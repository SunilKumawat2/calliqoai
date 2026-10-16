'use strict';
/**
 * ============================================================
 * Calliqo AI - CRM Sync Service
 * 
 * Handles 2-way sync with Google Sheets (lead import & outcome writeback),
 * Google Calendar availability checking & appointment booking,
 * and duplicate-safe CRM lead management.
 * 
 * ISOLATED: Operates strictly as a modular CRM extension without
 * affecting telephony engines or core call flows.
 * ============================================================
 */

import { db } from '../../db';
import { 
  leads, 
  contacts, 
  campaigns, 
  googleSheetsSyncConfigs, 
  crmSyncLogs, 
  appointments,
  notifications,
  users,
  type InsertGoogleSheetsSyncConfig,
  type GoogleSheetsSyncConfig
} from '@shared/schema';
import { eq, and, or, sql, desc } from 'drizzle-orm';
import { refreshAccessToken } from '../google-sheets/google-sheets.service';
import { checkFreeBusySlots, createCalendarEvent } from '../google-calendar/google-calendar.service';
import { logger } from '../../utils/logger';

const GOOGLE_SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

export class CrmSyncService {

  /**
   * Normalize phone number to E.164 standard format (+[country][digits])
   */
  static normalizePhoneNumber(raw: string): string {
    if (!raw) return '';
    let cleaned = raw.toString().trim().replace(/[\s\-\(\)\.]/g, '');
    if (!cleaned) return '';

    // If starts with +, ensure remaining is digits
    if (cleaned.startsWith('+')) {
      const rest = cleaned.substring(1).replace(/\D/g, '');
      return '+' + rest;
    }

    // Default to Indian +91 if 10 digits starting with 6-9
    cleaned = cleaned.replace(/\D/g, '');
    if (cleaned.length === 10 && /^[6-9]/.test(cleaned)) {
      return '+91' + cleaned;
    }
    if (cleaned.length === 12 && cleaned.startsWith('91')) {
      return '+' + cleaned;
    }

    return '+' + cleaned;
  }

  /**
   * Convert column letter (A, B, ..., Z, AA, AB...) to 0-based index
   */
  static columnLetterToIndex(letter: string): number {
    let column = 0;
    const clean = letter.toUpperCase().trim();
    for (let i = 0; i < clean.length; i++) {
      column += (clean.charCodeAt(i) - 64) * Math.pow(26, clean.length - i - 1);
    }
    return column - 1;
  }

  /**
   * Convert 0-based index to column letter (0 -> A, 1 -> B, ..., 26 -> AA)
   */
  static indexToColumnLetter(index: number): string {
    let temp = index + 1;
    let letter = '';
    while (temp > 0) {
      const rem = (temp - 1) % 26;
      letter = String.fromCharCode(65 + rem) + letter;
      temp = Math.floor((temp - 1) / 26);
    }
    return letter;
  }

  /**
   * List all Google Sheet sync configs for a user
   */
  static async listSyncConfigs(userId: string): Promise<GoogleSheetsSyncConfig[]> {
    return db
      .select()
      .from(googleSheetsSyncConfigs)
      .where(eq(googleSheetsSyncConfigs.userId, userId))
      .orderBy(desc(googleSheetsSyncConfigs.createdAt));
  }

  /**
   * Get single sync config
   */
  static async getSyncConfig(userId: string, id: string): Promise<GoogleSheetsSyncConfig | null> {
    const [row] = await db
      .select()
      .from(googleSheetsSyncConfigs)
      .where(and(eq(googleSheetsSyncConfigs.id, id), eq(googleSheetsSyncConfigs.userId, userId)))
      .limit(1);
    return row || null;
  }

  /**
   * Create or update a Google Sheet sync config
   */
  static async saveSyncConfig(userId: string, data: Partial<InsertGoogleSheetsSyncConfig> & { id?: string }): Promise<GoogleSheetsSyncConfig> {
    if (data.id) {
      const [updated] = await db
        .update(googleSheetsSyncConfigs)
        .set({
          ...data,
          updatedAt: new Date(),
        })
        .where(and(eq(googleSheetsSyncConfigs.id, data.id), eq(googleSheetsSyncConfigs.userId, userId)))
        .returning();
      return updated;
    } else {
      const [inserted] = await db
        .insert(googleSheetsSyncConfigs)
        .values({
          userId,
          spreadsheetId: data.spreadsheetId!,
          spreadsheetName: data.spreadsheetName || 'Untitled Spreadsheet',
          sheetTabName: data.sheetTabName || 'Sheet1',
          campaignId: data.campaignId || null,
          direction: data.direction || 'both',
          columnMapping: data.columnMapping || { phone: 'A' },
          autoSyncEnabled: data.autoSyncEnabled || false,
          syncIntervalMinutes: data.syncIntervalMinutes || 15,
        })
        .returning();
      return inserted;
    }
  }

  /**
   * Delete sync config
   */
  static async deleteSyncConfig(userId: string, id: string): Promise<boolean> {
    await db
      .delete(googleSheetsSyncConfigs)
      .where(and(eq(googleSheetsSyncConfigs.id, id), eq(googleSheetsSyncConfigs.userId, userId)));
    return true;
  }

  /**
   * Fetch sheet header row (Row 1) for column mapping UI
   */
  static async getSheetHeaders(userId: string, spreadsheetId: string, sheetTabName = 'Sheet1'): Promise<Array<{ letter: string; header: string }>> {
    const token = await refreshAccessToken(userId);
    if (!token) throw new Error('Google Sheets not connected or token expired');

    const range = encodeURIComponent(`${sheetTabName}!1:1`);
    const resp = await fetch(`${GOOGLE_SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${range}`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!resp.ok) {
      throw new Error(`Failed to fetch sheet headers: ${resp.statusText}`);
    }

    const data = await resp.json() as { values?: string[][] };
    const rowValues = data.values?.[0] || [];

    return rowValues.map((val, idx) => ({
      letter: this.indexToColumnLetter(idx),
      header: (val || '').toString().trim() || `Column ${this.indexToColumnLetter(idx)}`,
    }));
  }

  /**
   * Import leads from Google Sheet into Calliqo CRM & Campaigns with duplicate protection
   */
  static async syncGoogleSheet(userId: string, configId: string): Promise<{
    processed: number;
    created: number;
    updated: number;
    skipped: number;
    errors: Array<{ row?: number; phone?: string; error: string }>;
  }> {
    const config = await this.getSyncConfig(userId, configId);
    if (!config) throw new Error('Sync configuration not found');

    const token = await refreshAccessToken(userId);
    if (!token) throw new Error('Google Sheets not connected or token expired');

    // Fetch all rows from sheet
    const range = encodeURIComponent(`${config.sheetTabName}!A:Z`);
    const resp = await fetch(`${GOOGLE_SHEETS_API}/${encodeURIComponent(config.spreadsheetId)}/values/${range}`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!resp.ok) {
      const errText = await resp.text();
      await db.update(googleSheetsSyncConfigs)
        .set({ status: 'error', lastErrorMessage: `Google API error: ${resp.statusText}` })
        .where(eq(googleSheetsSyncConfigs.id, configId));
      throw new Error(`Failed to read spreadsheet: ${errText}`);
    }

    const data = await resp.json() as { values?: string[][] };
    const allRows = data.values || [];

    if (allRows.length <= 1) {
      return { processed: 0, created: 0, updated: 0, skipped: 0, errors: [] };
    }

    const mapping = config.columnMapping as Record<string, string>;
    const phoneIdx = mapping.phone ? this.columnLetterToIndex(mapping.phone) : -1;
    const firstNameIdx = mapping.firstName ? this.columnLetterToIndex(mapping.firstName) : -1;
    const lastNameIdx = mapping.lastName ? this.columnLetterToIndex(mapping.lastName) : -1;
    const emailIdx = mapping.email ? this.columnLetterToIndex(mapping.email) : -1;
    const companyIdx = mapping.company ? this.columnLetterToIndex(mapping.company) : -1;
    const notesIdx = mapping.notes ? this.columnLetterToIndex(mapping.notes) : -1;

    if (phoneIdx === -1) {
      throw new Error('Phone number column is not mapped in configuration');
    }

    let processed = 0;
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors: Array<{ row?: number; phone?: string; error: string }> = [];

    // Rows start from index 1 (row 2 in sheet, skipping header)
    for (let r = 1; r < allRows.length; r++) {
      const rowNum = r + 1; // 1-indexed for humans
      const row = allRows[r];
      if (!row || row.length === 0) continue;

      const rawPhone = row[phoneIdx];
      if (!rawPhone || !rawPhone.trim()) {
        skipped++;
        continue;
      }

      processed++;
      const normalizedPhone = this.normalizePhoneNumber(rawPhone);
      if (normalizedPhone.length < 10) {
        errors.push({ row: rowNum, phone: rawPhone, error: 'Invalid phone number format' });
        skipped++;
        continue;
      }

      const firstName = firstNameIdx >= 0 ? (row[firstNameIdx] || '').trim() : '';
      const lastName = lastNameIdx >= 0 ? (row[lastNameIdx] || '').trim() : '';
      const email = emailIdx >= 0 ? (row[emailIdx] || '').trim() : '';
      const company = companyIdx >= 0 ? (row[companyIdx] || '').trim() : '';
      const notes = notesIdx >= 0 ? (row[notesIdx] || '').trim() : '';

      try {
        // DEDUPLICATION CHECK: Look for existing lead with this phone for this user
        const [existingLead] = await db
          .select()
          .from(leads)
          .where(and(eq(leads.userId, userId), eq(leads.phone, normalizedPhone)))
          .limit(1);

        if (existingLead) {
          // Update existing lead (enrich with sheet row data without overwriting call intelligence)
          const currentCustom = (existingLead.customFields as Record<string, unknown>) || {};
          await db
            .update(leads)
            .set({
              firstName: firstName || existingLead.firstName,
              lastName: lastName || existingLead.lastName,
              email: email || existingLead.email,
              company: company || existingLead.company,
              googleSheetId: config.spreadsheetId,
              googleSheetRowIndex: rowNum,
              customFields: {
                ...currentCustom,
                sheetNotes: notes || currentCustom.sheetNotes,
                lastSheetSync: new Date().toISOString(),
              },
              updatedAt: new Date(),
            })
            .where(eq(leads.id, existingLead.id));
          updated++;
        } else {
          // Insert new lead
          await db.insert(leads).values({
            userId,
            phone: normalizedPhone,
            firstName: firstName || 'Lead',
            lastName: lastName || '',
            email: email || null,
            company: company || null,
            sourceType: 'campaign',
            campaignId: config.campaignId || null,
            googleSheetId: config.spreadsheetId,
            googleSheetRowIndex: rowNum,
            stage: 'new',
            leadScore: 50,
            customFields: notes ? { sheetNotes: notes } : {},
          });
          created++;
        }

        // If a campaign is linked, ensure contact is in campaign contacts for dialing
        if (config.campaignId) {
          const [existingContact] = await db
            .select()
            .from(contacts)
            .where(and(eq(contacts.campaignId, config.campaignId), eq(contacts.phone, normalizedPhone)))
            .limit(1);

          if (!existingContact) {
            await db.insert(contacts).values({
              campaignId: config.campaignId,
              phone: normalizedPhone,
              firstName: firstName || 'Lead',
              lastName: lastName || '',
              email: email || null,
              customFields: notes ? { notes } : {},
              status: 'pending',
            });
          }
        }
      } catch (rowErr: any) {
        errors.push({ row: rowNum, phone: normalizedPhone, error: rowErr.message });
      }
    }

    // Update sync config metrics
    await db
      .update(googleSheetsSyncConfigs)
      .set({
        lastSyncedAt: new Date(),
        lastSyncedRow: allRows.length,
        totalImported: sql`total_imported + ${created}`,
        totalUpdated: sql`total_updated + ${updated}`,
        status: 'active',
        lastErrorMessage: errors.length > 0 ? `${errors.length} rows had errors` : null,
        updatedAt: new Date(),
      })
      .where(eq(googleSheetsSyncConfigs.id, configId));

    // Log the sync event to crm_sync_logs
    await db.insert(crmSyncLogs).values({
      userId,
      configId,
      source: 'google_sheets',
      action: 'import',
      recordsProcessed: processed,
      recordsCreated: created,
      recordsUpdated: updated,
      recordsSkipped: skipped,
      status: errors.length === 0 ? 'success' : (created > 0 || updated > 0 ? 'partial' : 'failed'),
      errorDetails: errors.length > 0 ? errors : null,
      summary: `Imported ${created} new leads, updated ${updated} existing leads, skipped ${skipped}.`,
    });

    logger.info(`✅ [CRM Sync] Google Sheet "${config.spreadsheetName}" sync complete: ${created} created, ${updated} updated, ${errors.length} errors`, undefined, 'CrmSync');

    return { processed, created, updated, skipped, errors };
  }

  /**
   * Write call outcome back to Google Sheet row
   */
  static async writebackCallOutcome(callOutcome: {
    userId: string;
    phone: string;
    callStatus: string;
    duration?: number;
    aiSummary?: string;
    leadScore?: number;
    aiCategory?: string;
    appointmentDate?: string;
    recordingUrl?: string;
  }): Promise<boolean> {
    try {
      const normalizedPhone = this.normalizePhoneNumber(callOutcome.phone);

      // Find lead with googleSheetId & googleSheetRowIndex (prioritize rows that have googleSheetId)
      const last10 = normalizedPhone.replace(/\D/g, '').slice(-10);
      const [lead] = await db
        .select()
        .from(leads)
        .where(and(
          eq(leads.userId, callOutcome.userId),
          or(
            eq(leads.phone, normalizedPhone),
            sql`RIGHT(REGEXP_REPLACE(${leads.phone}, '[^0-9]', '', 'g'), 10) = ${last10}`
          ),
          sql`${leads.googleSheetId} IS NOT NULL`
        ))
        .orderBy(sql`${leads.updatedAt} DESC`)
        .limit(1);

      if (!lead || !lead.googleSheetId || !lead.googleSheetRowIndex) {
        logger.info(`ℹ️ [CRM Sync] No synced Google Sheet row found for phone ${normalizedPhone}, skipping writeback`, undefined, 'CrmSync');
        return false;
      }

      // Find active sync config for this sheet
      const [config] = await db
        .select()
        .from(googleSheetsSyncConfigs)
        .where(and(
          eq(googleSheetsSyncConfigs.userId, callOutcome.userId),
          eq(googleSheetsSyncConfigs.spreadsheetId, lead.googleSheetId)
        ))
        .limit(1);

      if (!config) return false;

      const mapping = config.columnMapping as Record<string, string>;
      const updates: Array<{ range: string; values: string[][] }> = [];
      const row = lead.googleSheetRowIndex;

      if (mapping.callStatus) {
        updates.push({
          range: `${config.sheetTabName}!${mapping.callStatus}${row}`,
          values: [[callOutcome.callStatus || 'Completed']]
        });
      }

      if (mapping.duration && callOutcome.duration !== undefined) {
        const mins = Math.floor(callOutcome.duration / 60);
        const secs = callOutcome.duration % 60;
        const durText = `${mins}m ${secs}s`;
        updates.push({
          range: `${config.sheetTabName}!${mapping.duration}${row}`,
          values: [[durText]]
        });
      }

      if (mapping.aiSummary && callOutcome.aiSummary) {
        updates.push({
          range: `${config.sheetTabName}!${mapping.aiSummary}${row}`,
          values: [[callOutcome.aiSummary]]
        });
      }

      if (mapping.leadScore && callOutcome.leadScore !== undefined) {
        updates.push({
          range: `${config.sheetTabName}!${mapping.leadScore}${row}`,
          values: [[callOutcome.leadScore.toString()]]
        });
      }

      if (mapping.appointmentDate && callOutcome.appointmentDate) {
        updates.push({
          range: `${config.sheetTabName}!${mapping.appointmentDate}${row}`,
          values: [[callOutcome.appointmentDate]]
        });
      }

      if (mapping.recordingUrl && callOutcome.recordingUrl) {
        updates.push({
          range: `${config.sheetTabName}!${mapping.recordingUrl}${row}`,
          values: [[callOutcome.recordingUrl]]
        });
      }

      if (updates.length === 0) return false;

      const token = await refreshAccessToken(callOutcome.userId);
      if (!token) return false;

      const resp = await fetch(`${GOOGLE_SHEETS_API}/${encodeURIComponent(lead.googleSheetId)}/values:batchUpdate`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          valueInputOption: 'USER_ENTERED',
          data: updates,
        })
      });

      if (!resp.ok) {
        console.error(`[CRM Sync] Writeback failed for row ${row}:`, await resp.text());
        return false;
      }

      logger.info(`✅ [CRM Sync] Call outcome written back to Sheet ${lead.googleSheetId} row ${row}`, undefined, 'CrmSync');
      return true;
    } catch (err: any) {
      console.error('[CRM Sync] Writeback error:', err.message);
      return false;
    }
  }

  /**
   * Check real-time Google Calendar availability (Client requirement #3)
   */
  static async checkCalendarAvailability(userId: string, dateStr: string, durationMinutes = 30): Promise<{
    availableSlots: string[];
    timezone: string;
  }> {
    const result = await checkFreeBusySlots(userId, dateStr, durationMinutes);
    if (!result) {
      // Fallback slots if calendar is not yet connected
      return {
        availableSlots: ['10:00', '11:00', '14:00', '15:30', '17:00'],
        timezone: 'Asia/Kolkata',
      };
    }
    return {
      availableSlots: result.slots,
      timezone: result.timezone,
    };
  }

  /**
   * Book appointment onto Google Calendar and Calliqo CRM (Client requirement #3)
   */
  static async bookAppointment(userId: string, data: {
    contactName: string;
    contactPhone: string;
    contactEmail?: string;
    appointmentDate: string; // YYYY-MM-DD
    appointmentTime: string; // HH:mm
    durationMinutes?: number;
    serviceName?: string;
    notes?: string;
  }): Promise<{ appointmentId: string; googleEventId: string | null }> {
    const aptId = `apt_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const duration = data.durationMinutes || 30;

    let googleEventId: string | null = null;
    try {
      googleEventId = await createCalendarEvent(userId, {
        id: aptId,
        contactName: data.contactName,
        contactPhone: data.contactPhone,
        contactEmail: data.contactEmail || null,
        appointmentDate: data.appointmentDate,
        appointmentTime: data.appointmentTime,
        duration,
        serviceName: data.serviceName || 'Consultation / Site Visit',
        notes: data.notes || 'Booked via Calliqo AI',
        status: 'scheduled',
      });
    } catch (gErr: any) {
      logger.warn(`Google Calendar event creation note: ${gErr.message}`, undefined, 'CrmSync');
    }

    // Insert into Calliqo appointments table
    await db.insert(appointments).values({
      id: aptId,
      userId,
      contactName: data.contactName,
      contactPhone: data.contactPhone,
      contactEmail: data.contactEmail || null,
      appointmentDate: data.appointmentDate,
      appointmentTime: data.appointmentTime,
      duration,
      serviceName: data.serviceName || 'Consultation / Site Visit',
      notes: data.notes || 'Booked via Calliqo AI',
      status: 'scheduled',
      googleCalendarEventId: googleEventId,
    });

    // Update lead record if exists
    const normPhone = this.normalizePhoneNumber(data.contactPhone);
    const [lead] = await db
      .select()
      .from(leads)
      .where(and(eq(leads.userId, userId), eq(leads.phone, normPhone)))
      .limit(1);

    if (lead) {
      await db
        .update(leads)
        .set({
          hasAppointment: true,
          appointmentDate: new Date(`${data.appointmentDate}T${data.appointmentTime}:00`),
          stage: 'appointment_booked',
          aiCategory: 'appointment_booked',
          updatedAt: new Date(),
        })
        .where(eq(leads.id, lead.id));
    }

    // Log the event
    await db.insert(crmSyncLogs).values({
      userId,
      source: 'google_calendar',
      action: 'calendar_book',
      recordsProcessed: 1,
      recordsCreated: 1,
      status: 'success',
      summary: `Appointment booked for ${data.contactName} on ${data.appointmentDate} at ${data.appointmentTime}`,
    });

    // Send in-app notification to user
    await db.insert(notifications).values({
      userId,
      type: 'appointment_booked',
      title: '📅 New Appointment Scheduled',
      message: `Appointment booked with ${data.contactName} (${data.contactPhone}) on ${data.appointmentDate} at ${data.appointmentTime}.`,
      isRead: false,
    });

    return { appointmentId: aptId, googleEventId };
  }

  /**
   * Get sync audit logs for user (Client requirement #6)
   */
  static async getSyncLogs(userId: string, limit = 50) {
    return db
      .select()
      .from(crmSyncLogs)
      .where(eq(crmSyncLogs.userId, userId))
      .orderBy(desc(crmSyncLogs.createdAt))
      .limit(limit);
  }
}
