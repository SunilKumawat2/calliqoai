import { Router } from "express";
import multer from "multer";
import { emailTemplateService } from "../services/email-template.service.js";
import { whatswayService } from "../services/whatsway.service.js";
import { metaWhatsAppService } from "../services/meta-whatsapp.service.js";
import { metaWhatsAppAdminService } from "../services/meta-whatsapp-admin.service.js";
import { whatsAppConversationService } from "../services/whatsapp-conversation.service.js";
import { messagingLogService } from "../services/messaging-log.service.js";
async function getActiveWhatsAppProvider(userId) {
  const [metaSettings, whatswaySettings] = await Promise.all([
    metaWhatsAppService.getSettings(userId),
    whatswayService.getSettings(userId)
  ]);
  if (metaSettings?.isActive) return "meta";
  if (whatswaySettings?.isActive) return "whatsway";
  return null;
}
const ALLOWED_MIME_TYPES = /* @__PURE__ */ new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/3gpp",
  "audio/aac",
  "audio/mp4",
  "audio/mpeg",
  "audio/amr",
  "audio/ogg",
  "application/pdf",
  "application/vnd.ms-powerpoint",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain"
]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 16 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}. Allowed: images (JPEG/PNG/WebP), videos (MP4/3GPP), audio (AAC/MP3/OGG/AMR), and documents (PDF/DOC/XLS/PPT/TXT).`));
    }
  }
});
const router = Router();
router.get("/email-templates", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });
    try {
      await emailTemplateService.seedDefaultTemplates(userId);
    } catch (seedErr) {
      console.warn("[Messaging] Failed to seed default templates:", seedErr.message);
    }
    const templates = await emailTemplateService.getAll(userId);
    res.json({ success: true, data: templates });
  } catch (error) {
    console.error("[Messaging] Error fetching email templates:", error.message);
    res.status(500).json({ success: false, error: "Failed to fetch email templates" });
  }
});
router.post("/email-templates", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });
    const { name, subject, htmlBody, variables, designJson } = req.body;
    if (!name || !subject || !htmlBody) {
      return res.status(400).json({ success: false, error: "Name, subject, and htmlBody are required" });
    }
    const template = await emailTemplateService.create(userId, { name, subject, htmlBody, variables, designJson });
    res.json({ success: true, data: template });
  } catch (error) {
    console.error("[Messaging] Error creating email template:", error.message);
    res.status(500).json({ success: false, error: "Failed to create email template" });
  }
});
router.put("/email-templates/:id", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });
    const { id } = req.params;
    const { name, subject, htmlBody } = req.body;
    if (!name || !subject || !htmlBody) {
      return res.status(400).json({ success: false, error: "Name, subject, and htmlBody are required" });
    }
    const template = await emailTemplateService.update(userId, id, req.body);
    if (!template) {
      return res.status(404).json({ success: false, error: "Template not found" });
    }
    res.json({ success: true, data: template });
  } catch (error) {
    console.error("[Messaging] Error updating email template:", error.message);
    res.status(500).json({ success: false, error: "Failed to update email template" });
  }
});
router.delete("/email-templates/:id", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });
    const { id } = req.params;
    const deleted = await emailTemplateService.delete(userId, id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: "Template not found" });
    }
    res.json({ success: true });
  } catch (error) {
    console.error("[Messaging] Error deleting email template:", error.message);
    res.status(500).json({ success: false, error: "Failed to delete email template" });
  }
});
router.post("/email-templates/:id/test", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });
    const { id } = req.params;
    const { recipientEmail, variables } = req.body;
    if (!recipientEmail) {
      return res.status(400).json({ success: false, error: "recipientEmail is required" });
    }
    try {
      await emailTemplateService.seedDefaultTemplates(userId);
    } catch (seedErr) {
      console.warn("[Messaging] Template repair skipped before test send:", seedErr?.message);
    }
    const result = await emailTemplateService.sendEmail(userId, id, recipientEmail, variables || {});
    res.json({ success: result.success, data: result });
  } catch (error) {
    console.error("[Messaging] Error sending test email:", error.message);
    res.status(500).json({ success: false, error: "Failed to send test email" });
  }
});
router.post("/whatsapp/test", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });
    const { phoneNumber, templateName, language, components } = req.body;
    if (!phoneNumber) {
      return res.status(400).json({ success: false, error: "phoneNumber is required" });
    }
    if (!templateName) {
      return res.status(400).json({ success: false, error: "templateName is required" });
    }
    const provider = await getActiveWhatsAppProvider(userId);
    if (!provider) {
      return res.status(400).json({ success: false, error: "No WhatsApp provider configured." });
    }
    let result;
    if (provider === "meta") {
      result = await metaWhatsAppService.sendTemplate(
        userId,
        phoneNumber,
        templateName,
        language || "en_US",
        components || []
      );
    } else {
      result = await whatswayService.sendTemplate(
        userId,
        phoneNumber,
        templateName,
        language || "en_US",
        components || []
      );
    }
    res.json({ success: true, data: result });
  } catch (error) {
    console.error("[Messaging] Error sending test WhatsApp message:", error.message);
    res.status(500).json({ success: false, error: "Failed to send test WhatsApp message" });
  }
});
router.get("/whatsway/settings", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });
    const settings = await whatswayService.getSettings(userId);
    if (settings) {
      const masked = {
        ...settings,
        apiKey: settings.apiKey ? `${settings.apiKey.substring(0, 8)}...` : "",
        apiSecret: settings.apiSecret ? `${settings.apiSecret.substring(0, 8)}...` : ""
      };
      res.json({ success: true, data: masked });
    } else {
      res.json({ success: true, data: null });
    }
  } catch (error) {
    console.error("[Messaging] Error fetching WhatsWay settings:", error.message);
    res.status(500).json({ success: false, error: "Failed to fetch WhatsWay settings" });
  }
});
router.post("/whatsway/settings", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });
    const whatswayAllowed = await metaWhatsAppAdminService.isWhatswayAllowed();
    if (!whatswayAllowed) {
      return res.status(403).json({ success: false, error: "WhatsWay is not enabled by the administrator" });
    }
    const { apiKey, apiSecret, baseUrl, channelId } = req.body;
    if (!apiKey || !apiSecret) {
      return res.status(400).json({ success: false, error: "apiKey and apiSecret are required" });
    }
    const settings = await whatswayService.saveSettings(userId, { apiKey, apiSecret, baseUrl, channelId });
    let verified = false;
    let accountName = "";
    let verifyError = "";
    try {
      const accountInfo = await whatswayService.testConnection(userId, true);
      verified = true;
      accountName = accountInfo?.name || accountInfo?.businessName || "";
      console.log(`[Messaging] WhatsWay credentials verified for user ${userId}: ${accountName}`);
      try {
        await metaWhatsAppService.deactivate(userId);
        console.log(`[Messaging] Deactivated Meta WhatsApp for user ${userId} (WhatsWay is now active)`);
      } catch (_) {
      }
    } catch (verErr) {
      verifyError = verErr.message || "Verification failed";
      console.log(`[Messaging] WhatsWay credentials saved but verification failed for user ${userId}: ${verifyError}`);
    }
    res.json({
      success: true,
      data: {
        id: settings.id,
        baseUrl: settings.baseUrl,
        isActive: settings.isActive,
        verified,
        accountName,
        verifyError
      }
    });
  } catch (error) {
    console.error("[Messaging] Error saving WhatsWay settings:", error.message);
    res.status(500).json({ success: false, error: "Failed to save WhatsWay settings" });
  }
});
router.delete("/whatsway/settings", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });
    await whatswayService.deleteSettings(userId);
    res.json({ success: true });
  } catch (error) {
    console.error("[Messaging] Error deleting WhatsWay settings:", error.message);
    res.status(500).json({ success: false, error: "Failed to delete WhatsWay settings" });
  }
});
router.post("/whatsway/test-connection", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });
    const accountInfo = await whatswayService.testConnection(userId);
    res.json({ success: true, data: accountInfo });
  } catch (error) {
    console.error("[Messaging] WhatsWay connection test failed:", error.message);
    res.status(400).json({ success: false, error: "Failed to test WhatsWay connection" });
  }
});
router.get("/whatsway/templates", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });
    const templates = await whatswayService.getTemplates(userId);
    res.json({ success: true, data: templates });
  } catch (error) {
    console.error("[Messaging] Error fetching WhatsWay templates:", error.message);
    res.status(400).json({ success: false, error: "Failed to fetch WhatsWay templates" });
  }
});
router.get("/meta-whatsapp/settings", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });
    const settings = await metaWhatsAppService.getSettings(userId);
    if (settings) {
      const safe = {
        ...settings,
        accessToken: settings.accessToken ? "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" : "",
        hasAccessToken: !!settings.accessToken
      };
      res.json({ success: true, data: safe });
    } else {
      res.json({ success: true, data: null });
    }
  } catch (error) {
    console.error("[Messaging] Error fetching Meta WhatsApp settings:", error.message);
    res.status(500).json({ success: false, error: "Failed to fetch Meta WhatsApp settings" });
  }
});
router.post("/meta-whatsapp/settings", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });
    const metaAllowed = await metaWhatsAppAdminService.isMetaAllowed();
    if (!metaAllowed) {
      return res.status(403).json({ success: false, error: "Meta WhatsApp is not enabled by the administrator" });
    }
    const { phoneNumberId, wabaId, accessToken } = req.body;
    if (!phoneNumberId || !wabaId) {
      return res.status(400).json({ success: false, error: "Phone Number ID and WABA ID are required" });
    }
    let tokenToSave = accessToken;
    const isPlaceholder = !accessToken || accessToken === "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" || accessToken.endsWith("...");
    if (isPlaceholder) {
      const existing = await metaWhatsAppService.getSettings(userId);
      if (existing?.accessToken) {
        tokenToSave = existing.accessToken;
      } else {
        return res.status(400).json({ success: false, error: "Access Token is required for initial setup" });
      }
    }
    const settings = await metaWhatsAppService.saveSettings(userId, { phoneNumberId, wabaId, accessToken: tokenToSave });
    try {
      const regResult = await metaWhatsAppService.registerPhoneNumber(phoneNumberId, tokenToSave);
      console.log(`[Messaging] Auto-registration result: ${regResult.success}${regResult.error ? ` (${regResult.error})` : ""}`);
    } catch (regErr) {
      console.warn(`[Messaging] Auto-registration failed for phone:`, regErr.message);
    }
    let verified = false;
    let businessName = "";
    let verifyError = "";
    try {
      const connInfo = await metaWhatsAppService.testConnection(userId, true);
      verified = true;
      businessName = connInfo.businessName || "";
      console.log(`[Messaging] Meta WhatsApp credentials verified for user ${userId}: ${businessName}`);
      try {
        await whatswayService.deactivate(userId);
        console.log(`[Messaging] Deactivated WhatsWay for user ${userId} (Meta WhatsApp is now active)`);
      } catch (_) {
      }
    } catch (verErr) {
      verifyError = verErr.message || "Verification failed";
      console.log(`[Messaging] Meta WhatsApp credentials saved but verification failed for user ${userId}: ${verifyError}`);
    }
    res.json({
      success: true,
      data: {
        id: settings.id,
        isActive: settings.isActive,
        verified,
        businessName,
        verifyError
      }
    });
  } catch (error) {
    console.error("[Messaging] Error saving Meta WhatsApp settings:", error.message);
    res.status(500).json({ success: false, error: "Failed to save Meta WhatsApp settings" });
  }
});
router.delete("/meta-whatsapp/settings", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });
    await metaWhatsAppService.deleteSettings(userId);
    res.json({ success: true });
  } catch (error) {
    console.error("[Messaging] Error deleting Meta WhatsApp settings:", error.message);
    res.status(500).json({ success: false, error: "Failed to delete Meta WhatsApp settings" });
  }
});
router.post("/meta-whatsapp/test-connection", async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });
  try {
    const connInfo = await metaWhatsAppService.testConnection(userId);
    res.json({ success: true, data: connInfo });
  } catch (error) {
    console.error("[Messaging] Meta WhatsApp connection test failed:", error.message);
    if (error.message && /not registered|register/i.test(error.message)) {
      console.log("[Messaging] Connection test failure looks registration-related, attempting auto-registration...");
      try {
        const settings = await metaWhatsAppService.getSettings(userId);
        if (settings?.phoneNumberId && settings?.accessToken) {
          const regResult = await metaWhatsAppService.registerPhoneNumber(settings.phoneNumberId, settings.accessToken);
          console.log(`[Messaging] Auto-registration result: ${regResult.success}${regResult.error ? ` (${regResult.error})` : ""}`);
          if (regResult.success) {
            const connInfo = await metaWhatsAppService.testConnection(userId);
            return res.json({ success: true, data: { ...connInfo, autoRegistered: true } });
          }
        }
      } catch (autoRegErr) {
        console.error("[Messaging] Auto-registration attempt failed:", autoRegErr.message);
      }
    }
    res.status(400).json({ success: false, error: "Failed to test Meta WhatsApp connection" });
  }
});
router.get("/meta-whatsapp/channel-health", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });
    const health = await metaWhatsAppService.getChannelHealth(userId);
    res.json({ success: true, data: health });
  } catch (error) {
    console.error("[Messaging] Error fetching channel health:", error.message);
    res.status(400).json({ success: false, error: error.message || "Failed to fetch channel health" });
  }
});
router.get("/meta-whatsapp/templates", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });
    const templates = await metaWhatsAppService.getTemplates(userId);
    res.json({ success: true, data: templates });
  } catch (error) {
    console.error("[Messaging] Error fetching Meta WhatsApp templates:", error.message);
    res.status(400).json({ success: false, error: "Failed to fetch Meta WhatsApp templates" });
  }
});
router.get("/logs", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });
    const { channel, status, startDate, endDate, limit, offset } = req.query;
    const result = await messagingLogService.getLogs(userId, {
      channel,
      status,
      startDate,
      endDate,
      limit: limit ? parseInt(limit, 10) : void 0,
      offset: offset ? parseInt(offset, 10) : void 0
    });
    res.json({ success: true, data: result });
  } catch (error) {
    console.error("[Messaging] Error fetching logs:", error.message);
    res.status(500).json({ success: false, error: "Failed to fetch messaging logs" });
  }
});
router.get("/whatsapp-provider-config", async (req, res) => {
  try {
    const config = await metaWhatsAppAdminService.getConfig();
    const providerMode = config?.whatsappProviderMode || "both";
    const embeddedSignupEnabled = config?.embeddedSignupEnabled ?? false;
    const coexistenceEnabled = config?.coexistenceEnabled ?? false;
    const result = {
      providerMode,
      embeddedSignupEnabled,
      coexistenceEnabled
    };
    if (embeddedSignupEnabled) {
      result.metaAppId = config?.metaAppId || "";
      result.metaConfigId = config?.metaConfigId || "";
    }
    res.json({ success: true, data: result });
  } catch (error) {
    console.error("[Messaging] Error fetching WhatsApp provider config:", error.message);
    res.status(500).json({ success: false, error: "Failed to fetch provider config" });
  }
});
router.get("/conversations", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });
    const { status, search, limit, offset } = req.query;
    const result = await whatsAppConversationService.getConversations(userId, {
      status,
      search,
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0
    });
    res.json({ success: true, data: result });
  } catch (error) {
    console.error("[Messaging] Error fetching conversations:", error.message);
    res.status(500).json({ success: false, error: "Failed to fetch conversations" });
  }
});
router.get("/conversations/updates", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });
    const { since } = req.query;
    if (!since) {
      return res.status(400).json({ success: false, error: "since parameter is required (ISO timestamp)" });
    }
    const conversations = await whatsAppConversationService.getConversationUpdates(userId, since);
    res.json({ success: true, data: conversations });
  } catch (error) {
    console.error("[Messaging] Error fetching conversation updates:", error.message);
    res.status(500).json({ success: false, error: "Failed to fetch conversation updates" });
  }
});
router.get("/conversations/:id", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });
    const conversation = await whatsAppConversationService.getConversation(userId, req.params.id);
    if (!conversation) {
      return res.status(404).json({ success: false, error: "Conversation not found" });
    }
    res.json({ success: true, data: conversation });
  } catch (error) {
    console.error("[Messaging] Error fetching conversation:", error.message);
    res.status(500).json({ success: false, error: "Failed to fetch conversation" });
  }
});
router.get("/conversations/:id/messages", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });
    const conversation = await whatsAppConversationService.getConversation(userId, req.params.id);
    if (!conversation) {
      return res.status(404).json({ success: false, error: "Conversation not found" });
    }
    const { limit, before } = req.query;
    const messages = await whatsAppConversationService.getMessages(req.params.id, {
      limit: limit ? parseInt(limit, 10) : 50,
      before
    });
    res.json({ success: true, data: messages });
  } catch (error) {
    console.error("[Messaging] Error fetching messages:", error.message);
    res.status(500).json({ success: false, error: "Failed to fetch messages" });
  }
});
router.post("/conversations/:id/messages", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });
    const conversation = await whatsAppConversationService.getConversation(userId, req.params.id);
    if (!conversation) {
      return res.status(404).json({ success: false, error: "Conversation not found" });
    }
    const provider = await getActiveWhatsAppProvider(userId);
    if (!provider) {
      return res.status(400).json({ success: false, error: "No WhatsApp provider configured. Please set up WhatsWay or Meta WhatsApp in your messaging settings." });
    }
    const { type, content, templateName, language, components, mediaId, caption, filename, mimeType, latitude, longitude, locationName, address } = req.body;
    if (type === "text") {
      if (!content) {
        return res.status(400).json({ success: false, error: "content is required for text messages" });
      }
      if (!whatsAppConversationService.isWindowOpen(conversation)) {
        return res.status(400).json({ success: false, error: "24-hour window closed. Please use a template message." });
      }
      const sendResult = provider === "meta" ? await metaWhatsAppService.sendReply(userId, conversation.contactPhone, content) : await whatswayService.sendReply(userId, conversation.contactPhone, content);
      const message = await whatsAppConversationService.addMessage({
        conversationId: conversation.id,
        userId,
        direction: "outbound",
        senderType: "user",
        messageType: "text",
        content,
        metaMessageId: sendResult.messageId,
        status: "sent"
      });
      res.json({ success: true, data: message });
    } else if (type === "template") {
      if (!templateName) {
        return res.status(400).json({ success: false, error: "templateName is required for template messages" });
      }
      const sendResult = provider === "meta" ? await metaWhatsAppService.sendTemplate(userId, conversation.contactPhone, templateName, language || "en_US", components || []) : await whatswayService.sendTemplate(userId, conversation.contactPhone, templateName, language || "en_US", components || []);
      const message = await whatsAppConversationService.addMessage({
        conversationId: conversation.id,
        userId,
        direction: "outbound",
        senderType: "user",
        messageType: "template",
        content: content || `Template: ${templateName}`,
        metaMessageId: sendResult.messageId,
        templateName,
        status: "sent"
      });
      res.json({ success: true, data: message });
    } else if (["image", "video", "audio", "document", "sticker"].includes(type)) {
      if (!mediaId) {
        return res.status(400).json({ success: false, error: "mediaId is required for media messages. Upload first via /upload endpoint." });
      }
      if (!whatsAppConversationService.isWindowOpen(conversation)) {
        return res.status(400).json({ success: false, error: "24-hour window closed. Please use a template message." });
      }
      const sendResult = provider === "meta" ? await metaWhatsAppService.sendMediaMessage(userId, conversation.contactPhone, type, mediaId, { caption, filename }) : await whatswayService.sendMediaMessage(userId, conversation.contactPhone, type, mediaId, { caption, filename });
      const placeholders = {
        image: "[Image]",
        video: "[Video]",
        audio: "[Audio]",
        document: "[Document]",
        sticker: "[Sticker]"
      };
      const displayContent = caption || filename || placeholders[type] || `[${type}]`;
      const message = await whatsAppConversationService.addMessage({
        conversationId: conversation.id,
        userId,
        direction: "outbound",
        senderType: "user",
        messageType: type,
        content: displayContent,
        metaMessageId: sendResult.messageId,
        mediaUrl: mediaId,
        mediaMimeType: mimeType || null,
        status: "sent",
        metadata: { mediaId, caption, filename, mimeType }
      });
      res.json({ success: true, data: message });
    } else if (type === "location") {
      if (latitude == null || longitude == null) {
        return res.status(400).json({ success: false, error: "latitude and longitude are required for location messages" });
      }
      const lat = parseFloat(latitude);
      const lng = parseFloat(longitude);
      if (!isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return res.status(400).json({ success: false, error: "Invalid coordinates. Latitude must be -90 to 90, longitude -180 to 180." });
      }
      if (!whatsAppConversationService.isWindowOpen(conversation)) {
        return res.status(400).json({ success: false, error: "24-hour window closed. Please use a template message." });
      }
      const sendResult = provider === "meta" ? await metaWhatsAppService.sendLocationMessage(userId, conversation.contactPhone, lat, lng, locationName, address) : await whatswayService.sendLocationMessage(userId, conversation.contactPhone, lat, lng, locationName, address);
      const displayContent = `[Location: ${locationName || `${lat}, ${lng}`}]`;
      const message = await whatsAppConversationService.addMessage({
        conversationId: conversation.id,
        userId,
        direction: "outbound",
        senderType: "user",
        messageType: "location",
        content: displayContent,
        metaMessageId: sendResult.messageId,
        status: "sent",
        metadata: { latitude: lat, longitude: lng, name: locationName, address }
      });
      res.json({ success: true, data: message });
    } else {
      return res.status(400).json({ success: false, error: "Unsupported message type. Use: text, template, image, video, audio, document, sticker, or location." });
    }
  } catch (error) {
    console.error("[Messaging] Error sending message:", error.message);
    res.status(500).json({ success: false, error: error.message || "Failed to send message" });
  }
});
router.post("/conversations/:id/upload", upload.single("file"), async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });
    const conversation = await whatsAppConversationService.getConversation(userId, req.params.id);
    if (!conversation) {
      return res.status(404).json({ success: false, error: "Conversation not found" });
    }
    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, error: "No file uploaded" });
    }
    const provider = await getActiveWhatsAppProvider(userId);
    if (!provider) {
      return res.status(400).json({ success: false, error: "No WhatsApp provider configured." });
    }
    const mediaId = provider === "meta" ? await metaWhatsAppService.uploadMedia(userId, file.buffer, file.mimetype, file.originalname) : await whatswayService.uploadMedia(userId, file.buffer, file.mimetype, file.originalname);
    res.json({
      success: true,
      data: {
        mediaId,
        filename: file.originalname,
        mimeType: file.mimetype,
        size: file.size
      }
    });
  } catch (error) {
    console.error("[Messaging] Error uploading media:", error.message);
    res.status(500).json({ success: false, error: error.message || "Failed to upload media" });
  }
});
router.get("/media/:mediaId", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });
    const { mediaId } = req.params;
    if (!mediaId) return res.status(400).json({ success: false, error: "Media ID required" });
    const provider = await getActiveWhatsAppProvider(userId);
    if (!provider) {
      return res.status(400).json({ success: false, error: "No WhatsApp provider configured." });
    }
    let mediaResult;
    try {
      mediaResult = provider === "meta" ? await metaWhatsAppService.getMediaStream(userId, mediaId) : await whatswayService.getMediaStream(userId, mediaId);
    } catch (primaryErr) {
      try {
        mediaResult = provider === "meta" ? await whatswayService.getMediaStream(userId, mediaId) : await metaWhatsAppService.getMediaStream(userId, mediaId);
        console.log(`[Messaging] Media fallback succeeded for ${mediaId} (primary=${provider})`);
      } catch {
        throw primaryErr;
      }
    }
    const { stream, contentType, contentLength } = mediaResult;
    res.setHeader("Content-Type", contentType);
    if (contentLength) res.setHeader("Content-Length", contentLength);
    res.setHeader("Cache-Control", "private, max-age=3600");
    const { Readable } = await import("stream");
    if (stream && typeof stream.pipe === "function") {
      stream.pipe(res);
    } else if (stream && typeof stream.getReader === "function") {
      const nodeStream = Readable.fromWeb(stream);
      nodeStream.pipe(res);
    } else {
      res.status(500).json({ success: false, error: "Invalid media stream" });
    }
  } catch (error) {
    console.error("[Messaging] Error proxying media:", error.message);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: error.message || "Failed to fetch media" });
    }
  }
});
router.post("/conversations/:id/read", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });
    const conversation = await whatsAppConversationService.getConversation(userId, req.params.id);
    if (!conversation) {
      return res.status(404).json({ success: false, error: "Conversation not found" });
    }
    await whatsAppConversationService.markRead(userId, req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error("[Messaging] Error marking conversation as read:", error.message);
    res.status(500).json({ success: false, error: "Failed to mark conversation as read" });
  }
});
router.patch("/conversations/:id", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });
    const conversation = await whatsAppConversationService.getConversation(userId, req.params.id);
    if (!conversation) {
      return res.status(404).json({ success: false, error: "Conversation not found" });
    }
    const { status, autoReplyEnabled, assignedAgentId } = req.body;
    if (status !== void 0) {
      const validStatuses = ["active", "closed", "archived"];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ success: false, error: "Invalid status. Must be active, closed, or archived." });
      }
      await whatsAppConversationService.updateConversationStatus(userId, req.params.id, status);
    }
    if (autoReplyEnabled !== void 0) {
      await whatsAppConversationService.setAutoReply(userId, req.params.id, autoReplyEnabled, assignedAgentId);
    }
    const updated = await whatsAppConversationService.getConversation(userId, req.params.id);
    res.json({ success: true, data: updated });
  } catch (error) {
    console.error("[Messaging] Error updating conversation:", error.message);
    res.status(500).json({ success: false, error: "Failed to update conversation" });
  }
});
router.post("/meta-whatsapp/embedded-signup/callback", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });
    const { code, wabaId, phoneNumberId, coexistenceMode } = req.body;
    if (!code) {
      return res.status(400).json({ success: false, error: "Authorization code is required" });
    }
    const adminConfig = await metaWhatsAppAdminService.getConfig();
    const isCoexistence = coexistenceMode === true && adminConfig?.coexistenceEnabled === true;
    if (coexistenceMode === true && !adminConfig?.coexistenceEnabled) {
      return res.status(403).json({ success: false, error: "Coexistence mode is not enabled by the administrator." });
    }
    let accessToken;
    try {
      accessToken = await metaWhatsAppAdminService.exchangeCodeForToken(code);
    } catch (exchangeErr) {
      console.warn(`[Messaging] Code exchange failed, checking if value is already an access token: ${exchangeErr.message}`);
      const tokenTestUrl = `https://graph.facebook.com/v21.0/me?access_token=${encodeURIComponent(code)}`;
      const tokenTestRes = await fetch(tokenTestUrl);
      if (tokenTestRes.ok) {
        console.log("[Messaging] Value is a valid access token, using directly");
        accessToken = code;
      } else {
        throw exchangeErr;
      }
    }
    let finalWabaId = wabaId;
    let finalPhoneNumberId = phoneNumberId;
    if (!finalWabaId || !finalPhoneNumberId) {
      const wabaIds = await metaWhatsAppAdminService.debugToken(accessToken);
      if (wabaIds.length === 0) {
        return res.status(400).json({ success: false, error: "No WhatsApp Business Account found for this token." });
      }
      if (!finalWabaId) {
        finalWabaId = wabaIds[0];
      }
      if (!finalPhoneNumberId) {
        const phones = await metaWhatsAppAdminService.getPhoneNumbers(finalWabaId, accessToken);
        if (phones.length === 0) {
          return res.status(400).json({ success: false, error: "No phone numbers found for this WhatsApp Business Account." });
        }
        finalPhoneNumberId = phones[0].id;
      }
    }
    let registered = false;
    let callbackOverridden = false;
    let coexistenceFallback = false;
    if (isCoexistence) {
      const verifyToken = adminConfig?.webhookVerifyToken || "";
      if (!verifyToken) {
        return res.status(400).json({ success: false, error: "Webhook verify token must be configured before using coexistence mode." });
      }
    }
    const regResult = await metaWhatsAppService.registerPhoneNumber(finalPhoneNumberId, accessToken);
    registered = regResult.success;
    if (isCoexistence) {
      console.log(`[Messaging] Coexistence mode: setting up callback override...`);
      const verifyToken = adminConfig?.webhookVerifyToken || "";
      const host = req.headers["x-forwarded-host"] || req.headers.host;
      const isLocalhost = typeof host === "string" && (host.startsWith("localhost") || host.startsWith("127.0.0.1"));
      const protocol = isLocalhost ? "http" : req.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
      const webhookUrl = `${protocol}://${host}/api/webhooks/messaging/meta/webhook`;
      callbackOverridden = await metaWhatsAppService.overrideCallbackUrl(finalPhoneNumberId, accessToken, webhookUrl, verifyToken);
      if (!callbackOverridden) {
        console.warn(`[Messaging] Coexistence override failed`);
        coexistenceFallback = true;
      } else {
        console.log(`[Messaging] Coexistence override callback: ${callbackOverridden} (URL: ${webhookUrl})`);
      }
    }
    const subscribed = await metaWhatsAppService.subscribeWabaToWebhooks(finalWabaId, accessToken);
    console.log(`[Messaging] Post-signup: coexistence=${isCoexistence}, registration=${registered}, callbackOverridden=${callbackOverridden}, subscription=${subscribed}`);
    await metaWhatsAppService.saveSettings(userId, {
      phoneNumberId: finalPhoneNumberId,
      wabaId: finalWabaId,
      accessToken
    });
    try {
      await whatswayService.deactivate(userId);
      console.log(`[Messaging] Deactivated WhatsWay for user ${userId} (Embedded Signup completed)`);
    } catch (_) {
    }
    let businessName = "";
    try {
      const connInfo = await metaWhatsAppService.testConnection(userId, true);
      businessName = connInfo.businessName || "";
    } catch (_) {
    }
    res.json({
      success: true,
      data: {
        wabaId: finalWabaId,
        phoneNumberId: finalPhoneNumberId,
        businessName,
        registered,
        subscribed,
        coexistenceEnabled: isCoexistence && !coexistenceFallback,
        callbackOverridden,
        coexistenceFallback,
        ...coexistenceFallback ? { fallbackReason: "This number does not support coexistence mode. It has been connected in standard mode instead." } : {}
      }
    });
  } catch (error) {
    console.error("[Messaging] Embedded Signup callback error:", error.message);
    res.status(500).json({ success: false, error: error.message || "Embedded Signup failed" });
  }
});
var user_messaging_routes_default = router;
export {
  user_messaging_routes_default as default
};
