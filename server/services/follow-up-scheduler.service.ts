'use strict';
/**
 * FollowUpSchedulerService - Automated AI Follow-Up Calling Service
 * 
 * Manages detection, scheduling, queueing, and automatic triggering of
 * callback requests from leads across campaigns and inbound/outbound calls.
 */

import { db } from '../db';
import { eq, and, lte, desc, sql } from 'drizzle-orm';
import { scheduledFollowUps, calls, plivoCalls, agents, plivoPhoneNumbers, users, contacts, type ScheduledFollowUp } from '../../shared/schema';
import { logger } from '../utils/logger';
import { PlivoCallService } from '../engines/plivo/services/plivo-call.service';
import type { OpenAIVoice, OpenAIRealtimeModel } from '../engines/plivo/types/plivo.types';

export class FollowUpSchedulerService {
  private static isRunning = false;
  private static timer: NodeJS.Timeout | null = null;
  private static isProcessing = false;

  /**
   * Parse relative time text into a concrete Javascript Date
   * Handles: "in 2 hours", "after 5 PM", "tomorrow 10 AM", "kal 5 baje", "shaam 6 baje", etc.
   */
  static parseFollowUpTime(timeText?: string | null, isoHint?: string | null): Date {
    const now = new Date();
    
    // If a valid ISO string is already provided and in future, use it
    if (isoHint) {
      const parsed = new Date(isoHint);
      if (!isNaN(parsed.getTime()) && parsed.getTime() > now.getTime() - 60000) {
        return parsed;
      }
    }

    if (!timeText || typeof timeText !== 'string') {
      // Default: 2 hours from now
      return new Date(now.getTime() + 2 * 60 * 60 * 1000);
    }

    const text = timeText.toLowerCase().trim();

    // 1. "in X hours" or "X hours later"
    const hoursMatch = text.match(/in\s+(\d+)\s+hour/i) || text.match(/(\d+)\s+ghante/i) || text.match(/(\d+)\s+hour/i);
    if (hoursMatch) {
      const hours = parseInt(hoursMatch[1], 10) || 2;
      return new Date(now.getTime() + hours * 60 * 60 * 1000);
    }

    // 2. "in X minutes"
    const minMatch = text.match(/in\s+(\d+)\s+min/i) || text.match(/(\d+)\s+minute/i);
    if (minMatch) {
      const mins = parseInt(minMatch[1], 10) || 30;
      return new Date(now.getTime() + mins * 60 * 1000);
    }

    // 3. Specific time today or tomorrow (e.g. "5 PM", "5:30 PM", "17:00", "shaam 5 baje", "subah 10 baje")
    const isTomorrow = text.includes('tomorrow') || text.includes('kal') || text.includes('next day');
    const isEvening = text.includes('pm') || text.includes('shaam') || text.includes('dopahar') || text.includes('evening') || text.includes('afternoon');
    const isMorning = text.includes('am') || text.includes('subah') || text.includes('morning');

    const timeDigitsMatch = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (timeDigitsMatch) {
      let hour = parseInt(timeDigitsMatch[1], 10);
      const minute = timeDigitsMatch[2] ? parseInt(timeDigitsMatch[2], 10) : 0;
      const meridiem = timeDigitsMatch[3]?.toLowerCase();

      if (meridiem === 'pm' && hour < 12) hour += 12;
      if (meridiem === 'am' && hour === 12) hour = 0;
      if (!meridiem && isEvening && hour < 12) hour += 12;
      if (!meridiem && isMorning && hour === 12) hour = 0;

      const target = new Date(now);
      if (isTomorrow) {
        target.setDate(target.getDate() + 1);
      }
      target.setHours(hour, minute, 0, 0);

      // If scheduled time has already passed today and 'tomorrow' was not explicitly mentioned, schedule for tomorrow or 2 hours later
      if (target.getTime() <= now.getTime()) {
        if (!isTomorrow) {
          target.setDate(target.getDate() + 1);
        } else {
          return new Date(now.getTime() + 2 * 60 * 60 * 1000);
        }
      }
      return target;
    }

    // 4. "Tomorrow" / "Kal" general
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
      let customerName = params.customerName;

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

      // Construct Follow-up Context Injection Prompt
      const customerName = followUp.customerName || 'Customer';
      const contextNote = followUp.contextNote || 'Customer requested a callback.';
      const preferredTime = followUp.preferredTimeText || 'at this time';

      const baseSystemPrompt = agentRecord.systemPrompt || 'You are a professional AI assistant.';
      const followUpContext = `\n\n[AUTOMATED FOLLOW-UP CALL CONTEXT]:
You are now calling back ${customerName} at ${destinationNumber} because during a previous call they requested to be called back (${preferredTime}).
Previous context / notes: "${contextNote}".
Guidelines:
1. Warmly greet ${customerName} and mention that you are calling back as requested earlier.
2. Politely confirm if this is a good time to speak.
3. Continue assisting them smoothly according to your core role and instructions.`;

      const voice = (agentRecord.openaiVoice || 'ash') as OpenAIVoice;
      const model = (agentRecord.llmModel || 'gpt-4o-realtime-preview-2024-12-17') as OpenAIRealtimeModel;

      // Personalized Opening Message
      let firstMessage = agentRecord.firstMessage || `Hello ${customerName}, I am calling you back as requested earlier. Is this a good time to talk?`;
      if (followUp.customerName) {
        firstMessage = `Hello ${followUp.customerName}, I am calling you back as you requested earlier. Is this a good time to talk?`;
      }

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
   * Main scheduler interval worker: queries pending follow-ups due now and fires calls
   */
  static async processDueFollowUps(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
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
