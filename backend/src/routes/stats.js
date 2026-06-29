import { Router } from 'express';
import db from '../db.js';
import logger from '../logger.js';
import { jwtAuth } from '../middleware.js';

const router = Router();

router.get('/', jwtAuth, (req, res) => {
  try {
    const userId = req.user.userId;
    const u = db.prepare('SELECT tier, is_premium FROM users WHERE id = ?').get(userId);
    const tier = u?.tier || (u?.is_premium ? 'pro' : 'free');

    const totalListings = db.prepare('SELECT COUNT(*) as c FROM scanned_posts').get().c;
    const watchedListings = db.prepare('SELECT COUNT(*) as c FROM scanned_posts WHERE post_id IN (SELECT post_id FROM saved_deals WHERE user_id = ?)').get(userId).c;
    const matchesFound = db.prepare('SELECT COUNT(*) as c FROM alert_matches am JOIN alert_rules ar ON am.alert_rule_id = ar.id WHERE ar.user_id = ?').get(userId).c;
    const rulesActive = db.prepare('SELECT COUNT(*) as c FROM alert_rules WHERE user_id = ? AND is_active = 1 AND deleted_at IS NULL').get(userId).c;
    const savedDeals = db.prepare('SELECT COUNT(*) as c FROM saved_deals WHERE user_id = ?').get(userId).c;
    const searchesDone = db.prepare('SELECT COUNT(*) as c FROM deal_search_history WHERE user_id = ?').get(userId).c;
    const totalSaved = db.prepare("SELECT COALESCE(SUM(sp.price - COALESCE(sp.market_value, sp.price)), 0) as savings FROM saved_deals sd JOIN scanned_posts sp ON sd.post_id = sp.post_id WHERE sd.user_id = ? AND sp.market_value IS NOT NULL AND sp.market_value > sp.price").get(userId).savings;
    const rareFinds = db.prepare("SELECT COUNT(*) as c FROM saved_deals sd JOIN scanned_posts sp ON sd.post_id = sp.post_id WHERE sd.user_id = ? AND sp.deal_score >= 80").get(userId).c;
    const priceDrops = db.prepare('SELECT COUNT(*) as c FROM price_drop_alerts WHERE user_id = ?').get(userId).c;
    const notificationsSent = db.prepare('SELECT COUNT(*) as c FROM notification_log WHERE user_id = ?').get(userId).c;

    const recentDrops = db.prepare(`
      SELECT pda.*, sp.title FROM price_drop_alerts pda
      JOIN scanned_posts sp ON pda.post_id = sp.post_id
      WHERE pda.user_id = ? ORDER BY pda.created_at DESC LIMIT 5
    `).all(userId);

    const bySource = db.prepare(`
      SELECT sp.source, COUNT(*) as c FROM saved_deals sd
      JOIN scanned_posts sp ON sd.post_id = sp.post_id
      WHERE sd.user_id = ? GROUP BY sp.source
    `).all(userId);

    res.json({
      tier,
      totalListings,
      watchedListings,
      matchesFound,
      rulesActive,
      savedDeals,
      searchesDone,
      totalSavings: Math.round(totalSaved),
      rareFinds,
      priceDrops,
      notificationsSent,
      recentDrops,
      bySource,
    });
  } catch (err) {
    logger.error('GET /stats error', { error: err.message, userId: req.user?.userId });
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/insights', jwtAuth, (req, res) => {
  try {
    const userId = req.user.userId;
    const u = db.prepare('SELECT tier, is_premium FROM users WHERE id = ?').get(userId);
    const tier = u?.tier || (u?.is_premium ? 'pro' : 'free');
    if (tier === 'free') return res.status(403).json({ error: 'Daily insights require Pro.' });

    const bestDeal = db.prepare(`
      SELECT sp.title, sp.price, sp.market_value, sp.deal_score, sp.permalink, sp.ai_explanation
      FROM scanned_posts sp
      WHERE sp.deal_score IS NOT NULL AND sp.price IS NOT NULL AND sp.market_value IS NOT NULL
      ORDER BY (sp.market_value - sp.price) DESC LIMIT 1
    `).get();

    const trending = db.prepare(`
      SELECT sp.title, sp.price, sp.permalink, sp.deal_score FROM scanned_posts sp
      WHERE sp.scanned_at >= datetime('now', '-1 day') AND sp.deal_score >= 70
      ORDER BY sp.deal_score DESC LIMIT 5
    `).all();

    const cheapestBySource = db.prepare(`
      SELECT source, MIN(price) as min_price, COUNT(*) as count FROM scanned_posts
      WHERE price IS NOT NULL AND scanned_at >= datetime('now', '-1 day')
      GROUP BY source
    `).all();

    const topSeller = db.prepare(`
      SELECT source, COUNT(*) as posts FROM scanned_posts
      WHERE scanned_at >= datetime('now', '-1 day')
      GROUP BY source ORDER BY posts DESC LIMIT 1
    `).get();

    const yourStats = db.prepare("SELECT COUNT(*) as saved FROM saved_deals WHERE user_id = ? AND created_at >= datetime('now', '-1 day')").get(userId).saved;

    res.json({
      date: new Date().toISOString().split('T')[0],
      bestDeal,
      trending,
      cheapestBySource,
      topSeller,
      yourActivity: { savedToday: yourStats },
    });
  } catch (err) {
    logger.error('GET /stats/insights error', { error: err.message });
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
