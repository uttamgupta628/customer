import { Router } from "express";
import {
  loginAdmin,
  getAdminProfile,
  changeEmail,
  changePassword,
  getCustomers,
  deactivateCustomer,
} from "../controllers/Admincontroller";
import { adminAuth } from "../middlewares/adminAuth";

const router = Router();

// ── Public ────────────────────────────────────────────────────────────────────
router.post("/login", loginAdmin);

// ── Protected (Admin only) ────────────────────────────────────────────────────
router.get("/profile", adminAuth, getAdminProfile);
router.patch("/email", adminAuth, changeEmail);
router.patch("/password", adminAuth, changePassword);

// ── Customer Management ───────────────────────────────────────────────────────
router.get("/customers", adminAuth, getCustomers);
router.patch("/customers/:id/deactivate", adminAuth, deactivateCustomer);

export default router;
