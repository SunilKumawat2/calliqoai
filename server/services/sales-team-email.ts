'use strict';
/**
 * ============================================================
 * Calliqo AI - Sales Team & Site Visit Email Notification Service
 * 
 * Sends automated, branded email notifications to:
 * 1. Sales Executive (Staff briefing with customer details & notes)
 * 2. Customer / Client (Site visit confirmation with executive details)
 * ============================================================
 */

import { emailService } from './email-service';
import { logger } from '../utils/logger';

export interface StaffAssignmentEmailParams {
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
  clientEmail: string;
  clientName: string;
  serviceName: string;
  appointmentDate: string;
  appointmentTime: string;
  staffName?: string | null;
  staffPhone?: string | null;
  staffRole?: string | null;
}

export function buildStaffAssignmentEmailHtml(params: StaffAssignmentEmailParams): string {
  return `
<!DOCTYPE html>
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
    .card-title.amber { color: #d97706; }
    .row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px dashed #e2e8f0; font-size: 14px; }
    .row:last-child { border-bottom: none; }
    .label { color: #64748b; font-weight: 500; }
    .val { color: #0f172a; font-weight: 600; text-align: right; }
    .btn { display: inline-block; background: #2563eb; color: #ffffff !important; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px; margin-top: 20px; box-shadow: 0 4px 10px rgba(37,99,235,0.25); text-align: center; }
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
        Namaste <strong>${params.staffName}</strong>,<br>
        A new customer property site visit has been booked and assigned to you via <strong>Calliqo AI</strong>. Please review the visit schedule and client requirements below.
      </div>

      <div class="card">
        <div class="card-title blue">📍 Property & Schedule Details</div>
        <div class="row">
          <span class="label">Project / Property:</span>
          <span class="val">${params.serviceName}</span>
        </div>
        <div class="row">
          <span class="label">Visit Date:</span>
          <span class="val">📅 ${params.appointmentDate}</span>
        </div>
        <div class="row">
          <span class="label">Scheduled Time:</span>
          <span class="val">⏰ ${params.appointmentTime}</span>
        </div>
      </div>

      <div class="card">
        <div class="card-title emerald">👤 Customer Information</div>
        <div class="row">
          <span class="label">Client Name:</span>
          <span class="val">${params.clientName}</span>
        </div>
        <div class="row">
          <span class="label">Mobile / WhatsApp:</span>
          <span class="val"><a href="tel:${params.clientPhone}" style="color: #2563eb; text-decoration: none;">${params.clientPhone}</a></span>
        </div>
        ${params.clientEmail ? `
        <div class="row">
          <span class="label">Client Email:</span>
          <span class="val">${params.clientEmail}</span>
        </div>` : ''}

        ${params.notes ? `
        <div class="notes-box">
          <strong>Customer Preference / Requirement:</strong><br>
          ${params.notes}
        </div>` : ''}
      </div>

      ${params.adminInstructions ? `
      <div class="instruction-box">
        <strong>📝 Instructions from Admin / Management:</strong><br>
        ${params.adminInstructions}
      </div>` : ''}

      <div style="text-align: center; margin: 24px 0 10px;">
        <a href="https://calliqoai.com/app/crm" class="btn">Open Site Visit in CRM</a>
      </div>
    </div>
    <div class="footer">
      Sent automatically via Calliqo AI • Real Estate Lead Management System
    </div>
  </div>
</body>
</html>
  `;
}

export function buildClientConfirmationEmailHtml(params: ClientConfirmationEmailParams): string {
  return `
<!DOCTYPE html>
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
        Dear <strong>${params.clientName}</strong>,<br>
        Thank you for your interest! Your property site visit has been successfully confirmed. Here are the details of your scheduled visit:
      </div>

      <div class="card">
        <div class="card-title">📅 Schedule & Property Information</div>
        <div class="row">
          <span class="label">Project / Property:</span>
          <span class="val">${params.serviceName}</span>
        </div>
        <div class="row">
          <span class="label">Date:</span>
          <span class="val">📅 ${params.appointmentDate}</span>
        </div>
        <div class="row">
          <span class="label">Time:</span>
          <span class="val">⏰ ${params.appointmentTime}</span>
        </div>
      </div>

      ${params.staffName ? `
      <div class="consultant-card">
        <div class="consultant-title">👤 Your Dedicated Property Consultant</div>
        <div class="row">
          <span class="label">Consultant Name:</span>
          <span class="val">${params.staffName} (${params.staffRole || 'Property Consultant'})</span>
        </div>
        ${params.staffPhone ? `
        <div class="row">
          <span class="label">Direct Contact:</span>
          <span class="val"><a href="tel:${params.staffPhone}" style="color: #2563eb; text-decoration: none; font-weight: 700;">${params.staffPhone}</a></span>
        </div>` : ''}
      </div>` : ''}

      <p style="font-size: 13px; color: #64748b; line-height: 1.6; margin-top: 18px;">
        Our property consultant will meet you at the site to show available unit options, floor plans, and discuss exclusive project offers. If you need any assistance or wish to reschedule, feel free to reply directly to this email.
      </p>
    </div>
    <div class="footer">
      Calliqo Real Estate Advisory • All rights reserved
    </div>
  </div>
</body>
</html>
  `;
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
    const html = buildStaffAssignmentEmailHtml(params);
    const subject = `🏢 New Site Visit Assigned: ${params.clientName} - ${params.serviceName}`;
    const result = await emailService.sendEmail(params.staffEmail, subject, html);
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
    const html = buildClientConfirmationEmailHtml(params);
    const subject = `✅ Property Site Visit Confirmed: ${params.serviceName}`;
    const result = await emailService.sendEmail(params.clientEmail, subject, html);
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
