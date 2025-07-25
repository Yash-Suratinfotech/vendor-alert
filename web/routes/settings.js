// web/routes/settings.js
import express from "express";
import db from "../db.js";
import bcrypt from "bcrypt";

const router = express.Router();

// GET /api/settings/profile - Get store owner profile
router.get("/profile", async (req, res) => {
  try {
    const shopDomain = res.locals.shopify.session.shop;

    const userResult = await db.query(
      `SELECT id, username, email, user_type, phone, avatar_url,
              created_at, last_login, is_active, is_verified, shop_domain,
              password_hash IS NOT NULL as has_password
       FROM users WHERE shop_domain = $1 AND user_type = 'store_owner'`,
      [shopDomain]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        success: false,
        error: "Store owner user not found for this shop.",
      });
    }

    const user = userResult.rows[0];
    // Do not expose password_hash directly
    const { password_hash, ...safeUser } = user;

    res.status(200).json({
      status: 200,
      success: true,
      user: safeUser,
    });
  } catch (error) {
    console.error("❌ Get settings profile error:", error);
    res.status(500).json({
      status: 500,
      success: false,
      error: "Failed to fetch settings profile",
      details: error.message,
    });
  }
});

// PUT /api/settings/profile - Update store owner profile
router.put("/profile", async (req, res) => {
  try {
    const shopDomain = res.locals.shopify.session.shop;
    const { username, password, phone, avatar_url } = req.body;

    const updates = [];
    const values = [];
    let paramCount = 1;

    // Fetch current user data to get the ID
    const currentUserResult = await db.query(
      "SELECT id FROM users WHERE shop_domain = $1 AND user_type = 'store_owner'",
      [shopDomain]
    );

    if (currentUserResult.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        success: false,
        error: "Store owner user not found for this shop.",
      });
    }

    const userId = currentUserResult.rows[0].id;

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

    if (avatar_url) {
      updates.push(`avatar_url = $${paramCount}`);
      values.push(avatar_url);
      paramCount++;
    }

    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      updates.push(`password_hash = $${paramCount}`);
      values.push(hashedPassword);
      paramCount++;
    }

    if (updates.length === 0) {
      return res.status(400).json({
        status: 400,
        success: false,
        error: "No fields to update",
      });
    }

    values.push(userId); // userId for the WHERE clause

    const query = `
      UPDATE users 
      SET ${updates.join(", ")}, updated_at = NOW()
      WHERE id = $${paramCount}
      RETURNING id, username, email, user_type, phone, avatar_url, shop_domain
    `;

    const result = await db.query(query, values);

    res.status(200).json({
      status: 200,
      success: true,
      message: "Profile updated successfully",
      user: result.rows[0],
    });
  } catch (error) {
    console.error("❌ Update settings profile error:", error);
    res.status(500).json({
      status: 500,
      success: false,
      error: "Failed to update profile",
      details: error.message,
    });
  }
});

export default router; 