import multer from "multer";
import { Request } from "express";

const storage = multer.memoryStorage();

// ─── Image File Filter ─────────────────────────────────────────────────────────
const imageFileFilter = (
  req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
) => {
  if (file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(new Error("Not an image! Please upload only images (JPG, PNG, WebP)."));
  }
};

// ─── Excel/CSV File Filter ─────────────────────────────────────────────────────
const excelFileFilter = (
  req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
) => {
  const allowedMimes = [
    "text/csv",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/csv",
  ];

  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Please upload a CSV or Excel file (.csv, .xlsx, .xls)."));
  }
};

// ─── Single Image Upload (for backward compatibility) ──────────────────────────
export const uploadSingleImage = multer({
  storage,
  fileFilter: imageFileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max per file
  },
}).single("image");

// ─── Multiple Images Upload (max 8 images) ─────────────────────────────────────
export const uploadMultipleImages = multer({
  storage,
  fileFilter: imageFileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max per file
    files: 8, // Maximum 8 files
  },
}).array("images", 8); // Field name "images", max 8 files

// ─── Bulk File Upload (Excel/CSV) ──────────────────────────────────────────────
export const uploadBulkFile = multer({
  storage,
  fileFilter: excelFileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max for bulk files
  },
}).single("file"); // Field name "file"
