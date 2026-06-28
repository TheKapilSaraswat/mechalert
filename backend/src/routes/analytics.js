import { Router } from 'express';
import db from '../db.js';
import logger from '../logger.js';

const router = Router();

router.get('/price-history/:postId', (req, res) => {
  try {
    const history = db.prepare(
      'SELECT price, recorded_at FROM price_history WHERE post_id = ? ORDER BY recorded_at ASC'
    ).all(req.params.postId);
    res.json(history);
  } catch (err) {
    logger.error('GET /analytics/price-history error', { error: err.message });
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/price-trends', (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const category = req.query.category || null;

    let query;
    let params;
    if (category) {
      query = `
        SELECT date(recorded_at) as day, AVG(price) as avg_price, MIN(price) as min_price, MAX(price) as max_price, COUNT(*) as samples
        FROM price_history ph
        JOIN scanned_posts sp ON ph.post_id = sp.post_id
        WHERE sp.category = ? AND ph.recorded_at >= datetime('now', ?)
        GROUP BY day ORDER BY day ASC
      `;
      params = [category, `-${days} days`];
    } else {
      query = `
        SELECT date(recorded_at) as day, AVG(price) as avg_price, MIN(price) as min_price, MAX(price) as max_price, COUNT(*) as samples
        FROM price_history
        WHERE recorded_at >= datetime('now', ?)
        GROUP BY day ORDER BY day ASC
      `;
      params = [`-${days} days`];
    }

    const trends = db.prepare(query).all(...params);
    res.json(trends);
  } catch (err) {
    logger.error('GET /analytics/price-trends error', { error: err.message });
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/deal-distribution', (req, res) => {
  try {
    const bySource = db.prepare('SELECT source, COUNT(*) as c FROM scanned_posts GROUP BY source ORDER BY c DESC').all();
    const byCategory = db.prepare('SELECT category, COUNT(*) as c FROM scanned_posts WHERE category IS NOT NULL GROUP BY category ORDER BY c DESC').all();
    const scoreDistribution = db.prepare(`
      SELECT
        CASE
          WHEN deal_score >= 80 THEN 'hot (80-100)'
          WHEN deal_score >= 50 THEN 'good (50-79)'
          WHEN deal_score >= 20 THEN 'ok (20-49)'
          ELSE 'skip (<20)'
        END as bucket,
        COUNT(*) as c
      FROM scanned_posts WHERE deal_score IS NOT NULL
      GROUP BY bucket ORDER BY bucket DESC
    `).all();
    const priceRange = db.prepare(`
      SELECT
        CASE
          WHEN price < 50 THEN 'under $50'
          WHEN price < 100 THEN '$50-$100'
          WHEN price < 500 THEN '$100-$500'
          ELSE '$500+'
        END as bucket,
        COUNT(*) as c
      FROM scanned_posts WHERE price IS NOT NULL GROUP BY bucket ORDER BY bucket
    `).all();

    res.json({ bySource, byCategory, scoreDistribution, priceRange });
  } catch (err) {
    logger.error('GET /analytics/deal-distribution error', { error: err.message });
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
