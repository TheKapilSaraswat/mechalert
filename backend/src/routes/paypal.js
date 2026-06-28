import { Router } from 'express';
import db from '../db.js';
import logger from '../logger.js';
import { jwtAuth } from '../middleware.js';

const router = Router();
const PAYPAL_API = process.env.PAYPAL_SANDBOX === 'true'
  ? 'https://api-m.sandbox.paypal.com'
  : 'https://api-m.paypal.com';

async function getAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !secret) return null;

  const basic = Buffer.from(`${clientId}:${secret}`).toString('base64');
  const res = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PayPal jwtAuth failed: ${text}`);
  }

  const data = await res.json();
  return data.access_token;
}

function getPrice() {
  return process.env.PAYPAL_PRO_MONTHLY || '2.99';
}

router.post('/create-order', jwtAuth, async (req, res) => {
  try {
    const token = await getAccessToken();
    if (!token) return res.status(500).json({ error: 'PayPal not configured' });

    const { plan } = req.body;
    if (!plan || plan !== 'pro') {
      return res.status(400).json({ error: 'Invalid plan.' });
    }

    const price = getPrice();
    db.prepare("INSERT INTO checkout_events (user_id, event, plan, payment_method) VALUES (?, 'started', ?, 'paypal')").run(req.user.userId, plan);
    const orderRes = await fetch(`${PAYPAL_API}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          amount: { currency_code: 'USD', value: price },
          custom_id: String(req.user.userId),
          description: plan === 'yearly'
            ? 'MechAlert Premium Yearly'
            : 'MechAlert Premium Monthly',
        }],
        payment_source: {
          paypal: {
            experience_context: {
              payment_method_preference: 'IMMEDIATE_PAYMENT_REQUIRED',
              landing_page: 'LOGIN',
              user_action: 'PAY_NOW',
              return_url: `${process.env.BASE_URL}/api/paypal/return?userId=${req.user.userId}&plan=${plan}`,
              cancel_url: `${process.env.BASE_URL}/pricing`,
            },
          },
        },
      }),
    });

    const orderData = await orderRes.json();
    if (!orderRes.ok) {
      throw new Error(`PayPal order error: ${orderData.message || JSON.stringify(orderData)}`);
    }

    const approvalLink = orderData.links?.find(l => l.rel === 'payer-action')?.href;

    db.prepare('UPDATE users SET checkout_started_at = datetime(\'now\') WHERE id = ?').run(req.user.userId);

    res.json({
      order_id: orderData.id,
      approval_url: approvalLink,
    });
  } catch (err) {
    logger.error('PayPal create-order error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.post('/capture-order', jwtAuth, async (req, res) => {
  try {
    const token = await getAccessToken();
    if (!token) return res.status(500).json({ error: 'PayPal not configured' });

    const { order_id, plan } = req.body;
    if (!order_id) return res.status(400).json({ error: 'Missing order_id' });

    const captureRes = await fetch(`${PAYPAL_API}/v2/checkout/orders/${order_id}/capture`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    const captureData = await captureRes.json();
    if (!captureRes.ok) {
      throw new Error(`PayPal capture error: ${captureData.message || JSON.stringify(captureData)}`);
    }

    if (captureData.status === 'COMPLETED') {
        db.prepare(
        "UPDATE users SET is_premium = 1, tier = 'pro', payment_provider = ?, provider_subscription_id = ?, subscription_ends_at = datetime('now', '+30 days') WHERE id = ?"
      ).run('paypal', order_id, req.user.userId);
      db.prepare("INSERT INTO checkout_events (user_id, event, plan, payment_method) VALUES (?, 'completed', ?, 'paypal')").run(req.user.userId, plan);

      logger.info(`User ${req.user.userId} upgraded to premium (PayPal)`);
      return res.json({ success: true });
    }

    res.status(400).json({ error: `Payment not completed: ${captureData.status}` });
  } catch (err) {
    logger.error('PayPal capture error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.post('/webhook', async (req, res) => {
  try {
    const webhookId = process.env.PAYPAL_WEBHOOK_ID;
    if (!webhookId) return res.status(500).json({ error: 'Webhook not configured' });

    const token = await getAccessToken();
    if (!token) return res.status(500).json({ error: 'PayPal not configured' });

    const body = JSON.parse(req.body);
    const verifyRes = await fetch(`${PAYPAL_API}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jwtAuth_algo: req.headers['paypal-auth-algo'],
        cert_url: req.headers['paypal-cert-url'],
        transmission_id: req.headers['paypal-transmission-id'],
        transmission_sig: req.headers['paypal-transmission-sig'],
        transmission_time: req.headers['paypal-transmission-time'],
        webhook_id: webhookId,
        webhook_event: body,
      }),
    });

    const verifyData = await verifyRes.json();
    if (verifyData.verification_status !== 'SUCCESS') {
      logger.error('PayPal webhook verification failed', { status: verifyData.verification_status });
      return res.status(400).json({ error: 'Verification failed' });
    }

    const eventType = body.event_type;

    switch (eventType) {
      case 'PAYMENT.CAPTURE.COMPLETED': {
        const resource = body.resource;
        const customId = resource.custom_id;
        const captureId = resource.id;
        const parsedId = parseInt(customId, 10);
        if (customId && !isNaN(parsedId) && parsedId > 0) {
      db.prepare(
        "UPDATE users SET is_premium = 1, tier = 'pro', payment_provider = ?, provider_subscription_id = ?, subscription_ends_at = datetime('now', '+30 days') WHERE id = ?"
      ).run('paypal', captureId, parsedId);
      try { db.prepare("INSERT INTO checkout_events (user_id, event, plan, payment_method) VALUES (?, 'completed', ?, 'paypal')").run(parsedId, 'pro'); } catch {}
      logger.info(`User ${parsedId} upgraded to premium (PayPal capture completed)`);
        }
        break;
      }
      case 'PAYMENT.CAPTURE.DENIED':
      case 'PAYMENT.CAPTURE.REFUNDED':
      case 'PAYMENT.CAPTURE.REVERSED': {
        const resource = body.resource;
        const customId = resource.custom_id;
        const parsedId = parseInt(customId, 10);
        if (customId && !isNaN(parsedId) && parsedId > 0) {
          db.prepare("UPDATE users SET is_premium = 0 WHERE id = ?").run(parsedId);
          logger.info(`User ${parsedId} premium removed (${eventType})`);
        }
        break;
      }
    }

    res.json({ received: true });
  } catch (err) {
    logger.error('PayPal webhook error', { error: err.message });
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/return', async (req, res) => {
  try {
    const { token, userId, plan } = req.query;
    if (!token || !userId) {
      return res.redirect(`${process.env.BASE_URL || 'http://localhost:5173'}/pricing?error=missing_params`);
    }

    const parsedUserId = parseInt(userId, 10);
    if (isNaN(parsedUserId) || parsedUserId <= 0) {
      return res.redirect(`${process.env.BASE_URL || 'http://localhost:5173'}/pricing?error=invalid_user`);
    }

    const accessToken = await getAccessToken();
    if (!accessToken) {
      return res.redirect(`${process.env.BASE_URL || 'http://localhost:5173'}/pricing?error=config`);
    }

    const orderRes = await fetch(`${PAYPAL_API}/v2/checkout/orders/${token}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!orderRes.ok) {
      return res.redirect(`${process.env.BASE_URL || 'http://localhost:5173'}/pricing?error=invalid_order`);
    }

    const orderData = await orderRes.json();
    const purchaseUnit = orderData.purchase_units?.[0];
    const orderUserId = parseInt(purchaseUnit?.custom_id, 10);

    if (orderUserId !== parsedUserId) {
      logger.warn('PayPal return ID mismatch', { orderUserId, requestUserId: parsedUserId });
      return res.redirect(`${process.env.BASE_URL || 'http://localhost:5173'}/pricing?error=forbidden`);
    }

    const capturer = await fetch(`${PAYPAL_API}/v2/checkout/orders/${token}/capture`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    const captureData = await capturer.json();
    if (captureData.status === 'COMPLETED') {
      db.prepare(
        "UPDATE users SET is_premium = 1, tier = 'pro', payment_provider = ?, provider_subscription_id = ?, subscription_ends_at = datetime('now', '+30 days') WHERE id = ?"
      ).run('paypal', token, parsedUserId);
      logger.info(`User ${parsedUserId} upgraded to premium (PayPal return)`);
    }

    res.redirect(`${process.env.BASE_URL || 'http://localhost:5173'}/dashboard?upgrade=success`);
  } catch (err) {
    logger.error('PayPal return error', { error: err.message });
    res.redirect(`${process.env.BASE_URL || 'http://localhost:5173'}/pricing?error=payment_failed`);
  }
});

export default router;
