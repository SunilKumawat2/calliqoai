/**
 * ============================================================
 * REST API Plugin - API Key Service
 * Handles API key generation, validation, and management
 * ============================================================
 */

import { db } from '../../../server/db.js';
import { apiKeys, apiAuditLogs, apiRateLimits, users } from '../../../shared/schema.js';
import type { ApiKey, ApiScope } from '../../../shared/schema.js';
import { eq, and, gte, sql } from 'drizzle-orm';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { API_KEY_PREFIX } from '../types.js';

const BCRYPT_ROUNDS = 12;

export class ApiKeyService {
  /**
   * Generate a new API key for a user
   * Returns the full key (shown once) and the stored key record
   */
  static async generateKey(params: {
    userId: string;
    name: string;
    scopes?: ApiScope[];
    rateLimit?: number;
    ipWhitelist?: string[];
    expiresAt?: Date;
    description?: string;
  }): Promise<{ key: string; record: ApiKey }> {
    // Generate a cryptographically secure random key
    const randomBytes = crypto.randomBytes(32);
    const keySecret = randomBytes.toString('base64url');
    const fullKey = `${API_KEY_PREFIX}${keySecret}`;
    
    // Extract prefix for identification (first 12 chars including prefix)
    const keyPrefix = fullKey.substring(0, 16);
    
    // Hash the secret for storage
    const hashedSecret = await bcrypt.hash(keySecret, BCRYPT_ROUNDS);
    
    // Insert into database
    const [record] = await db
      .insert(apiKeys)
      .values({
        userId: params.userId,
        name: params.name,
        keyPrefix,
        hashedSecret,
        scopes: params.scopes || ['calls:read', 'calls:write', 'campaigns:read', 'contacts:read'],
        rateLimit: params.rateLimit || 100,
        ipWhitelist: params.ipWhitelist || [],
        expiresAt: params.expiresAt,
        description: params.description,
      })
      .returning();
    
    return { key: fullKey, record };
  }
  
  /**
   * Validate an API key and return the key record if valid
   */
  static async validateKey(fullKey: string): Promise<ApiKey | null> {
    // Validate format
    if (!fullKey.startsWith(API_KEY_PREFIX)) {
      return null;
    }
    
    // Extract prefix and secret
    const keyPrefix = fullKey.substring(0, 16);
    const keySecret = fullKey.substring(API_KEY_PREFIX.length);
    
    // Find key by prefix
    const [keyRecord] = await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.keyPrefix, keyPrefix))
      .limit(1);
    
    if (!keyRecord) {
      return null;
    }
    
    // Check if key is active
    if (!keyRecord.isActive) {
      return null;
    }
    
    // Check expiration
    if (keyRecord.expiresAt && new Date(keyRecord.expiresAt) < new Date()) {
      return null;
    }
    
    // Verify the secret
    const isValid = await bcrypt.compare(keySecret, keyRecord.hashedSecret);
    if (!isValid) {
      return null;
    }
    
    // Update last used timestamp
    await db
      .update(apiKeys)
      .set({
        lastUsedAt: new Date(),
        totalRequests: sql`${apiKeys.totalRequests} + 1`,
      })
      .where(eq(apiKeys.id, keyRecord.id));
    
    return keyRecord;
  }
  
  /**
   * Check if IP is allowed for this key
   */
  static isIpAllowed(keyRecord: ApiKey, clientIp: string): boolean {
    // Empty whitelist = allow all
    if (!keyRecord.ipWhitelist || keyRecord.ipWhitelist.length === 0) {
      return true;
    }
    
    // Check if IP is in whitelist
    return keyRecord.ipWhitelist.includes(clientIp);
  }
  
  /**
   * Check if key has required scope
   */
  static hasScope(keyRecord: ApiKey, requiredScope: ApiScope): boolean {
    // Admin scope has access to everything
    if (keyRecord.scopes.includes('admin')) {
      return true;
    }
    
    return keyRecord.scopes.includes(requiredScope);
  }
  
  /**
   * Check and update rate limit
   * Returns true if request is allowed, false if rate limited
   */
  static async checkRateLimit(keyRecord: ApiKey): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
    const now = new Date();
    const windowStart = new Date(now.getTime() - (keyRecord.rateLimitWindow * 1000));
    
    // Get current request count in window
    const [rateLimit] = await db
      .select()
      .from(apiRateLimits)
      .where(
        and(
          eq(apiRateLimits.apiKeyId, keyRecord.id),
          gte(apiRateLimits.windowStart, windowStart)
        )
      )
      .limit(1);
    
    const currentCount = rateLimit?.requestCount || 0;
    const resetAt = new Date(now.getTime() + (keyRecord.rateLimitWindow * 1000));
    
    if (currentCount >= keyRecord.rateLimit) {
      return {
        allowed: false,
        remaining: 0,
        resetAt,
      };
    }
    
    // Update or insert rate limit record
    if (rateLimit) {
      await db
        .update(apiRateLimits)
        .set({ requestCount: sql`${apiRateLimits.requestCount} + 1` })
        .where(eq(apiRateLimits.id, rateLimit.id));
    } else {
      await db
        .insert(apiRateLimits)
        .values({
          apiKeyId: keyRecord.id,
          windowStart: now,
          requestCount: 1,
        });
    }
    
    return {
      allowed: true,
      remaining: keyRecord.rateLimit - currentCount - 1,
      resetAt,
    };
  }
  
  /**
   * Get all API keys for a user (without secrets)
   */
  static async getUserKeys(userId: string): Promise<Omit<ApiKey, 'hashedSecret'>[]> {
    const keys = await db
      .select({
        id: apiKeys.id,
        userId: apiKeys.userId,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        scopes: apiKeys.scopes,
        rateLimit: apiKeys.rateLimit,
        rateLimitWindow: apiKeys.rateLimitWindow,
        ipWhitelist: apiKeys.ipWhitelist,
        expiresAt: apiKeys.expiresAt,
        isActive: apiKeys.isActive,
        lastUsedAt: apiKeys.lastUsedAt,
        lastUsedIp: apiKeys.lastUsedIp,
        totalRequests: apiKeys.totalRequests,
        description: apiKeys.description,
        metadata: apiKeys.metadata,
        createdAt: apiKeys.createdAt,
        updatedAt: apiKeys.updatedAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.userId, userId));
    
    return keys as Omit<ApiKey, 'hashedSecret'>[];
  }
  
  /**
   * Revoke an API key
   */
  static async revokeKey(keyId: string, userId: string): Promise<boolean> {
    const result = await db
      .update(apiKeys)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId)))
      .returning();
    
    return result.length > 0;
  }
  
  /**
   * Delete an API key permanently
   */
  static async deleteKey(keyId: string, userId: string): Promise<boolean> {
    const result = await db
      .delete(apiKeys)
      .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId)))
      .returning();
    
    return result.length > 0;
  }
  
  /**
   * Update API key settings
   */
  static async updateKey(keyId: string, userId: string, updates: {
    name?: string;
    scopes?: ApiScope[];
    rateLimit?: number;
    ipWhitelist?: string[];
    isActive?: boolean;
    description?: string;
  }): Promise<ApiKey | null> {
    const [updated] = await db
      .update(apiKeys)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId)))
      .returning();
    
    return updated || null;
  }
  
  /**
   * Regenerate an API key (creates new secret, keeps settings)
   */
  static async regenerateKey(keyId: string, userId: string): Promise<{ key: string; record: ApiKey } | null> {
    // Get existing key
    const [existing] = await db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId)))
      .limit(1);
    
    if (!existing) {
      return null;
    }
    
    // Generate new secret
    const randomBytes = crypto.randomBytes(32);
    const keySecret = randomBytes.toString('base64url');
    const fullKey = `${API_KEY_PREFIX}${keySecret}`;
    const keyPrefix = fullKey.substring(0, 16);
    const hashedSecret = await bcrypt.hash(keySecret, BCRYPT_ROUNDS);
    
    // Update with new secret
    const [updated] = await db
      .update(apiKeys)
      .set({
        keyPrefix,
        hashedSecret,
        updatedAt: new Date(),
      })
      .where(eq(apiKeys.id, keyId))
      .returning();
    
    return { key: fullKey, record: updated };
  }
  
  /**
   * Log an API request
   */
  static async logRequest(params: {
    userId: string;
    apiKeyId: string;
    method: string;
    endpoint: string;
    path: string;
    requestBody?: unknown;
    queryParams?: unknown;
    statusCode: number;
    responseTime: number;
    errorMessage?: string;
    ipAddress?: string;
    userAgent?: string;
    requestId: string;
  }): Promise<void> {
    // Sanitize request body (remove sensitive fields)
    let sanitizedBody = params.requestBody;
    if (typeof sanitizedBody === 'object' && sanitizedBody !== null) {
      const body = { ...sanitizedBody as Record<string, unknown> };
      delete body.password;
      delete body.secret;
      delete body.apiKey;
      delete body.token;
      sanitizedBody = body;
    }
    
    await db.insert(apiAuditLogs).values({
      userId: params.userId,
      apiKeyId: params.apiKeyId,
      method: params.method,
      endpoint: params.endpoint,
      path: params.path,
      requestBody: sanitizedBody as Record<string, unknown>,
      queryParams: params.queryParams as Record<string, unknown>,
      statusCode: params.statusCode,
      responseTime: params.responseTime,
      errorMessage: params.errorMessage,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      requestId: params.requestId,
    });
  }
  
  /**
   * Get audit logs for a user
   */
  static async getAuditLogs(userId: string, options: {
    page?: number;
    pageSize?: number;
    apiKeyId?: string;
  } = {}) {
    const page = options.page || 1;
    const pageSize = Math.min(options.pageSize || 50, 100);
    const offset = (page - 1) * pageSize;
    
    const conditions = [eq(apiAuditLogs.userId, userId)];
    if (options.apiKeyId) {
      conditions.push(eq(apiAuditLogs.apiKeyId, options.apiKeyId));
    }
    
    const logs = await db
      .select()
      .from(apiAuditLogs)
      .where(and(...conditions))
      .orderBy(sql`${apiAuditLogs.createdAt} DESC`)
      .limit(pageSize)
      .offset(offset);
    
    return logs;
  }
}
