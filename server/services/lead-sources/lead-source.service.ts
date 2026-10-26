'use strict';
/**
 * ============================================================
 * Calliqo AI - Lead Source Integration Service
 * ============================================================
 * 
 * Handles multi-source lead ingestion and auto-call automation:
 * 1. Website Enquiry Forms (Elementor, CF7, WPForms, Webflow, custom)
 * 2. Meta Ads (Facebook & Instagram Lead Ads)
 * 3. Google Ads Lead Forms
 * 4. Real Estate Portals (99acres, Magicbricks, Housing.com)
 * 
 * Automatically normalizes data, inserts into CRM, and triggers
 * instant speed-to-lead AI outbound calls via the assigned campaign.
 */

import { db } from '../../db';
import { 
  leadSourceIntegrations, 
  leads, 
  campaigns, 
  agents, 
  users, 
  plivoPhoneNumbers,
  plivoCredentials,
  crmSyncLogs,
  contacts,
  type LeadSourceIntegration,
  type InsertLeadSourceIntegration
} from '@shared/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import crypto from 'crypto';
import { ElevenLabsPoolService } from '../elevenlabs-pool';
import { CrmSyncService } from '../crm-sync/crm-sync.service';

export interface NormalizedLead {
  firstName: string;
  lastName?: string;
  phone: string;
  email?: string;
  company?: string;
  city?: string;
  project?: string;
  budget?: string;
  notes?: string;
  externalLeadId?: string;
  rawPayload: Record<string, any>;
}

export class LeadSourceService {
  /**
   * Normalize Indian or International phone numbers
   */
  static normalizePhoneNumber(rawPhone: string): string {
    if (!rawPhone) return '';
    let cleaned = String(rawPhone).trim().replace(/[^\d+]/g, '');
    
    // Indian 10-digit mobile number starting with 6-9
    if (/^[6-9]\d{9}$/.test(cleaned)) {
      return `+91${cleaned}`;
    }
    // Indian 11-digit mobile starting with 0
    if (/^0[6-9]\d{9}$/.test(cleaned)) {
      return `+91${cleaned.substring(1)}`;
    }
    // 12 digits starting with 91
    if (/^91[6-9]\d{9}$/.test(cleaned)) {
      return `+${cleaned}`;
    }
    // General international number with 10+ digits
    if (!cleaned.startsWith('+') && cleaned.length >= 10) {
      return `+${cleaned}`;
    }
    return cleaned;
  }

  /**
   * Parser for 99acres Real Estate Lead Webhook / Push API
   */
  static parse99acresLead(body: any): NormalizedLead {
    const b = body || {};
    const rawName = b.CustName || b.custName || b.customer_name || b.name || b.Name || '';
    const rawPhone = b.CustPhone || b.custPhone || b.phone || b.mobile || b.Mobile || b.contact_no || '';
    const rawEmail = b.CustEmail || b.custEmail || b.email || b.Email || '';
    const project = b.ProjName || b.projName || b.project_name || b.projectName || b.Property || '';
    const budget = b.Budget || b.budget || b.Price || b.price || '';
    const city = b.Location || b.city || b.City || b.locality || '';
    const notes = b.Query || b.query || b.remarks || b.Remarks || b.comment || '';

    const nameParts = String(rawName).trim().split(/\s+/);
    const firstName = nameParts[0] || '99acres Prospect';
    const lastName = nameParts.slice(1).join(' ') || undefined;

    return {
      firstName,
      lastName,
      phone: this.normalizePhoneNumber(rawPhone),
      email: rawEmail ? String(rawEmail).trim() : undefined,
      city: city ? String(city).trim() : undefined,
      project: project ? String(project).trim() : undefined,
      budget: budget ? String(budget).trim() : undefined,
      notes: notes ? String(notes).trim() : (project ? `Interested in ${project}` : undefined),
      rawPayload: b,
    };
  }

  /**
   * Parser for Magicbricks Lead Webhook / Push API
   */
  static parseMagicbricksLead(body: any): NormalizedLead {
    const b = body || {};
    const rawName = b.name || b.customerName || b.buyer_name || b.CustomerName || b.Name || '';
    const rawPhone = b.mobile || b.mobileNo || b.phone || b.Phone || b.Mobile || '';
    const rawEmail = b.email || b.emailId || b.Email || '';
    const project = b.propertyId || b.propertyName || b.project || b.ProjectName || b.PropertyTitle || '';
    const budget = b.budget || b.Budget || b.price || '';
    const city = b.locality || b.city || b.City || '';
    const notes = b.comment || b.msg || b.message || b.Remarks || '';

    const nameParts = String(rawName).trim().split(/\s+/);
    const firstName = nameParts[0] || 'Magicbricks Prospect';
    const lastName = nameParts.slice(1).join(' ') || undefined;

    return {
      firstName,
      lastName,
      phone: this.normalizePhoneNumber(rawPhone),
      email: rawEmail ? String(rawEmail).trim() : undefined,
      city: city ? String(city).trim() : undefined,
      project: project ? String(project).trim() : undefined,
      budget: budget ? String(budget).trim() : undefined,
      notes: notes ? String(notes).trim() : (project ? `Property: ${project}` : undefined),
      rawPayload: b,
    };
  }

  /**
   * Parser for Housing.com Lead Webhook
   */
  static parseHousingLead(body: any): NormalizedLead {
    const b = body || {};
    const rawName = b.lead_name || b.name || b.userName || b.customer_name || '';
    const rawPhone = b.lead_phone || b.phone || b.mobile || b.userPhone || '';
    const rawEmail = b.lead_email || b.email || b.userEmail || '';
    const project = b.project_name || b.property_name || b.projectName || '';
    const budget = b.budget || b.price_range || '';
    const city = b.city || b.locality || '';
    const notes = b.requirement || b.query || b.notes || '';

    const nameParts = String(rawName).trim().split(/\s+/);
    return {
      firstName: nameParts[0] || 'Housing.com Prospect',
      lastName: nameParts.slice(1).join(' ') || undefined,
      phone: this.normalizePhoneNumber(rawPhone),
      email: rawEmail ? String(rawEmail).trim() : undefined,
      city: city ? String(city).trim() : undefined,
      project: project ? String(project).trim() : undefined,
      budget: budget ? String(budget).trim() : undefined,
      notes: notes ? String(notes).trim() : undefined,
      rawPayload: b,
    };
  }

  /**
   * Parser for Meta / Facebook Lead Ads Webhook & Form Submissions
   */
  static parseMetaLead(body: any): NormalizedLead {
    const b = body || {};
    
    // Check if body has form field arrays like Facebook Graph API field_data
    let name = '';
    let phone = '';
    let email = '';
    let project = '';
    let notes = '';

    if (Array.isArray(b.field_data)) {
      for (const field of b.field_data) {
        const fieldName = (field.name || '').toLowerCase();
        const val = Array.isArray(field.values) ? field.values[0] : field.values;
        if (fieldName.includes('name') && !name) name = val;
        if (fieldName.includes('phone') || fieldName.includes('mobile')) phone = val;
        if (fieldName.includes('email')) email = val;
        if (fieldName.includes('project') || fieldName.includes('property')) project = val;
        if (fieldName.includes('city') || fieldName.includes('location')) notes += ` City: ${val}`;
      }
    } else {
      name = b.full_name || b.name || b.first_name || b.customer_name || '';
      phone = b.phone_number || b.phone || b.mobile || b.contact || '';
      email = b.email || b.email_address || '';
      project = b.ad_name || b.campaign_name || b.project || '';
      notes = b.form_name || b.notes || '';
    }

    const nameParts = String(name).trim().split(/\s+/);
    return {
      firstName: nameParts[0] || 'Meta Ads Prospect',
      lastName: nameParts.slice(1).join(' ') || undefined,
      phone: this.normalizePhoneNumber(phone),
      email: email ? String(email).trim() : undefined,
      project: project ? String(project).trim() : undefined,
      notes: notes ? String(notes).trim() : undefined,
      rawPayload: b,
    };
  }

  /**
   * Universal Parser for Website Forms (Elementor, CF7, WPForms, Webflow, Custom HTML)
   */
  static parseWebsiteForm(body: any): NormalizedLead {
    const b = body || {};
    const rawPhone =
      b.phone || b.phoneNumber || b.phone_number || b.mobile || b.mobile_number ||
      b.contact || b.contact_number || b.tel || b.whatsapp || b.Phone || b.Mobile || '';

    const rawName =
      b.name || b.fullName || b.full_name || b.firstName || b.first_name ||
      b.customer_name || b.lead_name || b.client_name || b.Name || '';

    const rawEmail = b.email || b.emailAddress || b.email_address || b.Email || '';
    const rawNotes = b.message || b.notes || b.query || b.comments || b.Message || '';
    const rawProject = b.project || b.project_name || b.projectName || b.property || b.service || b.subject || b.requirement || '';
    const rawCity = b.city || b.City || b.location || b.Location || b.locality || '';
    const rawBudget = b.budget || b.Budget || b.price || b.Price || b.budget_range || b.budgetRange || '';

    const nameParts = String(rawName).trim().split(/\s+/);
    return {
      firstName: nameParts[0] || 'Website Visitor',
      lastName: nameParts.slice(1).join(' ') || undefined,
      phone: this.normalizePhoneNumber(rawPhone),
      email: rawEmail ? String(rawEmail).trim() : undefined,
      city: rawCity ? String(rawCity).trim() : undefined,
      project: rawProject ? String(rawProject).trim() : undefined,
      budget: rawBudget ? String(rawBudget).trim() : undefined,
      notes: rawNotes ? String(rawNotes).trim() : undefined,
      rawPayload: b,
    };
  }

  /**
   * Parser for Zoho CRM Lead Webhook & Workflow Automation
   */
  static parseZohoLead(body: any): NormalizedLead {
    let b = body || {};
    // Handle nested Zoho array responses { data: [...] } or direct array
    if (Array.isArray(b.data) && b.data.length > 0) {
      b = b.data[0];
    } else if (Array.isArray(b) && b.length > 0) {
      b = b[0];
    }

    const rawFirst = b.First_Name || b.first_name || b.firstName || b.FirstName || '';
    const rawLast = b.Last_Name || b.last_name || b.lastName || b.LastName || '';
    const rawFull = b.Full_Name || b.full_name || b.name || b.Name || b.lead_name || b.Customer_Name || '';

    let firstName = rawFirst ? String(rawFirst).trim() : '';
    let lastName = rawLast ? String(rawLast).trim() : '';

    if (!firstName && rawFull) {
      const parts = String(rawFull).trim().split(/\s+/);
      firstName = parts[0] || 'Zoho Prospect';
      lastName = parts.slice(1).join(' ') || '';
    } else if (!firstName) {
      firstName = 'Zoho Prospect';
    }

    const rawPhone = b.Phone || b.phone || b.Mobile || b.mobile || b.phone_number || b.Mobile_Number || b.Contact_Number || '';
    const rawEmail = b.Email || b.email || b.Secondary_Email || '';
    const rawCompany = b.Company || b.company || b.Account_Name || '';
    const rawCity = b.City || b.city || b.State || b.state || '';
    const rawProject = b.Project || b.project || b.Product_Interest || b.Interest || b.Service || rawCompany || '';
    const rawBudget = b.Annual_Revenue || b.annual_revenue || b.budget || b.Budget || '';
    const rawNotes = b.Description || b.description || b.Notes || b.notes || (rawCompany ? `Company: ${rawCompany}` : '');
    const externalLeadId = b.id || b.Lead_Id || b.lead_id || b.record_id || b.Id || undefined;

    return {
      firstName,
      lastName: lastName || undefined,
      phone: this.normalizePhoneNumber(rawPhone),
      email: rawEmail ? String(rawEmail).trim() : undefined,
      company: rawCompany ? String(rawCompany).trim() : undefined,
      city: rawCity ? String(rawCity).trim() : undefined,
      project: rawProject ? String(rawProject).trim() : undefined,
      budget: rawBudget ? String(rawBudget).trim() : undefined,
      notes: rawNotes ? String(rawNotes).trim() : undefined,
      externalLeadId: externalLeadId ? String(externalLeadId) : undefined,
      rawPayload: b,
    };
  }

  /**
   * Ingest lead from any source, save to CRM, and optionally trigger AI Speed-to-Lead call
   */
  static async ingestLead(
    integration: LeadSourceIntegration,
    leadData: NormalizedLead,
    sourceOverride?: string
  ): Promise<{ leadId: string; callInitiated: boolean; callId?: string; error?: string }> {
    if (!leadData.phone || leadData.phone.length < 10) {
      throw new Error(`Invalid phone number '${leadData.phone}'. Must be a valid 10+ digit number.`);
    }

    const source = sourceOverride || integration.sourceType;

    // 1. Resolve User
    const [user] = await db.select().from(users).where(eq(users.id, integration.userId)).limit(1);
    if (!user) {
      throw new Error(`User account associated with integration not found.`);
    }

    // 2. Insert Lead into CRM `leads` table
    const [newLead] = await db.insert(leads).values({
      userId: user.id,
      sourceType: 'campaign', // Always 'campaign' so it shows up in CRM campaign filters
      campaignId: integration.campaignId || null,
      firstName: leadData.firstName,
      lastName: leadData.lastName || null,
      phone: leadData.phone,
      email: leadData.email || null,
      company: leadData.company || leadData.rawPayload?.Company || leadData.rawPayload?.company || null,
      stage: 'new',
      tags: [source, integration.name],
      customFields: {
        source,
        integrationId: integration.id,
        integrationName: integration.name,
        externalLeadId: leadData.externalLeadId || null,
        company: leadData.company || leadData.rawPayload?.Company || null,
        project: leadData.project || leadData.rawPayload?.project || leadData.rawPayload?.project_name || null,
        budget: leadData.budget || leadData.rawPayload?.budget || leadData.rawPayload?.price || null,
        city: leadData.city || leadData.rawPayload?.city || leadData.rawPayload?.location || null,
        notes: leadData.notes || leadData.rawPayload?.notes || leadData.rawPayload?.query || null,
        rawPayload: leadData.rawPayload,
      },
      aiSummary: leadData.project 
        ? `Lead from ${integration.name} (${source}) interested in ${leadData.project}${leadData.budget ? ` with budget ${leadData.budget}` : ''}`
        : `Lead captured from ${integration.name} via ${source}.`,
    }).returning();

    // 3. Update Integration Stats
    await db.update(leadSourceIntegrations)
      .set({
        totalLeads: sql`${leadSourceIntegrations.totalLeads} + 1`,
        lastLeadAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(leadSourceIntegrations.id, integration.id));

    // 4. Log to CRM Sync Logs
    try {
      await db.insert(crmSyncLogs).values({
        userId: user.id,
        source: source,
        action: 'import',
        recordsProcessed: 1,
        recordsCreated: 1,
        recordsUpdated: 0,
        recordsSkipped: 0,
        status: 'success',
        summary: `Lead ${leadData.firstName} (${leadData.phone}) ingested from ${integration.name}`,
      });
    } catch (logErr) {
      // non-critical
    }

    // 4b. Auto-export newly ingested lead to connected Google Sheets (Real-time Omnichannel Sync)
    try {
      await CrmSyncService.exportLeadToGoogleSheets(user.id, newLead.id, integration.spreadsheetId || undefined);
    } catch (sheetSyncErr: any) {
      console.warn(`[LeadSource] Google Sheet export note:`, sheetSyncErr.message);
    }

    // 5. Automated AI Outbound Calling (Speed-to-Lead)
    let callInitiated = false;
    let callId: string | undefined;

    // Check if autoCall is requested: either by integration config OR dynamically via form payload
    const dynamicAutoCall = integration.autoCall ||
                            leadData.rawPayload?.auto_call === true || 
                            leadData.rawPayload?.autoCall === true || 
                            leadData.rawPayload?.trigger_call === true ||
                            Boolean(leadData.rawPayload?.agent_id || leadData.rawPayload?.agent_name);

    if (dynamicAutoCall) {
      try {
        if (user.credits < 1) {
          console.warn(`[LeadSource] User ${user.email} has insufficient credits (${user.credits}) for auto-call`);
        } else {
          // Dynamic Agent Resolution:
          let agentToUse: any = null;

          // 1. Dynamic Override from Form Payload (agent_id, agent_name, campaign_id)
          const reqAgentId = leadData.rawPayload?.agent_id || leadData.rawPayload?.agentId;
          const reqAgentName = leadData.rawPayload?.agent_name || leadData.rawPayload?.agentName || leadData.rawPayload?.agent;
          const reqCampaignId = leadData.rawPayload?.campaign_id || leadData.rawPayload?.campaignId;

          if (reqAgentId) {
            const [ag] = await db.select().from(agents).where(and(eq(agents.userId, user.id), eq(agents.id, reqAgentId))).limit(1);
            if (ag) agentToUse = ag;
          }

          if (!agentToUse && reqAgentName) {
            const cleanReq = String(reqAgentName).trim().toLowerCase();
            const userAgents = await db.select().from(agents).where(eq(agents.userId, user.id));
            agentToUse = userAgents.find(a => 
              a.name.toLowerCase().includes(cleanReq) || 
              cleanReq.includes(a.name.toLowerCase())
            ) || null;
          }

          if (!agentToUse && reqCampaignId) {
            const [camp] = await db.select().from(campaigns).where(eq(campaigns.id, reqCampaignId)).limit(1);
            if (camp && camp.agentId) {
              const [ag] = await db.select().from(agents).where(eq(agents.id, camp.agentId)).limit(1);
              if (ag) agentToUse = ag;
            }
          }

          // 2. Integration-Level Configuration
          if (!agentToUse && integration.agentId) {
            const [ag] = await db.select().from(agents).where(eq(agents.id, integration.agentId)).limit(1);
            agentToUse = ag;
          } else if (!agentToUse && integration.campaignId) {
            const [camp] = await db.select().from(campaigns).where(eq(campaigns.id, integration.campaignId)).limit(1);
            if (camp && camp.agentId) {
              const [ag] = await db.select().from(agents).where(eq(agents.id, camp.agentId)).limit(1);
              agentToUse = ag;
            }
          }

          // 3. Smart Default (Master Receptionist or user's active agent)
          if (!agentToUse) {
            const allAgents = await db.select().from(agents).where(eq(agents.userId, user.id)).orderBy(desc(agents.createdAt));
            agentToUse = allAgents.find(a => /master/i.test(a.name)) || allAgents[0] || null;
          }

          if (agentToUse) {
            // Initiate call via Plivo / ElevenLabs / OpenAI
            const callRes = await this.triggerOutboundCall({
              user,
              agent: agentToUse,
              lead: newLead,
              integration,
              customGreeting: integration.customGreeting,
            });

            if (callRes && (callRes.callId || callRes.callUuid)) {
              callInitiated = true;
              callId = callRes.callId || callRes.callUuid;

              // Update totalCalls on integration
              await db.update(leadSourceIntegrations)
                .set({
                  totalCalls: sql`${leadSourceIntegrations.totalCalls} + 1`,
                  updatedAt: new Date(),
                })
                .where(eq(leadSourceIntegrations.id, integration.id));
            }
          }
        }
      } catch (callErr: any) {
        console.error(`[LeadSource] Speed-to-lead call error:`, callErr.message);
      }
    }

    return {
      leadId: newLead.id,
      callInitiated,
      callId,
    };
  }

  /**
   * Helper: Trigger Outbound AI Call
   */
  private static async triggerOutboundCall(params: {
    user: any;
    agent: any;
    lead: any;
    integration: LeadSourceIntegration;
    customGreeting?: string | null;
  }): Promise<any> {
    const { user, agent, lead, integration, customGreeting } = params;

    // Resolve active outbound phone number
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
    if (!plivoPhone) {
      console.warn(`[LeadSource] No outbound phone number found for speed-to-lead call`);
      return null;
    }

    const isElevenLabs = Boolean(
      agent.elevenLabsAgentId ||
      (agent.metadata as any)?.elevenLabsAgentId ||
      agent.telephonyProvider === 'plivo_elevenlabs' ||
      agent.telephonyProvider === 'elevenlabs' ||
      agent.voiceEngine === 'elevenlabs'
    );

    const isHindi = (agent.language === 'hi') || 
                    /[\u0900-\u097F]/.test(agent.systemPrompt || '') || 
                    /namaste|kripya|baad|baje|karein|boliye|humne|baat/i.test(agent.systemPrompt || '');

    // Always respect the exact firstMessage configured on the agent or campaign custom greeting
    let firstMessage = customGreeting || agent.firstMessage || '';
    if (firstMessage && lead.firstName) {
      firstMessage = firstMessage
        .replace(/\{\{\s*(?:first_name|firstName|name|contact_name)\s*\}\}/gi, lead.firstName)
        .replace(/\{first_name\}/gi, lead.firstName);
    }

    // Resolve or insert contact record if campaignId exists (plivo_calls.contact_id FK references contacts.id)
    let resolvedContactId: string | undefined = undefined;
    if (integration.campaignId) {
      try {
        const [createdContact] = await db.insert(contacts).values({
          campaignId: integration.campaignId,
          firstName: lead.firstName || 'Lead',
          lastName: lead.lastName || null,
          phone: lead.phone,
          email: lead.email || null,
          status: 'pending',
          customFields: { leadId: lead.id, source: 'lead_source' }
        }).returning({ id: contacts.id });
        if (createdContact) {
          resolvedContactId = createdContact.id;
        }
      } catch (cErr: any) {
        console.warn('[LeadSource] Could not insert campaign contact (proceeding without contactId):', cErr.message);
      }
    }

    if (isElevenLabs) {
      const { PlivoElevenLabsOutboundService } = await import('../../engines/plivo-elevenlabs/services/outbound-call.service');
      const credential = await ElevenLabsPoolService.getCredentialForAgent(agent.id);
      const elevenLabsApiKey = credential?.apiKey || process.env.ELEVENLABS_API_KEY || 'sk_5a88ed1456bd2e0890567f3a55e80a5885949a5b988ef3b8';

      const [plivoCred] = await db
        .select()
        .from(plivoCredentials)
        .where(eq(plivoCredentials.isActive, true))
        .limit(1);

      if (!plivoCred) {
        console.warn('[LeadSource] No active Plivo credentials found');
        return null;
      }

      return await PlivoElevenLabsOutboundService.makeCall({
        toNumber: lead.phone,
        fromNumber: plivoPhone.phoneNumber,
        agentId: agent.elevenLabsAgentId || 'agent_2201m20fdvdket7rdh5pttn091b8',
        elevenLabsApiKey,
        plivoAuthId: plivoCred.authId,
        plivoAuthToken: plivoCred.authToken,
        userId: user.id,
        dbAgentId: agent.id,
        campaignId: integration.campaignId || undefined,
        contactId: resolvedContactId,
        plivoPhoneNumberId: plivoPhone.id,
        metadata: {
          leadId: lead.id,
          leadName: lead.firstName,
          source: 'lead_source',
        },
        agentConfig: {
          agentId: agent.elevenLabsAgentId || 'agent_2201m20fdvdket7rdh5pttn091b8',
          firstMessage,
          language: agent.language || 'en',
          voiceId: agent.voiceId || undefined,
        },
      });
    } else {
      // Plivo + OpenAI Realtime
      const { PlivoCallService } = await import('../../engines/plivo/services/plivo-call.service');

      return await PlivoCallService.initiateCall({
        fromNumber: plivoPhone.phoneNumber,
        toNumber: lead.phone,
        userId: user.id,
        campaignId: integration.campaignId || undefined,
        contactId: resolvedContactId,
        agentId: agent.id,
        plivoPhoneNumberId: plivoPhone.id,
        metadata: {
          leadId: lead.id,
          leadName: lead.firstName,
          source: 'lead_source',
        },
        agentConfig: {
          voice: (agent.voice || 'alloy') as any,
          model: (agent.model || 'gpt-4o-realtime-preview') as any,
          systemPrompt: agent.systemPrompt || '',
          firstMessage,
        },
      });
    }
  }

  /**
   * Helper: Generate unique secure webhook key
   */
  static generateWebhookKey(sourceType: string): string {
    const prefix = sourceType.slice(0, 4).replace(/[^a-z]/g, 'wh');
    const random = crypto.randomBytes(8).toString('hex');
    return `${prefix}_${random}`;
  }

  // ============================================================
  // Integration Management (CRUD)
  // ============================================================

  static async listIntegrations(userId: string, sourceType?: string): Promise<LeadSourceIntegration[]> {
    const conditions = [eq(leadSourceIntegrations.userId, userId)];
    if (sourceType) {
      conditions.push(eq(leadSourceIntegrations.sourceType, sourceType));
    }
    return await db.select().from(leadSourceIntegrations)
      .where(and(...conditions))
      .orderBy(desc(leadSourceIntegrations.createdAt));
  }

  static async getIntegrationById(userId: string, id: string): Promise<LeadSourceIntegration | null> {
    const [res] = await db.select().from(leadSourceIntegrations)
      .where(and(eq(leadSourceIntegrations.id, id), eq(leadSourceIntegrations.userId, userId)))
      .limit(1);
    return res || null;
  }

  static async getIntegrationByWebhookKey(webhookKey: string): Promise<LeadSourceIntegration | null> {
    const [res] = await db.select().from(leadSourceIntegrations)
      .where(eq(leadSourceIntegrations.webhookKey, webhookKey))
      .limit(1);
    return res || null;
  }

  static async createIntegration(userId: string, data: {
    name: string;
    sourceType: string;
    campaignId?: string | null;
    agentId?: string | null;
    spreadsheetId?: string | null;
    autoCall?: boolean;
    autoCallDelaySeconds?: number;
    customGreeting?: string | null;
    portalConfig?: Record<string, any>;
  }): Promise<LeadSourceIntegration> {
    const webhookKey = this.generateWebhookKey(data.sourceType);
    const [created] = await db.insert(leadSourceIntegrations).values({
      userId,
      name: data.name,
      sourceType: data.sourceType,
      campaignId: data.campaignId || null,
      agentId: data.agentId || null,
      spreadsheetId: data.spreadsheetId || null,
      webhookKey,
      autoCall: data.autoCall ?? true,
      autoCallDelaySeconds: data.autoCallDelaySeconds ?? 15,
      customGreeting: data.customGreeting || null,
      portalConfig: data.portalConfig || {},
      status: 'active',
    }).returning();
    return created;
  }

  static async updateIntegration(userId: string, id: string, data: Partial<InsertLeadSourceIntegration>): Promise<LeadSourceIntegration | null> {
    const [updated] = await db.update(leadSourceIntegrations)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(and(eq(leadSourceIntegrations.id, id), eq(leadSourceIntegrations.userId, userId)))
      .returning();
    return updated || null;
  }

  static async deleteIntegration(userId: string, id: string): Promise<boolean> {
    const res = await db.delete(leadSourceIntegrations)
      .where(and(eq(leadSourceIntegrations.id, id), eq(leadSourceIntegrations.userId, userId)))
      .returning();
    return res.length > 0;
  }
}
