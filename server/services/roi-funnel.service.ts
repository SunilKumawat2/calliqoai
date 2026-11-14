'use strict';
/**
 * ============================================================
 * Calliqo AI - Source-to-Sale ROI Funnel Service
 *
 * READ-ONLY analytics over existing data:
 *   Total Enquiries (leads) ➔ Qualified ➔ Appointments Booked
 *   ➔ Attended ➔ Closed Sales  + Estimated Revenue / ROI
 *
 * It never modifies leads / appointments / calls. The only thing it
 * writes is its own settings row (Average Deal Value, Spend) stored in
 * user_email_templates under a hidden name — same pattern used by the
 * Reminder and Review automation configs.
 * ============================================================
 */

import { db } from '../db';
import { leads, appointments, campaigns, leadStages, userEmailTemplates } from '@shared/schema';
import { eq, and, gte, lte } from 'drizzle-orm';
import { logger } from '../utils/logger';

export interface RoiFunnelConfig {
  avgDealValue: number; // ₹ value of one closed sale
  monthlySpend: number; // ₹ spend per month (AI calling + ads + team), used for ROI
  currency: string; // display symbol
  closedStageKeywords: string; // comma separated lead stage names that mean "closed / won"
  attendedStatuses: string[];
  closedStatuses: string[];
}

const CONFIG_TEMPLATE_NAME = '__CRM_ROI_FUNNEL_CONFIG__';

const QUALIFIED_CATEGORIES = ['hot', 'warm', 'appointment_booked', 'form_submitted', 'call_transfer', 'need_follow_up'];
const CANCELLED_STATUSES = ['cancelled', 'canceled'];
const NO_SHOW_STATUSES = ['no_show'];

type StageKey = 'enquiries' | 'qualified' | 'booked' | 'attended' | 'closed';

interface SourceRow {
  source: string;
  enquiries: number;
  qualified: number;
  booked: number;
  attended: number;
  closed: number;
  revenue: number;
}

export class RoiFunnelService {
  static getDefaultConfig(): RoiFunnelConfig {
    return {
      avgDealValue: 0,
      monthlySpend: 0,
      currency: '₹',
      closedStageKeywords: 'won, closed, converted, deal won, sold, booked done, payment done',
      attendedStatuses: ['completed', 'completed_visited', 'deal_won', 'interested_followup'],
      closedStatuses: ['deal_won'],
    };
  }

  static async getConfig(userId: string): Promise<RoiFunnelConfig> {
    const defaults = this.getDefaultConfig();
    try {
      const [row] = await db
        .select()
        .from(userEmailTemplates)
        .where(and(eq(userEmailTemplates.userId, userId), eq(userEmailTemplates.name, CONFIG_TEMPLATE_NAME)))
        .limit(1);
      if (row?.designJson && typeof row.designJson === 'object') {
        const saved = row.designJson as Partial<RoiFunnelConfig>;
        return {
          ...defaults,
          ...saved,
          attendedStatuses: Array.isArray(saved.attendedStatuses) && saved.attendedStatuses.length ? saved.attendedStatuses : defaults.attendedStatuses,
          closedStatuses: Array.isArray(saved.closedStatuses) && saved.closedStatuses.length ? saved.closedStatuses : defaults.closedStatuses,
        };
      }
    } catch (err: any) {
      logger.warn(`[RoiFunnel] Error loading config for ${userId}: ${err?.message}`);
    }
    return defaults;
  }

  static async saveConfig(userId: string, partial: Partial<RoiFunnelConfig>): Promise<RoiFunnelConfig> {
    const current = await this.getConfig(userId);
    const num = (v: any, fallback: number) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? n : fallback;
    };
    const merged: RoiFunnelConfig = {
      ...current,
      avgDealValue: num(partial.avgDealValue, current.avgDealValue),
      monthlySpend: num(partial.monthlySpend, current.monthlySpend),
      currency: typeof partial.currency === 'string' && partial.currency.trim() ? partial.currency.trim().slice(0, 5) : current.currency,
      closedStageKeywords: typeof partial.closedStageKeywords === 'string' ? partial.closedStageKeywords : current.closedStageKeywords,
      attendedStatuses: current.attendedStatuses,
      closedStatuses: current.closedStatuses,
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
        subject: 'CRM Source-to-Sale ROI Funnel Config',
        htmlBody: 'JSON_CONFIG',
        variables: [],
        isActive: false,
        designJson: merged as any,
      });
    }
    return merged;
  }

  private static phoneKey(raw?: string | null): string {
    const d = String(raw || '').replace(/\D/g, '');
    return d.length >= 10 ? d.slice(-10) : d;
  }

  private static pct(part: number, whole: number): number {
    if (!whole) return 0;
    return Math.round((part / whole) * 1000) / 10;
  }

  /**
   * Resolve the requested period. Defaults to the last 30 days.
   */
  static resolveRange(range?: string, from?: string, to?: string): { start: Date; end: Date; label: string } {
    const end = new Date();
    const start = new Date();
    const r = String(range || '30d');
    if (r === 'custom' && from) {
      const s = new Date(`${from}T00:00:00+05:30`);
      const e = to ? new Date(`${to}T23:59:59+05:30`) : end;
      if (!isNaN(s.getTime()) && !isNaN(e.getTime())) return { start: s, end: e, label: `${from} → ${to || 'today'}` };
    }
    if (r === 'today') {
      const istNow = new Date(Date.now() + 5.5 * 3600 * 1000);
      const ymd = istNow.toISOString().slice(0, 10);
      return { start: new Date(`${ymd}T00:00:00+05:30`), end, label: 'Today' };
    }
    const days = r === '7d' ? 7 : r === '90d' ? 90 : r === 'all' ? 3650 : 30;
    start.setTime(end.getTime() - days * 24 * 3600 * 1000);
    return { start, end, label: r === 'all' ? 'All time' : `Last ${days} days` };
  }

  static async getFunnel(
    userId: string,
    opts: { range?: string; from?: string; to?: string }
  ): Promise<any> {
    const config = await this.getConfig(userId);
    const { start, end, label } = this.resolveRange(opts.range, opts.from, opts.to);
    const startYmd = new Date(start.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    const endYmd = new Date(end.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

    // ── 1. Load data (read-only) ──
    const [leadRows, stageRows, campaignRows, aptRows] = await Promise.all([
      db
        .select({
          id: leads.id,
          phone: leads.phone,
          sourceType: leads.sourceType,
          campaignId: leads.campaignId,
          stageId: leads.stageId,
          stage: leads.stage,
          aiCategory: leads.aiCategory,
          leadScore: leads.leadScore,
          hasAppointment: leads.hasAppointment,
          hasFormSubmission: leads.hasFormSubmission,
          googleSheetId: leads.googleSheetId,
          externalLeadId: leads.externalLeadId,
          createdAt: leads.createdAt,
        })
        .from(leads)
        .where(and(eq(leads.userId, userId), gte(leads.createdAt, start), lte(leads.createdAt, end)))
        .limit(50000),
      db.select({ id: leadStages.id, name: leadStages.name }).from(leadStages).where(eq(leadStages.userId, userId)),
      db.select({ id: campaigns.id, name: campaigns.name }).from(campaigns).where(eq(campaigns.userId, userId)),
      db
        .select({
          id: appointments.id,
          contactPhone: appointments.contactPhone,
          status: appointments.status,
          appointmentDate: appointments.appointmentDate,
          createdAt: appointments.createdAt,
          metadata: appointments.metadata,
        })
        .from(appointments)
        .where(and(eq(appointments.userId, userId), gte(appointments.createdAt, start), lte(appointments.createdAt, end)))
        .limit(50000),
    ]);

    const stageNameById = new Map(stageRows.map((s) => [s.id, String(s.name || '')]));
    const campaignNameById = new Map(campaignRows.map((c) => [c.id, String(c.name || '')]));
    const closedKeywords = String(config.closedStageKeywords || '')
      .split(',')
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);

    const isLeadClosed = (l: (typeof leadRows)[0]) => {
      const stageName = `${(l.stageId && stageNameById.get(l.stageId)) || ''} ${l.stage || ''}`.toLowerCase();
      return closedKeywords.some((k) => stageName.includes(k));
    };
    const isLeadLost = (l: (typeof leadRows)[0]) => {
      const stageName = `${(l.stageId && stageNameById.get(l.stageId)) || ''} ${l.stage || ''}`.toLowerCase();
      return /not[\s_-]?interested|lost|junk|spam|invalid/.test(stageName);
    };
    const isLeadQualified = (l: (typeof leadRows)[0]) =>
      (!!l.aiCategory && QUALIFIED_CATEGORIES.includes(String(l.aiCategory))) ||
      (typeof l.leadScore === 'number' && l.leadScore >= 40) ||
      l.hasAppointment ||
      l.hasFormSubmission ||
      isLeadClosed(l);

    const sourceOf = (l: (typeof leadRows)[0]): string => {
      if (l.googleSheetId) return 'Google Sheet / Ads Form';
      if (l.externalLeadId) return 'External Portal / CRM';
      if (l.sourceType === 'campaign') {
        const name = l.campaignId ? campaignNameById.get(l.campaignId) : '';
        return name ? `Campaign: ${name}` : 'Outbound Campaign';
      }
      if (l.sourceType === 'incoming') return 'Inbound Call';
      return l.sourceType ? String(l.sourceType).replace(/_/g, ' ') : 'Other';
    };

    // ── 2. Appointments grouped by phone ──
    const attendedSet = new Set(config.attendedStatuses);
    const closedSet = new Set(config.closedStatuses);
    const aptByPhone = new Map<string, { booked: boolean; attended: boolean; closed: boolean }>();

    let booked = 0;
    let attended = 0;
    let closedFromApts = 0;
    let noShow = 0;
    let cancelled = 0;
    let upcoming = 0;
    let awaitingOutcome = 0;
    const todayYmd = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

    for (const a of aptRows) {
      const status = String(a.status || '').toLowerCase();
      const isCancelled = CANCELLED_STATUSES.includes(status);
      const isNoShow = NO_SHOW_STATUSES.includes(status);
      const isAttended = attendedSet.has(status);
      const isClosed = closedSet.has(status);
      const aptDate = String(a.appointmentDate || '').slice(0, 10);

      if (isCancelled) cancelled++;
      else booked++;
      if (isNoShow) noShow++;
      if (isAttended) attended++;
      if (isClosed) closedFromApts++;
      if (!isCancelled && !isNoShow && !isAttended) {
        if (aptDate >= todayYmd) upcoming++;
        else awaitingOutcome++;
      }

      const key = this.phoneKey(a.contactPhone);
      if (key) {
        const prev = aptByPhone.get(key) || { booked: false, attended: false, closed: false };
        aptByPhone.set(key, {
          booked: prev.booked || !isCancelled,
          attended: prev.attended || isAttended,
          closed: prev.closed || isClosed,
        });
      }
    }

    // ── 3. Leads → enquiries / qualified / per-source ──
    const sources = new Map<string, SourceRow>();
    const closedPhones = new Set<string>();
    let qualified = 0;
    let lost = 0;
    let hot = 0;
    let warm = 0;

    for (const l of leadRows) {
      const src = sourceOf(l);
      const row = sources.get(src) || { source: src, enquiries: 0, qualified: 0, booked: 0, attended: 0, closed: 0, revenue: 0 };
      row.enquiries++;
      const q = isLeadQualified(l);
      if (q) {
        qualified++;
        row.qualified++;
      }
      if (isLeadLost(l)) lost++;
      if (l.aiCategory === 'hot') hot++;
      if (l.aiCategory === 'warm') warm++;

      const key = this.phoneKey(l.phone);
      const apt = key ? aptByPhone.get(key) : undefined;
      if (apt?.booked || l.hasAppointment) row.booked++;
      if (apt?.attended) row.attended++;
      const isClosed = !!apt?.closed || isLeadClosed(l);
      if (isClosed) {
        row.closed++;
        if (key) closedPhones.add(key);
      }
      sources.set(src, row);
    }

    // Closed sales = unique customers closed via appointment (deal_won) or lead stage
    let closedWithoutPhone = 0;
    for (const a of aptRows) {
      if (closedSet.has(String(a.status || '').toLowerCase())) {
        const key = this.phoneKey(a.contactPhone);
        if (key) closedPhones.add(key);
        else closedWithoutPhone++;
      }
    }
    const closed = closedPhones.size + closedWithoutPhone;

    const enquiries = leadRows.length;
    // Funnel must never look inverted: each stage is capped by the previous one for display
    const qualifiedShown = Math.max(qualified, booked);
    const enquiriesShown = Math.max(enquiries, qualifiedShown);

    // ── 4. Revenue & ROI ──
    const days = Math.max(1, (end.getTime() - start.getTime()) / (24 * 3600 * 1000));
    const periodSpend = Math.round((config.monthlySpend * Math.min(days, 3650)) / 30);
    const revenue = Math.round(closed * config.avgDealValue);
    const roiPercent = periodSpend > 0 ? Math.round(((revenue - periodSpend) / periodSpend) * 1000) / 10 : null;
    const costPerEnquiry = periodSpend > 0 && enquiriesShown > 0 ? Math.round(periodSpend / enquiriesShown) : null;
    const costPerBooking = periodSpend > 0 && booked > 0 ? Math.round(periodSpend / booked) : null;
    const costPerSale = periodSpend > 0 && closed > 0 ? Math.round(periodSpend / closed) : null;

    const sourceList = Array.from(sources.values())
      .map((s) => ({ ...s, revenue: Math.round(s.closed * config.avgDealValue), conversionPct: this.pct(s.closed, s.enquiries) }))
      .sort((a, b) => b.enquiries - a.enquiries);

    // ── 5. Leakage insights (where leads are being lost) ──
    const insights: Array<{ level: 'warning' | 'info' | 'success'; text: string }> = [];
    const notQualified = Math.max(0, enquiriesShown - qualifiedShown);
    if (enquiriesShown > 0 && notQualified > 0) {
      insights.push({
        level: this.pct(notQualified, enquiriesShown) > 50 ? 'warning' : 'info',
        text: `${notQualified} enquiries (${this.pct(notQualified, enquiriesShown)}%) were not qualified — review your AI agent script or lead source quality.`,
      });
    }
    const qualifiedNotBooked = Math.max(0, qualifiedShown - booked);
    if (qualifiedNotBooked > 0) {
      insights.push({
        level: 'warning',
        text: `${qualifiedNotBooked} qualified leads have not booked an appointment yet — trigger a follow-up call or WhatsApp message.`,
      });
    }
    if (noShow > 0) {
      insights.push({
        level: 'warning',
        text: `${noShow} appointments were No-Show (${this.pct(noShow, booked)}% of booked) — keep No-Show Recovery automation enabled.`,
      });
    }
    if (awaitingOutcome > 0) {
      insights.push({
        level: 'info',
        text: `${awaitingOutcome} past appointments still have no outcome recorded — click "Mark Attended" to keep your funnel accurate.`,
      });
    }
    if (attended > 0 && closed < attended) {
      insights.push({
        level: 'info',
        text: `${attended - closed > 0 ? attended - closed : 0} attended visits have not closed yet — prioritize sales team follow-ups.`,
      });
    }
    if (config.avgDealValue <= 0) {
      insights.push({ level: 'info', text: 'Set your "Average Deal Value" in ROI Settings to calculate Estimated Revenue and ROI.' });
    }
    if (closed > 0 && roiPercent !== null && roiPercent > 0) {
      insights.push({ level: 'success', text: `${closed} sales closed in this period — ROI is +${roiPercent}%! 🎉` });
    }

    const stages: Array<{ key: StageKey; label: string; count: number; pctOfTotal: number; pctOfPrev: number }> = [];
    const counts: Record<StageKey, number> = {
      enquiries: enquiriesShown,
      qualified: qualifiedShown,
      booked,
      attended,
      closed,
    };
    const labels: Record<StageKey, string> = {
      enquiries: 'Total Enquiries',
      qualified: 'Qualified',
      booked: 'Appointments Booked',
      attended: 'Attended Visits',
      closed: 'Closed Sales',
    };
    const order: StageKey[] = ['enquiries', 'qualified', 'booked', 'attended', 'closed'];
    order.forEach((k, i) => {
      const prev = i === 0 ? counts[k] : counts[order[i - 1]];
      stages.push({
        key: k,
        label: labels[k],
        count: counts[k],
        pctOfTotal: this.pct(counts[k], counts.enquiries),
        pctOfPrev: i === 0 ? 100 : this.pct(counts[k], prev),
      });
    });

    return {
      period: { label, start: start.toISOString(), end: end.toISOString(), startDate: startYmd, endDate: endYmd },
      config,
      stages,
      extra: { noShow, cancelled, upcoming, awaitingOutcome, lost, hot, warm, rawEnquiries: enquiries, rawQualified: qualified },
      money: {
        currency: config.currency,
        avgDealValue: config.avgDealValue,
        periodSpend,
        revenue,
        roiPercent,
        costPerEnquiry,
        costPerBooking,
        costPerSale,
      },
      sources: sourceList,
      insights,
      generatedAt: new Date().toISOString(),
    };
  }
}
