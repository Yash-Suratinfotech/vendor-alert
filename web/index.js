// web/index.js
import { join } from "path";
import { readFileSync } from "fs";
import express from "express";
import serveStatic from "serve-static";
import cors from "cors";
import cron from "node-cron";

import shopify from "./shopify.js";

// Import existing routes
import vendorRouter from "./routes/vendor.js";
import webhookRouter from "./routes/webhook.js";
import ordersRouter from "./routes/orders.js";
import chatRouter from "./routes/chat/index.js";
import notifyOrdersApi from "./routes/notify-orders.js";
import settingsApi from "./routes/settings.js";

// Import webhook routes
import PrivacyWebhookHandlers from "./webhook/privacy.js";
import OrdersWebhookHandlers from "./webhook/orders.js";
import AppWebhookHandlers from "./webhook/app.js";

// Import data sync and cron-job service
import dataSyncService from "./services/dataSyncService.js";
import { runNotifyScheduler } from "./services/notifyScheduler.js";

const PORT = parseInt(
  process.env.BACKEND_PORT || process.env.PORT || "3000",
  10
);

const STATIC_PATH =
  process.env.NODE_ENV === "production"
    ? `${process.cwd()}/frontend/dist`
    : `${process.cwd()}/frontend/`;

const app = express();

app.use(cors());

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
      try {
        await dataSyncService.handleShopAuthentication(session);
      } catch (error) {
        console.error("❌ Error in OAuth callback:", error);
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
      ...OrdersWebhookHandlers,
      ...AppWebhookHandlers,
    },
  })
);

// 🔁 Cron job to run every 1 minutes
cron.schedule("*/1 * * * *", async () => {
  console.log("🕒 Running notifyScheduler...");
  await runNotifyScheduler();
});

// If you are adding routes outside of the /api path, remember to
// also add a proxy rule for them in web/frontend/vite.config.js

// API routes - require authentication
app.use("/api/*", shopify.validateAuthenticatedSession());

app.use(express.json());

// Mount API routes
app.use("/api/settings", settingsApi);
app.use("/api/vendor", vendorRouter);
app.use("/api/webhooks", webhookRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/notify-orders", notifyOrdersApi);
app.use("/chat", chatRouter);

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
