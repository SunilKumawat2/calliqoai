'use strict';
/**
 * ============================================================
 * Calliqo AI - Lead Source Integration Routes
 * ============================================================
 * 
 * Provides:
 * 1. Public Ingestion Webhooks:
 *    - POST /api/v1/integrations/lead-source/:webhookKey (Universal)
 *    - POST /api/v1/integrations/99acres/:webhookKey (99acres)
 *    - POST /api/v1/integrations/magicbricks/:webhookKey (Magicbricks)
 *    - POST /api/v1/integrations/housing/:webhookKey (Housing.com)
 *    - POST /api/v1/integrations/meta/:webhookKey (Meta / FB Ads)
 *    - GET  /api/v1/integrations/meta/:webhookKey (Meta Verification Challenge)
 * 2. Authenticated Management Endpoints:
 *    - GET    /api/lead-sources
 *    - POST   /api/lead-sources
 *    - PATCH  /api/lead-sources/:id
 *    - DELETE /api/lead-sources/:id
 *    - POST   /api/lead-sources/:id/test
 * ============================================================
 */

import { Router, type Request, type Response } from 'express';
import { LeadSourceService } from '../services/lead-sources/lead-source.service';

export const leadSourceRouter = Router();

// ============================================================
// Public Webhooks for Inbound Lead Streams
// ============================================================

/**
 * Universal Inbound Lead Webhook (Website Forms, Zapier, Webflow, CF7, Elementor)
 */
leadSourceRouter.post('/v1/integrations/lead-source/:webhookKey', async (req: Request, res: Response) => {
  try {
    const { webhookKey } = req.params;
    const integration = await LeadSourceService.getIntegrationByWebhookKey(webhookKey);

    if (!integration) {
      return res.status(404).json({ success: false, error: 'Integration webhook key not found' });
    }

    if (integration.status !== 'active') {
      return res.status(403).json({ success: false, error: 'Integration is currently paused' });
    }

    const leadData = LeadSourceService.parseWebsiteForm(req.body);
    const result = await LeadSourceService.ingestLead(integration, leadData);

    return res.json({
      success: true,
      message: 'Lead received and processed successfully',
      leadId: result.leadId,
      autoCallInitiated: result.callInitiated,
      callId: result.callId,
    });
  } catch (err: any) {
    console.error('[LeadSource] Universal webhook error:', err.message);
    return res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * 99acres Dedicated Lead Webhook
 */
leadSourceRouter.post('/v1/integrations/99acres/:webhookKey', async (req: Request, res: Response) => {
  try {
    const { webhookKey } = req.params;
    const integration = await LeadSourceService.getIntegrationByWebhookKey(webhookKey);

    if (!integration) {
      return res.status(404).json({ success: false, error: '99acres integration key not found' });
    }

    const leadData = LeadSourceService.parse99acresLead(req.body);
    const result = await LeadSourceService.ingestLead(integration, leadData, '99acres');

    return res.json({
      success: true,
      service: '99acres Lead Delivery',
      leadId: result.leadId,
      autoCallInitiated: result.callInitiated,
      callId: result.callId,
    });
  } catch (err: any) {
    console.error('[LeadSource] 99acres webhook error:', err.message);
    return res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * Magicbricks Dedicated Lead Webhook
 */
leadSourceRouter.post('/v1/integrations/magicbricks/:webhookKey', async (req: Request, res: Response) => {
  try {
    const { webhookKey } = req.params;
    const integration = await LeadSourceService.getIntegrationByWebhookKey(webhookKey);

    if (!integration) {
      return res.status(404).json({ success: false, error: 'Magicbricks integration key not found' });
    }

    const leadData = LeadSourceService.parseMagicbricksLead(req.body);
    const result = await LeadSourceService.ingestLead(integration, leadData, 'magicbricks');

    return res.json({
      success: true,
      service: 'Magicbricks Lead Delivery',
      leadId: result.leadId,
      autoCallInitiated: result.callInitiated,
      callId: result.callId,
    });
  } catch (err: any) {
    console.error('[LeadSource] Magicbricks webhook error:', err.message);
    return res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * Housing.com Dedicated Lead Webhook
 */
leadSourceRouter.post('/v1/integrations/housing/:webhookKey', async (req: Request, res: Response) => {
  try {
    const { webhookKey } = req.params;
    const integration = await LeadSourceService.getIntegrationByWebhookKey(webhookKey);

    if (!integration) {
      return res.status(404).json({ success: false, error: 'Housing.com integration key not found' });
    }

    const leadData = LeadSourceService.parseHousingLead(req.body);
    const result = await LeadSourceService.ingestLead(integration, leadData, 'housing');

    return res.json({
      success: true,
      service: 'Housing.com Lead Delivery',
      leadId: result.leadId,
      autoCallInitiated: result.callInitiated,
      callId: result.callId,
    });
  } catch (err: any) {
    console.error('[LeadSource] Housing.com webhook error:', err.message);
    return res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * Meta / Facebook Lead Ads Webhook (GET for verification challenge, POST for lead data)
 */
leadSourceRouter.get('/v1/integrations/meta/:webhookKey', async (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && challenge) {
    console.log('[LeadSource] Meta webhook challenge verified');
    return res.status(200).send(challenge);
  }
  return res.status(400).send('Invalid verification request');
});

leadSourceRouter.post('/v1/integrations/meta/:webhookKey', async (req: Request, res: Response) => {
  try {
    const { webhookKey } = req.params;
    const integration = await LeadSourceService.getIntegrationByWebhookKey(webhookKey);

    if (!integration) {
      return res.status(404).json({ success: false, error: 'Meta integration key not found' });
    }

    const leadData = LeadSourceService.parseMetaLead(req.body);
    const result = await LeadSourceService.ingestLead(integration, leadData, 'meta_ads');

    return res.json({
      success: true,
      service: 'Meta Lead Ads',
      leadId: result.leadId,
      autoCallInitiated: result.callInitiated,
      callId: result.callId,
    });
  } catch (err: any) {
    console.error('[LeadSource] Meta webhook error:', err.message);
    return res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * Zoho CRM Dedicated Inbound Lead Webhook (Workflow Rules & Instant Actions)
 */
leadSourceRouter.post('/v1/integrations/zoho/:webhookKey', async (req: Request, res: Response) => {
  try {
    const { webhookKey } = req.params;
    const integration = await LeadSourceService.getIntegrationByWebhookKey(webhookKey);

    if (!integration) {
      return res.status(404).json({ success: false, error: 'Zoho CRM integration webhook key not found' });
    }

    if (integration.status !== 'active') {
      return res.status(403).json({ success: false, error: 'Zoho CRM integration is currently paused' });
    }

    const leadData = LeadSourceService.parseZohoLead(req.body);
    const result = await LeadSourceService.ingestLead(integration, leadData, 'zoho_crm');

    return res.json({
      success: true,
      service: 'Zoho CRM Lead Delivery',
      leadId: result.leadId,
      autoCallInitiated: result.callInitiated,
      callId: result.callId,
      message: 'Zoho CRM lead successfully received and queued',
    });
  } catch (err: any) {
    console.error('[LeadSource] Zoho CRM webhook error:', err.message);
    return res.status(400).json({ success: false, error: err.message });
  }
});

// ============================================================
// Authenticated Management Endpoints (Requires Login)
// ============================================================

/**
 * GET /api/lead-sources
 * List user integrations
 */
leadSourceRouter.get('/lead-sources', async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const sourceType = req.query.sourceType ? String(req.query.sourceType) : undefined;
    const items = await LeadSourceService.listIntegrations(userId, sourceType);
    return res.json(items);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/lead-sources
 * Create new integration
 */
leadSourceRouter.post('/lead-sources', async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { name, sourceType, campaignId, agentId, spreadsheetId, autoCall, autoCallDelaySeconds, customGreeting, portalConfig } = req.body;
    if (!name || !sourceType) {
      return res.status(400).json({ error: 'name and sourceType are required' });
    }

    const created = await LeadSourceService.createIntegration(userId, {
      name,
      sourceType,
      campaignId,
      agentId,
      spreadsheetId,
      autoCall,
      autoCallDelaySeconds,
      customGreeting,
      portalConfig,
    });

    return res.json(created);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/lead-sources/:id
 * Update integration
 */
leadSourceRouter.patch('/lead-sources/:id', async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { id } = req.params;
    const updated = await LeadSourceService.updateIntegration(userId, id, req.body);
    if (!updated) {
      return res.status(404).json({ error: 'Integration not found' });
    }
    return res.json(updated);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/lead-sources/:id
 * Delete integration
 */
leadSourceRouter.delete('/lead-sources/:id', async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { id } = req.params;
    const deleted = await LeadSourceService.deleteIntegration(userId, id);
    return res.json({ success: deleted });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/lead-sources/:id/test
 * Test lead injection simulation
 */
leadSourceRouter.post('/lead-sources/:id/test', async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { id } = req.params;
    const integration = await LeadSourceService.getIntegrationById(userId, id);

    if (!integration) {
      return res.status(404).json({ error: 'Integration not found' });
    }

    const sampleLead = {
      firstName: req.body.firstName || 'Demo Lead',
      lastName: req.body.lastName || 'Test',
      phone: req.body.phone || '+919876543210',
      email: req.body.email || 'lead@example.com',
      project: req.body.project || 'Luxury 3BHK Residence',
      budget: req.body.budget || '₹1.5 - ₹2 Cr',
      city: req.body.city || 'Gurgaon',
      notes: req.body.notes || 'Simulated test lead from CRM Integrations tab',
      rawPayload: req.body,
    };

    const result = await LeadSourceService.ingestLead(integration, sampleLead);

    return res.json({
      success: true,
      message: 'Test lead created successfully in CRM!',
      leadId: result.leadId,
      autoCallInitiated: result.callInitiated,
      callId: result.callId,
    });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});
