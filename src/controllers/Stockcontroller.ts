import { Request, Response, NextFunction } from "express";
import Product from "../models/Product";
import StockAlert from "../models/StockAlert";
import { sendSuccess, sendError } from "../utils/response";
import { sendPushNotification } from "../utils/pushNotification";

// ─── Helper: Send stock alerts when product is restocked ──────────────────────
const sendStockAlerts = async (
  productId: string,
  newQuantity: number,
): Promise<void> => {
  try {
    // Only send if stock is actually available (from 0 to positive)
    if (newQuantity <= 0) return;

    // Find all pending alerts for this product
    const alerts = await StockAlert.find({
      product: productId,
      isNotified: false,
    }).populate("user", "_id phone profile.contactName");

    if (alerts.length === 0) {
      console.log(`ℹ️ No pending alerts for product ${productId}`);
      return;
    }

    const product = await Product.findById(productId).select(
      "name sellingPrice images",
    );
    if (!product) return;

    console.log(
      `🔔 Sending back-in-stock alerts for "${product.name}" to ${alerts.length} users`,
    );

    let sentCount = 0;
    for (const alert of alerts) {
      try {
        await sendPushNotification(
          alert.user._id.toString(),
          "📦 Back in Stock!",
          `${product.name} is now available at ₹${product.sellingPrice}. Stock: ${newQuantity} units. Order now!`,
          {
            type: "back_in_stock",
            screen: `/product/${productId}`,
            productId: productId,
            productName: product.name,
            price: String(product.sellingPrice),
            stock: String(newQuantity),
          },
        );

        // Mark as notified
        alert.isNotified = true;
        await alert.save();
        sentCount++;
      } catch (err) {
        console.error(`Failed to send alert to user ${alert.user._id}:`, err);
      }
    }

    console.log(
      `✅ Stock alerts sent for "${product.name}" - ${sentCount}/${alerts.length} successful`,
    );
  } catch (error) {
    console.error("❌ Failed to send stock alerts:", error);
  }
};

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

// ─── NOTIFY ME WHEN BACK IN STOCK ─────────────────────────────────────────────
// POST /api/stocks/notify-me
// Body: { productId: string }
export const notifyMeWhenInStock = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = (req as any).user?._id;
    if (!userId) {
      sendError(res, "Unauthorized", undefined, 401);
      return;
    }

    const { productId } = req.body;
    if (!productId) {
      sendError(res, "Product ID is required", undefined, 400);
      return;
    }

    // Check if product exists
    const product = await Product.findById(productId);
    if (!product) {
      sendError(res, "Product not found", undefined, 404);
      return;
    }

    // Check for ANY existing alert (notified or not)
    const existingAlert = await StockAlert.findOne({
      user: userId,
      product: productId,
    });

    if (existingAlert) {
      // If the alert exists but was already notified, RESET it
      if (existingAlert.isNotified) {
        existingAlert.isNotified = false;
        await existingAlert.save();

        sendSuccess(
          res,
          "You'll be notified when this product is back in stock",
          {
            alertId: existingAlert._id,
            productName: product.name,
            currentStock: product.stockQuantity,
            reactivated: true,
          },
        );
      } else {
        // Alert exists and is still pending
        sendSuccess(
          res,
          "You're already on the notification list for this product",
          {
            alertId: existingAlert._id,
            productName: product.name,
          },
        );
      }
      return;
    }

    // Create new alert
    const alert = await StockAlert.create({
      user: userId,
      product: productId,
      isNotified: false,
    });

    sendSuccess(res, "You'll be notified when this product is back in stock", {
      alertId: alert._id,
      productName: product.name,
      currentStock: product.stockQuantity,
    });
  } catch (error: any) {
    // Handle duplicate key error
    if (error.code === 11000) {
      // 🔧 FIX: Get userId and productId from request in catch block
      const userId = (req as any).user?._id;
      const productId = req.body?.productId;

      if (!userId || !productId) {
        sendError(res, "Invalid request data", undefined, 400);
        return;
      }

      try {
        const existingAlert = await StockAlert.findOne({
          user: userId,
          product: productId,
        });

        if (existingAlert && existingAlert.isNotified) {
          existingAlert.isNotified = false;
          await existingAlert.save();
          sendSuccess(
            res,
            "You'll be notified when this product is back in stock",
          );
        } else {
          sendSuccess(
            res,
            "You're already on the notification list for this product",
          );
        }
      } catch (resetError) {
        sendSuccess(
          res,
          "You're already on the notification list for this product",
        );
      }
      return;
    }
    next(error);
  }
};

// ─── CHECK NOTIFY STATUS ──────────────────────────────────────────────────────
// GET /api/stocks/notify-status/:productId
export const getNotifyStatus = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = (req as any).user?._id;
    if (!userId) {
      sendError(res, "Unauthorized", undefined, 401);
      return;
    }

    const { productId } = req.params;

    const alert = await StockAlert.findOne({
      user: userId,
      product: productId,
      isNotified: false,
    });

    sendSuccess(res, "Notify status fetched", {
      isSubscribed: !!alert,
      alertId: alert?._id || null,
    });
  } catch (error) {
    next(error);
  }
};

// ─── UNSUBSCRIBE FROM NOTIFICATION ────────────────────────────────────────────
// DELETE /api/stocks/notify-me/:productId
export const unsubscribeNotify = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = (req as any).user?._id;
    if (!userId) {
      sendError(res, "Unauthorized", undefined, 401);
      return;
    }

    const { productId } = req.params;

    const result = await StockAlert.findOneAndDelete({
      user: userId,
      product: productId,
      isNotified: false,
    });

    if (result) {
      sendSuccess(res, "Notification subscription removed");
    } else {
      sendError(res, "No active subscription found", undefined, 404);
    }
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

    // 🔔 Send back-in-stock notifications if stock was 0 and now > 0
    if (prev === 0 && product.stockQuantity > 0) {
      sendStockAlerts(product._id.toString(), product.stockQuantity).catch(
        (err) => console.error("Stock alert failed:", err),
      );
    }

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

    // Get the list of products that were OOS before restocking
    const oosProducts = await Product.find(
      { isActive: true, stockQuantity: 0 },
      "_id",
    ).lean();

    const result = await Product.updateMany(
      { isActive: true, stockQuantity: 0 },
      { $set: { stockQuantity: quantity } },
    );

    // 🔔 Send alerts for each restocked product
    for (const product of oosProducts) {
      sendStockAlerts(product._id.toString(), quantity).catch((err) =>
        console.error(`Stock alert failed for ${product._id}:`, err),
      );
    }

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

// PATCH /api/stocks/:id/toggle-order-limits
export const toggleOrderLimits = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { enforceOrderLimits } = req.body as { enforceOrderLimits: boolean };

    if (typeof enforceOrderLimits !== "boolean") {
      sendError(res, "enforceOrderLimits must be a boolean");
      return;
    }

    const product = await Product.findById(req.params.id);
    if (!product) {
      sendError(res, "Product not found", undefined, 404);
      return;
    }

    product.enforceOrderLimits = enforceOrderLimits;
    await product.save();

    sendSuccess(
      res,
      `Order limits ${enforceOrderLimits ? "enabled" : "disabled"}`,
      {
        _id: product._id,
        name: product.name,
        enforceOrderLimits: product.enforceOrderLimits,
      },
    );
  } catch (error) {
    next(error);
  }
};
