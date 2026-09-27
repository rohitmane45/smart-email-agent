import { getCalendarClient } from '../auth/oauth-manager.js';
import { run, queryAll, queryOne } from '../db/database.js';

/**
 * Create a Google Calendar event from AI-extracted event details.
 * @param {number} accountId - The Gmail account to create the event under.
 * @param {number} emailId - The source email ID in our DB.
 * @param {object} eventDetails - Extracted event details from AI.
 * @returns {object|null} The created event or null on failure.
 */
export async function createCalendarEvent(accountId, emailId, eventDetails) {
  try {
    if (!eventDetails?.startTime) {
      console.log('⚠️ No start time for event, skipping calendar creation');
      return null;
    }

    const calendar = await getCalendarClient(accountId);

    // Build event resource
    const event = {
      summary: eventDetails.summary || 'Event from Email',
      description: eventDetails.description || '',
      start: buildDateTime(eventDetails.startTime),
      end: buildDateTime(eventDetails.endTime || addOneHour(eventDetails.startTime)),
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 30 },
          { method: 'popup', minutes: 10 },
          { method: 'email', minutes: 60 },
        ],
      },
    };

    // Add location if available
    if (eventDetails.location) {
      event.location = eventDetails.location;
    }

    // Check for duplicate events
    const isDuplicate = await checkDuplicate(calendar, event);
    if (isDuplicate) {
      console.log(`⏭️ Duplicate event skipped: "${event.summary}"`);
      return null;
    }

    // Insert the event
    const res = await calendar.events.insert({
      calendarId: 'primary',
      resource: event,
      sendNotifications: true,
    });

    const createdEvent = res.data;

    // Save to our database
    run(
      `INSERT INTO calendar_events (email_id, account_id, calendar_event_id, summary, description, start_time, end_time, location, reminders) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        emailId,
        accountId,
        createdEvent.id,
        event.summary,
        event.description,
        eventDetails.startTime,
        eventDetails.endTime || '',
        eventDetails.location || '',
        JSON.stringify(event.reminders.overrides),
      ]
    );

    console.log(`📅 Calendar event created: "${event.summary}" — ${createdEvent.htmlLink}`);
    return createdEvent;
  } catch (error) {
    console.error('❌ Failed to create calendar event:', error.message);
    return null;
  }
}

/**
 * Create an urgent calendar event with more aggressive reminders.
 */
export async function createUrgentCalendarEvent(accountId, emailId, eventDetails) {
  // Override reminders with more aggressive ones for urgent events
  const urgentDetails = {
    ...eventDetails,
    summary: `🔴 URGENT: ${eventDetails.summary}`,
  };

  try {
    const calendar = await getCalendarClient(accountId);

    const event = {
      summary: urgentDetails.summary,
      description: urgentDetails.description || '',
      start: buildDateTime(urgentDetails.startTime),
      end: buildDateTime(urgentDetails.endTime || addOneHour(urgentDetails.startTime)),
      colorId: '11', // Red color for urgent events
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 5 },
          { method: 'popup', minutes: 15 },
          { method: 'popup', minutes: 30 },
          { method: 'popup', minutes: 60 },
          { method: 'email', minutes: 120 },
        ],
      },
    };

    if (urgentDetails.location) {
      event.location = urgentDetails.location;
    }

    const res = await calendar.events.insert({
      calendarId: 'primary',
      resource: event,
      sendNotifications: true,
    });

    run(
      `INSERT INTO calendar_events (email_id, account_id, calendar_event_id, summary, description, start_time, end_time, location, reminders)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        emailId,
        accountId,
        res.data.id,
        event.summary,
        event.description,
        urgentDetails.startTime,
        urgentDetails.endTime || '',
        urgentDetails.location || '',
        JSON.stringify(event.reminders.overrides),
      ]
    );

    console.log(`🔴 Urgent calendar event created: "${event.summary}"`);
    return res.data;
  } catch (error) {
    console.error('❌ Failed to create urgent calendar event:', error.message);
    return null;
  }
}

/**
 * Get upcoming calendar events created by this agent.
 */
export function getCreatedEvents(limit = 20) {
  return queryAll(
    `SELECT ce.*, a.email as account_email FROM calendar_events ce
     JOIN accounts a ON ce.account_id = a.id
     ORDER BY ce.created_at DESC LIMIT ?`,
    [limit]
  );
}

/**
 * Check for duplicate events on the same day with the same summary.
 */
async function checkDuplicate(calendar, event) {
  try {
    const timeMin = event.start.dateTime || event.start.date;
    const timeMax = event.end.dateTime || event.end.date;

    const res = await calendar.events.list({
      calendarId: 'primary',
      timeMin,
      timeMax,
      q: event.summary,
      maxResults: 5,
    });

    return (res.data.items || []).some(
      (existing) => existing.summary?.toLowerCase() === event.summary?.toLowerCase()
    );
  } catch {
    return false;
  }
}

/**
 * Build a dateTime object for Google Calendar API.
 */
function buildDateTime(isoString) {
  if (!isoString) return { dateTime: new Date().toISOString(), timeZone: 'Asia/Kolkata' };

  // If it's a date-only string (no time component), use the date field
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoString)) {
    return { date: isoString };
  }

  // Ensure proper ISO format with timezone
  let dateTime = isoString;
  if (!isoString.includes('T')) {
    dateTime = isoString + 'T00:00:00';
  }
  if (!isoString.includes('+') && !isoString.includes('Z') && !isoString.endsWith(']')) {
    dateTime += '+05:30'; // Default IST
  }

  return { dateTime, timeZone: 'Asia/Kolkata' };
}

/**
 * Add one hour to an ISO datetime string.
 */
function addOneHour(isoString) {
  try {
    const date = new Date(isoString);
    date.setHours(date.getHours() + 1);
    return date.toISOString();
  } catch {
    return isoString;
  }
}

export default { createCalendarEvent, createUrgentCalendarEvent, getCreatedEvents };
