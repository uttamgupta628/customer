// routes/Orderroutes.ts
import { Router } from "express";
import {
  placeOrder,
  getMyOrders,
  getOrderById,
  cancelOrder,
  updateOrderStatus,
  getAllOrders,
} from "../controllers/Ordercontroller";
import { protect } from "../middlewares/authMiddleware";
import { adminAuth } from "../middlewares/adminAuth";

const router = Router();

// Customer routes (User JWT)
router.post("/", protect, placeOrder);
router.get("/my", protect, getMyOrders);
router.get("/:id", protect, getOrderById);
router.patch("/:id/cancel", protect, cancelOrder);

// Admin routes (Admin JWT) - Use adminAuth instead of protect
router.get("/", adminAuth, getAllOrders); // ✅ Changed
router.patch("/:id/status", adminAuth, updateOrderStatus); // ✅ Changed

export default router;
