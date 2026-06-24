import { Router } from "express";
import {
  checkEmail,
  sendOtpHandler,
  verifyOtpHandler,
  googleLoginHandler,
  completeProfile,
  getMe,
  updateProfile,
  savePushToken, // ← legacy Expo push token
  saveFCMToken, // ← new FCM token handler
  removeFCMToken, // ← new FCM token removal
  getFCMTokens, // ← new get FCM tokens
} from "../controllers/authController";
import { protect } from "../middlewares/authMiddleware";

const router = Router();

// ── Public ────────────────────────────────────────────────────────────────────
router.get("/check-email", checkEmail); // GET  /auth/check-email?email=user@example.com
router.post("/send-otp", sendOtpHandler); // POST /auth/send-otp
router.post("/verify-otp", verifyOtpHandler); // POST /auth/verify-otp
router.post("/google", googleLoginHandler); // POST /auth/google

// ── Protected ─────────────────────────────────────────────────────────────────
router.post("/signup/profile", protect, completeProfile); // POST /auth/signup/profile  (first-time)
router.get("/me", protect, getMe); // GET  /auth/me
router.put("/profile", protect, updateProfile); // PUT  /auth/profile

// ── Push Notification Tokens ──────────────────────────────────────────────────
// Legacy Expo push token (for backward compatibility)
router.post("/push-token", protect, savePushToken); // POST /auth/push-token

// Firebase FCM token management (new)
router.post("/fcm-token", protect, saveFCMToken); // POST /auth/fcm-token
router.delete("/fcm-token", protect, removeFCMToken); // DELETE /auth/fcm-token
router.get("/fcm-tokens", protect, getFCMTokens); // GET /auth/fcm-tokens

export default router;
