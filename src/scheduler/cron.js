import cron from 'node-cron';
import { getActiveAccounts } from '../auth/oauth-manager.js';
import { fetchNewEmails, saveEmail } from '../email/fetcher.js';
import { analyzeEmails } from '../ai/analyzer.js';
import { createCalendarEvent, createUrgentCalendarEvent } from '../calendar/manager.js';
import { notifyImportantEmail, notifyCalendarEvent, notifyReplyApproval } from '../notifications/notifier.js';
import { sendUrgentNotification, getTelegramStatus } from '../notifications/telegram.js';
import { queueReply } from '../reply/auto-reply.js';
import { queryOne } from '../db/database.js';

let cronJob = null;
let isPipelineRunning = false; // Mutex: prevent concurrent pipeline runs

/**
 * Export the running state so /api/check-now can report it.
 */
export function getPipelineStatus() {
  return isPipelineRunning;
}

/**
 * The main email processing pipeline.
 * Fetches → Analyzes → Creates Events → Notifies → Queues Replies.
 * 
 * MUTEX PROTECTED: only one instance runs at a time.
 * Concurrent calls are silently dropped and return null.
 */
export async function runPipeline() {
  if (isPipelineRunning) {
    console.log('⚠️ Pipeline already running — skipping concurrent trigger.');
    return null;
  }
  isPipelineRunning = true;
  try {
    return await _runPipeline();
  } finally {
    isPipelineRunning = false;
  }
}

async function _runPipeline() {
  console.log('\n🔄 ════════════════════════════════════════════');
  console.log(`🔄 Email check started at ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
  console.log('🔄 ════════════════════════════════════════════\n');

  const accounts = await getActiveAccounts();
  if (accounts.length === 0) {
    console.log('⚠️ No active accounts. Add an account via the dashboard.');
    return;
  }

  const maxEmails = parseInt(
    (await queryOne("SELECT value FROM settings WHERE key = 'max_emails_per_check'"))?.value || '15'
  );

  let totalProcessed = 0;
  let totalEvents = 0;
  let totalReplies = 0;
  let criticalCount = 0;
  let highCount = 0;

  for (const account of accounts) {
    console.log(`\n📧 Checking account: ${account.email}`);

    // Step 1: Fetch new emails
    let emails;
    try {
      emails = await fetchNewEmails(account.id, maxEmails);
    } catch (err) {
      if (err.code === 'INVALID_GRANT') {
        // Refresh token has expired/been revoked — notify user to re-auth
        const reAuthUrl = `http://localhost:3000/auth/add-account`;
        const tgStatus = getTelegramStatus();
        if (tgStatus.isReady) {
          await sendUrgentNotification({
            subject: '⚠️ Gmail Re-Authentication Required',
            senderEmail: account.email,
            briefSummary: `The refresh token for ${account.email} has expired. Please re-authenticate to resume email monitoring.`,
            importance: 'critical',
            isUrgent: true,
            reAuthUrl,
          }).catch(() => { });
        }
        console.error(`🔐 Account ${account.email} needs re-authentication: ${reAuthUrl}`);
        continue;
      }
      console.error(`❌ Unexpected pipeline error for account ${account.id}:`, err.message);
      continue;
    }
    if (emails.length === 0) continue;

    // Step 2: Analyze with AI
    const analysisResults = await analyzeEmails(emails);

    for (const { email, analysis } of analysisResults) {
      // Step 3: Save to database
      const emailId = await saveEmail(email, analysis);
      if (!emailId) continue;

      totalProcessed++;

      // Track importance counts
      if (analysis.importance === 'critical') criticalCount++;
      else if (analysis.importance === 'high') highCount++;

      console.log(
        `  ${getImportanceIcon(analysis.importance)} [${analysis.importance.toUpperCase()}] ${email.subject} — ${analysis.briefSummary}`
      );

      // Step 4: Create calendar events
      if (analysis.isCalendarEvent && analysis.eventDetails) {
        let calendarEvent;
        if (analysis.isUrgent || analysis.importance === 'critical') {
          calendarEvent = await createUrgentCalendarEvent(account.id, emailId, analysis.eventDetails);
        } else {
          calendarEvent = await createCalendarEvent(account.id, emailId, analysis.eventDetails);
        }

        if (calendarEvent) {
          totalEvents++;
          await notifyCalendarEvent(analysis.eventDetails);
        }
      }

      // Step 5: Send notifications for important emails
      if (analysis.importance === 'critical' || analysis.importance === 'high' || analysis.isUrgent) {
        await notifyImportantEmail(email, analysis);
      }

      // Step 6: Queue auto-replies
      if (analysis.suggestedReply && !analysis.needsHumanReply) {
        const queued = await queueReply(emailId, account.id, email, analysis.suggestedReply);
        if (queued) {
          totalReplies++;
          await notifyReplyApproval({
            originalSender: email.senderEmail,
            originalSubject: email.subject,
            draftReply: analysis.suggestedReply,
          });
        }
      }
    }
  }

  console.log(`\n✅ Pipeline complete: ${totalProcessed} emails, ${totalEvents} events, ${totalReplies} replies queued\n`);

  return {
    totalProcessed,
    critical: criticalCount,
    high: highCount,
    eventsCreated: totalEvents,
    repliesQueued: totalReplies,
  };
}

/**
 * Start the cron scheduler.
 * @param {number} intervalHours - Hours between each check (default: 3).
 */
export function startScheduler(intervalHours = 3) {
  // Run immediately on startup
  console.log('🚀 Running initial email check...');
  runPipeline().catch((err) => console.error('Pipeline error:', err));

  // Schedule recurring checks
  // Convert hours to cron: "0 */3 * * *" = every 3 hours at minute 0
  const cronExpression = `0 */${intervalHours} * * *`;

  cronJob = cron.schedule(cronExpression, () => {
    console.log('⏰ Scheduled email check triggered');
    runPipeline().catch((err) => console.error('Pipeline error:', err));
  });

  console.log(`⏰ Scheduler started: checking every ${intervalHours} hour(s)`);
}

/**
 * Stop the cron scheduler.
 */
export function stopScheduler() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    console.log('⏹️ Scheduler stopped');
  }
}

/**
 * Get an icon for importance level.
 */
function getImportanceIcon(importance) {
  const icons = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' };
  return icons[importance] || '⚪';
}

export default { runPipeline, startScheduler, stopScheduler };
