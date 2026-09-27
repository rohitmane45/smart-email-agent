import { getGmailClient } from '../auth/oauth-manager.js';
import { run, queryAll, queryOne } from '../db/database.js';

/**
 * Queue an auto-reply for approval.
 */
export async function queueReply(emailId, accountId, email, suggestedReply) {
  if (!suggestedReply) return null;

  await run(
    `INSERT INTO reply_queue (email_id, account_id, original_subject, original_sender, draft_reply)
     VALUES (?, ?, ?, ?, ?)`,
    [emailId, accountId, email.subject, email.senderEmail, suggestedReply]
  );

  const queued = await queryOne(
    'SELECT * FROM reply_queue WHERE email_id = ? ORDER BY id DESC LIMIT 1',
    [emailId]
  );

  console.log(`✉️ Reply queued for approval: RE: ${email.subject}`);
  return queued;
}

/**
 * Approve and send a queued reply.
 */
export async function approveReply(queueId) {
  const entry = await queryOne('SELECT * FROM reply_queue WHERE id = ?', [queueId]);
  if (!entry) throw new Error('Reply not found in queue');
  if (entry.status === 'sent') throw new Error('Reply already sent');

  const replyText = entry.edited_reply || entry.draft_reply;

  try {
    const gmail = await getGmailClient(entry.account_id);
    const originalEmail = await queryOne('SELECT * FROM emails WHERE id = ?', [entry.email_id]);
    if (!originalEmail) throw new Error('Original email not found');

    const rawEmail = buildReplyEmail(
      entry.original_sender,
      originalEmail.recipient || '',
      entry.original_subject,
      replyText,
      originalEmail.message_id,
      originalEmail.thread_id
    );

    await gmail.users.messages.send({
      userId: 'me',
      resource: {
        raw: rawEmail,
        threadId: originalEmail.thread_id,
      },
    });

    await run(
      "UPDATE reply_queue SET status = 'sent', actioned_at = datetime('now') WHERE id = ?",
      [queueId]
    );

    console.log(`✅ Reply sent to ${entry.original_sender}`);
    return true;
  } catch (error) {
    console.error('❌ Failed to send reply:', error.message);
    await run(
      "UPDATE reply_queue SET status = 'pending', actioned_at = datetime('now') WHERE id = ?",
      [queueId]
    );
    return false;
  }
}

/**
 * Reject a queued reply.
 */
export async function rejectReply(queueId) {
  await run(
    "UPDATE reply_queue SET status = 'rejected', actioned_at = datetime('now') WHERE id = ?",
    [queueId]
  );
  console.log(`❌ Reply rejected: #${queueId}`);
}

/**
 * Edit a queued reply's text, then mark it ready for approval.
 */
export async function editReply(queueId, editedText) {
  await run(
    "UPDATE reply_queue SET edited_reply = ?, status = 'edited', actioned_at = datetime('now') WHERE id = ?",
    [editedText, queueId]
  );
  console.log(`✏️ Reply edited: #${queueId}`);
}

/**
 * Get all pending replies.
 */
export async function getPendingReplies() {
  return queryAll(
    `SELECT rq.*, a.email as account_email FROM reply_queue rq
     JOIN accounts a ON rq.account_id = a.id
     WHERE rq.status IN ('pending', 'edited')
     ORDER BY rq.created_at DESC`
  );
}

/**
 * Get all replies (for dashboard history).
 */
export async function getAllReplies(limit = 50) {
  return queryAll(
    `SELECT rq.*, a.email as account_email FROM reply_queue rq
     JOIN accounts a ON rq.account_id = a.id
     ORDER BY rq.created_at DESC LIMIT ?`,
    [limit]
  );
}

/**
 * Build a raw RFC 2822 email for the Gmail API.
 */
function buildReplyEmail(to, from, subject, body, inReplyTo, threadId) {
  const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
  const email = [
    `To: ${to}`,
    `Subject: ${replySubject}`,
    `In-Reply-To: ${inReplyTo || ''}`,
    `References: ${inReplyTo || ''}`,
    'Content-Type: text/plain; charset=utf-8',
    'MIME-Version: 1.0',
    '',
    body,
  ].join('\r\n');

  return Buffer.from(email)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export default { queueReply, approveReply, rejectReply, editReply, getPendingReplies, getAllReplies };
