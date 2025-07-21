// @ts-check
import { join } from "path";
import { readFileSync } from "fs";
import express from "express";
import serveStatic from "serve-static";

import shopify from "./shopify.js";
import productCreator from "./product-creator.js";
import PrivacyWebhookHandlers from "./privacy.js";

// Import existing routes
import storeRouter from "./routes/store.js";

import db from "./db.js";

const PORT = parseInt(
  process.env.BACKEND_PORT || process.env.PORT || "3000",
  10
);

const STATIC_PATH =
  process.env.NODE_ENV === "production"
    ? `${process.cwd()}/frontend/dist`
    : `${process.cwd()}/frontend/`;

const app = express();

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

      // Initialize default settings for new shops
      try {
        const client = await db.getClient();
        await client.query("BEGIN");

        // Check if shop already exists
        const existingShop = await client.query(
          "SELECT id FROM shops WHERE shop_domain = $1",
          [session.shop]
        );

        if (existingShop.rows.length === 0) {
          // Insert new shop
          await client.query(
            "INSERT INTO shops (shop_domain, access_token) VALUES ($1, $2) ON CONFLICT (shop_domain) DO UPDATE SET access_token = EXCLUDED.access_token",
            [session.shop, session.accessToken]
          );

          // Initialize default content protection settings
          await client.query(
            `
            INSERT INTO content_protection_settings (shop_domain) 
            VALUES ($1) 
            ON CONFLICT (shop_domain) DO NOTHING
          `,
            [session.shop]
          );

          console.log(
            "🆕 New shop initialized with default settings:",
            session.shop
          );
        }

        await client.query("COMMIT");
        client.release();
      } catch (error) {
        console.error("Error initializing shop settings:", error);
      }
    } else {
      console.log("⚠️ No session found in OAuth callback!");
    }

    return shopify.redirectToShopifyOrAppRoot()(req, res, next);
  }
);

app.post(
  shopify.config.webhooks.path,
  shopify.processWebhooks({ webhookHandlers: PrivacyWebhookHandlers })
);

// If you are adding routes outside of the /api path, remember to
// also add a proxy rule for them in web/frontend/vite.config.js

app.use("/api/*", shopify.validateAuthenticatedSession());

app.use(express.json());

// Mount API routes
app.use("/api/store", storeRouter);

app.get("/api/products/count", async (_req, res) => {
  const client = new shopify.api.clients.Graphql({
    session: res.locals.shopify.session,
  });

  const countData = await client.request(`
    query shopifyProductCount {
      productsCount {
        count
      }
    }
  `);

  res.status(200).send({ count: countData.data.productsCount.count });
});

app.post("/api/products", async (_req, res) => {
  let status = 200;
  let error = null;

  try {
    await productCreator(res.locals.shopify.session);
  } catch (e) {
    console.log(`Failed to process products/create: ${e.message}`);
    status = 500;
    error = e.message;
  }
  res.status(status).send({ success: status === 200, error });
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
