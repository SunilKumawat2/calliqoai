import { db } from "../../../server/db.js";
import { sql } from "drizzle-orm";
import { messagingLogService } from "./messaging-log.service.js";
const META_GRAPH_API_BASE = "https://graph.facebook.com";
const META_API_VERSION = process.env.META_WHATSAPP_API_VERSION || "v21.0";
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
function validatePhoneNumber(phone) {
  if (!/^[+\d]/.test(phone)) {
    throw new Error("Invalid phone number format. Use international format (e.g., +1234567890).");
  }
  const stripped = phone.replace(/[^0-9+]/g, "");
  const digits = stripped.replace(/\+/g, "");
  if (digits.length < 7) {
    throw new Error("Invalid phone number format. Use international format (e.g., +1234567890).");
  }
}
class MetaWhatsAppService {
  async getSettings(userId) {
    const result = await db.execute(sql`
      SELECT * FROM meta_whatsapp_settings WHERE user_id = ${userId} LIMIT 1
    `);
    const row = result.rows[0];
    return row ? transformRow(row) : null;
  }
  async saveSettings(userId, data) {
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
    return transformRow(result.rows[0]);
  }
  async _attemptRegister(phoneNumberId, accessToken, includePin) {
    const url = `${META_GRAPH_API_BASE}/${META_API_VERSION}/${phoneNumberId}/register`;
    const body = { messaging_product: "whatsapp" };
    if (includePin) body.pin = "123456";
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    console.log(`[Meta WhatsApp] Register response (${response.status}):`, JSON.stringify(data));
    return { ok: response.ok, data, status: response.status };
  }
  async registerPhoneNumber(phoneNumberId, accessToken) {
    try {
      console.log(`[Meta WhatsApp] Registering phone number with Cloud API...`);
      let result = await this._attemptRegister(phoneNumberId, accessToken, false);
      if (!result.ok) {
        console.log(`[Meta WhatsApp] Register without pin failed (${result.data?.error?.code}), retrying with pin...`);
        result = await this._attemptRegister(phoneNumberId, accessToken, true);
      }
      if (!result.ok) {
        console.log(`[Meta WhatsApp] Both attempts failed, waiting 3s before final retry...`);
        await new Promise((resolve) => setTimeout(resolve, 3e3));
        result = await this._attemptRegister(phoneNumberId, accessToken, true);
      }
      if (!result.ok) {
        const errMsg = result.data?.error?.message || JSON.stringify(result.data);
        console.error(`[Meta WhatsApp] Phone registration failed after all attempts:`, {
          code: result.data?.error?.code,
          subcode: result.data?.error?.error_subcode,
          type: result.data?.error?.type,
          message: result.data?.error?.message,
          fbtrace_id: result.data?.error?.fbtrace_id
        });
        return { success: false, error: errMsg };
      }
      console.log(`[Meta WhatsApp] Phone number registered successfully`);
      return { success: true };
    } catch (error) {
      console.error(`[Meta WhatsApp] Phone registration error:`, error.message);
      return { success: false, error: error.message };
    }
  }
  async overrideCallbackUrl(phoneNumberId, accessToken, callbackUrl, verifyToken) {
    try {
      const url = `${META_GRAPH_API_BASE}/${META_API_VERSION}/${phoneNumberId}/override_callback_url`;
      console.log(`[Meta WhatsApp] Setting override callback URL for phone...`);
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          callback_url: callbackUrl,
          verify_token: verifyToken
        })
      });
      const data = await response.json();
      if (!response.ok) {
        console.error(`[Meta WhatsApp] Override callback URL failed:`, data?.error?.message || JSON.stringify(data));
        return false;
      }
      console.log(`[Meta WhatsApp] Override callback URL set successfully`);
      return true;
    } catch (error) {
      console.error(`[Meta WhatsApp] Override callback URL error:`, error.message);
      return false;
    }
  }
  async subscribeWabaToWebhooks(wabaId, accessToken) {
    try {
      const url = `${META_GRAPH_API_BASE}/${META_API_VERSION}/${wabaId}/subscribed_apps`;
      console.log(`[Meta WhatsApp] Subscribing WABA ${wabaId} to webhook events`);
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`
        }
      });
      const data = await response.json();
      if (!response.ok) {
        console.error(`[Meta WhatsApp] WABA subscription failed:`, data?.error?.message || JSON.stringify(data));
        return false;
      }
      console.log(`[Meta WhatsApp] WABA ${wabaId} subscribed to webhooks successfully`);
      return true;
    } catch (error) {
      console.error(`[Meta WhatsApp] WABA subscription error:`, error.message);
      return false;
    }
  }
  async deactivate(userId) {
    await db.execute(sql`
      UPDATE meta_whatsapp_settings SET is_active = false, updated_at = NOW() WHERE user_id = ${userId}
    `);
  }
  async deleteSettings(userId) {
    await db.execute(sql`
      DELETE FROM meta_whatsapp_settings WHERE user_id = ${userId}
    `);
  }
  async getCredentials(userId, skipActiveCheck = false) {
    const settings = await this.getSettings(userId);
    if (!settings) {
      throw new Error("Meta WhatsApp not configured. Please add your WABA credentials first.");
    }
    if (!skipActiveCheck && !settings.isActive) {
      throw new Error("Meta WhatsApp integration is disabled.");
    }
    return {
      phoneNumberId: settings.phoneNumberId,
      wabaId: settings.wabaId,
      accessToken: settings.accessToken
    };
  }
  async makeRequest(userId, method, path, body, skipActiveCheck = false) {
    const { accessToken } = await this.getCredentials(userId, skipActiveCheck);
    const url = `${META_GRAPH_API_BASE}/${META_API_VERSION}${path}`;
    const headers = {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    };
    const options = { method, headers };
    if (body) {
      options.body = JSON.stringify(body);
    }
    console.log(`[Meta WhatsApp] ${method} ${url}`);
    if (body) {
      console.log(`[Meta WhatsApp] Request Payload: ${JSON.stringify(body, null, 2)}`);
    }
    const response = await fetch(url, options);
    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
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
            httpStatus: response.status
          }));
        }
      } catch {
      }
      if (response.status === 401 || response.status === 190) {
        errorMessage = "Invalid or expired Meta access token";
      } else if (response.status === 403) {
        errorMessage = "Insufficient permissions. Ensure your token has whatsapp_business_management and whatsapp_business_messaging permissions.";
      } else if (response.status === 429) {
        errorMessage = "Meta API rate limit exceeded. Please try again later.";
      } else {
        try {
          const errorJson = JSON.parse(errorText);
          const metaError = errorJson?.error;
          if (metaError?.code === 131047) {
            errorMessage = "Cannot send text message: the 24-hour customer service window has closed. Use a template message instead.";
          } else if (metaError?.code === 131026) {
            errorMessage = "Message could not be delivered. The recipient may have blocked messages or the number is invalid.";
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
  async testConnection(userId, skipActiveCheck = false) {
    const { phoneNumberId } = await this.getCredentials(userId, skipActiveCheck);
    const response = await this.makeRequest(
      userId,
      "GET",
      `/${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`,
      void 0,
      skipActiveCheck
    );
    return {
      businessName: response.verified_name || response.display_phone_number || "Meta WhatsApp",
      phoneNumber: response.display_phone_number || ""
    };
  }
  async getChannelHealth(userId) {
    const { phoneNumberId } = await this.getCredentials(userId);
    const fields = "display_phone_number,verified_name,quality_rating,account_mode,code_verification_status,name_status,messaging_limit_tier,throughput";
    const response = await this.makeRequest(
      userId,
      "GET",
      `/${phoneNumberId}?fields=${fields}`
    );
    return {
      accountMode: response.account_mode || "UNKNOWN",
      qualityRating: response.quality_rating || "UNKNOWN",
      messagingLimit: response.messaging_limit_tier || "UNKNOWN",
      throughput: response.throughput?.level || "STANDARD",
      verification: response.code_verification_status || "UNKNOWN",
      nameStatus: response.name_status || "UNKNOWN",
      phoneNumber: response.display_phone_number || "",
      businessName: response.verified_name || "",
      lastChecked: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  async getTemplates(userId) {
    const { wabaId, accessToken } = await this.getCredentials(userId);
    const MAX_PAGES = 10;
    const templates = [];
    const firstResponse = await this.makeRequest(
      userId,
      "GET",
      `/${wabaId}/message_templates?fields=name,status,category,language,components&limit=100`
    );
    const appendApproved = (data) => {
      for (const tmpl of data) {
        if (tmpl.status === "APPROVED") {
          templates.push({
            name: tmpl.name,
            status: tmpl.status,
            language: tmpl.language,
            category: tmpl.category || "",
            components: tmpl.components || []
          });
        }
      }
    };
    appendApproved(firstResponse?.data || []);
    let nextUrl = firstResponse?.paging?.next;
    let pageCount = 1;
    while (nextUrl && pageCount < MAX_PAGES) {
      pageCount++;
      console.log(`[Meta WhatsApp] Fetching templates page ${pageCount}: ${nextUrl}`);
      const response = await fetch(nextUrl, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        }
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
  async getTemplateByName(userId, templateName) {
    try {
      const templates = await this.getTemplates(userId);
      return templates.find((t) => t.name === templateName) || null;
    } catch (error) {
      console.warn(`[Meta WhatsApp] Failed to fetch template "${templateName}": ${error.message}`);
      return null;
    }
  }
  static buildButtonComponents(templateComponents, buttonOverrides) {
    const buttonComponents = [];
    const buttonsComponent = templateComponents.find(
      (c) => c.type === "BUTTONS" || c.type === "buttons"
    );
    if (!buttonsComponent || !Array.isArray(buttonsComponent.buttons)) return buttonComponents;
    buttonsComponent.buttons.forEach((btn, index) => {
      if (btn.type === "URL" && btn.url && btn.url.includes("{{")) {
        const overrideValue = buttonOverrides?.[index];
        buttonComponents.push({
          type: "button",
          sub_type: "url",
          index: String(index),
          parameters: [{
            type: "text",
            text: overrideValue || (Array.isArray(btn.example) ? btn.example[0] : null) || "details"
          }]
        });
      }
    });
    return buttonComponents;
  }
  async sendTemplate(userId, to, templateName, language, components = [], meta) {
    validatePhoneNumber(to);
    const { phoneNumberId } = await this.getCredentials(userId);
    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: to.replace(/[^0-9]/g, ""),
      type: "template",
      template: {
        name: templateName,
        language: {
          code: language || "en_US"
        }
      }
    };
    if (components && components.length > 0) {
      payload.template.components = components;
    }
    try {
      const response = await this.makeRequest(userId, "POST", `/${phoneNumberId}/messages`, payload);
      const messageId = response?.messages?.[0]?.id || "";
      const messageStatus = response?.messages?.[0]?.message_status || "accepted";
      await messagingLogService.logMessage(userId, "whatsapp", {
        callId: meta?.callId,
        agentId: meta?.agentId,
        recipientPhone: to,
        templateName,
        status: "sent",
        responseData: response,
        messageContent: `Template: ${templateName}`,
        messageType: "template"
      });
      console.log(`[Meta WhatsApp] Template "${templateName}" sent to ${to} (${messageId})`);
      return { messageId, status: messageStatus };
    } catch (error) {
      await messagingLogService.logMessage(userId, "whatsapp", {
        callId: meta?.callId,
        agentId: meta?.agentId,
        recipientPhone: to,
        templateName,
        status: "failed",
        errorMessage: error.message,
        messageContent: `Template: ${templateName}`,
        messageType: "template"
      });
      console.log(`[Meta WhatsApp] Failed to send template "${templateName}" to ${to}: ${error.message}`);
      throw error;
    }
  }
  async markMessageRead(userId, metaMessageId) {
    try {
      const { phoneNumberId } = await this.getCredentials(userId);
      await this.makeRequest(userId, "POST", `/${phoneNumberId}/messages`, {
        messaging_product: "whatsapp",
        status: "read",
        message_id: metaMessageId
      });
    } catch (error) {
      console.log(`[Meta WhatsApp] Failed to send read receipt for ${metaMessageId}: ${error.message}`);
    }
  }
  async sendReply(userId, to, message, meta) {
    validatePhoneNumber(to);
    const { phoneNumberId } = await this.getCredentials(userId);
    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: to.replace(/[^0-9]/g, ""),
      type: "text",
      text: {
        preview_url: false,
        body: message
      }
    };
    try {
      const response = await this.makeRequest(userId, "POST", `/${phoneNumberId}/messages`, payload);
      const messageId = response?.messages?.[0]?.id || "";
      const messageStatus = response?.messages?.[0]?.message_status || "accepted";
      await messagingLogService.logMessage(userId, "whatsapp", {
        callId: meta?.callId,
        agentId: meta?.agentId,
        recipientPhone: to,
        templateName: "reply",
        status: "sent",
        responseData: response,
        messageContent: message.substring(0, 200),
        messageType: "text"
      });
      console.log(`[Meta WhatsApp] Reply sent to ${to} (${messageId})`);
      return { messageId, status: messageStatus };
    } catch (error) {
      await messagingLogService.logMessage(userId, "whatsapp", {
        callId: meta?.callId,
        agentId: meta?.agentId,
        recipientPhone: to,
        templateName: "reply",
        status: "failed",
        errorMessage: error.message,
        messageContent: message.substring(0, 200),
        messageType: "text"
      });
      throw error;
    }
  }
  async uploadMedia(userId, fileBuffer, mimeType, filename) {
    const { phoneNumberId, accessToken } = await this.getCredentials(userId);
    const url = `${META_GRAPH_API_BASE}/${META_API_VERSION}/${phoneNumberId}/media`;
    const formData = new FormData();
    formData.append("messaging_product", "whatsapp");
    formData.append("type", mimeType);
    formData.append("file", new Blob([fileBuffer], { type: mimeType }), filename);
    console.log(`[Meta WhatsApp] Uploading media: ${filename} (${mimeType}, ${fileBuffer.length} bytes)`);
    const response = await fetch(url, {
      method: "POST",
      headers: { "Authorization": `Bearer ${accessToken}` },
      body: formData
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(`Media upload failed (${response.status}): ${errorText}`);
    }
    const json = await response.json();
    const mediaId = json?.id;
    if (!mediaId) {
      throw new Error("Media upload succeeded but no media ID returned");
    }
    console.log(`[Meta WhatsApp] Media uploaded: ${mediaId}`);
    return mediaId;
  }
  async getMediaStream(userId, mediaId) {
    const { accessToken } = await this.getCredentials(userId);
    const metaRes = await fetch(`${META_GRAPH_API_BASE}/${META_API_VERSION}/${mediaId}`, {
      headers: { "Authorization": `Bearer ${accessToken}` }
    });
    if (!metaRes.ok) {
      throw new Error(`Failed to get media URL (${metaRes.status})`);
    }
    const metaJson = await metaRes.json();
    const downloadUrl = metaJson.url;
    if (!downloadUrl) throw new Error("No download URL returned for media");
    const mediaRes = await fetch(downloadUrl, {
      headers: { "Authorization": `Bearer ${accessToken}` }
    });
    if (!mediaRes.ok) {
      throw new Error(`Failed to download media (${mediaRes.status})`);
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
    validatePhoneNumber(to);
    const { phoneNumberId } = await this.getCredentials(userId);
    const mediaPayload = { id: mediaId };
    if (options?.caption && ["image", "video", "document"].includes(mediaType)) {
      mediaPayload.caption = options.caption;
    }
    if (options?.filename && mediaType === "document") {
      mediaPayload.filename = options.filename;
    }
    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: to.replace(/[^0-9]/g, ""),
      type: mediaType,
      [mediaType]: mediaPayload
    };
    try {
      const response = await this.makeRequest(userId, "POST", `/${phoneNumberId}/messages`, payload);
      const messageId = response?.messages?.[0]?.id || "";
      const messageStatus = response?.messages?.[0]?.message_status || "accepted";
      const preview = options?.caption || options?.filename || `[${mediaType}]`;
      await messagingLogService.logMessage(userId, "whatsapp", {
        recipientPhone: to,
        templateName: `media:${mediaType}`,
        status: "sent",
        responseData: response,
        messageContent: preview.substring(0, 200),
        messageType: mediaType,
        callId: meta?.callId,
        agentId: meta?.agentId
      });
      console.log(`[Meta WhatsApp] ${mediaType} sent to ${to} (${messageId})`);
      return { messageId, status: messageStatus };
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
    validatePhoneNumber(to);
    const { phoneNumberId } = await this.getCredentials(userId);
    const locationPayload = { latitude, longitude };
    if (name) locationPayload.name = name;
    if (address) locationPayload.address = address;
    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: to.replace(/[^0-9]/g, ""),
      type: "location",
      location: locationPayload
    };
    try {
      const response = await this.makeRequest(userId, "POST", `/${phoneNumberId}/messages`, payload);
      const messageId = response?.messages?.[0]?.id || "";
      const messageStatus = response?.messages?.[0]?.message_status || "accepted";
      const preview = name || `${latitude}, ${longitude}`;
      await messagingLogService.logMessage(userId, "whatsapp", {
        recipientPhone: to,
        templateName: "location",
        status: "sent",
        responseData: response,
        messageContent: preview.substring(0, 200),
        messageType: "location",
        callId: meta?.callId,
        agentId: meta?.agentId
      });
      console.log(`[Meta WhatsApp] Location sent to ${to} (${messageId})`);
      return { messageId, status: messageStatus };
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
const metaWhatsAppService = new MetaWhatsAppService();
export {
  MetaWhatsAppService,
  metaWhatsAppService
};
