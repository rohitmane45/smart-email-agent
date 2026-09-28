import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import session from 'express-session';
import { getAuthUrl, handleAuthCallback, getActiveAccounts, deactivateAccount } from './auth/oauth-manager.js';
import { getRecentEmails } from './email/fetcher.js';
import { getCreatedEvents } from './calendar/manager.js';
import { getPendingReplies, getAllReplies, approveReply, rejectReply, editReply } from './reply/auto-reply.js';
import { getTelegramStatus } from './notifications/telegram.js';
import { runPipeline, getPipelineStatus } from './scheduler/cron.js';
import { queryAll, queryOne, run } from './db/database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || 'smart-email-agent-secret-key-change-me';

// ── Auth middleware ─────────────────────────────────────────
function requireAuth(req, res, next) {
  // If no password set, skip auth (backwards compat / local dev)
  if (!DASHBOARD_PASSWORD) return next();
  if (req.session && req.session.authenticated) return next();
  // API calls get 401, page requests get login page
  if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) {
    return res.status(401).json({ error: 'Unauthorized. Please log in at the dashboard.' });
  }
  return res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
}

export function createServer() {
  const app = express();

  app.use(express.json());

  // Session setup
  app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 8 * 60 * 60 * 1000, // 8 hours
      httpOnly: true,
      secure: false, // set true if behind HTTPS proxy
    }
  }));

  // Static assets (CSS, fonts, login.html) — always public
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // ═══════════════════════════════════════════
  // LOGIN / LOGOUT ROUTES (no auth required)
  // ═══════════════════════════════════════════

  app.post('/login', (req, res) => {
    const { password } = req.body;
    if (!DASHBOARD_PASSWORD) {
      // No password configured — auto-login
      req.session.authenticated = true;
      return res.json({ success: true });
    }
    if (password === DASHBOARD_PASSWORD) {
      req.session.authenticated = true;
      return res.json({ success: true });
    }
    return res.status(401).json({ error: 'Incorrect password.' });
  });

  app.get('/logout', (req, res) => {
    req.session.destroy(() => {
      res.redirect('/');
    });
  });

  app.get('/api/auth/status', (req, res) => {
    res.json({
      authenticated: !DASHBOARD_PASSWORD || !!(req.session && req.session.authenticated),
      passwordRequired: !!DASHBOARD_PASSWORD,
    });
  });

  // Apply auth guard to everything below
  app.use(requireAuth);

  // ═══════════════════════════════════════════
  // AUTH ROUTES (Google OAuth)
  // ═══════════════════════════════════════════

  app.get('/auth/add-account', (req, res) => {
    try {
      const authUrl = getAuthUrl();
      res.redirect(authUrl);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/auth/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).json({ error: 'Missing authorization code' });
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

  app.get('/api/accounts', async (req, res) => {
    try {
      const accounts = await getActiveAccounts();
      const safe = accounts.map(({ refresh_token, access_token, ...rest }) => rest);
      res.json(safe);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/accounts/:id', async (req, res) => {
    try {
      await deactivateAccount(parseInt(req.params.id));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/emails', async (req, res) => {
    try {
      const { limit, importance, accountId, urgent } = req.query;
      const emails = await getRecentEmails(
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

  app.get('/api/events', async (req, res) => {
    try {
      const events = await getCreatedEvents(parseInt(req.query.limit) || 20);
      res.json(events);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/queue', async (req, res) => {
    try {
      const pending = await getPendingReplies();
      res.json(pending);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/replies', async (req, res) => {
    try {
      const replies = await getAllReplies(parseInt(req.query.limit) || 50);
      res.json(replies);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/queue/:id/approve', async (req, res) => {
    try {
      const success = await approveReply(parseInt(req.params.id));
      res.json({ success });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/queue/:id/reject', async (req, res) => {
    try {
      await rejectReply(parseInt(req.params.id));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/queue/:id/edit', async (req, res) => {
    try {
      const { text } = req.body;
      if (!text) return res.status(400).json({ error: 'Missing reply text' });
      await editReply(parseInt(req.params.id), text);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/stats', async (req, res) => {
    try {
      const [te, ce, he, ev, pr, sr, ta] = await Promise.all([
        queryOne('SELECT COUNT(*) as count FROM emails'),
        queryOne("SELECT COUNT(*) as count FROM emails WHERE importance = 'critical'"),
        queryOne("SELECT COUNT(*) as count FROM emails WHERE importance = 'high'"),
        queryOne('SELECT COUNT(*) as count FROM calendar_events'),
        queryOne("SELECT COUNT(*) as count FROM reply_queue WHERE status IN ('pending', 'edited')"),
        queryOne("SELECT COUNT(*) as count FROM reply_queue WHERE status = 'sent'"),
        queryOne('SELECT COUNT(*) as count FROM accounts WHERE is_active = 1'),
      ]);
      res.json({
        totalEmails: te?.count || 0,
        criticalEmails: ce?.count || 0,
        highEmails: he?.count || 0,
        totalEvents: ev?.count || 0,
        pendingReplies: pr?.count || 0,
        sentReplies: sr?.count || 0,
        totalAccounts: ta?.count || 0,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/telegram/status', (req, res) => {
    try {
      const status = getTelegramStatus();
      res.json(status);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/settings', async (req, res) => {
    try {
      const settings = await queryAll('SELECT * FROM settings');
      const obj = {};
      settings.forEach((s) => (obj[s.key] = s.value));
      res.json(obj);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/settings', async (req, res) => {
    try {
      const updates = req.body;
      for (const [key, value] of Object.entries(updates)) {
        await run(
          "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
          [key, String(value)]
        );
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/pipeline-status', (req, res) => {
    res.json({ running: getPipelineStatus() });
  });

  app.post('/api/check-now', async (req, res) => {
    try {
      if (getPipelineStatus()) {
        // Already running — tell the client to just keep polling stats
        return res.json({ message: 'Pipeline already running', alreadyRunning: true });
      }
      res.json({ message: 'Email check started', alreadyRunning: false });
      runPipeline().catch((err) => console.error('Manual pipeline error:', err));
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/reanalyze', async (req, res) => {
    try {
      const { analyzeEmail } = await import('./ai/analyzer.js');
      const { notifyImportantEmail } = await import('./notifications/notifier.js');

      const candidates = await queryAll(
        `SELECT e.*, a.email as account_email FROM emails e
         JOIN accounts a ON e.account_id = a.id
         WHERE e.importance IN ('other', 'medium', 'low')
         ORDER BY e.processed_at DESC LIMIT 50`
      );

      res.json({ message: `Re-analyzing ${candidates.length} emails in background...`, count: candidates.length });

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

            if (analysis.importance === 'critical' || analysis.importance === 'high') {
              await run(
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

  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  });

  return app;
}

export default { createServer };
