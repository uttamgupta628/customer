import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import Admin from "../models/Admin";
import { sendSuccess, sendError } from "../utils/response";
import User from "../models/Users";
import { sendPushNotification } from "../utils/pushNotification";

const JWT_SECRET = process.env.JWT_SECRET ?? "changeme_secret";
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN ?? "7d";

export const ensureDefaultAdmin = async (): Promise<void> => {
  const count = await Admin.countDocuments();
  if (count === 0) {
    await Admin.create({ email: "admin@admin.com", password: "admin1234" });
    console.log(`[Admin] Default admin created → admin@admin.com`);
    console.log(
      `[Admin] ⚠️  Change credentials immediately via the Settings page.`,
    );
  }
};

// ─── LOGIN ─────────────────────────────────────────────────────────────────────

export const loginAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { email, password } = req.body as {
      email?: string;
      password?: string;
    };

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
  next: NextFunction,
): Promise<void> => {
  try {
    const admin = await Admin.findById(
      (req as Request & { adminId: string }).adminId,
    ).select("-password");
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
  next: NextFunction,
): Promise<void> => {
  try {
    const { newEmail, password } = req.body as {
      newEmail?: string;
      password?: string;
    };

    if (!newEmail || !password) {
      sendError(
        res,
        "New email and current password are required",
        undefined,
        400,
      );
      return;
    }

    const admin = await Admin.findById(
      (req as Request & { adminId: string }).adminId,
    );
    if (!admin) {
      sendError(res, "Admin not found", undefined, 404);
      return;
    }

    if (!(await admin.comparePassword(password))) {
      sendError(res, "Current password is incorrect", undefined, 401);
      return;
    }

    const exists = await Admin.findOne({
      email: newEmail.toLowerCase().trim(),
    });
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
  next: NextFunction,
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
      sendError(
        res,
        "New password must be at least 8 characters",
        undefined,
        400,
      );
      return;
    }

    const admin = await Admin.findById(
      (req as Request & { adminId: string }).adminId,
    );
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
// ─── GET ALL CUSTOMERS ────────────────────────────────────────────────────────
// GET /api/admin/customers
export const getCustomers = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { page = "1", limit = "50", search } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10));
    const limitNum = Math.min(200, parseInt(limit as string, 10));
    const skip = (pageNum - 1) * limitNum;

    // Filter: only customers (not admins)
    const filter: Record<string, unknown> = { role: { $ne: "admin" } };

    if (search && search !== "") {
      const searchStr = search as string;
      filter.$or = [
        { "profile.contactName": { $regex: searchStr, $options: "i" } },
        { phone: { $regex: searchStr, $options: "i" } },
        { "profile.city": { $regex: searchStr, $options: "i" } },
        { "profile.state": { $regex: searchStr, $options: "i" } },
        { "profile.gstNumber": { $regex: searchStr, $options: "i" } },
      ];
    }

    const [customers, total] = await Promise.all([
      User.find(filter)
        .select("-__v")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      User.countDocuments(filter),
    ]);

    sendSuccess(res, "Customers fetched successfully", {
      customers,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    next(error);
  }
};

// ─── APPROVE CUSTOMER ─────────────────────────────────────────────────────────
// PATCH /api/admin/customers/:id/approve
export const approveCustomer = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;

    const user = await User.findById(id);
    if (!user) {
      sendError(res, "Customer not found", undefined, 404);
      return;
    }

    if (user.approvalStatus !== "pending" && user.approvalStatus !== "manual") {
      sendError(
        res,
        `Cannot approve customer with status: ${user.approvalStatus}`,
        undefined,
        400,
      );
      return;
    }

    user.approvalStatus = "approved";
    user.isActive = true;
    await user.save();

    // ✅ Send push notification
    const customerName = user.profile?.contactName || "User";
    sendPushNotification(
      user._id.toString(),
      "🎉 Account Approved!",
      `Hi ${customerName}, your account has been approved. You can now place orders.`,
      {
        type: "approval_status",
        status: "approved",
        screen: "/(tabs)/home",
      },
    ).catch((err) => console.error("Push notification failed:", err));

    sendSuccess(res, "Customer approved successfully", {
      _id: user._id,
      phone: user.phone,
      approvalStatus: user.approvalStatus,
      isActive: user.isActive,
      profile: {
        contactName: user.profile?.contactName,
        phone: user.phone,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ─── REJECT CUSTOMER ──────────────────────────────────────────────────────────
// PATCH /api/admin/customers/:id/reject
export const rejectCustomer = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const user = await User.findById(id);
    if (!user) {
      sendError(res, "Customer not found", undefined, 404);
      return;
    }

    if (user.approvalStatus !== "pending" && user.approvalStatus !== "manual") {
      sendError(
        res,
        `Cannot reject customer with status: ${user.approvalStatus}`,
        undefined,
        400,
      );
      return;
    }

    user.approvalStatus = "rejected";
    user.isActive = false;
    await user.save();

    // ✅ Send push notification
    const customerName = user.profile?.contactName || "User";
    sendPushNotification(
      user._id.toString(),
      "❌ Account Not Approved",
      `Hi ${customerName}, your account was not approved. Please contact support for more details.`,
      {
        type: "approval_status",
        status: "rejected",
        screen: "/(tabs)/account",
      },
    ).catch((err) => console.error("Push notification failed:", err));

    sendSuccess(res, "Customer rejected successfully", {
      _id: user._id,
      phone: user.phone,
      approvalStatus: user.approvalStatus,
      isActive: user.isActive,
      reason: reason || "Rejected by admin",
    });
  } catch (error) {
    next(error);
  }
};

// ─── ACTIVATE CUSTOMER ────────────────────────────────────────────────────────
// PATCH /api/admin/customers/:id/activate
export const activateCustomer = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;

    const user = await User.findById(id);
    if (!user) {
      sendError(res, "Customer not found", undefined, 404);
      return;
    }

    user.isActive = true;
    await user.save();

    sendSuccess(res, "Customer activated successfully", {
      _id: user._id,
      phone: user.phone,
      isActive: user.isActive,
    });
  } catch (error) {
    next(error);
  }
};

// ─── DEACTIVATE CUSTOMER ──────────────────────────────────────────────────────
// PATCH /api/admin/customers/:id/deactivate
export const deactivateCustomer = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;

    const user = await User.findById(id);
    if (!user) {
      sendError(res, "Customer not found", undefined, 404);
      return;
    }

    user.isActive = false;
    await user.save();

    sendSuccess(res, "Customer deactivated successfully", {
      _id: user._id,
      phone: user.phone,
      isActive: user.isActive,
    });
  } catch (error) {
    next(error);
  }
};

// ─── DELETE CUSTOMER ──────────────────────────────────────────────────────────
// DELETE /api/admin/customers/:id
export const deleteCustomer = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;

    const user = await User.findById(id);
    if (!user) {
      sendError(res, "Customer not found", undefined, 404);
      return;
    }

    // Prevent deleting admin users
    if (user.role === "admin") {
      sendError(res, "Cannot delete admin users", undefined, 403);
      return;
    }

    await User.findByIdAndDelete(id);

    sendSuccess(res, "Customer deleted successfully", {
      _id: id,
      phone: user.phone,
    });
  } catch (error) {
    next(error);
  }
};

// ─── GET SINGLE CUSTOMER DETAILS ──────────────────────────────────────────────
// GET /api/admin/customers/:id
export const getCustomerById = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;

    const user = await User.findById(id).select("-__v").lean();
    if (!user) {
      sendError(res, "Customer not found", undefined, 404);
      return;
    }

    sendSuccess(res, "Customer fetched successfully", user);
  } catch (error) {
    next(error);
  }
};
