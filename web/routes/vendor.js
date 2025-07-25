// web/routes/vendor.js
import express from "express";
import db from "../db.js";

const router = express.Router();

// GET /api/vendor/list - Get all vendors with stats
router.get("/list", async (req, res) => {
  const session = res.locals.shopify.session;
  const shopDomain = session.shop;

  try {
    const { page = 1, limit = 25, search } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Build search condition
    let whereCondition = "v.shop_domain = $1";
    let queryParams = [shopDomain];
    let paramCount = 1;

    if (search) {
      paramCount++;
      whereCondition += ` AND (v.name ILIKE $${paramCount} OR v.contact_person ILIKE $${paramCount})`;
      queryParams.push(`%${search}%`);
    }

    // Get total count
    const countResult = await db.query(
      `SELECT COUNT(*) as total FROM vendors v WHERE ${whereCondition}`,
      queryParams
    );
    const total = parseInt(countResult.rows[0].total);

    // Fetch vendors with product and order counts
    const result = await db.query(
      `
      SELECT 
        v.*,
        COUNT(DISTINCT p.id) as product_count,
        COUNT(DISTINCT oli.order_id) as order_count,
        SUM(oli.quantity) as total_quantity_ordered
      FROM vendors v
      LEFT JOIN products p ON p.vendor_id = v.id
      LEFT JOIN order_line_items oli ON oli.product_id = p.id
      WHERE ${whereCondition}
      GROUP BY v.id
      ORDER BY v.name ASC
      LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
    `,
      [...queryParams, parseInt(limit), offset]
    );

    const vendors = result.rows.map((vendor) => ({
      id: vendor.id,
      name: vendor.name,
      contactPerson: vendor.contact_person,
      mobile: vendor.mobile,
      email: vendor.email,
      upiId: vendor.upi_id,
      stats: {
        productCount: parseInt(vendor.product_count || 0),
        orderCount: parseInt(vendor.order_count || 0),
        totalQuantityOrdered: parseInt(vendor.total_quantity_ordered || 0),
      },
      createdAt: vendor.created_at,
      updatedAt: vendor.updated_at,
    }));

    const totalPages = Math.ceil(total / parseInt(limit));

    res.status(200).json({
      success: true,
      vendors,
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
    console.error("❌ Failed to fetch vendor list:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch vendor list",
      details: error.message,
    });
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
      SELECT 
        v.*,
        COUNT(DISTINCT p.id) as product_count,
        COUNT(DISTINCT oli.order_id) as order_count,
        SUM(oli.quantity) as total_quantity_ordered
      FROM vendors v
      LEFT JOIN products p ON p.vendor_id = v.id
      LEFT JOIN order_line_items oli ON oli.product_id = p.id
      WHERE v.id = $1 AND v.shop_domain = $2
      GROUP BY v.id
    `,
      [vendorId, shopDomain]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        success: false,
        error: "Vendor not found",
      });
    }

    const vendor = result.rows[0];

    // Get vendor's products
    const productsResult = await db.query(
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

    // Get recent orders for this vendor
    const ordersResult = await db.query(
      `
      SELECT DISTINCT 
        o.id,
        o.shopify_order_id,
        o.name,
        o.notification,
        o.shopify_created_at,
        COUNT(oli.id) as line_items_count,
        SUM(oli.quantity) as total_quantity
      FROM orders o
      JOIN order_line_items oli ON oli.order_id = o.id
      JOIN products p ON p.id = oli.product_id
      WHERE p.vendor_id = $1 AND o.shop_domain = $2
      GROUP BY o.id
      ORDER BY o.shopify_created_at DESC
      LIMIT 10
    `,
      [vendorId, shopDomain]
    );

    const vendorDetails = {
      id: vendor.id,
      name: vendor.name,
      contactPerson: vendor.contact_person,
      mobile: vendor.mobile,
      email: vendor.email,
      upiId: vendor.upi_id,
      stats: {
        productCount: parseInt(vendor.product_count || 0),
        orderCount: parseInt(vendor.order_count || 0),
        totalQuantityOrdered: parseInt(vendor.total_quantity_ordered || 0),
      },
      products: productsResult.rows.map((product) => ({
        id: product.id,
        shopifyProductId: product.shopify_product_id,
        title: product.title,
        image: product.image,
        orderCount: parseInt(product.order_count || 0),
        totalQuantityOrdered: parseInt(product.total_quantity_ordered || 0),
        createdAt: product.created_at,
      })),
      recentOrders: ordersResult.rows.map((order) => ({
        id: order.id,
        shopifyOrderId: order.shopify_order_id,
        name: order.name,
        notification: order.notification,
        lineItemsCount: parseInt(order.line_items_count || 0),
        totalQuantity: parseInt(order.total_quantity || 0),
        orderDate: order.shopify_created_at,
      })),
      createdAt: vendor.created_at,
      updatedAt: vendor.updated_at,
    };

    res.status(200).json({
      success: true,
      vendor: vendorDetails,
    });
  } catch (error) {
    console.error("❌ Failed to fetch vendor details:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch vendor details",
      details: error.message,
    });
  }
});

// PUT /api/vendor/:id - Update vendor information
router.put("/:id", async (req, res) => {
  const session = res.locals.shopify.session;
  const shopDomain = session.shop;
  const vendorId = req.params.id;
  const { name, contactPerson, mobile, email, upiId } = req.body;

  try {
    const result = await db.query(
      `
      UPDATE vendors 
      SET name = $1, contact_person = $2, mobile = $3, email = $4, upi_id = $5, updated_at = NOW()
      WHERE id = $6 AND shop_domain = $7
      RETURNING *
    `,
      [name, contactPerson, mobile, email, upiId, vendorId, shopDomain]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        success: false,
        error: "Vendor not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Vendor updated successfully",
      vendor: result.rows[0],
    });
  } catch (error) {
    console.error("❌ Failed to update vendor:", error);
    res.status(500).json({
      success: false,
      error: "Failed to update vendor",
      details: error.message,
    });
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
      SELECT 
        p.*,
        COUNT(DISTINCT oli.order_id) as order_count,
        SUM(oli.quantity) as total_quantity_ordered,
        MAX(o.shopify_created_at) as last_ordered
      FROM products p
      LEFT JOIN order_line_items oli ON oli.product_id = p.id
      LEFT JOIN orders o ON o.id = oli.order_id
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
        lastOrdered: product.last_ordered,
      },
      createdAt: product.created_at,
      updatedAt: product.updated_at,
    }));

    res.status(200).json({
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

// GET /api/vendor/:id/orders - Get all orders for a vendor
router.get("/:id/orders", async (req, res) => {
  const session = res.locals.shopify.session;
  const shopDomain = session.shop;
  const vendorId = req.params.id;

  try {
    const result = await db.query(
      `
      SELECT DISTINCT 
        o.id,
        o.shopify_order_id,
        o.name,
        o.notification,
        o.shopify_created_at,
        json_agg(
          json_build_object(
            'id', oli.id,
            'productId', oli.product_id,
            'quantity', oli.quantity,
            'productTitle', p.title,
            'productImage', p.image
          ) ORDER BY oli.id
        ) as line_items
      FROM orders o
      JOIN order_line_items oli ON oli.order_id = o.id
      JOIN products p ON p.id = oli.product_id
      WHERE p.vendor_id = $1 AND o.shop_domain = $2
      GROUP BY o.id
      ORDER BY o.shopify_created_at DESC
    `,
      [vendorId, shopDomain]
    );

    const orders = result.rows.map((order) => ({
      id: order.id,
      shopifyOrderId: order.shopify_order_id,
      name: order.name,
      notification: order.notification,
      lineItems: order.line_items || [],
      orderDate: order.shopify_created_at,
    }));

    res.status(200).json({
      success: true,
      orders,
    });
  } catch (error) {
    console.error("❌ Failed to fetch vendor orders:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch vendor orders",
      details: error.message,
    });
  }
});

// GET /api/vendor/stats/summary - Get vendor statistics
router.get("/stats/summary", async (req, res) => {
  const session = res.locals.shopify.session;
  const shopDomain = session.shop;

  try {
    const statsResult = await db.query(
      `
      SELECT 
        COUNT(DISTINCT v.id) as total_vendors,
        COUNT(DISTINCT p.id) as total_products_with_vendors,
        COUNT(DISTINCT oli.order_id) as orders_with_vendors,
        SUM(oli.quantity) as total_quantity_by_vendors,
        COUNT(CASE WHEN v.mobile IS NOT NULL OR v.email IS NOT NULL THEN 1 END) as vendors_with_contact
      FROM vendors v
      LEFT JOIN products p ON p.vendor_id = v.id
      LEFT JOIN order_line_items oli ON oli.product_id = p.id
      WHERE v.shop_domain = $1
    `,
      [shopDomain]
    );

    const stats = statsResult.rows[0];

    res.json({
      success: true,
      stats: {
        totalVendors: parseInt(stats.total_vendors || 0),
        totalProductsWithVendors: parseInt(
          stats.total_products_with_vendors || 0
        ),
        ordersWithVendors: parseInt(stats.orders_with_vendors || 0),
        totalQuantityByVendors: parseInt(stats.total_quantity_by_vendors || 0),
        vendorsWithContact: parseInt(stats.vendors_with_contact || 0),
      },
    });
  } catch (error) {
    console.error("❌ Error fetching vendor stats:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch vendor statistics",
      details: error.message,
    });
  }
});

export default router;
