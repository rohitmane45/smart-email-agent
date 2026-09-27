import { google } from 'googleapis';
import { getGoogleCredentials } from './credentials.js';
import { run, queryAll, queryOne } from '../db/database.js';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

/**
 * Create a fresh OAuth2 client using app credentials.
 */
function createOAuth2Client() {
  const { clientId, clientSecret, redirectUri } = getGoogleCredentials();
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/**
 * Generate the Google OAuth consent URL to add a new account.
 */
export function getAuthUrl() {
  const client = createOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });
}

/**
 * Exchange an authorization code for tokens and store the account.
 */
export async function handleAuthCallback(code) {
  const client = createOAuth2Client();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  // Get user email
  const oauth2 = google.oauth2({ version: 'v2', auth: client });
  const userInfo = await oauth2.userinfo.get();
  const email = userInfo.data.email;
  const displayName = userInfo.data.name || email;

  // Check if account already exists
  const existing = queryOne('SELECT id FROM accounts WHERE email = ?', [email]);

  if (existing) {
    run(
      `UPDATE accounts SET refresh_token = ?, access_token = ?, token_expiry = ?, display_name = ?, is_active = 1 WHERE email = ?`,
      [tokens.refresh_token, tokens.access_token, tokens.expiry_date, displayName, email]
    );
  } else {
    run(
      `INSERT INTO accounts (email, refresh_token, access_token, token_expiry, display_name) VALUES (?, ?, ?, ?, ?)`,
      [email, tokens.refresh_token, tokens.access_token, tokens.expiry_date, displayName]
    );
  }

  console.log(`✅ Account connected: ${email}`);
  return { email, displayName };
}

/**
 * Get an authenticated OAuth2 client for a specific account.
 */
export async function getAuthClientForAccount(accountId) {
  const account = queryOne('SELECT * FROM accounts WHERE id = ? AND is_active = 1', [accountId]);

  if (!account) {
    throw new Error(`Account ${accountId} not found or inactive`);
  }

  const client = createOAuth2Client();
  client.setCredentials({
    refresh_token: account.refresh_token,
    access_token: account.access_token,
    expiry_date: account.token_expiry,
  });

  // Listen for token refresh events and update the DB
  client.on('tokens', (tokens) => {
    run(
      'UPDATE accounts SET access_token = ?, token_expiry = ? WHERE id = ?',
      [tokens.access_token, tokens.expiry_date, accountId]
    );
  });

  return client;
}

/**
 * Get an authenticated Gmail API client for a specific account.
 */
export async function getGmailClient(accountId) {
  const auth = await getAuthClientForAccount(accountId);
  return google.gmail({ version: 'v1', auth });
}

/**
 * Get an authenticated Calendar API client for a specific account.
 */
export async function getCalendarClient(accountId) {
  const auth = await getAuthClientForAccount(accountId);
  return google.calendar({ version: 'v3', auth });
}

/**
 * Get all active accounts from the database.
 */
export function getActiveAccounts() {
  return queryAll('SELECT * FROM accounts WHERE is_active = 1');
}

/**
 * Remove (deactivate) an account.
 */
export function deactivateAccount(accountId) {
  run('UPDATE accounts SET is_active = 0 WHERE id = ?', [accountId]);
}

export default {
  getAuthUrl,
  handleAuthCallback,
  getAuthClientForAccount,
  getGmailClient,
  getCalendarClient,
  getActiveAccounts,
  deactivateAccount,
};
