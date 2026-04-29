import User from "../models/Users";

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

    // Send to Expo push service
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(messages),
    });

    const result = await response.json();
    console.log("📤 Push notification sent:", JSON.stringify(result));
  } catch (error) {
    console.error("❌ Failed to send push notification:", error);
  }
}
