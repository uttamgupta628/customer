import { Request, Response, NextFunction } from "express";
import Product from "../models/Product";
import { sendSuccess, sendError } from "../utils/response";

// ─── GET STOCK STATS ───────────────────────────────────────────────────────────
// GET /api/stocks/stats
export const getStockStats = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const [total, outOfStock, fastMoving, featured, lowStockDocs] =
      await Promise.all([
        Product.countDocuments({ isActive: true }),
        Product.countDocuments({ isActive: true, stockQuantity: 0 }),
        Product.countDocuments({ isActive: true, isFastMoving: true }),
        Product.countDocuments({ isActive: true, isFeatured: true }),
        Product.find(
          { isActive: true, stockQuantity: { $gt: 0 } },
          { stockQuantity: 1, isFastMoving: 1 },
        ).lean(),
      ]);

    // A product is "low stock" if qty <= its threshold (fastMoving ? 20 : 10)
    const lowStock = lowStockDocs.filter(
      (p) => p.stockQuantity <= (p.isFastMoving ? 20 : 10),
    ).length;

    const inStock = total - outOfStock - lowStock;

    sendSuccess(
      res,
      "Electronics accessories stock stats fetched successfully",
      {
        total,
        inStock: Math.max(0, inStock),
        outOfStock,
        lowStock,
        fastMoving,
        featured,
      },
    );
  } catch (error) {
    next(error);
  }
};

// ─── GET STOCK LIST ────────────────────────────────────────────────────────────
// GET /api/stocks?page=1&limit=20&category=&search=&fastMoving=true&brand=
export const getStockList = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const {
      page = "1",
      limit = "20",
      category,
      brand,
      type,
      fastMoving,
      featured,
      search,
      compatibility,
      color,
      warranty,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10));
    const limitNum = Math.min(100, parseInt(limit as string, 10));
    const skip = (pageNum - 1) * limitNum;

    const filter: Record<string, unknown> = { isActive: true };

    if (category) filter.category = (category as string).toLowerCase();
    if (brand) filter.brand = brand as string;
    if (type) filter.type = type as string;
    if (fastMoving === "true") filter.isFastMoving = true;
    if (featured === "true") filter.isFeatured = true;
    if (color) filter.color = color as string;
    if (warranty) filter.warranty = warranty as string;
    if (compatibility)
      filter.compatibility = { $in: [compatibility as string] };
    if (search) filter.$text = { $search: search as string };

    const [products, total] = await Promise.all([
      Product.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Product.countDocuments(filter),
    ]);

    sendSuccess(res, "Stock list fetched successfully", {
      products,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    next(error);
  }
};

// ─── ADJUST QUANTITY ───────────────────────────────────────────────────────────
// PATCH /api/stocks/:id/quantity
// Body: { mode: "increment" | "decrement" | "set", value: number }
export const adjustQuantity = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { mode, value } = req.body as {
      mode: "increment" | "decrement" | "set";
      value: number;
    };

    if (!["increment", "decrement", "set"].includes(mode)) {
      sendError(res, 'mode must be "increment", "decrement", or "set"');
      return;
    }
    const val = parseInt(String(value), 10);
    if (isNaN(val) || val < 0) {
      sendError(res, "value must be a non-negative integer");
      return;
    }

    const product = await Product.findById(req.params.id);
    if (!product) {
      sendError(res, "Product not found", undefined, 404);
      return;
    }

    const prev = product.stockQuantity;
    if (mode === "increment") product.stockQuantity = prev + val;
    else if (mode === "decrement")
      product.stockQuantity = Math.max(0, prev - val);
    else product.stockQuantity = val;

    await product.save();

    sendSuccess(res, "Stock quantity updated", {
      _id: product._id,
      name: product.name,
      brand: product.brand,
      category: product.category,
      type: product.type,
      previousQty: prev,
      newQuantity: product.stockQuantity,
    });
  } catch (error) {
    next(error);
  }
};

// ─── TOGGLE FAST MOVING ────────────────────────────────────────────────────────
// PATCH /api/stocks/:id/fast-moving
// Body: { isFastMoving: boolean }
export const toggleFastMoving = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { isFastMoving } = req.body as { isFastMoving: boolean };
    if (typeof isFastMoving !== "boolean") {
      sendError(res, "isFastMoving must be a boolean");
      return;
    }

    const product = await Product.findById(req.params.id);
    if (!product) {
      sendError(res, "Product not found", undefined, 404);
      return;
    }

    product.isFastMoving = isFastMoving;
    await product.save();

    sendSuccess(
      res,
      `Product ${isFastMoving ? "marked as" : "removed from"} fast moving`,
      {
        _id: product._id,
        name: product.name,
        brand: product.brand,
        category: product.category,
        isFastMoving: product.isFastMoving,
      },
    );
  } catch (error) {
    next(error);
  }
};

// ─── TOGGLE FEATURED ───────────────────────────────────────────────────────────
// PATCH /api/stocks/:id/featured
// Body: { isFeatured: boolean }
export const toggleFeatured = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { isFeatured } = req.body as { isFeatured: boolean };
    if (typeof isFeatured !== "boolean") {
      sendError(res, "isFeatured must be a boolean");
      return;
    }

    const product = await Product.findById(req.params.id);
    if (!product) {
      sendError(res, "Product not found", undefined, 404);
      return;
    }

    product.isFeatured = isFeatured;
    await product.save();

    sendSuccess(
      res,
      `Product ${isFeatured ? "marked as" : "removed from"} featured`,
      {
        _id: product._id,
        name: product.name,
        brand: product.brand,
        category: product.category,
        isFeatured: product.isFeatured,
      },
    );
  } catch (error) {
    next(error);
  }
};

// ─── SET ALERT THRESHOLD ───────────────────────────────────────────────────────
// PATCH /api/stocks/:id/alert
// Body: { alertAt: number | null }
export const setAlertThreshold = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { alertAt } = req.body as { alertAt: number | null };

    if (alertAt !== null && (typeof alertAt !== "number" || alertAt < 0)) {
      sendError(res, "alertAt must be a non-negative number or null");
      return;
    }

    const product = await Product.findById(req.params.id);
    if (!product) {
      sendError(res, "Product not found", undefined, 404);
      return;
    }

    product.alertAt = alertAt;
    await product.save();

    sendSuccess(res, "Alert threshold updated", {
      _id: product._id,
      name: product.name,
      alertAt: product.alertAt,
    });
  } catch (error) {
    next(error);
  }
};

// ─── RESTOCK ALL OUT-OF-STOCK ──────────────────────────────────────────────────
// POST /api/stocks/restock-all-oos
// Body: { quantity?: number }  default 10
export const restockAllOOS = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const quantity = parseInt(String(req.body?.quantity ?? 10), 10);
    if (isNaN(quantity) || quantity < 1) {
      sendError(res, "quantity must be a positive integer");
      return;
    }

    const result = await Product.updateMany(
      { isActive: true, stockQuantity: 0 },
      { $set: { stockQuantity: quantity } },
    );

    sendSuccess(
      res,
      `${result.modifiedCount} out-of-stock electronics products restocked to ${quantity}`,
      { updatedCount: result.modifiedCount, quantity },
    );
  } catch (error) {
    next(error);
  }
};

// ─── EXPORT CSV ────────────────────────────────────────────────────────────────
// GET /api/stocks/export-csv
export const exportStockCSV = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const products = await Product.find({ isActive: true })
      .sort({ category: 1, name: 1 })
      .lean();

    // Updated headers for electronics accessories
    const headers = [
      "Name",
      "Brand",
      "Category",
      "Sub Category",
      "Type",
      "Compatibility",
      "Color",
      "Material",
      "Dimensions",
      "Weight",
      "Warranty",
      "Stock Qty",
      "Min Order Qty",
      "Selling Price (₹)",
      "Original Price (₹)",
      "Fast Moving",
      "Featured",
      "Alert At",
      "Image URLs",
      "Tags",
      "Created At",
    ];

    const escape = (v: unknown) => {
      const s = String(v ?? "");
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    };

    const rows = products.map((p) => {
      // Get primary image URL or first image
      const primaryImage =
        p.images?.find((img: any) => img.isPrimary)?.url ||
        p.images?.[0]?.url ||
        "";

      // Get all image URLs
      const allImageUrls = p.images?.map((img: any) => img.url).join(";") || "";

      // Get specifications as string
      const specs =
        p.specifications instanceof Map
          ? Array.from(p.specifications.entries())
              .map(([k, v]) => `${k}:${v}`)
              .join(";")
          : JSON.stringify(p.specifications || {});

      return [
        p.name,
        p.brand ?? "",
        p.category,
        p.subCategory ?? "",
        p.type ?? "",
        (p.compatibility ?? []).join(";"),
        p.color ?? "",
        p.material ?? "",
        p.dimensions ?? "",
        p.weight ?? "",
        p.warranty ?? "No Warranty",
        p.stockQuantity,
        p.minOrderQuantity,
        p.sellingPrice,
        p.originalPrice ?? "",
        p.isFastMoving ? "Yes" : "No",
        p.isFeatured ? "Yes" : "No",
        p.alertAt ?? "",
        allImageUrls,
        (p.tags ?? []).join(";"),
        new Date(p.createdAt).toLocaleDateString("en-IN"),
      ]
        .map(escape)
        .join(",");
    });

    const csv = [headers.join(","), ...rows].join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="electronics_stock_report_${Date.now()}.csv"`,
    );
    res.send(csv);
  } catch (error) {
    next(error);
  }
};

// ─── GET ACTIVITY LOG ──────────────────────────────────────────────────────────
// GET /api/stocks/activity-log
// TODO: replace with real ActivityLog model query when you create it
export const getActivityLog = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    sendSuccess(res, "Activity log fetched", {
      logs: [],
      pagination: { total: 0, page: 1, limit: 20, totalPages: 0 },
    });
  } catch (error) {
    next(error);
  }
};
