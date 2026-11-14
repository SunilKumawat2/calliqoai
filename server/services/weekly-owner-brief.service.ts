'use strict';
/**
 * ============================================================
 * Calliqo AI - Weekly Owner Brief (WhatsApp + Email) Service
 *
 * Automatically sends a weekly executive summary to the Business
 * Owner / Manager on their configured day & time (IST):
 *  - Total Enquiries, Qualified, Appointments Booked, Attended,
 *    No-Shows, Closed Sales, Estimated Revenue & ROI
 *  - Top performing source & top lead leakage insight
 *  - Recent complaint alerts count (last 7 days)
 *
 * 100% isolated & read-only over existing CRM tables.
 * ============================================================
 */

import { db } from '../db';
import { userEmailTemplates, crmWhitelabelConfigs, users } from '@shared/schema';
import { eq, and } from 'drizzle-orm';
import { logger } from '../utils/logger';
import { RoiFunnelService } from './roi-funnel.service';
import { ReviewComplaintAutomationService } from './review-complaint-automation.service';

export interface WeeklyOwnerBriefConfig {
  enabled: boolean;
  dayOfWeek: number; // 0 = Sunday, 1 = Monday ... 6 = Saturday (IST)
  hourIst: number; // 0..23
  minuteIst: number; // 0..59
  channels: { whatsapp: boolean; email: boolean };
  ownerName: string;
  ownerPhones: string; // comma-separated
  ownerEmails: string; // comma-separated (blank = account email)
  whatsappTemplateName: string; // optional approved Meta template ({{1}} = ownerName, {{2}} = summary)
  whatsappTemplateLanguage: string;
  lastSentWeekKey?: string;
}

export interface WeeklyBriefLogEntry {
  id: string;
  trigger: 'auto' | 'manual';
  weekKey: string;
  enquiries: number;
  qualified: number;
  booked: number;
  attended: number;
  closed: number;
  revenue: number;
  whatsappSent: boolean;
  emailSent: boolean;
  createdAt: string;
}

const CONFIG_TEMPLATE_NAME = '__CRM_WEEKLY_OWNER_BRIEF_CONFIG__';
const LOG_TEMPLATE_NAME = '__CRM_WEEKLY_OWNER_BRIEF_LOG__';
const MAX_LOG_ENTRIES = 50;

export class WeeklyOwnerBriefService {
  private static isSchedulerRunning = false;
  private static schedulerTimer: NodeJS.Timeout | null = null;

  static getDefaultConfig(): WeeklyOwnerBriefConfig {
    return {
      enabled: false,
      dayOfWeek: 1, // Monday
      hourIst: 9, // 9:00 AM IST
      minuteIst: 0,
      channels: { whatsapp: true, email: true },
      ownerName: '',
      ownerPhones: '',
      ownerEmails: '',
      whatsappTemplateName: '',
      whatsappTemplateLanguage: 'en',
    };
  }

  static async getConfig(userId: string): Promise<WeeklyOwnerBriefConfig> {
    const defaults = this.getDefaultConfig();
    try {
      const [row] = await db
        .select()
        .from(userEmailTemplates)
        .where(and(eq(userEmailTemplates.userId, userId), eq(userEmailTemplates.name, CONFIG_TEMPLATE_NAME)))
        .limit(1);
      if (row?.designJson && typeof row.designJson === 'object') {
        const saved = row.designJson as Partial<WeeklyOwnerBriefConfig>;
        return {
          ...defaults,
          ...saved,
          channels: { ...defaults.channels, ...(saved.channels || {}) },
        };
      }
    } catch (err: any) {
      logger.warn(`[WeeklyBrief] Error loading config for ${userId}: ${err?.message}`);
    }
    return defaults;
  }

  static async saveConfig(userId: string, partial: Partial<WeeklyOwnerBriefConfig>): Promise<WeeklyOwnerBriefConfig> {
    const current = await this.getConfig(userId);
    const clamp = (v: any, min: number, max: number, fb: number) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fb;
    };
    const merged: WeeklyOwnerBriefConfig = {
      ...current,
      ...partial,
      dayOfWeek: clamp(partial.dayOfWeek, 0, 6, current.dayOfWeek),
      hourIst: clamp(partial.hourIst, 0, 23, current.hourIst),
      minuteIst: clamp(partial.minuteIst, 0, 59, current.minuteIst),
      channels: { ...current.channels, ...(partial.channels || {}) },
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
        subject: 'CRM Weekly Owner Brief Config',
        htmlBody: 'JSON_CONFIG',
        variables: [],
        isActive: true,
        designJson: merged as any,
      });
    }
    return merged;
  }

  static async getLogs(userId: string): Promise<WeeklyBriefLogEntry[]> {
    try {
      const [row] = await db
        .select()
        .from(userEmailTemplates)
        .where(and(eq(userEmailTemplates.userId, userId), eq(userEmailTemplates.name, LOG_TEMPLATE_NAME)))
        .limit(1);
      const data = (row?.designJson as any) || {};
      return Array.isArray(data.entries) ? data.entries : [];
    } catch {
      return [];
    }
  }

  private static async appendLog(userId: string, entry: WeeklyBriefLogEntry): Promise<void> {
    try {
      const current = await this.getLogs(userId);
      const entries = [entry, ...current].slice(0, MAX_LOG_ENTRIES);
      const [existing] = await db
        .select({ id: userEmailTemplates.id })
        .from(userEmailTemplates)
        .where(and(eq(userEmailTemplates.userId, userId), eq(userEmailTemplates.name, LOG_TEMPLATE_NAME)))
        .limit(1);
      if (existing) {
        await db
          .update(userEmailTemplates)
          .set({ designJson: { entries } as any, updatedAt: new Date() })
          .where(eq(userEmailTemplates.id, existing.id));
      } else {
        await db.insert(userEmailTemplates).values({
          userId,
          name: LOG_TEMPLATE_NAME,
          subject: 'CRM Weekly Owner Brief Logs',
          htmlBody: 'JSON_LOG',
          variables: [],
          isActive: false,
          designJson: { entries } as any,
        });
      }
    } catch (err: any) {
      logger.warn(`[WeeklyBrief] Failed to append log: ${err?.message}`);
    }
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

  /**
   * Current IST calendar info + a stable key for the current week (Monday-based YYYY-MM-DD in IST)
   */
  private static getIstClock(now = new Date()) {
    const ist = new Date(now.getTime() + 5.5 * 3600 * 1000);
    const dayOfWeek = ist.getUTCDay(); // 0=Sun..6=Sat
    const hour = ist.getUTCHours();
    const minute = ist.getUTCMinutes();
    const ymd = ist.toISOString().slice(0, 10);
    // Monday of the current week in IST
    const diffToMon = (dayOfWeek + 6) % 7;
    const mon = new Date(ist.getTime() - diffToMon * 24 * 3600 * 1000);
    const weekKey = mon.toISOString().slice(0, 10);
    return { dayOfWeek, hour, minute, ymd, weekKey };
  }

  private static async getBusinessName(userId: string): Promise<string> {
    try {
      const [wl] = await db
        .select()
        .from(crmWhitelabelConfigs)
        .where(eq(crmWhitelabelConfigs.userId, userId))
        .limit(1);
      if (wl?.businessName) return wl.businessName;
    } catch (_) {}
    return 'Calliqo AI CRM';
  }

  static async buildBrief(userId: string, config?: WeeklyOwnerBriefConfig, isTest = false) {
    const cfg = config || (await this.getConfig(userId));
    const [funnel, rcLogs, businessName] = await Promise.all([
      RoiFunnelService.getFunnel(userId, { range: '7d' }),
      ReviewComplaintAutomationService.getLogs(userId),
      this.getBusinessName(userId),
    ]);

    const sevenDaysAgo = Date.now() - 7 * 24 * 3600 * 1000;
    const complaints7d = (rcLogs.complaints || []).filter(
      (c) => c.engine !== 'test' && new Date(c.createdAt).getTime() >= sevenDaysAgo
    ).length;

    const stage = (k: string) => funnel.stages.find((s: any) => s.key === k)?.count || 0;
    const enquiries = stage('enquiries');
    const qualified = stage('qualified');
    const booked = stage('booked');
    const attended = stage('attended');
    const closed = stage('closed');
    const noShow = funnel.extra?.noShow || 0;
    const cur = funnel.money?.currency || '₹';
    const revenue = funnel.money?.revenue || 0;
    const roiPercent = funnel.money?.roiPercent;
    const topSource = funnel.sources?.[0];
    const topInsight = funnel.insights?.[0]?.text || 'No major lead drop-offs detected this week.';

    const tag = isTest ? '[TEST] ' : '';
    const greeting = cfg.ownerName ? `Hello ${cfg.ownerName},` : 'Hello,';
    const roiLine = roiPercent !== null && roiPercent !== undefined ? `${roiPercent >= 0 ? '+' : ''}${roiPercent}%` : 'N/A';

    const whatsappMessage =
      `📊 *${tag}Weekly Business Brief — ${businessName}*\n` +
      `_(Last 7 Days: ${funnel.period.startDate} to ${funnel.period.endDate})_\n\n` +
      `${greeting} here is your weekly AI & CRM summary:\n\n` +
      `📥 *Total Enquiries:* ${enquiries}\n` +
      `✅ *Qualified Leads:* ${qualified}\n` +
      `📅 *Appointments Booked:* ${booked}\n` +
      `🤝 *Attended Visits:* ${attended}\n` +
      `🚫 *No-Shows:* ${noShow}\n` +
      `🏆 *Closed Sales:* ${closed}\n` +
      `💰 *Est. Revenue:* ${cur}${revenue.toLocaleString('en-IN')} (ROI: ${roiLine})\n` +
      `🚨 *Complaint Alerts:* ${complaints7d}\n\n` +
      (topSource ? `🔝 *Top Source:* ${topSource.source} (${topSource.enquiries} enquiries, ${topSource.closed} closed)\n` : '') +
      `💡 *Key Insight:* ${topInsight}`;

    const emailSubject = `📊 ${tag}Weekly Owner Brief — ${businessName} (${funnel.period.startDate} to ${funnel.period.endDate})`;
    const emailHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#f1f5f9;padding:24px;color:#0f172a;">
  <div style="max-width:620px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0;">
    <div style="background:linear-gradient(135deg,#0f172a,#1e3a8a);padding:26px 24px;color:#fff;text-align:center;">
      <h1 style="margin:0;font-size:20px;">📊 ${tag}Weekly Owner Brief</h1>
      <div style="margin-top:6px;font-size:12px;opacity:.85;">${this.escapeHtml(businessName)} • ${this.escapeHtml(funnel.period.startDate)} to ${this.escapeHtml(funnel.period.endDate)}</div>
    </div>
    <div style="padding:24px;font-size:14px;line-height:1.6;color:#334155;">
      <p style="margin-top:0;">${this.escapeHtml(greeting)}<br>Here is your automated 7-day performance summary:</p>
      <table style="width:100%;border-collapse:collapse;margin:14px 0;font-size:14px;">
        <tr><td style="padding:8px;border-bottom:1px dashed #e2e8f0;color:#64748b;">Total Enquiries</td><td style="padding:8px;border-bottom:1px dashed #e2e8f0;font-weight:700;text-align:right;">${enquiries}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px dashed #e2e8f0;color:#64748b;">Qualified Leads</td><td style="padding:8px;border-bottom:1px dashed #e2e8f0;font-weight:700;text-align:right;">${qualified}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px dashed #e2e8f0;color:#64748b;">Appointments Booked</td><td style="padding:8px;border-bottom:1px dashed #e2e8f0;font-weight:700;text-align:right;">${booked}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px dashed #e2e8f0;color:#64748b;">Attended Visits</td><td style="padding:8px;border-bottom:1px dashed #e2e8f0;font-weight:700;text-align:right;">${attended}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px dashed #e2e8f0;color:#64748b;">No-Shows</td><td style="padding:8px;border-bottom:1px dashed #e2e8f0;font-weight:700;text-align:right;color:#d97706;">${noShow}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px dashed #e2e8f0;color:#64748b;">Closed Sales</td><td style="padding:8px;border-bottom:1px dashed #e2e8f0;font-weight:700;text-align:right;color:#059669;">${closed}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px dashed #e2e8f0;color:#64748b;">Estimated Revenue</td><td style="padding:8px;border-bottom:1px dashed #e2e8f0;font-weight:700;text-align:right;color:#059669;">${this.escapeHtml(cur)}${revenue.toLocaleString('en-IN')} (ROI: ${this.escapeHtml(roiLine)})</td></tr>
        <tr><td style="padding:8px;color:#64748b;">Complaint Alerts (7d)</td><td style="padding:8px;font-weight:700;text-align:right;color:${complaints7d > 0 ? '#dc2626' : '#0f172a'};">${complaints7d}</td></tr>
      </table>
      ${topSource ? `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin:12px 0;"><strong>🔝 Top Source:</strong> ${this.escapeHtml(topSource.source)} — ${topSource.enquiries} enquiries, ${topSource.closed} closed sales</div>` : ''}
      <div style="background:#fffbeb;border:1px solid #fde68a;border-left:4px solid #f59e0b;border-radius:8px;padding:12px;">
        <strong>💡 Key Insight:</strong><br>${this.escapeHtml(topInsight)}
      </div>
    </div>
    <div style="padding:14px;text-align:center;font-size:12px;color:#94a3b8;border-top:1px solid #f1f5f9;">${this.escapeHtml(businessName)} • Automated Weekly Owner Brief</div>
  </div>
</body></html>`;

    return {
      whatsappMessage,
      emailSubject,
      emailHtml,
      metrics: { enquiries, qualified, booked, attended, closed, noShow, revenue, roiPercent, complaints7d },
    };
  }

  static async sendBrief(
    userId: string,
    opts: { trigger: 'auto' | 'manual'; test?: boolean } = { trigger: 'manual' }
  ): Promise<{ success: boolean; whatsappSent: boolean; emailSent: boolean; metrics: any; error?: string }> {
    const config = await this.getConfig(userId);
    const brief = await this.buildBrief(userId, config, !!opts.test);
    const { weekKey } = this.getIstClock();

    const phones = String(config.ownerPhones || '')
      .split(/[,;\n]/)
      .map((p) => this.normalizePhone(p))
      .filter((p) => p.length >= 8);

    let emails = String(config.ownerEmails || '')
      .split(/[,;\n]/)
      .map((e) => e.trim())
      .filter((e) => e.includes('@'));

    if (emails.length === 0) {
      try {
        const [owner] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
        if (owner?.email) emails = [owner.email];
      } catch (_) {}
    }

    let whatsappSent = false;
    if (config.channels.whatsapp && phones.length > 0) {
      try {
        const { metaWhatsAppService } = await import('../../plugins/messaging/services/meta-whatsapp.service');
        for (const phone of phones) {
          let ok = false;
          const tpl = config.whatsappTemplateName?.trim();
          if (tpl) {
            try {
              const shortSummary = `Enquiries: ${brief.metrics.enquiries}, Qualified: ${brief.metrics.qualified}, Booked: ${brief.metrics.booked}, Attended: ${brief.metrics.attended}, Closed: ${brief.metrics.closed}`;
              await metaWhatsAppService.sendTemplate(userId, phone, tpl, config.whatsappTemplateLanguage || 'en', [
                {
                  type: 'body',
                  parameters: [
                    { type: 'text', text: config.ownerName || 'Owner' },
                    { type: 'text', text: shortSummary },
                  ],
                },
              ]);
              ok = true;
            } catch (tplErr: any) {
              logger.warn(`[WeeklyBrief] Template send failed for ${phone}, falling back to text: ${tplErr?.message}`);
            }
          }
          if (!ok) {
            try {
              await metaWhatsAppService.sendReply(userId, phone, brief.whatsappMessage);
              ok = true;
            } catch (txtErr: any) {
              logger.warn(`[WeeklyBrief] WhatsApp text failed for ${phone}: ${txtErr?.message}`);
            }
          }
          whatsappSent = whatsappSent || ok;
        }
      } catch (err: any) {
        logger.warn(`[WeeklyBrief] WhatsApp service unavailable: ${err?.message}`);
      }
    }

    let emailSent = false;
    if (config.channels.email && emails.length > 0) {
      try {
        const { emailService } = await import('./email-service');
        for (const to of emails) {
          const res = await emailService.sendEmail(to, brief.emailSubject, brief.emailHtml, undefined, { userId });
          if (res?.success) emailSent = true;
        }
      } catch (err: any) {
        logger.warn(`[WeeklyBrief] Email send error: ${err?.message}`);
      }
    }

    if (opts.trigger === 'auto') {
      await this.saveConfig(userId, { lastSentWeekKey: weekKey }).catch(() => {});
    }

    await this.appendLog(userId, {
      id: `wb_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      trigger: opts.trigger,
      weekKey,
      enquiries: brief.metrics.enquiries,
      qualified: brief.metrics.qualified,
      booked: brief.metrics.booked,
      attended: brief.metrics.attended,
      closed: brief.metrics.closed,
      revenue: brief.metrics.revenue,
      whatsappSent,
      emailSent,
      createdAt: new Date().toISOString(),
    });

    const success = whatsappSent || emailSent;
    return {
      success,
      whatsappSent,
      emailSent,
      metrics: brief.metrics,
      error: success ? undefined : 'No channel delivered. Please verify Owner Email / WhatsApp settings.',
    };
  }

  /**
   * Background scheduler cycle — runs every 5 minutes and sends enabled
   * weekly briefs once per week on the user's configured IST day & time.
   */
  static async processDueBriefs(): Promise<void> {
    const rows = await db
      .select({ userId: userEmailTemplates.userId, designJson: userEmailTemplates.designJson })
      .from(userEmailTemplates)
      .where(eq(userEmailTemplates.name, CONFIG_TEMPLATE_NAME));

    const clock = this.getIstClock();
    const nowMinutes = clock.hour * 60 + clock.minute;

    for (const row of rows) {
      const cfg = { ...this.getDefaultConfig(), ...((row.designJson as any) || {}) };
      if (!cfg.enabled) continue;
      if (cfg.lastSentWeekKey === clock.weekKey) continue;
      if (cfg.dayOfWeek !== clock.dayOfWeek) continue;
      const targetMinutes = (Number(cfg.hourIst) || 9) * 60 + (Number(cfg.minuteIst) || 0);
      if (nowMinutes < targetMinutes) continue;

      await this.sendBrief(row.userId, { trigger: 'auto' }).catch((err) =>
        logger.warn(`[WeeklyBrief] Auto-send failed for ${row.userId}: ${err?.message}`)
      );
    }
  }

  static startScheduler(): void {
    if (this.isSchedulerRunning) return;
    this.isSchedulerRunning = true;
    console.log('📊 [WeeklyBrief] Weekly Owner Brief scheduler started (checks every 5m)');
    this.schedulerTimer = setInterval(() => {
      this.processDueBriefs().catch((err) => logger.warn(`[WeeklyBrief] Scheduler cycle error: ${err?.message}`));
    }, 5 * 60 * 1000);
  }
}
