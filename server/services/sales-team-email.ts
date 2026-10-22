'use strict';
/**
 * ============================================================
 * Calliqo AI - Sales Team & Site Visit Email Notification Service
 * 
 * Supports:
 * 1. Dynamic email templates customizable from Admin CRM panel
 * 2. Automatic variable interpolation ({{client_name}}, {{project_name}}, etc.)
 * 3. Tenant custom SMTP support via emailService
 * 4. Separate templates for Sales Executive (Staff) and Customer (Client)
 * ============================================================
 */

import { emailService } from './email-service';
import { logger } from '../utils/logger';
import { db } from '../db';
import { userEmailTemplates } from '@shared/schema';
import { eq, and } from 'drizzle-orm';

export interface StaffAssignmentEmailParams {
  userId?: string | null;
  staffEmail: string;
  staffName: string;
  clientName: string;
  clientPhone: string;
  clientEmail?: string | null;
  serviceName: string;
  appointmentDate: string;
  appointmentTime: string;
  notes?: string | null;
  adminInstructions?: string | null;
}

export interface ClientConfirmationEmailParams {
  userId?: string | null;
  clientEmail: string;
  clientName: string;
  serviceName: string;
  appointmentDate: string;
  appointmentTime: string;
  staffName?: string | null;
  staffPhone?: string | null;
  staffRole?: string | null;
}

export const DEFAULT_EMAIL_TEMPLATES = {
  staff_site_visit_assignment: {
    key: 'staff_site_visit_assignment',
    name: 'Sales Executive Briefing (Field Team)',
    description: 'Sent automatically to the assigned Sales Executive when a property site visit is deployed or booked.',
    recipientType: 'Assigned Sales Executive (Staff)',
    subject: '🏢 New Site Visit Assigned: {{client_name}} - {{project_name}} ({{visit_date}} at {{visit_time}})',
    variables: [
      'client_name',
      'client_phone',
      'client_email',
      'project_name',
      'service_name',
      'visit_date',
      'visit_time',
      'notes',
      'admin_instructions',
      'staff_name',
      'company_name',
    ],
    htmlBody: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f1f5f9; margin: 0; padding: 24px; color: #0f172a; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 14px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.08); border: 1px solid #e2e8f0; }
    .header { background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%); padding: 32px 24px; text-align: center; color: #ffffff; }
    .header h1 { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.5px; }
    .badge { display: inline-block; background: rgba(255,255,255,0.22); padding: 5px 14px; border-radius: 9999px; font-size: 12px; font-weight: 600; margin-top: 10px; letter-spacing: 0.3px; }
    .content { padding: 30px 24px; }
    .greeting { font-size: 16px; line-height: 1.6; margin-bottom: 20px; color: #334155; }
    .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 18px; margin: 18px 0; }
    .card-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px; display: flex; align-items: center; gap: 6px; }
    .card-title.blue { color: #2563eb; }
    .card-title.emerald { color: #059669; }
    .row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px dashed #e2e8f0; font-size: 14px; }
    .row:last-child { border-bottom: none; }
    .label { color: #64748b; font-weight: 500; }
    .val { color: #0f172a; font-weight: 600; text-align: right; }
    .btn { display: inline-block; background: #2563eb; color: #ffffff !important; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px; margin-top: 20px; text-align: center; }
    .notes-box { margin-top: 12px; font-size: 13px; color: #334155; background: #ffffff; padding: 12px; border-radius: 8px; border: 1px solid #cbd5e1; line-height: 1.5; }
    .instruction-box { background: #fffbeb; border: 1px solid #fef3c7; border-left: 4px solid #f59e0b; border-radius: 8px; padding: 14px; margin: 18px 0; font-size: 13px; color: #92400e; line-height: 1.5; }
    .footer { padding: 20px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #f1f5f9; background: #fafafa; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🏢 New Site Visit Assigned</h1>
      <div class="badge">ACTION REQUIRED • FIELD COORDINATION</div>
    </div>
    <div class="content">
      <div class="greeting">
        Namaste <strong>{{staff_name}}</strong>,<br>
        A new customer property site visit has been booked and assigned to you via <strong>{{company_name}}</strong>. Please review the visit schedule and client requirements below.
      </div>

      <div class="card">
        <div class="card-title blue">📍 Property & Schedule Details</div>
        <div class="row">
          <span class="label">Project / Property:</span>
          <span class="val">{{project_name}}</span>
        </div>
        <div class="row">
          <span class="label">Visit Date:</span>
          <span class="val">📅 {{visit_date}}</span>
        </div>
        <div class="row">
          <span class="label">Scheduled Time:</span>
          <span class="val">⏰ {{visit_time}}</span>
        </div>
      </div>

      <div class="card">
        <div class="card-title emerald">👤 Customer Information</div>
        <div class="row">
          <span class="label">Client Name:</span>
          <span class="val">{{client_name}}</span>
        </div>
        <div class="row">
          <span class="label">Mobile / WhatsApp:</span>
          <span class="val"><a href="tel:{{client_phone}}" style="color: #2563eb; text-decoration: none;">{{client_phone}}</a></span>
        </div>
        <div class="row">
          <span class="label">Client Email:</span>
          <span class="val">{{client_email}}</span>
        </div>

        <div class="notes-box">
          <strong>Customer Preference / Requirement:</strong><br>
          {{notes}}
        </div>
      </div>

      <div class="instruction-box">
        <strong>📝 Instructions from Admin / Management:</strong><br>
        {{admin_instructions}}
      </div>

      <div style="text-align: center; margin: 24px 0 10px;">
        <a href="https://calliqoai.com/app/crm" class="btn">Open Site Visit in CRM</a>
      </div>
    </div>
    <div class="footer">
      Sent automatically via {{company_name}} • Real Estate CRM
    </div>
  </div>
</body>
</html>`,
  },

  client_site_visit_confirmation: {
    key: 'client_site_visit_confirmation',
    name: 'Customer Confirmation (Client)',
    description: 'Sent automatically to the customer when their property visit is confirmed with consultant details.',
    recipientType: 'Customer / Lead (Client)',
    subject: '✅ Property Site Visit Confirmed: {{project_name}} ({{visit_date}} at {{visit_time}})',
    variables: [
      'client_name',
      'project_name',
      'service_name',
      'visit_date',
      'visit_time',
      'assigned_consultant_name',
      'assigned_consultant_phone',
      'assigned_consultant_role',
      'company_name',
    ],
    htmlBody: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f1f5f9; margin: 0; padding: 24px; color: #0f172a; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 14px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.08); border: 1px solid #e2e8f0; }
    .header { background: linear-gradient(135deg, #059669 0%, #10b981 100%); padding: 32px 24px; text-align: center; color: #ffffff; }
    .header h1 { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.5px; }
    .badge { display: inline-block; background: rgba(255,255,255,0.22); padding: 5px 14px; border-radius: 9999px; font-size: 12px; font-weight: 600; margin-top: 10px; letter-spacing: 0.3px; }
    .content { padding: 30px 24px; }
    .greeting { font-size: 16px; line-height: 1.6; margin-bottom: 20px; color: #334155; }
    .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 18px; margin: 18px 0; }
    .card-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px; color: #059669; }
    .row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px dashed #e2e8f0; font-size: 14px; }
    .row:last-child { border-bottom: none; }
    .label { color: #64748b; font-weight: 500; }
    .val { color: #0f172a; font-weight: 600; text-align: right; }
    .consultant-card { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 10px; padding: 18px; margin: 18px 0; }
    .consultant-title { font-size: 12px; font-weight: 700; text-transform: uppercase; color: #2563eb; margin-bottom: 10px; }
    .footer { padding: 20px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #f1f5f9; background: #fafafa; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>✅ Property Site Visit Confirmed</h1>
      <div class="badge">APPOINTMENT SCHEDULED</div>
    </div>
    <div class="content">
      <div class="greeting">
        Dear <strong>{{client_name}}</strong>,<br>
        Thank you for your interest! Your property site visit has been successfully confirmed. Here are the details of your scheduled visit:
      </div>

      <div class="card">
        <div class="card-title">📅 Schedule & Property Information</div>
        <div class="row">
          <span class="label">Project / Property:</span>
          <span class="val">{{project_name}}</span>
        </div>
        <div class="row">
          <span class="label">Date:</span>
          <span class="val">📅 {{visit_date}}</span>
        </div>
        <div class="row">
          <span class="label">Time:</span>
          <span class="val">⏰ {{visit_time}}</span>
        </div>
      </div>

      <div class="consultant-card">
        <div class="consultant-title">👤 Your Dedicated Property Consultant</div>
        <div class="row">
          <span class="label">Consultant Name:</span>
          <span class="val">{{assigned_consultant_name}} ({{assigned_consultant_role}})</span>
        </div>
        <div class="row">
          <span class="label">Direct Contact:</span>
          <span class="val"><a href="tel:{{assigned_consultant_phone}}" style="color: #2563eb; text-decoration: none; font-weight: 700;">{{assigned_consultant_phone}}</a></span>
        </div>
      </div>

      <p style="font-size: 13px; color: #64748b; line-height: 1.6; margin-top: 18px;">
        Our property consultant will meet you at the site to show available unit options, floor plans, and discuss exclusive project offers. If you need any assistance or wish to reschedule, feel free to reply directly to this email.
      </p>
    </div>
    <div class="footer">
      {{company_name}} • Real Estate Advisory • All rights reserved
    </div>
  </div>
</body>
</html>`,
  },
};

/**
 * Replace all {{key}} tags with actual values
 */
export function interpolateVariables(template: string, vars: Record<string, any>): string {
  if (!template) return '';
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'gi');
    result = result.replace(regex, value != null && value !== '' ? String(value) : 'N/A');
  }
  return result;
}

/**
 * Fetch active custom template from DB or fallback to default
 */
export async function getActiveEmailTemplate(
  userId: string | null | undefined,
  templateKey: keyof typeof DEFAULT_EMAIL_TEMPLATES
): Promise<{ subject: string; htmlBody: string }> {
  const defaultTpl = DEFAULT_EMAIL_TEMPLATES[templateKey];

  if (userId) {
    try {
      const [custom] = await db
        .select()
        .from(userEmailTemplates)
        .where(
          and(
            eq(userEmailTemplates.userId, userId),
            eq(userEmailTemplates.name, templateKey),
            eq(userEmailTemplates.isActive, true)
          )
        )
        .limit(1);

      if (custom && custom.subject && custom.htmlBody) {
        return {
          subject: custom.subject,
          htmlBody: custom.htmlBody,
        };
      }
    } catch (e: any) {
      logger.warn(`[SalesTeamEmail] Error fetching custom template for ${userId}/${templateKey}: ${e.message}`, undefined, 'SalesTeamEmail');
    }
  }

  return {
    subject: defaultTpl.subject,
    htmlBody: defaultTpl.htmlBody,
  };
}

/**
 * Send briefing email to assigned sales executive
 */
export async function sendStaffAssignmentEmail(params: StaffAssignmentEmailParams): Promise<boolean> {
  if (!params.staffEmail || !params.staffEmail.includes('@')) {
    logger.warn(`[SalesTeamEmail] Staff email missing or invalid: ${params.staffEmail}`, undefined, 'SalesTeamEmail');
    return false;
  }

  try {
    const template = await getActiveEmailTemplate(params.userId, 'staff_site_visit_assignment');

    const vars = {
      staff_name: params.staffName || 'Executive',
      client_name: params.clientName || 'Valued Customer',
      client_phone: params.clientPhone || 'Not provided',
      client_email: params.clientEmail || 'Not provided',
      project_name: params.serviceName || 'Property Site Visit',
      service_name: params.serviceName || 'Property Site Visit',
      visit_date: params.appointmentDate,
      visit_time: params.appointmentTime,
      notes: params.notes || 'None provided',
      admin_instructions: params.adminInstructions || 'Please arrive 15 minutes before the scheduled time and bring the project brochure.',
      company_name: 'Calliqo AI Real Estate',
    };

    const subject = interpolateVariables(template.subject, vars);
    const html = interpolateVariables(template.htmlBody, vars);

    const result = await emailService.sendEmail(params.staffEmail, subject, html, undefined, {
      userId: params.userId || undefined,
    });

    if (result.success) {
      logger.info(`[SalesTeamEmail] Sent staff briefing to ${params.staffEmail}`, undefined, 'SalesTeamEmail');
      return true;
    } else {
      logger.warn(`[SalesTeamEmail] Email send returned false for ${params.staffEmail}: ${result.error}`, undefined, 'SalesTeamEmail');
      return false;
    }
  } catch (error: any) {
    logger.error(`[SalesTeamEmail] Error sending staff briefing: ${error.message}`, error, 'SalesTeamEmail');
    return false;
  }
}

/**
 * Send confirmation email to customer
 */
export async function sendClientConfirmationEmail(params: ClientConfirmationEmailParams): Promise<boolean> {
  if (!params.clientEmail || !params.clientEmail.includes('@')) {
    return false;
  }

  try {
    const template = await getActiveEmailTemplate(params.userId, 'client_site_visit_confirmation');

    const vars = {
      client_name: params.clientName || 'Valued Customer',
      project_name: params.serviceName || 'Property Site Visit',
      service_name: params.serviceName || 'Property Site Visit',
      visit_date: params.appointmentDate,
      visit_time: params.appointmentTime,
      assigned_consultant_name: params.staffName || 'Dedicated Property Consultant',
      assigned_consultant_phone: params.staffPhone || '',
      assigned_consultant_role: params.staffRole || 'Property Consultant',
      company_name: 'Calliqo AI Real Estate',
    };

    const subject = interpolateVariables(template.subject, vars);
    const html = interpolateVariables(template.htmlBody, vars);

    const result = await emailService.sendEmail(params.clientEmail, subject, html, undefined, {
      userId: params.userId || undefined,
    });

    if (result.success) {
      logger.info(`[SalesTeamEmail] Sent client confirmation to ${params.clientEmail}`, undefined, 'SalesTeamEmail');
      return true;
    } else {
      logger.warn(`[SalesTeamEmail] Client email returned false for ${params.clientEmail}: ${result.error}`, undefined, 'SalesTeamEmail');
      return false;
    }
  } catch (error: any) {
    logger.error(`[SalesTeamEmail] Error sending client confirmation: ${error.message}`, error, 'SalesTeamEmail');
    return false;
  }
}
