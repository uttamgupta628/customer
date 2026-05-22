import mongoose, { Document, Schema } from "mongoose";

export interface IStockAlert extends Document {
  user: mongoose.Types.ObjectId;
  product: mongoose.Types.ObjectId;
  isNotified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const StockAlertSchema = new Schema<IStockAlert>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    product: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    isNotified: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

// Ensure one alert per user per product
StockAlertSchema.index({ user: 1, product: 1 }, { unique: true });
// Index for querying pending alerts when product is restocked
StockAlertSchema.index({ product: 1, isNotified: 1 });

const StockAlert = mongoose.model<IStockAlert>("StockAlert", StockAlertSchema);
export default StockAlert;
