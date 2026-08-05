import { db } from '../../../server/db';
import { sql } from 'drizzle-orm';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

let transporter: Transporter | null = null;
let fromAddress: string = '';
let fromName: string = '';
let smtpConfigured: boolean = false;

function cleanDbValue(value: string | undefined | null): string {
  if (!value) return '';
  let cleaned = value.trim();
  while (
    (cleaned.startsWith('"""') && cleaned.endsWith('"""')) ||
    (cleaned.startsWith('"') && cleaned.endsWith('"') && cleaned.length > 2)
  ) {
    if (cleaned.startsWith('"""') && cleaned.endsWith('"""')) {
      cleaned = cleaned.slice(3, -3);
    } else if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
      cleaned = cleaned.slice(1, -1);
    }
    cleaned = cleaned.trim();
  }
  return cleaned;
}

function createTransporter(host: string, portNum: number, user: string, pass: string): Transporter {
  return nodemailer.createTransport({
    host,
    port: portNum,
    secure: portNum === 465,
    requireTLS: portNum === 587,
    pool: true,
    maxConnections: 5,
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 15000,
  } as any);
}

async function initializeFromDatabase(): Promise<boolean> {
  try {
    const settings = await db.execute(sql`
      SELECT key, value FROM global_settings WHERE key IN ('smtp_host', 'smtp_port', 'smtp_username', 'smtp_password', 'smtp_from_email', 'smtp_from_name')
    `);

    // Handle both drizzle-orm result formats:
    // - Older versions wrap rows: { rows: [...] }
    // - Newer versions return the array directly
    let rows: any[] = [];
    if (Array.isArray(settings)) {
      rows = settings;
    } else if (Array.isArray((settings as any).rows)) {
      rows = (settings as any).rows;
    }

    const map: Record<string, string> = {};
    for (const row of rows) {
      map[row.key] = typeof row.value === 'string' ? row.value : String(row.value ?? '');
    }

    const host = cleanDbValue(map['smtp_host']);
    const port = map['smtp_port'];
    const user = cleanDbValue(map['smtp_username']);
    const pass = cleanDbValue(map['smtp_password']);
    const fromEmail = cleanDbValue(map['smtp_from_email']);
    const fName = cleanDbValue(map['smtp_from_name']);

    if (host && port && user && pass) {
      const portNum = typeof port === 'string' ? parseInt(port, 10) : Number(port);
      transporter = createTransporter(host, portNum, user, pass);
      smtpConfigured = true;
      fromAddress = fromEmail || user || '';
      fromName = fName || '';
      return true;
    }

    console.warn('[Email Sender] SMTP settings incomplete in admin panel (missing host, port, username, or password).');
  } catch (error) {
    console.warn('[Email Sender] Could not load SMTP settings from database:', (error as any).message);
  }

  smtpConfigured = false;
  transporter = null;
  return false;
}

export async function sendEmail(
  to: string,
  subject: string,
  html: string
): Promise<{ success: boolean; error?: string; messageId?: string }> {
  const dbLoaded = await initializeFromDatabase();

  if (!dbLoaded || !smtpConfigured || !transporter) {
    const reason = 'SMTP not configured. Please set up SMTP in Admin Settings → Master Settings.';
    console.warn(`[Email Sender] Cannot send to ${to}: ${reason}`);
    return { success: false, error: reason };
  }

  const from = fromName ? `"${fromName}" <${fromAddress}>` : fromAddress;
  if (!from) {
    return { success: false, error: 'No from address configured in Admin Settings → Master Settings.' };
  }

  try {
    const info = await transporter.sendMail({ from, to, subject, html });
    return { success: true, messageId: info.messageId };
  } catch (error: any) {
    console.error(`[Email Sender] Failed to send email to ${to}:`, error.message);
    return { success: false, error: error.message };
  }
}
