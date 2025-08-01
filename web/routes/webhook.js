// web/routes/webhook.js
import express from "express";
import db from "../db.js";
import dataSyncService from "../services/dataSyncService.js";

const router = express.Router();

// Middleware to verify webhook authenticity (simplified for now)
const verifyWebhook = (req, res, next) => {
  console.log("✌️req --->", req);
  // Add proper webhook verification logic here if needed
  next();
};

// Order webhooks - Main focus since we only care about order-based products
router.post("/orders", verifyWebhook, async (req, res) => {
  console.log("✌️req --->", req);
  try {
    const shop = req.headers["x-shopify-shop-domain"];
    const topic = req.headers["x-shopify-topic"];
    const rawOrderData = req.body;

    console.log(`📋 Order webhook received: ${topic} for shop: ${shop}`);

    if (!shop) {
      return res
        .status(400)
        .json({ status: 400, error: "Missing shop domain" });
    }

    // Process only the data we need for vendor alerts
    const filteredOrderData = {
      id: rawOrderData.id,
      name: rawOrderData.name,
      created_at: rawOrderData.created_at,
      updated_at: rawOrderData.updated_at,
      cancelled_at: rawOrderData.cancelled_at,
      line_items: rawOrderData.line_items.map((item) => ({
        id: item.id,
        title: item.title,
        vendor: item.vendor,
        quantity: item.quantity,
        product_id: item.product_id,
        variant_id: item.variant_id,
        // We'll fetch image from GraphQL if needed
      })),
    };

    // Process the filtered order data
    await dataSyncService.handleWebhookSync(filteredOrderData, shop, topic);

    // Check if this requires vendor notification
    if (topic === "orders/create" || topic === "orders/paid") {
      await handleVendorNotification(filteredOrderData, shop);
    }

    res
      .status(200)
      .json({ status: 200, success: true, message: "Order webhook processed" });
  } catch (error) {
    console.error("❌ Order webhook error:", error);
    res
      .status(500)
      .json({ status: 500, error: "Failed to process order webhook" });
  }
});

// Handle vendor notification for new orders
async function handleVendorNotification(orderData, shopDomain) {
  try {
    console.log(
      `🔔 Processing vendor notifications for order: ${
        orderData.name || orderData.id
      }`
    );

    // Get all vendors from line items
    const vendors = new Set();
    orderData.line_items.forEach((item) => {
      if (item.vendor) {
        vendors.add(item.vendor);
      }
    });

    // For each vendor, prepare notification data
    for (const vendorName of vendors) {
      const vendorResult = await db.query(
        `
        SELECT v.*, COUNT(DISTINCT p.id) as product_count
        FROM vendors v
        LEFT JOIN products p ON p.vendor_id = v.id
        WHERE v.name = $1 AND v.shop_domain = $2
        GROUP BY v.id
      `,
        [vendorName, shopDomain]
      );

      if (vendorResult.rows.length > 0) {
        const vendor = vendorResult.rows[0];

        // Calculate vendor-specific order details
        const vendorItems = orderData.line_items.filter(
          (item) => item.vendor === vendorName
        );
        const totalQuantity = vendorItems.reduce(
          (sum, item) => sum + item.quantity,
          0
        );

        console.log(
          `📱 Vendor ${vendor.name} has ${totalQuantity} items in order ${orderData.name}`
        );

        // Notification data preparation (implement actual notification logic here)
        const notificationData = {
          vendorName: vendor.name,
          vendorContact: vendor.mobile || vendor.email,
          upiId: vendor.upi_id,
          orderNumber: orderData.name,
          orderDate: new Date().toLocaleDateString(),
          itemCount: totalQuantity,
          items: vendorItems.map((item) => ({
            title: item.title,
            quantity: item.quantity,
          })),
        };

        // TODO: Implement actual notification (SMS/Email/WhatsApp)
        console.log(`📨 Notification ready for vendor:`, notificationData);

        // Mark order as notified
        await db.query(
          `
          UPDATE orders 
          SET notification = TRUE, updated_at = NOW() 
          WHERE shopify_order_id = $1 AND shop_domain = $2
        `,
          [orderData.id, shopDomain]
        );
      }
    }
  } catch (error) {
    console.error("❌ Error in vendor notification:", error);
  }
}

// Privacy webhooks (unchanged - no customer data stored)
router.post(
  "/privacy/customers-data-request",
  verifyWebhook,
  async (req, res) => {
    try {
      const shop = req.headers["x-shopify-shop-domain"];
      console.log(
        `📋 Customer data request for shop: ${shop} - no personal data stored`
      );
      res
        .status(200)
        .json({ success: true, message: "No customer data stored" });
    } catch (error) {
      console.error("❌ Customer data request error:", error);
      res.status(500).json({ error: "Failed to process request" });
    }
  }
);

router.post("/privacy/customers-redact", verifyWebhook, async (req, res) => {
  try {
    const shop = req.headers["x-shopify-shop-domain"];
    console.log(
      `🗑️ Customer redaction request for shop: ${shop} - no personal data to redact`
    );
    res
      .status(200)
      .json({ success: true, message: "No customer data to redact" });
  } catch (error) {
    console.error("❌ Customer redaction error:", error);
    res.status(500).json({ error: "Failed to process redaction" });
  }
});

router.post("/privacy/shop-redact", verifyWebhook, async (req, res) => {
  try {
    const shop = req.headers["x-shopify-shop-domain"];
    console.log(`🗑️ Shop redaction for: ${shop}`);

    const client = await db.getClient();
    try {
      await client.query("BEGIN");

      // Clean up all shop data in correct order (respecting foreign keys)
      await client.query(
        "DELETE FROM order_line_items WHERE shop_domain = $1",
        [shop]
      );
      await client.query("DELETE FROM orders WHERE shop_domain = $1", [shop]);
      await client.query("DELETE FROM products WHERE shop_domain = $1", [shop]);
      await client.query("DELETE FROM vendors WHERE shop_domain = $1", [shop]);
      await client.query("DELETE FROM sync_logs WHERE shop_domain = $1", [
        shop,
      ]);
      await client.query("DELETE FROM users WHERE shop_domain = $1", [shop]);

      await client.query("COMMIT");
      console.log(`✅ Shop data cleaned for: ${shop}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    res.status(200).json({ success: true, message: "Shop data redacted" });
  } catch (error) {
    console.error("❌ Shop redaction error:", error);
    res.status(500).json({ error: "Failed to redact shop data" });
  }
});

router.post("/app-uninstalled", verifyWebhook, async (req, res) => {
  const shop = req.headers["x-shopify-shop-domain"];
  console.log(
    `🗑️ App uninstalled for shop: ${shop} - data will be cleaned in 48h`
  );
  const client = await db.getClient();
  await client.query("BEGIN");

  // Clean up all shop data in correct order (respecting foreign keys)
  // This removes all business data, not personal customer data
  await client.query(
    "DELETE FROM order_line_items WHERE order_id IN (SELECT id FROM orders WHERE shop_domain = $1)",
    [shop]
  );
  await client.query("DELETE FROM orders WHERE shop_domain = $1", [shop]);
  await client.query("DELETE FROM products WHERE shop_domain = $1", [shop]);
  await client.query("DELETE FROM vendors WHERE shop_domain = $1", [shop]);
  await client.query("DELETE FROM sync_logs WHERE shop_domain = $1", [shop]);
  await client.query("DELETE FROM users WHERE shop_domain = $1", [shop]);

  await client.query("COMMIT");
  client.release();
  res.status(200).send("OK");
});

export default router;
