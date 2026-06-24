import sgMail from "@sendgrid/mail";

// Initialize SendGrid with API key
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const SENDGRID_FROM_EMAIL =
  process.env.SENDGRID_FROM_EMAIL || "noreply@thumpbeyondlimits.com";
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "admin@admin.com").split(",");
const ADMIN_PANEL_URL =
  process.env.ADMIN_PANEL_URL || "https://admin-panel-lovat-eta.vercel.app/";

if (SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY);
}

interface NewRegistrationEmailData {
  customerName: string;
  phone: string;
  city?: string;
  state?: string;
  gstNumber?: string;
  addressLine1?: string;
  addressLine2?: string;
  pincode?: string;
  customerId: string;
  approvalType: "auto" | "manual";
  createdAt: Date;
}

export const sendNewRegistrationEmail = async (
  data: NewRegistrationEmailData,
): Promise<void> => {
  if (!SENDGRID_API_KEY) {
    console.warn("[SendGrid] API key not configured. Skipping email.");
    return;
  }

  const {
    customerName,
    phone,
    city,
    state,
    gstNumber,
    addressLine1,
    addressLine2,
    pincode,
    customerId,
    approvalType,
    createdAt,
  } = data;

  const address = [addressLine1, addressLine2, city, state, pincode]
    .filter(Boolean)
    .join(", ");

  const gstInfo = gstNumber
    ? gstNumber
    : "Not provided (Manual Approval Required)";

  const approvalBadge =
    approvalType === "auto"
      ? `<span style="background-color: #22C55E; color: white; padding: 4px 12px; border-radius: 20px; font-size: 12px; margin-left: 8px;">Auto Approved</span>`
      : `<span style="background-color: #F59E0B; color: white; padding: 4px 12px; border-radius: 20px; font-size: 12px; margin-left: 8px;">Needs Approval</span>`;

  const htmlTemplate = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>New Customer Registration</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f4f4f9; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f9; padding: 20px;">
        <tr>
          <td align="center">
            <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.08);">
              
              <!-- Header -->
              <tr>
                <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 32px 40px; text-align: center;">
                  <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 700;">🔔 New Customer Registration</h1>
                  <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0; font-size: 14px;">${approvalType === "manual" ? "⚠️ Manual review required - No GST provided" : "✅ Auto-approved with valid GST"}</p>
                </td>
              </tr>

              <!-- Content -->
              <tr>
                <td style="padding: 32px 40px;">
                  
                  <!-- Customer Info -->
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="padding-bottom: 24px;">
                        <h2 style="color: #1a1a2e; margin: 0 0 4px; font-size: 20px;">
                          ${customerName || "New Customer"}
                          ${approvalBadge}
                        </h2>
                        <p style="color: #666; margin: 4px 0 0; font-size: 13px;">
                          Registered on ${new Date(
                            createdAt,
                          ).toLocaleDateString("en-IN", {
                            weekday: "long",
                            year: "numeric",
                            month: "long",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </td>
                    </tr>
                  </table>

                  <!-- Details Card -->
                  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8f9ff; border-radius: 8px; border: 1px solid #e8eaff;">
                    
                    <!-- Phone -->
                    <tr>
                      <td style="padding: 16px 20px; border-bottom: 1px solid #e8eaff;">
                        <table width="100%" cellpadding="0" cellspacing="0">
                          <tr>
                            <td style="width: 32px; vertical-align: top; padding-top: 2px;">
                              <span style="font-size: 18px;">📱</span>
                            </td>
                            <td style="vertical-align: top;">
                              <p style="color: #999; margin: 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;">Mobile Number</p>
                              <p style="color: #1a1a2e; margin: 4px 0 0; font-size: 15px; font-weight: 600;">+91 ${phone}</p>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>

                    <!-- Address -->
                    <tr>
                      <td style="padding: 16px 20px; border-bottom: 1px solid #e8eaff;">
                        <table width="100%" cellpadding="0" cellspacing="0">
                          <tr>
                            <td style="width: 32px; vertical-align: top; padding-top: 2px;">
                              <span style="font-size: 18px;">📍</span>
                            </td>
                            <td style="vertical-align: top;">
                              <p style="color: #999; margin: 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;">Business Address</p>
                              <p style="color: #1a1a2e; margin: 4px 0 0; font-size: 15px; font-weight: 600;">${address || "Not provided"}</p>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>

                    <!-- GST -->
                    <tr>
                      <td style="padding: 16px 20px;">
                        <table width="100%" cellpadding="0" cellspacing="0">
                          <tr>
                            <td style="width: 32px; vertical-align: top; padding-top: 2px;">
                              <span style="font-size: 18px;">🧾</span>
                            </td>
                            <td style="vertical-align: top;">
                              <p style="color: #999; margin: 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;">GST Number</p>
                              <p style="color: #1a1a2e; margin: 4px 0 0; font-size: 15px; font-weight: 600; font-family: 'Courier New', monospace; letter-spacing: 0.5px;">${gstInfo}</p>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>

                  <!-- Status Badge -->
                  <table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 20px;">
                    <tr>
                      <td style="background-color: ${approvalType === "auto" ? "#E6F9F0" : "#FFF8E1"}; border-radius: 8px; padding: 16px 20px;">
                        <p style="margin: 0; color: ${approvalType === "auto" ? "#16A34A" : "#D97706"}; font-size: 14px;">
                          <strong>${approvalType === "auto" ? "✅ Auto Approved" : "⚠️ Manual Approval Required"}</strong>
                          ${approvalType === "manual" ? " – This customer did not provide GST and needs admin review before they can place orders." : " – GST verified, account is active."}
                        </p>
                      </td>
                    </tr>
                  </table>

                  <!-- CTA Button -->
                  <table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 28px;">
                    <tr>
                      <td align="center">
                        <a href="${ADMIN_PANEL_URL}" 
                           style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #ffffff; text-decoration: none; padding: 14px 40px; border-radius: 8px; font-weight: 700; font-size: 15px; box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);">
                          🔗 Open Admin Panel to ${approvalType === "manual" ? "Review" : "View"}
                        </a>
                      </td>
                    </tr>
                    <tr>
                      <td align="center" style="padding-top: 12px;">
                        <p style="color: #999; font-size: 12px; margin: 0;">
                          Customer ID: <span style="font-family: 'Courier New', monospace; color: #666;">${customerId}</span>
                        </p>
                      </td>
                    </tr>
                  </table>

                </td>
              </tr>

              <!-- Footer -->
              <tr>
                <td style="background-color: #f8f9ff; padding: 20px 40px; border-top: 1px solid #e8eaff;">
                  <p style="color: #999; font-size: 12px; margin: 0; text-align: center;">
                    This is an automated notification from <strong>Thump Beyond Limits</strong> Admin System.
                    <br>
                    Please do not reply to this email.
                  </p>
                </td>
              </tr>

            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  const textVersion = `
NEW CUSTOMER REGISTRATION - ${approvalType === "auto" ? "AUTO APPROVED" : "NEEDS APPROVAL"}
================================================================

Customer: ${customerName || "New Customer"}
Phone: +91 ${phone}
Address: ${address || "Not provided"}
GST: ${gstNumber || "Not provided (Manual Approval Required)"}
Registered: ${new Date(createdAt).toLocaleDateString("en-IN", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })}
Customer ID: ${customerId}

Status: ${approvalType === "auto" ? "Auto Approved - Account is active" : "Manual Approval Required - Needs admin review (No GST provided)"}

Open Admin Panel: ${ADMIN_PANEL_URL}

---
Thump Beyond Limits Admin System
This is an automated notification.
  `.trim();

  const msg = {
    to: ADMIN_EMAILS,
    from: SENDGRID_FROM_EMAIL,
    subject: `${approvalType === "manual" ? "⚠️ ACTION REQUIRED: " : "✅ "}New Customer Registration - ${customerName || phone}${approvalType === "manual" ? " (Manual Approval - No GST)" : " (Auto Approved)"}`,
    text: textVersion,
    html: htmlTemplate,
  };

  try {
    await sgMail.send(msg);
    console.log(
      `[SendGrid] Registration email sent for customer: ${customerName || phone} (${approvalType})`,
    );
  } catch (error) {
    console.error("[SendGrid] Failed to send registration email:", error);
    // Don't throw - email failure shouldn't break the registration flow
  }
};

export const sendOtpEmail = async (email: string, otp: string): Promise<void> => {
  if (!SENDGRID_API_KEY) {
    console.warn("[SendGrid] API key not configured. Skipping OTP email.");
    return;
  }

  const htmlTemplate = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Your Verification Code</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f4f4f9; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f9; padding: 20px;">
        <tr>
          <td align="center">
            <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.08);">
              <!-- Header -->
              <tr>
                <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 32px 40px; text-align: center;">
                  <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 700;">Verification Code</h1>
                </td>
              </tr>
              <!-- Content -->
              <tr>
                <td style="padding: 32px 40px; text-align: center;">
                  <p style="color: #333; font-size: 16px; line-height: 1.5; margin-bottom: 24px;">Please use the following verification code to log in to your account. This code is valid for 5 minutes.</p>
                  <div style="background-color: #f8f9ff; border: 1px solid #e8eaff; border-radius: 8px; display: inline-block; padding: 16px 40px; font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #764ba2; margin-bottom: 24px;">
                    ${otp}
                  </div>
                  <p style="color: #999; font-size: 13px; margin: 0;">If you did not request this verification code, please ignore this email.</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  const textVersion = `Your verification code is ${otp}. Valid for 5 minutes.`;

  const msg = {
    to: email.trim().toLowerCase(),
    from: SENDGRID_FROM_EMAIL,
    subject: `Your Verification Code - ${otp}`,
    text: textVersion,
    html: htmlTemplate,
  };

  try {
    await sgMail.send(msg);
    console.log(`[SendGrid] OTP email sent to ${email}`);
  } catch (error) {
    console.error("[SendGrid] Failed to send OTP email:", error);
    throw new Error("Failed to send OTP email. Please check your email address.");
  }
};
