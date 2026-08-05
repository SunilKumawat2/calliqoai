import { Router } from "express";
import { ApiKeyService } from "../services/api-key.service.js";
import { API_SCOPES, apiAuditLogs } from "../../../shared/schema.js";
import { z } from "zod";
import { db } from "../../../server/db.js";
import { eq, and, sql } from "drizzle-orm";
const router = Router();
const requireAuth = (req, res, next) => {
  if (!req.userId) {
    return res.status(401).json({
      success: false,
      error: { code: "UNAUTHORIZED", message: "Authentication required" }
    });
  }
  next();
};
const createKeySchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.string()).optional(),
  rateLimit: z.number().int().min(10).max(1e4).optional(),
  ipWhitelist: z.array(z.string().ip()).optional(),
  expiresAt: z.string().datetime().optional(),
  description: z.string().max(500).optional()
});
const updateKeySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  scopes: z.array(z.string()).optional(),
  rateLimit: z.number().int().min(10).max(1e4).optional(),
  ipWhitelist: z.array(z.string().ip()).optional(),
  isActive: z.boolean().optional(),
  description: z.string().max(500).optional()
});
router.get("/", requireAuth, async (req, res) => {
  try {
    const userId = req.userId;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(Math.max(1, parseInt(req.query.pageSize) || 50), 100);
    const offset = (page - 1) * pageSize;
    const allKeys = await ApiKeyService.getUserKeys(userId);
    const totalItems = allKeys.length;
    const paginatedKeys = allKeys.slice(offset, offset + pageSize);
    const response = {
      success: true,
      data: paginatedKeys.map((k) => ({
        id: k.id,
        name: k.name,
        keyPrefix: k.keyPrefix,
        scopes: k.scopes,
        rateLimit: k.rateLimit,
        ipWhitelist: k.ipWhitelist,
        isActive: k.isActive,
        lastUsedAt: k.lastUsedAt,
        totalRequests: k.totalRequests,
        expiresAt: k.expiresAt,
        description: k.description,
        createdAt: k.createdAt
      })),
      meta: {
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
  } catch (error) {
    console.error("[API Keys] Error listing keys:", error);
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to list API keys" }
    });
  }
});
router.post("/", requireAuth, async (req, res) => {
  try {
    const userId = req.userId;
    const parseResult = createKeySchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request body",
          details: parseResult.error.flatten().fieldErrors
        }
      });
    }
    const { name, scopes, rateLimit, ipWhitelist, expiresAt, description } = parseResult.data;
    const validScopes = Object.keys(API_SCOPES);
    if (scopes) {
      const invalidScopes = scopes.filter((s) => !validScopes.includes(s));
      if (invalidScopes.length > 0) {
        return res.status(400).json({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid scopes",
            details: { invalidScopes, validScopes }
          }
        });
      }
    }
    const { key, record } = await ApiKeyService.generateKey({
      userId,
      name,
      scopes,
      rateLimit,
      ipWhitelist,
      expiresAt: expiresAt ? new Date(expiresAt) : void 0,
      description
    });
    const response = {
      success: true,
      data: {
        id: record.id,
        name: record.name,
        key,
        // Full key - only shown once!
        keyPrefix: record.keyPrefix,
        scopes: record.scopes,
        rateLimit: record.rateLimit,
        ipWhitelist: record.ipWhitelist,
        expiresAt: record.expiresAt,
        description: record.description,
        createdAt: record.createdAt,
        warning: "Save this API key securely. It will not be shown again."
      }
    };
    res.status(201).json(response);
  } catch (error) {
    console.error("[API Keys] Error creating key:", error);
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to create API key" }
    });
  }
});
router.put("/:id", requireAuth, async (req, res) => {
  try {
    const userId = req.userId;
    const { id } = req.params;
    const parseResult = updateKeySchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request body",
          details: parseResult.error.flatten().fieldErrors
        }
      });
    }
    const updates = parseResult.data;
    if (updates.scopes) {
      const validScopes = Object.keys(API_SCOPES);
      const invalidScopes = updates.scopes.filter((s) => !validScopes.includes(s));
      if (invalidScopes.length > 0) {
        return res.status(400).json({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid scopes",
            details: { invalidScopes, validScopes }
          }
        });
      }
    }
    const updated = await ApiKeyService.updateKey(id, userId, updates);
    if (!updated) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "API key not found" }
      });
    }
    const response = {
      success: true,
      data: {
        id: updated.id,
        name: updated.name,
        keyPrefix: updated.keyPrefix,
        scopes: updated.scopes,
        rateLimit: updated.rateLimit,
        ipWhitelist: updated.ipWhitelist,
        isActive: updated.isActive,
        expiresAt: updated.expiresAt,
        description: updated.description,
        updatedAt: updated.updatedAt
      }
    };
    res.json(response);
  } catch (error) {
    console.error("[API Keys] Error updating key:", error);
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to update API key" }
    });
  }
});
router.post("/:id/regenerate", requireAuth, async (req, res) => {
  try {
    const userId = req.userId;
    const { id } = req.params;
    const result = await ApiKeyService.regenerateKey(id, userId);
    if (!result) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "API key not found" }
      });
    }
    const response = {
      success: true,
      data: {
        id: result.record.id,
        name: result.record.name,
        key: result.key,
        // New full key - only shown once!
        keyPrefix: result.record.keyPrefix,
        warning: "Save this API key securely. It will not be shown again. The old key is now invalid."
      }
    };
    res.json(response);
  } catch (error) {
    console.error("[API Keys] Error regenerating key:", error);
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to regenerate API key" }
    });
  }
});
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const userId = req.userId;
    const { id } = req.params;
    const deleted = await ApiKeyService.deleteKey(id, userId);
    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "API key not found" }
      });
    }
    const response = {
      success: true,
      data: { deleted: true }
    };
    res.json(response);
  } catch (error) {
    console.error("[API Keys] Error deleting key:", error);
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to delete API key" }
    });
  }
});
router.get("/scopes", requireAuth, async (req, res) => {
  const response = {
    success: true,
    data: Object.entries(API_SCOPES).map(([scope, description]) => ({
      scope,
      description
    }))
  };
  res.json(response);
});
router.get("/:id/audit-logs", requireAuth, async (req, res) => {
  try {
    const userId = req.userId;
    const { id } = req.params;
    const page = parseInt(req.query.page) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize) || 50, 100);
    const [logs, countResult] = await Promise.all([
      ApiKeyService.getAuditLogs(userId, { page, pageSize, apiKeyId: id }),
      db.select({ count: sql`count(*)` }).from(apiAuditLogs).where(and(eq(apiAuditLogs.userId, userId), eq(apiAuditLogs.apiKeyId, id)))
    ]);
    const totalItems = Number(countResult[0]?.count || 0);
    const response = {
      success: true,
      data: logs,
      meta: {
        requestId: "audit-log-request",
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
  } catch (error) {
    console.error("[API Keys] Error fetching audit logs:", error);
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to fetch audit logs" }
    });
  }
});
var api_keys_routes_default = router;
export {
  api_keys_routes_default as default
};
