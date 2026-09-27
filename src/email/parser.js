/**
 * Email Parser — Extracts clean content from Gmail API message objects.
 */

/**
 * Parse a Gmail API message into a clean structured object.
 * @param {object} message - The full Gmail message object from messages.get().
 * @returns {object} Parsed email data.
 */
export function parseMessage(message) {
  const headers = message.payload?.headers || [];
  const getHeader = (name) =>
    headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

  const subject = getHeader('Subject');
  const from = getHeader('From');
  const to = getHeader('To');
  const date = getHeader('Date');
  const messageId = message.id;
  const threadId = message.threadId;
  const snippet = message.snippet || '';

  // Parse sender info
  const senderMatch = from.match(/^(.+?)\s*<(.+?)>$/);
  const senderName = senderMatch ? senderMatch[1].replace(/"/g, '').trim() : from;
  const senderEmail = senderMatch ? senderMatch[2] : from;

  // Determine read status — Gmail marks unread emails with the 'UNREAD' label.
  // If UNREAD label is absent the user has already opened the email.
  const labels = message.labelIds || [];
  const isRead = !labels.includes('UNREAD');

  // Extract body text
  const bodyText = extractBodyText(message.payload);

  return {
    messageId,
    threadId,
    subject,
    senderName,
    senderEmail,
    recipient: to,
    date,
    snippet,
    bodyText: bodyText || snippet,
    isRead,
  };
}

/**
 * Recursively extract text content from a MIME message payload.
 * Prefers text/plain, falls back to text/html (stripped of tags).
 */
function extractBodyText(payload) {
  if (!payload) return '';

  // Direct body data (single-part message)
  if (payload.body?.data) {
    const decoded = decodeBase64Url(payload.body.data);
    if (payload.mimeType === 'text/plain') {
      return decoded;
    }
    if (payload.mimeType === 'text/html') {
      return stripHtml(decoded);
    }
    return decoded;
  }

  // Multi-part message — recurse into parts
  if (payload.parts) {
    // Prefer text/plain
    const plainPart = payload.parts.find((p) => p.mimeType === 'text/plain');
    if (plainPart) {
      return extractBodyText(plainPart);
    }

    // Fall back to text/html
    const htmlPart = payload.parts.find((p) => p.mimeType === 'text/html');
    if (htmlPart) {
      return extractBodyText(htmlPart);
    }

    // Recurse into nested multipart sections
    for (const part of payload.parts) {
      if (part.mimeType?.startsWith('multipart/')) {
        const result = extractBodyText(part);
        if (result) return result;
      }
    }
  }

  return '';
}

/**
 * Decode a base64url-encoded string.
 */
function decodeBase64Url(data) {
  try {
    const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(base64, 'base64').toString('utf-8');
  } catch {
    return '';
  }
}

/**
 * Strip HTML tags and decode common entities to get plain text.
 */
function stripHtml(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export default { parseMessage };
