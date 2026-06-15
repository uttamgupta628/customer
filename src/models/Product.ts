import mongoose, { Document, Schema } from "mongoose";

export interface IProductImage {
  url: string;
  publicId: string;
  isPrimary: boolean;
  altText?: string;
}

export interface IProduct extends Document {
  sku?: string; // ✅ NEW: Unique identifier for bulk operations
  name: string;
  brand?: string;
  category: string;
  subCategory?: string;
  type?: string;
  compatibility?: string[];
  sellingPrice: number;
  originalPrice?: number;
  enforceOrderLimits?: boolean;
  color?: string;
  material?: string;
  dimensions?: string;
  weight?: string;
  warranty?: string;
  stockQuantity: number;
  minOrderQuantity: number;
  maxOrderQuantity?: number;
  description?: string;
  specifications?: Map<string, string>;
  images: IProductImage[];
  tags: string[];
  isFastMoving: boolean;
  isFeatured: boolean;
  isActive: boolean;
  alertAt?: number | null;
  createdAt: Date;
  updatedAt: Date;
}

const ProductImageSchema = new Schema<IProductImage>(
  {
    url: { type: String, required: true },
    publicId: { type: String, required: true },
    isPrimary: { type: Boolean, default: false },
    altText: { type: String },
  },
  { _id: true },
);

const ProductSchema = new Schema<IProduct>(
  {
    sku: {
      type: String,
      trim: true,
      uppercase: true,
      sparse: true, // ✅ allows null/undefined for old products, unique for new ones
      unique: true,
    },
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
    type: {
      type: String,
      trim: true,
    },
    compatibility: {
      type: [String],
      default: [],
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
    color: {
      type: String,
      trim: true,
    },
    material: {
      type: String,
      trim: true,
    },
    dimensions: {
      type: String,
      trim: true,
    },
    weight: {
      type: String,
      trim: true,
    },
    warranty: {
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
    maxOrderQuantity: {
      type: Number,
      min: [1, "Maximum order quantity must be at least 1"],
      default: null,
    },
    enforceOrderLimits: {
      type: Boolean,
      default: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: [3000, "Description cannot exceed 3000 characters"],
    },
    specifications: {
      type: Map,
      of: String,
      default: new Map(),
    },
    images: {
      type: [ProductImageSchema],
      default: [],
      validate: {
        validator: function (images: IProductImage[]) {
          return images.length <= 8;
        },
        message: "Maximum 8 images allowed",
      },
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
  },
);

// Indexes
ProductSchema.index({ category: 1, subCategory: 1 });
ProductSchema.index({ brand: 1 });
ProductSchema.index({ isFeatured: 1 });
ProductSchema.index({ isFastMoving: 1 });
ProductSchema.index({
  name: "text",
  brand: "text",
  description: "text",
  tags: "text",
});
ProductSchema.index({ compatibility: 1 });
// ✅ NEW: compound index for bulk-delete matching (old products without sku)
ProductSchema.index({ name: 1, brand: 1, category: 1 });

// Virtual for primary image URL
ProductSchema.virtual("primaryImage").get(function (this: IProduct) {
  const primary = this.images.find((img) => img.isPrimary);
  return primary ? primary.url : this.images[0]?.url || null;
});

const Product = mongoose.model<IProduct>("Product", ProductSchema);
export default Product;
