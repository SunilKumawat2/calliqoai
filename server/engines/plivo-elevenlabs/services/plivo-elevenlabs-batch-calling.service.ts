'use strict';
/**
 * ============================================================
 * Plivo-ElevenLabs Batch Calling Service
 * 
 * Manages bulk outbound calling campaigns via Plivo + ElevenLabs:
 * - Concurrent call management with rate limiting
 * - Pre-creates call records for tracking
 * - Integrates with ElevenLabs Conversational AI + Plivo SIP audio bridge
 * - Campaign progress tracking with real-time database updates
 * - ISOLATED from Plivo+OpenAI, Twilio+ElevenLabs, Twilio+OpenAI
 * ============================================================
 */

import { db } from '../../../db';
import { campaigns, contacts, plivoCalls, agents, plivoPhoneNumbers, plivoCredentials, users } from '@shared/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { PlivoElevenLabsOutboundService } from './outbound-call.service';
import { ElevenLabsPoolService } from '../../../services/elevenlabs-pool';
import { webhookDeliveryService } from '../../../services/webhook-delivery';
import { emailService } from '../../../services/email-service';
import { logger } from '../../../utils/logger';

type Campaign = typeof campaigns.$inferSelect;
type Contact = typeof contacts.$inferSelect;
type Agent = typeof agents.$inferSelect;
type PlivoPhoneNumber = typeof plivoPhoneNumbers.$inferSelect;

interface BatchCallConfig {
  campaignId: string;
  userId: string;
  agentId: string;
  phoneNumberId: string;
  maxConcurrentCalls: number;
  callDelayMs: number;
}

interface BatchJobResult {
  campaignId: string;
  status: 'completed' | 'failed' | 'cancelled';
  totalCalls: number;
  completedCalls: number;
  failedCalls: number;
  duration: number;
}

export class PlivoElevenLabsBatchCallingService {
  private activeCalls: Map<string, { callId: string; contactId: string; startTime: Date }> = new Map();
  private callQueue: Contact[] = [];
  private isProcessing: boolean = false;
  private isPaused: boolean = false;
  private isCancelled: boolean = false;
  private config: BatchCallConfig | null = null;
  private agent: Agent | null = null;
  private phoneNumber: PlivoPhoneNumber | null = null;
  private startTime: Date | null = null;
  private totalContacts: number = 0;
  private plivoAuthId: string = '';
  private plivoAuthToken: string = '';
  private elevenLabsApiKey: string = '';

  private static instances: Map<string, PlivoElevenLabsBatchCallingService> = new Map();

  private constructor() {}

  static getInstance(campaignId: string): PlivoElevenLabsBatchCallingService {
    if (!this.instances.has(campaignId)) {
      this.instances.set(campaignId, new PlivoElevenLabsBatchCallingService());
    }
    return this.instances.get(campaignId)!;
  }

  static removeInstance(campaignId: string): void {
    this.instances.delete(campaignId);
  }

  static getActiveInstances(): string[] {
    return Array.from(this.instances.keys());
  }

  /**
   * Execute a campaign using Plivo + ElevenLabs engine
   */
  async executeCampaign(campaignId: string): Promise<BatchJobResult> {
    logger.info(`Starting Plivo+ElevenLabs campaign execution: ${campaignId}`, undefined, 'PlivoElevenLabsBatch');

    try {
      const [campaign] = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.id, campaignId))
        .limit(1);

      if (!campaign) {
        throw new Error('Campaign not found');
      }

      if (!campaign.agentId) {
        throw new Error('Campaign has no agent configured');
      }

      const plivoPhoneNumberId = campaign.plivoPhoneNumberId;
      if (!plivoPhoneNumberId) {
        throw new Error('Campaign has no Plivo phone number configured. Please select a Plivo phone number.');
      }

      const [agent] = await db
        .select()
        .from(agents)
        .where(eq(agents.id, campaign.agentId))
        .limit(1);

      if (!agent) {
        throw new Error('Agent not found');
      }

      if (!agent.elevenLabsAgentId) {
        throw new Error('Agent has no ElevenLabs Agent ID configured. Please configure the ElevenLabs agent.');
      }

      const [phoneNumber] = await db
        .select()
        .from(plivoPhoneNumbers)
        .where(eq(plivoPhoneNumbers.id, plivoPhoneNumberId))
        .limit(1);

      if (!phoneNumber) {
        throw new Error('Plivo phone number not found');
      }

      // Resolve Plivo Credentials
      let plivoAuthId = process.env.PLIVO_AUTH_ID || '';
      let plivoAuthToken = process.env.PLIVO_AUTH_TOKEN || '';

      if (phoneNumber.plivoCredentialId) {
        const [cred] = await db
          .select()
          .from(plivoCredentials)
          .where(and(eq(plivoCredentials.id, phoneNumber.plivoCredentialId), eq(plivoCredentials.isActive, true)))
          .limit(1);
        if (cred) {
          plivoAuthId = cred.authId;
          plivoAuthToken = cred.authToken;
        }
      } else {
        const [primaryCred] = await db
          .select()
          .from(plivoCredentials)
          .where(and(eq(plivoCredentials.isPrimary, true), eq(plivoCredentials.isActive, true)))
          .limit(1);
        if (primaryCred) {
          plivoAuthId = primaryCred.authId;
          plivoAuthToken = primaryCred.authToken;
        }
      }

      if (!plivoAuthId || !plivoAuthToken) {
        throw new Error('Plivo credentials not configured. Please add Plivo credentials in admin settings.');
      }

      // Resolve ElevenLabs API key
      const elCred = await ElevenLabsPoolService.getCredentialForAgent(agent.id);
      const elevenLabsApiKey = elCred?.apiKey || process.env.ELEVENLABS_API_KEY || '';

      if (!elevenLabsApiKey) {
        throw new Error('No ElevenLabs API key found. Please configure ElevenLabs credentials in admin settings.');
      }

      this.plivoAuthId = plivoAuthId;
      this.plivoAuthToken = plivoAuthToken;
      this.elevenLabsApiKey = elevenLabsApiKey;
      this.agent = agent;
      this.phoneNumber = phoneNumber;

      const campaignContacts = await db
        .select()
        .from(contacts)
        .where(eq(contacts.campaignId, campaignId));

      if (campaignContacts.length === 0) {
        throw new Error('Campaign has no contacts');
      }

      this.totalContacts = campaignContacts.length;
      this.callQueue = [...campaignContacts];
      this.startTime = new Date();

      this.config = {
        campaignId,
        userId: campaign.userId,
        agentId: agent.id,
        phoneNumberId: phoneNumber.id,
        maxConcurrentCalls: 5,
        callDelayMs: 500,
      };

      const plivoElBatchJobId = `plivo_elevenlabs-${campaignId}`;

      await db
        .update(campaigns)
        .set({
          status: 'running',
          startedAt: new Date(),
          batchJobId: plivoElBatchJobId,
          batchJobStatus: 'running',
          totalContacts: campaignContacts.length,
        })
        .where(eq(campaigns.id, campaignId));

      await this.processQueue();

      const duration = this.startTime
        ? Math.floor((Date.now() - this.startTime.getTime()) / 1000)
        : 0;

      const finalStatusCounts = await db
        .select({
          status: contacts.status,
          count: sql<number>`count(*)::int`,
        })
        .from(contacts)
        .where(eq(contacts.campaignId, campaignId))
        .groupBy(contacts.status);

      const dbCompletedCount = finalStatusCounts.find(s => s.status === 'completed')?.count || 0;
      const dbFailedCount = finalStatusCounts.find(s => s.status === 'failed')?.count || 0;

      let finalStatus: 'completed' | 'failed' | 'cancelled' = 'completed';
      if (this.isCancelled) {
        finalStatus = 'cancelled';
      }

      const result: BatchJobResult = {
        campaignId,
        status: finalStatus,
        totalCalls: this.totalContacts,
        completedCalls: dbCompletedCount,
        failedCalls: dbFailedCount,
        duration,
      };

      await db
        .update(campaigns)
        .set({
          status: finalStatus,
          completedAt: new Date(),
          completedCalls: dbCompletedCount + dbFailedCount,
          successfulCalls: dbCompletedCount,
          failedCalls: dbFailedCount,
        })
        .where(eq(campaigns.id, campaignId));

      logger.info(`Plivo+ElevenLabs Campaign ${campaignId} finished`, undefined, 'PlivoElevenLabsBatch');
      PlivoElevenLabsBatchCallingService.removeInstance(campaignId);
      return result;
    } catch (error: any) {
      logger.error(`Plivo+ElevenLabs Campaign ${campaignId} failed: ${error.message}`, error, 'PlivoElevenLabsBatch');

      await db
        .update(campaigns)
        .set({
          status: 'failed',
          completedAt: new Date(),
        })
        .where(eq(campaigns.id, campaignId));

      PlivoElevenLabsBatchCallingService.removeInstance(campaignId);
      throw error;
    }
  }

  private async processQueue(): Promise<void> {
    this.isProcessing = true;

    while (this.callQueue.length > 0 && !this.isCancelled) {
      if (this.isPaused) {
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }

      while (this.activeCalls.size >= (this.config?.maxConcurrentCalls || 5)) {
        await new Promise(r => setTimeout(r, 1000));
      }

      const contact = this.callQueue.shift();
      if (!contact) break;

      try {
        await this.initiateCall(contact);
      } catch (err: any) {
        logger.error(`Error initiating call to ${contact.phone}: ${err?.message || err}`, undefined, 'PlivoElevenLabsBatch');
        await db
          .update(contacts)
          .set({ status: 'failed', lastAttemptAt: new Date() })
          .where(eq(contacts.id, contact.id));
      }

      if (this.config?.callDelayMs) {
        await new Promise(r => setTimeout(r, this.config.callDelayMs));
      }
    }

    // Wait for remaining active calls to finish
    while (this.activeCalls.size > 0 && !this.isCancelled) {
      await new Promise(r => setTimeout(r, 2000));
    }

    this.isProcessing = false;
  }

  private async initiateCall(contact: Contact): Promise<void> {
    if (!this.config || !this.agent || !this.phoneNumber) return;

    logger.info(`Initiating Plivo+ElevenLabs call to ${contact.phone}`, undefined, 'PlivoElevenLabsBatch');

    await db
      .update(contacts)
      .set({ status: 'in_progress', lastAttemptAt: new Date(), attemptCount: sql`COALESCE(attempt_count, 0) + 1` })
      .where(eq(contacts.id, contact.id));

    const agentConfigData = (this.agent.config as Record<string, any>) || {};

    const callResult = await PlivoElevenLabsOutboundService.makeCall({
      toNumber: contact.phone,
      fromNumber: this.phoneNumber.phoneNumber,
      agentId: this.agent.elevenLabsAgentId!,
      elevenLabsApiKey: this.elevenLabsApiKey,
      agentConfig: {
        agentId: this.agent.elevenLabsAgentId!,
        firstMessage: this.agent.firstMessage || undefined,
        language: this.agent.language || 'en',
        voiceId: this.agent.voiceId || undefined,
        dynamicData: {
          firstName: contact.firstName || '',
          lastName: contact.lastName || '',
          phone: contact.phone || '',
          email: contact.email || '',
        },
      },
      plivoAuthId: this.plivoAuthId,
      plivoAuthToken: this.plivoAuthToken,
      userId: this.config.userId,
      dbAgentId: this.agent.id,
      campaignId: this.config.campaignId,
      contactId: contact.id,
      plivoPhoneNumberId: this.phoneNumber.id,
    });

    if (callResult.success && callResult.callUuid) {
      this.activeCalls.set(callResult.callUuid, {
        callId: callResult.callRecordId || callResult.callUuid,
        contactId: contact.id,
        startTime: new Date(),
      });
    } else {
      throw new Error(callResult.error || 'Failed to dispatch Plivo outbound call');
    }
  }

  pause(): void {
    this.isPaused = true;
  }

  resume(): void {
    this.isPaused = false;
  }

  cancel(): void {
    this.isCancelled = true;
    this.callQueue = [];
  }
}
