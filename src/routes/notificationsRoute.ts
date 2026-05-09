import { Router } from "express";
import mongoose from "mongoose";
import { protect } from "../middlewares/authMiddleware";
import Notification from "../models/Notification";

const router = Router();

// GET / - Get user's notifications
router.get("/", protect, async (req: any, res) => {
  try {
    const userId = req.user._id;
    console.log("🔍 User ID from token:", userId);
    console.log("🔍 User ID type:", typeof userId, userId?.constructor?.name);

    // Convert to ObjectId if it's a string
    const userObjectId =
      typeof userId === "string" ? new mongoose.Types.ObjectId(userId) : userId;

    console.log("🔍 Querying with ObjectId:", userObjectId);

    // DEBUG: Show ALL notifications
    const allNotifs = await Notification.find({}).lean();
    console.log(`📦 Total notifications in DB: ${allNotifs.length}`);
    allNotifs.forEach((n: any) => {
      console.log(
        `  - ID: ${n._id}, User: ${n.user} (type: ${typeof n.user}), Title: ${n.title}`,
      );
      console.log(
        `    Match? ${n.user.toString() === userObjectId.toString()}`,
      );
    });

    // Query with proper ObjectId
    const notifications = await Notification.find({ user: userObjectId })
      .sort({ createdAt: -1 })
      .lean();

    console.log(`📦 Notifications for user: ${notifications.length}`);

    const unreadCount = notifications.filter((n: any) => !n.isRead).length;

    res.json({
      success: true,
      data: {
        notifications,
        unreadCount,
        pagination: {
          total: notifications.length,
          page: 1,
          limit: 50,
          totalPages: Math.ceil(notifications.length / 50) || 1,
        },
      },
    });
  } catch (error) {
    console.error("❌ Error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// PATCH /:id/read
router.patch("/:id/read", protect, async (req: any, res) => {
  try {
    await Notification.findByIdAndUpdate(req.params.id, { isRead: true });
    res.json({ success: true, message: "Marked as read" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// PATCH /mark-all-read
router.patch("/mark-all-read", protect, async (req: any, res) => {
  try {
    await Notification.updateMany(
      { user: req.user._id, isRead: false },
      { isRead: true },
    );
    res.json({ success: true, message: "All marked as read" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// DELETE /:id
router.delete("/:id", protect, async (req: any, res) => {
  try {
    await Notification.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Notification deleted" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// DELETE /clear-all
router.delete("/clear-all", protect, async (req: any, res) => {
  try {
    await Notification.deleteMany({ user: req.user._id });
    res.json({ success: true, message: "All notifications cleared" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// TEMPORARY DEBUG ROUTE - Shows ALL notifications in database
router.get("/debug-all", async (req, res) => {
  try {
    const allNotifications = await Notification.find({})
      .sort({ createdAt: -1 })
      .lean();

    console.log(
      `📦 DEBUG: Total notifications in DB: ${allNotifications.length}`,
    );

    // Show each notification's user ID
    const summary = allNotifications.map((n: any) => ({
      id: n._id,
      user: n.user?.toString(),
      userType: typeof n.user,
      type: n.type,
      title: n.title,
      createdAt: n.createdAt,
    }));

    res.json({
      success: true,
      total: allNotifications.length,
      summary,
      notifications: allNotifications,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error" });
  }
});

// TEMPORARY TEST ROUTE - Create a test notification
router.post("/test-create", protect, async (req: any, res) => {
  try {
    console.log("🧪 Testing notification creation for user:", req.user._id);

    const testNotif = await Notification.create({
      user: req.user._id,
      type: "system",
      title: "Test Notification " + Date.now(),
      body: "This is a test notification to verify the model works.",
      isRead: false,
      data: { test: true },
    });

    console.log("✅ Test notification created:", testNotif._id);

    // Verify immediately
    const verify = await Notification.findById(testNotif._id);
    console.log("✅ Verified:", !!verify);

    // Count all
    const total = await Notification.countDocuments();
    console.log("📦 Total notifications in DB:", total);

    res.json({
      success: true,
      message: "Test notification created",
      notification: testNotif,
      totalInDB: total,
    });
  } catch (error: any) {
    console.error("❌ Test failed:", error.message, error);
    res.status(500).json({
      success: false,
      message: error.message,
      errorName: error.name,
      errors: error.errors,
    });
  }
});

export default router;
