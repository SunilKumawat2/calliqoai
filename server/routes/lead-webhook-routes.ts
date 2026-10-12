'use strict';
/**
 * ============================================================
 * Calliqo AI - Multi-Tenant Lead-to-Call Webhook Engine
 * ============================================================
 * 
 * Allows any client/company to paste their dedicated webhook URL
 * into WordPress (Elementor, CF7, WPForms), Webflow, Wix, Facebook
 * Lead Ads, or any HTML form.
 * 
 * When a visitor submits their name & phone number on the form:
 * 1. Webhook parses and normalizes the lead data.
 * 2. Authenticates and verifies the tenant/agent.
 * 3. Saves lead in Calliqo CRM.
 * 4. Checks tenant's call credit balance.
 * 5. Automatically initiates an instant AI call (Speed-to-Lead)
 *    within seconds using the company's designated AI agent!
 */

import { Router, Request, Response } from 'express';
import { RouteContext } from './common';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '../db';
import { agents, users, plivoPhoneNumbers, phoneNumbers, leads } from '@shared/schema';
import { ElevenLabsPoolService } from '../services/elevenlabs-pool';
import { OpenAIAgentFactory } from '../engines/plivo/services/openai-agent-factory';

export function createLeadWebhookRoutes(ctx: RouteContext): Router {
  const router = Router();
  const { storage } = ctx;

  /**
   * Helper: Normalize Phone Number
   */
  function normalizePhoneNumber(rawPhone: string): string {
    if (!rawPhone) return '';
    // Strip everything except digits and leading +
    let cleaned = rawPhone.trim().replace(/[^\d+]/g, '');
    
    // Indian 10-digit mobile number starting with 6-9
    if (/^[6-9]\d{9}$/.test(cleaned)) {
      return `+91${cleaned}`;
    }
    // Indian 11-digit mobile starting with 0
    if (/^0[6-9]\d{9}$/.test(cleaned)) {
      return `+91${cleaned.substring(1)}`;
    }
    // If 12 digits starting with 91 but missing +
    if (/^91[6-9]\d{9}$/.test(cleaned)) {
      return `+${cleaned}`;
    }
    // Ensure leading + if international
    if (!cleaned.startsWith('+') && cleaned.length >= 10) {
      return `+${cleaned}`;
    }
    return cleaned;
  }

  /**
   * Helper: Extract Lead Fields from any request body
   */
  function extractLeadFields(body: any): { name: string; phone: string; email: string; notes: string } {
    if (!body || typeof body !== 'object') {
      return { name: '', phone: '', email: '', notes: '' };
    }

    // Common phone field aliases
    const rawPhone =
      body.phone ||
      body.phoneNumber ||
      body.phone_number ||
      body.mobile ||
      body.mobile_number ||
      body.contact ||
      body.contact_number ||
      body.tel ||
      body.telephone ||
      body.whatsapp ||
      body.Phone ||
      body.Mobile ||
      '';

    // Common name field aliases
    const rawName =
      body.name ||
      body.fullName ||
      body.full_name ||
      body.firstName ||
      body.first_name ||
      body.customer_name ||
      body.lead_name ||
      body.client_name ||
      body.Name ||
      '';

    // Common email field aliases
    const rawEmail =
      body.email ||
      body.emailAddress ||
      body.email_address ||
      body.mail ||
      body.Email ||
      '';

    // Common notes/message field aliases
    const rawNotes =
      body.message ||
      body.notes ||
      body.note ||
      body.comments ||
      body.requirement ||
      body.inquiry ||
      body.Message ||
      '';

    return {
      name: String(rawName).trim(),
      phone: String(rawPhone).trim(),
      email: String(rawEmail).trim(),
      notes: String(rawNotes).trim(),
    };
  }

  /**
   * GET /api/v1/lead-webhook/:agentId
   * Documentation & Verification endpoint for testing in browser / curl
   */
  router.get('/api/v1/lead-webhook/:agentId', async (req: Request, res: Response) => {
    try {
      const { agentId } = req.params;
      const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);

      if (!agent) {
        return res.status(404).json({
          success: false,
          error: 'Agent not found with this ID',
        });
      }

      return res.json({
        success: true,
        service: 'Calliqo AI Speed-to-Lead Webhook',
        status: 'ready',
        agent: {
          id: agent.id,
          name: agent.name,
          telephonyProvider: agent.telephonyProvider,
        },
        usage: {
          description: 'Submit your website form data via HTTP POST to this URL to trigger an instant AI call.',
          method: 'POST',
          url: `https://calliqoai.com/api/v1/lead-webhook/${agent.id}`,
          supportedFormats: ['application/json', 'application/x-www-form-urlencoded', 'multipart/form-data'],
          requiredFields: {
            phone: 'Customer phone number (e.g. "+919876543210" or "9876543210")',
          },
          optionalFields: {
            name: 'Customer name (e.g. "Rahul")',
            email: 'Customer email address',
            message: 'Inquiry note or requirement',
          },
          samplePayload: {
            name: 'John Doe',
            phone: '+919876543210',
            email: 'john@example.com',
            message: 'Interested in 3 BHK villa',
          },
        },
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * POST /api/v1/lead-webhook/:agentId
   * The core Inbound Webhook endpoint
   */
  router.post('/api/v1/lead-webhook/:agentId', async (req: Request, res: Response) => {
    try {
      const { agentId } = req.params;
      const { token, apiKey } = req.query;

      // 1. Resolve Agent
      const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
      if (!agent) {
        return res.status(404).json({
          success: false,
          error: `AI Agent '${agentId}' not found. Please verify the Webhook URL.`,
        });
      }

      // 2. Resolve Tenant / User
      const [user] = await db.select().from(users).where(eq(users.id, agent.userId)).limit(1);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User account associated with this agent was not found.',
        });
      }

      // Optional security token check if provided
      if (token || apiKey) {
        const providedToken = String(token || apiKey);
        if (providedToken !== user.id && providedToken !== agent.id && providedToken !== agent.id.substring(0, 8)) {
          return res.status(401).json({
            success: false,
            error: 'Invalid authorization token.',
          });
        }
      }

      // 3. Extract Lead Information
      const { name, phone: rawPhone, email, notes } = extractLeadFields(req.body);
      if (!rawPhone) {
        return res.status(400).json({
          success: false,
          error: 'Phone number is required. Please include "phone" or "mobile" in your form submission.',
          receivedBody: req.body,
        });
      }

      const formattedToNumber = normalizePhoneNumber(rawPhone);
      if (formattedToNumber.length < 10) {
        return res.status(400).json({
          success: false,
          error: `Invalid phone number format: '${rawPhone}'. Must be at least 10 digits.`,
        });
      }

      // 4. Credit Verification
      if (user.credits < 1) {
        console.warn(`[LeadWebhook] User ${user.email} has insufficient credits (${user.credits}) for incoming lead`);
        return res.status(402).json({
          success: false,
          error: 'Insufficient call credits on Calliqo AI account. Please recharge to enable instant calling.',
        });
      }

      // 5. Save Lead in CRM
      try {
        await db.insert(leads).values({
          userId: user.id,
          sourceType: 'campaign', // Compatible with CRM filters
          firstName: name || 'Website Visitor',
          phone: formattedToNumber,
          email: email || null,
          stage: 'new',
          customFields: {
            source: 'website_lead_form',
            agentId: agent.id,
            agentName: agent.name,
            notes: notes || null,
            rawSubmission: req.body,
          },
        });
        console.log(`[LeadWebhook] Saved lead for ${user.email}: ${name} (${formattedToNumber})`);
      } catch (crmErr: any) {
        console.warn(`[LeadWebhook] Non-critical: Failed to save lead to CRM table:`, crmErr.message);
      }

      // 6. Determine Engine and Telephony Provider
      const isElevenLabs = Boolean(
        agent.elevenLabsAgentId ||
        (agent.metadata as any)?.elevenLabsAgentId ||
        agent.telephonyProvider === 'plivo_elevenlabs' ||
        agent.telephonyProvider === 'elevenlabs' ||
        (agent as any).voiceEngine === 'elevenlabs'
      );

      // Resolve Outbound Phone Number (Plivo or Twilio)
      let plivoPhoneResult = await db
        .select()
        .from(plivoPhoneNumbers)
        .where(and(eq(plivoPhoneNumbers.userId, user.id), eq(plivoPhoneNumbers.status, 'active')))
        .orderBy(desc(plivoPhoneNumbers.createdAt))
        .limit(1);

      if (plivoPhoneResult.length === 0) {
        plivoPhoneResult = await db
          .select()
          .from(plivoPhoneNumbers)
          .where(eq(plivoPhoneNumbers.status, 'active'))
          .orderBy(desc(plivoPhoneNumbers.createdAt))
          .limit(1);
      }

      const plivoPhone = plivoPhoneResult[0];

      // Personalized greeting for instant lead response
      const isHindi = (agent.language === 'hi') || 
                      /[\u0900-\u097F]/.test(agent.systemPrompt || '') || 
                      /namaste|kripya|baad|baje|karein|boliye|humne|baat/i.test(agent.systemPrompt || '');

      let firstMessage = agent.firstMessage || '';
      if (name) {
        if (isHindi) {
          firstMessage = `नमस्ते ${name} जी, मैं ${agent.name} बात कर रहा हूँ। आपने अभी हमारी वेबसाइट पर इन्क्वायरी की थी। क्या मैं आपके सवाल में सहायता कर सकता हूँ?`;
        } else {
          firstMessage = `Hello ${name}, I am ${agent.name}. You recently requested information on our website. How can I assist you today?`;
        }
      }

      let callResult: any = null;

      // 7. Dispatch Call: Plivo + ElevenLabs
      if (isElevenLabs) {
        if (!plivoPhone) {
          return res.status(400).json({
            success: false,
            error: 'No active Plivo phone number configured on account to place the call.',
          });
        }

        const { PlivoElevenLabsOutboundService } = await import('../engines/plivo-elevenlabs/services/outbound-call.service');
        const credential = await ElevenLabsPoolService.getCredentialForAgent(agent.id);
        const elevenLabsApiKey = credential?.apiKey || process.env.ELEVENLABS_API_KEY || 'sk_5a88ed1456bd2e0890567f3a55e80a5885949a5b988ef3b8';

        callResult = await PlivoElevenLabsOutboundService.makeCall({
          toNumber: formattedToNumber,
          fromNumber: plivoPhone.phoneNumber,
          agentId: agent.elevenLabsAgentId || 'agent_2201m20fdvdket7rdh5pttn091b8',
          elevenLabsApiKey,
          agentConfig: {
            firstMessage,
            systemPrompt: agent.systemPrompt || '',
            language: agent.language || 'en',
          },
          metadata: {
            source: 'website_lead_form',
            isLeadCall: true,
            leadName: name,
            leadEmail: email,
            agentId: agent.id,
            userId: user.id,
          },
        });

        console.log(`[LeadWebhook] Plivo+ElevenLabs call initiated for lead ${formattedToNumber}, callUuid: ${callResult?.callUuid || callResult?.callId}`);

        return res.json({
          success: true,
          message: 'Lead received and AI call initiated successfully via Plivo + ElevenLabs!',
          lead: {
            name: name || 'Website Visitor',
            phone: formattedToNumber,
            email: email || undefined,
          },
          agent: {
            id: agent.id,
            name: agent.name,
            provider: 'plivo_elevenlabs',
          },
          callId: callResult?.callId || callResult?.callUuid,
        });
      }

      // 8. Dispatch Call: Plivo + OpenAI Realtime (Default)
      if (plivoPhone) {
        const { PlivoCallService } = await import('../engines/plivo/services/plivo-call.service');

        const validatedVoice = OpenAIAgentFactory.validateVoice(agent.openaiVoice || 'sage');
        const validatedModel = OpenAIAgentFactory.validateModel(
          (agent.config as any)?.openaiModel || agent.openaiModel || 'gpt-realtime-1.5',
          'pro'
        );

        const { callUuid, plivoCall } = await PlivoCallService.initiateCall({
          fromNumber: plivoPhone.phoneNumber,
          toNumber: formattedToNumber,
          userId: user.id,
          agentId: agent.id,
          plivoPhoneNumberId: plivoPhone.id,
          agentConfig: {
            voice: validatedVoice,
            model: validatedModel,
            systemPrompt: agent.systemPrompt || '',
            firstMessage,
            tools: [],
          },
        });

        console.log(`[LeadWebhook] Plivo+OpenAI call initiated for lead ${formattedToNumber}, uuid: ${callUuid}`);

        return res.json({
          success: true,
          message: 'Lead received and AI call initiated successfully via Plivo + OpenAI!',
          lead: {
            name: name || 'Website Visitor',
            phone: formattedToNumber,
            email: email || undefined,
          },
          agent: {
            id: agent.id,
            name: agent.name,
            provider: 'plivo_openai',
          },
          callId: plivoCall?.id,
          uuid: callUuid,
        });
      }

      // 9. Dispatch Call: Twilio (Fallback if no Plivo numbers)
      const twilioPhoneResult = await db
        .select()
        .from(phoneNumbers)
        .where(and(eq(phoneNumbers.userId, user.id), eq(phoneNumbers.status, 'active')))
        .limit(1);

      const twilioPhone = twilioPhoneResult[0];
      if (twilioPhone) {
        const { TwilioOpenAICallService } = await import('../engines/twilio-openai/services/twilio-openai-call.service');
        const result = await TwilioOpenAICallService.initiateCall({
          userId: user.id,
          agentId: agent.id,
          toNumber: formattedToNumber,
          fromNumber: twilioPhone.phoneNumber,
        });

        return res.json({
          success: true,
          message: 'Lead received and AI call initiated successfully via Twilio!',
          lead: {
            name: name || 'Website Visitor',
            phone: formattedToNumber,
          },
          agent: {
            id: agent.id,
            name: agent.name,
            provider: 'twilio_openai',
          },
          callId: (result as any)?.callId,
        });
      }

      return res.status(400).json({
        success: false,
        error: 'No active phone number (Plivo or Twilio) configured on your account to make outbound calls.',
      });

    } catch (error: any) {
      console.error('[LeadWebhook] Error processing lead webhook:', error);
      return res.status(500).json({
        success: false,
        error: error.message || 'Internal server error while initiating call',
      });
    }
  });

  return router;
}
