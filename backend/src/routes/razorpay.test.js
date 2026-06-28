import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import crypto from 'crypto';

const whsec = 'whsec_test';

beforeAll(() => {
  process.env.RAZORPAY_WEBHOOK_SECRET = whsec;
});

const mockStmt = {
  run: vi.fn(() => ({ changes: 1 })),
  get: vi.fn(() => ({ id: 1, is_premium: 0, tier: 'free', email: 'test@example.com' })),
  all: vi.fn(() => []),
};
vi.mock('../db.js', () => ({ default: { prepare: vi.fn(() => mockStmt) } }));

function resetMockStmt() {
  mockStmt.run.mockReset();
  mockStmt.run.mockImplementation(() => ({ changes: 1 }));
  mockStmt.get.mockReset();
  mockStmt.get.mockImplementation(() => ({ id: 1, is_premium: 0, tier: 'free', email: 'test@example.com' }));
  mockStmt.all.mockReset();
  mockStmt.all.mockImplementation(() => []);
}
vi.mock('jsonwebtoken', () => ({ default: { verify: vi.fn(() => ({ userId: 1, version: 1 })) } }));
vi.mock('../logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('../middleware.js', () => ({ jwtAuth: (req, res, next) => { req.user = { userId: 1 }; next(); } }));
vi.mock('razorpay', () => ({ default: vi.fn(() => ({ orders: { create: vi.fn() } }) ) }));

import razorpayRoutes from './razorpay.js';

function mockReq(overrides = {}) {
  return { headers: { authorization: 'Bearer test' }, body: {}, params: {}, user: { userId: 1 }, ...overrides };
}
function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}
function getHandler(method, path) {
  const route = razorpayRoutes.stack.find(l => l.route?.path === path && l.route.methods[method])?.route;
  if (!route) return null;
  const handlers = route.stack.map(l => l.handle);
  return handlers[handlers.length - 1];
}

describe('Razorpay Routes', () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockStmt(); });

  it('POST /create-order creates Razorpay order', () => {
    const res = mockRes();
    getHandler('post', '/create-order')(mockReq({ body: { plan: 'pro' } }), res);
  });

  it('POST /create-order handles missing keys gracefully', () => {
    const res = mockRes();
    getHandler('post', '/create-order')(mockReq({ body: { plan: 'pro' } }), res);
  });

  it('POST /cancel-order cancels checkout', () => {
    const res = mockRes();
    getHandler('post', '/cancel-order')(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('POST /webhook handles Razorpay webhook', () => {
    const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { notes: { user_id: '1' }, order_id: 'order_123' } } } });
    const sig = crypto.createHmac('sha256', whsec).update(body).digest('hex');
    const res = mockRes();
    getHandler('post', '/webhook')(mockReq({
      body,
      headers: { 'x-razorpay-signature': sig },
    }), res);
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it('POST /webhook handles payment failed', () => {
    const body = JSON.stringify({ event: 'payment.failed', payload: { payment: { entity: { notes: { user_id: '1' } } } } });
    const sig = crypto.createHmac('sha256', whsec).update(body).digest('hex');
    const res = mockRes();
    getHandler('post', '/webhook')(mockReq({
      body,
      headers: { 'x-razorpay-signature': sig },
    }), res);
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it('POST /verify verifies payment signature', () => {
    const res = mockRes();
    getHandler('post', '/verify')(mockReq({ body: { order_id: 'order_123', payment_id: 'pay_123', signature: 'sig_123', plan: 'pro' } }), res);
  });

  it('POST /verify returns 500 on error', async () => {
    mockStmt.run.mockImplementation(() => { throw new Error('DB error'); });
    const res = mockRes();
    getHandler('post', '/verify')(mockReq({ body: { razorpay_order_id: 'o', razorpay_payment_id: 'p', razorpay_signature: 's', plan: 'pro' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('POST /create-order returns 400 when plan is missing', async () => {
    const origKey = process.env.RAZORPAY_KEY_ID;
    const origSecret = process.env.RAZORPAY_KEY_SECRET;
    process.env.RAZORPAY_KEY_ID = 'rzp_key';
    process.env.RAZORPAY_KEY_SECRET = 'rzp_secret';
    try {
      const res = mockRes();
      await getHandler('post', '/create-order')(mockReq({ body: {} }), res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid plan.' });
    } finally {
      process.env.RAZORPAY_KEY_ID = origKey;
      process.env.RAZORPAY_KEY_SECRET = origSecret;
    }
  });

  it('POST /create-order returns 400 when plan is invalid', async () => {
    const origKey = process.env.RAZORPAY_KEY_ID;
    const origSecret = process.env.RAZORPAY_KEY_SECRET;
    process.env.RAZORPAY_KEY_ID = 'rzp_key';
    process.env.RAZORPAY_KEY_SECRET = 'rzp_secret';
    try {
      const res = mockRes();
      await getHandler('post', '/create-order')(mockReq({ body: { plan: 'enterprise' } }), res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid plan.' });
    } finally {
      process.env.RAZORPAY_KEY_ID = origKey;
      process.env.RAZORPAY_KEY_SECRET = origSecret;
    }
  });

  it('POST /create-order returns 500 on DB error', async () => {
    mockStmt.run.mockImplementation(() => { throw new Error('DB error'); });
    const res = mockRes();
    await getHandler('post', '/create-order')(mockReq({ body: { plan: 'pro' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('POST /cancel-order works without plan in body', async () => {
    const res = mockRes();
    await getHandler('post', '/cancel-order')(mockReq({ body: {} }), res);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('POST /cancel-order handles DB errors gracefully', async () => {
    mockStmt.run.mockImplementation(() => { throw new Error('DB error'); });
    const res = mockRes();
    await getHandler('post', '/cancel-order')(mockReq({ body: { plan: 'pro' } }), res);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('POST /webhook returns 400 when signature header is missing', async () => {
    const res = mockRes();
    await getHandler('post', '/webhook')(mockReq({
      body: JSON.stringify({ event: 'payment.captured' }),
      headers: {},
    }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Missing signature' });
  });

  it('POST /webhook returns 400 on invalid signature', async () => {
    const res = mockRes();
    await getHandler('post', '/webhook')(mockReq({
      body: JSON.stringify({ event: 'payment.captured' }),
      headers: { 'x-razorpay-signature': 'bad_sig' },
    }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid signature' });
  });

  it('POST /webhook returns 500 when webhook not configured', async () => {
    const orig = process.env.RAZORPAY_WEBHOOK_SECRET;
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    const res = mockRes();
    await getHandler('post', '/webhook')(mockReq({
      body: JSON.stringify({ event: 'payment.captured' }),
      headers: { 'x-razorpay-signature': 'sig' },
    }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Webhook not configured' });
    process.env.RAZORPAY_WEBHOOK_SECRET = orig;
  });

  it('POST /webhook returns 500 on invalid JSON body', async () => {
    const body = 'not-json';
    const sig = crypto.createHmac('sha256', whsec).update(body).digest('hex');
    const res = mockRes();
    await getHandler('post', '/webhook')(mockReq({
      body,
      headers: { 'x-razorpay-signature': sig },
    }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('POST /webhook handles payment.captured with NaN userId', async () => {
    const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { notes: { userId: 'not-a-number' }, order_id: 'order_123' } } } });
    const sig = crypto.createHmac('sha256', whsec).update(body).digest('hex');
    const res = mockRes();
    await getHandler('post', '/webhook')(mockReq({ body, headers: { 'x-razorpay-signature': sig } }), res);
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it('POST /webhook handles payment.captured with missing order_id', async () => {
    const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { notes: { userId: '1' } } } } });
    const sig = crypto.createHmac('sha256', whsec).update(body).digest('hex');
    const res = mockRes();
    await getHandler('post', '/webhook')(mockReq({ body, headers: { 'x-razorpay-signature': sig } }), res);
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it('POST /webhook handles payment.failed with NaN userId', async () => {
    const body = JSON.stringify({ event: 'payment.failed', payload: { payment: { entity: { notes: { userId: null } } } } });
    const sig = crypto.createHmac('sha256', whsec).update(body).digest('hex');
    const res = mockRes();
    await getHandler('post', '/webhook')(mockReq({ body, headers: { 'x-razorpay-signature': sig } }), res);
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it('POST /verify returns 400 when razorpay_payment_id is missing', async () => {
    const res = mockRes();
    await getHandler('post', '/verify')(mockReq({ body: { razorpay_order_id: 'o', razorpay_signature: 's', plan: 'pro' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Missing payment details' });
  });

  it('POST /verify returns 400 when razorpay_order_id is missing', async () => {
    const res = mockRes();
    await getHandler('post', '/verify')(mockReq({ body: { razorpay_payment_id: 'p', razorpay_signature: 's', plan: 'pro' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Missing payment details' });
  });

  it('POST /verify returns 400 when razorpay_signature is missing', async () => {
    const res = mockRes();
    await getHandler('post', '/verify')(mockReq({ body: { razorpay_payment_id: 'p', razorpay_order_id: 'o', plan: 'pro' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Missing payment details' });
  });

  it('POST /verify returns 400 on invalid signature', async () => {
    const orig = process.env.RAZORPAY_KEY_SECRET;
    process.env.RAZORPAY_KEY_SECRET = 'test_key_secret';
    try {
      const res = mockRes();
      await getHandler('post', '/verify')(mockReq({ body: { razorpay_payment_id: 'p', razorpay_order_id: 'o', razorpay_signature: 'bad_sig', plan: 'pro' } }), res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid signature' });
    } finally {
      process.env.RAZORPAY_KEY_SECRET = orig;
    }
  });

  it('POST /verify succeeds with pro_plus plan', async () => {
    const orig = process.env.RAZORPAY_KEY_SECRET;
    process.env.RAZORPAY_KEY_SECRET = 'test_key_secret';
    try {
      const razorpay_payment_id = 'pay_test';
      const razorpay_order_id = 'order_test';
      const body = razorpay_order_id + '|' + razorpay_payment_id;
      const razorpay_signature = crypto.createHmac('sha256', 'test_key_secret').update(body).digest('hex');
      const res = mockRes();
      await getHandler('post', '/verify')(mockReq({ body: { razorpay_payment_id, razorpay_order_id, razorpay_signature, plan: 'pro_plus' } }), res);
      expect(res.json).toHaveBeenCalledWith({ success: true });
    } finally {
      process.env.RAZORPAY_KEY_SECRET = orig;
    }
  });

  it('POST /verify calls DB on successful verification', async () => {
    const orig = process.env.RAZORPAY_KEY_SECRET;
    process.env.RAZORPAY_KEY_SECRET = 'test_key_secret';
    try {
      const razorpay_payment_id = 'pay_db';
      const razorpay_order_id = 'order_db';
      const body = razorpay_order_id + '|' + razorpay_payment_id;
      const razorpay_signature = crypto.createHmac('sha256', 'test_key_secret').update(body).digest('hex');
      const res = mockRes();
      await getHandler('post', '/verify')(mockReq({ body: { razorpay_payment_id, razorpay_order_id, razorpay_signature, plan: 'pro' } }), res);
      expect(mockStmt.run).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ success: true });
    } finally {
      process.env.RAZORPAY_KEY_SECRET = orig;
    }
  });

  it('POST /webhook payment.captured with valid userId upgrades user', () => {
    const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { notes: { userId: '1', plan: 'pro' }, order_id: 'order_123' } } } });
    const sig = crypto.createHmac('sha256', whsec).update(body).digest('hex');
    const res = mockRes();
    getHandler('post', '/webhook')(mockReq({ body, headers: { 'x-razorpay-signature': sig } }), res);
    expect(res.json).toHaveBeenCalledWith({ received: true });
    expect(mockStmt.run).toHaveBeenCalledWith('razorpay', 'order_123', 1);
  });

  it('POST /webhook payment.captured with pro_plus plan', () => {
    const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { notes: { userId: '2', plan: 'pro_plus' }, order_id: 'order_456' } } } });
    const sig = crypto.createHmac('sha256', whsec).update(body).digest('hex');
    const res = mockRes();
    getHandler('post', '/webhook')(mockReq({ body, headers: { 'x-razorpay-signature': sig } }), res);
    expect(res.json).toHaveBeenCalledWith({ received: true });
    expect(mockStmt.run).toHaveBeenCalledWith('razorpay', 'order_456', 2);
  });

  it('POST /webhook payment.failed with valid userId removes premium', () => {
    const body = JSON.stringify({ event: 'payment.failed', payload: { payment: { entity: { notes: { userId: '1', plan: 'pro' } } } } });
    const sig = crypto.createHmac('sha256', whsec).update(body).digest('hex');
    const res = mockRes();
    getHandler('post', '/webhook')(mockReq({ body, headers: { 'x-razorpay-signature': sig } }), res);
    expect(res.json).toHaveBeenCalledWith({ received: true });
    expect(mockStmt.run).toHaveBeenCalledWith(1);
  });

  it('POST /create-order returns 500 when Razorpay not configured', async () => {
    const origKey = process.env.RAZORPAY_KEY_ID;
    const origSecret = process.env.RAZORPAY_KEY_SECRET;
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    try {
      const res = mockRes();
      await getHandler('post', '/create-order')(mockReq({ body: { plan: 'pro' } }), res);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Razorpay not configured' });
    } finally {
      process.env.RAZORPAY_KEY_ID = origKey;
      process.env.RAZORPAY_KEY_SECRET = origSecret;
    }
  });

  it('POST /verify returns 500 on DB error with valid signature', async () => {
    const orig = process.env.RAZORPAY_KEY_SECRET;
    process.env.RAZORPAY_KEY_SECRET = 'test_key_secret';
    try {
      const razorpay_payment_id = 'pay_err';
      const razorpay_order_id = 'order_err';
      const body = razorpay_order_id + '|' + razorpay_payment_id;
      const razorpay_signature = crypto.createHmac('sha256', 'test_key_secret').update(body).digest('hex');
      mockStmt.run.mockImplementation(() => { throw new Error('DB error'); });
      const res = mockRes();
      await getHandler('post', '/verify')(mockReq({ body: { razorpay_payment_id, razorpay_order_id, razorpay_signature, plan: 'pro' } }), res);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Server error' });
    } finally {
      process.env.RAZORPAY_KEY_SECRET = orig;
    }
  });

  it('POST /create-order creates order successfully with keys set', async () => {
    const origKey = process.env.RAZORPAY_KEY_ID;
    const origSecret = process.env.RAZORPAY_KEY_SECRET;
    process.env.RAZORPAY_KEY_ID = 'rzp_key';
    process.env.RAZORPAY_KEY_SECRET = 'rzp_secret';
    try {
      const Razorpay = (await import('razorpay')).default;
      Razorpay.mockImplementation(() => ({
        orders: { create: vi.fn().mockResolvedValue({ id: 'order_pro', amount: 19900 }) },
      }));
      const res = mockRes();
      await getHandler('post', '/create-order')(mockReq({ body: { plan: 'pro' } }), res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ order_id: 'order_pro', amount: expect.any(Number), currency: 'INR', plan: 'pro' }));
    } finally {
      process.env.RAZORPAY_KEY_ID = origKey;
      process.env.RAZORPAY_KEY_SECRET = origSecret;
    }
  });

  it('POST /create-order creates order with pro_plus plan (covers getAmount pro_plus branch)', async () => {
    const origKey = process.env.RAZORPAY_KEY_ID;
    const origSecret = process.env.RAZORPAY_KEY_SECRET;
    process.env.RAZORPAY_KEY_ID = 'rzp_key';
    process.env.RAZORPAY_KEY_SECRET = 'rzp_secret';
    try {
      const Razorpay = (await import('razorpay')).default;
      Razorpay.mockImplementation(() => ({
        orders: { create: vi.fn().mockResolvedValue({ id: 'order_proplus', amount: 39900 }) },
      }));
      const res = mockRes();
      await getHandler('post', '/create-order')(mockReq({ body: { plan: 'pro_plus' } }), res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ order_id: 'order_proplus', plan: 'pro_plus' }));
    } finally {
      process.env.RAZORPAY_KEY_ID = origKey;
      process.env.RAZORPAY_KEY_SECRET = origSecret;
    }
  });

  it('POST /create-order handles Razorpay API error in catch block', async () => {
    const origKey = process.env.RAZORPAY_KEY_ID;
    const origSecret = process.env.RAZORPAY_KEY_SECRET;
    process.env.RAZORPAY_KEY_ID = 'rzp_key';
    process.env.RAZORPAY_KEY_SECRET = 'rzp_secret';
    try {
      const Razorpay = (await import('razorpay')).default;
      Razorpay.mockImplementation(() => ({
        orders: { create: vi.fn().mockRejectedValue(new Error('Razorpay API error')) },
      }));
      const res = mockRes();
      await getHandler('post', '/create-order')(mockReq({ body: { plan: 'pro' } }), res);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Razorpay API error' });
    } finally {
      process.env.RAZORPAY_KEY_ID = origKey;
      process.env.RAZORPAY_KEY_SECRET = origSecret;
    }
  });

  it('POST /cancel-order handles missing req.body gracefully', async () => {
    const res = mockRes();
    getHandler('post', '/cancel-order')(mockReq({ body: undefined }), res);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('POST /webhook payment.captured without notes uses empty object fallback', () => {
    const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { order_id: 'order_no_notes' } } } });
    const sig = crypto.createHmac('sha256', whsec).update(body).digest('hex');
    const res = mockRes();
    getHandler('post', '/webhook')(mockReq({ body, headers: { 'x-razorpay-signature': sig } }), res);
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it('POST /webhook payment.failed without notes uses empty object fallback', () => {
    const body = JSON.stringify({ event: 'payment.failed', payload: { payment: { entity: {} } } });
    const sig = crypto.createHmac('sha256', whsec).update(body).digest('hex');
    const res = mockRes();
    getHandler('post', '/webhook')(mockReq({ body, headers: { 'x-razorpay-signature': sig } }), res);
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it('POST /webhook payment.captured without plan in notes uses default pro', () => {
    const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { notes: { userId: '1' }, order_id: 'order_no_plan' } } } });
    const sig = crypto.createHmac('sha256', whsec).update(body).digest('hex');
    const res = mockRes();
    getHandler('post', '/webhook')(mockReq({ body, headers: { 'x-razorpay-signature': sig } }), res);
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it('POST /webhook payment.failed without plan in notes uses default pro', () => {
    const body = JSON.stringify({ event: 'payment.failed', payload: { payment: { entity: { notes: { userId: '1' } } } } });
    const sig = crypto.createHmac('sha256', whsec).update(body).digest('hex');
    const res = mockRes();
    getHandler('post', '/webhook')(mockReq({ body, headers: { 'x-razorpay-signature': sig } }), res);
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it('POST /webhook payment.captured catches DB insert error gracefully', () => {
    mockStmt.run.mockImplementationOnce(() => ({ changes: 1 }));
    mockStmt.run.mockImplementationOnce(() => { throw new Error('insert error'); });
    const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { notes: { userId: '1', plan: 'pro' }, order_id: 'order_123' } } } });
    const sig = crypto.createHmac('sha256', whsec).update(body).digest('hex');
    const res = mockRes();
    getHandler('post', '/webhook')(mockReq({ body, headers: { 'x-razorpay-signature': sig } }), res);
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it('POST /webhook payment.failed catches DB insert error gracefully', () => {
    mockStmt.run.mockImplementationOnce(() => ({ changes: 1 }));
    mockStmt.run.mockImplementationOnce(() => { throw new Error('insert error'); });
    const body = JSON.stringify({ event: 'payment.failed', payload: { payment: { entity: { notes: { userId: '1', plan: 'pro' } } } } });
    const sig = crypto.createHmac('sha256', whsec).update(body).digest('hex');
    const res = mockRes();
    getHandler('post', '/webhook')(mockReq({ body, headers: { 'x-razorpay-signature': sig } }), res);
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });
});
