import dotenv from 'dotenv';
dotenv.config();

import { initDb, closeDb } from './db/database.js';
import { runMigrations } from './db/migrations.js';
import { getAppSettings } from './auth/credentials.js';
import { createServer } from './server.js';
import { startScheduler, stopScheduler, runPipeline } from './scheduler/cron.js';
import { initTelegram, verifyBot, startPolling, stopPolling, registerCommandHandlers } from './notifications/telegram.js';
import { queryAll, queryOne } from './db/database.js';

async function main() {
  console.log(`
  ╔═══════════════════════════════════════════════════╗
  ║                                                   ║
  ║   📧  Smart Email Agent  🤖                       ║
  ║                                                   ║
  ║   AI-powered email analysis, calendar events,     ║
  ║   Telegram notifications & auto-replies           ║
  ║                                                   ║
  ╚═══════════════════════════════════════════════════╝
  `);

  try {
    // Step 1: Initialize database
    console.log('📦 Initializing database...');
    await initDb();
    runMigrations();

    // Step 2: Get settings
    const settings = getAppSettings();

    // Step 3: Start Express server
    const app = createServer();
    const server = app.listen(settings.port, () => {
      console.log(`\n🌐 Dashboard running at: http://localhost:${settings.port}`);
      console.log(`📱 Add Gmail account: http://localhost:${settings.port}/auth/add-account\n`);
    });

    // Step 4: Initialize Telegram bot
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    const telegramChatId = process.env.TELEGRAM_CHAT_ID;
    initTelegram(telegramToken, telegramChatId);

    if (telegramToken) {
      const botInfo = await verifyBot();
      if (botInfo) {
        console.log(`📨 Telegram notifications active → @${botInfo.username}`);

        // Register interactive command handlers
        registerCommandHandlers({
          onCheck: async () => {
            const result = await runPipeline();
            return result || { totalProcessed: 0, critical: 0, high: 0, eventsCreated: 0 };
          },
          onStatus: async () => {
            const totalEmails = queryOne('SELECT COUNT(*) as count FROM emails')?.count || 0;
            const criticalEmails = queryOne("SELECT COUNT(*) as count FROM emails WHERE importance = 'critical'")?.count || 0;
            const highEmails = queryOne("SELECT COUNT(*) as count FROM emails WHERE importance = 'high'")?.count || 0;
            const totalEvents = queryOne('SELECT COUNT(*) as count FROM calendar_events')?.count || 0;
            const pendingReplies = queryOne("SELECT COUNT(*) as count FROM reply_queue WHERE status = 'pending'")?.count || 0;
            const totalAccounts = queryOne('SELECT COUNT(*) as count FROM accounts WHERE is_active = 1')?.count || 0;
            return {
              totalEmails, criticalEmails, highEmails,
              totalEvents, pendingReplies, totalAccounts,
              intervalHours: settings.checkIntervalHours,
            };
          },
          onRecent: async () => {
            return queryAll(
              "SELECT * FROM emails WHERE importance IN ('critical', 'high') ORDER BY processed_at DESC LIMIT 5"
            );
          },
        });

        // Start listening for commands from phone
        startPolling();
        console.log('📱 Telegram commands active — send /help to your bot from your phone!\n');
      }
    }

    // Step 5: Start the email checking scheduler
    startScheduler(settings.checkIntervalHours);

    // Graceful shutdown
    const shutdown = () => {
      console.log('\n🛑 Shutting down gracefully...');
      stopPolling();
      stopScheduler();
      closeDb();
      server.close();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

  } catch (error) {
    console.error('\n❌ Failed to start:', error.message);
    console.error('\n💡 Quick fixes:');
    console.error('   1. Copy .env.example to .env and fill in your credentials');
    console.error('   2. Run: node setup.js — for guided setup');
    console.error('   3. Check README.md for full setup instructions\n');
    process.exit(1);
  }
}

main();
