import { db } from "../../../server/db.js";
import { apiKeys, apiAuditLogs, apiRateLimits } from "../../../shared/schema.js";
import { eq, and, gte, sql } from "drizzle-orm";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { API_KEY_PREFIX } from "../types.js";
const BCRYPT_ROUNDS = 12;
class ApiKeyService {
  /**
   * Generate a new API key for a user
   * Returns the full key (shown once) and the stored key record
   */
  static async generateKey(params) {
    const randomBytes = crypto.randomBytes(32);
    const keySecret = randomBytes.toString("base64url");
    const fullKey = `${API_KEY_PREFIX}${keySecret}`;
    const keyPrefix = fullKey.substring(0, 16);
    const hashedSecret = await bcrypt.hash(keySecret, BCRYPT_ROUNDS);
    const [record] = await db.insert(apiKeys).values({
      userId: params.userId,
      name: params.name,
      keyPrefix,
      hashedSecret,
      scopes: params.scopes || ["calls:read", "calls:write", "campaigns:read", "contacts:read"],
      rateLimit: params.rateLimit || 100,
      ipWhitelist: params.ipWhitelist || [],
      expiresAt: params.expiresAt,
      description: params.description
    }).returning();
    return { key: fullKey, record };
  }
  /**
   * Validate an API key and return the key record if valid
   */
  static async validateKey(fullKey) {
    if (!fullKey.startsWith(API_KEY_PREFIX)) {
      return null;
    }
    const keyPrefix = fullKey.substring(0, 16);
    const keySecret = fullKey.substring(API_KEY_PREFIX.length);
    const [keyRecord] = await db.select().from(apiKeys).where(eq(apiKeys.keyPrefix, keyPrefix)).limit(1);
    if (!keyRecord) {
      return null;
    }
    if (!keyRecord.isActive) {
      return null;
    }
    if (keyRecord.expiresAt && new Date(keyRecord.expiresAt) < /* @__PURE__ */ new Date()) {
      return null;
    }
    const isValid = await bcrypt.compare(keySecret, keyRecord.hashedSecret);
    if (!isValid) {
      return null;
    }
    await db.update(apiKeys).set({
      lastUsedAt: /* @__PURE__ */ new Date(),
      totalRequests: sql`${apiKeys.totalRequests} + 1`
    }).where(eq(apiKeys.id, keyRecord.id));
    return keyRecord;
  }
  /**
   * Check if IP is allowed for this key
   */
  static isIpAllowed(keyRecord, clientIp) {
    if (!keyRecord.ipWhitelist || keyRecord.ipWhitelist.length === 0) {
      return true;
    }
    return keyRecord.ipWhitelist.includes(clientIp);
  }
  /**
   * Check if key has required scope
   */
  static hasScope(keyRecord, requiredScope) {
    if (keyRecord.scopes.includes("admin")) {
      return true;
    }
    return keyRecord.scopes.includes(requiredScope);
  }
  /**
   * Check and update rate limit
   * Returns true if request is allowed, false if rate limited
   */
  static async checkRateLimit(keyRecord) {
    const now = /* @__PURE__ */ new Date();
    const windowStart = new Date(now.getTime() - keyRecord.rateLimitWindow * 1e3);
    const [rateLimit] = await db.select().from(apiRateLimits).where(
      and(
        eq(apiRateLimits.apiKeyId, keyRecord.id),
        gte(apiRateLimits.windowStart, windowStart)
      )
    ).limit(1);
    const currentCount = rateLimit?.requestCount || 0;
    const resetAt = new Date(now.getTime() + keyRecord.rateLimitWindow * 1e3);
    if (currentCount >= keyRecord.rateLimit) {
      return {
        allowed: false,
        remaining: 0,
        resetAt
      };
    }
    if (rateLimit) {
      await db.update(apiRateLimits).set({ requestCount: sql`${apiRateLimits.requestCount} + 1` }).where(eq(apiRateLimits.id, rateLimit.id));
    } else {
      await db.insert(apiRateLimits).values({
        apiKeyId: keyRecord.id,
        windowStart: now,
        requestCount: 1
      });
    }
    return {
      allowed: true,
      remaining: keyRecord.rateLimit - currentCount - 1,
      resetAt
    };
  }
  /**
   * Get all API keys for a user (without secrets)
   */
  static async getUserKeys(userId) {
    const keys = await db.select({
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
      updatedAt: apiKeys.updatedAt
    }).from(apiKeys).where(eq(apiKeys.userId, userId));
    return keys;
  }
  /**
   * Revoke an API key
   */
  static async revokeKey(keyId, userId) {
    const result = await db.update(apiKeys).set({ isActive: false, updatedAt: /* @__PURE__ */ new Date() }).where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId))).returning();
    return result.length > 0;
  }
  /**
   * Delete an API key permanently
   */
  static async deleteKey(keyId, userId) {
    const result = await db.delete(apiKeys).where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId))).returning();
    return result.length > 0;
  }
  /**
   * Update API key settings
   */
  static async updateKey(keyId, userId, updates) {
    const [updated] = await db.update(apiKeys).set({
      ...updates,
      updatedAt: /* @__PURE__ */ new Date()
    }).where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId))).returning();
    return updated || null;
  }
  /**
   * Regenerate an API key (creates new secret, keeps settings)
   */
  static async regenerateKey(keyId, userId) {
    const [existing] = await db.select().from(apiKeys).where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId))).limit(1);
    if (!existing) {
      return null;
    }
    const randomBytes = crypto.randomBytes(32);
    const keySecret = randomBytes.toString("base64url");
    const fullKey = `${API_KEY_PREFIX}${keySecret}`;
    const keyPrefix = fullKey.substring(0, 16);
    const hashedSecret = await bcrypt.hash(keySecret, BCRYPT_ROUNDS);
    const [updated] = await db.update(apiKeys).set({
      keyPrefix,
      hashedSecret,
      updatedAt: /* @__PURE__ */ new Date()
    }).where(eq(apiKeys.id, keyId)).returning();
    return { key: fullKey, record: updated };
  }
  /**
   * Log an API request
   */
  static async logRequest(params) {
    let sanitizedBody = params.requestBody;
    if (typeof sanitizedBody === "object" && sanitizedBody !== null) {
      const body = { ...sanitizedBody };
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
      requestBody: sanitizedBody,
      queryParams: params.queryParams,
      statusCode: params.statusCode,
      responseTime: params.responseTime,
      errorMessage: params.errorMessage,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      requestId: params.requestId
    });
  }
  /**
   * Get audit logs for a user
   */
  static async getAuditLogs(userId, options = {}) {
    const page = options.page || 1;
    const pageSize = Math.min(options.pageSize || 50, 100);
    const offset = (page - 1) * pageSize;
    const conditions = [eq(apiAuditLogs.userId, userId)];
    if (options.apiKeyId) {
      conditions.push(eq(apiAuditLogs.apiKeyId, options.apiKeyId));
    }
    const logs = await db.select().from(apiAuditLogs).where(and(...conditions)).orderBy(sql`${apiAuditLogs.createdAt} DESC`).limit(pageSize).offset(offset);
    return logs;
  }
}
export {
  ApiKeyService
};
