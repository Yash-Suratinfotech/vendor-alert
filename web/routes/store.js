// web/api/store.js
import express from "express";
import shopify from "../shopify.js";

const router = express.Router();

// GET /api/store/info
router.get("/info", async (req, res) => {
  try {
    const client = new shopify.api.clients.Rest({
      session: res.locals.shopify.session,
    });

    const response = await client.get({ path: "shop" });
    const shop = response?.body?.shop;

    // Return simplified store information
    const simplified = {
      name: shop.name,
      domain: shop.domain,
      email: shop.email,
      plan_display_name: shop.plan_display_name,
      shop_owner: shop.shop_owner,
      country_name: shop.country_name,
      currency: shop.currency,
    };

    res.status(200).json(simplified);
  } catch (error) {
    console.error("Failed to fetch store info:", error);
    res.status(500).json({ error: "Failed to fetch store info" });
  }
});

export default router;