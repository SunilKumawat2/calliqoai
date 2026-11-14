'use strict';
/**
 * ============================================================
 * Calliqo AI - Sales Team & Site Visit Assignment API Routes
 * 
 * Manages:
 * - Sales Staff Members (Add, Edit, List, Delete, Toggle Active)
 * - Site Visits & Appointments with Assigned Staff
 * - 1-Click Assignment & Status Updates (Visited, Deal Won, etc.)
 * ============================================================
 */

import { Router, type Request, type Response } from 'express';
import { db } from '../db';
import { salesTeamMembers, appointments, leads, notifications } from '@shared/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { logger } from '../utils/logger';
import { sendStaffAssignmentEmail, sendClientConfirmationEmail } from '../services/sales-team-email';
import { updateCalendarEvent, createCalendarEvent } from '../services/google-calendar/google-calendar.service';

export const salesTeamRouter = Router();

// Helper to resolve userId
function getUserId(req: Request): string | null {
  return (req as any).user?.id || (req as any).userId || null;
}

const userLastSyncMap = new Map<string, number>();

// ── 1. GET /api/sales-team (List All Sales Staff) ─────────────
salesTeamRouter.get('/', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const staffList = await db
      .select()
      .from(salesTeamMembers)
      .where(eq(salesTeamMembers.userId, userId))
      .orderBy(desc(salesTeamMembers.createdAt));

    res.json(staffList);
  } catch (error: any) {
    logger.error(`[SalesTeam] Error listing staff: ${error.message}`, error, 'SalesTeam');
    res.status(500).json({ error: error.message });
  }
});

// ── 2. POST /api/sales-team (Create Sales Staff) ──────────────
salesTeamRouter.post('/', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { name, phone, email, role, city, assignedProjects, notes } = req.body;
    if (!name || !phone) {
      return res.status(400).json({ error: 'Name and Phone are required' });
    }

    const staffId = `staff_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const [created] = await db
      .insert(salesTeamMembers)
      .values({
        id: staffId,
        userId,
        name: name.trim(),
        phone: phone.trim(),
        email: email ? email.trim() : null,
        role: role ? role.trim() : 'Sales Executive',
        city: city ? city.trim() : null,
        assignedProjects: Array.isArray(assignedProjects) ? assignedProjects : [],
        isActive: true,
        notes: notes ? notes.trim() : null,
      })
      .returning();

    res.status(201).json(created);
  } catch (error: any) {
    logger.error(`[SalesTeam] Error creating staff: ${error.message}`, error, 'SalesTeam');
    res.status(500).json({ error: error.message });
  }
});

// ── 2B. PUT /api/sales-team/reminder-automation-config ────────
// Must be registered BEFORE PUT /:id so it is not captured as a staff ID.
salesTeamRouter.put('/reminder-automation-config', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { AppointmentRecoveryService } = await import('../services/appointment-recovery.service');
    const saved = await AppointmentRecoveryService.saveAutomationConfig(userId, req.body || {});
    res.json(saved);
  } catch (error: any) {
    logger.error(`[SalesTeam] Error saving reminder automation config: ${error.message}`, error, 'SalesTeam');
    res.status(500).json({ error: error.message });
  }
});

// ── 2C. Google Review Request & Complaint Alert Automation ────
// Must be registered BEFORE PUT /:id so it is not captured as a staff ID.
salesTeamRouter.get('/review-complaint-config', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { ReviewComplaintAutomationService } = await import('../services/review-complaint-automation.service');
    res.json(await ReviewComplaintAutomationService.getConfig(userId));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

salesTeamRouter.put('/review-complaint-config', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { ReviewComplaintAutomationService } = await import('../services/review-complaint-automation.service');
    res.json(await ReviewComplaintAutomationService.saveConfig(userId, req.body || {}));
  } catch (error: any) {
    logger.error(`[SalesTeam] Error saving review/complaint config: ${error.message}`, error, 'SalesTeam');
    res.status(500).json({ error: error.message });
  }
});

salesTeamRouter.get('/review-complaint-logs', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { ReviewComplaintAutomationService } = await import('../services/review-complaint-automation.service');
    res.json(await ReviewComplaintAutomationService.getLogs(userId));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

salesTeamRouter.post('/review-complaint/test-alert', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { ReviewComplaintAutomationService } = await import('../services/review-complaint-automation.service');
    const result = await ReviewComplaintAutomationService.handleCompletedCall({
      id: `test_${Date.now()}`,
      userId,
      engine: 'test',
      phoneNumber: '+910000000000',
      callDirection: 'incoming',
      duration: 60,
      sentiment: 'negative',
      firstName: 'Test',
      lastName: 'Customer',
      aiSummary: 'TEST ALERT: The customer was unhappy with the service and wanted to register a complaint.',
      transcript: 'Customer: Mujhe complaint karni hai, service bahut bekar thi.',
      test: true,
    });
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── 2D. Source-to-Sale ROI Funnel (read-only analytics + its own settings) ──
// Must be registered BEFORE PUT /:id so it is not captured as a staff ID.
salesTeamRouter.get('/roi-funnel', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { RoiFunnelService } = await import('../services/roi-funnel.service');
    const { range, from, to } = req.query as Record<string, string | undefined>;
    res.json(await RoiFunnelService.getFunnel(userId, { range, from, to }));
  } catch (error: any) {
    logger.error(`[SalesTeam] Error building ROI funnel: ${error.message}`, error, 'SalesTeam');
    res.status(500).json({ error: error.message });
  }
});

salesTeamRouter.put('/roi-funnel-config', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { RoiFunnelService } = await import('../services/roi-funnel.service');
    res.json(await RoiFunnelService.saveConfig(userId, req.body || {}));
  } catch (error: any) {
    logger.error(`[SalesTeam] Error saving ROI funnel config: ${error.message}`, error, 'SalesTeam');
    res.status(500).json({ error: error.message });
  }
});

// ── 2E. Weekly Owner Brief (WhatsApp + Email) ─────────────────
// Must be registered BEFORE PUT /:id so it is not captured as a staff ID.
salesTeamRouter.get('/weekly-owner-brief-config', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { WeeklyOwnerBriefService } = await import('../services/weekly-owner-brief.service');
    res.json(await WeeklyOwnerBriefService.getConfig(userId));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

salesTeamRouter.put('/weekly-owner-brief-config', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { WeeklyOwnerBriefService } = await import('../services/weekly-owner-brief.service');
    res.json(await WeeklyOwnerBriefService.saveConfig(userId, req.body || {}));
  } catch (error: any) {
    logger.error(`[SalesTeam] Error saving weekly brief config: ${error.message}`, error, 'SalesTeam');
    res.status(500).json({ error: error.message });
  }
});

salesTeamRouter.get('/weekly-owner-brief-logs', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { WeeklyOwnerBriefService } = await import('../services/weekly-owner-brief.service');
    res.json(await WeeklyOwnerBriefService.getLogs(userId));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

salesTeamRouter.post('/weekly-owner-brief/send-now', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { WeeklyOwnerBriefService } = await import('../services/weekly-owner-brief.service');
    const result = await WeeklyOwnerBriefService.sendBrief(userId, {
      trigger: 'manual',
      test: Boolean(req.body?.test),
    });
    res.json(result);
  } catch (error: any) {
    logger.error(`[SalesTeam] Error sending weekly owner brief: ${error.message}`, error, 'SalesTeam');
    res.status(500).json({ error: error.message });
  }
});

// ── 3. PUT /api/sales-team/:id (Update Sales Staff) ───────────
salesTeamRouter.put('/:id', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { id } = req.params;
    const { name, phone, email, role, city, assignedProjects, isActive, notes } = req.body;

    const [updated] = await db
      .update(salesTeamMembers)
      .set({
        name: name !== undefined ? name.trim() : undefined,
        phone: phone !== undefined ? phone.trim() : undefined,
        email: email !== undefined ? (email ? email.trim() : null) : undefined,
        role: role !== undefined ? role.trim() : undefined,
        city: city !== undefined ? (city ? city.trim() : null) : undefined,
        assignedProjects: Array.isArray(assignedProjects) ? assignedProjects : undefined,
        isActive: isActive !== undefined ? Boolean(isActive) : undefined,
        notes: notes !== undefined ? (notes ? notes.trim() : null) : undefined,
        updatedAt: new Date(),
      })
      .where(and(eq(salesTeamMembers.id, id), eq(salesTeamMembers.userId, userId)))
      .returning();

    if (!updated) {
      return res.status(404).json({ error: 'Sales team member not found' });
    }

    res.json(updated);
  } catch (error: any) {
    logger.error(`[SalesTeam] Error updating staff: ${error.message}`, error, 'SalesTeam');
    res.status(500).json({ error: error.message });
  }
});

// ── 4. DELETE /api/sales-team/:id (Delete Sales Staff) ────────
salesTeamRouter.delete('/:id', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { id } = req.params;
    await db
      .delete(salesTeamMembers)
      .where(and(eq(salesTeamMembers.id, id), eq(salesTeamMembers.userId, userId)));

    res.json({ success: true });
  } catch (error: any) {
    logger.error(`[SalesTeam] Error deleting staff: ${error.message}`, error, 'SalesTeam');
    res.status(500).json({ error: error.message });
  }
});

// ── 5. GET /api/sales-team/site-visits (List Site Visits) ─────
salesTeamRouter.get('/site-visits/all', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  // Auto-sync Google Calendar in background (debounced every 20s)
  const lastSync = userLastSyncMap.get(userId) || 0;
  if (Date.now() - lastSync > 20000) {
    userLastSyncMap.set(userId, Date.now());
    import('../services/google-calendar/google-calendar.service')
      .then(({ syncGoogleCalendarEvents }) => syncGoogleCalendarEvents(userId))
      .catch(() => {});
  }

  try {
    const visits = await db
      .select()
      .from(appointments)
      .where(eq(appointments.userId, userId))
      .orderBy(desc(appointments.appointmentDate), desc(appointments.appointmentTime));

    res.json(visits);
  } catch (error: any) {
    logger.error(`[SalesTeam] Error fetching visits: ${error.message}`, error, 'SalesTeam');
    res.status(500).json({ error: error.message });
  }
});

// ── 6. PUT /api/sales-team/site-visits/:id/assign ─────────────
salesTeamRouter.put('/site-visits/:id/assign', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { id } = req.params;
    const { staffId, notes, sendEmailToStaff, sendEmailToClient, clientEmail } = req.body;

    let staffRecord: any = null;
    let staffName: string | null = null;
    let staffPhone: string | null = null;
    const isAssigning = staffId && staffId !== 'unassigned';

    if (isAssigning) {
      const [staff] = await db
        .select()
        .from(salesTeamMembers)
        .where(and(eq(salesTeamMembers.id, staffId), eq(salesTeamMembers.userId, userId)))
        .limit(1);

      if (staff) {
        staffRecord = staff;
        staffName = staff.name;
        staffPhone = staff.phone;

        // Increment visit count for this staff member
        await db
          .update(salesTeamMembers)
          .set({
            totalVisitsCount: sql`${salesTeamMembers.totalVisitsCount} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(salesTeamMembers.id, staff.id));
      }
    }

    const updatePayload: Record<string, any> = {
      assignedStaffId: isAssigning ? staffId : null,
      assignedStaffName: isAssigning ? staffName : null,
      assignedStaffPhone: isAssigning ? staffPhone : null,
      updatedAt: new Date(),
    };

    if (notes !== undefined && notes !== null) {
      updatePayload.notes = notes.trim();
    }

    if (clientEmail && clientEmail.trim()) {
      updatePayload.contactEmail = clientEmail.trim();
    }

    const [updatedAppointment] = await db
      .update(appointments)
      .set(updatePayload)
      .where(and(eq(appointments.id, id), eq(appointments.userId, userId)))
      .returning();

    if (!updatedAppointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    // ── Email Notification to Assigned Staff ──
    if (isAssigning && staffRecord?.email && sendEmailToStaff !== false) {
      console.log(`📧 [SalesTeam] Dispatching staff assignment email to: ${staffRecord.email}`);
      sendStaffAssignmentEmail({
        userId,
        staffEmail: staffRecord.email,
        staffName: staffRecord.name,
        clientName: updatedAppointment.contactName,
        clientPhone: updatedAppointment.contactPhone,
        clientEmail: updatedAppointment.contactEmail,
        serviceName: updatedAppointment.serviceName || 'Property Site Visit',
        appointmentDate: String(updatedAppointment.appointmentDate),
        appointmentTime: String(updatedAppointment.appointmentTime),
        notes: updatedAppointment.notes,
        adminInstructions: notes,
      }).then(ok => {
        console.log(`📧 [SalesTeam] Staff email result for ${staffRecord.email}: ${ok ? 'SUCCESS' : 'FAILED'}`);
      }).catch(err => {
        console.error(`❌ [SalesTeam] Staff email error: ${err.message}`);
        logger.warn(`[SalesTeam] Staff email error: ${err.message}`, undefined, 'SalesTeam');
      });
    }

    // ── Email Notification to Customer / Client ──
    const targetClientEmail = clientEmail?.trim() || updatedAppointment.contactEmail;
    if (targetClientEmail && sendEmailToClient !== false) {
      console.log(`📧 [SalesTeam] Dispatching client confirmation email to: ${targetClientEmail}`);
      sendClientConfirmationEmail({
        userId,
        clientEmail: targetClientEmail,
        clientName: updatedAppointment.contactName,
        serviceName: updatedAppointment.serviceName || 'Property Site Visit',
        appointmentDate: String(updatedAppointment.appointmentDate),
        appointmentTime: String(updatedAppointment.appointmentTime),
        staffName: isAssigning ? staffName : null,
        staffPhone: isAssigning ? staffPhone : null,
        staffRole: isAssigning && staffRecord ? staffRecord.role : 'Property Consultant',
      }).then(ok => {
        console.log(`📧 [SalesTeam] Client email result for ${targetClientEmail}: ${ok ? 'SUCCESS' : 'FAILED'}`);
      }).catch(err => {
        console.error(`❌ [SalesTeam] Client email error: ${err.message}`);
        logger.warn(`[SalesTeam] Client email error: ${err.message}`, undefined, 'SalesTeam');
      });
    }

    // ── Two-Way Sync to Google Calendar (Update Consultant & Details) ──
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
        status: updatedAppointment.status,
        statusReason: updatedAppointment.statusReason,
        assignedStaffName: updatedAppointment.assignedStaffName,
        assignedStaffPhone: updatedAppointment.assignedStaffPhone,
      }).then(synced => {
        if (synced) {
          console.log(`📅 [SalesTeam] Synced consultant assignment to Google Calendar event: ${updatedAppointment.googleCalendarEventId}`);
        }
      }).catch(err => {
        logger.warn(`[SalesTeam] Google Calendar staff sync error: ${err.message}`, undefined, 'SalesTeam');
      });
    }

    // ── Two-Way Sync to External CRM (Zoho / HubSpot / Custom Webhook) ──
    import('../services/appointment-recovery.service')
      .then(({ AppointmentRecoveryService }) =>
        AppointmentRecoveryService.pushEventToExternalCrm(userId, `appointment.${updatedAppointment.status}`, {
          appointmentId: updatedAppointment.id,
          contactName: updatedAppointment.contactName,
          contactPhone: updatedAppointment.contactPhone,
          contactEmail: updatedAppointment.contactEmail,
          appointmentDate: updatedAppointment.appointmentDate,
          appointmentTime: updatedAppointment.appointmentTime,
          serviceName: updatedAppointment.serviceName,
          status: updatedAppointment.status,
          statusReason: updatedAppointment.statusReason,
          assignedStaffName: updatedAppointment.assignedStaffName,
        })
      )
      .catch(() => {});

    res.json(updatedAppointment);
  } catch (error: any) {
    logger.error(`[SalesTeam] Error assigning staff: ${error.message}`, error, 'SalesTeam');
    res.status(500).json({ error: error.message });
  }
});

// ── 7. PUT /api/sales-team/site-visits/:id/status ─────────────
salesTeamRouter.put('/site-visits/:id/status', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { id } = req.params;
    const { status, statusReason } = req.body;

    const [updatedAppointment] = await db
      .update(appointments)
      .set({
        status: status || 'scheduled',
        statusReason: statusReason || null,
        updatedAt: new Date(),
      })
      .where(and(eq(appointments.id, id), eq(appointments.userId, userId)))
      .returning();

    if (!updatedAppointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    // ── Two-Way Sync to Google Calendar (Update Status & Outcome) ──
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
        status: updatedAppointment.status,
        statusReason: updatedAppointment.statusReason,
        assignedStaffName: updatedAppointment.assignedStaffName,
        assignedStaffPhone: updatedAppointment.assignedStaffPhone,
      }).then(synced => {
        if (synced) {
          console.log(`📅 [SalesTeam] Two-way synced status '${status}' to Google Calendar event: ${updatedAppointment.googleCalendarEventId}`);
        }
      }).catch(err => {
        logger.warn(`[SalesTeam] Google Calendar status sync error: ${err.message}`, undefined, 'SalesTeam');
      });
    }

    // ── Two-Way Sync to External CRM (Zoho / HubSpot / Custom Webhook) ──
    import('../services/appointment-recovery.service')
      .then(({ AppointmentRecoveryService }) =>
        AppointmentRecoveryService.pushEventToExternalCrm(userId, `appointment.${updatedAppointment.status}`, {
          appointmentId: updatedAppointment.id,
          contactName: updatedAppointment.contactName,
          contactPhone: updatedAppointment.contactPhone,
          contactEmail: updatedAppointment.contactEmail,
          appointmentDate: updatedAppointment.appointmentDate,
          appointmentTime: updatedAppointment.appointmentTime,
          serviceName: updatedAppointment.serviceName,
          status: updatedAppointment.status,
          statusReason: updatedAppointment.statusReason,
          assignedStaffName: updatedAppointment.assignedStaffName,
        })
      )
      .catch(() => {});

    // ── Automated Google Review Request (fire-and-forget, admin-controlled) ──
    import('../services/review-complaint-automation.service')
      .then(({ ReviewComplaintAutomationService }) =>
        ReviewComplaintAutomationService.onAppointmentStatusChanged(userId, updatedAppointment.id, updatedAppointment.status)
      )
      .catch(() => {});

    res.json(updatedAppointment);
  } catch (error: any) {
    logger.error(`[SalesTeam] Error updating visit status: ${error.message}`, error, 'SalesTeam');
    res.status(500).json({ error: error.message });
  }
});


// ── 7a. PUT /api/sales-team/site-visits/:id/confirm ────────────
salesTeamRouter.put('/site-visits/:id/confirm', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { id } = req.params;
    const [updatedAppointment] = await db
      .update(appointments)
      .set({
        status: 'confirmed',
        updatedAt: new Date(),
      })
      .where(and(eq(appointments.id, id), eq(appointments.userId, userId)))
      .returning();

    if (!updatedAppointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

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
        status: 'confirmed',
        assignedStaffName: updatedAppointment.assignedStaffName,
        assignedStaffPhone: updatedAppointment.assignedStaffPhone,
      }).catch(() => {});
    } else {
      createCalendarEvent(userId, {
        id: updatedAppointment.id,
        contactName: updatedAppointment.contactName,
        contactPhone: updatedAppointment.contactPhone,
        contactEmail: updatedAppointment.contactEmail,
        appointmentDate: String(updatedAppointment.appointmentDate),
        appointmentTime: String(updatedAppointment.appointmentTime),
        duration: updatedAppointment.duration || 30,
        serviceName: updatedAppointment.serviceName,
        notes: updatedAppointment.notes,
        status: 'confirmed',
        assignedStaffName: updatedAppointment.assignedStaffName,
        assignedStaffPhone: updatedAppointment.assignedStaffPhone,
      }).then(async (gEventId) => {
        if (gEventId) {
          await db.update(appointments).set({ googleCalendarEventId: gEventId }).where(eq(appointments.id, updatedAppointment.id));
          console.log(`📅 [SalesTeam] Confirmed visit pushed to Google Calendar: ${gEventId}`);
        }
      }).catch(() => {});
    }

    // ── Two-Way Sync to External CRM (Zoho / HubSpot / Custom Webhook) ──
    import('../services/appointment-recovery.service')
      .then(({ AppointmentRecoveryService }) =>
        AppointmentRecoveryService.pushEventToExternalCrm(userId, `appointment.${updatedAppointment.status}`, {
          appointmentId: updatedAppointment.id,
          contactName: updatedAppointment.contactName,
          contactPhone: updatedAppointment.contactPhone,
          contactEmail: updatedAppointment.contactEmail,
          appointmentDate: updatedAppointment.appointmentDate,
          appointmentTime: updatedAppointment.appointmentTime,
          serviceName: updatedAppointment.serviceName,
          status: updatedAppointment.status,
          statusReason: updatedAppointment.statusReason,
          assignedStaffName: updatedAppointment.assignedStaffName,
        })
      )
      .catch(() => {});

    res.json(updatedAppointment);
  } catch (error: any) {
    logger.error(`[SalesTeam] Error confirming visit: ${error.message}`, error, 'SalesTeam');
    res.status(500).json({ error: error.message });
  }
});

// ── 7b. PUT /api/sales-team/site-visits/:id/cancel ─────────────
salesTeamRouter.put('/site-visits/:id/cancel', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { id } = req.params;
    const { reason } = req.body;

    const [updatedAppointment] = await db
      .update(appointments)
      .set({
        status: 'cancelled',
        statusReason: reason ? String(reason).trim() : 'Cancelled by user',
        updatedAt: new Date(),
      })
      .where(and(eq(appointments.id, id), eq(appointments.userId, userId)))
      .returning();

    if (!updatedAppointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

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
        status: 'cancelled',
        statusReason: updatedAppointment.statusReason,
        assignedStaffName: updatedAppointment.assignedStaffName,
        assignedStaffPhone: updatedAppointment.assignedStaffPhone,
      }).catch(() => {});
    }

    // ── Two-Way Sync to External CRM (Zoho / HubSpot / Custom Webhook) ──
    import('../services/appointment-recovery.service')
      .then(({ AppointmentRecoveryService }) =>
        AppointmentRecoveryService.pushEventToExternalCrm(userId, `appointment.${updatedAppointment.status}`, {
          appointmentId: updatedAppointment.id,
          contactName: updatedAppointment.contactName,
          contactPhone: updatedAppointment.contactPhone,
          contactEmail: updatedAppointment.contactEmail,
          appointmentDate: updatedAppointment.appointmentDate,
          appointmentTime: updatedAppointment.appointmentTime,
          serviceName: updatedAppointment.serviceName,
          status: updatedAppointment.status,
          statusReason: updatedAppointment.statusReason,
          assignedStaffName: updatedAppointment.assignedStaffName,
        })
      )
      .catch(() => {});

    res.json(updatedAppointment);
  } catch (error: any) {
    logger.error(`[SalesTeam] Error cancelling visit: ${error.message}`, error, 'SalesTeam');
    res.status(500).json({ error: error.message });
  }
});

// ── 7c. PUT /api/sales-team/site-visits/:id/reschedule ─────────
salesTeamRouter.put('/site-visits/:id/reschedule', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { id } = req.params;
    const { appointmentDate, appointmentTime, notes } = req.body;

    if (!appointmentDate || !appointmentTime) {
      return res.status(400).json({ error: 'Date and time are required for rescheduling' });
    }

    const [updatedAppointment] = await db
      .update(appointments)
      .set({
        appointmentDate: String(appointmentDate).trim(),
        appointmentTime: String(appointmentTime).trim(),
        status: 'rescheduled',
        notes: notes !== undefined ? (notes ? String(notes).trim() : null) : undefined,
        updatedAt: new Date(),
      })
      .where(and(eq(appointments.id, id), eq(appointments.userId, userId)))
      .returning();

    if (!updatedAppointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

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
        status: 'rescheduled',
        assignedStaffName: updatedAppointment.assignedStaffName,
        assignedStaffPhone: updatedAppointment.assignedStaffPhone,
      }).catch(() => {});
    }

    // ── Two-Way Sync to External CRM (Zoho / HubSpot / Custom Webhook) ──
    import('../services/appointment-recovery.service')
      .then(({ AppointmentRecoveryService }) =>
        AppointmentRecoveryService.pushEventToExternalCrm(userId, `appointment.${updatedAppointment.status}`, {
          appointmentId: updatedAppointment.id,
          contactName: updatedAppointment.contactName,
          contactPhone: updatedAppointment.contactPhone,
          contactEmail: updatedAppointment.contactEmail,
          appointmentDate: updatedAppointment.appointmentDate,
          appointmentTime: updatedAppointment.appointmentTime,
          serviceName: updatedAppointment.serviceName,
          status: updatedAppointment.status,
          statusReason: updatedAppointment.statusReason,
          assignedStaffName: updatedAppointment.assignedStaffName,
        })
      )
      .catch(() => {});

    res.json(updatedAppointment);
  } catch (error: any) {
    logger.error(`[SalesTeam] Error rescheduling visit: ${error.message}`, error, 'SalesTeam');
    res.status(500).json({ error: error.message });
  }
});


// ── 7d. POST /api/sales-team/site-visits/:id/push-calendar ─────
salesTeamRouter.post('/site-visits/:id/push-calendar', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { id } = req.params;
    const [apt] = await db
      .select()
      .from(appointments)
      .where(and(eq(appointments.id, id), eq(appointments.userId, userId)))
      .limit(1);

    if (!apt) return res.status(404).json({ error: 'Appointment not found' });

    let gEventId = apt.googleCalendarEventId;
    if (!gEventId) {
      gEventId = await createCalendarEvent(userId, {
        id: apt.id,
        contactName: apt.contactName,
        contactPhone: apt.contactPhone,
        contactEmail: apt.contactEmail,
        appointmentDate: String(apt.appointmentDate),
        appointmentTime: String(apt.appointmentTime),
        duration: apt.duration || 30,
        serviceName: apt.serviceName,
        notes: apt.notes,
        status: apt.status,
        assignedStaffName: apt.assignedStaffName,
        assignedStaffPhone: apt.assignedStaffPhone,
      });

      if (gEventId) {
        await db.update(appointments).set({ googleCalendarEventId: gEventId }).where(eq(appointments.id, apt.id));
        console.log(`📅 [SalesTeam] Manually pushed appointment ${apt.id} to Google Calendar: ${gEventId}`);
      }
    }

    res.json({ success: true, googleCalendarEventId: gEventId });
  } catch (err: any) {
    logger.error(`[SalesTeam] Error pushing to Google Calendar: ${err.message}`, err, 'SalesTeam');
    res.status(500).json({ error: err.message });
  }
});

// ── 8. POST /api/sales-team/site-visits (Create & Appoint Site Visit Manually) ───
salesTeamRouter.post('/site-visits', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const {
      contactName,
      contactPhone,
      contactEmail,
      appointmentDate,
      appointmentTime,
      serviceName,
      notes,
      staffId,
    } = req.body;

    if (!contactName || !contactPhone || !appointmentDate || !appointmentTime) {
      return res.status(400).json({ error: 'Contact name, phone, date, and time are required' });
    }

    let staffName: string | null = null;
    let staffPhone: string | null = null;
    const isAssigning = staffId && staffId !== 'unassigned';

    if (isAssigning) {
      const [staff] = await db
        .select()
        .from(salesTeamMembers)
        .where(and(eq(salesTeamMembers.id, staffId), eq(salesTeamMembers.userId, userId)))
        .limit(1);

      if (staff) {
        staffName = staff.name;
        staffPhone = staff.phone;

        await db
          .update(salesTeamMembers)
          .set({
            totalVisitsCount: sql`${salesTeamMembers.totalVisitsCount} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(salesTeamMembers.id, staff.id));
      }
    }

    const aptId = `apt_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const [created] = await db
      .insert(appointments)
      .values({
        id: aptId,
        userId,
        contactName: contactName.trim(),
        contactPhone: contactPhone.trim(),
        contactEmail: contactEmail ? contactEmail.trim() : null,
        appointmentDate: appointmentDate.trim(),
        appointmentTime: appointmentTime.trim(),
        duration: 30,
        serviceName: serviceName ? serviceName.trim() : 'Property Site Visit',
        notes: notes ? notes.trim() : null,
        status: 'scheduled',
        assignedStaffId: isAssigning ? staffId : null,
        assignedStaffName: staffName,
        assignedStaffPhone: staffPhone,
      })
      .returning();

    // Create system notification for bell icon & CRM
    try {
      const notifId = `notif_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      await db.insert(notifications).values({
        id: notifId,
        userId,
        type: 'site_visit',
        title: `📅 Site Visit: ${contactName.trim()}`,
        message: `${contactName.trim()} scheduled for ${serviceName || 'Property Site Visit'} on ${appointmentDate} at ${appointmentTime}. Assigned: ${staffName || 'Awaiting Staff'}.`,
        link: '/app/crm',
        isRead: false,
      });
    } catch (nErr: any) {}

    // Send emails for manual creation if staff or client email present
    if (isAssigning && staffPhone) {
      db.select().from(salesTeamMembers).where(and(eq(salesTeamMembers.id, staffId), eq(salesTeamMembers.userId, userId))).limit(1).then(([st]) => {
        if (st && st.email) {
          sendStaffAssignmentEmail({
            userId,
            staffEmail: st.email,
            staffName: st.name,
            clientName: created.contactName,
            clientPhone: created.contactPhone,
            clientEmail: created.contactEmail,
            serviceName: created.serviceName || 'Property Site Visit',
            appointmentDate: String(created.appointmentDate),
            appointmentTime: String(created.appointmentTime),
            notes: created.notes,
          }).catch(e => logger.warn(`Staff email error: ${e.message}`, undefined, 'SalesTeam'));
        }
      });
    }

    if (created.contactEmail) {
      sendClientConfirmationEmail({
        userId,
        clientEmail: created.contactEmail,
        clientName: created.contactName,
        serviceName: created.serviceName || 'Property Site Visit',
        appointmentDate: String(created.appointmentDate),
        appointmentTime: String(created.appointmentTime),
        staffName: isAssigning ? staffName : null,
        staffPhone: isAssigning ? staffPhone : null,
      }).catch(e => logger.warn(`Client email error: ${e.message}`, undefined, 'SalesTeam'));
    }

    // ── Two-Way Sync: Push manual site visit to Google Calendar ──
    createCalendarEvent(userId, {
      id: created.id,
      contactName: created.contactName,
      contactPhone: created.contactPhone,
      contactEmail: created.contactEmail,
      appointmentDate: String(created.appointmentDate),
      appointmentTime: String(created.appointmentTime),
      duration: created.duration || 30,
      serviceName: created.serviceName,
      notes: created.notes,
      status: created.status,
      assignedStaffName: staffName,
      assignedStaffPhone: staffPhone,
    }).then(async (gEventId) => {
      if (gEventId) {
        await db.update(appointments).set({ googleCalendarEventId: gEventId }).where(eq(appointments.id, created.id));
        console.log(`📅 [SalesTeam] Manually appointed visit pushed to Google Calendar: ${gEventId}`);
      }
    }).catch(err => {
      logger.warn(`[SalesTeam] Google Calendar event create error: ${err.message}`, undefined, 'SalesTeam');
    });

    res.status(201).json(created);
  } catch (error: any) {
    logger.error(`[SalesTeam] Error creating visit: ${error.message}`, error, 'SalesTeam');
    res.status(500).json({ error: error.message });
  }
});

// ── 9. GET /api/sales-team/notifications/stats ─────────────────
salesTeamRouter.get('/notifications/stats', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const allVisits = await db
      .select()
      .from(appointments)
      .where(eq(appointments.userId, userId))
      .orderBy(desc(appointments.createdAt));

    const unassignedVisits = allVisits.filter(
      (v) => !v.assignedStaffId || v.assignedStaffId === 'unassigned' || v.assignedStaffId === ''
    );

    const todayStr = new Date().toISOString().split('T')[0];
    const todayVisits = allVisits.filter((v) => v.appointmentDate === todayStr);

    res.json({
      totalVisits: allVisits.length,
      unassignedCount: unassignedVisits.length,
      todayVisitsCount: todayVisits.length,
      latestUnassigned: unassignedVisits[0] || null,
      recentVisits: allVisits.slice(0, 5),
    });
  } catch (error: any) {
    logger.error(`[SalesTeam] Error getting notifications stats: ${error.message}`, error, 'SalesTeam');
    res.status(500).json({ error: error.message });
  }
});

// ── 10. POST /api/sales-team/sync-calendar ─────────────────────
salesTeamRouter.post('/sync-calendar', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { syncGoogleCalendarEvents } = await import('../services/google-calendar/google-calendar.service');
    const result = await syncGoogleCalendarEvents(userId);
    res.json(result);
  } catch (error: any) {
    logger.error(`[SalesTeam] Error syncing Google Calendar: ${error.message}`, error, 'SalesTeam');
    res.status(500).json({ error: error.message });
  }
});

// ── 11. PUT /api/sales-team/site-visits/:id/unassign ───────────
salesTeamRouter.put('/site-visits/:id/unassign', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { id } = req.params;
    const [updated] = await db
      .update(appointments)
      .set({
        assignedStaffId: null,
        assignedStaffName: null,
        assignedStaffPhone: null,
        updatedAt: new Date(),
      })
      .where(and(eq(appointments.id, id), eq(appointments.userId, userId)))
      .returning();

    if (!updated) return res.status(404).json({ error: 'Appointment not found' });
    res.json(updated);
  } catch (error: any) {
    logger.error(`[SalesTeam] Error unassigning visit: ${error.message}`, error, 'SalesTeam');
    res.status(500).json({ error: error.message });
  }
});

// ── 12. POST /api/sales-team/site-visits/:id/send-reminder ─────
salesTeamRouter.post('/site-visits/:id/send-reminder', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { id } = req.params;
    const { triggerVoiceCall, triggerWhatsapp, triggerEmail, customVoiceScript, customWhatsappMessage, customAgentId, delaySeconds } = req.body || {};
    const { AppointmentRecoveryService } = await import('../services/appointment-recovery.service');
    const result = await AppointmentRecoveryService.sendAppointmentReminder({
      appointmentId: id,
      userId,
      reminderType: 'manual',
      triggerVoiceCall: triggerVoiceCall !== undefined ? Boolean(triggerVoiceCall) : undefined,
      triggerWhatsapp: triggerWhatsapp !== undefined ? Boolean(triggerWhatsapp) : undefined,
      triggerEmail: triggerEmail !== undefined ? Boolean(triggerEmail) : undefined,
      customVoiceScript,
      customWhatsappMessage,
      customAgentId,
      delaySeconds: delaySeconds !== undefined ? Number(delaySeconds) : undefined,
    });
    res.json(result);
  } catch (error: any) {
    logger.error(`[SalesTeam] Error sending appointment reminder: ${error.message}`, error, 'SalesTeam');
    res.status(500).json({ error: error.message });
  }
});

// ── 13. POST /api/sales-team/site-visits/:id/no-show-recovery ──
salesTeamRouter.post('/site-visits/:id/no-show-recovery', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { id } = req.params;
    const { delaySeconds, notes, customVoiceScript, customWhatsappMessage, customAgentId } = req.body || {};
    const { AppointmentRecoveryService } = await import('../services/appointment-recovery.service');
    const result = await AppointmentRecoveryService.triggerNoShowRecovery({
      appointmentId: id,
      userId,
      delaySeconds: delaySeconds ? Number(delaySeconds) : 30,
      notes,
      customVoiceScript,
      customWhatsappMessage,
      customAgentId,
    });
    res.json(result);
  } catch (error: any) {
    logger.error(`[SalesTeam] Error triggering no-show recovery: ${error.message}`, error, 'SalesTeam');
    res.status(500).json({ error: error.message });
  }
});

// ── 13A. POST /api/sales-team/site-visits/:id/send-review-request (Manual 1-click) ──
salesTeamRouter.post('/site-visits/:id/send-review-request', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { ReviewComplaintAutomationService } = await import('../services/review-complaint-automation.service');
    const result = await ReviewComplaintAutomationService.sendReviewRequest({
      userId,
      appointmentId: req.params.id,
      trigger: 'manual',
    });
    if (!result.success) return res.status(400).json(result);
    res.json(result);
  } catch (error: any) {
    logger.error(`[SalesTeam] Error sending review request: ${error.message}`, error, 'SalesTeam');
    res.status(500).json({ error: error.message });
  }
});

// ── 13B. GET & PUT /api/sales-team/reminder-automation-config ──
salesTeamRouter.get('/reminder-automation-config', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { AppointmentRecoveryService } = await import('../services/appointment-recovery.service');
    const config = await AppointmentRecoveryService.getAutomationConfig(userId);
    res.json(config);
  } catch (error: any) {
    logger.error(`[SalesTeam] Error fetching reminder automation config: ${error.message}`, error, 'SalesTeam');
    res.status(500).json({ error: error.message });
  }
});

// NOTE: PUT /reminder-automation-config is registered above PUT /:id (see section 2B)

// ── 14. POST /api/sales-team/site-visits/:id/auto-assign ───────
salesTeamRouter.post('/site-visits/:id/auto-assign', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { id } = req.params;
    const { AppointmentRecoveryService } = await import('../services/appointment-recovery.service');
    const assigned = await AppointmentRecoveryService.autoAssignAppointment(userId, id);
    if (!assigned) {
      return res.status(400).json({ error: 'No active sales team members available for auto-assignment' });
    }
    res.json(assigned);
  } catch (error: any) {
    logger.error(`[SalesTeam] Error auto-assigning visit: ${error.message}`, error, 'SalesTeam');
    res.status(500).json({ error: error.message });
  }
});

// ── 15. POST /api/sales-team/site-visits/auto-assign-all ───────
salesTeamRouter.post('/site-visits/auto-assign-all', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { AppointmentRecoveryService } = await import('../services/appointment-recovery.service');
    const result = await AppointmentRecoveryService.autoAssignAllUnassigned(userId);
    res.json(result);
  } catch (error: any) {
    logger.error(`[SalesTeam] Error bulk auto-assigning visits: ${error.message}`, error, 'SalesTeam');
    res.status(500).json({ error: error.message });
  }
});


