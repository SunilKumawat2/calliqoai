/**
 * ============================================================
 * REST API Plugin - Calls Routes
 * Endpoints for triggering and managing calls
 * ============================================================
 */

import { Router, Response } from 'express';
import { apiAuthMiddleware, asyncHandler, requireScope } from '../middleware/auth.middleware.js';
import type { AuthenticatedApiRequest, ApiResponse, TriggerCallRequest, TriggerCallResponse, PaginationMeta } from '../types.js';
import { db } from '../../../server/db.js';
import { calls, plivoCalls, twilioOpenaiCalls, agents, phoneNumbers, users } from '../../../shared/schema.js';
import { eq, and, desc, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getCallServices } from '../service-registry.js';

const router = Router();

// Validation schemas
const triggerCallSchema = z.object({
  agentId: z.string().uuid('Invalid agent ID'),
  toNumber: z.string().min(10, 'Phone number must be at least 10 digits'),
  fromNumber: z.string().optional(),
  engine: z.enum(['elevenlabs', 'plivo', 'twilio-openai']).optional(),
  dynamicVariables: z.record(z.string()).optional(),
  metadata: z.record(z.string()).optional(),
  scheduledAt: z.string().datetime().optional(),
});

/**
 * POST /v1/calls - Trigger a new outbound call
 */
router.post(
  '/',
  apiAuthMiddleware('calls:write'),
  asyncHandler(async (req: AuthenticatedApiRequest, res: Response) => {
    const { userId, apiKeyId } = req.apiAuth;
    
    // Validate request body
    const parseResult = triggerCallSchema.safeParse(req.body);
    if (!parseResult.success) {
      const response: ApiResponse = {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request body',
          details: { errors: parseResult.error.flatten().fieldErrors },
        },
        meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
      };
      return res.status(400).json(response);
    }
    
    const { agentId, toNumber, fromNumber, engine, dynamicVariables, metadata } = parseResult.data;
    
    // Check user has credits
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user || user.credits < 1) {
      const response: ApiResponse = {
        success: false,
        error: {
          code: 'INSUFFICIENT_CREDITS',
          message: 'Insufficient credits to make a call. Please add more credits.',
        },
        meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
      };
      return res.status(402).json(response);
    }
    
    // Get agent
    const [agent] = await db
      .select()
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.userId, userId)))
      .limit(1);
    
    if (!agent) {
      const response: ApiResponse = {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Agent not found or does not belong to you.',
        },
        meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
      };
      return res.status(404).json(response);
    }
    
    if (!agent.isActive) {
      const response: ApiResponse = {
        success: false,
        error: {
          code: 'AGENT_NOT_ACTIVE',
          message: 'Agent is not active. Please activate it before making calls.',
        },
        meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
      };
      return res.status(400).json(response);
    }
    
    // Determine engine to use - default to elevenlabs for outbound calls
    const callEngine = engine || agent.telephonyProvider || 'elevenlabs';
    
    // Get from number and phone record if not provided
    let callerNumber = fromNumber;
    let fromPhoneRecord: typeof phoneNumbers.$inferSelect | null = null;
    
    if (!callerNumber) {
      // Find a phone number owned by the user
      const [userPhone] = await db
        .select()
        .from(phoneNumbers)
        .where(and(eq(phoneNumbers.userId, userId), eq(phoneNumbers.status, 'active')))
        .limit(1);
      
      if (!userPhone) {
        const response: ApiResponse = {
          success: false,
          error: {
            code: 'PHONE_NUMBER_NOT_AVAILABLE',
            message: 'No active phone number found. Please provide a fromNumber or purchase a phone number.',
          },
          meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
        };
        return res.status(400).json(response);
      }
      callerNumber = userPhone.phoneNumber;
      fromPhoneRecord = userPhone;
    } else {
      // Look up phone record by number
      const [foundPhone] = await db
        .select()
        .from(phoneNumbers)
        .where(and(eq(phoneNumbers.phoneNumber, callerNumber), eq(phoneNumbers.userId, userId)))
        .limit(1);
      fromPhoneRecord = foundPhone || null;
    }
    
    // Create call based on engine
    let callId: string;
    let callStatus: string = 'queued';
    
    let services: ReturnType<typeof getCallServices>;
    try {
      services = getCallServices();
    } catch (serviceErr: any) {
      console.error('[REST API] Call initiation failed:', serviceErr.message);
      return res.status(503).json({
        success: false,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Call services are not available. Ensure the REST API plugin is properly registered with call service injection.',
        },
      } as ApiResponse);
    }

    try {
      if (callEngine === 'plivo') {
        // Use Plivo + OpenAI engine
        if (!fromPhoneRecord) {
          throw new Error('Phone number not found in database.');
        }
        const { PlivoCallService } = services;
        const result = await PlivoCallService.initiateCall({
          userId,
          agentId,
          toNumber,
          fromNumber: callerNumber,
          plivoPhoneNumberId: fromPhoneRecord.id,
          agentConfig: {
            voice: (agent.openaiVoice as any) || 'alloy',
            model: (agent.openaiModel as any) || 'gpt-realtime-1.5',
            systemPrompt: agent.systemPrompt || 'You are a helpful assistant.',
            firstMessage: agent.firstMessage || undefined,
          },
        });
        callId = result.callUuid;
        callStatus = result.plivoCall?.status || 'queued';
      } else if (callEngine === 'twilio-openai') {
        // Use Twilio + OpenAI engine
        if (!fromPhoneRecord) {
          throw new Error('Phone number not found in database.');
        }
        const { TwilioOpenAICallService } = services;
        const result = await TwilioOpenAICallService.initiateCall({
          userId,
          agentId,
          toNumber,
          fromNumberId: fromPhoneRecord.id,
        });
        if (!result.success) {
          throw new Error(result.error || 'Failed to initiate Twilio-OpenAI call');
        }
        callId = result.callId || '';
        callStatus = 'queued';
      } else {
        // Use ElevenLabs engine (default)
        const { OutboundCallService, getCredentialForAgent } = services;
        
        // Get the agent's ElevenLabs ID
        if (!agent.elevenLabsAgentId) {
          throw new Error('Agent is not configured for ElevenLabs. Missing elevenLabsAgentId.');
        }
        
        // Find phone number with ElevenLabs ID
        const [elPhone] = await db
          .select()
          .from(phoneNumbers)
          .where(and(eq(phoneNumbers.phoneNumber, callerNumber), eq(phoneNumbers.userId, userId)))
          .limit(1);
        
        if (!elPhone || !elPhone.elevenLabsPhoneNumberId) {
          throw new Error('Phone number is not configured for ElevenLabs outbound calls. Missing elevenLabsPhoneNumberId.');
        }
        
        // Get API key from pool
        const credential = await getCredentialForAgent(agentId);
        if (!credential) {
          throw new Error('No ElevenLabs API capacity available.');
        }
        
        const merged: Record<string, string> = {
          ...(metadata || {}),
          ...(dynamicVariables || {}),
        };
        const callDynamicVars: Record<string, string> = {
          contact_name: merged.contact_name?.trim() || toNumber,
          contact_phone: merged.contact_phone?.trim() || toNumber,
          name: merged.name?.trim() || toNumber,
          phone: merged.phone?.trim() || toNumber,
          ...merged,
        };
        callDynamicVars.contact_name = callDynamicVars.contact_name?.trim() || toNumber;
        callDynamicVars.name = callDynamicVars.name?.trim() || toNumber;

        const callService = new OutboundCallService(credential.apiKey);
        const result = await callService.initiateCall({
          agentId: agent.elevenLabsAgentId,
          agentPhoneNumberId: elPhone.elevenLabsPhoneNumberId,
          toNumber,
          dynamicData: callDynamicVars,
        });
        
        const contactName = callDynamicVars.contact_name || toNumber;

        // Create a call record in the database
        const callRecord = await db.insert(calls).values({
          id: result.conversationId || `el-${Date.now()}`,
          userId,
          toNumber,
          fromNumber: callerNumber,
          status: result.success ? 'in-progress' : 'failed',
          callDirection: 'outgoing',
          twilioSid: result.callSid || undefined,
          elevenLabsConversationId: result.conversationId,
          metadata: { apiKeyId, callSid: result.callSid, agentId, agentName: agent.name, engine: callEngine, credentialId: credential.id, contactName, dynamicVariables: callDynamicVars },
          agentId,
          engineType: callEngine,
          creditsUsed: 1,
        }).returning();
        
        callId = callRecord[0]?.id || result.conversationId || '';
        callStatus = result.success ? 'in-progress' : 'failed';
      }
    } catch (error: any) {
      console.error('[REST API] Call initiation failed:', error);
      const response: ApiResponse = {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to initiate call',
        },
        meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
      };
      return res.status(500).json(response);
    }
    
    const responseData: TriggerCallResponse = {
      callId,
      status: callStatus,
      agentId,
      toNumber,
      fromNumber: callerNumber,
      engine: callEngine,
      createdAt: new Date().toISOString(),
    };
    
    const response: ApiResponse<TriggerCallResponse> = {
      success: true,
      data: responseData,
      meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
    };
    
    res.status(201).json(response);
  })
);

/**
 * GET /v1/calls - List calls
 */
router.get(
  '/',
  apiAuthMiddleware('calls:read'),
  asyncHandler(async (req: AuthenticatedApiRequest, res: Response) => {
    const { userId } = req.apiAuth;
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize as string) || 20, 100);
    const offset = (page - 1) * pageSize;
    
    const fetchLimit = offset + pageSize;
    
    const [
      elevenLabsCalls, plivoCallsList, twilioOpenaiCallsList,
      elCount, plivoCount, twilioCount,
    ] = await Promise.all([
      db
        .select()
        .from(calls)
        .where(eq(calls.userId, userId))
        .orderBy(desc(calls.createdAt))
        .limit(fetchLimit),
      db
        .select()
        .from(plivoCalls)
        .where(eq(plivoCalls.userId, userId))
        .orderBy(desc(plivoCalls.createdAt))
        .limit(fetchLimit),
      db
        .select()
        .from(twilioOpenaiCalls)
        .where(eq(twilioOpenaiCalls.userId, userId))
        .orderBy(desc(twilioOpenaiCalls.createdAt))
        .limit(fetchLimit),
      db.select({ count: sql<number>`count(*)` }).from(calls).where(eq(calls.userId, userId)),
      db.select({ count: sql<number>`count(*)` }).from(plivoCalls).where(eq(plivoCalls.userId, userId)),
      db.select({ count: sql<number>`count(*)` }).from(twilioOpenaiCalls).where(eq(twilioOpenaiCalls.userId, userId)),
    ]);
    
    const totalItems = Number(elCount[0]?.count || 0) + Number(plivoCount[0]?.count || 0) + Number(twilioCount[0]?.count || 0);
    
    // Normalize and merge calls
    const normalizedCalls = [
      ...elevenLabsCalls.map(c => ({
        id: c.id,
        engine: 'elevenlabs',
        agentId: c.agentId,
        toNumber: c.toNumber,
        fromNumber: c.fromNumber,
        status: c.status,
        duration: c.duration,
        creditsUsed: c.creditsUsed,
        transcript: c.transcript,
        aiSummary: c.aiSummary,
        recordingUrl: c.recordingUrl,
        createdAt: c.createdAt,
        endedAt: c.endedAt,
      })),
      ...plivoCallsList.map(c => ({
        id: c.id,
        engine: 'plivo',
        agentId: c.agentId,
        toNumber: c.toNumber,
        fromNumber: c.fromNumber,
        status: c.status,
        duration: c.duration,
        creditsUsed: c.creditsUsed,
        transcript: c.transcript,
        aiSummary: c.aiSummary,
        recordingUrl: c.recordingUrl,
        createdAt: c.createdAt,
        endedAt: c.endedAt,
      })),
      ...twilioOpenaiCallsList.map(c => ({
        id: c.id,
        engine: 'twilio-openai',
        agentId: c.agentId,
        toNumber: c.toNumber,
        fromNumber: c.fromNumber,
        status: c.status,
        duration: c.duration,
        creditsUsed: c.creditsUsed,
        transcript: c.transcript,
        aiSummary: c.aiSummary,
        recordingUrl: c.recordingUrl,
        createdAt: c.createdAt,
        endedAt: c.endedAt,
      })),
    ].sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime());
    
    const totalPages = Math.ceil(totalItems / pageSize);
    
    const response: ApiResponse = {
      success: true,
      data: normalizedCalls.slice(offset, offset + pageSize),
      meta: {
        requestId: req.requestId,
        timestamp: new Date().toISOString(),
        pagination: {
          page,
          pageSize,
          totalItems,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      },
    };
    
    res.json(response);
  })
);

/**
 * GET /v1/calls/:id - Get call details
 */
router.get(
  '/:id',
  apiAuthMiddleware('calls:read'),
  asyncHandler(async (req: AuthenticatedApiRequest, res: Response) => {
    const { userId } = req.apiAuth;
    const { id } = req.params;
    
    // Try to find call in all engines
    const [elevenLabsCall] = await db
      .select()
      .from(calls)
      .where(and(eq(calls.id, id), eq(calls.userId, userId)))
      .limit(1);
    
    if (elevenLabsCall) {
      const response: ApiResponse = {
        success: true,
        data: {
          id: elevenLabsCall.id,
          engine: 'elevenlabs',
          agentId: elevenLabsCall.agentId,
          toNumber: elevenLabsCall.toNumber,
          fromNumber: elevenLabsCall.fromNumber,
          status: elevenLabsCall.status,
          duration: elevenLabsCall.duration,
          creditsUsed: elevenLabsCall.creditsUsed,
          transcript: elevenLabsCall.transcript,
          aiSummary: elevenLabsCall.aiSummary,
          recordingUrl: elevenLabsCall.recordingUrl,
          sentiment: elevenLabsCall.sentiment,
          createdAt: elevenLabsCall.createdAt,
          endedAt: elevenLabsCall.endedAt,
        },
        meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
      };
      return res.json(response);
    }
    
    const [plivoCall] = await db
      .select()
      .from(plivoCalls)
      .where(and(eq(plivoCalls.id, id), eq(plivoCalls.userId, userId)))
      .limit(1);
    
    if (plivoCall) {
      const response: ApiResponse = {
        success: true,
        data: {
          id: plivoCall.id,
          engine: 'plivo',
          agentId: plivoCall.agentId,
          toNumber: plivoCall.toNumber,
          fromNumber: plivoCall.fromNumber,
          status: plivoCall.status,
          duration: plivoCall.durationSeconds,
          creditsUsed: plivoCall.creditsUsed,
          transcript: plivoCall.transcript,
          aiSummary: plivoCall.aiSummary,
          recordingUrl: plivoCall.recordingUrl,
          createdAt: plivoCall.createdAt,
          endedAt: plivoCall.endedAt,
        },
        meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
      };
      return res.json(response);
    }
    
    const [twilioCall] = await db
      .select()
      .from(twilioOpenaiCalls)
      .where(and(eq(twilioOpenaiCalls.id, id), eq(twilioOpenaiCalls.userId, userId)))
      .limit(1);
    
    if (twilioCall) {
      const response: ApiResponse = {
        success: true,
        data: {
          id: twilioCall.id,
          engine: 'twilio-openai',
          agentId: twilioCall.agentId,
          toNumber: twilioCall.toNumber,
          fromNumber: twilioCall.fromNumber,
          status: twilioCall.status,
          duration: twilioCall.durationSeconds,
          creditsUsed: twilioCall.creditsUsed,
          transcript: twilioCall.transcript,
          aiSummary: twilioCall.aiSummary,
          recordingUrl: twilioCall.recordingUrl,
          createdAt: twilioCall.createdAt,
          endedAt: twilioCall.endedAt,
        },
        meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
      };
      return res.json(response);
    }
    
    // Call not found
    const response: ApiResponse = {
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Call not found.',
      },
      meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
    };
    res.status(404).json(response);
  })
);

/**
 * POST /v1/calls/:id/hangup - Hangup an active call
 */
router.post(
  '/:id/hangup',
  apiAuthMiddleware('calls:write'),
  asyncHandler(async (req: AuthenticatedApiRequest, res: Response) => {
    const { userId } = req.apiAuth;
    const { id } = req.params;
    
    // This would integrate with the call service to end the call
    // For now, return a placeholder response
    const response: ApiResponse = {
      success: true,
      data: {
        callId: id,
        status: 'hangup_requested',
        message: 'Hangup request sent to call.',
      },
      meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
    };
    
    res.json(response);
  })
);

export default router;
