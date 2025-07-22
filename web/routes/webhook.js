// web/routes/webhook.js
import express from "express";
import db from "../db.js";
import dataSyncService from "../services/dataSyncService.js";

const router = express.Router();

// Middleware to verify webhook authenticity
const verifyWebhook = (req, res, next) => {
  // Add webhook verification logic here
  next();
};

// Product webhooks
router.post("/products", verifyWebhook, async (req, res) => {
  try {
    const shop = req.headers["x-shopify-shop-domain"];
    const topic = req.headers["x-shopify-topic"];
    const productData = req.body;

    console.log(`📦 Product webhook received: ${topic} for shop: ${shop}`);

    if (!shop) {
      return res.status(400).json({ error: "Missing shop domain" });
    }

    await dataSyncService.handleWebhookSync(productData, shop, topic);

    res
      .status(200)
      .json({ success: true, message: "Product webhook processed" });
  } catch (error) {
    console.error("❌ Product webhook error:", error);
    res.status(500).json({ error: "Failed to process product webhook" });
  }
});

// Order webhooks
router.post("/orders", verifyWebhook, async (req, res) => {
  try {
    const shop = req.headers["x-shopify-shop-domain"];
    const topic = req.headers["x-shopify-topic"];
    const rawOrderData = req.body;

    console.log(`📋 Order webhook received: ${topic} for shop: ${shop}`);

    if (!shop) {
      return res.status(400).json({ error: "Missing shop domain" });
    }

    // keep only business data needed for vendor alerts
    const filteredOrderData = {
      id: rawOrderData.id,
      name: rawOrderData.name,
      total_price: rawOrderData.total_price,
      financial_status: rawOrderData.financial_status,
      fulfillment_status: rawOrderData.fulfillment_status,
      created_at: rawOrderData.created_at,
      updated_at: rawOrderData.updated_at,
      line_items: rawOrderData.line_items.map((item) => ({
        id: item.id,
        title: item.title,
        vendor: item.vendor,
        quantity: item.quantity,
        price: item.price,
        total_discount: item.total_discount || 0,
        product_id: item.product_id,
        variant_id: item.variant_id,
      })),
    };

    // Process the filtered order data
    await dataSyncService.handleWebhookSync(filteredOrderData, shop, topic);

    // Check if this is a new order that requires vendor notification
    if (topic === "orders/create" || topic === "orders/paid") {
      await handleVendorNotification(filteredOrderData, shop);
    }

    res.status(200).json({ success: true, message: "Order webhook processed" });
  } catch (error) {
    console.error("❌ Order webhook error:", error);
    res.status(500).json({ error: "Failed to process order webhook" });
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

    // For each vendor, send notification
    for (const vendorName of vendors) {
      const vendorResult = await db.query(
        `
        SELECT v.*, COUNT(oli.id) as order_items_count
        FROM vendors v
        LEFT JOIN products p ON p.vendor_id = v.id
        LEFT JOIN order_line_items oli ON oli.vendor = v.shopify_vendor_name
        LEFT JOIN orders o ON o.id = oli.order_id AND o.shopify_order_id = $1
        WHERE v.shopify_vendor_name = $2 AND v.shop_domain = $3
        GROUP BY v.id
      `,
        [orderData.id, vendorName, shopDomain]
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
        const totalValue = vendorItems.reduce(
          (sum, item) => sum + item.quantity * parseFloat(item.price || 0),
          0
        );

        console.log(
          `📱 Vendor ${
            vendor.name
          } has ${totalQuantity} items worth $${totalValue.toFixed(
            2
          )} in order ${orderData.name}`
        );

        // Notification data
        const notificationData = {
          vendorName: vendor.name,
          vendorContact: vendor.mobile || vendor.email,
          orderNumber: orderData.name,
          orderDate: new Date().toLocaleDateString(),
          itemCount: totalQuantity,
          orderValue: totalValue.toFixed(2),
          items: vendorItems.map((item) => ({
            title: item.title,
            quantity: item.quantity,
            price: item.price,
          })),
        };

        // TODO: Implement actual notification (SMS/Email/WhatsApp)
        console.log(`📨 Notification ready for vendor:`, notificationData);

        // Mark as notified
        await db.query(
          `
          UPDATE orders 
          SET notified = TRUE, updated_at = NOW() 
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

// Privacy webhooks (same as before)
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

      // Clean up all shop data
      await client.query(
        "DELETE FROM order_line_items WHERE order_id IN (SELECT id FROM orders WHERE shop_domain = $1)",
        [shop]
      );
      await client.query("DELETE FROM orders WHERE shop_domain = $1", [shop]);
      await client.query("DELETE FROM products WHERE shop_domain = $1", [shop]);
      await client.query("DELETE FROM vendors WHERE shop_domain = $1", [shop]);
      await client.query("DELETE FROM sync_logs WHERE shop_domain = $1", [
        shop,
      ]);
      await client.query("DELETE FROM shops WHERE shop_domain = $1", [shop]);

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

// Manual sync and health endpoints (same as before)
router.post("/manual-sync/:type", async (req, res) => {
  try {
    const { type } = req.params;
    const shop = req.body.shop || req.headers["x-shopify-shop-domain"];

    if (!shop) {
      return res.status(400).json({ error: "Shop domain required" });
    }

    const session = { shop: shop, accessToken: req.body.accessToken };
    let result;

    switch (type) {
      case "products":
        result = await dataSyncService.syncAllProducts(session);
        break;
      case "orders":
        result = await dataSyncService.syncAllOrders(session);
        break;
      case "full":
        await dataSyncService.performInitialSync(session);
        result = "Full sync completed";
        break;
      default:
        return res.status(400).json({ error: "Invalid sync type" });
    }

    res.status(200).json({
      success: true,
      message: `Manual ${type} sync completed`,
      result,
    });
  } catch (error) {
    console.error(`❌ Manual sync error:`, error);
    res.status(500).json({ error: "Manual sync failed" });
  }
});

router.get("/health", (req, res) => {
  res.status(200).json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    webhooks: [
      "products/create",
      "products/update",
      "products/delete",
      "orders/create",
      "orders/updated",
      "orders/paid",
      "orders/cancelled",
      "orders/fulfilled",
      "shop/redact",
      "app/uninstalled",
    ],
  });
});

export default router;
