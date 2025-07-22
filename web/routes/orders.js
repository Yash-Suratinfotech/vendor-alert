// web/routes/orders.js - Enhanced with debugging
import express from "express";
import db from "../db.js";

const router = express.Router();

// Get orders with pagination and filters - ENHANCED WITH DEBUGGING
router.get("/", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const shopDomain = session.shop;

    // Parse query parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 25;
    const offset = (page - 1) * limit;

    // Filters
    const financialStatus = req.query.financial_status;
    const fulfillmentStatus = req.query.fulfillment_status;
    const vendor = req.query.vendor;

    console.log("🔍 Orders API Debug:", {
      shopDomain,
      page,
      limit,
      offset,
      filters: {
        financialStatus,
        fulfillmentStatus,
        vendor,
      },
    });

    // Build WHERE conditions
    let whereConditions = ["shop_domain = $1"];
    let queryParams = [shopDomain];
    let paramCount = 1;

    if (financialStatus) {
      paramCount++;
      whereConditions.push(`financial_status = $${paramCount}`);
      queryParams.push(financialStatus);
    }

    if (fulfillmentStatus) {
      paramCount++;
      whereConditions.push(`fulfillment_status = $${paramCount}`);
      queryParams.push(fulfillmentStatus);
    }

    if (vendor) {
      paramCount++;
      whereConditions.push(`
        id IN (
          SELECT DISTINCT order_id 
          FROM order_line_items 
          WHERE vendor = $${paramCount}
        )
      `);
      queryParams.push(vendor);
    }

    const whereClause = whereConditions.join(" AND ");

    // First, let's get total count for debugging
    const totalCountQuery = `
      SELECT COUNT(*) as total
      FROM orders 
      WHERE ${whereClause}
    `;

    console.log("📊 Total count query:", totalCountQuery);
    console.log("📊 Query params:", queryParams);

    const totalResult = await db.query(totalCountQuery, queryParams);
    const total = parseInt(totalResult.rows[0].total);

    console.log("📊 Total orders found:", total);

    // Get orders with pagination
    const ordersQuery = `
      SELECT 
        id,
        shopify_order_id,
        shopify_order_number,
        total_price,
        financial_status,
        fulfillment_status,
        order_status,
        notified,
        created_at,
        updated_at,
        shopify_created_at,
        shopify_updated_at
      FROM orders 
      WHERE ${whereClause}
      ORDER BY shopify_created_at DESC, created_at DESC
      LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
    `;

    queryParams.push(limit, offset);

    console.log("📋 Orders query:", ordersQuery);
    console.log("📋 Final query params:", queryParams);

    const ordersResult = await db.query(ordersQuery, queryParams);
    const orders = ordersResult.rows;

    console.log("📋 Orders returned:", {
      count: orders.length,
      sampleOrder: orders[0],
    });

    // Calculate pagination
    const totalPages = Math.ceil(total / limit);

    // Additional debugging: Check raw order count in database
    const rawCountResult = await db.query(
      "SELECT COUNT(*) as raw_total FROM orders WHERE shop_domain = $1",
      [shopDomain]
    );
    const rawTotal = parseInt(rawCountResult.rows[0].raw_total);

    console.log("📊 Debug Summary:", {
      shopDomain,
      rawTotalInDB: rawTotal,
      filteredTotal: total,
      ordersReturned: orders.length,
      page,
      totalPages,
      hasFilters: !!(financialStatus || fulfillmentStatus || vendor),
    });

    // Return response with debug info
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
      debug: {
        rawTotalInDB: rawTotal,
        filteredTotal: total,
        queryParams: queryParams.slice(0, -2), // Don't expose limit/offset
        hasFilters: !!(financialStatus || fulfillmentStatus || vendor),
        shopDomain,
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

// Get single order details
router.get("/:id", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const shopDomain = session.shop;
    const orderId = req.params.id;

    // Get order details
    const orderResult = await db.query(
      `
      SELECT * FROM orders 
      WHERE id = $1 AND shop_domain = $2
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

    // Get line items
    const lineItemsResult = await db.query(
      `
      SELECT 
        id,
        shopify_line_item_id,
        title,
        vendor,
        quantity,
        price,
        total_discount
      FROM order_line_items 
      WHERE order_id = $1
      ORDER BY id
    `,
      [orderId]
    );

    const lineItems = lineItemsResult.rows;

    res.json({
      success: true,
      order,
      lineItems,
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

// Debug endpoint to check database state
router.get("/debug/database", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const shopDomain = session.shop;

    // Get comprehensive database stats
    const stats = await db.query(
      `
      SELECT 
        (SELECT COUNT(*) FROM orders WHERE shop_domain = $1) as total_orders,
        (SELECT COUNT(*) FROM orders WHERE shop_domain = $1 AND financial_status = 'paid') as paid_orders,
        (SELECT COUNT(*) FROM orders WHERE shop_domain = $1 AND fulfillment_status = 'fulfilled') as fulfilled_orders,
        (SELECT COUNT(*) FROM orders WHERE shop_domain = $1 AND notified = true) as notified_orders,
        (SELECT COUNT(*) FROM order_line_items oli 
         JOIN orders o ON oli.order_id = o.id 
         WHERE o.shop_domain = $1) as total_line_items,
        (SELECT COUNT(DISTINCT vendor) FROM order_line_items oli 
         JOIN orders o ON oli.order_id = o.id 
         WHERE o.shop_domain = $1 AND vendor IS NOT NULL) as unique_vendors_in_orders,
        (SELECT MIN(shopify_created_at) FROM orders WHERE shop_domain = $1) as oldest_order,
        (SELECT MAX(shopify_created_at) FROM orders WHERE shop_domain = $1) as newest_order
    `,
      [shopDomain]
    );

    // Get sample orders
    const sampleOrders = await db.query(
      `
      SELECT 
        shopify_order_id,
        shopify_order_number,
        financial_status,
        fulfillment_status,
        total_price,
        shopify_created_at
      FROM orders 
      WHERE shop_domain = $1 
      ORDER BY shopify_created_at DESC 
      LIMIT 5
    `,
      [shopDomain]
    );

    // Get orders by status
    const statusBreakdown = await db.query(
      `
      SELECT 
        financial_status,
        fulfillment_status,
        COUNT(*) as count
      FROM orders 
      WHERE shop_domain = $1 
      GROUP BY financial_status, fulfillment_status
      ORDER BY count DESC
    `,
      [shopDomain]
    );

    res.json({
      success: true,
      shopDomain,
      stats: stats.rows[0],
      sampleOrders: sampleOrders.rows,
      statusBreakdown: statusBreakdown.rows,
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
