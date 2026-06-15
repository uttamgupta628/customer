import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import streamifier from "streamifier";
import Product, { IProductImage } from "../models/Product";
import cloudinary from "../config/cloudinary";
import {
  singleProductSchema,
  csvRowSchema,
  csvUpdateRowSchema,
  csvDeleteRowSchema,
} from "../utils/validators";
import { parseFileBuffer } from "../utils/fileParser";
import { sendSuccess, sendError } from "../utils/response";
import { UploadApiResponse } from "cloudinary";
import mongoose from "mongoose";
import {
  convertToDirectImageUrl,
  isGoogleDriveUrl,
} from "../utils/googleDriveParser";
import { sendPushNotification } from "../utils/pushNotification";
import User from "../models/Users";

// ─── Helper: upload a Buffer to Cloudinary ────────────────────────────────────
const uploadBufferToCloudinary = (
  buffer: Buffer,
  originalName: string,
): Promise<UploadApiResponse> => {
  return new Promise((resolve, reject) => {
    const publicId = `electronics_${Date.now()}_${originalName.replace(
      /\.[^/.]+$/,
      "",
    )}`;

    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: "electronics-accessories",
        public_id: publicId,
        allowed_formats: ["jpg", "jpeg", "png", "webp"],
        transformation: [
          {
            width: 1200,
            height: 1200,
            crop: "limit",
            quality: "auto:best",
            fetch_format: "auto",
          },
        ],
      },
      (error, result) => {
        if (error || !result)
          return reject(error ?? new Error("Cloudinary upload failed"));
        resolve(result);
      },
    );

    streamifier.createReadStream(buffer).pipe(uploadStream);
  });
};

// ─── Helper: Send Product Notifications ───────────────────────────────────────
const notifyNewProducts = async (
  products: Array<{
    _id: mongoose.Types.ObjectId | string;
    name: string;
    sellingPrice: number;
  }>,
  isBulk: boolean,
): Promise<void> => {
  try {
    const users = await User.find({
      role: "customer",
      isActive: true,
    }).lean();

    if (users.length === 0) {
      console.log("⚠️ No active customers to notify");
      return;
    }

    let title: string;
    let body: string;
    let data: Record<string, string>;

    if (isBulk) {
      const productNames = products
        .slice(0, 3)
        .map((p) => p.name)
        .join(", ");
      const moreText =
        products.length > 3 ? ` and ${products.length - 3} more` : "";

      title = "🆕 New Products Arrived!";
      body = `${products.length} new products added${productNames ? `: ${productNames}${moreText}` : ""}. Check them out now!`;

      data = {
        type: "new_products",
        screen: "/products",
        count: String(products.length),
      };
    } else if (products.length === 1) {
      const product = products[0];
      title = "🆕 New Product Added!";
      body = `${product.name} is now available at ₹${product.sellingPrice}. Tap to view details!`;

      data = {
        type: "new_product",
        screen: `/product/${product._id}`,
        productId: product._id.toString(),
        productName: product.name,
        price: String(product.sellingPrice),
      };
    } else {
      title = "🆕 New Products Available!";
      body = `Check out our latest additions to the catalog.`;

      data = {
        type: "new_products",
        screen: "/products",
      };
    }

    console.log(`📢 Sending product notification to ${users.length} users`);

    let sentCount = 0;
    for (const user of users) {
      try {
        await sendPushNotification(user._id.toString(), title, body, data);
        sentCount++;
      } catch (err) {
        console.error(`Failed to send to user ${user._id}:`, err);
      }
    }

    console.log(
      `✅ Product notification sent to ${sentCount}/${users.length} users`,
    );
  } catch (error) {
    console.error("❌ Failed to send product notification:", error);
  }
};

// ─── Helper: sanitize CSV/Excel row ──────────────────────────────────────────
function sanitizeRow(row: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) {
    const cleaned = value
      .trim()
      .replace(/^[₹$€£¥\s]+/, "")
      .replace(/^["']|["']$/g, "");
    out[key] = cleaned;
  }
  for (const numField of [
    "price",
    "original_price",
    "stock",
    "min_order_qty",
  ]) {
    if (out[numField]) {
      out[numField] = out[numField].replace(/,/g, "").replace(/\.00$/, "");
    }
  }
  return out;
}

// ─── Helper: parse image URLs from a row ─────────────────────────────────────
function parseImageUrls(
  row: Record<string, string>,
  rowIndex: number,
): { url: string; publicId: string; isPrimary: boolean; altText: string }[] {
  const imageUrls: string[] = [];

  for (let j = 1; j <= 8; j++) {
    const imgValue = row[`image_${j}`];
    if (imgValue && String(imgValue).trim()) {
      const url = String(imgValue).trim();
      if (isGoogleDriveUrl(url)) {
        const converted = convertToDirectImageUrl(url);
        if (converted) imageUrls.push(converted);
        else console.warn(`⚠️ Failed to convert Google Drive URL: ${url}`);
      } else {
        imageUrls.push(url);
      }
    }
  }

  if (imageUrls.length === 0 && row["image_urls"]) {
    String(row["image_urls"])
      .split(",")
      .map((u) => u.trim())
      .filter(Boolean)
      .forEach((url) => {
        if (isGoogleDriveUrl(url)) {
          const converted = convertToDirectImageUrl(url);
          if (converted) imageUrls.push(converted);
        } else {
          imageUrls.push(url);
        }
      });
  }

  return imageUrls.map((url, index) => ({
    url,
    publicId: `bulk_${Date.now()}_${rowIndex}_${index}`,
    isPrimary: index === 0,
    altText: `Image ${index + 1}`,
  }));
}

// ─── Helper: parse specifications string to Map ───────────────────────────────
function parseSpecifications(
  specsStr: string | undefined,
): Map<string, string> {
  const map = new Map<string, string>();
  if (!specsStr) return map;
  try {
    specsStr.split(";").forEach((pair) => {
      const [key, value] = pair.split(":").map((s) => s.trim());
      if (key && value) map.set(key, value);
    });
  } catch {
    // skip invalid
  }
  return map;
}

// ─── ADD SINGLE PRODUCT ────────────────────────────────────────────────────────
// POST /api/products/single
export const addSingleProduct = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const parseResult = singleProductSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: parseResult.error.flatten().fieldErrors,
      });
      return;
    }

    const data = parseResult.data;

    const imageFiles = req.files as Express.Multer.File[] | undefined;
    const images: IProductImage[] = [];

    if (imageFiles && imageFiles.length > 0) {
      if (imageFiles.length > 8) {
        sendError(res, "Maximum 8 images allowed", undefined, 400);
        return;
      }

      try {
        const uploadPromises = imageFiles.map(async (file, index) => {
          const cloudResult = await uploadBufferToCloudinary(
            file.buffer,
            file.originalname,
          );
          return {
            url: cloudResult.secure_url,
            publicId: cloudResult.public_id,
            isPrimary: index === 0,
            altText: `${data.name} - Image ${index + 1}`,
          };
        });

        const uploadedImages = await Promise.all(uploadPromises);
        images.push(...uploadedImages);
      } catch (uploadErr) {
        res.status(502).json({
          success: false,
          message: "Image upload to Cloudinary failed. Product was not saved.",
          errors: uploadErr instanceof Error ? uploadErr.message : uploadErr,
        });
        return;
      }
    }

    const product = new Product({
      sku: data.sku || undefined, // ✅ NEW
      name: data.name,
      brand: data.brand,
      category: data.category,
      subCategory: data.subCategory,
      type: data.type,
      compatibility: data.compatibility,
      sellingPrice: data.sellingPrice,
      originalPrice: data.originalPrice,
      color: data.color,
      material: data.material,
      dimensions: data.dimensions,
      weight: data.weight,
      warranty: data.warranty || "No Warranty",
      stockQuantity: data.stockQuantity,
      minOrderQuantity: data.minOrderQuantity,
      maxOrderQuantity: data.maxOrderQuantity || null,
      description: data.description,
      specifications: data.specifications || new Map(),
      images,
      tags: data.tags ?? [],
      isFastMoving: data.isFastMoving ?? false,
      isFeatured: data.isFeatured ?? false,
    });

    await product.save();

    notifyNewProducts(
      [
        {
          _id: product._id as mongoose.Types.ObjectId,
          name: product.name,
          sellingPrice: product.sellingPrice,
        },
      ],
      false,
    ).catch((err) => console.error("Single product notification failed:", err));

    sendSuccess(res, "Product added successfully", product, 201);
  } catch (error) {
    next(error);
  }
};

// ─── BULK UPLOAD PRODUCTS ──────────────────────────────────────────────────────
// POST /api/products/bulk
export const bulkUploadProducts = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.file) {
      sendError(res, "No file uploaded. Please upload a CSV or Excel file.");
      return;
    }

    let rawRows: Record<string, string>[];
    try {
      rawRows = parseFileBuffer(
        req.file.buffer,
        req.file.mimetype,
        req.file.originalname,
      );
    } catch (parseError) {
      sendError(
        res,
        "Failed to parse the uploaded file. Ensure it is a valid CSV or Excel file.",
        parseError instanceof Error ? parseError.message : parseError,
      );
      return;
    }

    if (!rawRows.length) {
      sendError(res, "The uploaded file is empty or has no data rows.");
      return;
    }

    const validProducts: object[] = [];
    const failedRows: {
      row: number;
      data: Record<string, string>;
      errors: unknown;
    }[] = [];

    for (let i = 0; i < rawRows.length; i++) {
      const row = sanitizeRow(rawRows[i]);
      const result = csvRowSchema.safeParse(row);

      if (result.success) {
        const d = result.data;
        const images = parseImageUrls(row, i);

        validProducts.push({
          sku: d.sku || undefined, // ✅ NEW
          name: d.name,
          brand: d.brand || undefined,
          category: d.category,
          subCategory: d.sub_category || undefined,
          type: d.type || undefined,
          compatibility: d.compatibility
            ? d.compatibility
                .split(",")
                .map((c) => c.trim())
                .filter(Boolean)
            : [],
          sellingPrice: d.price,
          originalPrice: d.original_price,
          color: d.color || undefined,
          material: d.material || undefined,
          dimensions: d.dimensions || undefined,
          weight: d.weight || undefined,
          warranty: d.warranty || "No Warranty",
          stockQuantity: d.stock,
          minOrderQuantity: d.min_order_qty,
          maxOrderQuantity: d.max_order_qty || null,
          description: d.description || undefined,
          specifications: parseSpecifications(d.specifications),
          images,
          tags: d.tags,
          isFastMoving: d.fast_moving,
          isFeatured: d.featured,
        });
      } else {
        failedRows.push({
          row: i + 2,
          data: row,
          errors:
            result.error instanceof ZodError
              ? result.error.flatten().fieldErrors
              : result.error,
        });
      }
    }

    let insertedProducts: object[] = [];
    if (validProducts.length > 0) {
      try {
        insertedProducts = await Product.insertMany(validProducts, {
          ordered: false,
        });

        if (insertedProducts.length > 0) {
          const productSummaries = (insertedProducts as any[]).map((p) => ({
            _id: p._id,
            name: p.name,
            sellingPrice: p.sellingPrice,
          }));
          notifyNewProducts(productSummaries, true).catch((err) =>
            console.error("Bulk upload notification failed:", err),
          );
        }
      } catch (insertError) {
        if (insertError instanceof mongoose.Error) {
          console.error("Bulk insert error:", insertError);
        }
      }
    }

    const responseData = {
      totalRows: rawRows.length,
      successCount: insertedProducts.length,
      failedCount: failedRows.length,
      insertedProducts: insertedProducts.slice(0, 10),
      failedRows: failedRows.slice(0, 10),
    };

    if (failedRows.length > 0 && insertedProducts.length === 0) {
      sendError(
        res,
        "All rows failed validation. No products were added.",
        responseData,
        400,
      );
    } else if (failedRows.length > 0) {
      res.status(207).json({
        success: true,
        message: `Partial upload: ${insertedProducts.length} added, ${failedRows.length} failed.`,
        data: responseData,
      });
    } else {
      sendSuccess(
        res,
        `All ${insertedProducts.length} products uploaded successfully.`,
        responseData,
        201,
      );
    }
  } catch (error) {
    next(error);
  }
};

// ─── BULK UPDATE PRODUCTS ──────────────────────────────────────────────────────
// POST /api/products/bulk-update
// Match by SKU. Only updates fields present in the sheet row.
export const bulkUpdateProducts = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.file) {
      sendError(res, "No file uploaded. Please upload a CSV or Excel file.");
      return;
    }

    let rawRows: Record<string, string>[];
    try {
      rawRows = parseFileBuffer(
        req.file.buffer,
        req.file.mimetype,
        req.file.originalname,
      );
    } catch (parseError) {
      sendError(
        res,
        "Failed to parse file.",
        parseError instanceof Error ? parseError.message : parseError,
      );
      return;
    }

    if (!rawRows.length) {
      sendError(res, "File is empty or has no data rows.");
      return;
    }

    const results = {
      totalRows: rawRows.length,
      updatedCount: 0,
      skippedCount: 0, // sku not found in DB
      failedCount: 0,
      skippedRows: [] as { row: number; sku: string; reason: string }[],
      failedRows: [] as {
        row: number;
        data: Record<string, string>;
        errors: unknown;
      }[],
    };

    for (let i = 0; i < rawRows.length; i++) {
      const row = sanitizeRow(rawRows[i]);
      const parseResult = csvUpdateRowSchema.safeParse(row);

      if (!parseResult.success) {
        results.failedCount++;
        results.failedRows.push({
          row: i + 2,
          data: row,
          errors:
            parseResult.error instanceof ZodError
              ? parseResult.error.flatten().fieldErrors
              : parseResult.error,
        });
        continue;
      }

      const d = parseResult.data;

      // Find product by SKU
      const product = await Product.findOne({ sku: d.sku });

      if (!product) {
        results.skippedCount++;
        results.skippedRows.push({
          row: i + 2,
          sku: d.sku,
          reason: "SKU not found in database",
        });
        continue;
      }

      // Build $set object — only update fields present in the row (non-empty)
      const updateFields: Record<string, unknown> = {};

      if (d.name) updateFields.name = d.name.trim();
      if (d.brand !== undefined && d.brand !== "")
        updateFields.brand = d.brand.trim();
      if (d.category) updateFields.category = d.category.trim().toLowerCase();
      if (d.sub_category !== undefined && d.sub_category !== "")
        updateFields.subCategory = d.sub_category.trim().toLowerCase();
      if (d.type !== undefined && d.type !== "")
        updateFields.type = d.type.trim();
      if (d.color !== undefined && d.color !== "")
        updateFields.color = d.color.trim();
      if (d.material !== undefined && d.material !== "")
        updateFields.material = d.material.trim();
      if (d.dimensions !== undefined && d.dimensions !== "")
        updateFields.dimensions = d.dimensions.trim();
      if (d.weight !== undefined && d.weight !== "")
        updateFields.weight = d.weight.trim();
      if (d.warranty !== undefined && d.warranty !== "")
        updateFields.warranty = d.warranty.trim();
      if (d.description !== undefined && d.description !== "")
        updateFields.description = d.description.trim();
      if (d.price !== undefined) updateFields.sellingPrice = d.price;
      if (d.original_price !== undefined)
        updateFields.originalPrice = d.original_price;
      if (d.stock !== undefined) updateFields.stockQuantity = d.stock;
      if (d.min_order_qty !== undefined)
        updateFields.minOrderQuantity = d.min_order_qty;
      if (d.max_order_qty !== undefined)
        updateFields.maxOrderQuantity = d.max_order_qty;
      if (d.fast_moving !== undefined)
        updateFields.isFastMoving = d.fast_moving;
      if (d.featured !== undefined) updateFields.isFeatured = d.featured;

      if (d.compatibility !== undefined && d.compatibility !== "") {
        updateFields.compatibility = d.compatibility
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean);
      }

      if (d.tags !== undefined && d.tags.length > 0) {
        updateFields.tags = d.tags;
      }

      if (d.specifications !== undefined && d.specifications !== "") {
        updateFields.specifications = parseSpecifications(d.specifications);
      }

      // Only save if there are actual changes
      if (Object.keys(updateFields).length === 0) {
        results.skippedCount++;
        results.skippedRows.push({
          row: i + 2,
          sku: d.sku,
          reason: "No fields to update",
        });
        continue;
      }

      await Product.updateOne({ sku: d.sku }, { $set: updateFields });
      results.updatedCount++;
    }

    const message = `Bulk update complete: ${results.updatedCount} updated, ${results.skippedCount} skipped, ${results.failedCount} failed.`;

    if (results.updatedCount === 0 && results.failedCount > 0) {
      sendError(res, "All rows failed. No products updated.", results, 400);
    } else {
      res.status(results.failedCount > 0 ? 207 : 200).json({
        success: true,
        message,
        data: {
          ...results,
          // Cap response size
          skippedRows: results.skippedRows.slice(0, 20),
          failedRows: results.failedRows.slice(0, 20),
        },
      });
    }
  } catch (error) {
    next(error);
  }
};

// ─── BULK DELETE PRODUCTS ──────────────────────────────────────────────────────
// POST /api/products/bulk-delete
// Match by name + brand + category (old products have no sku)
// Deletes Cloudinary images + removes product from DB
export const bulkDeleteProducts = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.file) {
      sendError(res, "No file uploaded. Please upload a CSV or Excel file.");
      return;
    }

    let rawRows: Record<string, string>[];
    try {
      rawRows = parseFileBuffer(
        req.file.buffer,
        req.file.mimetype,
        req.file.originalname,
      );
    } catch (parseError) {
      sendError(
        res,
        "Failed to parse file.",
        parseError instanceof Error ? parseError.message : parseError,
      );
      return;
    }

    if (!rawRows.length) {
      sendError(res, "File is empty or has no data rows.");
      return;
    }

    const results = {
      totalRows: rawRows.length,
      deletedCount: 0,
      notFoundCount: 0,
      failedCount: 0,
      notFoundRows: [] as {
        row: number;
        name: string;
        brand: string;
        category: string;
      }[],
      failedRows: [] as {
        row: number;
        data: Record<string, string>;
        errors: unknown;
      }[],
    };

    for (let i = 0; i < rawRows.length; i++) {
      const row = sanitizeRow(rawRows[i]);
      const parseResult = csvDeleteRowSchema.safeParse(row);

      if (!parseResult.success) {
        results.failedCount++;
        results.failedRows.push({
          row: i + 2,
          data: row,
          errors:
            parseResult.error instanceof ZodError
              ? parseResult.error.flatten().fieldErrors
              : parseResult.error,
        });
        continue;
      }

      const d = parseResult.data;

      // Build match query — brand optional (some products may not have brand)
      const matchQuery: Record<string, unknown> = {
        name: { $regex: new RegExp(`^${d.name.trim()}$`, "i") }, // case-insensitive exact match
        category: d.category.trim().toLowerCase(),
      };

      if (d.brand && d.brand.trim()) {
        matchQuery.brand = { $regex: new RegExp(`^${d.brand.trim()}$`, "i") };
      }

      const product = await Product.findOne(matchQuery);

      if (!product) {
        results.notFoundCount++;
        results.notFoundRows.push({
          row: i + 2,
          name: d.name,
          brand: d.brand || "",
          category: d.category,
        });
        continue;
      }

      // Delete Cloudinary images
      if (product.images && product.images.length > 0) {
        const deletePromises = product.images.map((img) =>
          cloudinary.uploader.destroy(img.publicId).catch((err) => {
            console.error(`Failed to delete image ${img.publicId}:`, err);
          }),
        );
        await Promise.all(deletePromises);
      }

      await product.deleteOne();
      results.deletedCount++;
      console.log(`🗑️ Deleted: ${product.name} (${product._id})`);
    }

    const message = `Bulk delete complete: ${results.deletedCount} deleted, ${results.notFoundCount} not found, ${results.failedCount} failed.`;

    if (results.deletedCount === 0 && results.failedCount > 0) {
      sendError(res, "All rows failed. No products deleted.", results, 400);
    } else {
      res.status(results.failedCount > 0 ? 207 : 200).json({
        success: true,
        message,
        data: {
          ...results,
          notFoundRows: results.notFoundRows.slice(0, 20),
          failedRows: results.failedRows.slice(0, 20),
        },
      });
    }
  } catch (error) {
    next(error);
  }
};

// ─── GET ALL PRODUCTS ──────────────────────────────────────────────────────────
// GET /api/products
export const getAllProducts = async (
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
      featured,
      fastMoving,
      compatibility,
      search,
      color,
      sortBy = "createdAt",
      order = "desc",
    } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10));
    const limitNum = Math.min(100, parseInt(limit as string, 10));
    const skip = (pageNum - 1) * limitNum;

    const filter: Record<string, unknown> = { isActive: true };
    if (category) filter.category = (category as string).toLowerCase();
    if (brand) filter.brand = brand as string;
    if (featured === "true") filter.isFeatured = true;
    if (fastMoving === "true") filter.isFastMoving = true;
    if (color) filter.color = color as string;
    if (compatibility)
      filter.compatibility = { $in: [compatibility as string] };
    if (search) filter.$text = { $search: search as string };

    const sortObj: Record<string, 1 | -1> = {
      [sortBy as string]: order === "desc" ? -1 : 1,
    };

    const [products, total] = await Promise.all([
      Product.find(filter).sort(sortObj).skip(skip).limit(limitNum).lean(),
      Product.countDocuments(filter),
    ]);

    sendSuccess(res, "Products fetched successfully", {
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

// ─── GET SINGLE PRODUCT ────────────────────────────────────────────────────────
// GET /api/products/:id
export const getProductById = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const product = await Product.findById(req.params.id).lean();
    if (!product) {
      sendError(res, "Product not found", undefined, 404);
      return;
    }
    sendSuccess(res, "Product fetched successfully", product);
  } catch (error) {
    next(error);
  }
};

// ─── UPDATE PRODUCT ────────────────────────────────────────────────────────────
// PATCH /api/products/:id
export const updateProduct = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      sendError(res, "Product not found", undefined, 404);
      return;
    }

    const {
      sku, // ✅ NEW
      name,
      brand,
      category,
      subCategory,
      type,
      compatibility,
      sellingPrice,
      originalPrice,
      color,
      material,
      dimensions,
      weight,
      warranty,
      stockQuantity,
      minOrderQuantity,
      maxOrderQuantity,
      description,
      specifications,
      tags,
      isFastMoving,
      isFeatured,
    } = req.body;

    // ✅ NEW: Update SKU if provided
    if (sku !== undefined && sku.trim()) product.sku = sku.trim().toUpperCase();

    if (name !== undefined) product.name = String(name).trim();
    if (brand !== undefined) product.brand = String(brand).trim() || undefined;
    if (category !== undefined)
      product.category = String(category).trim().toLowerCase();
    if (subCategory !== undefined)
      product.subCategory =
        String(subCategory).trim().toLowerCase() || undefined;
    if (type !== undefined) product.type = String(type).trim() || undefined;
    if (color !== undefined) product.color = String(color).trim() || undefined;
    if (material !== undefined)
      product.material = String(material).trim() || undefined;
    if (dimensions !== undefined)
      product.dimensions = String(dimensions).trim() || undefined;
    if (weight !== undefined)
      product.weight = String(weight).trim() || undefined;
    if (warranty !== undefined)
      product.warranty = String(warranty).trim() || "No Warranty";
    if (description !== undefined)
      product.description = String(description).trim() || undefined;

    if (compatibility !== undefined) {
      if (typeof compatibility === "string") {
        product.compatibility = compatibility
          .split(",")
          .map((c: string) => c.trim())
          .filter(Boolean);
      } else if (Array.isArray(compatibility)) {
        product.compatibility = compatibility;
      }
    }

    if (sellingPrice !== undefined) {
      const p = parseFloat(sellingPrice);
      if (isNaN(p) || p < 0) {
        sendError(res, "sellingPrice must be a non-negative number");
        return;
      }
      product.sellingPrice = p;
    }
    if (originalPrice !== undefined) {
      const p = parseFloat(originalPrice);
      if (isNaN(p) || p < 0) {
        sendError(res, "originalPrice must be a non-negative number");
        return;
      }
      product.originalPrice = p;
    }
    if (stockQuantity !== undefined) {
      const q = parseInt(stockQuantity, 10);
      if (isNaN(q) || q < 0) {
        sendError(res, "stockQuantity must be a non-negative integer");
        return;
      }
      product.stockQuantity = q;
    }
    if (minOrderQuantity !== undefined) {
      const q = parseInt(minOrderQuantity, 10);
      if (isNaN(q) || q < 1) {
        sendError(res, "minOrderQuantity must be >= 1");
        return;
      }
      product.minOrderQuantity = q;
    }
    if (maxOrderQuantity !== undefined) {
      if (
        maxOrderQuantity === "" ||
        maxOrderQuantity === null ||
        maxOrderQuantity === "null"
      ) {
        product.maxOrderQuantity = undefined;
      } else {
        const q = parseInt(maxOrderQuantity, 10);
        if (isNaN(q) || q < 1) {
          sendError(
            res,
            "maxOrderQuantity must be a positive integer or empty",
          );
          return;
        }
        product.maxOrderQuantity = q;
      }
    }

    if (specifications !== undefined) {
      try {
        let specsMap: Map<string, string>;
        if (typeof specifications === "string") {
          specsMap = new Map(JSON.parse(specifications));
        } else if (typeof specifications === "object") {
          specsMap = new Map(Object.entries(specifications));
        } else {
          specsMap = new Map();
        }
        product.specifications = specsMap;
      } catch {
        const map = new Map<string, string>();
        if (typeof specifications === "string") {
          specifications.split(";").forEach((pair: string) => {
            const [key, value] = pair.split(":").map((s: string) => s.trim());
            if (key && value) map.set(key, value);
          });
        }
        product.specifications = map;
      }
    }

    if (tags !== undefined) {
      product.tags = String(tags)
        .split(",")
        .map((t: string) => t.trim())
        .filter(Boolean);
    }

    if (isFastMoving !== undefined) {
      product.isFastMoving =
        isFastMoving === true ||
        isFastMoving === "true" ||
        isFastMoving === "yes" ||
        isFastMoving === "1";
    }
    if (isFeatured !== undefined) {
      product.isFeatured =
        isFeatured === true ||
        isFeatured === "true" ||
        isFeatured === "yes" ||
        isFeatured === "1";
    }

    // ─── IMAGE MANAGEMENT ────────────────────────────────────────────────────
    const primaryImageId = req.body.primaryImageId;
    const deletedImagesStr = req.body.deletedImages;
    const imageFiles = req.files as Express.Multer.File[] | undefined;
    const firstNewIsPrimary = req.body.firstNewIsPrimary === "true";

    if (primaryImageId && product.images && product.images.length > 0) {
      const currentImages = product.images.map((img: any) =>
        img.toObject ? img.toObject() : { ...img },
      );
      product.images = currentImages.map((img: any) => ({
        url: img.url,
        publicId: img.publicId,
        isPrimary: img.publicId === primaryImageId,
        altText: img.altText || "",
      }));
    }

    if (deletedImagesStr) {
      try {
        const deletedIds: string[] = JSON.parse(deletedImagesStr);
        if (
          deletedIds.length > 0 &&
          product.images &&
          product.images.length > 0
        ) {
          for (const publicId of deletedIds) {
            await cloudinary.uploader.destroy(publicId).catch((err) => {
              console.error(
                `Failed to delete ${publicId} from Cloudinary:`,
                err,
              );
            });
          }
          const currentImages = product.images.map((img: any) =>
            img.toObject ? img.toObject() : { ...img },
          );
          product.images = currentImages.filter(
            (img: any) => !deletedIds.includes(img.publicId),
          );
        }
      } catch (err) {
        console.error("Failed to parse deletedImages:", err);
      }
    }

    if (imageFiles && imageFiles.length > 0) {
      try {
        const uploadPromises = imageFiles.map(async (file) => {
          const cloudResult = await uploadBufferToCloudinary(
            file.buffer,
            file.originalname,
          );
          return {
            url: cloudResult.secure_url,
            publicId: cloudResult.public_id,
            isPrimary: false,
            altText: `${product.name} - Image ${Date.now()}`,
          };
        });

        const uploadedImages = await Promise.all(uploadPromises);
        const hasExistingImages = product.images && product.images.length > 0;

        if (!hasExistingImages && uploadedImages.length > 0) {
          uploadedImages[0].isPrimary = true;
        } else if (firstNewIsPrimary && uploadedImages.length > 0) {
          uploadedImages[0].isPrimary = true;
        }

        const currentImages = (product.images || []).map((img: any) =>
          img.toObject ? img.toObject() : { ...img },
        );
        product.images = [...currentImages, ...uploadedImages];
      } catch (uploadErr) {
        await product.save();
        res.status(502).json({
          success: false,
          message: "Product updated but new image upload failed.",
          errors: uploadErr instanceof Error ? uploadErr.message : uploadErr,
        });
        return;
      }
    }

    if (product.images && product.images.length > 0) {
      const hasPrimary = product.images.some((img: any) => img.isPrimary);
      if (!hasPrimary) {
        const currentImages = product.images.map((img: any) =>
          img.toObject ? img.toObject() : { ...img },
        );
        currentImages[0].isPrimary = true;
        product.images = currentImages;
      }
    }

    await product.save();
    sendSuccess(res, "Product updated successfully", product);
  } catch (error) {
    next(error);
  }
};

// ─── REPLACE PRODUCT IMAGES ────────────────────────────────────────────────────
// PATCH /api/products/:id/images
export const replaceProductImages = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const imageFiles = req.files as Express.Multer.File[] | undefined;
    if (!imageFiles || imageFiles.length === 0) {
      sendError(res, "No image files provided");
      return;
    }

    if (imageFiles.length > 8) {
      sendError(res, "Maximum 8 images allowed");
      return;
    }

    const product = await Product.findById(req.params.id);
    if (!product) {
      sendError(res, "Product not found", undefined, 404);
      return;
    }

    if (product.images && product.images.length > 0) {
      const deletePromises = product.images.map((img) =>
        cloudinary.uploader.destroy(img.publicId).catch(() => null),
      );
      await Promise.all(deletePromises);
    }

    try {
      const uploadPromises = imageFiles.map(async (file, index) => {
        const cloudResult = await uploadBufferToCloudinary(
          file.buffer,
          file.originalname,
        );
        return {
          url: cloudResult.secure_url,
          publicId: cloudResult.public_id,
          isPrimary: index === 0,
          altText: `${product.name} - Image ${index + 1}`,
        };
      });
      product.images = await Promise.all(uploadPromises);
    } catch (uploadErr) {
      res.status(502).json({
        success: false,
        message: "Image upload to Cloudinary failed.",
        errors: uploadErr instanceof Error ? uploadErr.message : uploadErr,
      });
      return;
    }

    await product.save();
    sendSuccess(res, "Product images replaced successfully", {
      _id: product._id,
      name: product.name,
      images: product.images,
    });
  } catch (error) {
    next(error);
  }
};

// ─── UPDATE STEP SIZE ──────────────────────────────────────────────────────────
// PATCH /api/products/:id/step
export const updateStepSize = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const step = parseInt(req.body?.step, 10);
    if (isNaN(step) || step < 1) {
      sendError(res, "step must be a positive integer (minimum 1)");
      return;
    }

    const product = await Product.findById(req.params.id);
    if (!product) {
      sendError(res, "Product not found", undefined, 404);
      return;
    }

    const previous = product.minOrderQuantity;
    product.minOrderQuantity = step;
    await product.save();

    sendSuccess(res, "Step size updated successfully", {
      _id: product._id,
      name: product.name,
      previousStep: previous,
      newStep: step,
    });
  } catch (error) {
    next(error);
  }
};

// ─── TOGGLE PRODUCT STATUS ────────────────────────────────────────────────────
// PATCH /api/products/:id/status
export const toggleProductStatus = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { isActive } = req.body as { isActive: boolean };
    if (typeof isActive !== "boolean") {
      sendError(res, "isActive must be a boolean");
      return;
    }

    const product = await Product.findById(req.params.id);
    if (!product) {
      sendError(res, "Product not found", undefined, 404);
      return;
    }

    product.isActive = isActive;
    await product.save();

    sendSuccess(
      res,
      `Product ${isActive ? "restored" : "deactivated"} successfully`,
      { _id: product._id, name: product.name, isActive: product.isActive },
    );
  } catch (error) {
    next(error);
  }
};

// ─── DELETE PRODUCT ────────────────────────────────────────────────────────────
// DELETE /api/products/:id
export const deleteProduct = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      sendError(res, "Product not found", undefined, 404);
      return;
    }

    if (product.images && product.images.length > 0) {
      const deletePromises = product.images.map((img) =>
        cloudinary.uploader.destroy(img.publicId).catch(() => null),
      );
      await Promise.all(deletePromises);
    }

    await product.deleteOne();
    sendSuccess(res, "Product deleted successfully");
  } catch (error) {
    next(error);
  }
};
