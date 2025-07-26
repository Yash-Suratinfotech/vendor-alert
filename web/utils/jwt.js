// web/utils/jwt.js
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "1234567890";
const JWT_EXPIRE = "24h";

export const generateToken = (userId, email, userType) => {
  return jwt.sign(
    {
      userId,
      email,
      userType,
      iat: Math.floor(Date.now() / 1000),
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRE }
  );
};

export const verifyToken = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      throw new Error("Token has expired. Please login again.");
    } else if (error.name === "JsonWebTokenError") {
      throw new Error("Invalid token. Please login again.");
    }
    throw error;
  }
};

export const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

export const generateResetToken = () => {
  const crypto = require("crypto");
  return crypto.randomBytes(32).toString("hex");
};
