// web/routes/orders.js - FIXED
import express from "express";
import db from "../db.js";

const router = express.Router();

// GET /api/orders - Get orders with pagination and filters
router.get("/", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const shopDomain = session.shop;

    // Pagination
    const { page = 1, limit = 25, search } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Filters
    const vendor = req.query.vendor;
    const notification = req.query.notification;

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
      whereConditions.push(`o.notification = $${paramCount}`);
      queryParams.push(notification === "true");
    }

    if (search) {
      paramCount++;
      whereConditions.push(`
        (
          o.name ILIKE $${paramCount}
          OR EXISTS (
            SELECT 1 FROM order_line_items oli
            JOIN products p ON p.id = oli.product_id
            WHERE oli.order_id = o.id
              AND (
                p.title ILIKE $${paramCount}
                OR p.vendor_name ILIKE $${paramCount}
              )
          )
        )
      `);
      queryParams.push(`%${search}%`);
    }

    const whereClause = whereConditions.join(" AND ");

    // Total count
    const totalResult = await db.query(
      `SELECT COUNT(*) as total FROM orders o WHERE ${whereClause}`,
      queryParams
    );
    const total = parseInt(totalResult.rows[0].total);

    // Orders with enriched line items
    const nextParamCount = paramCount + 1;
    const offsetParamCount = paramCount + 2;

    const ordersQuery = `
      SELECT 
        o.*,
        json_agg(
          json_build_object(
            'id', oli.id,
            'productId', oli.product_id,
            'quantity', oli.quantity,
            'notification', oli.notification,
            'title', p.title,
            'image', p.image,
            'vendor', p.vendor_name,
            'vendorId', p.vendor_id,
            'shopifyProductId', p.shopify_product_id
          ) ORDER BY oli.id
        ) FILTER (WHERE oli.id IS NOT NULL) as line_items
      FROM orders o
      LEFT JOIN order_line_items oli ON oli.order_id = o.id
      LEFT JOIN products p ON p.id = oli.product_id
      WHERE ${whereClause}
      GROUP BY o.id
      ORDER BY o.shopify_created_at DESC, o.created_at DESC
      LIMIT $${nextParamCount} OFFSET $${offsetParamCount}
    `;

    const finalParams = [...queryParams, limit, offset];
    const ordersResult = await db.query(ordersQuery, finalParams);

    const orders = ordersResult.rows.map((order) => ({
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

    res.json({
      success: true,
      orders,
      pagination: {
        total,
        page,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page < Math.ceil(total / limit),
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
export default router;
