import mongoose, { Model, Schema, Document } from "mongoose";

// ─── Interfaces ───────────────────────────────────────────────────────────────
interface IProfile {
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

interface IFCMToken {
  token: string;
  platform: "ios" | "android" | "web";
  device: string;
  createdAt: Date;
  lastUsed: Date;
}

interface IPushToken {
  token?: string;
  platform?: "ios" | "android";
  device?: string;
  createdAt?: Date;
}

interface IUser extends Document {
  // Auth
  email: string;
  isEmailVerified: boolean;
  phone?: string;
  countryCode?: string;
  isPhoneVerified?: boolean;

  // Role
  role: "customer" | "admin";

  // Profile (filled at signup step 3)
  profile: IProfile;

  // Push tokens (legacy - for backward compatibility)
  pushTokens?: IPushToken[];

  // FCM tokens (new - Firebase Cloud Messaging)
  fcmTokens: IFCMToken[];

  // Account Status
  approvalStatus: "auto" | "manual" | "approved" | "rejected" | "pending";
  isProfileComplete: boolean;
  isActive: boolean;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;

  // Methods
  addFCMToken(token: string, platform: string, device?: string): Promise<IUser>;
}

// ─── GST Validation Function ─────────────────────────────────────────────────
const validateGST = (v: string): boolean => {
  if (!v) return true; // optional field
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(v);
};

// ─── FCM Token Schema ───────────────────────────────────────────────────────
const FCMTokenSchema = new Schema<IFCMToken>(
  {
    token: {
      type: String,
      required: true,
    },
    platform: {
      type: String,
      enum: ["ios", "android", "web"],
      required: true,
      default: "android",
    },
    device: {
      type: String,
      default: "Unknown",
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    lastUsed: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true },
);

// ─── Schema Definition ──────────────────────────────────────────────────────
const UserSchema = new mongoose.Schema<IUser>(
  {
    // ── Auth ──────────────────────────────────────────
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    phone: {
      type: String,
      required: false,
      trim: true,
      match: [/^\d{10}$/, "Phone must be 10 digits"],
    },
    countryCode: {
      type: String,
      default: "+91",
    },
    isPhoneVerified: {
      type: Boolean,
      default: false,
    },

    // ── Role ──────────────────────────────────────────
    role: {
      type: String,
      enum: ["customer", "admin"],
      default: "customer",
    },

    // ── Profile (filled at signup step 3) ─────────────
    profile: {
      contactName: { type: String, trim: true },
      addressLine1: { type: String, trim: true },
      addressLine2: { type: String, trim: true, default: "" },
      city: { type: String, trim: true },
      state: { type: String, trim: true },
      pincode: {
        type: String,
        trim: true,
        match: [/^\d{6}$/, "Invalid pincode"],
      },
      gstNumber: {
        type: String,
        trim: true,
        uppercase: true,
        default: "",
        validate: {
          validator: validateGST,
          message: "Invalid GST number format",
        },
      },
      latitude: { type: Number, default: null },
      longitude: { type: Number, default: null },
    },

    // ── Push Tokens (Legacy - for backward compatibility) ──
    pushTokens: [
      {
        token: { type: String },
        platform: { type: String, enum: ["ios", "android"] },
        device: { type: String },
        createdAt: { type: Date, default: Date.now },
      },
    ],

    // ── FCM Tokens (New - Firebase Cloud Messaging) ─────
    fcmTokens: {
      type: [FCMTokenSchema],
      default: [],
      validate: {
        validator: function (tokens: IFCMToken[]) {
          // Ensure no duplicate tokens
          const uniqueTokens = new Set(tokens.map((t) => t.token));
          return uniqueTokens.size === tokens.length;
        },
        message: "Duplicate FCM tokens are not allowed",
      },
    },

    // ── Account Status ────────────────────────────────
    approvalStatus: {
      type: String,
      enum: ["auto", "manual", "approved", "rejected", "pending"],
      default: "pending",
    },
    isProfileComplete: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true, // createdAt, updatedAt
  },
);

// ── Methods ──────────────────────────────────────────────────────────────────

// Add or update FCM token
UserSchema.methods.addFCMToken = async function (
  token: string,
  platform: string,
  device?: string,
): Promise<IUser> {
  // Find existing token
  const existingTokenIndex = this.fcmTokens.findIndex(
    (t: IFCMToken) => t.token === token,
  );

  if (existingTokenIndex >= 0) {
    // Update existing token
    this.fcmTokens[existingTokenIndex].lastUsed = new Date();
    this.fcmTokens[existingTokenIndex].platform = platform as
      | "ios"
      | "android"
      | "web";
    this.fcmTokens[existingTokenIndex].device = device || "Unknown";
  } else {
    // Add new token
    this.fcmTokens.push({
      token,
      platform: (platform as "ios" | "android" | "web") || "android",
      device: device || "Unknown",
      createdAt: new Date(),
      lastUsed: new Date(),
    });
  }

  // Limit to max 10 tokens per user
  if (this.fcmTokens.length > 10) {
    // Remove oldest tokens
    this.fcmTokens.sort(
      (a: IFCMToken, b: IFCMToken) =>
        b.lastUsed.getTime() - a.lastUsed.getTime(),
    );
    this.fcmTokens = this.fcmTokens.slice(0, 10);
  }

  return this.save();
};

// ── Indexes ──────────────────────────────────────────────────────────────────
UserSchema.index({ email: 1 });
UserSchema.index({ phone: 1 });
UserSchema.index({ "profile.gstNumber": 1 }, { sparse: true });
UserSchema.index({ "fcmTokens.token": 1 });
UserSchema.index({ "pushTokens.token": 1 });
UserSchema.index({ role: 1, isActive: 1 });
UserSchema.index({ approvalStatus: 1 });

// ── Pre-save middleware for data cleanup ─────────────────────────────────────
UserSchema.pre("save", function (next) {
  // Clean up invalid tokens
  if (this.fcmTokens && this.fcmTokens.length > 0) {
    this.fcmTokens = this.fcmTokens.filter(
      (token: IFCMToken) => token.token && token.token.length > 50,
    );
  }

  if (this.pushTokens && this.pushTokens.length > 0) {
    this.pushTokens = this.pushTokens.filter(
      (token: IPushToken) => token.token && token.token.length > 0,
    );
  }

  next();
});

// ─── Create and Export Model ─────────────────────────────────────────────────
const User: Model<IUser> = mongoose.model<IUser>("User", UserSchema);

export default User;
export { IUser, IProfile, IFCMToken, IPushToken };
