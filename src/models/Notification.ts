import mongoose, { Document, Schema } from "mongoose";

export interface INotification extends Document {
  user: mongoose.Types.ObjectId;
  type: "approval_status" | "order_status" | "manual_broadcast" | "system";
  title: string;
  body: string;
  isRead: boolean;
  data?: {
    type?: string;
    status?: string;
    orderId?: string;
    orderNumber?: string;
    screen?: string;
    [key: string]: any;
  };
  createdAt: Date;
  updatedAt: Date;
}

const NotificationSchema = new Schema<INotification>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["approval_status", "order_status", "manual_broadcast", "system"],
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    body: {
      type: String,
      required: true,
    },
    isRead: {
      type: Boolean,
      default: false,
    },
    data: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  },
);

NotificationSchema.index({ user: 1, createdAt: -1 });
NotificationSchema.index({ user: 1, isRead: 1 });

const Notification = mongoose.model<INotification>(
  "Notification",
  NotificationSchema,
);
export default Notification;
