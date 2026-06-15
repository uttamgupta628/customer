import "dotenv/config"; 

import express, { Request, Response } from "express";
import cors from "cors";
import connectDB from "./config/db";
import "./config/cloudinary";
import productRoutes from "./routes/productRoutes";
import stockRoutes from "./routes/Stockroutes";
import adminRoutes from "./routes/adminRoutes";
import authRoutes from "./routes/authRoutes";
import orderRoutes from "./routes/Orderroutes";
import notificationRoute from "./routes/notificationsRoute";
import { ensureDefaultAdmin } from "./controllers/Admincontroller";
import { errorHandler } from "./middlewares/errorHandler";

const app = express();
const PORT = process.env.PORT ?? 5000;

if (!process.env.JWT_SECRET) {
  throw new Error("FATAL: JWT_SECRET is not set. Check your .env file.");
}

connectDB().then(() => ensureDefaultAdmin());

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// In server.ts or routes - TEMPORARY DEBUG
app.get("/api/debug/product-images", async (req, res) => {
  try {
    const Product = require("./models/Product").default;
    const products = await Product.find({}).limit(5).lean();
    const summary = products.map((p: { name: any; images: any[] }) => ({
      name: p.name,
      imagesCount: p.images?.length || 0,
      images: p.images?.map((img: any) => ({
        url: img.url?.substring(0, 80),
        publicId: img.publicId,
        isPrimary: img.isPrimary,
      })),
    }));
    res.json({ success: true, total: products.length, products: summary });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Add this in server.ts before your routes
app.post("/test-notification/:userId", async (req: Request, res: Response) => {
  try {
    const mongoose = require("mongoose");
    const Notification = require("./models/Notification").default;
    const userId = req.params.userId;

    console.log("🧪 Testing notification creation for user:", userId);

    const testNotif = await Notification.create({
      user: new mongoose.Types.ObjectId(userId),
      type: "manual_broadcast",
      title: "Test Notification " + Date.now(),
      body: "This is a test notification.",
      isRead: false,
    });

    console.log("✅ Test notification created:", testNotif._id);

    const total = await Notification.countDocuments();
    console.log("📦 Total notifications:", total);

    res.json({ success: true, notification: testNotif, total });
  } catch (error: any) {
    console.error("❌ Error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get("/", (_req: Request, res: Response) => {
  res.json({ message: "Product Management API is running 🚀" });
});

app.use("/api/products", productRoutes);
app.use("/api/stocks", stockRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/orders", orderRoutes); // ✅ Make sure this line exists!
app.use("/api/notifications", notificationRoute); // ✅ Make sure this line exists!
app.use("/auth", authRoutes);

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});

export default app;
