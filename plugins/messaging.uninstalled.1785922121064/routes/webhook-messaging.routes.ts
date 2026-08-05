import { Router, Request, Response } from 'express';
import { db } from '../../../server/db';
import { sql } from 'drizzle-orm';
import { validateAppointmentWebhookToken } from '../services/webhook-auth.service';
import { emailTemplateService } from '../services/email-template.service';
import { whatswayService } from '../services/whatsway.service';
import { metaWhatsAppService, MetaWhatsAppService } from '../services/meta-whatsapp.service';
import { whatsAppConversationService } from '../services/whatsapp-conversation.service';

const router = Router();

function stripUnresolvedElevenLabsVar(value: string | undefined | null): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (/^\{\{\s*\w+\s*\}\}$/.test(trimmed)) return '';
  return trimmed;
}

interface SipLookupResult {
  phone: string;
  sipCallId: string;
  conversationId: string;
  contactData: Record<string, string>;
}

function buildSipLookupResult(row: any): SipLookupResult | null {
  const phone = row.direction === 'inbound'
    ? (row.from_number || row.to_number || '')
    : (row.to_number || row.from_number || '');
  if (!phone) return null;
  return {
    phone,
    sipCallId: row.id || '',
    conversationId: row.elevenlabs_conversation_id || '',
    contactData: {
      contact_name: row.contact_name || '',
      contact_phone: phone,
      contact_email: row.contact_email || '',
      agent_name: row.agent_name || '',
      system__caller_id: phone,
    }
  };
}

async function lookupSipCallByConversationId(conversationId: string, userId?: string): Promise<SipLookupResult | null> {
  if (!conversationId) return null;
  try {
    const conditions = userId
      ? sql`sc.elevenlabs_conversation_id = ${conversationId} AND sc.user_id = ${userId}`
      : sql`sc.elevenlabs_conversation_id = ${conversationId}`;
    const sipResult = await db.execute(sql`
      SELECT sc.id, sc.from_number, sc.to_number, sc.direction, sc.elevenlabs_conversation_id,
             a.name as agent_name, COALESCE(ct.first_name || ' ' || ct.last_name, ct.first_name, '') as contact_name, ct.email as contact_email
      FROM sip_calls sc
      LEFT JOIN agents a ON sc.agent_id = a.id
      LEFT JOIN contacts ct ON sc.contact_id = ct.id
      WHERE ${conditions}
      ORDER BY sc.created_at DESC LIMIT 1
    `);
    const rows = Array.isArray(sipResult) ? sipResult : ((sipResult as any).rows || []);
    if (rows.length > 0) return buildSipLookupResult(rows[0]);
  } catch (err: any) {
    console.warn(`[SIP Lookup] Error querying sip_calls by conversationId: ${err.message}`);
  }
  return null;
}

async function lookupAnyCallByAgentId(elevenLabsAgentId: string, userId: string): Promise<SipLookupResult | null> {
  try {
    // Check calls table first (Flow Test calls go here)
    const callResult = await db.execute(sql`
      SELECT c.id, c.phone_number, COALESCE(ct.first_name || ' ' || ct.last_name, ct.first_name, '') as contact_name, ct.email as contact_email, a.name as agent_name
      FROM calls c
      JOIN agents a ON c.agent_id = a.id
      LEFT JOIN contacts ct ON c.contact_id = ct.id
      WHERE (a.eleven_labs_agent_id = ${elevenLabsAgentId} OR a.id = ${elevenLabsAgentId})
        AND c.user_id = ${userId}
        AND c.created_at > NOW() - INTERVAL '10 minutes'
      ORDER BY c.created_at DESC LIMIT 1
    `);

    const callRows = Array.isArray(callResult) ? callResult : ((callResult as any).rows || []);
    if (callRows.length > 0) {
      const row = callRows[0];
      console.log(`💬 [Messaging Webhook] Found matching record in calls table for agent: ${elevenLabsAgentId}`);
      return {
        phone: row.phone_number as string,
        sipCallId: row.id as string,
        contactData: {
          contact_name: row.contact_name || '',
          contact_phone: row.phone_number as string,
          contact_email: row.contact_email || '',
          agent_name: row.agent_name || '',
          system__caller_id: row.phone_number as string,
        }
      };
    }

    // Fallback to sip_calls
    const sipResult = await db.execute(sql`
      SELECT sc.id, sc.from_number, sc.to_number, sc.direction, sc.elevenlabs_conversation_id,
             a.name as agent_name, COALESCE(ct.first_name || ' ' || ct.last_name, ct.first_name, '') as contact_name, ct.email as contact_email
      FROM sip_calls sc
      JOIN agents a ON sc.agent_id = a.id
      LEFT JOIN contacts ct ON sc.contact_id = ct.id
      WHERE (a.eleven_labs_agent_id = ${elevenLabsAgentId} OR a.id = ${elevenLabsAgentId})
        AND sc.user_id = ${userId}
        AND sc.created_at > NOW() - INTERVAL '10 minutes'
      ORDER BY CASE WHEN sc.status IN ('initiated', 'ringing', 'in-progress', 'answered') THEN 0 ELSE 1 END, sc.created_at DESC LIMIT 1
    `);

    const sipRows = Array.isArray(sipResult) ? sipResult : ((sipResult as any).rows || []);
    if (sipRows.length > 0) {
      console.log(`💬 [Messaging Webhook] Found matching record in sip_calls table for agent: ${elevenLabsAgentId}`);
      return buildSipLookupResult(sipRows[0]);
    }
  } catch (err: any) {
    console.warn(`[Call Lookup] Error querying by agentId: ${err.message}`);
  }
  return null;
}

async function lookupAppointmentData(sipCallId: string, conversationId: string, userId: string): Promise<Record<string, string>> {
  try {
    const ids = [sipCallId, conversationId].filter(Boolean);
    if (ids.length === 0 || !userId) return {};
    const conditions = ids.map(id => sql`call_id = ${id}`);
    const orClause = conditions.length === 1 ? conditions[0] : sql`(${sql.join(conditions, sql` OR `)})`;
    const apptResult = await db.execute(sql`
      SELECT contact_name, contact_phone, contact_email, appointment_date, appointment_time,
             duration, service_name, notes, status
      FROM appointments
      WHERE user_id = ${userId} AND ${orClause}
      ORDER BY created_at DESC LIMIT 1
    `);
    const rows = Array.isArray(apptResult) ? apptResult : ((apptResult as any).rows || []);
    if (rows.length > 0) {
      const a = rows[0];
      console.log(`💬 [Messaging Webhook] Found appointment data: date=${a.appointment_date}, time=${a.appointment_time}, service=${a.service_name || 'N/A'}`);
      return {
        ...(a.contact_name ? { contact_name: a.contact_name } : {}),
        ...(a.contact_phone ? { contact_phone: a.contact_phone } : {}),
        ...(a.contact_email ? { contact_email: a.contact_email } : {}),
        ...(a.appointment_date ? { appointment_date: a.appointment_date } : {}),
        ...(a.appointment_time ? { appointment_time: a.appointment_time } : {}),
        ...(a.duration ? { duration: String(a.duration) } : {}),
        ...(a.service_name ? { service_name: a.service_name } : {}),
        ...(a.notes ? { notes: a.notes } : {}),
        ...(a.status ? { appointment_status: a.status } : {}),
      };
    }
  } catch (err: any) {
    console.warn(`[SIP Lookup] Error querying appointments: ${err.message}`);
  }
  return {};
}

/**
 * POST /collect-email/:token/:agentId
 * ElevenLabs webhook tool: collect caller email during a call and persist it
 * to the call record metadata for post-call messaging.
 */
router.post('/collect-email/:token/:agentId', async (req: Request, res: Response) => {
  const { token, agentId: elevenLabsAgentId } = req.params;
  const { email, caller_email, email_address, conversationId: bodyConversationId, callId: bodyCallId } = req.body;
  const conversationId = stripUnresolvedElevenLabsVar((req.query.conversationId as string) || bodyConversationId);
  const callId = (req.query.callId as string) || bodyCallId;

  try {
    if (!validateAppointmentWebhookToken(token)) {
      console.warn(`📧 [Collect Email] Invalid token`);
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const callerEmail = (email_address || email || caller_email || '').trim().toLowerCase();
    if (!callerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(callerEmail)) {
      return res.json({ success: false, message: 'Invalid email address provided' });
    }

    if (!conversationId && !callId) {
      return res.json({ success: false, message: 'Missing conversationId or callId' });
    }

    let updated = false;

    // Allowlisted table names (never user-supplied — safe to use with sql.raw for table names)
    const ALLOWED_CONV_TABLES = ['calls', 'sip_calls'] as const;
    const ALLOWED_ID_TABLES = ['twilio_openai_calls', 'plivo_calls', 'calls', 'sip_calls'] as const;

    // Persist caller email across all call tables
    if (conversationId) {
      // Match by elevenlabs_conversation_id in tables that have this column
      for (const tbl of ALLOWED_CONV_TABLES) {
        try {
          const r = await db.execute(
            sql`UPDATE ${sql.identifier(tbl)} SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('callerEmail', ${callerEmail}::text) WHERE elevenlabs_conversation_id = ${conversationId} RETURNING id`
          );
          const rows = Array.isArray(r) ? r : ((r as any).rows || []);
          if (rows.length > 0) { updated = true; }
        } catch (_) { }
      }
    }

    if (callId) {
      // Try each call table by primary key — persist to all matches
      for (const tbl of ALLOWED_ID_TABLES) {
        try {
          const r = await db.execute(
            sql`UPDATE ${sql.identifier(tbl)} SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('callerEmail', ${callerEmail}::text) WHERE id = ${callId} RETURNING id`
          );
          const rows = Array.isArray(r) ? r : ((r as any).rows || []);
          if (rows.length > 0) { updated = true; }
        } catch (_) { }
      }
    }

    if (!updated) {
      console.warn(`📧 [Collect Email] No call found for conversationId=${conversationId} callId=${callId}`);
      return res.json({ success: false, message: 'Call record not found' });
    }

    console.log(`📧 [Collect Email] Saved callerEmail=${callerEmail} for conversationId=${conversationId} callId=${callId}`);
    return res.json({ success: true, message: `Email ${callerEmail} collected successfully` });
  } catch (error: any) {
    console.error(`📧 [Collect Email] Error:`, error.message);
    return res.json({ success: false, message: 'Error saving caller email' });
  }
});

router.post('/send-email/:token/:agentId', async (req: Request, res: Response) => {
  const startTime = Date.now();
  console.log(`📧 [Messaging Webhook] ===== SEND EMAIL WEBHOOK HIT =====`);

  const { token, agentId: elevenLabsAgentId } = req.params;

  try {
    if (!validateAppointmentWebhookToken(token)) {
      console.warn(`📧 [Messaging Webhook] Invalid authentication token`);
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const agentResult = await db.execute(sql`
      SELECT id, user_id, messaging_email_template FROM agents 
      WHERE eleven_labs_agent_id = ${elevenLabsAgentId} OR id = ${elevenLabsAgentId} LIMIT 1
    `);

    const agentRows = Array.isArray(agentResult) ? agentResult : ((agentResult as any).rows || []);
    if (agentRows.length === 0) {
      console.warn(`📧 [Messaging Webhook] Agent not found: ${elevenLabsAgentId}`);
      return res.json({ success: false, message: 'Agent not found' });
    }

    const { id: dbAgentId, user_id: userId, messaging_email_template: savedEmailTemplate } = agentRows[0];
    const { recipient_email: rawRecipientEmail, template_name: requestedTemplateName, variables, dynamic_variables } = req.body;
    const template_name = savedEmailTemplate || requestedTemplateName;

    let recipient_email = stripUnresolvedElevenLabsVar(rawRecipientEmail);

    console.log(`📧 [Messaging Webhook] Headers: ${JSON.stringify(req.headers, null, 2)}`);
    const rawConvId = (req.query.conversationId as string) || req.body.conversationId || req.headers['elevenlabs-conversation-id'] || req.headers['x-elevenlabs-conversation-id'] || req.headers['xi-conversation-id'];
    const conversationId = stripUnresolvedElevenLabsVar(rawConvId);
    const callId = (req.query.callId as string) || req.body.callId;

    const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
    if (!recipient_email || !isValidEmail(recipient_email)) {
      recipient_email = '';
    }

    if (!recipient_email && conversationId) {
      console.log(`📧 [Messaging Webhook] recipient_email unresolved, attempting sip_calls lookup for conversationId: ${conversationId}`);
      const sipLookup = await lookupSipCallByConversationId(conversationId, userId);
      if (sipLookup?.contactData?.contact_email && isValidEmail(sipLookup.contactData.contact_email)) {
        recipient_email = sipLookup.contactData.contact_email;
        console.log(`📧 [Messaging Webhook] Resolved email from sip_calls (by convId): ${recipient_email}`);
      }
    }

    if (!recipient_email) {
      console.log(`📧 [Messaging Webhook] Attempting agent-based SIP lookup for agent: ${elevenLabsAgentId}`);
      const sipLookup = await lookupSipCallByAgentId(elevenLabsAgentId, userId);
      if (sipLookup?.contactData?.contact_email && isValidEmail(sipLookup.contactData.contact_email)) {
        recipient_email = sipLookup.contactData.contact_email;
        console.log(`📧 [Messaging Webhook] Resolved email from sip_calls (by agentId): ${recipient_email}`);
      }
    }

    if (!recipient_email || !template_name) {
      return res.json({
        success: false,
        message: 'Please provide both the email address and template name.',
      });
    }

    const mergedVars = { ...(variables || {}), ...(dynamic_variables || {}) };
    const result = await emailTemplateService.sendEmailByName(
      userId,
      template_name,
      recipient_email,
      mergedVars,
      { callId: req.query.callId as string, agentId: dbAgentId }
    );
    if (recipient_email && (callId || conversationId)) {
      const CONV_TABLES = ['calls', 'sip_calls'] as const;
      const ID_TABLES = ['twilio_openai_calls', 'plivo_calls', 'calls', 'sip_calls'] as const;
      if (conversationId) {
        for (const tbl of CONV_TABLES) {
          try {
            await db.execute(
              sql`UPDATE ${sql.identifier(tbl)} SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('callerEmail', ${recipient_email}::text) WHERE elevenlabs_conversation_id = ${conversationId}`
            );
          } catch (_) { }
        }
      }
      if (callId) {
        for (const tbl of ID_TABLES) {
          try {
            await db.execute(
              sql`UPDATE ${sql.identifier(tbl)} SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('callerEmail', ${recipient_email}::text) WHERE id = ${callId}`
            );
          } catch (_) { }
        }
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`📧 [Messaging Webhook] Email completed in ${elapsed}ms - success: ${result.success}`);

    return res.json({
      success: result.success,
      message: result.success
        ? `Email sent successfully to ${recipient_email}`
        : `Failed to send email: ${result.error}`,
    });
  } catch (error: any) {
    console.error(`📧 [Messaging Webhook] Error:`, error.message);
    return res.json({
      success: false,
      message: 'Error processing email webhook',
    });
  }
});

router.post('/send-whatsapp/:token/:agentId', async (req: Request, res: Response) => {
  const startTime = Date.now();
  const { token, agentId: elevenLabsAgentId } = req.params;
  console.log(`💬 [Messaging Webhook] Agent ID: ${elevenLabsAgentId}`);
  console.log(`💬 [Messaging Webhook] Headers: ${JSON.stringify(req.headers, null, 2)}`);
  console.log(`💬 [Messaging Webhook] Query: ${JSON.stringify(req.query)}`);


  try {
    if (!validateAppointmentWebhookToken(token)) {
      console.warn(`💬 [Messaging Webhook] Invalid authentication token`);
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const agentResult = await db.execute(sql`
      SELECT id, user_id, messaging_whatsapp_template, messaging_whatsapp_variables FROM agents 
      WHERE eleven_labs_agent_id = ${elevenLabsAgentId} OR id = ${elevenLabsAgentId} LIMIT 1
    `);

    const agentRows = Array.isArray(agentResult) ? agentResult : ((agentResult as any).rows || []);
    if (agentRows.length === 0) {
      console.warn(`💬 [Messaging Webhook] Agent not found: ${elevenLabsAgentId}`);
      return res.json({ success: false, message: 'Agent not found' });
    }

    const { id: dbAgentId, user_id: userId, messaging_whatsapp_template: savedWhatsappTemplate, messaging_whatsapp_variables: savedWhatsappVariables } = agentRows[0];
    const { template_name: requestedTemplateName, language, phone_number: rawPhoneNumber, template_variables, headerVariable: incomingHeader, buttonVariables: incomingButtons } = req.body;

    console.log(`💬 [Messaging Webhook] Incoming Request Body: ${JSON.stringify(req.body, null, 2)}`);
    const template_name = savedWhatsappTemplate || requestedTemplateName;

    if (!template_name) {
      return res.json({
        success: false,
        message: 'Please provide the WhatsApp template name.',
      });
    }

    let recipientPhone = stripUnresolvedElevenLabsVar(rawPhoneNumber);
    let digits = recipientPhone.replace(/[^0-9]/g, '');
    let contactData: Record<string, string> = {};

    console.log(`💬 [Messaging Webhook] Headers: ${JSON.stringify(req.headers, null, 2)}`);
    const rawConversationId = (req.query.conversationId as string) || req.body.conversationId || req.headers['elevenlabs-conversation-id'] || req.headers['x-elevenlabs-conversation-id'] || req.headers['xi-conversation-id'];
    const resolvedConversationId = stripUnresolvedElevenLabsVar(rawConversationId);

    if (digits.length < 6 || (Array.isArray(template_variables) && template_variables.length > 0) || savedWhatsappVariables) {
      if (req.query.callId) {
        const callResult = await db.execute(sql`
          SELECT c.phone_number, COALESCE(ct.first_name || ' ' || ct.last_name, ct.first_name, '') as contact_name, ct.email as contact_email, a.name as agent_name
          FROM calls c
          LEFT JOIN contacts ct ON c.contact_id = ct.id
          LEFT JOIN agents a ON c.agent_id = a.id
          WHERE c.id = ${req.query.callId} LIMIT 1
        `);
        const callRows = Array.isArray(callResult) ? callResult : ((callResult as any).rows || []);
        if (callRows.length > 0) {
          const row = callRows[0];
          // Always prioritize the customer phone number from our database if available
          if (row.phone_number) {
            recipientPhone = row.phone_number;
            digits = recipientPhone.replace(/[^0-9]/g, '');
            console.log(`💬 [Messaging Webhook] Resolved real customer phone from call record: ${recipientPhone}`);
          }
          contactData = {
            contact_name: row.contact_name || '',
            contact_phone: row.phone_number || recipientPhone,
            contact_email: row.contact_email || '',
            agent_name: row.agent_name || '',
            system__caller_id: recipientPhone,
          };
        }
      }
    }

    if ((!recipientPhone || recipientPhone.replace(/[^0-9]/g, '').length < 6) && resolvedConversationId) {
      console.log(`💬 [Messaging Webhook] Attempting conversationId fallback for: ${resolvedConversationId}`);
      const convResult = await db.execute(sql`
          SELECT c.phone_number, c.from_number, COALESCE(ct.first_name || ' ' || ct.last_name, ct.first_name, '') as contact_name, ct.email as contact_email, a.name as agent_name
          FROM calls c
          LEFT JOIN contacts ct ON c.contact_id = ct.id
          LEFT JOIN agents a ON c.agent_id = a.id
          WHERE c.elevenlabs_conversation_id = ${resolvedConversationId}
          AND c.user_id = ${userId}
          ORDER BY c.created_at DESC LIMIT 1
        `);
      const convRows = Array.isArray(convResult) ? convResult : ((convResult as any).rows || []);
      if (convRows.length > 0) {
        const row = convRows[0];
        const resolvedPhone = row.phone_number || row.from_number || '';
        // Always prioritize the customer phone number from our database if available
        if (resolvedPhone) {
          recipientPhone = resolvedPhone;
          digits = recipientPhone.replace(/[^0-9]/g, '');
          console.log(`💬 [Messaging Webhook] Resolved real customer phone from calls table: ${recipientPhone}`);
        }
        contactData = {
          contact_name: row.contact_name || '',
          contact_phone: resolvedPhone || recipientPhone,
          contact_email: row.contact_email || '',
          agent_name: row.agent_name || '',
          system__caller_id: recipientPhone,
        };
      }
    }

    let sipCallId = '';
    let resolvedSipConversationId = '';

    if ((!recipientPhone || recipientPhone.replace(/[^0-9]/g, '').length < 6) && resolvedConversationId) {
      console.log(`💬 [Messaging Webhook] Attempting sip_calls fallback for conversationId: ${resolvedConversationId}`);
      const sipLookup = await lookupSipCallByConversationId(resolvedConversationId, userId);
      if (sipLookup && sipLookup.phone) {
        recipientPhone = sipLookup.phone;
        digits = recipientPhone.replace(/[^0-9]/g, '');
        contactData = sipLookup.contactData;
        sipCallId = sipLookup.sipCallId;
        resolvedSipConversationId = sipLookup.conversationId;
        console.log(`💬 [Messaging Webhook] Resolved phone from sip_calls (by convId): ${recipientPhone}`);
      }
    }

    if (!recipientPhone || recipientPhone.replace(/[^0-9]/g, '').length < 6) {
      console.log(`💬 [Messaging Webhook] Attempting agent-based lookup for agent: ${elevenLabsAgentId}`);
      const anyLookup = await lookupAnyCallByAgentId(elevenLabsAgentId, userId);
      if (anyLookup && anyLookup.phone) {
        recipientPhone = anyLookup.phone;
        digits = recipientPhone.replace(/[^0-9]/g, '');
        contactData = anyLookup.contactData;
        sipCallId = (anyLookup as any).callId || anyLookup.sipCallId;
        resolvedSipConversationId = anyLookup.conversationId;
        console.log(`💬 [Messaging Webhook] Resolved phone from agent-based lookup: ${recipientPhone}`);
      }
    }

    // FINAL FALLBACK: If we have a phone but no contact data (e.g. Inbound call where 'calls' record is created later),
    // look up the contact by phone directly to ensure variables like {{contact_name}} can be resolved.
    if (digits.length >= 6 && Object.keys(contactData).length === 0) {
      try {
        console.log(`💬 [Messaging Webhook] Direct contact lookup for ${recipientPhone}...`);
        const { lookupContactByPhone } = await import('../../../server/services/post-call-messaging');
        const contactInfo = await lookupContactByPhone(recipientPhone, userId);
        if (contactInfo && Object.keys(contactInfo).length > 0) {
          contactData = {
            contact_name: contactInfo.contact_name || '',
            contact_phone: recipientPhone,
            contact_email: contactInfo.contact_email || '',
            agent_name: (agentRows[0] as any).name || '',
            system__caller_id: recipientPhone,
            ...contactInfo
          };
          console.log(`💬 [Messaging Webhook] Found contact by phone: ${contactData.contact_name}`);
        }
      } catch (err: any) {
        console.warn(`💬 [Messaging Webhook] Direct contact lookup failed: ${err.message}`);
      }
    }

    if (!recipientPhone || recipientPhone.replace(/[^0-9]/g, '').length < 6) {
      return res.json({
        success: false,
        message: 'Could not determine the recipient phone number.',
      });
    }

    if (sipCallId || resolvedSipConversationId) {
      const apptData = await lookupAppointmentData(sipCallId, resolvedSipConversationId, userId);
      if (Object.keys(apptData).length > 0) {
        contactData = { ...contactData, ...apptData };
        console.log(`💬 [Messaging Webhook] Enriched contactData with appointment fields: ${Object.keys(apptData).join(', ')}`);
      }
    }
    console.log(`💬 [Messaging Webhook] Final Resolved Contact Data: ${JSON.stringify(contactData)}`);

    let components: any[] = [];
    const buttonOverrides: Record<number, string> = {};
    if (Array.isArray(template_variables) && template_variables.length > 0) {
      const bodyVars = template_variables.filter((tv: any) => tv.componentType !== 'button');
      const buttonVars = template_variables.filter((tv: any) => tv.componentType === 'button');

      if (bodyVars.length > 0) {
        const sorted = [...bodyVars].sort((a: any, b: any) => a.position - b.position);
        const parameters = sorted.map((tv: any) => {
          let val = stripUnresolvedElevenLabsVar(tv.value || '');
          if (tv.source && tv.source !== 'custom' && contactData[tv.source]) {
            val = contactData[tv.source];
          } else if (!val || val.trim() === '') {
            const varMatch = (tv.value || '').match(/^\{\{(\w+)\}\}$/);
            if (varMatch && contactData[varMatch[1]]) {
              val = contactData[varMatch[1]];
            }
          } else {
            const varMatch = val.match(/^\{\{(\w+)\}\}$/);
            if (varMatch && contactData[varMatch[1]]) {
              val = contactData[varMatch[1]];
            }
          }
          return { type: 'text', text: val || ' ' };
        });
        components = [{ type: 'body', parameters }];
        console.log(`[Messaging Webhook] Built ${parameters.length} body template variable(s)`);
      }

      for (const tv of buttonVars) {
        const btnIdx = typeof tv.position === 'number' ? tv.position : parseInt(tv.position || '0');
        let val = stripUnresolvedElevenLabsVar(tv.value || '');
        if (tv.source && tv.source !== 'custom' && contactData[tv.source]) {
          val = contactData[tv.source];
        } else if (!val || val.trim() === '') {
          const varMatch = (tv.value || '').match(/^\{\{(\w+)\}\}$/);
          if (varMatch && contactData[varMatch[1]]) {
            val = contactData[varMatch[1]];
          }
        } else {
          const varMatch = val.match(/^\{\{(\w+)\}\}$/);
          if (varMatch && contactData[varMatch[1]]) {
            val = contactData[varMatch[1]];
          }
        }
        if (val) buttonOverrides[btnIdx] = val;
      }
      if (Object.keys(buttonOverrides).length > 0) {
        console.log(`[Messaging Webhook] Found ${Object.keys(buttonOverrides).length} button variable override(s) from request`);
      }
    }

    if (savedWhatsappVariables) {
      try {
        const parsedVars = JSON.parse(savedWhatsappVariables);

        if (Object.keys(buttonOverrides).length === 0) {
          for (const [key, val] of Object.entries(parsedVars)) {
            if (val && typeof val === 'object' && (val as any).componentType === 'button') {
              const btnIdx = key.startsWith('btn_') ? parseInt(key.replace('btn_', '')) : parseInt(key);
              if (!isNaN(btnIdx) && (val as any).value) {
                let btnVal = (val as any).value as string;
                if (contactData[btnVal]) {
                  btnVal = contactData[btnVal];
                } else {
                  const varMatch = btnVal.match(/^\{\{\s*(\w+)\s*\}\}$/);
                  if (varMatch && contactData[varMatch[1]]) {
                    btnVal = contactData[varMatch[1]];
                  } else {
                    btnVal = btnVal.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
                      return (contactData[key] && contactData[key].trim() !== '') ? contactData[key] : '';
                    });
                  }
                }
                btnVal = stripUnresolvedElevenLabsVar(btnVal);
                if (btnVal) buttonOverrides[btnIdx] = btnVal;
              }
            }
          }
          if (Object.keys(buttonOverrides).length > 0) {
            console.log(`[Messaging Webhook] Found ${Object.keys(buttonOverrides).length} button variable override(s) from agent config`);
          }
        }

        if (components.length === 0) {
          const bodyVarEntries: Array<[number, string]> = [];
          for (const [key, val] of Object.entries(parsedVars)) {
            if (val && typeof val === 'object' && !(val as any).componentType && ((val as any).mode === 'fixed' || (val as any).mode === 'collect') && (val as any).value) {
              const idx = parseInt(key);
              if (!isNaN(idx)) {
                bodyVarEntries.push([idx, (val as any).value]);
              }
            }
          }
          if (bodyVarEntries.length > 0) {
            bodyVarEntries.sort((a, b) => a[0] - b[0]);
            const parameters = bodyVarEntries.map(([, value]) => {
              let resolved = value;
              if (contactData[value]) {
                resolved = contactData[value];
              } else {
                const varMatch = value.match(/^\{\{\s*(\w+)\s*\}\}$/);
                if (varMatch && contactData[varMatch[1]]) {
                  resolved = contactData[varMatch[1]];
                } else {
                  resolved = value.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
                    return (contactData[key] && contactData[key].trim() !== '') ? contactData[key] : '';
                  });
                }
              }
              resolved = stripUnresolvedElevenLabsVar(resolved);
              return { type: 'text', text: resolved || ' ' };
            });
            components = [{ type: 'body', parameters }];
            console.log(`[Messaging Webhook] Built ${parameters.length} body variable(s) from agent config`);
          }
        }
      } catch (parseErr: any) {
        console.warn(`[Messaging Webhook] Failed to parse saved variables: ${parseErr.message}`);
      }
    }

    const metaSettings = await metaWhatsAppService.getSettings(userId);
    const whatswaySettings = await whatswayService.getSettings(userId);

    let headerVariable = incomingHeader || req.body.headerVariable || null;
    const buttonVariables = incomingButtons || req.body.buttonVariables || [];

    console.log(`💬 [Messaging Webhook] Initial Header Variable: ${JSON.stringify(headerVariable)}`);
    console.log(`💬 [Messaging Webhook] Initial Button Variables: ${JSON.stringify(buttonVariables)}`);

    if (!headerVariable && savedWhatsappVariables) {
      try {
        const parsedVars = JSON.parse(savedWhatsappVariables);
        for (const [, val] of Object.entries(parsedVars)) {
          if (val && typeof val === 'object' && (val as any).componentType === 'header' && (val as any).value) {
            headerVariable = { value: (val as any).value, source: (val as any).source };
            break;
          }
        }
      } catch (_) { }
    }

    let resolvedLanguage = language || 'en_US';
    if (metaSettings?.isActive) {
      try {
        const templateDef = await metaWhatsAppService.getTemplateByName(userId, template_name);
        if (templateDef) {
          // If a language was requested but it's the default en_US, prioritize the actual template language
          // This fixes cases where templates are registered as 'en' but ElevenLabs sends 'en_US'
          if (language === 'en_US' || !language) {
            resolvedLanguage = templateDef.language || 'en_US';
          } else {
            resolvedLanguage = language || templateDef.language || 'en_US';
          }
        }
        if (templateDef && templateDef.components) {
          const bodyComp = templateDef.components.find((c: any) => c.type === 'BODY');
          if (bodyComp && bodyComp.text) {
            const bodyVarMatches = bodyComp.text.match(/\{\{\d+\}\}/g) || [];
            const requiredCount = [...new Set(bodyVarMatches)].length;
            if (requiredCount > 0) {
              const existingBody = components.find((c: any) => c.type === 'body');
              const existingParams = existingBody?.parameters || [];
              if (existingParams.length < requiredCount) {
                const fallbackOrder = ['contact_name', 'contact_phone', 'contact_email', 'agent_name', 'appointment_date', 'appointment_time', 'service_name', 'duration', 'notes', 'appointment_status'];
                const availableValues = fallbackOrder.filter(k => contactData[k] && contactData[k].trim() !== '').map(k => contactData[k]);
                const parameters = [];
                for (let i = 0; i < requiredCount; i++) {
                  if (i < existingParams.length && existingParams[i]?.text && existingParams[i].text.trim() !== '') {
                    parameters.push(existingParams[i]);
                  } else {
                    const fallbackIdx = i - existingParams.length;
                    parameters.push({ type: 'text', text: availableValues[fallbackIdx >= 0 ? fallbackIdx : i] || ' ' });
                  }
                }
                components = components.filter((c: any) => c.type !== 'body');
                components.push({ type: 'body', parameters });
                console.log(`[Messaging Webhook] Body variables: ${existingParams.length} provided + ${requiredCount - existingParams.length} auto-populated = ${requiredCount} total for template "${template_name}"`);
              }
            }
          }

          const headerComp = templateDef.components.find((c: any) => c.type === 'HEADER');
          if (headerComp) {
            const headerFormat = (headerComp.format || '').toUpperCase();
            if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerFormat)) {
              let headerUrl = stripUnresolvedElevenLabsVar(headerVariable?.url || headerVariable?.value || '');
              if (headerUrl) {
                const varMatch = headerUrl.match(/^\{\{(\w+)\}\}$/);
                if (varMatch && contactData[varMatch[1]]) headerUrl = contactData[varMatch[1]];
              }
              if (headerUrl) {
                const mediaTypeLowercase = headerFormat.toLowerCase() as 'image' | 'video' | 'document';

                // For Meta API, the parameter type MUST match the media type (image, video, document)
                const headerParam: any = {
                  type: mediaTypeLowercase
                };

                // Add the media object with the link
                headerParam[mediaTypeLowercase] = {
                  link: headerUrl.trim()
                };

                const headerComponent = {
                  type: 'header',
                  parameters: [headerParam]
                };

                // Add as the first component
                components = [headerComponent, ...components.filter(c => c.type !== 'header')];
                console.log(`💬 [Messaging Webhook] Added Meta HEADER (${mediaTypeLowercase}) component: ${headerUrl}`);
              }
            } else if (headerFormat === 'TEXT' && headerComp.text) {
              const headerVarMatches = headerComp.text.match(/\{\{\d+\}\}/g) || [];
              if (headerVarMatches.length > 0) {
                let headerVal = stripUnresolvedElevenLabsVar(headerVariable?.value || headerVariable?.text || '');
                if (!headerVal || headerVal.trim() === '') {
                  headerVal = contactData.contact_name || ' ';
                } else {
                  const varMatch = headerVal.match(/^\{\{(\w+)\}\}$/);
                  if (varMatch && contactData[varMatch[1]]) headerVal = contactData[varMatch[1]];
                  if (headerVariable?.source && headerVariable.source !== 'custom' && contactData[headerVariable.source]) {
                    headerVal = contactData[headerVariable.source];
                  }
                }
                components = [{ type: 'header', parameters: [{ type: 'text', text: headerVal }] }, ...components];
                console.log(`[Messaging Webhook] Added HEADER text variable: ${headerVal}`);
              }
            }
          }

          if (Array.isArray(buttonVariables) && buttonVariables.length > 0) {
            for (const bv of buttonVariables) {
              const idx = typeof bv.index === 'number' ? bv.index : parseInt(bv.index || '0');
              let btnVal = stripUnresolvedElevenLabsVar(bv.value || '');
              if (btnVal) {
                const varMatch = btnVal.match(/^\{\{(\w+)\}\}$/);
                if (varMatch && contactData[varMatch[1]]) btnVal = contactData[varMatch[1]];
              }
              if (btnVal && !isNaN(idx)) {
                buttonOverrides[idx] = btnVal;
              }
            }
          }

          const buttonComponents = MetaWhatsAppService.buildButtonComponents(
            templateDef.components,
            Object.keys(buttonOverrides).length > 0 ? buttonOverrides : undefined
          );
          if (buttonComponents.length > 0) {
            components = [...components, ...buttonComponents];
            console.log(`[Messaging Webhook] Auto-added ${buttonComponents.length} button component(s) for template "${template_name}"`);
          }
        }
      } catch (tmplError: any) {
        console.warn(`[Messaging Webhook] Could not fetch template metadata: ${tmplError.message}`);
      }
    }

    console.log(`💬 [Messaging Webhook] Final send: to=${recipientPhone}, template=${template_name}, lang=${resolvedLanguage}, bodyVars=${components.length > 0 ? JSON.stringify(components[0]?.parameters?.map((p: any) => p.text)) : '[]'}, contactDataKeys=${Object.keys(contactData).join(',')}`);

    let sendResult: { messageId: string; status: string } | undefined;

    if (metaSettings?.isActive) {
      console.log(`[Messaging Webhook] Using Meta WhatsApp Cloud API for user ${userId}`);
      console.log(`💬 [Messaging Webhook] Final Constructed Components for Meta: ${JSON.stringify(components, null, 2)}`);
      sendResult = await metaWhatsAppService.sendTemplate(
        userId,
        recipientPhone,
        template_name,
        resolvedLanguage,
        components,
        { callId: req.query.callId as string, agentId: dbAgentId }
      );
    } else if (whatswaySettings?.isActive) {
      console.log(`[Messaging Webhook] Using WhatsWay for user ${userId}`);
      console.log(`💬 [Messaging Webhook] Final Constructed Components for WhatsWay: ${JSON.stringify(components, null, 2)}`);
      sendResult = await whatswayService.sendTemplate(
        userId,
        recipientPhone,
        template_name,
        resolvedLanguage,
        components,
        { callId: req.query.callId as string, agentId: dbAgentId }
      );
    } else {
      console.warn(`[Messaging Webhook] No WhatsApp provider configured for user ${userId}`);
      return res.json({
        success: false,
        message: 'No WhatsApp provider configured. Please set up WhatsWay or Meta WhatsApp in your messaging settings.',
      });
    }

    try {
      const conversation = await whatsAppConversationService.getOrCreateConversation(
        userId,
        recipientPhone
      );
      await whatsAppConversationService.addMessage({
        conversationId: conversation.id,
        userId,
        direction: 'outbound',
        senderType: 'agent',
        messageType: 'template',
        content: `[Template: ${template_name}]`,
        templateName: template_name,
        metaMessageId: sendResult?.messageId || undefined,
        status: 'sent',
        metadata: { agentId: dbAgentId, source: 'webhook' },
      });
      console.log(`💬 [Messaging Webhook] Stored outgoing message in conversation ${conversation.id}`);
    } catch (convError: any) {
      console.warn(`💬 [Messaging Webhook] Failed to store in conversations: ${convError.message}`);
    }

    const elapsed = Date.now() - startTime;
    console.log(`[Messaging Webhook] WhatsApp completed in ${elapsed}ms - success: true`);

    return res.json({
      success: true,
      message: `WhatsApp message sent successfully to ${recipientPhone}`,
    });
  } catch (error: any) {
    console.error(`💬 [Messaging Webhook] Error:`, error.message);
    return res.json({
      success: false,
      message: 'Error processing WhatsApp webhook',
    });
  }
});

export default router;
