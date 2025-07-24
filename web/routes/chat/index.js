// web/routes/chat/index.js
import express from "express";

import { authenticateUser } from "../../middleware/auth.js";

import authRouters from "./auth.js";
import profileRouters from "./profile.js";
import chatRouters from "./chat.js";

const router = express.Router();

// Auth routes (no authentication required)
router.use("/auth", authRouters);

// Protected routes (authentication required)
router.use("/", authenticateUser, profileRouters);
router.use("/", authenticateUser, chatRouters);

export default router;