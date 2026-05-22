import { Router } from "express";
import {
  getStockStats,
  getStockList,
  exportStockCSV,
  getActivityLog,
  restockAllOOS,
  adjustQuantity,
  toggleFastMoving,
  toggleFeatured,
  setAlertThreshold,
  toggleOrderLimits,
  notifyMeWhenInStock,
  getNotifyStatus,
  unsubscribeNotify,
} from "../controllers/Stockcontroller";
import { protect } from "../middlewares/authMiddleware";

const router = Router();

// ── Stats & Reports ────────────────────────────────────────────
router.get("/stats", getStockStats);
router.get("/export-csv", exportStockCSV);
router.get("/activity-log", getActivityLog);

// ── Notify Me (must be BEFORE /:id routes) ────────────────────
router.post("/notify-me", protect, notifyMeWhenInStock);
router.get("/notify-status/:productId", protect, getNotifyStatus);
router.delete("/notify-me/:productId", protect, unsubscribeNotify);

// ── Bulk Actions ───────────────────────────────────────────────
router.post("/restock-all-oos", restockAllOOS);

// ── Product-Specific Actions (these use :id) ──────────────────
router.patch("/:id/quantity", adjustQuantity);
router.patch("/:id/fast-moving", toggleFastMoving);
router.patch("/:id/featured", toggleFeatured);
router.patch("/:id/alert", setAlertThreshold);
router.patch("/:id/toggle-order-limits", toggleOrderLimits);

// ── List (must be LAST because it's the most general route) ────
router.get("/", getStockList);

export default router;
