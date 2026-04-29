// middlewares/adminAuth.ts
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import Admin from "../models/Admin";

const JWT_SECRET = process.env.JWT_SECRET ?? "changeme_secret";

export const adminAuth = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({
        success: false,
        message: "No token provided. Authorization denied.",
      });
      return;
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET) as {
      id: string;
      email: string;
    };

    // ✅ Check Admin model (not User model)
    const admin = await Admin.findById(decoded.id);
    if (!admin) {
      res.status(401).json({
        success: false,
        message: "Admin not found. Authorization denied.",
      });
      return;
    }

    // Attach admin info to request
    (req as any).adminId = decoded.id;
    (req as any).user = admin; // ✅ Also attach as user for compatibility

    next();
  } catch (error) {
    res.status(401).json({
      success: false,
      message: "Invalid or expired token.",
    });
  }
};
