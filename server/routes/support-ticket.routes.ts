import { Router, type Request, type Response } from 'express';
import { SupportTicketService } from '../services/support-ticket.service';
import { db } from '../db';
import { salesTeamMembers } from '@shared/schema';
import { and, eq } from 'drizzle-orm';

export const supportTicketRouter = Router();

function getUserId(req: Request): string | null {
  return (req as any).user?.id || (req as any).userId || null;
}

/**
 * GET /api/support-tickets/metrics
 * Resolution Rate Dashboard stats (Total queries, AI resolved, Escalated, AI resolution %)
 */
supportTicketRouter.get('/support-tickets/metrics', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const metrics = await SupportTicketService.getMetrics(userId);
    return res.json(metrics);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/support-tickets/staff/list
 * Active staff members available for ticket assignment
 */
supportTicketRouter.get('/support-tickets/staff/list', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const staff = await db
      .select({
        id: salesTeamMembers.id,
        name: salesTeamMembers.name,
        phone: salesTeamMembers.phone,
        email: salesTeamMembers.email,
        role: salesTeamMembers.role,
      })
      .from(salesTeamMembers)
      .where(and(eq(salesTeamMembers.userId, userId), eq(salesTeamMembers.isActive, true)));

    return res.json(staff);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/support-tickets
 * List support tickets with filtering, search and pagination
 */
supportTicketRouter.get('/support-tickets', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { status, priority, category, channel, search, limit, offset } = req.query;
    const result = await SupportTicketService.listTickets(userId, {
      status: status ? String(status) : undefined,
      priority: priority ? String(priority) : undefined,
      category: category ? String(category) : undefined,
      channel: channel ? String(channel) : undefined,
      search: search ? String(search) : undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/support-tickets
 * Create a new support ticket
 */
supportTicketRouter.post('/support-tickets', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const {
      customerName,
      customerPhone,
      customerEmail,
      channel,
      category,
      priority,
      subject,
      description,
      aiSummary,
      sentiment,
      assignedStaffId,
      escalated,
      metadata,
    } = req.body || {};

    if (!customerName || !customerPhone || !subject) {
      return res.status(400).json({ error: 'Customer name, phone, and subject are required.' });
    }

    const ticket = await SupportTicketService.createTicket(userId, {
      customerName,
      customerPhone,
      customerEmail,
      channel: channel || 'manual',
      category: category || 'service_complaint',
      priority: priority || 'medium',
      subject,
      description,
      aiSummary,
      sentiment,
      assignedStaffId,
      escalated: escalated === true,
      metadata,
    });

    return res.status(201).json(ticket);
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/support-tickets/test-auto-call
 * Simulate an automatic AI call complaint to test the auto-ticket creation pipeline
 */
supportTicketRouter.post('/support-tickets/test-auto-call', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { phone, customerName, customerEmail } = req.body || {};
    const testCallId = `call_test_${Date.now()}`;
    const detection = {
      isComplaint: true,
      reason: 'Negative sentiment detected • Complaint keywords: refund, bekar, manager',
      matchedKeywords: ['refund', 'bekar', 'manager'],
    };

    const ticket = await SupportTicketService.autoCreateFromCall(
      {
        id: testCallId,
        userId,
        phoneNumber: phone || '+917023088303',
        callDirection: 'incoming',
        duration: 85,
        firstName: customerName || 'Rajesh',
        lastName: 'Verma',
        sentiment: 'negative',
        aiSummary: 'Customer complained about service delay and demanded an immediate refund. Requested escalation to manager.',
        metadata: {
          customerPhone: phone || '+917023088303',
          customerName: customerName || 'Rajesh Verma',
          customerEmail: customerEmail || 'sunilmi17891@gmail.com',
          recordingUrl: 'https://calliqoai.com/sample-complaint-call.mp3',
        },
      },
      detection
    );

    return res.status(201).json({ success: true, ticket });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/support-tickets/:id
 * Get single ticket details
 */
supportTicketRouter.get('/support-tickets/:id', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const ticket = await SupportTicketService.getTicketById(userId, req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    return res.json(ticket);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/support-tickets/:id
 * Update status, priority, category, staff assignment, resolution notes
 */
supportTicketRouter.patch('/support-tickets/:id', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { status, priority, category, assignedStaffId, resolutionNotes, resolvedBy } = req.body || {};
    const updated = await SupportTicketService.updateTicket(userId, req.params.id, {
      status,
      priority,
      category,
      assignedStaffId,
      resolutionNotes,
      resolvedBy: resolvedBy || (req as any).user?.name || 'Staff',
    });

    if (!updated) return res.status(404).json({ error: 'Ticket not found' });
    return res.json(updated);
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/support-tickets/:id/escalate
 * Trigger 1-Click WhatsApp & Email escalation alert to Staff & Manager
 */
supportTicketRouter.post('/support-tickets/:id/escalate', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { customNote } = req.body || {};
    const updated = await SupportTicketService.reEscalateTicket(userId, req.params.id, customNote);
    if (!updated) return res.status(404).json({ error: 'Ticket not found' });
    return res.json({ success: true, ticket: updated, message: 'Escalation alert dispatched to WhatsApp & Email' });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

/**
 * DELETE /api/support-tickets/:id
 * Delete ticket
 */
supportTicketRouter.delete('/support-tickets/:id', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const deleted = await SupportTicketService.deleteTicket(userId, req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Ticket not found' });
    return res.json({ success: true, message: 'Ticket deleted successfully' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});
