import express from "express";
import {
  checkPhone,
  sendOtpHandler,
  verifyOtpHandler,
  completeProfile,
  getMe,
} from "../controllers/authController";
import { protect } from "../middlewares/authMiddleware";

const router = express.Router();

// ── Public routes ─────────────────────────────────────────────────────────────
router.get("/check-phone", checkPhone); // GET  /auth/check-phone?phone=9876543210
router.post("/send-otp", sendOtpHandler); // POST /auth/send-otp
router.post("/verify-otp", verifyOtpHandler); // POST /auth/verify-otp

// ── Protected routes (need JWT) ───────────────────────────────────────────────
router.post("/signup/profile", protect, completeProfile); // POST /auth/signup/profile
router.get("/me", protect, getMe); // GET  /auth/me

export default router;
