import jwt from "jsonwebtoken";
import User from "../models/Users";
import OtpRecord from "../models/OtpRecords";
import admin from "../utils/firebaseAdmin";
import {
  generateOtp,
  isGstValid,
  resolveApprovalStatus,
} from "../utils/otpUtils";
import { sendNewRegistrationEmail, sendOtpEmail } from "../utils/sendgrid";
import { Request, Response } from "express";
import { Types } from "mongoose";

// ─── Types & Interfaces ───────────────────────────────────────────────────────
interface CustomRequest extends Request {
  user?: {
    _id: Types.ObjectId;
    email: string;
    phone?: string;
    role: string;
    isProfileComplete: boolean;
    approvalStatus: string;
  };
}

interface CheckEmailQuery {
  email?: string;
}

interface SendOtpBody {
  email?: string;
}

interface VerifyOtpBody {
  email?: string;
  otp?: string;
}

interface CompleteProfileBody {
  contactName?: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  pincode?: string;
  gstNumber?: string;
  latitude?: number | null;
  longitude?: number | null;
}

interface UpdateProfileBody {
  contactName?: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  pincode?: string;
  gstNumber?: string;
}

interface SaveFCMTokenBody {
  fcmToken?: string;
  platform?: string;
  device?: string;
}

interface RemoveFCMTokenBody {
  fcmToken?: string;
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
  email: string;
  phone?: string;
  role: string;
  isProfileComplete: boolean;
  approvalStatus: string;
  profile: UserProfile;
  isEmailVerified: boolean;
  save(): Promise<UserDocument>;
}

// ─── Constants ───────────────────────────────────────────────────────────────
const OTP_EXPIRY_MINUTES: number = 5;
const MAX_OTP_ATTEMPTS: number = 5;
const RESEND_COOLDOWN_SECONDS: number = 30;

// ─── Helper: sign JWT ─────────────────────────────────────────────────────────
const signToken = (userId: Types.ObjectId): string => {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not set.");
  }

  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: (process.env.JWT_EXPIRES_IN || "30d") as string | number,
  } as jwt.SignOptions);
};

// [1] CHECK EMAIL REGISTRATION
// GET /auth/check-email?email=user@example.com
// Used by the signup screen to show "registered / not registered" banner
// ─────────────────────────────────────────────────────────────────────────────
const checkEmail = async (
  req: Request<{}, {}, {}, CheckEmailQuery>,
  res: Response,
): Promise<Response> => {
  try {
    const { email } = req.query;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email address.",
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    return res.status(200).json({
      success: true,
      isRegistered: !!user,
      isProfileComplete: user ? user.isProfileComplete : false,
    });
  } catch (err) {
    console.error("[checkEmail]", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// [2] SEND OTP VIA EMAIL
// POST /auth/send-otp
// Body: { email: "user@example.com" }
// Works for both Login (existing user) and Signup (new user)
// ─────────────────────────────────────────────────────────────────────────────
const sendOtpHandler = async (
  req: Request<{}, {}, SendOtpBody>,
  res: Response,
): Promise<Response> => {
  try {
    const { email } = req.body;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email address.",
      });
    }

    const emailLower = email.toLowerCase();

    // ── Resend cooldown: check if a recent OTP was already sent ──
    const recentOtp = await OtpRecord.findOne({
      email: emailLower,
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

    // ── Invalidate any existing unused OTPs for this email ──
    await OtpRecord.updateMany({ email: emailLower, isUsed: false }, { isUsed: true });

    // ── Generate new OTP ──
    const otp: string = generateOtp();
    const expiresAt: Date = new Date(
      Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000,
    );

    await OtpRecord.create({ email: emailLower, otp, expiresAt });

    // ── Send OTP via SendGrid ──
    try {
      await sendOtpEmail(emailLower, otp);
    } catch (emailErr: any) {
      console.warn("[SendGrid Warning] Failed to send OTP email:", emailErr.message);
      if (process.env.NODE_ENV !== "development") {
        // Rethrow the error in production so the request fails
        throw emailErr;
      }
    }

    const responseData: any = {
      success: true,
      message: `OTP sent to ${emailLower}`,
    };

    // ⚠️  REMOVE THIS IN PRODUCTION — only for dev/testing
    if (process.env.NODE_ENV === "development") {
      responseData.otp = otp;
    }

    return res.status(200).json(responseData);
  } catch (err: any) {
    console.error("[sendOtp]", err);
    return res.status(500).json({ success: false, message: err.message || "Server error." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// [3] VERIFY OTP VIA EMAIL
// POST /auth/verify-otp
// Body: { email: "user@example.com", otp: "123456" }
// Returns JWT token. Creates user record if first time.
// ─────────────────────────────────────────────────────────────────────────────
const verifyOtpHandler = async (
  req: Request<{}, {}, VerifyOtpBody>,
  res: Response,
): Promise<Response> => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: "Email and OTP are required.",
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid email address." });
    }

    if (!/^\d{6}$/.test(otp)) {
      return res
        .status(400)
        .json({ success: false, message: "OTP must be 6 digits." });
    }

    const emailLower = email.toLowerCase();

    // ── Find latest valid OTP record ──
    const otpRecord = await OtpRecord.findOne({
      email: emailLower,
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
    let user = await User.findOne({ email: emailLower });
    let isNewUser: boolean = false;

    if (!user) {
      user = await User.create({ email: emailLower, isEmailVerified: true });
      isNewUser = true;
    } else {
      user.isEmailVerified = true;
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
        email: user.email,
        phone: user.phone,
        role: user.role,
        isProfileComplete: user.isProfileComplete,
        approvalStatus: user.approvalStatus,
        profile: user.profile,
      },
    });
  } catch (err) {
    console.error("[verifyOtp]", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// [3.5] GOOGLE LOGIN
// POST /auth/google
// Body: { idToken: string }
// Returns JWT token. Creates user record if first time.
// ─────────────────────────────────────────────────────────────────────────────
const googleLoginHandler = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({
        success: false,
        message: "ID Token is required.",
      });
    }

    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(idToken);
    } catch (verifyErr: any) {
      console.error("[googleLogin] Firebase verification failed:", verifyErr);
      return res.status(401).json({
        success: false,
        message: "Invalid Google / Firebase credentials.",
      });
    }

    const { email, name } = decodedToken;
    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Google account does not provide an email address.",
      });
    }

    const emailLower = email.toLowerCase();
    let user = await User.findOne({ email: emailLower });
    let isNewUser: boolean = false;

    if (!user) {
      user = await User.create({
        email: emailLower,
        isEmailVerified: true,
        profile: {
          contactName: name || "",
        },
      });
      isNewUser = true;
    } else {
      if (!user.isEmailVerified) {
        user.isEmailVerified = true;
        await user.save();
      }
    }

    const token: string = signToken(user._id);

    return res.status(200).json({
      success: true,
      message: "Google authentication successful.",
      token,
      isNewUser,
      isProfileComplete: user.isProfileComplete,
      user: {
        id: user._id,
        email: user.email,
        phone: user.phone,
        role: user.role,
        isProfileComplete: user.isProfileComplete,
        approvalStatus: user.approvalStatus,
        profile: user.profile,
      },
    });
  } catch (err) {
    console.error("[googleLogin]", err);
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
      phone,
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
    if (!phone?.trim()) missing.push("phone");
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

    // ── Validate phone ──
    if (!/^\d{10}$/.test(phone!.trim())) {
      return res.status(400).json({
        success: false,
        message: "Phone number must be a 10-digit number.",
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
          phone: phone!.trim(),
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

    // ── 🔔 Send email notification to admins (fire and forget) ──
    const approvalType =
      gstTrimmed && isGstValid(gstTrimmed) ? "auto" : "manual";

    sendNewRegistrationEmail({
      customerName: user.profile?.contactName || "New Customer",
      phone: user.phone || "",
      city: user.profile?.city,
      state: user.profile?.state,
      gstNumber: user.profile?.gstNumber,
      addressLine1: user.profile?.addressLine1,
      addressLine2: user.profile?.addressLine2,
      pincode: user.profile?.pincode,
      customerId: user._id.toString(),
      approvalType: approvalType as "auto" | "manual",
      createdAt: new Date(),
    }).catch((err) => {
      console.error(
        "[completeProfile] Failed to send email notification:",
        err,
      );
      // Don't fail the request if email fails
    });

    return res.status(200).json({
      success: true,
      message:
        approvalStatus === "auto"
          ? "Profile saved. Account auto-approved via GST verification."
          : "Profile saved. Account is under manual review (within 24 hours).",
      approvalStatus,
      user: {
        id: user._id,
        email: user.email,
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

// ─── [7] SAVE PUSH TOKEN (LEGACY - for backward compatibility) ───────────────
// POST /auth/push-token
// Protected: requires Bearer token
// Body: { pushToken, platform?, device? }
// Handles both Expo tokens and FCM tokens
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

    // Check if it's an FCM token (not Expo token)
    const isFCMToken = !pushToken.startsWith("ExponentPushToken");

    // Save to legacy pushTokens array
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

    // If it's an FCM token, also add to fcmTokens array
    if (isFCMToken) {
      await user.addFCMToken(
        pushToken,
        platform || "android",
        device || "Unknown",
      );
    }

    await user.save();

    console.log(`📱 Push token saved: ${isFCMToken ? "FCM" : "Expo"}`);
    console.log(`   User: ${user.phone}`);
    console.log(`   FCM devices: ${user.fcmTokens?.length || 0}`);

    return res.status(200).json({
      success: true,
      message: "Push token saved",
      tokenType: isFCMToken ? "fcm" : "expo",
      totalDevices: user.fcmTokens?.length || 1,
    });
  } catch (err) {
    console.error("[savePushToken]", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// ─── [8] SAVE FCM TOKEN (NEW) ───────────────────────────────────────────────
// POST /auth/fcm-token
// Protected: requires Bearer token
// Body: { fcmToken, platform?, device? }
const saveFCMToken = async (
  req: CustomRequest,
  res: Response,
): Promise<Response> => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { fcmToken, platform, device } = req.body as SaveFCMTokenBody;

    // Validation
    if (!fcmToken) {
      return res.status(400).json({
        success: false,
        message: "FCM token is required",
      });
    }

    if (typeof fcmToken !== "string" || fcmToken.length < 50) {
      return res.status(400).json({
        success: false,
        message: "Invalid FCM token format",
      });
    }

    // Validate platform
    const validPlatforms = ["ios", "android", "web"];
    if (platform && !validPlatforms.includes(platform)) {
      return res.status(400).json({
        success: false,
        message: "Invalid platform. Must be: ios, android, or web",
      });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Add FCM token using model method
    await user.addFCMToken(
      fcmToken,
      platform || "android",
      device || "Unknown",
    );

    // Also add to legacy pushTokens for backward compatibility
    const existingPushToken = (user.pushTokens || []).findIndex(
      (t: any) => t.token === fcmToken,
    );

    if (existingPushToken === -1) {
      user.pushTokens = [
        ...(user.pushTokens || []),
        {
          token: fcmToken,
          platform: (platform as "ios" | "android") || "android",
          device: device || "Unknown",
          createdAt: new Date(),
        },
      ];
      await user.save();
    }

    console.log(`📱 FCM token registered for user: ${user.phone}`);
    console.log(`   Platform: ${platform || "android"}`);
    console.log(`   Device: ${device || "Unknown"}`);
    console.log(`   Total devices: ${user.fcmTokens.length}`);

    return res.status(200).json({
      success: true,
      message: "FCM token registered successfully",
      tokenCount: user.fcmTokens.length,
      platforms: user.fcmTokens.map((t) => t.platform),
      lastRegistered: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[saveFCMToken]", err);
    return res.status(500).json({
      success: false,
      message: "Failed to save FCM token",
      error: err.message,
    });
  }
};

// ─── [9] REMOVE FCM TOKEN (NEW) ─────────────────────────────────────────────
// DELETE /auth/fcm-token
// Protected: requires Bearer token
// Body: { fcmToken }
const removeFCMToken = async (
  req: CustomRequest,
  res: Response,
): Promise<Response> => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { fcmToken } = req.body as RemoveFCMTokenBody;

    if (!fcmToken) {
      return res.status(400).json({
        success: false,
        message: "FCM token is required",
      });
    }

    // Remove from both FCM tokens and legacy pushTokens
    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      {
        $pull: {
          fcmTokens: { token: fcmToken },
          pushTokens: { token: fcmToken },
        },
      },
      { new: true },
    ).select("fcmTokens pushTokens");

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    console.log(`🗑️ FCM token removed for user: ${req.user._id}`);
    console.log(`   Remaining devices: ${updatedUser.fcmTokens.length}`);

    return res.status(200).json({
      success: true,
      message: "FCM token removed successfully",
      remainingTokens: updatedUser.fcmTokens.length,
    });
  } catch (err: any) {
    console.error("[removeFCMToken]", err);
    return res.status(500).json({
      success: false,
      message: "Failed to remove FCM token",
      error: err.message,
    });
  }
};

// ─── [10] GET FCM TOKENS (NEW) ──────────────────────────────────────────────
// GET /auth/fcm-tokens
// Protected: requires Bearer token
const getFCMTokens = async (
  req: CustomRequest,
  res: Response,
): Promise<Response> => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const user = await User.findById(req.user._id).select(
      "fcmTokens pushTokens phone profile.contactName",
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Format active FCM tokens
    const activeTokens = (user.fcmTokens || []).map((token) => ({
      platform: token.platform,
      device: token.device,
      lastUsed: token.lastUsed,
      createdAt: token.createdAt,
      isActive: true,
    }));

    // Format legacy tokens
    const legacyTokens = (user.pushTokens || []).map((token) => ({
      platform: token.platform || "unknown",
      device: token.device || "Unknown",
      createdAt: token.createdAt,
      isLegacy: true,
    }));

    return res.status(200).json({
      success: true,
      message: "FCM tokens fetched successfully",
      phone: user.phone,
      name: user.profile?.contactName,
      activeDevices: activeTokens.length,
      fcmTokens: activeTokens,
      legacyTokens: legacyTokens,
    });
  } catch (err: any) {
    console.error("[getFCMTokens]", err);
    return res.status(500).json({
      success: false,
      message: "Failed to get FCM tokens",
      error: err.message,
    });
  }
};

export {
  checkEmail,
  sendOtpHandler,
  verifyOtpHandler,
  googleLoginHandler,
  completeProfile,
  getMe,
  updateProfile,
  savePushToken, // Legacy push token (backward compatible)
  saveFCMToken, // New FCM token handler
  removeFCMToken, // New FCM token removal
  getFCMTokens, // New get FCM tokens
};
