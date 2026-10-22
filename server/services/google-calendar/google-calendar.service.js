import { db } from "../../db.js";
import { googleCalendarCredentials, appointmentSettings, users, appointments, notifications } from "../../../shared/schema.js";
import { eq, and, sql } from "drizzle-orm";
import { getGoogleCredentials } from "../google-sheets/google-sheets.service.js";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";
async function refreshCalendarToken(userId, force = false) {
  const [cred] = await db.select().from(googleCalendarCredentials).where(eq(googleCalendarCredentials.userId, userId)).limit(1);
  if (!cred) return null;
  const now = /* @__PURE__ */ new Date();
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
        grant_type: "refresh_token"
      })
    });
    if (!resp.ok) {
      console.error("[GoogleCalendar] Token refresh failed:", await resp.text());
      return null;
    }
    const data = await resp.json();
    const newExpiry = new Date(Date.now() + data.expires_in * 1e3);
    await db.update(googleCalendarCredentials).set({ accessToken: data.access_token, tokenExpiry: newExpiry, updatedAt: /* @__PURE__ */ new Date() }).where(eq(googleCalendarCredentials.userId, userId));
    return data.access_token;
  } catch (err) {
    console.error("[GoogleCalendar] Token refresh error:", err.message);
    return null;
  }
}
function buildEventBody(apt, timezone) {
  const dateStr = apt.appointmentDate;
  const timeStr = (apt.appointmentTime || "11:00").substring(0, 5);
  const startDateTime = `${dateStr}T${timeStr}:00`;
  const [hoursStr, minutesStr] = timeStr.split(":");
  const [yearStr, monthStr, dayStr] = dateStr.split("-");
  const startYear = parseInt(yearStr, 10);
  const startMonth = parseInt(monthStr, 10) - 1;
  const startDay = parseInt(dayStr, 10);
  const startHours = parseInt(hoursStr, 10);
  const startMinutes = parseInt(minutesStr, 10);
  const startDate = new Date(startYear, startMonth, startDay, startHours, startMinutes);
  const durationMinutes = Number(apt.duration) || 30;
  const endDate = new Date(startDate.getTime() + durationMinutes * 60 * 1e3);
  const endYear = endDate.getFullYear();
  const endMonth = String(endDate.getMonth() + 1).padStart(2, "0");
  const endDay = String(endDate.getDate()).padStart(2, "0");
  const endHours = String(endDate.getHours()).padStart(2, "0");
  const endMinutes = String(endDate.getMinutes()).padStart(2, "0");
  const endDateTime = `${endYear}-${endMonth}-${endDay}T${endHours}:${endMinutes}:00`;
  const rawStatus = (apt.status || "scheduled").toLowerCase();
  let statusBadge = "[SCHEDULED \u{1F4C5}]";
  let statusDisplay = "Scheduled";
  let colorId = void 0;
  switch (rawStatus) {
    case "visited":
    case "completed_visited":
    case "completed":
      statusBadge = "[VISITED \u2705]";
      statusDisplay = "Visited / Completed";
      colorId = "10";
      break;
    case "deal_won":
    case "won":
      statusBadge = "[DEAL WON \u{1F3C6}]";
      statusDisplay = "Deal Won / Sale Closed";
      colorId = "2";
      break;
    case "interested":
    case "interested_followup":
      statusBadge = "[INTERESTED \u2B50]";
      statusDisplay = "Interested / Hot Followup";
      colorId = "5";
      break;
    case "cancelled":
      statusBadge = "[CANCELLED \u274C]";
      statusDisplay = "Cancelled";
      colorId = "11";
      break;
    case "no_show":
      statusBadge = "[NO SHOW \u26A0\uFE0F]";
      statusDisplay = "Customer Did Not Show Up";
      colorId = "8";
      break;
    default:
      statusBadge = "[SCHEDULED \u{1F4C5}]";
      statusDisplay = "Scheduled";
      colorId = "9";
      break;
  }
  const descParts = [
    `\u{1F4CC} Status: ${statusDisplay}`,
    `\u{1F464} Customer: ${apt.contactName}`,
    `\u{1F4DE} Phone: ${apt.contactPhone}`
  ];
  if (apt.contactEmail) descParts.push(`\u{1F4E7} Email: ${apt.contactEmail}`);
  if (apt.serviceName) descParts.push(`\u{1F3E2} Property / Project: ${apt.serviceName}`);
  if (apt.assignedStaffName) {
    descParts.push(`\u{1F454} Assigned Executive: ${apt.assignedStaffName}${apt.assignedStaffPhone ? ` (${apt.assignedStaffPhone})` : ""}`);
  } else {
    descParts.push(`\u{1F454} Assigned Executive: Awaiting Assignment`);
  }
  descParts.push(`\u23F1 Duration: ${durationMinutes} minutes`);
  if (apt.notes) descParts.push(`\u{1F4DD} Notes: ${apt.notes}`);
  if (apt.statusReason) descParts.push(`\u{1F4AC} Status Reason: ${apt.statusReason}`);
  const updatedTimestamp = (/* @__PURE__ */ new Date()).toLocaleString("en-IN", {
    timeZone: timezone || "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short"
  });
  descParts.push(`
\u26A1 Synced live from Calliqo AI CRM (${updatedTimestamp})`);
  const eventPayload = {
    summary: `${statusBadge} ${apt.contactName}${apt.serviceName ? ` \u2014 ${apt.serviceName}` : ""}`,
    description: descParts.join("\n"),
    start: { dateTime: startDateTime, timeZone: timezone },
    end: { dateTime: endDateTime, timeZone: timezone }
  };
  if (colorId) {
    eventPayload.colorId = colorId;
  }
  return eventPayload;
}
async function createCalendarEvent(userId, apt) {
  let token = await refreshCalendarToken(userId);
  if (!token) return null;
  const [user] = await db.select({ timezone: users.timezone }).from(users).where(eq(users.id, userId)).limit(1);
  const timezone = user?.timezone || "UTC";
  const body = buildEventBody(apt, timezone);
  const doCreate = (t) => fetch(`${GOOGLE_CALENDAR_API}/calendars/primary/events`, {
    method: "POST",
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
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
    const data = await resp.json();
    console.log(`\u{1F4C5} [GoogleCalendar] Created event ${data.id} for appointment ${apt.id}`);
    return data.id;
  } catch (err) {
    console.error("[GoogleCalendar] Create event error:", err.message);
    return null;
  }
}
async function updateCalendarEvent(userId, eventId, apt) {
  let token = await refreshCalendarToken(userId);
  if (!token) return false;
  const [user] = await db.select({ timezone: users.timezone }).from(users).where(eq(users.id, userId)).limit(1);
  const timezone = user?.timezone || "UTC";
  const body = buildEventBody(apt, timezone);
  const doUpdate = (t) => fetch(`${GOOGLE_CALENDAR_API}/calendars/primary/events/${encodeURIComponent(eventId)}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
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
    console.log(`\u{1F4C5} [GoogleCalendar] Updated event ${eventId}`);
    return true;
  } catch (err) {
    console.error("[GoogleCalendar] Update event error:", err.message);
    return false;
  }
}
async function deleteCalendarEvent(userId, eventId) {
  let token = await refreshCalendarToken(userId);
  if (!token) return false;
  const doDelete = (t) => fetch(`${GOOGLE_CALENDAR_API}/calendars/primary/events/${encodeURIComponent(eventId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${t}` }
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
    console.log(`\u{1F4C5} [GoogleCalendar] Deleted event ${eventId}`);
    return true;
  } catch (err) {
    console.error("[GoogleCalendar] Delete event error:", err.message);
    return false;
  }
}
async function isCalendarSyncEnabled(userId) {
  const [cred] = await db.select({ id: googleCalendarCredentials.id }).from(googleCalendarCredentials).where(eq(googleCalendarCredentials.userId, userId)).limit(1);
  if (!cred) return false;
  const [settings] = await db.select({ syncToGoogleCalendar: appointmentSettings.syncToGoogleCalendar }).from(appointmentSettings).where(eq(appointmentSettings.userId, userId)).limit(1);
  return settings?.syncToGoogleCalendar ?? false;
}
async function getCalendarConnectionStatus(userId) {
  const [cred] = await db.select({ connectedEmail: googleCalendarCredentials.connectedEmail }).from(googleCalendarCredentials).where(eq(googleCalendarCredentials.userId, userId)).limit(1);
  if (!cred) return { connected: false };
  return { connected: true, email: cred.connectedEmail };
}
async function disconnectGoogleCalendar(userId) {
  await db.delete(googleCalendarCredentials).where(eq(googleCalendarCredentials.userId, userId));
}
async function checkFreeBusySlots(userId, dateStr, slotDurationMinutes = 30) {
  let token = await refreshCalendarToken(userId);
  if (!token) return null;
  const [user] = await db.select({ timezone: users.timezone }).from(users).where(eq(users.id, userId)).limit(1);
  const timezone = user?.timezone || "Asia/Kolkata";
  const timeMin = `${dateStr}T00:00:00Z`;
  const timeMax = `${dateStr}T23:59:59Z`;
  try {
    const doQuery = (t) => fetch(`${GOOGLE_CALENDAR_API}/freeBusy`, {
      method: "POST",
      headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        timeMin,
        timeMax,
        timeZone: timezone,
        items: [{ id: "primary" }]
      })
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
    const data = await resp.json();
    const busyRanges = data.calendars?.primary?.busy || [];
    const startHour = 9;
    const endHour = 18;
    const availableSlots = [];
    for (let h = startHour; h < endHour; h++) {
      for (let m = 0; m < 60; m += slotDurationMinutes) {
        const slotTimeStr = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
        const slotStart = /* @__PURE__ */ new Date(`${dateStr}T${slotTimeStr}:00`);
        const slotEnd = new Date(slotStart.getTime() + slotDurationMinutes * 60 * 1e3);
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
  } catch (err) {
    console.error("[GoogleCalendar] FreeBusy query error:", err.message);
    return null;
  }
}
async function syncGoogleCalendarEvents(userId) {
  let token = await refreshCalendarToken(userId);
  if (!token) {
    return { synced: false, imported: 0, updated: 0, total: 0, error: "Google Calendar is not connected. Please connect Google Calendar first." };
  }
  try {
    await db.execute(sql`
      DELETE FROM appointments 
      WHERE user_id = ${userId}
      AND (
        google_calendar_event_id IS NOT NULL 
        OR notes ILIKE '%birthday%'
        OR contact_name ILIKE '%birthday%'
        OR service_name ILIKE '%birthday%'
      )
      AND (
        appointment_date < CURRENT_DATE
        OR contact_name ILIKE '%birthday%'
        OR notes ILIKE '%birthday%'
        OR service_name ILIKE '%birthday%'
      )
    `);
  } catch (_) {
  }
  const today = /* @__PURE__ */ new Date();
  today.setHours(0, 0, 0, 0);
  const timeMin = today.toISOString();
  const timeMax = new Date(Date.now() + 180 * 24 * 60 * 60 * 1e3).toISOString();
  const todayDateStr = today.toISOString().split("T")[0];
  const doFetch = (t) => fetch(
    `${GOOGLE_CALENDAR_API}/calendars/primary/events?singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&maxResults=250`,
    {
      headers: { Authorization: `Bearer ${t}` }
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
    const data = await resp.json();
    const items = data.items || [];
    let imported = 0;
    let updated = 0;
    for (const item of items) {
      if (item.status === "cancelled") continue;
      const summary = (item.summary || "").trim();
      const description = (item.description || "").trim();
      const summaryLower = summary.toLowerCase();
      if (item.eventType === "birthday" || summaryLower.includes("birthday") || summaryLower.includes("anniversary") || summaryLower.includes("holiday") || summaryLower.includes("reminder")) {
        continue;
      }
      const startDateTimeStr = item.start?.dateTime || item.start?.date || "";
      if (!startDateTimeStr) continue;
      let appointmentDate = "";
      let appointmentTime = "11:00";
      if (startDateTimeStr.includes("T")) {
        const [dPart, tPart] = startDateTimeStr.split("T");
        appointmentDate = dPart;
        appointmentTime = tPart.substring(0, 5);
      } else {
        appointmentDate = startDateTimeStr;
      }
      if (appointmentDate < todayDateStr) {
        continue;
      }
      const eventId = item.id;
      const cleanSummary = summary.replace(/^\[[^\]]+\]\s*/, "").trim();
      let contactName = "";
      const prefixMatch = cleanSummary.match(/(?:Site Visit|Appointment|Consultation|Booking|Confirmed|Pending|Visited|Scheduled)[:\s—\-]+(.+?)(?:\s*—|\s*-\s*|$)/i);
      if (prefixMatch && prefixMatch[1]) {
        contactName = prefixMatch[1].trim();
      } else if (cleanSummary.includes("\u2014") || cleanSummary.includes("-")) {
        const parts = cleanSummary.split(/[—\-]/);
        if (parts.length > 0 && parts[0].trim()) {
          contactName = parts[0].trim();
        }
      }
      const attendees = item.attendees || [];
      const nonSelfAttendee = attendees.find((a) => !a.self);
      let contactEmail = nonSelfAttendee?.email || null;
      if (!contactName && nonSelfAttendee?.displayName) {
        contactName = nonSelfAttendee.displayName.trim();
      }
      if (!contactEmail && description) {
        const emailMatch = description.match(/(?:email|mail)[:\s]*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
        if (emailMatch && emailMatch[1]) {
          contactEmail = emailMatch[1].trim();
        }
      }
      let contactPhone = "";
      const textToSearch = `${description} ${summary}`;
      const phoneMatch = textToSearch.match(/(?:phone|mobile|tel|contact|whatsapp)[:\s]*([+0-9\s\-()]{10,20})/i) || textToSearch.match(/(\+?91[\s\-]?[6-9][0-9]{9}|\+?[1-9][0-9]{9,13})/);
      if (phoneMatch && phoneMatch[1]) {
        contactPhone = phoneMatch[1].replace(/[\s\-()]/g, "").trim();
      }
      if (!contactName) {
        contactName = cleanSummary || (contactEmail ? contactEmail.split("@")[0] : "Google Calendar Client");
      }
      if (!contactPhone) {
        contactPhone = "Google Calendar";
      }
      let serviceName = "Property Site Visit";
      if (cleanSummary.includes("\u2014") || cleanSummary.includes("-")) {
        const parts = cleanSummary.split(/[—\-]/);
        if (parts.length > 1) {
          serviceName = parts[parts.length - 1].trim();
        }
      } else if (cleanSummary.toLowerCase().includes("bhk") || cleanSummary.toLowerCase().includes("visit") || cleanSummary.toLowerCase().includes("heights")) {
        serviceName = cleanSummary;
      }
      const notes = description || summary;
      const [existing] = await db.select().from(appointments).where(
        and(
          eq(appointments.userId, userId),
          eq(appointments.googleCalendarEventId, eventId)
        )
      ).limit(1);
      if (existing) {
        if (existing.appointmentDate !== appointmentDate || existing.appointmentTime !== appointmentTime || existing.notes !== notes) {
          await db.update(appointments).set({
            appointmentDate,
            appointmentTime,
            notes,
            contactEmail: contactEmail || existing.contactEmail,
            updatedAt: /* @__PURE__ */ new Date()
          }).where(eq(appointments.id, existing.id));
          updated++;
        }
      } else {
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
          assignedStaffId: null,
          // UNASSIGNED - Awaiting manual assignment by admin
          assignedStaffName: null,
          assignedStaffPhone: null
        });
        try {
          const notifId = `notif_${Date.now()}_${Math.random().toString(36).substring(7)}`;
          await db.insert(notifications).values({
            id: notifId,
            userId,
            type: "site_visit",
            title: `\u{1F4C5} Google Calendar Site Visit: ${contactName}`,
            message: `${contactName} (${contactPhone}) scheduled for ${serviceName} on ${appointmentDate} at ${appointmentTime}. Action required: Appoint a sales executive!`,
            link: "/app/crm",
            isRead: false
          });
        } catch (_) {
        }
        imported++;
      }
    }
    console.log(`\u{1F4C5} [GoogleCalendar] Sync complete for user ${userId}: ${imported} imported, ${updated} updated out of ${items.length} events`);
    return { synced: true, imported, updated, total: items.length };
  } catch (err) {
    console.error("[GoogleCalendar] Sync error:", err.message);
    return { synced: false, imported: 0, updated: 0, total: 0, error: err.message };
  }
}
export {
  checkFreeBusySlots,
  createCalendarEvent,
  deleteCalendarEvent,
  disconnectGoogleCalendar,
  getCalendarConnectionStatus,
  isCalendarSyncEnabled,
  refreshCalendarToken,
  syncGoogleCalendarEvents,
  updateCalendarEvent
};
