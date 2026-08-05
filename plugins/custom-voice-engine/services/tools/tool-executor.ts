import { db } from '../../../../server/db';
import { sql, eq, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { LlmToolCall } from '../../types';
import type { AudioSession } from '../audio-pipeline/audio-session';
import { appointments } from '../../../../shared/schema';
import { isCalendarSyncEnabled, createCalendarEvent } from '../../../../server/services/google-calendar/google-calendar.service';
import { appendRowToSheet, ensureSheetHeaders } from '../../../../server/services/google-sheets/google-sheets.service';
import { RAGKnowledgeService } from '../../../../server/services/rag-knowledge';

export class ToolExecutor {
  static async executeToolCall(
    toolCall: LlmToolCall,
    metadata: any,
    userId: string,
    agentId: string,
    callId: string | undefined,
    session: AudioSession
  ): Promise<{ success: boolean; result: unknown }> {
    const name = toolCall.function.name;
    let params: Record<string, unknown> = {};
    try {
      params = JSON.parse(toolCall.function.arguments);
    } catch {
      params = {};
    }

    if (name === 'book_appointment' || name.startsWith('book_appointment_')) {
      return await ToolExecutor.executeBookAppointment(params, metadata, userId, agentId, callId);
    } else if (name.startsWith('submit_form')) {
      return await ToolExecutor.executeFormSubmission(params, metadata, userId, callId);
    } else if (name === 'lookup_knowledge_base' || name === 'query_knowledge_base') {
      const kbIds = metadata?.knowledgeBaseIds || [];
      if (!kbIds.length) return { success: false, result: 'No knowledge base configured.' };
      if (!params.query) return { success: false, result: 'Query is required.' };
      try {
        const results = await RAGKnowledgeService.searchKnowledge(params.query as string, kbIds, userId);
        const formattedResponse = RAGKnowledgeService.formatResultsForAgent(results, 400);
        return { success: true, result: formattedResponse || 'No relevant information found in the knowledge base.' };
      } catch (err) {
        console.error('[ToolExecutor] Knowledge base error:', err);
        return { success: false, result: 'Unable to search knowledge base at this time.' };
      }
    } else if (name.startsWith('webhook_') || name.startsWith('send_email_') || name.startsWith('send_whatsapp_') || metadata?.webhookUrl || metadata?.url) {
      return await ToolExecutor.executeWebhook(name, params, metadata);
    } else if (name === 'end_call') {
      setImmediate(() => { session.end('hangup').catch(() => {}); });
      return { success: true, result: 'Ending call' };
    } else if (name === 'transfer_call' || name.startsWith('transfer_')) {
      const targetNumber = (params.destination as string) || (params.phoneNumber as string) || (metadata?.phoneNumber as string) || '';
      if (!targetNumber) {
        return { success: false, result: 'No transfer destination specified.' };
      }
      setImmediate(() => {
        session.emit('transfer', targetNumber);
      });
      return { success: true, result: `Initiated transfer to ${targetNumber}` };
    } else if (name === 'play_audio' || name.startsWith('play_audio_')) {
      const audioUrl = (params.audioUrl as string) || (params.audio_url as string) || (metadata?.audioUrl as string) || '';
      if (!audioUrl) {
        return { success: false, result: 'No audio URL specified.' };
      }
      setImmediate(() => {
        session.emit('play_audio', audioUrl);
      });
      return { success: true, result: 'Playing audio' };
    } else {
      console.log(`[ToolExecutor] Unknown tool: ${name}`);
      return { success: true, result: 'Tool executed' };
    }
  }

  static async executeWebhook(
    name: string,
    params: Record<string, unknown>,
    metadata: any
  ): Promise<{ success: boolean; result: unknown }> {
    try {
      const webhookUrl = metadata?.webhookUrl || metadata?.url || '';
      if (!webhookUrl) {
        console.warn(`[ToolExecutor] Webhook tool ${name} missing URL in metadata`);
        return { success: false, result: 'Webhook URL is not configured.' };
      }

      const webhookMethod = metadata?.webhookMethod || metadata?.method || 'POST';
      const headers = metadata?.headers || metadata?.webhookHeaders || {};

      console.log(`[ToolExecutor] Executing Webhook: ${webhookMethod} ${webhookUrl}`);

      let payload = { ...params };
      
      const fetchOptions: RequestInit = {
        method: webhookMethod.toUpperCase(),
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
      };

      if (['POST', 'PUT', 'PATCH'].includes(webhookMethod.toUpperCase())) {
        fetchOptions.body = JSON.stringify(payload);
      }

      const response = await fetch(webhookUrl, fetchOptions);
      if (!response.ok) {
        throw new Error(`Webhook returned status ${response.status}`);
      }

      let responseData: any;
      try {
        responseData = await response.json();
      } catch {
        responseData = await response.text();
      }

      console.log(`[ToolExecutor] Webhook response received successfully`);
      return { success: true, result: responseData || 'Webhook executed successfully.' };
    } catch (err: any) {
      console.error(`[ToolExecutor] Webhook error for ${name}:`, err.message);
      return { success: false, result: `Failed to execute webhook: ${err.message}` };
    }
  }

  static async executeBookAppointment(
    params: Record<string, unknown>,
    metadata: any,
    userId: string,
    agentId: string,
    callId: string | undefined
  ): Promise<{ success: boolean; result: unknown }> {
    try {
      const googleSheetId = metadata?.googleSheetId;
      const googleSheetName = metadata?.googleSheetName;
      console.log(`[Appointment Tool] metadata:`, JSON.stringify(metadata));
      console.log(`[Appointment Tool] googleSheetId:`, googleSheetId, `googleSheetName:`, googleSheetName);
      console.log(`[Appointment Tool] Booking:`, JSON.stringify(params));

      if (!params.contactName || !params.contactPhone || !params.appointmentDate || !params.appointmentTime) {
        return { success: false, result: 'Please provide name, phone, date and time for the appointment.' };
      }

      // Resolve flow_id: try both the ElevenLabs agents table and the custom-voice-engine ve_voice_agents table
      let resolvedFlowId: string | null = null;
      const agentRow = await db.execute(sql`SELECT flow_id FROM agents WHERE id = ${agentId} LIMIT 1`);
      const agentData = (agentRow as any).rows?.[0];
      if (agentData?.flow_id) {
        resolvedFlowId = agentData.flow_id;
      } else {
        // Custom-voice-engine agent: look up the active flow pointing to this agent
        const flowRow = await db.execute(sql`SELECT id FROM flows WHERE agent_id = ${agentId} AND is_active = true LIMIT 1`);
        resolvedFlowId = (flowRow.rows?.[0] as any)?.id || null;
      }

      const settingsResult = await db.execute(sql`
        SELECT * FROM appointment_settings WHERE user_id = ${userId} LIMIT 1
      `);
      const settings = (settingsResult as any).rows?.[0];

      const defaultWorkingHours: Record<string, { start: string; end: string; enabled: boolean }> = {
        monday: { start: "09:00", end: "17:00", enabled: true },
        tuesday: { start: "09:00", end: "17:00", enabled: true },
        wednesday: { start: "09:00", end: "17:00", enabled: true },
        thursday: { start: "09:00", end: "17:00", enabled: true },
        friday: { start: "09:00", end: "17:00", enabled: true },
        saturday: { start: "09:00", end: "17:00", enabled: false },
        sunday: { start: "09:00", end: "17:00", enabled: false },
      };

      const appointmentDate = params.appointmentDate as string;
      const appointmentTime = params.appointmentTime as string;
      const parsedDate = new Date(appointmentDate + 'T12:00:00');

      if (!isNaN(parsedDate.getTime())) {
        const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
        const dayOfWeek = parsedDate.getDay();
        const dayName = dayNames[dayOfWeek];

        let daySettings = defaultWorkingHours[dayName];
        if (settings?.working_hours) {
          const wh = typeof settings.working_hours === 'string' ? JSON.parse(settings.working_hours) : settings.working_hours;
          if (wh[dayName]) {
            daySettings = { ...daySettings, ...wh[dayName] };
          }
        }

        if (!daySettings.enabled) {
          const capitalizedDay = dayName.charAt(0).toUpperCase() + dayName.slice(1);
          return { success: false, result: `We're not available on ${capitalizedDay}s. Please choose a different day.` };
        }

        const parseTimeToMinutes = (timeStr: string): number => {
          const parts = timeStr.split(':');
          return parseInt(parts[0], 10) * 60 + parseInt(parts[1] || '0', 10);
        };

        const requestedMinutes = parseTimeToMinutes(appointmentTime);
        const startMinutes = parseTimeToMinutes(daySettings.start || "09:00");
        const endMinutes = parseTimeToMinutes(daySettings.end || "17:00");
        const duration = (params.duration as number) || 30;
        const appointmentEndMinutes = requestedMinutes + duration;

        if (requestedMinutes < startMinutes || appointmentEndMinutes > endMinutes) {
          const capitalizedDay = dayName.charAt(0).toUpperCase() + dayName.slice(1);
          return {
            success: false,
            result: `${appointmentTime} is outside our available hours on ${capitalizedDay}. We're available from ${daySettings.start} to ${daySettings.end}.`
          };
        }
      }

      if (callId) {
        const dupResult = await db.execute(sql`
          SELECT id FROM appointments
          WHERE call_id = ${callId} AND appointment_date = ${appointmentDate} AND status = 'scheduled'
          LIMIT 1
        `);
        if ((dupResult as any).rows?.length > 0) {
          const existing = (dupResult as any).rows[0];
          return { success: true, result: `Your appointment is already confirmed for ${appointmentDate}.`, appointmentId: existing.id, alreadyBooked: true };
        }
      }

      const dupByContact = await db.execute(sql`
        SELECT id FROM appointments
        WHERE user_id = ${userId} AND contact_phone = ${params.contactPhone as string}
          AND appointment_date = ${appointmentDate} AND appointment_time = ${appointmentTime}
          AND status = 'scheduled'
        LIMIT 1
      `);
      if ((dupByContact as any).rows?.length > 0) {
        const existing = (dupByContact as any).rows[0];
        return { success: true, result: `Your appointment is confirmed for ${appointmentDate} at ${appointmentTime}.`, appointmentId: existing.id, alreadyBooked: true };
      }

      if (settings && !settings.allow_overlapping) {
        const overlapResult = await db.execute(sql`
          SELECT id FROM appointments
          WHERE user_id = ${userId} AND appointment_date = ${appointmentDate}
            AND appointment_time = ${appointmentTime} AND status = 'scheduled'
          LIMIT 1
        `);
        if ((overlapResult as any).rows?.length > 0) {
          return { success: false, result: 'That time slot is already booked. Please choose a different time.' };
        }
      }

      const appointmentId = nanoid();
      await db.execute(sql`
        INSERT INTO appointments (id, user_id, call_id, flow_id, contact_name, contact_phone, contact_email, appointment_date, appointment_time, duration, service_name, notes, status, metadata)
        VALUES (${appointmentId}, ${userId}, ${callId || null}, ${resolvedFlowId}, ${params.contactName as string}, ${params.contactPhone as string}, ${(params.contactEmail as string) || null}, ${params.appointmentDate as string}, ${params.appointmentTime as string}, ${(params.duration as number) || 30}, ${(params.serviceName as string) || null}, ${(params.notes as string) || null}, 'scheduled', ${JSON.stringify({ source: 'custom-voice-engine', agentId })})
      `);

      console.log(`[Appointment Tool] ✅ Created appointment ${appointmentId} for user ${userId}, flow_id=${resolvedFlowId}, callId=${callId}`);

      if (googleSheetId) {
        try {
          let sheetTab = googleSheetName || '';
          if (!sheetTab) {
            const tabsResult = await db.execute(sql`SELECT list_sheet_tabs(${userId}, ${googleSheetId})`);
            sheetTab = (tabsResult as any).rows?.[0]?.list_sheet_tabs?.[0]?.title || 'Sheet1';
          }
          const row = [
            String(params.contactName || ""),
            String(params.contactPhone || ""),
            String(appointmentDate || ""),
            String(appointmentTime || ""),
            String((params.duration as number) || 30),
            String(params.serviceName || ""),
            String(callId || ""),
            new Date().toISOString(),
          ];
          const pushed = await appendRowToSheet(userId, googleSheetId, sheetTab, row);
          if (pushed) {
            console.log(`[Appointment Tool] ✅ Successfully pushed appointment row to Google Sheet ${googleSheetId} tab "${sheetTab}"`);
          } else {
            console.warn(`[Appointment Tool] ⚠️ Google Sheets push returned false for sheet ${googleSheetId} tab "${sheetTab}"`);
          }
        } catch (sheetErr: any) {
          console.error(`[Appointment Tool] Google Sheets push failed (non-fatal):`, sheetErr.message);
        }
      }

      // Auto-sync to Google Calendar if enabled
      try {
        const syncEnabled = await isCalendarSyncEnabled(userId);
        if (syncEnabled) {
          const calendarApt = {
            id: appointmentId,
            contactName: params.contactName as string,
            contactPhone: params.contactPhone as string,
            contactEmail: (params.contactEmail as string) || null,
            appointmentDate: appointmentDate,
            appointmentTime: appointmentTime,
            duration: (params.duration as number) || 30,
            serviceName: (params.serviceName as string) || null,
            notes: (params.notes as string) || null,
            status: "scheduled",
          };
          const eventId = await createCalendarEvent(userId, calendarApt);
          if (eventId) {
            await db.update(appointments)
              .set({ googleCalendarEventId: eventId, updatedAt: new Date() })
              .where(eq(appointments.id, appointmentId));
            console.log(`📅 [GoogleCalendar] Auto-synced appointment ${appointmentId} → event ${eventId}`);
          }
        }
      } catch (calErr: any) {
        console.error(`📅 [GoogleCalendar] Auto-sync error for ${appointmentId}:`, calErr.message);
      }

      return { success: true, result: `Appointment booked for ${params.contactName} on ${appointmentDate} at ${appointmentTime}`, appointmentId };
    } catch (error: any) {
      console.error(`[Appointment Tool] Error:`, error.message, error.stack);
      return { success: false, result: 'Unable to book appointment at this time. Please try again.' };
    }
  }

  static async executeFormSubmission(
    params: Record<string, unknown>,
    metadata: any,
    userId: string,
    callId: string | undefined
  ): Promise<{ success: boolean; result: unknown }> {
    try {
      const googleSheetId = metadata?.googleSheetId;
      const googleSheetName = metadata?.googleSheetName;
      const formId = metadata?.formId;
      if (!formId) {
        console.error(`[Form Tool] Missing formId in metadata`);
        return { success: false, result: 'Form configuration not found.' };
      }

      console.log(`[Form Tool] Submitting to form ${formId}:`, JSON.stringify(params));

      const formResult = await db.execute(sql`
        SELECT id, name FROM forms WHERE id = ${formId} LIMIT 1
      `);
      const form = (formResult as any).rows?.[0];
      if (!form) {
        return { success: false, result: 'Form configuration not found.' };
      }

      const fieldsResult = await db.execute(sql`
        SELECT id, question, field_type, is_required FROM form_fields WHERE form_id = ${formId} ORDER BY "order" ASC
      `);
      const formFieldRows = (fieldsResult as any).rows || [];

      const responses: Array<{ fieldId: string; question: string; answer: string }> = [];

      for (const field of formFieldRows) {
        const fieldKey = `field_${field.id.replace(/-/g, '_')}`;
        const answer = params[fieldKey] ?? params[field.id] ?? params[field.question] ?? null;
        if (answer !== null && answer !== undefined) {
          responses.push({
            fieldId: field.id,
            question: field.question,
            answer: String(answer),
          });
        }
      }

      if (responses.length === 0 && metadata?.fields) {
        for (const f of metadata.fields) {
          const key = f.name || f.id || f;
          const answer = params[key];
          if (answer !== null && answer !== undefined) {
            responses.push({
              fieldId: key,
              question: f.description || f.label || key,
              answer: String(answer),
            });
          }
        }
      }

      const submissionId = nanoid();
      await db.execute(sql`
        INSERT INTO form_submissions (id, form_id, call_id, contact_name, contact_phone, responses)
        VALUES (${submissionId}, ${formId}, ${callId || null}, ${(params.contactName as string) || (params.fullName as string) || null}, ${(params.contactPhone as string) || (params.phone as string) || null}, ${JSON.stringify(responses)})
      `);

      console.log(`[Form Tool] Created submission ${submissionId} with ${responses.length} responses`);

      if (googleSheetId) {
        try {
          const sheetTab = googleSheetName || 'Sheet1';
          const headerRow = [
            'Contact Name',
            'Contact Phone',
            ...responses.map((r: any) => r.question || r.fieldId || ''),
            'Call ID',
            'Submitted At',
          ];
          try {
            await ensureSheetHeaders(userId, googleSheetId, sheetTab, headerRow);
          } catch (headerErr: any) {
            console.warn(`[Form Tool] Safety-net header write failed (non-fatal):`, headerErr.message);
          }

          const answerValues = responses.map((r: any) => r.answer ?? '');
          const sheetRow: (string | null)[] = [
            (params.contactName as string) || (params.fullName as string) || null,
            (params.contactPhone as string) || (params.phone as string) || null,
            ...answerValues,
            callId || null,
            new Date().toISOString(),
          ];
          const pushed = await appendRowToSheet(userId, googleSheetId, sheetTab, sheetRow);
          if (pushed) {
            console.log(`[Form Tool] ✅ Appended row to Google Sheet "${sheetTab}" (${googleSheetId})`);
          } else {
            console.error(`[Form Tool] ⚠️ Google Sheets append FAILED for sheet ${googleSheetId} tab "${sheetTab}"`);
          }
        } catch (sheetErr: any) {
          console.error(`[Form Tool] Google Sheets push failed (non-fatal):`, sheetErr.message);
        }
      }

      return { success: true, result: `Form submitted successfully.`, submissionId };
    } catch (error: any) {
      console.error(`[Form Tool] Error:`, error.message, error.stack);
      return { success: false, result: 'Unable to submit form at this time. Please try again.' };
    }
  }
}
