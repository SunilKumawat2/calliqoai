"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.webhookDeliveryService = exports.WebhookDeliveryService = void 0;
/**
 * ============================================================
 * © 2025 Diploy — a brand of Bisht Technologies Private Limited
 * Original Author: BTPL Engineering Team
 * Website: https://diploy.in
 * Contact: cs@diploy.in
 *
 * Distributed under the Envato / CodeCanyon License Agreement.
 * Licensed to the purchaser for use as defined by the
 * Envato Market (CodeCanyon) Regular or Extended License.
 *
 * You are NOT permitted to redistribute, resell, sublicense,
 * or share this source code, in whole or in part.
 * Respect the author's rights and Envato licensing terms.
 * ============================================================
 */
const crypto_1 = require("crypto");
const storage_1 = require("../storage");
const db_1 = require("../db");
const schema_1 = require("@shared/schema");
const drizzle_orm_1 = require("drizzle-orm");
const url_validator_1 = require("../utils/url-validator");
const RETRY_DELAYS = [0, 60000, 300000]; // 0s, 1min, 5min
class WebhookDeliveryService {
    generateSignature(payload, secret) {
        return crypto_1.default
            .createHmac('sha256', secret)
            .update(payload)
            .digest('hex');
    }
    buildHeaders(webhook, payloadString) {
        const headers = {
            'Content-Type': 'application/json',
            'User-Agent': 'Platform-Webhook/1.0',
            'X-Webhook-Event': webhook.events?.[0] || 'unknown',
            'X-Webhook-Delivery': crypto_1.default.randomUUID(),
            'X-Webhook-Signature': `sha256=${this.generateSignature(payloadString, webhook.secret)}`,
        };
        if (webhook.authType === 'basic' && webhook.authCredentials) {
            const creds = webhook.authCredentials;
            if (creds.username && creds.password) {
                const basicAuth = Buffer.from(`${creds.username}:${creds.password}`).toString('base64');
                headers['Authorization'] = `Basic ${basicAuth}`;
            }
        }
        else if (webhook.authType === 'bearer' && webhook.authCredentials) {
            const creds = webhook.authCredentials;
            if (creds.token) {
                headers['Authorization'] = `Bearer ${creds.token}`;
            }
        }
        if (webhook.headers) {
            const customHeaders = webhook.headers;
            Object.assign(headers, customHeaders);
        }
        return headers;
    }
    async deliverWebhook(webhook, payload, attemptNumber = 1) {
        const payloadString = JSON.stringify(payload);
        const headers = this.buildHeaders(webhook, payloadString);
        const startTime = Date.now();
        console.log(`📤 [Webhook] Delivering to ${webhook.url} (attempt ${attemptNumber})`);
        console.log(`   Event: ${payload.event}`);
        try {
            const urlCheck = await (0, url_validator_1.validateWebhookUrl)(webhook.url);
            if (!urlCheck.valid) {
                console.warn(`🚫 [Webhook] SSRF blocked: ${urlCheck.error} for URL ${webhook.url}`);
                return {
                    success: false,
                    statusCode: 0,
                    responseBody: `Blocked: ${urlCheck.error}`,
                    responseTime: 0,
                    error: urlCheck.error,
                };
            }
            const response = await fetch(webhook.url, {
                method: webhook.method || 'POST',
                headers,
                body: payloadString,
                signal: AbortSignal.timeout(30000),
                redirect: 'error',
            });
            const responseTime = Date.now() - startTime;
            let responseBody = '';
            try {
                responseBody = await response.text();
                if (responseBody.length > 10000) {
                    responseBody = responseBody.substring(0, 10000) + '...[truncated]';
                }
            }
            catch {
                responseBody = 'Unable to read response body';
            }
            const success = response.ok;
            console.log(`${success ? '✅' : '❌'} [Webhook] Status: ${response.status}, Time: ${responseTime}ms`);
            return {
                success,
                httpStatus: response.status,
                responseBody,
                responseTime,
            };
        }
        catch (error) {
            const responseTime = Date.now() - startTime;
            const errorMessage = error.name === 'TimeoutError'
                ? 'Request timed out after 30 seconds'
                : error.message || 'Unknown error';
            console.error(`❌ [Webhook] Delivery failed: ${errorMessage}`);
            return {
                success: false,
                responseTime,
                error: errorMessage,
            };
        }
    }
    async deliverWithRetry(webhook, payload, maxAttempts = 3) {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const result = await this.deliverWebhook(webhook, payload, attempt);
            const logData = {
                webhookId: webhook.id,
                event: payload.event,
                payload: payload,
                success: result.success,
                httpStatus: result.httpStatus || null,
                responseBody: result.responseBody || null,
                responseTime: result.responseTime || null,
                error: result.error || null,
                attemptNumber: attempt,
                maxAttempts,
                nextRetryAt: null,
            };
            if (!result.success && attempt < maxAttempts) {
                const delay = RETRY_DELAYS[attempt] || 300000;
                logData.nextRetryAt = new Date(Date.now() + delay);
                console.log(`⏳ [Webhook] Scheduling retry in ${delay / 1000}s`);
            }
            try {
                // Check if webhook still exists before logging (might have been deleted)
                const webhookExists = await storage_1.storage.getWebhook(webhook.id);
                if (webhookExists) {
                    await storage_1.storage.createWebhookLog(logData);
                }
                else {
                    console.log(`ℹ️ [Webhook] Skipping log - webhook ${webhook.id} was deleted`);
                }
            }
            catch (err) {
                // Handle foreign key constraint violations gracefully (webhook was deleted)
                if (err.code === '23503' || err.message?.includes('foreign key constraint')) {
                    console.log(`ℹ️ [Webhook] Skipping log - webhook ${webhook.id} no longer exists`);
                }
                else {
                    console.error(`❌ [Webhook] Failed to log delivery:`, err);
                }
            }
            if (result.success) {
                console.log(`✅ [Webhook] Delivery successful on attempt ${attempt}`);
                return;
            }
            if (attempt < maxAttempts) {
                const delay = RETRY_DELAYS[attempt] || 60000;
                console.log(`⏳ [Webhook] Waiting ${delay / 1000}s before retry...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        console.error(`❌ [Webhook] All ${maxAttempts} attempts failed for ${webhook.url}`);
    }
    async triggerEvent(userId, event, data, campaignId) {
        console.log(`🔔 [Webhook] Triggering event: ${event}`);
        console.log(`   UserId: ${userId}, CampaignId: ${campaignId || 'N/A'}`);
        try {
            const webhooks = await storage_1.storage.getWebhooksForEvent(userId, event, campaignId || undefined);
            if (webhooks.length === 0) {
                console.log(`ℹ️ [Webhook] No webhooks configured for event: ${event}`);
                return;
            }
            console.log(`📤 [Webhook] Found ${webhooks.length} webhook(s) to deliver`);
            const payload = {
                event,
                timestamp: new Date().toISOString(),
                data,
            };
            const deliveryPromises = webhooks.map(webhook => this.deliverWithRetry(webhook, payload).catch(err => {
                console.error(`❌ [Webhook] Error delivering to ${webhook.url}:`, err);
            }));
            await Promise.allSettled(deliveryPromises);
            console.log(`✅ [Webhook] Event ${event} processing complete`);
        }
        catch (error) {
            console.error(`❌ [Webhook] Error triggering event ${event}:`, error);
        }
    }
    async testWebhook(webhookId, userId) {
        const [webhook] = await db_1.db
            .select()
            .from(schema_1.webhooks)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.webhooks.id, webhookId), (0, drizzle_orm_1.eq)(schema_1.webhooks.userId, userId)));
        if (!webhook) {
            throw new Error('Webhook not found');
        }
        const testPayload = {
            event: 'webhook.test',
            timestamp: new Date().toISOString(),
            data: {
                test: true,
                message: 'This is a test webhook from your platform',
            }
        };
        console.log(`🧪 Testing webhook ${webhookId}...`);
        const result = await this.deliverWebhook(webhook, testPayload, 1);
        return {
            success: result.success,
            statusCode: result.httpStatus || 0,
            responseTime: result.responseTime || 0,
            responseBody: result.responseBody || '',
            error: result.error
        };
    }
    async retryWebhook(logId, userId) {
        const [log] = await db_1.db
            .select()
            .from(schema_1.webhookLogs)
            .where((0, drizzle_orm_1.eq)(schema_1.webhookLogs.id, logId));
        if (!log) {
            throw new Error('Webhook log not found');
        }
        const [webhook] = await db_1.db
            .select()
            .from(schema_1.webhooks)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.webhooks.id, log.webhookId), (0, drizzle_orm_1.eq)(schema_1.webhooks.userId, userId)));
        if (!webhook) {
            throw new Error('Webhook not found or access denied');
        }
        console.log(`🔄 Manually retrying webhook ${webhook.id} (log ${logId})...`);
        const payload = {
            event: log.event,
            timestamp: new Date().toISOString(),
            data: log.payload?.data || log.payload
        };
        const result = await this.deliverWebhook(webhook, payload, 1);
        const logData = {
            webhookId: webhook.id,
            event: log.event,
            payload: log.payload,
            success: result.success,
            httpStatus: result.httpStatus || null,
            responseBody: result.responseBody || null,
            responseTime: result.responseTime || null,
            error: result.error || null,
            attemptNumber: 1,
            maxAttempts: 1,
            nextRetryAt: null,
        };
        try {
            const newLog = await storage_1.storage.createWebhookLog(logData);
            return {
                success: result.success,
                newLogId: newLog?.id,
                error: result.error
            };
        }
        catch (err) {
            console.error(`❌ [Webhook] Failed to log retry:`, err);
            return {
                success: result.success,
                error: result.error
            };
        }
    }
}
exports.WebhookDeliveryService = WebhookDeliveryService;
exports.webhookDeliveryService = new WebhookDeliveryService();
