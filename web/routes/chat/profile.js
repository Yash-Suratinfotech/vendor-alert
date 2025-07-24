// web/routes/chat/profile.js
import express from "express";
import db from "../../db.js";

const router = express.Router();

// ============== GET PROFILE ==============
router.get("/profile", async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user profile
    const userResult = await db.query(
      `SELECT id, username, email, user_type, phone, avatar_url, 
              created_at, last_login, is_active, is_verified
       FROM users WHERE id = $1`,
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    const user = userResult.rows[0];

    // Get additional info based on user type
    let additionalInfo = {};

    if (user.user_type === "vendor") {
      const vendorResult = await db.query(
        `SELECT v.*, 
                COUNT(DISTINCT p.id) as product_count,
                COUNT(DISTINCT o.id) as order_count
         FROM vendors v
         LEFT JOIN products p ON p.vendor_id = v.id
         LEFT JOIN order_line_items oli ON oli.product_id = p.id
         LEFT JOIN orders o ON o.id = oli.order_id
         WHERE v.email = $1
         GROUP BY v.id`,
        [user.email]
      );

      if (vendorResult.rows.length > 0) {
        additionalInfo = vendorResult.rows[0];
      }
    } else if (user.user_type === "store_owner") {
      const shopResult = await db.query(
        `SELECT s.*,
                COUNT(DISTINCT p.id) as product_count,
                COUNT(DISTINCT o.id) as order_count,
                COUNT(DISTINCT v.id) as vendor_count
         FROM shops s
         LEFT JOIN products p ON p.shop_domain = s.shop_domain
         LEFT JOIN orders o ON o.shop_domain = s.shop_domain
         LEFT JOIN vendors v ON v.shop_domain = s.shop_domain
         WHERE s.id = (SELECT shop_id FROM users WHERE id = $1)
         GROUP BY s.id`,
        [userId]
      );

      if (shopResult.rows.length > 0) {
        additionalInfo = shopResult.rows[0];
      }
    }

    res.status(200).json({
      success: true,
      user: {
        ...user,
        ...additionalInfo,
      },
    });
  } catch (error) {
    console.error("❌ Get profile error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch profile",
      details: error.message,
    });
  }
});

// ============== UPDATE PROFILE ==============
router.put("/profile", async (req, res) => {
  try {
    const userId = req.user.id;
    const { username, phone, avatarUrl } = req.body;

    const updates = [];
    const values = [];
    let paramCount = 1;

    if (username) {
      updates.push(`username = $${paramCount}`);
      values.push(username);
      paramCount++;
    }

    if (phone) {
      updates.push(`phone = $${paramCount}`);
      values.push(phone);
      paramCount++;
    }

    if (avatarUrl) {
      updates.push(`avatar_url = $${paramCount}`);
      values.push(avatarUrl);
      paramCount++;
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No fields to update",
      });
    }

    updates.push(`last_active = NOW()`);
    values.push(userId);

    const query = `
      UPDATE users 
      SET ${updates.join(", ")}
      WHERE id = $${paramCount}
      RETURNING id, username, email, user_type, phone, avatar_url
    `;

    const result = await db.query(query, values);

    res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      user: result.rows[0],
    });
  } catch (error) {
    console.error("❌ Update profile error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to update profile",
      details: error.message,
    });
  }
});

export default router;
