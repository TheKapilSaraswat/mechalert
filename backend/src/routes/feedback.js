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

// Submit 👍 (relevant=1) or 👎 (relevant=0) feedback on a match
router.post('/', auth, (req, res) => {
  try {
    const { match_id, relevant } = req.body;
    if (!match_id || (relevant !== 0 && relevant !== 1)) {
      return res.status(400).json({ error: 'match_id (number) and relevant (0 or 1) required' });
    }
    const match = db.prepare('SELECT * FROM alert_matches WHERE id = ?').get(match_id);
    if (!match) return res.status(404).json({ error: 'Match not found' });
    const result = db.prepare(
      'INSERT OR REPLACE INTO feedback (user_id, match_id, relevant, created_at) VALUES (?, ?, ?, datetime(\'now\'))'
    ).run(req.user.userId, match_id, relevant);
    logger.info(`Feedback: user ${req.user.userId} marked match ${match_id} as ${relevant ? 'relevant' : 'irrelevant'}`);
    res.json({ ok: true });
  } catch (err) {
    logger.error('POST /feedback error', { error: err.message, userId: req.user?.userId });
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
