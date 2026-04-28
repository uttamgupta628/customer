import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import Admin from "../models/Admin";
import { sendSuccess, sendError } from "../utils/response";

const JWT_SECRET = process.env.JWT_SECRET ?? "changeme_secret";
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN ?? "7d";

export const ensureDefaultAdmin = async (): Promise<void> => {
  const count = await Admin.countDocuments();
  if (count === 0) {
    await Admin.create({ email: "admin@admin.com", password: "admin1234" });
    console.log(`[Admin] Default admin created → admin@admin.com`);
    console.log(`[Admin] ⚠️  Change credentials immediately via the Settings page.`);
  }
};

// ─── LOGIN ─────────────────────────────────────────────────────────────────────

export const loginAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email, password } = req.body as { email?: string; password?: string };

    if (!email || !password) {
      sendError(res, "Email and password are required", undefined, 400);
      return;
    }

    const admin = await Admin.findOne({ email: email.toLowerCase().trim() });
    if (!admin || !(await admin.comparePassword(password))) {
      sendError(res, "Invalid email or password", undefined, 401);
      return;
    }

    const token = jwt.sign({ id: admin._id, email: admin.email }, JWT_SECRET, {
      expiresIn: JWT_EXPIRES,
    } as jwt.SignOptions);

    sendSuccess(res, "Login successful", {
      token,
      admin: { email: admin.email },
    });
  } catch (error) {
    next(error);
  }
};

// ─── GET PROFILE ───────────────────────────────────────────────────────────────
export const getAdminProfile = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const admin = await Admin.findById((req as Request & { adminId: string }).adminId).select("-password");
    if (!admin) {
      sendError(res, "Admin not found", undefined, 404);
      return;
    }
    sendSuccess(res, "Profile fetched", { email: admin.email });
  } catch (error) {
    next(error);
  }
};

// ─── CHANGE EMAIL ──────────────────────────────────────────────────────────────
export const changeEmail = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { newEmail, password } = req.body as { newEmail?: string; password?: string };

    if (!newEmail || !password) {
      sendError(res, "New email and current password are required", undefined, 400);
      return;
    }

    const admin = await Admin.findById((req as Request & { adminId: string }).adminId);
    if (!admin) {
      sendError(res, "Admin not found", undefined, 404);
      return;
    }

    if (!(await admin.comparePassword(password))) {
      sendError(res, "Current password is incorrect", undefined, 401);
      return;
    }

    const exists = await Admin.findOne({ email: newEmail.toLowerCase().trim() });
    if (exists && String(exists._id) !== String(admin._id)) {
      sendError(res, "Email is already in use", undefined, 409);
      return;
    }

    admin.email = newEmail.toLowerCase().trim();
    await admin.save();

    const token = jwt.sign({ id: admin._id, email: admin.email }, JWT_SECRET, {
      expiresIn: JWT_EXPIRES,
    } as jwt.SignOptions);

    sendSuccess(res, "Email updated successfully", {
      token,
      admin: { email: admin.email },
    });
  } catch (error) {
    next(error);
  }
};

// ─── CHANGE PASSWORD ───────────────────────────────────────────────────────────
export const changePassword = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { oldPassword, newPassword, confirmPassword } = req.body as {
      oldPassword?: string;
      newPassword?: string;
      confirmPassword?: string;
    };

    if (!oldPassword || !newPassword || !confirmPassword) {
      sendError(res, "All password fields are required", undefined, 400);
      return;
    }

    if (newPassword !== confirmPassword) {
      sendError(res, "New passwords do not match", undefined, 400);
      return;
    }

    if (newPassword.length < 8) {
      sendError(res, "New password must be at least 8 characters", undefined, 400);
      return;
    }

    const admin = await Admin.findById((req as Request & { adminId: string }).adminId);
    if (!admin) {
      sendError(res, "Admin not found", undefined, 404);
      return;
    }

    if (!(await admin.comparePassword(oldPassword))) {
      sendError(res, "Current password is incorrect", undefined, 401);
      return;
    }

    admin.password = newPassword;
    await admin.save();

    sendSuccess(res, "Password updated successfully");
  } catch (error) {
    next(error);
  }
};