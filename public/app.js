/* ═══════════════════════════════════════════════
   Smart Email Agent — Dashboard JavaScript
   ═══════════════════════════════════════════════ */

// ═══ State ═══
let currentSection = 'overview';
let editingReplyId = null;
let refreshInterval = null;

// ═══ Init ═══
document.addEventListener('DOMContentLoaded', () => {
  // Check for URL params (success/error messages)
  const params = new URLSearchParams(window.location.search);
  if (params.get('success')) {
    showToast(params.get('success'), 'success');
    window.history.replaceState({}, '', '/');
  }
  if (params.get('error')) {
    showToast(params.get('error'), 'error');
    window.history.replaceState({}, '', '/');
  }

  // Load initial data
  loadStats();
  loadAccounts();
  loadEmails();
  loadEvents();
  loadReplies();
  loadSettings();
  checkTelegramStatus();

  // Auto-refresh every 30 seconds
  refreshInterval = setInterval(() => {
    loadStats();
    loadReplies();
    checkTelegramStatus();
  }, 30000);
});

// ═══ Navigation ═══
function switchSection(section) {
  currentSection = section;

  // Update nav buttons
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.section === section);
  });

  // Show/hide sections
  document.querySelectorAll('.section').forEach((sec) => {
    sec.classList.toggle('active', sec.id === `section-${section}`);
  });

  // Refresh data for the section
  switch (section) {
    case 'overview': loadStats(); loadEmails(); loadEvents(); break;
    case 'accounts': loadAccounts(); break;
    case 'emails': loadEmails(); break;
    case 'events': loadEvents(); break;
    case 'replies': loadReplies(); break;
    case 'settings': loadSettings(); checkTelegramStatus(); break;
  }
}

// ═══ API Helper ═══
async function api(url, options = {}) {
  try {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    return await res.json();
  } catch (error) {
    console.error(`API error (${url}):`, error);
    return null;
  }
}

// ═══ Stats ═══
async function loadStats() {
  const stats = await api('/api/stats');
  if (!stats) return;

  animateNumber('stat-total-emails', stats.totalEmails);
  animateNumber('stat-critical', stats.criticalEmails);
  animateNumber('stat-high', stats.highEmails);
  animateNumber('stat-events', stats.totalEvents);
  animateNumber('stat-pending', stats.pendingReplies);
  animateNumber('stat-accounts', stats.totalAccounts);

  // Update reply badge
  const badge = document.getElementById('reply-badge');
  if (stats.pendingReplies > 0) {
    badge.style.display = 'inline';
    badge.textContent = stats.pendingReplies;
  } else {
    badge.style.display = 'none';
  }
}

function animateNumber(elementId, target) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const current = parseInt(el.textContent) || 0;
  if (current === target) return;

  const duration = 600;
  const start = performance.now();

  function update(now) {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(current + (target - current) * eased);
    if (progress < 1) requestAnimationFrame(update);
  }

  requestAnimationFrame(update);
}

// ═══ Accounts ═══
async function loadAccounts() {
  const accounts = await api('/api/accounts');
  const container = document.getElementById('accounts-list');

  if (!accounts || accounts.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">👤</div>
        <p>No accounts connected</p>
        <p class="muted">Click "Add Account" to connect your Gmail</p>
      </div>`;
    return;
  }

  container.innerHTML = accounts.map((acc) => `
    <div class="account-card">
      <div class="account-avatar">${(acc.display_name || acc.email)[0].toUpperCase()}</div>
      <div class="account-info">
        <div class="account-name">${escapeHtml(acc.display_name || acc.email)}</div>
        <div class="account-email">${escapeHtml(acc.email)}</div>
        <div class="account-last-check">
          ${acc.last_checked_at ? `Last checked: ${formatDate(acc.last_checked_at)}` : 'Not checked yet'}
        </div>
      </div>
      <button class="btn btn-danger btn-sm" onclick="removeAccount(${acc.id})" title="Remove account">✕</button>
    </div>
  `).join('');
}

async function removeAccount(id) {
  if (!confirm('Are you sure you want to remove this account?')) return;
  const result = await api(`/api/accounts/${id}`, { method: 'DELETE' });
  if (result?.success) {
    showToast('Account removed', 'success');
    loadAccounts();
    loadStats();
  } else {
    showToast('Failed to remove account', 'error');
  }
}

// ═══ Emails ═══
async function loadEmails() {
  const importance = document.getElementById('filter-importance')?.value || '';
  const params = new URLSearchParams({ limit: '50' });
  if (importance) params.set('importance', importance);

  const emails = await api(`/api/emails?${params}`);

  // Update overview's recent emails (show top 5 important ones)
  const recentContainer = document.getElementById('recent-emails-list');
  const fullContainer = document.getElementById('emails-list');

  if (!emails || emails.length === 0) {
    const emptyHtml = `
      <div class="empty-state">
        <div class="empty-icon">📭</div>
        <p>No emails analyzed yet</p>
        <p class="muted">Connect a Gmail account to get started</p>
      </div>`;
    if (recentContainer) recentContainer.innerHTML = emptyHtml;
    if (fullContainer) fullContainer.innerHTML = emptyHtml;
    return;
  }

  const renderEmail = (email) => `
    <div class="email-item">
      <div class="importance-badge importance-${email.importance}"></div>
      <div class="email-content">
        <div class="email-subject">${escapeHtml(email.subject || '(no subject)')}</div>
        <div class="email-from">${escapeHtml(email.sender_name || email.sender_email)}</div>
        <div class="email-summary">${escapeHtml(email.brief_summary || email.snippet || '')}</div>
        <div class="email-meta">
          <span class="email-tag tag-category">${email.category || 'other'}</span>
          ${email.is_calendar_event ? '<span class="email-tag tag-calendar">📅 Calendar Event</span>' : ''}
          ${email.is_urgent ? '<span class="email-tag tag-urgent">⚡ Urgent</span>' : ''}
        </div>
      </div>
      <div class="email-time">${formatDate(email.processed_at || email.received_at)}</div>
    </div>`;

  if (recentContainer) {
    const important = emails.filter((e) => e.importance === 'critical' || e.importance === 'high');
    const top5 = (important.length > 0 ? important : emails).slice(0, 5);
    recentContainer.innerHTML = top5.map(renderEmail).join('');
  }

  if (fullContainer) {
    fullContainer.innerHTML = emails.map(renderEmail).join('');
  }
}

// ═══ Events ═══
async function loadEvents() {
  const events = await api('/api/events');

  const recentContainer = document.getElementById('recent-events-list');
  const fullContainer = document.getElementById('events-list');

  if (!events || events.length === 0) {
    const emptyHtml = `
      <div class="empty-state">
        <div class="empty-icon">📅</div>
        <p>No events created yet</p>
        <p class="muted">Events will appear when detected in emails</p>
      </div>`;
    if (recentContainer) recentContainer.innerHTML = emptyHtml;
    if (fullContainer) fullContainer.innerHTML = emptyHtml;
    return;
  }

  const renderEvent = (event) => `
    <div class="event-item">
      <div class="event-summary">${escapeHtml(event.summary)}</div>
      <div class="event-details">
        <div class="event-detail">🕐 ${formatDate(event.start_time)}</div>
        ${event.location ? `<div class="event-detail">📍 ${escapeHtml(event.location)}</div>` : ''}
        <div class="event-detail">👤 ${escapeHtml(event.account_email)}</div>
      </div>
    </div>`;

  if (recentContainer) {
    recentContainer.innerHTML = events.slice(0, 5).map(renderEvent).join('');
  }

  if (fullContainer) {
    fullContainer.innerHTML = events.map(renderEvent).join('');
  }
}

// ═══ Replies ═══
async function loadReplies() {
  const replies = await api('/api/queue');
  const container = document.getElementById('replies-list');

  if (!replies || replies.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">✉️</div>
        <p>No pending replies</p>
        <p class="muted">AI-suggested replies will appear here for your approval</p>
      </div>`;
    return;
  }

  container.innerHTML = replies.map((reply) => `
    <div class="reply-item">
      <div class="reply-header">
        <div>
          <div class="reply-to">To: ${escapeHtml(reply.original_sender)}</div>
          <div class="reply-subject">RE: ${escapeHtml(reply.original_subject || '(no subject)')}</div>
        </div>
        <span class="reply-status status-${reply.status}">${reply.status}</span>
      </div>
      <div class="reply-draft">${escapeHtml(reply.edited_reply || reply.draft_reply)}</div>
      ${reply.status === 'pending' || reply.status === 'edited' ? `
        <div class="reply-actions">
          <button class="btn btn-success btn-sm" onclick="handleApprove(${reply.id})">
            ✅ Approve & Send
          </button>
          <button class="btn btn-ghost btn-sm" onclick="openEditModal(${reply.id}, '${escapeAttr(reply.original_sender)}', '${escapeAttr(reply.original_subject)}', '${escapeAttr(reply.edited_reply || reply.draft_reply)}')">
            ✏️ Edit
          </button>
          <button class="btn btn-danger btn-sm" onclick="handleReject(${reply.id})">
            ❌ Reject
          </button>
        </div>
      ` : ''}
    </div>
  `).join('');
}

async function handleApprove(id) {
  const result = await api(`/api/queue/${id}/approve`, { method: 'POST' });
  if (result?.success) {
    showToast('Reply sent successfully!', 'success');
    loadReplies();
    loadStats();
  } else {
    showToast('Failed to send reply', 'error');
  }
}

async function handleReject(id) {
  if (!confirm('Reject this auto-reply?')) return;
  const result = await api(`/api/queue/${id}/reject`, { method: 'POST' });
  if (result?.success) {
    showToast('Reply rejected', 'info');
    loadReplies();
    loadStats();
  }
}

function openEditModal(id, sender, subject, text) {
  editingReplyId = id;
  document.getElementById('edit-modal-info').innerHTML = `
    <strong>To:</strong> ${escapeHtml(sender)}<br>
    <strong>RE:</strong> ${escapeHtml(subject)}
  `;
  document.getElementById('edit-reply-text').value = text;
  document.getElementById('edit-modal').style.display = 'flex';
}

function closeEditModal() {
  editingReplyId = null;
  document.getElementById('edit-modal').style.display = 'none';
}

async function submitEditedReply() {
  if (!editingReplyId) return;
  const text = document.getElementById('edit-reply-text').value.trim();
  if (!text) return showToast('Reply cannot be empty', 'error');

  // Save edit
  await api(`/api/queue/${editingReplyId}/edit`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  });

  // Then approve
  const result = await api(`/api/queue/${editingReplyId}/approve`, { method: 'POST' });
  closeEditModal();

  if (result?.success) {
    showToast('Edited reply sent!', 'success');
  } else {
    showToast('Failed to send reply', 'error');
  }

  loadReplies();
  loadStats();
}

// ═══ Settings ═══
async function loadSettings() {
  const settings = await api('/api/settings');
  if (!settings) return;

  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = val === 'true';
    else el.value = val;
  };

  setVal('setting-interval', settings.check_interval_hours);
  setVal('setting-max-emails', settings.max_emails_per_check);
  setVal('setting-notify-critical', settings.notify_critical);
  setVal('setting-notify-high', settings.notify_high);
  setVal('setting-notify-medium', settings.notify_medium);
  setVal('setting-notify-low', settings.notify_low);
  setVal('setting-auto-reply', settings.auto_reply_enabled);
  setVal('setting-language', settings.language);
}

async function saveSettings() {
  const getVal = (id) => {
    const el = document.getElementById(id);
    if (!el) return '';
    return el.type === 'checkbox' ? String(el.checked) : el.value;
  };

  const settings = {
    check_interval_hours: getVal('setting-interval'),
    max_emails_per_check: getVal('setting-max-emails'),
    notify_critical: getVal('setting-notify-critical'),
    notify_high: getVal('setting-notify-high'),
    notify_medium: getVal('setting-notify-medium'),
    notify_low: getVal('setting-notify-low'),
    auto_reply_enabled: getVal('setting-auto-reply'),
    language: getVal('setting-language'),
  };

  const result = await api('/api/settings', {
    method: 'POST',
    body: JSON.stringify(settings),
  });

  if (result?.success) {
    showToast('Settings saved!', 'success');
  } else {
    showToast('Failed to save settings', 'error');
  }
}

// ═══ Telegram ═══
async function checkTelegramStatus() {
  const status = await api('/api/telegram/status');
  if (!status) return;

  // Update header dot
  const headerDot = document.querySelector('#telegram-status-dot .dot');
  if (headerDot) {
    headerDot.className = `dot ${status.isReady ? 'connected' : 'disconnected'}`;
  }

  // Update settings page
  const display = document.getElementById('tg-status-display');
  if (display) {
    const statusText = status.isReady ? '✅ Connected' : '❌ Disconnected (check .env)';
    const dotClass = status.isReady ? 'connected' : 'disconnected';
    display.innerHTML = `<span class="dot ${dotClass}"></span><span>${statusText}</span>`;
  }
}

// ═══ Check Now ═══
let _checkNowActive = false; // Prevent double-click from firing multiple pipelines

async function checkNow() {
  if (_checkNowActive) {
    showToast('⏳ Already checking — please wait...', 'info');
    return;
  }
  _checkNowActive = true;

  const btn = document.getElementById('btn-check-now');
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-icon">⏳</span> Checking...';

  // Fire check-now ONCE. Server will reject if pipeline already running.
  const result = await api('/api/check-now', { method: 'POST' });

  if (result?.alreadyRunning) {
    showToast('⏳ A check is already in progress — waiting for it to finish...', 'info');
  } else {
    showToast('🔄 Email check started — checking all accounts...', 'info');
  }

  const previousTotal = parseInt(document.getElementById('stat-total-emails')?.textContent) || 0;

  // Poll pipeline-status every 3s. Once pipeline is done, refresh UI.
  let elapsed = 0;
  const maxWait = 150000; // 2.5 minutes max
  const pollInterval = 3000;

  const poller = setInterval(async () => {
    elapsed += pollInterval;
    try {
      const status = await api('/api/pipeline-status');
      const running = status?.running;

      // Update stats every poll tick while running
      await loadStats();

      // Pipeline finished (or timed out)
      if (!running || elapsed >= maxWait) {
        clearInterval(poller);
        _checkNowActive = false;
        btn.disabled = false;
        btn.innerHTML = '<span class="btn-icon">🔄</span> Check Now';

        // Final UI refresh
        await loadStats();
        loadEmails();
        loadEvents();
        loadReplies();

        const newTotal = parseInt(document.getElementById('stat-total-emails')?.textContent) || 0;
        if (newTotal > previousTotal) {
          showToast('✅ Check complete! Found ' + (newTotal - previousTotal) + ' new email(s).', 'success');
        } else {
          showToast('✅ Check complete (no new emails found).', 'info');
        }
      }
    } catch (err) {
      // Network error — stop polling
      clearInterval(poller);
      _checkNowActive = false;
      btn.disabled = false;
      btn.innerHTML = '<span class="btn-icon">🔄</span> Check Now';
    }
  }, pollInterval);
}


// ═══ Toast Notifications ═══
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3500);
}

// ═══ Utilities ═══
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function escapeAttr(text) {
  if (!text) return '';
  return text.replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;

    // Less than 24 hours — show relative time
    if (diff < 86400000 && diff > 0) {
      const hours = Math.floor(diff / 3600000);
      if (hours < 1) {
        const minutes = Math.floor(diff / 60000);
        return minutes <= 1 ? 'Just now' : `${minutes}m ago`;
      }
      return `${hours}h ago`;
    }

    return date.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}
