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

interface IUser extends Document {
  // Auth
  phone: string;
  countryCode: string;
  isPhoneVerified: boolean;

  // Role
  role: "customer" | "admin";

  // Profile (filled at signup step 3)
  profile: IProfile;

  // Account Status
  approvalStatus: "auto" | "manual" | "approved" | "rejected" | "pending";
  isProfileComplete: boolean;
  isActive: boolean;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

// ─── GST Validation Function ─────────────────────────────────────────────────
const validateGST = (v: string): boolean => {
  if (!v) return true; // optional field
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(v);
};

// ─── Schema Definition ──────────────────────────────────────────────────────
const UserSchema = new mongoose.Schema<IUser>(
  {
    // ── Auth ──────────────────────────────────────────
    phone: {
      type: String,
      required: true,
      unique: true,
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

// ── Indexes ──────────────────────────────────────────────────────────────────
UserSchema.index({ phone: 1 });
UserSchema.index({ "profile.gstNumber": 1 }, { sparse: true });

// ─── Create and Export Model ─────────────────────────────────────────────────
const User: Model<IUser> = mongoose.model<IUser>("User", UserSchema);

export default User;
