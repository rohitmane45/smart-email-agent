import initSqlJs from 'sql.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'email_agent.db');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let db = null;

/**
 * Initialize and return the SQLite database instance (sql.js).
 * Loads existing DB file if present, otherwise creates a new one.
 */
export async function initDb() {
  if (db) return db;

  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  return db;
}

/**
 * Get the current database instance (must call initDb first).
 */
export function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

/**
 * Persist the database to disk.
 */
export function saveDb() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  }
}

/**
 * Close and persist the database.
 */
export function closeDb() {
  if (db) {
    saveDb();
    db.close();
    db = null;
  }
}

/**
 * Helper: Run a SQL statement that doesn't return results (INSERT, UPDATE, DELETE).
 */
export function run(sql, params = []) {
  const database = getDb();
  database.run(sql, params);
  saveDb();
}

/**
 * Helper: Run a SQL query and return all matching rows as objects.
 */
export function queryAll(sql, params = []) {
  const database = getDb();
  const stmt = database.prepare(sql);
  if (params.length) stmt.bind(params);

  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

/**
 * Helper: Run a SQL query and return the first matching row as an object, or null.
 */
export function queryOne(sql, params = []) {
  const rows = queryAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Helper: Execute raw SQL (for DDL like CREATE TABLE).
 */
export function exec(sql) {
  const database = getDb();
  database.exec(sql);
  saveDb();
}

export default { initDb, getDb, saveDb, closeDb, run, queryAll, queryOne, exec };
