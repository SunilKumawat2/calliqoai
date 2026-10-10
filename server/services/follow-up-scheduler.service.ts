'use strict';
/**
 * FollowUpSchedulerService - Automated AI Follow-Up Calling Service
 * 
 * Manages detection, scheduling, queueing, and automatic triggering of
 * callback requests from leads across campaigns and inbound/outbound calls.
 */

import { db } from '../db';
import { eq, and, lte, desc, sql } from 'drizzle-orm';
import { scheduledFollowUps, calls, plivoCalls, agents, plivoPhoneNumbers, users, contacts, campaigns, type ScheduledFollowUp } from '../../shared/schema';
import { logger } from '../utils/logger';
import { PlivoCallService } from '../engines/plivo/services/plivo-call.service';
import type { OpenAIVoice, OpenAIRealtimeModel } from '../engines/plivo/types/plivo.types';

export class FollowUpSchedulerService {
  private static isRunning = false;
  private static timer: NodeJS.Timeout | null = null;
  private static isProcessing = false;

  /**
   * Parse relative time text into a concrete Javascript Date
   * Handles: "10 minute baad", "in 2 hours", "after 5 PM", "tomorrow 10 AM", "kal 5 baje", "shaam 6 baje", "दस मिनट बाद", "1 din baad", "4 hours", etc.
   */
  static parseFollowUpTime(timeText?: string | null, isoHint?: string | null, userTimezone: string = 'Asia/Kolkata'): Date {
    const now = new Date();
    
    // If a valid ISO string is already provided and in future, use it
    if (isoHint) {
      const parsed = new Date(isoHint);
      if (!isNaN(parsed.getTime()) && parsed.getTime() > now.getTime() - 60000 && parsed.getTime() < now.getTime() + 30 * 24 * 3600 * 1000) {
        return parsed;
      }
    }

    if (!timeText || typeof timeText !== 'string') {
      // Default: 2 hours from now
      return new Date(now.getTime() + 2 * 60 * 60 * 1000);
    }

    let text = timeText.toLowerCase().trim();

    // Convert Devanagari digits ०-९ to 0-9
    const devDigits = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'];
    for (let i = 0; i < 10; i++) {
      text = text.replaceAll(devDigits[i], String(i));
    }

    // Normalize speech recognition variations
    text = text.replace(/बज़|बजे|बज़े|बजकर|बज़कर/gi, 'बज');
    text = text.replace(/मिनेट|फिल्ट|वीट|मिल्ट|मिंट|मिनिट/gi, 'मिनट');
    text = text.replace(/कौल|कोल/gi, 'कॉल');

    // Map Hindi numerals & words to numbers
    const hindiNumberMap: Record<string, string> = {
      'आधा': '0.5',
      'आधे': '0.5',
      'aadha': '0.5',
      'aadhe': '0.5',
      'डेढ़': '1.5',
      'dedh': '1.5',
      'ढाई': '2.5',
      'dhai': '2.5',
      'एक': '1',
      'ek': '1',
      'दो': '2',
      'do': '2',
      'तीन': '3',
      'teen': '3',
      'चार': '4',
      'chaar': '4',
      'पांच': '5',
      'पाँच': '5',
      'panch': '5',
      'paanch': '5',
      'छह': '6',
      'छः': '6',
      'chheh': '6',
      'सात': '7',
      'saat': '7',
      'आठ': '8',
      'aath': '8',
      'नौ': '9',
      'nau': '9',
      'दस': '10',
      'das': '10',
      'dus': '10',
      'पंद्रह': '15',
      'pandrah': '15',
      'बीस': '20',
      'bees': '20',
      'पच्चीस': '25',
      'pachees': '25',
      'तीस': '30',
      'tees': '30',
      'पैंतालीस': '45',
      'paintalis': '45',
    };

    for (const [hindiWord, num] of Object.entries(hindiNumberMap)) {
      const regex = new RegExp(`\\b${hindiWord}\\b|${hindiWord}`, 'gi');
      text = text.replace(regex, num);
    }

    // 1. Specific time today or tomorrow in user's timezone (e.g. "10:52", "10 बज के 52 मिनट", "5 PM", "shaam 5 baje", "कल 4 बजे")
    const isTomorrow = text.includes('tomorrow') || text.includes('kal') || text.includes('कल') || text.includes('next day') || text.includes('agle din');
    const isEvening = text.includes('pm') || text.includes('shaam') || text.includes('शाम') || text.includes('dopahar') || text.includes('दोपहर') || text.includes('evening') || text.includes('afternoon') || text.includes('raat') || text.includes('रात');
    const isMorning = text.includes('am') || text.includes('subah') || text.includes('सुबह') || text.includes('morning');

    const specificTimeMatch = text.match(/(\d{1,2})\s*(?::|बज\s*के|बज\s*कर|बज)\s*(\d{1,2})\s*(?:मिनट|min)?/i) || 
                              text.match(/(\d{1,2})\s*(?::|बज\s*के|बज\s*कर|बज)\s*(\d{1,2})?/i) ||
                              text.match(/(\d{1,2})\s*(?:baje|बजे|o'clock)\s*(\d{1,2})?/i);

    if (specificTimeMatch) {
      let hour = parseInt(specificTimeMatch[1], 10);
      const minute = specificTimeMatch[2] ? parseInt(specificTimeMatch[2], 10) : 0;
      const meridiem = text.includes('pm') ? 'pm' : (text.includes('am') ? 'am' : undefined);

      if (meridiem === 'pm' && hour < 12) hour += 12;
      if (meridiem === 'am' && hour === 12) hour = 0;
      if (!meridiem && isEvening && hour < 12) hour += 12;
      if (!meridiem && isMorning && hour === 12) hour = 0;

      // Get current local date/time in user's timezone (e.g. Asia/Kolkata)
      try {
        const formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: userTimezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        });
        
        const parts = formatter.formatToParts(now);
        const pMap: Record<string, string> = {};
        for (const p of parts) pMap[p.type] = p.value;

        const localYear = parseInt(pMap.year, 10);
        const localMonth = parseInt(pMap.month, 10) - 1;
        let localDay = parseInt(pMap.day, 10);
        const currentLocalHour = parseInt(pMap.hour, 10);

        if (!meridiem && !isMorning && !isEvening && hour >= 1 && hour <= 7 && currentLocalHour >= 8) {
          hour += 12;
        }

        if (isTomorrow) {
          localDay += 1;
        }

        const tzOffsetMs = 5.5 * 60 * 60 * 1000; // Asia/Kolkata is UTC+5:30
        const localTargetUtcEpoch = Date.UTC(localYear, localMonth, localDay, hour, minute, 0) - tzOffsetMs;
        let targetDate = new Date(localTargetUtcEpoch);

        if (targetDate.getTime() <= now.getTime() - 60000) {
          if (!isTomorrow) {
            targetDate = new Date(localTargetUtcEpoch + 24 * 60 * 60 * 1000);
          }
        }
        return targetDate;
      } catch {
        // Fallback to basic offset
      }
    }

    // 2. Minutes relative: "5 min baad", "5 मिनट बाद", "3-4 मिनट", "in 10 min", "0.5 ghanta" (30 mins)
    const minMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:min|mins|minute|minutes|मिनट)/i);
    if (minMatch) {
      const mins = parseFloat(minMatch[1]) || 15;
      return new Date(now.getTime() + Math.round(mins * 60 * 1000));
    }

    // 3. Hours relative: "2 ghante baad", "1.5 ghanta", "in 2 hours", "4 hours later", "2 घंटे"
    const hoursMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:hour|hours|hr|hrs|ghante|ghanta|घंटे|घंटा|h\b)/i);
    if (hoursMatch) {
      const hours = parseFloat(hoursMatch[1]) || 2;
      return new Date(now.getTime() + Math.round(hours * 60 * 60 * 1000));
    }

    // 4. Days relative: "1 din baad", "2 din", "in 1 day", "1 दिन"
    const daysMatch = text.match(/(\d+)\s*(?:day|days|din|दिन|d\b)/i);
    if (daysMatch) {
      const days = parseInt(daysMatch[1], 10) || 1;
      return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    }

    // 5. "Tomorrow" / "Kal" general without specific time
    if (isTomorrow) {
      const target = new Date(now);
      target.setDate(target.getDate() + 1);
      target.setHours(11, 0, 0, 0); // Default to 11:00 AM tomorrow
      return target;
    }

    // Fallback: 2 hours from now
    return new Date(now.getTime() + 2 * 60 * 60 * 1000);
  }

  /**
   * Schedule a follow-up call record
   */
  static async scheduleFollowUp(params: {
    userId: string;
    campaignId?: string | null;
    contactId?: string | null;
    callId?: string | null;
    agentId?: string | null;
    phoneNumber: string;
    customerName?: string | null;
    preferredTimeText?: string | null;
    scheduledAt?: Date | null;
    contextNote?: string | null;
  }): Promise<ScheduledFollowUp> {
    const scheduledAt = params.scheduledAt || this.parseFollowUpTime(params.preferredTimeText);

    // Check if there's already an existing pending follow-up for this call or phone
    if (params.callId) {
      const [existing] = await db
        .select()
        .from(scheduledFollowUps)
        .where(
          and(
            eq(scheduledFollowUps.callId, params.callId),
            eq(scheduledFollowUps.status, 'pending')
          )
        )
        .limit(1);

      if (existing) {
        // Update existing pending follow-up
        const [updated] = await db
          .update(scheduledFollowUps)
          .set({
            scheduledAt,
            preferredTimeText: params.preferredTimeText || existing.preferredTimeText,
            customerName: params.customerName || existing.customerName,
            contextNote: params.contextNote || existing.contextNote,
            updatedAt: new Date(),
          })
          .where(eq(scheduledFollowUps.id, existing.id))
          .returning();

        logger.info(`Updated existing follow-up ${existing.id} for call ${params.callId}`, { scheduledAt }, 'FollowUpScheduler');
        return updated;
      }
    }

    // Insert new scheduled follow-up
    const [inserted] = await db
      .insert(scheduledFollowUps)
      .values({
        userId: params.userId,
        campaignId: params.campaignId || null,
        contactId: params.contactId || null,
        callId: params.callId || null,
        agentId: params.agentId || null,
        phoneNumber: params.phoneNumber,
        customerName: params.customerName || null,
        scheduledAt,
        preferredTimeText: params.preferredTimeText || null,
        contextNote: params.contextNote || null,
        status: 'pending',
      })
      .returning();

    logger.info(`Scheduled automated follow-up ${inserted.id} for ${params.phoneNumber} at ${scheduledAt.toISOString()}`, {
      callId: params.callId,
      customerName: params.customerName,
    }, 'FollowUpScheduler');

    return inserted;
  }

  static async scheduleFromInsights(params: {
    callId: string;
    userId?: string | null;
    agentId?: string | null;
    campaignId?: string | null;
    contactId?: string | null;
    phoneNumber?: string | null;
    customerName?: string | null;
    preferredTimeText?: string | null;
    isoHint?: string | null;
    contextNote?: string | null;
  }): Promise<ScheduledFollowUp | null> {
    try {
      let userId = params.userId || null;
      let agentId = params.agentId || null;
      let campaignId = params.campaignId || null;
      let contactId = params.contactId || null;
      let phoneNumber = params.phoneNumber || null;
      let customerName = params.customerName || null;

      // If missing details or to ensure correct destination phone number, look up call in DB
      if (params.callId) {
        const [callRec] = await db
          .select()
          .from(calls)
          .where(eq(calls.id, params.callId))
          .limit(1)
          .catch(() => []);

        if (callRec) {
          userId = userId || callRec.userId;
          agentId = agentId || callRec.agentId;
          campaignId = campaignId || callRec.campaignId;
          contactId = contactId || callRec.contactId;

          // For outbound campaign calls, the customer is the toNumber, not the fromNumber!
          const isIncoming = callRec.callDirection === 'incoming';
          if (isIncoming) {
            phoneNumber = callRec.fromNumber || callRec.phoneNumber || phoneNumber;
          } else {
            phoneNumber = callRec.toNumber || callRec.phoneNumber || phoneNumber;
          }
        }
      }

      // If contactId is present, verify customer name and phone
      if (contactId) {
        const [contactRec] = await db
          .select()
          .from(contacts)
          .where(eq(contacts.id, contactId))
          .limit(1)
          .catch(() => []);

        if (contactRec) {
          if (contactRec.phone) phoneNumber = contactRec.phone;
          const fullName = [contactRec.firstName, contactRec.lastName].filter(Boolean).join(' ').trim();
          if (fullName && fullName.toLowerCase() !== 'unknown') {
            customerName = customerName || fullName;
          }
        }
      }

      if (!userId || !phoneNumber) {
        logger.warn(`Cannot auto-schedule follow-up: missing userId or phoneNumber for call ${params.callId}`, undefined, 'FollowUpScheduler');
        return null;
      }

      const scheduledAt = this.parseFollowUpTime(params.preferredTimeText, params.isoHint);
      return await this.scheduleFollowUp({
        userId,
        campaignId,
        contactId,
        callId: params.callId,
        agentId,
        phoneNumber,
        customerName,
        preferredTimeText: params.preferredTimeText,
        scheduledAt,
        contextNote: params.contextNote || `Customer requested a follow-up callback.`,
      });
    } catch (err: any) {
      logger.error(`Failed to auto-schedule follow-up for call ${params.callId}: ${err.message}`, undefined, 'FollowUpScheduler');
      return null;
    }
  }

  /**
   * Fetch all scheduled follow-ups with optional filters
   */
  static async getFollowUps(filter: {
    userId: string;
    callId?: string;
    campaignId?: string;
    status?: string;
  }): Promise<ScheduledFollowUp[]> {
    const conditions = [eq(scheduledFollowUps.userId, filter.userId)];

    if (filter.callId) {
      conditions.push(eq(scheduledFollowUps.callId, filter.callId));
    }
    if (filter.campaignId) {
      conditions.push(eq(scheduledFollowUps.campaignId, filter.campaignId));
    }
    if (filter.status && filter.status !== 'all') {
      conditions.push(eq(scheduledFollowUps.status, filter.status));
    }

    return await db
      .select()
      .from(scheduledFollowUps)
      .where(and(...conditions))
      .orderBy(desc(scheduledFollowUps.scheduledAt));
  }

  /**
   * Update follow-up (reschedule or edit note)
   */
  static async updateFollowUp(
    id: string,
    userId: string,
    updates: {
      scheduledAt?: Date | string;
      preferredTimeText?: string;
      contextNote?: string;
      status?: string;
    }
  ): Promise<ScheduledFollowUp | null> {
    const [existing] = await db
      .select()
      .from(scheduledFollowUps)
      .where(and(eq(scheduledFollowUps.id, id), eq(scheduledFollowUps.userId, userId)))
      .limit(1);

    if (!existing) return null;

    const data: Partial<typeof scheduledFollowUps.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (updates.scheduledAt) {
      data.scheduledAt = new Date(updates.scheduledAt);
    }
    if (updates.preferredTimeText !== undefined) {
      data.preferredTimeText = updates.preferredTimeText;
    }
    if (updates.contextNote !== undefined) {
      data.contextNote = updates.contextNote;
    }
    if (updates.status !== undefined) {
      data.status = updates.status;
    }

    const [updated] = await db
      .update(scheduledFollowUps)
      .set(data)
      .where(eq(scheduledFollowUps.id, id))
      .returning();

    return updated;
  }

  /**
   * Cancel follow-up
   */
  static async cancelFollowUp(id: string, userId: string): Promise<boolean> {
    const [updated] = await db
      .update(scheduledFollowUps)
      .set({
        status: 'cancelled',
        updatedAt: new Date(),
      })
      .where(and(eq(scheduledFollowUps.id, id), eq(scheduledFollowUps.userId, userId)))
      .returning();

    return !!updated;
  }

  /**
   * Trigger follow-up call immediately (either on scheduled time or manual 'Call Now' action)
   */
  static async triggerFollowUp(id: string, triggerUserId?: string): Promise<{ success: boolean; callId?: string; error?: string }> {
    try {
      const [followUp] = await db
        .select()
        .from(scheduledFollowUps)
        .where(eq(scheduledFollowUps.id, id))
        .limit(1);

      if (!followUp) {
        return { success: false, error: 'Follow-up record not found' };
      }

      if (triggerUserId && followUp.userId !== triggerUserId) {
        return { success: false, error: 'Unauthorized access' };
      }

      if (followUp.status === 'completed') {
        return { success: false, error: 'Follow-up is already completed' };
      }

      // Mark as in_progress
      await db
        .update(scheduledFollowUps)
        .set({ status: 'in_progress', updatedAt: new Date() })
        .where(eq(scheduledFollowUps.id, id));

      // Resolve Agent & Telephony Phone Number
      let agentRecord: any = null;
      if (followUp.agentId) {
        const [a] = await db.select().from(agents).where(eq(agents.id, followUp.agentId)).limit(1);
        agentRecord = a;
      }

      // If agent not found via followUp.agentId, try to retrieve from original call record
      if (!agentRecord && followUp.callId) {
        const [callRec] = await db.select().from(calls).where(eq(calls.id, followUp.callId)).limit(1);
        if (callRec?.agentId) {
          const [a] = await db.select().from(agents).where(eq(agents.id, callRec.agentId)).limit(1);
          agentRecord = a;
        }
      }

      if (!agentRecord) {
        // Fallback to first available agent for user
        const [firstAgent] = await db.select().from(agents).where(eq(agents.userId, followUp.userId)).limit(1);
        agentRecord = firstAgent;
      }

      if (!agentRecord) {
        await db.update(scheduledFollowUps).set({
          status: 'failed',
          errorMessage: 'No active AI agent found for this follow-up call',
          updatedAt: new Date(),
        }).where(eq(scheduledFollowUps.id, id));
        return { success: false, error: 'No active AI agent found' };
      }

      // Resolve Outbound Plivo Phone Number (MUST be active!)
      let plivoPhone: any = null;
      // 1. Try finding active number assigned to user
      const userPhones = await db
        .select()
        .from(plivoPhoneNumbers)
        .where(
          and(
            eq(plivoPhoneNumbers.userId, followUp.userId),
            eq(plivoPhoneNumbers.status, 'active')
          )
        )
        .limit(1);

      if (userPhones.length > 0) {
        plivoPhone = userPhones[0];
      } else {
        // 2. Try any active phone in database
        const [anyPhone] = await db.select().from(plivoPhoneNumbers).where(eq(plivoPhoneNumbers.status, 'active')).limit(1);
        plivoPhone = anyPhone;
      }

      if (!plivoPhone) {
        await db.update(scheduledFollowUps).set({
          status: 'failed',
          errorMessage: 'No active outbound Plivo phone number configured on account',
          updatedAt: new Date(),
        }).where(eq(scheduledFollowUps.id, id));
        return { success: false, error: 'No active outbound Plivo phone number configured' };
      }

      // Resolve destination number (ensure it's the customer, not the Plivo fromNumber)
      let destinationNumber = followUp.phoneNumber;
      if (destinationNumber === plivoPhone.phoneNumber) {
        if (followUp.contactId) {
          const [contact] = await db.select().from(contacts).where(eq(contacts.id, followUp.contactId)).limit(1).catch(() => []);
          if (contact?.phone) destinationNumber = contact.phone;
        }
        if (destinationNumber === plivoPhone.phoneNumber && followUp.callId) {
          const [origCall] = await db.select().from(calls).where(eq(calls.id, followUp.callId)).limit(1).catch(() => []);
          if (origCall?.toNumber && origCall.toNumber !== plivoPhone.phoneNumber) {
            destinationNumber = origCall.toNumber;
          }
        }
      }

      // Construct Follow-up Context Injection Prompt & Initial Greeting
      const rawName = followUp.customerName?.trim() || '';
      const isGenericName = !rawName || ['customer', 'unknown', 'not mentioned', 'caller', 'user'].includes(rawName.toLowerCase());
      const customerName = isGenericName ? '' : rawName;
      const contextNote = followUp.contextNote || 'Customer requested a callback.';
      const preferredTime = followUp.preferredTimeText || 'इस समय';

      // Detect language preference (Hindi vs English)
      const isHindi = (agentRecord.language === 'hi') || 
                      /[\u0900-\u097F]/.test(agentRecord.systemPrompt || '') || 
                      /[\u0900-\u097F]/.test(contextNote) || 
                      /[\u0900-\u097F]/.test(preferredTime) ||
                      /namaste|kripya|baad|baje|karein|boliye|humne|baat/i.test(agentRecord.systemPrompt || '');

      let firstMessage = '';
      if (isHindi) {
        firstMessage = customerName
          ? `नमस्ते ${customerName} जी, मैं ${agentRecord.name || 'AI Assistant'} बात कर रहा हूँ। आपने पहले कहा था कि ${preferredTime} कॉल करें, तो क्या अभी आपसे बात करने का सही समय है?`
          : `नमस्ते, मैं ${agentRecord.name || 'AI Assistant'} बात कर रहा हूँ। आपने पहले कहा था कि ${preferredTime} कॉल करें, तो क्या अभी आपसे बात करने का सही समय है?`;
      } else {
        firstMessage = customerName
          ? `Hello ${customerName}, I am calling you back as you requested earlier (${preferredTime}). Is this a good time to speak?`
          : `Hello, I am calling you back as requested earlier (${preferredTime}). Is this a good time to speak?`;
      }

      const baseSystemPrompt = agentRecord.systemPrompt || 'You are a professional AI assistant.';
      const followUpContext = `\n\n[AUTOMATED FOLLOW-UP CALL MODE]:
You are now calling back ${customerName || 'the customer'} at ${destinationNumber} for a scheduled follow-up.
In the previous conversation, the customer was busy or requested a callback (${preferredTime}).
Previous context / notes from earlier call: "${contextNote}".

CRITICAL INSTRUCTIONS FOR THIS FOLLOW-UP CALL:
1. DO NOT restart from scratch with a generic cold sales pitch or introduce yourself as a stranger.
2. Your initial greeting explicitly references that you are calling them back at their requested time (${preferredTime}) and asks if this is a good time to speak.
3. If the customer says "हाँ बोलिए" / "Yes" / "I'm free" / "Tell me":
   - Directly resume the conversation from where it left off based on previous notes ("${contextNote}").
4. If the customer is STILL busy or driving:
   - Politely ask when would be a better time to call them back and confirm politely before ending the call.
5. Maintain a natural, warm, conversational, and helpful tone throughout.`;

      const voice = (agentRecord.openaiVoice || 'ash') as OpenAIVoice;
      const model = (agentRecord.llmModel || 'gpt-4o-realtime-preview-2024-12-17') as OpenAIRealtimeModel;

      // Initiate outbound Plivo call
      const { callUuid, plivoCall } = await PlivoCallService.initiateCall({
        fromNumber: plivoPhone.phoneNumber,
        toNumber: destinationNumber,
        userId: followUp.userId,
        campaignId: followUp.campaignId || undefined,
        contactId: followUp.contactId || undefined,
        agentId: agentRecord.id,
        plivoPhoneNumberId: plivoPhone.id,
        agentConfig: {
          voice,
          model,
          systemPrompt: `${baseSystemPrompt}${followUpContext}`,
          firstMessage,
        },
      });

      // Update follow-up record to completed
      await db
        .update(scheduledFollowUps)
        .set({
          status: 'completed',
          followUpCallId: plivoCall.id,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(scheduledFollowUps.id, id));

      logger.info(`Successfully triggered automated follow-up call ${id} -> call ${plivoCall.id}`, {
        phoneNumber: followUp.phoneNumber,
        callUuid,
      }, 'FollowUpScheduler');

      return { success: true, callId: plivoCall.id };
    } catch (err: any) {
      logger.error(`Error triggering follow-up call ${id}: ${err.message}`, undefined, 'FollowUpScheduler');
      await db
        .update(scheduledFollowUps)
        .set({
          status: 'failed',
          errorMessage: err.message || 'Call initiation failed',
          updatedAt: new Date(),
        })
        .where(eq(scheduledFollowUps.id, id))
        .catch(() => {});

      return { success: false, error: err.message };
    }
  }

  /**
   * Automatically scans recent completed calls that contain callback phrases
   * and ensures an AI follow-up is scheduled if requested by caller.
   */
  static async scanRecentCallsForFollowUps(): Promise<void> {
    try {
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
      const recentCalls = await db
        .select({
          id: calls.id,
          userId: calls.userId,
          campaignId: calls.campaignId,
          contactId: calls.contactId,
          agentId: calls.agentId,
          fromNumber: calls.fromNumber,
          toNumber: calls.toNumber,
          duration: calls.duration,
          transcript: calls.transcript,
          metadata: calls.metadata,
        })
        .from(calls)
        .where(
          and(
            eq(calls.status, 'completed'),
            sql`${calls.createdAt} >= ${fifteenMinutesAgo}`,
            sql`${calls.transcript} IS NOT NULL`
          )
        )
        .limit(10);

      for (const c of recentCalls) {
        if (!c.transcript || c.transcript.length < 25) continue;
        
        // Fast keyword check for callback intent in transcript
        const hasCallbackIntent = /बाद|minute|min|घंटे|कॉल\s*करना|कॉल\s*कर|call\s*back|later|tomorrow|कल|बजे|baje/i.test(c.transcript);
        if (!hasCallbackIntent) continue;

        // Check if follow-up is already recorded for this call
        const [existing] = await db
          .select({ id: scheduledFollowUps.id })
          .from(scheduledFollowUps)
          .where(eq(scheduledFollowUps.callId, c.id))
          .limit(1);

        if (existing) continue;

        // Call insights to parse intent and schedule
        const { CallInsightsService } = await import('./call-insights.service');
        await CallInsightsService.analyzeTranscript(
          c.transcript,
          {
            callId: c.id,
            userId: c.userId || undefined,
            agentId: c.agentId || undefined,
            campaignId: c.campaignId || undefined,
            contactId: c.contactId || undefined,
            fromNumber: c.fromNumber || undefined,
            toNumber: c.toNumber || undefined,
            duration: c.duration || undefined,
          }
        ).catch(() => null);
      }
    } catch (err: any) {
      logger.error(`Error in scanRecentCallsForFollowUps: ${err.message}`, undefined, 'FollowUpScheduler');
    }
  }

  /**
   * Main scheduler interval worker: queries pending follow-ups due now and fires calls
   */
  static async processDueFollowUps(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      // 1. Scan any recent completed calls with transcripts for callback requests
      await this.scanRecentCallsForFollowUps().catch(() => {});

      const now = new Date();
      // Find all pending follow-ups where scheduledAt <= now
      const dueFollowUps = await db
        .select()
        .from(scheduledFollowUps)
        .where(
          and(
            eq(scheduledFollowUps.status, 'pending'),
            lte(scheduledFollowUps.scheduledAt, now)
          )
        )
        .limit(10); // Process in batches of 10 to manage concurrency

      if (dueFollowUps.length > 0) {
        logger.info(`Found ${dueFollowUps.length} due follow-up calls to process`, undefined, 'FollowUpScheduler');

        for (const item of dueFollowUps) {
          try {
            // If follow-up belongs to a campaign, check if automatic follow-up is enabled for that campaign
            if (item.campaignId) {
              const [campaignRec] = await db
                .select({ autoFollowUpEnabled: campaigns.autoFollowUpEnabled })
                .from(campaigns)
                .where(eq(campaigns.id, item.campaignId))
                .limit(1)
                .catch(() => []);

              if (campaignRec && campaignRec.autoFollowUpEnabled === false) {
                logger.info(`Skipping automated follow-up ${item.id} - autoFollowUpEnabled is inactive/false on campaign ${item.campaignId}`, undefined, 'FollowUpScheduler');
                continue;
              }
            }

            await this.triggerFollowUp(item.id);
          } catch (callErr: any) {
            logger.error(`Error executing follow-up ${item.id}: ${callErr.message}`, undefined, 'FollowUpScheduler');
          }
        }
      }
    } catch (err: any) {
      logger.error(`Error in processDueFollowUps loop: ${err.message}`, undefined, 'FollowUpScheduler');
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Start recurring background scheduler
   */
  static startScheduler(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    console.log('⏰ [FollowUpScheduler] Automated Follow-Up Calling Service started (checking every 30s)');

    // Run check every 30 seconds
    this.timer = setInterval(() => {
      this.processDueFollowUps().catch((err) => {
        logger.error(`Scheduler interval error: ${err.message}`, undefined, 'FollowUpScheduler');
      });
    }, 30000);

    // Also run immediate check on startup after a 10-second delay
    setTimeout(() => {
      this.processDueFollowUps().catch(() => {});
    }, 10000);
  }

  /**
   * Stop scheduler
   */
  static stopScheduler(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
  }
}
