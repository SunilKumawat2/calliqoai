import { db } from "../../db";
import { googleCalendarCredentials, appointmentSettings, users, appointments, notifications } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { getGoogleCredentials } from "../google-sheets/google-sheets.service";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";

export interface CalendarAppointment {
  id: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string | null;
  appointmentDate: string;
  appointmentTime: string;
  duration: number;
  serviceName: string | null;
  notes: string | null;
  status: string;
}

export async function refreshCalendarToken(userId: string, force = false): Promise<string | null> {
  const [cred] = await db
    .select()
    .from(googleCalendarCredentials)
    .where(eq(googleCalendarCredentials.userId, userId))
    .limit(1);

  if (!cred) return null;

  const now = new Date();
  if (!force && cred.tokenExpiry > now) {
    return cred.accessToken;
  }

  const creds = await getGoogleCredentials();
  if (!creds) {
    console.error("[GoogleCalendar] Google OAuth credentials not configured");
    return null;
  }

  try {
    const resp = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        refresh_token: cred.refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!resp.ok) {
      console.error("[GoogleCalendar] Token refresh failed:", await resp.text());
      return null;
    }

    const data = await resp.json() as { access_token: string; expires_in: number };
    const newExpiry = new Date(Date.now() + data.expires_in * 1000);

    await db
      .update(googleCalendarCredentials)
      .set({ accessToken: data.access_token, tokenExpiry: newExpiry, updatedAt: new Date() })
      .where(eq(googleCalendarCredentials.userId, userId));

    return data.access_token;
  } catch (err: any) {
    console.error("[GoogleCalendar] Token refresh error:", err.message);
    return null;
  }
}

function buildEventBody(apt: CalendarAppointment, timezone: string) {
  const dateStr = apt.appointmentDate;
  const timeStr = apt.appointmentTime.substring(0, 5);
  const startDateTime = `${dateStr}T${timeStr}:00`;

  // Parse time and date locally (without shifting timezone)
  const [hoursStr, minutesStr] = timeStr.split(':');
  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  
  const startYear = parseInt(yearStr, 10);
  const startMonth = parseInt(monthStr, 10) - 1; // 0-indexed
  const startDay = parseInt(dayStr, 10);
  const startHours = parseInt(hoursStr, 10);
  const startMinutes = parseInt(minutesStr, 10);
  
  const startDate = new Date(startYear, startMonth, startDay, startHours, startMinutes);
  const endDate = new Date(startDate.getTime() + apt.duration * 60 * 1000);
  
  // Format endDate back to local YYYY-MM-DDTHH:mm:ss format
  const endYear = endDate.getFullYear();
  const endMonth = String(endDate.getMonth() + 1).padStart(2, '0');
  const endDay = String(endDate.getDate()).padStart(2, '0');
  const endHours = String(endDate.getHours()).padStart(2, '0');
  const endMinutes = String(endDate.getMinutes()).padStart(2, '0');
  
  const endDateTime = `${endYear}-${endMonth}-${endDay}T${endHours}:${endMinutes}:00`;

  const descParts: string[] = [
    `Phone: ${apt.contactPhone}`,
  ];
  if (apt.contactEmail) descParts.push(`Email: ${apt.contactEmail}`);
  if (apt.serviceName) descParts.push(`Service: ${apt.serviceName}`);
  descParts.push(`Duration: ${apt.duration} minutes`);
  if (apt.notes) descParts.push(`Notes: ${apt.notes}`);
  descParts.push(`\nBooked by AI agent via Diploy`);

  if (apt.status === "completed") {
    const completedAt = new Date().toLocaleString("en-US", {
      month: "short", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit", hour12: true,
    });
    descParts.push(`\nCompleted at: ${completedAt}`);
  }

  const statusLabel = apt.status.charAt(0).toUpperCase() + apt.status.slice(1);

  return {
    summary: `${statusLabel}: ${apt.contactName}${apt.serviceName ? ` — ${apt.serviceName}` : ""}`,
    description: descParts.join("\n"),
    start: { dateTime: startDateTime, timeZone: timezone },
    end: { dateTime: endDateTime, timeZone: timezone },
  };
}

export async function createCalendarEvent(userId: string, apt: CalendarAppointment): Promise<string | null> {
  let token = await refreshCalendarToken(userId);
  if (!token) return null;

  // Retrieve user's timezone configuration
  const [user] = await db
    .select({ timezone: users.timezone })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const timezone = user?.timezone || "UTC";

  const body = buildEventBody(apt, timezone);

  const doCreate = (t: string) =>
    fetch(`${GOOGLE_CALENDAR_API}/calendars/primary/events`, {
      method: "POST",
      headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  try {
    let resp = await doCreate(token);
    if (resp.status === 401) {
      const fresh = await refreshCalendarToken(userId, true);
      if (!fresh) return null;
      resp = await doCreate(fresh);
    }
    if (!resp.ok) {
      console.error("[GoogleCalendar] Create event failed:", await resp.text());
      return null;
    }
    const data = await resp.json() as { id: string };
    console.log(`📅 [GoogleCalendar] Created event ${data.id} for appointment ${apt.id}`);
    return data.id;
  } catch (err: any) {
    console.error("[GoogleCalendar] Create event error:", err.message);
    return null;
  }
}

export async function updateCalendarEvent(userId: string, eventId: string, apt: CalendarAppointment): Promise<boolean> {
  let token = await refreshCalendarToken(userId);
  if (!token) return false;

  // Retrieve user's timezone configuration
  const [user] = await db
    .select({ timezone: users.timezone })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const timezone = user?.timezone || "UTC";

  const body = buildEventBody(apt, timezone);

  const doUpdate = (t: string) =>
    fetch(`${GOOGLE_CALENDAR_API}/calendars/primary/events/${encodeURIComponent(eventId)}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  try {
    let resp = await doUpdate(token);
    if (resp.status === 401) {
      const fresh = await refreshCalendarToken(userId, true);
      if (!fresh) return false;
      resp = await doUpdate(fresh);
    }
    if (!resp.ok) {
      console.error("[GoogleCalendar] Update event failed:", await resp.text());
      return false;
    }
    console.log(`📅 [GoogleCalendar] Updated event ${eventId}`);
    return true;
  } catch (err: any) {
    console.error("[GoogleCalendar] Update event error:", err.message);
    return false;
  }
}

export async function deleteCalendarEvent(userId: string, eventId: string): Promise<boolean> {
  let token = await refreshCalendarToken(userId);
  if (!token) return false;

  const doDelete = (t: string) =>
    fetch(`${GOOGLE_CALENDAR_API}/calendars/primary/events/${encodeURIComponent(eventId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${t}` },
    });

  try {
    let resp = await doDelete(token);
    if (resp.status === 401) {
      const fresh = await refreshCalendarToken(userId, true);
      if (!fresh) return false;
      resp = await doDelete(fresh);
    }
    if (resp.status === 404) {
      console.warn(`[GoogleCalendar] Event ${eventId} not found (already deleted?)`);
      return true;
    }
    if (!resp.ok) {
      console.error("[GoogleCalendar] Delete event failed:", await resp.text());
      return false;
    }
    console.log(`📅 [GoogleCalendar] Deleted event ${eventId}`);
    return true;
  } catch (err: any) {
    console.error("[GoogleCalendar] Delete event error:", err.message);
    return false;
  }
}

export async function isCalendarSyncEnabled(userId: string): Promise<boolean> {
  const [cred] = await db
    .select({ id: googleCalendarCredentials.id })
    .from(googleCalendarCredentials)
    .where(eq(googleCalendarCredentials.userId, userId))
    .limit(1);

  if (!cred) return false;

  const [settings] = await db
    .select({ syncToGoogleCalendar: appointmentSettings.syncToGoogleCalendar })
    .from(appointmentSettings)
    .where(eq(appointmentSettings.userId, userId))
    .limit(1);

  return settings?.syncToGoogleCalendar ?? false;
}

export async function getCalendarConnectionStatus(userId: string): Promise<{ connected: boolean; email?: string }> {
  const [cred] = await db
    .select({ connectedEmail: googleCalendarCredentials.connectedEmail })
    .from(googleCalendarCredentials)
    .where(eq(googleCalendarCredentials.userId, userId))
    .limit(1);

  if (!cred) return { connected: false };
  return { connected: true, email: cred.connectedEmail };
}

export async function disconnectGoogleCalendar(userId: string): Promise<void> {
  await db.delete(googleCalendarCredentials).where(eq(googleCalendarCredentials.userId, userId));
}

export async function checkFreeBusySlots(
  userId: string,
  dateStr: string,
  slotDurationMinutes = 30
): Promise<{ slots: string[]; timezone: string } | null> {
  let token = await refreshCalendarToken(userId);
  if (!token) return null;

  const [user] = await db
    .select({ timezone: users.timezone })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const timezone = user?.timezone || "Asia/Kolkata";

  const timeMin = `${dateStr}T00:00:00Z`;
  const timeMax = `${dateStr}T23:59:59Z`;

  try {
    const doQuery = (t: string) =>
      fetch(`${GOOGLE_CALENDAR_API}/freeBusy`, {
        method: "POST",
        headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          timeMin,
          timeMax,
          timeZone: timezone,
          items: [{ id: "primary" }],
        }),
      });

    let resp = await doQuery(token);
    if (resp.status === 401) {
      const fresh = await refreshCalendarToken(userId, true);
      if (!fresh) return null;
      resp = await doQuery(fresh);
    }

    if (!resp.ok) {
      console.error("[GoogleCalendar] FreeBusy query failed:", await resp.text());
      return null;
    }

    const data = await resp.json() as {
      calendars?: {
        primary?: {
          busy?: Array<{ start: string; end: string }>;
        };
      };
    };

    const busyRanges = data.calendars?.primary?.busy || [];

    const startHour = 9;
    const endHour = 18;
    const availableSlots: string[] = [];

    for (let h = startHour; h < endHour; h++) {
      for (let m = 0; m < 60; m += slotDurationMinutes) {
        const slotTimeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        const slotStart = new Date(`${dateStr}T${slotTimeStr}:00`);
        const slotEnd = new Date(slotStart.getTime() + slotDurationMinutes * 60 * 1000);

        const isBusy = busyRanges.some((b) => {
          const bStart = new Date(b.start);
          const bEnd = new Date(b.end);
          return slotStart < bEnd && slotEnd > bStart;
        });

        if (!isBusy) {
          availableSlots.push(slotTimeStr);
        }
      }
    }

    return { slots: availableSlots, timezone };
  } catch (err: any) {
    console.error("[GoogleCalendar] FreeBusy query error:", err.message);
    return null;
  }
}

/**
 * Sync / Import events from Google Calendar into Calliqo CRM appointments
 * Creates new events as UNASSIGNED so the admin can manually appoint a staff member.
 */
export async function syncGoogleCalendarEvents(userId: string): Promise<{
  synced: boolean;
  imported: number;
  updated: number;
  total: number;
  error?: string;
}> {
  let token = await refreshCalendarToken(userId);
  if (!token) {
    return { synced: false, imported: 0, updated: 0, total: 0, error: "Google Calendar is not connected. Please connect Google Calendar first." };
  }

  // Look for events from 14 days ago to 90 days in the future
  const timeMin = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const timeMax = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

  const doFetch = (t: string) =>
    fetch(
      `${GOOGLE_CALENDAR_API}/calendars/primary/events?singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&maxResults=250`,
      {
        headers: { Authorization: `Bearer ${t}` },
      }
    );

  try {
    let resp = await doFetch(token);
    if (resp.status === 401) {
      const fresh = await refreshCalendarToken(userId, true);
      if (!fresh) return { synced: false, imported: 0, updated: 0, total: 0, error: "Google authentication failed. Please reconnect Google Calendar." };
      resp = await doFetch(fresh);
    }

    if (!resp.ok) {
      const errText = await resp.text();
      console.error("[GoogleCalendar] Fetch events failed:", errText);
      return { synced: false, imported: 0, updated: 0, total: 0, error: errText };
    }

    const data = (await resp.json()) as { items?: any[] };
    const items = data.items || [];

    let imported = 0;
    let updated = 0;

    for (const item of items) {
      if (item.status === "cancelled") continue;

      const eventId = item.id;
      const summary = (item.summary || "").trim();
      const description = (item.description || "").trim();

      // Determine date and time
      const startDateTimeStr = item.start?.dateTime || item.start?.date || "";
      if (!startDateTimeStr) continue;

      let appointmentDate = "";
      let appointmentTime = "11:00";

      if (startDateTimeStr.includes("T")) {
        const [dPart, tPart] = startDateTimeStr.split("T");
        appointmentDate = dPart;
        appointmentTime = tPart.substring(0, 5); // "HH:mm"
      } else {
        appointmentDate = startDateTimeStr; // "YYYY-MM-DD"
      }

      // Extract client name
      let contactName = "";
      const prefixMatch = summary.match(/(?:Site Visit|Appointment|Consultation|Booking|Confirmed|Pending)[:\s—\-]+(.+?)(?:\s*—|\s*-\s*|$)/i);
      if (prefixMatch && prefixMatch[1]) {
        contactName = prefixMatch[1].trim();
      }

      // Check attendees
      const attendees = item.attendees || [];
      const nonSelfAttendee = attendees.find((a: any) => !a.self);
      let contactEmail = nonSelfAttendee?.email || null;

      if (!contactName && nonSelfAttendee?.displayName) {
        contactName = nonSelfAttendee.displayName.trim();
      }

      // If email in description
      if (!contactEmail && description) {
        const emailMatch = description.match(/(?:email|mail)[:\s]*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
        if (emailMatch && emailMatch[1]) {
          contactEmail = emailMatch[1].trim();
        }
      }

      // Extract client phone from description or summary
      let contactPhone = "";
      const textToSearch = `${description} ${summary}`;
      const phoneMatch = textToSearch.match(/(?:phone|mobile|tel|contact|whatsapp)[:\s]*([+0-9\s\-()]{10,20})/i) ||
                         textToSearch.match(/(\+?91[\s\-]?[6-9][0-9]{9}|\+?[1-9][0-9]{9,13})/);
      if (phoneMatch && phoneMatch[1]) {
        contactPhone = phoneMatch[1].replace(/[\s\-()]/g, "").trim();
      }

      if (!contactName) {
        contactName = summary || (contactEmail ? contactEmail.split("@")[0] : "Google Calendar Client");
      }
      if (!contactPhone) {
        contactPhone = "Google Calendar";
      }

      // Service / Project name
      let serviceName = "Property Site Visit";
      if (summary.includes("—") || summary.includes("-")) {
        const parts = summary.split(/[—\-]/);
        if (parts.length > 1) {
          serviceName = parts[parts.length - 1].trim();
        }
      } else if (summary.toLowerCase().includes("bhk") || summary.toLowerCase().includes("visit") || summary.toLowerCase().includes("heights")) {
        serviceName = summary;
      }

      const notes = description || summary;

      // Check if existing appointment in DB
      const [existing] = await db
        .select()
        .from(appointments)
        .where(
          and(
            eq(appointments.userId, userId),
            eq(appointments.googleCalendarEventId, eventId)
          )
        )
        .limit(1);

      if (existing) {
        if (
          existing.appointmentDate !== appointmentDate ||
          existing.appointmentTime !== appointmentTime ||
          existing.notes !== notes
        ) {
          await db
            .update(appointments)
            .set({
              appointmentDate,
              appointmentTime,
              notes,
              contactEmail: contactEmail || existing.contactEmail,
              updatedAt: new Date(),
            })
            .where(eq(appointments.id, existing.id));
          updated++;
        }
      } else {
        // New appointment from Google Calendar! Insert as UNASSIGNED so admin can manually assign!
        const aptId = `apt_gcal_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        await db.insert(appointments).values({
          id: aptId,
          userId,
          contactName,
          contactPhone,
          contactEmail,
          appointmentDate,
          appointmentTime,
          duration: 30,
          serviceName,
          notes,
          status: "scheduled",
          googleCalendarEventId: eventId,
          assignedStaffId: null, // UNASSIGNED - Awaiting manual assignment by admin
          assignedStaffName: null,
          assignedStaffPhone: null,
        });

        // Add Bell & CRM notification
        try {
          const notifId = `notif_${Date.now()}_${Math.random().toString(36).substring(7)}`;
          await db.insert(notifications).values({
            id: notifId,
            userId,
            type: "site_visit",
            title: `📅 Google Calendar Site Visit: ${contactName}`,
            message: `${contactName} (${contactPhone}) scheduled for ${serviceName} on ${appointmentDate} at ${appointmentTime}. Action required: Appoint a sales executive!`,
            link: "/app/crm",
            isRead: false,
          });
        } catch (_) {}

        imported++;
      }
    }

    console.log(`📅 [GoogleCalendar] Sync complete for user ${userId}: ${imported} imported, ${updated} updated out of ${items.length} events`);
    return { synced: true, imported, updated, total: items.length };
  } catch (err: any) {
    console.error("[GoogleCalendar] Sync error:", err.message);
    return { synced: false, imported: 0, updated: 0, total: 0, error: err.message };
  }
}


