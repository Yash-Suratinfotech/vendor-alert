// web/routes/vendor.js
import express from "express";
import shopify from "../shopify.js";
import db from "../db.js";

const router = express.Router();

// GET /api/vendor/list - Get all vendors from database
router.get("/list", async (req, res) => {
  const session = res.locals.shopify.session;
  const shopDomain = session.shop;

  try {
    // Fetch vendors from database with product counts
    const result = await db.query(
      `
      SELECT 
        v.*,
        COUNT(p.id) as product_count,
        COUNT(DISTINCT oli.order_id) as order_count
      FROM vendors v
      LEFT JOIN products p ON p.vendor_id = v.id
      LEFT JOIN order_line_items oli ON oli.vendor = v.shopify_vendor_name
      WHERE v.shop_domain = $1
      GROUP BY v.id
      ORDER BY v.name ASC
    `,
      [shopDomain]
    );

    const vendors = result.rows.map((vendor) => ({
      id: vendor.id,
      name: vendor.name,
      shopifyVendorName: vendor.shopify_vendor_name,
      contactPerson: vendor.contact_person,
      mobile: vendor.mobile,
      email: vendor.email,
      upiId: vendor.upi_id,
      productCount: parseInt(vendor.product_count),
      orderCount: parseInt(vendor.order_count),
      createdAt: vendor.created_at,
      updatedAt: vendor.updated_at,
    }));

    res.status(200).json({ success: true, vendors });
  } catch (error) {
    console.error("❌ Failed to fetch vendor list:", error);
    res.status(500).json({ error: "Failed to fetch vendor list" });
  }
});

// GET /api/vendor/:id - Get specific vendor details
router.get("/:id", async (req, res) => {
  const session = res.locals.shopify.session;
  const shopDomain = session.shop;
  const vendorId = req.params.id;

  try {
    const result = await db.query(
      `
      SELECT v.*, 
        COUNT(p.id) as product_count,
        COUNT(DISTINCT oli.order_id) as order_count,
        SUM(oli.quantity * oli.price) as total_revenue
      FROM vendors v
      LEFT JOIN products p ON p.vendor_id = v.id
      LEFT JOIN order_line_items oli ON oli.vendor = v.shopify_vendor_name
      WHERE v.id = $1 AND v.shop_domain = $2
      GROUP BY v.id
    `,
      [vendorId, shopDomain]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Vendor not found" });
    }

    const vendor = result.rows[0];

    // Get vendor's products
    const productsResult = await db.query(
      `
      SELECT shopify_product_id, name, sku, status, inventory_quantity, price
      FROM products 
      WHERE vendor_id = $1 AND shop_domain = $2
      ORDER BY name ASC
    `,
      [vendorId, shopDomain]
    );

    // Get recent orders
    const ordersResult = await db.query(
      `
      SELECT DISTINCT o.shopify_order_id, o.shopify_order_number, 
        o.total_price, o.financial_status, o.shopify_created_at
      FROM orders o
      JOIN order_line_items oli ON oli.order_id = o.id
      WHERE oli.vendor = $1 AND o.shop_domain = $2
      ORDER BY o.shopify_created_at DESC
      LIMIT 10
    `,
      [vendor.shopify_vendor_name, shopDomain]
    );

    const vendorDetails = {
      id: vendor.id,
      name: vendor.name,
      shopifyVendorName: vendor.shopify_vendor_name,
      contactPerson: vendor.contact_person,
      mobile: vendor.mobile,
      email: vendor.email,
      upiId: vendor.upi_id,
      stats: {
        productCount: parseInt(vendor.product_count),
        orderCount: parseInt(vendor.order_count),
        totalRevenue: parseFloat(vendor.total_revenue) || 0,
      },
      products: productsResult.rows,
      recentOrders: ordersResult.rows,
      createdAt: vendor.created_at,
      updatedAt: vendor.updated_at,
    };

    res.status(200).json({ success: true, vendor: vendorDetails });
  } catch (error) {
    console.error("❌ Failed to fetch vendor details:", error);
    res.status(500).json({ error: "Failed to fetch vendor details" });
  }
});

// PUT /api/vendor/:id - Update vendor information
router.put("/:id", async (req, res) => {
  const session = res.locals.shopify.session;
  const shopDomain = session.shop;
  const vendorId = req.params.id;
  const { contactPerson, mobile, email, upiId } = req.body;

  try {
    const result = await db.query(
      `
      UPDATE vendors 
      SET contact_person = $1, mobile = $2, email = $3, upi_id = $4, updated_at = NOW()
      WHERE id = $5 AND shop_domain = $6
      RETURNING *
    `,
      [contactPerson, mobile, email, upiId, vendorId, shopDomain]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Vendor not found" });
    }

    res.status(200).json({
      success: true,
      message: "Vendor updated successfully",
      vendor: result.rows[0],
    });
  } catch (error) {
    console.error("❌ Failed to update vendor:", error);
    res.status(500).json({ error: "Failed to update vendor" });
  }
});

// GET /api/vendor/:id/products - Get all products for a vendor
router.get("/:id/products", async (req, res) => {
  const session = res.locals.shopify.session;
  const shopDomain = session.shop;
  const vendorId = req.params.id;

  try {
    const result = await db.query(
      `
      SELECT p.*, 
        COUNT(oli.id) as times_ordered,
        SUM(oli.quantity) as total_quantity_sold
      FROM products p
      LEFT JOIN order_line_items oli ON oli.product_id = p.id
      WHERE p.vendor_id = $1 AND p.shop_domain = $2
      GROUP BY p.id
      ORDER BY p.name ASC
    `,
      [vendorId, shopDomain]
    );

    const products = result.rows.map((product) => ({
      id: product.id,
      shopifyProductId: product.shopify_product_id,
      name: product.name,
      sku: product.sku,
      handle: product.handle,
      productType: product.product_type,
      status: product.status,
      inventoryQuantity: product.inventory_quantity,
      price: parseFloat(product.price),
      timesOrdered: parseInt(product.times_ordered),
      totalQuantitySold: parseInt(product.total_quantity_sold) || 0,
      createdAt: product.shopify_created_at,
      updatedAt: product.shopify_updated_at,
    }));

    res.status(200).json({ success: true, products });
  } catch (error) {
    console.error("❌ Failed to fetch vendor products:", error);
    res.status(500).json({ error: "Failed to fetch vendor products" });
  }
});

// GET /api/vendor/:id/orders - Get all orders for a vendor
router.get("/:id/orders", async (req, res) => {
  const session = res.locals.shopify.session;
  const shopDomain = session.shop;
  const vendorId = req.params.id;

  try {
    // First get the vendor's shopify_vendor_name
    const vendorResult = await db.query(
      "SELECT shopify_vendor_name FROM vendors WHERE id = $1 AND shop_domain = $2",
      [vendorId, shopDomain]
    );

    if (vendorResult.rows.length === 0) {
      return res.status(404).json({ error: "Vendor not found" });
    }

    const vendorName = vendorResult.rows[0].shopify_vendor_name;

    // Get orders with line items for this vendor
    const result = await db.query(
      `
      SELECT DISTINCT o.*, 
        array_agg(json_build_object(
          'id', oli.id,
          'title', oli.title,
          'quantity', oli.quantity,
          'price', oli.price,
          'total_discount', oli.total_discount
        )) as line_items
      FROM orders o
      JOIN order_line_items oli ON oli.order_id = o.id
      WHERE oli.vendor = $1 AND o.shop_domain = $2
      GROUP BY o.id
      ORDER BY o.shopify_created_at DESC
    `,
      [vendorName, shopDomain]
    );

    const orders = result.rows.map((order) => ({
      id: order.id,
      shopifyOrderId: order.shopify_order_id,
      orderNumber: order.shopify_order_number,
      totalPrice: parseFloat(order.total_price),
      financialStatus: order.financial_status,
      fulfillmentStatus: order.fulfillment_status,
      notified: order.notified,
      lineItems: order.line_items,
      createdAt: order.shopify_created_at,
      updatedAt: order.shopify_updated_at,
    }));

    res.status(200).json({ success: true, orders });
  } catch (error) {
    console.error("❌ Failed to fetch vendor orders:", error);
    res.status(500).json({ error: "Failed to fetch vendor orders" });
  }
});

// GET /api/vendor/shopify/list - Get vendors from Shopify (for comparison/backup)
router.get("/shopify/list", async (req, res) => {
  const session = res.locals.shopify.session;

  try {
    // Fetch vendor list from Shopify GraphQL
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

    const shopifyVendors = response.data.productVendors.edges.map(
      (edge) => edge.node
    );

    // Compare with database vendors
    const dbVendors = await db.query(
      "SELECT shopify_vendor_name FROM vendors WHERE shop_domain = $1",
      [session.shop]
    );

    const dbVendorNames = new Set(
      dbVendors.rows.map((v) => v.shopify_vendor_name)
    );

    const comparison = shopifyVendors.map((vendor) => ({
      name: vendor,
      inDatabase: dbVendorNames.has(vendor),
      inShopify: true,
    }));

    res.status(200).json({
      success: true,
      shopifyVendors,
      comparison,
    });
  } catch (error) {
    console.error("❌ Failed to fetch Shopify vendor list:", error);
    res.status(500).json({ error: "Failed to fetch Shopify vendor list" });
  }
});

// POST /api/vendor/sync - Manual vendor sync
router.post("/sync", async (req, res) => {
  const session = res.locals.shopify.session;

  try {
    // This would trigger a manual sync of vendors from products
    // You can implement this based on your needs
    res.status(200).json({
      success: true,
      message: "Vendor sync initiated",
    });
  } catch (error) {
    console.error("❌ Failed to sync vendors:", error);
    res.status(500).json({ error: "Failed to sync vendors" });
  }
});

export default router;
