import { db } from "../../../server/db.js";
import { sql } from "drizzle-orm";
import { messagingLogService } from "./messaging-log.service.js";
function snakeToCamel(str) {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}
function transformRow(row) {
  const transformed = {};
  for (const key of Object.keys(row)) {
    transformed[snakeToCamel(key)] = row[key];
  }
  return transformed;
}
class WhatswayService {
  async getSettings(userId) {
    const result = await db.execute(sql`
      SELECT * FROM whatsway_settings WHERE user_id = ${userId} LIMIT 1
    `);
    const row = result.rows[0];
    return row ? transformRow(row) : null;
  }
  async saveSettings(userId, data) {
    const baseUrl = data.baseUrl || "https://whatsway.diploy.in";
    const channelId = data.channelId || "";
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
    return transformRow(result.rows[0]);
  }
  async deactivate(userId) {
    await db.execute(sql`
      UPDATE whatsway_settings SET is_active = false, updated_at = NOW() WHERE user_id = ${userId}
    `);
  }
  async deleteSettings(userId) {
    await db.execute(sql`
      DELETE FROM whatsway_settings WHERE user_id = ${userId}
    `);
  }
  async getCredentials(userId, skipActiveCheck = false) {
    const settings = await this.getSettings(userId);
    if (!settings) {
      throw new Error("WhatsWay not configured. Please add your API credentials first.");
    }
    if (!skipActiveCheck && !settings.isActive) {
      throw new Error("WhatsWay integration is disabled.");
    }
    return {
      apiKey: settings.apiKey,
      apiSecret: settings.apiSecret,
      baseUrl: settings.baseUrl,
      channelId: settings.channelId || ""
    };
  }
  async makeRequest(userId, method, path, body, skipActiveCheck = false) {
    const { apiKey, apiSecret, baseUrl, channelId } = await this.getCredentials(userId, skipActiveCheck);
    const url = `${baseUrl}${path}`;
    const headers = {
      "X-API-Key": apiKey,
      "X-API-Secret": apiSecret,
      "Content-Type": "application/json"
    };
    if (channelId) {
      headers["X-Channel-Id"] = channelId;
    }
    const options = { method, headers };
    if (body) {
      options.body = JSON.stringify(body);
    }
    console.log(`[WhatsWay] ${method} ${url}`);
    const response = await fetch(url, options);
    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      let errorMessage = `WhatsWay API error (${response.status})`;
      if (response.status === 401 || response.status === 403) {
        errorMessage = "Invalid WhatsWay API credentials";
      } else if (response.status === 429) {
        errorMessage = "WhatsWay rate limit exceeded. Please try again later.";
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
  async testConnection(userId, skipActiveCheck = false) {
    const response = await this.makeRequest(userId, "GET", "/api/v1/account", void 0, skipActiveCheck);
    if (!response.success) {
      throw new Error(response.error || "Failed to connect to WhatsWay");
    }
    return response.data;
  }
  async getTemplates(userId) {
    const response = await this.makeRequest(userId, "GET", "/api/v1/templates?status=APPROVED");
    if (!response.success) {
      throw new Error(response.error || "Failed to fetch templates");
    }
    return Array.isArray(response.data) ? response.data : [];
  }
  async sendTemplate(userId, to, templateName, language, components = [], meta) {
    try {
      const response = await this.makeRequest(userId, "POST", "/api/v1/messages/template", {
        to,
        templateName,
        language,
        components
      });
      if (!response.success) {
        throw new Error(response.error || "Failed to send WhatsApp template message");
      }
      await messagingLogService.logMessage(userId, "whatsapp", {
        callId: meta?.callId,
        agentId: meta?.agentId,
        recipientPhone: to,
        templateName,
        status: "sent",
        responseData: response.data
      });
      console.log(`\u2705 [WhatsWay] Template "${templateName}" sent to ${to}`);
      return response.data;
    } catch (error) {
      await messagingLogService.logMessage(userId, "whatsapp", {
        callId: meta?.callId,
        agentId: meta?.agentId,
        recipientPhone: to,
        templateName,
        status: "failed",
        errorMessage: error.message
      });
      console.log(`\u274C [WhatsWay] Failed to send template "${templateName}" to ${to}: ${error.message}`);
      throw error;
    }
  }
  async sendReply(userId, to, message, meta) {
    try {
      const response = await this.makeRequest(userId, "POST", "/api/v1/messages/reply", {
        to,
        message
      });
      if (!response.success) {
        throw new Error(response.error || "Failed to send WhatsApp reply");
      }
      await messagingLogService.logMessage(userId, "whatsapp", {
        callId: meta?.callId,
        agentId: meta?.agentId,
        recipientPhone: to,
        templateName: "reply",
        status: "sent",
        responseData: response.data
      });
      console.log(`\u2705 [WhatsWay] Reply sent to ${to}`);
      return response.data;
    } catch (error) {
      await messagingLogService.logMessage(userId, "whatsapp", {
        callId: meta?.callId,
        agentId: meta?.agentId,
        recipientPhone: to,
        templateName: "reply",
        status: "failed",
        errorMessage: error.message
      });
      throw error;
    }
  }
  async uploadMedia(userId, fileBuffer, mimeType, filename) {
    const { apiKey, apiSecret, baseUrl, channelId } = await this.getCredentials(userId);
    const url = `${baseUrl}/api/v1/media/upload`;
    const formData = new FormData();
    formData.append("file", new Blob([fileBuffer], { type: mimeType }), filename);
    formData.append("mimeType", mimeType);
    const headers = {
      "X-API-Key": apiKey,
      "X-API-Secret": apiSecret
    };
    if (channelId) headers["X-Channel-Id"] = channelId;
    console.log(`[WhatsWay] Uploading media: ${filename} (${mimeType}, ${fileBuffer.length} bytes)`);
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: formData
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(`WhatsWay media upload failed (${response.status}): ${errorText}`);
    }
    const json = await response.json();
    const mediaId = json?.data?.mediaId || json?.data?.id || json?.data?.url || "";
    if (!mediaId) {
      throw new Error("WhatsWay media upload succeeded but no media ID returned");
    }
    console.log(`[WhatsWay] Media uploaded: ${mediaId}`);
    return mediaId;
  }
  async getMediaStream(userId, mediaId) {
    const { apiKey, apiSecret, baseUrl, channelId } = await this.getCredentials(userId);
    let downloadUrl;
    if (mediaId.startsWith("http://") || mediaId.startsWith("https://")) {
      const allowedHost = new URL(baseUrl).host;
      const mediaHost = new URL(mediaId).host;
      if (mediaHost !== allowedHost) {
        throw new Error("Media URL is not from a trusted WhatsWay host");
      }
      downloadUrl = mediaId;
    } else {
      downloadUrl = `${baseUrl}/api/v1/media/${encodeURIComponent(mediaId)}`;
    }
    const headers = {
      "X-API-Key": apiKey,
      "X-API-Secret": apiSecret
    };
    if (channelId) headers["X-Channel-Id"] = channelId;
    const mediaRes = await fetch(downloadUrl, { headers });
    if (!mediaRes.ok) {
      throw new Error(`WhatsWay media download failed (${mediaRes.status})`);
    }
    const contentType = mediaRes.headers.get("content-type") || "application/octet-stream";
    const contentLength = mediaRes.headers.get("content-length");
    return {
      stream: mediaRes.body,
      contentType,
      contentLength: contentLength ? parseInt(contentLength, 10) : void 0
    };
  }
  async sendMediaMessage(userId, to, mediaType, mediaId, options, meta) {
    try {
      const response = await this.makeRequest(userId, "POST", "/api/v1/messages/media", {
        to,
        type: mediaType,
        mediaId,
        caption: options?.caption,
        filename: options?.filename
      });
      if (!response.success) {
        throw new Error(response.error || "Failed to send WhatsApp media message");
      }
      const preview = options?.caption || options?.filename || `[${mediaType}]`;
      await messagingLogService.logMessage(userId, "whatsapp", {
        recipientPhone: to,
        templateName: `media:${mediaType}`,
        status: "sent",
        responseData: response.data,
        messageContent: preview.substring(0, 200),
        messageType: mediaType,
        callId: meta?.callId,
        agentId: meta?.agentId
      });
      console.log(`\u2705 [WhatsWay] ${mediaType} sent to ${to}`);
      return response.data;
    } catch (error) {
      const preview = options?.caption || options?.filename || `[${mediaType}]`;
      await messagingLogService.logMessage(userId, "whatsapp", {
        recipientPhone: to,
        templateName: `media:${mediaType}`,
        status: "failed",
        errorMessage: error.message,
        messageContent: preview.substring(0, 200),
        messageType: mediaType,
        callId: meta?.callId,
        agentId: meta?.agentId
      });
      throw error;
    }
  }
  async sendLocationMessage(userId, to, latitude, longitude, name, address, meta) {
    try {
      const response = await this.makeRequest(userId, "POST", "/api/v1/messages/location", {
        to,
        latitude,
        longitude,
        name,
        address
      });
      if (!response.success) {
        throw new Error(response.error || "Failed to send WhatsApp location message");
      }
      const preview = name || `${latitude}, ${longitude}`;
      await messagingLogService.logMessage(userId, "whatsapp", {
        recipientPhone: to,
        templateName: "location",
        status: "sent",
        responseData: response.data,
        messageContent: preview.substring(0, 200),
        messageType: "location",
        callId: meta?.callId,
        agentId: meta?.agentId
      });
      console.log(`\u2705 [WhatsWay] Location sent to ${to}`);
      return response.data;
    } catch (error) {
      const preview = name || `${latitude}, ${longitude}`;
      await messagingLogService.logMessage(userId, "whatsapp", {
        recipientPhone: to,
        templateName: "location",
        status: "failed",
        errorMessage: error.message,
        messageContent: preview.substring(0, 200),
        messageType: "location",
        callId: meta?.callId,
        agentId: meta?.agentId
      });
      throw error;
    }
  }
}
const whatswayService = new WhatswayService();
export {
  WhatswayService,
  whatswayService
};
