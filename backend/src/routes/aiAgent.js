import { Router } from 'express';
import jwt from 'jsonwebtoken';
import db from '../db.js';
import logger from '../logger.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET;
const OPENROUTER_API = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'openai/gpt-4o-mini';

function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(header.replace('Bearer ', ''), JWT_SECRET, { algorithms: ['HS256'] });
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function getApiKey() {
  return process.env.OPENROUTER_API_KEY || '';
}

async function llm(messages, maxTokens = 500) {
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
      body: JSON.stringify({ model: MODEL, messages, temperature: 0.2, max_tokens: maxTokens }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.choices?.[0]?.message?.content || null;
  } catch {
    return null;
  }
}

// 1. AI Chat — parse natural language into alert rule or respond conversationally
router.post('/chat', auth, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || typeof message !== 'string') return res.status(400).json({ error: 'Message required' });

    const user = db.prepare('SELECT is_premium FROM users WHERE id = ?').get(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const prompt = `You are MechAlert, an AI shopping assistant. The user wants to set up deal alerts. Analyze their message and return JSON.

User message: "${message}"

Rules:
- If they want to create an alert/watch for something, return { "action": "create_alert", "keywords": "comma-separated", "subreddit": "all", "min_price": null, "max_price": null, "response": "I'll watch for that!" }
- If they mention specific brands/models to AVOID, prepend "NOT " to those in keywords
- If they want to search existing deals, return { "action": "search", "query": "search text", "response": "Let me look..." }
- If they're just chatting, return { "action": "chat", "response": "conversational reply" }
- Extract price limits: "under $X" → max_price, "over $X" → min_price, "between $X and $Y" → both
- Determine source: "reddit", "ebay", "facebook", "craigslist", "offerup", "slickdeals", or "all"

Return JSON only. Examples:
- "Find me Gaming laptop RTX 4070 under $900 good battery avoid Acer prefer Lenovo" → { "action": "create_alert", "keywords": "gaming laptop, RTX 4070, good battery, Lenovo, NOT Acer", "subreddit": "all", "min_price": null, "max_price": 900, "response": "I'll watch for gaming laptops with RTX 4070 under $900, avoiding Acer." }
- "I want a mirrorless camera for travel" → { "action": "expand_keywords", "category": "mirrorless camera for travel", "response": "Let me find the best mirrorless cameras for travel..." }`;

    const content = await llm([
      { role: 'system', content: 'You are a helpful shopping assistant. Return only valid JSON.' },
      { role: 'user', content: prompt },
    ]);

    if (!content) return res.json({ action: 'chat', response: 'AI is not configured. Set OPENROUTER_API_KEY to enable.' });

    const parsed = JSON.parse(content.replace(/```json|```/g, '').trim());

    if (parsed.action === 'create_alert') {
      const ruleCount = db.prepare('SELECT COUNT(*) as cnt FROM alert_rules WHERE user_id = ? AND deleted_at IS NULL').get(req.user.userId).cnt;
      if (!user.is_premium && ruleCount >= 3) {
        return res.json({ action: 'chat', response: 'You\'ve reached the Free tier limit of 3 rules. Upgrade to Pro to add more!' });
      }
      // Estimate weekly match volume (rough: count similar keyword matches in last 30 days)
      const estimate = db.prepare(`
        SELECT COUNT(*) as c FROM alert_matches am
        JOIN alert_rules ar ON am.alert_rule_id = ar.id
        WHERE ar.user_id = ? AND am.sent_at >= datetime('now', '-30 days')
      `).get(req.user.userId).c;
      const weeklyEstimate = Math.max(1, Math.round(estimate / 4.3));

      parsed.preview = {
        keywords: parsed.keywords,
        source: parsed.subreddit || 'all',
        min_price: parsed.min_price,
        max_price: parsed.max_price,
        estimatedWeekly: weeklyEstimate,
      };

      // If user said "preview" or "show me", don't save yet
      const previewOnly = /preview|show me|what would|before (saving|creating)/i.test(req.body.message);
      if (previewOnly) {
        parsed.action = 'search_preview';
        return res.json(parsed);
      }

      db.prepare(
        'INSERT INTO alert_rules (user_id, keywords, subreddit, min_price, max_price, notify_type, notify_target) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(req.user.userId, parsed.keywords, parsed.subreddit || 'all', parsed.min_price || null, parsed.max_price || null, 'email', req.user.email || '');
      logger.info(`AI Chat created alert for user ${req.user.userId}: ${parsed.keywords}`);
    }

    if (parsed.action === 'expand_keywords') {
      const expansionPrompt = `The user is looking for: "${parsed.category}". Generate 5-8 specific popular models/products for this category. Return JSON: { "keywords": ["model1", "model2", ...], "response": "I'll search for these..." }`;
      const expansion = await llm([
        { role: 'system', content: 'You are a product expert. Return only valid JSON.' },
        { role: 'user', content: expansionPrompt },
      ], 400);
      if (expansion) {
        const expanded = JSON.parse(expansion.replace(/```json|```/g, '').trim());
        parsed.expandedKeywords = expanded.keywords || [];
        parsed.response = expanded.response || `I'll watch for ${(expanded.keywords || []).slice(0, 3).join(', ')} and more.`;
      }
    }

    res.json(parsed);
  } catch (err) {
    logger.error('AI Chat error', { error: err.message, userId: req.user?.userId });
    res.status(500).json({ error: 'AI chat error' });
  }
});

// 2. Auto-generate keywords from category description
router.post('/auto-keywords', auth, async (req, res) => {
  try {
    const { category } = req.body;
    if (!category) return res.status(400).json({ error: 'Category required' });

    const prompt = `The user wants to find: "${category}". Generate 6-10 specific popular models, products, or search terms for this category. Return JSON only: { "keywords": ["term1", "term2", ...], "category": "short category name" }`;
    const content = await llm([
      { role: 'system', content: 'You are a product expert. Return only valid JSON.' },
      { role: 'user', content: prompt },
    ], 400);

    if (!content) return res.json({ keywords: [category], category });

    const parsed = JSON.parse(content.replace(/```json|```/g, '').trim());
    res.json({ keywords: parsed.keywords || [category], category: parsed.category || category });
  } catch (err) {
    logger.error('Auto-keywords error', { error: err.message });
    res.status(500).json({ error: 'Auto-keywords error' });
  }
});

// 4. AI Negotiation — generate polite message for a listing
router.post('/negotiate', auth, async (req, res) => {
  try {
    const { title, price, permalink } = req.body;
    if (!title || !price) return res.status(400).json({ error: 'Title and price required' });

    const prompt = `You are helping a buyer negotiate. Generate a polite, friendly negotiation message for this item:
Title: "${title}"
Price: $${price}

The message should:
- Be polite and friendly
- Suggest a reasonable lower price (10-20% below asking)
- Offer flexibility (pickup, timing)
- Be 2-3 sentences max

Return JSON only: { "message": "negotiation text", "suggestedPrice": number }`;
    const content = await llm([
      { role: 'system', content: 'You are a polite negotiator. Return only valid JSON.' },
      { role: 'user', content: prompt },
    ], 300);

    if (!content) {
      const suggested = Math.round(price * 0.85);
      return res.json({ message: `Hi! Would you consider $${suggested} if I can pick it up soon?`, suggestedPrice: suggested });
    }

    const parsed = JSON.parse(content.replace(/```json|```/g, '').trim());
    res.json({ message: parsed.message, suggestedPrice: parsed.suggestedPrice || Math.round(price * 0.85) });
  } catch (err) {
    logger.error('Negotiate error', { error: err.message });
    res.status(500).json({ error: 'Negotiate error' });
  }
});

// 7. Flip analysis
router.get('/flip-analysis/:postId', auth, async (req, res) => {
  try {
    const post = db.prepare('SELECT * FROM scanned_posts WHERE post_id = ?').get(req.params.postId);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const categoryAvg = db.prepare('SELECT AVG(price) as avg FROM scanned_posts WHERE source = ? AND price IS NOT NULL AND price > 0').get(post.source);
    const marketAvg = categoryAvg?.avg || post.price * 1.15;

    const estimatedResale = marketAvg * (post.source === 'craigslist' || post.source === 'facebook' ? 1.3 : 1.2);
    const profit = estimatedResale - post.price;
    const profitMargin = post.price > 0 ? ((profit / post.price) * 100).toFixed(0) : 0;
    const risk = profitMargin > 30 ? 'Low' : profitMargin > 10 ? 'Medium' : 'High';

    const prompt = post.price ? `Analyze flip potential: "${post.title}" at $${post.price}. Market avg ~$${Math.round(marketAvg)}. Return JSON: { "summary": "1 sentence", "riskFactors": ["factor"] }` : '';
    let aiSummary = null;
    let riskFactors = [];
    if (prompt && getApiKey()) {
      const content = await llm([
        { role: 'system', content: 'Return only valid JSON.' },
        { role: 'user', content: prompt },
      ], 200);
      if (content) {
        try {
          const parsed = JSON.parse(content.replace(/```json|```/g, '').trim());
          aiSummary = parsed.summary;
          riskFactors = parsed.riskFactors || [];
        } catch { /* ignore */ }
      }
    }

    res.json({
      buyPrice: post.price,
      estimatedResale: Math.round(estimatedResale),
      profit: Math.round(profit),
      profitMargin: parseInt(profitMargin),
      risk,
      aiSummary,
      riskFactors,
    });
  } catch (err) {
    logger.error('Flip analysis error', { error: err.message });
    res.status(500).json({ error: 'Flip analysis error' });
  }
});

export default router;
