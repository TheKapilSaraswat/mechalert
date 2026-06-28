import logger from './logger.js';

const OPENROUTER_API = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'openai/gpt-4o-mini';

function getApiKey() {
  return process.env.OPENROUTER_API_KEY || '';
}

function buildPrompt(title, body, price) {
  return `You are a deal quality scorer for a hardware/mechanical keyboard deal alert system. Analyze this listing and return JSON only.

Listing: "${title}"
${body ? `Details: ${body.substring(0, 500)}` : ''}
${price ? `Listed Price: $${price}` : ''}

Return this exact JSON format:
{
  "score": number 0-100 (deal quality),
  "reasoning": "string (why this is or isn't a good deal)",
  "market_value": number or null (estimated fair market price),
  "scam_signals": ["list of red flags or empty array"],
  "scam_risk": "low"|"medium"|"high"
}

Score guidelines:
- 90-100: Exceptional deal, significantly below market value
- 70-89: Good deal, fair pricing
- 50-69: Average market price
- 30-49: Overpriced or unclear value
- 0-29: Likely scam, spam, or not a real listing

For market_value: estimate what this item typically sells for second-hand. Be realistic.
For scam_signals: flag suspicious wording, unrealistic pricing, new accounts, payment red flags.
For scam_risk: "low" = legitimate, "medium" = some concerns, "high" = likely fraudulent.`;
}

export async function scoreDeal(title, body, price) {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  try {
    const res = await fetch(OPENROUTER_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://mechalert.app',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: buildPrompt(title, body, price) }],
        temperature: 0.1,
        max_tokens: 400,
      }),
    });

    if (!res.ok) {
      logger.error('AI scoring API error', { status: res.status });
      return null;
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content.replace(/```json|```/g, '').trim());
    return {
      score: Math.max(0, Math.min(100, parsed.score || 50)),
      reasoning: parsed.reasoning || '',
      market_value: parsed.market_value != null ? parsed.market_value : null,
      scam_signals: Array.isArray(parsed.scam_signals) ? parsed.scam_signals : [],
      scam_risk: parsed.scam_risk || 'low',
    };
  } catch (err) {
    logger.error('AI scoring error', { error: err.message });
    return null;
  }
}
