import { Router } from 'express';
import Stripe from 'stripe';
import db from '../db.js';
import logger from '../logger.js';
import { jwtAuth } from '../middleware.js';

const router = Router();
const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

let allowedOrigins = null;

function getAllowedOrigins() {
  if (allowedOrigins) return allowedOrigins;

  const origins = new Set([BASE_URL, 'http://localhost:5173', 'http://localhost:3001']);

  if (process.env.ALLOWED_ORIGINS) {
    for (const o of process.env.ALLOWED_ORIGINS.split(',')) {
      const trimmed = o.trim();
      if (trimmed) origins.add(trimmed);
    }
  }

  allowedOrigins = origins;
  return allowedOrigins;
}

function isAllowedRedirect(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return getAllowedOrigins().has(parsed.origin);
  } catch {
    return false;
  }
}

router.post('/create-checkout', jwtAuth, async (req, res) => {
  try {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) return res.status(500).json({ error: 'Stripe not configured' });

    const stripe = new Stripe(stripeKey);
    const { priceId, successUrl, cancelUrl } = req.body;

    db.prepare('UPDATE users SET checkout_started_at = datetime(\'now\') WHERE id = ?').run(req.user.userId);

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: String(req.user.userId),
      customer_email: req.body.email,
      success_url: successUrl && isAllowedRedirect(successUrl) ? successUrl : `${BASE_URL}/dashboard?upgrade=success`,
      cancel_url: cancelUrl && isAllowedRedirect(cancelUrl) ? cancelUrl : `${BASE_URL}/pricing`,
    });

    res.json({ url: session.url });
  } catch (err) {
    logger.error('Stripe checkout error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.post('/portal', jwtAuth, async (req, res) => {
  try {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) return res.status(500).json({ error: 'Stripe not configured' });

    const stripe = new Stripe(stripeKey);

    const user = db.prepare('SELECT stripe_customer_id FROM users WHERE id = ?').get(req.user.userId);
    if (!user?.stripe_customer_id) return res.status(400).json({ error: 'No subscription found' });

    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripe_customer_id,
      return_url: `${BASE_URL}/dashboard`,
    });

    res.json({ url: session.url });
  } catch (err) {
    logger.error('Portal error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.post('/webhook', async (req, res) => {
  try {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) return res.status(500).json({ error: 'Stripe not configured' });

    const stripe = new Stripe(stripeKey);
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!endpointSecret) return res.status(500).json({ error: 'Webhook secret not configured' });

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
      logger.error('Webhook signature error', { error: err.message });
      return res.status(400).json({ error: err.message });
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const parsedId = parseInt(session.client_reference_id, 10);
        if (!isNaN(parsedId) && parsedId > 0) {
          db.prepare('UPDATE users SET is_premium = 1, stripe_customer_id = ? WHERE id = ?')
            .run(session.customer, parsedId);
          logger.info(`User ${parsedId} upgraded to premium (Stripe)`);
        }
        break;
      }
      case 'customer.subscription.deleted':
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const status = sub.status;
        const customerId = sub.customer;
        if (status === 'canceled' || status === 'unpaid' || status === 'incomplete_expired') {
          db.prepare('UPDATE users SET is_premium = 0 WHERE stripe_customer_id = ?')
            .run(customerId);
          logger.info(`Customer ${customerId} premium removed (${status})`);
        }
        break;
      }
    }

    res.json({ received: true });
  } catch (err) {
    logger.error('Stripe webhook error', { error: err.message });
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
