import { Router } from 'express';
import db from '../db.js';
import logger from '../logger.js';
import { sendEmail } from '../notifier.js';
import { jwtAuth } from '../middleware.js';

const router = Router();

router.put('/preference', jwtAuth, (req, res) => {
  try {
    const { frequency } = req.body;
    if (!['never', 'daily', 'weekly'].includes(frequency)) {
      return res.status(400).json({ error: 'Invalid frequency. Must be never, daily, or weekly.' });
    }
    db.prepare('UPDATE users SET digest_frequency = ? WHERE id = ?').run(frequency, req.user.userId);
    res.json({ ok: true, digest_frequency: frequency });
  } catch (err) {
    logger.error('PUT /digest/preference error', { error: err.message, userId: req.user?.userId });
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/send', jwtAuth, async (req, res) => {
  try {
    const user = db.prepare('SELECT id, email, is_premium, is_admin, digest_frequency, last_digest_at FROM users WHERE id = ?').get(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.is_premium && !user.is_admin) return res.status(403).json({ error: 'Email digest is a Premium feature.' });
    if (user.digest_frequency === 'never') return res.status(400).json({ error: 'Digest is disabled' });

    const period = user.digest_frequency === 'weekly' ? 7 : 1;
    const since = user.last_digest_at || new Date(Date.now() - period * 86400000).toISOString();

    const matches = db.prepare(`
      SELECT am.*, sp.title, sp.price, sp.permalink, sp.source, ar.keywords
      FROM alert_matches am
      JOIN scanned_posts sp ON am.post_id = sp.post_id
      JOIN alert_rules ar ON am.alert_rule_id = ar.id
      WHERE ar.user_id = ? AND am.sent_at >= ?
      ORDER BY am.sent_at DESC
    `).all(user.id, since);

    if (matches.length === 0) return res.json({ matches: 0, message: 'No new matches' });

    let html = `<h2>MechAlert Digest</h2><p>${matches.length} new matches since last digest.</p><table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;"><tr><th>Title</th><th>Price</th><th>Source</th><th>Keyword</th></tr>`;
    for (const m of matches) {
      html += `<tr><td><a href="${m.permalink}">${(m.title || '').substring(0, 60)}</a></td><td>${m.price ? '$' + m.price : '-'}</td><td>${m.source}</td><td>${m.matched_keyword}</td></tr>`;
    }
    html += '</table>';

    await sendEmail(user.email, 'Your MechAlert Digest', '', '', html);

    db.prepare("UPDATE users SET last_digest_at = datetime('now') WHERE id = ?").run(user.id);

    res.json({ matches: matches.length, sent: true });
  } catch (err) {
    logger.error('POST /digest/send error', { error: err.message, userId: req.user?.userId });
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
