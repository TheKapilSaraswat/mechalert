import { Router } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
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

// Get or create referral code for current user
router.get('/code', auth, (req, res) => {
  try {
    let user = db.prepare('SELECT id, referral_code FROM users WHERE id = ?').get(req.user.userId);
    if (!user.referral_code) {
      const code = crypto.randomBytes(4).toString('hex');
      db.prepare('UPDATE users SET referral_code = ? WHERE id = ?').run(code, req.user.userId);
      user = db.prepare('SELECT id, referral_code FROM users WHERE id = ?').get(req.user.userId);
    }
    res.json({ code: user.referral_code, url: `https://mechalert.app?ref=${user.referral_code}` });
  } catch (err) {
    logger.error('GET /referrals/code error', { error: err.message, userId: req.user?.userId });
    res.status(500).json({ error: 'Server error' });
  }
});

// Claim referral code (used by new user at signup)
router.post('/claim', auth, (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Referral code required' });

    const referrer = db.prepare('SELECT id, is_premium FROM users WHERE referral_code = ?').get(code);
    if (!referrer) return res.status(404).json({ error: 'Invalid referral code' });
    if (referrer.id === req.user.userId) return res.status(400).json({ error: 'Cannot refer yourself' });

    const existing = db.prepare('SELECT id FROM referral_claims WHERE claimed_user_id = ?').get(req.user.userId);
    if (existing) return res.status(409).json({ error: 'Already claimed a referral' });

    // Grant referrer 1 month Pro
    const refCount = db.prepare('SELECT COUNT(*) as c FROM referral_claims WHERE referrer_id = ?').get(referrer.id).c;

    db.prepare('INSERT INTO referral_claims (referrer_id, claimed_user_id) VALUES (?, ?)').run(referrer.id, req.user.userId);
    db.prepare('UPDATE users SET referrer_id = ? WHERE id = ?').run(referrer.id, req.user.userId);

    // First referral gives 1 month Pro
    if (refCount === 0) {
      db.prepare('UPDATE users SET is_premium = 1 WHERE id = ?').run(referrer.id);
      logger.info(`Referral: user ${referrer.id} got 1mo Pro for referring user ${req.user.userId}`);
    }

    logger.info(`Referral: user ${req.user.userId} claimed code ${code} from user ${referrer.id}`);
    res.json({ ok: true, reward: refCount === 0 ? 'You got 1 month Pro!' : null });
  } catch (err) {
    logger.error('POST /referrals/claim error', { error: err.message, userId: req.user?.userId });
    res.status(500).json({ error: 'Server error' });
  }
});

// Get referral stats for current user
router.get('/stats', auth, (req, res) => {
  try {
    const invitesSent = db.prepare('SELECT COUNT(*) as c FROM referral_claims WHERE referrer_id = ?').get(req.user.userId).c;
    const claimedUsers = db.prepare(`
      SELECT rc.created_at, u.email FROM referral_claims rc
      JOIN users u ON rc.claimed_user_id = u.id
      WHERE rc.referrer_id = ?
      ORDER BY rc.created_at DESC
    `).all(req.user.userId);
    res.json({ invitesSent, claimedUsers });
  } catch (err) {
    logger.error('GET /referrals/stats error', { error: err.message, userId: req.user?.userId });
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
