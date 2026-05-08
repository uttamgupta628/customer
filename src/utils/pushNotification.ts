import mongoose from "mongoose";
import User from "../models/Users";
import Notification from "../models/Notification";

interface ExpoPushMessage {
  to: string;
  sound?: string;
  title: string;
  body: string;
  data?: any;
  badge?: number;
  priority?: "default" | "normal" | "high";
  channelId?: string;
}

export async function sendPushNotification(
  userId: string,
  title: string,
  body: string,
  data?: any,
): Promise<void> {
  try {
    console.log("📝 Starting sendPushNotification for user:", userId);
    console.log("📝 Title:", title);
    console.log("📝 Body:", body);
    console.log("📝 Data:", JSON.stringify(data));

    // Try to save notification FIRST before sending push
    try {
      const userObjectId = new mongoose.Types.ObjectId(userId);

      const notificationType =
        data?.type === "approval_status"
          ? "approval_status"
          : data?.type === "order_status_update"
            ? "order_status"
            : data?.type === "manual_broadcast"
              ? "manual_broadcast"
              : "system";

      console.log("📝 Creating notification with:");
      console.log("   user:", userObjectId);
      console.log("   type:", notificationType);
      console.log("   title:", title);
      console.log("   body:", body);

      const savedNotification = await Notification.create({
        user: userObjectId,
        type: notificationType,
        title,
        body,
        isRead: false,
        data: data || {},
      });

      console.log("✅ Notification saved successfully!");
      console.log("   ID:", savedNotification._id);
      console.log("   User:", savedNotification.user);
      console.log("   Type:", savedNotification.type);

      // Verify it was saved
      const verify = await Notification.findById(savedNotification._id);
      console.log("✅ Verified in DB:", !!verify);
    } catch (dbError: any) {
      console.error("❌ FAILED to save notification to DB!");
      console.error("   Error name:", dbError.name);
      console.error("   Error message:", dbError.message);
      console.error("   Full error:", JSON.stringify(dbError, null, 2));

      // If it's a validation error, log details
      if (dbError.name === "ValidationError") {
        console.error(
          "   Validation errors:",
          JSON.stringify(dbError.errors, null, 2),
        );
      }
    }

    // Send push via Expo
    const user = await User.findById(userId).lean();
    if (!user || !user.pushTokens || user.pushTokens.length === 0) {
      console.log("📱 No push tokens for user:", userId);
      return;
    }

    const messages: ExpoPushMessage[] = (user.pushTokens as any[]).map(
      (token: any) => ({
        to: token.token,
        sound: "default",
        title,
        body,
        data: { ...data, timestamp: new Date().toISOString() },
        badge: 1,
        priority: "high",
        channelId: "default",
      }),
    );

    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(messages),
    });

    const result = await response.json();
    console.log(
      "📤 Push sent result:",
      JSON.stringify(result).substring(0, 200),
    );
  } catch (error) {
    console.error("❌ CRITICAL ERROR in sendPushNotification:", error);
  }
}
