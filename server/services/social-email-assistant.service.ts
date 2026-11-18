import { db } from '../db';
import { sql, eq, and, desc } from 'drizzle-orm';
import {
  leads,
  appointments,
  agents,
  knowledgeBase,
  crmWhitelabelConfigs,
  userEmailTemplates,
  users,
} from '@shared/schema';
import { emailService } from './email-service';
import { WhatsAppAiBotService } from './whatsapp-ai-bot.service';

export interface SocialAgentRule {
  id: string;
  name: string;
  enabled: boolean;
  channel: 'all' | 'instagram_comment' | 'instagram_dm' | 'facebook_comment' | 'facebook_dm';
  matchKeywords: string;
  agentId: string;
  agentName?: string;
  brochureUrl?: string;
  customInstructions?: string;
  autoCallEnabled: boolean;
  callGreeting?: string;
}

export interface SocialLeadCaptureConfig {
  enabled: boolean;
  instagramDmEnabled: boolean;
  instagramCommentEnabled: boolean;
  facebookMessengerEnabled: boolean;
  facebookCommentEnabled: boolean;
  commentTriggerKeywords: string;
  autoReplyToComments: boolean;
  autoSendDmOnComment: boolean;
  autoCreateCrmLead: boolean;
  metaPageAccessToken: string;
  instagramAccountId: string;
  facebookPageId: string;
  webhookVerifyToken: string;
  metaAppSecret?: string;
  brochureUrl: string;
  defaultCommentReply: string;
  customQualificationPrompt: string;
  agentRules?: SocialAgentRule[];
}

export interface SocialLeadEventLog {
  id: string;
  timestamp: string;
  platform: 'instagram_dm' | 'instagram_comment' | 'facebook_dm' | 'facebook_comment';
  senderHandle: string;
  senderName: string;
  extractedPhone: string | null;
  extractedEmail: string | null;
  postOrReelTitle: string | null;
  incomingText: string;
  publicCommentReply: string | null;
  aiDmReply: string;
  category: string;
  leadScore: number;
  sentiment: string;
  crmLeadId: string | null;
  summary: string;
  matchedRuleName?: string | null;
  autoCallTriggered?: boolean;
  autoCallAgentName?: string | null;
  autoCallError?: string | null;
}

export interface EmailSequenceStep {
  id: string;
  stepNumber: number;
  name: string;
  delayHours: number;
  targetCategory: 'all' | 'hot' | 'warm' | 'new';
  subjectTemplate: string;
  instructions: string;
  enabled: boolean;
}

export interface EmailAssistantConfig {
  enabled: boolean;
  senderDisplayName: string;
  replyToEmail: string;
  signatureText: string;
  brochureUrl: string;
  bookingLink: string;
  autoEnrollHotLeads: boolean;
  autoEnrollWarmLeads: boolean;
  useCrossChannelMemory: boolean;
  /** Master switch for the automatic background sequence sender (default OFF for safety). */
  autoSequenceEnabled?: boolean;
  /** ISO timestamp when auto-sequences were switched ON. Only leads created after this are auto-enrolled. */
  autoSequenceEnabledAt?: string | null;
  sequences: EmailSequenceStep[];
}

export interface AiEmailDraft {
  id: string;
  createdAt: string;
  leadId: string | null;
  recipientName: string;
  recipientEmail: string;
  recipientPhone: string | null;
  purpose: string;
  subject: string;
  body: string;
  status: 'draft' | 'sent';
  sentAt?: string | null;
  usedCallAndChatMemory: boolean;
}

const SOCIAL_CONFIG_KEY = '__CRM_SOCIAL_LEAD_CAPTURE_CONFIG__';
const SOCIAL_LOG_KEY = '__CRM_SOCIAL_LEAD_CAPTURE_LOG__';
const EMAIL_CONFIG_KEY = '__CRM_EMAIL_ASSISTANT_CONFIG__';
const EMAIL_DRAFTS_KEY = '__CRM_EMAIL_ASSISTANT_DRAFTS__';

const DEFAULT_SOCIAL_CONFIG: SocialLeadCaptureConfig = {
  enabled: true,
  instagramDmEnabled: true,
  instagramCommentEnabled: true,
  facebookMessengerEnabled: true,
  facebookCommentEnabled: true,
  commentTriggerKeywords: 'price, details, pp, interested, brochure, info, book, visit, cost, dm, link',
  autoReplyToComments: true,
  autoSendDmOnComment: true,
  autoCreateCrmLead: true,
  metaPageAccessToken: '',
  instagramAccountId: '',
  facebookPageId: '',
  webhookVerifyToken: 'calliqo_social_verify_token',
  metaAppSecret: '',
  brochureUrl: '',
  defaultCommentReply: 'Thank you for your interest! We have just sent you the complete details & brochure in your DM. Please check your inbox!',
  customQualificationPrompt: 'Qualify the prospect warmly, share the brochure/pricing details if requested, and politely ask for their WhatsApp phone number and preferred date/time so our team or AI assistant can schedule their consultation/site visit.',
  agentRules: [],
};

const DEFAULT_EMAIL_CONFIG: EmailAssistantConfig = {
  enabled: true,
  senderDisplayName: '',
  replyToEmail: '',
  signatureText: 'Best Regards,\nSales & Advisory Team',
  brochureUrl: '',
  bookingLink: '',
  autoEnrollHotLeads: true,
  autoEnrollWarmLeads: true,
  useCrossChannelMemory: true,
  autoSequenceEnabled: false,
  autoSequenceEnabledAt: null,
  sequences: [
    {
      id: 'seq-step-1',
      stepNumber: 1,
      name: 'Step 1: Instant Call/Chat Recap & Brochure Email',
      delayHours: 0,
      targetCategory: 'all',
      subjectTemplate: 'Thank you for speaking with {business_name} — Details & Brochure Inside',
      instructions: 'Reference our recent phone/WhatsApp conversation, summarize their requirement, share the brochure link, and invite them to confirm a consultation or site visit slot.',
      enabled: true,
    },
    {
      id: 'seq-step-2',
      stepNumber: 2,
      name: 'Step 2: 24-Hour Value & FAQ Follow-up',
      delayHours: 24,
      targetCategory: 'warm',
      subjectTemplate: 'Quick follow-up on your inquiry with {business_name}',
      instructions: 'Address common questions regarding pricing/availability, highlight key benefits, and ask if they have any questions.',
      enabled: true,
    },
    {
      id: 'seq-step-3',
      stepNumber: 3,
      name: 'Step 3: 72-Hour Priority Consultation / Site Visit Invite',
      delayHours: 72,
      targetCategory: 'hot',
      subjectTemplate: 'Priority Slot Confirmation — {business_name}',
      instructions: 'Create gentle urgency to book their site visit or consultation this week and offer a direct callback.',
      enabled: true,
    },
  ],
};

export class SocialEmailAssistantService {
  // ─────────────────────────────────────────────────────────────
  // JSON Storage Helpers (Isolated in userEmailTemplates.designJson)
  // ─────────────────────────────────────────────────────────────
  private static async readJsonStore<T>(userId: string, key: string, fallback: T): Promise<T> {
    try {
      const [row] = await db
        .select()
        .from(userEmailTemplates)
        .where(and(eq(userEmailTemplates.userId, userId), eq(userEmailTemplates.name, key)))
        .limit(1);
      if (row && row.designJson && typeof row.designJson === 'object') {
        if (Array.isArray(fallback)) {
          const items = (row.designJson as any).items;
          return (Array.isArray(items) ? items : fallback) as T;
        }
        return { ...fallback, ...(row.designJson as any) };
      }
    } catch (err: any) {
      console.warn(`[SocialEmailAssistant] Error reading ${key}:`, err?.message);
    }
    return fallback;
  }

  private static async writeJsonStore(userId: string, key: string, subject: string, data: any): Promise<void> {
    try {
      const payload = Array.isArray(data) ? { items: data } : data;
      const [existing] = await db
        .select({ id: userEmailTemplates.id })
        .from(userEmailTemplates)
        .where(and(eq(userEmailTemplates.userId, userId), eq(userEmailTemplates.name, key)))
        .limit(1);

      if (existing) {
        await db
          .update(userEmailTemplates)
          .set({ designJson: payload, updatedAt: new Date() })
          .where(eq(userEmailTemplates.id, existing.id));
      } else {
        await db.insert(userEmailTemplates).values({
          userId,
          name: key,
          subject,
          htmlBody: 'JSON_STORE',
          variables: [],
          isActive: false,
          designJson: payload,
        });
      }
    } catch (err: any) {
      console.warn(`[SocialEmailAssistant] Error writing ${key}:`, err?.message);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // PART A: Instagram & Facebook DM / Comment Lead Capture
  // ─────────────────────────────────────────────────────────────
  static async getSocialConfig(userId: string): Promise<SocialLeadCaptureConfig> {
    return this.readJsonStore<SocialLeadCaptureConfig>(userId, SOCIAL_CONFIG_KEY, { ...DEFAULT_SOCIAL_CONFIG });
  }

  static async saveSocialConfig(
    userId: string,
    partial: Partial<SocialLeadCaptureConfig>
  ): Promise<SocialLeadCaptureConfig> {
    const current = await this.getSocialConfig(userId);
    const updated: SocialLeadCaptureConfig = { ...current, ...partial };
    await this.writeJsonStore(userId, SOCIAL_CONFIG_KEY, 'Social Lead Capture Config', updated);
    return updated;
  }

  static async getSocialLogs(userId: string): Promise<SocialLeadEventLog[]> {
    return this.readJsonStore<SocialLeadEventLog[]>(userId, SOCIAL_LOG_KEY, []);
  }

  private static recentAutoCallPhones = new Map<string, number>();

  /** Strictly validates phone numbers (rejects 7-9 digit incomplete numbers like +91702308303). */
  private static extractValidPhone(text: string): { validPhone: string | null; invalidAttempt: string | null } {
    const matches = String(text || '').match(/\+?\d[\d\s-]{5,16}\d/g) || [];
    let invalidAttempt: string | null = null;
    for (const raw of matches) {
      const cleaned = raw.trim();
      const digits = cleaned.replace(/\D/g, '');
      if (digits.length === 10 && /^[6-9]/.test(digits)) {
        return { validPhone: `+91${digits}`, invalidAttempt: null };
      }
      if (digits.length === 12 && digits.startsWith('91') && /^[6-9]/.test(digits.slice(2))) {
        return { validPhone: `+${digits}`, invalidAttempt: null };
      }
      if (digits.length === 11 && digits.startsWith('0') && /^[6-9]/.test(digits.slice(1))) {
        return { validPhone: `+91${digits.slice(1)}`, invalidAttempt: null };
      }
      if (cleaned.startsWith('+') && !digits.startsWith('91') && digits.length >= 10 && digits.length <= 15) {
        return { validPhone: `+${digits}`, invalidAttempt: null };
      }
      if (digits.length >= 6 && digits.length <= 14 && !invalidAttempt) {
        invalidAttempt = cleaned;
      }
    }
    return { validPhone: null, invalidAttempt };
  }

  /** Returns true only when the name is a real person's name (not a generic placeholder like "User"). */
  private static isRealCustomerName(name?: string | null): boolean {
    const n = String(name || '').trim().toLowerCase();
    if (!n || n.length < 2) return false;
    if (n.startsWith('fb:') || n.startsWith('ig:') || n.startsWith('@')) return false;
    const generic = new Set(['user', 'customer', 'unknown', 'social', 'social media lead', 'not provided', 'not mentioned', 'guest', 'caller', 'calliqo ai']);
    return !generic.has(n);
  }

  /** Picks the first enabled Post/DM rule matching the channel & keywords (or a catch-all rule). */
  private static resolveMatchingRule(
    config: SocialLeadCaptureConfig,
    platform: 'instagram_dm' | 'instagram_comment' | 'facebook_dm' | 'facebook_comment',
    incomingText: string,
    postOrReelTitle?: string
  ): SocialAgentRule | null {
    const rules = Array.isArray(config.agentRules) ? config.agentRules : [];
    const eligible = rules.filter((r) => r.enabled && (r.channel === 'all' || r.channel === platform));
    if (eligible.length === 0) return null;

    const haystack = `${incomingText} ${postOrReelTitle || ''}`.toLowerCase();
    for (const rule of eligible) {
      const kws = (rule.matchKeywords || '')
        .split(',')
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean);
      if (kws.length > 0 && kws.some((kw) => haystack.includes(kw))) {
        return rule;
      }
    }
    // Fallback: first enabled rule for this channel with empty matchKeywords
    return eligible.find((r) => !(r.matchKeywords || '').trim()) || null;
  }

  /** Loads the selected Agent's prompt + the tenant's Knowledge Base entries for accurate replies. */
  private static async buildAgentAndKnowledgeContext(
    userId: string,
    agentId?: string
  ): Promise<{ agentName: string | null; agentPrompt: string; knowledgeContext: string }> {
    let agentName: string | null = null;
    let agentPrompt = '';
    if (agentId) {
      try {
        const [ag] = await db
          .select({ name: agents.name, systemPrompt: agents.systemPrompt, personality: agents.personality })
          .from(agents)
          .where(and(eq(agents.id, agentId), eq(agents.userId, userId)))
          .limit(1);
        if (ag) {
          agentName = ag.name;
          agentPrompt = [ag.personality ? `Tone/Personality: ${ag.personality}` : '', ag.systemPrompt || '']
            .filter(Boolean)
            .join('\n')
            .slice(0, 2200);
        }
      } catch (_) {}
    }

    let knowledgeContext = '';
    try {
      const kbRows = await db
        .select({ title: knowledgeBase.title, content: knowledgeBase.content, type: knowledgeBase.type })
        .from(knowledgeBase)
        .where(eq(knowledgeBase.userId, userId))
        .orderBy(desc(knowledgeBase.createdAt))
        .limit(8);

      const parts: string[] = [];
      let totalLen = 0;
      for (const kb of kbRows) {
        const text = String(kb.content || '').trim();
        if (!text) continue;
        const snippet = `[${kb.title} (${kb.type})]: ${text.slice(0, 800)}`;
        if (totalLen + snippet.length > 3500) break;
        parts.push(snippet);
        totalLen += snippet.length;
      }
      knowledgeContext = parts.join('\n\n');
    } catch (_) {}

    return { agentName, agentPrompt, knowledgeContext };
  }

  /** Schedules an immediate AI Voice Call ONLY if the matched rule has autoCallEnabled = true. */
  private static async triggerRuleAutoCallIfEnabled(params: {
    userId: string;
    rule: SocialAgentRule | null;
    detectedPhone: string | null;
    customerName: string;
    platform: string;
    incomingText: string;
    businessName: string;
  }): Promise<{ triggered: boolean; agentName: string | null; error?: string }> {
    const { rule, detectedPhone } = params;
    if (!rule || !rule.autoCallEnabled || !detectedPhone || !rule.agentId) {
      return { triggered: false, agentName: rule?.agentName || null };
    }

    const last10 = WhatsAppAiBotService.normalizePhoneLast10(detectedPhone);
    const dedupeKey = `${params.userId}:${last10 || detectedPhone}`;
    const lastCallTs = this.recentAutoCallPhones.get(dedupeKey) || 0;
    if (Date.now() - lastCallTs < 10 * 60 * 1000) {
      return { triggered: false, agentName: rule.agentName || null, error: 'Skipped duplicate call within 10 min' };
    }

    try {
      const { FollowUpSchedulerService } = await import('./follow-up-scheduler.service');
      const greeting = (rule.callGreeting || '').trim()
        ? rule.callGreeting!.trim()
        : `Hello ${params.customerName || ''}, I am calling from ${params.businessName} regarding your recent ${params.platform.replace('_', ' ')} inquiry. Is this a good time to speak?`.trim();

      const contextNote = `[CUSTOM_GREETING]: ${greeting} ||| Customer inquired via ${params.platform.replace('_', ' ')} (Rule: ${rule.name}): "${params.incomingText.slice(0, 240)}"`;
      const scheduled = await FollowUpSchedulerService.scheduleFollowUp({
        userId: params.userId,
        agentId: rule.agentId,
        phoneNumber: detectedPhone,
        customerName: params.customerName,
        scheduledAt: new Date(Date.now() + 3000),
        preferredTimeText: 'Social Media Lead Instant Callback',
        contextNote,
      });

      if (!scheduled) {
        return { triggered: false, agentName: rule.agentName || null, error: 'Could not schedule outbound call' };
      }

      this.recentAutoCallPhones.set(dedupeKey, Date.now());
      console.log(`[SocialEmailAssistant] Auto-Call scheduled for ${detectedPhone} via rule "${rule.name}" (agent ${rule.agentId})`);
      return { triggered: true, agentName: rule.agentName || null };
    } catch (err: any) {
      console.warn('[SocialEmailAssistant] Auto-Call error:', err?.message);
      return { triggered: false, agentName: rule.agentName || null, error: err?.message || 'Auto-call failed' };
    }
  }

  static async processSocialLeadEvent(params: {
    userId: string;
    platform: 'instagram_dm' | 'instagram_comment' | 'facebook_dm' | 'facebook_comment';
    senderHandle: string;
    senderName?: string;
    incomingText: string;
    postOrReelTitle?: string;
    extractedPhone?: string;
    extractedEmail?: string;
  }): Promise<{
    handled: boolean;
    event: SocialLeadEventLog;
  }> {
    const {
      userId,
      platform,
      senderHandle,
      senderName,
      incomingText,
      postOrReelTitle,
    } = params;

    const config = await this.getSocialConfig(userId);
    const currentLogs = await this.getSocialLogs(userId);
    const isComment = platform === 'instagram_comment' || platform === 'facebook_comment';

    // Load recent conversation history for this same sender (last 24h, up to 6 turns)
    const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
    const senderHistory = currentLogs
      .filter((l) => l.senderHandle === senderHandle && new Date(l.timestamp).getTime() > cutoffMs)
      .slice(0, 6)
      .reverse();

    const recentChatHistory = senderHistory
      .map((l) => `Customer: "${l.incomingText}"\nAI: "${l.aiDmReply}"`)
      .join('\n---\n');

    // Strictly validate phone number (reject 7-9 digit typos); reuse valid phone from recent chat
    const phoneCheck = params.extractedPhone?.trim()
      ? this.extractValidPhone(params.extractedPhone)
      : this.extractValidPhone(incomingText);
    const emailMatch = incomingText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    const rawNewPhone = phoneCheck.validPhone;
    const invalidPhoneAttempt = phoneCheck.invalidAttempt;
    const stickyPhoneEntry = [...senderHistory].reverse().find((l) => l.extractedPhone);
    const stickyPhone = stickyPhoneEntry?.extractedPhone ? this.extractValidPhone(stickyPhoneEntry.extractedPhone).validPhone : null;
    const detectedPhone = rawNewPhone || stickyPhone;
    const stickyName = [...senderHistory].reverse().find((l) => this.isRealCustomerName(l.senderName))?.senderName || null;
    const knownCustomerName = this.isRealCustomerName(senderName) ? senderName!.trim() : stickyName;
    const detectedEmail =
      params.extractedEmail?.trim() ||
      (emailMatch ? emailMatch[0] : null) ||
      [...senderHistory].reverse().find((l) => l.extractedEmail)?.extractedEmail ||
      null;

    // Resolve Business Name
    let businessName = 'Our Business';
    try {
      const [wl] = await db
        .select({ businessName: crmWhitelabelConfigs.businessName })
        .from(crmWhitelabelConfigs)
        .where(eq(crmWhitelabelConfigs.userId, userId))
        .limit(1);
      if (wl?.businessName) businessName = wl.businessName;
    } catch (_) {}

    // Resolve Dynamic Post / DM Agent Rule (or sticky rule from recent chat) + Agent Prompt + Knowledge Base
    let matchedRule = this.resolveMatchingRule(config, platform, incomingText, postOrReelTitle);
    if (!matchedRule) {
      const lastRuleName = [...senderHistory].reverse().find((l) => l.matchedRuleName)?.matchedRuleName;
      if (lastRuleName && Array.isArray(config.agentRules)) {
        matchedRule = config.agentRules.find((r) => r.enabled && r.name === lastRuleName) || null;
      }
    }
    const effectiveBrochureUrl = (matchedRule?.brochureUrl || '').trim() || config.brochureUrl;
    const effectiveInstructions = (matchedRule?.customInstructions || '').trim() || config.customQualificationPrompt;
    const { agentName, agentPrompt, knowledgeContext } = await this.buildAgentAndKnowledgeContext(
      userId,
      matchedRule?.agentId
    );

    const todayIst = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

    let aiParsed: {
      publicCommentReply: string | null;
      aiDmReply: string;
      customerName: string;
      requirement: string;
      category: 'hot' | 'warm' | 'cold';
      leadScore: number;
      sentiment: 'positive' | 'neutral' | 'negative';
      summary: string;
      appointmentDate?: string | null;
      appointmentTime?: string | null;
      serviceName?: string | null;
    } | null = null;

    try {
      const dbApiKey = await db.execute(sql`
        SELECT value FROM global_settings WHERE key = 'openai_api_key' LIMIT 1
      `);
      let apiKey = (dbApiKey.rows[0]?.value as string) || process.env.OPENAI_API_KEY || '';
      if (typeof apiKey === 'string') apiKey = apiKey.replace(/^"|"$/g, '').trim();

      if (apiKey) {
        const { default: OpenAI } = await import('openai');
        const openai = new OpenAI({ apiKey });

        const prompt = `You are a conversational Social Media AI Assistant${agentName ? ` acting as "${agentName}"` : ` for "${businessName}"`}.
Today's Date (IST): ${todayIst}
Channel: ${platform.toUpperCase()}
Post / Reel Context: ${postOrReelTitle || 'Direct Message / General Page Inquiry'}
Sender Handle: ${senderHandle} (${senderName || senderHandle})
${recentChatHistory ? `\n=== RECENT CHAT HISTORY WITH THIS USER ===\n${recentChatHistory}\n` : ''}
Latest Incoming Message/Comment: "${incomingText}"
Known Customer Name: ${knownCustomerName || 'NOT PROVIDED YET'}
Known Valid Phone Number: ${detectedPhone || 'NOT PROVIDED YET'}
${invalidPhoneAttempt ? `INVALID/INCOMPLETE PHONE ATTEMPT DETECTED: "${invalidPhoneAttempt}" (too short / wrong digits — MUST tell user to share a valid 10-digit mobile number!)` : ''}
Known Email: ${detectedEmail || 'Not provided yet'}
Brochure Link: ${effectiveBrochureUrl || 'Available on request'}
Qualification Instructions: ${effectiveInstructions}
${matchedRule ? `Matched Rule: ${matchedRule.name}${agentName ? ` (Agent: ${agentName})` : ''}` : ''}
${agentPrompt ? `\n=== ASSIGNED AGENT PERSONA & INSTRUCTIONS (STAY STRICTLY IN THIS PERSONA) ===\n${agentPrompt}\n` : ''}${knowledgeContext ? `\n=== BUSINESS KNOWLEDGE BASE (USE EXACT PRICES, TIMINGS & FACTS FROM HERE) ===\n${knowledgeContext}\n` : ''}

CRITICAL CONVERSATION RULES:
1. Read the RECENT CHAT HISTORY carefully. Do NOT repeat questions the user already answered!
2. NEVER book or say "your appointment is booked/confirmed" unless we have BOTH:
   (a) Known Customer Real Name (NOT "User" or blank — extract from message if user wrote "my name is ..."), AND
   (b) A VALID 10-digit phone number (Known Valid Phone Number is present).
   If Name or Valid Phone is missing, politely ask for the missing detail(s) first BEFORE confirming the appointment!
3. If "INVALID/INCOMPLETE PHONE ATTEMPT DETECTED" is shown above, politely tell the customer their phone number appears incomplete/invalid and ask for a valid 10-digit mobile number.
4. If "Known Valid Phone Number" is already present (${detectedPhone || 'none'}), NEVER ask for their phone number again!
5. If user gives date + time AND we have BOTH Real Name and Valid Phone, extract "appointmentDate" (YYYY-MM-DD) and "appointmentTime" (HH:MM 24h) and CONFIRM the appointment clearly!
6. Match the user's language (if they write in Hindi/Hinglish or ask for Hindi/Hinglish, reply ONLY in natural Hinglish/Hindi).
7. Stay strictly in the Assigned Agent's persona if present (do not mention another unrelated business).

Respond ONLY with a valid JSON object matching this exact schema:
{
  "publicCommentReply": ${isComment ? '"Short polite public reply telling them to check their DM for details"' : 'null'},
  "aiDmReply": "Natural, non-repetitive DM response following the conversation rules above",
  "customerName": "Inferred customer name from senderName or message",
  "requirement": "Extracted product/service/appointment interest",
  "category": "hot" | "warm" | "cold",
  "leadScore": 80,
  "sentiment": "positive" | "neutral" | "negative",
  "summary": "1-2 sentence CRM summary of this social media lead",
  "appointmentDate": "YYYY-MM-DD if user requested/confirmed a date in this message or chat history, else null",
  "appointmentTime": "HH:MM (24-hour, e.g. 16:00) if time was given, else null",
  "serviceName": "Appointment service name (e.g. Dental Consultation / Site Visit) or null"
}`;

        const completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
          temperature: 0.3,
        });

        const content = completion.choices[0]?.message?.content;
        if (content) {
          const parsed = JSON.parse(content);
          aiParsed = {
            publicCommentReply: isComment
              ? parsed.publicCommentReply || config.defaultCommentReply
              : null,
            aiDmReply:
              parsed.aiDmReply ||
              `Hi ${senderName || senderHandle}! Thank you for reaching out to ${businessName}. Please share your WhatsApp number so we can send you the complete brochure and schedule your visit.`,
            customerName: parsed.customerName || senderName || senderHandle.replace(/^@/, ''),
            requirement: parsed.requirement || incomingText.slice(0, 100),
            category: parsed.category || (detectedPhone ? 'hot' : 'warm'),
            leadScore: typeof parsed.leadScore === 'number' ? parsed.leadScore : detectedPhone ? 85 : 70,
            sentiment: parsed.sentiment || 'positive',
            summary:
              parsed.summary ||
              `Captured via ${platform.replace('_', ' ')} (${senderHandle}): "${incomingText.slice(0, 120)}"`,
            appointmentDate: parsed.appointmentDate || null,
            appointmentTime: parsed.appointmentTime || null,
            serviceName: parsed.serviceName || null,
          };
        }
      }
    } catch (err: any) {
      console.warn('[SocialEmailAssistant] OpenAI social parse fallback:', err?.message);
    }

    if (!aiParsed) {
      aiParsed = {
        publicCommentReply: isComment ? config.defaultCommentReply : null,
        aiDmReply: `Hi ${senderName || senderHandle}! Thank you for your interest in *${businessName}*${
          postOrReelTitle ? ` regarding "${postOrReelTitle}"` : ''
        }. ${config.brochureUrl ? `Here is our brochure: ${config.brochureUrl}\n\n` : ''}${
          detectedPhone
            ? `We have noted your number (${detectedPhone}) and our advisor will connect with you shortly!`
            : `Could you please share your WhatsApp number so we can send you full pricing details and book a priority slot?`
        }`,
        customerName: senderName || senderHandle.replace(/^@/, ''),
        requirement: incomingText.slice(0, 100),
        category: detectedPhone ? 'hot' : 'warm',
        leadScore: detectedPhone ? 85 : 68,
        sentiment: 'positive',
        summary: `Social Lead from ${platform.replace('_', ' ')} (${senderHandle}): "${incomingText.slice(0, 120)}"`,
      };
    }

    // Create or Update Lead in CRM `leads` table
    let crmLeadId: string | null = null;
    if (config.autoCreateCrmLead) {
      try {
        const cleanName = (aiParsed.customerName || senderName || senderHandle.replace(/^@/, '')).trim();
        const firstName = cleanName.split(' ')[0] || 'Social';
        const lastName = cleanName.includes(' ')
          ? cleanName.split(' ').slice(1).join(' ')
          : `(${platform.startsWith('instagram') ? 'Instagram' : 'Facebook'})`;
        const phoneToStore = detectedPhone || `social:${senderHandle}`;
        const tag = platform.replace('_', '-');

        // Check if lead already exists by phone or social handle
        let existingLeadId: string | null = null;
        if (detectedPhone) {
          const last10 = WhatsAppAiBotService.normalizePhoneLast10(detectedPhone);
          if (last10.length >= 7) {
            const existingRes = await db.execute(sql`
              SELECT id FROM leads
              WHERE user_id = ${userId} AND REGEXP_REPLACE(phone, '[^0-9]', '', 'g') LIKE ${`%${last10}`}
              ORDER BY updated_at DESC LIMIT 1
            `);
            if ((existingRes as any)?.rows?.length > 0) {
              existingLeadId = (existingRes as any).rows[0].id;
            }
          }
        } else {
          const existingRes = await db.execute(sql`
            SELECT id FROM leads
            WHERE user_id = ${userId} AND phone = ${phoneToStore}
            ORDER BY updated_at DESC LIMIT 1
          `);
          if ((existingRes as any)?.rows?.length > 0) {
            existingLeadId = (existingRes as any).rows[0].id;
          }
        }

        if (existingLeadId) {
          crmLeadId = existingLeadId;
          await db
            .update(leads)
            .set({
              firstName,
              lastName,
              email: detectedEmail || undefined,
              leadScore: aiParsed.leadScore,
              aiCategory: aiParsed.category,
              sentiment: aiParsed.sentiment,
              aiSummary: `[${platform.toUpperCase()}]: ${aiParsed.summary}`,
              stage: aiParsed.category === 'hot' ? 'hot' : 'follow_up',
              updatedAt: new Date(),
            } as any)
            .where(eq(leads.id, existingLeadId));
        } else {
          const [inserted] = await db
            .insert(leads)
            .values({
              userId,
              sourceType: 'incoming',
              firstName,
              lastName,
              phone: phoneToStore,
              email: detectedEmail || null,
              stage: aiParsed.category === 'hot' ? 'hot' : 'new',
              leadScore: aiParsed.leadScore,
              aiCategory: aiParsed.category,
              sentiment: aiParsed.sentiment,
              aiSummary: `[${platform.toUpperCase()}]: ${aiParsed.summary}`,
              aiNextAction: detectedPhone
                ? 'Call or WhatsApp prospect immediately'
                : 'Collect phone number via Instagram/Facebook DM',
              tags: [tag, 'social-lead'],
              customFields: {
                sourceChannel: platform,
                socialHandle: senderHandle,
                postOrReelTitle: postOrReelTitle || null,
                incomingMessage: incomingText,
                aiDmReply: aiParsed.aiDmReply,
              },
            } as any)
            .returning({ id: leads.id });
          crmLeadId = inserted?.id || null;
        }
      } catch (leadErr: any) {
        console.warn('[SocialEmailAssistant] Failed to save CRM lead:', leadErr?.message);
      }
    }

    // Create Appointment in `appointments` table ONLY when date + time + valid phone + real customer name are ALL known
    const finalCustomerName = this.isRealCustomerName(aiParsed.customerName)
      ? aiParsed.customerName.trim()
      : knownCustomerName;
    if (aiParsed.appointmentDate && aiParsed.appointmentTime && detectedPhone && finalCustomerName) {
      try {
        const apptDate = String(aiParsed.appointmentDate).trim();
        const apptTime = /^\d{2}:\d{2}$/.test(String(aiParsed.appointmentTime).trim())
          ? `${String(aiParsed.appointmentTime).trim()}:00`
          : '11:00:00';
        const existingAppt = await db
          .select({ id: appointments.id })
          .from(appointments)
          .where(
            and(
              eq(appointments.userId, userId),
              eq(appointments.contactPhone, detectedPhone),
              eq(appointments.appointmentDate, apptDate as any)
            )
          )
          .limit(1);
        if (existingAppt.length === 0) {
          await db.insert(appointments).values({
            id: `apt_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            userId,
            contactName: finalCustomerName,
            contactPhone: detectedPhone,
            contactEmail: detectedEmail || null,
            appointmentDate: apptDate as any,
            appointmentTime: apptTime as any,
            duration: 30,
            serviceName: aiParsed.serviceName || matchedRule?.name || 'Social Media Appointment',
            status: 'scheduled',
            notes: `Booked automatically via ${platform.replace('_', ' ')}. Summary: ${aiParsed.summary}`,
            metadata: { source: 'social_ai_bot', platform, senderHandle },
          } as any);
          console.log(`[SocialEmailAssistant] Appointment booked for ${detectedPhone} on ${apptDate} ${apptTime}`);
        }
      } catch (apptErr: any) {
        console.warn('[SocialEmailAssistant] Failed to book appointment:', apptErr?.message);
      }
    }

    // Per-rule Auto-Call (ONLY if matched rule has autoCallEnabled = true AND NEW phone detected)
    const autoCallResult = await this.triggerRuleAutoCallIfEnabled({
      userId,
      rule: matchedRule,
      detectedPhone: rawNewPhone || (senderHistory.length === 0 ? detectedPhone : null),
      customerName: aiParsed.customerName,
      platform,
      incomingText,
      businessName,
    });

    const eventEntry: SocialLeadEventLog = {
      id: `soc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      platform,
      senderHandle,
      senderName: aiParsed.customerName,
      extractedPhone: detectedPhone,
      extractedEmail: detectedEmail,
      postOrReelTitle: postOrReelTitle || null,
      incomingText,
      publicCommentReply: aiParsed.publicCommentReply,
      aiDmReply: aiParsed.aiDmReply,
      category: aiParsed.category,
      leadScore: aiParsed.leadScore,
      sentiment: aiParsed.sentiment,
      crmLeadId,
      summary: aiParsed.summary,
      matchedRuleName: matchedRule?.name || null,
      autoCallTriggered: autoCallResult.triggered,
      autoCallAgentName: agentName || autoCallResult.agentName || null,
      autoCallError: autoCallResult.error || null,
    };

    await this.writeJsonStore(
      userId,
      SOCIAL_LOG_KEY,
      'Social Lead Capture Logs',
      [eventEntry, ...currentLogs].slice(0, 80)
    );

    return { handled: true, event: eventEntry };
  }

  // ─────────────────────────────────────────────────────────────
  // PART B: AI Email Assistant (Follow-up Sequences & AI Drafts)
  // ─────────────────────────────────────────────────────────────
  static async getEmailConfig(userId: string): Promise<EmailAssistantConfig> {
    const cfg = await this.readJsonStore<EmailAssistantConfig>(userId, EMAIL_CONFIG_KEY, {
      ...DEFAULT_EMAIL_CONFIG,
    });
    if (!Array.isArray(cfg.sequences) || cfg.sequences.length === 0) {
      cfg.sequences = DEFAULT_EMAIL_CONFIG.sequences;
    }
    return cfg;
  }

  static async saveEmailConfig(
    userId: string,
    partial: Partial<EmailAssistantConfig>
  ): Promise<EmailAssistantConfig> {
    const current = await this.getEmailConfig(userId);
    const updated: EmailAssistantConfig = {
      ...current,
      ...partial,
      sequences: Array.isArray(partial.sequences) ? partial.sequences : current.sequences,
    };
    // Track when automatic sequences were switched ON so only NEW leads get auto-enrolled
    if (updated.autoSequenceEnabled && !current.autoSequenceEnabled) {
      updated.autoSequenceEnabledAt = new Date().toISOString();
    } else if (!updated.autoSequenceEnabled) {
      updated.autoSequenceEnabledAt = null;
    } else {
      updated.autoSequenceEnabledAt = current.autoSequenceEnabledAt || new Date().toISOString();
    }
    await this.writeJsonStore(userId, EMAIL_CONFIG_KEY, 'AI Email Assistant Config', updated);
    return updated;
  }

  static async getEmailDrafts(userId: string): Promise<AiEmailDraft[]> {
    return this.readJsonStore<AiEmailDraft[]>(userId, EMAIL_DRAFTS_KEY, []);
  }

  static async generateAiEmailDraft(params: {
    userId: string;
    leadId?: string;
    recipientName: string;
    recipientEmail: string;
    recipientPhone?: string;
    purpose: string;
    customNotes?: string;
  }): Promise<AiEmailDraft> {
    const {
      userId,
      leadId,
      recipientName,
      recipientEmail,
      recipientPhone,
      purpose,
      customNotes,
    } = params;

    const config = await this.getEmailConfig(userId);

    let businessName = config.senderDisplayName || 'Our Business';
    try {
      const [wl] = await db
        .select({ businessName: crmWhitelabelConfigs.businessName })
        .from(crmWhitelabelConfigs)
        .where(eq(crmWhitelabelConfigs.userId, userId))
        .limit(1);
      if (wl?.businessName && !config.senderDisplayName) businessName = wl.businessName;
    } catch (_) {}

    // Fetch Unified Cross-Channel Memory (Voice Calls + WhatsApp + CRM Lead) if phone provided
    let memoryContext = '';
    let usedCallAndChatMemory = false;
    if (config.useCrossChannelMemory && recipientPhone) {
      try {
        const mem = await WhatsAppAiBotService.getCrossChannelMemory(userId, recipientPhone);
        if (mem.pastCalls.length > 0 || mem.recentWhatsAppMessages.length > 0 || mem.lead?.aiSummary) {
          memoryContext = mem.unifiedContextPrompt;
          usedCallAndChatMemory = true;
        }
      } catch (_) {}
    }

    // Load Knowledge Base facts so email replies include accurate prices/timings/details
    const { knowledgeContext } = await this.buildAgentAndKnowledgeContext(userId);

    let subject = `Follow-up from ${businessName} — ${purpose}`;
    let body = `Dear ${recipientName || 'Valued Customer'},\n\nThank you for connecting with ${businessName}.\n\n${
      customNotes || 'We wanted to share our complete details and assist you with your requirement.'
    }\n\n${config.brochureUrl ? `Brochure & Details: ${config.brochureUrl}\n` : ''}${
      config.bookingLink ? `Schedule a Consultation: ${config.bookingLink}\n` : ''
    }\n${config.signatureText || `Best Regards,\n${businessName}`}`;

    try {
      const dbApiKey = await db.execute(sql`
        SELECT value FROM global_settings WHERE key = 'openai_api_key' LIMIT 1
      `);
      let apiKey = (dbApiKey.rows[0]?.value as string) || process.env.OPENAI_API_KEY || '';
      if (typeof apiKey === 'string') apiKey = apiKey.replace(/^"|"$/g, '').trim();

      if (apiKey) {
        const { default: OpenAI } = await import('openai');
        const openai = new OpenAI({ apiKey });

        const prompt = `You are an expert B2B/B2C Sales & Follow-up Email Copywriter for "${businessName}".
Write a personalized, high-converting email to ${recipientName || 'the customer'} (${recipientEmail}).
Email Purpose / Sequence Step: ${purpose}
Additional Notes: ${customNotes || 'None'}
Brochure Link: ${config.brochureUrl || 'Not set'}
Booking Link: ${config.bookingLink || 'Not set'}
Signature: ${config.signatureText || `Best Regards,\n${businessName}`}

${memoryContext ? `=== UNIFIED CUSTOMER MEMORY (PAST PHONE CALLS & WHATSAPP CHATS) ===\n${memoryContext}\nIMPORTANT: Naturally reference relevant details from their prior phone call or WhatsApp chat so the email feels 100% personal!` : ''}
${knowledgeContext ? `\n=== BUSINESS KNOWLEDGE BASE (USE EXACT PRICES, TIMINGS & FACTS FROM HERE) ===\n${knowledgeContext}` : ''}

Respond ONLY with a valid JSON object:
{
  "subject": "Compelling, professional email subject line",
  "body": "Well-structured plain text email body with greeting, personalized context, clear call-to-action, and signature"
}`;

        const completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
          temperature: 0.4,
        });

        const raw = completion.choices[0]?.message?.content;
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed.subject) subject = parsed.subject;
          if (parsed.body) body = parsed.body;
        }
      }
    } catch (err: any) {
      console.warn('[SocialEmailAssistant] OpenAI email draft fallback:', err?.message);
    }

    const draft: AiEmailDraft = {
      id: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      createdAt: new Date().toISOString(),
      leadId: leadId || null,
      recipientName: recipientName || 'Customer',
      recipientEmail,
      recipientPhone: recipientPhone || null,
      purpose,
      subject,
      body,
      status: 'draft',
      usedCallAndChatMemory,
    };

    const existingDrafts = await this.getEmailDrafts(userId);
    await this.writeJsonStore(
      userId,
      EMAIL_DRAFTS_KEY,
      'AI Email Assistant Drafts',
      [draft, ...existingDrafts].slice(0, 80)
    );

    return draft;
  }

  static async sendEmailDraft(params: {
    userId: string;
    draftId?: string;
    recipientName: string;
    recipientEmail: string;
    subject: string;
    body: string;
    purpose?: string;
  }): Promise<{ success: boolean; draft: AiEmailDraft; error?: string }> {
    const { userId, draftId, recipientName, recipientEmail, subject, body, purpose } = params;

    let businessName = 'Calliqo AI';
    try {
      const [wl] = await db
        .select({ businessName: crmWhitelabelConfigs.businessName })
        .from(crmWhitelabelConfigs)
        .where(eq(crmWhitelabelConfigs.userId, userId))
        .limit(1);
      if (wl?.businessName) businessName = wl.businessName;
    } catch (_) {}

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
        <div style="background: linear-gradient(135deg, #2563eb, #1d4ed8); color: #ffffff; padding: 18px 24px;">
          <h2 style="margin: 0; font-size: 18px;">${businessName}</h2>
          <p style="margin: 4px 0 0; font-size: 12px; opacity: 0.9;">${purpose || 'Personalized Follow-up'}</p>
        </div>
        <div style="padding: 24px; background: #ffffff; color: #1e293b; font-size: 14px; line-height: 1.7; white-space: pre-wrap;">${body
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')}</div>
      </div>
    `;

    try {
      const emailConfig = await this.getEmailConfig(userId);
      const sendResult = await emailService.sendEmail(recipientEmail, subject, html, undefined, {
        text: body,
        userId,
        replyTo: emailConfig.replyToEmail || undefined,
      });
      if (!sendResult?.success) {
        throw new Error(sendResult?.error || 'Email delivery failed (check SMTP settings)');
      }
    } catch (err: any) {
      return {
        success: false,
        draft: {
          id: draftId || `draft-${Date.now()}`,
          createdAt: new Date().toISOString(),
          leadId: null,
          recipientName,
          recipientEmail,
          recipientPhone: null,
          purpose: purpose || 'Follow-up Email',
          subject,
          body,
          status: 'draft',
          usedCallAndChatMemory: false,
        },
        error: err?.message || 'Failed to send email',
      };
    }

    const drafts = await this.getEmailDrafts(userId);
    let updatedDraft: AiEmailDraft | undefined;

    if (draftId) {
      const idx = drafts.findIndex((d) => d.id === draftId);
      if (idx !== -1) {
        drafts[idx] = {
          ...drafts[idx],
          recipientName,
          recipientEmail,
          subject,
          body,
          status: 'sent',
          sentAt: new Date().toISOString(),
        };
        updatedDraft = drafts[idx];
      }
    }

    if (!updatedDraft) {
      updatedDraft = {
        id: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        createdAt: new Date().toISOString(),
        leadId: null,
        recipientName,
        recipientEmail,
        recipientPhone: null,
        purpose: purpose || 'Follow-up Email',
        subject,
        body,
        status: 'sent',
        sentAt: new Date().toISOString(),
        usedCallAndChatMemory: true,
      };
      drafts.unshift(updatedDraft);
    }

    await this.writeJsonStore(userId, EMAIL_DRAFTS_KEY, 'AI Email Assistant Drafts', drafts.slice(0, 80));
    return { success: true, draft: updatedDraft };
  }
}
