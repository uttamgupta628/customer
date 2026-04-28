/**
 * Generate a random 6-digit OTP.
 * Padded so it's always 6 digits (e.g. 000123)
 */
const generateOtp = (): string => {
  return String(Math.floor(100000 + Math.random() * 900000));
};

/**
 * Validate GST number format.
 * @param gst - GST number to validate
 * @returns boolean indicating if GST is valid
 */
const isGstValid = (gst: string): boolean => {
  if (!gst) return false;
  const GST_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
  return GST_REGEX.test(gst.trim().toUpperCase());
};

/**
 * Determine approval status based on GST.
 * auto  → valid GST provided, approved immediately
 * manual → no GST or invalid GST, needs admin review
 * @param gstNumber - GST number to check
 * @returns approval status ('auto' or 'manual')
 */
const resolveApprovalStatus = (gstNumber: string): "auto" | "manual" => {
  return gstNumber && isGstValid(gstNumber) ? "auto" : "manual";
};

/**
 * Mock OTP sender.
 * TODO: Replace with Twilio / MSG91 / Fast2SMS integration.
 * @param phone - Phone number (10 digits)
 * @param otp - Generated OTP
 * @returns Promise<boolean>
 */
const sendOtp = async (phone: string, otp: string): Promise<boolean> => {
  console.log(`[OTP] Sending OTP ${otp} to +91${phone}`);

  // Example Twilio integration (uncomment when ready):
  // const twilioClient = require('twilio')(
  //   process.env.TWILIO_ACCOUNT_SID,
  //   process.env.TWILIO_AUTH_TOKEN
  // );
  // await twilioClient.messages.create({
  //   body: `Your OTP is ${otp}. Valid for 5 minutes. Do not share.`,
  //   from: process.env.TWILIO_PHONE_NUMBER,
  //   to: `+91${phone}`,
  // });

  return true;
};

// Optional: Export types for use in other files
export type ApprovalStatus = "auto" | "manual";

export { generateOtp, isGstValid, resolveApprovalStatus, sendOtp };
