import { Router, Request, Response } from 'express';
import { messagingLogService } from '../services/messaging-log.service';
import { metaWhatsAppAdminService } from '../services/meta-whatsapp-admin.service';
import { db } from '../../../server/db';
import { sql } from 'drizzle-orm';

const router = Router();

router.get('/logs', async (req: Request, res: Response) => {
  try {
    const { channel, status, limit, offset } = req.query;
    const result = await messagingLogService.getAdminLogs({
      channel: channel as any,
      status: status as any,
      limit: limit ? parseInt(limit as string, 10) : undefined,
      offset: offset ? parseInt(offset as string, 10) : undefined,
    });
    res.json({ success: true, data: result });
  } catch (error: any) {
    console.error('[Messaging Admin] Error fetching logs:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch messaging logs' });
  }
});

router.get('/stats', async (req: Request, res: Response) => {
  try {
    const stats = await messagingLogService.getStats();
    res.json({ success: true, data: stats });
  } catch (error: any) {
    console.error('[Messaging Admin] Error fetching stats:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch messaging stats' });
  }
});

router.get('/whatsapp-config', async (req: Request, res: Response) => {
  try {
    const config = await metaWhatsAppAdminService.getConfig();
    if (!config) {
      return res.json({ success: true, data: null });
    }
    const masked = {
      ...config,
      metaAppSecret: config.metaAppSecret
        ? config.metaAppSecret.substring(0, 8) + '...'
        : '',
    };
    res.json({ success: true, data: masked });
  } catch (error: any) {
    console.error('[Messaging Admin] Error fetching WhatsApp config:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch WhatsApp config' });
  }
});

router.patch('/whatsapp-config', async (req: Request, res: Response) => {
  try {
    const { provider_mode, meta_app_id, meta_app_secret, meta_config_id, embedded_signup_enabled, coexistence_enabled } = req.body;
    const updateData: Record<string, any> = {};

    if (provider_mode !== undefined) updateData.whatsappProviderMode = provider_mode;
    if (meta_app_id !== undefined) updateData.metaAppId = meta_app_id;
    if (meta_config_id !== undefined) updateData.metaConfigId = meta_config_id;
    if (embedded_signup_enabled !== undefined) updateData.embeddedSignupEnabled = embedded_signup_enabled;
    if (coexistence_enabled !== undefined) updateData.coexistenceEnabled = coexistence_enabled;

    if (meta_app_secret !== undefined && !meta_app_secret.endsWith('...')) {
      updateData.metaAppSecret = meta_app_secret;
    }

    const config = await metaWhatsAppAdminService.saveConfig(updateData);
    const masked = {
      ...config,
      metaAppSecret: config.metaAppSecret
        ? config.metaAppSecret.substring(0, 8) + '...'
        : '',
    };
    res.json({ success: true, data: masked });
  } catch (error: any) {
    console.error('[Messaging Admin] Error updating WhatsApp config:', error.message);
    res.status(500).json({ success: false, error: 'Failed to update WhatsApp config' });
  }
});

router.post('/whatsapp-config/generate-verify-token', async (req: Request, res: Response) => {
  try {
    const token = await metaWhatsAppAdminService.generateWebhookVerifyToken();
    res.json({ success: true, data: { verifyToken: token } });
  } catch (error: any) {
    console.error('[Messaging Admin] Error generating verify token:', error.message);
    res.status(500).json({ success: false, error: 'Failed to generate verify token' });
  }
});

router.post('/whatsapp-config/test-connection', async (req: Request, res: Response) => {
  try {
    const config = await metaWhatsAppAdminService.getConfig();

    if (!config || !config.metaAppId || !config.metaAppSecret) {
      return res.json({
        success: true,
        data: {
          status: 'failed',
          error: 'Meta App ID and App Secret are not configured. Please save your Meta configuration first.',
        },
      });
    }

    const META_API_VERSION = process.env.META_WHATSAPP_API_VERSION || 'v22.0';
    const appToken = `${config.metaAppId}|${config.metaAppSecret}`;
    const url = `https://graph.facebook.com/${META_API_VERSION}/${config.metaAppId}?fields=name`;

    const metaRes = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${appToken}` },
    });

    if (!metaRes.ok) {
      const errText = await metaRes.text().catch(() => 'Unknown error');
      let errorMsg = `Meta API returned ${metaRes.status}`;
      try {
        const errJson = JSON.parse(errText);
        if (errJson?.error?.message) errorMsg = errJson.error.message;
      } catch {}
      return res.json({
        success: true,
        data: {
          status: 'failed',
          error: errorMsg,
        },
      });
    }

    const metaData = await metaRes.json();
    res.json({
      success: true,
      data: {
        status: 'connected',
        appName: metaData.name || config.metaAppId,
      },
    });
  } catch (error: any) {
    console.error('[Messaging Admin] Test connection error:', error.message);
    res.json({
      success: true,
      data: { status: 'failed', error: error.message || 'Connection test failed' },
    });
  }
});

router.get('/whatsapp-config/webhook-url', async (req: Request, res: Response) => {
  try {
    const host = req.get('host') || 'localhost';
    const isLocalhost = host.startsWith('localhost') || host.startsWith('127.0.0.1');
    const protocol = isLocalhost ? 'http' : (req.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'https');
    const webhookUrl = `${protocol}://${host}/api/webhooks/messaging/meta/webhook`;
    res.json({ success: true, data: { webhookUrl } });
  } catch (error: any) {
    console.error('[Messaging Admin] Error getting webhook URL:', error.message);
    res.status(500).json({ success: false, error: 'Failed to get webhook URL' });
  }
});

export default router;
