import { db } from '../../../server/db';
import { sql } from 'drizzle-orm';
import type { MetaWhatsAppSettings, MetaWhatsAppTemplate } from '../types';
import { messagingLogService } from './messaging-log.service';

const META_GRAPH_API_BASE = 'https://graph.facebook.com';
// Meta deprecates graph API versions on a ~2 year cycle; keep this in sync
const META_API_VERSION = process.env.META_WHATSAPP_API_VERSION || 'v21.0';

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

function validatePhoneNumber(phone: string): void {
  if (!/^[+\d]/.test(phone)) {
    throw new Error('Invalid phone number format. Use international format (e.g., +1234567890).');
  }
  const stripped = phone.replace(/[^0-9+]/g, '');
  const digits = stripped.replace(/\+/g, '');
  if (digits.length < 7) {
    throw new Error('Invalid phone number format. Use international format (e.g., +1234567890).');
  }
}

export class MetaWhatsAppService {
  async getSettings(userId: string): Promise<MetaWhatsAppSettings | null> {
    const result = await db.execute(sql`
      SELECT * FROM meta_whatsapp_settings WHERE user_id = ${userId} LIMIT 1
    `);
    const row = (result as any).rows[0];
    return row ? transformRow<MetaWhatsAppSettings>(row) : null;
  }

  async saveSettings(
    userId: string,
    data: { phoneNumberId: string; wabaId: string; accessToken: string }
  ): Promise<MetaWhatsAppSettings> {
    const result = await db.execute(sql`
      INSERT INTO meta_whatsapp_settings (user_id, phone_number_id, waba_id, access_token)
      VALUES (${userId}, ${data.phoneNumberId}, ${data.wabaId}, ${data.accessToken})
      ON CONFLICT (user_id) DO UPDATE SET
        phone_number_id = EXCLUDED.phone_number_id,
        waba_id = EXCLUDED.waba_id,
        access_token = EXCLUDED.access_token,
        updated_at = NOW()
      RETURNING *
    `);
    return transformRow<MetaWhatsAppSettings>((result as any).rows[0]);
  }

  private async _attemptRegister(phoneNumberId: string, accessToken: string, includePin: boolean): Promise<{ ok: boolean; data: any; status: number }> {
    const url = `${META_GRAPH_API_BASE}/${META_API_VERSION}/${phoneNumberId}/register`;
    const body: any = { messaging_product: 'whatsapp' };
    if (includePin) body.pin = '123456';
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    console.log(`[Meta WhatsApp] Register response (${response.status}):`, JSON.stringify(data));
    return { ok: response.ok, data, status: response.status };
  }

  async registerPhoneNumber(phoneNumberId: string, accessToken: string): Promise<{ success: boolean; error?: string }> {
    try {
      console.log(`[Meta WhatsApp] Registering phone number with Cloud API...`);

      let result = await this._attemptRegister(phoneNumberId, accessToken, false);

      if (!result.ok) {
        console.log(`[Meta WhatsApp] Register without pin failed (${result.data?.error?.code}), retrying with pin...`);
        result = await this._attemptRegister(phoneNumberId, accessToken, true);
      }

      if (!result.ok) {
        console.log(`[Meta WhatsApp] Both attempts failed, waiting 3s before final retry...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
        result = await this._attemptRegister(phoneNumberId, accessToken, true);
      }

      if (!result.ok) {
        const errMsg = result.data?.error?.message || JSON.stringify(result.data);
        console.error(`[Meta WhatsApp] Phone registration failed after all attempts:`, {
          code: result.data?.error?.code,
          subcode: result.data?.error?.error_subcode,
          type: result.data?.error?.type,
          message: result.data?.error?.message,
          fbtrace_id: result.data?.error?.fbtrace_id,
        });
        return { success: false, error: errMsg };
      }
      console.log(`[Meta WhatsApp] Phone number registered successfully`);
      return { success: true };
    } catch (error: any) {
      console.error(`[Meta WhatsApp] Phone registration error:`, error.message);
      return { success: false, error: error.message };
    }
  }

  async overrideCallbackUrl(phoneNumberId: string, accessToken: string, callbackUrl: string, verifyToken: string): Promise<boolean> {
    try {
      const url = `${META_GRAPH_API_BASE}/${META_API_VERSION}/${phoneNumberId}/override_callback_url`;
      console.log(`[Meta WhatsApp] Setting override callback URL for phone...`);
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          callback_url: callbackUrl,
          verify_token: verifyToken,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        console.error(`[Meta WhatsApp] Override callback URL failed:`, data?.error?.message || JSON.stringify(data));
        return false;
      }
      console.log(`[Meta WhatsApp] Override callback URL set successfully`);
      return true;
    } catch (error: any) {
      console.error(`[Meta WhatsApp] Override callback URL error:`, error.message);
      return false;
    }
  }

  async subscribeWabaToWebhooks(wabaId: string, accessToken: string): Promise<boolean> {
    try {
      const url = `${META_GRAPH_API_BASE}/${META_API_VERSION}/${wabaId}/subscribed_apps`;
      console.log(`[Meta WhatsApp] Subscribing WABA ${wabaId} to webhook events`);
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });
      const data = await response.json();
      if (!response.ok) {
        console.error(`[Meta WhatsApp] WABA subscription failed:`, data?.error?.message || JSON.stringify(data));
        return false;
      }
      console.log(`[Meta WhatsApp] WABA ${wabaId} subscribed to webhooks successfully`);
      return true;
    } catch (error: any) {
      console.error(`[Meta WhatsApp] WABA subscription error:`, error.message);
      return false;
    }
  }

  async deactivate(userId: string): Promise<void> {
    await db.execute(sql`
      UPDATE meta_whatsapp_settings SET is_active = false, updated_at = NOW() WHERE user_id = ${userId}
    `);
  }

  async deleteSettings(userId: string): Promise<void> {
    await db.execute(sql`
      DELETE FROM meta_whatsapp_settings WHERE user_id = ${userId}
    `);
  }

  private async getCredentials(userId: string, skipActiveCheck = false): Promise<{ phoneNumberId: string; wabaId: string; accessToken: string }> {
    const settings = await this.getSettings(userId);
    if (!settings) {
      throw new Error('Meta WhatsApp not configured. Please add your WABA credentials first.');
    }
    if (!skipActiveCheck && !settings.isActive) {
      throw new Error('Meta WhatsApp integration is disabled.');
    }
    return {
      phoneNumberId: settings.phoneNumberId,
      wabaId: settings.wabaId,
      accessToken: settings.accessToken,
    };
  }

  private async makeRequest(
    userId: string,
    method: string,
    path: string,
    body?: any,
    skipActiveCheck = false
  ): Promise<any> {
    const { accessToken } = await this.getCredentials(userId, skipActiveCheck);
    const url = `${META_GRAPH_API_BASE}/${META_API_VERSION}${path}`;

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    };

    const options: RequestInit = { method, headers };
    if (body) {
      options.body = JSON.stringify(body);
    }

    console.log(`[Meta WhatsApp] ${method} ${url}`);
    if (body) {
      console.log(`[Meta WhatsApp] Request Payload: ${JSON.stringify(body, null, 2)}`);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      let errorMessage = `Meta WhatsApp API error (${response.status})`;

      try {
        const errorJson = JSON.parse(errorText);
        const metaError = errorJson?.error;
        if (metaError) {
          console.error(`[Meta WhatsApp] API Error Details:`, JSON.stringify({
            code: metaError.code,
            subcode: metaError.error_subcode,
            type: metaError.type,
            message: metaError.message,
            fbtrace_id: metaError.fbtrace_id,
            error_data: metaError.error_data,
            httpStatus: response.status,
          }));
        }
      } catch {
      }

      if (response.status === 401 || response.status === 190) {
        errorMessage = 'Invalid or expired Meta access token';
      } else if (response.status === 403) {
        errorMessage = 'Insufficient permissions. Ensure your token has whatsapp_business_management and whatsapp_business_messaging permissions.';
      } else if (response.status === 429) {
        errorMessage = 'Meta API rate limit exceeded. Please try again later.';
      } else {
        try {
          const errorJson = JSON.parse(errorText);
          const metaError = errorJson?.error;
          if (metaError?.code === 131047) {
            errorMessage = 'Cannot send text message: the 24-hour customer service window has closed. Use a template message instead.';
          } else if (metaError?.code === 131026) {
            errorMessage = 'Message could not be delivered. The recipient may have blocked messages or the number is invalid.';
          } else if (metaError?.message) {
            errorMessage = metaError.message;
          }
        } catch {
          errorMessage = `${errorMessage}: ${errorText}`;
        }
      }
      throw new Error(errorMessage);
    }

    return response.json();
  }

  async testConnection(userId: string, skipActiveCheck = false): Promise<{ businessName: string; phoneNumber: string }> {
    const { phoneNumberId } = await this.getCredentials(userId, skipActiveCheck);
    const response = await this.makeRequest(
      userId,
      'GET',
      `/${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`,
      undefined,
      skipActiveCheck
    );

    return {
      businessName: response.verified_name || response.display_phone_number || 'Meta WhatsApp',
      phoneNumber: response.display_phone_number || '',
    };
  }

  async getChannelHealth(userId: string): Promise<{
    accountMode: string;
    qualityRating: string;
    messagingLimit: string;
    throughput: string;
    verification: string;
    nameStatus: string;
    phoneNumber: string;
    businessName: string;
    lastChecked: string;
  }> {
    const { phoneNumberId } = await this.getCredentials(userId);
    const fields = 'display_phone_number,verified_name,quality_rating,account_mode,code_verification_status,name_status,messaging_limit_tier,throughput';
    const response = await this.makeRequest(
      userId,
      'GET',
      `/${phoneNumberId}?fields=${fields}`
    );

    return {
      accountMode: response.account_mode || 'UNKNOWN',
      qualityRating: response.quality_rating || 'UNKNOWN',
      messagingLimit: response.messaging_limit_tier || 'UNKNOWN',
      throughput: response.throughput?.level || 'STANDARD',
      verification: response.code_verification_status || 'UNKNOWN',
      nameStatus: response.name_status || 'UNKNOWN',
      phoneNumber: response.display_phone_number || '',
      businessName: response.verified_name || '',
      lastChecked: new Date().toISOString(),
    };
  }

  async getTemplates(userId: string): Promise<MetaWhatsAppTemplate[]> {
    const { wabaId, accessToken } = await this.getCredentials(userId);
    const MAX_PAGES = 10;
    const templates: MetaWhatsAppTemplate[] = [];

    const firstResponse = await this.makeRequest(
      userId,
      'GET',
      `/${wabaId}/message_templates?fields=name,status,category,language,components&limit=100`
    );

    const appendApproved = (data: any[]) => {
      for (const tmpl of data) {
        if (tmpl.status === 'APPROVED') {
          templates.push({
            name: tmpl.name,
            status: tmpl.status,
            language: tmpl.language,
            category: tmpl.category || '',
            components: tmpl.components || [],
          });
        }
      }
    };

    appendApproved(firstResponse?.data || []);

    let nextUrl: string | undefined = firstResponse?.paging?.next;
    let pageCount = 1;

    while (nextUrl && pageCount < MAX_PAGES) {
      pageCount++;
      console.log(`[Meta WhatsApp] Fetching templates page ${pageCount}: ${nextUrl}`);

      const response = await fetch(nextUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        console.log(`[Meta WhatsApp] Failed to fetch templates page ${pageCount}: ${response.status}`);
        break;
      }

      const json = await response.json();
      appendApproved(json?.data || []);
      nextUrl = json?.paging?.next;
    }

    console.log(`[Meta WhatsApp] Fetched ${templates.length} approved templates across ${pageCount} page(s)`);
    return templates;
  }

  async getTemplateByName(userId: string, templateName: string): Promise<MetaWhatsAppTemplate | null> {
    try {
      const templates = await this.getTemplates(userId);
      return templates.find(t => t.name === templateName) || null;
    } catch (error: any) {
      console.warn(`[Meta WhatsApp] Failed to fetch template "${templateName}": ${error.message}`);
      return null;
    }
  }

  static buildButtonComponents(templateComponents: any[], buttonOverrides?: Record<number, string>): any[] {
    const buttonComponents: any[] = [];
    const buttonsComponent = templateComponents.find((c: any) =>
      c.type === 'BUTTONS' || c.type === 'buttons'
    );
    if (!buttonsComponent || !Array.isArray(buttonsComponent.buttons)) return buttonComponents;

    buttonsComponent.buttons.forEach((btn: any, index: number) => {
      if (btn.type === 'URL' && btn.url && btn.url.includes('{{')) {
        const overrideValue = buttonOverrides?.[index];
        buttonComponents.push({
          type: 'button',
          sub_type: 'url',
          index: String(index),
          parameters: [{
            type: 'text',
            text: overrideValue || (Array.isArray(btn.example) ? btn.example[0] : null) || 'details'
          }]
        });
      }
    });

    return buttonComponents;
  }

  async sendTemplate(
    userId: string,
    to: string,
    templateName: string,
    language: string,
    components: any[] = [],
    meta?: { callId?: string; agentId?: string }
  ): Promise<{ messageId: string; status: string }> {
    validatePhoneNumber(to);
    const { phoneNumberId } = await this.getCredentials(userId);

    const payload: any = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: to.replace(/[^0-9]/g, ''),
      type: 'template',
      template: {
        name: templateName,
        language: {
          code: language || 'en_US',
        },
      },
    };

    if (components && components.length > 0) {
      payload.template.components = components;
    }

    try {
      const response = await this.makeRequest(userId, 'POST', `/${phoneNumberId}/messages`, payload);

      const messageId = response?.messages?.[0]?.id || '';
      const messageStatus = response?.messages?.[0]?.message_status || 'accepted';

      await messagingLogService.logMessage(userId, 'whatsapp', {
        callId: meta?.callId,
        agentId: meta?.agentId,
        recipientPhone: to,
        templateName,
        status: 'sent',
        responseData: response,
        messageContent: `Template: ${templateName}`,
        messageType: 'template',
      });

      console.log(`[Meta WhatsApp] Template "${templateName}" sent to ${to} (${messageId})`);
      return { messageId, status: messageStatus };
    } catch (error: any) {
      await messagingLogService.logMessage(userId, 'whatsapp', {
        callId: meta?.callId,
        agentId: meta?.agentId,
        recipientPhone: to,
        templateName,
        status: 'failed',
        errorMessage: error.message,
        messageContent: `Template: ${templateName}`,
        messageType: 'template',
      });
      console.log(`[Meta WhatsApp] Failed to send template "${templateName}" to ${to}: ${error.message}`);
      throw error;
    }
  }

  async markMessageRead(userId: string, metaMessageId: string): Promise<void> {
    try {
      const { phoneNumberId } = await this.getCredentials(userId);
      await this.makeRequest(userId, 'POST', `/${phoneNumberId}/messages`, {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: metaMessageId,
      });
    } catch (error: any) {
      console.log(`[Meta WhatsApp] Failed to send read receipt for ${metaMessageId}: ${error.message}`);
    }
  }

  async sendReply(
    userId: string,
    to: string,
    message: string,
    meta?: { callId?: string; agentId?: string }
  ): Promise<{ messageId: string; status: string }> {
    validatePhoneNumber(to);
    const { phoneNumberId } = await this.getCredentials(userId);

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: to.replace(/[^0-9]/g, ''),
      type: 'text',
      text: {
        preview_url: false,
        body: message,
      },
    };

    try {
      const response = await this.makeRequest(userId, 'POST', `/${phoneNumberId}/messages`, payload);

      const messageId = response?.messages?.[0]?.id || '';
      const messageStatus = response?.messages?.[0]?.message_status || 'accepted';

      await messagingLogService.logMessage(userId, 'whatsapp', {
        callId: meta?.callId,
        agentId: meta?.agentId,
        recipientPhone: to,
        templateName: 'reply',
        status: 'sent',
        responseData: response,
        messageContent: message.substring(0, 200),
        messageType: 'text',
      });

      console.log(`[Meta WhatsApp] Reply sent to ${to} (${messageId})`);
      return { messageId, status: messageStatus };
    } catch (error: any) {
      await messagingLogService.logMessage(userId, 'whatsapp', {
        callId: meta?.callId,
        agentId: meta?.agentId,
        recipientPhone: to,
        templateName: 'reply',
        status: 'failed',
        errorMessage: error.message,
        messageContent: message.substring(0, 200),
        messageType: 'text',
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
    const { phoneNumberId, accessToken } = await this.getCredentials(userId);
    const url = `${META_GRAPH_API_BASE}/${META_API_VERSION}/${phoneNumberId}/media`;

    const formData = new FormData();
    formData.append('messaging_product', 'whatsapp');
    formData.append('type', mimeType);
    formData.append('file', new Blob([fileBuffer], { type: mimeType }), filename);

    console.log(`[Meta WhatsApp] Uploading media: ${filename} (${mimeType}, ${fileBuffer.length} bytes)`);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}` },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Media upload failed (${response.status}): ${errorText}`);
    }

    const json = await response.json();
    const mediaId = json?.id;
    if (!mediaId) {
      throw new Error('Media upload succeeded but no media ID returned');
    }

    console.log(`[Meta WhatsApp] Media uploaded: ${mediaId}`);
    return mediaId;
  }

  async getMediaStream(
    userId: string,
    mediaId: string
  ): Promise<{ stream: ReadableStream | NodeJS.ReadableStream; contentType: string; contentLength?: number }> {
    const { accessToken } = await this.getCredentials(userId);

    const metaRes = await fetch(`${META_GRAPH_API_BASE}/${META_API_VERSION}/${mediaId}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    if (!metaRes.ok) {
      throw new Error(`Failed to get media URL (${metaRes.status})`);
    }
    const metaJson = await metaRes.json();
    const downloadUrl = metaJson.url;
    if (!downloadUrl) throw new Error('No download URL returned for media');

    const mediaRes = await fetch(downloadUrl, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    if (!mediaRes.ok) {
      throw new Error(`Failed to download media (${mediaRes.status})`);
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
    validatePhoneNumber(to);
    const { phoneNumberId } = await this.getCredentials(userId);

    const mediaPayload: Record<string, any> = { id: mediaId };
    if (options?.caption && ['image', 'video', 'document'].includes(mediaType)) {
      mediaPayload.caption = options.caption;
    }
    if (options?.filename && mediaType === 'document') {
      mediaPayload.filename = options.filename;
    }

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: to.replace(/[^0-9]/g, ''),
      type: mediaType,
      [mediaType]: mediaPayload,
    };

    try {
      const response = await this.makeRequest(userId, 'POST', `/${phoneNumberId}/messages`, payload);
      const messageId = response?.messages?.[0]?.id || '';
      const messageStatus = response?.messages?.[0]?.message_status || 'accepted';

      const preview = options?.caption || options?.filename || `[${mediaType}]`;
      await messagingLogService.logMessage(userId, 'whatsapp', {
        recipientPhone: to,
        templateName: `media:${mediaType}`,
        status: 'sent',
        responseData: response,
        messageContent: preview.substring(0, 200),
        messageType: mediaType,
        callId: meta?.callId,
        agentId: meta?.agentId,
      });

      console.log(`[Meta WhatsApp] ${mediaType} sent to ${to} (${messageId})`);
      return { messageId, status: messageStatus };
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
    validatePhoneNumber(to);
    const { phoneNumberId } = await this.getCredentials(userId);

    const locationPayload: Record<string, any> = { latitude, longitude };
    if (name) locationPayload.name = name;
    if (address) locationPayload.address = address;

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: to.replace(/[^0-9]/g, ''),
      type: 'location',
      location: locationPayload,
    };

    try {
      const response = await this.makeRequest(userId, 'POST', `/${phoneNumberId}/messages`, payload);
      const messageId = response?.messages?.[0]?.id || '';
      const messageStatus = response?.messages?.[0]?.message_status || 'accepted';

      const preview = name || `${latitude}, ${longitude}`;
      await messagingLogService.logMessage(userId, 'whatsapp', {
        recipientPhone: to,
        templateName: 'location',
        status: 'sent',
        responseData: response,
        messageContent: preview.substring(0, 200),
        messageType: 'location',
        callId: meta?.callId,
        agentId: meta?.agentId,
      });

      console.log(`[Meta WhatsApp] Location sent to ${to} (${messageId})`);
      return { messageId, status: messageStatus };
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

export const metaWhatsAppService = new MetaWhatsAppService();
