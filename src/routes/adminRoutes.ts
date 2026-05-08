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
router.get("/customers/:id", adminAuth, getCustomerById); // GET single customer
router.patch("/customers/:id/approve", adminAuth, approveCustomer); // Approve
router.patch("/customers/:id/reject", adminAuth, rejectCustomer); // Reject
router.patch("/customers/:id/activate", adminAuth, activateCustomer); // Activate
router.patch("/customers/:id/deactivate", adminAuth, deactivateCustomer); // Deactivate
router.delete("/customers/:id", adminAuth, deleteCustomer); // Delete

export default router;
