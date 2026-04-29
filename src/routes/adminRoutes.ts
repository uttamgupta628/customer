import { Router } from "express";
import {
  loginAdmin,
  getAdminProfile,
  changeEmail,
  changePassword,
} from "../controllers/Admincontroller";
import { protect } from "../middlewares/authMiddleware";

const router = Router();

router.post("/login", loginAdmin);
router.get("/profile", protect, getAdminProfile);
router.patch("/email", protect, changeEmail);
router.patch("/password", protect, changePassword);

export default router;