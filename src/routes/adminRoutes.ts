import { Router } from "express";
import {
  loginAdmin,
  getAdminProfile,
  changeEmail,
  changePassword,
} from "../controllers/Admincontroller";
import { authMiddleware } from "../middlewares/authMiddleware";

const router = Router();

router.post("/login",       loginAdmin);
router.get("/profile",      authMiddleware, getAdminProfile);
router.patch("/email",      authMiddleware, changeEmail);
router.patch("/password",   authMiddleware, changePassword);

export default router;