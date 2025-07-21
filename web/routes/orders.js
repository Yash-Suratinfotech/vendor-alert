// web/routes/orders.js
import express from "express";
import db from "../db.js";

const router = express.Router();

// GET /api/orders - Get orders with filtering and pagination
router.get("/", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const shopDomain = session.shop;

    const {
      page = 1,
      limit = 25,
      financial_status,
      fulfillment_status,
      vendor,
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Build WHERE conditions
    const conditions = ["o.shop_domain = $1"];
    const params = [shopDomain];
    let paramIndex = 2;

    if (financial_status) {
      conditions.push(`o.financial_status = $${paramIndex}`);
      params.push(financial_status);
      paramIndex++;
    }

    if (fulfillment_status) {
      conditions.push(`o.fulfillment_status = $${paramIndex}`);
      params.push(fulfillment_status);
      paramIndex++;
    }

    let joinClause = "";
    if (vendor) {
      joinClause = "JOIN order_line_items oli ON oli.order_id = o.id";
      conditions.push(`oli.vendor = $${paramIndex}`);
      params.push(vendor);
      paramIndex++;
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Get total count
    const countQuery = `
      SELECT COUNT(DISTINCT o.id) as total 
      FROM orders o
      ${joinClause}
      ${whereClause}
    `;
    const countResult = await db.query(countQuery, params);
    const total = parseInt(countResult.rows[0].total);

    // Get orders
    const ordersQuery = `
      SELECT DISTINCT o.*
      FROM orders o
      ${joinClause}
      ${whereClause}
      ORDER BY o.shopify_created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    const ordersResult = await db.query(ordersQuery, [
      ...params,
      parseInt(limit),
      offset,
    ]);

    const orders = ordersResult.rows.map((order) => ({
      id: order.id,
      shopifyOrderId: order.shopify_order_id,
      shopifyOrderNumber: order.shopify_order_number,
      totalPrice: parseFloat(order.total_price || 0),
      financialStatus: order.financial_status,
      fulfillmentStatus: order.fulfillment_status,
      orderStatus: order.order_status,
      notified: order.notified,
      shopifyCreatedAt: order.shopify_created_at,
      shopifyUpdatedAt: order.shopify_updated_at,
      createdAt: order.created_at,
      updatedAt: order.updated_at,
    }));

    const totalPages = Math.ceil(total / parseInt(limit));

    res.json({
      success: true,
      orders,
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
    console.error("❌ Failed to fetch orders:", error);
    res.status(500).json({ error: "Failed to fetch orders" });
  }
});

// GET /api/orders/:id - Get specific order details
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
      return res.status(404).json({ error: "Order not found" });
    }

    const order = orderResult.rows[0];

    // Get line items
    const lineItemsResult = await db.query(
      `
      SELECT 
        oli.*,
        p.name as product_name,
        p.handle as product_handle
      FROM order_line_items oli
      LEFT JOIN products p ON p.id = oli.product_id
      WHERE oli.order_id = $1
      ORDER BY oli.id ASC
    `,
      [orderId]
    );

    const orderDetails = {
      id: order.id,
      shopifyOrderId: order.shopify_order_id,
      shopifyOrderNumber: order.shopify_order_number,
      totalPrice: parseFloat(order.total_price || 0),
      financialStatus: order.financial_status,
      fulfillmentStatus: order.fulfillment_status,
      orderStatus: order.order_status,
      notified: order.notified,
      shopifyCreatedAt: order.shopify_created_at,
      shopifyUpdatedAt: order.shopify_updated_at,
    };

    const lineItems = lineItemsResult.rows.map((item) => ({
      id: item.id,
      shopifyLineItemId: item.shopify_line_item_id,
      productId: item.product_id,
      shopifyProductId: item.shopify_product_id,
      shopifyVariantId: item.shopify_variant_id,
      title: item.title,
      productName: item.product_name,
      productHandle: item.product_handle,
      vendor: item.vendor,
      quantity: item.quantity,
      price: parseFloat(item.price || 0),
      totalDiscount: parseFloat(item.total_discount || 0),
      createdAt: item.created_at,
    }));

    res.json({
      success: true,
      order: orderDetails,
      lineItems,
    });
  } catch (error) {
    console.error("❌ Failed to fetch order details:", error);
    res.status(500).json({ error: "Failed to fetch order details" });
  }
});

// PUT /api/orders/:id/notify - Mark order as notified
router.put("/:id/notify", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const shopDomain = session.shop;
    const orderId = req.params.id;

    const result = await db.query(
      `
      UPDATE orders 
      SET notified = TRUE, updated_at = NOW()
      WHERE id = $1 AND shop_domain = $2
      RETURNING *
    `,
      [orderId, shopDomain]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Order not found" });
    }

    res.json({
      success: true,
      message: "Order marked as notified",
      order: result.rows[0],
    });
  } catch (error) {
    console.error("❌ Failed to update order notification status:", error);
    res.status(500).json({ error: "Failed to update notification status" });
  }
});

export default router;
