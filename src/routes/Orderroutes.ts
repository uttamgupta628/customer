import { Router } from "express";
import {
  placeOrder,
  getMyOrders,
  getOrderById,
  cancelOrder,
  updateOrderStatus,
  getAllOrders,
} from "../controllers/Ordercontroller";
import { authenticate, requireAdmin } from "../middlewares/authMiddleware"; // adjust path to your auth middleware

const router = Router();

// ── Customer routes (JWT required) ───────────────────────────────────────────
router.post("/", authenticate, placeOrder);              // Place a new order
router.get("/my", authenticate, getMyOrders);            // My orders list
router.get("/:id", authenticate, getOrderById);          // Single order detail
router.patch("/:id/cancel", authenticate, cancelOrder);  // Cancel my order

// ── Admin routes ──────────────────────────────────────────────────────────────
router.get("/", authenticate, requireAdmin, getAllOrders);                     // All orders
router.patch("/:id/status", authenticate, requireAdmin, updateOrderStatus);   // Update status

export default router;