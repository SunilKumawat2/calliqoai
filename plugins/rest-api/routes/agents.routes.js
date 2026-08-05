import { Router } from "express";
import { apiAuthMiddleware, asyncHandler } from "../middleware/auth.middleware.js";
import { db } from "../../../server/db.js";
import { agents, flows } from "../../../shared/schema.js";
import { eq, and, desc, sql } from "drizzle-orm";
const router = Router();
router.get(
  "/",
  apiAuthMiddleware("agents:read"),
  asyncHandler(async (req, res) => {
    const { userId } = req.apiAuth;
    const page = parseInt(req.query.page) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize) || 20, 100);
    const offset = (page - 1) * pageSize;
    const [agentList, countResult] = await Promise.all([
      db.select().from(agents).where(eq(agents.userId, userId)).orderBy(desc(agents.createdAt)).limit(pageSize).offset(offset),
      db.select({ count: sql`count(*)` }).from(agents).where(eq(agents.userId, userId))
    ]);
    const totalItems = Number(countResult[0]?.count || 0);
    const response = {
      success: true,
      data: agentList.map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        telephonyProvider: a.telephonyProvider,
        language: a.language,
        isActive: a.isActive,
        transferEnabled: a.transferEnabled,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt
      })),
      meta: {
        requestId: req.requestId,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        pagination: {
          page,
          pageSize,
          totalItems,
          totalPages: Math.ceil(totalItems / pageSize),
          hasNext: page < Math.ceil(totalItems / pageSize),
          hasPrev: page > 1
        }
      }
    };
    res.json(response);
  })
);
router.get(
  "/:id",
  apiAuthMiddleware("agents:read"),
  asyncHandler(async (req, res) => {
    const { userId } = req.apiAuth;
    const { id } = req.params;
    const [agent] = await db.select().from(agents).where(and(eq(agents.id, id), eq(agents.userId, userId))).limit(1);
    if (!agent) {
      const response2 = {
        success: false,
        error: { code: "NOT_FOUND", message: "Agent not found." },
        meta: { requestId: req.requestId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
      };
      return res.status(404).json(response2);
    }
    const response = {
      success: true,
      data: {
        id: agent.id,
        name: agent.name,
        type: agent.type,
        telephonyProvider: agent.telephonyProvider,
        systemPrompt: agent.systemPrompt,
        firstMessage: agent.firstMessage,
        language: agent.language,
        llmModel: agent.llmModel,
        temperature: agent.temperature,
        voiceId: agent.elevenLabsVoiceId,
        openaiVoice: agent.openaiVoice,
        transferEnabled: agent.transferEnabled,
        transferPhoneNumber: agent.transferPhoneNumber,
        isActive: agent.isActive,
        maxDurationSeconds: agent.maxDurationSeconds,
        createdAt: agent.createdAt,
        updatedAt: agent.updatedAt
      },
      meta: { requestId: req.requestId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
    };
    res.json(response);
  })
);
router.get(
  "/:id/flow",
  apiAuthMiddleware("agents:read"),
  asyncHandler(async (req, res) => {
    const { userId } = req.apiAuth;
    const { id } = req.params;
    const [agent] = await db.select().from(agents).where(and(eq(agents.id, id), eq(agents.userId, userId))).limit(1);
    if (!agent) {
      const response2 = {
        success: false,
        error: { code: "NOT_FOUND", message: "Agent not found." },
        meta: { requestId: req.requestId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
      };
      return res.status(404).json(response2);
    }
    if (agent.type !== "flow" || !agent.flowId) {
      const response2 = {
        success: false,
        error: { code: "VALIDATION_ERROR", message: "Agent is not a flow agent or has no flow assigned." },
        meta: { requestId: req.requestId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
      };
      return res.status(400).json(response2);
    }
    const [flow] = await db.select().from(flows).where(eq(flows.id, agent.flowId)).limit(1);
    if (!flow) {
      const response2 = {
        success: false,
        error: { code: "NOT_FOUND", message: "Flow not found for this agent." },
        meta: { requestId: req.requestId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
      };
      return res.status(404).json(response2);
    }
    const response = {
      success: true,
      data: {
        version: "1.0",
        agentId: agent.id,
        agentName: agent.name,
        exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
        flow: {
          id: flow.id,
          name: flow.name,
          nodes: flow.nodes,
          edges: flow.edges,
          variables: flow.variables
        }
      },
      meta: { requestId: req.requestId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
    };
    res.json(response);
  })
);
router.put(
  "/:id/flow",
  apiAuthMiddleware("agents:write"),
  asyncHandler(async (req, res) => {
    const { userId } = req.apiAuth;
    const { id } = req.params;
    const [agent] = await db.select().from(agents).where(and(eq(agents.id, id), eq(agents.userId, userId))).limit(1);
    if (!agent) {
      const response2 = {
        success: false,
        error: { code: "NOT_FOUND", message: "Agent not found." },
        meta: { requestId: req.requestId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
      };
      return res.status(404).json(response2);
    }
    if (agent.type !== "flow") {
      const response2 = {
        success: false,
        error: { code: "VALIDATION_ERROR", message: "Agent is not a flow agent." },
        meta: { requestId: req.requestId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
      };
      return res.status(400).json(response2);
    }
    const { flow } = req.body;
    if (!flow || !flow.nodes || !flow.edges) {
      const response2 = {
        success: false,
        error: { code: "VALIDATION_ERROR", message: "Invalid flow data. Required: flow.nodes and flow.edges" },
        meta: { requestId: req.requestId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
      };
      return res.status(400).json(response2);
    }
    if (agent.flowId) {
      await db.update(flows).set({
        nodes: flow.nodes,
        edges: flow.edges,
        variables: flow.variables,
        updatedAt: /* @__PURE__ */ new Date()
      }).where(eq(flows.id, agent.flowId));
    } else {
      const [newFlow] = await db.insert(flows).values({
        userId,
        name: flow.name || `${agent.name} Flow`,
        nodes: flow.nodes,
        edges: flow.edges,
        variables: flow.variables
      }).returning();
      await db.update(agents).set({ flowId: newFlow.id, updatedAt: /* @__PURE__ */ new Date() }).where(eq(agents.id, id));
    }
    const response = {
      success: true,
      data: {
        agentId: id,
        message: "Flow imported successfully."
      },
      meta: { requestId: req.requestId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
    };
    res.json(response);
  })
);
var agents_routes_default = router;
export {
  agents_routes_default as default
};
