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

export const salesTeamRouter = Router();

// Helper to resolve userId
function getUserId(req: Request): string | null {
  return (req as any).user?.id || (req as any).userId || null;
}

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
      sendStaffAssignmentEmail({
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
      }).catch(err => logger.warn(`[SalesTeam] Staff email error: ${err.message}`, undefined, 'SalesTeam'));
    }

    // ── Email Notification to Customer / Client ──
    const targetClientEmail = clientEmail?.trim() || updatedAppointment.contactEmail;
    if (targetClientEmail && sendEmailToClient !== false) {
      sendClientConfirmationEmail({
        clientEmail: targetClientEmail,
        clientName: updatedAppointment.contactName,
        serviceName: updatedAppointment.serviceName || 'Property Site Visit',
        appointmentDate: String(updatedAppointment.appointmentDate),
        appointmentTime: String(updatedAppointment.appointmentTime),
        staffName: isAssigning ? staffName : null,
        staffPhone: isAssigning ? staffPhone : null,
        staffRole: isAssigning && staffRecord ? staffRecord.role : 'Property Consultant',
      }).catch(err => logger.warn(`[SalesTeam] Client email error: ${err.message}`, undefined, 'SalesTeam'));
    }

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

    res.json(updatedAppointment);
  } catch (error: any) {
    logger.error(`[SalesTeam] Error updating visit status: ${error.message}`, error, 'SalesTeam');
    res.status(500).json({ error: error.message });
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
        clientEmail: created.contactEmail,
        clientName: created.contactName,
        serviceName: created.serviceName || 'Property Site Visit',
        appointmentDate: String(created.appointmentDate),
        appointmentTime: String(created.appointmentTime),
        staffName: isAssigning ? staffName : null,
        staffPhone: isAssigning ? staffPhone : null,
      }).catch(e => logger.warn(`Client email error: ${e.message}`, undefined, 'SalesTeam'));
    }

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

