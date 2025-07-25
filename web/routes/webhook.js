// web/routes/webhook.js
import express from "express";
import db from "../db.js";
import dataSyncService from "../services/dataSyncService.js";

const router = express.Router();

// Middleware to verify webhook authenticity (simplified for now)
const verifyWebhook = (req, res, next) => {
  // Add proper webhook verification logic here if needed
  next();
};

// Order webhooks - Main focus since we only care about order-based products
router.post("/orders", verifyWebhook, async (req, res) => {
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

    res.status(200).json({ status: 200, success: true, message: "Order webhook processed" });
  } catch (error) {
    console.error("❌ Order webhook error:", error);
    res.status(500).json({ status: 500, error: "Failed to process order webhook" });
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
  res.status(200).send("OK");
});

// Manual sync endpoints - updated for order-based approach
router.post("/manual-sync/:type", async (req, res) => {
  try {
    const { type } = req.params;
    const shop = req.body.shop || req.headers["x-shopify-shop-domain"];

    if (!shop) {
      return res.status(400).json({ status: 400, error: "Shop domain required" });
    }

    const session = { shop: shop, accessToken: req.body.accessToken };
    let result;

    switch (type) {
      case "orders":
      case "full":
        // Only sync orders (which creates products and vendors automatically)
        result = await dataSyncService.syncAllOrders(session);
        break;
      default:
        return res.status(400).json({
          status: 400,
          error: "Invalid sync type. Use 'orders' or 'full'",
        });
    }

    res.status(200).json({
      success: true,
      message: `Manual ${type} sync completed`,
      result,
    });
  } catch (error) {
    console.error(`❌ Manual sync error:`, error);
    res.status(500).json({
      status: 500,
      error: "Manual sync failed",
      details: error.message,
    });
  }
});

// Health check endpoint
router.get("/health", (req, res) => {
  res.status(200).json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    webhooks: [
      "orders/create",
      "orders/updated",
      "orders/paid",
      "orders/cancelled",
      "orders/fulfilled",
      "shop/redact",
      "app/uninstalled",
    ],
    sync_types: ["orders", "full"],
    note: "Only order-based products are synced (no store-wide product sync)",
  });
});

// Sync status endpoint
router.get("/sync/status", async (req, res) => {
  try {
    const shop = req.query.shop || req.headers["x-shopify-shop-domain"];

    if (!shop) {
      return res.status(400).json({ error: "Shop domain required" });
    }

    const result = await db.query(
      `
      SELECT 
        initial_sync_completed,
        (SELECT COUNT(*) FROM products WHERE shop_domain = $1) as product_count,
        (SELECT COUNT(*) FROM orders WHERE shop_domain = $1) as order_count,
        (SELECT COUNT(*) FROM vendors WHERE shop_domain = $1) as vendor_count,
        (SELECT COUNT(*) FROM sync_logs WHERE shop_domain = $1 AND status = 'running') as running_syncs
      FROM users WHERE shop_domain = $1
    `,
      [shop]
    );

    const stats = result.rows[0] || {};

    res.json({
      success: true,
      shop: shop,
      initialSyncCompleted: stats.initial_sync_completed || false,
      counts: {
        products: parseInt(stats.product_count) || 0,
        orders: parseInt(stats.order_count) || 0,
        vendors: parseInt(stats.vendor_count) || 0,
      },
      hasRunningSyncs: parseInt(stats.running_syncs) > 0,
      syncType: "order-based-only",
    });
  } catch (error) {
    console.error("❌ Error fetching sync status:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch sync status",
    });
  }
});

export default router;
