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

export default router;
