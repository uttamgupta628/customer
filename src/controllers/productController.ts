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
        if (error || !result) return reject(error ?? new Error("Cloudinary upload failed"));
        resolve(result);
      }
    );

    streamifier.createReadStream(buffer).pipe(uploadStream);
  });
};

// ─── ADD SINGLE PRODUCT ────────────────────────────────────────────────────────
export const addSingleProduct = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // 1. Validate body fields
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

    // 2. Upload image to Cloudinary if provided
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

    // 3. Create & save product
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
export const bulkUploadProducts = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // 1. Check file presence
    if (!req.file) {
      sendError(res, "No file uploaded. Please upload a CSV or Excel file.");
      return;
    }

    // 2. Parse the file
    let rawRows: Record<string, string>[];
    try {
      rawRows = parseFileBuffer(req.file.buffer, req.file.mimetype, req.file.originalname);
    } catch {
      sendError(res, "Failed to parse the uploaded file. Ensure it is a valid CSV or Excel file.");
      return;
    }

    if (!rawRows.length) {
      sendError(res, "The uploaded file is empty or has no data rows.");
      return;
    }

    // 3. Validate each row
    const validProducts: object[] = [];
    const failedRows: { row: number; data: Record<string, string>; errors: unknown }[] = [];

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
          row: i + 2, // row 1 = header; user-facing rows are 1-indexed
          data: row,
          errors:
            result.error instanceof ZodError
              ? result.error.flatten().fieldErrors
              : result.error,
        });
      }
    }

    // 4. Insert valid products
    let insertedProducts: object[] = [];
    if (validProducts.length > 0) {
      insertedProducts = await Product.insertMany(validProducts, {
        ordered: false,
      });
    }

    // 5. Respond with summary
    const responseData = {
      totalRows: rawRows.length,
      successCount: insertedProducts.length,
      failedCount: failedRows.length,
      insertedProducts,
      failedRows,
    };

    if (failedRows.length > 0 && insertedProducts.length === 0) {
      sendError(res, "All rows failed validation. No products were added.", responseData, 400);
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
      Product.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
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

// ─── DELETE PRODUCT ────────────────────────────────────────────────────────────
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

    // Delete image from Cloudinary if it exists
    if (product.imagePublicId) {
      await cloudinary.uploader.destroy(product.imagePublicId).catch(() => null);
    }

    await product.deleteOne();
    sendSuccess(res, "Product deleted successfully");
  } catch (error) {
    next(error);
  }
};
