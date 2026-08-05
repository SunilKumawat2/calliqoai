import crypto from "crypto";
import fs from "fs";
import path from "path";
const PERSISTED_SECRET_PATH = path.join(process.cwd(), ".appointment-webhook-secret");
let appointmentWebhookSecret = null;
function getAppointmentWebhookSecret() {
  if (!appointmentWebhookSecret) {
    if (process.env.APPOINTMENT_WEBHOOK_SECRET) {
      appointmentWebhookSecret = process.env.APPOINTMENT_WEBHOOK_SECRET;
    } else {
      try {
        if (fs.existsSync(PERSISTED_SECRET_PATH)) {
          appointmentWebhookSecret = fs.readFileSync(PERSISTED_SECRET_PATH, "utf-8").trim();
          console.log(`[Webhook Auth] Loaded persisted webhook secret from file`);
        }
      } catch (err) {
      }
      if (!appointmentWebhookSecret) {
        appointmentWebhookSecret = crypto.randomBytes(32).toString("hex");
        console.log(`[Webhook Auth] Generated new webhook secret`);
      }
      try {
        fs.writeFileSync(PERSISTED_SECRET_PATH, appointmentWebhookSecret, { mode: 384 });
      } catch (err) {
        console.warn(`[Webhook Auth] Could not persist webhook secret to file`);
      }
    }
  }
  return appointmentWebhookSecret;
}
function validateAppointmentWebhookToken(providedToken) {
  if (!providedToken) {
    return false;
  }
  const secret = getAppointmentWebhookSecret();
  const providedBuffer = Buffer.from(providedToken);
  const secretBuffer = Buffer.from(secret);
  if (providedBuffer.length !== secretBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(providedBuffer, secretBuffer);
}
export {
  getAppointmentWebhookSecret,
  validateAppointmentWebhookToken
};
