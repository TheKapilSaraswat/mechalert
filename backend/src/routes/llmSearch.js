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
  function cur() { return '(?:[$€£]|\\b[a-z]{3}\\b\\s+)?'; }
  function mkMaxRe() { return new RegExp('(?:under|below|less than|<|max|up to|at most|budget)\\s*' + cur() + '\\s*(\\d+)', 'i'); }
  function mkMinRe() { return new RegExp('(?:over|above|more than|>|min|at least|starting at)\\s*' + cur() + '\\s*(\\d+)', 'i'); }
  function mkRangeRe() { return new RegExp(cur() + '\\s*(\\d+)\\s*(?:-|to|–)\\s*' + cur() + '\\s*(\\d+)'); }

  const maxMatch = lower.match(mkMaxRe());
  if (maxMatch) filters.max_price = parseFloat(maxMatch[1]);

  const minMatch = lower.match(mkMinRe());
  if (minMatch) filters.min_price = parseFloat(minMatch[1]);

  const rangeMatch = lower.match(mkRangeRe());
  if (rangeMatch) {
    filters.min_price = parseFloat(rangeMatch[1]);
    filters.max_price = parseFloat(rangeMatch[2]);
  }

  const betweenMatch = lower.match(/between\s*(?:[$€£])?\s*(\d+)\s*and\s*(?:[$€£])?\s*(\d+)/i);
  if (betweenMatch) {
    filters.min_price = parseFloat(betweenMatch[1]);
    filters.max_price = parseFloat(betweenMatch[2]);
  }

  const suffixMatch = lower.match(/(\d+)\s*(?:\bor\b\s+less\b|\band\b\s+under\b|\bor\b\s+lower\b|\band\b\s+below\b)(?!\s*\d)/i);
  if (suffixMatch) filters.max_price = parseFloat(suffixMatch[1]);

  const sourceMatch = lower.match(/\b(?:on|from)\s+(reddit|craigslist)\b/i);
  if (sourceMatch) filters.source = sourceMatch[1].toLowerCase();

  function curG() { return '(?:[$€£]\\s*|\\b[a-z]{3}\\b\\s+)?'; }

  let kw = query
    .replace(new RegExp('(?:under|below|less than|<|max|up to|at most|budget)\\s*' + curG() + '\\d+', 'gi'), '')
    .replace(new RegExp('(?:over|above|more than|>|min|at least|starting at)\\s*' + curG() + '\\d+', 'gi'), '')
    .replace(new RegExp(curG() + '\\d+\\s*(?:-|to|–)\\s*' + curG() + '\\d+', 'g'), '')
    .replace(/between\s*(?:[$€£])?\s*\d+\s*and\s*(?:[$€£])?\s*\d+/gi, '')
    .replace(/\d+\s*(?:\bor\b\s+less\b|\band\b\s+under\b|\bor\b\s+lower\b|\band\b\s+below\b)(?!\s*\d)/gi, '')
    .replace(/\b(?:on|from)\s+(?:reddit|craigslist)\b/gi, '')
    .replace(/[$€£][\d.,]+/g, '')
    .replace(/\b(?:under|below|less than|over|above|more than|max|min|up to|at most|at least|budget|starting|cheap|cheapest|best|deal|deals|find|search|show|me|for|or|and|the|a|an|in|of|to|with|on|less)\b/gi, '')
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

export { basicParse };
export default router;