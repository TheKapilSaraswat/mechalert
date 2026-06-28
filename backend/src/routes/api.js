import { Router } from 'express';
import crypto from 'crypto';
import db from '../db.js';
import logger from '../logger.js';
import { jwtAuth } from '../middleware.js';

const router = Router();

const rateLimitStore = new Map();

function apiKeyRateLimit(req, res, next) {
  const key = req.apiKey || req.ip;
  const now = Date.now();
  const windowMs = 60000;
  const max = 100;
  if (!rateLimitStore.has(key)) {
    rateLimitStore.set(key, { count: 1, start: now });
    return next();
  }
  const entry = rateLimitStore.get(key);
  if (now - entry.start > windowMs) {
    rateLimitStore.set(key, { count: 1, start: now });
    return next();
  }
  entry.count++;
  if (entry.count > max) {
    return res.status(429).json({ error: 'Too many requests. Rate limit: 100 req/min.' });
  }
  next();
}

router.get('/settings/api-key', jwtAuth, (req, res) => {
  try {
    const user = db.prepare('SELECT is_premium, api_key FROM users WHERE id = ?').get(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.is_premium) return res.status(403).json({ error: 'Only premium users can generate API keys' });
    if (user.api_key) {
      return res.json({ api_key: user.api_key });
    }
    const apiKey = crypto.randomBytes(32).toString('hex');
    db.prepare('UPDATE users SET api_key = ? WHERE id = ?').run(apiKey, req.user.userId);
    res.json({ api_key: apiKey });
  } catch (err) {
    logger.error('GET /settings/api-key error', { error: err.message, userId: req.user?.userId });
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/v1/matches', apiKeyRateLimit, (req, res) => {
  try {
    const apiKey = req.query.api_key || req.headers['x-api-key'];
    if (!apiKey) return res.status(401).json({ error: 'API key required' });
    const user = db.prepare('SELECT id, is_premium FROM users WHERE api_key = ?').get(apiKey);
    if (!user) return res.status(401).json({ error: 'Invalid API key' });
    if (!user.is_premium) return res.status(401).json({ error: 'Premium account required' });
    req.apiKey = `user_${user.id}`;
    const matches = db.prepare(`
      SELECT am.*, sp.title, sp.price, sp.permalink, sp.deal_score, sp.source, ar.keywords
      FROM alert_matches am
      JOIN scanned_posts sp ON am.post_id = sp.post_id
      JOIN alert_rules ar ON am.alert_rule_id = ar.id
      WHERE ar.user_id = ?
      ORDER BY am.sent_at DESC
      LIMIT 50
    `).all(user.id);
    res.set('Cache-Control', 'public, max-age=60');
    res.json(matches);
  } catch (err) {
    logger.error('GET /v1/matches error', { error: err.message });
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
