import { createClient } from '@libsql/client';

let client = null;

/**
 * Initialize and return the Turso/libSQL client.
 * Uses TURSO_DATABASE_URL + TURSO_AUTH_TOKEN for cloud (production/Render).
 * Falls back to a local file:// SQLite if Turso env vars are not set (dev without Turso).
 */
export async function initDb() {
  if (client) return client;

  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (url && authToken) {
    client = createClient({ url, authToken });
    console.log('📦 Connected to Turso cloud database');
  } else {
    // Local fallback: file-based libSQL (works the same as SQLite)
    client = createClient({ url: 'file:data/email_agent.db' });
    console.log('📦 Using local SQLite database (no Turso credentials found)');
  }

  return client;
}

/**
 * Get the initialized client (throws if initDb not called yet).
 */
export function getClient() {
  if (!client) throw new Error('Database not initialized. Call initDb() first.');
  return client;
}

/**
 * Run a SQL statement that modifies data (INSERT, UPDATE, DELETE, DDL).
 */
export async function run(sql, params = []) {
  const db = getClient();
  await db.execute({ sql, args: params });
}

/**
 * Run a SQL query and return ALL matching rows as plain objects.
 */
export async function queryAll(sql, params = []) {
  const db = getClient();
  const result = await db.execute({ sql, args: params });
  return result.rows.map((row) => Object.fromEntries(Object.entries(row)));
}

/**
 * Run a SQL query and return the FIRST matching row, or null.
 */
export async function queryOne(sql, params = []) {
  const rows = await queryAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Execute raw DDL SQL (CREATE TABLE, etc.).
 */
export async function exec(sql) {
  const db = getClient();
  await db.execute(sql);
}

// Legacy no-ops kept for compatibility (Turso auto-persists, no manual save needed)
export function saveDb() {}
export function closeDb() {}
export function getDb() { return getClient(); }

export default { initDb, getClient, run, queryAll, queryOne, exec, saveDb, closeDb };
