'use strict';
/**
 * ============================================================
 * Calliqo AI - Dynamic Appointment Reminders, No-Show Recovery,
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
  userEmailTemplates,
  agents,
} from '@shared/schema';
import { eq, and, desc, or, sql } from 'drizzle-orm';
import { logger } from '../utils/logger';
import { sendStaffAssignmentEmail, sendClientConfirmationEmail } from './sales-team-email';
import { updateCalendarEvent } from './google-calendar/google-calendar.service';

export interface BookingTypeTemplate {
  id: string;
  label: string;
  serviceKeywords: string;
  voiceScript: string;
  whatsappMessage: string;
}

export interface ReminderAutomationConfig {
  // 1. Automated Pre-Appointment Reminder Rules
  autoReminderEnabled: boolean;
  reminder1OffsetMinutes: number; // e.g., 1440 (24h), 120 (2h), 60 (1h), 30 (30m), or custom
  reminder2Enabled: boolean;
  reminder2OffsetMinutes: number; // e.g., 60 (1h), 30 (30m), or custom
  reminderVoiceCallEnabled: boolean;
  reminderAgentId: string;        // 'default' or specific agent UUID
  reminderWhatsappEnabled: boolean;
  reminderEmailEnabled: boolean;
  reminderChannels: {
    whatsapp: boolean;
    email: boolean;
    voiceCall: boolean;
  };
  activeBookingPreset: string;    // 'default' | 'doctor_clinic' | 'real_estate' | 'custom'
  bookingTypeTemplates: BookingTypeTemplate[];

  // 2. Automated No-Show Recovery Rules
  autoNoShowEnabled: boolean;
  noShowAfterMinutes: number;     // e.g., 30, 60, 120, or custom minutes after appointment time
  noShowVoiceCallEnabled: boolean;
  noShowAgentId: string;          // 'default' or specific agent UUID
  noShowWhatsappEnabled: boolean;
  noShowChannels: {
    whatsapp: boolean;
    voiceCall: boolean;
  };
  noShowVoiceScript: string;
  noShowWhatsappMessage: string;
}

const CONFIG_TEMPLATE_NAME = '__CRM_AUTO_REMINDER_CONFIG__';

export class AppointmentRecoveryService {
  private static isSchedulerRunning = false;
  private static schedulerTimer: NodeJS.Timeout | null = null;

  static getDefaultAutomationConfig(): ReminderAutomationConfig {
    return {
      autoReminderEnabled: true,
      reminder1OffsetMinutes: 1440, // 24 Hours Before
      reminder2Enabled: true,
      reminder2OffsetMinutes: 60,   // 1 Hour Before
      reminderVoiceCallEnabled: true,
      reminderAgentId: 'default',
      reminderWhatsappEnabled: true,
      reminderEmailEnabled: true,
      reminderChannels: {
        whatsapp: true,
        email: true,
        voiceCall: true,
      },
      activeBookingPreset: 'default',
      bookingTypeTemplates: [
        {
          id: 'default',
          label: 'General Appointment / Service Booking (Default)',
          serviceKeywords: 'appointment, consultation, meeting, general, booking',
          voiceScript:
            'नमस्ते {customer_name} जी, मैं {business_name} से बात कर रहा हूँ। यह आपकी आगामी {service_name} अपॉइंटमेंट ({date} को {time} बजे) के रिमाइंडर के लिए कॉल है। क्या आप निर्धारित समय पर आ रहे हैं, या इसे री-शेड्यूल करना चाहेंगे?',
          whatsappMessage:
            'नमस्ते {customer_name} जी! 🔔\n\nयह *{business_name}* की ओर से आपकी आगामी *{service_name}* अपॉइंटमेंट का रिमाइंडर है:\n📅 तारीख: {date}\n⏰ समय: {time}\n👤 एग्जीक्यूटिव: {staff_name}\n\nयदि आप समय बदलना (Reschedule) चाहते हैं, तो कृपया इसी मैसेज का रिप्लाई करें। धन्यवाद!',
        },
        {
          id: 'doctor_clinic',
          label: '🏥 Doctor / Hospital / Clinic Consultation',
          serviceKeywords: 'doctor, clinic, hospital, opd, checkup, dental, neurology, cardiology, patient',
          voiceScript:
            'नमस्ते {customer_name} जी, मैं {business_name} क्लिनिक से बात कर रहा हूँ। आपकी {service_name} की अपॉइंटमेंट {date} को {time} बजे {staff_name} के साथ निर्धारित है। कृपया पुष्टि करें कि क्या आप समय पर क्लिनिक आ रहे हैं?',
          whatsappMessage:
            'नमस्ते {customer_name} जी! 🏥\n\n*{business_name}* में आपकी *{service_name}* अपॉइंटमेंट का रिमाइंडर:\n📅 तारीख: {date}\n⏰ समय: {time}\n👨‍⚕️ डॉक्टर/विशेषज्ञ: {staff_name}\n\nकृपया समय से 10 मिनट पहले पधारें। समय बदलने के लिए रिप्लाई करें।',
        },
        {
          id: 'real_estate',
          label: '🏢 Real Estate / Property Site Visit',
          serviceKeywords: 'site visit, property, flat, villa, plot, real estate, bhk, project, home',
          voiceScript:
            'नमस्ते {customer_name} जी, मैं {business_name} से बात कर रहा हूँ। आपकी {service_name} प्रॉपर्टी साइट विजिट {date} को {time} बजे शेड्यूल है, और हमारे एग्जीक्यूटिव {staff_name} आपको अटेंड करेंगे। क्या आप निर्धारित समय पर साइट विजिट के लिए आ रहे हैं?',
          whatsappMessage:
            'नमस्ते {customer_name} जी! 🏢\n\n*{business_name}* के साथ आपकी *{service_name}* प्रॉपर्टी साइट विजिट का रिमाइंडर:\n📅 तारीख: {date}\n⏰ समय: {time}\n👤 साइट एग्जीक्यूटिव: {staff_name} ({staff_phone})\n\nलोकेशन या समय बदलने के लिए इसी मैसेज पर रिप्लाई करें!',
        },
        {
          id: 'custom',
          label: '✏️ Custom Booking Type / Special Campaign',
          serviceKeywords: 'custom, special, vip',
          voiceScript:
            'नमस्ते {customer_name} जी, मैं {business_name} से बात कर रहा हूँ। आपकी {service_name} बुकिंग {date} को {time} बजे शेड्यूल है। क्या आप निर्धारित समय पर उपलब्ध रहेंगे?',
          whatsappMessage:
            'नमस्ते {customer_name} जी! 🔔\n\n*{business_name}* में आपकी *{service_name}* बुकिंग ({date} को {time} बजे) का रिमाइंडर। किसी भी सहायता के लिए रिप्लाई करें!',
        },
      ],
      autoNoShowEnabled: true,
      noShowAfterMinutes: 30, // 30 Minutes After Missed Appointment Time
      noShowVoiceCallEnabled: true,
      noShowAgentId: 'default',
      noShowWhatsappEnabled: true,
      noShowChannels: {
        whatsapp: true,
        voiceCall: true,
      },
      noShowVoiceScript:
        'नमस्ते {customer_name} जी, मैं {business_name} से बात कर रहा हूँ। आज {date} को {time} बजे आपकी {service_name} अपॉइंटमेंट शेड्यूल थी, लेकिन शायद व्यस्तता के कारण आप नहीं आ पाए। क्या मैं आपकी अपॉइंटमेंट किसी नए समय या कल के लिए री-शेड्यूल कर दूँ?',
      noShowWhatsappMessage:
        'नमस्ते {customer_name} जी! 🙏\n\nआज {date} को {time} बजे *{business_name}* के साथ आपकी *{service_name}* अपॉइंटमेंट शेड्यूल थी, लेकिन शायद व्यस्तता के कारण आप नहीं आ पाए।\n\nहमारा AI असिस्टेंट आपका नया समय (Reschedule) बुक करने के लिए आपको कॉल कर रहा है, या आप सीधे यहीं अपना पसंदीदा दिन और समय रिप्लाई कर सकते हैं!',
    };
  }

  /**
   * Load Tenant/User Reminder & No-Show Automation Config
   */
  static async getAutomationConfig(userId: string): Promise<ReminderAutomationConfig> {
    const defaults = this.getDefaultAutomationConfig();
    try {
      const [row] = await db
        .select()
        .from(userEmailTemplates)
        .where(and(eq(userEmailTemplates.userId, userId), eq(userEmailTemplates.name, CONFIG_TEMPLATE_NAME)))
        .limit(1);

      if (row && row.designJson && typeof row.designJson === 'object') {
        const saved = row.designJson as Partial<ReminderAutomationConfig>;
        const reminderChannels = {
          whatsapp: saved.reminderChannels?.whatsapp ?? saved.reminderWhatsappEnabled ?? defaults.reminderWhatsappEnabled,
          email: saved.reminderChannels?.email ?? saved.reminderEmailEnabled ?? defaults.reminderEmailEnabled,
          voiceCall: saved.reminderChannels?.voiceCall ?? saved.reminderVoiceCallEnabled ?? defaults.reminderVoiceCallEnabled,
        };
        const noShowChannels = {
          whatsapp: saved.noShowChannels?.whatsapp ?? saved.noShowWhatsappEnabled ?? defaults.noShowWhatsappEnabled,
          voiceCall: saved.noShowChannels?.voiceCall ?? saved.noShowVoiceCallEnabled ?? defaults.noShowVoiceCallEnabled,
        };
        return {
          ...defaults,
          ...saved,
          reminderChannels,
          reminderWhatsappEnabled: reminderChannels.whatsapp,
          reminderEmailEnabled: reminderChannels.email,
          reminderVoiceCallEnabled: reminderChannels.voiceCall,
          noShowChannels,
          noShowWhatsappEnabled: noShowChannels.whatsapp,
          noShowVoiceCallEnabled: noShowChannels.voiceCall,
          bookingTypeTemplates:
            Array.isArray(saved.bookingTypeTemplates) && saved.bookingTypeTemplates.length > 0
              ? saved.bookingTypeTemplates
              : defaults.bookingTypeTemplates,
        };
      }
    } catch (err: any) {
      logger.warn(`[AppointmentRecovery] Error loading config for ${userId}: ${err?.message}`);
    }
    return defaults;
  }

  /**
   * Save Tenant/User Reminder & No-Show Automation Config
   */
  static async saveAutomationConfig(
    userId: string,
    partialConfig: Partial<ReminderAutomationConfig>
  ): Promise<ReminderAutomationConfig> {
    const current = await this.getAutomationConfig(userId);
    const reminderChannels = {
      whatsapp:
        partialConfig.reminderChannels?.whatsapp ??
        partialConfig.reminderWhatsappEnabled ??
        current.reminderChannels.whatsapp,
      email:
        partialConfig.reminderChannels?.email ??
        partialConfig.reminderEmailEnabled ??
        current.reminderChannels.email,
      voiceCall:
        partialConfig.reminderChannels?.voiceCall ??
        partialConfig.reminderVoiceCallEnabled ??
        current.reminderChannels.voiceCall,
    };
    const noShowChannels = {
      whatsapp:
        partialConfig.noShowChannels?.whatsapp ??
        partialConfig.noShowWhatsappEnabled ??
        current.noShowChannels.whatsapp,
      voiceCall:
        partialConfig.noShowChannels?.voiceCall ??
        partialConfig.noShowVoiceCallEnabled ??
        current.noShowChannels.voiceCall,
    };
    const merged: ReminderAutomationConfig = {
      ...current,
      ...partialConfig,
      reminderChannels,
      reminderWhatsappEnabled: reminderChannels.whatsapp,
      reminderEmailEnabled: reminderChannels.email,
      reminderVoiceCallEnabled: reminderChannels.voiceCall,
      noShowChannels,
      noShowWhatsappEnabled: noShowChannels.whatsapp,
      noShowVoiceCallEnabled: noShowChannels.voiceCall,
      bookingTypeTemplates:
        Array.isArray(partialConfig.bookingTypeTemplates) && partialConfig.bookingTypeTemplates.length > 0
          ? partialConfig.bookingTypeTemplates
          : current.bookingTypeTemplates,
    };

    const [existing] = await db
      .select({ id: userEmailTemplates.id })
      .from(userEmailTemplates)
      .where(and(eq(userEmailTemplates.userId, userId), eq(userEmailTemplates.name, CONFIG_TEMPLATE_NAME)))
      .limit(1);

    if (existing) {
      await db
        .update(userEmailTemplates)
        .set({
          designJson: merged as any,
          updatedAt: new Date(),
        })
        .where(eq(userEmailTemplates.id, existing.id));
    } else {
      await db.insert(userEmailTemplates).values({
        userId,
        name: CONFIG_TEMPLATE_NAME,
        subject: 'CRM Auto Reminder & No-Show Automation Config',
        htmlBody: 'JSON_CONFIG',
        variables: [],
        isActive: true,
        designJson: merged as any,
      });
    }

    return merged;
  }

  /**
   * Replace {customer_name}, {service_name}, {date}, {time}, {staff_name}, {staff_phone}, {business_name}
   */
  static interpolateTemplate(
    template: string,
    vars: {
      customerName: string;
      serviceName: string;
      date: string;
      time: string;
      staffName: string;
      staffPhone: string;
      businessName: string;
    }
  ): string {
    if (!template) return '';
    return template
      .replace(/\{customer_name\}/gi, vars.customerName || 'जी')
      .replace(/\{service_name\}/gi, vars.serviceName || 'अपॉइंटमेंट')
      .replace(/\{date\}/gi, vars.date || '')
      .replace(/\{time\}/gi, vars.time || '')
      .replace(/\{staff_name\}/gi, vars.staffName || 'हमारी टीम')
      .replace(/\{staff_phone\}/gi, vars.staffPhone || '')
      .replace(/\{business_name\}/gi, vars.businessName || 'हमारे ऑफिस');
  }

  /**
   * Automatically pick the best BookingTypeTemplate for an appointment based on serviceName keywords or activeBookingPreset
   */
  static resolveBookingTemplate(
    config: ReminderAutomationConfig,
    serviceName?: string | null,
    overridePresetId?: string
  ): BookingTypeTemplate {
    const templates = config.bookingTypeTemplates || this.getDefaultAutomationConfig().bookingTypeTemplates;
    if (overridePresetId) {
      const exact = templates.find((t) => t.id === overridePresetId);
      if (exact) return exact;
    }

    // 1. Check keyword match against appointment's serviceName
    const cleanService = (serviceName || '').toLowerCase().trim();
    if (cleanService) {
      for (const t of templates) {
        if (t.id === 'default') continue;
        const keywords = (t.serviceKeywords || '')
          .split(',')
          .map((k) => k.trim().toLowerCase())
          .filter(Boolean);
        if (keywords.some((kw) => cleanService.includes(kw))) {
          return t;
        }
      }
    }

    // 2. Fallback to user's selected activeBookingPreset or default
    const presetMatch = templates.find((t) => t.id === config.activeBookingPreset);
    return presetMatch || templates[0];
  }

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
   * 1. Send Pre-Appointment Reminder (Uses Dynamic Automation Config + Optional Overrides)
   */
  static async sendAppointmentReminder(params: {
    appointmentId: string;
    userId: string;
    reminderType?: 'reminder1' | 'reminder2' | '24h' | '1h' | 'manual';
    triggerVoiceCall?: boolean;
    triggerWhatsapp?: boolean;
    triggerEmail?: boolean;
    customVoiceScript?: string;
    customWhatsappMessage?: string;
    customAgentId?: string;
    delaySeconds?: number;
  }): Promise<{
    success: boolean;
    whatsappSent: boolean;
    emailSent: boolean;
    voiceCallScheduled: boolean;
  }> {
    const {
      appointmentId,
      userId,
      reminderType = 'manual',
      delaySeconds = 10,
    } = params;

    const [apt] = await db
      .select()
      .from(appointments)
      .where(and(eq(appointments.id, appointmentId), eq(appointments.userId, userId)))
      .limit(1);

    if (!apt) {
      throw new Error('Appointment not found');
    }

    const config = await this.getAutomationConfig(userId);

    let businessName = 'Our Office';
    let appointmentTerm = apt.serviceName || 'Appointment';
    try {
      const [wl] = await db
        .select()
        .from(crmWhitelabelConfigs)
        .where(eq(crmWhitelabelConfigs.userId, userId))
        .limit(1);
      if (wl?.businessName) businessName = wl.businessName;
      if (!apt.serviceName && wl?.appointmentTerm) appointmentTerm = wl.appointmentTerm;
    } catch (_) {}

    const matchedTemplate = this.resolveBookingTemplate(config, apt.serviceName);
    const vars = {
      customerName: apt.contactName || 'जी',
      serviceName: appointmentTerm,
      date: String(apt.appointmentDate || ''),
      time: String(apt.appointmentTime || ''),
      staffName: apt.assignedStaffName || 'हमारी टीम',
      staffPhone: apt.assignedStaffPhone || '',
      businessName,
    };

    const finalWhatsappMsg = params.customWhatsappMessage?.trim()
      ? this.interpolateTemplate(params.customWhatsappMessage, vars)
      : this.interpolateTemplate(matchedTemplate.whatsappMessage, vars);

    const finalVoiceScript = params.customVoiceScript?.trim()
      ? this.interpolateTemplate(params.customVoiceScript, vars)
      : this.interpolateTemplate(matchedTemplate.voiceScript, vars);

    const doWhatsapp = params.triggerWhatsapp !== undefined ? params.triggerWhatsapp : config.reminderWhatsappEnabled;
    const doEmail = params.triggerEmail !== undefined ? params.triggerEmail : config.reminderEmailEnabled;
    const doVoice = params.triggerVoiceCall !== undefined ? params.triggerVoiceCall : config.reminderVoiceCallEnabled;

    let cleanPhone = (apt.contactPhone || '').trim();
    if (cleanPhone && !cleanPhone.startsWith('+')) {
      cleanPhone = `+${cleanPhone}`;
    }

    // A. Send WhatsApp Reminder
    let whatsappSent = false;
    if (doWhatsapp && cleanPhone) {
      try {
        const { metaWhatsAppService } = await import('../../plugins/messaging/services/meta-whatsapp.service').catch(
          () => ({ metaWhatsAppService: null as any })
        );
        if (metaWhatsAppService && typeof metaWhatsAppService.sendTextMessage === 'function') {
          await metaWhatsAppService.sendTextMessage(userId, cleanPhone, finalWhatsappMsg);
          whatsappSent = true;
        }
      } catch (waErr: any) {
        logger.warn(`[AppointmentRecovery] WhatsApp reminder notice: ${waErr?.message}`, undefined, 'AppointmentRecovery');
      }
    }

    // B. Send Email Reminder if contactEmail exists
    let emailSent = false;
    if (doEmail && apt.contactEmail) {
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

    // C. AI Voice Reminder Call
    let voiceCallScheduled = false;
    if (doVoice && cleanPhone) {
      try {
        const chosenAgentConfigId = params.customAgentId || config.reminderAgentId;
        let targetAgentId: string | null = null;

        if (chosenAgentConfigId && chosenAgentConfigId !== 'default') {
          targetAgentId = chosenAgentConfigId;
        } else if (!apt.callId) {
          const userAgents = await db
            .select({ id: agents.id, elevenLabsAgentId: agents.elevenLabsAgentId })
            .from(agents)
            .where(eq(agents.userId, userId));
          const preferredAgent = userAgents.find((a) => Boolean(a.elevenLabsAgentId)) || userAgents[0];
          targetAgentId = preferredAgent?.id || null;
        }

        await db.insert(scheduledFollowUps).values({
          userId,
          agentId: targetAgentId,
          callId: apt.callId || null,
          phoneNumber: cleanPhone,
          customerName: apt.contactName,
          preferredTimeText: `Appointment Reminder (${apt.appointmentDate} ${apt.appointmentTime})`,
          contextNote: `[CUSTOM_GREETING]: ${finalVoiceScript} ||| Appointment Reminder Call for ${apt.contactName}. Scheduled ${appointmentTerm} with ${businessName} on ${apt.appointmentDate} at ${apt.appointmentTime}${apt.assignedStaffName ? ` (Assigned Staff: ${apt.assignedStaffName})` : ''}. Politely remind the customer, confirm their attendance, or offer to reschedule if needed.`,
          scheduledAt: new Date(Date.now() + Math.max(5, delaySeconds) * 1000),
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
      autoReminder1Sent: reminderType === 'reminder1' || reminderType === '24h' ? true : existingMeta.autoReminder1Sent,
      autoReminder2Sent: reminderType === 'reminder2' || reminderType === '1h' ? true : existingMeta.autoReminder2Sent,
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
    customVoiceScript?: string;
    customWhatsappMessage?: string;
    customAgentId?: string;
  }): Promise<{
    success: boolean;
    appointment: any;
    scheduledFollowUpId?: string;
    whatsappSent: boolean;
  }> {
    const { appointmentId, userId, delaySeconds = 10, notes } = params;

    const [apt] = await db
      .select()
      .from(appointments)
      .where(and(eq(appointments.id, appointmentId), eq(appointments.userId, userId)))
      .limit(1);

    if (!apt) {
      throw new Error('Appointment not found');
    }

    const config = await this.getAutomationConfig(userId);

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

    const vars = {
      customerName: apt.contactName || 'जी',
      serviceName: appointmentTerm,
      date: String(apt.appointmentDate || ''),
      time: String(apt.appointmentTime || ''),
      staffName: apt.assignedStaffName || 'हमारी टीम',
      staffPhone: apt.assignedStaffPhone || '',
      businessName,
    };

    const finalVoiceScript = params.customVoiceScript?.trim()
      ? this.interpolateTemplate(params.customVoiceScript, vars)
      : this.interpolateTemplate(config.noShowVoiceScript, vars);

    const finalWhatsappMsg = params.customWhatsappMessage?.trim()
      ? this.interpolateTemplate(params.customWhatsappMessage, vars)
      : this.interpolateTemplate(config.noShowWhatsappMessage, vars);

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
        statusReason: notes?.trim() || 'Missed appointment (No-Show) — Automated AI Recovery initiated',
        metadata: updatedMeta,
        updatedAt: new Date(),
      })
      .where(eq(appointments.id, apt.id))
      .returning();

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
    if (cleanPhone && config.noShowVoiceCallEnabled) {
      try {
        const chosenAgentConfigId = params.customAgentId || config.noShowAgentId;
        let targetAgentId: string | null = null;

        if (chosenAgentConfigId && chosenAgentConfigId !== 'default') {
          targetAgentId = chosenAgentConfigId;
        } else if (!apt.callId) {
          const userAgents = await db
            .select({ id: agents.id, elevenLabsAgentId: agents.elevenLabsAgentId })
            .from(agents)
            .where(eq(agents.userId, userId));
          const preferredAgent = userAgents.find((a) => Boolean(a.elevenLabsAgentId)) || userAgents[0];
          targetAgentId = preferredAgent?.id || null;
        }

        const [newFollowUp] = await db
          .insert(scheduledFollowUps)
          .values({
            userId,
            agentId: targetAgentId,
            callId: apt.callId || null,
            phoneNumber: cleanPhone,
            customerName: apt.contactName,
            preferredTimeText: 'Appointment No-Show Recovery',
            contextNote: `[CUSTOM_GREETING]: ${finalVoiceScript} ||| NO-SHOW RECOVERY CALL: Customer ${apt.contactName} had booked a ${appointmentTerm} with ${businessName} on ${apt.appointmentDate} at ${apt.appointmentTime}, but could not attend. Politely check in with them, ask if they were busy, and offer to reschedule their ${appointmentTerm} to a new convenient date and time.`,
            scheduledAt: new Date(Date.now() + Math.max(5, delaySeconds) * 1000),
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
    if (cleanPhone && config.noShowWhatsappEnabled) {
      try {
        const { metaWhatsAppService } = await import('../../plugins/messaging/services/meta-whatsapp.service').catch(
          () => ({ metaWhatsAppService: null as any })
        );
        if (metaWhatsAppService && typeof metaWhatsAppService.sendTextMessage === 'function') {
          await metaWhatsAppService.sendTextMessage(userId, cleanPhone, finalWhatsappMsg);
          whatsappSent = true;
        }
      } catch (_) {}
    }

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
   * 3. Smart Auto-Assignment (Kept for API compatibility if needed)
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

    if (activeStaff.length === 0) return null;

    const searchContext = `${apt.serviceName || ''} ${apt.notes || ''}`.toLowerCase();

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

    return updated;
  }

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
   * 5. Background Scheduler: Runs every 60 seconds to automatically process
   *    User-Configured Pre-Appointment Reminders AND Automatic No-Show Recovery
   */
  static startScheduler(): void {
    if (this.isSchedulerRunning) return;
    this.isSchedulerRunning = true;

    console.log('🔔 [AppointmentRecovery] Dynamic Auto-Reminder & No-Show Recovery Engine started (every 60s)');
    this.schedulerTimer = setInterval(() => {
      this.processUpcomingReminders().catch((err) => {
        logger.warn(`[AppointmentRecovery] Scheduler cycle error: ${err?.message}`);
      });
    }, 60 * 1000);
  }

  static async processUpcomingReminders(): Promise<void> {
    const activeAppointments = await db
      .select()
      .from(appointments)
      .where(
        or(
          eq(appointments.status, 'new'),
          eq(appointments.status, 'scheduled'),
          eq(appointments.status, 'confirmed'),
          eq(appointments.status, 'rescheduled')
        )
      )
      .limit(200);

    const now = Date.now();
    const configCache = new Map<string, ReminderAutomationConfig>();

    for (const apt of activeAppointments) {
      const dt = this.parseAppointmentDateTime(String(apt.appointmentDate), String(apt.appointmentTime));
      if (!dt) continue;

      let config = configCache.get(apt.userId);
      if (!config) {
        config = await this.getAutomationConfig(apt.userId);
        configCache.set(apt.userId, config);
      }

      const diffMinutes = (dt.getTime() - now) / (1000 * 60);
      const meta = (apt.metadata && typeof apt.metadata === 'object') ? apt.metadata : {};

      // A. Future Appointment -> Check Auto-Reminder 1 & Auto-Reminder 2
      if (diffMinutes > 0 && config.autoReminderEnabled) {
        // Check Reminder 2 first if closer to appointment time
        if (
          config.reminder2Enabled &&
          diffMinutes <= config.reminder2OffsetMinutes &&
          diffMinutes >= Math.max(0, config.reminder2OffsetMinutes - 30) &&
          !meta.autoReminder2Sent &&
          !meta.reminder1hSent
        ) {
          await this.sendAppointmentReminder({
            appointmentId: apt.id,
            userId: apt.userId,
            reminderType: 'reminder2',
          }).catch(() => {});
        }
        // Check Reminder 1
        else if (
          diffMinutes <= config.reminder1OffsetMinutes &&
          diffMinutes >= Math.max(0, config.reminder1OffsetMinutes - 45) &&
          !meta.autoReminder1Sent &&
          !meta.reminder24hSent
        ) {
          await this.sendAppointmentReminder({
            appointmentId: apt.id,
            userId: apt.userId,
            reminderType: 'reminder1',
          }).catch(() => {});
        }
      }

      // B. Past Appointment -> Check Automatic No-Show Detection & AI Recovery
      if (diffMinutes < 0 && config.autoNoShowEnabled) {
        const minutesPast = Math.abs(diffMinutes);
        // Trigger if appointment time passed by >= noShowAfterMinutes (within last 24h so old history isn't mass dialed)
        if (
          minutesPast >= config.noShowAfterMinutes &&
          minutesPast <= config.noShowAfterMinutes + 180 &&
          !meta.noShowRecoveryTriggered
        ) {
          await this.triggerNoShowRecovery({
            appointmentId: apt.id,
            userId: apt.userId,
            delaySeconds: 15,
            notes: `Auto-detected No-Show (${ config.noShowAfterMinutes } mins after scheduled time) — AI Recovery triggered`,
          }).catch(() => {});
        }
      }
    }
  }
}
