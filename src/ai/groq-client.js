import Groq from 'groq-sdk';

let groqInstance = null;

/**
 * Get or create Groq client singleton.
 */
export function getGroqClient() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('GROQ_API_KEY is not configured in .env');
  }

  if (!groqInstance) {
    groqInstance = new Groq({ apiKey });
  }

  return groqInstance;
}

/**
 * Analyze an email using Groq with structured JSON output mode.
 * Tries fast models available in your Groq account (openai/gpt-oss-20b, qwen/qwen3.8-27b).
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @returns {Promise<object>}
 */
export async function analyzeWithGroq(systemPrompt, userPrompt) {
  const client = getGroqClient();
  const modelsToTry = [
    'openai/gpt-oss-20b',
    'qwen/qwen3.8-27b',
    'openai/gpt-oss-120b',
  ];

  let lastError = null;

  for (const model of modelsToTry) {
    try {
      const completion = await client.chat.completions.create({
        messages: [
          {
            role: 'system',
            content: `${systemPrompt}\n\nIMPORTANT: You must respond in valid JSON matching the exact schema specified. Do not include markdown formatting or backticks. Output valid JSON only.`,
          },
          {
            role: 'user',
            content: userPrompt,
          },
        ],
        model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
      });

      const content = completion.choices[0]?.message?.content;
      if (!content) {
        throw new Error(`Empty response received from Groq model ${model}`);
      }

      return JSON.parse(content);
    } catch (err) {
      lastError = err;
      // If error is model not found or rate limit, try next available model
      console.warn(`⚠️ Groq model ${model} failed: ${err.message}. Trying next model...`);
    }
  }

  throw lastError || new Error('All Groq models failed');
}

export default { getGroqClient, analyzeWithGroq };
