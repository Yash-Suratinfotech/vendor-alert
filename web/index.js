// web/index.js
import { join } from "path";
import { readFileSync } from "fs";
import express from "express";
import serveStatic from "serve-static";
import cors from "cors";

import db from "./db.js";
import shopify from "./shopify.js";

// Import existing routes
import storeRouter from "./routes/store.js";
import vendorRouter from "./routes/vendor.js";
import webhookRouter from "./routes/webhook.js";
import productsRouter from "./routes/products.js";
import ordersRouter from "./routes/orders.js";
import chatRouter from "./routes/chat/index.js";

// Import webhook routes
import PrivacyWebhookHandlers from "./webhook/privacy.js";
import ProductsWebhookHandlers from "./webhook/products.js";
import OrdersWebhookHandlers from "./webhook/orders.js";
import AppWebhookHandlers from "./webhook/app.js";

// Import data sync service
import dataSyncService from "./services/dataSyncService.js";

const PORT = parseInt(
  process.env.BACKEND_PORT || process.env.PORT || "3000",
  10
);

const STATIC_PATH =
  process.env.NODE_ENV === "production"
    ? `${process.cwd()}/frontend/dist`
    : `${process.cwd()}/frontend/`;

const app = express();

app.use(cors())

// Trust proxy for accurate IP detection
app.set("trust proxy", true);

// Set up Shopify authentication and webhook handling
app.get(shopify.config.auth.path, shopify.auth.begin());
app.get(
  shopify.config.auth.callbackPath,
  shopify.auth.callback(),
  async (req, res, next) => {
    const session = res.locals.shopify?.session;
    if (session) {
      console.log("✅ OAuth Callback - Shop authenticated:", session.shop);

      try {
        const client = await db.getClient();
        await client.query("BEGIN");

        // Check if shop already exists
        const existingShop = await client.query(
          "SELECT id, initial_sync_completed FROM shops WHERE shop_domain = $1",
          [session.shop]
        );

        let isNewInstall = false;

        if (existingShop.rows.length === 0) {
          // Insert new shop
          await client.query(
            `INSERT INTO shops (shop_domain, access_token, shopify_shop_id) 
             VALUES ($1, $2, $3)`,
            [session.shop, session.accessToken, null]
          );
          isNewInstall = true;
          console.log("🆕 New shop registered:", session.shop);
        } else {
          // Update existing shop
          await client.query(
            `UPDATE shops 
             SET access_token = $2, updated_at = NOW() 
             WHERE shop_domain = $1`,
            [session.shop, session.accessToken]
          );
          console.log("🔄 Existing shop updated:", session.shop);
        }

        await client.query("COMMIT");
        client.release();

        // Perform initial sync for new installations
        if (isNewInstall || !existingShop.rows[0]?.initial_sync_completed) {
          console.log("🚀 Starting initial data sync for:", session.shop);

          // Run initial sync in background (don't wait for completion)
          dataSyncService.performInitialSync(session).catch((error) => {
            console.error("❌ Initial sync failed:", error);
          });
        }
      } catch (error) {
        console.error("❌ Error during OAuth callback:", error);
      }
    } else {
      console.log("⚠️ No session found in OAuth callback!");
    }

    return shopify.redirectToShopifyOrAppRoot()(req, res, next);
  }
);

// Webhook processing with enhanced handlers
app.post(
  shopify.config.webhooks.path,
  shopify.processWebhooks({
    webhookHandlers: {
      ...PrivacyWebhookHandlers,
      ...ProductsWebhookHandlers,
      ...OrdersWebhookHandlers,
      ...AppWebhookHandlers,
    },
  })
);

// If you are adding routes outside of the /api path, remember to
// also add a proxy rule for them in web/frontend/vite.config.js

// API routes - require authentication
app.use("/api/*", shopify.validateAuthenticatedSession());

app.use(express.json());

// Mount API routes
app.use("/api/store", storeRouter);
app.use("/api/vendor", vendorRouter);
app.use("/api/webhooks", webhookRouter);
app.use("/api/products", productsRouter);
app.use("/api/orders", ordersRouter);
app.use("/chat", chatRouter);

// Add sync status endpoint
app.get("/api/sync/status", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const shopDomain = session.shop;

    const result = await db.query(
      `
      SELECT 
        initial_sync_completed,
        (SELECT COUNT(*) FROM products WHERE shop_domain = $1) as product_count,
        (SELECT COUNT(*) FROM orders WHERE shop_domain = $1) as order_count,
        (SELECT COUNT(*) FROM vendors WHERE shop_domain = $1) as vendor_count,
        (SELECT COUNT(*) FROM sync_logs WHERE shop_domain = $1 AND status = 'running') as running_syncs
      FROM shops WHERE shop_domain = $1
    `,
      [shopDomain]
    );

    const stats = result.rows[0] || {};

    res.json({
      success: true,
      initialSyncCompleted: stats.initial_sync_completed || false,
      counts: {
        products: parseInt(stats.product_count) || 0,
        orders: parseInt(stats.order_count) || 0,
        vendors: parseInt(stats.vendor_count) || 0,
      },
      hasRunningSyncs: parseInt(stats.running_syncs) > 0,
    });
  } catch (error) {
    console.error("❌ Error fetching sync status:", error);
    res.status(500).json({ error: "Failed to fetch sync status" });
  }
});

app.use(shopify.cspHeaders());
app.use(serveStatic(STATIC_PATH, { index: false }));

app.use("/*", shopify.ensureInstalledOnShop(), async (_req, res, _next) => {
  return res
    .status(200)
    .set("Content-Type", "text/html")
    .send(
      readFileSync(join(STATIC_PATH, "index.html"))
        .toString()
        .replace("%VITE_SHOPIFY_API_KEY%", process.env.SHOPIFY_API_KEY || "")
    );
});

app.listen(PORT, () => {
  console.log(`🚀 Enhanced Vendor Alert app running on port ${PORT}`);
});
