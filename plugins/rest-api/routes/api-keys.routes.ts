/**
 * ============================================================
 * REST API Plugin - API Keys Management Routes
 * Endpoints for users to manage their API keys
 * These routes use session auth (not API key auth)
 * ============================================================
 */

import { Router, Request, Response } from 'express';
import { ApiKeyService } from '../services/api-key.service.js';
import type { ApiResponse } from '../types.js';
import { API_SCOPES, type ApiScope, apiAuditLogs } from '../../../shared/schema.js';
import { z } from 'zod';
import { db } from '../../../server/db.js';
import { eq, and, sql } from 'drizzle-orm';

const router = Router();

// Session auth middleware - requires logged in user
const requireAuth = (req: Request, res: Response, next: Function) => {
  if (!(req as any).userId) {
    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    });
  }
  next();
};

const createKeySchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.string()).optional(),
  rateLimit: z.number().int().min(10).max(10000).optional(),
  ipWhitelist: z.array(z.string().ip()).optional(),
  expiresAt: z.string().datetime().optional(),
  description: z.string().max(500).optional(),
});

const updateKeySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  scopes: z.array(z.string()).optional(),
  rateLimit: z.number().int().min(10).max(10000).optional(),
  ipWhitelist: z.array(z.string().ip()).optional(),
  isActive: z.boolean().optional(),
  description: z.string().max(500).optional(),
});

/**
 * GET /api/user/api-keys - List user's API keys
 */
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId as string;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(Math.max(1, parseInt(req.query.pageSize as string) || 50), 100);
    const offset = (page - 1) * pageSize;

    const allKeys = await ApiKeyService.getUserKeys(userId);
    const totalItems = allKeys.length;
    const paginatedKeys = allKeys.slice(offset, offset + pageSize);
    
    const response: ApiResponse = {
      success: true,
      data: paginatedKeys.map(k => ({
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
        createdAt: k.createdAt,
      })),
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
    };
    
    res.json(response);
  } catch (error: any) {
    console.error('[API Keys] Error listing keys:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to list API keys' },
    });
  }
});

/**
 * POST /api/user/api-keys - Create a new API key
 */
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId as string;
    
    const parseResult = createKeySchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request body',
          details: parseResult.error.flatten().fieldErrors,
        },
      });
    }
    
    const { name, scopes, rateLimit, ipWhitelist, expiresAt, description } = parseResult.data;
    
    // Validate scopes
    const validScopes = Object.keys(API_SCOPES);
    if (scopes) {
      const invalidScopes = scopes.filter(s => !validScopes.includes(s));
      if (invalidScopes.length > 0) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid scopes',
            details: { invalidScopes, validScopes },
          },
        });
      }
    }
    
    const { key, record } = await ApiKeyService.generateKey({
      userId,
      name,
      scopes: scopes as ApiScope[],
      rateLimit,
      ipWhitelist,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
      description,
    });
    
    const response: ApiResponse = {
      success: true,
      data: {
        id: record.id,
        name: record.name,
        key, // Full key - only shown once!
        keyPrefix: record.keyPrefix,
        scopes: record.scopes,
        rateLimit: record.rateLimit,
        ipWhitelist: record.ipWhitelist,
        expiresAt: record.expiresAt,
        description: record.description,
        createdAt: record.createdAt,
        warning: 'Save this API key securely. It will not be shown again.',
      },
    };
    
    res.status(201).json(response);
  } catch (error: any) {
    console.error('[API Keys] Error creating key:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to create API key' },
    });
  }
});

/**
 * PUT /api/user/api-keys/:id - Update an API key
 */
router.put('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId as string;
    const { id } = req.params;
    
    const parseResult = updateKeySchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request body',
          details: parseResult.error.flatten().fieldErrors,
        },
      });
    }
    
    const updates = parseResult.data;
    
    // Validate scopes if provided
    if (updates.scopes) {
      const validScopes = Object.keys(API_SCOPES);
      const invalidScopes = updates.scopes.filter(s => !validScopes.includes(s));
      if (invalidScopes.length > 0) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid scopes',
            details: { invalidScopes, validScopes },
          },
        });
      }
    }
    
    const updated = await ApiKeyService.updateKey(id, userId, updates as any);
    
    if (!updated) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'API key not found' },
      });
    }
    
    const response: ApiResponse = {
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
        updatedAt: updated.updatedAt,
      },
    };
    
    res.json(response);
  } catch (error: any) {
    console.error('[API Keys] Error updating key:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to update API key' },
    });
  }
});

/**
 * POST /api/user/api-keys/:id/regenerate - Regenerate API key secret
 */
router.post('/:id/regenerate', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId as string;
    const { id } = req.params;
    
    const result = await ApiKeyService.regenerateKey(id, userId);
    
    if (!result) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'API key not found' },
      });
    }
    
    const response: ApiResponse = {
      success: true,
      data: {
        id: result.record.id,
        name: result.record.name,
        key: result.key, // New full key - only shown once!
        keyPrefix: result.record.keyPrefix,
        warning: 'Save this API key securely. It will not be shown again. The old key is now invalid.',
      },
    };
    
    res.json(response);
  } catch (error: any) {
    console.error('[API Keys] Error regenerating key:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to regenerate API key' },
    });
  }
});

/**
 * DELETE /api/user/api-keys/:id - Delete an API key
 */
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId as string;
    const { id } = req.params;
    
    const deleted = await ApiKeyService.deleteKey(id, userId);
    
    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'API key not found' },
      });
    }
    
    const response: ApiResponse = {
      success: true,
      data: { deleted: true },
    };
    
    res.json(response);
  } catch (error: any) {
    console.error('[API Keys] Error deleting key:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to delete API key' },
    });
  }
});

/**
 * GET /api/user/api-keys/scopes - Get available scopes
 */
router.get('/scopes', requireAuth, async (req: Request, res: Response) => {
  const response: ApiResponse = {
    success: true,
    data: Object.entries(API_SCOPES).map(([scope, description]) => ({
      scope,
      description,
    })),
  };
  
  res.json(response);
});

/**
 * GET /api/user/api-keys/:id/audit-logs - Get audit logs for a key
 */
router.get('/:id/audit-logs', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId as string;
    const { id } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize as string) || 50, 100);
    
    const [logs, countResult] = await Promise.all([
      ApiKeyService.getAuditLogs(userId, { page, pageSize, apiKeyId: id }),
      db.select({ count: sql<number>`count(*)` }).from(apiAuditLogs).where(and(eq(apiAuditLogs.userId, userId), eq(apiAuditLogs.apiKeyId, id))),
    ]);
    
    const totalItems = Number(countResult[0]?.count || 0);
    
    const response: ApiResponse = {
      success: true,
      data: logs,
      meta: {
        requestId: 'audit-log-request',
        timestamp: new Date().toISOString(),
        pagination: {
          page,
          pageSize,
          totalItems,
          totalPages: Math.ceil(totalItems / pageSize),
          hasNext: page < Math.ceil(totalItems / pageSize),
          hasPrev: page > 1,
        },
      },
    };
    
    res.json(response);
  } catch (error: any) {
    console.error('[API Keys] Error fetching audit logs:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch audit logs' },
    });
  }
});

export default router;
