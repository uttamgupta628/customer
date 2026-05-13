import * as admin from "firebase-admin";

// Initialize Firebase Admin
if (!admin.apps.length) {
  // Check if GOOGLE_APPLICATION_CREDENTIALS is set (production with Render)
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    // Use the path from environment variable (works with Render Secret Files)
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
    });
    console.log("✅ Firebase initialized using GOOGLE_APPLICATION_CREDENTIALS");
  }
  // Fallback: Try individual environment variables
  //   else if (process.env.FIREBASE_PRIVATE_KEY) {
  //     admin.initializeApp({
  //       credential: admin.credential.cert({
  //         projectId: process.env.FIREBASE_PROJECT_ID,
  //         clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  //         privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  //       }),
  //     });
  //     console.log("✅ Firebase initialized using environment variables");
  //   }
  // Fallback: Local development with JSON file
  //   else {
  //     try {
  //       admin.initializeApp({
  //         credential: admin.credential.cert(
  //           require("../../firebase-service-account.json"),
  //         ),
  //       });
  //       console.log("✅ Firebase initialized using local JSON file");
  //     } catch (error) {
  //       console.error("❌ Failed to initialize Firebase Admin SDK");
  //       console.error("   Make sure one of these is available:");
  //       console.error("   1. GOOGLE_APPLICATION_CREDENTIALS env variable");
  //       console.error("   2. FIREBASE_PRIVATE_KEY env variable");
  //       console.error("   3. firebase-service-account.json in project root");
  //     }
  //   }
}

export default admin;
