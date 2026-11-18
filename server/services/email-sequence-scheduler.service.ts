/**
 * ============================================================
 * Calliqo AI - Automated Email Follow-up Sequence Scheduler
 *
 * Runs in the background (every 10 minutes) and, for every tenant who has switched
 * ON "Automatic Email Sequences" in the AI Email Assistant settings:
 *   1. Auto-enrolls NEW Hot / Warm CRM leads (created after the switch was turned ON)
 *      that have a valid email address.
 *   2. Sends each enabled sequence step when it becomes due
 *      (Step 1 → +0h, Step 2 → +24h, Step 3 → +72h by default), using the existing
 *      AI draft generator (with Call + WhatsApp memory) and SMTP sender.
 *   3. Automatically stops a sequence when the lead books an appointment,
 *      is marked not interested / closed, or is deleted.
 *
 * Fully isolated: uses its own JSON store row and does not modify the existing
 * follow-up CALL scheduler or any other automation.
 * ============================================================
 */

import { db } from '../db';
import { sql, and, eq } from 'drizzle-orm';
import { userEmailTemplates } from '@shared/schema';
import {
  SocialEmailAssistantService,
  type EmailAssistantConfig,
  type EmailSequenceStep,
} from './social-email-assistant.service';

const EMAIL_CONFIG_KEY = '__CRM_EMAIL_ASSISTANT_CONFIG__';
const ENROLLMENTS_KEY = '__CRM_EMAIL_SEQUENCE_ENROLLMENTS__';
const TICK_INTERVAL_MS = 10 * 60 * 1000;
const MAX_EMAILS_PER_USER_PER_TICK = 20;
const MAX_ENROLLMENTS_STORED = 300;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const STOP_STAGES = ['appointment', 'not_interested', 'won', 'closed', 'lost', 'converted', 'deal_won'];
const STOP_CATEGORIES = ['appointment_booked'];

export interface SequenceStepLog {
  stepId: string;
  stepNumber: number;
  name: string;
  status: 'sent' | 'skipped' | 'failed';
  at: string;
  subject?: string;
  error?: string;
}

export interface SequenceEnrollment {
  id: string;
  leadId: string | null;
  recipientName: string;
  recipientEmail: string;
  recipientPhone: string | null;
  category: string;
  source: 'auto' | 'manual';
  enrolledAt: string;
  status: 'active' | 'completed' | 'stopped';
  stopReason?: string | null;
  stepLogs: SequenceStepLog[];
  nextStepNumber: number | null;
  nextDueAt: string | null;
}

export class EmailSequenceSchedulerService {
  private static isSchedulerRunning = false;
  private static isProcessing = false;
  private static processingUsers = new Set<string>();
  private static schedulerTimer: NodeJS.Timeout | null = null;

  // ─────────────────────────────────────────────────────────────
  // Storage (isolated row in user_email_templates.design_json)
  // ─────────────────────────────────────────────────────────────
  static async getEnrollments(userId: string): Promise<SequenceEnrollment[]> {
    try {
      const [row] = await db
        .select()
        .from(userEmailTemplates)
        .where(and(eq(userEmailTemplates.userId, userId), eq(userEmailTemplates.name, ENROLLMENTS_KEY)))
        .limit(1);
      const items = (row?.designJson as any)?.items;
      return Array.isArray(items) ? items : [];
    } catch (err: any) {
      console.warn('[EmailSequence] Failed to read enrollments:', err?.message);
      return [];
    }
  }

  private static async saveEnrollments(userId: string, items: SequenceEnrollment[]): Promise<void> {
    const payload = { items: items.slice(0, MAX_ENROLLMENTS_STORED) };
    try {
      const [existing] = await db
        .select({ id: userEmailTemplates.id })
        .from(userEmailTemplates)
        .where(and(eq(userEmailTemplates.userId, userId), eq(userEmailTemplates.name, ENROLLMENTS_KEY)))
        .limit(1);
      if (existing) {
        await db
          .update(userEmailTemplates)
          .set({ designJson: payload, updatedAt: new Date() })
          .where(eq(userEmailTemplates.id, existing.id));
      } else {
        await db.insert(userEmailTemplates).values({
          userId,
          name: ENROLLMENTS_KEY,
          subject: 'AI Email Sequence Enrollments',
          htmlBody: 'JSON_STORE',
          variables: [],
          isActive: false,
          designJson: payload,
        });
      }
    } catch (err: any) {
      console.warn('[EmailSequence] Failed to save enrollments:', err?.message);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Step scheduling helpers
  // ─────────────────────────────────────────────────────────────
  private static enabledSteps(config: EmailAssistantConfig): EmailSequenceStep[] {
    return (config.sequences || [])
      .filter((s) => s.enabled)
      .sort((a, b) => a.stepNumber - b.stepNumber);
  }

  private static stepApplies(step: EmailSequenceStep, category: string): boolean {
    if (!step.targetCategory || step.targetCategory === 'all') return true;
    return step.targetCategory === category;
  }

  /** Computes the next pending step (number + due time) for an enrollment. */
  private static computeNext(
    enrollment: SequenceEnrollment,
    config: EmailAssistantConfig
  ): { nextStepNumber: number | null; nextDueAt: string | null } {
    const done = new Set(enrollment.stepLogs.map((l) => l.stepId));
    const next = this.enabledSteps(config).find((s) => !done.has(s.id));
    if (!next) return { nextStepNumber: null, nextDueAt: null };
    const due = new Date(new Date(enrollment.enrolledAt).getTime() + (next.delayHours || 0) * 3600 * 1000);
    return { nextStepNumber: next.stepNumber, nextDueAt: due.toISOString() };
  }

  private static normaliseCategory(aiCategory: string | null, stage: string | null): string {
    const c = String(aiCategory || '').toLowerCase();
    const s = String(stage || '').toLowerCase();
    if (c === 'hot' || s === 'hot') return 'hot';
    if (c === 'warm' || c === 'need_follow_up' || s === 'follow_up') return 'warm';
    return 'new';
  }

  // ─────────────────────────────────────────────────────────────
  // Manual controls (used by dashboard routes)
  // ─────────────────────────────────────────────────────────────
  static async enrollManually(
    userId: string,
    params: { leadId?: string; recipientName: string; recipientEmail: string; recipientPhone?: string; category?: string }
  ): Promise<SequenceEnrollment> {
    const email = String(params.recipientEmail || '').trim().toLowerCase();
    if (!EMAIL_REGEX.test(email)) throw new Error('Valid recipient email is required');

    const config = await SocialEmailAssistantService.getEmailConfig(userId);
    const items = await this.getEnrollments(userId);
    const existing = items.find((e) => e.status === 'active' && e.recipientEmail.toLowerCase() === email);
    if (existing) return existing;

    const enrollment: SequenceEnrollment = {
      id: `seq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      leadId: params.leadId || null,
      recipientName: params.recipientName || 'Customer',
      recipientEmail: email,
      recipientPhone: params.recipientPhone || null,
      category: params.category || 'all',
      source: 'manual',
      enrolledAt: new Date().toISOString(),
      status: 'active',
      stepLogs: [],
      nextStepNumber: null,
      nextDueAt: null,
    };
    Object.assign(enrollment, this.computeNext(enrollment, config));
    await this.saveEnrollments(userId, [enrollment, ...items]);

    // Send any immediately-due step (e.g. Step 1 at +0h) without waiting for the next tick
    this.processUser(userId, config).catch((err) =>
      console.warn('[EmailSequence] Immediate processing failed:', err?.message)
    );
    return enrollment;
  }

  static async stopEnrollment(userId: string, enrollmentId: string, reason = 'Stopped manually'): Promise<SequenceEnrollment | null> {
    const items = await this.getEnrollments(userId);
    const target = items.find((e) => e.id === enrollmentId);
    if (!target) return null;
    target.status = 'stopped';
    target.stopReason = reason;
    target.nextDueAt = null;
    target.nextStepNumber = null;
    await this.saveEnrollments(userId, items);
    return target;
  }

  // ─────────────────────────────────────────────────────────────
  // Scheduler
  // ─────────────────────────────────────────────────────────────
  static startScheduler(): void {
    if (this.isSchedulerRunning) return;
    this.isSchedulerRunning = true;
    console.log('📧 [EmailSequence] Automated Email Follow-up Sequence scheduler started (every 10 min)');

    // First run shortly after boot, then on an interval
    setTimeout(() => this.runCycle().catch(() => {}), 60 * 1000);
    this.schedulerTimer = setInterval(() => {
      this.runCycle().catch((err) => console.warn('[EmailSequence] Cycle error:', err?.message));
    }, TICK_INTERVAL_MS);
  }

  static async runCycle(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;
    try {
      const result = await db.execute(sql`
        SELECT user_id FROM user_email_templates
        WHERE name = ${EMAIL_CONFIG_KEY}
          AND design_json->>'autoSequenceEnabled' = 'true'
      `);
      const userIds: string[] = ((result as any)?.rows || []).map((r: any) => r.user_id).filter(Boolean);
      for (const userId of userIds) {
        try {
          const config = await SocialEmailAssistantService.getEmailConfig(userId);
          if (!config.enabled || !config.autoSequenceEnabled) continue;
          await this.autoEnrollNewLeads(userId, config);
          await this.processUser(userId, config);
        } catch (err: any) {
          console.warn(`[EmailSequence] User ${userId} cycle error:`, err?.message);
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /** Enroll new Hot/Warm leads (created after auto-sequences were switched ON) with a valid email. */
  private static async autoEnrollNewLeads(userId: string, config: EmailAssistantConfig): Promise<void> {
    if (!config.autoEnrollHotLeads && !config.autoEnrollWarmLeads) return;
    const since = config.autoSequenceEnabledAt ? new Date(config.autoSequenceEnabledAt) : null;
    if (!since || isNaN(since.getTime())) return; // safety: never enroll historic leads

    const res = await db.execute(sql`
      SELECT id, first_name, last_name, email, phone, stage, ai_category
      FROM leads
      WHERE user_id = ${userId}
        AND email IS NOT NULL AND email <> ''
        AND created_at >= ${since.toISOString()}
        AND (LOWER(COALESCE(ai_category, '')) IN ('hot', 'warm', 'need_follow_up')
             OR LOWER(COALESCE(stage, '')) IN ('hot', 'follow_up'))
      ORDER BY created_at DESC
      LIMIT 100
    `);
    const rows: any[] = (res as any)?.rows || [];
    if (rows.length === 0) return;

    const items = await this.getEnrollments(userId);
    const enrolledLeadIds = new Set(items.map((e) => e.leadId).filter(Boolean));
    const enrolledEmails = new Set(items.map((e) => e.recipientEmail.toLowerCase()));
    let added = 0;

    for (const lead of rows) {
      const email = String(lead.email || '').trim().toLowerCase();
      if (!EMAIL_REGEX.test(email)) continue;
      if (enrolledLeadIds.has(lead.id) || enrolledEmails.has(email)) continue;

      const category = this.normaliseCategory(lead.ai_category, lead.stage);
      if (category === 'hot' && !config.autoEnrollHotLeads) continue;
      if (category === 'warm' && !config.autoEnrollWarmLeads) continue;
      if (category === 'new') continue;

      const phone = String(lead.phone || '');
      const enrollment: SequenceEnrollment = {
        id: `seq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        leadId: lead.id,
        recipientName: [lead.first_name, lead.last_name].filter(Boolean).join(' ').replace(/\((Instagram|Facebook)\)/, '').trim() || 'Customer',
        recipientEmail: email,
        recipientPhone: phone.startsWith('social:') ? null : phone || null,
        category,
        source: 'auto',
        enrolledAt: new Date().toISOString(),
        status: 'active',
        stepLogs: [],
        nextStepNumber: null,
        nextDueAt: null,
      };
      Object.assign(enrollment, this.computeNext(enrollment, config));
      items.unshift(enrollment);
      enrolledLeadIds.add(lead.id);
      enrolledEmails.add(email);
      added++;
    }

    if (added > 0) {
      await this.saveEnrollments(userId, items);
      console.log(`[EmailSequence] Auto-enrolled ${added} new lead(s) for user ${userId}`);
    }
  }

  /** Returns a stop reason if the lead no longer needs the sequence. */
  private static async checkStopCondition(userId: string, leadId: string | null): Promise<string | null> {
    if (!leadId) return null;
    const res = await db.execute(sql`
      SELECT stage, ai_category, has_appointment FROM leads
      WHERE id = ${leadId} AND user_id = ${userId}
      LIMIT 1
    `);
    const lead = (res as any)?.rows?.[0];
    if (!lead) return 'Lead deleted from CRM';
    if (lead.has_appointment) return 'Appointment booked';
    if (STOP_STAGES.includes(String(lead.stage || '').toLowerCase())) return `Lead moved to "${lead.stage}"`;
    if (STOP_CATEGORIES.includes(String(lead.ai_category || '').toLowerCase())) return 'Appointment booked';
    return null;
  }

  /** Sends all due steps for one tenant. */
  static async processUser(userId: string, config?: EmailAssistantConfig): Promise<{ sent: number; failed: number }> {
    if (this.processingUsers.has(userId)) return { sent: 0, failed: 0 };
    this.processingUsers.add(userId);
    try {
      return await this.processUserInternal(userId, config);
    } finally {
      this.processingUsers.delete(userId);
    }
  }

  private static async processUserInternal(userId: string, config?: EmailAssistantConfig): Promise<{ sent: number; failed: number }> {
    const cfg = config || (await SocialEmailAssistantService.getEmailConfig(userId));
    const items = await this.getEnrollments(userId);
    const steps = this.enabledSteps(cfg);
    const now = Date.now();
    let sent = 0;
    let failed = 0;
    let changed = false;

    for (const enrollment of items) {
      if (enrollment.status !== 'active') continue;
      if (sent + failed >= MAX_EMAILS_PER_USER_PER_TICK) break;

      const stopReason = await this.checkStopCondition(userId, enrollment.leadId).catch(() => null);
      if (stopReason) {
        enrollment.status = 'stopped';
        enrollment.stopReason = stopReason;
        enrollment.nextDueAt = null;
        enrollment.nextStepNumber = null;
        changed = true;
        continue;
      }

      const enrolledAtMs = new Date(enrollment.enrolledAt).getTime();
      const done = new Set(enrollment.stepLogs.map((l) => l.stepId));

      for (const step of steps) {
        if (done.has(step.id)) continue;
        const dueAt = enrolledAtMs + (step.delayHours || 0) * 3600 * 1000;
        if (dueAt > now) break; // later steps are not due yet

        if (!this.stepApplies(step, enrollment.category) && enrollment.category !== 'all') {
          enrollment.stepLogs.push({
            stepId: step.id,
            stepNumber: step.stepNumber,
            name: step.name,
            status: 'skipped',
            at: new Date().toISOString(),
            error: `Step targets "${step.targetCategory}" leads (lead is "${enrollment.category}")`,
          });
          changed = true;
          continue;
        }

        if (sent + failed >= MAX_EMAILS_PER_USER_PER_TICK) break;

        try {
          const draft = await SocialEmailAssistantService.generateAiEmailDraft({
            userId,
            leadId: enrollment.leadId || undefined,
            recipientName: enrollment.recipientName,
            recipientEmail: enrollment.recipientEmail,
            recipientPhone: enrollment.recipientPhone || undefined,
            purpose: `${step.name} (Subject idea: ${step.subjectTemplate})`,
            customNotes: step.instructions,
          });
          const result = await SocialEmailAssistantService.sendEmailDraft({
            userId,
            draftId: draft.id,
            recipientName: enrollment.recipientName,
            recipientEmail: enrollment.recipientEmail,
            subject: draft.subject,
            body: draft.body,
            purpose: step.name,
          });
          enrollment.stepLogs.push({
            stepId: step.id,
            stepNumber: step.stepNumber,
            name: step.name,
            status: result.success ? 'sent' : 'failed',
            at: new Date().toISOString(),
            subject: draft.subject,
            error: result.error,
          });
          if (result.success) sent++;
          else failed++;
        } catch (err: any) {
          enrollment.stepLogs.push({
            stepId: step.id,
            stepNumber: step.stepNumber,
            name: step.name,
            status: 'failed',
            at: new Date().toISOString(),
            error: err?.message || 'Unknown error',
          });
          failed++;
        }
        changed = true;
      }

      const next = this.computeNext(enrollment, cfg);
      enrollment.nextStepNumber = next.nextStepNumber;
      enrollment.nextDueAt = next.nextDueAt;
      if (!next.nextStepNumber) {
        enrollment.status = 'completed';
        changed = true;
      }
    }

    if (changed) await this.saveEnrollments(userId, items);
    if (sent || failed) console.log(`[EmailSequence] User ${userId}: sent=${sent}, failed=${failed}`);
    return { sent, failed };
  }
}
