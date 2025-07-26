// web/routes/notify-orders.js - FIXED
import express from "express";
import db from "../db.js";

const router = express.Router();

// POST /api/notify-orders - Get orders for notify orders
router.post("/", async (req, res) => {
  console.log("✌️ call notify orders api --->");
  try {
    const { shopDomain } = req.body;

    if (!shopDomain) {
      return res
        .status(400)
        .json({ success: false, error: "Missing shopDomain" });
    }

    // Get store_owner
    const storeOwnerResult = await db.query(
      "SELECT id FROM users WHERE shop_domain = $1 AND user_type = 'store_owner'",
      [shopDomain]
    );
    if (storeOwnerResult.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, error: "Store owner not found" });
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
      return res.json({ success: true, message: "No pending notifications" });
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
        const messageResult = await db.query(
          `INSERT INTO messages 
               (sender_id, receiver_id, content, message_type, order_data)
             VALUES ($1, $2, $3, 'order_notification', $4)
             RETURNING id`,
          [
            storeOwnerId,
            vendorUserId,
            "order notification",
            JSON.stringify(item),
          ]
        );

        const messageId = messageResult.rows[0].id;

        await db.query(
          `INSERT INTO message_recipients (message_id, delivery_status)
             VALUES ($1, 'sent')`,
          [messageId]
        );
      }

      // ✅ Mark all line items as notified
      await db.query(
        `UPDATE order_line_items SET notification = true WHERE id = ANY($1::int[])`,
        [lineItemIds]
      );

      results.push({
        vendorUserId,
        itemCount: mergedItems.length,
        message: "Notification sent",
      });
    }

    res.json({ success: true, notified: results });
  } catch (error) {
    console.error(
      "❌ Error in to send message and updating line item notification:",
      error
    );
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

export default router;
