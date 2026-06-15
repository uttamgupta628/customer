import { z } from "zod";

// ─── Constants ────────────────────────────────────────────────────────────────
export const CATEGORIES = [
  "charging-cables",
  "chargers-adapters",
  "power-banks",
  "headphones-earphones",
  "speakers",
  "screen-protectors",
  "cases-covers",
  "mounts-stands",
  "cables-connectors",
  "storage-devices",
  "gaming-accessories",
  "smartwatch-accessories",
  "keyboard-mouse",
  "webcam-microphone",
  "other-accessories",
] as const;

const GST_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
export const isGstValid = (gst: string): boolean =>
  GST_REGEX.test(gst.trim().toUpperCase());

export const VALID_COLORS = [
  "Black",
  "White",
  "Silver",
  "Gold",
  "Rose Gold",
  "Blue",
  "Red",
  "Green",
  "Purple",
  "Grey",
  "Navy",
  "Transparent",
  "Multicolor",
] as const;

export const VALID_MATERIALS = [
  "Silicone",
  "Plastic",
  "Metal",
  "Aluminum",
  "Platinum",
  "Rubber",
  "Leather",
  "Fabric",
  "TPU",
  "Polycarbonate",
  "Glass",
  "Ceramic",
  "Braided Nylon",
  "ABS",
  "Zinc Alloy",
] as const;

export const WARRANTY_OPTIONS = [
  "No Warranty",
  "3 Months",
  "6 Months",
  "1 Year",
  "2 Years",
  "3 Years",
  "5 Years",
  "Lifetime",
] as const;

export const COMPATIBILITY_OPTIONS = [
  "iPhone 15",
  "iPhone 14",
  "iPhone 13",
  "iPhone 12",
  "iPhone 11",
  "Android USB-C",
  "Android Micro USB",
  "iPad",
  "MacBook",
  "Laptop USB-C",
  "Gaming Console",
  "Smartwatch",
  "Universal",
] as const;

// ─── Single Product Schema ─────────────────────────────────────────────────────
export const singleProductSchema = z.object({
  sku: z.string().trim().toUpperCase().optional(), // ✅ NEW
  name: z.string().min(1, "Product name is required").max(200),
  brand: z.string().optional(),
  category: z.string().min(1, "Category is required"),
  subCategory: z.string().optional(),
  type: z.string().optional(),
  compatibility: z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(",")
            .map((c) => c.trim())
            .filter(Boolean)
        : [],
    ),
  sellingPrice: z
    .string()
    .or(z.number())
    .transform((v) => parseFloat(String(v)))
    .refine(
      (v) => !isNaN(v) && v >= 0,
      "Selling price must be a non-negative number",
    ),
  originalPrice: z
    .string()
    .or(z.number())
    .transform((v) => parseFloat(String(v)))
    .refine(
      (v) => !isNaN(v) && v >= 0,
      "Original price must be a non-negative number",
    )
    .optional(),
  color: z.string().optional(),
  material: z.string().optional(),
  dimensions: z.string().optional(),
  weight: z.string().optional(),
  warranty: z.string().optional().default("No Warranty"),
  stockQuantity: z
    .string()
    .or(z.number())
    .transform((v) => parseInt(String(v), 10))
    .refine(
      (v) => !isNaN(v) && v >= 0,
      "Stock quantity must be a non-negative integer",
    ),
  minOrderQuantity: z
    .string()
    .or(z.number())
    .transform((v) => parseInt(String(v), 10))
    .refine((v) => !isNaN(v) && v >= 1, "Min order quantity must be at least 1")
    .optional()
    .default(1),
  maxOrderQuantity: z
    .string()
    .or(z.number())
    .transform((v) => parseInt(String(v), 10))
    .refine((v) => !isNaN(v) && v >= 1, "Max order quantity must be at least 1")
    .optional()
    .nullable()
    .default(null),
  description: z.string().max(3000).optional(),
  specifications: z
    .string()
    .optional()
    .transform((v) => {
      if (!v) return new Map<string, string>();
      try {
        const obj = JSON.parse(v);
        const map = new Map<string, string>();
        Object.entries(obj).forEach(([key, val]) => {
          map.set(key, String(val));
        });
        return map;
      } catch {
        const map = new Map<string, string>();
        v.split(";").forEach((pair) => {
          const [key, value] = pair.split(":").map((s) => s.trim());
          if (key && value) map.set(key, value);
        });
        return map;
      }
    }),
  tags: z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : [],
    ),
  isFastMoving: z
    .string()
    .or(z.boolean())
    .transform((v) => v === true || v === "true" || v === "yes" || v === "1")
    .optional()
    .default(false),
  isFeatured: z
    .string()
    .or(z.boolean())
    .transform((v) => v === true || v === "true" || v === "yes" || v === "1")
    .optional()
    .default(false),
});

// ─── CSV Row Schema (for bulk INSERT) ─────────────────────────────────────────
export const csvRowSchema = z.object({
  sku: z.string().trim().toUpperCase().optional().default(""), // ✅ NEW
  name: z.string().min(1, "name is required"),
  brand: z.string().optional().default(""),
  category: z.string().min(1, "category is required"),
  sub_category: z.string().optional().default(""),
  type: z.string().optional().default(""),
  compatibility: z.string().optional().default(""),
  price: z
    .string()
    .transform((v) => parseFloat(v))
    .refine((v) => !isNaN(v) && v >= 0, "price must be a valid number"),
  original_price: z
    .string()
    .optional()
    .transform((v) => (v ? parseFloat(v) : undefined)),
  color: z.string().optional().default(""),
  material: z.string().optional().default(""),
  dimensions: z.string().optional().default(""),
  weight: z.string().optional().default(""),
  warranty: z.string().optional().default("No Warranty"),
  description: z.string().optional().default(""),
  specifications: z.string().optional().default(""),
  image_urls: z.string().optional().default(""),
  min_order_qty: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 1))
    .default("1"),
  max_order_qty: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : null))
    .nullable()
    .default(null),
  fast_moving: z
    .string()
    .optional()
    .transform((v) => v?.toLowerCase() === "yes" || v?.toLowerCase() === "true")
    .default("no"),
  featured: z
    .string()
    .optional()
    .transform((v) => v?.toLowerCase() === "yes" || v?.toLowerCase() === "true")
    .default("no"),
  stock: z
    .string()
    .transform((v) => parseInt(v, 10))
    .refine(
      (v) => !isNaN(v) && v >= 0,
      "stock must be a valid non-negative integer",
    ),
  tags: z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .replace(/['"]/g, "")
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : [],
    )
    .default(""),
});

// ─── CSV Row Schema for Bulk UPDATE ──────────────────────────────────────────
// sku is required here — it's the lookup key
// all other fields optional — only provided fields get updated
export const csvUpdateRowSchema = z.object({
  sku: z
    .string()
    .min(1, "sku is required for bulk update")
    .trim()
    .toUpperCase(),
  name: z.string().min(1).max(200).optional(),
  brand: z.string().optional(),
  category: z.string().optional(),
  sub_category: z.string().optional(),
  type: z.string().optional(),
  compatibility: z.string().optional(),
  price: z
    .string()
    .optional()
    .transform((v) => (v ? parseFloat(v) : undefined))
    .refine(
      (v) => v === undefined || (!isNaN(v) && v >= 0),
      "price must be a valid number",
    ),
  original_price: z
    .string()
    .optional()
    .transform((v) => (v ? parseFloat(v) : undefined)),
  color: z.string().optional(),
  material: z.string().optional(),
  dimensions: z.string().optional(),
  weight: z.string().optional(),
  warranty: z.string().optional(),
  description: z.string().optional(),
  specifications: z.string().optional(),
  min_order_qty: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : undefined)),
  max_order_qty: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : undefined)),
  fast_moving: z
    .string()
    .optional()
    .transform((v) =>
      v ? v.toLowerCase() === "yes" || v.toLowerCase() === "true" : undefined,
    ),
  featured: z
    .string()
    .optional()
    .transform((v) =>
      v ? v.toLowerCase() === "yes" || v.toLowerCase() === "true" : undefined,
    ),
  stock: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : undefined))
    .refine(
      (v) => v === undefined || (!isNaN(v) && v >= 0),
      "stock must be a valid non-negative integer",
    ),
  tags: z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .replace(/['"]/g, "")
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : undefined,
    ),
});

// ─── CSV Row Schema for Bulk DELETE ──────────────────────────────────────────
// Match by name + brand + category (old products have no sku)
export const csvDeleteRowSchema = z.object({
  name: z.string().min(1, "name is required for bulk delete"),
  brand: z.string().optional().default(""),
  category: z.string().min(1, "category is required for bulk delete"),
});

export type SingleProductInput = z.infer<typeof singleProductSchema>;
export type CsvRowInput = z.infer<typeof csvRowSchema>;
export type CsvUpdateRowInput = z.infer<typeof csvUpdateRowSchema>;
export type CsvDeleteRowInput = z.infer<typeof csvDeleteRowSchema>;
