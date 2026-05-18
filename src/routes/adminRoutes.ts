import { Router } from "express";
import {
  loginAdmin,
  getAdminProfile,
  changeEmail,
  changePassword,
  getCustomers,
  getCustomerById,
  approveCustomer,
  rejectCustomer,
  activateCustomer,
  deactivateCustomer,
  deleteCustomer,
  sendManualPush,
  testFCMNotification,
  uploadQRCode,
  getQRCode,
  deleteQRCode,
} from "../controllers/Admincontroller";
import { adminAuth } from "../middlewares/adminAuth";
import { uploadSingleImage } from "../middlewares/upload";
import User from "../models/Users";

const router = Router();

// ── Public ────────────────────────────────────────────────────────────────────
router.post("/login", loginAdmin);

// ── Protected (Admin only) ────────────────────────────────────────────────────
router.get("/profile", adminAuth, getAdminProfile);
router.patch("/email", adminAuth, changeEmail);
router.patch("/password", adminAuth, changePassword);

// ── QR Code Management ────────────────────────────────────────────────────────
router.post("/qr-code", adminAuth, uploadSingleImage, uploadQRCode);
router.get("/qr-code", getQRCode);  
router.delete("/qr-code", adminAuth, deleteQRCode);

// ── Customer Management ───────────────────────────────────────────────────────
router.get("/customers", adminAuth, getCustomers);
router.get("/customers/:id", adminAuth, getCustomerById);
router.patch("/customers/:id/approve", adminAuth, approveCustomer);
router.patch("/customers/:id/reject", adminAuth, rejectCustomer);
router.patch("/customers/:id/activate", adminAuth, activateCustomer);
router.patch("/customers/:id/deactivate", adminAuth, deactivateCustomer);
router.delete("/customers/:id", adminAuth, deleteCustomer);

// ── Push Notification Routes ──────────────────────────────────────────────────
router.post("/send-push", adminAuth, sendManualPush);
router.post("/test-fcm", adminAuth, testFCMNotification);

// ── FCM Token Management (for debugging) ──────────────────────────────────────
router.get("/customers/:id/fcm-tokens", adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id).select(
      "fcmTokens pushTokens phone profile.contactName",
    );

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    res.json({
      success: true,
      data: {
        userId: user._id,
        phone: user.phone,
        name: user.profile?.contactName,
        fcmTokens: user.fcmTokens || [],
        pushTokens: user.pushTokens || [],
        totalDevices: user.fcmTokens?.length || 0,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ── Clear FCM Tokens (for debugging) ──────────────────────────────────────────
router.delete("/customers/:id/fcm-tokens", adminAuth, async (req, res) => {
  try {
    const { id } = req.params;

    await User.findByIdAndUpdate(id, {
      $set: { fcmTokens: [], pushTokens: [] },
    });

    res.json({ success: true, message: "All FCM tokens cleared" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

export default router;
