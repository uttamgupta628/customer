import { Response } from "express";

export interface ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  errors?: unknown;
}

export const sendSuccess = <T>(
  res: Response,
  message: string,
  data?: T,
  statusCode = 200
): Response => {
  return res.status(statusCode).json(<ApiResponse<T>>{
    success: true,
    message,
    data,
  });
};

export const sendError = (
  res: Response,
  message: string,
  errors?: unknown,
  statusCode = 400
): Response => {
  return res.status(statusCode).json(<ApiResponse>{
    success: false,
    message,
    errors,
  });
};
