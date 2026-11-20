import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { db } from '../db';
import { supportTickets, salesTeamMembers, users, type SupportTicket } from '@shared/schema';
import { logger } from '../utils/logger';

export interface CreateSupportTicketInput {
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  channel?: 'voice_call' | 'whatsapp' | 'instagram_dm' | 'facebook_dm' | 'manual' | 'email';
  sourceId?: string;
  category?: 'service_complaint' | 'billing_refund' | 'technical_issue' | 'escalation_request' | 'appointment_issue' | 'general';
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  subject: string;
  description?: string;
  aiSummary?: string;
  sentiment?: string;
  assignedStaffId?: string;
  assignedStaffName?: string;
  assignedStaffPhone?: string;
  assignedStaffEmail?: string;
  escalated?: boolean;
  metadata?: Record<string, any>;
}

export interface SupportTicketFilter {
  status?: string;
  priority?: string;
  category?: string;
  channel?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface SupportMetrics {
  totalTickets: number;
  openTickets: number;
  inProgressTickets: number;
  resolvedTickets: number;
  escalatedCount: number;
  aiAutoResolvedCount: number;
  humanResolvedCount: number;
  aiResolutionRate: number; // percentage (e.g. 84.5)
  totalCustomerQueries: number;
  avgResolutionHours: number;
  categoryBreakdown: Record<string, number>;
  channelBreakdown: Record<string, number>;
  urgentPendingCount: number;
}

export class SupportTicketService {
  private static tableInitialized = false;

  /**
   * Safe idempotent table initialization on startup
   */
  static async ensureTable(): Promise<void> {
    if (this.tableInitialized) return;
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS support_tickets (
          id VARCHAR(64) PRIMARY KEY,
          ticket_number VARCHAR(32) NOT NULL,
          user_id VARCHAR(64) NOT NULL,
          customer_name VARCHAR(255) NOT NULL,
          customer_phone VARCHAR(50) NOT NULL,
          customer_email VARCHAR(255),
          channel VARCHAR(50) NOT NULL DEFAULT 'voice_call',
          source_id VARCHAR(64),
          category VARCHAR(64) NOT NULL DEFAULT 'service_complaint',
          priority VARCHAR(32) NOT NULL DEFAULT 'medium',
          status VARCHAR(32) NOT NULL DEFAULT 'open',
          subject VARCHAR(255) NOT NULL,
          description TEXT,
          ai_summary TEXT,
          sentiment VARCHAR(50) DEFAULT 'neutral',
          assigned_staff_id VARCHAR(64),
          assigned_staff_name VARCHAR(255),
          assigned_staff_phone VARCHAR(50),
          assigned_staff_email VARCHAR(255),
          escalated BOOLEAN NOT NULL DEFAULT false,
          escalated_at TIMESTAMP,
          escalation_sent_whatsapp BOOLEAN DEFAULT false,
          escalation_sent_email BOOLEAN DEFAULT false,
          resolved_at TIMESTAMP,
          resolved_by VARCHAR(255),
          resolution_notes TEXT,
          resolution_source VARCHAR(32) DEFAULT 'human_staff',
          metadata JSONB DEFAULT '{}'::jsonb,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS support_tickets_user_id_idx ON support_tickets (user_id);
        CREATE INDEX IF NOT EXISTS support_tickets_status_idx ON support_tickets (status);
        CREATE INDEX IF NOT EXISTS support_tickets_priority_idx ON support_tickets (priority);
        CREATE INDEX IF NOT EXISTS support_tickets_created_at_idx ON support_tickets (created_at);
      `);
      this.tableInitialized = true;
    } catch (err: any) {
      logger.warn(`[SupportTicket] ensureTable check: ${err?.message}`);
    }
  }

  /**
   * Generate next user-scoped Ticket Number: TKT-1001, TKT-1002, etc.
   */
  private static async getNextTicketNumber(userId: string): Promise<string> {
    try {
      const res = await db.execute(sql`
        SELECT COUNT(*)::int AS cnt FROM support_tickets WHERE user_id = ${userId}
      `);
      const count = Number((res as any)?.rows?.[0]?.cnt || 0);
      return `TKT-${1001 + count}`;
    } catch {
      return `TKT-${Date.now().toString().slice(-4)}`;
    }
  }

  /**
   * Format phone number to clean E.164 (+91XXXXXXXXXX)
   */
  private static normalizePhone(raw?: string | null): string {
    const digits = String(raw || '').replace(/[^\d]/g, '');
    if (!digits) return '';
    if (digits.length === 10 && /^[6-9]/.test(digits)) return `+91${digits}`;
    return `+${digits}`;
  }

  /**
   * Create a new support ticket and optionally trigger instant escalation alerts
   */
  static async createTicket(userId: string, input: CreateSupportTicketInput): Promise<SupportTicket> {
    await this.ensureTable();

    const ticketNumber = await this.getNextTicketNumber(userId);
    const priority = input.priority || (input.escalated ? 'high' : 'medium');
    const isEscalated = input.escalated ?? (priority === 'urgent' || priority === 'high');

    // Fill staff details if assigned
    let assignedStaffName = input.assignedStaffName;
    let assignedStaffPhone = input.assignedStaffPhone;
    let assignedStaffEmail = input.assignedStaffEmail;

    if (input.assignedStaffId && (!assignedStaffName || !assignedStaffPhone)) {
      try {
        const [staff] = await db
          .select()
          .from(salesTeamMembers)
          .where(and(eq(salesTeamMembers.id, input.assignedStaffId), eq(salesTeamMembers.userId, userId)))
          .limit(1);
        if (staff) {
          assignedStaffName = staff.name;
          assignedStaffPhone = staff.phone;
          assignedStaffEmail = staff.email || undefined;
        }
      } catch (_) {}
    }

    const [ticket] = await db
      .insert(supportTickets)
      .values({
        ticketNumber,
        userId,
        customerName: input.customerName.trim(),
        customerPhone: this.normalizePhone(input.customerPhone),
        customerEmail: input.customerEmail?.trim() || null,
        channel: input.channel || 'voice_call',
        sourceId: input.sourceId || null,
        category: input.category || 'service_complaint',
        priority,
        status: 'open',
        subject: input.subject.trim(),
        description: input.description?.trim() || null,
        aiSummary: input.aiSummary?.trim() || null,
        sentiment: input.sentiment || 'neutral',
        assignedStaffId: input.assignedStaffId || null,
        assignedStaffName: assignedStaffName || null,
        assignedStaffPhone: assignedStaffPhone || null,
        assignedStaffEmail: assignedStaffEmail || null,
        escalated: isEscalated,
        escalatedAt: isEscalated ? new Date() : null,
        metadata: input.metadata || {},
      })
      .returning();

    // Trigger instant staff & manager escalation alert if escalated
    if (isEscalated) {
      this.dispatchEscalationAlerts(userId, ticket).catch((err) => {
        logger.warn(`[SupportTicket] Escalation alert dispatch failed for ${ticket.ticketNumber}: ${err.message}`);
      });
    }

    return ticket;
  }

  /**
   * Dispatch instant WhatsApp and/or Email alerts to Assigned Staff & Business Manager
   */
  static async dispatchEscalationAlerts(userId: string, ticket: SupportTicket, customNote?: string): Promise<{
    whatsappSent: boolean;
    emailSent: boolean;
  }> {
    let whatsappSent = false;
    let emailSent = false;

    try {
      const { ReviewComplaintAutomationService } = await import('./review-complaint-automation.service');
      const config = await ReviewComplaintAutomationService.getConfig(userId);

      // Collect recipient phone numbers (Assigned staff phone + Manager phones)
      const recipientPhones = new Set<string>();
      if (ticket.assignedStaffPhone) {
        recipientPhones.add(this.normalizePhone(ticket.assignedStaffPhone));
      }
      if (config.managerPhones) {
        config.managerPhones
          .split(/[,;\n]/)
          .map((p) => this.normalizePhone(p))
          .filter((p) => p.length >= 8)
          .forEach((p) => recipientPhones.add(p));
      }

      // Collect recipient emails (Assigned staff email + Manager emails + Account Owner)
      const recipientEmails = new Set<string>();
      if (ticket.assignedStaffEmail && ticket.assignedStaffEmail.includes('@')) {
        recipientEmails.add(ticket.assignedStaffEmail.trim());
      }
      if (config.managerEmails) {
        config.managerEmails
          .split(/[,;\n]/)
          .map((e) => e.trim())
          .filter((e) => e.includes('@'))
          .forEach((e) => recipientEmails.add(e));
      }
      if (recipientEmails.size === 0) {
        try {
          const [owner] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
          if (owner?.email) recipientEmails.add(owner.email);
        } catch (_) {}
      }

      const timeStr = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
      const channelLabel = ticket.channel.replace('_', ' ').toUpperCase();
      const priorityEmoji = ticket.priority === 'urgent' ? '🔴 URGENT' : ticket.priority === 'high' ? '🟠 HIGH' : '🟡 MEDIUM';

      // 1. WhatsApp Alert Text
      const waMessage =
        `🚨 *SUPPORT TICKET ESCALATION — #${ticket.ticketNumber}*\n\n` +
        `Customer complaint / unresolved issue requires human intervention.\n\n` +
        `👤 *Customer:* ${ticket.customerName}\n` +
        `📞 *Phone:* ${ticket.customerPhone}\n` +
        `🏷️ *Category:* ${ticket.category.replace('_', ' ').toUpperCase()}\n` +
        `⚡ *Priority:* ${priorityEmoji}\n` +
        `📡 *Channel:* ${channelLabel}\n` +
        `⏰ *Time:* ${timeStr}\n` +
        (ticket.assignedStaffName ? `👨‍💼 *Assigned To:* ${ticket.assignedStaffName}\n` : '') +
        (customNote ? `\n📌 *Manager Note:* ${customNote}\n` : '') +
        `\n📝 *Issue Summary:* ${ticket.subject}\n` +
        (ticket.aiSummary ? `\n🔍 *AI Notes:* ${ticket.aiSummary.slice(0, 400)}\n` : '') +
        `\n👉 *View in CRM:* https://calliqoai.com/app/crm`;

      for (const phone of recipientPhones) {
        try {
          const { metaWhatsAppService } = await import('../../plugins/messaging/services/meta-whatsapp.service');
          await metaWhatsAppService.sendReply(userId, phone, waMessage);
          whatsappSent = true;
        } catch (err: any) {
          logger.warn(`[SupportTicket] WhatsApp alert to ${phone} failed: ${err.message}`);
        }
      }

      // 2. Email Alert
      const emailSubject = `🚨 Support Ticket #${ticket.ticketNumber} [${ticket.priority.toUpperCase()}]: ${ticket.customerName}`;
      const emailHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;background:#0f172a;color:#f8fafc;padding:24px;">
  <div style="max-width:600px;margin:0 auto;background:#1e293b;border-radius:14px;border:1px solid #334155;overflow:hidden;">
    <div style="background:linear-gradient(135deg,#dc2626,#ea580c);padding:24px;text-align:center;">
      <h1 style="color:#ffffff;margin:0;font-size:22px;">Support Ticket #${ticket.ticketNumber} Escalation</h1>
      <p style="color:#fecaca;margin:6px 0 0;font-size:13px;">Customer complaint requires immediate team review</p>
    </div>
    <div style="padding:24px;font-size:14px;line-height:1.6;color:#cbd5e1;">
      <table style="width:100%;border-collapse:collapse;margin-bottom:18px;">
        <tr><td style="padding:6px 0;color:#94a3b8;width:35%;">Customer:</td><td style="font-weight:600;color:#f8fafc;">${ticket.customerName}</td></tr>
        <tr><td style="padding:6px 0;color:#94a3b8;">Phone:</td><td style="font-weight:600;color:#38bdf8;">${ticket.customerPhone}</td></tr>
        <tr><td style="padding:6px 0;color:#94a3b8;">Channel:</td><td>${channelLabel}</td></tr>
        <tr><td style="padding:6px 0;color:#94a3b8;">Category:</td><td>${ticket.category.replace('_', ' ')}</td></tr>
        <tr><td style="padding:6px 0;color:#94a3b8;">Priority:</td><td style="color:#f87171;font-weight:700;">${ticket.priority.toUpperCase()}</td></tr>
        ${ticket.assignedStaffName ? `<tr><td style="padding:6px 0;color:#94a3b8;">Assigned Staff:</td><td>${ticket.assignedStaffName}</td></tr>` : ''}
      </table>
      <div style="background:#0f172a;padding:14px;border-radius:8px;border:1px solid #334155;margin-bottom:18px;">
        <p style="margin:0 0 6px;color:#94a3b8;font-size:12px;text-transform:uppercase;font-weight:700;">Issue Description:</p>
        <p style="margin:0;color:#f1f5f9;">${ticket.subject}</p>
        ${ticket.aiSummary ? `<p style="margin:10px 0 0;font-size:13px;color:#94a3b8;">${ticket.aiSummary}</p>` : ''}
      </div>
      <div style="text-align:center;margin:24px 0 10px;">
        <a href="https://calliqoai.com/app/crm" style="display:inline-block;background:#38bdf8;color:#0f172a;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;">Open CRM & Resolve Ticket</a>
      </div>
    </div>
  </div>
</body></html>`;

      if (recipientEmails.size > 0) {
        try {
          const { emailService } = await import('./email-service');
          for (const email of recipientEmails) {
            const res = await emailService.sendEmail(email, emailSubject, emailHtml, undefined, { userId });
            if (res?.success) emailSent = true;
          }
        } catch (err: any) {
          logger.warn(`[SupportTicket] Email alert failed: ${err.message}`);
        }
      }

      // Update ticket escalation flags
      await db
        .update(supportTickets)
        .set({
          escalated: true,
          escalatedAt: new Date(),
          escalationSentWhatsapp: whatsappSent,
          escalationSentEmail: emailSent,
          updatedAt: new Date(),
        })
        .where(eq(supportTickets.id, ticket.id));
    } catch (err: any) {
      logger.warn(`[SupportTicket] dispatchEscalationAlerts error: ${err.message}`);
    }

    return { whatsappSent, emailSent };
  }

  /**
   * Hook: Auto-create Support Ticket from a completed voice call if negative sentiment or complaint keywords detected
   */
  static async autoCreateFromCall(
    callData: {
      id: string;
      userId: string;
      phoneNumber?: string | null;
      fromNumber?: string | null;
      toNumber?: string | null;
      callDirection?: string;
      duration?: number | null;
      aiSummary?: string | null;
      sentiment?: string | null;
      firstName?: string | null;
      lastName?: string | null;
      metadata?: Record<string, unknown> | null;
    },
    detection: { isComplaint: boolean; reason: string; matchedKeywords: string[] }
  ): Promise<SupportTicket | null> {
    try {
      if (!detection.isComplaint || !callData?.id || !callData?.userId) return null;
      await this.ensureTable();

      // Check if ticket already exists for this call
      const [existing] = await db
        .select()
        .from(supportTickets)
        .where(and(eq(supportTickets.userId, callData.userId), eq(supportTickets.sourceId, callData.id)))
        .limit(1);
      if (existing) return existing;

      const meta = (callData.metadata || {}) as any;
      const isIncoming = String(callData.callDirection || '').toLowerCase().startsWith('in');
      const phone =
        (meta.customerPhone as string) ||
        (isIncoming ? callData.fromNumber : callData.toNumber) ||
        callData.phoneNumber ||
        '';
      if (!phone) return null;

      const customerName =
        [callData.firstName, callData.lastName].filter(Boolean).join(' ').trim() ||
        (meta.customerName as string) ||
        (meta.contactName as string) ||
        'Customer';

      // Determine category from keywords
      const kw = detection.matchedKeywords.join(' ').toLowerCase();
      let category: CreateSupportTicketInput['category'] = 'service_complaint';
      if (kw.includes('refund') || kw.includes('payment') || kw.includes('bill') || kw.includes('charge')) {
        category = 'billing_refund';
      } else if (kw.includes('cancel') || kw.includes('appointment') || kw.includes('booking') || kw.includes('slot')) {
        category = 'appointment_issue';
      } else if (kw.includes('manager') || kw.includes('senior') || kw.includes('human') || kw.includes('agent')) {
        category = 'escalation_request';
      }

      const priority =
        callData.sentiment === 'angry' || kw.includes('cheat') || kw.includes('fraud') || kw.includes('police')
          ? 'urgent'
          : 'high';

      const subject = `AI Call Complaint: ${detection.reason.slice(0, 180)}`;
      const aiSummary = callData.aiSummary || `Call sentiment: ${callData.sentiment || 'negative'}. Matched triggers: ${detection.matchedKeywords.join(', ')}`;

      return await this.createTicket(callData.userId, {
        customerName,
        customerPhone: phone,
        customerEmail: meta.email || meta.customerEmail,
        channel: 'voice_call',
        sourceId: callData.id,
        category,
        priority,
        subject,
        description: `Customer expressed issue during AI voice call.\nReason: ${detection.reason}\nDuration: ${callData.duration || 0}s`,
        aiSummary,
        sentiment: callData.sentiment || 'negative',
        escalated: true,
        metadata: {
          callId: callData.id,
          matchedKeywords: detection.matchedKeywords,
          recordingUrl: meta.recordingUrl,
        },
      });
    } catch (err: any) {
      logger.warn(`[SupportTicket] autoCreateFromCall error: ${err.message}`);
      return null;
    }
  }

  /**
   * Hook: Auto-create Support Ticket from 2-way WhatsApp Bot when human handover is requested
   */
  static async autoCreateFromWhatsApp(params: {
    userId: string;
    contactPhone: string;
    contactName?: string | null;
    messageText: string;
    reason?: string | null;
    conversationId?: string;
  }): Promise<SupportTicket | null> {
    try {
      await this.ensureTable();
      const { userId, contactPhone, contactName, messageText, reason, conversationId } = params;

      // De-duplicate recent open ticket for same phone in last 2 hours
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const [recent] = await db
        .select()
        .from(supportTickets)
        .where(
          and(
            eq(supportTickets.userId, userId),
            eq(supportTickets.customerPhone, this.normalizePhone(contactPhone)),
            eq(supportTickets.status, 'open'),
            sql`${supportTickets.createdAt} >= ${twoHoursAgo}`
          )
        )
        .limit(1);

      if (recent) return recent;

      const lower = messageText.toLowerCase();
      let category: CreateSupportTicketInput['category'] = 'escalation_request';
      if (lower.includes('refund') || lower.includes('payment') || lower.includes('bill')) {
        category = 'billing_refund';
      } else if (lower.includes('complaint') || lower.includes('bad') || lower.includes('worst') || lower.includes('issue')) {
        category = 'service_complaint';
      }

      return await this.createTicket(userId, {
        customerName: contactName || 'WhatsApp Contact',
        customerPhone: contactPhone,
        channel: 'whatsapp',
        sourceId: conversationId,
        category,
        priority: 'high',
        subject: `WhatsApp Handover: ${reason || 'Human agent requested'}`,
        description: `Customer requested human staff on WhatsApp chat.\nLatest message:\n"${messageText}"`,
        aiSummary: `WhatsApp Handover Trigger: ${reason || 'Customer asked to talk to someone'}.`,
        sentiment: 'neutral',
        escalated: true,
        metadata: { conversationId, lastMessage: messageText },
      });
    } catch (err: any) {
      logger.warn(`[SupportTicket] autoCreateFromWhatsApp error: ${err.message}`);
      return null;
    }
  }

  /**
   * List support tickets with rich filtering, search and pagination
   */
  static async listTickets(userId: string, filter: SupportTicketFilter = {}): Promise<{
    tickets: SupportTicket[];
    total: number;
    openCount: number;
  }> {
    await this.ensureTable();

    const conditions = [eq(supportTickets.userId, userId)];

    if (filter.status && filter.status !== 'all') {
      conditions.push(eq(supportTickets.status, filter.status));
    }
    if (filter.priority && filter.priority !== 'all') {
      conditions.push(eq(supportTickets.priority, filter.priority));
    }
    if (filter.category && filter.category !== 'all') {
      conditions.push(eq(supportTickets.category, filter.category));
    }
    if (filter.channel && filter.channel !== 'all') {
      conditions.push(eq(supportTickets.channel, filter.channel));
    }
    if (filter.search && filter.search.trim()) {
      const q = `%${filter.search.trim()}%`;
      conditions.push(
        or(
          ilike(supportTickets.ticketNumber, q),
          ilike(supportTickets.customerName, q),
          ilike(supportTickets.customerPhone, q),
          ilike(supportTickets.subject, q)
        )!
      );
    }

    const whereClause = and(...conditions);
    const limit = Math.min(filter.limit || 50, 100);
    const offset = filter.offset || 0;

    const [rows, countRes, openCountRes] = await Promise.all([
      db
        .select()
        .from(supportTickets)
        .where(whereClause)
        .orderBy(desc(supportTickets.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(supportTickets)
        .where(whereClause),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(supportTickets)
        .where(and(eq(supportTickets.userId, userId), or(eq(supportTickets.status, 'open'), eq(supportTickets.status, 'in_progress')))),
    ]);

    return {
      tickets: rows,
      total: countRes[0]?.count || 0,
      openCount: openCountRes[0]?.count || 0,
    };
  }

  /**
   * Get single ticket by ID
   */
  static async getTicketById(userId: string, ticketId: string): Promise<SupportTicket | null> {
    await this.ensureTable();
    const [t] = await db
      .select()
      .from(supportTickets)
      .where(and(eq(supportTickets.id, ticketId), eq(supportTickets.userId, userId)))
      .limit(1);
    return t || null;
  }

  /**
   * Update support ticket status, assignment or resolution notes
   */
  static async updateTicket(
    userId: string,
    ticketId: string,
    updates: {
      status?: 'open' | 'in_progress' | 'resolved' | 'closed';
      priority?: 'low' | 'medium' | 'high' | 'urgent';
      category?: string;
      assignedStaffId?: string | null;
      resolutionNotes?: string;
      resolvedBy?: string;
    }
  ): Promise<SupportTicket | null> {
    await this.ensureTable();

    let assignedStaffName: string | undefined;
    let assignedStaffPhone: string | undefined;
    let assignedStaffEmail: string | undefined;

    if (updates.assignedStaffId) {
      try {
        const [staff] = await db
          .select()
          .from(salesTeamMembers)
          .where(and(eq(salesTeamMembers.id, updates.assignedStaffId), eq(salesTeamMembers.userId, userId)))
          .limit(1);
        if (staff) {
          assignedStaffName = staff.name;
          assignedStaffPhone = staff.phone;
          assignedStaffEmail = staff.email || undefined;
        }
      } catch (_) {}
    }

    const isResolving = updates.status === 'resolved' || updates.status === 'closed';

    const patch: any = {
      ...(updates.status ? { status: updates.status } : {}),
      ...(updates.priority ? { priority: updates.priority } : {}),
      ...(updates.category ? { category: updates.category } : {}),
      ...(updates.resolutionNotes !== undefined ? { resolutionNotes: updates.resolutionNotes } : {}),
      ...(updates.assignedStaffId !== undefined ? { assignedStaffId: updates.assignedStaffId } : {}),
      ...(assignedStaffName ? { assignedStaffName } : {}),
      ...(assignedStaffPhone ? { assignedStaffPhone } : {}),
      ...(assignedStaffEmail ? { assignedStaffEmail } : {}),
      ...(isResolving
        ? {
            resolvedAt: new Date(),
            resolvedBy: updates.resolvedBy || 'Human Staff',
            resolutionSource: 'human_staff',
          }
        : {}),
      updatedAt: new Date(),
    };

    const [updated] = await db
      .update(supportTickets)
      .set(patch)
      .where(and(eq(supportTickets.id, ticketId), eq(supportTickets.userId, userId)))
      .returning();

    return updated || null;
  }

  /**
   * 1-Click Manual Re-Escalate Ticket (sends instant WhatsApp & Email to staff/manager)
   */
  static async reEscalateTicket(userId: string, ticketId: string, customNote?: string): Promise<SupportTicket | null> {
    const ticket = await this.getTicketById(userId, ticketId);
    if (!ticket) return null;

    await this.dispatchEscalationAlerts(userId, ticket, customNote);
    return await this.getTicketById(userId, ticketId);
  }

  /**
   * Delete ticket
   */
  static async deleteTicket(userId: string, ticketId: string): Promise<boolean> {
    await this.ensureTable();
    const res = await db
      .delete(supportTickets)
      .where(and(eq(supportTickets.id, ticketId), eq(supportTickets.userId, userId)))
      .returning();
    return res.length > 0;
  }

  /**
   * Compute Resolution Rate Dashboard Metrics (Section 3 KPI Tracker)
   */
  static async getMetrics(userId: string): Promise<SupportMetrics> {
    await this.ensureTable();

    try {
      const [ticketStatsRes, callStatsRes, categoryRes, channelRes] = await Promise.all([
        db.execute(sql`
          SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'open')::int AS open_cnt,
            COUNT(*) FILTER (WHERE status = 'in_progress')::int AS in_progress_cnt,
            COUNT(*) FILTER (WHERE status IN ('resolved', 'closed'))::int AS resolved_cnt,
            COUNT(*) FILTER (WHERE escalated = true)::int AS escalated_cnt,
            COUNT(*) FILTER (WHERE priority = 'urgent' AND status IN ('open', 'in_progress'))::int AS urgent_pending,
            AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600) FILTER (WHERE resolved_at IS NOT NULL) AS avg_res_hours
          FROM support_tickets
          WHERE user_id = ${userId}
        `),
        db.execute(sql`
          SELECT COUNT(*)::int AS total_calls FROM plivo_calls WHERE user_id = ${userId}
        `),
        db.execute(sql`
          SELECT category, COUNT(*)::int AS cnt FROM support_tickets WHERE user_id = ${userId} GROUP BY category
        `),
        db.execute(sql`
          SELECT channel, COUNT(*)::int AS cnt FROM support_tickets WHERE user_id = ${userId} GROUP BY channel
        `),
      ]);

      const tStats = (ticketStatsRes as any)?.rows?.[0] || {};
      const totalTickets = Number(tStats.total || 0);
      const openTickets = Number(tStats.open_cnt || 0);
      const inProgressTickets = Number(tStats.in_progress_cnt || 0);
      const resolvedTickets = Number(tStats.resolved_cnt || 0);
      const escalatedCount = Number(tStats.escalated_cnt || 0);
      const urgentPendingCount = Number(tStats.urgent_pending || 0);
      const avgResolutionHours = Number(Number(tStats.avg_res_hours || 0).toFixed(1));

      const totalCalls = Number((callStatsRes as any)?.rows?.[0]?.total_calls || 0);
      // Total customer inquiries = Total Calls + WhatsApp tickets
      const totalCustomerQueries = Math.max(totalCalls + totalTickets, totalTickets || 1);

      // AI Auto-Resolved = Total Customer Inquiries minus Escalated Tickets
      const aiAutoResolvedCount = Math.max(totalCustomerQueries - escalatedCount, 0);
      const humanResolvedCount = resolvedTickets;

      // AI Resolution Rate %
      const aiResolutionRate = totalCustomerQueries > 0
        ? Number(((aiAutoResolvedCount / totalCustomerQueries) * 100).toFixed(1))
        : 100;

      const categoryBreakdown: Record<string, number> = {};
      for (const r of (categoryRes as any)?.rows || []) {
        categoryBreakdown[r.category] = Number(r.cnt || 0);
      }

      const channelBreakdown: Record<string, number> = {};
      for (const r of (channelRes as any)?.rows || []) {
        channelBreakdown[r.channel] = Number(r.cnt || 0);
      }

      return {
        totalTickets,
        openTickets,
        inProgressTickets,
        resolvedTickets,
        escalatedCount,
        aiAutoResolvedCount,
        humanResolvedCount,
        aiResolutionRate,
        totalCustomerQueries,
        avgResolutionHours,
        categoryBreakdown,
        channelBreakdown,
        urgentPendingCount,
      };
    } catch (err: any) {
      logger.warn(`[SupportTicket] getMetrics error: ${err.message}`);
      return {
        totalTickets: 0,
        openTickets: 0,
        inProgressTickets: 0,
        resolvedTickets: 0,
        escalatedCount: 0,
        aiAutoResolvedCount: 0,
        humanResolvedCount: 0,
        aiResolutionRate: 100,
        totalCustomerQueries: 0,
        avgResolutionHours: 0,
        categoryBreakdown: {},
        channelBreakdown: {},
        urgentPendingCount: 0,
      };
    }
  }
}
