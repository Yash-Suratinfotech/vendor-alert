// web/routes/settings.js
import express from "express";
import db from "../db.js";
import bcrypt from "bcrypt";
import dataSyncService from "../services/dataSyncService.js";

const router = express.Router();

// GET /api/settings/profile - Get store owner profile
router.get("/profile", async (req, res) => {
  try {
    const shopDomain = res.locals.shopify.session.shop;

    const userResult = await db.query(
      `SELECT id, username, email, user_type, phone, avatar_url, notify_mode, notify_value,
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
    const { username, password, phone, avatar_url, notify_mode, notify_value } =
      req.body;

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

    if (notify_mode) {
      updates.push(`notify_mode = $${paramCount}`);
      values.push(notify_mode);
      paramCount++;
    }

    if (notify_value) {
      updates.push(`notify_value = $${paramCount}`);
      values.push(notify_value);
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
      RETURNING id, username, email, user_type, phone, avatar_url, shop_domain, notify_mode, notify_value
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

// PUT /api/settings/manual-sync/:type - Manual sync updated for order-based approach
router.post("/manual-sync/:type", async (req, res) => {
  try {
    const shopDomain = res.locals.shopify.session.shop;
    const { type } = req.params;
    if (!shop) {
      return res
        .status(400)
        .json({ status: 400, error: "Shop domain required" });
    }

    let result;

    switch (type) {
      case "orders":
        // Only sync orders (which creates products and vendors automatically)
        result = await dataSyncService.syncAllOrders(session);
        break;
      default:
        return res.status(400).json({
          status: 400,
          error: "Invalid sync type. Use 'orders' or 'full'",
        });
    }

    res.status(200).json({
      success: true,
      message: `Manual ${type} sync completed`,
      result,
    });
  } catch (error) {
    console.error(`❌ Manual sync error:`, error);
    res.status(500).json({
      status: 500,
      error: "Manual sync failed",
      details: error.message,
    });
  }
});

// GET /api/settings/status - Sync status
router.get("/status", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const shopDomain = session.shop;

    const result = await db.query(
      `
      SELECT 
        initial_sync_completed,
        (SELECT COUNT(*) FROM products WHERE shop_domain = $1) as product_count,
        (SELECT COUNT(*) FROM orders WHERE shop_domain = $1) as order_count,
        (SELECT COUNT(*) FROM vendors WHERE shop_domain = $1) as vendor_count,
        (SELECT COUNT(*) FROM sync_logs WHERE shop_domain = $1 AND status = 'running') as running_syncs
      FROM users WHERE shop_domain = $1
    `,
      [shopDomain]
    );

    const stats = result.rows[0] || {};

    res.json({
      success: true,
      initialSyncCompleted: stats.initial_sync_completed || false,
      counts: {
        products: parseInt(stats.product_count) || 0,
        orders: parseInt(stats.order_count) || 0,
        vendors: parseInt(stats.vendor_count) || 0,
      },
      hasRunningSyncs: parseInt(stats.running_syncs) > 0,
    });
  } catch (error) {
    console.error("❌ Error fetching sync status:", error);
    res.status(500).json({ status: 500, error: "Failed to fetch sync status" });
  }
});

// GET /api/settings/token - Get store owner profile
router.get("/token", async (req, res) => {
  try {
    const shopDomain = res.locals.shopify.session.shop;

    const userResult = await db.query(
      `SELECT access_token FROM users WHERE shop_domain = $1 AND user_type = 'store_owner'`,
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

    res.status(200).json({
      status: 200,
      success: true,
      token: user.access_token,
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

export default router;
