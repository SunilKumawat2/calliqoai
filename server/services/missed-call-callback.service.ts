'use strict';
/**
 * ============================================================
 * MissedCallCallbackService - Phase 1 / Module 1
 * Automatically detects missed/unanswered calls (inbound & outbound)
 * - Captures lead in CRM under "Missed Call / Follow-up"
 * - Sends instant WhatsApp acknowledgment to caller
 * - Schedules automatic AI callback within 1-2 minutes
 * ============================================================
 */

import { db } from '../db';
import { eq, and, or, sql, desc } from 'drizzle-orm';
import { 
  leads, 
  scheduledFollowUps, 
  crmWhitelabelConfigs, 
  agents, 
  plivoPhoneNumbers, 
  phoneNumbers, 
  incomingConnections, 
  campaigns,
  users,
  calls,
  plivoCalls
} from '../../shared/schema';
import { logger } from '../utils/logger';

// In-memory cooldown set to prevent multiple triggers for the same caller within 10 minutes
const _recentMissedCallCoolDown = new Set<string>();

export interface MissedCallParams {
  callId: string;
  engine: 'plivo-openai' | 'plivo-elevenlabs' | 'twilio-openai' | 'sip';
  direction: 'inbound' | 'outbound';
  fromNumber: string;
  toNumber: string;
  userId: string;
  agentId?: string | null;
  campaignId?: string | null;
  incomingConnectionId?: string | null;
  status: string; // 'no-answer', 'busy', 'failed', 'canceled', etc.
  hangupCause?: string | null;
}

export class MissedCallCallbackService {
  /**
   * Main entrypoint: process any call that ended in an unanswered / missed status
   */
  static async handleMissedCall(params: MissedCallParams): Promise<{
    scheduledFollowUpId?: string;
    leadId?: string;
    whatsappSent?: boolean;
  } | null> {
    try {
      const {
        callId,
        engine,
        direction,
        fromNumber,
        toNumber,
        userId,
        status,
      } = params;

      // 1. Identify customer phone number
      const rawCustomerPhone = direction === 'inbound' ? fromNumber : toNumber;
      let cleanPhone = (rawCustomerPhone || '').trim().replace(/^(whatsapp:|tel:)/i, '');
      if (cleanPhone && !cleanPhone.startsWith('+')) {
        cleanPhone = `+${cleanPhone}`;
      }

      if (!cleanPhone || cleanPhone.replace(/\D/g, '').length < 6) {
        logger.warn(`[MissedCallService] Skipping invalid customer phone: "${rawCustomerPhone}" for call ${callId}`);
        return null;
      }

      // 2. Cooldown check: Prevent duplicate callbacks if customer rings multiple times within 1 minute
      const coolDownKey = `${userId}:${cleanPhone}`;
      if (_recentMissedCallCoolDown.has(coolDownKey)) {
        console.log(`⏳ [MissedCallService] Cooldown active for ${cleanPhone}. Skipping duplicate auto-callback.`);
        return null;
      }
      _recentMissedCallCoolDown.add(coolDownKey);
      setTimeout(() => _recentMissedCallCoolDown.delete(coolDownKey), 60 * 1000);

      console.log(`🔔 [MissedCallService] Processing missed ${direction} call for ${cleanPhone} (Call: ${callId}, Status: ${status})`);

      // 3. Check White-Label / Business settings for this workspace
      let businessName = 'Our Office';
      let appointmentTerm = 'Appointment';
      let callbackEnabled = true;
      let delaySeconds = 90; // Default: 1.5 minutes
      let whatsappEnabled = true;

      try {
        const [config] = await db
          .select()
          .from(crmWhitelabelConfigs)
          .where(eq(crmWhitelabelConfigs.userId, userId))
          .limit(1);

        if (config) {
          businessName = config.businessName || businessName;
          appointmentTerm = config.appointmentTerm || appointmentTerm;
          callbackEnabled = config.missedCallCallbackEnabled !== false;
          delaySeconds = config.missedCallDelaySeconds || 90;
          whatsappEnabled = config.missedCallWhatsappEnabled !== false;
        }
      } catch (err: any) {
        console.warn(`[MissedCallService] Error reading white-label config: ${err.message}`);
      }

      if (!callbackEnabled) {
        console.log(`[MissedCallService] Auto-callback is disabled for user ${userId}`);
        return null;
      }

      // 3b. Check Campaign-level Auto-FollowUp / Retry setting (Active vs Inactive)
      let resolvedCampaignId = params.campaignId || null;
      if (!resolvedCampaignId && params.callId) {
        try {
          const [callRec] = await db
            .select({ campaignId: calls.campaignId })
            .from(calls)
            .where(eq(calls.id, params.callId))
            .limit(1)
            .catch(() => []);
          if (callRec?.campaignId) {
            resolvedCampaignId = callRec.campaignId;
          } else {
            const [plivoRec] = await db
              .select({ campaignId: plivoCalls.campaignId })
              .from(plivoCalls)
              .where(eq(plivoCalls.id, params.callId))
              .limit(1)
              .catch(() => []);
            if (plivoRec?.campaignId) resolvedCampaignId = plivoRec.campaignId;
          }
        } catch (_) {}
      }

      if (resolvedCampaignId) {
        try {
          const [camp] = await db
            .select({ autoFollowUpEnabled: campaigns.autoFollowUpEnabled, name: campaigns.name })
            .from(campaigns)
            .where(eq(campaigns.id, resolvedCampaignId))
            .limit(1);

          if (camp && camp.autoFollowUpEnabled === false) {
            console.log(`[MissedCallService] Skipping auto-callback: Campaign "${camp.name}" (${resolvedCampaignId}) has Auto-FollowUp / Retry set to Inactive (autoFollowUpEnabled: false).`);
            return null;
          }
        } catch (campErr: any) {
          console.warn(`[MissedCallService] Error checking campaign autoFollowUpEnabled: ${campErr.message}`);
        }
      }

      // 4. Resolve Agent ID
      let resolvedAgentId = params.agentId || null;
      if (!resolvedAgentId && direction === 'inbound') {
        // Try looking up assigned agent from plivoPhoneNumbers or incomingConnections
        try {
          const last10 = cleanPhone.replace(/\D/g, '').slice(-10);
          const [plivoPhone] = await db
            .select({ assignedAgentId: plivoPhoneNumbers.assignedAgentId })
            .from(plivoPhoneNumbers)
            .where(
              or(
                eq(plivoPhoneNumbers.phoneNumber, toNumber),
                sql`REPLACE(${plivoPhoneNumbers.phoneNumber}, '+', '') LIKE ${`%${last10}`}`
              )
            )
            .limit(1);

          if (plivoPhone?.assignedAgentId) {
            resolvedAgentId = plivoPhone.assignedAgentId;
          }
        } catch (_) {}
      }

      // Fallback: Pick any active agent for this user if none specified
      if (!resolvedAgentId) {
        try {
          const [firstAgent] = await db
            .select({ id: agents.id })
            .from(agents)
            .where(eq(agents.userId, userId))
            .limit(1);
          if (firstAgent) resolvedAgentId = firstAgent.id;
        } catch (_) {}
      }

      // 5. CRM Lead Management: Create or Update Lead
      let leadId: string | undefined;
      let customerName: string | null = null;
      try {
        const last10 = cleanPhone.replace(/\D/g, '').slice(-10);
        const [existingLead] = await db
          .select()
          .from(leads)
          .where(
            and(
              eq(leads.userId, userId),
              or(
                eq(leads.phone, cleanPhone),
                sql`RIGHT(REGEXP_REPLACE(${leads.phone}, '[^0-9]', '', 'g'), 10) = ${last10}`
              )
            )
          )
          .limit(1);

        const timeStr = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });

        if (existingLead) {
          leadId = existingLead.id;
          customerName = [existingLead.firstName, existingLead.lastName].filter(Boolean).join(' ').trim() || null;
          
          await db
            .update(leads)
            .set({
              hasCallback: true,
              aiSummary: `Missed call at ${timeStr}. Auto-callback queued in ${Math.round(delaySeconds / 60)} min.`,
              updatedAt: new Date(),
            })
            .where(eq(leads.id, existingLead.id));
          console.log(`📋 [MissedCallService] Updated existing CRM lead ${leadId} for missed call`);
        } else {
          const [newLead] = await db
            .insert(leads)
            .values({
              userId,
              phone: cleanPhone,
              sourceType: direction === 'inbound' ? 'incoming' : 'campaign',
              stage: 'new',
              leadScore: 60,
              aiCategory: 'missed_call',
              hasCallback: true,
              aiSummary: `Missed call received at ${timeStr}. Auto-callback scheduled in ${Math.round(delaySeconds / 60)} min.`,
            })
            .returning();
          leadId = newLead?.id;
          console.log(`📋 [MissedCallService] Created new CRM lead ${leadId} for missed call from ${cleanPhone}`);
        }
      } catch (crmErr: any) {
        console.warn(`[MissedCallService] CRM lead update notice: ${crmErr.message}`);
      }

      // 6. Schedule Auto-Callback in scheduledFollowUps table
      let scheduledFollowUpId: string | undefined;
      const scheduledAt = new Date(Date.now() + Math.max(30, delaySeconds) * 1000);

      // Verify no pending follow-up is already waiting
      const [existingPending] = await db
        .select({ id: scheduledFollowUps.id })
        .from(scheduledFollowUps)
        .where(
          and(
            eq(scheduledFollowUps.userId, userId),
            eq(scheduledFollowUps.phoneNumber, cleanPhone),
            eq(scheduledFollowUps.status, 'pending')
          )
        )
        .limit(1);

      if (existingPending) {
        console.log(`[MissedCallService] Follow-up already pending (${existingPending.id}), bringing scheduled time forward to ${delaySeconds}s`);
        await db
          .update(scheduledFollowUps)
          .set({ 
            scheduledAt, 
            preferredTimeText: direction === 'outbound' ? 'Outbound Unanswered Auto-Retry' : 'Missed Call Auto-Callback',
            contextNote: direction === 'outbound'
              ? `Outbound call from ${businessName} at ${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })} was not answered (busy/no-answer). Calling back automatically to connect and qualify.`
              : `Missed call callback. Caller rang at ${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })} but call was unanswered. Calling back automatically to assist and qualify.`,
            updatedAt: new Date() 
          })
          .where(eq(scheduledFollowUps.id, existingPending.id));
        scheduledFollowUpId = existingPending.id;
      } else {
        const [newFollowUp] = await db
          .insert(scheduledFollowUps)
          .values({
            userId,
            agentId: resolvedAgentId,
            campaignId: params.campaignId || null,
            callId: params.callId,
            phoneNumber: cleanPhone,
            customerName,
            preferredTimeText: direction === 'outbound' ? 'Outbound Unanswered Auto-Retry' : 'Missed Call Auto-Callback',
            contextNote: direction === 'outbound'
              ? `Outbound call from ${businessName} at ${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })} was not answered (busy/no-answer). Calling back automatically to connect and qualify.`
              : `Missed call callback. Caller rang at ${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })} but call was unanswered. Calling back automatically to assist and qualify.`,
            scheduledAt,
            status: 'pending',
          })
          .returning();
        scheduledFollowUpId = newFollowUp?.id;
        console.log(`⏰ [MissedCallService] Scheduled auto-callback in ${delaySeconds}s (id: ${scheduledFollowUpId}) for ${cleanPhone}`);
      }

      // 7. Instant WhatsApp Acknowledgment to Customer
      let whatsappSent = false;
      if (whatsappEnabled) {
        try {
          const { metaWhatsAppService } = await import('../../plugins/messaging/services/meta-whatsapp.service').catch(() => ({ metaWhatsAppService: null as any }));
          if (metaWhatsAppService && typeof metaWhatsAppService.sendTextMessage === 'function') {
            const defaultMsg = direction === 'outbound'
              ? `नमस्ते! हमने आपको ${businessName} से कॉल किया था, लेकिन किसी वजह से आपसे बात नहीं हो पाई। हमारा AI असिस्टेंट आपको अगले 1-2 मिनट में दोबारा कॉल करेगा। आप चाहें तो सीधे यहीं पर रिप्लाई करके भी बात कर सकते हैं!`
              : `नमस्ते! आपने ${businessName} पर कॉल किया था, लेकिन किसी वजह से कॉल कनेक्ट नहीं हो पाया। हमारा AI असिस्टेंट आपको अगले 1-2 मिनट में वापस कॉल करेगा। आप चाहें तो सीधे यहीं पर रिप्लाई करके भी बात कर सकते हैं!`;
            
            const messageBody = customWaMessage
              ? customWaMessage.replace(/{businessName}/g, businessName)
              : defaultMsg;
            
            await metaWhatsAppService.sendTextMessage(userId, cleanPhone, messageBody);
            whatsappSent = true;
            console.log(`📱 [MissedCallService] Sent instant missed-call WhatsApp message to ${cleanPhone}`);
          }
        } catch (waErr: any) {
          // WhatsApp delivery failure shouldn't block calling workflow
          console.log(`ℹ️ [MissedCallService] WhatsApp notice (optional): ${waErr?.message || waErr}`);
        }
      }

      return {
        scheduledFollowUpId,
        leadId,
        whatsappSent,
      };
    } catch (error: any) {
      logger.error(`[MissedCallService] Unhandled error: ${error.message}`, error, 'MissedCall');
      return null;
    }
  }
}

