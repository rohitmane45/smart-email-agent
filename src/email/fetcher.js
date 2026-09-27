import { getGmailClient } from '../auth/oauth-manager.js';
import { run, queryOne, queryAll } from '../db/database.js';
import { parseMessage } from './parser.js';

/**
 * Fetch new (unread) emails from a specific Gmail account.
 * @param {number} accountId - The account ID.
 * @param {number} maxResults - Maximum emails to fetch.
 * @returns {Array} Array of parsed email objects.
 */
export async function fetchNewEmails(accountId, maxResults = 25) {
  try {
    const gmail = await getGmailClient(accountId);

    // Get the last checked time for this account
    const account = await queryOne('SELECT last_checked_at FROM accounts WHERE id = ?', [accountId]);

    // Build query — fetch ALL emails (read OR unread, any category) after the
    // last check.  We rely solely on message_id dedup in the DB so we never
    // miss a placement/T&P email just because it landed in a non-Primary tab
    // or was already opened by the user.
    let query = '-in:spam -in:trash'; // exclude true spam/trash only
    if (account?.last_checked_at) {
      // Gmail uses epoch seconds for the 'after:' operator
      const afterDate = Math.floor(new Date(account.last_checked_at).getTime() / 1000);
      query += ` after:${afterDate}`;
    } else {
      // First run — look back 48 hours so we catch recent placement emails
      const fortyEightHoursAgo = Math.floor((Date.now() - 48 * 60 * 60 * 1000) / 1000);
      query += ` after:${fortyEightHoursAgo}`;
    }

    // List messages
    const listRes = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults,
    });

    const messages = listRes.data.messages || [];
    if (messages.length === 0) {
      console.log(`📭 No new emails for account ${accountId}`);
      // Still update last_checked_at so next run has a fresh window
      await run('UPDATE accounts SET last_checked_at = datetime("now") WHERE id = ?', [accountId]);
      return [];
    }

    console.log(`📬 Found ${messages.length} email(s) in window for account ${accountId}`);

    // Fetch full message details — skip any already stored in DB
    const parsedEmails = [];
    for (const msg of messages) {
      // Dedup: skip if we already processed this message
      const existing = await queryOne('SELECT id FROM emails WHERE message_id = ?', [msg.id]);
      if (existing) continue;

      try {
        const fullMsg = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'full',
        });

        const parsed = parseMessage(fullMsg.data);
        parsedEmails.push({ ...parsed, accountId });
      } catch (err) {
        console.error(`⚠️ Failed to fetch message ${msg.id}:`, err.message);
      }
    }

    // Update last checked timestamp
    await run('UPDATE accounts SET last_checked_at = datetime("now") WHERE id = ?', [accountId]);

    if (parsedEmails.length === 0) {
      console.log(`📭 All ${messages.length} email(s) already processed for account ${accountId}`);
    } else {
      console.log(`📬 ${parsedEmails.length} new email(s) to process for account ${accountId}`);
    }

    return parsedEmails;
  } catch (error) {
    // Handle expired / revoked refresh token — mark account inactive so the
    // scheduler stops hammering Google and alert the user to re-authenticate.
    if (error.message === 'invalid_grant' || error?.response?.data?.error === 'invalid_grant') {
      console.error(`🔐 Refresh token expired for account ${accountId}. Marking inactive — re-auth needed.`);
      run('UPDATE accounts SET is_active = 0 WHERE id = ?', [accountId]);
      const invalidGrantError = new Error('invalid_grant');
      invalidGrantError.code = 'INVALID_GRANT';
      invalidGrantError.accountId = accountId;
      throw invalidGrantError;
    }
    console.error(`❌ Error fetching emails for account ${accountId}:`, error.message);
    return [];
  }
}

/**
 * Save a processed email to the database.
 */
export async function saveEmail(email, analysis) {
  await run(
    `INSERT OR IGNORE INTO emails 
      (account_id, message_id, thread_id, subject, sender_email, sender_name, recipient, snippet, body_text, importance, category, is_urgent, is_calendar_event, is_read, brief_summary, ai_analysis, received_at) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      email.accountId,
      email.messageId,
      email.threadId,
      email.subject,
      email.senderEmail,
      email.senderName,
      email.recipient,
      email.snippet,
      email.bodyText?.substring(0, 5000) || '',
      analysis.importance || 'low',
      analysis.category || 'other',
      analysis.isUrgent ? 1 : 0,
      analysis.isCalendarEvent ? 1 : 0,
      email.isRead ? 1 : 0,
      analysis.briefSummary || '',
      JSON.stringify(analysis),
      email.date,
    ]
  );

  const saved = await queryOne('SELECT id FROM emails WHERE message_id = ?', [email.messageId]);
  return saved?.id;
}

/**
 * Get recent emails from the database with optional filters.
 */
export async function getRecentEmails(limit = 50, filters = {}) {
  let sql = `SELECT e.*, a.email as account_email FROM emails e 
    JOIN accounts a ON e.account_id = a.id WHERE 1=1`;
  const params = [];

  if (filters.importance) {
    sql += ' AND e.importance = ?';
    params.push(filters.importance);
  }
  if (filters.accountId) {
    sql += ' AND e.account_id = ?';
    params.push(filters.accountId);
  }
  if (filters.isUrgent) {
    sql += ' AND e.is_urgent = 1';
  }

  sql += ' ORDER BY e.processed_at DESC LIMIT ?';
  params.push(limit);

  return queryAll(sql, params);
}

export default { fetchNewEmails, saveEmail, getRecentEmails };
