import { db } from '../db';
import { sql, eq, and, desc } from 'drizzle-orm';
import {
  leads,
  appointments,
  agents,
  plivoCalls,
  calls,
  knowledgeBase,
  crmWhitelabelConfigs,
  userEmailTemplates,
  users,
} from '@shared/schema';
import { emailService } from './email-service';

export interface WhatsAppAiBotConfig {
  enabled: boolean;
  defaultAgentId: string; // 'default' or specific agent UUID
  useCallMemory: boolean;
  useKnowledgeBase: boolean;
  autoQualifyLeads: boolean;
  autoBookAppointments: boolean;
  autoHandoverOnHumanRequest: boolean;
  handoverKeywords: string;
  brochureUrl: string;
  brochureTitle: string;
  collectDocumentsPrompt: string;
  customBotInstructions: string;
  managerWhatsAppPhones: string;
  managerEmails: string;
  notifyManagerOnHandoverWhatsApp: boolean;
  notifyManagerOnHandoverEmail: boolean;
  notifyManagerOnHotLead: boolean;
}

export interface WhatsAppBotActivityLog {
  id: string;
  timestamp: string;
  conversationId: string;
  contactPhone: string;
  contactName: string;
  customerMessage: string;
  aiReply: string;
  category: string;
  leadScore: number;
  sentiment: string;
  handoverTriggered: boolean;
  handoverReason?: string | null;
  usedCallMemory: boolean;
  appointmentBooked?: string | null;
  deliveryChannel: string;
}

export interface CrossChannelMemorySnapshot {
  phone: string;
  normalizedLast10: string;
  lead: {
    id: string;
    name: string;
    stage: string;
    aiCategory: string | null;
    leadScore: number | null;
    sentiment: string | null;
    aiSummary: string | null;
    aiNextAction: string | null;
    updatedAt: string;
  } | null;
  pastCalls: Array<{
    id: string;
    engine: string;
    direction: string;
    duration: number;
    summary: string | null;
    transcriptSnippet: string | null;
    sentiment: string | null;
    createdAt: string;
  }>;
  appointments: Array<{
    id: string;
    customerName: string;
    appointmentDate: string;
    appointmentTime: string;
    serviceName: string | null;
    status: string;
  }>;
  recentWhatsAppMessages: Array<{
    id: string;
    direction: string;
    senderType: string;
    content: string;
    createdAt: string;
  }>;
  unifiedContextPrompt: string;
}

const CONFIG_KEY = '__CRM_WHATSAPP_AI_BOT_CONFIG__';
const LOG_KEY = '__CRM_WHATSAPP_AI_BOT_LOG__';

const DEFAULT_CONFIG: WhatsAppAiBotConfig = {
  enabled: true,
  defaultAgentId: 'default',
  useCallMemory: true,
  useKnowledgeBase: true,
  autoQualifyLeads: true,
  autoBookAppointments: true,
  autoHandoverOnHumanRequest: true,
  handoverKeywords: 'human, manager, executive, agent, person, senior, complaint, refund, talk to someone, call me urgently',
  brochureUrl: '',
  brochureTitle: 'Company Brochure & Price List',
  collectDocumentsPrompt: 'If the customer wants to proceed with booking or verification, politely ask them to share their ID proof or relevant documents right here on WhatsApp.',
  customBotInstructions: 'Reply concisely in a warm, natural conversational tone (match customer language: English, Hinglish, or Hindi). Qualify the customer by understanding their requirement, budget/timeline, and preferred date/time for a consultation or site visit.',
  managerWhatsAppPhones: '',
  managerEmails: '',
  notifyManagerOnHandoverWhatsApp: true,
  notifyManagerOnHandoverEmail: true,
  notifyManagerOnHotLead: true,
};

export class WhatsAppAiBotService {
  private static processedMessageIds = new Set<string>();

  static normalizePhoneLast10(phone: string): string {
    const digits = (phone || '').replace(/\D/g, '');
    return digits.length >= 10 ? digits.slice(-10) : digits;
  }

  static async getConfig(userId: string): Promise<WhatsAppAiBotConfig> {
    try {
      const [row] = await db
        .select()
        .from(userEmailTemplates)
        .where(and(eq(userEmailTemplates.userId, userId), eq(userEmailTemplates.name, CONFIG_KEY)))
        .limit(1);
      if (row && row.designJson && typeof row.designJson === 'object') {
        return { ...DEFAULT_CONFIG, ...(row.designJson as Partial<WhatsAppAiBotConfig>) };
      }
    } catch (err: any) {
      console.warn('[WhatsAppAiBot] Error reading config:', err?.message);
    }
    return { ...DEFAULT_CONFIG };
  }

  static async saveConfig(userId: string, partial: Partial<WhatsAppAiBotConfig>): Promise<WhatsAppAiBotConfig> {
    const current = await this.getConfig(userId);
    const updated: WhatsAppAiBotConfig = {
      ...current,
      ...partial,
    };

    const [existing] = await db
      .select({ id: userEmailTemplates.id })
      .from(userEmailTemplates)
      .where(and(eq(userEmailTemplates.userId, userId), eq(userEmailTemplates.name, CONFIG_KEY)))
      .limit(1);

    if (existing) {
      await db
        .update(userEmailTemplates)
        .set({ designJson: updated as any, updatedAt: new Date() })
        .where(eq(userEmailTemplates.id, existing.id));
    } else {
      await db.insert(userEmailTemplates).values({
        userId,
        name: CONFIG_KEY,
        subject: 'WhatsApp AI Bot Config',
        htmlBody: 'JSON_CONFIG',
        variables: [],
        isActive: false,
        designJson: updated as any,
      });
    }
    return updated;
  }

  static async getLogs(userId: string): Promise<WhatsAppBotActivityLog[]> {
    try {
      const [row] = await db
        .select()
        .from(userEmailTemplates)
        .where(and(eq(userEmailTemplates.userId, userId), eq(userEmailTemplates.name, LOG_KEY)))
        .limit(1);
      const data = row?.designJson as any;
      if (Array.isArray(data)) return data;
      if (data && Array.isArray(data.logs)) return data.logs;
    } catch (err: any) {
      console.warn('[WhatsAppAiBot] Error reading logs:', err?.message);
    }
    return [];
  }

  static async appendLog(userId: string, entry: WhatsAppBotActivityLog): Promise<void> {
    try {
      const current = await this.getLogs(userId);
      const updated = [entry, ...current].slice(0, 80);

      const [existing] = await db
        .select({ id: userEmailTemplates.id })
        .from(userEmailTemplates)
        .where(and(eq(userEmailTemplates.userId, userId), eq(userEmailTemplates.name, LOG_KEY)))
        .limit(1);

      if (existing) {
        await db
          .update(userEmailTemplates)
          .set({ designJson: { logs: updated } as any, updatedAt: new Date() })
          .where(eq(userEmailTemplates.id, existing.id));
      } else {
        await db.insert(userEmailTemplates).values({
          userId,
          name: LOG_KEY,
          subject: 'WhatsApp AI Bot Logs',
          htmlBody: 'JSON_LOGS',
          variables: [],
          isActive: false,
          designJson: { logs: updated } as any,
        });
      }
    } catch (err: any) {
      console.warn('[WhatsAppAiBot] Error appending log:', err?.message);
    }
  }

  /**
   * Build Unified Cross-Channel Memory for a phone number across:
   * 1. CRM Leads (leadScore, stage, aiSummary, customFields)
   * 2. Past Voice Calls (plivo_calls & calls)
   * 3. Scheduled / Completed Appointments (appointments)
   * 4. Recent WhatsApp Messages (whatsapp_messages)
   */
  static async getCrossChannelMemory(userId: string, phone: string): Promise<CrossChannelMemorySnapshot> {
    const last10 = this.normalizePhoneLast10(phone);
    const snapshot: CrossChannelMemorySnapshot = {
      phone,
      normalizedLast10: last10,
      lead: null,
      pastCalls: [],
      appointments: [],
      recentWhatsAppMessages: [],
      unifiedContextPrompt: '',
    };

    if (!last10 || last10.length < 7) {
      return snapshot;
    }

    const likePattern = `%${last10}`;

    // 1. Lead record
    try {
      const leadRes = await db.execute(sql`
        SELECT id, first_name, last_name, stage, ai_category, lead_score, sentiment, ai_summary, ai_next_action, updated_at
        FROM leads
        WHERE user_id = ${userId} AND REGEXP_REPLACE(phone, '[^0-9]', '', 'g') LIKE ${likePattern}
        ORDER BY updated_at DESC
        LIMIT 1
      `);
      const leadRows = (leadRes as any)?.rows || [];
      if (leadRows.length > 0) {
        const l = leadRows[0];
        snapshot.lead = {
          id: l.id,
          name: [l.first_name, l.last_name].filter(Boolean).join(' ').trim() || 'Customer',
          stage: l.stage || 'new',
          aiCategory: l.ai_category || null,
          leadScore: l.lead_score ?? null,
          sentiment: l.sentiment || null,
          aiSummary: l.ai_summary || null,
          aiNextAction: l.ai_next_action || null,
          updatedAt: l.updated_at ? new Date(l.updated_at).toISOString() : new Date().toISOString(),
        };
      }
    } catch (_) {}

    // 2. Past Voice Calls (plivo_calls + calls)
    try {
      const plivoRes = await db.execute(sql`
        SELECT id, call_direction, duration, ai_summary, transcript, sentiment, created_at
        FROM plivo_calls
        WHERE user_id = ${userId}
          AND (
            REGEXP_REPLACE(COALESCE(from_number, ''), '[^0-9]', '', 'g') LIKE ${likePattern}
            OR REGEXP_REPLACE(COALESCE(to_number, ''), '[^0-9]', '', 'g') LIKE ${likePattern}
          )
        ORDER BY created_at DESC
        LIMIT 3
      `);
      for (const r of ((plivoRes as any)?.rows || [])) {
        snapshot.pastCalls.push({
          id: r.id,
          engine: 'plivo',
          direction: r.call_direction || 'outbound',
          duration: Number(r.duration || 0),
          summary: r.ai_summary || null,
          transcriptSnippet: r.transcript ? String(r.transcript).slice(0, 500) : null,
          sentiment: r.sentiment || null,
          createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
        });
      }
    } catch (_) {}

    try {
      const elRes = await db.execute(sql`
        SELECT id, call_direction, duration, ai_summary, transcript, sentiment, created_at
        FROM calls
        WHERE user_id = ${userId}
          AND REGEXP_REPLACE(COALESCE(phone_number, ''), '[^0-9]', '', 'g') LIKE ${likePattern}
        ORDER BY created_at DESC
        LIMIT 3
      `);
      for (const r of ((elRes as any)?.rows || [])) {
        snapshot.pastCalls.push({
          id: r.id,
          engine: 'elevenlabs',
          direction: r.call_direction || 'outbound',
          duration: Number(r.duration || 0),
          summary: r.ai_summary || null,
          transcriptSnippet: r.transcript ? String(r.transcript).slice(0, 500) : null,
          sentiment: r.sentiment || null,
          createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
        });
      }
    } catch (_) {}

    snapshot.pastCalls.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    snapshot.pastCalls = snapshot.pastCalls.slice(0, 3);

    // 3. Appointments
    try {
      const apptRes = await db.execute(sql`
        SELECT id, contact_name, appointment_date, appointment_time, service_name, status
        FROM appointments
        WHERE user_id = ${userId}
          AND REGEXP_REPLACE(COALESCE(contact_phone, ''), '[^0-9]', '', 'g') LIKE ${likePattern}
        ORDER BY created_at DESC
        LIMIT 3
      `);
      for (const a of ((apptRes as any)?.rows || [])) {
        snapshot.appointments.push({
          id: a.id,
          customerName: a.contact_name || 'Customer',
          appointmentDate: String(a.appointment_date || ''),
          appointmentTime: String(a.appointment_time || ''),
          serviceName: a.service_name || null,
          status: a.status || 'scheduled',
        });
      }
    } catch (_) {}

    // 4. Recent WhatsApp Messages
    try {
      const waRes = await db.execute(sql`
        SELECT m.id, m.direction, m.sender_type, m.content, m.created_at
        FROM whatsapp_messages m
        INNER JOIN whatsapp_conversations c ON c.id = m.conversation_id
        WHERE m.user_id = ${userId}
          AND REGEXP_REPLACE(COALESCE(c.contact_phone, ''), '[^0-9]', '', 'g') LIKE ${likePattern}
        ORDER BY m.created_at DESC
        LIMIT 12
      `);
      const rows = ((waRes as any)?.rows || []).reverse();
      for (const m of rows) {
        snapshot.recentWhatsAppMessages.push({
          id: m.id,
          direction: m.direction,
          senderType: m.sender_type,
          content: m.content || '',
          createdAt: m.created_at ? new Date(m.created_at).toISOString() : new Date().toISOString(),
        });
      }
    } catch (_) {}

    // Build unified prompt snippet
    const parts: string[] = [];
    if (snapshot.lead) {
      parts.push(
        `CRM Lead Record: Name=${snapshot.lead.name}, Stage=${snapshot.lead.stage}, Category=${snapshot.lead.aiCategory || 'N/A'}, Score=${snapshot.lead.leadScore ?? 'N/A'}/100.`
      );
      if (snapshot.lead.aiSummary) {
        parts.push(`CRM AI Summary (Call + Chat Memory): ${snapshot.lead.aiSummary}`);
      }
    }
    if (snapshot.pastCalls.length > 0) {
      const callNotes = snapshot.pastCalls.map((c, idx) => {
        const dateStr = new Date(c.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
        return `Call #${idx + 1} (${dateStr}, ${c.direction}, ${c.duration}s): ${c.summary || c.transcriptSnippet || 'Call connected'}`;
      });
      parts.push(`Past Phone Calls with Customer:\n${callNotes.join('\n')}`);
    }
    if (snapshot.appointments.length > 0) {
      const apptNotes = snapshot.appointments.map(
        (a) => `${a.appointmentDate} at ${a.appointmentTime} (${a.serviceName || 'Appointment'}) — Status: ${a.status}`
      );
      parts.push(`Appointments on File:\n${apptNotes.join('\n')}`);
    }

    snapshot.unifiedContextPrompt =
      parts.length > 0
        ? parts.join('\n\n')
        : 'No prior phone calls or CRM records found for this phone number.';

    return snapshot;
  }

  /**
   * List recent WhatsApp conversations enriched with AI Bot mode, CRM qualification & Call Memory status
   */
  static async getConversationsWithBotStatus(userId: string): Promise<any[]> {
    try {
      const res = await db.execute(sql`
        SELECT id, contact_phone, contact_name, status, assigned_agent_id, auto_reply_enabled,
               window_expires_at, unread_count, last_message_at, last_message_preview, created_at
        FROM whatsapp_conversations
        WHERE user_id = ${userId}
        ORDER BY COALESCE(last_message_at, created_at) DESC
        LIMIT 50
      `);
      const rows = (res as any)?.rows || [];
      const enriched = [];

      for (const r of rows) {
        const last10 = this.normalizePhoneLast10(r.contact_phone || '');
        let leadInfo: any = null;
        let callCount = 0;

        if (last10.length >= 7) {
          const likePattern = `%${last10}`;
          try {
            const leadRes = await db.execute(sql`
              SELECT id, first_name, last_name, stage, ai_category, lead_score, sentiment, ai_summary, has_transfer
              FROM leads
              WHERE user_id = ${userId} AND REGEXP_REPLACE(phone, '[^0-9]', '', 'g') LIKE ${likePattern}
              ORDER BY updated_at DESC
              LIMIT 1
            `);
            if ((leadRes as any)?.rows?.length > 0) {
              leadInfo = (leadRes as any).rows[0];
            }
            const callRes = await db.execute(sql`
              SELECT COUNT(*)::int AS cnt FROM plivo_calls
              WHERE user_id = ${userId}
                AND (
                  REGEXP_REPLACE(COALESCE(from_number, ''), '[^0-9]', '', 'g') LIKE ${likePattern}
                  OR REGEXP_REPLACE(COALESCE(to_number, ''), '[^0-9]', '', 'g') LIKE ${likePattern}
                )
            `);
            callCount = Number((callRes as any)?.rows?.[0]?.cnt || 0);
          } catch (_) {}
        }

        enriched.push({
          id: r.id,
          contactPhone: r.contact_phone,
          contactName: r.contact_name || (leadInfo ? [leadInfo.first_name, leadInfo.last_name].filter(Boolean).join(' ') : null) || r.contact_phone,
          status: r.status,
          assignedAgentId: r.assigned_agent_id,
          autoReplyEnabled: r.auto_reply_enabled !== false,
          windowExpiresAt: r.window_expires_at,
          unreadCount: r.unread_count || 0,
          lastMessageAt: r.last_message_at,
          lastMessagePreview: r.last_message_preview,
          lead: leadInfo
            ? {
                id: leadInfo.id,
                stage: leadInfo.stage,
                aiCategory: leadInfo.ai_category,
                leadScore: leadInfo.lead_score,
                sentiment: leadInfo.sentiment,
                aiSummary: leadInfo.ai_summary,
                hasTransfer: leadInfo.has_transfer,
              }
            : null,
          pastCallCount: callCount,
        });
      }
      return enriched;
    } catch (err: any) {
      console.warn('[WhatsAppAiBot] Error listing conversations:', err?.message);
      return [];
    }
  }

  /**
   * Toggle AI Bot vs Human Handover mode on a conversation
   */
  static async setConversationMode(
    userId: string,
    conversationId: string,
    autoReplyEnabled: boolean,
    reason?: string
  ): Promise<{ success: boolean }> {
    await db.execute(sql`
      UPDATE whatsapp_conversations
      SET auto_reply_enabled = ${autoReplyEnabled}, updated_at = NOW()
      WHERE id = ${conversationId} AND user_id = ${userId}
    `);
    return { success: true };
  }

  /**
   * Core handler for inbound WhatsApp messages (from live Meta webhook OR Interactive Simulator)
   */
  static async handleInboundWhatsAppMessage(params: {
    userId: string;
    conversationId?: string;
    contactPhone: string;
    contactName?: string;
    messageText: string;
    messageType?: string;
    metaMessageId?: string;
    isSimulation?: boolean;
    sendRealWhatsApp?: boolean;
  }): Promise<{
    handled: boolean;
    reason?: string;
    aiReply?: string;
    qualification?: any;
    handoverTriggered?: boolean;
    usedCallMemory?: boolean;
    conversationId?: string;
  }> {
    const {
      userId,
      contactPhone,
      contactName,
      messageText,
      messageType = 'text',
      metaMessageId,
      isSimulation = false,
      sendRealWhatsApp = false,
    } = params;

    if (metaMessageId) {
      if (this.processedMessageIds.has(metaMessageId)) {
        return { handled: false, reason: 'Duplicate message ID' };
      }
      this.processedMessageIds.add(metaMessageId);
      if (this.processedMessageIds.size > 2000) {
        const first = this.processedMessageIds.values().next().value;
        if (first) this.processedMessageIds.delete(first);
      }
    }

    const config = await this.getConfig(userId);
    if (!config.enabled && !isSimulation) {
      return { handled: false, reason: 'WhatsApp AI Bot is disabled globally' };
    }

    const { whatsAppConversationService } = await import('../../plugins/messaging/services/whatsapp-conversation.service');

    // Ensure conversation exists
    let conversationId = params.conversationId;
    let conversation: any = null;
    if (conversationId) {
      conversation = await whatsAppConversationService.getConversation(userId, conversationId);
    }
    if (!conversation) {
      conversation = await whatsAppConversationService.getOrCreateConversation(
        userId,
        contactPhone,
        contactName || undefined,
        contactPhone.replace(/[^0-9]/g, '')
      );
      conversationId = conversation.id;
    }

    // If this is a simulation, record the simulated inbound message in the conversation so it shows in history
    if (isSimulation) {
      await whatsAppConversationService.refreshWindow(conversation.id);
      await whatsAppConversationService.addMessage({
        conversationId: conversation.id,
        userId,
        direction: 'inbound',
        senderType: 'customer',
        messageType: messageType || 'text',
        content: messageText,
        metadata: { simulated: true },
      });
    }

    // Check if conversation is in Human Hand-over mode (autoReplyEnabled === false)
    if (conversation.autoReplyEnabled === false && !isSimulation) {
      console.log(`[WhatsAppAiBot] Conversation ${conversation.id} is in Human Hand-over mode (autoReplyEnabled=false). Skipping AI reply.`);
      return { handled: false, reason: 'Conversation is assigned to Human Hand-over', conversationId: conversation.id };
    }

    // Load Business Name & Selected Agent Prompt
    let businessName = 'Our Business';
    try {
      const [wl] = await db
        .select({ businessName: crmWhitelabelConfigs.businessName })
        .from(crmWhitelabelConfigs)
        .where(eq(crmWhitelabelConfigs.userId, userId))
        .limit(1);
      if (wl?.businessName) businessName = wl.businessName;
    } catch (_) {}

    let agentPrompt = `You are a helpful, polite AI Sales & Support Assistant for ${businessName}.`;
    try {
      if (config.defaultAgentId && config.defaultAgentId !== 'default') {
        const [ag] = await db
          .select()
          .from(agents)
          .where(and(eq(agents.id, config.defaultAgentId), eq(agents.userId, userId)))
          .limit(1);
        if (ag?.systemPrompt) {
          agentPrompt = ag.systemPrompt;
          if (ag.name && businessName === 'Our Business') businessName = ag.name;
        }
      } else {
        const [firstAgent] = await db
          .select()
          .from(agents)
          .where(eq(agents.userId, userId))
          .orderBy(desc(agents.createdAt))
          .limit(1);
        if (firstAgent?.systemPrompt) {
          agentPrompt = firstAgent.systemPrompt;
        }
      }
    } catch (_) {}

    // Load Knowledge Base (RAG) if enabled
    let knowledgeSnippet = '';
    if (config.useKnowledgeBase) {
      try {
        const kbItems = await db
          .select({ title: knowledgeBase.title, content: knowledgeBase.content })
          .from(knowledgeBase)
          .where(eq(knowledgeBase.userId, userId))
          .limit(5);
        const validKb = kbItems.filter((k) => k.content && k.content.trim().length > 0);
        if (validKb.length > 0) {
          knowledgeSnippet = validKb
            .map((k) => `### ${k.title}:\n${String(k.content).slice(0, 1200)}`)
            .join('\n\n');
        }
      } catch (_) {}
    }

    // Load Unified Cross-Channel Memory (Voice Calls + CRM + Appointments + Recent Chat)
    const memory = await this.getCrossChannelMemory(userId, contactPhone);
    const usedCallMemory = config.useCallMemory && (memory.pastCalls.length > 0 || Boolean(memory.lead?.aiSummary));

    // Check explicit keyword match for Human Hand-over
    const lowerMsg = (messageText || '').toLowerCase();
    const keywordList = (config.handoverKeywords || '')
      .split(',')
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);
    const matchedKeyword = config.autoHandoverOnHumanRequest
      ? keywordList.find((kw) => kw.length >= 3 && lowerMsg.includes(kw))
      : undefined;

    // Format recent chat history
    const chatTranscript = memory.recentWhatsAppMessages
      .map((m) => `${m.direction === 'inbound' ? 'Customer' : 'AI/Staff'}: ${m.content}`)
      .join('\n');

    // Today's date in IST for accurate appointment booking
    const todayIst = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

    // Call OpenAI gpt-4o-mini for intelligent 2-Way reply + CRM Qualification + Hand-over decision
    let aiResult: {
      reply: string;
      customerName: string | null;
      requirement: string | null;
      budgetOrPreference: string | null;
      category: 'hot' | 'warm' | 'cold' | 'appointment_booked' | 'call_transfer';
      leadScore: number;
      sentiment: 'positive' | 'neutral' | 'negative';
      summary: string;
      nextAction: string;
      appointmentBooked: { date: string; time: string; service: string } | null;
      needsHumanHandover: boolean;
      handoverReason: string | null;
    } | null = null;

    try {
      const dbApiKey = await db.execute(sql`
        SELECT value FROM global_settings WHERE key = 'openai_api_key' LIMIT 1
      `);
      let apiKey = (dbApiKey.rows[0]?.value as string) || process.env.OPENAI_API_KEY || '';
      if (typeof apiKey === 'string') {
        apiKey = apiKey.replace(/^"|"$/g, '').trim();
      }

      if (apiKey) {
        const { default: OpenAI } = await import('openai');
        const openai = new OpenAI({ apiKey });

        const systemInstruction = `You are a 2-Way Conversational WhatsApp AI Assistant for "${businessName}".
Today's Date (IST): ${todayIst}

=== CORE AGENT PERSONA ===
${agentPrompt}

=== WHATSAPP BOT INSTRUCTIONS ===
${config.customBotInstructions}
${config.brochureUrl ? `If the customer asks for a brochure, catalog, price list, or details PDF, share this link in your reply: ${config.brochureTitle ? `${config.brochureTitle}: ` : ''}${config.brochureUrl}` : ''}
${config.collectDocumentsPrompt ? `Document Collection Rule: ${config.collectDocumentsPrompt}` : ''}

${config.useCallMemory ? `=== UNIFIED CROSS-CHANNEL MEMORY (PRIOR PHONE CALLS & CRM RECORD) ===\n${memory.unifiedContextPrompt}\nIMPORTANT: If the customer had a previous phone call or appointment, naturally remember it and continue from where the phone call left off without asking repetitive questions!` : ''}

${knowledgeSnippet ? `=== APPROVED KNOWLEDGE BASE ===\n${knowledgeSnippet}` : ''}

=== HUMAN HAND-OVER RULES ===
Set "needsHumanHandover": true if:
1. The customer explicitly asks to speak with a human, manager, agent, or senior executive.
2. The customer is angry, frustrated, or raising a serious billing/refund complaint that requires human intervention.
3. Matched handover keyword: ${matchedKeyword ? `"${matchedKeyword}" (TRIGGER HANDOVER)` : 'None'}

Respond ONLY with a valid JSON object matching this exact schema:
{
  "reply": "Your concise, friendly WhatsApp message (2-4 short lines, use WhatsApp-friendly formatting, match customer's language: English, Hinglish, or Hindi)",
  "customerName": "Extracted customer name if mentioned in chat or memory, else null",
  "requirement": "Customer's core requirement/product/service interest, else null",
  "budgetOrPreference": "Any budget, timeline, or preference shared, else null",
  "category": "hot" | "warm" | "cold" | "appointment_booked" | "call_transfer",
  "leadScore": 75,
  "sentiment": "positive" | "neutral" | "negative",
  "summary": "2-sentence unified summary combining prior call context and latest WhatsApp chat",
  "nextAction": "Recommended next step for sales team",
  "appointmentBooked": { "date": "YYYY-MM-DD", "time": "HH:MM AM/PM", "service": "Consultation / Site Visit" } or null,
  "needsHumanHandover": boolean,
  "handoverReason": "Reason for human handover if needsHumanHandover is true, else null"
}`;

        const userPrompt = `=== RECENT WHATSAPP CONVERSATION ===
${chatTranscript || '(New conversation)'}

=== LATEST CUSTOMER MESSAGE (${messageType}) ===
Customer (${contactName || contactPhone}): ${messageText}`;

        const completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemInstruction },
            { role: 'user', content: userPrompt },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.3,
        });

        const rawJson = completion.choices[0]?.message?.content;
        if (rawJson) {
          const parsed = JSON.parse(rawJson);
          aiResult = {
            reply: parsed.reply || `Thank you for messaging ${businessName}! How can I help you today?`,
            customerName: parsed.customerName || memory.lead?.name || contactName || null,
            requirement: parsed.requirement || null,
            budgetOrPreference: parsed.budgetOrPreference || null,
            category: parsed.category || 'warm',
            leadScore: typeof parsed.leadScore === 'number' ? Math.max(1, Math.min(100, parsed.leadScore)) : 65,
            sentiment: parsed.sentiment || 'neutral',
            summary: parsed.summary || `Customer messaged on WhatsApp: "${messageText.slice(0, 120)}"`,
            nextAction: parsed.nextAction || 'Follow up on WhatsApp',
            appointmentBooked: parsed.appointmentBooked && parsed.appointmentBooked.date ? parsed.appointmentBooked : null,
            needsHumanHandover: Boolean(parsed.needsHumanHandover || matchedKeyword),
            handoverReason: parsed.handoverReason || (matchedKeyword ? `Customer used handover keyword: "${matchedKeyword}"` : null),
          };
        }
      }
    } catch (aiErr: any) {
      console.warn('[WhatsAppAiBot] OpenAI call failed, using smart fallback:', aiErr?.message);
    }

    // Fallback if OpenAI was unavailable
    if (!aiResult) {
      const isHandover = Boolean(matchedKeyword);
      const asksBrochure = /brochure|pdf|price|detail|catalog|rate/i.test(messageText);
      let fallbackReply = `Hello${contactName ? ` ${contactName}` : ''}! Thank you for reaching out to *${businessName}*. `;
      if (isHandover) {
        fallbackReply = `I have connected your chat to our senior team member at *${businessName}*. A human executive will reply to you shortly with full details.`;
      } else if (asksBrochure && config.brochureUrl) {
        fallbackReply += `Here is our ${config.brochureTitle || 'brochure'}: ${config.brochureUrl}\n\nWould you like to schedule a consultation or site visit? Please share your preferred date and time.`;
      } else if (memory.pastCalls.length > 0) {
        fallbackReply += `Following up on our recent phone conversation, please let me know your preferred date & time for a visit or any questions you have!`;
      } else {
        fallbackReply += `Could you please share your requirement and preferred time for a quick consultation or site visit?`;
      }

      aiResult = {
        reply: fallbackReply,
        customerName: memory.lead?.name || contactName || null,
        requirement: messageText.slice(0, 140),
        budgetOrPreference: null,
        category: isHandover ? 'call_transfer' : 'warm',
        leadScore: isHandover ? 80 : 65,
        sentiment: 'neutral',
        summary: `WhatsApp inquiry from ${contactName || contactPhone}: "${messageText.slice(0, 120)}"`,
        nextAction: isHandover ? 'Human team member to respond immediately' : 'Continue WhatsApp qualification',
        appointmentBooked: null,
        needsHumanHandover: isHandover,
        handoverReason: isHandover ? `Matched keyword "${matchedKeyword}"` : null,
      };
    }

    // If Human Handover triggered, disable auto-reply on the conversation so human takes over
    if (aiResult.needsHumanHandover && config.autoHandoverOnHumanRequest) {
      aiResult.category = 'call_transfer';
      await whatsAppConversationService.setAutoReply(userId, conversation.id, false, null);
    }

    // Send the AI Reply via WhatsApp (unless it's an offline-only simulation)
    let deliveryChannel = isSimulation ? 'simulator' : 'none';
    let metaMsgId: string | undefined;

    if (!isSimulation || sendRealWhatsApp) {
      try {
        const { metaWhatsAppService } = await import('../../plugins/messaging/services/meta-whatsapp.service');
        const sendRes = await metaWhatsAppService.sendReply(userId, contactPhone, aiResult.reply, {
          agentId: config.defaultAgentId !== 'default' ? config.defaultAgentId : undefined,
          triggeredBy: 'whatsapp_ai_bot',
        });
        metaMsgId = sendRes?.messageId;
        deliveryChannel = 'meta_whatsapp';
      } catch (metaErr: any) {
        try {
          const { whatswayService } = await import('../../plugins/messaging/services/whatsway.service');
          const wwRes = await whatswayService.sendTextMessage(userId, contactPhone, aiResult.reply, {
            triggeredBy: 'whatsapp_ai_bot',
          });
          metaMsgId = wwRes?.messageId;
          deliveryChannel = 'whatsway';
        } catch (wwErr: any) {
          console.warn('[WhatsAppAiBot] Live WhatsApp send skipped/failed:', metaErr?.message);
          if (!isSimulation) deliveryChannel = `logged_only (${metaErr?.message || 'provider error'})`;
        }
      }
    }

    // Store outbound AI reply in whatsapp_messages so it appears in the WhatsApp Conversations UI
    await whatsAppConversationService.addMessage({
      conversationId: conversation.id,
      userId,
      direction: 'outbound',
      senderType: 'agent',
      messageType: 'text',
      content: aiResult.reply,
      metaMessageId: metaMsgId,
      status: 'sent',
      metadata: {
        aiBot: true,
        category: aiResult.category,
        leadScore: aiResult.leadScore,
        usedCallMemory,
        handoverTriggered: aiResult.needsHumanHandover,
      },
    });

    // Self-Filling CRM: Create or Update Lead in `leads` table (and sync Cross-Channel Memory back for future Voice Calls!)
    if (config.autoQualifyLeads) {
      await this.upsertLeadFromWhatsApp(userId, contactPhone, contactName, aiResult, memory);
    }

    // Auto-book appointment if customer confirmed date & time on WhatsApp
    let bookedApptSummary: string | null = null;
    if (config.autoBookAppointments && aiResult.appointmentBooked?.date && aiResult.appointmentBooked?.time) {
      try {
        const apptDate = aiResult.appointmentBooked.date;
        const rawTime = aiResult.appointmentBooked.time;
        // Convert "04:00 PM" -> "16:00" if needed for time column
        let normalizedTime = '11:00';
        const timeMatch = String(rawTime).match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
        if (timeMatch) {
          let hh = parseInt(timeMatch[1], 10);
          const mm = timeMatch[2];
          const mer = (timeMatch[3] || '').toUpperCase();
          if (mer === 'PM' && hh < 12) hh += 12;
          if (mer === 'AM' && hh === 12) hh = 0;
          normalizedTime = `${String(hh).padStart(2, '0')}:${mm}`;
        }
        const apptService = aiResult.appointmentBooked.service || 'WhatsApp Booking';
        const aptId = `apt_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        await db.insert(appointments).values({
          id: aptId,
          userId,
          contactName: aiResult.customerName || contactName || 'WhatsApp Customer',
          contactPhone,
          appointmentDate: apptDate,
          appointmentTime: normalizedTime,
          duration: 30,
          serviceName: apptService,
          status: 'scheduled',
          notes: `Booked automatically via 2-Way WhatsApp AI Bot. Summary: ${aiResult.summary}`,
          metadata: { source: 'whatsapp_ai_bot', conversationId: conversation.id },
        } as any);
        bookedApptSummary = `${apptDate} at ${rawTime} (${apptService})`;
      } catch (apptErr: any) {
        console.warn('[WhatsAppAiBot] Failed to insert appointment:', apptErr?.message);
      }
    }

    // Trigger Manager Alert on Human Hand-over (with full chat transcript + call memory)
    if (aiResult.needsHumanHandover && config.autoHandoverOnHumanRequest) {
      await this.sendHumanHandoverAlerts(userId, config, {
        businessName,
        contactPhone,
        contactName: aiResult.customerName || contactName || contactPhone,
        handoverReason: aiResult.handoverReason || 'Customer requested human assistance',
        latestMessage: messageText,
        aiSummary: aiResult.summary,
        chatTranscript: `${chatTranscript}\nCustomer: ${messageText}\nAI Bot: ${aiResult.reply}`.trim(),
        callMemory: memory.unifiedContextPrompt,
      });
    }

    // Append to Activity Log
    await this.appendLog(userId, {
      id: `wa-bot-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      conversationId: conversation.id,
      contactPhone,
      contactName: aiResult.customerName || contactName || contactPhone,
      customerMessage: messageText,
      aiReply: aiResult.reply,
      category: aiResult.category,
      leadScore: aiResult.leadScore,
      sentiment: aiResult.sentiment,
      handoverTriggered: aiResult.needsHumanHandover,
      handoverReason: aiResult.handoverReason,
      usedCallMemory,
      appointmentBooked: bookedApptSummary,
      deliveryChannel,
    });

    return {
      handled: true,
      aiReply: aiResult.reply,
      qualification: aiResult,
      handoverTriggered: aiResult.needsHumanHandover,
      usedCallMemory,
      conversationId: conversation.id,
    };
  }

  /**
   * Upsert Lead in CRM `leads` table so WhatsApp qualification + Cross-Channel Memory is saved for Voice Calls
   */
  private static async upsertLeadFromWhatsApp(
    userId: string,
    contactPhone: string,
    contactName: string | undefined,
    aiResult: {
      customerName: string | null;
      requirement: string | null;
      budgetOrPreference: string | null;
      category: string;
      leadScore: number;
      sentiment: string;
      summary: string;
      nextAction: string;
      needsHumanHandover: boolean;
      handoverReason: string | null;
    },
    memory: CrossChannelMemorySnapshot
  ): Promise<void> {
    try {
      const last10 = this.normalizePhoneLast10(contactPhone);
      const likePattern = `%${last10}`;
      const existingRes = await db.execute(sql`
        SELECT id, first_name, last_name, ai_summary, custom_fields, lead_score, stage
        FROM leads
        WHERE user_id = ${userId} AND REGEXP_REPLACE(phone, '[^0-9]', '', 'g') LIKE ${likePattern}
        ORDER BY updated_at DESC
        LIMIT 1
      `);
      const rows = (existingRes as any)?.rows || [];

      const resolvedName = (aiResult.customerName || contactName || '').trim();
      const firstName = resolvedName && resolvedName !== 'Customer' ? resolvedName.split(' ')[0] : null;
      const lastName =
        resolvedName && resolvedName !== 'Customer' && resolvedName.includes(' ')
          ? resolvedName.split(' ').slice(1).join(' ')
          : null;

      const stageMap: Record<string, string> = {
        hot: 'hot',
        warm: 'follow_up',
        appointment_booked: 'appointment',
        call_transfer: 'follow_up',
        cold: 'new',
      };
      const newStage = stageMap[aiResult.category] || 'follow_up';

      const unifiedSummary = `[WhatsApp AI Qualification]: ${aiResult.summary}${
        aiResult.requirement ? ` | Requirement: ${aiResult.requirement}` : ''
      }${aiResult.budgetOrPreference ? ` | Preference/Budget: ${aiResult.budgetOrPreference}` : ''}`;

      if (rows.length > 0) {
        const existing = rows[0];
        const prevSummary = existing.ai_summary || '';
        const combinedSummary = prevSummary.includes('[WhatsApp AI Qualification]:')
          ? prevSummary.replace(/\[WhatsApp AI Qualification\]:[\s\S]*$/, unifiedSummary)
          : prevSummary
            ? `${prevSummary}\n\n${unifiedSummary}`
            : unifiedSummary;

        const existingCustom =
          typeof existing.custom_fields === 'object' && existing.custom_fields !== null
            ? existing.custom_fields
            : {};
        const updatedCustom = {
          ...existingCustom,
          whatsappQualified: true,
          whatsappRequirement: aiResult.requirement || (existingCustom as any).whatsappRequirement,
          whatsappBudget: aiResult.budgetOrPreference || (existingCustom as any).whatsappBudget,
          whatsappLastUpdatedAt: new Date().toISOString(),
          humanHandoverRequested: aiResult.needsHumanHandover,
          handoverReason: aiResult.handoverReason,
        };

        await db
          .update(leads)
          .set({
            firstName: firstName || existing.first_name,
            lastName: lastName || existing.last_name,
            leadScore: Math.max(Number(existing.lead_score || 0), aiResult.leadScore),
            aiCategory: aiResult.category,
            sentiment: aiResult.sentiment,
            aiSummary: combinedSummary,
            aiNextAction: aiResult.nextAction,
            stage: existing.stage === 'converted' || existing.stage === 'won' ? existing.stage : newStage,
            hasTransfer: aiResult.needsHumanHandover ? true : undefined,
            transferredAt: aiResult.needsHumanHandover ? new Date() : undefined,
            customFields: updatedCustom,
            updatedAt: new Date(),
          } as any)
          .where(eq(leads.id, existing.id));
      } else {
        await db.insert(leads).values({
          userId,
          sourceType: 'incoming',
          firstName: firstName || 'WhatsApp',
          lastName: lastName || 'Lead',
          phone: contactPhone,
          stage: newStage,
          leadScore: aiResult.leadScore,
          aiCategory: aiResult.category,
          sentiment: aiResult.sentiment,
          aiSummary: unifiedSummary,
          aiNextAction: aiResult.nextAction,
          hasTransfer: aiResult.needsHumanHandover,
          transferredAt: aiResult.needsHumanHandover ? new Date() : null,
          tags: ['whatsapp-ai-bot'],
          customFields: {
            sourceChannel: 'whatsapp',
            whatsappQualified: true,
            whatsappRequirement: aiResult.requirement,
            whatsappBudget: aiResult.budgetOrPreference,
            humanHandoverRequested: aiResult.needsHumanHandover,
            handoverReason: aiResult.handoverReason,
          },
        } as any);
      }
    } catch (err: any) {
      console.warn('[WhatsAppAiBot] Error upserting CRM lead:', err?.message);
    }
  }

  /**
   * Send instant WhatsApp + Email alert to Manager/Staff when Human Hand-over is triggered
   */
  private static async sendHumanHandoverAlerts(
    userId: string,
    config: WhatsAppAiBotConfig,
    info: {
      businessName: string;
      contactPhone: string;
      contactName: string;
      handoverReason: string;
      latestMessage: string;
      aiSummary: string;
      chatTranscript: string;
      callMemory: string;
    }
  ): Promise<void> {
    const alertText = [
      `🚨 *HUMAN HAND-OVER ALERT — ${info.businessName}*`,
      `👤 *Customer:* ${info.contactName} (${info.contactPhone})`,
      `⚠️ *Reason:* ${info.handoverReason}`,
      `💬 *Latest Message:* "${info.latestMessage}"`,
      `📋 *AI Summary:* ${info.aiSummary}`,
      `🛑 *Action Taken:* AI Auto-Reply has been paused for this conversation so a human team member can reply directly in the WhatsApp Inbox.`,
    ].join('\n');

    // 1. Manager WhatsApp Alert
    if (config.notifyManagerOnHandoverWhatsApp && config.managerWhatsAppPhones.trim()) {
      const phones = config.managerWhatsAppPhones
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
      for (const phone of phones) {
        try {
          const { metaWhatsAppService } = await import('../../plugins/messaging/services/meta-whatsapp.service');
          await metaWhatsAppService.sendReply(userId, phone, alertText, {
            triggeredBy: 'whatsapp_human_handover_alert',
          });
        } catch (_) {}
      }
    }

    // 2. Manager Email Alert
    if (config.notifyManagerOnHandoverEmail) {
      let emails = config.managerEmails
        .split(',')
        .map((e) => e.trim())
        .filter(Boolean);

      if (emails.length === 0) {
        try {
          const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
          if (u?.email) emails = [u.email];
        } catch (_) {}
      }

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
          <div style="background: linear-gradient(135deg, #d97706, #b45309); color: #ffffff; padding: 18px 24px;">
            <h2 style="margin: 0; font-size: 18px;">WhatsApp Human Hand-over Alert — ${info.businessName}</h2>
            <p style="margin: 4px 0 0; font-size: 13px; opacity: 0.9;">AI Bot has paused auto-replies and handed this conversation over to your team</p>
          </div>
          <div style="padding: 20px 24px; background: #ffffff; color: #1e293b; font-size: 14px; line-height: 1.6;">
            <p><strong>Customer:</strong> ${info.contactName} (${info.contactPhone})</p>
            <p><strong>Hand-over Reason:</strong> <span style="color: #b45309; font-weight: 600;">${info.handoverReason}</span></p>
            <p><strong>Latest Message:</strong> "${info.latestMessage}"</p>
            <p><strong>AI Qualification Summary:</strong> ${info.aiSummary}</p>
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 16px 0;" />
            <h4 style="margin: 0 0 8px; font-size: 13px; text-transform: uppercase; color: #64748b;">Full WhatsApp Chat Transcript</h4>
            <pre style="background: #f8fafc; padding: 12px; border-radius: 8px; font-size: 12px; white-space: pre-wrap; border: 1px solid #e2e8f0;">${info.chatTranscript}</pre>
            <h4 style="margin: 16px 0 8px; font-size: 13px; text-transform: uppercase; color: #64748b;">Unified Cross-Channel Call Memory</h4>
            <pre style="background: #f8fafc; padding: 12px; border-radius: 8px; font-size: 12px; white-space: pre-wrap; border: 1px solid #e2e8f0;">${info.callMemory}</pre>
          </div>
        </div>
      `;

      for (const toEmail of emails) {
        try {
          await emailService.sendEmail(
            toEmail,
            `[Human Hand-over] WhatsApp Chat with ${info.contactName} (${info.contactPhone})`,
            html,
            undefined,
            { text: `${alertText}\n\nChat Transcript:\n${info.chatTranscript}`, userId }
          );
        } catch (_) {}
      }
    }

    // 3. Auto-create Support Ticket for Customer Support & Resolution Rate tracking
    try {
      const { SupportTicketService } = await import('./support-ticket.service');
      await SupportTicketService.autoCreateFromWhatsApp({
        userId,
        contactPhone: conv.contactPhone,
        contactName: conv.contactName || info.contactName,
        messageText: info.latestMessage,
        reason: info.handoverReason,
        conversationId: conv.id,
      });
    } catch (_) {}
  }
}
