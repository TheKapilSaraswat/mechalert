import { Router } from 'express';
import fs from 'fs';
import db from '../db.js';
import logger from '../logger.js';
import { sendEmail } from '../notifier.js';
import { adminAuth } from '../middleware.js';

const router = Router();
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

router.get('/stats', adminAuth, (req, res) => {
  try {
    const totalUsers = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
    const proUsers = db.prepare("SELECT COUNT(*) as c FROM users WHERE tier = 'pro'").get().c;
    const premiumUsers = proUsers;
    const totalPosts = db.prepare('SELECT COUNT(*) as c FROM scanned_posts').get().c;
    const totalMatches = db.prepare('SELECT COUNT(*) as c FROM alert_matches').get().c;
    const totalRules = db.prepare('SELECT COUNT(*) as c FROM alert_rules').get().c;
    const activeRules = db.prepare('SELECT COUNT(*) as c FROM alert_rules WHERE is_active = 1').get().c;
    const bySource = db.prepare('SELECT source, COUNT(*) as c FROM scanned_posts GROUP BY source ORDER BY c DESC').all();
    const posts24h = db.prepare("SELECT COUNT(*) as c FROM scanned_posts WHERE scanned_at >= datetime('now', '-1 day')").get().c;
    const matches24h = db.prepare("SELECT COUNT(*) as c FROM alert_matches WHERE sent_at >= datetime('now', '-1 day')").get().c;
    const totalSaved = db.prepare('SELECT COUNT(*) as c FROM saved_deals').get().c;
    const searches24h = db.prepare("SELECT COUNT(*) as c FROM deal_search_history WHERE searched_at >= datetime('now', '-1 day')").get().c;

    let dbSize = 'N/A';
    try {
      const dbPath = process.env.DATABASE_PATH || null;
      if (dbPath && fs.existsSync(dbPath)) {
        dbSize = (fs.statSync(dbPath).size / 1024 / 1024).toFixed(2) + ' MB';
      }
    } catch {}

    res.json({
      users: { total: totalUsers, premium: premiumUsers, free: totalUsers - premiumUsers, pro: proUsers },
      content: { posts: totalPosts, matches: totalMatches, rules: totalRules, activeRules, savedDeals: totalSaved },
      activity24h: { posts: posts24h, matches: matches24h, searches: searches24h },
      bySource,
      dbSize,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    });
  } catch (err) {
    logger.error('Admin stats error', { error: err.message });
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/users', adminAuth, (req, res) => {
  try {
    const users = db.prepare(`
      SELECT u.id, u.email, u.is_premium, u.is_admin, u.tier, u.is_active, u.email_verified, u.created_at,
        (SELECT COUNT(*) FROM alert_rules ar WHERE ar.user_id = u.id AND ar.deleted_at IS NULL) as rule_count,
        (SELECT COUNT(*) FROM alert_matches am JOIN alert_rules ar ON am.alert_rule_id = ar.id WHERE ar.user_id = u.id) as match_count,
        (SELECT COUNT(*) FROM notification_log WHERE user_id = u.id AND type = 'marketing') as mail_count
      FROM users u ORDER BY u.id DESC LIMIT 100
    `).all();
    res.json(users);
  } catch (err) {
    logger.error('Admin users error', { error: err.message });
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/recent-activity', adminAuth, (req, res) => {
  try {
    const recentPosts = db.prepare(`
      SELECT post_id, title, price, source, deal_score, scanned_at
      FROM scanned_posts ORDER BY id DESC LIMIT 50
    `).all();
    const recentMatches = db.prepare(`
      SELECT am.*, sp.title, sp.price, sp.source, sp.permalink
      FROM alert_matches am
      JOIN scanned_posts sp ON am.post_id = sp.post_id
      ORDER BY am.id DESC LIMIT 50
    `).all();
    res.json({ recentPosts, recentMatches });
  } catch (err) {
    logger.error('Admin activity error', { error: err.message });
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/source-health', adminAuth, (req, res) => {
  try {
    const sources = db.prepare(`
      SELECT source, COUNT(*) as total,
        SUM(CASE WHEN scanned_at >= datetime('now', '-1 day') THEN 1 ELSE 0 END) as last24h,
        MAX(scanned_at) as last_scanned
      FROM scanned_posts GROUP BY source ORDER BY source
    `).all();

    const sourceRules = db.prepare(`
      SELECT subreddit as source, COUNT(*) as rule_count
      FROM alert_rules WHERE is_active = 1 GROUP BY subreddit
    `).all();

    const result = sources.map(s => {
      const rules = sourceRules.find(r => r.source === s.source);
      return { ...s, activeRules: rules?.rule_count || 0 };
    });

    res.json(result);
  } catch (err) {
    logger.error('Admin source health error', { error: err.message });
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/analytics', adminAuth, (req, res) => {
  try {
    const totalUsers = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
    const usersToday = db.prepare("SELECT COUNT(*) as c FROM users WHERE created_at >= datetime('now', '-1 day')").get().c;
    const usersThisWeek = db.prepare("SELECT COUNT(*) as c FROM users WHERE created_at >= datetime('now', '-7 days')").get().c;
    const usersThisMonth = db.prepare("SELECT COUNT(*) as c FROM users WHERE created_at >= datetime('now', '-30 days')").get().c;

    const uniqueIpsToday = db.prepare("SELECT COUNT(DISTINCT ip) as c FROM visit_log WHERE created_at >= datetime('now', '-1 day')").get().c;
    const uniqueIpsThisWeek = db.prepare("SELECT COUNT(DISTINCT ip) as c FROM visit_log WHERE created_at >= datetime('now', '-7 days')").get().c;
    const uniqueIpsAll = db.prepare('SELECT COUNT(DISTINCT ip) as c FROM visit_log').get().c;

    const totalViews = db.prepare('SELECT COUNT(*) as c FROM visit_log').get().c;
    const viewsToday = db.prepare("SELECT COUNT(*) as c FROM visit_log WHERE created_at >= datetime('now', '-1 day')").get().c;

    const pricingViews = db.prepare("SELECT COUNT(*) as c FROM visit_log WHERE path = '/pricing'").get().c;
    const pricingViewsToday = db.prepare("SELECT COUNT(*) as c FROM visit_log WHERE path = '/pricing' AND created_at >= datetime('now', '-1 day')").get().c;
    const pricingUniqueUsers = db.prepare("SELECT COUNT(DISTINCT user_id) as c FROM visit_log WHERE path = '/pricing' AND user_id IS NOT NULL").get().c;

    const checkoutStarted = db.prepare("SELECT COUNT(*) as c FROM users WHERE checkout_started_at IS NOT NULL").get().c;
    const checkoutStartedToday = db.prepare("SELECT COUNT(*) as c FROM users WHERE checkout_started_at >= datetime('now', '-1 day')").get().c;

    const premiumUsers = db.prepare('SELECT COUNT(*) as c FROM users WHERE is_premium = 1').get().c;
    const premiumToday = db.prepare("SELECT COUNT(*) as c FROM users WHERE is_premium = 1 AND (checkout_started_at >= datetime('now', '-1 day') OR created_at >= datetime('now', '-1 day'))").get().c;

    const activeLastDay = db.prepare("SELECT COUNT(*) as c FROM users WHERE visited_at >= datetime('now', '-1 day')").get().c;
    const activeLastWeek = db.prepare("SELECT COUNT(*) as c FROM users WHERE visited_at >= datetime('now', '-7 days')").get().c;

    const topPaths = db.prepare("SELECT path, COUNT(*) as c FROM visit_log GROUP BY path ORDER BY c DESC LIMIT 10").all();

    const regPricing = db.prepare("SELECT COUNT(*) as c FROM users WHERE pricing_visited_at IS NOT NULL").get().c;
    const regCheckout = db.prepare("SELECT COUNT(*) as c FROM users WHERE checkout_started_at IS NOT NULL").get().c;
    const regPaid = premiumUsers;

    res.json({
      users: { total: totalUsers, today: usersToday, thisWeek: usersThisWeek, thisMonth: usersThisMonth },
      visits: { uniqueIpsToday, uniqueIpsThisWeek, uniqueIpsAll, totalViews, viewsToday },
      pricing: { totalViews: pricingViews, viewsToday: pricingViewsToday, uniqueUsers: pricingUniqueUsers },
      checkout: { started: checkoutStarted, startedToday: checkoutStartedToday },
      subscriptions: { total: premiumUsers, today: premiumToday },
      activeUsers: { lastDay: activeLastDay, lastWeek: activeLastWeek },
      funnel: {
        registered: totalUsers,
        viewedPricing: regPricing,
        startedCheckout: regCheckout,
        paid: regPaid,
        viewRate: totalUsers > 0 ? ((regPricing / totalUsers) * 100).toFixed(1) + '%' : '0%',
        checkoutRate: regPricing > 0 ? ((regCheckout / regPricing) * 100).toFixed(1) + '%' : '0%',
        conversionRate: totalUsers > 0 ? ((regPaid / totalUsers) * 100).toFixed(1) + '%' : '0%',
      },
      topPaths,
    });
  } catch (err) {
    logger.error('Admin analytics error', { error: err.message });
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/users/:id', adminAuth, (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) return res.status(400).json({ error: 'Invalid user ID' });
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { is_admin, is_premium, tier, is_active } = req.body;
    db.prepare(`
      UPDATE users SET
        is_admin = COALESCE(?, is_admin),
        is_premium = COALESCE(?, is_premium),
        tier = COALESCE(?, tier),
        is_active = COALESCE(?, is_active)
      WHERE id = ?
    `).run(is_admin ?? null, is_premium ?? null, tier ?? null, is_active ?? null, userId);
    const updated = db.prepare('SELECT id, email, is_premium, is_admin, tier, is_active, created_at FROM users WHERE id = ?').get(userId);
    res.json(updated);
  } catch (err) {
    logger.error('Admin update user error', { error: err.message });
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/users/:id', adminAuth, (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) return res.status(400).json({ error: 'Invalid user ID' });
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    db.prepare('DELETE FROM alert_matches WHERE alert_rule_id IN (SELECT id FROM alert_rules WHERE user_id = ?)').run(userId);
    db.prepare('DELETE FROM alert_rules WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM saved_deals WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM notification_log WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    logger.info('Admin deleted user', { userId });
    res.json({ ok: true });
  } catch (err) {
    logger.error('Admin delete user error', { error: err.message });
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/cleanup', adminAuth, (req, res) => {
  try {
    const staleMatches = db.prepare("DELETE FROM alert_matches WHERE post_id IN (SELECT post_id FROM scanned_posts WHERE source NOT IN ('reddit','craigslist'))").run();
    const stalePosts = db.prepare("DELETE FROM scanned_posts WHERE source NOT IN ('reddit','craigslist')").run();
    res.json({ removedMatches: staleMatches.changes, removedPosts: stalePosts.changes });
  } catch (err) {
    logger.error('Admin cleanup error', { error: err.message });
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/tracking-stats', adminAuth, (req, res) => {
  try {
    const totalClicks = db.prepare('SELECT COUNT(*) as c FROM deal_clicks').get().c;
    const clicksToday = db.prepare("SELECT COUNT(*) as c FROM deal_clicks WHERE clicked_at >= datetime('now', '-1 day')").get().c;
    const clicksBySource = db.prepare('SELECT source, COUNT(*) as c FROM deal_clicks GROUP BY source ORDER BY c DESC').all();
    const topClickers = db.prepare(`
      SELECT dc.user_id, u.email, COUNT(*) as clicks
      FROM deal_clicks dc JOIN users u ON dc.user_id = u.id
      GROUP BY dc.user_id ORDER BY clicks DESC LIMIT 10
    `).all();

    const checkoutStarted = db.prepare("SELECT COUNT(*) as c FROM checkout_events WHERE event = 'started'").get().c;
    const checkoutCompleted = db.prepare("SELECT COUNT(*) as c FROM checkout_events WHERE event = 'completed'").get().c;
    const checkoutCancelled = db.prepare("SELECT COUNT(*) as c FROM checkout_events WHERE event = 'cancelled'").get().c;
    const checkoutFailed = db.prepare("SELECT COUNT(*) as c FROM checkout_events WHERE event = 'failed'").get().c;

    res.json({
      clicks: { total: totalClicks, today: clicksToday, bySource: clicksBySource, topUsers: topClickers },
      checkout: { started: checkoutStarted, completed: checkoutCompleted, cancelled: checkoutCancelled, failed: checkoutFailed },
    });
  } catch (err) {
    logger.error('Admin tracking-stats error', { error: err.message });
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/user-activity', adminAuth, (req, res) => {
  try {
    const users = db.prepare(`
      SELECT u.id, u.email, u.is_premium,
        (SELECT COUNT(*) FROM deal_search_history WHERE user_id = u.id) as search_count,
        (SELECT MAX(searched_at) FROM deal_search_history WHERE user_id = u.id) as last_search_at,
        (SELECT COUNT(*) FROM notification_log WHERE user_id = u.id) as notification_count,
        (SELECT MAX(created_at) FROM notification_log WHERE user_id = u.id) as last_notification_at
      FROM users u ORDER BY u.id
    `).all();
    res.json(users);
  } catch (err) {
    logger.error('Admin user-activity error', { error: err.message });
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/user-searches/:userId', adminAuth, (req, res) => {
  try {
    const searches = db.prepare(
      'SELECT query, results_count, searched_at FROM deal_search_history WHERE user_id = ? ORDER BY searched_at DESC LIMIT 50'
    ).all(req.params.userId);
    res.json(searches);
  } catch (err) {
    logger.error('Admin user-searches error', { error: err.message });
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/user-clicks/:userId', adminAuth, (req, res) => {
  try {
    const clicks = db.prepare(
      'SELECT post_id, permalink, source, clicked_at FROM deal_clicks WHERE user_id = ? ORDER BY clicked_at DESC LIMIT 50'
    ).all(req.params.userId);
    res.json(clicks);
  } catch (err) {
    logger.error('Admin user-clicks error', { error: err.message });
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/user-checkout-events/:userId', adminAuth, (req, res) => {
  try {
    const events = db.prepare(
      'SELECT event, plan, payment_method, created_at FROM checkout_events WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'
    ).all(req.params.userId);
    res.json(events);
  } catch (err) {
    logger.error('Admin user-checkout-events error', { error: err.message });
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/user-notifications/:userId', adminAuth, (req, res) => {
  try {
    const notifications = db.prepare(
      'SELECT type, channel, subject, body, created_at FROM notification_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'
    ).all(req.params.userId);
    res.json(notifications);
  } catch (err) {
    logger.error('Admin user-notifications error', { error: err.message });
    res.status(500).json({ error: 'Server error' });
  }
});

async function sendMarketingEmail(userId, email, subject, body) {
  try {
    const html = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
      <h2 style="color:#58a6ff">${subject.replace(/</g,'&lt;')}</h2>
      ${body.replace(/\n/g, '<br>')}
      <hr style="border:1px solid #30363d;margin:20px 0">
      <p style="color:#8b949e;font-size:0.8rem">
        <a href="https://mechalert-production.up.railway.app/pricing" style="color:#58a6ff">Upgrade to Premium</a> ·
        <a href="https://mechalert-production.up.railway.app/dashboard" style="color:#58a6ff">Dashboard</a>
      </p>
    </div>`;
    await sendEmail(email, subject, body, null, html);
    db.prepare('INSERT INTO notification_log (user_id, type, channel, subject, body) VALUES (?, ?, ?, ?, ?)')
      .run(userId, 'marketing', 'email', subject, body);
    return true;
  } catch (emailErr) {
    logger.error('Marketing email failed for', { email, error: emailErr.message });
    return false;
  }
}

router.post('/marketing-email', adminAuth, async (req, res) => {
  try {
    const { subject, body } = req.body;
    if (!subject || !body) return res.status(400).json({ error: 'Subject and body required' });

    const freeUsers = db.prepare("SELECT id, email FROM users WHERE is_premium = 0").all();
    if (!freeUsers.length) return res.json({ sent: 0, message: 'No free users to email' });

    res.json({ sent: 0, total: freeUsers.length, message: 'Sending in background...' });

    for (const u of freeUsers) {
      await sendMarketingEmail(u.id, u.email, subject, body);
    }
  } catch (err) {
    logger.error('Admin marketing-email error', { error: err.message });
  }
});

router.post('/user-email/:id', adminAuth, async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) return res.status(400).json({ error: 'Invalid user ID' });
    const { subject, body } = req.body;
    if (!subject || !body) return res.status(400).json({ error: 'Subject and body required' });

    const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    setImmediate(() => sendMarketingEmail(user.id, user.email, subject, body));
    res.json({ ok: true, message: 'Email queued' });
  } catch (err) {
    logger.error('Admin user-email error', { error: err.message });
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/email-check', adminAuth, async (req, res) => {
  try {
    const { email } = req.body;
    const targetEmail = email || ADMIN_EMAIL || 'kapil.saraswat981@gmail.com';
    const subject = `MechAlert - Email Check ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`;
    const body = 'This is an automated email check from MechAlert admin panel. If you receive this, email delivery is working correctly.';

    let sendGridCredits = null;
    if (process.env.SENDGRID_API_KEY) {
      try {
        const sgResp = await fetch('https://api.sendgrid.com/v3/user/credits', {
          headers: { Authorization: `Bearer ${process.env.SENDGRID_API_KEY}` },
        });
        if (sgResp.ok) {
          const data = await sgResp.json();
          sendGridCredits = { remain: data.remain, total: data.total, used: data.used, reset: data.last_reset };
        } else if (sgResp.status === 404) {
          const statsResp = await fetch(`https://api.sendgrid.com/v3/stats?aggregated_by=day&start_date=${new Date().toISOString().slice(0, 10)}&limit=1`, {
            headers: { Authorization: `Bearer ${process.env.SENDGRID_API_KEY}` },
          });
          if (statsResp.ok) {
            const stats = await statsResp.json();
            const sentToday = stats.reduce((sum, d) => sum + (d.stats?.[0]?.metrics?.delivered || 0), 0);
            sendGridCredits = { daily_sent: sentToday, note: 'Free plan - 100/day limit' };
          }
        }
      } catch { }
    }

    await sendEmail(targetEmail, subject, body);
    const adminUser = db.prepare("SELECT id FROM users WHERE is_admin = 1 LIMIT 1").get();
    if (adminUser) {
      db.prepare('INSERT INTO notification_log (user_id, type, channel, subject, body) VALUES (?, ?, ?, ?, ?)')
        .run(adminUser.id, 'email_check', 'email', subject, body);
    }

    res.json({
      ok: true,
      sent_to: targetEmail,
      method: process.env.SENDGRID_API_KEY ? 'sendgrid' : process.env.RESEND_API_KEY ? 'resend' : 'smtp',
      sendgrid: sendGridCredits,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('Admin email-check error', { error: err.message });
    res.status(500).json({ error: 'Server error', message: err.message });
  }
});

router.get('/email-status', adminAuth, async (req, res) => {
  try {
    let sendGridCredits = null;
    if (process.env.SENDGRID_API_KEY) {
      try {
        const sgResp = await fetch('https://api.sendgrid.com/v3/user/credits', {
          headers: { Authorization: `Bearer ${process.env.SENDGRID_API_KEY}` },
        });
        if (sgResp.ok) {
          const data = await sgResp.json();
          sendGridCredits = { remain: data.remain, total: data.total, used: data.used, reset: data.last_reset };
        } else if (sgResp.status === 404) {
          const statsResp = await fetch(`https://api.sendgrid.com/v3/stats?aggregated_by=day&start_date=${new Date().toISOString().slice(0, 10)}&limit=1`, {
            headers: { Authorization: `Bearer ${process.env.SENDGRID_API_KEY}` },
          });
          if (statsResp.ok) {
            const stats = await statsResp.json();
            const sentToday = stats.reduce((sum, d) => sum + (d.stats?.[0]?.metrics?.delivered || 0), 0);
            sendGridCredits = { daily_sent: sentToday, limit: 100, note: 'Free plan - 100/day limit' };
          }
        }
      } catch (e) { sendGridCredits = { error: e.message }; }
    }
    const todayLogs = db.prepare(`
      SELECT u.email, nl.type, nl.channel, nl.subject, nl.created_at
      FROM notification_log nl JOIN users u ON nl.user_id = u.id
      WHERE nl.created_at >= datetime('now', '-1 day')
      ORDER BY nl.created_at DESC
    `).all();
    const todayCount = todayLogs.length;
    res.json({ sendGridCredits, todayCount, logs: todayLogs, provider: process.env.SENDGRID_API_KEY ? 'sendgrid' : process.env.RESEND_API_KEY ? 'resend' : 'smtp' });
  } catch (err) {
    logger.error('Admin email-status error', { error: err.message });
    res.status(500).json({ error: 'Server error', message: err.message });
  }
});

router.post('/email-test', adminAuth, async (req, res) => {
  try {
    const targetEmail = 'kapil.saraswat981@gmail.com';
    const subject = `MechAlert Test Email ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`;
    const body = 'This is a test email from MechAlert admin panel. Your email delivery is working correctly.';
    await sendEmail(targetEmail, subject, body);
    const adminUser = db.prepare("SELECT id FROM users WHERE is_admin = 1 LIMIT 1").get();
    if (adminUser) {
      db.prepare('INSERT INTO notification_log (user_id, type, channel, subject, body) VALUES (?, ?, ?, ?, ?)')
        .run(adminUser.id, 'email_test', 'email', subject, body);
    }
    res.json({ ok: true, sent_to: targetEmail, method: process.env.SENDGRID_API_KEY ? 'sendgrid' : process.env.RESEND_API_KEY ? 'resend' : 'smtp', timestamp: new Date().toISOString() });
  } catch (err) {
    logger.error('Admin email-test error', { error: err.message });
    res.status(500).json({ error: 'Server error', message: err.message });
  }
});

export default router;
