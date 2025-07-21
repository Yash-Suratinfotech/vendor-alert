// web/api/vendor.js
import express from "express";
import shopify from "../shopify.js";
// import db from "../db.js";

const router = express.Router();

// GET /api/vendor
router.get("/list", async (_req, res) => {
  const session = res.locals.shopify.session;

  try {
    // Fetch vendor list from Shopify
    const shopifyClient = new shopify.api.clients.Graphql({ session });
    const response = await shopifyClient.request(`
      query GetVendors {
        productVendors(first: 250) {
          edges {
            node
          }
        }
      }
    `);

    const vendors = response.data.productVendors.edges.map((edge) => edge.node);

    res.status(200).send({ vendors });
  } catch (error) {
    console.error("❌ Failed to fetch vendor list from Shopify:", error);
    res.status(500).json({ error: "Failed to fetch vendor list" });
  }
});

export default router;
