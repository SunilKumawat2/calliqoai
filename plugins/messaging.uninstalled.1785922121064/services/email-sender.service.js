import { db } from "../../../server/db.js";
import { sql } from "drizzle-orm";
import nodemailer from "nodemailer";
let transporter = null;
let fromAddress = "";
let fromName = "";
let smtpConfigured = false;
function cleanDbValue(value) {
  if (!value) return "";
  let cleaned = value.trim();
  while (cleaned.startsWith('"""') && cleaned.endsWith('"""') || cleaned.startsWith('"') && cleaned.endsWith('"') && cleaned.length > 2) {
    if (cleaned.startsWith('"""') && cleaned.endsWith('"""')) {
      cleaned = cleaned.slice(3, -3);
    } else if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
      cleaned = cleaned.slice(1, -1);
    }
    cleaned = cleaned.trim();
  }
  return cleaned;
}
function createTransporter(host, portNum, user, pass) {
  return nodemailer.createTransport({
    host,
    port: portNum,
    secure: portNum === 465,
    requireTLS: portNum === 587,
    pool: true,
    maxConnections: 5,
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
    connectionTimeout: 15e3,
    greetingTimeout: 15e3,
    socketTimeout: 15e3
  });
}
async function initializeFromDatabase() {
  try {
    const settings = await db.execute(sql`
      SELECT key, value FROM global_settings WHERE key IN ('smtp_host', 'smtp_port', 'smtp_username', 'smtp_password', 'smtp_from_email', 'smtp_from_name')
    `);
    let rows = [];
    if (Array.isArray(settings)) {
      rows = settings;
    } else if (Array.isArray(settings.rows)) {
      rows = settings.rows;
    }
    const map = {};
    for (const row of rows) {
      map[row.key] = typeof row.value === "string" ? row.value : String(row.value ?? "");
    }
    const host = cleanDbValue(map["smtp_host"]);
    const port = map["smtp_port"];
    const user = cleanDbValue(map["smtp_username"]);
    const pass = cleanDbValue(map["smtp_password"]);
    const fromEmail = cleanDbValue(map["smtp_from_email"]);
    const fName = cleanDbValue(map["smtp_from_name"]);
    if (host && port && user && pass) {
      const portNum = typeof port === "string" ? parseInt(port, 10) : Number(port);
      transporter = createTransporter(host, portNum, user, pass);
      smtpConfigured = true;
      fromAddress = fromEmail || user || "";
      fromName = fName || "";
      return true;
    }
    console.warn("[Email Sender] SMTP settings incomplete in admin panel (missing host, port, username, or password).");
  } catch (error) {
    console.warn("[Email Sender] Could not load SMTP settings from database:", error.message);
  }
  smtpConfigured = false;
  transporter = null;
  return false;
}
async function sendEmail(to, subject, html) {
  const dbLoaded = await initializeFromDatabase();
  if (!dbLoaded || !smtpConfigured || !transporter) {
    const reason = "SMTP not configured. Please set up SMTP in Admin Settings \u2192 Master Settings.";
    console.warn(`[Email Sender] Cannot send to ${to}: ${reason}`);
    return { success: false, error: reason };
  }
  const from = fromName ? `"${fromName}" <${fromAddress}>` : fromAddress;
  if (!from) {
    return { success: false, error: "No from address configured in Admin Settings \u2192 Master Settings." };
  }
  try {
    const info = await transporter.sendMail({ from, to, subject, html });
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error(`[Email Sender] Failed to send email to ${to}:`, error.message);
    return { success: false, error: error.message };
  }
}
export {
  sendEmail
};
