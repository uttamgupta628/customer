import * as admin from "firebase-admin";

// Initialize Firebase Admin
if (!admin.apps.length) {
  // Option 1: Using service account JSON file
  // admin.initializeApp({
  //   credential: admin.credential.cert(
  //     require("../../firebase-service-account.json"),
  //   ),
  // });

  // Option 2: Using environment variables (for production)
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}

export default admin;
