// web/middleware/auth.js
import { verifyToken } from '../utils/jwt.js';
import db from '../db.js';

export const authenticateUser = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.headers?.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'No token provided'
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify token
    const decoded = verifyToken(token);

    // Get user from database
    const userResult = await db.query(
      'SELECT id, email, user_type, is_active, is_verified FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'User not found'
      });
    }

    const user = userResult.rows[0];

    // Check if user is active
    if (!user.is_active) {
      return res.status(401).json({
        success: false,
        error: 'Account is deactivated'
      });
    }

    // Check if user is verified
    if (!user.is_verified) {
      return res.status(401).json({
        success: false,
        error: 'Please verify your email first'
      });
    }

    // Attach user to request
    req.user = user;
    next();
  } catch (error) {
    console.error('❌ Authentication error:', error);
    return res.status(401).json({
      success: false,
      error: error.message || 'Invalid or expired token'
    });
  }
};

// Optional: Role-based middleware
export const requireVendor = (req, res, next) => {
  if (req.user.user_type !== 'vendor') {
    return res.status(403).json({
      success: false,
      error: 'Access denied. Vendor only.'
    });
  }
  next();
};

export const requireStoreOwner = (req, res, next) => {
  if (req.user.user_type !== 'store_owner') {
    return res.status(403).json({
      success: false,
      error: 'Access denied. Store owner only.'
    });
  }
  next();
};