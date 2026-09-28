/**
 * Telegram Bot — Notifications + Interactive Commands
 * Uses the official Telegram Bot API (REST). No extra dependencies.
 *
 * Commands you can send from your phone:
 *   /check   — Trigger an email check right now
 *   /status  — Get agent status (accounts, emails, pending replies)
 *   /recent  — Show last 5 important emails
 *   /help    — Show all available commands
 */

const TELEGRAM_API = 'https://api.telegram.org/bot';

let botToken = null;
let chatId = null;
let isConfigured = false;
let pollingActive = false;
let pollingTimeout = null;
let lastUpdateId = 0;

// Callback for /check command — set by app.js
let onCheckCommand = null;
// Callback for /status command
let onStatusCommand = null;
// Callback for /recent command
let onRecentCommand = null;

/**
 * Register command handlers from outside this module.
 */
export function registerCommandHandlers({ onCheck, onStatus, onRecent }) {
  onCheckCommand = onCheck || null;
  onStatusCommand = onStatus || null;
  onRecentCommand = onRecent || null;
}

/**
 * Initialize the Telegram bot with token and chat ID.
 */
export function initTelegram(token, targetChatId) {
  if (!token || !targetChatId) {
    console.log('⚠️ Telegram not configured (missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID)');
    console.log('💡 To set up Telegram notifications:');
    console.log('   1. Message @BotFather on Telegram → /newbot → get your token');
    console.log('   2. Message your bot, then visit:');
    console.log('      https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates');
    console.log('   3. Find your chat_id in the response');
    console.log('   4. Add both to your .env file\n');
    return;
  }

  botToken = token;
  chatId = targetChatId;
  isConfigured = true;
  console.log('✅ Telegram bot configured');
}

/**
 * Start polling for incoming commands from Telegram.
 */
export function startPolling() {
  if (!isConfigured) return;
  if (pollingActive) return;
  pollingActive = true;
  console.log('🔄 Telegram bot polling started — listening for commands');
  poll();
}

/**
 * Stop polling.
 */
export function stopPolling() {
  pollingActive = false;
  if (pollingTimeout) {
    clearTimeout(pollingTimeout);
    pollingTimeout = null;
  }
}

/**
 * Long-poll for updates from Telegram.
 */
async function poll() {
  if (!pollingActive) return;

  try {
    const url = `${TELEGRAM_API}${botToken}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 35000);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    const data = await res.json();

    if (data.ok && data.result.length > 0) {
      for (const update of data.result) {
        lastUpdateId = update.update_id;
        if (update.message?.text) {
          await handleCommand(update.message);
        }
      }
    }
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.error('⚠️ Telegram polling error:', error.message);
    }
  }

  // Schedule next poll
  if (pollingActive) {
    pollingTimeout = setTimeout(poll, 1000);
  }
}

/**
 * Handle incoming bot commands.
 */
async function handleCommand(message) {
  // Only respond to the configured chat
  if (String(message.chat.id) !== String(chatId)) return;

  const text = (message.text || '').trim().toLowerCase();
  const command = text.split(' ')[0];

  switch (command) {
    case '/start':
      await sendTelegramMessage(
        `👋 *Welcome to Smart Email Agent!*\n\n` +
        `I'm your AI-powered email assistant. Here's what I can do:\n\n` +
        `📧 /check — Check emails right now\n` +
        `📊 /status — View agent status\n` +
        `🔥 /recent — Show recent important emails\n` +
        `❓ /help — Show all commands\n\n` +
        `I'll automatically notify you when important emails arrive!`
      );
      break;

    case '/check':
      await sendTelegramMessage('🔄 *Checking emails now...*\nThis may take a minute.');
      if (onCheckCommand) {
        try {
          const result = await onCheckCommand();
          await sendTelegramMessage(
            `✅ *Email check complete!*\n\n` +
            `📬 Processed: ${result?.totalProcessed || 0} emails\n` +
            `🔴 Critical: ${result?.critical || 0}\n` +
            `🟠 High: ${result?.high || 0}\n` +
            `📅 Events created: ${result?.eventsCreated || 0}`
          );
        } catch (err) {
          await sendTelegramMessage(`❌ Email check failed: ${escMd(err.message)}`);
        }
      } else {
        await sendTelegramMessage('⚠️ Check command not available yet. Server may still be starting.');
      }
      break;

    case '/status':
      if (onStatusCommand) {
        try {
          const status = await onStatusCommand();
          await sendTelegramMessage(
            `📊 *Agent Status*\n\n` +
            `🟢 Server: Running\n` +
            `👤 Accounts: ${status.totalAccounts}\n` +
            `📧 Emails analyzed: ${status.totalEmails}\n` +
            `🔴 Critical: ${status.criticalEmails}\n` +
            `🟠 High: ${status.highEmails}\n` +
            `📅 Events: ${status.totalEvents}\n` +
            `✉️ Pending replies: ${status.pendingReplies}\n` +
            `⏰ Next check: every ${status.intervalHours || 3}h`
          );
        } catch (err) {
          await sendTelegramMessage(`❌ Status error: ${escMd(err.message)}`);
        }
      } else {
        await sendTelegramMessage('⚠️ Status not available yet.');
      }
      break;

    case '/recent':
      if (onRecentCommand) {
        try {
          const emails = await onRecentCommand();
          if (!emails || emails.length === 0) {
            await sendTelegramMessage('📭 No recent important emails found.');
          } else {
            let msg = '🔥 *Recent Important Emails:*\n\n';
            emails.forEach((e, i) => {
              const icon = e.importance === 'critical' ? '🔴' : e.importance === 'high' ? '🟠' : '🟡';
              msg += `${icon} *${escMd(e.subject || '(no subject)')}*\n`;
              msg += `   From: ${escMd(e.sender_name || e.sender_email)}\n`;
              msg += `   ${escMd(e.brief_summary || '')}\n\n`;
            });
            await sendTelegramMessage(msg);
          }
        } catch (err) {
          await sendTelegramMessage(`❌ Error: ${escMd(err.message)}`);
        }
      }
      break;

    case '/help':
      await sendTelegramMessage(
        `🤖 *Smart Email Agent Commands:*\n\n` +
        `📧 /check — Trigger an email check now\n` +
        `📊 /status — View accounts, stats, and next check time\n` +
        `🔥 /recent — Show last 5 important emails\n` +
        `❓ /help — Show this help message\n\n` +
        `_The agent automatically checks every 3 hours and notifies you of critical emails._`
      );
      break;

    default:
      // Ignore unknown messages silently
      break;
  }
}

// ═══ Notification Functions ═══

/**
 * Send a message via Telegram Bot API.
 */
export async function sendTelegramMessage(message) {
  if (!isConfigured) {
    console.log('⚠️ Telegram not configured, notification skipped');
    return false;
  }

  try {
    const url = `${TELEGRAM_API}${botToken}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      }),
    });

    const data = await res.json();
    if (data.ok) {
      return true;
    } else {
      console.error('❌ Telegram API error:', data.description);
      return false;
    }
  } catch (error) {
    console.error('❌ Failed to send Telegram message:', error.message);
    return false;
  }
}

/**
 * Send an urgent email notification via Telegram.
 */
export async function sendUrgentNotification(emailData) {
  const importanceIcon =
    emailData.importance === 'critical' ? '🔴 CRITICAL' :
    emailData.importance === 'high'     ? '🟠 HIGH'     : '⚠️ URGENT';

  // Format received time in IST
  let timeStr = 'Unknown time';
  try {
    const d = new Date(emailData.date || emailData.received_at || Date.now());
    timeStr = d.toLocaleString('en-IN', {
      weekday: 'short', day: 'numeric', month: 'short',
      hour: '2-digit', minute: '2-digit', hour12: true,
      timeZone: 'Asia/Kolkata',
    });
  } catch { /* keep default */ }

  // Read / viewed status
  const viewedStatus = emailData.isRead
    ? '👁️ Viewed (already read)'
    : '🔵 Unread';

  const message =
    `${importanceIcon} — *New Email Alert*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `📌 *Subject:* ${escMd(emailData.subject || '(no subject)')}\n` +
    `📨 *From:* ${escMd(emailData.senderName || emailData.sender_name || emailData.senderEmail || emailData.sender_email)}\n` +
    `⏰ *Time:* ${escMd(timeStr)}\n` +
    `${viewedStatus}\n\n` +
    `📝 *Summary:* ${escMd(emailData.briefSummary || emailData.brief_summary || emailData.snippet || 'No summary available')}\n\n` +
    `⚡ _Open the dashboard to view the full email._`;

  return sendTelegramMessage(message);
}

/**
 * Send a calendar event notification via Telegram.
 */
export async function sendCalendarNotification(eventData) {
  const message =
    `📅 *New Calendar Event Added*\n\n` +
    `📋 *Event:* ${escMd(eventData.summary)}\n` +
    `🕐 *When:* ${formatDateTime(eventData.startTime)}\n` +
    `${eventData.location ? `📍 *Where:* ${escMd(eventData.location)}\n` : ''}` +
    `${eventData.description ? `📝 *Details:* ${escMd(eventData.description)}\n` : ''}\n` +
    `✅ _Event has been added to your Google Calendar with reminders._`;

  return sendTelegramMessage(message);
}

/**
 * Send a reply approval request via Telegram.
 */
export async function sendReplyApprovalRequest(replyData) {
  const message =
    `✉️ *Auto-Reply Ready for Approval*\n\n` +
    `📧 *To:* ${escMd(replyData.originalSender)}\n` +
    `📋 *RE:* ${escMd(replyData.originalSubject)}\n\n` +
    `💬 *Suggested Reply:*\n${escMd(replyData.draftReply)}\n\n` +
    `👉 _Open the dashboard to approve, edit, or reject this reply._`;

  return sendTelegramMessage(message);
}

/**
 * Send a periodic summary via Telegram.
 */
export async function sendSummaryNotification(summary) {
  const message =
    `📊 *Email Agent Summary*\n\n` +
    `📬 Emails processed: ${summary.totalEmails}\n` +
    `🔴 Critical: ${summary.critical}\n` +
    `🟠 High: ${summary.high}\n` +
    `📅 Events created: ${summary.eventsCreated}\n` +
    `✉️ Replies pending: ${summary.pendingReplies}\n\n` +
    `_Check the dashboard for details._`;

  return sendTelegramMessage(message);
}

/**
 * Get the current Telegram connection status.
 */
export function getTelegramStatus() {
  return {
    status: isConfigured ? 'connected' : 'disconnected',
    isReady: isConfigured,
    isPolling: pollingActive,
  };
}

/**
 * Verify the bot token works by calling getMe.
 */
export async function verifyBot() {
  if (!botToken) return null;
  try {
    const res = await fetch(`${TELEGRAM_API}${botToken}/getMe`);
    const data = await res.json();
    if (data.ok) {
      console.log(`🤖 Telegram bot: @${data.result.username}`);
      return data.result;
    }
    return null;
  } catch {
    return null;
  }
}

// ═══ Utilities ═══

function escMd(text) {
  if (!text) return '';
  // Telegram Markdown (v1) only requires escaping: _ * [ ] ( ) ~ ` > # + - = | { }
  // Do NOT escape dots (.) or exclamation marks (!) — those only matter in MarkdownV2
  return String(text)
    .replace(/\\/g, '')       // strip stray backslashes first
    .replace(/([_*`\[\]])/g, '\\$1');  // escape only v1 special chars
}

function formatDateTime(isoString) {
  try {
    const date = new Date(isoString);
    return date.toLocaleString('en-IN', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Kolkata',
    });
  } catch {
    return isoString || 'TBD';
  }
}

export default {
  initTelegram,
  startPolling,
  stopPolling,
  registerCommandHandlers,
  sendTelegramMessage,
  sendUrgentNotification,
  sendCalendarNotification,
  sendReplyApprovalRequest,
  sendSummaryNotification,
  getTelegramStatus,
  verifyBot,
};
