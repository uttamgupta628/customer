import mongoose, { Model, Schema, Document } from "mongoose";

// ─── Interface ───────────────────────────────────────────────────────────────
interface IOtpRecord extends Document {
  email: string;
  otp: string;
  expiresAt: Date;
  attempts: number;
  isUsed: boolean;
  createdAt: Date;
}

// ─── Schema Definition ──────────────────────────────────────────────────────
const OtpSchema = new Schema<IOtpRecord>(
  {
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    otp: {
      type: String,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    isUsed: {
      type: Boolean,
      default: false,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      // TTL index: MongoDB auto-deletes documents 10 minutes after createdAt
      expires: 600, // 10 minutes in seconds
    },
  },
  {
    // Optional: Add timestamps if needed
    // timestamps: true,
  },
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
OtpSchema.index({ email: 1 });

// ─── Create and Export Model ─────────────────────────────────────────────────
const OtpRecord: Model<IOtpRecord> = mongoose.model<IOtpRecord>(
  "OtpRecord",
  OtpSchema,
);

export default OtpRecord;
