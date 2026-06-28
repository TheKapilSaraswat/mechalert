import { Router } from 'express';
import db from '../db.js';
import { sendNotification } from '../notifier.js';
import { matchKeywords, matchPrice, extractPrice } from '../matchers.js';
import { scoreDeal } from '../aiScorer.js';
import logger from '../logger.js';
import { validate, webhookPostSchema } from '../validation.js';

const router = Router();
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

function webhookAuth(req, res, next) {
  if (!WEBHOOK_SECRET) return next();
  const secret = req.headers['x-webhook-secret'];
  if (!secret) return res.status(401).json({ error: 'Missing webhook secret' });
  if (secret !== WEBHOOK_SECRET) return res.status(401).json({ error: 'Invalid webhook secret' });
  next();
}

router.post('/post', webhookAuth, validate(webhookPostSchema), async (req, res) => {
  const { id, title, body, price, permalink, subreddit, source } = req.validated;
  const fullText = `${title} ${body || ''}`;
  const extractedPrice = price || extractPrice(fullText);

  try {
    const insertPost = db.prepare(
      'INSERT OR IGNORE INTO scanned_posts (post_id, title, body, price, permalink, source, category, image_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const insertResult = insertPost.run(id, title, body || '', extractedPrice, permalink, source || 'reddit', subreddit || null, null);
    if (insertResult.changes === 0) return res.json({ ok: true, new: false });

    if (extractedPrice) {
      db.prepare('INSERT INTO price_history (post_id, price) VALUES (?, ?)').run(id, extractedPrice);
    }

    const aiScore = await scoreDeal(title, body, extractedPrice);
    if (aiScore) {
      db.prepare('UPDATE scanned_posts SET deal_score = ? WHERE post_id = ?').run(aiScore.score, id);
    }

    const rules = db.prepare(
      'SELECT ar.*, u.email FROM alert_rules ar JOIN users u ON ar.user_id = u.id WHERE ar.is_active = 1 AND (ar.subreddit = ? OR ar.subreddit = \'all\')'
    ).all(subreddit || 'mechmarket');

    for (const rule of rules) {
      const matchedKeywords = matchKeywords(fullText, rule.keywords);
      if (matchedKeywords.length === 0) continue;
      if (!matchPrice(fullText, rule.min_price, rule.max_price)) continue;

      db.prepare(
        'INSERT INTO alert_matches (alert_rule_id, post_id, matched_keyword) VALUES (?, ?, ?)'
      ).run(rule.id, id, matchedKeywords[0]);

      await sendNotification(rule, { title, permalink, selftext: body || '' }, matchedKeywords[0]);
    }

    res.json({ ok: true, new: true, aiScore });
  } catch (err) {
    logger.error('Webhook error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

export default router;