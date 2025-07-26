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
              created_at, last_login, is_active, is_verified, shop_domain
       FROM users WHERE id = $1`,
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        success: false,
        error: "User not found",
      });
    }

    const user = userResult.rows[0];

    res.status(200).json({
      status: 200,
      success: true,
      user,
    });
  } catch (error) {
    console.error("❌ Get profile error:", error);
    res.status(500).json({
      status: 500,
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
        status: 400,
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
      status: 200,
      success: true,
      message: "Profile updated successfully",
      user: result.rows[0],
    });
  } catch (error) {
    console.error("❌ Update profile error:", error);
    res.status(500).json({
      status: 500,
      success: false,
      error: "Failed to update profile",
      details: error.message,
    });
  }
});

export default router;
