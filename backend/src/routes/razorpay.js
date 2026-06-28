import { Router } from 'express';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import db from '../db.js';
import logger from '../logger.js';
import { jwtAuth } from '../middleware.js';

const router = Router();

function getClient() {
  const key = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key || !secret) return null;
  return new Razorpay({ key_id: key, key_secret: secret });
}

function getAmount(plan) {
  if (plan === 'pro_plus') {
    return parseInt(process.env.RAZORPAY_PROPLUS_MONTHLY) || parseInt(process.env.RAZORPAY_AMOUNT_MONTHLY) || 39900;
  }
  return parseInt(process.env.RAZORPAY_PRO_MONTHLY) || parseInt(process.env.RAZORPAY_AMOUNT_MONTHLY) || 19900;
}

router.post('/create-order', jwtAuth, async (req, res) => {
  try {
    const client = getClient();
    if (!client) return res.status(500).json({ error: 'Razorpay not configured' });

    const { plan } = req.body;
    if (!plan || !['pro', 'pro_plus'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan.' });
    }

    const amount = getAmount(plan);
    db.prepare("INSERT INTO checkout_events (user_id, event, plan, payment_method) VALUES (?, 'started', ?, 'razorpay')").run(req.user.userId, plan);
    const order = await client.orders.create({
      amount,
      currency: 'INR',
      receipt: `receipt_${req.user.userId}_${Date.now()}`,
      notes: { userId: String(req.user.userId), plan },
    });

    db.prepare('UPDATE users SET checkout_started_at = datetime(\'now\') WHERE id = ?').run(req.user.userId);

    res.json({
      order_id: order.id,
      razorpay_key: process.env.RAZORPAY_KEY_ID,
      amount,
      currency: 'INR',
      plan,
    });
  } catch (err) {
    logger.error('Razorpay create-order error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.post('/cancel-order', jwtAuth, (req, res) => {
  try {
    const { plan } = req.body || {};
    db.prepare("INSERT INTO checkout_events (user_id, event, plan, payment_method) VALUES (?, 'cancelled', ?, 'razorpay')").run(req.user.userId, plan || 'pro');
    res.json({ ok: true });
  } catch {
    res.json({ ok: true });
  }
});

router.post('/webhook', async (req, res) => {
  try {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) return res.status(500).json({ error: 'Webhook not configured' });

    const signature = req.headers['x-razorpay-signature'];
    if (!signature) return res.status(400).json({ error: 'Missing signature' });

    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(req.body)
      .digest('hex');

    if (expectedSig !== signature) {
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const event = JSON.parse(req.body);
    const eventName = event.event;

    switch (eventName) {
      case 'payment.captured': {
        const payment = event.payload.payment.entity;
        const notes = payment.notes || {};
        const parsedId = parseInt(notes.userId, 10);
        const orderId = payment.order_id;

        if (!isNaN(parsedId) && parsedId > 0 && orderId) {
          db.prepare(
            "UPDATE users SET is_premium = 1, payment_provider = ?, provider_subscription_id = ?, subscription_ends_at = datetime('now', '+30 days') WHERE id = ?"
          ).run('razorpay', orderId, parsedId);
          try { const p = event.payload.payment.entity; db.prepare("INSERT INTO checkout_events (user_id, event, plan, payment_method) VALUES (?, 'completed', ?, 'razorpay')").run(parsedId, (p.notes?.plan || 'pro')); } catch {}
          logger.info(`User ${parsedId} upgraded to premium (Razorpay)`);
        }
        break;
      }
      case 'payment.failed': {
        const payment = event.payload.payment.entity;
        const notes = payment.notes || {};
        const parsedId = parseInt(notes.userId, 10);
        if (!isNaN(parsedId) && parsedId > 0) {
          db.prepare("UPDATE users SET is_premium = 0 WHERE id = ?").run(parsedId);
          try { db.prepare("INSERT INTO checkout_events (user_id, event, plan, payment_method) VALUES (?, 'failed', ?, 'razorpay')").run(parsedId, (notes.plan || 'pro')); } catch {}
          logger.info(`User ${parsedId} premium removed (Razorpay failed)`);
        }
        break;
      }
    }

    res.json({ received: true });
  } catch (err) {
    logger.error('Razorpay webhook error', { error: err.message });
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/verify', jwtAuth, async (req, res) => {
  try {
    const { razorpay_payment_id, razorpay_order_id, razorpay_signature, plan } = req.body;

    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Missing payment details' });
    }

    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSig = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    if (expectedSig !== razorpay_signature) {
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const tier = plan === 'pro_plus' ? 'pro_plus' : 'pro';
    db.prepare(
      "UPDATE users SET is_premium = 1, tier = ?, payment_provider = ?, provider_subscription_id = ?, subscription_ends_at = datetime('now', '+30 days') WHERE id = ?"
    ).run(tier, 'razorpay', razorpay_order_id, req.user.userId);
    db.prepare("INSERT INTO checkout_events (user_id, event, plan, payment_method) VALUES (?, 'completed', ?, 'razorpay')").run(req.user.userId, plan);

    logger.info(`User ${req.user.userId} upgraded to premium (Razorpay)`);
    res.json({ success: true });
  } catch (err) {
    logger.error('Razorpay verify error', { error: err.message });
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
