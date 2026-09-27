import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { getAuthUrl, handleAuthCallback, getActiveAccounts, deactivateAccount } from './auth/oauth-manager.js';
import { getRecentEmails } from './email/fetcher.js';
import { getCreatedEvents } from './calendar/manager.js';
import { getPendingReplies, getAllReplies, approveReply, rejectReply, editReply } from './reply/auto-reply.js';
import { getTelegramStatus } from './notifications/telegram.js';
import { runPipeline } from './scheduler/cron.js';
import { queryAll, queryOne, run } from './db/database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createServer() {
  const app = express();

  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // ═══════════════════════════════════════════
  // AUTH ROUTES
  // ═══════════════════════════════════════════

  /** Start OAuth flow to add a new Gmail account */
  app.get('/auth/add-account', (req, res) => {
    try {
      const authUrl = getAuthUrl();
      res.redirect(authUrl);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  /** OAuth callback — exchanges code for tokens */
  app.get('/auth/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) {
      return res.status(400).json({ error: 'Missing authorization code' });
    }

    try {
      const account = await handleAuthCallback(code);
      res.redirect(`/?success=Account ${account.email} connected!`);
    } catch (error) {
      console.error('OAuth callback error:', error);
      res.redirect(`/?error=${encodeURIComponent(error.message)}`);
    }
  });

  // ═══════════════════════════════════════════
  // API ROUTES
  // ═══════════════════════════════════════════

  /** Get all connected accounts */
  app.get('/api/accounts', (req, res) => {
    try {
      const accounts = getActiveAccounts();
      // Don't expose tokens to the frontend
      const safe = accounts.map(({ refresh_token, access_token, ...rest }) => rest);
      res.json(safe);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Remove (deactivate) an account */
  app.delete('/api/accounts/:id', (req, res) => {
    try {
      deactivateAccount(parseInt(req.params.id));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Get recent analyzed emails */
  app.get('/api/emails', (req, res) => {
    try {
      const { limit, importance, accountId, urgent } = req.query;
      const emails = getRecentEmails(
        parseInt(limit) || 50,
        {
          importance: importance || undefined,
          accountId: accountId ? parseInt(accountId) : undefined,
          isUrgent: urgent === 'true',
        }
      );
      res.json(emails);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Get created calendar events */
  app.get('/api/events', (req, res) => {
    try {
      const events = getCreatedEvents(parseInt(req.query.limit) || 20);
      res.json(events);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Get pending reply queue */
  app.get('/api/queue', (req, res) => {
    try {
      const pending = getPendingReplies();
      res.json(pending);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Get all reply history */
  app.get('/api/replies', (req, res) => {
    try {
      const replies = getAllReplies(parseInt(req.query.limit) || 50);
      res.json(replies);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Approve a queued reply */
  app.post('/api/queue/:id/approve', async (req, res) => {
    try {
      const success = await approveReply(parseInt(req.params.id));
      res.json({ success });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Reject a queued reply */
  app.post('/api/queue/:id/reject', (req, res) => {
    try {
      rejectReply(parseInt(req.params.id));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Edit a queued reply */
  app.post('/api/queue/:id/edit', (req, res) => {
    try {
      const { text } = req.body;
      if (!text) return res.status(400).json({ error: 'Missing reply text' });
      editReply(parseInt(req.params.id), text);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Get dashboard statistics */
  app.get('/api/stats', (req, res) => {
    try {
      const totalEmails = queryOne('SELECT COUNT(*) as count FROM emails')?.count || 0;
      const criticalEmails = queryOne("SELECT COUNT(*) as count FROM emails WHERE importance = 'critical'")?.count || 0;
      const highEmails = queryOne("SELECT COUNT(*) as count FROM emails WHERE importance = 'high'")?.count || 0;
      const totalEvents = queryOne('SELECT COUNT(*) as count FROM calendar_events')?.count || 0;
      const pendingReplies = queryOne("SELECT COUNT(*) as count FROM reply_queue WHERE status IN ('pending', 'edited')")?.count || 0;
      const sentReplies = queryOne("SELECT COUNT(*) as count FROM reply_queue WHERE status = 'sent'")?.count || 0;
      const totalAccounts = queryOne('SELECT COUNT(*) as count FROM accounts WHERE is_active = 1')?.count || 0;

      res.json({
        totalEmails,
        criticalEmails,
        highEmails,
        totalEvents,
        pendingReplies,
        sentReplies,
        totalAccounts,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Get Telegram bot connection status */
  app.get('/api/telegram/status', (req, res) => {
    try {
      const status = getTelegramStatus();
      res.json(status);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Get/update settings */
  app.get('/api/settings', (req, res) => {
    try {
      const settings = queryAll('SELECT * FROM settings');
      const obj = {};
      settings.forEach((s) => (obj[s.key] = s.value));
      res.json(obj);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/settings', (req, res) => {
    try {
      const updates = req.body;
      for (const [key, value] of Object.entries(updates)) {
        run(
          "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
          [key, String(value)]
        );
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Manually trigger email check */
  app.post('/api/check-now', async (req, res) => {
    try {
      res.json({ message: 'Email check started' });
      // Run pipeline in background
      runPipeline().catch((err) => console.error('Manual pipeline error:', err));
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Re-analyze existing emails that were misclassified and notify if upgraded */
  app.post('/api/reanalyze', async (req, res) => {
    try {
      // Import dynamically to avoid circular deps at top level
      const { analyzeEmail } = await import('./ai/analyzer.js');
      const { notifyImportantEmail } = await import('./notifications/notifier.js');

      // Fetch emails that were saved as 'other' or 'medium' (likely misclassified)
      const candidates = queryAll(
        `SELECT e.*, a.email as account_email FROM emails e
         JOIN accounts a ON e.account_id = a.id
         WHERE e.importance IN ('other', 'medium', 'low')
         ORDER BY e.processed_at DESC LIMIT 50`
      );

      res.json({ message: `Re-analyzing ${candidates.length} emails in background...`, count: candidates.length });

      // Run in background
      (async () => {
        let upgraded = 0;
        for (const row of candidates) {
          try {
            const email = {
              messageId: row.message_id,
              subject: row.subject,
              senderName: row.sender_name,
              senderEmail: row.sender_email,
              bodyText: row.body_text,
              snippet: row.snippet,
              date: row.received_at,
              isRead: Boolean(row.is_read),
              accountId: row.account_id,
            };

            const analysis = await analyzeEmail(email);

            // Only update + notify if importance was upgraded
            if (analysis.importance === 'critical' || analysis.importance === 'high') {
              run(
                `UPDATE emails SET importance = ?, category = ?, is_urgent = ?, brief_summary = ?, ai_analysis = ? WHERE id = ?`,
                [
                  analysis.importance,
                  analysis.category,
                  analysis.isUrgent ? 1 : 0,
                  analysis.briefSummary,
                  JSON.stringify(analysis),
                  row.id,
                ]
              );

              console.log(`🔄 Re-analyzed & upgraded: [${analysis.importance.toUpperCase()}] "${row.subject}"`);
              await notifyImportantEmail(email, analysis);
              upgraded++;
            }

            // Delay between API calls
            await new Promise((r) => setTimeout(r, 800));
          } catch (err) {
            console.error(`⚠️ Re-analyze error for "${row.subject}":`, err.message);
          }
        }
        console.log(`✅ Re-analysis complete: ${upgraded} email(s) upgraded and notified.`);
      })();
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Serve the dashboard for all non-API routes */
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  });

  return app;
}

export default { createServer };
