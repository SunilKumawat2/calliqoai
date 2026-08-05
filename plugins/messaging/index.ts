import { Router, type Express, type RequestHandler } from 'express';
import type { Server as HttpServer } from 'http';

import userMessagingRoutes from './routes/user-messaging.routes';
import adminMessagingRoutes from './routes/admin-messaging.routes';
import webhookMessagingRoutes from './routes/webhook-messaging.routes';
import metaWebhookRoutes from './routes/meta-webhook.routes';

export { EmailTemplateService, emailTemplateService } from './services/email-template.service';
export { WhatswayService, whatswayService } from './services/whatsway.service';
export { MetaWhatsAppService, metaWhatsAppService } from './services/meta-whatsapp.service';
export { MessagingLogService, messagingLogService } from './services/messaging-log.service';
export { WhatsAppConversationService, whatsAppConversationService } from './services/whatsapp-conversation.service';
export { MetaWhatsAppAdminService, metaWhatsAppAdminService } from './services/meta-whatsapp-admin.service';

export * from './types';

export const PLUGIN_VERSION = '1.0.3';
export const PLUGIN_NAME = 'messaging';

export function createUserMessagingRouter(): Router {
  const router = Router();
  router.use('/', userMessagingRoutes);
  return router;
}

export function createAdminMessagingRouter(): Router {
  const router = Router();
  router.use('/', adminMessagingRoutes);
  return router;
}

export function createWebhookMessagingRouter(): Router {
  const router = Router();
  router.use('/', webhookMessagingRoutes);
  router.use('/meta', metaWebhookRoutes);
  return router;
}

interface PluginLoaderOptions {
  sessionAuthMiddleware: RequestHandler;
  adminAuthMiddleware: RequestHandler;
  httpServer?: HttpServer;
}

export function registerMessagingRoutes(
  app: Express,
  options: PluginLoaderOptions
): void {
  const { sessionAuthMiddleware, adminAuthMiddleware } = options;

  app.use('/api/messaging', sessionAuthMiddleware, createUserMessagingRouter());

  app.use('/api/admin/messaging', adminAuthMiddleware, createAdminMessagingRouter());

  app.use('/api/webhooks/messaging', createWebhookMessagingRouter());

  console.log('[Messaging] Plugin registered (v1.0.3)');
  console.log('[Messaging] Endpoints:');
  console.log('  - /api/messaging/email-templates (user auth)');
  console.log('  - /api/messaging/whatsway/* (user auth)');
  console.log('  - /api/messaging/meta-whatsapp/* (user auth)');
  console.log('  - /api/messaging/conversations (user auth)');
  console.log('  - /api/messaging/logs (user auth)');
  console.log('  - /api/admin/messaging/* (admin auth)');
  console.log('  - /api/admin/messaging/whatsapp-config (admin auth)');
  console.log('  - /api/webhooks/messaging/send-email (webhook)');
  console.log('  - /api/webhooks/messaging/send-whatsapp (webhook)');
  console.log('  - /api/webhooks/messaging/meta/webhook (Meta webhook)');
  console.log('[Messaging] Plugin initialized');
}

export default {
  name: PLUGIN_NAME,
  version: PLUGIN_VERSION,
  register: registerMessagingRoutes,
};
