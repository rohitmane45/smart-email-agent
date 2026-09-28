import { GoogleGenerativeAI } from '@google/generative-ai';
import { getGeminiApiKey, markCurrentKeyRateLimited } from '../auth/credentials.js';
import { SYSTEM_PROMPT, ANALYSIS_PROMPT } from './prompts.js';
import { analyzeWithGroq } from './groq-client.js';

/**
 * Check if Groq provider should be used.
 */
function shouldUseGroq() {
  const provider = (process.env.AI_PROVIDER || '').toLowerCase();
  return provider === 'groq' || Boolean(process.env.GROQ_API_KEY);
}

/**
 * Create a fresh Gemini model using the currently active API key.
 * Called fresh each time so key rotation takes effect immediately.
 */
function createGeminiModel() {
  const apiKey = getGeminiApiKey();
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({
    model: 'gemini-1.5-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.3,
    },
  });
}

/**
 * Check if an error is a rate limit (429) error from Gemini.
 */
function isRateLimitError(error) {
  const msg = error.message || '';
  return (
    error.status === 429 ||
    msg.includes('429') ||
    msg.toLowerCase().includes('quota') ||
    msg.toLowerCase().includes('rate limit') ||
    msg.toLowerCase().includes('resource_exhausted')
  );
}

/**
 * Analyze email using Gemini with key rotation.
 */
async function analyzeWithGemini(contents, email) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const model = createGeminiModel();
      const result = await model.generateContent({ contents });
      const responseText = result.response.text();
      return JSON.parse(responseText);
    } catch (error) {
      if (isRateLimitError(error)) {
        console.warn(`⚠️ Gemini rate limit hit on attempt ${attempt + 1}. Rotating API key...`);
        const newKey = markCurrentKeyRateLimited();
        if (!newKey || attempt === 1) {
          throw new Error('All Gemini API keys are rate-limited');
        }
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      throw error;
    }
  }
  throw new Error('Max retries exceeded for Gemini');
}

/**
 * Analyze a single email using configured AI provider (Groq or Gemini).
 * @param {object} email - Parsed email object.
 * @returns {object} AI analysis result.
 */
export async function analyzeEmail(email) {
  const today = new Date().toISOString().split('T')[0];
  const systemPrompt = SYSTEM_PROMPT.replace('{TODAY_DATE}', today);

  const userPrompt = ANALYSIS_PROMPT
    .replace('{SENDER_NAME}', email.senderName || 'Unknown')
    .replace('{SENDER_EMAIL}', email.senderEmail || 'unknown@email.com')
    .replace('{SUBJECT}', email.subject || '(no subject)')
    .replace('{DATE}', email.date || 'Unknown')
    .replace('{BODY}', (email.bodyText || email.snippet || '').substring(0, 3000));

  let rawAnalysis = null;

  // 1. Try Groq if enabled
  if (shouldUseGroq()) {
    try {
      rawAnalysis = await analyzeWithGroq(systemPrompt, userPrompt);
    } catch (err) {
      console.warn(`⚠️ Groq analysis failed (${err.message}). Trying Gemini fallback...`);
    }
  }

  // 2. Fallback to Gemini if Groq didn't succeed
  if (!rawAnalysis) {
    try {
      const contents = [
        { role: 'user', parts: [{ text: systemPrompt + '\n\n' + userPrompt }] },
      ];
      rawAnalysis = await analyzeWithGemini(contents, email);
    } catch (err) {
      console.error('❌ AI analysis failed on all providers:', err.message);
      return applyKeywordOverride(buildDefaultAnalysis(email, err.message), email);
    }
  }

  const normalized = normalizeAnalysis(rawAnalysis);
  return applyKeywordOverride(normalized, email);
}

/**
 * Analyze multiple emails in batch.
 * @param {Array} emails - Array of parsed email objects.
 * @returns {Array} Array of { email, analysis } objects.
 */
export async function analyzeEmails(emails) {
  const results = [];

  for (const email of emails) {
    console.log(`🤖 Analyzing: "${email.subject}" from ${email.senderEmail}`);
    const analysis = await analyzeEmail(email);
    results.push({ email, analysis });

    // Small delay between calls to be kind to API rate limits
    await new Promise((resolve) => setTimeout(resolve, 600));
  }

  return results;
}

/**
 * Normalize and validate the AI analysis result.
 */
function normalizeAnalysis(analysis) {
  const validImportance = ['critical', 'high', 'medium', 'low'];
  const validCategories = ['placement', 'hackathon', 'job_application', 'meeting', 'deadline', 'academic', 'personal', 'work', 'newsletter', 'notification', 'other'];

  return {
    importance: validImportance.includes(analysis.importance) ? analysis.importance : 'medium',
    category: validCategories.includes(analysis.category) ? analysis.category : 'other',
    isCalendarEvent: Boolean(analysis.isCalendarEvent),
    isUrgent: Boolean(analysis.isUrgent),
    eventDetails: analysis.isCalendarEvent && analysis.eventDetails ? {
      summary: analysis.eventDetails.summary || 'Untitled Event',
      description: analysis.eventDetails.description || '',
      startTime: analysis.eventDetails.startTime || null,
      endTime: analysis.eventDetails.endTime || null,
      location: analysis.eventDetails.location || '',
    } : null,
    suggestedReply: analysis.suggestedReply || null,
    needsHumanReply: Boolean(analysis.needsHumanReply),
    briefSummary: analysis.briefSummary || 'No summary available',
  };
}

/**
 * Return a safe default analysis when AI is unavailable.
 */
function buildDefaultAnalysis(email, reason) {
  return {
    importance: 'medium',
    category: 'other',
    isCalendarEvent: false,
    isUrgent: false,
    eventDetails: null,
    suggestedReply: null,
    needsHumanReply: false,
    briefSummary: email.subject || `Could not analyze email (${reason})`,
  };
}

/**
 * Hard keyword override — runs after AI analysis to catch placement/T&P emails
 * that the AI may have missed. Checks sender name, sender email, and subject
 * against a curated list of critical placement keywords.
 * @param {object} analysis - The AI analysis result.
 * @param {object} email - The original email object.
 * @returns {object} Updated analysis with corrected importance/category if matched.
 */
function applyKeywordOverride(analysis, email) {
  const sender = (email.senderName || '').toLowerCase();
  const senderEmail = (email.senderEmail || '').toLowerCase();
  const subject = (email.subject || '').toLowerCase();
  const body = (email.bodyText || email.snippet || '').toLowerCase();

  // --- PROMOTIONAL / SERVICE EMAIL GUARD --- 
  // Prevent automated service/marketing emails from ever being escalated.
  const promotionalSenderDomains = [
    'accounts.google.com', 'no-reply@google.com', 'mail.google.com',
    'calendar-notification@google.com', 'calendar@google.com',
  ];
  const promotionalSenderKeywords = [
    'google', 'microsoft', 'apple', 'meta', 'facebook',
    'linkedin', 'instagram', 'twitter', 'youtube',
    'noreply', 'no-reply', 'notifications', 'do-not-reply', 'donotreply',
  ];
  const promotionalSubjectKeywords = [
    'finish setting up', 'complete your setup', 'get started with', 'welcome to',
    'your account is ready', 'tips for', 'try', 'unsubscribe',
    'special offer', 'discount', 'sale ends', 'limited time', 'deal',
  ];
  const isPromotionalDomain = promotionalSenderDomains.some((d) => senderEmail.includes(d));
  const isPromotionalSenderName = promotionalSenderKeywords.some((kw) => sender.includes(kw));
  const isPromotionalSubject = promotionalSubjectKeywords.some((kw) => subject.includes(kw));
  const hasUnsubscribe = body.includes('unsubscribe');

  // If it's a known service sender AND (domain match OR promotional subject OR unsubscribe link), cap it at LOW
  if (isPromotionalDomain || (isPromotionalSenderName && (isPromotionalSubject || hasUnsubscribe))) {
    if (analysis.importance === 'critical' || analysis.importance === 'high') {
      console.log(`🔒 Promo guard: capping "${email.subject}" from ${analysis.importance} → low (sender: "${email.senderName}")`);
    }
    return {
      ...analysis,
      importance: 'low',
      isUrgent: false,
    };
  }

  // Google Calendar automated notifications — keep as medium unless placement keyword
  const isGoogleCalendarSender =
    sender.includes('google calendar') ||
    senderEmail.includes('calendar-notification@google.com') ||
    senderEmail.includes('calendar@google.com');

  if (isGoogleCalendarSender) {
    // Only upgrade if the actual meeting/event is placement-related
    const hasPlacementKeyword = [
      'placement', 'internship', 'hackathon', 'interview', 'ppt', 'pod', 'drive', 't&p'
    ].some((kw) => subject.includes(kw));

    if (!hasPlacementKeyword) {
      if (analysis.importance === 'critical' || analysis.importance === 'high') {
        console.log(`🔒 Calendar guard: capping "${email.subject}" from ${analysis.importance} → medium`);
      }
      return { ...analysis, importance: 'medium', isUrgent: false };
    }
  }

  // --- CRITICAL sender names (exact or partial match) ---
  const criticalSenders = [
    'placement execution',
    'placement executive',
    'pod cell',
    'pod',
    't&p cell',
    'tp cell',
    'tpo',
    'placement cell',
    'training and placement',
    'training & placement',
    'placement office',
    'placement officer',
    'career services',
    'campus recruitment',
  ];

  const isCriticalSender = criticalSenders.some((kw) => sender.includes(kw));

  // --- CRITICAL subject keywords ---
  const criticalSubjectKeywords = [
    'reporting time',
    'test instructions',
    'you are eligible',
    'campus hiring',
    'register for the same',
    'shortlisted',
    'selected for',
    'offer letter',
    'placement drive',
    'drive result',
    'pod result',
    'campus placement',
    'interview schedule',
    'next round',
    'assessment link',
    'placement notification',
    'company visit',
    'pre-placement talk',
    'pre placement talk',
    'ppt —',
    'internship — you are eligible',
    'invitation for campus',
  ];

  const hasCriticalSubject = criticalSubjectKeywords.some((kw) => subject.includes(kw));

  // --- HIGH-importance sender domains (company recruiters) ---
  const companyDomains = [
    'rockwellautomation.com', 'godaddy.com', 'google.com', 'microsoft.com',
    'amazon.com', 'infosys.com', 'tcs.com', 'wipro.com', 'accenture.com',
    'cognizant.com', 'capgemini.com', 'deloitte.com', 'ibm.com',
  ];
  const isCompanyRecruiter = companyDomains.some((d) => senderEmail.endsWith(d));

  if (isCriticalSender || hasCriticalSubject) {
    const wasDowngraded = analysis.importance !== 'critical';
    if (wasDowngraded) {
      console.log(`🔄 Keyword override: upgrading "${email.subject}" from ${analysis.importance} → CRITICAL (sender: "${email.senderName}")`);
    }
    return {
      ...analysis,
      importance: 'critical',
      category: 'placement',
      isUrgent: true,
      needsHumanReply: true,
      suggestedReply: null,
      briefSummary: analysis.briefSummary || subject,
    };
  }

  if (isCompanyRecruiter && analysis.importance === 'other' || isCompanyRecruiter && analysis.importance === 'low') {
    console.log(`🔄 Keyword override: upgrading company recruiter email to HIGH`);
    return { ...analysis, importance: 'high', category: 'job_application' };
  }

  return analysis;
}

export default { analyzeEmail, analyzeEmails };
