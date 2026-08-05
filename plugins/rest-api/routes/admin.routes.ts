/**
 * ============================================================
 * REST API Plugin - Admin Routes
 * Endpoints for admin management of all API keys
 * ============================================================
 */

import { Router, Response, Request, NextFunction } from 'express';
import { db } from '../../../server/db.js';
import { apiKeys, users, apiAuditLogs } from '../../../shared/schema.js';
import { eq, desc, sql } from 'drizzle-orm';
import { z } from 'zod';

const router = Router();

const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  const user = (req as any).user;
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
    return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Admin access required' } });
  }
  next();
};

/**
 * GET /api/admin/api-keys - List all API keys across all users
 */
router.get('/', requireAdmin, async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize as string) || 50, 100);
    const offset = (page - 1) * pageSize;

    const [keys, countResult, requestCounts] = await Promise.all([
      db
        .select({
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
          createdAt: apiKeys.createdAt,
        })
        .from(apiKeys)
        .leftJoin(users, eq(apiKeys.userId, users.id))
        .orderBy(desc(apiKeys.createdAt))
        .limit(pageSize)
        .offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(apiKeys),
      db
        .select({
          apiKeyId: apiAuditLogs.apiKeyId,
          count: sql<number>`count(*)`,
        })
        .from(apiAuditLogs)
        .groupBy(apiAuditLogs.apiKeyId),
    ]);

    const countMap = new Map(requestCounts.map(r => [r.apiKeyId, Number(r.count)]));
    const totalItems = Number(countResult[0]?.count || 0);

    const keysWithCount = keys.map(k => ({
      ...k,
      requestCount: countMap.get(k.id) || 0,
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
          hasPrev: page > 1,
        },
      },
    });
  } catch (error: any) {
    console.error('[Admin API Keys] List error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to list API keys' } });
  }
});

/**
 * GET /api/admin/api-keys/settings - Get default rate limit settings
 */
router.get('/settings', requireAdmin, async (req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      data: {
        defaultRateLimit: 100,
        defaultRateLimitWindow: 60,
      },
    });
  } catch (error: any) {
    console.error('[Admin API Keys] Settings error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to get settings' } });
  }
});

/**
 * PUT /api/admin/api-keys/settings - Update default rate limit settings
 */
router.put('/settings', requireAdmin, async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      defaultRateLimit: z.number().min(1).max(10000),
      defaultRateLimitWindow: z.number().min(1).max(3600),
    });

    const parseResult = schema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid settings' } });
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error('[Admin API Keys] Update settings error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to update settings' } });
  }
});

/**
 * PATCH /api/admin/api-keys/:id - Update an API key (toggle active, rate limit)
 */
router.patch('/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const updateSchema = z.object({
      isActive: z.boolean().optional(),
      rateLimit: z.number().min(1).max(10000).optional(),
      rateLimitWindow: z.number().min(1).max(3600).optional(),
    });
    const parseResult = updateSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid request body', details: parseResult.error.flatten().fieldErrors } });
    }

    const { isActive, rateLimit, rateLimitWindow } = parseResult.data;
    const updateData: Record<string, any> = {};
    if (typeof isActive === 'boolean') updateData.isActive = isActive;
    if (typeof rateLimit === 'number') updateData.rateLimit = rateLimit;
    if (typeof rateLimitWindow === 'number') updateData.rateLimitWindow = rateLimitWindow;

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'No valid fields to update' } });
    }

    const [updated] = await db
      .update(apiKeys)
      .set(updateData)
      .where(eq(apiKeys.id, id))
      .returning();

    if (!updated) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'API key not found' } });
    }

    res.json({ success: true, data: updated });
  } catch (error: any) {
    console.error('[Admin API Keys] Update error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to update API key' } });
  }
});

/**
 * DELETE /api/admin/api-keys/:id - Delete an API key
 */
router.delete('/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await db
      .delete(apiKeys)
      .where(eq(apiKeys.id, id))
      .returning();

    if (result.length === 0) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'API key not found' } });
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error('[Admin API Keys] Delete error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to delete API key' } });
  }
});

export default router;
