import { Router, Request, Response, NextFunction, RequestHandler } from "express";
import {
  addSingleProduct,
  bulkUploadProducts,
  getAllProducts,
  getProductById,
  deleteProduct,
} from "../controllers/productController";
import { uploadSingleImage, uploadBulkFile } from "../middlewares/upload";

const router = Router();

// ─── Helper to wrap multer errors in a clean JSON response ────────────────────
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

// ─── Routes ───────────────────────────────────────────────────────────────────

router.post(
  "/single",
  handleUpload(uploadSingleImage as RequestHandler),
  addSingleProduct
);


router.post(
  "/bulk",
  handleUpload(uploadBulkFile as RequestHandler),
  bulkUploadProducts
);


router.get("/", getAllProducts);


router.get("/:id", getProductById);


router.delete("/:id", deleteProduct);

export default router;
