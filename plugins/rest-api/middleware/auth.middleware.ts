/**
 * ============================================================
 * REST API Plugin - Authentication Middleware
 * Handles API key validation, rate limiting, and request logging
 * ============================================================
 */

import type { Request, Response, NextFunction } from 'express';
import { ApiKeyService } from '../services/api-key.service.js';
import type { AuthenticatedApiRequest, ApiResponse, ApiErrorCode } from '../types.js';
import { API_ERROR_CODES } from '../types.js';
import type { ApiScope } from '../../../shared/schema.js';
import { nanoid } from 'nanoid';

/**
 * Extract API key from request headers
 * Supports: Authorization: Bearer <key> or X-API-Key: <key>
 */
function extractApiKey(req: Request): string | null {
  // Check Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  
  // Check X-API-Key header
  const apiKeyHeader = req.headers['x-api-key'];
  if (typeof apiKeyHeader === 'string') {
    return apiKeyHeader;
  }
  
  return null;
}

/**
 * Get client IP address
 */
function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

/**
 * Send error response
 */
function sendError(
  res: Response,
  statusCode: number,
  code: ApiErrorCode,
  message: string,
  requestId: string,
  details?: Record<string, unknown>
): void {
  const response: ApiResponse = {
    success: false,
    error: {
      code,
      message,
      details,
    },
    meta: {
      requestId,
      timestamp: new Date().toISOString(),
    },
  };
  res.status(statusCode).json(response);
}

/**
 * Main API authentication middleware
 */
export function apiAuthMiddleware(requiredScope?: ApiScope) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const requestId = nanoid(12);
    const requestStartTime = Date.now();
    const clientIp = getClientIp(req);
    
    // Attach request ID and start time to request
    (req as AuthenticatedApiRequest).requestId = requestId;
    (req as AuthenticatedApiRequest).requestStartTime = requestStartTime;
    
    // Add request ID to response headers
    res.setHeader('X-Request-ID', requestId);
    
    try {
      // Extract API key
      const apiKey = extractApiKey(req);
      if (!apiKey) {
        return sendError(res, 401, 'UNAUTHORIZED', 'API key is required. Provide via Authorization: Bearer <key> or X-API-Key header.', requestId);
      }
      
      // Validate API key
      const keyRecord = await ApiKeyService.validateKey(apiKey);
      if (!keyRecord) {
        return sendError(res, 401, 'INVALID_API_KEY', 'Invalid or expired API key.', requestId);
      }
      
      // Check IP whitelist
      if (!ApiKeyService.isIpAllowed(keyRecord, clientIp)) {
        await ApiKeyService.logRequest({
          userId: keyRecord.userId,
          apiKeyId: keyRecord.id,
          method: req.method,
          endpoint: req.route?.path || req.path,
          path: req.path,
          requestBody: req.body,
          queryParams: req.query,
          statusCode: 403,
          responseTime: Date.now() - requestStartTime,
          errorMessage: 'IP not whitelisted',
          ipAddress: clientIp,
          userAgent: req.headers['user-agent'],
          requestId,
        });
        return sendError(res, 403, 'IP_NOT_WHITELISTED', `IP address ${clientIp} is not in the whitelist.`, requestId);
      }
      
      // Check rate limit
      const rateLimitResult = await ApiKeyService.checkRateLimit(keyRecord);
      res.setHeader('X-RateLimit-Limit', keyRecord.rateLimit);
      res.setHeader('X-RateLimit-Remaining', rateLimitResult.remaining);
      res.setHeader('X-RateLimit-Reset', Math.ceil(rateLimitResult.resetAt.getTime() / 1000));
      
      if (!rateLimitResult.allowed) {
        await ApiKeyService.logRequest({
          userId: keyRecord.userId,
          apiKeyId: keyRecord.id,
          method: req.method,
          endpoint: req.route?.path || req.path,
          path: req.path,
          requestBody: req.body,
          queryParams: req.query,
          statusCode: 429,
          responseTime: Date.now() - requestStartTime,
          errorMessage: 'Rate limit exceeded',
          ipAddress: clientIp,
          userAgent: req.headers['user-agent'],
          requestId,
        });
        return sendError(res, 429, 'RATE_LIMIT_EXCEEDED', `Rate limit exceeded. Retry after ${Math.ceil((rateLimitResult.resetAt.getTime() - Date.now()) / 1000)} seconds.`, requestId, {
          retryAfter: Math.ceil((rateLimitResult.resetAt.getTime() - Date.now()) / 1000),
        });
      }
      
      // Check scope if required
      if (requiredScope && !ApiKeyService.hasScope(keyRecord, requiredScope)) {
        await ApiKeyService.logRequest({
          userId: keyRecord.userId,
          apiKeyId: keyRecord.id,
          method: req.method,
          endpoint: req.route?.path || req.path,
          path: req.path,
          requestBody: req.body,
          queryParams: req.query,
          statusCode: 403,
          responseTime: Date.now() - requestStartTime,
          errorMessage: `Missing scope: ${requiredScope}`,
          ipAddress: clientIp,
          userAgent: req.headers['user-agent'],
          requestId,
        });
        return sendError(res, 403, 'INSUFFICIENT_SCOPES', `API key does not have required scope: ${requiredScope}`, requestId, {
          requiredScope,
          availableScopes: keyRecord.scopes,
        });
      }
      
      // Attach auth context to request
      (req as AuthenticatedApiRequest).apiAuth = {
        userId: keyRecord.userId,
        apiKeyId: keyRecord.id,
        keyPrefix: keyRecord.keyPrefix,
        scopes: keyRecord.scopes as ApiScope[],
        rateLimit: keyRecord.rateLimit,
        rateLimitWindow: keyRecord.rateLimitWindow,
      };
      
      // Log request on response finish
      res.on('finish', () => {
        ApiKeyService.logRequest({
          userId: keyRecord.userId,
          apiKeyId: keyRecord.id,
          method: req.method,
          endpoint: req.route?.path || req.path,
          path: req.path,
          requestBody: req.body,
          queryParams: req.query,
          statusCode: res.statusCode,
          responseTime: Date.now() - requestStartTime,
          ipAddress: clientIp,
          userAgent: req.headers['user-agent'],
          requestId,
        }).catch(err => console.error('[REST API] Failed to log request:', err));
      });
      
      next();
    } catch (error: unknown) {
      console.error('[REST API] Auth middleware error:', error);
      return sendError(res, 500, 'INTERNAL_ERROR', 'An internal error occurred during authentication.', requestId);
    }
  };
}

/**
 * Scope checker middleware factory
 * Use after apiAuthMiddleware to check for specific scopes
 */
export function requireScope(scope: ApiScope) {
  return (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthenticatedApiRequest;
    const requestId = authReq.requestId || nanoid(12);
    
    if (!authReq.apiAuth) {
      return sendError(res, 401, 'UNAUTHORIZED', 'Authentication required.', requestId);
    }
    
    if (!ApiKeyService.hasScope({ scopes: authReq.apiAuth.scopes } as any, scope)) {
      return sendError(res, 403, 'INSUFFICIENT_SCOPES', `API key does not have required scope: ${scope}`, requestId);
    }
    
    next();
  };
}

/**
 * Helper to wrap route handlers with error handling
 */
export function asyncHandler(
  fn: (req: AuthenticatedApiRequest, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthenticatedApiRequest;
    Promise.resolve(fn(authReq, res, next)).catch((error: unknown) => {
      console.error('[REST API] Route handler error:', error);
      const requestId = authReq.requestId || 'unknown';
      sendError(res, 500, 'INTERNAL_ERROR', 'An internal error occurred.', requestId);
    });
  };
}
