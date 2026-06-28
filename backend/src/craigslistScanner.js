import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import db from './db.js';
import { sendNotification } from './notifier.js';
import { matchKeywords, matchPrice } from './matchers.js';
import logger from './logger.js';

const SEARCH_QUERIES = [
  'mechanical keyboard',
  'custom keyboard',
  'keycaps',
];

const AREAS = { sfbay: 'SF bay', losangeles: 'LA', newyork: 'NYC', seattle: 'SEA', austin: 'ATX' };

async function searchCraigslist(query) {
  const items = [];
  for (const [area, label] of Object.entries(AREAS)) {
    try {
      const url = `https://${area}.craigslist.org/search/sss?query=${encodeURIComponent(query)}&sort=date`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'MechAlert/1.0' },
        timeout: 15000,
      });
      const html = await res.text();
      const $ = cheerio.load(html);

      $('.cl-static-search-result a[href*=".html"]').each((_, el) => {
        const href = $(el).attr('href');
        const titleEl = $(el).find('.title');
        const priceEl = $(el).find('.price');
        const title = titleEl.text().trim();
        const priceText = priceEl.text().trim();
        const priceMatch = priceText.match(/\$([\d,]+(?:\.\d{2})?)/);
        if (title && priceMatch && href) {
          items.push({
            id: href.split('/').pop().replace('.html', ''),
            title,
            price: parseFloat(priceMatch[1].replace(/,/g, '')),
            url: href,
            source: 'craigslist',
            area: label,
          });
        }
      });
    } catch (err) {
      logger.error(`Craigslist ${label} error`, { error: err.message });
    }
  }
  return items;
}

export async function scanCraigslist() {
  try {
    const allItems = [];
    for (const query of SEARCH_QUERIES) {
      const items = await searchCraigslist(query);
      allItems.push(...items);
    }

    const insertPost = db.prepare(
      'INSERT OR IGNORE INTO scanned_posts (post_id, title, body, price, permalink, source, category, image_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const insertPriceHistory = db.prepare(
      'INSERT INTO price_history (post_id, price) VALUES (?, ?)'
    );
    const rules = db.prepare(
      'SELECT ar.*, u.email, u.is_premium FROM alert_rules ar JOIN users u ON ar.user_id = u.id WHERE ar.is_active = 1 AND ar.subreddit = ?'
    ).all('craigslist');

    for (const item of allItems) {
      const postId = `cl_${item.id}`;
      const result = insertPost.run(postId, item.title, `${item.area}`, item.price, item.url, 'craigslist', 'craigslist', null);
      if (result.changes === 0) {
        if (item.price) {
          const existing = db.prepare('SELECT price FROM scanned_posts WHERE post_id = ?').get(postId);
          if (existing && existing.price !== item.price) {
            insertPriceHistory.run(postId, item.price);
            const prevPrice = db.prepare("SELECT price FROM price_history WHERE post_id = ? AND recorded_at < datetime('now') ORDER BY recorded_at DESC LIMIT 1").get(postId);
            if (prevPrice && prevPrice.price > item.price) {
              const savedBy = db.prepare('SELECT user_id FROM saved_deals WHERE post_id = ?').all(postId);
              for (const s of savedBy) {
                const dropPct = +((prevPrice.price - item.price) / prevPrice.price * 100).toFixed(1);
                const existing2 = db.prepare('SELECT id FROM price_drop_alerts WHERE post_id = ? AND user_id = ? AND drop_percent = ?').get(postId, s.user_id, dropPct);
                if (!existing2) {
                  db.prepare('INSERT INTO price_drop_alerts (user_id, post_id, old_price, new_price, drop_percent) VALUES (?, ?, ?, ?, ?)').run(s.user_id, postId, prevPrice.price, item.price, dropPct);
                }
              }
            }
            db.prepare('UPDATE scanned_posts SET price = ? WHERE post_id = ?').run(item.price, postId);
          }
        }
        continue;
      }
      if (item.price) {
        insertPriceHistory.run(postId, item.price);
      }

      if (!rules.length) continue;
      for (const rule of rules) {
        const matchedKeywords = matchKeywords(item.title, rule.keywords);
        if (matchedKeywords.length === 0) continue;
        if (!matchPrice(item.title, rule.min_price, rule.max_price)) continue;

        const minSinceMatch = rule.last_matched_at
          ? (Date.now() - new Date(rule.last_matched_at).getTime()) / 60000
          : Infinity;
        const interval = rule.scan_interval || (rule.is_premium ? 10 : 180);
        if (minSinceMatch < interval) continue;

        db.prepare(
          'INSERT INTO alert_matches (alert_rule_id, post_id, matched_keyword) VALUES (?, ?, ?)'
        ).run(rule.id, postId, matchedKeywords[0]);

        db.prepare(
          "UPDATE alert_rules SET last_matched_at = datetime('now') WHERE id = ?"
        ).run(rule.id);

        await sendNotification(rule, { title: item.title, permalink: item.url, selftext: '' }, matchedKeywords[0]);
      }
    }
  } catch (err) {
    logger.error('Craigslist scan error', { error: err.message });
  }
}