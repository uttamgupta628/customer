// models/AdminSettings.ts
import mongoose, { Document, Schema } from "mongoose";

export interface IAdminSettings extends Document {
  qrCodeUrl: string;
  upiId?: string;
  updatedAt: Date;
}

const AdminSettingsSchema = new Schema<IAdminSettings>(
  {
    qrCodeUrl: {
      type: String,
      default: "",
    },
    upiId: {
      type: String,
      default: "",
    },
  },
  { timestamps: true },
);

// Ensure only one document exists
AdminSettingsSchema.statics.getSettings = async function () {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create({});
  }
  return settings;
};

const AdminSettings = mongoose.model<IAdminSettings>(
  "AdminSettings",
  AdminSettingsSchema,
);
export default AdminSettings;
