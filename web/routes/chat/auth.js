// web/routes/chat/auth.js
import express from "express";
import bcrypt from "bcrypt";
import db from "../../db.js";
import {
  generateToken,
  generateOTP,
  generateResetToken,
} from "../../utils/jwt.js";
import {
  sendVerificationEmail,
  sendPasswordResetEmail,
} from "../../services/emailService.js";

const router = express.Router();

// ============== REGISTER ==============
router.post("/register", async (req, res) => {
  const client = await db.getClient();

  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: "Email, password, and user type are required",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: "Password must be at least 6 characters long",
      });
    }

    await client.query("BEGIN");

    // Check if user already exists
    const existingUser = await client.query(
      "SELECT id FROM users WHERE email = $1",
      [email.toLowerCase()]
    );

    if (existingUser.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        status: 409,
        success: false,
        error: "Email already registered",
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Generate OTP
    const otp = generateOTP();
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Create user
    const username = email.split("@")[0].toLowerCase();
    const userResult = await client.query(
      `INSERT INTO users (
        username, email, password_hash, user_type, 
        otp, otp_expires_at, is_active, is_verified
      ) VALUES ($1, $2, $3, 'vendor', $4, $5, true, true)
      RETURNING id, username, email, user_type`,
      [username, email.toLowerCase(), hashedPassword, otp, otpExpiresAt]
    );

    const user = userResult.rows[0];

    // const vendorCheck = await client.query(
    //   "SELECT * FROM vendors WHERE email = $1",
    //   [email.toLowerCase()]
    // );

    // if (vendorCheck.rows.length === 0) {
    //   await client.query("ROLLBACK");
    //   return res.status(404).json({
    //     success: false,
    //     error:
    //       "Vendor not found. Please contact store owner to add you as a vendor.",
    //   });
    // }

    await client.query("COMMIT");

    // Send verification email
    try {
      await sendVerificationEmail(email, otp);
    } catch (emailError) {
      console.error("❌ Email sending failed:", emailError);
    }

    // Generate token (for by pass email)
    const token = generateToken(user.id, user.email, user.user_type);

    // Update user as verified (for by pass email)
    await db.query(
      `UPDATE users 
       SET is_verified = true, 
           otp = NULL, 
           otp_expires_at = NULL, 
           last_active = NOW(), 
           access_token = $2 
       WHERE id = $1`,
      [user.id, token]
    );

    res.status(201).json({
      status: 201,
      success: true,
      // message:
      //   "Registration successful. Please check your email for OTP verification.",
      message: "Registration successful.",
      user: {
        id: user.id,
        email: user.email,
        userType: "vendor",
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Registration error:", error);
    res.status(500).json({
      success: false,
      error: "Registration failed",
      details: error.message,
    });
  } finally {
    client.release();
  }
});

// ============== VERIFY OTP ==============
router.post("/verify-otp", async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        error: "Email and OTP are required",
      });
    }

    // Get user with OTP
    const userResult = await db.query(
      `SELECT id, email, user_type, otp, otp_expires_at, is_verified 
       FROM users WHERE email = $1`,
      [email.toLowerCase()]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        success: false,
        error: "User not found",
      });
    }

    const user = userResult.rows[0];

    // Check if already verified
    if (user.is_verified) {
      return res.status(400).json({
        success: false,
        error: "Email already verified",
      });
    }

    // Check OTP
    if (user.otp !== otp) {
      return res.status(400).json({
        success: false,
        error: "Invalid OTP",
      });
    }

    // Check OTP expiry
    if (new Date() > new Date(user.otp_expires_at)) {
      return res.status(400).json({
        success: false,
        error: "OTP has expired. Please request a new one.",
      });
    }

    // Generate token
    const token = generateToken(user.id, user.email, user.user_type);

    // Update user as verified
    await db.query(
      `UPDATE users 
      SET is_verified = true, 
          otp = NULL, 
          otp_expires_at = NULL, 
          last_active = NOW(), 
          access_token = $2 
      WHERE id = $1`,
      [user.id, token]
    );

    res.status(200).json({
      success: true,
      message: "Email verified successfully",
    });
  } catch (error) {
    console.error("❌ OTP verification error:", error);
    res.status(500).json({
      success: false,
      error: "OTP verification failed",
      details: error.message,
    });
  }
});

// ============== RESEND OTP ==============
router.post("/resend-otp", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email is required",
      });
    }

    // Get user
    const userResult = await db.query(
      "SELECT id, email, is_verified FROM users WHERE email = $1",
      [email.toLowerCase()]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        status: 404,
        success: false,
        error: "User not found",
      });
    }

    const user = userResult.rows[0];

    if (user.is_verified) {
      return res.status(400).json({
        success: false,
        error: "Email already verified",
      });
    }

    // Generate new OTP
    const otp = generateOTP();
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    // Update OTP
    await db.query(
      "UPDATE users SET otp = $1, otp_expires_at = $2 WHERE id = $3",
      [otp, otpExpiresAt, user.id]
    );

    // Send email
    await sendVerificationEmail(user.email, otp);

    res.status(200).json({
      success: true,
      message: "OTP sent successfully",
    });
  } catch (error) {
    console.error("❌ Resend OTP error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to resend OTP",
      details: error.message,
    });
  }
});

// ============== LOGIN ==============
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: "Email and password are required",
      });
    }

    // Get user
    const userResult = await db.query(
      `SELECT id, email, password_hash, user_type, is_active, is_verified, 
              login_attempts, locked_until, shop_domain
       FROM users WHERE email = $1`,
      [email.toLowerCase()]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        status: 401,
        success: false,
        error: "Invalid email or password",
      });
    }

    const user = userResult.rows[0];

    // Check if account is locked
    if (user.locked_until && new Date() < new Date(user.locked_until)) {
      return res.status(401).json({
        status: 401,
        status: 401,
        success: false,
        error: "Account is temporarily locked. Please try again later.",
      });
    }

    // Check if account is active
    if (!user.is_active) {
      return res.status(401).json({
        status: 401,
        status: 401,
        success: false,
        error: "Account is deactivated. Please contact support.",
      });
    }

    // Check if email is verified
    if (!user.is_verified) {
      return res.status(401).json({
        status: 401,
        status: 401,
        success: false,
        error: "Please verify your email first",
        requiresVerification: true,
      });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);

    if (!isPasswordValid) {
      // Increment login attempts
      const attempts = user.login_attempts + 1;
      let lockedUntil = null;

      if (attempts >= 5) {
        lockedUntil = new Date(Date.now() + 30 * 60 * 1000); // Lock for 30 minutes
      }

      await db.query(
        "UPDATE users SET login_attempts = $1, locked_until = $2 WHERE id = $3",
        [attempts, lockedUntil, user.id]
      );

      return res.status(401).json({
        status: 401,
        status: 401,
        success: false,
        error: "Invalid email or password",
        attemptsRemaining: Math.max(0, 5 - attempts),
      });
    }

    // Reset login attempts and update last login
    await db.query(
      `UPDATE users 
       SET login_attempts = 0, locked_until = NULL, last_login = NOW(), last_active = NOW() 
       WHERE id = $1`,
      [user.id]
    );

    // Generate token
    const token = generateToken(user.id, user.email, user.user_type);

    res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      user: user,
    });
  } catch (error) {
    console.error("❌ Login error:", error);
    res.status(500).json({
      success: false,
      error: "Login failed",
      details: error.message,
    });
  }
});

// ============== FORGOT PASSWORD ==============
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email is required",
      });
    }

    // Get user
    const userResult = await db.query(
      "SELECT id, email FROM users WHERE email = $1",
      [email.toLowerCase()]
    );

    if (userResult.rows.length === 0) {
      // Don't reveal if email exists or not
      return res.status(200).json({
        success: true,
        message: "If the email exists, a password reset link has been sent.",
      });
    }

    const user = userResult.rows[0];

    // Generate reset token
    const resetToken = generateResetToken();
    const resetTokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Save reset token
    await db.query(
      "UPDATE users SET reset_token = $1, reset_token_expires_at = $2 WHERE id = $3",
      [resetToken, resetTokenExpiresAt, user.id]
    );

    // Send email
    await sendPasswordResetEmail(user.email, resetToken);

    res.status(200).json({
      success: true,
      message: "If the email exists, a password reset link has been sent.",
    });
  } catch (error) {
    console.error("❌ Forgot password error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to process password reset request",
      details: error.message,
    });
  }
});

// ============== RESET PASSWORD ==============
router.post("/reset-password", async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({
        success: false,
        error: "Token and new password are required",
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        error: "Password must be at least 6 characters long",
      });
    }

    // Get user with reset token
    const userResult = await db.query(
      `SELECT id, email, reset_token_expires_at 
       FROM users WHERE reset_token = $1`,
      [token]
    );

    if (userResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Invalid or expired reset token",
      });
    }

    const user = userResult.rows[0];

    // Check token expiry
    if (new Date() > new Date(user.reset_token_expires_at)) {
      return res.status(400).json({
        success: false,
        error: "Reset token has expired. Please request a new one.",
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password and clear reset token
    await db.query(
      `UPDATE users 
       SET password_hash = $1, reset_token = NULL, reset_token_expires_at = NULL, 
           login_attempts = 0, locked_until = NULL
       WHERE id = $2`,
      [hashedPassword, user.id]
    );

    res.status(200).json({
      success: true,
      message:
        "Password reset successful. You can now login with your new password.",
    });
  } catch (error) {
    console.error("❌ Reset password error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to reset password",
      details: error.message,
    });
  }
});

// ============== VERIFY USER ==============
router.post("/verify-user", async (req, res) => {
  try {
    const { token } = req.body;

    // Get user profile
    const userResult = await db.query(
      `SELECT id, username, email, user_type, phone, avatar_url, 
            created_at, last_login, is_active, is_verified, shop_domain
     FROM users WHERE access_token = $1`,
      [token]
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
      token
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
export default router;
