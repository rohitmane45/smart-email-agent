import { exec, run, queryOne } from './database.js';

/**
 * Run all database migrations against Turso/libSQL.
 * Safe to run on every startup — uses CREATE TABLE IF NOT EXISTS.
 */
export async function runMigrations() {
  // Create all tables
  const tables = [
    `CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      refresh_token TEXT NOT NULL,
      access_token TEXT,
      token_expiry INTEGER,
      display_name TEXT,
      is_active INTEGER DEFAULT 1,
      added_at TEXT DEFAULT (datetime('now')),
      last_checked_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      message_id TEXT UNIQUE NOT NULL,
      thread_id TEXT,
      subject TEXT,
      sender_email TEXT,
      sender_name TEXT,
      recipient TEXT,
      snippet TEXT,
      body_text TEXT,
      importance TEXT DEFAULT 'low',
      category TEXT,
      is_urgent INTEGER DEFAULT 0,
      is_calendar_event INTEGER DEFAULT 0,
      is_read INTEGER DEFAULT 0,
      brief_summary TEXT,
      ai_analysis TEXT,
      processed_at TEXT DEFAULT (datetime('now')),
      received_at TEXT,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS calendar_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email_id INTEGER,
      account_id INTEGER NOT NULL,
      calendar_event_id TEXT,
      summary TEXT NOT NULL,
      description TEXT,
      start_time TEXT NOT NULL,
      end_time TEXT,
      location TEXT,
      reminders TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (email_id) REFERENCES emails(id) ON DELETE SET NULL,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS reply_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL,
      original_subject TEXT,
      original_sender TEXT,
      draft_reply TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      edited_reply TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      actioned_at TEXT,
      FOREIGN KEY (email_id) REFERENCES emails(id) ON DELETE CASCADE,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      channel TEXT NOT NULL,
      message TEXT NOT NULL,
      email_id INTEGER,
      sent_at TEXT DEFAULT (datetime('now')),
      status TEXT DEFAULT 'sent',
      FOREIGN KEY (email_id) REFERENCES emails(id) ON DELETE SET NULL
    )`,
    `CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    )`,
  ];

  for (const sql of tables) {
    await exec(sql);
  }

  // Create indexes
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_emails_account ON emails(account_id)',
    'CREATE INDEX IF NOT EXISTS idx_emails_importance ON emails(importance)',
    'CREATE INDEX IF NOT EXISTS idx_emails_message_id ON emails(message_id)',
    'CREATE INDEX IF NOT EXISTS idx_emails_is_read ON emails(is_read)',
    'CREATE INDEX IF NOT EXISTS idx_reply_queue_status ON reply_queue(status)',
    'CREATE INDEX IF NOT EXISTS idx_calendar_events_account ON calendar_events(account_id)',
  ];

  for (const idx of indexes) {
    await exec(idx);
  }

  // Insert default settings if not present
  const defaults = {
    check_interval_hours: '3',
    max_emails_per_check: '15',
    notify_critical: 'true',
    notify_high: 'true',
    notify_medium: 'false',
    notify_low: 'false',
    auto_reply_enabled: 'true',
    language: 'english',
  };

  for (const [key, value] of Object.entries(defaults)) {
    const existing = await queryOne('SELECT key FROM settings WHERE key = ?', [key]);
    if (!existing) {
      await run('INSERT INTO settings (key, value) VALUES (?, ?)', [key, value]);
    }
  }

  console.log('✅ Database migrations complete');
}

export default { runMigrations };
