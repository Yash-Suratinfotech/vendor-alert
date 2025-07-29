// web/socketServer.js - Socket.IO integration for real-time chat
import { Server } from "socket.io";
import { verifyToken } from "./utils/jwt.js";
import db from "./db.js";

class SocketManager {
  constructor() {
    this.io = null;
    this.connectedUsers = new Map(); // userId -> socketId
    this.userSockets = new Map(); // socketId -> user data
  }

  initialize(httpServer) {
    this.io = new Server(httpServer, {
      cors: {
        origin: "*", // Configure appropriately for production
        methods: ["GET", "POST"],
      },
    });

    this.setupSocketHandlers();
    console.log("✅ Socket.IO server initialized");
  }

  setupSocketHandlers() {
    this.io.on("connection", (socket) => {
      console.log(`🔌 Socket connected: ${socket.id}`);

      // Authentication
      socket.on("authenticate", async (data) => {
        try {
          const { token } = data;
          const decoded = verifyToken(token);

          // Get user from database
          const userResult = await db.query(
            "SELECT id, username, email, user_type, avatar_url, color FROM users WHERE id = $1",
            [decoded.userId]
          );

          if (userResult.rows.length === 0) {
            socket.emit("auth_error", { message: "User not found" });
            return;
          }

          const user = userResult.rows[0];

          // Store user connection
          this.connectedUsers.set(user.id, socket.id);
          this.userSockets.set(socket.id, user);

          // Join user-specific room
          socket.join(`user_${user.id}`);

          // Update user status to online
          await db.query("UPDATE users SET last_active = NOW() WHERE id = $1", [
            user.id,
          ]);

          socket.emit("authenticated", {
            user: user,
            status: "connected",
          });

          // Notify contacts that user is online
          await this.notifyContactsUserOnline(user.id, true);

          console.log(
            `✅ User authenticated: ${user.username} (${user.user_type})`
          );
        } catch (error) {
          console.error("❌ Authentication error:", error);
          socket.emit("auth_error", { message: "Authentication failed" });
        }
      });

      // Join conversation room
      socket.on("join_conversation", async (data) => {
        try {
          const user = this.userSockets.get(socket.id);
          if (!user) {
            socket.emit("error", { message: "Not authenticated" });
            return;
          }

          const { contactId } = data;
          const conversationRoom = this.getConversationRoom(user.id, contactId);

          socket.join(conversationRoom);
          console.log(
            `👥 User ${user.username} joined conversation with ${contactId}`
          );

          // Mark messages as delivered
          await this.markMessagesAsDelivered(contactId, user.id);

          socket.emit("conversation_joined", {
            conversationRoom,
            contactId,
          });
        } catch (error) {
          console.error("❌ Error joining conversation:", error);
          socket.emit("error", { message: "Failed to join conversation" });
        }
      });

      // Leave conversation room
      socket.on("leave_conversation", (data) => {
        try {
          const user = this.userSockets.get(socket.id);
          if (!user) return;

          const { contactId } = data;
          const conversationRoom = this.getConversationRoom(user.id, contactId);

          socket.leave(conversationRoom);
          console.log(
            `👋 User ${user.username} left conversation with ${contactId}`
          );
        } catch (error) {
          console.error("❌ Error leaving conversation:", error);
        }
      });

      // Send message
      socket.on("send_message", async (data) => {
        try {
          const user = this.userSockets.get(socket.id);
          if (!user) {
            socket.emit("error", { message: "Not authenticated" });
            return;
          }

          const {
            receiverId,
            content,
            messageType = "text",
            fileUrl,
            fileName,
            orderData,
          } = data;

          // Save message to database
          const client = await db.getClient();
          await client.query("BEGIN");

          const messageResult = await client.query(
            `INSERT INTO messages (sender_id, receiver_id, content, message_type, file_url, file_name, order_data)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [
              user.id,
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

          await client.query("COMMIT");
          client.release();

          // Get enriched message data
          const enrichedMessage = await this.getEnrichedMessage(message.id);

          // Send to conversation room
          const conversationRoom = this.getConversationRoom(
            user.id,
            receiverId
          );
          this.io.to(conversationRoom).emit("new_message", enrichedMessage);

          // Send to receiver's user room if they're online but not in conversation
          const receiverSocketId = this.connectedUsers.get(receiverId);
          if (receiverSocketId) {
            this.io.to(`user_${receiverId}`).emit("message_notification", {
              senderId: user.id,
              senderName: user.username,
              message: enrichedMessage,
              conversationRoom,
            });

            // Mark as delivered immediately if receiver is online
            await this.markMessageAsDelivered(message.id);
            this.io.to(conversationRoom).emit("message_delivered", {
              messageId: message.id,
              deliveredAt: new Date(),
            });
          }

          console.log(
            `💬 Message sent from ${user.username} to user ${receiverId}`
          );
        } catch (error) {
          console.error("❌ Error sending message:", error);
          socket.emit("error", { message: "Failed to send message" });
        }
      });

      // Mark message as read
      socket.on("mark_message_read", async (data) => {
        try {
          const user = this.userSockets.get(socket.id);
          if (!user) return;

          const { messageId, senderId } = data;

          await db.query(
            `UPDATE message_recipients 
             SET is_read = true, read_at = NOW(), delivery_status = 'read'
             WHERE message_id = $1`,
            [messageId]
          );

          // Notify sender about read receipt
          const conversationRoom = this.getConversationRoom(user.id, senderId);
          this.io.to(conversationRoom).emit("message_read", {
            messageId,
            readAt: new Date(),
            readBy: user.id,
          });
        } catch (error) {
          console.error("❌ Error marking message as read:", error);
        }
      });

      // Handle order response (accept/decline)
      socket.on("order_response", async (data) => {
        try {
          const user = this.userSockets.get(socket.id);
          if (!user || user.user_type !== "vendor") {
            socket.emit("error", {
              message: "Only vendors can respond to orders",
            });
            return;
          }

          const { messageId, response, storeOwnerId } = data; // response: 'accept' or 'decline'

          // Update the message recipient with acceptance status
          await db.query(
            `UPDATE message_recipients 
             SET is_accept = $1, delivery_status = 'read', read_at = NOW()
             WHERE message_id = $2`,
            [response === "accept", messageId]
          );

          // Notify store owner about vendor response
          const conversationRoom = this.getConversationRoom(
            user.id,
            storeOwnerId
          );
          this.io.to(conversationRoom).emit("order_response", {
            originalMessageId: messageId,
            response,
            responseMessage,
            vendor: {
              id: user.id,
              name: user.username,
            },
          });

          // Send notification to store owner
          this.io
            .to(`user_${storeOwnerId}`)
            .emit("vendor_response_notification", {
              vendorName: user.username,
              response,
              messageId,
              responseMessage,
            });

          console.log(
            `📋 Order ${response} by vendor ${user.username} for message ${messageId}`
          );
        } catch (error) {
          console.error("❌ Error handling order response:", error);
          socket.emit("error", { message: "Failed to process order response" });
        }
      });

      // Typing indicators
      socket.on("typing_start", (data) => {
        const user = this.userSockets.get(socket.id);
        if (!user) return;

        const { contactId } = data;
        const conversationRoom = this.getConversationRoom(user.id, contactId);

        socket.to(conversationRoom).emit("user_typing", {
          userId: user.id,
          username: user.username,
          isTyping: true,
        });
      });

      socket.on("typing_stop", (data) => {
        const user = this.userSockets.get(socket.id);
        if (!user) return;

        const { contactId } = data;
        const conversationRoom = this.getConversationRoom(user.id, contactId);

        socket.to(conversationRoom).emit("user_typing", {
          userId: user.id,
          username: user.username,
          isTyping: false,
        });
      });

      // Handle disconnection
      socket.on("disconnect", async () => {
        try {
          const user = this.userSockets.get(socket.id);
          if (user) {
            // Remove from connected users
            this.connectedUsers.delete(user.id);
            this.userSockets.delete(socket.id);

            // Update last active time
            await db.query(
              "UPDATE users SET last_active = NOW() WHERE id = $1",
              [user.id]
            );

            // Notify contacts that user is offline
            await this.notifyContactsUserOnline(user.id, false);

            console.log(`🔌 User disconnected: ${user.username}`);
          }
        } catch (error) {
          console.error("❌ Error handling disconnect:", error);
        }
      });
    });
  }

  // Helper methods
  getConversationRoom(userId1, userId2) {
    const sortedIds = [userId1, userId2].sort((a, b) => a - b);
    return `conversation_${sortedIds[0]}_${sortedIds[1]}`;
  }

  async getEnrichedMessage(messageId) {
    const result = await db.query(
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
      [messageId]
    );

    if (result.rows.length === 0) return null;

    const msg = result.rows[0];
    return {
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
  }

  async sendSystemMessage(senderId, receiverId, content, messageType = "text") {
    const client = await db.getClient();
    await client.query("BEGIN");

    const messageResult = await client.query(
      `INSERT INTO messages (sender_id, receiver_id, content, message_type)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [senderId, receiverId, content, messageType]
    );

    const message = messageResult.rows[0];

    await client.query(
      `INSERT INTO message_recipients (message_id, delivery_status)
       VALUES ($1, 'sent')`,
      [message.id]
    );

    await client.query("COMMIT");
    client.release();

    return await this.getEnrichedMessage(message.id);
  }

  async markMessageAsDelivered(messageId) {
    await db.query(
      `UPDATE message_recipients 
       SET delivery_status = 'delivered', delivered_at = NOW()
       WHERE message_id = $1 AND delivery_status = 'sent'`,
      [messageId]
    );
  }

  async markMessagesAsDelivered(senderId, receiverId) {
    await db.query(
      `UPDATE message_recipients 
       SET delivery_status = 'delivered', delivered_at = NOW()
       WHERE message_id IN (
         SELECT id FROM messages 
         WHERE sender_id = $1 AND receiver_id = $2 
         AND created_at > NOW() - INTERVAL '1 hour'
       ) AND delivery_status = 'sent'`,
      [senderId, receiverId]
    );
  }

  async notifyContactsUserOnline(userId, isOnline) {
    try {
      // Get user's contacts (vendors if store owner, store owners if vendor)
      const user = await db.query(
        "SELECT user_type, email FROM users WHERE id = $1",
        [userId]
      );
      if (user.rows.length === 0) return;

      const userType = user.rows[0].user_type;
      let contacts = [];

      if (userType === "store_owner") {
        // Get all vendor contacts
        contacts = await db.query(
          `SELECT u.id FROM users u 
           JOIN vendors v ON v.email = u.email 
           WHERE v.shop_domain = (SELECT shop_domain FROM users WHERE id = $1)
           AND u.user_type = 'vendor' AND u.id != $1`,
          [userId]
        );
      } else if (userType === "vendor") {
        // Get store owner contacts
        contacts = await db.query(
          `SELECT u.id FROM users u 
           WHERE u.shop_domain IN (
             SELECT v.shop_domain FROM vendors v 
             WHERE v.email = (SELECT email FROM users WHERE id = $1)
           ) AND u.user_type = 'store_owner'`,
          [userId]
        );
      }

      // Notify online contacts
      contacts.rows.forEach((contact) => {
        const contactSocketId = this.connectedUsers.get(contact.id);
        if (contactSocketId) {
          this.io.to(`user_${contact.id}`).emit("contact_status_changed", {
            userId,
            isOnline,
            timestamp: new Date(),
          });
        }
      });
    } catch (error) {
      console.error("❌ Error notifying contacts about user status:", error);
    }
  }

  // Public method to send notifications from other parts of the app
  async sendOrderNotification(storeOwnerId, vendorUserId, orderData) {
    try {
      const enrichedMessage = await this.sendSystemMessage(
        storeOwnerId,
        vendorUserId,
        "New order notification",
        "order_notification"
      );

      // Update the message with order data
      await db.query("UPDATE messages SET order_data = $1 WHERE id = $2", [
        JSON.stringify(orderData),
        enrichedMessage.id,
      ]);

      enrichedMessage.orderData = orderData;

      // Send real-time notification
      const conversationRoom = this.getConversationRoom(
        storeOwnerId,
        vendorUserId
      );
      this.io.to(conversationRoom).emit("new_message", enrichedMessage);

      // Send push notification if vendor is online
      this.io.to(`user_${vendorUserId}`).emit("order_notification", {
        message: enrichedMessage,
        orderData,
        storeOwner: storeOwnerId,
      });

      return enrichedMessage;
    } catch (error) {
      console.error("❌ Error sending order notification:", error);
      throw error;
    }
  }
}

export default new SocketManager();
