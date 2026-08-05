import { db } from '../../../server/db';
import { sql } from 'drizzle-orm';
import type { WhatswaySettings, WhatswayTemplate, WhatswayAccountInfo } from '../types';
import { messagingLogService } from './messaging-log.service';

function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function transformRow<T>(row: Record<string, any>): T {
  const transformed: Record<string, any> = {};
  for (const key of Object.keys(row)) {
    transformed[snakeToCamel(key)] = row[key];
  }
  return transformed as T;
}

export class WhatswayService {
  async getSettings(userId: string): Promise<WhatswaySettings | null> {
    const result = await db.execute(sql`
      SELECT * FROM whatsway_settings WHERE user_id = ${userId} LIMIT 1
    `);
    const row = (result as any).rows[0];
    return row ? transformRow<WhatswaySettings>(row) : null;
  }

  async saveSettings(
    userId: string,
    data: { apiKey: string; apiSecret: string; baseUrl?: string; channelId?: string }
  ): Promise<WhatswaySettings> {
    const baseUrl = data.baseUrl || 'https://whatsway.diploy.in';
    const channelId = data.channelId || '';
    const result = await db.execute(sql`
      INSERT INTO whatsway_settings (user_id, api_key, api_secret, base_url, channel_id)
      VALUES (${userId}, ${data.apiKey}, ${data.apiSecret}, ${baseUrl}, ${channelId})
      ON CONFLICT (user_id) DO UPDATE SET
        api_key = EXCLUDED.api_key,
        api_secret = EXCLUDED.api_secret,
        base_url = EXCLUDED.base_url,
        channel_id = EXCLUDED.channel_id,
        updated_at = NOW()
      RETURNING *
    `);
    return transformRow<WhatswaySettings>((result as any).rows[0]);
  }

  async deactivate(userId: string): Promise<void> {
    await db.execute(sql`
      UPDATE whatsway_settings SET is_active = false, updated_at = NOW() WHERE user_id = ${userId}
    `);
  }

  async deleteSettings(userId: string): Promise<void> {
    await db.execute(sql`
      DELETE FROM whatsway_settings WHERE user_id = ${userId}
    `);
  }

  private async getCredentials(userId: string, skipActiveCheck = false): Promise<{ apiKey: string; apiSecret: string; baseUrl: string; channelId: string }> {
    const settings = await this.getSettings(userId);
    if (!settings) {
      throw new Error('WhatsWay not configured. Please add your API credentials first.');
    }
    if (!skipActiveCheck && !settings.isActive) {
      throw new Error('WhatsWay integration is disabled.');
    }
    return {
      apiKey: settings.apiKey,
      apiSecret: settings.apiSecret,
      baseUrl: settings.baseUrl,
      channelId: settings.channelId || '',
    };
  }

  private async makeRequest(
    userId: string,
    method: string,
    path: string,
    body?: any,
    skipActiveCheck = false
  ): Promise<any> {
    const { apiKey, apiSecret, baseUrl, channelId } = await this.getCredentials(userId, skipActiveCheck);
    const url = `${baseUrl}${path}`;

    const headers: Record<string, string> = {
      'X-API-Key': apiKey,
      'X-API-Secret': apiSecret,
      'Content-Type': 'application/json',
    };
    if (channelId) {
      headers['X-Channel-Id'] = channelId;
    }

    const options: RequestInit = { method, headers };
    if (body) {
      options.body = JSON.stringify(body);
    }

    console.log(`[WhatsWay] ${method} ${url}`);

    const response = await fetch(url, options);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      let errorMessage = `WhatsWay API error (${response.status})`;
      if (response.status === 401 || response.status === 403) {
        errorMessage = 'Invalid WhatsWay API credentials';
      } else if (response.status === 429) {
        errorMessage = 'WhatsWay rate limit exceeded. Please try again later.';
      } else {
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.error || errorMessage;
        } catch {
          errorMessage = `${errorMessage}: ${errorText}`;
        }
      }
      throw new Error(errorMessage);
    }

    return response.json();
  }

  async testConnection(userId: string, skipActiveCheck = false): Promise<WhatswayAccountInfo> {
    const response = await this.makeRequest(userId, 'GET', '/api/v1/account', undefined, skipActiveCheck);
    if (!response.success) {
      throw new Error(response.error || 'Failed to connect to WhatsWay');
    }
    return response.data;
  }

  async getTemplates(userId: string): Promise<WhatswayTemplate[]> {
    const response = await this.makeRequest(userId, 'GET', '/api/v1/templates?status=APPROVED');
    if (!response.success) {
      throw new Error(response.error || 'Failed to fetch templates');
    }
    return Array.isArray(response.data) ? response.data : [];
  }

  async sendTemplate(
    userId: string,
    to: string,
    templateName: string,
    language: string,
    components: any[] = [],
    meta?: { callId?: string; agentId?: string }
  ): Promise<{ messageId: string; status: string }> {
    try {
      const response = await this.makeRequest(userId, 'POST', '/api/v1/messages/template', {
        to,
        templateName,
        language,
        components,
      });

      if (!response.success) {
        throw new Error(response.error || 'Failed to send WhatsApp template message');
      }

      await messagingLogService.logMessage(userId, 'whatsapp', {
        callId: meta?.callId,
        agentId: meta?.agentId,
        recipientPhone: to,
        templateName,
        status: 'sent',
        responseData: response.data,
      });

      console.log(`✅ [WhatsWay] Template "${templateName}" sent to ${to}`);
      return response.data;
    } catch (error: any) {
      await messagingLogService.logMessage(userId, 'whatsapp', {
        callId: meta?.callId,
        agentId: meta?.agentId,
        recipientPhone: to,
        templateName,
        status: 'failed',
        errorMessage: error.message,
      });
      console.log(`❌ [WhatsWay] Failed to send template "${templateName}" to ${to}: ${error.message}`);
      throw error;
    }
  }

  async sendReply(
    userId: string,
    to: string,
    message: string,
    meta?: { callId?: string; agentId?: string }
  ): Promise<{ messageId: string; status: string }> {
    try {
      const response = await this.makeRequest(userId, 'POST', '/api/v1/messages/reply', {
        to,
        message,
      });

      if (!response.success) {
        throw new Error(response.error || 'Failed to send WhatsApp reply');
      }

      await messagingLogService.logMessage(userId, 'whatsapp', {
        callId: meta?.callId,
        agentId: meta?.agentId,
        recipientPhone: to,
        templateName: 'reply',
        status: 'sent',
        responseData: response.data,
      });

      console.log(`✅ [WhatsWay] Reply sent to ${to}`);
      return response.data;
    } catch (error: any) {
      await messagingLogService.logMessage(userId, 'whatsapp', {
        callId: meta?.callId,
        agentId: meta?.agentId,
        recipientPhone: to,
        templateName: 'reply',
        status: 'failed',
        errorMessage: error.message,
      });
      throw error;
    }
  }

  async uploadMedia(
    userId: string,
    fileBuffer: Buffer,
    mimeType: string,
    filename: string
  ): Promise<string> {
    const { apiKey, apiSecret, baseUrl, channelId } = await this.getCredentials(userId);
    const url = `${baseUrl}/api/v1/media/upload`;

    const formData = new FormData();
    formData.append('file', new Blob([fileBuffer], { type: mimeType }), filename);
    formData.append('mimeType', mimeType);

    const headers: Record<string, string> = {
      'X-API-Key': apiKey,
      'X-API-Secret': apiSecret,
    };
    if (channelId) headers['X-Channel-Id'] = channelId;

    console.log(`[WhatsWay] Uploading media: ${filename} (${mimeType}, ${fileBuffer.length} bytes)`);

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`WhatsWay media upload failed (${response.status}): ${errorText}`);
    }

    const json = await response.json();
    const mediaId = json?.data?.mediaId || json?.data?.id || json?.data?.url || '';
    if (!mediaId) {
      throw new Error('WhatsWay media upload succeeded but no media ID returned');
    }

    console.log(`[WhatsWay] Media uploaded: ${mediaId}`);
    return mediaId;
  }

  async getMediaStream(
    userId: string,
    mediaId: string
  ): Promise<{ stream: ReadableStream | NodeJS.ReadableStream; contentType: string; contentLength?: number }> {
    const { apiKey, apiSecret, baseUrl, channelId } = await this.getCredentials(userId);

    let downloadUrl: string;
    if (mediaId.startsWith('http://') || mediaId.startsWith('https://')) {
      const allowedHost = new URL(baseUrl).host;
      const mediaHost = new URL(mediaId).host;
      if (mediaHost !== allowedHost) {
        throw new Error('Media URL is not from a trusted WhatsWay host');
      }
      downloadUrl = mediaId;
    } else {
      downloadUrl = `${baseUrl}/api/v1/media/${encodeURIComponent(mediaId)}`;
    }

    const headers: Record<string, string> = {
      'X-API-Key': apiKey,
      'X-API-Secret': apiSecret,
    };
    if (channelId) headers['X-Channel-Id'] = channelId;

    const mediaRes = await fetch(downloadUrl, { headers });
    if (!mediaRes.ok) {
      throw new Error(`WhatsWay media download failed (${mediaRes.status})`);
    }

    const contentType = mediaRes.headers.get('content-type') || 'application/octet-stream';
    const contentLength = mediaRes.headers.get('content-length');

    return {
      stream: mediaRes.body as any,
      contentType,
      contentLength: contentLength ? parseInt(contentLength, 10) : undefined,
    };
  }

  async sendMediaMessage(
    userId: string,
    to: string,
    mediaType: 'image' | 'video' | 'audio' | 'document' | 'sticker',
    mediaId: string,
    options?: { caption?: string; filename?: string },
    meta?: { callId?: string; agentId?: string }
  ): Promise<{ messageId: string; status: string }> {
    try {
      const response = await this.makeRequest(userId, 'POST', '/api/v1/messages/media', {
        to,
        type: mediaType,
        mediaId,
        caption: options?.caption,
        filename: options?.filename,
      });

      if (!response.success) {
        throw new Error(response.error || 'Failed to send WhatsApp media message');
      }

      const preview = options?.caption || options?.filename || `[${mediaType}]`;
      await messagingLogService.logMessage(userId, 'whatsapp', {
        recipientPhone: to,
        templateName: `media:${mediaType}`,
        status: 'sent',
        responseData: response.data,
        messageContent: preview.substring(0, 200),
        messageType: mediaType,
        callId: meta?.callId,
        agentId: meta?.agentId,
      });

      console.log(`✅ [WhatsWay] ${mediaType} sent to ${to}`);
      return response.data;
    } catch (error: any) {
      const preview = options?.caption || options?.filename || `[${mediaType}]`;
      await messagingLogService.logMessage(userId, 'whatsapp', {
        recipientPhone: to,
        templateName: `media:${mediaType}`,
        status: 'failed',
        errorMessage: error.message,
        messageContent: preview.substring(0, 200),
        messageType: mediaType,
        callId: meta?.callId,
        agentId: meta?.agentId,
      });
      throw error;
    }
  }

  async sendLocationMessage(
    userId: string,
    to: string,
    latitude: number,
    longitude: number,
    name?: string,
    address?: string,
    meta?: { callId?: string; agentId?: string }
  ): Promise<{ messageId: string; status: string }> {
    try {
      const response = await this.makeRequest(userId, 'POST', '/api/v1/messages/location', {
        to,
        latitude,
        longitude,
        name,
        address,
      });

      if (!response.success) {
        throw new Error(response.error || 'Failed to send WhatsApp location message');
      }

      const preview = name || `${latitude}, ${longitude}`;
      await messagingLogService.logMessage(userId, 'whatsapp', {
        recipientPhone: to,
        templateName: 'location',
        status: 'sent',
        responseData: response.data,
        messageContent: preview.substring(0, 200),
        messageType: 'location',
        callId: meta?.callId,
        agentId: meta?.agentId,
      });

      console.log(`✅ [WhatsWay] Location sent to ${to}`);
      return response.data;
    } catch (error: any) {
      const preview = name || `${latitude}, ${longitude}`;
      await messagingLogService.logMessage(userId, 'whatsapp', {
        recipientPhone: to,
        templateName: 'location',
        status: 'failed',
        errorMessage: error.message,
        messageContent: preview.substring(0, 200),
        messageType: 'location',
        callId: meta?.callId,
        agentId: meta?.agentId,
      });
      throw error;
    }
  }
}

export const whatswayService = new WhatswayService();
