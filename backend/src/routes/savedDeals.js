import { Router } from 'express';
import db from '../db.js';
import logger from '../logger.js';
import { validate, createSavedDealSchema, updateSavedDealSchema } from '../validation.js';
import { jwtAuth } from '../middleware.js';

const router = Router();

router.get('/', jwtAuth, (req, res) => {
  try {
    const deals = db.prepare(`
      SELECT sd.*, sp.title, sp.price, sp.permalink, sp.deal_score, sp.source, sp.image_url, sp.scanned_at
      FROM saved_deals sd
      JOIN scanned_posts sp ON sd.post_id = sp.post_id
      WHERE sd.user_id = ?
      ORDER BY sd.created_at DESC
      LIMIT 100
    `).all(req.user.userId);
    res.json(deals);
  } catch (err) {
    logger.error('GET /saved-deals error', { error: err.message, userId: req.user?.userId });
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/', jwtAuth, validate(createSavedDealSchema), (req, res) => {
  try {
    const { post_id, notes } = req.validated;
    const post = db.prepare('SELECT post_id FROM scanned_posts WHERE post_id = ?').get(post_id);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const existing = db.prepare('SELECT id FROM saved_deals WHERE user_id = ? AND post_id = ?').get(req.user.userId, post_id);
    if (existing) return res.status(409).json({ error: 'Already saved' });

    db.prepare(
      'INSERT INTO saved_deals (user_id, post_id, notes) VALUES (?, ?, ?)'
    ).run(req.user.userId, post_id, notes || null);
    res.status(201).json({ ok: true });
  } catch (err) {
    logger.error('POST /saved-deals error', { error: err.message, userId: req.user?.userId });
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id', jwtAuth, validate(updateSavedDealSchema), (req, res) => {
  try {
    const deal = db.prepare('SELECT * FROM saved_deals WHERE id = ? AND user_id = ?').get(req.params.id, req.user.userId);
    if (!deal) return res.status(404).json({ error: 'Not found' });

    const { notes } = req.validated;
    db.prepare('UPDATE saved_deals SET notes = ? WHERE id = ?').run(notes || null, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    logger.error('PUT /saved-deals error', { error: err.message, userId: req.user?.userId });
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id', jwtAuth, (req, res) => {
  try {
    const result = db.prepare('DELETE FROM saved_deals WHERE id = ? AND user_id = ?').run(req.params.id, req.user.userId);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    logger.error('DELETE /saved-deals error', { error: err.message, userId: req.user?.userId });
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;