/**
 * ============================================================
 * Calliqo AI - Google Calendar Auto-Sync Background Worker
 * 
 * Automatically polls Google Calendar every 30 seconds for all users
 * who have Google Calendar connected.
 * 
 * - Only imports UPCOMING events from today onwards
 * - Automatically ignores birthdays, holidays, and past events
 * - Automatically inserts new appointments as UNASSIGNED so admin can manually appoint
 * - Sends instant bell & CRM notifications to admin
 * ============================================================
 */

import { db } from '../../db';
import { googleCalendarCredentials } from '@shared/schema';
import { syncGoogleCalendarEvents } from './google-calendar.service';
import { logger } from '../../utils/logger';

let workerInterval: NodeJS.Timeout | null = null;
let isSyncing = false;

export function startGoogleCalendarAutoSyncWorker(intervalMs = 30000) {
  if (workerInterval) return;

  console.log(`📅 [GoogleCalendarWorker] Auto-sync worker started (polling every ${intervalMs / 1000}s)`);

  // Initial sync after 3 seconds of server startup
  setTimeout(() => runSyncCycle(), 3000);

  workerInterval = setInterval(() => {
    runSyncCycle();
  }, intervalMs);
}

export function stopGoogleCalendarAutoSyncWorker() {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
  }
}

async function runSyncCycle() {
  if (isSyncing) return;
  isSyncing = true;

  try {
    // Find all users who have Google Calendar connected
    const connectedUsers = await db
      .select({ userId: googleCalendarCredentials.userId })
      .from(googleCalendarCredentials);

    for (const { userId } of connectedUsers) {
      if (!userId) continue;
      try {
        await syncGoogleCalendarEvents(userId);
      } catch (err: any) {
        // Individual user error shouldn't stop other users
      }
    }
  } catch (error: any) {
    logger.warn(`[GoogleCalendarWorker] Auto-sync cycle error: ${error.message}`, undefined, 'GoogleCalendar');
  } finally {
    isSyncing = false;
  }
}
