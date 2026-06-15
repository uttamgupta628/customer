import {
  Router,
  Request,
  Response,
  NextFunction,
  RequestHandler,
} from "express";
import {
  addSingleProduct,
  bulkUploadProducts,
  bulkUpdateProducts,
  bulkDeleteProducts,
  getAllProducts,
  getProductById,
  updateProduct,
  updateStepSize,
  replaceProductImages,
  toggleProductStatus,
  deleteProduct,
} from "../controllers/productController";
import { uploadMultipleImages, uploadBulkFile } from "../middlewares/upload";

const router = Router();

// ─── Upload error wrapper ──────────────────────────────────────────────────────
const handleUpload =
  (uploadMiddleware: RequestHandler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    uploadMiddleware(req, res, (err: unknown) => {
      if (err) {
        res.status(400).json({
          success: false,
          message: err instanceof Error ? err.message : "File upload error",
        });
        return;
      }
      next();
    });
  };

// POST /api/products/single - Add single product with multiple images (up to 8)
router.post(
  "/single",
  handleUpload(uploadMultipleImages as RequestHandler),
  addSingleProduct,
);

// POST /api/products/bulk - Bulk upload via CSV/Excel file
router.post(
  "/bulk",
  handleUpload(uploadBulkFile as RequestHandler),
  bulkUploadProducts,
);

// POST /api/products/bulk-update - Bulk update by SKU via CSV/Excel file
router.post(
  "/bulk-update",
  handleUpload(uploadBulkFile as RequestHandler),
  bulkUpdateProducts,
);

// POST /api/products/bulk-delete - Bulk delete via CSV/Excel file
router.post(
  "/bulk-delete",
  handleUpload(uploadBulkFile as RequestHandler),
  bulkDeleteProducts,
);

// GET /api/products - Get all products with filtering and pagination
router.get("/", getAllProducts);

// GET /api/products/:id - Get single product by ID
router.get("/:id", getProductById);

// PATCH /api/products/:id - Update product with optional new images (up to 8)
router.patch(
  "/:id",
  handleUpload(uploadMultipleImages as RequestHandler),
  updateProduct,
);

// PATCH /api/products/:id/step - Update min order quantity
router.patch("/:id/step", updateStepSize);

// PATCH /api/products/:id/images - Replace all product images (up to 8)
router.patch(
  "/:id/images",
  handleUpload(uploadMultipleImages as RequestHandler),
  replaceProductImages,
);

// PATCH /api/products/:id/status - Toggle product active/inactive
router.patch("/:id/status", toggleProductStatus);

// DELETE /api/products/:id - Hard delete product with images
router.delete("/:id", deleteProduct);

export default router;
