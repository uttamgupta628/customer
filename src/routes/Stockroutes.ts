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
} from "../controllers/Stockcontroller";

const router = Router();

router.get("/stats", getStockStats);

router.get("/export-csv", exportStockCSV);

router.get("/activity-log", getActivityLog);

router.post("/restock-all-oos", restockAllOOS);

router.get("/", getStockList);

router.patch("/:id/quantity", adjustQuantity);

router.patch("/:id/fast-moving", toggleFastMoving);

router.patch("/:id/featured", toggleFeatured);

router.patch("/:id/alert", setAlertThreshold);

export default router;