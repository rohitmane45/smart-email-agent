import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '.env');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question, defaultVal = '') {
  return new Promise((resolve) => {
    const prompt = defaultVal ? `${question} (${defaultVal}): ` : `${question}: `;
    rl.question(prompt, (answer) => {
      resolve(answer.trim() || defaultVal);
    });
  });
}

async function main() {
  console.log(`
  ╔═══════════════════════════════════════════════════╗
  ║                                                   ║
  ║   📧  Smart Email Agent — Setup Wizard  🔧        ║
  ║                                                   ║
  ╚═══════════════════════════════════════════════════╝
  `);

  console.log('This wizard will help you configure your Email Agent.\n');
  console.log('📋 Before you start, you need:');
  console.log('   1. A Google Cloud project with Gmail API & Calendar API enabled');
  console.log('   2. OAuth 2.0 credentials (Client ID & Secret)');
  console.log('   3. A Gemini API key from aistudio.google.com');
  console.log('   4. A Telegram bot token (from @BotFather)\n');

  // Check if .env already exists
  if (fs.existsSync(ENV_PATH)) {
    const overwrite = await ask('⚠️ .env already exists. Overwrite? (y/N)', 'N');
    if (overwrite.toLowerCase() !== 'y') {
      console.log('✅ Keeping existing .env file. You can edit it manually.');
      rl.close();
      return;
    }
  }

  console.log('\n── Google Cloud Credentials ──\n');
  console.log('📝 Get these from: https://console.cloud.google.com/apis/credentials\n');

  const clientId = await ask('Google Client ID');
  const clientSecret = await ask('Google Client Secret');
  const redirectUri = await ask('OAuth Redirect URI', 'http://localhost:3000/auth/callback');

  console.log('\n── Gemini AI ──\n');
  console.log('📝 Get your key from: https://aistudio.google.com/apikey\n');

  const geminiKey = await ask('Gemini API Key');

  console.log('\n── Agent Settings ──\n');

  const interval = await ask('Check emails every N hours', '3');
  const maxEmails = await ask('Max emails to check per cycle', '15');
  const port = await ask('Dashboard port', '3000');

  console.log('\n── Telegram Notifications ──\n');
  console.log('📝 Setup steps:');
  console.log('   1. Open Telegram → search @BotFather → send /newbot');
  console.log('   2. Follow the prompts to create a bot and get a token');
  console.log('   3. Open your new bot in Telegram and send it any message');
  console.log('   4. Visit: https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates');
  console.log('   5. Find "chat":{"id": YOUR_CHAT_ID} in the response\n');

  const telegramToken = await ask('Telegram Bot Token (or press Enter to skip)', '');
  const telegramChatId = await ask('Telegram Chat ID (or press Enter to skip)', '');

  // Build .env content
  const envContent = `# ===== Google Cloud OAuth2 =====
GOOGLE_CLIENT_ID=${clientId}
GOOGLE_CLIENT_SECRET=${clientSecret}
GOOGLE_REDIRECT_URI=${redirectUri}

# ===== Gemini AI =====
GEMINI_API_KEY=${geminiKey}

# ===== Agent Settings =====
CHECK_INTERVAL_HOURS=${interval}
PORT=${port}
MAX_EMAILS_PER_CHECK=${maxEmails}

# ===== Telegram Bot =====
TELEGRAM_BOT_TOKEN=${telegramToken}
TELEGRAM_CHAT_ID=${telegramChatId}

# ===== Notification Preferences =====
NOTIFY_ON_CRITICAL=true
NOTIFY_ON_HIGH=true
NOTIFY_ON_MEDIUM=false
NOTIFY_ON_LOW=false
`;

  fs.writeFileSync(ENV_PATH, envContent);

  console.log('\n✅ Configuration saved to .env\n');
  console.log('── Next Steps ──\n');
  console.log('  1. Start the agent:  npm run dev');
  console.log('  2. Open dashboard:   http://localhost:' + port);
  console.log('  3. Add Gmail account by clicking "Add Account" on the dashboard');
  if (!telegramToken) {
    console.log('  4. Set up Telegram later by editing .env with your bot token & chat ID');
  } else {
    console.log('  4. Telegram notifications are ready! 📨');
  }
  console.log('\n🚀 You\'re all set! Run "npm run dev" to start.\n');

  rl.close();
}

main().catch((err) => {
  console.error('Setup error:', err);
  rl.close();
  process.exit(1);
});
