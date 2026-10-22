'use strict';
/**
 * ============================================================
 * Calliqo AI - Company / Tenant Custom SMTP API Routes
 * 
 * Allows each tenant / company to connect, configure, and test
 * their own domain email (Gmail, Custom SMTP, Outlook, SendGrid)
 * directly from the CRM panel.
 * ============================================================
 */

import { Router, type Request, type Response } from 'express';
import { db } from '../db';
import { userSmtpSettings } from '@shared/schema';
import { eq } from 'drizzle-orm';
import nodemailer from 'nodemailer';
import { emailService } from '../services/email-service';
import { logger } from '../utils/logger';

export const crmSmtpRouter = Router();

function getUserId(req: Request): string | null {
  return (req as any).user?.id || (req as any).userId || null;
}

// ── 1. GET /api/crm/smtp-settings (Fetch Company SMTP Config) ──
crmSmtpRouter.get('/smtp-settings', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const [settings] = await db
      .select()
      .from(userSmtpSettings)
      .where(eq(userSmtpSettings.userId, userId))
      .limit(1);

    if (!settings) {
      return res.json({
        configured: false,
        settings: null,
      });
    }

    // Mask password for security
    const sanitized = {
      id: settings.id,
      provider: settings.provider || 'custom',
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      username: settings.username,
      password: '********',
      passwordSet: Boolean(settings.password),
      fromEmail: settings.fromEmail,
      fromName: settings.fromName,
      replyTo: settings.replyTo || '',
      isActive: settings.isActive,
      lastTestedAt: settings.lastTestedAt,
      updatedAt: settings.updatedAt,
    };

    res.json({
      configured: Boolean(settings.host && settings.username && settings.password),
      settings: sanitized,
    });
  } catch (error: any) {
    logger.error(`[CRMSmtp] Error fetching SMTP settings for user ${userId}: ${error.message}`, error, 'CRMSmtp');
    res.status(500).json({ error: 'Failed to fetch company email settings' });
  }
});

// ── 2. PUT /api/crm/smtp-settings (Save Company SMTP Config) ──
crmSmtpRouter.put('/smtp-settings', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const {
      provider,
      host,
      port,
      secure,
      username,
      password,
      fromEmail,
      fromName,
      replyTo,
      isActive,
    } = req.body;

    if (!host || !username || !fromEmail || !fromName) {
      return res.status(400).json({ error: 'Host, username, sender email, and sender name are required' });
    }

    const portNum = Number(port) || 587;
    const isSecure = secure === true || secure === 'true' || portNum === 465;

    // Check existing record to preserve password if masked
    const [existing] = await db
      .select()
      .from(userSmtpSettings)
      .where(eq(userSmtpSettings.userId, userId))
      .limit(1);

    let finalPassword = (password || '').trim();
    if ((finalPassword === '********' || !finalPassword) && existing) {
      finalPassword = existing.password;
    }

    if (!finalPassword) {
      return res.status(400).json({ error: 'Password or App Password is required' });
    }

    const payload = {
      userId,
      provider: provider || 'custom',
      host: host.trim(),
      port: portNum,
      secure: isSecure,
      username: username.trim(),
      password: finalPassword,
      fromEmail: fromEmail.trim(),
      fromName: fromName.trim(),
      replyTo: replyTo ? replyTo.trim() : null,
      isActive: isActive !== false,
      updatedAt: new Date(),
    };

    if (existing) {
      await db
        .update(userSmtpSettings)
        .set(payload)
        .where(eq(userSmtpSettings.id, existing.id));
    } else {
      await db.insert(userSmtpSettings).values({
        ...payload,
        createdAt: new Date(),
      });
    }

    // Clear cached transporter in memory so new settings take effect immediately
    emailService.clearUserTransporter(userId);
    console.log(`✅ [CRMSmtp] Saved company SMTP settings for user ${userId} (${fromEmail})`);

    res.json({
      success: true,
      message: 'Company email settings saved successfully!',
    });
  } catch (error: any) {
    logger.error(`[CRMSmtp] Error saving SMTP settings for user ${userId}: ${error.message}`, error, 'CRMSmtp');
    res.status(500).json({ error: error.message || 'Failed to save company email settings' });
  }
});

// ── 3. POST /api/crm/smtp-settings/test (Live Verify & Test Email) ──
crmSmtpRouter.post('/smtp-settings/test', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const {
      testEmail,
      host,
      port,
      secure,
      username,
      password,
      fromEmail,
      fromName,
    } = req.body;

    if (!testEmail || !testEmail.includes('@')) {
      return res.status(400).json({ error: 'Valid test recipient email is required' });
    }

    // Resolve actual password
    let actualPassword = (password || '').trim();
    if (actualPassword === '********' || !actualPassword) {
      const [existing] = await db
        .select()
        .from(userSmtpSettings)
        .where(eq(userSmtpSettings.userId, userId))
        .limit(1);
      if (existing) {
        actualPassword = existing.password;
      }
    }

    const testHost = host || '';
    const testUser = username || '';
    const testPort = Number(port) || 587;
    const testSecure = secure === true || secure === 'true' || testPort === 465;
    const testFromName = fromName || 'Calliqo AI CRM';
    const testFromEmail = fromEmail || testUser;

    if (!testHost || !testUser || !actualPassword || !testFromEmail) {
      return res.status(400).json({ error: 'SMTP Host, Username, Password, and Sender Email are required to test' });
    }

    // Create isolated test transporter
    const transporter = nodemailer.createTransport({
      host: testHost,
      port: testPort,
      secure: testSecure,
      requireTLS: testPort === 587,
      auth: {
        user: testUser,
        pass: actualPassword,
      },
      tls: {
        rejectUnauthorized: false,
      },
      connectionTimeout: 12000,
      greetingTimeout: 12000,
      socketTimeout: 12000,
    });

    // 1. Verify connection credentials with mail server
    await transporter.verify();

    // 2. Send actual branded verification test email
    const info = await transporter.sendMail({
      from: `"${testFromName}" <${testFromEmail}>`,
      to: testEmail,
      subject: `✅ Verified: ${testFromName} Email Gateway is Live!`,
      text: `Hello! Your company email setup for ${testFromName} (${testFromEmail}) is now connected and verified successfully in Calliqo AI CRM. Site visit briefings and customer appointment confirmations will now be delivered directly from this email address.`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
          <div style="background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%); padding: 28px 24px; text-align: center; color: #ffffff;">
            <h2 style="margin: 0; font-size: 20px; font-weight: 700;">✅ Company Email Gateway Connected</h2>
            <div style="display: inline-block; background: rgba(255,255,255,0.2); padding: 4px 12px; border-radius: 9999px; font-size: 11px; font-weight: 600; margin-top: 8px;">VERIFIED & ACTIVE</div>
          </div>
          <div style="padding: 24px; color: #1e293b; font-size: 14px; line-height: 1.6;">
            <p style="margin-top: 0;">Namaste,</p>
            <p>Your custom company email gateway for <strong>${testFromName}</strong> has been tested and verified successfully in <strong>Calliqo AI CRM</strong>.</p>
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; margin: 18px 0; font-size: 13px;">
              <div style="margin-bottom: 6px;"><strong>Sender Name:</strong> ${testFromName}</div>
              <div style="margin-bottom: 6px;"><strong>Sender Email:</strong> ${testFromEmail}</div>
              <div style="margin-bottom: 6px;"><strong>SMTP Server:</strong> ${testHost}:${testPort}</div>
              <div><strong>Status:</strong> <span style="color: #059669; font-weight: 700;">● Connected</span></div>
            </div>
            <p style="margin-bottom: 0; font-size: 13px; color: #64748b;">
              All upcoming property site visit confirmations, staff assignment briefings, and customer communications for your account will now be dispatched directly through your own verified email domain.
            </p>
          </div>
          <div style="padding: 16px; background: #f8fafc; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #f1f5f9;">
            Calliqo AI • Enterprise CRM Notification Engine
          </div>
        </div>
      `,
    });

    // Update lastTestedAt in DB
    try {
      await db
        .update(userSmtpSettings)
        .set({ lastTestedAt: new Date() })
        .where(eq(userSmtpSettings.userId, userId));
    } catch (_) {}

    res.json({
      success: true,
      message: `Test email sent successfully to ${testEmail}!`,
      messageId: info.messageId,
    });
  } catch (error: any) {
    logger.error(`[CRMSmtp] Test failed for user ${userId}: ${error.message}`, error, 'CRMSmtp');
    
    let friendlyMessage = error.message || 'SMTP connection failed';
    const msgLower = (error.message || '').toLowerCase();
    
    if (error.code === 'EAUTH' || msgLower.includes('invalid login') || msgLower.includes('badcredentials') || msgLower.includes('authentication')) {
      friendlyMessage = 'Authentication failed. Please verify your SMTP Username and Password (or 16-letter Google App Password).';
    } else if (error.code === 'ETIMEDOUT') {
      friendlyMessage = 'Connection timed out. Check that SMTP host and port are correct and reachable.';
    } else if (error.code === 'ECONNREFUSED') {
      friendlyMessage = 'Connection refused by mail server. Port might be blocked or incorrect (Common: 587 or 465).';
    }

    res.status(400).json({
      success: false,
      error: friendlyMessage,
    });
  }
});

// ── 4. DELETE /api/crm/smtp-settings (Remove Custom Config) ──
crmSmtpRouter.delete('/smtp-settings', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    await db
      .delete(userSmtpSettings)
      .where(eq(userSmtpSettings.userId, userId));

    emailService.clearUserTransporter(userId);
    res.json({
      success: true,
      message: 'Custom company email removed. The system default will be used.',
    });
  } catch (error: any) {
    logger.error(`[CRMSmtp] Error deleting SMTP settings for user ${userId}: ${error.message}`, error, 'CRMSmtp');
    res.status(500).json({ error: 'Failed to delete company email settings' });
  }
});
