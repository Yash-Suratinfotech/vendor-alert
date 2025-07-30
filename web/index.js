// web/index.js - Fixed with single listen call
import { join } from "path";
import { readFileSync } from "fs";
import express from "express";
import { createServer } from "http";
import serveStatic from "serve-static";
import cors from "cors";
import cron from "node-cron";

import shopify from "./shopify.js";
import socketManager from "./socketServer.js";

// Import existing routes
import vendorRouter from "./routes/vendor.js";
import webhookRouter from "./routes/webhook.js";
import ordersRouter from "./routes/orders.js";
import chatRouter from "./routes/chat/index.js";
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
const httpServer = createServer(app);

// Initialize Socket.IO
socketManager.initialize(httpServer);

app.use(cors({
  origin: ["http://localhost:3000", "https://vendor-alert-webapp.vercel.app"],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  credentials: true
}));

// Trust proxy for accurate IP detection
app.set("trust proxy", true);

// Basic health check endpoint (no Shopify auth required)
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    timestamp: new Date().toISOString(),
    socketIO: socketManager ? "initialized" : "not initialized",
  });
});

// Socket.IO status endpoint (for debugging)
app.get("/socket-status", (req, res) => {
  res.status(200).json({
    socketIO: {
      initialized: !!socketManager,
      connectedUsers: socketManager ? socketManager.connectedUsers.size : 0,
    },
  });
});

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

// Parse JSON for API routes
app.use(express.json());

// Chat routes - NO Shopify authentication required (they have their own JWT auth)
app.use("/chat", chatRouter);

// API routes - require Shopify authentication
app.use("/api/*", shopify.validateAuthenticatedSession());

// Mount API routes that require Shopify authentication
app.use("/api/settings", settingsApi);
app.use("/api/vendor", vendorRouter);
app.use("/api/webhooks", webhookRouter);
app.use("/api/orders", ordersRouter);

// Make socketManager available to routes
app.locals.socketManager = socketManager;

// Serve static files and CSP headers
app.use(shopify.cspHeaders());
app.use(serveStatic(STATIC_PATH, { index: false }));

// Main app route - only for Shopify embedded app (with proper route filtering)
app.use("/*", (req, res, next) => {
  // Skip Shopify middleware for Socket.IO and other non-app routes
  if (req.path.startsWith('/socket.io') || 
      req.path.startsWith('/health') || 
      req.path.startsWith('/socket-status') ||
      req.path.startsWith('/chat') ||
      req.path.startsWith('/api')) {
    return res.status(404).json({ error: "Route not found" });
  }
  
  // Apply Shopify middleware for app routes only
  return shopify.ensureInstalledOnShop()(req, res, next);
}, async (req, res) => {
  return res
    .status(200)
    .set("Content-Type", "text/html")
    .send(
      readFileSync(join(STATIC_PATH, "index.html"))
        .toString()
        .replace("%VITE_SHOPIFY_API_KEY%", process.env.SHOPIFY_API_KEY || "")
    );
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error("❌ Server error:", error);
  
  if (error.name === 'ShopifyError') {
    return res.status(400).json({ 
      error: "Shopify integration error",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
  
  res.status(500).json({ 
    error: "Internal server error",
    details: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
});

// IMPORTANT: Only use httpServer.listen() - NOT app.listen()
// This is the key fix for the EADDRINUSE error
httpServer.listen(PORT, () => {
  console.log(`🚀 Enhanced Vendor Alert app with Socket.IO running on port ${PORT}`);
  console.log(`📡 Socket.IO server initialized`);
});