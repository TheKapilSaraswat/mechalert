import { Router } from 'express';
import db from '../db.js';
import logger from '../logger.js';
import { jwtAuth } from '../middleware.js';

const router = Router();

function requirePremium(req, res, next) {
  const user = db.prepare('SELECT is_premium FROM users WHERE id = ?').get(req.user.userId);
  if (!user?.is_premium) return res.status(403).json({ error: 'Collections are a Premium feature.' });
  next();
}

router.get('/', jwtAuth, requirePremium, (req, res) => {
  try {
    const collections = db.prepare('SELECT * FROM deal_collections WHERE user_id = ? ORDER BY created_at DESC').all(req.user.userId);
    res.json(collections);
  } catch (err) {
    logger.error('GET /collections error', { error: err.message, userId: req.user?.userId });
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/', jwtAuth, requirePremium, (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Name is required' });
    }
    const result = db.prepare('INSERT INTO deal_collections (user_id, name) VALUES (?, ?)').run(req.user.userId, name.trim());
    const collection = db.prepare('SELECT * FROM deal_collections WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(collection);
  } catch (err) {
    logger.error('POST /collections error', { error: err.message, userId: req.user?.userId });
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id', jwtAuth, requirePremium, (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Name is required' });
    }
    const collection = db.prepare('SELECT * FROM deal_collections WHERE id = ? AND user_id = ?').get(req.params.id, req.user.userId);
    if (!collection) return res.status(404).json({ error: 'Not found' });
    db.prepare('UPDATE deal_collections SET name = ? WHERE id = ?').run(name.trim(), req.params.id);
    const updated = db.prepare('SELECT * FROM deal_collections WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    logger.error('PUT /collections error', { error: err.message, userId: req.user?.userId });
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id', jwtAuth, requirePremium, (req, res) => {
  try {
    const result = db.prepare('DELETE FROM deal_collections WHERE id = ? AND user_id = ?').run(req.params.id, req.user.userId);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    logger.error('DELETE /collections error', { error: err.message, userId: req.user?.userId });
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:id/items', jwtAuth, requirePremium, (req, res) => {
  try {
    const collection = db.prepare('SELECT * FROM deal_collections WHERE id = ? AND user_id = ?').get(req.params.id, req.user.userId);
    if (!collection) return res.status(404).json({ error: 'Not found' });
    const items = db.prepare(`
      SELECT dci.*, sd.post_id, sd.notes, sd.created_at as saved_at, sp.title, sp.price, sp.permalink, sp.deal_score, sp.source, sp.image_url
      FROM deal_collection_items dci
      JOIN saved_deals sd ON dci.saved_deal_id = sd.id
      JOIN scanned_posts sp ON sd.post_id = sp.post_id
      WHERE dci.collection_id = ?
      ORDER BY dci.added_at DESC
    `).all(req.params.id);
    res.json(items);
  } catch (err) {
    logger.error('GET /collections/:id/items error', { error: err.message, userId: req.user?.userId });
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/items', jwtAuth, requirePremium, (req, res) => {
  try {
    const { saved_deal_id } = req.body || {};
    if (!saved_deal_id) return res.status(400).json({ error: 'saved_deal_id is required' });
    const collection = db.prepare('SELECT * FROM deal_collections WHERE id = ? AND user_id = ?').get(req.params.id, req.user.userId);
    if (!collection) return res.status(404).json({ error: 'Collection not found' });
    const savedDeal = db.prepare('SELECT id FROM saved_deals WHERE id = ? AND user_id = ?').get(saved_deal_id, req.user.userId);
    if (!savedDeal) return res.status(404).json({ error: 'Saved deal not found' });
    const existing = db.prepare('SELECT id FROM deal_collection_items WHERE collection_id = ? AND saved_deal_id = ?').get(req.params.id, saved_deal_id);
    if (existing) return res.status(409).json({ error: 'Already in collection' });
    const result = db.prepare('INSERT INTO deal_collection_items (collection_id, saved_deal_id) VALUES (?, ?)').run(req.params.id, saved_deal_id);
    const item = db.prepare('SELECT * FROM deal_collection_items WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(item);
  } catch (err) {
    logger.error('POST /collections/:id/items error', { error: err.message, userId: req.user?.userId });
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/items/:itemId', jwtAuth, requirePremium, (req, res) => {
  try {
    const item = db.prepare(`
      SELECT dci.* FROM deal_collection_items dci
      JOIN deal_collections dc ON dci.collection_id = dc.id
      WHERE dci.id = ? AND dc.user_id = ?
    `).get(req.params.itemId, req.user.userId);
    if (!item) return res.status(404).json({ error: 'Not found' });
    db.prepare('DELETE FROM deal_collection_items WHERE id = ?').run(req.params.itemId);
    res.json({ ok: true });
  } catch (err) {
    logger.error('DELETE /collections/items/:itemId error', { error: err.message, userId: req.user?.userId });
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
