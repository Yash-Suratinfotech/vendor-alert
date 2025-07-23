// web/routes/products.js
import express from "express";
import db from "../db.js";

const router = express.Router();

// GET /api/products - Get order-based products with filtering and pagination
router.get("/", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const shopDomain = session.shop;

    const { page = 1, limit = 25, search, vendor } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Build query conditions
    let whereConditions = `p.shop_domain = $1`;
    let queryParams = [shopDomain];
    let paramCounter = 2;

    // Add search condition (title only)
    if (search) {
      whereConditions += ` AND p.title ILIKE $${paramCounter}`;
      queryParams.push(`%${search}%`);
      paramCounter++;
    }

    // Add vendor filter
    if (vendor) {
      whereConditions += ` AND p.vendor_name = $${paramCounter}`;
      queryParams.push(vendor);
      paramCounter++;
    }

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total 
      FROM products p
      WHERE ${whereConditions}
    `;

    const countResult = await db.query(countQuery, queryParams);
    const total = parseInt(countResult.rows[0].total);

    // Get products with additional stats
    const productsQuery = `
      SELECT 
        p.id,
        p.shopify_product_id,
        p.title,
        p.image,
        p.vendor_name,
        p.created_at,
        p.updated_at,
        v.name as vendor_display_name,
        v.contact_person,
        v.mobile,
        v.email,
        COUNT(DISTINCT oli.order_id) as order_count,
        SUM(oli.quantity) as total_quantity_ordered,
        COUNT(oli.id) as line_item_count
      FROM products p
      LEFT JOIN vendors v ON p.vendor_id = v.id
      LEFT JOIN order_line_items oli ON oli.product_id = p.id
      WHERE ${whereConditions}
      GROUP BY p.id, v.id, v.name, v.contact_person, v.mobile, v.email
      ORDER BY p.title ASC
      LIMIT $${paramCounter} OFFSET $${paramCounter + 1}
    `;

    const finalParams = [...queryParams, parseInt(limit), offset];
    const productsResult = await db.query(productsQuery, finalParams);

    const products = productsResult.rows.map((product) => ({
      id: product.id,
      shopifyProductId: product.shopify_product_id,
      title: product.title,
      image: product.image,
      vendorName: product.vendor_name,
      vendorDisplayName: product.vendor_display_name,
      vendor: {
        name: product.vendor_display_name,
        contactPerson: product.contact_person,
        mobile: product.mobile,
        email: product.email,
      },
      stats: {
        orderCount: parseInt(product.order_count || 0),
        totalQuantityOrdered: parseInt(product.total_quantity_ordered || 0),
        lineItemCount: parseInt(product.line_item_count || 0),
      },
      createdAt: product.created_at,
      updatedAt: product.updated_at,
    }));

    const totalPages = Math.ceil(total / parseInt(limit));

    res.json({
      success: true,
      products,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages,
        hasNext: parseInt(page) < totalPages,
        hasPrev: parseInt(page) > 1,
      },
    });
  } catch (error) {
    console.error("❌ Failed to fetch products:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch products",
      details: error.message,
    });
  }
});

// GET /api/products/:id - Get specific product with order history
router.get("/:id", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const shopDomain = session.shop;
    const productId = req.params.id;

    // Get product details
    const productResult = await db.query(
      `
      SELECT 
        p.*,
        v.name as vendor_display_name,
        v.contact_person,
        v.mobile,
        v.email,
        v.upi_id
      FROM products p
      LEFT JOIN vendors v ON p.vendor_id = v.id
      WHERE p.id = $1 AND p.shop_domain = $2
    `,
      [productId, shopDomain]
    );

    if (productResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Product not found",
      });
    }

    const product = productResult.rows[0];

    // Get order history for this product
    const ordersResult = await db.query(
      `
      SELECT 
        o.id,
        o.shopify_order_id,
        o.name as order_name,
        o.notification,
        o.shopify_created_at,
        oli.quantity,
        oli.created_at as line_item_created_at
      FROM orders o
      JOIN order_line_items oli ON oli.order_id = o.id
      WHERE oli.product_id = $1 AND o.shop_domain = $2
      ORDER BY o.shopify_created_at DESC
      LIMIT 20
    `,
      [productId, shopDomain]
    );

    // Get summary stats
    const statsResult = await db.query(
      `
      SELECT 
        COUNT(DISTINCT oli.order_id) as order_count,
        SUM(oli.quantity) as total_quantity,
        COUNT(oli.id) as line_item_count,
        MIN(o.shopify_created_at) as first_ordered,
        MAX(o.shopify_created_at) as last_ordered
      FROM order_line_items oli
      JOIN orders o ON o.id = oli.order_id
      WHERE oli.product_id = $1 AND o.shop_domain = $2
    `,
      [productId, shopDomain]
    );

    const stats = statsResult.rows[0];

    const productDetails = {
      id: product.id,
      shopifyProductId: product.shopify_product_id,
      title: product.title,
      image: product.image,
      vendorName: product.vendor_name,
      vendor: {
        name: product.vendor_display_name,
        contactPerson: product.contact_person,
        mobile: product.mobile,
        email: product.email,
        upiId: product.upi_id,
      },
      stats: {
        orderCount: parseInt(stats.order_count || 0),
        totalQuantity: parseInt(stats.total_quantity || 0),
        lineItemCount: parseInt(stats.line_item_count || 0),
        firstOrdered: stats.first_ordered,
        lastOrdered: stats.last_ordered,
      },
      orderHistory: ordersResult.rows.map((order) => ({
        id: order.id,
        shopifyOrderId: order.shopify_order_id,
        orderName: order.order_name,
        quantity: order.quantity,
        notification: order.notification,
        orderDate: order.shopify_created_at,
        lineItemCreatedAt: order.line_item_created_at,
      })),
      createdAt: product.created_at,
      updatedAt: product.updated_at,
    };

    res.json({
      success: true,
      product: productDetails,
    });
  } catch (error) {
    console.error("❌ Failed to fetch product details:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch product details",
      details: error.message,
    });
  }
});

// GET /api/products/vendor/:vendorId - Get all products for a specific vendor
router.get("/vendor/:vendorId", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const shopDomain = session.shop;
    const vendorId = req.params.vendorId;

    const result = await db.query(
      `
      SELECT 
        p.*,
        COUNT(DISTINCT oli.order_id) as order_count,
        SUM(oli.quantity) as total_quantity_ordered
      FROM products p
      LEFT JOIN order_line_items oli ON oli.product_id = p.id
      WHERE p.vendor_id = $1 AND p.shop_domain = $2
      GROUP BY p.id
      ORDER BY p.title ASC
    `,
      [vendorId, shopDomain]
    );

    const products = result.rows.map((product) => ({
      id: product.id,
      shopifyProductId: product.shopify_product_id,
      title: product.title,
      image: product.image,
      vendorName: product.vendor_name,
      stats: {
        orderCount: parseInt(product.order_count || 0),
        totalQuantityOrdered: parseInt(product.total_quantity_ordered || 0),
      },
      createdAt: product.created_at,
      updatedAt: product.updated_at,
    }));

    res.json({
      success: true,
      products,
    });
  } catch (error) {
    console.error("❌ Failed to fetch vendor products:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch vendor products",
      details: error.message,
    });
  }
});

// GET /api/products/count - Get total product count (for compatibility)
router.get("/count", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const shopDomain = session.shop;

    const result = await db.query(
      "SELECT COUNT(*) as count FROM products WHERE shop_domain = $1",
      [shopDomain]
    );

    res.json({
      success: true,
      count: parseInt(result.rows[0].count),
    });
  } catch (error) {
    console.error("❌ Error fetching product count:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch product count",
    });
  }
});

// GET /api/products/stats/summary - Get product statistics
router.get("/stats/summary", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const shopDomain = session.shop;

    const statsResult = await db.query(
      `
      SELECT 
        COUNT(DISTINCT p.id) as total_products,
        COUNT(DISTINCT p.vendor_name) as unique_vendors,
        COUNT(DISTINCT oli.order_id) as orders_with_products,
        SUM(oli.quantity) as total_quantity_ordered,
        AVG(oli.quantity) as avg_quantity_per_line_item
      FROM products p
      LEFT JOIN order_line_items oli ON oli.product_id = p.id
      LEFT JOIN orders o ON o.id = oli.order_id
      WHERE p.shop_domain = $1
    `,
      [shopDomain]
    );

    const stats = statsResult.rows[0];

    res.json({
      success: true,
      stats: {
        totalProducts: parseInt(stats.total_products || 0),
        uniqueVendors: parseInt(stats.unique_vendors || 0),
        ordersWithProducts: parseInt(stats.orders_with_products || 0),
        totalQuantityOrdered: parseInt(stats.total_quantity_ordered || 0),
        avgQuantityPerLineItem: parseFloat(
          stats.avg_quantity_per_line_item || 0
        ).toFixed(2),
      },
    });
  } catch (error) {
    console.error("❌ Error fetching product stats:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch product statistics",
    });
  }
});

export default router;
