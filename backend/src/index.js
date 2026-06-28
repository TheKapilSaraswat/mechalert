import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import rateLimit from 'express-rate-limit';
import cron from 'node-cron';
import jwt from 'jsonwebtoken';
import { jwtAuth } from './middleware.js';
import { scanSubreddit } from './scanner.js';
import { scanCraigslist } from './craigslistScanner.js';
import { matchKeywords, matchPrice } from './matchers.js';
import { sendNotification } from './notifier.js';
import authRoutes from './routes/auth.js';
import alertRoutes from './routes/alerts.js';
import webhookRoutes from './routes/webhook.js';
import razorpayRoutes from './routes/razorpay.js';
import paypalRoutes from './routes/paypal.js';
import savedDealsRoutes from './routes/savedDeals.js';
import analyticsRoutes from './routes/analytics.js';
import llmSearchRoutes from './routes/llmSearch.js';
import adminRoutes from './routes/admin.js';
import digestRoutes from './routes/digest.js';
import collectionRoutes from './routes/collections.js';
import apiRoutes from './routes/api.js';
import statsRoutes from './routes/stats.js';
import aiAgentRoutes from './routes/aiAgent.js';
import feedbackRoutes from './routes/feedback.js';
import referralRoutes from './routes/referrals.js';
import savingsRoutes from './routes/savings.js';
import db from './db.js';
import logger from './logger.js';
import { backupDatabase, runWALCheckpoint } from './dbBackup.js';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  logger.error('FATAL: JWT_SECRET is not set in .env');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3001;

app.set('trust proxy', process.env.NODE_ENV === 'production' ? 2 : 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://checkout.razorpay.com", "https://*.razorpay.com", "https://www.paypal.com", "https://www.paypalobjects.com"],
      frameSrc: ["'self'", "https://checkout.razorpay.com", "https://*.razorpay.com", "https://www.paypal.com", "https://www.sandbox.paypal.com"],
      imgSrc: ["'self'", "data:", "https:", "https://*.razorpay.com", "https://www.paypalobjects.com"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'", "https://api.openrouter.ai", "https://hooks.slack.com", "https://api.telegram.org", "https://api.pushover.net", "https://ntfy.sh", "https://api.razorpay.com", "https://api-m.paypal.com", "https://api-m.sandbox.paypal.com"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : ['http://localhost:5173', 'https://mechalert-production.up.railway.app'],
  credentials: true,
  maxAge: 86400,
}));

if (process.env.NODE_ENV !== 'production') {
  const { default: morgan } = await import('morgan');
  app.use(morgan('combined'));
}

app.use('/api/razorpay/webhook', express.raw({ type: 'application/json', limit: '50kb' }));
app.use('/api/paypal/webhook', express.raw({ type: 'application/json', limit: '50kb' }));
app.use('/api', express.json({ limit: '50kb' }));

function keyGenerator(req) {
  if (req.user?.userId) return `user_${req.user.userId}`;
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.API_RATE_LIMIT_MAX) || 200,
  keyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Try again later.' },
});
app.use('/api', apiLimiter);

const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX) || 10,
  keyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again later.' },
});

const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.SEARCH_RATE_LIMIT_MAX) || 30,
  keyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Search rate limit. Try again later.' },
});

const scanLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  keyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Slow down.' },
});

app.use((req, res, next) => {
  res.setTimeout(parseInt(process.env.REQUEST_TIMEOUT_MS) || 30000, () => {
    res.status(503).json({ error: 'Request timeout' });
  });
  next();
});

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/razorpay', razorpayRoutes);
app.use('/api/paypal', paypalRoutes);
app.use('/api/saved-deals', savedDealsRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/search', searchLimiter, llmSearchRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/digest', digestRoutes);
app.use('/api/collections', collectionRoutes);
app.use('/api', apiRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/ai', jwtAuth, aiAgentRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/referrals', referralRoutes);
app.use('/api/savings', savingsRoutes);

app.get('/api/me', jwtAuth, (req, res) => {
  try {
    const user = db.prepare('SELECT id, email, is_premium, is_admin, tier, is_active, payment_provider, digest_frequency, api_key FROM users WHERE id = ?').get(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.tier = user.tier || (user.is_premium ? 'pro' : 'free');
    res.json(user);
  } catch (err) {
    logger.error('/api/me error', { error: err.message, userId: req.user?.userId });
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/matches', jwtAuth, (req, res) => {
  try {
    const matches = db.prepare(`
      SELECT am.*, sp.title, sp.price, sp.permalink, sp.deal_score, sp.source,
             sp.ai_analysis, sp.seller_name, sp.seller_location,
             ar.keywords, ar.min_price, ar.max_price, ar.subreddit as rule_subreddit
      FROM alert_matches am
      JOIN scanned_posts sp ON am.post_id = sp.post_id
      JOIN alert_rules ar ON am.alert_rule_id = ar.id
      WHERE ar.user_id = ? AND ar.archived_at IS NULL
      ORDER BY am.sent_at DESC
      LIMIT 50
    `).all(req.user.userId);

    const feedbacks = db.prepare('SELECT match_id, relevant FROM feedback WHERE user_id = ?').all(req.user.userId);
    const fbMap = {};
    for (const f of feedbacks) fbMap[f.match_id] = f.relevant;

    const sourceReliability = { reddit: 'High', craigslist: 'Low' };
    const enriched = matches.map(m => ({
      ...m,
      ai_analysis: m.ai_analysis ? JSON.parse(m.ai_analysis) : null,
      user_feedback: fbMap[m.id] ?? null,
      source_reliability: sourceReliability[m.source] || 'Medium',
      why_matched: {
        keywords: m.matched_keyword,
        price_ok: !m.min_price || !m.price || m.price >= m.min_price,
        within_max: !m.max_price || !m.price || m.price <= m.max_price,
        min_price: m.min_price,
        max_price: m.max_price,
        seller: m.seller_name,
        location: m.seller_location,
      },
    }));
    res.json(enriched);
  } catch (err) {
    logger.error('/api/matches error', { error: err.message, userId: req.user?.userId });
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/alerts/expiring', jwtAuth, (req, res) => {
  try {
    const stale = db.prepare(`
      SELECT ar.*, (SELECT COUNT(*) FROM alert_matches am WHERE am.alert_rule_id = ar.id AND am.sent_at >= datetime('now', '-90 days')) as matches_90d
      FROM alert_rules ar
      WHERE ar.user_id = ? AND ar.is_active = 1 AND ar.archived_at IS NULL
      HAVING matches_90d = 0
    `).all(req.user.userId);
    res.json(stale);
  } catch (err) {
    logger.error('/api/alerts/expiring error', { error: err.message });
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/alerts/estimate', jwtAuth, (req, res) => {
  try {
    const { keywords } = req.body;
    if (!keywords) return res.status(400).json({ error: 'Keywords required' });
    const weekEstimate = db.prepare(`
      SELECT COUNT(*) as c FROM scanned_posts
      WHERE scanned_at >= datetime('now', '-7 days')
        AND (title LIKE ? OR body LIKE ?)
    `).get(`%${keywords.split(',')[0].trim()}%`, `%${keywords.split(',')[0].trim()}%`);
    res.json({ estimatedWeekly: Math.max(1, Math.round(weekEstimate.c / 2)), estimatedDaily: Math.max(0, Math.round(weekEstimate.c / 14)) });
  } catch (err) {
    logger.error('/api/alerts/estimate error', { error: err.message });
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/debug/reddit', (req, res) => {
  const envToken = !!process.env.REDDIT_TOKEN;
  const envClient = !!process.env.REDDIT_CLIENT_ID;
  const hasRefresh = !!(process.env.REDDIT_REFRESH_TOKEN || process.env.REDDIT_USERNAME);
  res.json({ REDDIT_TOKEN: envToken, REDDIT_CLIENT_ID: envClient, hasRefreshOrPassword: hasRefresh, rssMode: !envClient && !hasRefresh });
});

app.get('/api/stats', (req, res) => {
  try {
    const totalPosts = db.prepare('SELECT COUNT(*) as c FROM scanned_posts').get().c;
    const totalMatches = db.prepare('SELECT COUNT(*) as c FROM alert_matches').get().c;
    const totalUsers = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
    const totalRules = db.prepare('SELECT COUNT(*) as c FROM alert_rules').get().c;
    const bySource = db.prepare('SELECT source, COUNT(*) as c FROM scanned_posts GROUP BY source').all();
    const avgScore = db.prepare('SELECT AVG(deal_score) as avg FROM scanned_posts WHERE deal_score IS NOT NULL').get().avg;
    const topKeywords = db.prepare(`
      SELECT am.matched_keyword, COUNT(*) as c FROM alert_matches am
      GROUP BY am.matched_keyword ORDER BY c DESC LIMIT 10
    `).all();
    const scansToday = db.prepare(`
      SELECT COUNT(*) as c FROM scanned_posts WHERE scanned_at >= datetime('now', '-1 day')
    `).get().c;
    const totalSaved = db.prepare('SELECT COUNT(*) as c FROM saved_deals').get().c;
    const hotDeals = db.prepare(`
      SELECT COUNT(*) as c FROM scanned_posts WHERE deal_score >= 80 AND scanned_at >= datetime('now', '-7 days')
    `).get().c;
    res.json({ totalPosts, totalMatches, totalUsers, totalRules, bySource, avgScore, topKeywords, scansToday, totalSaved, hotDeals });
  } catch (err) {
    logger.error('/api/stats error', { error: err.message });
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/config', (req, res) => {
  res.json({
    tiers: {
      free: { rules: 3, interval: 1440 },
      pro: { price: 2.99, priceINR: 199, rules: -1, interval: 180 },
    },
    razorpay: {
      key: process.env.RAZORPAY_KEY_ID || '',
      pro: { monthly: parseInt(process.env.RAZORPAY_PRO_MONTHLY) || parseInt(process.env.RAZORPAY_AMOUNT_MONTHLY) || 19900, yearly: parseInt(process.env.RAZORPAY_PRO_YEARLY) || parseInt(process.env.RAZORPAY_AMOUNT_YEARLY) || 199900 },
    },
    paypal: {
      clientId: process.env.PAYPAL_CLIENT_ID || '',
      pro: { monthly: process.env.PAYPAL_PRO_MONTHLY || '2.99', yearly: process.env.PAYPAL_PRO_YEARLY || '29.99' },
    },
    sources: [
      { id: 'reddit', label: 'Reddit', subs: ['mechmarket', 'hardwareswap', 'appleswap', 'photomarket', 'homelabsales', 'AVexchange', 'gamesale', 'Pen_Swap'] },
      { id: 'craigslist', label: 'Craigslist' },
    ],
    notifyTypes: ['email', 'discord', 'telegram', 'slack', 'ntfy', 'pushover'],
  });
});

app.get('/api/health', (req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
  } catch (err) {
    logger.error('Health check failed', { error: err.message });
    res.status(503).json({ status: 'error', error: err.message });
  }
});

app.get('/api/ping', (req, res) => res.send('pong'));

app.get('/api/price-history/:postId', jwtAuth, (req, res) => {
  try {
    const user = db.prepare('SELECT is_premium FROM users WHERE id = ?').get(req.user.userId);
    if (!user?.is_premium) return res.status(403).json({ error: 'Price history is a Premium feature.' });
    const history = db.prepare(
      'SELECT price, recorded_at FROM price_history WHERE post_id = ? ORDER BY recorded_at ASC'
    ).all(req.params.postId);
    res.json(history);
  } catch (err) {
    logger.error('Price history error', { error: err.message });
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/track-click', jwtAuth, (req, res) => {
  try {
    const { post_id, permalink, source } = req.body || {};
    if (!post_id) return res.json({ ok: true });
    db.prepare('INSERT INTO deal_clicks (user_id, post_id, permalink, source) VALUES (?, ?, ?, ?)').run(req.user.userId, post_id, permalink || '', source || '');
    res.json({ ok: true });
  } catch {
    res.json({ ok: true });
  }
});

app.post('/api/track', (req, res) => {
  try {
    const { path: pagePath } = req.body || {};
    if (!pagePath) return res.json({ ok: true });
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const ua = req.headers['user-agent'] || '';
    let userId = null;
    const header = req.headers.authorization;
    if (header) {
      try { userId = jwt.verify(header.replace('Bearer ', ''), JWT_SECRET, { algorithms: ['HS256'] }).userId; } catch {}
    }
    db.prepare('INSERT INTO visit_log (path, ip, user_agent, user_id) VALUES (?, ?, ?, ?)').run(pagePath, ip, ua, userId);
    if (pagePath === '/pricing' && userId) {
      db.prepare('UPDATE users SET pricing_visited_at = datetime(\'now\') WHERE id = ?').run(userId);
    }
    if (userId) {
      db.prepare('UPDATE users SET visited_at = datetime(\'now\') WHERE id = ?').run(userId);
    }
    res.json({ ok: true });
  } catch (err) {
    logger.error('Track error', { error: err.message });
    res.json({ ok: true });
  }
});

const SUBREDDITS = ['mechmarket', 'hardwareswap', 'appleswap', 'photomarket', 'homelabsales', 'AVexchange', 'gamesale', 'Pen_Swap'];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

let scanCycle = 0;

async function scanAll() {
  const batchSize = 4;
  const start = (scanCycle * batchSize) % SUBREDDITS.length;
  const batch = SUBREDDITS.slice(start, start + batchSize);
  scanCycle++;
  logger.info('Starting scan cycle', { batch, total: SUBREDDITS.length, cycle: scanCycle });
  for (const sub of batch) {
    scanSubreddit(sub).catch(err => logger.error(`Scan ${sub} error`, { error: err.message }));
    await sleep(10000);
  }
  if (process.env.ENABLE_CRAIGSLIST_SCANNER !== 'false') {
    logger.info('Starting Craigslist scan');
    scanCraigslist().catch(err => logger.error('Craigslist scan error', { error: err.message }));
  }
  logger.info('Scan cycle complete');
}

const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
app.use(express.static(frontendDist, {
  maxAge: process.env.NODE_ENV === 'production' ? '1y' : 0,
  etag: true,
  lastModified: true,
}));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(frontendDist, 'index.html'));
});

let Sentry;
if (process.env.SENTRY_DSN) {
  const sentryModule = await import('@sentry/node');
  Sentry = sentryModule.default;
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE) || 0.1,
  });
  logger.info('Sentry initialized');
}

process.on('unhandledRejection', (reason) => {
  logger.error('UNHANDLED REJECTION', { error: reason instanceof Error ? reason.message : reason, stack: reason instanceof Error ? reason.stack : undefined });
});

process.on('uncaughtException', (err) => {
  logger.error('UNCAUGHT EXCEPTION', { error: err.message, stack: err.stack });
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
});

app.use((err, req, res, _next) => {
  if (typeof Sentry !== 'undefined' && Sentry) Sentry.captureException(err);
  logger.error('Unhandled error', { error: err.message, stack: err.stack, path: req.path, method: req.method });
  res.status(500).json({ error: 'Internal server error' });
});

if (!process.env.OPENROUTER_API_KEY) {
  logger.warn('OPENROUTER_API_KEY not set — AI scoring disabled (silent)');
}
if (!process.env.REDDIT_CLIENT_ID) {
  logger.warn('REDDIT_CLIENT_ID not set — Reddit scanner will use RSS feed fallback (limited)');
}
if (!process.env.SMTP_HOST && !process.env.RESEND_API_KEY) {
  logger.warn('SMTP_HOST/RESEND_API_KEY not set — emails use Ethereal dev mode (not suitable for production)');
}
if (!process.env.WEBHOOK_SECRET) {
  logger.warn('WEBHOOK_SECRET not set — external webhook endpoint has no auth!');
}
if (!process.env.STRIPE_WEBHOOK_SECRET && process.env.STRIPE_SECRET_KEY) {
  logger.warn('STRIPE_WEBHOOK_SECRET not set — Stripe webhook verification disabled!');
}
if (!process.env.PAYPAL_WEBHOOK_ID && process.env.PAYPAL_CLIENT_ID) {
  logger.warn('PAYPAL_WEBHOOK_ID not set — PayPal webhook verification disabled!');
}
if (!process.env.RAZORPAY_WEBHOOK_SECRET && process.env.RAZORPAY_KEY_ID) {
  logger.warn('RAZORPAY_WEBHOOK_SECRET not set — Razorpay webhook verification disabled!');
}

const scanInterval = parseInt(process.env.SCAN_INTERVAL_MINUTES) || 2;
cron.schedule(`*/${scanInterval} * * * *`, scanAll);

if (process.env.ENABLE_DB_BACKUP !== 'false') {
  cron.schedule('*/30 * * * *', backupDatabase);
  cron.schedule('*/5 * * * *', runWALCheckpoint);
  logger.info('DB backup cron: every 30 min, WAL checkpoint: every 5 min');
}

cron.schedule('0 0 * * *', async () => {
  logger.info('Running subscription expiry check');
  try {
    const expired = db.prepare("SELECT id, email, subscription_ends_at FROM users WHERE is_premium = 1 AND subscription_ends_at IS NOT NULL AND subscription_ends_at < datetime('now')").all();
    if (expired.length > 0) {
      for (const u of expired) {
        db.prepare("UPDATE users SET is_premium = 0, tier = 'free' WHERE id = ?").run(u.id);
        logger.info('Subscription expired', { userId: u.id, email: u.email, endedAt: u.subscription_ends_at });
      }
    }
  } catch (err) {
    logger.error('Subscription expiry cron error', { error: err.message });
  }
});

cron.schedule('0 8 * * *', async () => {
  logger.info('Running daily digest cron');
  try {
    const users = db.prepare("SELECT id, email, digest_frequency, last_digest_at FROM users WHERE digest_frequency != 'never' AND is_premium = 1").all();
    for (const u of users) {
      const period = u.digest_frequency === 'weekly' ? 7 : 1;
      const since = u.last_digest_at || new Date(Date.now() - period * 86400000).toISOString();
      const matches = db.prepare(`
        SELECT am.*, sp.title, sp.price, sp.permalink, sp.source, ar.keywords, ar.notify_type
        FROM alert_matches am
        JOIN scanned_posts sp ON am.post_id = sp.post_id
        JOIN alert_rules ar ON am.alert_rule_id = ar.id
        WHERE ar.user_id = ? AND am.sent_at >= ?
        ORDER BY am.sent_at DESC
      `).all(u.id, since);
      if (matches.length === 0) continue;
      let html = `<h2>MechAlert Digest</h2><p>${matches.length} new matches since last digest.</p><table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;"><tr><th>Title</th><th>Price</th><th>Source</th><th>Keyword</th></tr>`;
      for (const m of matches) {
        html += `<tr><td><a href="${m.permalink}">${(m.title || '').substring(0, 60)}</a></td><td>${m.price ? '$' + m.price : '-'}</td><td>${m.source}</td><td>${m.matched_keyword}</td></tr>`;
      }
      html += '</table>';
      const { sendEmail } = await import('./notifier.js');
      await sendEmail(u.email, 'Your MechAlert Digest', '', '', html);
      db.prepare("UPDATE users SET last_digest_at = datetime('now') WHERE id = ?").run(u.id);
    }
  } catch (err) {
    logger.error('Digest cron error', { error: err.message });
  }
});

async function backfillUnmatchedRules() {
  logger.info('Running startup backfill for unmatched rules');
  try {
    const rules = db.prepare("SELECT ar.*, u.email FROM alert_rules ar JOIN users u ON ar.user_id = u.id WHERE ar.is_active = 1 AND ar.last_matched_at IS NULL").all();
    for (const rule of rules) {
      const subFilter = rule.subreddit === 'all' ? "source = 'reddit'"
        : rule.subreddit === 'craigslist' ? "source = 'craigslist'"
        : "category = ?";
      const subParams = rule.subreddit !== 'all' && rule.subreddit !== 'craigslist' ? [rule.subreddit] : [];
      const posts = db.prepare(`SELECT * FROM scanned_posts WHERE ${subFilter} AND scanned_at > datetime('now', '-1 day') ORDER BY scanned_at DESC LIMIT 100`).all(...subParams);
      let matched = 0;
      for (const post of posts) {
        const fullText = `${post.title} ${post.body || ''}`;
        const kw = matchKeywords(fullText, rule.keywords);
        if (kw.length === 0) continue;
        if (!matchPrice(fullText, rule.min_price, rule.max_price)) continue;
        const existing = db.prepare('SELECT id FROM alert_matches WHERE alert_rule_id = ? AND post_id = ?').get(rule.id, post.post_id);
        if (existing) continue;
        db.prepare('INSERT INTO alert_matches (alert_rule_id, post_id, matched_keyword) VALUES (?, ?, ?)').run(rule.id, post.post_id, kw[0]);
        db.prepare("UPDATE alert_rules SET last_matched_at = datetime('now') WHERE id = ?").run(rule.id);
        sendNotification(rule, post, kw[0]).catch(() => {});
        matched++;
      }
      if (matched > 0) logger.info('Startup backfill', { ruleId: rule.id, keywords: rule.keywords, matched });
    }
  } catch (err) {
    logger.error('Startup backfill error', { error: err.message });
  }
}

export function onServerStart() {
  logger.info(`Server running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
  scanAll();
  backfillUnmatchedRules();
}

if (!process.env.VITEST) {
  app.listen(PORT, onServerStart);
}

export default app;