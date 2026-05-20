import mongoose, { Document, Schema } from "mongoose";

// ─── Sub-document types ───────────────────────────────────────────────────────

export interface IOrderItem {
  product: mongoose.Types.ObjectId;
  name: string;
  brand?: string;
  category?: string;
  type?: string;
  color?: string;
  warranty?: string;
  imageUrl?: string;
  images?: {
    url: string;
    publicId: string;
    isPrimary: boolean;
    altText?: string;
  }[];
  specifications?: Record<string, string>;
  compatibility?: string[];
  dimensions?: string;
  weight?: string;
  material?: string;
  sellingPrice: number;
  originalPrice?: number;
  quantity: number;
  lineTotal: number;
}

export interface IOrderAddress {
  contactName: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  pincode: string;
  phone: string;
}

// ✅ Added "completed" to OrderStatus type
export type OrderStatus =
  | "pending"
  | "confirmed"
  | "processing"
  | "out_for_delivery"
  | "delivered"
  | "completed"
  | "cancelled";

export type PaymentMethod = "upi" | "cod" | "card" | "netbanking";
export type PaymentStatus = "pending" | "paid" | "failed" | "refunded";

export interface IOrder extends Document {
  orderNumber: string;
  customer: mongoose.Types.ObjectId;
  items: IOrderItem[];
  deliveryAddress: IOrderAddress;

  // Pricing
  subtotal: number;
  couponCode?: string;
  couponDiscount: number;
  deliveryCharge: number;
  platformFee: number;
  gst: number;
  deliveryTip: number;
  totalAmount: number;

  // Payment
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  transactionId?: string;

  // Status
  status: OrderStatus;
  statusHistory: { status: OrderStatus; timestamp: Date; note?: string }[];

  // Timestamps
  placedAt: Date;
  estimatedDelivery?: Date;
  deliveredAt?: Date;
  cancelledAt?: Date;
  cancellationReason?: string;

  createdAt: Date;
  updatedAt: Date;
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const OrderItemSchema = new Schema<IOrderItem>(
  {
    product: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    name: { type: String, required: true, trim: true },
    brand: { type: String, trim: true },
    category: { type: String, trim: true },
    type: { type: String, trim: true },
    color: { type: String, trim: true },
    warranty: { type: String, trim: true },
    imageUrl: { type: String },
    images: [
      {
        url: { type: String },
        publicId: { type: String },
        isPrimary: { type: Boolean, default: false },
        altText: { type: String },
      },
    ],
    specifications: { type: Map, of: String },
    compatibility: [{ type: String, trim: true }],
    dimensions: { type: String, trim: true },
    weight: { type: String, trim: true },
    material: { type: String, trim: true },
    sellingPrice: { type: Number, required: true, min: 0 },
    originalPrice: { type: Number, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
    lineTotal: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const OrderAddressSchema = new Schema<IOrderAddress>(
  {
    contactName: { type: String, required: true, trim: true },
    addressLine1: { type: String, required: true, trim: true },
    addressLine2: { type: String, trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    pincode: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
  },
  { _id: false },
);

// ✅ Added "completed" to StatusHistorySchema enum
const StatusHistorySchema = new Schema(
  {
    status: {
      type: String,
      enum: [
        "pending",
        "confirmed",
        "processing",
        "out_for_delivery",
        "delivered",
        "completed",
        "cancelled",
      ],
      required: true,
    },
    timestamp: { type: Date, default: Date.now },
    note: { type: String, trim: true },
  },
  { _id: false },
);

// ─── Counter for order number generation ─────────────────────────────────────

const CounterSchema = new Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});
const Counter =
  mongoose.models.Counter || mongoose.model("Counter", CounterSchema);

// ─── Main Order Schema ────────────────────────────────────────────────────────

const OrderSchema = new Schema<IOrder>(
  {
    orderNumber: {
      type: String,
      unique: true,
      // auto-generated in pre-save
    },
    customer: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    items: {
      type: [OrderItemSchema],
      required: true,
      validate: {
        validator: (v: IOrderItem[]) => v.length > 0,
        message: "Order must have at least one item",
      },
    },
    deliveryAddress: {
      type: OrderAddressSchema,
      required: true,
    },

    // ── Pricing ──
    subtotal: { type: Number, required: true, min: 0 },
    couponCode: { type: String, trim: true, uppercase: true },
    couponDiscount: { type: Number, default: 0, min: 0 },
    deliveryCharge: { type: Number, default: 0, min: 0 },
    platformFee: { type: Number, default: 0, min: 0 },
    gst: { type: Number, default: 0, min: 0 },
    deliveryTip: { type: Number, default: 0, min: 0 },
    totalAmount: { type: Number, required: true, min: 0 },

    // ── Payment ──
    paymentMethod: {
      type: String,
      enum: ["upi", "cod", "card", "netbanking"],
      default: "upi",
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed", "refunded"],
      default: "pending",
    },
    transactionId: { type: String, trim: true },

    // ✅ Added "completed" to status enum
    status: {
      type: String,
      enum: [
        "pending",
        "confirmed",
        "processing",
        "out_for_delivery",
        "delivered",
        "completed",
        "cancelled",
      ],
      default: "pending",
      index: true,
    },
    statusHistory: {
      type: [StatusHistorySchema],
      default: [],
    },

    // ── Timestamps ──
    placedAt: { type: Date, default: Date.now },
    estimatedDelivery: { type: Date },
    deliveredAt: { type: Date },
    cancelledAt: { type: Date },
    cancellationReason: { type: String, trim: true },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// ─── Auto-generate order number ───────────────────────────────────────────────

OrderSchema.pre("save", async function (next) {
  if (!this.isNew) return next();
  try {
    const counter = await Counter.findByIdAndUpdate(
      "orderNumber",
      { $inc: { seq: 1 } },
      { new: true, upsert: true },
    );
    const padded = String(counter.seq).padStart(6, "0");
    this.orderNumber = `ORD-${padded}`;
    next();
  } catch (err) {
    next(err as Error);
  }
});

// ─── Indexes ──────────────────────────────────────────────────────────────────

OrderSchema.index({ customer: 1, createdAt: -1 });
OrderSchema.index({ status: 1, createdAt: -1 });
OrderSchema.index({ orderNumber: 1 }, { unique: true });

const Order = mongoose.model<IOrder>("Order", OrderSchema);
export default Order;
