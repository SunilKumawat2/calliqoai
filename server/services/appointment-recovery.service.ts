'use strict';
/**
 * ============================================================
 * Calliqo AI - Appointment Reminders, No-Show Recovery,
 * Smart Auto-Assignment & 2-Way External CRM Sync Service
 * ============================================================
 */

import { db } from '../db';
import {
  appointments,
  salesTeamMembers,
  scheduledFollowUps,
  leads,
  crmWhitelabelConfigs,
  leadSourceIntegrations,
  notifications,
  agents,
} from '@shared/schema';
import { eq, and, desc, or, sql } from 'drizzle-orm';
import { logger } from '../utils/logger';
import { sendStaffAssignmentEmail, sendClientConfirmationEmail } from './sales-team-email';
import { updateCalendarEvent } from './google-calendar/google-calendar.service';

export class AppointmentRecoveryService {
  private static isSchedulerRunning = false;
  private static schedulerTimer: NodeJS.Timeout | null = null;

  /**
   * Parse appointmentDate (YYYY-MM-DD) + appointmentTime (HH:mm or HH:mm AM/PM) into a JS Date
   */
  static parseAppointmentDateTime(dateStr: string, timeStr: string): Date | null {
    try {
      if (!dateStr) return null;
      const cleanDate = String(dateStr).trim().slice(0, 10);
      const rawTime = String(timeStr || '10:00').trim();

      let hours = 10;
      let minutes = 0;

      const ampmMatch = rawTime.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
      if (ampmMatch) {
        hours = parseInt(ampmMatch[1], 10);
        minutes = parseInt(ampmMatch[2], 10);
        const period = ampmMatch[3].toUpperCase();
        if (period === 'PM' && hours < 12) hours += 12;
        if (period === 'AM' && hours === 12) hours = 0;
      } else {
        const parts = rawTime.split(':');
        if (parts.length >= 2) {
          hours = parseInt(parts[0], 10) || 10;
          minutes = parseInt(parts[1], 10) || 0;
        }
      }

      const iso = `${cleanDate}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00+05:30`;
      const dt = new Date(iso);
      return isNaN(dt.getTime()) ? null : dt;
    } catch {
      return null;
    }
  }

  /**
   * 1. Send Pre-Appointment Reminder (WhatsApp + Email + optional AI Voice Call)
   */
  static async sendAppointmentReminder(params: {
    appointmentId: string;
    userId: string;
    reminderType?: '24h' | '1h' | 'manual';
    triggerVoiceCall?: boolean;
  }): Promise<{
    success: boolean;
    whatsappSent: boolean;
    emailSent: boolean;
    voiceCallScheduled: boolean;
  }> {
    const { appointmentId, userId, reminderType = 'manual', triggerVoiceCall = false } = params;

    const [apt] = await db
      .select()
      .from(appointments)
      .where(and(eq(appointments.id, appointmentId), eq(appointments.userId, userId)))
      .limit(1);

    if (!apt) {
      throw new Error('Appointment not found');
    }

    let businessName = 'Our Office';
    let appointmentTerm = apt.serviceName || 'Site Visit / Appointment';
    try {
      const [wl] = await db
        .select()
        .from(crmWhitelabelConfigs)
        .where(eq(crmWhitelabelConfigs.userId, userId))
        .limit(1);
      if (wl?.businessName) businessName = wl.businessName;
      if (!apt.serviceName && wl?.appointmentTerm) appointmentTerm = wl.appointmentTerm;
    } catch (_) {}

    let cleanPhone = (apt.contactPhone || '').trim();
    if (cleanPhone && !cleanPhone.startsWith('+')) {
      cleanPhone = `+${cleanPhone}`;
    }

    // A. Send WhatsApp Reminder
    let whatsappSent = false;
    try {
      const { metaWhatsAppService } = await import('../../plugins/messaging/services/meta-whatsapp.service').catch(
        () => ({ metaWhatsAppService: null as any })
      );
      if (metaWhatsAppService && typeof metaWhatsAppService.sendTextMessage === 'function' && cleanPhone) {
        const staffLine = apt.assignedStaffName
          ? `\n👤 एग्जीक्यूटिव: ${apt.assignedStaffName}${apt.assignedStaffPhone ? ` (${apt.assignedStaffPhone})` : ''}`
          : '';
        const msg = `नमस्ते ${apt.contactName || 'जी'}! 🔔\n\nयह ${businessName} की ओर से आपके आगामी *${appointmentTerm}* का रिमाइंडर है:\n📅 तारीख: ${apt.appointmentDate}\n⏰ समय: ${apt.appointmentTime}${staffLine}\n\nयदि आप समय बदलना (Reschedule) चाहते हैं, तो कृपया इसी मैसेज का रिप्लाई करें। धन्यवाद!`;
        await metaWhatsAppService.sendTextMessage(userId, cleanPhone, msg);
        whatsappSent = true;
      }
    } catch (waErr: any) {
      logger.warn(`[AppointmentRecovery] WhatsApp reminder notice: ${waErr?.message}`, undefined, 'AppointmentRecovery');
    }

    // B. Send Email Reminder if contactEmail exists
    let emailSent = false;
    if (apt.contactEmail) {
      try {
        emailSent = await sendClientConfirmationEmail({
          userId,
          clientEmail: apt.contactEmail,
          clientName: apt.contactName,
          serviceName: `${appointmentTerm} (Reminder)`,
          appointmentDate: String(apt.appointmentDate),
          appointmentTime: String(apt.appointmentTime),
          staffName: apt.assignedStaffName || null,
          staffPhone: apt.assignedStaffPhone || null,
        });
      } catch (_) {}
    }

    // C. Optional AI Voice Reminder Call
    let voiceCallScheduled = false;
    if (triggerVoiceCall && cleanPhone) {
      try {
        const userAgents = await db
          .select({ id: agents.id, elevenLabsAgentId: agents.elevenLabsAgentId })
          .from(agents)
          .where(eq(agents.userId, userId));
        const preferredAgent = userAgents.find((a) => Boolean(a.elevenLabsAgentId)) || userAgents[0];

        await db.insert(scheduledFollowUps).values({
          userId,
          agentId: apt.callId ? null : (preferredAgent?.id || null),
          callId: apt.callId || null,
          phoneNumber: cleanPhone,
          customerName: apt.contactName,
          preferredTimeText: `Appointment Reminder (${apt.appointmentDate} ${apt.appointmentTime})`,
          contextNote: `Appointment Reminder Call for ${apt.contactName}. Scheduled ${appointmentTerm} with ${businessName} on ${apt.appointmentDate} at ${apt.appointmentTime}${apt.assignedStaffName ? ` (Assigned Staff: ${apt.assignedStaffName})` : ''}. Politely remind the customer, confirm their attendance, or offer to reschedule if needed.`,
          scheduledAt: new Date(Date.now() + 10 * 1000),
          status: 'pending',
        });
        voiceCallScheduled = true;
      } catch (vErr: any) {
        logger.warn(`[AppointmentRecovery] Voice reminder schedule error: ${vErr?.message}`, undefined, 'AppointmentRecovery');
      }
    }

    // D. Update appointment metadata
    const existingMeta = (apt.metadata && typeof apt.metadata === 'object') ? apt.metadata : {};
    const updatedMeta = {
      ...existingMeta,
      lastReminderSentAt: new Date().toISOString(),
      lastReminderType: reminderType,
      reminder24hSent: reminderType === '24h' ? true : existingMeta.reminder24hSent,
      reminder1hSent: reminderType === '1h' ? true : existingMeta.reminder1hSent,
      reminderCount: (Number(existingMeta.reminderCount) || 0) + 1,
    };

    await db
      .update(appointments)
      .set({
        metadata: updatedMeta,
        updatedAt: new Date(),
      })
      .where(eq(appointments.id, apt.id));

    return {
      success: true,
      whatsappSent,
      emailSent,
      voiceCallScheduled,
    };
  }

  /**
   * 2. Trigger No-Show Recovery (Marks No-Show + Schedules AI Recovery Call + Sends WhatsApp/Email)
   */
  static async triggerNoShowRecovery(params: {
    appointmentId: string;
    userId: string;
    delaySeconds?: number;
    notes?: string;
  }): Promise<{
    success: boolean;
    appointment: any;
    scheduledFollowUpId?: string;
    whatsappSent: boolean;
  }> {
    const { appointmentId, userId, delaySeconds = 30, notes } = params;

    const [apt] = await db
      .select()
      .from(appointments)
      .where(and(eq(appointments.id, appointmentId), eq(appointments.userId, userId)))
      .limit(1);

    if (!apt) {
      throw new Error('Appointment not found');
    }

    let businessName = 'Our Office';
    let appointmentTerm = apt.serviceName || 'Site Visit / Appointment';
    try {
      const [wl] = await db
        .select()
        .from(crmWhitelabelConfigs)
        .where(eq(crmWhitelabelConfigs.userId, userId))
        .limit(1);
      if (wl?.businessName) businessName = wl.businessName;
      if (!apt.serviceName && wl?.appointmentTerm) appointmentTerm = wl.appointmentTerm;
    } catch (_) {}

    const existingMeta = (apt.metadata && typeof apt.metadata === 'object') ? apt.metadata : {};
    const updatedMeta = {
      ...existingMeta,
      noShowMarkedAt: new Date().toISOString(),
      noShowRecoveryTriggered: true,
      noShowRecoveryCount: (Number(existingMeta.noShowRecoveryCount) || 0) + 1,
    };

    const [updatedAppointment] = await db
      .update(appointments)
      .set({
        status: 'no_show',
        statusReason: notes?.trim() || 'Missed appointment (No-Show) — AI Recovery initiated',
        metadata: updatedMeta,
        updatedAt: new Date(),
      })
      .where(eq(appointments.id, apt.id))
      .returning();

    // Sync to Google Calendar if linked
    if (updatedAppointment.googleCalendarEventId) {
      updateCalendarEvent(userId, updatedAppointment.googleCalendarEventId, {
        id: updatedAppointment.id,
        contactName: updatedAppointment.contactName,
        contactPhone: updatedAppointment.contactPhone,
        contactEmail: updatedAppointment.contactEmail,
        appointmentDate: String(updatedAppointment.appointmentDate),
        appointmentTime: String(updatedAppointment.appointmentTime),
        duration: updatedAppointment.duration || 30,
        serviceName: updatedAppointment.serviceName,
        notes: updatedAppointment.notes,
        status: 'no_show',
        statusReason: updatedAppointment.statusReason,
        assignedStaffName: updatedAppointment.assignedStaffName,
        assignedStaffPhone: updatedAppointment.assignedStaffPhone,
      }).catch(() => {});
    }

    let cleanPhone = (apt.contactPhone || '').trim();
    if (cleanPhone && !cleanPhone.startsWith('+')) {
      cleanPhone = `+${cleanPhone}`;
    }

    // Schedule AI No-Show Recovery Call in scheduledFollowUps
    let scheduledFollowUpId: string | undefined;
    if (cleanPhone) {
      try {
        const userAgents = await db
          .select({ id: agents.id, elevenLabsAgentId: agents.elevenLabsAgentId })
          .from(agents)
          .where(eq(agents.userId, userId));
        const preferredAgent = userAgents.find((a) => Boolean(a.elevenLabsAgentId)) || userAgents[0];

        const [newFollowUp] = await db
          .insert(scheduledFollowUps)
          .values({
            userId,
            agentId: apt.callId ? null : (preferredAgent?.id || null),
            callId: apt.callId || null,
            phoneNumber: cleanPhone,
            customerName: apt.contactName,
            preferredTimeText: 'Appointment No-Show Recovery',
            contextNote: `NO-SHOW RECOVERY CALL: Customer ${apt.contactName} had booked a ${appointmentTerm} with ${businessName} on ${apt.appointmentDate} at ${apt.appointmentTime}, but could not attend. Politely check in with them, ask if they were busy, and offer to reschedule their ${appointmentTerm} to a new convenient date and time.`,
            scheduledAt: new Date(Date.now() + 10 * 1000),
            status: 'pending',
          })
          .returning();

        scheduledFollowUpId = newFollowUp?.id;
      } catch (fuErr: any) {
        logger.warn(`[AppointmentRecovery] Error scheduling no-show recovery call: ${fuErr?.message}`, undefined, 'AppointmentRecovery');
      }
    }

    // Send WhatsApp No-Show Recovery Message
    let whatsappSent = false;
    try {
      const { metaWhatsAppService } = await import('../../plugins/messaging/services/meta-whatsapp.service').catch(
        () => ({ metaWhatsAppService: null as any })
      );
      if (metaWhatsAppService && typeof metaWhatsAppService.sendTextMessage === 'function' && cleanPhone) {
        const msg = `नमस्ते ${apt.contactName || 'जी'}! 🙏\n\nआज ${apt.appointmentDate} को ${apt.appointmentTime} बजे ${businessName} के साथ आपका *${appointmentTerm}* शेड्यूल था, लेकिन शायद व्यस्तता के कारण आप नहीं आ पाए।\n\nहमारा AI असिस्टेंट आपका नया समय (Reschedule) बुक करने के लिए आपको कॉल कर रहा है, या आप सीधे यहीं अपना पसंदीदा दिन और समय रिप्लाई कर सकते हैं!`;
        await metaWhatsAppService.sendTextMessage(userId, cleanPhone, msg);
        whatsappSent = true;
      }
    } catch (_) {}

    // Push 2-way event to external CRM if configured
    this.pushEventToExternalCrm(userId, 'appointment.no_show', {
      appointmentId: updatedAppointment.id,
      contactName: updatedAppointment.contactName,
      contactPhone: updatedAppointment.contactPhone,
      contactEmail: updatedAppointment.contactEmail,
      appointmentDate: updatedAppointment.appointmentDate,
      appointmentTime: updatedAppointment.appointmentTime,
      serviceName: updatedAppointment.serviceName,
      status: 'no_show',
      assignedStaffName: updatedAppointment.assignedStaffName,
    }).catch(() => {});

    return {
      success: true,
      appointment: updatedAppointment,
      scheduledFollowUpId,
      whatsappSent,
    };
  }

  /**
   * 3. Smart Auto-Assignment (Project/City Match + Round-Robin Workload Balancing)
   */
  static async autoAssignAppointment(userId: string, appointmentId: string): Promise<any | null> {
    const [apt] = await db
      .select()
      .from(appointments)
      .where(and(eq(appointments.id, appointmentId), eq(appointments.userId, userId)))
      .limit(1);

    if (!apt) return null;

    const activeStaff = await db
      .select()
      .from(salesTeamMembers)
      .where(and(eq(salesTeamMembers.userId, userId), eq(salesTeamMembers.isActive, true)));

    if (activeStaff.length === 0) {
      return null;
    }

    const searchContext = `${apt.serviceName || ''} ${apt.notes || ''}`.toLowerCase();

    // 1. Score staff by project/city match first, then lowest totalVisitsCount (Round-Robin)
    const scoredStaff = activeStaff.map((staff) => {
      let matchScore = 0;
      if (staff.city && searchContext.includes(staff.city.toLowerCase())) {
        matchScore += 10;
      }
      if (Array.isArray(staff.assignedProjects)) {
        for (const proj of staff.assignedProjects) {
          if (proj && searchContext.includes(String(proj).toLowerCase())) {
            matchScore += 20;
            break;
          }
        }
      }
      return { staff, matchScore };
    });

    scoredStaff.sort((a, b) => {
      if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
      return (a.staff.totalVisitsCount || 0) - (b.staff.totalVisitsCount || 0);
    });

    const chosen = scoredStaff[0].staff;

    const [updated] = await db
      .update(appointments)
      .set({
        assignedStaffId: chosen.id,
        assignedStaffName: chosen.name,
        assignedStaffPhone: chosen.phone,
        updatedAt: new Date(),
      })
      .where(eq(appointments.id, apt.id))
      .returning();

    await db
      .update(salesTeamMembers)
      .set({
        totalVisitsCount: sql`${salesTeamMembers.totalVisitsCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(salesTeamMembers.id, chosen.id));

    if (chosen.email) {
      sendStaffAssignmentEmail({
        userId,
        staffEmail: chosen.email,
        staffName: chosen.name,
        clientName: updated.contactName,
        clientPhone: updated.contactPhone,
        clientEmail: updated.contactEmail,
        serviceName: updated.serviceName || 'Property Site Visit',
        appointmentDate: String(updated.appointmentDate),
        appointmentTime: String(updated.appointmentTime),
        notes: updated.notes,
        adminInstructions: 'Auto-assigned via Smart Round-Robin / Project Match',
      }).catch(() => {});
    }

    if (updated.googleCalendarEventId) {
      updateCalendarEvent(userId, updated.googleCalendarEventId, {
        id: updated.id,
        contactName: updated.contactName,
        contactPhone: updated.contactPhone,
        contactEmail: updated.contactEmail,
        appointmentDate: String(updated.appointmentDate),
        appointmentTime: String(updated.appointmentTime),
        duration: updated.duration || 30,
        serviceName: updated.serviceName,
        notes: updated.notes,
        status: updated.status,
        statusReason: updated.statusReason,
        assignedStaffName: updated.assignedStaffName,
        assignedStaffPhone: updated.assignedStaffPhone,
      }).catch(() => {});
    }

    return updated;
  }

  /**
   * Bulk Auto-Assign all currently unassigned appointments for a user
   */
  static async autoAssignAllUnassigned(userId: string): Promise<{ assignedCount: number; appointments: any[] }> {
    const allVisits = await db
      .select()
      .from(appointments)
      .where(eq(appointments.userId, userId));

    const unassigned = allVisits.filter(
      (v) =>
        (!v.assignedStaffId || v.assignedStaffId === 'unassigned' || v.assignedStaffId === '') &&
        v.status !== 'cancelled'
    );

    const results: any[] = [];
    for (const visit of unassigned) {
      const assigned = await this.autoAssignAppointment(userId, visit.id);
      if (assigned) results.push(assigned);
    }

    return {
      assignedCount: results.length,
      appointments: results,
    };
  }

  /**
   * 4. Two-Way External CRM Sync (Outbound Push to Zoho CRM / HubSpot / Custom Webhook)
   */
  static async pushEventToExternalCrm(
    userId: string,
    eventType: string,
    payload: Record<string, any>
  ): Promise<{ syncedCount: number }> {
    try {
      const integrations = await db
        .select()
        .from(leadSourceIntegrations)
        .where(and(eq(leadSourceIntegrations.userId, userId), eq(leadSourceIntegrations.status, 'active')));

      let syncedCount = 0;
      for (const integ of integrations) {
        const outboundUrl = (integ.portalConfig as any)?.outboundWebhookUrl;
        if (!outboundUrl || typeof outboundUrl !== 'string' || !outboundUrl.startsWith('http')) {
          continue;
        }

        try {
          const response = await fetch(outboundUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(integ.apiKey ? { Authorization: `Bearer ${integ.apiKey}`, 'X-API-Key': integ.apiKey } : {}),
            },
            body: JSON.stringify({
              event: eventType,
              source: 'calliqo_ai_crm',
              integrationId: integ.id,
              integrationName: integ.name,
              timestamp: new Date().toISOString(),
              data: payload,
            }),
          });
          if (response.ok) {
            syncedCount++;
          }
        } catch (err: any) {
          logger.warn(`[AppointmentRecovery] Outbound CRM webhook error for ${integ.name}: ${err.message}`);
        }
      }

      return { syncedCount };
    } catch {
      return { syncedCount: 0 };
    }
  }

  /**
   * 5. Background Scheduler: Checks every 5 minutes for upcoming 24h / 1h reminders
   */
  static startScheduler(): void {
    if (this.isSchedulerRunning) return;
    this.isSchedulerRunning = true;

    console.log('🔔 [AppointmentRecovery] Pre-Appointment Reminder & No-Show Detection Service started (every 5m)');
    this.schedulerTimer = setInterval(() => {
      this.processUpcomingReminders().catch((err) => {
        logger.warn(`[AppointmentRecovery] Scheduler cycle error: ${err?.message}`);
      });
    }, 5 * 60 * 1000);
  }

  static async processUpcomingReminders(): Promise<void> {
    const activeAppointments = await db
      .select()
      .from(appointments)
      .where(
        or(
          eq(appointments.status, 'scheduled'),
          eq(appointments.status, 'confirmed'),
          eq(appointments.status, 'rescheduled')
        )
      )
      .limit(200);

    const now = Date.now();
    for (const apt of activeAppointments) {
      const dt = this.parseAppointmentDateTime(String(apt.appointmentDate), String(apt.appointmentTime));
      if (!dt) continue;

      const diffHours = (dt.getTime() - now) / (1000 * 60 * 60);
      const meta = (apt.metadata && typeof apt.metadata === 'object') ? apt.metadata : {};

      // 1-Hour Reminder window (between 0.5h and 1.25h before appointment)
      if (diffHours > 0.4 && diffHours <= 1.25 && !meta.reminder1hSent) {
        await this.sendAppointmentReminder({
          appointmentId: apt.id,
          userId: apt.userId,
          reminderType: '1h',
        }).catch(() => {});
      }
      // 24-Hour Reminder window (between 22h and 25h before appointment)
      else if (diffHours > 22 && diffHours <= 25 && !meta.reminder24hSent) {
        await this.sendAppointmentReminder({
          appointmentId: apt.id,
          userId: apt.userId,
          reminderType: '24h',
        }).catch(() => {});
      }
    }
  }
}

