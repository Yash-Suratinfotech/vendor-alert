// web/routes/orders.js
import express from "express";
import db from "../db.js";

const router = express.Router();

// GET /api/orders - Get orders with pagination and filters
router.get("/", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const shopDomain = session.shop;

    // Parse query parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 25;
    const offset = (page - 1) * limit;

    // Filters
    const vendor = req.query.vendor;
    const notification = req.query.notification; // 'true', 'false', or undefined

    // Build WHERE conditions
    let whereConditions = ["o.shop_domain = $1"];
    let queryParams = [shopDomain];
    let paramCount = 1;

    if (vendor) {
      paramCount++;
      whereConditions.push(`
        EXISTS (
          SELECT 1 FROM order_line_items oli 
          JOIN products p ON p.id = oli.product_id 
          WHERE oli.order_id = o.id AND p.vendor_name = $${paramCount}
        )
      `);
      queryParams.push(vendor);
    }

    if (notification !== undefined) {
      paramCount++;
      whereConditions.push(`o.notification = ${paramCount}`);
      queryParams.push(notification === 'true');
    }

    const whereClause = whereConditions.join(" AND ");

    // Get total count
    const totalCountQuery = `
      SELECT COUNT(*) as total
      FROM orders o 
      WHERE ${whereClause}
    `;

    const totalResult = await db.query(totalCountQuery, queryParams);
    const total = parseInt(totalResult.rows[0].total);

    // Get orders with line items
    const ordersQuery = `
      SELECT 
        o.id,
        o.shopify_order_id,
        o.name,
        o.notification,
        o.created_at,
        o.updated_at,
        o.shopify_created_at,
        o.shopify_updated_at,
        json_agg(
          json_build_object(
            'id', oli.id,
            'productId', oli.product_id,
            'quantity', oli.quantity,
            'productTitle', p.title,
            'productImage', p.image,
            'vendorName', p.vendor_name
          ) ORDER BY oli.id
        ) as line_items
      FROM orders o 
      LEFT JOIN order_line_items oli ON oli.order_id = o.id
      LEFT JOIN products p ON p.id = oli.product_id
      WHERE ${whereClause}
      GROUP BY o.id
      ORDER BY o.shopify_created_at DESC, o.created_at DESC
      LIMIT ${paramCount + 1} OFFSET ${paramCount + 2}
    `;

    queryParams.push(limit, offset);

    const ordersResult = await db.query(ordersQuery, queryParams);
    const orders = ordersResult.rows.map(order => ({
      id: order.id,
      shopifyOrderId: order.shopify_order_id,
      name: order.name,
      notification: order.notification,
      lineItems: order.line_items || [],
      createdAt: order.created_at,
      updatedAt: order.updated_at,
      shopifyCreatedAt: order.shopify_created_at,
      shopifyUpdatedAt: order.shopify_updated_at,
    }));

    // Calculate pagination
    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      orders,
      pagination: {
        total,
        page,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    });
  } catch (error) {
    console.error("❌ Error fetching orders:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch orders",
      details: error.message,
    });
  }
});

// GET /api/orders/:id - Get single order details
router.get("/:id", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const shopDomain = session.shop;
    const orderId = req.params.id;

    // Get order with line items
    const orderResult = await db.query(
      `
      SELECT 
        o.*,
        json_agg(
          json_build_object(
            'id', oli.id,
            'productId', oli.product_id,
            'quantity', oli.quantity,
            'productTitle', p.title,
            'productImage', p.image,
            'vendorName', p.vendor_name,
            'shopifyProductId', p.shopify_product_id
          ) ORDER BY oli.id
        ) as line_items
      FROM orders o 
      LEFT JOIN order_line_items oli ON oli.order_id = o.id
      LEFT JOIN products p ON p.id = oli.product_id
      WHERE o.id = $1 AND o.shop_domain = $2
      GROUP BY o.id
    `,
      [orderId, shopDomain]
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Order not found",
      });
    }

    const order = orderResult.rows[0];

    res.json({
      success: true,
      order: {
        id: order.id,
        shopifyOrderId: order.shopify_order_id,
        name: order.name,
        notification: order.notification,
        lineItems: order.line_items || [],
        createdAt: order.created_at,
        updatedAt: order.updated_at,
        shopifyCreatedAt: order.shopify_created_at,
        shopifyUpdatedAt: order.shopify_updated_at,
      },
    });
  } catch (error) {
    console.error("❌ Error fetching order details:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch order details",
      details: error.message,
    });
  }
});

// PUT /api/orders/:id/notification - Update notification status
router.put("/:id/notification", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const shopDomain = session.shop;
    const orderId = req.params.id;
    const { notification } = req.body;

    const result = await db.query(
      `
      UPDATE orders 
      SET notification = $1, updated_at = NOW()
      WHERE id = $2 AND shop_domain = $3
      RETURNING *
    `,
      [notification, orderId, shopDomain]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Order not found",
      });
    }

    res.json({
      success: true,
      message: "Notification status updated",
      order: result.rows[0],
    });
  } catch (error) {
    console.error("❌ Error updating notification status:", error);
    res.status(500).json({
      success: false,
      error: "Failed to update notification status",
      details: error.message,
    });
  }
});

// GET /api/orders/stats/summary - Get order statistics
router.get("/stats/summary", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const shopDomain = session.shop;

    const statsResult = await db.query(
      `
      SELECT 
        COUNT(*) as total_orders,
        COUNT(CASE WHEN notification = true THEN 1 END) as notified_orders,
        COUNT(CASE WHEN notification = false THEN 1 END) as pending_notifications,
        COUNT(DISTINCT p.vendor_name) as unique_vendors_in_orders,
        SUM(oli.quantity) as total_items_ordered,
        MIN(o.shopify_created_at) as oldest_order,
        MAX(o.shopify_created_at) as newest_order
      FROM orders o
      LEFT JOIN order_line_items oli ON oli.order_id = o.id
      LEFT JOIN products p ON p.id = oli.product_id
      WHERE o.shop_domain = $1
    `,
      [shopDomain]
    );

    const stats = statsResult.rows[0];

    res.json({
      success: true,
      stats: {
        totalOrders: parseInt(stats.total_orders || 0),
        notifiedOrders: parseInt(stats.notified_orders || 0),
        pendingNotifications: parseInt(stats.pending_notifications || 0),
        uniqueVendorsInOrders: parseInt(stats.unique_vendors_in_orders || 0),
        totalItemsOrdered: parseInt(stats.total_items_ordered || 0),
        oldestOrder: stats.oldest_order,
        newestOrder: stats.newest_order,
      },
    });
  } catch (error) {
    console.error("❌ Error fetching order stats:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch order statistics",
      details: error.message,
    });
  }
});

// GET /api/orders/vendor/:vendorName - Get orders for specific vendor
router.get("/vendor/:vendorName", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const shopDomain = session.shop;
    const vendorName = decodeURIComponent(req.params.vendorName);

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
        ) FILTER (WHERE p.vendor_name = $2) as vendor_line_items
      FROM orders o
      JOIN order_line_items oli ON oli.order_id = o.id
      JOIN products p ON p.id = oli.product_id
      WHERE o.shop_domain = $1 AND p.vendor_name = $2
      GROUP BY o.id
      ORDER BY o.shopify_created_at DESC
    `,
      [shopDomain, vendorName]
    );

    const orders = result.rows.map(order => ({
      id: order.id,
      shopifyOrderId: order.shopify_order_id,
      name: order.name,
      notification: order.notification,
      vendorLineItems: order.vendor_line_items || [],
      orderDate: order.shopify_created_at,
    }));

    res.json({
      success: true,
      vendorName,
      orders,
    });
  } catch (error) {
    console.error("❌ Error fetching vendor orders:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch vendor orders",
      details: error.message,
    });
  }
});

// Debug endpoint
router.get("/debug/database", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const shopDomain = session.shop;

    // Get comprehensive database stats
    const stats = await db.query(
      `
      SELECT 
        (SELECT COUNT(*) FROM orders WHERE shop_domain = $1) as total_orders,
        (SELECT COUNT(*) FROM orders WHERE shop_domain = $1 AND notification = true) as notified_orders,
        (SELECT COUNT(*) FROM orders WHERE shop_domain = $1 AND notification = false) as pending_orders,
        (SELECT COUNT(*) FROM order_line_items oli 
         JOIN orders o ON oli.order_id = o.id 
         WHERE o.shop_domain = $1) as total_line_items,
        (SELECT COUNT(*) FROM products WHERE shop_domain = $1) as total_products,
        (SELECT COUNT(DISTINCT vendor_name) FROM products WHERE shop_domain = $1 AND vendor_name IS NOT NULL) as unique_vendors,
        (SELECT MIN(shopify_created_at) FROM orders WHERE shop_domain = $1) as oldest_order,
        (SELECT MAX(shopify_created_at) FROM orders WHERE shop_domain = $1) as newest_order
    `,
      [shopDomain]
    );

    // Get sample orders
    const sampleOrders = await db.query(
      `
      SELECT 
        o.shopify_order_id,
        o.name,
        o.notification,
        o.shopify_created_at,
        COUNT(oli.id) as line_item_count
      FROM orders o
      LEFT JOIN order_line_items oli ON oli.order_id = o.id
      WHERE o.shop_domain = $1 
      GROUP BY o.id
      ORDER BY o.shopify_created_at DESC 
      LIMIT 5
    `,
      [shopDomain]
    );

    res.json({
      success: true,
      shopDomain,
      stats: stats.rows[0],
      sampleOrders: sampleOrders.rows,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Error in debug endpoint:", error);
    res.status(500).json({
      success: false,
      error: "Debug query failed",
      details: error.message,
    });
  }
});

export default router;