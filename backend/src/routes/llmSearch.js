import { Router } from 'express';
import db from '../db.js';
import logger from '../logger.js';
import { validate, searchQuerySchema } from '../validation.js';
import { jwtAuth } from '../middleware.js';

const router = Router();
const OPENROUTER_API = 'https://openrouter.ai/api/v1/chat/completions';

function getApiKey() {
  return process.env.OPENROUTER_API_KEY || '';
}

async function parseQuery(naturalQuery) {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  const prompt = `Parse this deal search query into structured filters. Return JSON only.
Query: "${naturalQuery}"

Possible fields: keywords (string), min_price (number or null), max_price (number or null), source (string or null: reddit/craigslist), category (string or null), sort (string: newest/cheapest/best_score), limit (number, max 50).

Examples:
- "mechanical keyboard under $200" → {"keywords":"mechanical keyboard","max_price":200}
- "keyboard on craigslist" → {"keywords":"keyboard","source":"craigslist","sort":"cheapest"}
- "best deals in photomarket" → {"keywords":"","source":"reddit","category":"photomarket","sort":"best_score"}

Return JSON only.`;

  try {
    const res = await fetch(OPENROUTER_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://mechalert.app',
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 300,
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;

    return JSON.parse(content.replace(/```json|```/g, '').trim());
  } catch (err) {
    logger.error('LLM parse error', { error: err.message });
    return null;
  }
}

function basicParse(query) {
  const filters = {};
  const lower = query.toLowerCase().trim();

  const maxMatch = lower.match(/(?:under|below|less than|<|max|up to|at most|budget)\s*\$?\s*(\d+)/i);
  if (maxMatch) filters.max_price = parseFloat(maxMatch[1]);

  const minMatch = lower.match(/(?:over|above|more than|>|min|at least|starting at)\s*\$?\s*(\d+)/i);
  if (minMatch) filters.min_price = parseFloat(minMatch[1]);

  const rangeMatch = lower.match(/\$?(\d+)\s*(?:-|to|–)\s*\$?(\d+)/);
  if (rangeMatch) {
    filters.min_price = parseFloat(rangeMatch[1]);
    filters.max_price = parseFloat(rangeMatch[2]);
  }

  const sourceMatch = lower.match(/\b(?:on|from)\s+(reddit|craigslist)\b/i);
  if (sourceMatch) filters.source = sourceMatch[1].toLowerCase();

  let kw = query
    .replace(/(?:under|below|less than|<|max|up to|at most|budget)\s*\$?\s*\d+/gi, '')
    .replace(/(?:over|above|more than|>|min|at least|starting at)\s*\$?\s*\d+/gi, '')
    .replace(/\$?\d+\s*(?:-|to|–)\s*\$?\d+/g, '')
    .replace(/\b(?:on|from)\s+(?:reddit|craigslist)\b/gi, '')
    .replace(/\$[\d.,]+/g, '')
    .replace(/\b(?:under|below|less than|over|above|more than|max|min|up to|at most|at least|budget|starting|cheap|cheapest|best|deal|deals|find|search|show|me|for|and|the|a|an|in|of|to|with)\b/gi, '')
    .replace(/[<>]/g, '')
    .trim();

  if (kw) filters.keywords = kw;

  return filters;
}

function buildQuery(filters) {
  const conditions = [];
  const params = [];

  if (filters.keywords) {
    conditions.push('(sp.title LIKE ? OR sp.body LIKE ?)');
    params.push(`%${filters.keywords}%`, `%${filters.keywords}%`);
  }

  if (filters.min_price) {
    conditions.push('sp.price >= ?');
    params.push(filters.min_price);
  }

  if (filters.max_price) {
    conditions.push('sp.price <= ?');
    params.push(filters.max_price);
  }

  if (filters.source) {
    conditions.push('sp.source = ?');
    params.push(filters.source);
  }

  if (filters.category) {
    conditions.push('sp.category = ?');
    params.push(filters.category);
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const order = filters.sort === 'cheapest' ? 'sp.price ASC'
    : filters.sort === 'best_score' ? 'sp.deal_score DESC NULLS LAST'
    : 'sp.scanned_at DESC';
  const limit = Math.min(filters.limit || 20, 50);

  return db.prepare(`
    SELECT sp.* FROM scanned_posts sp
    ${where}
    ORDER BY ${order}
    LIMIT ?
  `).all(...params, limit);
}

router.post('/', jwtAuth, validate(searchQuerySchema), async (req, res) => {
  try {
    const { query } = req.validated;

    db.prepare('INSERT INTO deal_search_history (user_id, query) VALUES (?, ?)').run(req.user.userId, query);

    if (query.length < 3) {
      const results = db.prepare(
        'SELECT sp.* FROM scanned_posts sp ORDER BY sp.scanned_at DESC LIMIT 20'
      ).all();
      return res.json({ query, filters: { keywords: query }, results, interpreted: false });
    }

    let filters = await parseQuery(query);
    if (!filters || !filters.keywords) {
      filters = basicParse(query);
    }

    const results = buildQuery(filters);
    db.prepare('UPDATE deal_search_history SET results_count = ? WHERE user_id = ? AND query = ? AND searched_at >= datetime(\'now\', \'-1 minute\')')
      .run(results.length, req.user.userId, query);

    res.json({ query, filters, results, interpreted: true });
  } catch (err) {
    logger.error('LLM search error', { error: err.message, userId: req.user?.userId });
    res.status(500).json({ error: 'Search failed' });
  }
});

export default router;