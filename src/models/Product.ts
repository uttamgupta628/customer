import mongoose, { Document, Schema } from "mongoose";

export type ProductUnit =
  | "kg"
  | "g"
  | "litre"
  | "ml"
  | "pack"
  | "piece"
  | "dozen"
  | "box";

export interface IProduct extends Document {
  name: string;
  brand?: string;
  category: string;
  subCategory?: string;
  sellingPrice: number;
  originalPrice?: number;
  unit: ProductUnit;
  weightOrSize?: string;
  stockQuantity: number;
  minOrderQuantity: number;
  description?: string;
  imageUrl?: string;
  imagePublicId?: string;
  tags: string[];
  isFastMoving: boolean;
  isFeatured: boolean;
  isActive: boolean;
  alertAt?: number | null;
  createdAt: Date;
  updatedAt: Date;
}

const ProductSchema = new Schema<IProduct>(
  {
    name: {
      type: String,
      required: [true, "Product name is required"],
      trim: true,
      maxlength: [200, "Product name cannot exceed 200 characters"],
    },
    brand: {
      type: String,
      trim: true,
    },
    category: {
      type: String,
      required: [true, "Category is required"],
      trim: true,
      lowercase: true,
    },
    subCategory: {
      type: String,
      trim: true,
      lowercase: true,
    },
    sellingPrice: {
      type: Number,
      required: [true, "Selling price is required"],
      min: [0, "Price cannot be negative"],
    },
    originalPrice: {
      type: Number,
      min: [0, "Original price cannot be negative"],
    },
    unit: {
      type: String,
      required: [true, "Unit is required"],
      enum: {
        values: ["kg", "g", "litre", "ml", "pack", "piece", "dozen", "box"],
        message: "Invalid unit. Allowed: kg, g, litre, ml, pack, piece, dozen, box",
      },
      default: "pack",
    },
    weightOrSize: {
      type: String,
      trim: true,
    },
    stockQuantity: {
      type: Number,
      required: [true, "Stock quantity is required"],
      min: [0, "Stock cannot be negative"],
      default: 0,
    },
    minOrderQuantity: {
      type: Number,
      min: [1, "Minimum order quantity must be at least 1"],
      default: 1,
    },
    description: {
      type: String,
      trim: true,
      maxlength: [2000, "Description cannot exceed 2000 characters"],
    },
    imageUrl: {
      type: String,
    },
    imagePublicId: {
      type: String,
    },
    tags: {
      type: [String],
      default: [],
    },
    isFastMoving: {
      type: Boolean,
      default: false,
    },
    isFeatured: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    alertAt: {
      type: Number,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes for common queries
ProductSchema.index({ category: 1, subCategory: 1 });
ProductSchema.index({ isFeatured: 1 });
ProductSchema.index({ isFastMoving: 1 });
ProductSchema.index({ name: "text", brand: "text", description: "text" });

const Product = mongoose.model<IProduct>("Product", ProductSchema);
export default Product;