import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import streamifier from "streamifier";
import Product from "../models/Product";
import cloudinary from "../config/cloudinary";
import { singleProductSchema, csvRowSchema } from "../utils/validators";
import { parseFileBuffer } from "../utils/fileParser";
import { sendSuccess, sendError } from "../utils/response";
import { UploadApiResponse } from "cloudinary";

// ─── Helper: upload a Buffer to Cloudinary ────────────────────────────────────
const uploadBufferToCloudinary = (
  buffer: Buffer,
  originalName: string
): Promise<UploadApiResponse> => {
  return new Promise((resolve, reject) => {
    const publicId = `product_${Date.now()}_${originalName.replace(/\.[^/.]+$/, "")}`;

    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: "products",
        public_id: publicId,
        allowed_formats: ["jpg", "jpeg", "png", "webp"],
        transformation: [
          { width: 800, height: 800, crop: "limit", quality: "auto" },
        ],
      },
      (error, result) => {
        if (error || !result)
          return reject(error ?? new Error("Cloudinary upload failed"));
        resolve(result);
      }
    );

    streamifier.createReadStream(buffer).pipe(uploadStream);
  });
};

// ─── ADD SINGLE PRODUCT ────────────────────────────────────────────────────────
// POST /api/products/single
export const addSingleProduct = async (
  req: Request,
  res: Response,
  next: NextFunction
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

    let imageUrl: string | undefined;
    let imagePublicId: string | undefined;

    if (req.file?.buffer) {
      try {
        const cloudResult = await uploadBufferToCloudinary(
          req.file.buffer,
          req.file.originalname
        );
        imageUrl = cloudResult.secure_url;
        imagePublicId = cloudResult.public_id;
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
      sellingPrice: data.sellingPrice,
      originalPrice: data.originalPrice,
      unit: data.unit,
      weightOrSize: data.weightOrSize,
      stockQuantity: data.stockQuantity,
      minOrderQuantity: data.minOrderQuantity,
      description: data.description,
      imageUrl,
      imagePublicId,
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
  next: NextFunction
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
        req.file.originalname
      );
    } catch {
      sendError(
        res,
        "Failed to parse the uploaded file. Ensure it is a valid CSV or Excel file."
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
      const row = rawRows[i];
      const result = csvRowSchema.safeParse(row);

      if (result.success) {
        const d = result.data;
        validProducts.push({
          name: d.name,
          brand: d.brand || undefined,
          category: d.category,
          subCategory: d.sub_category || undefined,
          sellingPrice: d.price,
          originalPrice: d.original_price,
          unit: d.unit,
          weightOrSize: d.weight || undefined,
          stockQuantity: d.stock,
          minOrderQuantity: d.min_order_qty,
          description: d.description || undefined,
          imageUrl: d.image_url || undefined,
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
      insertedProducts = await Product.insertMany(validProducts, {
        ordered: false,
      });
    }

    const responseData = {
      totalRows: rawRows.length,
      successCount: insertedProducts.length,
      failedCount: failedRows.length,
      insertedProducts,
      failedRows,
    };

    if (failedRows.length > 0 && insertedProducts.length === 0) {
      sendError(
        res,
        "All rows failed validation. No products were added.",
        responseData,
        400
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
        201
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
  next: NextFunction
): Promise<void> => {
  try {
    const {
      page = "1",
      limit = "20",
      category,
      featured,
      fastMoving,
      search,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10));
    const limitNum = Math.min(100, parseInt(limit as string, 10));
    const skip = (pageNum - 1) * limitNum;

    const filter: Record<string, unknown> = { isActive: true };
    if (category) filter.category = (category as string).toLowerCase();
    if (featured === "true") filter.isFeatured = true;
    if (fastMoving === "true") filter.isFastMoving = true;
    if (search) filter.$text = { $search: search as string };

    const [products, total] = await Promise.all([
      Product.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
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
  next: NextFunction
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
  next: NextFunction
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
      sellingPrice,
      originalPrice,
      unit,
      weightOrSize,
      stockQuantity,
      minOrderQuantity,
      description,
      tags,
      isFastMoving,
      isFeatured,
    } = req.body;

    if (name !== undefined) product.name = String(name).trim();
    if (brand !== undefined) product.brand = String(brand).trim() || undefined;
    if (category !== undefined)
      product.category = String(category).trim().toLowerCase();
    if (subCategory !== undefined)
      product.subCategory = String(subCategory).trim().toLowerCase() || undefined;
    if (weightOrSize !== undefined)
      product.weightOrSize = String(weightOrSize).trim() || undefined;
    if (description !== undefined)
      product.description = String(description).trim() || undefined;

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
    if (unit !== undefined) {
      const validUnits = ["kg", "g", "litre", "ml", "pack", "piece", "dozen", "box"];
      if (!validUnits.includes(unit)) {
        sendError(res, `unit must be one of: ${validUnits.join(", ")}`);
        return;
      }
      product.unit = unit;
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
        isFastMoving === "yes";
    }
    if (isFeatured !== undefined) {
      product.isFeatured =
        isFeatured === true || isFeatured === "true" || isFeatured === "yes";
    }

    if (req.file?.buffer) {
      if (product.imagePublicId) {
        await cloudinary.uploader.destroy(product.imagePublicId).catch(() => null);
      }
      try {
        const cloudResult = await uploadBufferToCloudinary(
          req.file.buffer,
          req.file.originalname
        );
        product.imageUrl = cloudResult.secure_url;
        product.imagePublicId = cloudResult.public_id;
      } catch (uploadErr) {
        res.status(502).json({
          success: false,
          message: "New image upload failed. Other changes were not saved.",
          errors: uploadErr instanceof Error ? uploadErr.message : uploadErr,
        });
        return;
      }
    }

    await product.save();
    sendSuccess(res, "Product updated successfully", product);
  } catch (error) {
    next(error);
  }
};

// ─── UPDATE STEP SIZE ──────────────────────────────────────────────────────────
// PATCH /api/products/:id/step
export const updateStepSize = async (
  req: Request,
  res: Response,
  next: NextFunction
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

// ─── REPLACE PRODUCT IMAGE ─────────────────────────────────────────────────────
// PATCH /api/products/:id/image
export const replaceProductImage = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.file?.buffer) {
      sendError(res, "No image file provided");
      return;
    }

    const product = await Product.findById(req.params.id);
    if (!product) {
      sendError(res, "Product not found", undefined, 404);
      return;
    }

    if (product.imagePublicId) {
      await cloudinary.uploader.destroy(product.imagePublicId).catch(() => null);
    }

    try {
      const cloudResult = await uploadBufferToCloudinary(
        req.file.buffer,
        req.file.originalname
      );
      product.imageUrl = cloudResult.secure_url;
      product.imagePublicId = cloudResult.public_id;
    } catch (uploadErr) {
      res.status(502).json({
        success: false,
        message: "Image upload to Cloudinary failed.",
        errors: uploadErr instanceof Error ? uploadErr.message : uploadErr,
      });
      return;
    }

    await product.save();
    sendSuccess(res, "Product image replaced successfully", {
      _id: product._id,
      name: product.name,
      imageUrl: product.imageUrl,
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
  next: NextFunction
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
      { _id: product._id, name: product.name, isActive: product.isActive }
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
  next: NextFunction
): Promise<void> => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      sendError(res, "Product not found", undefined, 404);
      return;
    }

    if (product.imagePublicId) {
      await cloudinary.uploader.destroy(product.imagePublicId).catch(() => null);
    }

    await product.deleteOne();
    sendSuccess(res, "Product deleted successfully");
  } catch (error) {
    next(error);
  }
};