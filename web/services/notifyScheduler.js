// web/services/notifyScheduler.js - Updated with Socket.IO integration
import dotenv from "dotenv";
dotenv.config();
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

import db from "../db.js";

function getCurrentTime() {
  const now = new Date();
  const hour = now.getHours();
  const ampm = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12} ${ampm}`;
}

export async function runNotifyScheduler() {
  try {
    const currentTime = getCurrentTime();

    const result = await db.query(`
      SELECT id, shop_domain, notify_mode, notify_value, last_notified_at
      FROM users 
      WHERE user_type = 'store_owner'
        AND notify_mode IS NOT NULL 
        AND notify_value IS NOT NULL
    `);

    const shopOwners = result.rows;

    for (const {
      shop_domain,
      notify_mode,
      notify_value,
      last_notified_at,
    } of shopOwners) {
      if (notify_mode === "specific_time") {
        if (notify_value === currentTime) {
          const lastNotifyTime = new Date(last_notified_at);
          const now = new Date();
          const lastDate = lastNotifyTime?.toDateString();
          const nowDate = now.toDateString();

          if (lastDate !== nowDate) {
            await triggerNotification(shop_domain);
          }
        }
      }

      if (notify_mode === "every_x_hours") {
        const interval = parseInt(notify_value);
        if (interval && interval > 0) {
          const now = new Date();

          // If last_notified_at is null, don't trigger notification immediately
          // Wait for the first scheduled interval
          if (!last_notified_at) {
            await triggerNotification(shop_domain);
            continue;
          }

          const lastNotifyTime = new Date(last_notified_at);

          // Check if lastNotifyTime is valid
          if (isNaN(lastNotifyTime.getTime())) {
            console.log(
              `⚠️ Invalid last_notified_at for ${shop_domain}, skipping`
            );
            continue;
          }

          const hoursSinceLast = (now - lastNotifyTime) / (1000 * 60 * 60);

          if (hoursSinceLast >= interval) {
            console.log(
              `⏰ Triggering notification for ${shop_domain} (${hoursSinceLast.toFixed(
                2
              )} 
              hours since last notification)`
            );
            await triggerNotification(shop_domain);
          } else {
            console.log(
              `⏰ Skipping notification for ${shop_domain} (${hoursSinceLast.toFixed(
                2
              )} 
              hours since last, interval: ${interval} hours)`
            );
          }
        }
      }
    }
  } catch (err) {
    console.error("❌ notifyScheduler error:", err);
  }
}

async function triggerNotification(shopDomain) {
  try {
    // Get store_owner
    const storeOwnerResult = await db.query(
      "SELECT id FROM users WHERE shop_domain = $1 AND user_type = 'store_owner'",
      [shopDomain]
    );
    if (storeOwnerResult.rows.length === 0) {
      console.error(`❌ Store owner not found for ${shopDomain}`);
      return { success: false, error: "Store owner not found" };
    }
    const storeOwnerId = storeOwnerResult.rows[0].id;

    // Get unnotified order line items grouped by vendor
    const lineItemsResult = await db.query(
      `SELECT 
          oli.id as line_item_id,
          oli.quantity,
          o.name as order_name,
          p.title as product_title,
          p.image,
          p.vendor_name,
          p.shopify_product_id,
          p.id as product_id,
          v.email as vendor_email,
          v.id as vendor_id,
          u.id as vendor_user_id
        FROM order_line_items oli
        JOIN orders o ON o.id = oli.order_id
        JOIN products p ON p.id = oli.product_id
        JOIN vendors v ON p.vendor_id = v.id
        JOIN users u ON u.email = v.email AND u.user_type = 'vendor'
        WHERE oli.notification = false AND oli.shop_domain = $1
        ORDER BY v.name, p.title`,
      [shopDomain]
    );

    const items = lineItemsResult.rows;

    if (items.length === 0) {
      // ✅ Update user last notified datetime
      await db.query(
        `UPDATE users SET last_notified_at = NOW() WHERE shop_domain = $1`,
        [shopDomain]
      );
      console.log(`No pending notifications for ${shopDomain}`);
      return { success: true, message: "No pending notifications" };
    }

    // Group by vendor
    const vendorMap = new Map();
    for (const item of items) {
      if (!vendorMap.has(item.vendor_user_id)) {
        vendorMap.set(item.vendor_user_id, {
          vendorId: item.vendor_id,
          vendorEmail: item.vendor_email,
          items: [],
          lineItemIds: [],
        });
      }

      vendorMap.get(item.vendor_user_id).items.push({
        name: item.product_title,
        sku: `SKU-${item.shopify_product_id}`,
        image: item.image,
        qty: item.quantity,
      });

      vendorMap.get(item.vendor_user_id).lineItemIds.push(item.line_item_id);
    }

    const results = [];

    // 🔥 Import socketManager dynamically to avoid circular dependencies
    let socketManager = null;
    try {
      const socketModule = await import("../socketServer.js");
      socketManager = socketModule.default;
    } catch (error) {
      console.warn("⚠️ Socket manager not available:", error.message);
    }

    for (const [vendorUserId, { items, lineItemIds }] of vendorMap.entries()) {
      // Group by SKU to merge same products
      const groupedBySKU = {};

      for (const item of items) {
        const sku = item.sku;
        if (!groupedBySKU[sku]) {
          groupedBySKU[sku] = { ...item };
        } else {
          groupedBySKU[sku].qty += item.qty;
        }
      }

      const mergedItems = Object.values(groupedBySKU);

      for (const item of mergedItems) {
        try {
          // Save message to database
          const messageResult = await db.query(
            `INSERT INTO messages 
                 (sender_id, receiver_id, content, message_type, order_data)
               VALUES ($1, $2, $3, 'order_notification', $4)
               RETURNING id`,
            [
              storeOwnerId,
              vendorUserId,
              "Order notification",
              JSON.stringify(item),
            ]
          );

          const messageId = messageResult.rows[0].id;

          await db.query(
            `INSERT INTO message_recipients (message_id, delivery_status)
               VALUES ($1, 'sent')`,
            [messageId]
          );

          // 🔥 SOCKET.IO INTEGRATION - Send real-time notification
          if (socketManager && socketManager.io) {
            try {
              await socketManager.sendOrderNotification(
                storeOwnerId,
                vendorUserId,
                item
              );
              console.log(
                `🔔 Real-time notification sent to vendor ${vendorUserId}`
              );
            } catch (socketError) {
              console.error("❌ Socket notification error:", socketError);
              // Continue with regular notification flow even if socket fails
            }
          }

          results.push({
            vendorUserId,
            messageId,
            item: item.name,
            socketSent: !!socketManager,
          });
        } catch (error) {
          console.error(
            `❌ Error sending notification to vendor ${vendorUserId}:`,
            error
          );
          results.push({
            vendorUserId,
            error: error.message,
          });
        }
      }

      // ✅ Mark all line items as notified
      await db.query(
        `UPDATE order_line_items SET notification = true WHERE id = ANY($1::int[])`,
        [lineItemIds]
      );

      // ✅ Also mark parent orders as notified if all their line items are now notified
      await db.query(
        `UPDATE orders
        SET notification = true
        WHERE id IN (
          SELECT o.id
          FROM orders o
          WHERE o.shop_domain = $1
            AND NOT EXISTS (
              SELECT 1
              FROM order_line_items oli
              WHERE oli.order_id = o.id AND oli.notification = false
            )
        )
      `,
        [shopDomain]
      );
    }

    // ✅ Update user last notified datetime
    await db.query(
      `UPDATE users SET last_notified_at = NOW() WHERE shop_domain = $1`,
      [shopDomain]
    );

    console.log(`✅ Notification process completed for ${shopDomain}`);
    console.log(`📊 Results:`, results);

    return { success: true, notified: results };
  } catch (error) {
    console.error(`❌ Error for ${shopDomain}:`, error.message);
    return { success: false, error: error.message };
  }
}
