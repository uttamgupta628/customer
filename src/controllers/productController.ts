import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import streamifier from "streamifier";
import Product, { IProductImage } from "../models/Product";
import cloudinary from "../config/cloudinary";
import { singleProductSchema, csvRowSchema } from "../utils/validators";
import { parseFileBuffer } from "../utils/fileParser";
import { sendSuccess, sendError } from "../utils/response";
import { UploadApiResponse } from "cloudinary";
import mongoose from "mongoose";
import {
  convertToDirectImageUrl,
  isGoogleDriveUrl,
} from "../utils/googleDriveParser";

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

// ─── ADD SINGLE PRODUCT (Multiple Images) ─────────────────────────────────────
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

    // Handle multiple image uploads
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
            isPrimary: index === 0, // First image is primary
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
      maxOrderQuantity: data.maxOrderQuantity || null, // ✅ NEW
      description: data.description,
      specifications: data.specifications || new Map(),
      images,
      tags: data.tags ?? [],
      isFastMoving: data.isFastMoving ?? false,
      isFeatured: data.isFeatured ?? false,
    });

    await product.save();
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
    function sanitizeRow(row: Record<string, string>): Record<string, string> {
      const out: Record<string, string> = {};
      for (const [key, value] of Object.entries(row)) {
        // Strip currency symbols, commas in numbers (e.g. "1,499" → "1499")
        const cleaned = value
          .trim()
          .replace(/^[₹$€£¥\s]+/, "") // leading currency symbols
          .replace(/^["']|["']$/g, ""); // stray surrounding quotes
        out[key] = cleaned;
      }
      // Normalize numeric fields specifically — remove thousand separators
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
    for (let i = 0; i < rawRows.length; i++) {
      const row = sanitizeRow(rawRows[i]); // ← add this
      const result = csvRowSchema.safeParse(row);
      if (!result.success) {
        console.log(
          `Row ${i + 2} failed:`,
          JSON.stringify(result.error.flatten().fieldErrors),
        );
        console.log(`Row ${i + 2} raw data:`, JSON.stringify(row));
      }
      if (result.success) {
        const d = result.data;

        // Parse specifications string to Map
        let specifications = new Map<string, string>();
        if (d.specifications) {
          try {
            d.specifications.split(";").forEach((pair) => {
              const [key, value] = pair.split(":").map((s) => s.trim());
              if (key && value) specifications.set(key, value);
            });
          } catch {
            // Skip invalid specifications
          }
        }

        // Parse image URLs
        // ✅ Parse image URLs - check BOTH formats:
        // New format: image_1, image_2, ..., image_8
        // Old format: image_urls (comma-separated)
        // In bulkUploadProducts, change:
        const imageUrls: string[] = [];

        // Check image_1 through image_8
        for (let j = 1; j <= 8; j++) {
          const imgField = `image_${j}`;
          const imgValue = row[imgField]; // Get directly from the raw row
          if (imgValue && String(imgValue).trim()) {
            const url = String(imgValue).trim();
            // Convert Google Drive URLs to direct image URLs
            if (isGoogleDriveUrl(url)) {
              const converted = convertToDirectImageUrl(url);
              if (converted) {
                imageUrls.push(converted);
                console.log(
                  `🔄 Converted Google Drive URL: ${url} → ${converted}`,
                );
              } else {
                console.warn(`⚠️ Failed to convert Google Drive URL: ${url}`);
              }
            } else {
              imageUrls.push(url);
            }
          }
        }

        // Fallback to old image_urls
        if (imageUrls.length === 0 && row["image_urls"]) {
          const urls = String(row["image_urls"])
            .split(",")
            .map((url: string) => url.trim())
            .filter(Boolean);

          urls.forEach((url: string) => {
            if (isGoogleDriveUrl(url)) {
              const converted = convertToDirectImageUrl(url);
              if (converted) {
                imageUrls.push(converted);
              }
            } else {
              imageUrls.push(url);
            }
          });
        }

        console.log(`📷 Images for row ${i + 2}:`, imageUrls);

        const images = imageUrls.map((url, index) => ({
          url,
          publicId: `bulk_${Date.now()}_${i}_${index}`,
          isPrimary: index === 0,
          altText: `${d.name} - Image ${index + 1}`,
        }));

        validProducts.push({
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
          maxOrderQuantity: d.max_order_qty || null, // ✅ NEW
          description: d.description || undefined,
          specifications,
          images,
          tags: d.tags,
          isFastMoving: d.fast_moving,
          isFeatured: d.featured,
        });
      } else {
        failedRows.push({
          row: i + 2, // +2 for header row and 0-index
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
          ordered: false, // Continue inserting even if some fail
        });
      } catch (insertError) {
        // Handle partial insert errors
        if (insertError instanceof mongoose.Error) {
          console.error("Bulk insert error:", insertError);
        }
      }
    }

    const responseData = {
      totalRows: rawRows.length,
      successCount: insertedProducts.length,
      failedCount: failedRows.length,
      insertedProducts: insertedProducts.slice(0, 10), // Return only first 10
      failedRows: failedRows.slice(0, 10), // Return only first 10 errors
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

    // Build sort object
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

    // Update text fields
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

    // Update compatibility
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

    // Update numeric fields
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
    // ✅ Use undefined instead of null
    if (maxOrderQuantity !== undefined) {
      if (
        maxOrderQuantity === "" ||
        maxOrderQuantity === null ||
        maxOrderQuantity === "null"
      ) {
        product.maxOrderQuantity = undefined; // ✅ Changed from null to undefined
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

    // Update specifications
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

    // Update tags
    if (tags !== undefined) {
      product.tags = String(tags)
        .split(",")
        .map((t: string) => t.trim())
        .filter(Boolean);
    }

    // Update booleans
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

    // ═══════════════════════════════════════════
    // ✅ IMAGE MANAGEMENT - COMPLETE REWRITE
    // ═══════════════════════════════════════════

    const primaryImageId = req.body.primaryImageId;
    const deletedImagesStr = req.body.deletedImages;
    const imageFiles = req.files as Express.Multer.File[] | undefined;
    const firstNewIsPrimary = req.body.firstNewIsPrimary === "true";

    console.log("📷 Image update request:");
    console.log("   primaryImageId:", primaryImageId);
    console.log("   deletedImages:", deletedImagesStr);
    console.log("   new image files:", imageFiles?.length || 0);
    console.log("   firstNewIsPrimary:", firstNewIsPrimary);

    // ── STEP 1: Update primary image on EXISTING images ──
    if (primaryImageId && product.images && product.images.length > 0) {
      console.log("🔄 Setting primary image to:", primaryImageId);

      // Convert Mongoose subdocuments to plain objects if needed
      const currentImages = product.images.map((img: any) =>
        img.toObject ? img.toObject() : { ...img },
      );

      product.images = currentImages.map((img: any) => ({
        url: img.url,
        publicId: img.publicId,
        isPrimary: img.publicId === primaryImageId,
        altText: img.altText || "",
      }));

      console.log("✅ Primary image updated in existing images");
    }

    // ── STEP 2: Delete images marked for removal ──
    if (deletedImagesStr) {
      try {
        const deletedIds: string[] = JSON.parse(deletedImagesStr);
        console.log("🗑️ Deleting images:", deletedIds);

        if (
          deletedIds.length > 0 &&
          product.images &&
          product.images.length > 0
        ) {
          // Delete from Cloudinary
          for (const publicId of deletedIds) {
            await cloudinary.uploader.destroy(publicId).catch((err) => {
              console.error(
                `Failed to delete ${publicId} from Cloudinary:`,
                err,
              );
            });
          }

          // Remove from product images array
          const currentImages = product.images.map((img: any) =>
            img.toObject ? img.toObject() : { ...img },
          );

          product.images = currentImages.filter(
            (img: any) => !deletedIds.includes(img.publicId),
          );

          console.log(
            `✅ Removed ${deletedIds.length} images. Remaining: ${product.images.length}`,
          );
        }
      } catch (err) {
        console.error("Failed to parse deletedImages:", err);
      }
    }

    // ── STEP 3: Add new uploaded images ──
    if (imageFiles && imageFiles.length > 0) {
      console.log(`📤 Uploading ${imageFiles.length} new images`);

      try {
        const uploadPromises = imageFiles.map(async (file, index) => {
          const cloudResult = await uploadBufferToCloudinary(
            file.buffer,
            file.originalname,
          );
          return {
            url: cloudResult.secure_url,
            publicId: cloudResult.public_id,
            isPrimary: false, // Will be set below if needed
            altText: `${product.name} - Image ${Date.now()}`,
          };
        });

        const uploadedImages = await Promise.all(uploadPromises);

        // Determine if new images should be primary
        const hasExistingImages = product.images && product.images.length > 0;

        if (
          !hasExistingImages &&
          firstNewIsPrimary &&
          uploadedImages.length > 0
        ) {
          // No existing images left + flag says first new should be primary
          uploadedImages[0].isPrimary = true;
          console.log("✅ First new image set as primary (no existing images)");
        } else if (!hasExistingImages && uploadedImages.length > 0) {
          // No existing images, first new image becomes primary automatically
          uploadedImages[0].isPrimary = true;
          console.log("✅ First new image set as primary (auto)");
        }

        // Add to existing images
        const currentImages = (product.images || []).map((img: any) =>
          img.toObject ? img.toObject() : { ...img },
        );

        product.images = [...currentImages, ...uploadedImages];
        console.log(
          `✅ Added ${uploadedImages.length} new images. Total: ${product.images.length}`,
        );
      } catch (uploadErr) {
        // Save other changes even if image upload fails
        await product.save();
        res.status(502).json({
          success: false,
          message: "Product updated but new image upload failed.",
          errors: uploadErr instanceof Error ? uploadErr.message : uploadErr,
        });
        return;
      }
    }

    // ── STEP 4: Ensure at least one image is primary ──
    if (product.images && product.images.length > 0) {
      const hasPrimary = product.images.some((img: any) => img.isPrimary);
      if (!hasPrimary) {
        console.log("⚠️ No primary image found, setting first as primary");
        const currentImages = product.images.map((img: any) =>
          img.toObject ? img.toObject() : { ...img },
        );
        currentImages[0].isPrimary = true;
        product.images = currentImages;
      }

      // Log final state
      const primary = product.images.find((img: any) => img.isPrimary);
      console.log(
        `📷 Final primary: ${primary?.publicId} (${product.images.length} total)`,
      );
      product.images.forEach((img: any, i: number) => {
        console.log(`   [${i}] ${img.publicId} - primary: ${img.isPrimary}`);
      });
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

    // Delete old images
    if (product.images && product.images.length > 0) {
      const deletePromises = product.images.map((img) =>
        cloudinary.uploader.destroy(img.publicId).catch(() => null),
      );
      await Promise.all(deletePromises);
    }

    // Upload new images
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

// ─── UPDATE STEP SIZE (Min Order Qty) ──────────────────────────────────────────
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

// ─── TOGGLE PRODUCT STATUS (soft delete / restore) ────────────────────────────
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

    // Delete all images from Cloudinary
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
