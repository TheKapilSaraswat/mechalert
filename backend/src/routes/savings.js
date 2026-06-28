import { Router } from 'express';
import jwt from 'jsonwebtoken';
import db from '../db.js';
import logger from '../logger.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET;

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

router.get('/', auth, (req, res) => {
  try {
    const userId = req.user.userId;
    const dealsFound = db.prepare('SELECT COUNT(*) as c FROM saved_deals WHERE user_id = ?').get(userId).c;
    const dealsPurchased = db.prepare('SELECT COUNT(*) as c FROM saved_deals WHERE user_id = ? AND purchased = 1').get(userId).c;
    const totalSavings = db.prepare('SELECT COALESCE(SUM(savings_amount), 0) as s FROM saved_deals WHERE user_id = ? AND purchased = 1').get(userId).s;
    const bestDeal = db.prepare(`
      SELECT sd.savings_amount, sp.title, sp.permalink, sp.source
      FROM saved_deals sd
      JOIN scanned_posts sp ON sd.post_id = sp.post_id
      WHERE sd.user_id = ? AND sd.purchased = 1 AND sd.savings_amount IS NOT NULL
      ORDER BY sd.savings_amount DESC
      LIMIT 1
    `).get(userId);
    const successStory = db.prepare(`
      SELECT sd.savings_amount, sp.title, sp.price, sp.permalink, sp.source, sp.deal_score,
             sp.scanned_at, sd.purchased_at
      FROM saved_deals sd
      JOIN scanned_posts sp ON sd.post_id = sp.post_id
      WHERE sd.user_id = ? AND sd.purchased = 1
      ORDER BY sd.savings_amount DESC
      LIMIT 3
    `).all(userId);
    res.json({
      dealsFound, dealsPurchased, totalSavings: Math.round(totalSavings * 100) / 100, bestDeal: bestDeal || null,
      successStories: successStory.map(s => ({
        title: s.title, price: s.price, savings: s.savings_amount,
        marketValue: s.price ? Math.round(s.price + (s.savings_amount || 0)) : null,
        permalink: s.permalink, source: s.source, dealScore: s.deal_score,
        foundAt: s.scanned_at, purchasedAt: s.purchased_at,
      })),
    });
  } catch (err) {
    logger.error('GET /savings error', { error: err.message, userId: req.user?.userId });
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/mark-purchased/:id', auth, (req, res) => {
  try {
    const { savings_amount, archive_rule } = req.body;
    if (savings_amount !== undefined && (typeof savings_amount !== 'number' || savings_amount < 0)) {
      return res.status(400).json({ error: 'savings_amount must be a non-negative number' });
    }
    const deal = db.prepare(`
      SELECT sd.*, (SELECT am.alert_rule_id FROM alert_matches am WHERE am.post_id = sd.post_id AND am.alert_rule_id IN (SELECT id FROM alert_rules WHERE user_id = ?) LIMIT 1) as alert_rule_id
      FROM saved_deals sd WHERE sd.id = ? AND sd.user_id = ?
    `).get(req.user.userId, req.params.id, req.user.userId);
    if (!deal) return res.status(404).json({ error: 'Saved deal not found' });

    db.prepare("UPDATE saved_deals SET purchased = 1, savings_amount = ?, purchased_at = datetime('now') WHERE id = ?")
      .run(savings_amount ?? null, req.params.id);

    // Optionally archive the related alert rule (stop notifications)
    if (archive_rule && deal.alert_rule_id) {
      db.prepare("UPDATE alert_rules SET is_active = 0, archived_at = datetime('now') WHERE id = ?").run(deal.alert_rule_id);
    }

    res.json({ ok: true });
  } catch (err) {
    logger.error('POST /savings/mark-purchased error', { error: err.message, userId: req.user?.userId });
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
