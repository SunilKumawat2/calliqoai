import { Router } from "express";
import { db } from "../../../server/db.js";
import { apiKeys, users, apiAuditLogs } from "../../../shared/schema.js";
import { eq, desc, sql } from "drizzle-orm";
import { z } from "zod";
const router = Router();
const requireAdmin = (req, res, next) => {
  const user = req.user;
  if (!user || user.role !== "admin" && user.role !== "super_admin") {
    return res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Admin access required" } });
  }
  next();
};
router.get("/", requireAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize) || 50, 100);
    const offset = (page - 1) * pageSize;
    const [keys, countResult, requestCounts] = await Promise.all([
      db.select({
        id: apiKeys.id,
        userId: apiKeys.userId,
        userName: users.name,
        userEmail: users.email,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        scopes: apiKeys.scopes,
        rateLimit: apiKeys.rateLimit,
        rateLimitWindow: apiKeys.rateLimitWindow,
        isActive: apiKeys.isActive,
        lastUsedAt: apiKeys.lastUsedAt,
        createdAt: apiKeys.createdAt
      }).from(apiKeys).leftJoin(users, eq(apiKeys.userId, users.id)).orderBy(desc(apiKeys.createdAt)).limit(pageSize).offset(offset),
      db.select({ count: sql`count(*)` }).from(apiKeys),
      db.select({
        apiKeyId: apiAuditLogs.apiKeyId,
        count: sql`count(*)`
      }).from(apiAuditLogs).groupBy(apiAuditLogs.apiKeyId)
    ]);
    const countMap = new Map(requestCounts.map((r) => [r.apiKeyId, Number(r.count)]));
    const totalItems = Number(countResult[0]?.count || 0);
    const keysWithCount = keys.map((k) => ({
      ...k,
      requestCount: countMap.get(k.id) || 0
    }));
    res.json({
      success: true,
      data: keysWithCount,
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
    });
  } catch (error) {
    console.error("[Admin API Keys] List error:", error);
    res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Failed to list API keys" } });
  }
});
router.get("/settings", requireAdmin, async (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        defaultRateLimit: 100,
        defaultRateLimitWindow: 60
      }
    });
  } catch (error) {
    console.error("[Admin API Keys] Settings error:", error);
    res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Failed to get settings" } });
  }
});
router.put("/settings", requireAdmin, async (req, res) => {
  try {
    const schema = z.object({
      defaultRateLimit: z.number().min(1).max(1e4),
      defaultRateLimitWindow: z.number().min(1).max(3600)
    });
    const parseResult = schema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Invalid settings" } });
    }
    res.json({ success: true });
  } catch (error) {
    console.error("[Admin API Keys] Update settings error:", error);
    res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Failed to update settings" } });
  }
});
router.patch("/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const updateSchema = z.object({
      isActive: z.boolean().optional(),
      rateLimit: z.number().min(1).max(1e4).optional(),
      rateLimitWindow: z.number().min(1).max(3600).optional()
    });
    const parseResult = updateSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Invalid request body", details: parseResult.error.flatten().fieldErrors } });
    }
    const { isActive, rateLimit, rateLimitWindow } = parseResult.data;
    const updateData = {};
    if (typeof isActive === "boolean") updateData.isActive = isActive;
    if (typeof rateLimit === "number") updateData.rateLimit = rateLimit;
    if (typeof rateLimitWindow === "number") updateData.rateLimitWindow = rateLimitWindow;
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "No valid fields to update" } });
    }
    const [updated] = await db.update(apiKeys).set(updateData).where(eq(apiKeys.id, id)).returning();
    if (!updated) {
      return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "API key not found" } });
    }
    res.json({ success: true, data: updated });
  } catch (error) {
    console.error("[Admin API Keys] Update error:", error);
    res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Failed to update API key" } });
  }
});
router.delete("/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.delete(apiKeys).where(eq(apiKeys.id, id)).returning();
    if (result.length === 0) {
      return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "API key not found" } });
    }
    res.json({ success: true });
  } catch (error) {
    console.error("[Admin API Keys] Delete error:", error);
    res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Failed to delete API key" } });
  }
});
var admin_routes_default = router;
export {
  admin_routes_default as default
};
