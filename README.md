# 📧 Smart Email Agent 🤖

> AI-powered email agent that reads your Gmail, identifies important emails, creates Google Calendar events, sends WhatsApp notifications, and auto-replies with your permission.

## ✨ Features

- **🔍 Multi-Account Gmail** — Connect 2+ Gmail accounts and monitor all of them
- **🤖 AI Email Analysis** — Uses Google Gemini to classify importance (critical/high/medium/low)
- **📅 Calendar Events** — Automatically creates Google Calendar events from emails with reminders
- **📱 WhatsApp Notifications** — Get instant WhatsApp alerts for urgent emails
- **✉️ Smart Auto-Reply** — AI generates reply drafts; you approve/edit before sending
- **🎛️ Beautiful Dashboard** — Dark glassmorphism control panel to manage everything
- **⏰ Scheduled Checks** — Checks emails every 3 hours (configurable)

---

## 🚀 Quick Start

### Prerequisites

1. **Node.js 18+** — [Download](https://nodejs.org)
2. **Google Cloud Project** — [Console](https://console.cloud.google.com)
3. **Gemini API Key** — [AI Studio](https://aistudio.google.com/apikey)

### Step 1: Google Cloud Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project (or select existing)
3. Enable these APIs:
   - **Gmail API** → [Enable](https://console.cloud.google.com/apis/library/gmail.googleapis.com)
   - **Google Calendar API** → [Enable](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com)
4. Go to **APIs & Services → OAuth Consent Screen**:
   - Choose "External" user type
   - Fill in app name, email
   - Add scopes: Gmail readonly, Gmail send, Calendar
   - Add your Gmail addresses as **Test Users**
5. Go to **APIs & Services → Credentials**:
   - Click **Create Credentials → OAuth 2.0 Client IDs**
   - Application type: **Web Application**
   - Add redirect URI: `http://localhost:3000/auth/callback`
   - Download the credentials (Client ID + Secret)

### Step 2: Install & Configure

```bash
# Install dependencies
npm install

# Run the setup wizard
npm run setup
```

The wizard will ask for:
- Google Client ID & Secret
- Gemini API Key
- Your WhatsApp phone number
- Check interval (default: 3 hours)

### Step 3: Run

```bash
# Start the agent
npm run dev
```

### Step 4: Connect Accounts

1. Open **http://localhost:3000** in your browser
2. Click **"Add Account"** to connect your Gmail
3. Authorize the app with your Google account
4. Repeat for your second Gmail account

### Step 5: WhatsApp Setup

1. When the agent starts, a QR code appears in the terminal
2. Open WhatsApp on your phone
3. Go to **Settings → Linked Devices → Link a Device**
4. Scan the QR code

---

## 🎛️ Dashboard

Open **http://localhost:3000** to access:

| Section | Description |
|---------|-------------|
| **Overview** | Stats, recent important emails, recent events |
| **Accounts** | Manage connected Gmail accounts |
| **Emails** | Browse all analyzed emails with filters |
| **Calendar** | View events created by the agent |
| **Replies** | Approve, edit, or reject auto-reply drafts |
| **Settings** | Configure check interval, notifications, etc. |

---

## ⚙️ Configuration

### Environment Variables (.env)

| Variable | Description | Default |
|----------|-------------|---------|
| `GOOGLE_CLIENT_ID` | OAuth 2.0 Client ID | Required |
| `GOOGLE_CLIENT_SECRET` | OAuth 2.0 Client Secret | Required |
| `GEMINI_API_KEY` | Gemini API Key | Required |
| `CHECK_INTERVAL_HOURS` | Hours between email checks | `3` |
| `MAX_EMAILS_PER_CHECK` | Max emails to process per check | `15` |
| `PORT` | Dashboard port | `3000` |
| `WHATSAPP_PHONE_NUMBER` | Your WhatsApp number with country code | Optional |

---

## 📁 Project Structure

```
├── public/                 # Dashboard UI
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── src/
│   ├── ai/                 # Gemini AI analysis
│   │   ├── analyzer.js
│   │   └── prompts.js
│   ├── auth/               # OAuth2 multi-account
│   │   ├── credentials.js
│   │   └── oauth-manager.js
│   ├── calendar/           # Google Calendar
│   │   └── manager.js
│   ├── db/                 # SQLite database
│   │   ├── database.js
│   │   └── migrations.js
│   ├── email/              # Email fetching
│   │   ├── fetcher.js
│   │   └── parser.js
│   ├── notifications/      # WhatsApp
│   │   ├── whatsapp.js
│   │   └── notifier.js
│   ├── reply/              # Auto-reply
│   │   └── auto-reply.js
│   ├── scheduler/          # Cron scheduler
│   │   └── cron.js
│   ├── server.js           # Express API
│   └── app.js              # Entry point
├── data/                   # SQLite DB (gitignored)
├── .env.example
├── package.json
├── setup.js
└── README.md
```

---

## 🔧 Troubleshooting

| Issue | Fix |
|-------|-----|
| OAuth error | Make sure redirect URI matches exactly: `http://localhost:3000/auth/callback` |
| Gmail API disabled | Enable it in Google Cloud Console |
| WhatsApp QR not showing | Wait 10-15 seconds; check terminal output |
| No emails found | Make sure you have unread emails in the Primary tab |
| Calendar events not created | Check that Calendar API is enabled for your project |

---

## 📝 License

MIT — Built with ❤️ for Ro
