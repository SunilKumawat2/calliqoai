import { Router } from "express";
import { apiAuthMiddleware, asyncHandler } from "../middleware/auth.middleware.js";
import { db } from "../../../server/db.js";
import { calls, plivoCalls, twilioOpenaiCalls, agents, phoneNumbers, users } from "../../../shared/schema.js";
import { eq, and, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { getCallServices } from "../service-registry.js";
const router = Router();
const triggerCallSchema = z.object({
  agentId: z.string().uuid("Invalid agent ID"),
  toNumber: z.string().min(10, "Phone number must be at least 10 digits"),
  fromNumber: z.string().optional(),
  engine: z.enum(["elevenlabs", "plivo", "twilio-openai"]).optional(),
  dynamicVariables: z.record(z.string()).optional(),
  metadata: z.record(z.string()).optional(),
  scheduledAt: z.string().datetime().optional()
});
router.post(
  "/",
  apiAuthMiddleware("calls:write"),
  asyncHandler(async (req, res) => {
    const { userId, apiKeyId } = req.apiAuth;
    const parseResult = triggerCallSchema.safeParse(req.body);
    if (!parseResult.success) {
      const response2 = {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request body",
          details: { errors: parseResult.error.flatten().fieldErrors }
        },
        meta: { requestId: req.requestId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
      };
      return res.status(400).json(response2);
    }
    const { agentId, toNumber, fromNumber, engine, dynamicVariables, metadata } = parseResult.data;
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user || user.credits < 1) {
      const response2 = {
        success: false,
        error: {
          code: "INSUFFICIENT_CREDITS",
          message: "Insufficient credits to make a call. Please add more credits."
        },
        meta: { requestId: req.requestId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
      };
      return res.status(402).json(response2);
    }
    const [agent] = await db.select().from(agents).where(and(eq(agents.id, agentId), eq(agents.userId, userId))).limit(1);
    if (!agent) {
      const response2 = {
        success: false,
        error: {
          code: "NOT_FOUND",
          message: "Agent not found or does not belong to you."
        },
        meta: { requestId: req.requestId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
      };
      return res.status(404).json(response2);
    }
    if (!agent.isActive) {
      const response2 = {
        success: false,
        error: {
          code: "AGENT_NOT_ACTIVE",
          message: "Agent is not active. Please activate it before making calls."
        },
        meta: { requestId: req.requestId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
      };
      return res.status(400).json(response2);
    }
    const callEngine = engine || agent.telephonyProvider || "elevenlabs";
    let callerNumber = fromNumber;
    let fromPhoneRecord = null;
    if (!callerNumber) {
      const [userPhone] = await db.select().from(phoneNumbers).where(and(eq(phoneNumbers.userId, userId), eq(phoneNumbers.status, "active"))).limit(1);
      if (!userPhone) {
        const response2 = {
          success: false,
          error: {
            code: "PHONE_NUMBER_NOT_AVAILABLE",
            message: "No active phone number found. Please provide a fromNumber or purchase a phone number."
          },
          meta: { requestId: req.requestId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
        };
        return res.status(400).json(response2);
      }
      callerNumber = userPhone.phoneNumber;
      fromPhoneRecord = userPhone;
    } else {
      const [foundPhone] = await db.select().from(phoneNumbers).where(and(eq(phoneNumbers.phoneNumber, callerNumber), eq(phoneNumbers.userId, userId))).limit(1);
      fromPhoneRecord = foundPhone || null;
    }
    let callId;
    let callStatus = "queued";
    let services;
    try {
      services = getCallServices();
    } catch (serviceErr) {
      console.error("[REST API] Call initiation failed:", serviceErr.message);
      return res.status(503).json({
        success: false,
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "Call services are not available. Ensure the REST API plugin is properly registered with call service injection."
        }
      });
    }
    try {
      if (callEngine === "plivo") {
        if (!fromPhoneRecord) {
          throw new Error("Phone number not found in database.");
        }
        const { PlivoCallService } = services;
        const result = await PlivoCallService.initiateCall({
          userId,
          agentId,
          toNumber,
          fromNumber: callerNumber,
          plivoPhoneNumberId: fromPhoneRecord.id,
          agentConfig: {
            voice: agent.openaiVoice || "alloy",
            model: agent.openaiModel || "gpt-realtime-1.5",
            systemPrompt: agent.systemPrompt || "You are a helpful assistant.",
            firstMessage: agent.firstMessage || void 0
          }
        });
        callId = result.callUuid;
        callStatus = result.plivoCall?.status || "queued";
      } else if (callEngine === "twilio-openai") {
        if (!fromPhoneRecord) {
          throw new Error("Phone number not found in database.");
        }
        const { TwilioOpenAICallService } = services;
        const result = await TwilioOpenAICallService.initiateCall({
          userId,
          agentId,
          toNumber,
          fromNumberId: fromPhoneRecord.id
        });
        if (!result.success) {
          throw new Error(result.error || "Failed to initiate Twilio-OpenAI call");
        }
        callId = result.callId || "";
        callStatus = "queued";
      } else {
        const { OutboundCallService, getCredentialForAgent } = services;
        if (!agent.elevenLabsAgentId) {
          throw new Error("Agent is not configured for ElevenLabs. Missing elevenLabsAgentId.");
        }
        const [elPhone] = await db.select().from(phoneNumbers).where(and(eq(phoneNumbers.phoneNumber, callerNumber), eq(phoneNumbers.userId, userId))).limit(1);
        if (!elPhone || !elPhone.elevenLabsPhoneNumberId) {
          throw new Error("Phone number is not configured for ElevenLabs outbound calls. Missing elevenLabsPhoneNumberId.");
        }
        const credential = await getCredentialForAgent(agentId);
        if (!credential) {
          throw new Error("No ElevenLabs API capacity available.");
        }
        const merged = {
          ...metadata || {},
          ...dynamicVariables || {}
        };
        const callDynamicVars = {
          contact_name: merged.contact_name?.trim() || toNumber,
          contact_phone: merged.contact_phone?.trim() || toNumber,
          name: merged.name?.trim() || toNumber,
          phone: merged.phone?.trim() || toNumber,
          ...merged
        };
        callDynamicVars.contact_name = callDynamicVars.contact_name?.trim() || toNumber;
        callDynamicVars.name = callDynamicVars.name?.trim() || toNumber;
        const callService = new OutboundCallService(credential.apiKey);
        const result = await callService.initiateCall({
          agentId: agent.elevenLabsAgentId,
          agentPhoneNumberId: elPhone.elevenLabsPhoneNumberId,
          toNumber,
          dynamicData: callDynamicVars
        });
        const contactName = callDynamicVars.contact_name || toNumber;
        const callRecord = await db.insert(calls).values({
          id: result.conversationId || `el-${Date.now()}`,
          userId,
          toNumber,
          fromNumber: callerNumber,
          status: result.success ? "in-progress" : "failed",
          callDirection: "outgoing",
          twilioSid: result.callSid || void 0,
          elevenLabsConversationId: result.conversationId,
          metadata: { apiKeyId, callSid: result.callSid, agentId, agentName: agent.name, engine: callEngine, credentialId: credential.id, contactName, dynamicVariables: callDynamicVars },
          agentId,
          engineType: callEngine,
          creditsUsed: 1
        }).returning();
        callId = callRecord[0]?.id || result.conversationId || "";
        callStatus = result.success ? "in-progress" : "failed";
      }
    } catch (error) {
      console.error("[REST API] Call initiation failed:", error);
      const response2 = {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to initiate call"
        },
        meta: { requestId: req.requestId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
      };
      return res.status(500).json(response2);
    }
    const responseData = {
      callId,
      status: callStatus,
      agentId,
      toNumber,
      fromNumber: callerNumber,
      engine: callEngine,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    const response = {
      success: true,
      data: responseData,
      meta: { requestId: req.requestId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
    };
    res.status(201).json(response);
  })
);
router.get(
  "/",
  apiAuthMiddleware("calls:read"),
  asyncHandler(async (req, res) => {
    const { userId } = req.apiAuth;
    const page = parseInt(req.query.page) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize) || 20, 100);
    const offset = (page - 1) * pageSize;
    const fetchLimit = offset + pageSize;
    const [
      elevenLabsCalls,
      plivoCallsList,
      twilioOpenaiCallsList,
      elCount,
      plivoCount,
      twilioCount
    ] = await Promise.all([
      db.select().from(calls).where(eq(calls.userId, userId)).orderBy(desc(calls.createdAt)).limit(fetchLimit),
      db.select().from(plivoCalls).where(eq(plivoCalls.userId, userId)).orderBy(desc(plivoCalls.createdAt)).limit(fetchLimit),
      db.select().from(twilioOpenaiCalls).where(eq(twilioOpenaiCalls.userId, userId)).orderBy(desc(twilioOpenaiCalls.createdAt)).limit(fetchLimit),
      db.select({ count: sql`count(*)` }).from(calls).where(eq(calls.userId, userId)),
      db.select({ count: sql`count(*)` }).from(plivoCalls).where(eq(plivoCalls.userId, userId)),
      db.select({ count: sql`count(*)` }).from(twilioOpenaiCalls).where(eq(twilioOpenaiCalls.userId, userId))
    ]);
    const totalItems = Number(elCount[0]?.count || 0) + Number(plivoCount[0]?.count || 0) + Number(twilioCount[0]?.count || 0);
    const normalizedCalls = [
      ...elevenLabsCalls.map((c) => ({
        id: c.id,
        engine: "elevenlabs",
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
        endedAt: c.endedAt
      })),
      ...plivoCallsList.map((c) => ({
        id: c.id,
        engine: "plivo",
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
        endedAt: c.endedAt
      })),
      ...twilioOpenaiCallsList.map((c) => ({
        id: c.id,
        engine: "twilio-openai",
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
        endedAt: c.endedAt
      }))
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const totalPages = Math.ceil(totalItems / pageSize);
    const response = {
      success: true,
      data: normalizedCalls.slice(offset, offset + pageSize),
      meta: {
        requestId: req.requestId,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        pagination: {
          page,
          pageSize,
          totalItems,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      }
    };
    res.json(response);
  })
);
router.get(
  "/:id",
  apiAuthMiddleware("calls:read"),
  asyncHandler(async (req, res) => {
    const { userId } = req.apiAuth;
    const { id } = req.params;
    const [elevenLabsCall] = await db.select().from(calls).where(and(eq(calls.id, id), eq(calls.userId, userId))).limit(1);
    if (elevenLabsCall) {
      const response2 = {
        success: true,
        data: {
          id: elevenLabsCall.id,
          engine: "elevenlabs",
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
          endedAt: elevenLabsCall.endedAt
        },
        meta: { requestId: req.requestId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
      };
      return res.json(response2);
    }
    const [plivoCall] = await db.select().from(plivoCalls).where(and(eq(plivoCalls.id, id), eq(plivoCalls.userId, userId))).limit(1);
    if (plivoCall) {
      const response2 = {
        success: true,
        data: {
          id: plivoCall.id,
          engine: "plivo",
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
          endedAt: plivoCall.endedAt
        },
        meta: { requestId: req.requestId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
      };
      return res.json(response2);
    }
    const [twilioCall] = await db.select().from(twilioOpenaiCalls).where(and(eq(twilioOpenaiCalls.id, id), eq(twilioOpenaiCalls.userId, userId))).limit(1);
    if (twilioCall) {
      const response2 = {
        success: true,
        data: {
          id: twilioCall.id,
          engine: "twilio-openai",
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
          endedAt: twilioCall.endedAt
        },
        meta: { requestId: req.requestId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
      };
      return res.json(response2);
    }
    const response = {
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "Call not found."
      },
      meta: { requestId: req.requestId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
    };
    res.status(404).json(response);
  })
);
router.post(
  "/:id/hangup",
  apiAuthMiddleware("calls:write"),
  asyncHandler(async (req, res) => {
    const { userId } = req.apiAuth;
    const { id } = req.params;
    const response = {
      success: true,
      data: {
        callId: id,
        status: "hangup_requested",
        message: "Hangup request sent to call."
      },
      meta: { requestId: req.requestId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
    };
    res.json(response);
  })
);
var calls_routes_default = router;
export {
  calls_routes_default as default
};
