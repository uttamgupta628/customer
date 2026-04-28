import "dotenv/config";
import express, { Request, Response } from "express";
import cors from "cors";
import connectDB from "./config/db";
import "./config/cloudinary";
import productRoutes from "./routes/productRoutes";
import stockRoutes from "./routes/Stockroutes";
import adminRoutes from "./routes/adminRoutes";          
import { ensureDefaultAdmin } from "./controllers/Admincontroller"; 
import { errorHandler } from "./middlewares/errorHandler";

const app = express();
const PORT = process.env.PORT ?? 5000;

connectDB().then(() => ensureDefaultAdmin());               

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (_req: Request, res: Response) => {
  res.json({ message: "Product Management API is running 🚀" });
});

app.use("/api/products", productRoutes);
app.use("/api/stocks",   stockRoutes);
app.use("/api/admin",    adminRoutes);                  

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});

export default app;