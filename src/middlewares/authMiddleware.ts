import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { sendError } from "../utils/response";

const JWT_SECRET = process.env.JWT_SECRET ?? "changeme_secret";

export const authMiddleware = (
  req: Request & { adminId?: string },
  res: Response,
  next: NextFunction
): void => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    sendError(res, "Unauthorized", undefined, 401);
    return;
  }
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET) as { id: string };
    req.adminId = payload.id;
    next();
  } catch {
    sendError(res, "Invalid or expired token", undefined, 401);
  }
};