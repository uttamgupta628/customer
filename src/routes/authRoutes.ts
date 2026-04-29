import { Router } from "express";
import {
  checkPhone,
  sendOtpHandler,
  verifyOtpHandler,
  completeProfile,
  getMe,
  updateProfile,          // ← new
} from "../controllers/authController";
import { protect } from "../middlewares/authMiddleware";
 
const router = Router();
 
// ── Public ────────────────────────────────────────────────────────────────────
router.get("/check-phone", checkPhone);        // GET  /auth/check-phone?phone=9876543210
router.post("/send-otp",   sendOtpHandler);    // POST /auth/send-otp
router.post("/verify-otp", verifyOtpHandler);  // POST /auth/verify-otp
 
// ── Protected ─────────────────────────────────────────────────────────────────
router.post("/signup/profile", protect, completeProfile); // POST /auth/signup/profile  (first-time)
router.get("/me",              protect, getMe);            // GET  /auth/me
router.put("/profile", protect, updateProfile);    // PUT  /auth/profile  ← new
 
export default router;
