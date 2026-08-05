import { Router } from "express";
import userMessagingRoutes from "./routes/user-messaging.routes.js";
import adminMessagingRoutes from "./routes/admin-messaging.routes.js";
import webhookMessagingRoutes from "./routes/webhook-messaging.routes.js";
import metaWebhookRoutes from "./routes/meta-webhook.routes.js";
import { EmailTemplateService, emailTemplateService } from "./services/email-template.service.js";
import { WhatswayService, whatswayService } from "./services/whatsway.service.js";
import { MetaWhatsAppService, metaWhatsAppService } from "./services/meta-whatsapp.service.js";
import { MessagingLogService, messagingLogService } from "./services/messaging-log.service.js";
import { WhatsAppConversationService, whatsAppConversationService } from "./services/whatsapp-conversation.service.js";
import { MetaWhatsAppAdminService, metaWhatsAppAdminService } from "./services/meta-whatsapp-admin.service.js";
export * from "./types.js";
const PLUGIN_VERSION = "1.0.3";
const PLUGIN_NAME = "messaging";
function createUserMessagingRouter() {
  const router = Router();
  router.use("/", userMessagingRoutes);
  return router;
}
function createAdminMessagingRouter() {
  const router = Router();
  router.use("/", adminMessagingRoutes);
  return router;
}
function createWebhookMessagingRouter() {
  const router = Router();
  router.use("/", webhookMessagingRoutes);
  router.use("/meta", metaWebhookRoutes);
  return router;
}
function registerMessagingRoutes(app, options) {
  const { sessionAuthMiddleware, adminAuthMiddleware } = options;
  app.use("/api/messaging", sessionAuthMiddleware, createUserMessagingRouter());
  app.use("/api/admin/messaging", adminAuthMiddleware, createAdminMessagingRouter());
  app.use("/api/webhooks/messaging", createWebhookMessagingRouter());
  console.log("[Messaging] Plugin registered (v1.0.3)");
  console.log("[Messaging] Endpoints:");
  console.log("  - /api/messaging/email-templates (user auth)");
  console.log("  - /api/messaging/whatsway/* (user auth)");
  console.log("  - /api/messaging/meta-whatsapp/* (user auth)");
  console.log("  - /api/messaging/conversations (user auth)");
  console.log("  - /api/messaging/logs (user auth)");
  console.log("  - /api/admin/messaging/* (admin auth)");
  console.log("  - /api/admin/messaging/whatsapp-config (admin auth)");
  console.log("  - /api/webhooks/messaging/send-email (webhook)");
  console.log("  - /api/webhooks/messaging/send-whatsapp (webhook)");
  console.log("  - /api/webhooks/messaging/meta/webhook (Meta webhook)");
  console.log("[Messaging] Plugin initialized");
}
var index_default = {
  name: PLUGIN_NAME,
  version: PLUGIN_VERSION,
  register: registerMessagingRoutes
};
export {
  EmailTemplateService,
  MessagingLogService,
  MetaWhatsAppAdminService,
  MetaWhatsAppService,
  PLUGIN_NAME,
  PLUGIN_VERSION,
  WhatsAppConversationService,
  WhatswayService,
  createAdminMessagingRouter,
  createUserMessagingRouter,
  createWebhookMessagingRouter,
  index_default as default,
  emailTemplateService,
  messagingLogService,
  metaWhatsAppAdminService,
  metaWhatsAppService,
  registerMessagingRoutes,
  whatsAppConversationService,
  whatswayService
};
