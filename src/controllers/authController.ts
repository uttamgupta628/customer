import jwt from "jsonwebtoken";
import User from "../models/Users";
import OtpRecord from "../models/OtpRecords";
import {
  generateOtp,
  isGstValid,
  resolveApprovalStatus,
  sendOtp,
} from "../utils/otpUtils";
import { Request, Response } from "express";
import { Types } from "mongoose";

// ─── Types & Interfaces ───────────────────────────────────────────────────────
interface CustomRequest extends Request {
  user?: {
    _id: Types.ObjectId;
    phone: string;
    role: string;
    isProfileComplete: boolean;
    approvalStatus: string;
  };
}

interface CheckPhoneQuery {
  phone?: string;
}

interface SendOtpBody {
  phone?: string;
}

interface VerifyOtpBody {
  phone?: string;
  otp?: string;
}

interface CompleteProfileBody {
  contactName?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  pincode?: string;
  gstNumber?: string;
  latitude?: number | null;
  longitude?: number | null;
}

interface UserProfile {
  contactName: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  pincode: string;
  gstNumber: string;
  latitude: number | null;
  longitude: number | null;
}

interface UserDocument {
  _id: Types.ObjectId;
  phone: string;
  role: string;
  isProfileComplete: boolean;
  approvalStatus: string;
  profile: UserProfile;
  isPhoneVerified: boolean;
  save(): Promise<UserDocument>;
}

// ─── Constants ───────────────────────────────────────────────────────────────
const OTP_EXPIRY_MINUTES: number = 5;
const MAX_OTP_ATTEMPTS: number = 5;
const RESEND_COOLDOWN_SECONDS: number = 30;

// ─── Helper: sign JWT ─────────────────────────────────────────────────────────
// Replace the existing signToken with this:
// ─── Helper: sign JWT ─────────────────────────────────────────────────────────
const signToken = (userId: Types.ObjectId): string => {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not set.");
  }

  // ✅ Fix: Use proper typing for expiresIn
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: (process.env.JWT_EXPIRES_IN || "30d") as string | number,
  } as jwt.SignOptions);
};

// ─────────────────────────────────────────────────────────────────────────────
// [1] CHECK PHONE REGISTRATION
// GET /auth/check-phone?phone=9876543210
// Used by the signup screen to show "registered / not registered" banner
// ─────────────────────────────────────────────────────────────────────────────
const checkPhone = async (
  req: Request<{}, {}, {}, CheckPhoneQuery>,
  res: Response,
): Promise<Response> => {
  try {
    const { phone } = req.query;

    if (!phone || !/^\d{10}$/.test(phone)) {
      return res.status(400).json({
        success: false,
        message: "Invalid phone number. Must be 10 digits.",
      });
    }

    const user = await User.findOne({ phone });

    return res.status(200).json({
      success: true,
      isRegistered: !!user,
      isProfileComplete: user ? user.isProfileComplete : false,
    });
  } catch (err) {
    console.error("[checkPhone]", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// [2] SEND OTP
// POST /auth/send-otp
// Body: { phone: "9876543210" }
// Works for both Login (existing user) and Signup (new user)
// ─────────────────────────────────────────────────────────────────────────────
const sendOtpHandler = async (
  req: Request<{}, {}, SendOtpBody>,
  res: Response,
): Promise<Response> => {
  try {
    const { phone } = req.body;

    if (!phone || !/^\d{10}$/.test(phone)) {
      return res.status(400).json({
        success: false,
        message: "Invalid phone number. Must be 10 digits.",
      });
    }

    // ── Resend cooldown: check if a recent OTP was already sent ──
    const recentOtp = await OtpRecord.findOne({
      phone,
      isUsed: false,
      createdAt: {
        $gte: new Date(Date.now() - RESEND_COOLDOWN_SECONDS * 1000),
      },
    });

    if (recentOtp) {
      const secondsLeft: number = Math.ceil(
        (recentOtp.createdAt.getTime() +
          RESEND_COOLDOWN_SECONDS * 1000 -
          Date.now()) /
          1000,
      );
      return res.status(429).json({
        success: false,
        message: `Please wait ${secondsLeft}s before requesting a new OTP.`,
        retryAfter: secondsLeft,
      });
    }

    // ── Invalidate any existing unused OTPs for this phone ──
    await OtpRecord.updateMany({ phone, isUsed: false }, { isUsed: true });

    // ── Generate new OTP ──
    const otp: string = generateOtp();
    const expiresAt: Date = new Date(
      Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000,
    );

    await OtpRecord.create({ phone, otp, expiresAt });

    // ── Send OTP (mock for now) ──
    await sendOtp(phone, otp);

    const responseData: any = {
      success: true,
      message: `OTP sent to +91${phone}`,
    };

    // ⚠️  REMOVE THIS IN PRODUCTION — only for dev/testing
    if (process.env.NODE_ENV === "development") {
      responseData.otp = otp;
    }

    return res.status(200).json(responseData);
  } catch (err) {
    console.error("[sendOtp]", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// [3] VERIFY OTP
// POST /auth/verify-otp
// Body: { phone: "9876543210", otp: "123456" }
// Returns JWT token. Creates user record if first time.
// ─────────────────────────────────────────────────────────────────────────────
const verifyOtpHandler = async (
  req: Request<{}, {}, VerifyOtpBody>,
  res: Response,
): Promise<Response> => {
  try {
    const { phone, otp } = req.body;

    if (!phone || !otp) {
      return res.status(400).json({
        success: false,
        message: "Phone and OTP are required.",
      });
    }

    if (!/^\d{10}$/.test(phone)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid phone number." });
    }

    if (!/^\d{6}$/.test(otp)) {
      return res
        .status(400)
        .json({ success: false, message: "OTP must be 6 digits." });
    }

    // ── Find latest valid OTP record ──
    const otpRecord = await OtpRecord.findOne({
      phone,
      isUsed: false,
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 });

    if (!otpRecord) {
      return res.status(400).json({
        success: false,
        message: "OTP has expired or not found. Please request a new one.",
      });
    }

    // ── Max attempts guard ──
    if (otpRecord.attempts >= MAX_OTP_ATTEMPTS) {
      await OtpRecord.findByIdAndUpdate(otpRecord._id, { isUsed: true });
      return res.status(400).json({
        success: false,
        message: "Too many failed attempts. Please request a new OTP.",
      });
    }

    // ── Validate OTP ──
    // NOTE: "252002" is the hardcoded dev OTP. Remove the second condition in production.
    const isValid: boolean = otpRecord.otp === otp || otp === "252002";

    if (!isValid) {
      await OtpRecord.findByIdAndUpdate(otpRecord._id, {
        $inc: { attempts: 1 },
      });
      return res.status(400).json({
        success: false,
        message: "Invalid OTP. Please try again.",
        attemptsLeft: MAX_OTP_ATTEMPTS - otpRecord.attempts - 1,
      });
    }

    // ── Mark OTP as used ──
    await OtpRecord.findByIdAndUpdate(otpRecord._id, { isUsed: true });

    // ── Get or create user ──
    let user = await User.findOne({ phone });
    let isNewUser: boolean = false;

    if (!user) {
      user = await User.create({ phone, isPhoneVerified: true });
      isNewUser = true;
    } else {
      user.isPhoneVerified = true;
      await user.save();
    }

    // ── Sign JWT ──
    const token: string = signToken(user._id);

    return res.status(200).json({
      success: true,
      message: "OTP verified successfully.",
      token,
      isNewUser, // frontend uses this to decide: go to profile setup or home
      isProfileComplete: user.isProfileComplete,
      user: {
        id: user._id,
        phone: user.phone,
        role: user.role,
        isProfileComplete: user.isProfileComplete,
        approvalStatus: user.approvalStatus,
      },
    });
  } catch (err) {
    console.error("[verifyOtp]", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// [4] COMPLETE PROFILE (Signup Step 3)
// POST /auth/signup/profile
// Protected: requires Bearer token from step 3
// Body: { contactName, addressLine1, addressLine2, city, state, pincode, gstNumber, latitude, longitude }
// ─────────────────────────────────────────────────────────────────────────────
const completeProfile = async (
  req: CustomRequest,
  res: Response,
): Promise<Response> => {
  try {
    const {
      contactName,
      addressLine1,
      addressLine2 = "",
      city,
      state,
      pincode,
      gstNumber = "",
      latitude = null,
      longitude = null,
    } = req.body as CompleteProfileBody;

    // ── Validate required fields ──
    const missing: string[] = [];
    if (!contactName?.trim()) missing.push("contactName");
    if (!addressLine1?.trim()) missing.push("addressLine1");
    if (!city?.trim()) missing.push("city");
    if (!state?.trim()) missing.push("state");
    if (!pincode?.trim()) missing.push("pincode");

    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Required fields missing.",
        missing,
      });
    }

    // ── Validate pincode ──
    if (!/^\d{6}$/.test(pincode!.trim())) {
      return res.status(400).json({
        success: false,
        message: "Pincode must be a 6-digit number.",
      });
    }

    // ── Validate GST if provided ──
    const gstTrimmed: string = gstNumber.trim().toUpperCase();
    if (gstTrimmed && !isGstValid(gstTrimmed)) {
      return res.status(400).json({
        success: false,
        message: "Invalid GST number format.",
      });
    }

    // ── Resolve approval status ──
    const approvalStatus: string = resolveApprovalStatus(gstTrimmed);

    // ── Update user ──
    // req.user is set by the protect middleware
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      {
        $set: {
          "profile.contactName": contactName!.trim(),
          "profile.addressLine1": addressLine1!.trim(),
          "profile.addressLine2": addressLine2.trim(),
          "profile.city": city!.trim(),
          "profile.state": state!.trim(),
          "profile.pincode": pincode!.trim(),
          "profile.gstNumber": gstTrimmed,
          "profile.latitude": latitude,
          "profile.longitude": longitude,
          approvalStatus,
          isProfileComplete: true,
        },
      },
      { new: true, runValidators: true },
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(200).json({
      success: true,
      message:
        approvalStatus === "auto"
          ? "Profile saved. Account auto-approved via GST verification."
          : "Profile saved. Account is under manual review (within 24 hours).",
      approvalStatus,
      user: {
        id: user._id,
        phone: user.phone,
        role: user.role,
        isProfileComplete: user.isProfileComplete,
        approvalStatus: user.approvalStatus,
        profile: user.profile,
      },
    });
  } catch (err: any) {
    console.error("[completeProfile]", err);
    if (err.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: Object.values(err.errors)
          .map((e: any) => e.message)
          .join(", "),
      });
    }
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// [5] GET MY PROFILE
// GET /auth/me
// Protected: requires Bearer token
// ─────────────────────────────────────────────────────────────────────────────
const getMe = async (req: CustomRequest, res: Response): Promise<Response> => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
    }

    const user = await User.findById(req.user._id).select("-__v");
    return res.status(200).json({ success: true, user });
  } catch (err) {
    console.error("[getMe]", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

interface UpdateProfileBody {
  contactName?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  pincode?: string;
  gstNumber?: string;
}

// [6] UPDATE PROFILE
// PUT /auth/profile
// Protected: requires Bearer token
const updateProfile = async (
  req: CustomRequest,
  res: Response,
): Promise<Response> => {
  try {
    if (!req.user) {
      return res
        .status(401)
        .json({ success: false, message: "User not authenticated" });
    }

    const {
      contactName,
      addressLine1,
      addressLine2 = "",
      city,
      state,
      pincode,
      gstNumber = "",
    } = req.body as UpdateProfileBody;

    // ── Validate required fields ──
    const missing: string[] = [];
    if (!contactName?.trim()) missing.push("contactName");
    if (!addressLine1?.trim()) missing.push("addressLine1");
    if (!city?.trim()) missing.push("city");
    if (!state?.trim()) missing.push("state");
    if (!pincode?.trim()) missing.push("pincode");

    if (missing.length > 0) {
      return res
        .status(400)
        .json({ success: false, message: "Required fields missing.", missing });
    }

    // ── Validate pincode ──
    if (!/^\d{6}$/.test(pincode!.trim())) {
      return res
        .status(400)
        .json({ success: false, message: "Pincode must be 6 digits." });
    }

    // ── Validate GST if provided ──
    const gstTrimmed = gstNumber.trim().toUpperCase();
    if (gstTrimmed && !isGstValid(gstTrimmed)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid GST number format." });
    }

    // ── Update only profile fields — don't touch approvalStatus or isProfileComplete ──
    const user = await User.findByIdAndUpdate(
      req.user._id,
      {
        $set: {
          "profile.contactName": contactName!.trim(),
          "profile.addressLine1": addressLine1!.trim(),
          "profile.addressLine2": addressLine2.trim(),
          "profile.city": city!.trim(),
          "profile.state": state!.trim(),
          "profile.pincode": pincode!.trim(),
          "profile.gstNumber": gstTrimmed,
        },
      },
      { new: true, runValidators: true },
    );

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully.",
      user: {
        id: user._id,
        phone: user.phone,
        role: user.role,
        isProfileComplete: user.isProfileComplete,
        approvalStatus: user.approvalStatus,
        profile: user.profile,
      },
    });
  } catch (err: any) {
    console.error("[updateProfile]", err);
    if (err.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: Object.values(err.errors)
          .map((e: any) => e.message)
          .join(", "),
      });
    }
    return res.status(500).json({ success: false, message: "Server error." });
  }
};
// ─── SAVE PUSH TOKEN ─────────────────────────────────────────────────────────
const savePushToken = async (
  req: CustomRequest,
  res: Response,
): Promise<Response> => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { pushToken, platform, device } = req.body;

    if (!pushToken) {
      return res
        .status(400)
        .json({ success: false, message: "Push token required" });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    // Check if token already exists
    const existingIndex = (user.pushTokens || []).findIndex(
      (t: any) => t.token === pushToken,
    );

    if (existingIndex > -1) {
      // Update existing token
      (user.pushTokens as any)[existingIndex] = {
        token: pushToken,
        platform: platform || "unknown",
        device: device || "Unknown",
        createdAt: new Date(),
      };
    } else {
      // Add new token
      user.pushTokens = [
        ...(user.pushTokens || []),
        {
          token: pushToken,
          platform: platform || "unknown",
          device: device || "Unknown",
          createdAt: new Date(),
        },
      ];
    }

    await user.save();

    return res.status(200).json({
      success: true,
      message: "Push token saved",
    });
  } catch (err) {
    console.error("[savePushToken]", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export {
  checkPhone,
  sendOtpHandler,
  verifyOtpHandler,
  completeProfile,
  getMe,
  updateProfile,
  savePushToken,
};
