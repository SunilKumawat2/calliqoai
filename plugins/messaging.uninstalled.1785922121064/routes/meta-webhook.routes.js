import { Router } from "express";
import crypto from "crypto";
import { whatsAppConversationService } from "../services/whatsapp-conversation.service.js";
import { metaWhatsAppAdminService } from "../services/meta-whatsapp-admin.service.js";
import { metaWhatsAppService } from "../services/meta-whatsapp.service.js";
const router = Router();
function getConversationService() {
  return whatsAppConversationService;
}
function getAdminService() {
  return metaWhatsAppAdminService;
}
function getMetaService() {
  return metaWhatsAppService;
}
function verifySignature(rawBody, signatureHeader, appSecret) {
  if (!signatureHeader || !appSecret) return false;
  try {
    const expectedSignature = "sha256=" + crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
    return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expectedSignature));
  } catch {
    return false;
  }
}
function extractMessageContent(message) {
  const type = message.type || "unknown";
  let content = "";
  let messageType = type;
  let mediaUrl = null;
  let mediaMimeType = null;
  let metadata = {};
  switch (type) {
    case "text":
      content = message.text?.body || "";
      break;
    case "image":
      content = message.image?.caption || "[Image]";
      mediaUrl = message.image?.id || null;
      mediaMimeType = message.image?.mime_type || "image/jpeg";
      metadata = { mediaId: message.image?.id, sha256: message.image?.sha256 };
      break;
    case "video":
      content = message.video?.caption || "[Video]";
      mediaUrl = message.video?.id || null;
      mediaMimeType = message.video?.mime_type || "video/mp4";
      metadata = { mediaId: message.video?.id };
      break;
    case "audio":
      content = "[Audio]";
      mediaUrl = message.audio?.id || null;
      mediaMimeType = message.audio?.mime_type || "audio/ogg";
      metadata = { mediaId: message.audio?.id };
      break;
    case "document":
      content = message.document?.filename || "[Document]";
      mediaUrl = message.document?.id || null;
      mediaMimeType = message.document?.mime_type || "application/octet-stream";
      metadata = { mediaId: message.document?.id, filename: message.document?.filename };
      break;
    case "sticker":
      content = "[Sticker]";
      mediaUrl = message.sticker?.id || null;
      mediaMimeType = message.sticker?.mime_type || "image/webp";
      metadata = { mediaId: message.sticker?.id };
      break;
    case "reaction":
      content = message.reaction?.emoji || "";
      messageType = "reaction";
      metadata = { reactedMessageId: message.reaction?.message_id };
      break;
    case "button":
      content = message.button?.text || "";
      messageType = "button";
      metadata = { payload: message.button?.payload };
      break;
    case "interactive":
      if (message.interactive?.type === "button_reply") {
        content = message.interactive.button_reply?.title || "";
        metadata = { buttonId: message.interactive.button_reply?.id };
      } else if (message.interactive?.type === "list_reply") {
        content = message.interactive.list_reply?.title || "";
        metadata = { listId: message.interactive.list_reply?.id, description: message.interactive.list_reply?.description };
      } else {
        content = "[Interactive]";
      }
      break;
    case "location":
      content = `[Location: ${message.location?.latitude}, ${message.location?.longitude}]`;
      metadata = { latitude: message.location?.latitude, longitude: message.location?.longitude, name: message.location?.name, address: message.location?.address };
      break;
    case "contacts":
      const firstContact = message.contacts?.[0];
      content = firstContact?.name?.formatted_name || "[Contact]";
      metadata = { contacts: message.contacts };
      messageType = "contacts";
      break;
    default:
      content = `[${type}]`;
      messageType = "unknown";
  }
  return { content, messageType, mediaUrl, mediaMimeType, metadata };
}
router.get("/webhook", async (req, res) => {
  try {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    console.log(`[Meta Webhook] Verification request: mode=${mode}, token=${token ? token.substring(0, 8) + "..." : "(empty)"}, challenge=${challenge ? "present" : "missing"}`);
    if (mode !== "subscribe") {
      console.log("[Meta Webhook] Verification failed: mode is not subscribe");
      return res.status(403).send("Forbidden");
    }
    const admin = getAdminService();
    const config = await admin.getConfig();
    const storedToken = config?.webhookVerifyToken || "";
    console.log(`[Meta Webhook] Stored token: ${storedToken ? storedToken.substring(0, 8) + "..." : "(empty)"}, Received token: ${token ? token.substring(0, 8) + "..." : "(empty)"}`);
    if (!storedToken || token !== storedToken) {
      console.log("[Meta Webhook] Verification failed: token mismatch");
      return res.status(403).send("Forbidden");
    }
    console.log("[Meta Webhook] Verification successful \u2014 returning challenge");
    return res.status(200).send(challenge);
  } catch (error) {
    console.error("[Meta Webhook] Verification error:", error.message);
    return res.status(403).send("Forbidden");
  }
});
router.post("/webhook", async (req, res) => {
  try {
    const signatureHeader = req.headers["x-hub-signature-256"];
    const admin = getAdminService();
    const config = await admin.getConfig();
    const appSecret = config?.metaAppSecret || "";
    if (appSecret) {
      if (!signatureHeader) {
        console.warn("[Meta Webhook] Missing X-Hub-Signature-256 header \u2014 rejecting");
        return res.status(401).send("Unauthorized");
      }
      const rawBody = req.rawBody;
      if (!rawBody) {
        console.warn("[Meta Webhook] rawBody not captured \u2014 rejecting (ensure raw body middleware is active)");
        return res.status(500).send("Server configuration error");
      }
      if (!verifySignature(Buffer.from(rawBody), signatureHeader, appSecret)) {
        console.warn("[Meta Webhook] Invalid HMAC signature \u2014 rejecting");
        return res.status(403).send("Forbidden");
      }
    }
    const body = req.body;
    if (body?.object !== "whatsapp_business_account") {
      return res.status(200).send("OK");
    }
    const entries = body.entry || [];
    for (const entry of entries) {
      const changes = entry.changes || [];
      for (const change of changes) {
        const value = change.value;
        if (!value) continue;
        if (value.messages && Array.isArray(value.messages)) {
          await processInboundMessages(value);
        }
        if (value.statuses && Array.isArray(value.statuses)) {
          await processStatusUpdates(value.statuses);
        }
      }
    }
  } catch (error) {
    console.error("[Meta Webhook] Error processing webhook:", error.message);
  }
  return res.status(200).send("OK");
});
async function processInboundMessages(value) {
  const phoneNumberId = value.metadata?.phone_number_id;
  if (!phoneNumberId) {
    console.warn("[Meta Webhook] No phone_number_id in metadata");
    return;
  }
  const convService = getConversationService();
  const meta = getMetaService();
  let userId = await convService.findUserByPhoneNumberId(phoneNumberId);
  if (!userId) {
    const wabaId = value.metadata?.waba_id;
    if (wabaId) {
      const wabaMatch = await convService.findUserByWabaId(wabaId);
      if (wabaMatch) {
        console.log(`[Meta Webhook] phone_number_id mismatch detected. Auto-healing via WABA lookup`);
        await convService.updatePhoneNumberId(wabaMatch.userId, phoneNumberId);
        userId = wabaMatch.userId;
      }
    }
    if (!userId) {
      console.warn(`[Meta Webhook] No user found for incoming phone_number_id`);
      return;
    }
  }
  const contactName = value.contacts?.[0]?.profile?.name || "";
  const contactWaId = value.contacts?.[0]?.wa_id || "";
  for (const message of value.messages) {
    try {
      const isDuplicate = await convService.isDuplicateMessage(message.id);
      if (isDuplicate) {
        console.log(`[Meta Webhook] Skipping duplicate message: ${message.id}`);
        continue;
      }
      const conversation = await convService.getOrCreateConversation(
        userId,
        message.from,
        contactName,
        contactWaId
      );
      await convService.refreshWindow(conversation.id);
      const { content, messageType, mediaUrl, mediaMimeType, metadata } = extractMessageContent(message);
      await convService.addMessage({
        conversationId: conversation.id,
        userId,
        direction: "inbound",
        senderType: "customer",
        messageType,
        content,
        metaMessageId: message.id,
        mediaUrl,
        mediaMimeType,
        metadata
      });
      meta.markMessageRead(userId, message.id).catch(() => {
      });
      console.log(`[Meta Webhook] Inbound message from ${message.from} stored (${message.id})`);
    } catch (error) {
      console.error(`[Meta Webhook] Error processing message ${message.id}:`, error.message);
    }
  }
}
async function processStatusUpdates(statuses) {
  const convService = getConversationService();
  for (const status of statuses) {
    try {
      const errorMessage = status.errors?.[0]?.message || null;
      await convService.updateMessageStatus(status.id, status.status, errorMessage);
    } catch (error) {
      console.error(`[Meta Webhook] Error processing status update for ${status.id}:`, error.message);
    }
  }
}
var meta_webhook_routes_default = router;
export {
  meta_webhook_routes_default as default
};
