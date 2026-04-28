import { Router, Request, Response, NextFunction, RequestHandler } from "express";
import {
  addSingleProduct,
  bulkUploadProducts,
  getAllProducts,
  getProductById,
  updateProduct,
  updateStepSize,
  replaceProductImage,
  toggleProductStatus,
  deleteProduct,
} from "../controllers/productController";
import { uploadSingleImage, uploadBulkFile } from "../middlewares/upload";

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

router.post("/single", handleUpload(uploadSingleImage as RequestHandler), addSingleProduct);

router.post("/bulk", handleUpload(uploadBulkFile as RequestHandler), bulkUploadProducts);

router.get("/", getAllProducts);

router.get("/:id", getProductById);

router.patch("/:id", handleUpload(uploadSingleImage as RequestHandler), updateProduct);

router.patch("/:id/step", updateStepSize);

router.patch("/:id/image", handleUpload(uploadSingleImage as RequestHandler), replaceProductImage);

router.patch("/:id/status", toggleProductStatus);

router.delete("/:id", deleteProduct);

export default router;