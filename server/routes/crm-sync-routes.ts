'use strict';
/**
 * ============================================================
 * Calliqo AI - CRM Sync API Routes
 * 
 * Provides endpoints for Google Sheets 2-way sync management,
 * Google Calendar availability queries, appointment bookings,
 * and sync audit logs.
 * ============================================================
 */

import { Router, type Request, type Response } from 'express';
import { CrmSyncService } from '../services/crm-sync/crm-sync.service';
import { getConnectionStatus as getSheetsStatus } from '../services/google-sheets/google-sheets.service';
import { getCalendarConnectionStatus } from '../services/google-calendar/google-calendar.service';

export const crmSyncRouter = Router();

// ── GET /status ─────────────────────────────────────────────
crmSyncRouter.get('/status', async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const [sheets, calendar] = await Promise.all([
      getSheetsStatus(userId),
      getCalendarConnectionStatus(userId),
    ]);

    res.json({
      googleSheets: sheets,
      googleCalendar: calendar,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── GET /configs ────────────────────────────────────────────
crmSyncRouter.get('/configs', async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const configs = await CrmSyncService.listSyncConfigs(userId);
    res.json(configs);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── POST /configs ───────────────────────────────────────────
crmSyncRouter.post('/configs', async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const saved = await CrmSyncService.saveSyncConfig(userId, req.body);
    res.json(saved);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ── DELETE /configs/:id ─────────────────────────────────────
crmSyncRouter.delete('/configs/:id', async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    await CrmSyncService.deleteSyncConfig(userId, req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── POST /configs/:id/sync ──────────────────────────────────
crmSyncRouter.post('/configs/:id/sync', async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const result = await CrmSyncService.syncGoogleSheet(userId, req.params.id);
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ── GET /headers ────────────────────────────────────────────
crmSyncRouter.get('/headers', async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { spreadsheetId, sheetTabName } = req.query as { spreadsheetId?: string; sheetTabName?: string };
  if (!spreadsheetId) {
    return res.status(400).json({ error: 'spreadsheetId query parameter is required' });
  }

  try {
    const headers = await CrmSyncService.getSheetHeaders(userId, spreadsheetId, sheetTabName || 'Sheet1');
    res.json(headers);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ── GET /logs ───────────────────────────────────────────────
crmSyncRouter.get('/logs', async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const logs = await CrmSyncService.getSyncLogs(userId, limit);
    res.json(logs);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── GET /calendar/slots ─────────────────────────────────────
crmSyncRouter.get('/calendar/slots', async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { date, duration } = req.query as { date?: string; duration?: string };
  if (!date) {
    return res.status(400).json({ error: 'date (YYYY-MM-DD) query parameter is required' });
  }

  try {
    const dur = parseInt(duration || '30', 10);
    const result = await CrmSyncService.checkCalendarAvailability(userId, date, dur);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── POST /calendar/book ─────────────────────────────────────
crmSyncRouter.post('/calendar/book', async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { contactName, contactPhone, appointmentDate, appointmentTime } = req.body;
  if (!contactName || !contactPhone || !appointmentDate || !appointmentTime) {
    return res.status(400).json({ error: 'contactName, contactPhone, appointmentDate, appointmentTime are required' });
  }

  try {
    const result = await CrmSyncService.bookAppointment(userId, req.body);
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});
