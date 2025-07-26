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
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 25;
    const offset = (page - 1) * limit;

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

// GET /api/orders/:id - Get single order details with full line item info
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
      WHERE o.id = $1 AND o.shop_domain = $2
      GROUP BY o.id
    `,
      [orderId, shopDomain]
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({
        status: 404,
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
      status: 500,
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
        status: 404,
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
      status: 500,
      success: false,
      error: "Failed to update notification status",
      details: error.message,
    });
  }
});

// PUT /api/orders/:orderId/line-items/:lineItemId/notification - Update line item notification
router.put(
  "/:orderId/line-items/:lineItemId/notification",
  async (req, res) => {
    try {
      const session = res.locals.shopify.session;
      const shopDomain = session.shop;
      const { orderId, lineItemId } = req.params;
      const { notification } = req.body;

      // Verify order belongs to shop
      const orderCheck = await db.query(
        "SELECT id FROM orders WHERE id = $1 AND shop_domain = $2",
        [orderId, shopDomain]
      );

      if (orderCheck.rows.length === 0) {
        return res.status(404).json({
          status: 404,
          success: false,
          error: "Order not found",
        });
      }

      // Update line item notification
      const result = await db.query(
        `
      UPDATE order_line_items 
      SET notification = $1 
      WHERE id = $2 AND order_id = $3 AND shop_domain = $4
      RETURNING *
    `,
        [notification, lineItemId, orderId, shopDomain]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          status: 404,
          success: false,
          error: "Line item not found",
        });
      }

      res.json({
        success: true,
        message: "Line item notification status updated",
        lineItem: result.rows[0],
      });
    } catch (error) {
      console.error("❌ Error updating line item notification:", error);
      res.status(500).json({
        status: 500,
        success: false,
        error: "Failed to update line item notification",
        details: error.message,
      });
    }
  }
);

// POST /api/orders/notify-vendors/orderId - Manually notify vendors for an order
router.post("/notify-vendors/:orderId", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const shopDomain = session.shop;
    const orderId = req.params.orderId;

    // Trigger notification through notify-orders API
    const response = await fetch(
      `${process.env.BACKEND_URL}/api/notify-orders`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shopDomain, orderId }),
      }
    );

    const result = await response.json();

    if (response.ok) {
      res.json({
        success: true,
        message: "Vendors notified successfully",
        results: result.notified,
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error || "Failed to notify vendors",
      });
    }
  } catch (error) {
    console.error("❌ Error notifying vendors:", error);
    res.status(500).json({
      success: false,
      error: "Failed to notify vendors",
      details: error.message,
    });
  }
});

export default router;
