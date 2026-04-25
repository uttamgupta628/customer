import { z } from "zod";

const VALID_UNITS = ["kg", "g", "litre", "ml", "pack", "piece", "dozen", "box"] as const;

// ─── Single Product Schema ─────────────────────────────────────────────────────
export const singleProductSchema = z.object({
  name: z.string().min(1, "Product name is required").max(200),
  brand: z.string().optional(),
  category: z.string().min(1, "Category is required"),
  subCategory: z.string().optional(),
  sellingPrice: z
    .string()
    .or(z.number())
    .transform((v) => parseFloat(String(v)))
    .refine((v) => !isNaN(v) && v >= 0, "Selling price must be a non-negative number"),
  originalPrice: z
    .string()
    .or(z.number())
    .transform((v) => parseFloat(String(v)))
    .refine((v) => !isNaN(v) && v >= 0, "Original price must be a non-negative number")
    .optional(),
  unit: z.enum(VALID_UNITS).default("pack"),
  weightOrSize: z.string().optional(),
  stockQuantity: z
    .string()
    .or(z.number())
    .transform((v) => parseInt(String(v), 10))
    .refine((v) => !isNaN(v) && v >= 0, "Stock quantity must be a non-negative integer"),
  minOrderQuantity: z
    .string()
    .or(z.number())
    .transform((v) => parseInt(String(v), 10))
    .refine((v) => !isNaN(v) && v >= 1, "Min order quantity must be at least 1")
    .optional()
    .default(1),
  description: z.string().max(2000).optional(),
  tags: z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : []
    ),
  isFastMoving: z
    .string()
    .or(z.boolean())
    .transform((v) => v === true || v === "true" || v === "yes")
    .optional()
    .default(false),
  isFeatured: z
    .string()
    .or(z.boolean())
    .transform((v) => v === true || v === "true" || v === "yes")
    .optional()
    .default(false),
});

// ─── CSV Row Schema (for bulk upload validation) ───────────────────────────────
export const csvRowSchema = z.object({
  name: z.string().min(1, "name is required"),
  brand: z.string().optional().default(""),
  category: z.string().min(1, "category is required"),
  sub_category: z.string().optional().default(""),
  price: z
    .string()
    .transform((v) => parseFloat(v))
    .refine((v) => !isNaN(v) && v >= 0, "price must be a valid number"),
  original_price: z
    .string()
    .optional()
    .transform((v) => (v ? parseFloat(v) : undefined)),
  unit: z
    .string()
    .optional()
    .transform((v) => (VALID_UNITS.includes(v as (typeof VALID_UNITS)[number]) ? v : "pack"))
    .default("pack"),
  weight: z.string().optional().default(""),
  description: z.string().optional().default(""),
  image_url: z.string().url().optional().or(z.literal("")).default(""),
  min_order_qty: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 1))
    .default("1"),
  fast_moving: z
    .string()
    .optional()
    .transform((v) => v === "yes" || v === "true")
    .default("no"),
  featured: z
    .string()
    .optional()
    .transform((v) => v === "yes" || v === "true")
    .default("no"),
  stock: z
    .string()
    .transform((v) => parseInt(v, 10))
    .refine((v) => !isNaN(v) && v >= 0, "stock must be a valid non-negative integer"),
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
        : []
    )
    .default(""),
});

export type SingleProductInput = z.infer<typeof singleProductSchema>;
export type CsvRowInput = z.infer<typeof csvRowSchema>;
