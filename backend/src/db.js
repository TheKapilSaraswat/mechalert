import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import logger from './logger.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'mechmarket.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    is_premium INTEGER DEFAULT 0,
    stripe_customer_id TEXT,
    payment_provider TEXT DEFAULT 'stripe',
    provider_subscription_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS alert_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    keywords TEXT NOT NULL,
    subreddit TEXT DEFAULT 'mechmarket',
    min_price REAL,
    max_price REAL,
    notify_type TEXT DEFAULT 'discord',
    notify_target TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS scanned_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    price REAL,
    permalink TEXT NOT NULL,
    source TEXT DEFAULT 'reddit',
    deal_score REAL,
    scanned_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS alert_matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alert_rule_id INTEGER NOT NULL,
    post_id TEXT NOT NULL,
    matched_keyword TEXT NOT NULL,
    sent_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (alert_rule_id) REFERENCES alert_rules(id)
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id TEXT NOT NULL,
    price REAL NOT NULL,
    recorded_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (post_id) REFERENCES scanned_posts(post_id)
  );

  CREATE TABLE IF NOT EXISTS saved_deals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    post_id TEXT NOT NULL,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (post_id) REFERENCES scanned_posts(post_id),
    UNIQUE(user_id, post_id)
  );

  CREATE TABLE IF NOT EXISTS deal_search_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    query TEXT NOT NULL,
    results_count INTEGER DEFAULT 0,
    searched_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS visit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL,
    ip TEXT,
    user_agent TEXT,
    user_id INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS deal_collections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS deal_collection_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    collection_id INTEGER NOT NULL,
    saved_deal_id INTEGER NOT NULL,
    added_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (collection_id) REFERENCES deal_collections(id) ON DELETE CASCADE,
    FOREIGN KEY (saved_deal_id) REFERENCES saved_deals(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS price_drop_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    post_id TEXT NOT NULL,
    old_price REAL,
    new_price REAL,
    drop_percent REAL,
    notified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// Migrations for existing DBs
try { db.exec('ALTER TABLE scanned_posts ADD COLUMN source TEXT DEFAULT \'reddit\''); } catch {}
try { db.exec('ALTER TABLE scanned_posts ADD COLUMN deal_score REAL'); } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN stripe_customer_id TEXT'); } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN reset_token TEXT'); } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN reset_expires TEXT'); } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN payment_provider TEXT DEFAULT \'stripe\''); } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN provider_subscription_id TEXT'); } catch {}
try { db.exec('ALTER TABLE scanned_posts ADD COLUMN category TEXT'); } catch {}
try { db.exec('ALTER TABLE scanned_posts ADD COLUMN image_url TEXT'); } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN visited_at TEXT'); } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN pricing_visited_at TEXT'); } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN checkout_started_at TEXT'); } catch {}
try { db.exec('ALTER TABLE alert_rules ADD COLUMN last_matched_at TEXT'); } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN digest_frequency TEXT DEFAULT \'never\''); } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN api_key TEXT'); } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN last_digest_at TEXT'); } catch {}
try { db.exec('ALTER TABLE alert_rules ADD COLUMN scan_interval INTEGER'); } catch {}
try { db.exec(`
  CREATE TABLE IF NOT EXISTS notification_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    channel TEXT DEFAULT 'email',
    subject TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`); } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN tier TEXT DEFAULT \'free\''); } catch {}
try { db.exec(`
  UPDATE users SET tier = CASE WHEN is_premium = 1 THEN 'pro' ELSE 'free' END
  WHERE tier IS NULL OR tier = ''
`); } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN jwt_version INTEGER DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN is_active INTEGER DEFAULT 1'); } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN failed_attempts INTEGER DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN locked_until TEXT'); } catch {}
try { db.exec('ALTER TABLE scanned_posts ADD COLUMN market_value REAL'); } catch {}
try { db.exec('ALTER TABLE scanned_posts ADD COLUMN ai_explanation TEXT'); } catch {}
try { db.exec('ALTER TABLE scanned_posts ADD COLUMN scam_score REAL'); } catch {}
try { db.exec('ALTER TABLE scanned_posts ADD COLUMN ai_analysis TEXT'); } catch {}
try { db.exec('ALTER TABLE scanned_posts ADD COLUMN seller_reputation INTEGER DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE alert_rules ADD COLUMN min_score REAL'); } catch {}
try { db.exec('ALTER TABLE alert_rules ADD COLUMN condition_type TEXT'); } catch {}
try { db.exec('ALTER TABLE alert_rules ADD COLUMN condition_value TEXT'); } catch {}
try { db.exec('ALTER TABLE notification_log ADD COLUMN body TEXT'); } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN subscription_ends_at TEXT'); } catch {}
try { db.exec("UPDATE users SET subscription_ends_at = datetime('now', '+30 days') WHERE is_premium = 1 AND subscription_ends_at IS NULL"); } catch {}
try { db.exec(`
  CREATE TABLE IF NOT EXISTS deal_clicks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    post_id TEXT NOT NULL,
    permalink TEXT,
    source TEXT,
    clicked_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`); } catch {}
try { db.exec(`
  CREATE TABLE IF NOT EXISTS checkout_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    event TEXT NOT NULL,
    plan TEXT,
    payment_method TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`); } catch {}
try { db.exec(`
  CREATE TABLE IF NOT EXISTS seller_reputation (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seller_name TEXT NOT NULL,
    source TEXT NOT NULL,
    total_listings INTEGER DEFAULT 0,
    positive_ratings INTEGER DEFAULT 0,
    negative_ratings INTEGER DEFAULT 0,
    last_seen TEXT,
    flags INTEGER DEFAULT 0,
    UNIQUE(seller_name, source)
  )
`); } catch {}
try { db.exec(`
  CREATE TABLE IF NOT EXISTS webhook_urls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    url TEXT NOT NULL,
    events TEXT DEFAULT 'match',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`); } catch {}
try { db.exec(`
  CREATE TABLE IF NOT EXISTS daily_insights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`); } catch {}
try { db.exec('ALTER TABLE saved_deals ADD COLUMN purchased INTEGER DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE saved_deals ADD COLUMN savings_amount REAL'); } catch {}
try { db.exec('ALTER TABLE saved_deals ADD COLUMN purchased_at TEXT'); } catch {}
try { db.exec('ALTER TABLE alert_rules ADD COLUMN pause_until TEXT'); } catch {}
try { db.exec('ALTER TABLE alert_rules ADD COLUMN archived_at TEXT'); } catch {}
try { db.exec('ALTER TABLE scanned_posts ADD COLUMN seller_name TEXT'); } catch {}
try { db.exec('ALTER TABLE scanned_posts ADD COLUMN seller_location TEXT'); } catch {}
try { db.exec('ALTER TABLE scanned_posts ADD COLUMN normalized_title TEXT'); } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN referral_code TEXT UNIQUE'); } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN referrer_id INTEGER'); } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN verification_token TEXT'); } catch {}
try { db.exec(`
  CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    match_id INTEGER NOT NULL,
    relevant INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (match_id) REFERENCES alert_matches(id),
    UNIQUE(user_id, match_id)
  )
`); } catch {}
try { db.exec(`
  CREATE TABLE IF NOT EXISTS referral_claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    referrer_id INTEGER NOT NULL,
    claimed_user_id INTEGER NOT NULL UNIQUE,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (referrer_id) REFERENCES users(id),
    FOREIGN KEY (claimed_user_id) REFERENCES users(id)
  )
`); } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN last_batch_email_at TEXT'); } catch {}
try { db.exec('ALTER TABLE alert_rules ADD COLUMN deleted_at TEXT'); } catch {}
try { db.exec(`
  CREATE TABLE IF NOT EXISTS email_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    rule_id INTEGER,
    post_id TEXT NOT NULL,
    matched_keyword TEXT NOT NULL,
    title TEXT,
    price REAL,
    permalink TEXT,
    queued_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`); } catch {}
if (process.env.ADMIN_EMAIL) {
  db.prepare('UPDATE users SET is_admin = 1 WHERE email = ?').run(process.env.ADMIN_EMAIL);
}
try {
  db.prepare("DELETE FROM price_history WHERE post_id IN (SELECT post_id FROM scanned_posts WHERE source NOT IN ('reddit','craigslist'))").run();
  db.prepare("DELETE FROM saved_deals WHERE post_id IN (SELECT post_id FROM scanned_posts WHERE source NOT IN ('reddit','craigslist'))").run();
  db.prepare("DELETE FROM alert_matches WHERE post_id IN (SELECT post_id FROM scanned_posts WHERE source NOT IN ('reddit','craigslist'))").run();
  const removed = db.prepare("DELETE FROM scanned_posts WHERE source NOT IN ('reddit','craigslist')").run();
  if (removed.changes > 0) logger.info('Cleaned up stale posts', { count: removed.changes });
} catch (err) {
  logger.error('Startup cleanup error', { error: err.message });
}

export default db;
