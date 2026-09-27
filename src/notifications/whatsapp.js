import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import { run } from '../db/database.js';

let client = null;
let isReady = false;
let qrCodeData = null;
let connectionStatus = 'disconnected'; // disconnected | qr_pending | connected

/**
 * Initialize the WhatsApp Web client.
 * @returns {Promise} Resolves when the client is ready.
 */
export async function initWhatsApp() {
  if (client) return client;

  console.log('📱 Initializing WhatsApp client...');

  client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
  });

  client.on('qr', (qr) => {
    qrCodeData = qr;
    connectionStatus = 'qr_pending';
    console.log('\n📱 Scan this QR code with WhatsApp:');
    qrcode.generate(qr, { small: true });
    console.log('Or open the dashboard to scan the QR code.\n');
  });

  client.on('ready', () => {
    isReady = true;
    qrCodeData = null;
    connectionStatus = 'connected';
    console.log('✅ WhatsApp client is ready!');
  });

  client.on('authenticated', () => {
    console.log('🔐 WhatsApp authenticated');
  });

  client.on('auth_failure', (msg) => {
    console.error('❌ WhatsApp auth failed:', msg);
    connectionStatus = 'disconnected';
    isReady = false;
  });

  client.on('disconnected', (reason) => {
    console.log('📱 WhatsApp disconnected:', reason);
    connectionStatus = 'disconnected';
    isReady = false;
    client = null;
  });

  try {
    await client.initialize();
  } catch (error) {
    console.error('⚠️ WhatsApp initialization failed:', error.message);
    console.log('💡 WhatsApp notifications will be disabled. You can still use the dashboard.');
    connectionStatus = 'disconnected';
  }

  return client;
}

/**
 * Send a WhatsApp notification message.
 * @param {string} phoneNumber - Phone number with country code (e.g., "919876543210").
 * @param {string} message - The message to send.
 * @returns {boolean} Whether the message was sent successfully.
 */
export async function sendWhatsAppMessage(phoneNumber, message) {
  if (!isReady || !client) {
    console.log('⚠️ WhatsApp not connected, notification skipped');
    return false;
  }

  try {
    // Format phone number for WhatsApp (remove +, add @c.us)
    const chatId = phoneNumber.replace(/[^0-9]/g, '') + '@c.us';
    await client.sendMessage(chatId, message);
    console.log(`📱 WhatsApp notification sent to ${phoneNumber}`);
    return true;
  } catch (error) {
    console.error('❌ Failed to send WhatsApp message:', error.message);
    return false;
  }
}

/**
 * Send a formatted urgent email notification via WhatsApp.
 */
export async function sendUrgentNotification(phoneNumber, emailData) {
  const message =
    `🔴 *URGENT EMAIL ALERT*\n\n` +
    `📧 *From:* ${emailData.senderName || emailData.senderEmail}\n` +
    `📋 *Subject:* ${emailData.subject}\n` +
    `⏰ *Received:* ${emailData.date || 'Just now'}\n\n` +
    `📝 *Summary:* ${emailData.briefSummary || emailData.snippet}\n\n` +
    `⚡ _This email requires your immediate attention!_`;

  return sendWhatsAppMessage(phoneNumber, message);
}

/**
 * Send a calendar event notification via WhatsApp.
 */
export async function sendCalendarNotification(phoneNumber, eventData) {
  const message =
    `📅 *New Calendar Event Added*\n\n` +
    `📋 *Event:* ${eventData.summary}\n` +
    `🕐 *When:* ${formatDateTime(eventData.startTime)}\n` +
    `${eventData.location ? `📍 *Where:* ${eventData.location}\n` : ''}` +
    `${eventData.description ? `📝 *Details:* ${eventData.description}\n` : ''}\n` +
    `✅ _Event has been added to your Google Calendar with reminders._`;

  return sendWhatsAppMessage(phoneNumber, message);
}

/**
 * Send a reply approval request via WhatsApp.
 */
export async function sendReplyApprovalRequest(phoneNumber, replyData) {
  const message =
    `✉️ *Auto-Reply Ready for Approval*\n\n` +
    `📧 *To:* ${replyData.originalSender}\n` +
    `📋 *RE:* ${replyData.originalSubject}\n\n` +
    `💬 *Suggested Reply:*\n${replyData.draftReply}\n\n` +
    `👉 _Open the dashboard to approve, edit, or reject this reply._`;

  return sendWhatsAppMessage(phoneNumber, message);
}

/**
 * Send a daily/periodic summary via WhatsApp.
 */
export async function sendSummaryNotification(phoneNumber, summary) {
  const message =
    `📊 *Email Agent Summary*\n\n` +
    `📬 Emails processed: ${summary.totalEmails}\n` +
    `🔴 Critical: ${summary.critical}\n` +
    `🟠 High: ${summary.high}\n` +
    `📅 Events created: ${summary.eventsCreated}\n` +
    `✉️ Replies pending: ${summary.pendingReplies}\n\n` +
    `_Check the dashboard for details._`;

  return sendWhatsAppMessage(phoneNumber, message);
}

/**
 * Get the current WhatsApp connection status.
 */
export function getWhatsAppStatus() {
  return {
    status: connectionStatus,
    isReady,
    qrCode: qrCodeData,
  };
}

/**
 * Format a datetime string for display.
 */
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
  initWhatsApp,
  sendWhatsAppMessage,
  sendUrgentNotification,
  sendCalendarNotification,
  sendReplyApprovalRequest,
  sendSummaryNotification,
  getWhatsAppStatus,
};
