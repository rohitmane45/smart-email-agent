import {
  sendUrgentNotification,
  sendCalendarNotification,
  sendReplyApprovalRequest,
  sendSummaryNotification,
  getTelegramStatus,
} from './telegram.js';
import { run, queryOne } from '../db/database.js';

/**
 * Send a notification through Telegram.
 * Routes based on email importance and notification preferences.
 */
export async function notify(type, data, emailId = null) {
  // Check if notifications are enabled for this importance level
  const shouldNotify = await checkNotificationPreference(data.importance || 'medium');
  if (!shouldNotify) {
    console.log(`🔕 Notification skipped (importance: ${data.importance})`);
    return;
  }

  let sent = false;

  // Send via Telegram
  const tgStatus = getTelegramStatus();
  if (tgStatus.isReady) {
    try {
      switch (type) {
        case 'urgent_email':
          sent = await sendUrgentNotification(data);
          break;
        case 'calendar_event':
          sent = await sendCalendarNotification(data);
          break;
        case 'reply_approval':
          sent = await sendReplyApprovalRequest(data);
          break;
        case 'summary':
          sent = await sendSummaryNotification(data);
          break;
        default:
          console.log(`⚠️ Unknown notification type: ${type}`);
      }
    } catch (error) {
      console.error('❌ Telegram notification failed:', error.message);
    }
  }

  // Log the notification (fire-and-forget)
  logNotification(type, 'telegram', JSON.stringify(data), emailId, sent ? 'sent' : 'failed');

  return sent;
}

/**
 * Send notification for an important email.
 * Stamps notified_at so this NEVER fires twice for the same email.
 */
export async function notifyImportantEmail(email, analysis, emailId = null) {
  if (!analysis.isUrgent && analysis.importance !== 'critical' && analysis.importance !== 'high') return;

  // Guard: if we have an emailId, check whether we already notified this email
  if (emailId) {
    const row = await queryOne('SELECT notified_at FROM emails WHERE id = ?', [emailId]);
    if (row?.notified_at) {
      console.log(`🔕 Notification already sent for email #${emailId} [“${email.subject}”] — skipping duplicate.`);
      return;
    }
    // Stamp notified_at immediately to prevent race conditions
    await run("UPDATE emails SET notified_at = datetime('now') WHERE id = ?", [emailId]);
  }

  return notify('urgent_email', {
    ...email,
    briefSummary: analysis.briefSummary,
    importance: analysis.importance,
    isRead: email.isRead ?? false,
  }, emailId);
}

/**
 * Send notification for a newly created calendar event.
 */
export async function notifyCalendarEvent(eventDetails) {
  return notify('calendar_event', {
    ...eventDetails,
    importance: 'high',
  });
}

/**
 * Send notification for a pending reply approval.
 */
export async function notifyReplyApproval(replyData) {
  return notify('reply_approval', {
    ...replyData,
    importance: 'medium',
  });
}

/**
 * Check if notifications should be sent for a given importance level.
 */
async function checkNotificationPreference(importance) {
  const notifyLevels = {
    critical: (await queryOne("SELECT value FROM settings WHERE key = 'notify_critical'"))?.value !== 'false',
    high: (await queryOne("SELECT value FROM settings WHERE key = 'notify_high'"))?.value !== 'false',
    medium: (await queryOne("SELECT value FROM settings WHERE key = 'notify_medium'"))?.value === 'true',
    low: (await queryOne("SELECT value FROM settings WHERE key = 'notify_low'"))?.value === 'true',
  };

  return notifyLevels[importance] ?? false;
}

/**
 * Log a notification to the database (fire-and-forget).
 */
function logNotification(type, channel, message, emailId, status) {
  run(
    `INSERT INTO notifications (type, channel, message, email_id, status) VALUES (?, ?, ?, ?, ?)`,
    [type, channel, message.substring(0, 1000), emailId, status]
  ).catch(() => {}); // non-critical, don't block
}

export default {
  notify,
  notifyImportantEmail,
  notifyCalendarEvent,
  notifyReplyApproval,
};
