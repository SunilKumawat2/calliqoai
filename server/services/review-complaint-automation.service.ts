'use strict';
/**
 * ============================================================
 * Calliqo AI - Automated Google Review Request &
 *             Negative Call / Complaint Alert Service
 *
 * 1. Review Request: When an appointment is marked Attended / Completed
 *    (or Deal Won), automatically send a Thank-You + Google Review link to
 *    the customer on WhatsApp + Email — immediately or after an admin
 *    configured delay (e.g. 2 hours). Fully controlled from the CRM
 *    Automation tab.
 *
 * 2. Complaint Alert: When any AI call ends with Negative sentiment or
 *    complaint keywords, the Owner / Manager instantly receives an Urgent
 *    Complaint Alert on Email + WhatsApp.
 *
 * This module is fully isolated: every entry point is fail-safe and
 * never throws into the caller, so existing call / CRM / appointment
 * flows keep working exactly as before.
 * ============================================================
 */

import { db } from '../db';
import { appointments, userEmailTemplates, crmWhitelabelConfigs, users } from '@shared/schema';
import { eq, and, sql } from 'drizzle-orm';
import { logger } from '../utils/logger';

export interface ReviewComplaintConfig {
  // ── 1. Google Review Request ──
  reviewRequestEnabled: boolean;
  reviewDelayMinutes: number; // 0 = immediately after Mark Attended
  reviewTriggerStatuses: string[]; // appointment statuses that trigger a review request
  googleReviewLink: string;
  reviewChannels: { whatsapp: boolean; email: boolean };
  reviewWhatsappMessage: string;
  reviewEmailSubject: string;
  reviewEmailMessage: string;
  reviewWhatsappTemplateName: string; // optional approved Meta template ({{1}} = name, {{2}} = review link)
  reviewWhatsappTemplateLanguage: string;

  // ── 2. Negative Call / Complaint Alert ──
  complaintAlertEnabled: boolean;
  complaintDetectNegativeSentiment: boolean;
  complaintDetectKeywords: boolean;
  complaintKeywords: string;
  complaintChannels: { whatsapp: boolean; email: boolean };
  managerName: string;
  managerPhones: string; // comma separated
  managerEmails: string; // comma separated (empty = account owner email)
  complaintMinCallSeconds: number;
}

export interface ComplaintAlertLogEntry {
  id: string;
  callId: string;
  engine: string;
  customerPhone: string;
  customerName: string;
  reason: string;
  sentiment: string | null;
  matchedKeywords: string[];
  summary: string;
  whatsappSent: boolean;
  emailSent: boolean;
  createdAt: string;
}

export interface ReviewLogEntry {
  id: string;
  appointmentId: string;
  customerName: string;
  customerPhone: string;
  whatsappSent: boolean;
  emailSent: boolean;
  trigger: 'auto' | 'manual';
  createdAt: string;
}

const CONFIG_TEMPLATE_NAME = '__CRM_REVIEW_COMPLAINT_CONFIG__';
const LOG_TEMPLATE_NAME = '__CRM_REVIEW_COMPLAINT_LOG__';
const MAX_LOG_ENTRIES = 100;

const DEFAULT_COMPLAINT_KEYWORDS = [
  'complaint', 'complain', 'angry', 'frustrated', 'worst', 'terrible', 'horrible', 'pathetic',
  'refund', 'fraud', 'cheat', 'scam', 'consumer court', 'legal action', 'very bad', 'disappointed',
  'shikayat', 'shikayat', 'gussa', 'bakwas', 'bekar', 'bekaar', 'dhokha', 'ghatiya', 'faltu',
  'paisa wapas', 'paise wapas', 'शिकायत', 'गुस्सा', 'बकवास', 'बेकार', 'धोखा', 'घटिया', 'फालतू',
].join(', ');

export class ReviewComplaintAutomationService {
  private static isSchedulerRunning = false;
  private static schedulerTimer: NodeJS.Timeout | null = null;
  private static processingCallIds = new Set<string>();

  static getDefaultConfig(): ReviewComplaintConfig {
    return {
      reviewRequestEnabled: false,
      reviewDelayMinutes: 120,
      reviewTriggerStatuses: ['completed_visited', 'deal_won'],
      googleReviewLink: '',
      reviewChannels: { whatsapp: true, email: true },
      reviewWhatsappMessage:
        'Namaste {customer_name} ji! 🙏\n\n*{business_name}* mein aane ke liye dil se dhanyavaad. Humein umeed hai ki aapka *{service_name}* ka anubhav accha raha.\n\nAgar aap humari service se khush hain, toh kripya 1 minute nikaal kar humein Google par ⭐⭐⭐⭐⭐ review dein:\n👉 {review_link}\n\nAapka feedback humare liye bahut keemti hai!',
      reviewEmailSubject: '🙏 Thank you for visiting {business_name} — Share your experience ⭐',
      reviewEmailMessage:
        'Dear {customer_name},\n\nThank you for visiting {business_name} for your {service_name}. We hope you had a great experience!\n\nIf you are happy with our service, we would be grateful if you could take a minute to leave us a 5-star review on Google. Your feedback helps us serve you and others better.',
      reviewWhatsappTemplateName: '',
      reviewWhatsappTemplateLanguage: 'en',

      complaintAlertEnabled: false,
      complaintDetectNegativeSentiment: true,
      complaintDetectKeywords: true,
      complaintKeywords: DEFAULT_COMPLAINT_KEYWORDS,
      complaintChannels: { whatsapp: true, email: true },
      managerName: '',
      managerPhones: '',
      managerEmails: '',
      complaintMinCallSeconds: 10,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Config persistence (stored as a hidden row in user_email_templates,
  // same pattern as the Reminder & No-Show automation config)
  // ─────────────────────────────────────────────────────────────
  static async getConfig(userId: string): Promise<ReviewComplaintConfig> {
    const defaults = this.getDefaultConfig();
    try {
      const [row] = await db
        .select()
        .from(userEmailTemplates)
        .where(and(eq(userEmailTemplates.userId, userId), eq(userEmailTemplates.name, CONFIG_TEMPLATE_NAME)))
        .limit(1);
      if (row && row.designJson && typeof row.designJson === 'object') {
        const saved = row.designJson as Partial<ReviewComplaintConfig>;
        return {
          ...defaults,
          ...saved,
          reviewChannels: { ...defaults.reviewChannels, ...(saved.reviewChannels || {}) },
          complaintChannels: { ...defaults.complaintChannels, ...(saved.complaintChannels || {}) },
          reviewTriggerStatuses:
            Array.isArray(saved.reviewTriggerStatuses) && saved.reviewTriggerStatuses.length > 0
              ? saved.reviewTriggerStatuses
              : defaults.reviewTriggerStatuses,
        };
      }
    } catch (err: any) {
      logger.warn(`[ReviewComplaint] Error loading config for ${userId}: ${err?.message}`);
    }
    return defaults;
  }

  static async saveConfig(userId: string, partial: Partial<ReviewComplaintConfig>): Promise<ReviewComplaintConfig> {
    const current = await this.getConfig(userId);
    const delay = Number(partial.reviewDelayMinutes ?? current.reviewDelayMinutes);
    const minSecs = Number(partial.complaintMinCallSeconds ?? current.complaintMinCallSeconds);
    const merged: ReviewComplaintConfig = {
      ...current,
      ...partial,
      reviewDelayMinutes: Number.isFinite(delay) ? Math.max(0, Math.min(delay, 60 * 24 * 14)) : current.reviewDelayMinutes,
      complaintMinCallSeconds: Number.isFinite(minSecs) ? Math.max(0, minSecs) : current.complaintMinCallSeconds,
      reviewChannels: { ...current.reviewChannels, ...(partial.reviewChannels || {}) },
      complaintChannels: { ...current.complaintChannels, ...(partial.complaintChannels || {}) },
      reviewTriggerStatuses:
        Array.isArray(partial.reviewTriggerStatuses) && partial.reviewTriggerStatuses.length > 0
          ? partial.reviewTriggerStatuses
          : current.reviewTriggerStatuses,
    };

    const [existing] = await db
      .select({ id: userEmailTemplates.id })
      .from(userEmailTemplates)
      .where(and(eq(userEmailTemplates.userId, userId), eq(userEmailTemplates.name, CONFIG_TEMPLATE_NAME)))
      .limit(1);

    if (existing) {
      await db
        .update(userEmailTemplates)
        .set({ designJson: merged as any, updatedAt: new Date() })
        .where(eq(userEmailTemplates.id, existing.id));
    } else {
      await db.insert(userEmailTemplates).values({
        userId,
        name: CONFIG_TEMPLATE_NAME,
        subject: 'CRM Google Review Request & Complaint Alert Config',
        htmlBody: 'JSON_CONFIG',
        variables: [],
        isActive: true,
        designJson: merged as any,
      });
    }
    return merged;
  }

  // ─────────────────────────────────────────────────────────────
  // Activity log (recent review requests + complaint alerts)
  // ─────────────────────────────────────────────────────────────
  static async getLogs(userId: string): Promise<{ complaints: ComplaintAlertLogEntry[]; reviews: ReviewLogEntry[] }> {
    try {
      const [row] = await db
        .select()
        .from(userEmailTemplates)
        .where(and(eq(userEmailTemplates.userId, userId), eq(userEmailTemplates.name, LOG_TEMPLATE_NAME)))
        .limit(1);
      const data = (row?.designJson as any) || {};
      return {
        complaints: Array.isArray(data.complaints) ? data.complaints : [],
        reviews: Array.isArray(data.reviews) ? data.reviews : [],
      };
    } catch {
      return { complaints: [], reviews: [] };
    }
  }

  private static async appendLog(
    userId: string,
    kind: 'complaints' | 'reviews',
    entry: ComplaintAlertLogEntry | ReviewLogEntry
  ): Promise<void> {
    try {
      const logs = await this.getLogs(userId);
      const list = [entry, ...(logs[kind] as any[])].slice(0, MAX_LOG_ENTRIES);
      const next = { ...logs, [kind]: list };

      const [existing] = await db
        .select({ id: userEmailTemplates.id })
        .from(userEmailTemplates)
        .where(and(eq(userEmailTemplates.userId, userId), eq(userEmailTemplates.name, LOG_TEMPLATE_NAME)))
        .limit(1);
      if (existing) {
        await db
          .update(userEmailTemplates)
          .set({ designJson: next as any, updatedAt: new Date() })
          .where(eq(userEmailTemplates.id, existing.id));
      } else {
        await db.insert(userEmailTemplates).values({
          userId,
          name: LOG_TEMPLATE_NAME,
          subject: 'CRM Review & Complaint Activity Log',
          htmlBody: 'JSON_LOG',
          variables: [],
          isActive: false,
          designJson: next as any,
        });
      }
    } catch (err: any) {
      logger.warn(`[ReviewComplaint] Failed to append log: ${err?.message}`);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────
  private static async getBusinessName(userId: string): Promise<string> {
    try {
      const [wl] = await db
        .select()
        .from(crmWhitelabelConfigs)
        .where(eq(crmWhitelabelConfigs.userId, userId))
        .limit(1);
      if (wl?.businessName) return wl.businessName;
    } catch (_) {}
    return 'Our Team';
  }

  private static interpolate(template: string, vars: Record<string, string>): string {
    if (!template) return '';
    let out = template;
    for (const [key, value] of Object.entries(vars)) {
      out = out.replace(new RegExp(`\\{${key}\\}`, 'gi'), value ?? '');
    }
    return out;
  }

  private static normalizePhone(raw?: string | null): string {
    const digits = String(raw || '').replace(/[^\d]/g, '');
    if (!digits) return '';
    if (digits.length === 10 && /^[6-9]/.test(digits)) return `+91${digits}`;
    return `+${digits}`;
  }

  private static escapeHtml(s: string): string {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private static async sendWhatsAppText(userId: string, phone: string, message: string): Promise<boolean> {
    if (!phone || !message) return false;
    try {
      const { metaWhatsAppService } = await import('../../plugins/messaging/services/meta-whatsapp.service');
      await metaWhatsAppService.sendReply(userId, phone, message);
      return true;
    } catch (err: any) {
      logger.warn(`[ReviewComplaint] WhatsApp text to ${phone} failed: ${err?.message}`);
      return false;
    }
  }

  private static async sendEmail(userId: string, to: string, subject: string, html: string): Promise<boolean> {
    if (!to || !to.includes('@')) return false;
    try {
      const { emailService } = await import('./email-service');
      const result = await emailService.sendEmail(to, subject, html, undefined, { userId });
      return !!result?.success;
    } catch (err: any) {
      logger.warn(`[ReviewComplaint] Email to ${to} failed: ${err?.message}`);
      return false;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 1. GOOGLE REVIEW REQUEST
  // ─────────────────────────────────────────────────────────────

  /**
   * Called right after an appointment status is updated (Mark Attended / Deal Won).
   * Never throws. Either sends immediately (delay = 0) or stamps a due time
   * in appointment.metadata that the background scheduler will pick up.
   */
  static async onAppointmentStatusChanged(userId: string, appointmentId: string, newStatus: string): Promise<void> {
    try {
      const config = await this.getConfig(userId);
      if (!config.reviewRequestEnabled) return;
      if (!config.reviewTriggerStatuses.includes(newStatus)) return;

      const [apt] = await db
        .select()
        .from(appointments)
        .where(and(eq(appointments.id, appointmentId), eq(appointments.userId, userId)))
        .limit(1);
      if (!apt) return;

      const meta = (apt.metadata && typeof apt.metadata === 'object') ? apt.metadata : {};
      if (meta.reviewRequestSent || meta.reviewRequestDueAt) return; // never double-send

      const delayMin = Math.max(0, Number(config.reviewDelayMinutes) || 0);
      const dueAt = new Date(Date.now() + delayMin * 60 * 1000).toISOString();

      await db
        .update(appointments)
        .set({
          metadata: sql`COALESCE(${appointments.metadata}, '{}'::jsonb) || ${JSON.stringify({
            reviewRequestDueAt: dueAt,
            reviewRequestScheduledAt: new Date().toISOString(),
          })}::jsonb`,
        })
        .where(eq(appointments.id, apt.id));

      if (delayMin === 0) {
        await this.sendReviewRequest({ userId, appointmentId: apt.id, trigger: 'auto' });
      } else {
        logger.info(`[ReviewComplaint] Review request for appointment ${apt.id} scheduled at ${dueAt}`);
      }
    } catch (err: any) {
      logger.warn(`[ReviewComplaint] onAppointmentStatusChanged error: ${err?.message}`);
    }
  }

  static async sendReviewRequest(params: {
    userId: string;
    appointmentId: string;
    trigger: 'auto' | 'manual';
  }): Promise<{ success: boolean; whatsappSent: boolean; emailSent: boolean; error?: string }> {
    const { userId, appointmentId, trigger } = params;
    const [apt] = await db
      .select()
      .from(appointments)
      .where(and(eq(appointments.id, appointmentId), eq(appointments.userId, userId)))
      .limit(1);
    if (!apt) return { success: false, whatsappSent: false, emailSent: false, error: 'Appointment not found' };

    const config = await this.getConfig(userId);
    if (!config.googleReviewLink?.trim()) {
      return { success: false, whatsappSent: false, emailSent: false, error: 'Google Review Link is not configured' };
    }

    const businessName = await this.getBusinessName(userId);
    const vars = {
      customer_name: apt.contactName || 'Customer',
      business_name: businessName,
      service_name: apt.serviceName || 'appointment',
      review_link: config.googleReviewLink.trim(),
      staff_name: apt.assignedStaffName || '',
      date: String(apt.appointmentDate || ''),
      time: String(apt.appointmentTime || ''),
    };

    const phone = this.normalizePhone(apt.contactPhone);

    // A. WhatsApp
    let whatsappSent = false;
    if (config.reviewChannels.whatsapp && phone) {
      const templateName = config.reviewWhatsappTemplateName?.trim();
      if (templateName) {
        try {
          const { metaWhatsAppService } = await import('../../plugins/messaging/services/meta-whatsapp.service');
          await metaWhatsAppService.sendTemplate(userId, phone, templateName, config.reviewWhatsappTemplateLanguage || 'en', [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: vars.customer_name },
                { type: 'text', text: vars.review_link },
              ],
            },
          ]);
          whatsappSent = true;
        } catch (err: any) {
          logger.warn(`[ReviewComplaint] Review template send failed, falling back to text: ${err?.message}`);
        }
      }
      if (!whatsappSent) {
        whatsappSent = await this.sendWhatsAppText(userId, phone, this.interpolate(config.reviewWhatsappMessage, vars));
      }
    }

    // B. Email
    let emailSent = false;
    if (config.reviewChannels.email && apt.contactEmail) {
      const subject = this.interpolate(config.reviewEmailSubject, vars);
      const bodyHtml = this.escapeHtml(this.interpolate(config.reviewEmailMessage, vars)).replace(/\n/g, '<br>');
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#f1f5f9;padding:24px;color:#0f172a;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0;">
    <div style="background:linear-gradient(135deg,#f59e0b,#f97316);padding:28px 24px;text-align:center;color:#fff;">
      <div style="font-size:34px;letter-spacing:4px;">⭐⭐⭐⭐⭐</div>
      <h1 style="margin:8px 0 0;font-size:20px;">Thank you for visiting ${this.escapeHtml(businessName)}!</h1>
    </div>
    <div style="padding:28px 24px;font-size:15px;line-height:1.6;color:#334155;">
      ${bodyHtml}
      <div style="text-align:center;margin:28px 0 8px;">
        <a href="${this.escapeHtml(vars.review_link)}" style="display:inline-block;background:#f59e0b;color:#fff;padding:13px 30px;border-radius:8px;text-decoration:none;font-weight:700;">⭐ Leave a Google Review</a>
      </div>
    </div>
    <div style="padding:16px;text-align:center;font-size:12px;color:#94a3b8;border-top:1px solid #f1f5f9;">${this.escapeHtml(businessName)}</div>
  </div>
</body></html>`;
      emailSent = await this.sendEmail(userId, apt.contactEmail, subject, html);
    }

    const success = whatsappSent || emailSent;
    try {
      await db
        .update(appointments)
        .set({
          metadata: sql`COALESCE(${appointments.metadata}, '{}'::jsonb) || ${JSON.stringify({
            reviewRequestSent: true,
            reviewRequestSentAt: new Date().toISOString(),
            reviewRequestTrigger: trigger,
            reviewRequestWhatsappSent: whatsappSent,
            reviewRequestEmailSent: emailSent,
          })}::jsonb`,
        })
        .where(eq(appointments.id, apt.id));
    } catch (_) {}

    await this.appendLog(userId, 'reviews', {
      id: `rv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      appointmentId: apt.id,
      customerName: apt.contactName,
      customerPhone: apt.contactPhone,
      whatsappSent,
      emailSent,
      trigger,
      createdAt: new Date().toISOString(),
    });

    logger.info(`[ReviewComplaint] Review request for ${apt.id}: whatsapp=${whatsappSent}, email=${emailSent}`);
    return {
      success,
      whatsappSent,
      emailSent,
      error: success ? undefined : 'No channel could be delivered (check WhatsApp connection / customer email)',
    };
  }

  /**
   * Background scheduler cycle — only processes appointments that were explicitly
   * scheduled via onAppointmentStatusChanged (reviewRequestDueAt set), so older
   * historical appointments are never mass-messaged.
   */
  static async processDueReviewRequests(): Promise<void> {
    const nowIso = new Date().toISOString();
    const due = await db
      .select({ id: appointments.id, userId: appointments.userId })
      .from(appointments)
      .where(
        sql`${appointments.metadata}->>'reviewRequestDueAt' IS NOT NULL
          AND ${appointments.metadata}->>'reviewRequestDueAt' <= ${nowIso}
          AND COALESCE(${appointments.metadata}->>'reviewRequestSent', 'false') <> 'true'
          AND COALESCE(${appointments.metadata}->>'reviewRequestCancelled', 'false') <> 'true'`
      )
      .limit(50);

    const configCache = new Map<string, ReviewComplaintConfig>();
    for (const row of due) {
      let config = configCache.get(row.userId);
      if (!config) {
        config = await this.getConfig(row.userId);
        configCache.set(row.userId, config);
      }
      if (!config.reviewRequestEnabled) continue; // paused by admin — keep pending
      await this.sendReviewRequest({ userId: row.userId, appointmentId: row.id, trigger: 'auto' }).catch((err) =>
        logger.warn(`[ReviewComplaint] Scheduled review send failed for ${row.id}: ${err?.message}`)
      );
    }
  }

  static startScheduler(): void {
    if (this.isSchedulerRunning) return;
    this.isSchedulerRunning = true;
    console.log('⭐ [ReviewComplaint] Google Review Request scheduler started (every 60s)');
    this.schedulerTimer = setInterval(() => {
      this.processDueReviewRequests().catch((err) =>
        logger.warn(`[ReviewComplaint] Scheduler cycle error: ${err?.message}`)
      );
    }, 60 * 1000);
  }

  // ─────────────────────────────────────────────────────────────
  // 2. NEGATIVE CALL / COMPLAINT ALERT
  // ─────────────────────────────────────────────────────────────

  static detectComplaint(
    config: ReviewComplaintConfig,
    input: { sentiment?: string | null; transcript?: string | null; aiSummary?: string | null }
  ): { isComplaint: boolean; reason: string; matchedKeywords: string[] } {
    const sentiment = String(input.sentiment || '').toLowerCase().trim();
    const negativeSentiment =
      config.complaintDetectNegativeSentiment &&
      (sentiment === 'negative' || sentiment === 'very_negative' || sentiment.includes('negative') || sentiment === 'angry');

    let matchedKeywords: string[] = [];
    if (config.complaintDetectKeywords) {
      // Only scan what the customer said when the transcript has speaker labels
      const transcript = String(input.transcript || '');
      const customerLines = transcript
        .split(/\n/)
        .filter((l) => /^(customer|user|caller|human)\s*:/i.test(l.trim()))
        .join('\n');
      const haystack = `${customerLines || transcript}\n${input.aiSummary || ''}`.toLowerCase();
      const keywords = String(config.complaintKeywords || '')
        .split(',')
        .map((k) => k.trim().toLowerCase())
        .filter((k) => k.length >= 3);
      matchedKeywords = Array.from(new Set(keywords.filter((k) => haystack.includes(k)))).slice(0, 10);
    }

    const reasons: string[] = [];
    if (negativeSentiment) reasons.push('Negative sentiment detected by AI');
    if (matchedKeywords.length > 0) reasons.push(`Complaint keywords: ${matchedKeywords.join(', ')}`);
    return { isComplaint: reasons.length > 0, reason: reasons.join(' • '), matchedKeywords };
  }

  /**
   * Called (fire-and-forget) whenever a completed call is processed by the CRM.
   * Never throws.
   */
  static async handleCompletedCall(callData: {
    id: string;
    userId: string;
    engine?: string;
    phoneNumber?: string | null;
    fromNumber?: string | null;
    toNumber?: string | null;
    callDirection?: string;
    duration?: number | null;
    transcript?: string | null;
    aiSummary?: string | null;
    sentiment?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    metadata?: Record<string, unknown> | null;
    test?: boolean;
  }): Promise<{ alerted: boolean; reason?: string; whatsappSent?: boolean; emailSent?: boolean }> {
    try {
      if (!callData?.id || !callData?.userId) return { alerted: false };
      const config = await this.getConfig(callData.userId);
      if (!config.complaintAlertEnabled && !callData.test) return { alerted: false };
      if (!callData.test && (callData.duration ?? 0) > 0 && (callData.duration ?? 0) < config.complaintMinCallSeconds) {
        return { alerted: false };
      }

      const detection = this.detectComplaint(config, callData);
      if (!detection.isComplaint) return { alerted: false };

      // De-duplicate (processCall may run more than once for the same call)
      if (this.processingCallIds.has(callData.id)) return { alerted: false };
      this.processingCallIds.add(callData.id);
      setTimeout(() => this.processingCallIds.delete(callData.id), 10 * 60 * 1000);
      if (!callData.test) {
        const logs = await this.getLogs(callData.userId);
        if (logs.complaints.some((c) => c.callId === callData.id)) return { alerted: false };
      }

      const businessName = await this.getBusinessName(callData.userId);
      const meta = (callData.metadata || {}) as any;
      const isIncoming = String(callData.callDirection || '').toLowerCase().startsWith('in');
      const customerPhone =
        (meta.customerPhone as string) ||
        (isIncoming ? callData.fromNumber : callData.toNumber) ||
        callData.phoneNumber ||
        'Unknown';
      const customerName =
        [callData.firstName, callData.lastName].filter(Boolean).join(' ').trim() ||
        (meta.customerName as string) ||
        (meta.contactName as string) ||
        'Unknown Caller';
      const summary = String(callData.aiSummary || '').slice(0, 800) || 'No AI summary available.';
      const timeStr = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

      // Recipients
      const phones = String(config.managerPhones || '')
        .split(/[,;\n]/)
        .map((p) => this.normalizePhone(p))
        .filter((p) => p.length >= 8);
      let emails = String(config.managerEmails || '')
        .split(/[,;\n]/)
        .map((e) => e.trim())
        .filter((e) => e.includes('@'));
      if (emails.length === 0) {
        try {
          const [owner] = await db.select({ email: users.email }).from(users).where(eq(users.id, callData.userId)).limit(1);
          if (owner?.email) emails = [owner.email];
        } catch (_) {}
      }

      const testTag = callData.test ? '[TEST] ' : '';
      const waMessage =
        `🚨 *${testTag}URGENT COMPLAINT ALERT — ${businessName}*\n\n` +
        `${config.managerName ? `Namaste ${config.managerName} ji, ` : ''}ek AI call par customer naraz / complaint mood mein tha. Kripya turant contact karein.\n\n` +
        `👤 *Customer:* ${customerName}\n` +
        `📞 *Phone:* ${customerPhone}\n` +
        `⏰ *Time:* ${timeStr}\n` +
        `⚠️ *Reason:* ${detection.reason}\n\n` +
        `📝 *AI Summary:* ${summary.slice(0, 500)}`;

      let whatsappSent = false;
      if (config.complaintChannels.whatsapp) {
        for (const p of phones) {
          const ok = await this.sendWhatsAppText(callData.userId, p, waMessage);
          whatsappSent = whatsappSent || ok;
        }
      }

      let emailSent = false;
      if (config.complaintChannels.email && emails.length > 0) {
        const subject = `🚨 ${testTag}Urgent Complaint Alert: ${customerName} (${customerPhone})`;
        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#f1f5f9;padding:24px;color:#0f172a;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #fecaca;">
    <div style="background:linear-gradient(135deg,#dc2626,#ef4444);padding:24px;text-align:center;color:#fff;">
      <h1 style="margin:0;font-size:20px;">🚨 ${testTag}Urgent Complaint Alert</h1>
      <div style="margin-top:6px;font-size:12px;opacity:.9;">${this.escapeHtml(businessName)} • Negative AI Call Detected</div>
    </div>
    <div style="padding:24px;font-size:14px;line-height:1.6;color:#334155;">
      <p>${config.managerName ? `Hello <strong>${this.escapeHtml(config.managerName)}</strong>,<br>` : ''}A customer sounded upset / raised a complaint on an AI call. Please contact them as soon as possible.</p>
      <table style="width:100%;border-collapse:collapse;margin:14px 0;font-size:14px;">
        <tr><td style="padding:8px;color:#64748b;border-bottom:1px dashed #e2e8f0;">Customer</td><td style="padding:8px;font-weight:600;border-bottom:1px dashed #e2e8f0;">${this.escapeHtml(customerName)}</td></tr>
        <tr><td style="padding:8px;color:#64748b;border-bottom:1px dashed #e2e8f0;">Phone</td><td style="padding:8px;font-weight:600;border-bottom:1px dashed #e2e8f0;"><a href="tel:${this.escapeHtml(customerPhone)}">${this.escapeHtml(customerPhone)}</a></td></tr>
        <tr><td style="padding:8px;color:#64748b;border-bottom:1px dashed #e2e8f0;">Time</td><td style="padding:8px;font-weight:600;border-bottom:1px dashed #e2e8f0;">${this.escapeHtml(timeStr)}</td></tr>
        <tr><td style="padding:8px;color:#64748b;">Reason</td><td style="padding:8px;font-weight:600;color:#dc2626;">${this.escapeHtml(detection.reason)}</td></tr>
      </table>
      <div style="background:#fef2f2;border:1px solid #fecaca;border-left:4px solid #dc2626;border-radius:8px;padding:14px;">
        <strong>AI Call Summary:</strong><br>${this.escapeHtml(summary)}
      </div>
    </div>
  </div>
</body></html>`;
        for (const e of emails) {
          const ok = await this.sendEmail(callData.userId, e, subject, html);
          emailSent = emailSent || ok;
        }
      }

      await this.appendLog(callData.userId, 'complaints', {
        id: `ca_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        callId: callData.id,
        engine: callData.test ? 'test' : String(callData.engine || ''),
        customerPhone: String(customerPhone),
        customerName,
        reason: detection.reason,
        sentiment: callData.sentiment || null,
        matchedKeywords: detection.matchedKeywords,
        summary: summary.slice(0, 300),
        whatsappSent,
        emailSent,
        createdAt: new Date().toISOString(),
      });

      logger.info(
        `[ReviewComplaint] Complaint alert for call ${callData.id}: whatsapp=${whatsappSent}, email=${emailSent} (${detection.reason})`
      );
      return { alerted: true, reason: detection.reason, whatsappSent, emailSent };
    } catch (err: any) {
      logger.warn(`[ReviewComplaint] handleCompletedCall error: ${err?.message}`);
      return { alerted: false };
    }
  }
}

