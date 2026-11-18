/**
 * ============================================================
 * Calliqo AI - Real Instagram / Facebook DM & Comment Webhook Engine
 *
 * Receives LIVE events from Meta (Graph API Webhooks) for:
 *   - Instagram Direct Messages        (object: "instagram", entry[].messaging[])
 *   - Instagram Post / Reel Comments   (object: "instagram", entry[].changes[] field "comments")
 *   - Facebook Messenger (Page) DMs     (object: "page", entry[].messaging[])
 *   - Facebook Page Post Comments       (object: "page", entry[].changes[] field "feed", item "comment")
 *
 * For each event it:
 *   1. Resolves the tenant (userId) by matching the Facebook Page ID / Instagram Account ID
 *      saved in the tenant's Social Lead Capture settings.
 *   2. Verifies X-Hub-Signature-256 when a Meta App Secret is configured.
 *   3. Runs the existing SocialEmailAssistantService.processSocialLeadEvent (AI reply + CRM lead).
 *   4. Sends the public comment reply + private DM back through the Meta Graph API.
 *
 * This module is fully isolated: it does NOT touch the existing WhatsApp webhook
 * (/api/webhooks/messaging/...) or the Meta Lead Ads webhook (/api/v1/integrations/meta/...).
 * ============================================================
 */

import * as crypto from 'crypto';
import { db } from '../db';
import { sql } from 'drizzle-orm';
import {
  SocialEmailAssistantService,
  type SocialLeadCaptureConfig,
} from './social-email-assistant.service';

const SOCIAL_CONFIG_KEY = '__CRM_SOCIAL_LEAD_CAPTURE_CONFIG__';
const GRAPH_API_VERSION = 'v19.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const MAX_MESSAGE_LENGTH = 1900;

type SocialPlatform = 'instagram_dm' | 'instagram_comment' | 'facebook_dm' | 'facebook_comment';

interface NormalizedSocialEvent {
  platform: SocialPlatform;
  accountId: string; // Facebook Page ID or Instagram Business Account ID (entry.id)
  senderId: string;
  senderName?: string;
  senderUsername?: string;
  text: string;
  eventId: string; // message mid or comment id (used for de-duplication)
  commentId?: string;
  postId?: string;
}

export interface SocialWebhookActivity {
  timestamp: string;
  platform: SocialPlatform | 'unknown';
  accountId: string;
  sender: string;
  text: string;
  status: 'processed' | 'skipped' | 'error';
  reason?: string;
  commentReplySent?: boolean;
  dmSent?: boolean;
  deliveryError?: string;
}

/** Recently processed event IDs (Meta retries deliveries; avoid double replies). */
const processedEventIds = new Map<string, number>();
const DEDUPE_TTL_MS = 6 * 60 * 60 * 1000;

/** In-memory recent activity per user (shown on the dashboard for live testing). */
const recentActivity = new Map<string, SocialWebhookActivity[]>();
let lastWebhookReceivedAt: string | null = null;

function rememberEvent(eventId: string): boolean {
  const now = Date.now();
  if (processedEventIds.size > 5000) {
    processedEventIds.forEach((ts, id) => {
      if (now - ts > DEDUPE_TTL_MS) processedEventIds.delete(id);
    });
  }
  if (processedEventIds.has(eventId)) return false;
  processedEventIds.set(eventId, now);
  return true;
}

function pushActivity(userId: string, activity: SocialWebhookActivity) {
  const list = recentActivity.get(userId) || [];
  list.unshift(activity);
  recentActivity.set(userId, list.slice(0, 30));
}

function truncate(text: string, max = MAX_MESSAGE_LENGTH): string {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

export class SocialMetaWebhookService {
  // ─────────────────────────────────────────────────────────────
  // Tenant resolution
  // ─────────────────────────────────────────────────────────────
  static async findTenantByAccountId(
    accountId: string
  ): Promise<{ userId: string; config: SocialLeadCaptureConfig } | null> {
    if (!accountId) return null;
    try {
      const result = await db.execute(sql`
        SELECT user_id FROM user_email_templates
        WHERE name = ${SOCIAL_CONFIG_KEY}
          AND (
            design_json->>'facebookPageId' = ${accountId}
            OR design_json->>'instagramAccountId' = ${accountId}
          )
        ORDER BY updated_at DESC
        LIMIT 1
      `);
      const row = (result as any)?.rows?.[0];
      if (!row?.user_id) return null;
      const config = await SocialEmailAssistantService.getSocialConfig(row.user_id);
      return { userId: row.user_id, config };
    } catch (err: any) {
      console.warn('[SocialMetaWebhook] Tenant lookup failed:', err?.message);
      return null;
    }
  }

  /** Validates the hub.verify_token sent by Meta during webhook setup. */
  static async isValidVerifyToken(token: string): Promise<boolean> {
    if (!token) return false;
    if (process.env.META_SOCIAL_VERIFY_TOKEN && token === process.env.META_SOCIAL_VERIFY_TOKEN) {
      return true;
    }
    try {
      const result = await db.execute(sql`
        SELECT 1 FROM user_email_templates
        WHERE name = ${SOCIAL_CONFIG_KEY}
          AND design_json->>'webhookVerifyToken' = ${token}
        LIMIT 1
      `);
      if ((result as any)?.rows?.length > 0) return true;
    } catch (err: any) {
      console.warn('[SocialMetaWebhook] Verify token lookup failed:', err?.message);
    }
    // Default token shown in the dashboard for tenants who have not customised it yet
    return token === 'calliqo_social_verify_token';
  }

  static verifySignature(rawBody: Buffer | undefined, signatureHeader: string | undefined, appSecret: string): boolean {
    if (!appSecret) return true; // Signature checking is optional until an App Secret is saved
    if (!rawBody || !signatureHeader) return false;
    try {
      const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
      const a = Buffer.from(expected);
      const b = Buffer.from(signatureHeader);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Payload normalisation
  // ─────────────────────────────────────────────────────────────
  static normalizePayload(body: any): NormalizedSocialEvent[] {
    const events: NormalizedSocialEvent[] = [];
    if (!body || !Array.isArray(body.entry)) return events;
    const isInstagram = body.object === 'instagram';
    const isPage = body.object === 'page';
    if (!isInstagram && !isPage) return events;

    for (const entry of body.entry) {
      const accountId = String(entry?.id || '');

      // A. Direct Messages (Instagram DM / Facebook Messenger)
      if (Array.isArray(entry?.messaging)) {
        for (const m of entry.messaging) {
          const msg = m?.message;
          if (!msg || msg.is_echo) continue; // ignore our own outgoing messages
          const senderId = String(m?.sender?.id || '');
          if (!senderId || senderId === accountId) continue;
          const text = String(msg.text || '').trim();
          if (!text) continue; // attachments/stickers without text are ignored
          events.push({
            platform: isInstagram ? 'instagram_dm' : 'facebook_dm',
            accountId,
            senderId,
            text,
            eventId: String(msg.mid || `${senderId}-${m?.timestamp || Date.now()}`),
          });
        }
      }

      // B. Comments
      if (Array.isArray(entry?.changes)) {
        for (const change of entry.changes) {
          const v = change?.value || {};
          if (isInstagram && change?.field === 'comments') {
            const fromId = String(v?.from?.id || '');
            if (!v?.id || !v?.text || fromId === accountId) continue;
            events.push({
              platform: 'instagram_comment',
              accountId,
              senderId: fromId,
              senderUsername: v?.from?.username ? `@${v.from.username}` : undefined,
              text: String(v.text).trim(),
              eventId: String(v.id),
              commentId: String(v.id),
              postId: v?.media?.id ? String(v.media.id) : undefined,
            });
          } else if (isPage && change?.field === 'feed' && v?.item === 'comment' && v?.verb === 'add') {
            const fromId = String(v?.from?.id || '');
            if (!v?.comment_id || !v?.message || fromId === accountId) continue;
            events.push({
              platform: 'facebook_comment',
              accountId,
              senderId: fromId,
              senderName: v?.from?.name,
              text: String(v.message).trim(),
              eventId: String(v.comment_id),
              commentId: String(v.comment_id),
              postId: v?.post_id ? String(v.post_id) : undefined,
            });
          }
        }
      }
    }
    return events;
  }

  // ─────────────────────────────────────────────────────────────
  // Graph API helpers
  // ─────────────────────────────────────────────────────────────
  private static async graphPost(path: string, token: string, payload: any): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(`${GRAPH_BASE}/${path}?access_token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errBody: any = await res.json().catch(() => ({}));
        return { ok: false, error: errBody?.error?.message || `HTTP ${res.status}` };
      }
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Network error' };
    }
  }

  private static async fetchSenderProfile(
    senderId: string,
    token: string,
    isInstagram: boolean
  ): Promise<{ name?: string; username?: string }> {
    try {
      const fields = isInstagram ? 'name,username' : 'name';
      const res = await fetch(
        `${GRAPH_BASE}/${encodeURIComponent(senderId)}?fields=${fields}&access_token=${encodeURIComponent(token)}`
      );
      if (!res.ok) return {};
      const data: any = await res.json();
      return { name: data?.name, username: data?.username };
    } catch {
      return {};
    }
  }

  private static async fetchPostCaption(postId: string, token: string, isInstagram: boolean): Promise<string | undefined> {
    try {
      const fields = isInstagram ? 'caption' : 'message';
      const res = await fetch(
        `${GRAPH_BASE}/${encodeURIComponent(postId)}?fields=${fields}&access_token=${encodeURIComponent(token)}`
      );
      if (!res.ok) return undefined;
      const data: any = await res.json();
      const caption = String(data?.caption || data?.message || '').trim();
      return caption ? caption.slice(0, 120) : undefined;
    } catch {
      return undefined;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Main entry: process a full webhook delivery
  // ─────────────────────────────────────────────────────────────
  static async handleWebhook(body: any, rawBody: Buffer | undefined, signatureHeader: string | undefined): Promise<void> {
    lastWebhookReceivedAt = new Date().toISOString();
    const events = this.normalizePayload(body);
    if (events.length === 0) return;

    const tenantCache = new Map<string, { userId: string; config: SocialLeadCaptureConfig } | null>();
    const signatureChecked = new Map<string, boolean>();

    for (const evt of events) {
      let tenant = tenantCache.get(evt.accountId);
      if (tenant === undefined) {
        tenant = await this.findTenantByAccountId(evt.accountId);
        tenantCache.set(evt.accountId, tenant);
      }
      if (!tenant) {
        console.warn(`[SocialMetaWebhook] No tenant configured for Meta account ${evt.accountId} — event ignored`);
        continue;
      }

      const { userId, config } = tenant;
      const baseActivity: SocialWebhookActivity = {
        timestamp: new Date().toISOString(),
        platform: evt.platform,
        accountId: evt.accountId,
        sender: evt.senderUsername || evt.senderName || evt.senderId,
        text: truncate(evt.text, 200),
        status: 'skipped',
      };

      // Signature verification (once per tenant per delivery)
      const appSecret = (config.metaAppSecret || process.env.META_APP_SECRET || '').trim();
      if (!signatureChecked.has(userId)) {
        signatureChecked.set(userId, this.verifySignature(rawBody, signatureHeader, appSecret));
      }
      if (!signatureChecked.get(userId)) {
        pushActivity(userId, { ...baseActivity, status: 'error', reason: 'Invalid X-Hub-Signature-256 (check Meta App Secret)' });
        continue;
      }

      if (!rememberEvent(evt.eventId)) continue; // duplicate retry from Meta

      try {
        await this.processSingleEvent(userId, config, evt, baseActivity);
      } catch (err: any) {
        console.error('[SocialMetaWebhook] Event processing error:', err?.message);
        pushActivity(userId, { ...baseActivity, status: 'error', reason: err?.message || 'Processing failed' });
      }
    }
  }

  private static async processSingleEvent(
    userId: string,
    config: SocialLeadCaptureConfig,
    evt: NormalizedSocialEvent,
    baseActivity: SocialWebhookActivity
  ): Promise<void> {
    // 1. Respect feature switches
    const switchMap: Record<SocialPlatform, boolean> = {
      instagram_dm: config.instagramDmEnabled,
      instagram_comment: config.instagramCommentEnabled,
      facebook_dm: config.facebookMessengerEnabled,
      facebook_comment: config.facebookCommentEnabled,
    };
    if (!config.enabled || !switchMap[evt.platform]) {
      pushActivity(userId, { ...baseActivity, reason: 'Channel disabled in Social Lead Capture settings' });
      return;
    }

    const isComment = evt.platform === 'instagram_comment' || evt.platform === 'facebook_comment';
    const isInstagram = evt.platform.startsWith('instagram');

    // 2. Comments must contain one of the trigger keywords (avoid replying to "nice pic 😍")
    if (isComment) {
      const keywords = (config.commentTriggerKeywords || '')
        .split(',')
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean);
      const lower = evt.text.toLowerCase();
      const hasPhoneOrEmail = /(?:\+?91[\s-]?)?[6-9]\d{9}/.test(evt.text) || /@[a-z0-9.-]+\.[a-z]{2,}/i.test(evt.text);
      if (keywords.length > 0 && !hasPhoneOrEmail && !keywords.some((k) => lower.includes(k))) {
        pushActivity(userId, { ...baseActivity, reason: 'Comment has no trigger keyword' });
        return;
      }
    }

    const token = (config.metaPageAccessToken || '').trim();

    // 3. Enrich sender + post details from Graph API (best-effort)
    let senderName = evt.senderName;
    let senderHandle = evt.senderUsername || '';
    if (token && (!senderName || !senderHandle)) {
      const profile = await this.fetchSenderProfile(evt.senderId, token, isInstagram);
      senderName = senderName || profile.name || profile.username;
      if (!senderHandle && profile.username) senderHandle = `@${profile.username}`;
    }
    if (!senderHandle) senderHandle = `${isInstagram ? 'ig' : 'fb'}:${evt.senderId}`;

    let postTitle: string | undefined;
    if (token && evt.postId) {
      postTitle = await this.fetchPostCaption(evt.postId, token, isInstagram);
    }

    // 4. AI reply + CRM lead (existing, unchanged service)
    const { event } = await SocialEmailAssistantService.processSocialLeadEvent({
      userId,
      platform: evt.platform,
      senderHandle,
      senderName,
      incomingText: evt.text,
      postOrReelTitle: postTitle,
    });

    const activity: SocialWebhookActivity = {
      ...baseActivity,
      sender: senderHandle,
      status: 'processed',
      commentReplySent: false,
      dmSent: false,
    };

    if (!token) {
      activity.deliveryError = 'Meta Page Access Token not saved — lead captured but replies were not sent';
      pushActivity(userId, activity);
      return;
    }

    const errors: string[] = [];

    // 5a. Public comment reply
    if (isComment && config.autoReplyToComments && event.publicCommentReply && evt.commentId) {
      const path = isInstagram ? `${evt.commentId}/replies` : `${evt.commentId}/comments`;
      const r = await this.graphPost(path, token, { message: truncate(event.publicCommentReply, 900) });
      activity.commentReplySent = r.ok;
      if (!r.ok) errors.push(`Comment reply: ${r.error}`);
    }

    // 5b. Private DM (private reply for comments, normal reply for DMs)
    const shouldSendDm = isComment ? config.autoSendDmOnComment : true;
    if (shouldSendDm && event.aiDmReply) {
      const recipient = isComment ? { comment_id: evt.commentId } : { id: evt.senderId };
      const payload: any = { recipient, message: { text: truncate(event.aiDmReply) } };
      if (!isComment) payload.messaging_type = 'RESPONSE';
      const r = await this.graphPost('me/messages', token, payload);
      activity.dmSent = r.ok;
      if (!r.ok) errors.push(`DM: ${r.error}`);
    }

    if (errors.length > 0) activity.deliveryError = errors.join(' | ');
    pushActivity(userId, activity);
    console.log(
      `[SocialMetaWebhook] ${evt.platform} from ${senderHandle} → lead ${event.crmLeadId || 'n/a'} ` +
        `(commentReply=${activity.commentReplySent}, dm=${activity.dmSent})`
    );
  }

  static getStatus(userId: string): { lastWebhookReceivedAt: string | null; recentActivity: SocialWebhookActivity[] } {
    const list = recentActivity.get(userId) || [];
    return {
      lastWebhookReceivedAt: list[0]?.timestamp || null,
      recentActivity: list,
    };
  }
}
