import { Router } from 'express';
import db from '../db.js';
import logger from '../logger.js';
import { validate, createAlertRuleSchema, updateAlertRuleSchema } from '../validation.js';
import { jwtAuth } from '../middleware.js';
import { matchKeywords, matchPrice } from '../matchers.js';
import { sendNotification } from '../notifier.js';

const router = Router();

function getTier(userId) {
  const u = db.prepare('SELECT tier, is_premium FROM users WHERE id = ?').get(userId);
  if (!u) return 'free';
  return u.tier || (u.is_premium ? 'pro' : 'free');
}

const TIER_LIMITS = { free: 3, pro: -1 };
const TIER_FEATURES = {
  free: { priceFilters: false, minScore: false, customInterval: false, advancedNotify: false },
  pro: { priceFilters: true, minScore: true, customInterval: true, advancedNotify: true },
};

router.get('/', jwtAuth, (req, res) => {
  try {
    const rules = db.prepare('SELECT * FROM alert_rules WHERE user_id = ? ORDER BY created_at DESC').all(req.user.userId);
    res.json(rules);
  } catch (err) {
    logger.error('GET /alerts error', { error: err.message, userId: req.user?.userId });
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/', jwtAuth, validate(createAlertRuleSchema), (req, res) => {
  try {
    const data = req.validated;
    const tier = getTier(req.user.userId);
    const features = TIER_FEATURES[tier] || TIER_FEATURES.free;

    const limit = TIER_LIMITS[tier] || 3;
    const ruleCount = db.prepare('SELECT COUNT(*) as cnt FROM alert_rules WHERE user_id = ?').get(req.user.userId).cnt;
    if (limit > 0 && ruleCount >= limit) {
      return res.status(403).json({ error: `Free tier limit: ${limit} alert rules. Upgrade to Pro for unlimited.` });
    }

    if (!features.priceFilters && (data.min_price != null || data.max_price != null)) {
      return res.status(403).json({ error: 'Price filters require Pro.' });
    }
    if (!features.minScore && data.min_score != null) {
      return res.status(403).json({ error: 'Minimum deal score filter requires Pro.' });
    }
    if (!features.customInterval && data.scan_interval != null) {
      return res.status(403).json({ error: 'Custom scan interval requires Pro.' });
    }
    if (!features.advancedNotify && data.notify_type && data.notify_type !== 'email') {
      return res.status(403).json({ error: 'Non-email notifications require Pro.' });
    }

    const result = db.prepare(
      'INSERT INTO alert_rules (user_id, keywords, subreddit, min_price, max_price, min_score, scan_interval, notify_type, notify_target) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(req.user.userId, data.keywords, data.subreddit, data.min_price || null, data.max_price || null, data.min_score ?? null, data.scan_interval ?? null, data.notify_type, data.notify_target);

    const ruleId = result.lastInsertRowid;

    // Backfill — match against recent existing posts (last 24h)
    try {
      const subFilter = data.subreddit === 'all' ? "source = 'reddit'"
        : data.subreddit === 'craigslist' ? "source = 'craigslist'"
        : "category = ?";
      const subParams = data.subreddit !== 'all' && data.subreddit !== 'craigslist' ? [data.subreddit] : [];
      const posts = db.prepare(`SELECT * FROM scanned_posts WHERE ${subFilter} AND scanned_at > datetime('now', '-1 day') ORDER BY scanned_at DESC LIMIT 100`).all(...subParams);
      for (const post of posts) {
        const fullText = `${post.title} ${post.body || ''}`;
        const matched = matchKeywords(fullText, data.keywords);
        if (matched.length === 0) continue;
        if (!matchPrice(fullText, data.min_price, data.max_price)) continue;
        const existing = db.prepare('SELECT id FROM alert_matches WHERE alert_rule_id = ? AND post_id = ?').get(ruleId, post.post_id);
        if (existing) continue;
        db.prepare('INSERT INTO alert_matches (alert_rule_id, post_id, matched_keyword) VALUES (?, ?, ?)').run(ruleId, post.post_id, matched[0]);
        db.prepare("UPDATE alert_rules SET last_matched_at = datetime('now') WHERE id = ?").run(ruleId);
        sendNotification({
          user_id: req.user.userId,
          notify_type: data.notify_type,
          notify_target: data.notify_target,
        }, post, matched[0]).catch(err => logger.error('Backfill notification error', { error: err.message, ruleId }));
      }
    } catch (backfillErr) {
      logger.error('Rule backfill error', { error: backfillErr.message, ruleId });
    }

    const rule = db.prepare('SELECT * FROM alert_rules WHERE id = ?').get(ruleId);
    res.status(201).json(rule);
  } catch (err) {
    logger.error('POST /alerts error', { error: err.message, userId: req.user?.userId });
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id', jwtAuth, validate(updateAlertRuleSchema), (req, res) => {
  try {
    const rule = db.prepare('SELECT * FROM alert_rules WHERE id = ? AND user_id = ?').get(req.params.id, req.user.userId);
    if (!rule) return res.status(404).json({ error: 'Rule not found' });

    const data = req.validated;
    const tier = getTier(req.user.userId);
    const features = TIER_FEATURES[tier] || TIER_FEATURES.free;

    if (!features.priceFilters && (data.min_price != null || data.max_price != null)) {
      return res.status(403).json({ error: 'Price filters require Pro.' });
    }
    if (!features.advancedNotify && data.notify_type && data.notify_type !== 'email') {
      return res.status(403).json({ error: 'Non-email notifications require Pro.' });
    }

    const pauseUntil = data.pause_until || null;
    const isActiveVal = data.is_active !== undefined ? data.is_active : (pauseUntil ? 0 : null);
    db.prepare(`
      UPDATE alert_rules SET
        keywords = COALESCE(?, keywords),
        subreddit = COALESCE(?, subreddit),
        min_price = COALESCE(?, min_price),
        max_price = COALESCE(?, max_price),
        min_score = COALESCE(?, min_score),
        scan_interval = COALESCE(?, scan_interval),
        notify_type = COALESCE(?, notify_type),
        notify_target = COALESCE(?, notify_target),
        is_active = COALESCE(?, is_active),
        pause_until = COALESCE(?, pause_until)
      WHERE id = ?
    `).run(data.keywords || null, data.subreddit || null, data.min_price ?? null, data.max_price ?? null, data.min_score ?? null, data.scan_interval ?? null, data.notify_type || null, data.notify_target || null, isActiveVal, pauseUntil, req.params.id);

    const updated = db.prepare('SELECT * FROM alert_rules WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    logger.error('PUT /alerts error', { error: err.message, userId: req.user?.userId });
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id', jwtAuth, (req, res) => {
  try {
    const rule = db.prepare('SELECT id FROM alert_rules WHERE id = ? AND user_id = ?').get(req.params.id, req.user.userId);
    if (!rule) return res.status(404).json({ error: 'Rule not found' });
    db.prepare('DELETE FROM alert_matches WHERE alert_rule_id = ?').run(req.params.id);
    db.prepare('DELETE FROM alert_rules WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    logger.error('DELETE /alerts error', { error: err.message, userId: req.user?.userId });
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
