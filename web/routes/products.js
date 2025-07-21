// web/routes/products.js
import express from "express";
import db from "../db.js";

const router = express.Router();

// GET /api/products - Get products with filtering and pagination
router.get("/", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const shopDomain = session.shop;

    const { page = 1, limit = 25, search, vendor, status } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Simple approach - build query step by step
    let whereConditions = `p.shop_domain = $1`;
    let queryParams = [shopDomain];
    let paramCounter = 2;

    // Add search condition
    if (search) {
      whereConditions += ` AND (p.name ILIKE $${paramCounter} OR p.sku ILIKE $${paramCounter})`;
      queryParams.push(`%${search}%`);
      paramCounter++;
    }

    // Add vendor filter
    if (vendor) {
      whereConditions += ` AND p.vendor_name = $${paramCounter}`;
      queryParams.push(vendor);
      paramCounter++;
    }

    // Add status filter
    if (status) {
      whereConditions += ` AND p.status = $${paramCounter}`;
      queryParams.push(status);
      paramCounter++;
    }

    // Get total count first
    const countQuery = `
      SELECT COUNT(*) as total 
      FROM products p
      WHERE ${whereConditions}
    `;

    const countResult = await db.query(countQuery, queryParams);
    const total = parseInt(countResult.rows[0].total);

    // Get products with pagination
    const productsQuery = `
      SELECT 
        p.id,
        p.shopify_product_id,
        p.name,
        p.sku,
        p.vendor_name,
        p.handle,
        p.product_type,
        p.status,
        p.inventory_quantity,
        p.price,
        p.shopify_created_at,
        p.shopify_updated_at,
        p.created_at,
        p.updated_at,
        v.name as vendor_display_name
      FROM products p
      LEFT JOIN vendors v ON p.vendor_id = v.id
      WHERE ${whereConditions}
      ORDER BY p.name ASC
      LIMIT $${paramCounter} OFFSET $${paramCounter + 1}
    `;

    // Add limit and offset to params
    const finalParams = [...queryParams, parseInt(limit), offset];

    const productsResult = await db.query(productsQuery, finalParams);

    const products = productsResult.rows.map((product) => ({
      id: product.id,
      shopifyProductId: product.shopify_product_id,
      name: product.name,
      sku: product.sku,
      vendorName: product.vendor_name,
      vendorDisplayName: product.vendor_display_name,
      handle: product.handle,
      productType: product.product_type,
      status: product.status,
      inventoryQuantity: product.inventory_quantity,
      price: parseFloat(product.price || 0),
      shopifyCreatedAt: product.shopify_created_at,
      shopifyUpdatedAt: product.shopify_updated_at,
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
    console.error("Error details:", error.message);
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

// GET /api/products/:id - Get specific product details
router.get("/:id", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const shopDomain = session.shop;
    const productId = req.params.id;

    const result = await db.query(
      `
      SELECT 
        p.id,
        p.shopify_product_id,
        p.name,
        p.sku,
        p.vendor_name,
        p.handle,
        p.product_type,
        p.status,
        p.inventory_quantity,
        p.price,
        p.shopify_created_at,
        p.shopify_updated_at,
        v.name as vendor_display_name,
        v.contact_person,
        v.mobile,
        v.email
      FROM products p
      LEFT JOIN vendors v ON p.vendor_id = v.id
      WHERE p.id = $1 AND p.shop_domain = $2
    `,
      [productId, shopDomain]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Product not found" });
    }

    const product = result.rows[0];

    // Get order history for this product (no customer data)
    const ordersResult = await db.query(
      `
      SELECT DISTINCT 
        o.shopify_order_id, 
        o.shopify_order_number, 
        o.total_price, 
        o.shopify_created_at,
        oli.quantity, 
        oli.price as line_item_price
      FROM orders o
      JOIN order_line_items oli ON oli.order_id = o.id
      WHERE oli.product_id = $1
      ORDER BY o.shopify_created_at DESC
      LIMIT 10
    `,
      [productId]
    );

    const productDetails = {
      id: product.id,
      shopifyProductId: product.shopify_product_id,
      name: product.name,
      sku: product.sku,
      vendorName: product.vendor_name,
      vendorDisplayName: product.vendor_display_name,
      handle: product.handle,
      productType: product.product_type,
      status: product.status,
      inventoryQuantity: product.inventory_quantity,
      price: parseFloat(product.price || 0),
      vendor: {
        name: product.vendor_display_name,
        contactPerson: product.contact_person,
        mobile: product.mobile,
        email: product.email,
      },
      recentOrders: ordersResult.rows,
      shopifyCreatedAt: product.shopify_created_at,
      shopifyUpdatedAt: product.shopify_updated_at,
    };

    res.json({
      success: true,
      product: productDetails,
    });
  } catch (error) {
    console.error("❌ Failed to fetch product details:", error);
    res.status(500).json({ error: "Failed to fetch product details" });
  }
});

export default router;
