import admin from "./firebaseAdmin";
import mongoose from "mongoose";
import Notification from "../models/Notification";
import User from "../models/Users";

interface PushNotificationData {
  type?: string;
  screen?: string;
  status?: string;
  orderId?: string;
  [key: string]: any;
}

export async function sendPushNotification(
  userId: string,
  title: string,
  body: string,
  data?: PushNotificationData,
): Promise<void> {
  try {
    console.log("═══════════════════════════════════════════════");
    console.log("📝 FCM PUSH DEBUG - Starting");
    console.log("═══════════════════════════════════════════════");
    console.log("📝 User ID:", userId);
    console.log("📝 Title:", title);
    console.log("📝 Body:", body);
    console.log("📝 Data:", JSON.stringify(data));

    // ── 1. Save notification to database ─────────────────────────────────
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

      const savedNotification = await Notification.create({
        user: userObjectId,
        type: notificationType,
        title,
        body,
        isRead: false,
        data: data || {},
      });

      console.log("✅ [DB] Notification saved:", savedNotification._id);
    } catch (dbError: any) {
      console.error("❌ [DB] Failed to save notification:", dbError.message);
      console.error("❌ [DB] Full error:", dbError);
    }

    // ── 2. Get user's FCM tokens ────────────────────────────────────────
    console.log("🔍 [USER] Looking up user:", userId);
    const user = await User.findById(userId).lean();

    if (!user) {
      console.log("❌ [USER] User not found in database:", userId);
      console.log("═══════════════════════════════════════════════");
      return;
    }

    console.log("✅ [USER] User found:", user.phone);
    console.log(
      "🔍 [TOKENS] fcmTokens array length:",
      user.fcmTokens?.length || 0,
    );
    console.log(
      "🔍 [TOKENS] pushTokens array length:",
      user.pushTokens?.length || 0,
    );

    // Log actual token data (masked for security)
    if (user.fcmTokens && user.fcmTokens.length > 0) {
      user.fcmTokens.forEach((t: any, i: number) => {
        console.log(`🔍 [TOKENS] fcmTokens[${i}]:`, {
          token: t.token?.substring(0, 20) + "...",
          platform: t.platform,
          device: t.device,
          lastUsed: t.lastUsed,
        });
      });
    }

    if (user.pushTokens && user.pushTokens.length > 0) {
      user.pushTokens.forEach((t: any, i: number) => {
        console.log(`🔍 [TOKENS] pushTokens[${i}]:`, {
          token: t.token?.substring(0, 20) + "...",
          isExpo: t.token?.startsWith("ExponentPushToken"),
          platform: t.platform,
        });
      });
    }

    // Collect all FCM tokens from user
    let tokens: string[] = [];

    // Check for fcmTokens array (new format)
    if (user.fcmTokens && user.fcmTokens.length > 0) {
      tokens = user.fcmTokens.map((t: any) => t.token);
      console.log(
        `✅ [TOKENS] Found ${tokens.length} FCM tokens in fcmTokens array`,
      );
    }
    // Check for pushTokens array and filter out Expo tokens (backward compatibility)
    else if (user.pushTokens && user.pushTokens.length > 0) {
      const allTokens = user.pushTokens.map((t: any) => t.token);
      const expoTokens = allTokens.filter((t: string) =>
        t.startsWith("ExponentPushToken"),
      );
      tokens = allTokens.filter(
        (t: string) => !t.startsWith("ExponentPushToken"),
      );

      console.log(`🔍 [TOKENS] pushTokens summary:`);
      console.log(`   Total tokens: ${allTokens.length}`);
      console.log(`   Expo tokens (skipped): ${expoTokens.length}`);
      console.log(`   FCM tokens (valid): ${tokens.length}`);

      if (tokens.length > 0) {
        console.log(
          `✅ [TOKENS] Using ${tokens.length} FCM tokens from pushTokens array`,
        );
      } else {
        console.log("❌ [TOKENS] Only Expo tokens found in pushTokens");
        console.log(
          "   User needs to login from the new app build to get FCM token",
        );
        console.log("═══════════════════════════════════════════════");
        return;
      }
    }

    if (tokens.length === 0) {
      console.log("❌ [TOKENS] No valid FCM tokens for user:", userId);
      console.log("   Possible reasons:");
      console.log("   1. User hasn't logged in from the new app build");
      console.log("   2. User has only Expo push tokens (old app)");
      console.log("   3. Token registration to backend failed");
      console.log("═══════════════════════════════════════════════");
      return;
    }

    // ── 3. Prepare FCM message ──────────────────────────────────────────
    console.log("📦 [FCM] Preparing message for", tokens.length, "devices");

    // Convert all data values to strings (FCM requirement)
    const stringData: Record<string, string> = {};
    if (data) {
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined && value !== null) {
          stringData[key] = String(value);
        }
      }
    }
    console.log("📦 [FCM] String data:", JSON.stringify(stringData));

    const message: admin.messaging.MulticastMessage = {
      tokens,
      notification: {
        title,
        body,
      },
      data: stringData,
      android: {
        priority: "high",
        notification: {
          channelId: "default",
          sound: "default",
          priority: "high",
        },
      },
      apns: {
        payload: {
          aps: {
            sound: "default",
            badge: 1,
            "content-available": 1,
          },
        },
      },
    };

    console.log("📤 [FCM] Sending multicast message...");
    console.log(`📤 [FCM] Target tokens: ${tokens.length}`);

    // ── 4. Send notifications ───────────────────────────────────────────
    const response = await admin.messaging().sendEachForMulticast(message);

    console.log(`\n📊 [FCM] Results:`);
    console.log(`  ✅ Success: ${response.successCount}`);
    console.log(`  ❌ Failure: ${response.failureCount}`);
    console.log(`  📝 Total processed: ${response.responses.length}`);

    // Handle failed tokens
    if (response.failureCount > 0) {
      const invalidTokens: string[] = [];

      response.responses.forEach((resp: any, idx: number) => {
        if (!resp.success) {
          const error = resp.error;
          console.error(`  ❌ Token ${idx} FAILED:`);
          console.error(`     Code: ${error.code}`);
          console.error(`     Message: ${error.message}`);
          console.error(`     Token: ${tokens[idx]?.substring(0, 30)}...`);

          // Collect invalid tokens for cleanup
          if (
            error.code === "messaging/invalid-registration-token" ||
            error.code === "messaging/registration-token-not-registered" ||
            error.code === "messaging/invalid-argument"
          ) {
            invalidTokens.push(tokens[idx]);
            console.log(`     🧹 Will remove this invalid token`);
          }
        } else {
          console.log(`  ✅ Token ${idx}: Message ID: ${resp.messageId}`);
        }
      });

      // Remove invalid tokens from database
      if (invalidTokens.length > 0) {
        console.log(`🧹 Cleaning up ${invalidTokens.length} invalid tokens...`);
        const updateResult = await User.findByIdAndUpdate(userId, {
          $pull: {
            fcmTokens: { token: { $in: invalidTokens } },
            pushTokens: { token: { $in: invalidTokens } },
          },
        });
        console.log(
          `🧹 Token cleanup result:`,
          updateResult ? "Success" : "Failed",
        );
      }
    }

    if (response.successCount > 0) {
      console.log(
        `\n✅ [SUCCESS] Push notifications sent to ${response.successCount} device(s)`,
      );
      console.log("   The notification should appear on the user's device");
      console.log("   If not visible, check:");
      console.log("   - Is app in foreground? (handled by onMessage)");
      console.log("   - Are notifications enabled for this app?");
      console.log("   - Is Do Not Disturb mode on?");
    } else {
      console.log(`\n❌ [FAILED] No notifications were sent successfully`);
      console.log("   All tokens failed or were invalid");
    }

    console.log("═══════════════════════════════════════════════\n");
  } catch (error) {
    console.error("❌ [CRITICAL] FCM sendPushNotification failed:");
    console.error("   Error:", error);
    if (error instanceof Error) {
      console.error("   Message:", error.message);
      console.error("   Stack:", error.stack);
    }
    console.log("═══════════════════════════════════════════════\n");
  }
}

// ─── Send push to multiple users ────────────────────────────────────────
export async function sendBulkPushNotification(
  userIds: string[],
  title: string,
  body: string,
  data?: PushNotificationData,
): Promise<{ sent: number; failed: number }> {
  console.log(`\n📢 [BULK] Sending push to ${userIds.length} users`);
  let sent = 0;
  let failed = 0;

  for (const userId of userIds) {
    try {
      await sendPushNotification(userId, title, body, data);
      sent++;
    } catch (error) {
      failed++;
      console.error(`❌ [BULK] Failed to send to user ${userId}:`, error);
    }
  }

  console.log(`📊 [BULK] Results: ${sent} sent, ${failed} failed\n`);
  return { sent, failed };
}
