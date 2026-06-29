import db from './db.js';
import { sendNotification } from './notifier.js';
import { fetchReddit } from './redditAuth.js';
import { extractPrice, matchKeywords, matchPrice } from './matchers.js';
import { scoreDeal } from './aiScorer.js';
import logger from './logger.js';

export const SUPPORTED_SUBREDDITS = [
  'mechmarket',
  'hardwareswap',
  'appleswap',
  'photomarket',
  'homelabsales',
  'AVexchange',
  'gamesale',
  'Pen_Swap',
];

export async function scanSubreddit(subreddit) {
  try {
    const data = await fetchReddit(`/r/${subreddit}/new?limit=25`);
    const posts = data.data.children;

    const normalizedTitle = (title) => title.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100);

    const insertPost = db.prepare(
      'INSERT OR IGNORE INTO scanned_posts (post_id, title, body, price, permalink, source, category, image_url, normalized_title) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const insertPriceHistory = db.prepare(
      'INSERT INTO price_history (post_id, price) VALUES (?, ?)'
    );

    const rules = db.prepare(
      `SELECT ar.*, u.email, u.is_premium, u.tier FROM alert_rules ar
       JOIN users u ON ar.user_id = u.id
       WHERE ar.is_active = 1 AND ar.archived_at IS NULL AND ar.deleted_at IS NULL
         AND (ar.pause_until IS NULL OR ar.pause_until <= datetime('now'))
         AND (ar.subreddit = ? OR ar.subreddit = 'all')`
    ).all(subreddit);

    for (const post of posts) {
      const p = post.data;
      const fullText = `${p.title} ${p.selftext || ''}`;
      const price = extractPrice(fullText);
      const category = subreddit;
      const imageUrl = p.preview?.images?.[0]?.source?.url?.replace(/&amp;/g, '&') || p.thumbnail || null;
      const normTitle = normalizedTitle(p.title);

      // Dedup: skip if identical normalized title exists within 7 days
      const dup = db.prepare(`
        SELECT post_id FROM scanned_posts
        WHERE normalized_title = ? AND scanned_at >= datetime('now', '-7 days')
        AND post_id != ?
        LIMIT 1
      `).get(normTitle, p.id);
      if (dup) continue;

      const sellerName = p.author || null;
      const sellerLocation = (p.title.match(/\b[A-Z]{2}\b/) || [])[0] || null;

      const result = insertPost.run(p.id, p.title, p.selftext || '', price, p.permalink, 'reddit', category, imageUrl, normTitle);
      if (result.changes === 0) {
        if (price) {
          const existing = db.prepare('SELECT price FROM scanned_posts WHERE post_id = ?').get(p.id);
          if (existing && existing.price !== price) {
            insertPriceHistory.run(p.id, price);
            const prevPrice = db.prepare("SELECT price FROM price_history WHERE post_id = ? AND recorded_at < datetime('now') ORDER BY recorded_at DESC LIMIT 1").get(p.id);
            if (prevPrice && prevPrice.price > price) {
              const savedBy = db.prepare('SELECT user_id FROM saved_deals WHERE post_id = ?').all(p.id);
              for (const s of savedBy) {
                const dropPct = +((prevPrice.price - price) / prevPrice.price * 100).toFixed(1);
                const existing2 = db.prepare('SELECT id FROM price_drop_alerts WHERE post_id = ? AND user_id = ? AND drop_percent = ?').get(p.id, s.user_id, dropPct);
                if (!existing2) {
                  db.prepare('INSERT INTO price_drop_alerts (user_id, post_id, old_price, new_price, drop_percent) VALUES (?, ?, ?, ?, ?)').run(s.user_id, p.id, prevPrice.price, price, dropPct);
                }
              }
            }
            db.prepare('UPDATE scanned_posts SET price = ? WHERE post_id = ?').run(price, p.id);
          }
        }
        continue;
      }

      if (sellerName || sellerLocation) {
        db.prepare('UPDATE scanned_posts SET seller_name = ?, seller_location = ? WHERE post_id = ?').run(sellerName, sellerLocation, p.id);
      }

      if (price) {
        insertPriceHistory.run(p.id, price);
      }

      const aiScore = await scoreDeal(p.title, p.selftext, price);
      if (aiScore) {
        const scamScore = aiScore.scam_risk === 'high' ? 90 : aiScore.scam_risk === 'medium' ? 50 : 10;
        db.prepare(
          'UPDATE scanned_posts SET deal_score = ?, market_value = ?, ai_explanation = ?, scam_score = ? WHERE post_id = ?'
        ).run(aiScore.score, aiScore.market_value, aiScore.reasoning, scamScore, p.id);
      }

      if (!rules.length) continue;
      for (const rule of rules) {
        const matchedKeywords = matchKeywords(fullText, rule.keywords);
        if (matchedKeywords.length === 0) continue;
        if (!matchPrice(fullText, rule.min_price, rule.max_price)) continue;
        if (rule.min_score && aiScore && aiScore.score < rule.min_score) continue;

        const minSinceMatch = rule.last_matched_at
          ? (Date.now() - new Date(rule.last_matched_at).getTime()) / 60000
          : Infinity;
        const tier = rule.tier || (rule.is_premium ? 'pro' : 'free');
        const baseInterval = tier === 'pro' ? 180 : 1440;
        const interval = rule.scan_interval || baseInterval;
        if (minSinceMatch < interval) continue;

        db.prepare(
          'INSERT INTO alert_matches (alert_rule_id, post_id, matched_keyword) VALUES (?, ?, ?)'
        ).run(rule.id, p.id, matchedKeywords[0]);

        db.prepare(
          "UPDATE alert_rules SET last_matched_at = datetime('now') WHERE id = ?"
        ).run(rule.id);

        sendNotification(rule, p, matchedKeywords[0]).catch(err => logger.error('Scanner notification error', { error: err.message }));
      }
    }
  } catch (err) {
    console.error('Scan error:', err.message);
  }
}
