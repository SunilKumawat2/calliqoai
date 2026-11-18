/**
 * ============================================================
 * Calliqo AI - Public Meta Social Webhook Route (Instagram + Facebook)
 *
 *   GET  /api/webhooks/meta-social  → Meta verification challenge (hub.challenge)
 *   POST /api/webhooks/meta-social  → Live Instagram/Facebook DM & Comment events
 *
 * Isolated new route — existing WhatsApp (/api/webhooks/messaging/...) and
 * Meta Lead Ads (/api/v1/integrations/meta/...) webhooks are untouched.
 * ============================================================
 */

import { Router, type Request, type Response } from 'express';
import { SocialMetaWebhookService } from '../services/social-meta-webhook.service';

export const metaSocialWebhookRouter = Router();

metaSocialWebhookRouter.get('/', async (req: Request, res: Response) => {
  const mode = String(req.query['hub.mode'] || '');
  const token = String(req.query['hub.verify_token'] || '');
  const challenge = String(req.query['hub.challenge'] || '');

  if (mode === 'subscribe' && challenge && (await SocialMetaWebhookService.isValidVerifyToken(token))) {
    console.log('[SocialMetaWebhook] Meta webhook verification successful');
    return res.status(200).type('text/plain').send(challenge);
  }
  console.warn('[SocialMetaWebhook] Meta webhook verification failed (wrong verify token)');
  return res.sendStatus(403);
});

metaSocialWebhookRouter.post('/', (req: Request, res: Response) => {
  // Meta requires a fast 200 response; process asynchronously
  res.sendStatus(200);

  const rawBody = Buffer.isBuffer((req as any).rawBody) ? ((req as any).rawBody as Buffer) : undefined;
  const signature = req.headers['x-hub-signature-256'] as string | undefined;

  SocialMetaWebhookService.handleWebhook(req.body, rawBody, signature).catch((err: any) => {
    console.error('[SocialMetaWebhook] Unhandled webhook error:', err?.message);
  });
});
