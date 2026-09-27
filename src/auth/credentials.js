import dotenv from 'dotenv';
dotenv.config();

export function getGoogleCredentials() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/callback';

  if (!clientId || !clientSecret) {
    throw new Error(
      '❌ Missing Google OAuth credentials!\n' +
      'Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your .env file.\n' +
      'Get them from: https://console.cloud.google.com/apis/credentials'
    );
  }

  return { clientId, clientSecret, redirectUri };
}

// ──────────────────────────────────────────────
// Gemini API Key Rotation
// Reads all keys defined as:
//   GEMINI_API_KEY=key1
//   GEMINI_API_KEY_2=key2
//   GEMINI_API_KEY_3=key3
//   ... (up to 10 keys)
// Automatically rotates when one hits a rate limit.
// ──────────────────────────────────────────────

const keyState = {
  keys: [],           // All available API keys
  currentIndex: 0,    // Which key we're using right now
  rateLimited: {},    // { index: timestamp } — when this key was rate-limited
  usageCount: {},     // { index: count } — how many calls each key made
};

const RATE_LIMIT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour cooldown before retrying a limited key

/**
 * Load all Gemini API keys from environment variables.
 * Keys are read from GEMINI_API_KEY, GEMINI_API_KEY_2, GEMINI_API_KEY_3, ... GEMINI_API_KEY_10
 */
function loadKeys() {
  if (keyState.keys.length > 0) return; // Already loaded

  const keys = [];

  // Primary key
  if (process.env.GEMINI_API_KEY) {
    keys.push(process.env.GEMINI_API_KEY.trim());
  }

  // Additional keys: GEMINI_API_KEY_2 through GEMINI_API_KEY_10
  for (let i = 2; i <= 10; i++) {
    const key = process.env[`GEMINI_API_KEY_${i}`];
    if (key && key.trim()) {
      keys.push(key.trim());
    }
  }

  if (keys.length === 0) {
    throw new Error(
      '❌ Missing Gemini API key!\n' +
      'Please set GEMINI_API_KEY in your .env file.\n' +
      'Get one from: https://aistudio.google.com/apikey'
    );
  }

  keyState.keys = keys;
  console.log(`🔑 Gemini API key rotation ready: ${keys.length} key(s) loaded`);
}

/**
 * Get the current active Gemini API key.
 * Automatically skips keys that are still in cooldown.
 */
export function getGeminiApiKey() {
  loadKeys();

  const now = Date.now();
  const total = keyState.keys.length;

  // Try each key starting from current index
  for (let attempt = 0; attempt < total; attempt++) {
    const idx = (keyState.currentIndex + attempt) % total;
    const limitedAt = keyState.rateLimited[idx];

    if (!limitedAt || now - limitedAt >= RATE_LIMIT_COOLDOWN_MS) {
      // This key is available
      keyState.currentIndex = idx;
      return keyState.keys[idx];
    }
  }

  // All keys are rate-limited — find the one that will recover soonest
  let soonestIdx = 0;
  let soonestTime = Infinity;
  for (let i = 0; i < total; i++) {
    const remaining = RATE_LIMIT_COOLDOWN_MS - (now - (keyState.rateLimited[i] || 0));
    if (remaining < soonestTime) {
      soonestTime = remaining;
      soonestIdx = i;
    }
  }

  const minutesLeft = Math.ceil(soonestTime / 60000);
  throw new Error(
    `⚠️ All ${total} Gemini API key(s) are rate-limited.\n` +
    `Next key available in ~${minutesLeft} minute(s).\n` +
    `Add more keys: GEMINI_API_KEY_${total + 1}=your_new_key in .env`
  );
}

/**
 * Call this when a Gemini API call hits a 429 rate limit error.
 * Marks the current key as limited and switches to the next one.
 * @returns {string|null} The new key to use, or null if all keys are exhausted.
 */
export function markCurrentKeyRateLimited() {
  loadKeys();

  const idx = keyState.currentIndex;
  keyState.rateLimited[idx] = Date.now();

  const keyNum = idx === 0 ? '' : `_${idx + 1}`;
  console.warn(`⚠️ GEMINI_API_KEY${keyNum} hit rate limit — rotating to next key...`);

  // Try to find the next available key
  const total = keyState.keys.length;
  for (let attempt = 1; attempt < total; attempt++) {
    const nextIdx = (idx + attempt) % total;
    const limitedAt = keyState.rateLimited[nextIdx];
    if (!limitedAt || Date.now() - limitedAt >= RATE_LIMIT_COOLDOWN_MS) {
      keyState.currentIndex = nextIdx;
      const nextKeyNum = nextIdx === 0 ? '' : `_${nextIdx + 1}`;
      console.log(`✅ Switched to GEMINI_API_KEY${nextKeyNum}`);
      return keyState.keys[nextIdx];
    }
  }

  console.error(`❌ All ${total} Gemini API key(s) are rate-limited!`);
  return null;
}

/**
 * Get status of all API keys (for dashboard/Telegram status command).
 */
export function getApiKeyStatus() {
  loadKeys();

  const now = Date.now();
  return keyState.keys.map((key, idx) => {
    const limitedAt = keyState.rateLimited[idx];
    const isLimited = limitedAt && now - limitedAt < RATE_LIMIT_COOLDOWN_MS;
    const recoversIn = isLimited ? Math.ceil((RATE_LIMIT_COOLDOWN_MS - (now - limitedAt)) / 60000) : 0;
    const keyNum = idx === 0 ? 'GEMINI_API_KEY' : `GEMINI_API_KEY_${idx + 1}`;
    const maskedKey = `${key.substring(0, 8)}...${key.slice(-4)}`;

    return {
      index: idx,
      envVar: keyNum,
      maskedKey,
      isCurrent: idx === keyState.currentIndex,
      isRateLimited: !!isLimited,
      recoversInMinutes: recoversIn,
      usageCount: keyState.usageCount[idx] || 0,
    };
  });
}

export function getAppSettings() {
  return {
    port: parseInt(process.env.PORT || '3000', 10),
    checkIntervalHours: parseInt(process.env.CHECK_INTERVAL_HOURS || '3', 10),
    maxEmailsPerCheck: parseInt(process.env.MAX_EMAILS_PER_CHECK || '15', 10),
    whatsappPhone: process.env.WHATSAPP_PHONE_NUMBER || '',
  };
}
