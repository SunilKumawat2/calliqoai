import { ApiKeyService } from "../services/api-key.service.js";
import { nanoid } from "nanoid";
function extractApiKey(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.substring(7);
  }
  const apiKeyHeader = req.headers["x-api-key"];
  if (typeof apiKeyHeader === "string") {
    return apiKeyHeader;
  }
  return null;
}
function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "unknown";
}
function sendError(res, statusCode, code, message, requestId, details) {
  const response = {
    success: false,
    error: {
      code,
      message,
      details
    },
    meta: {
      requestId,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    }
  };
  res.status(statusCode).json(response);
}
function apiAuthMiddleware(requiredScope) {
  return async (req, res, next) => {
    const requestId = nanoid(12);
    const requestStartTime = Date.now();
    const clientIp = getClientIp(req);
    req.requestId = requestId;
    req.requestStartTime = requestStartTime;
    res.setHeader("X-Request-ID", requestId);
    try {
      const apiKey = extractApiKey(req);
      if (!apiKey) {
        return sendError(res, 401, "UNAUTHORIZED", "API key is required. Provide via Authorization: Bearer <key> or X-API-Key header.", requestId);
      }
      const keyRecord = await ApiKeyService.validateKey(apiKey);
      if (!keyRecord) {
        return sendError(res, 401, "INVALID_API_KEY", "Invalid or expired API key.", requestId);
      }
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
          errorMessage: "IP not whitelisted",
          ipAddress: clientIp,
          userAgent: req.headers["user-agent"],
          requestId
        });
        return sendError(res, 403, "IP_NOT_WHITELISTED", `IP address ${clientIp} is not in the whitelist.`, requestId);
      }
      const rateLimitResult = await ApiKeyService.checkRateLimit(keyRecord);
      res.setHeader("X-RateLimit-Limit", keyRecord.rateLimit);
      res.setHeader("X-RateLimit-Remaining", rateLimitResult.remaining);
      res.setHeader("X-RateLimit-Reset", Math.ceil(rateLimitResult.resetAt.getTime() / 1e3));
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
          errorMessage: "Rate limit exceeded",
          ipAddress: clientIp,
          userAgent: req.headers["user-agent"],
          requestId
        });
        return sendError(res, 429, "RATE_LIMIT_EXCEEDED", `Rate limit exceeded. Retry after ${Math.ceil((rateLimitResult.resetAt.getTime() - Date.now()) / 1e3)} seconds.`, requestId, {
          retryAfter: Math.ceil((rateLimitResult.resetAt.getTime() - Date.now()) / 1e3)
        });
      }
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
          userAgent: req.headers["user-agent"],
          requestId
        });
        return sendError(res, 403, "INSUFFICIENT_SCOPES", `API key does not have required scope: ${requiredScope}`, requestId, {
          requiredScope,
          availableScopes: keyRecord.scopes
        });
      }
      req.apiAuth = {
        userId: keyRecord.userId,
        apiKeyId: keyRecord.id,
        keyPrefix: keyRecord.keyPrefix,
        scopes: keyRecord.scopes,
        rateLimit: keyRecord.rateLimit,
        rateLimitWindow: keyRecord.rateLimitWindow
      };
      res.on("finish", () => {
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
          userAgent: req.headers["user-agent"],
          requestId
        }).catch((err) => console.error("[REST API] Failed to log request:", err));
      });
      next();
    } catch (error) {
      console.error("[REST API] Auth middleware error:", error);
      return sendError(res, 500, "INTERNAL_ERROR", "An internal error occurred during authentication.", requestId);
    }
  };
}
function requireScope(scope) {
  return (req, res, next) => {
    const authReq = req;
    const requestId = authReq.requestId || nanoid(12);
    if (!authReq.apiAuth) {
      return sendError(res, 401, "UNAUTHORIZED", "Authentication required.", requestId);
    }
    if (!ApiKeyService.hasScope({ scopes: authReq.apiAuth.scopes }, scope)) {
      return sendError(res, 403, "INSUFFICIENT_SCOPES", `API key does not have required scope: ${scope}`, requestId);
    }
    next();
  };
}
function asyncHandler(fn) {
  return (req, res, next) => {
    const authReq = req;
    Promise.resolve(fn(authReq, res, next)).catch((error) => {
      console.error("[REST API] Route handler error:", error);
      const requestId = authReq.requestId || "unknown";
      sendError(res, 500, "INTERNAL_ERROR", "An internal error occurred.", requestId);
    });
  };
}
export {
  apiAuthMiddleware,
  asyncHandler,
  requireScope
};
