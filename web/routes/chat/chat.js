// web/routes/chat/chat.js - Complete Updated with Socket.IO integration
import express from "express";
import db from "../../db.js";

const router = express.Router();

// ============== CONVERSATION ROUTES =================

// GET /chat/conversations - Get conversation list for current user
router.get("/conversations", async (req, res) => {
  try {
    const { userId, userType } = req.query;

    let conversations;

    if (userType === "store_owner") {
      // Get all vendors from same shop and their conversations
      conversations = await db.query(
        `SELECT DISTINCT
          u.id as contact_id,
          u.username as contact_name,
          u.email as contact_email,
          u.color as contact_color,
          u.avatar_url as contact_avatar,
          'vendor' as contact_type,
          v.name as vendor_name,
          v.mobile as vendor_mobile,
          (SELECT content FROM messages 
           WHERE (sender_id = $1 AND receiver_id = u.id) OR (sender_id = u.id AND receiver_id = $1)
           ORDER BY created_at DESC LIMIT 1) as last_message,
          (SELECT created_at FROM messages 
           WHERE (sender_id = $1 AND receiver_id = u.id) OR (sender_id = u.id AND receiver_id = $1)
           ORDER BY created_at DESC LIMIT 1) as last_message_time,
          (SELECT COUNT(*) FROM messages m
           JOIN message_recipients mr ON mr.message_id = m.id
           WHERE m.sender_id = u.id AND m.receiver_id = $1 AND mr.is_read = false) as unread_count,
          u.last_active,
          CASE 
            WHEN u.last_active > NOW() - INTERVAL '5 minutes' THEN true 
            ELSE false 
          END as is_online
         FROM vendors v
         JOIN users u ON u.email = v.email AND u.user_type = 'vendor'
         WHERE v.shop_domain = (SELECT shop_domain FROM users WHERE id = $1 AND user_type = 'store_owner')
         ORDER BY last_message_time DESC NULLS LAST`,
        [userId]
      );
    } else if (userType === "vendor") {
      // Get all store owners from users where this vendor exists
      conversations = await db.query(
        `SELECT DISTINCT
          u.id as contact_id,
          u.username as contact_name,
          u.email as contact_email,
          u.color as contact_color,
          u.avatar_url as contact_avatar,
          'store_owner' as contact_type,
          u.username as shop_name,
          u.shop_domain,
          (SELECT content FROM messages 
           WHERE (sender_id = $1 AND receiver_id = u.id) OR (sender_id = u.id AND receiver_id = $1)
           ORDER BY created_at DESC LIMIT 1) as last_message,
          (SELECT created_at FROM messages 
           WHERE (sender_id = $1 AND receiver_id = u.id) OR (sender_id = u.id AND receiver_id = $1)
           ORDER BY created_at DESC LIMIT 1) as last_message_time,
          (SELECT COUNT(*) FROM messages m
           JOIN message_recipients mr ON mr.message_id = m.id
           WHERE m.sender_id = u.id AND m.receiver_id = $1 AND mr.is_read = false) as unread_count,
          u.last_active,
          CASE 
            WHEN u.last_active > NOW() - INTERVAL '5 minutes' THEN true 
            ELSE false 
          END as is_online
          FROM vendors v
          JOIN users u ON u.shop_domain = v.shop_domain AND u.user_type = 'store_owner'
          WHERE v.email = (SELECT email FROM users WHERE id = $1)`,
        [userId]
      );
    }

    const formattedConversations = conversations.rows.map((conv) => ({
      contactId: conv.contact_id,
      contactName: conv.vendor_name || conv.shop_name || conv.contact_name,
      contactEmail: conv.contact_email,
      contactAvatar: conv.contact_avatar,
      contactType: conv.contact_type,
      lastMessage: conv.last_message || "No messages yet",
      lastMessageTime: conv.last_message_time,
      unreadCount: parseInt(conv.unread_count || 0),
      color: conv.contact_color,
      isOnline: conv.is_online,
      lastActive: conv.last_active,
      metadata: {
        vendorName: conv.vendor_name,
        vendorMobile: conv.vendor_mobile,
        shopName: conv.shop_name,
        shopDomain: conv.shop_domain,
      },
    }));

    res.status(200).json({
      status: 200,
      success: true,
      conversations: formattedConversations,
    });
  } catch (error) {
    console.error("❌ Error fetching conversations:", error);
    res.status(500).json({
      status: 500,
      success: false,
      error: "Failed to fetch conversations",
    });
  }
});

// ============== MESSAGE ROUTES =================

// GET /chat/messages - Get messages between two users
router.get("/messages", async (req, res) => {
  try {
    const { userId, contactId, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const messages = await db.query(
      `SELECT 
        m.*,
        u_sender.username as sender_username,
        u_sender.user_type as sender_type,
        u_receiver.username as receiver_username,
        mr.is_read,
        mr.read_at,
        mr.delivery_status,
        mr.is_accept
       FROM messages m
       JOIN users u_sender ON u_sender.id = m.sender_id
       JOIN users u_receiver ON u_receiver.id = m.receiver_id
       LEFT JOIN message_recipients mr ON mr.message_id = m.id
       WHERE ((m.sender_id = $1 AND m.receiver_id = $2) OR (m.sender_id = $2 AND m.receiver_id = $1))
       AND m.is_deleted = false
       ORDER BY m.created_at DESC
       LIMIT $3 OFFSET $4`,
      [userId, contactId, parseInt(limit), offset]
    );

    const formattedMessages = messages.rows.map((msg) => ({
      id: msg.id,
      content: msg.content,
      messageType: msg.message_type,
      fileUrl: msg.file_url,
      fileName: msg.file_name,
      orderData: msg.order_data,
      sender: {
        id: msg.sender_id,
        username: msg.sender_username,
        type: msg.sender_type,
      },
      receiver: {
        id: msg.receiver_id,
        username: msg.receiver_username,
      },
      isRead: msg.is_read,
      readAt: msg.read_at,
      deliveryStatus: msg.delivery_status,
      isAccept: msg.is_accept, // For order notifications
      createdAt: msg.created_at,
    }));

    res.status(200).json({
      status: 200,
      success: true,
      messages: formattedMessages.reverse(), // Return in chronological order
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        hasMore: messages.rows.length === parseInt(limit),
      },
    });
  } catch (error) {
    console.error("❌ Error fetching messages:", error);
    res.status(500).json({
      status: 500,
      success: false,
      error: "Failed to fetch messages",
    });
  }
});

// POST /chat/messages - Send a message (Updated with Socket.IO integration)
router.post("/messages", async (req, res) => {
  try {
    const {
      senderId,
      receiverId,
      content,
      messageType = "text",
      fileUrl,
      fileName,
      orderData,
    } = req.body;

    const client = await db.getClient();
    await client.query("BEGIN");

    // Insert message
    const messageResult = await client.query(
      `INSERT INTO messages (sender_id, receiver_id, content, message_type, file_url, file_name, order_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        senderId,
        receiverId,
        content,
        messageType,
        fileUrl || null,
        fileName || null,
        orderData ? JSON.stringify(orderData) : null,
      ]
    );

    const message = messageResult.rows[0];

    // Create message recipient record
    await client.query(
      `INSERT INTO message_recipients (message_id, delivery_status)
       VALUES ($1, 'sent')`,
      [message.id]
    );

    // Fetch full enriched message like in GET API
    const enrichedMessage = await client.query(
      `SELECT 
        m.*,
        u_sender.username as sender_username,
        u_sender.user_type as sender_type,
        u_receiver.username as receiver_username,
        mr.is_read,
        mr.read_at,
        mr.delivery_status,
        mr.is_accept
       FROM messages m
       JOIN users u_sender ON u_sender.id = m.sender_id
       JOIN users u_receiver ON u_receiver.id = m.receiver_id
       LEFT JOIN message_recipients mr ON mr.message_id = m.id
       WHERE m.id = $1`,
      [message.id]
    );

    await client.query("COMMIT");
    client.release();

    const msg = enrichedMessage.rows[0];
    const formattedMessage = {
      id: msg.id,
      content: msg.content,
      messageType: msg.message_type,
      fileUrl: msg.file_url,
      fileName: msg.file_name,
      orderData: msg.order_data,
      sender: {
        id: msg.sender_id,
        username: msg.sender_username,
        type: msg.sender_type,
      },
      receiver: {
        id: msg.receiver_id,
        username: msg.receiver_username,
      },
      isRead: msg.is_read,
      readAt: msg.read_at,
      deliveryStatus: msg.delivery_status,
      isAccept: msg.is_accept,
      createdAt: msg.created_at,
    };

    // 🔥 SOCKET.IO INTEGRATION - Send real-time message
    const socketManager = req.app.locals.socketManager;
    if (socketManager && socketManager.io) {
      try {
        // Get conversation room
        const conversationRoom = socketManager.getConversationRoom(
          senderId,
          receiverId
        );

        // Emit to conversation room
        socketManager.io
          .to(conversationRoom)
          .emit("new_message", formattedMessage);

        // Send notification to receiver if they're online but not in conversation
        socketManager.io.to(`user_${receiverId}`).emit("message_notification", {
          senderId: senderId,
          message: formattedMessage,
          conversationRoom,
        });

        // Check if receiver is online and mark as delivered
        if (socketManager.connectedUsers.has(receiverId)) {
          await db.query(
            `UPDATE message_recipients 
             SET delivery_status = 'delivered', delivered_at = NOW()
             WHERE message_id = $1`,
            [message.id]
          );

          formattedMessage.deliveryStatus = "delivered";

          // Emit delivery confirmation
          socketManager.io.to(conversationRoom).emit("message_delivered", {
            messageId: message.id,
            deliveredAt: new Date(),
          });
        }
      } catch (socketError) {
        console.error("❌ Socket.IO error in message sending:", socketError);
        // Don't fail the API call if socket fails
      }
    }

    res.status(200).json({
      status: 200,
      success: true,
      message: formattedMessage,
    });
  } catch (error) {
    console.error("❌ Error sending message:", error);
    res.status(500).json({
      status: 500,
      success: false,
      error: "Failed to send message",
    });
  }
});

// PUT /chat/messages/:id/read - Mark message as read
router.put("/messages/:id/read", async (req, res) => {
  try {
    const messageId = req.params.id;

    await db.query(
      `UPDATE message_recipients 
       SET is_read = true, read_at = NOW(), delivery_status = 'read'
       WHERE message_id = $1`,
      [messageId]
    );

    // 🔥 SOCKET.IO INTEGRATION - Send read receipt
    const socketManager = req.app.locals.socketManager;
    if (socketManager && socketManager.io) {
      try {
        // Get message details to find conversation
        const msgResult = await db.query(
          "SELECT sender_id, receiver_id FROM messages WHERE id = $1",
          [messageId]
        );

        if (msgResult.rows.length > 0) {
          const { sender_id, receiver_id } = msgResult.rows[0];
          const conversationRoom = socketManager.getConversationRoom(
            sender_id,
            receiver_id
          );

          socketManager.io.to(conversationRoom).emit("message_read", {
            messageId,
            readAt: new Date(),
          });
        }
      } catch (socketError) {
        console.error("❌ Socket.IO error in read receipt:", socketError);
      }
    }

    res.status(200).json({
      status: 200,
      success: true,
      message: "Message marked as read",
    });
  } catch (error) {
    console.error("❌ Error marking message as read:", error);
    res.status(500).json({
      status: 500,
      success: false,
      error: "Failed to mark message as read",
    });
  }
});

// ============== ORDER NOTIFICATION ROUTES =================

// POST /chat/send-order-notification - Send automated order notification
router.post("/send-order-notification", async (req, res) => {
  try {
    const { orderId, userId } = req.body;

    // Get order details with line items
    const orderData = await db.query(
      `SELECT 
        o.*,
        json_agg(
          json_build_object(
            'productId', p.id,
            'title', p.title,
            'image', p.image,
            'quantity', oli.quantity,
            'vendorName', p.vendor_name
          )
        ) as line_items
       FROM orders o
       JOIN order_line_items oli ON oli.order_id = o.id
       JOIN products p ON p.id = oli.product_id
       WHERE o.id = $1 AND o.shop_domain = (SELECT shop_domain FROM users WHERE id = $2)
       GROUP BY o.id`,
      [orderId, userId]
    );

    if (orderData.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        success: false,
        error: "Order not found",
      });
    }

    const order = orderData.rows[0];
    const lineItems = order.line_items;

    // Group line items by vendor
    const vendorOrders = {};
    lineItems.forEach((item) => {
      if (item.vendorName) {
        if (!vendorOrders[item.vendorName]) {
          vendorOrders[item.vendorName] = [];
        }
        vendorOrders[item.vendorName].push(item);
      }
    });

    const results = [];

    // Get store owner user
    const storeOwner = await db.query(
      "SELECT * FROM users WHERE shop_domain = $1 AND user_type = 'store_owner' LIMIT 1",
      [userId]
    );

    if (storeOwner.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        success: false,
        error: "Store owner not found",
      });
    }

    // 🔥 SOCKET.IO INTEGRATION - Get socket manager
    const socketManager = req.app.locals.socketManager;

    // Send notification to each vendor
    for (const [vendorName, items] of Object.entries(vendorOrders)) {
      try {
        // Find vendor user by email matching
        const vendorUser = await db.query(
          `SELECT u.* FROM users u 
           JOIN vendors v ON v.email = u.email 
           WHERE v.name = $1 AND v.shop_domain = (SELECT shop_domain FROM users WHERE id = $2)
           AND u.user_type = 'vendor'`,
          [vendorName, userId]
        );

        if (vendorUser.rows.length === 0) {
          results.push({
            vendor: vendorName,
            error: "Vendor user not found",
          });
          continue;
        }

        // Create order notification message
        const orderSummary = {
          orderNumber: order.name,
          orderDate: order.shopify_created_at,
          items: items.map((item) => ({
            title: item.title,
            image: item.image,
            quantity: item.quantity,
          })),
          totalItems: items.reduce((sum, item) => sum + item.quantity, 0),
        };

        const notificationContent = `🛍️ New Order: ${
          order.name
        }\n\nItems for ${vendorName}:\n${items
          .map((item) => `• ${item.title} (Qty: ${item.quantity})`)
          .join("\n")}\n\nTotal Items: ${orderSummary.totalItems}`;

        // Send automated message
        const messageResult = await db.query(
          `INSERT INTO messages (sender_id, receiver_id, content, message_type, order_data)
           VALUES ($1, $2, $3, 'order_notification', $4)
           RETURNING *`,
          [
            storeOwner.rows[0].id,
            vendorUser.rows[0].id,
            notificationContent,
            JSON.stringify(orderSummary),
          ]
        );

        // Create recipient record
        await db.query(
          `INSERT INTO message_recipients (message_id, delivery_status)
           VALUES ($1, 'sent')`,
          [messageResult.rows[0].id]
        );

        // 🔥 SOCKET.IO INTEGRATION - Send real-time order notification
        if (socketManager && socketManager.io) {
          try {
            await socketManager.sendOrderNotification(
              storeOwner.rows[0].id,
              vendorUser.rows[0].id,
              orderSummary
            );
          } catch (socketError) {
            console.error(
              "❌ Socket.IO error in order notification:",
              socketError
            );
          }
        }

        results.push({
          vendor: vendorName,
          messageId: messageResult.rows[0].id,
          itemCount: items.length,
        });
      } catch (error) {
        console.error(
          `❌ Error sending notification to vendor ${vendorName}:`,
          error
        );
        results.push({
          vendor: vendorName,
          error: error.message,
        });
      }
    }

    // Mark order as notified
    await db.query("UPDATE orders SET notification = true WHERE id = $1", [
      orderId,
    ]);

    res.status(200).json({
      status: 200,
      success: true,
      message: "Order notifications sent",
      results,
      orderNumber: order.name,
    });
  } catch (error) {
    console.error("❌ Error sending order notifications:", error);
    res.status(500).json({
      status: 500,
      success: false,
      error: "Failed to send order notifications",
    });
  }
});

// POST /chat/vendor-response - Handle vendor response to order (accept/decline)
router.post("/vendor-response", async (req, res) => {
  try {
    const { messageId, vendorUserId, response, storeOwnerId } = req.body; // response: 'accept' or 'decline'

    // Update the message recipient with acceptance status
    await db.query(
      `UPDATE message_recipients 
       SET is_accept = $1, delivery_status = 'read', read_at = NOW()
       WHERE message_id = $2`,
      [response === "accept", messageId]
    );

    // Send response message
    const originalMessage = await db.query(
      "SELECT * FROM messages WHERE id = $1",
      [messageId]
    );

    if (originalMessage.rows.length > 0) {
      const responseMessage =
        response === "accept"
          ? "✅ Order accepted! I'll prepare your items."
          : "❌ Sorry, I can't fulfill this order right now.";

      const responseResult = await db.query(
        `INSERT INTO messages (sender_id, receiver_id, content, message_type)
         VALUES ($1, $2, $3, 'text')
         RETURNING *`,
        [
          vendorUserId,
          originalMessage.rows[0].sender_id,
          responseMessage,
          "text",
        ]
      );

      // Create recipient record for response
      await db.query(
        `INSERT INTO message_recipients (message_id, delivery_status)
         VALUES ($1, 'sent')`,
        [responseResult.rows[0].id]
      );

      // 🔥 SOCKET.IO INTEGRATION - Send real-time vendor response
      const socketManager = req.app.locals.socketManager;
      if (socketManager && socketManager.io) {
        try {
          const conversationRoom = socketManager.getConversationRoom(
            vendorUserId,
            storeOwnerId
          );

          // Send order response notification
          socketManager.io.to(conversationRoom).emit("order_response", {
            originalMessageId: messageId,
            response,
            responseMessage: {
              id: responseResult.rows[0].id,
              content: responseMessage,
              senderId: vendorUserId,
              createdAt: responseResult.rows[0].created_at,
            },
            vendor: {
              id: vendorUserId,
            },
          });

          // Send notification to store owner
          socketManager.io
            .to(`user_${storeOwnerId}`)
            .emit("vendor_response_notification", {
              vendorUserId,
              response,
              messageId,
              responseMessage: responseMessage,
            });
        } catch (socketError) {
          console.error("❌ Socket.IO error in vendor response:", socketError);
        }
      }
    }

    res.status(200).json({
      status: 200,
      success: true,
      message: "Vendor response recorded",
      response,
    });
  } catch (error) {
    console.error("❌ Error recording vendor response:", error);
    res.status(500).json({
      status: 500,
      success: false,
      error: "Failed to record vendor response",
    });
  }
});

// DELETE /chat/messages - Delete messages
router.delete("/messages", async (req, res) => {
  try {
    const { messageIds, userId } = req.body;

    if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
      return res.status(400).json({
        status: 400,
        success: false,
        error: "Message IDs array is required",
      });
    }

    // Soft delete messages (only for the requesting user)
    const result = await db.query(
      `UPDATE messages 
       SET is_deleted = true, updated_at = NOW()
       WHERE id = ANY($1::int[]) 
       AND (sender_id = $2 OR receiver_id = $2)
       RETURNING id`,
      [messageIds, userId]
    );

    res.status(200).json({
      status: 200,
      success: true,
      message: "Messages deleted successfully",
      deletedCount: result.rows.length,
    });
  } catch (error) {
    console.error("❌ Error deleting messages:", error);
    res.status(500).json({
      status: 500,
      success: false,
      error: "Failed to delete messages",
    });
  }
});

export default router;
