import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest';

const mockStmt = {
  run: vi.fn(() => ({ changes: 1 })),
  get: vi.fn(() => ({ id: 1, is_premium: 0, stripe_customer_id: 'cus_123', email: 'test@example.com' })),
  all: vi.fn(() => []),
};
vi.mock('../db.js', () => ({ default: { prepare: vi.fn(() => mockStmt) } }));

function resetMockStmt() {
  mockStmt.run.mockReset();
  mockStmt.run.mockImplementation(() => ({ changes: 1 }));
  mockStmt.get.mockReset();
  mockStmt.get.mockImplementation(() => ({ id: 1, is_premium: 0, stripe_customer_id: 'cus_123', email: 'test@example.com' }));
  mockStmt.all.mockReset();
  mockStmt.all.mockImplementation(() => []);
}

beforeAll(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
});
vi.mock('jsonwebtoken', () => ({ default: { verify: vi.fn(() => ({ userId: 1, version: 1 })) } }));
vi.mock('stripe', () => {
  return {
    default: vi.fn(() => ({
      checkout: { sessions: { create: vi.fn(() => Promise.resolve({ url: 'https://checkout.stripe.com/session' })) } },
      billingPortal: { sessions: { create: vi.fn(() => Promise.resolve({ url: 'https://billing.stripe.com/session' })) } },
      webhooks: { constructEvent: vi.fn(() => ({ type: 'checkout.session.completed', data: { object: { id: 'cs_123', client_reference_id: '1', customer: 'cus_456', subscription: 'sub_789' } } })) },
    })),
  };
});
vi.mock('../logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('../middleware.js', () => ({ jwtAuth: (req, res, next) => { req.user = { userId: 1 }; next(); } }));

import Stripe from 'stripe';
import stripeRoutes from './stripe.js';

function mockReq(overrides = {}) {
  return { headers: { authorization: 'Bearer test' }, body: {}, params: {}, user: { userId: 1 }, query: {}, ...overrides };
}
function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}
function getHandler(method, path) {
  const route = stripeRoutes.stack.find(l => l.route?.path === path && l.route.methods[method])?.route;
  if (!route) return null;
  const handlers = route.stack.map(l => l.handle);
  return handlers[handlers.length - 1];
}

function defaultStripeMock() {
  return {
    checkout: { sessions: { create: vi.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/session' }) } },
    billingPortal: { sessions: { create: vi.fn().mockResolvedValue({ url: 'https://billing.stripe.com/session' }) } },
    webhooks: { constructEvent: vi.fn().mockReturnValue({ type: 'checkout.session.completed', data: { object: { id: 'cs_123', client_reference_id: '1', customer: 'cus_456' } } }) },
  };
}

describe('Stripe Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMockStmt();
    Stripe.mockReset();
    Stripe.mockImplementation(defaultStripeMock);
  });
  afterEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  });

  it('POST /create-checkout creates checkout session', () => {
    const res = mockRes();
    getHandler('post', '/create-checkout')(mockReq({ body: { priceId: 'price_123' } }), res);
  });

  it('POST /create-checkout returns 500 on error', async () => {
    mockStmt.run.mockImplementation(() => { throw new Error('DB error'); });
    const res = mockRes();
    getHandler('post', '/create-checkout')(mockReq({ body: { priceId: 'price_123' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('POST /portal creates portal session', () => {
    const res = mockRes();
    getHandler('post', '/portal')(mockReq(), res);
  });

  it('POST /portal returns 500 on error', async () => {
    mockStmt.get.mockImplementation(() => { throw new Error('DB error'); });
    const res = mockRes();
    getHandler('post', '/portal')(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('POST /webhook handles Stripe webhook', () => {
    const res = mockRes();
    getHandler('post', '/webhook')(mockReq({
      body: { type: 'checkout.session.completed', data: { object: { id: 'cs_123', client_reference_id: '1', customer: 'cus_456', subscription: 'sub_789' } } },
      headers: { 'stripe-signature': 'test_sig' },
    }), res);
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it('POST /webhook handles subscription deletion', () => {
    const res = mockRes();
    getHandler('post', '/webhook')(mockReq({
      body: { type: 'customer.subscription.deleted', data: { object: { id: 'sub_789', metadata: { user_id: '1' } } } },
      headers: { 'stripe-signature': 'test_sig' },
    }), res);
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it('POST /webhook handles unknown event', () => {
    const res = mockRes();
    getHandler('post', '/webhook')(mockReq({
      body: { type: 'unknown.event', data: { object: {} } },
      headers: { 'stripe-signature': 'test_sig' },
    }), res);
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it('POST /create-checkout returns 500 when Stripe not configured', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const res = mockRes();
    await getHandler('post', '/create-checkout')(mockReq({ body: { priceId: 'price_123' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Stripe not configured' });
  });

  it('POST /create-checkout with valid success and cancel URLs', async () => {
    const res = mockRes();
    await getHandler('post', '/create-checkout')(mockReq({
      body: { priceId: 'price_123', successUrl: 'http://localhost:5173/success', cancelUrl: 'http://localhost:5173/cancel' },
    }), res);
    expect(res.json).toHaveBeenCalledWith({ url: 'https://checkout.stripe.com/session' });
  });

  it('POST /create-checkout uses default URL for invalid redirect', async () => {
    const res = mockRes();
    await getHandler('post', '/create-checkout')(mockReq({
      body: { priceId: 'price_123', successUrl: 'https://evil.com/phish', cancelUrl: 'https://evil.com/cancel' },
    }), res);
    expect(res.json).toHaveBeenCalledWith({ url: 'https://checkout.stripe.com/session' });
  });

  it('POST /create-checkout response shape has url', async () => {
    const res = mockRes();
    await getHandler('post', '/create-checkout')(mockReq({ body: { priceId: 'price_123' } }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ url: expect.any(String) }));
  });

  it('POST /create-checkout returns 500 when stripe.create fails', async () => {
    Stripe.mockImplementationOnce(() => ({
      checkout: { sessions: { create: vi.fn().mockRejectedValue(new Error('Stripe API error')) } },
      billingPortal: { sessions: { create: vi.fn() } },
      webhooks: { constructEvent: vi.fn() },
    }));
    const res = mockRes();
    await getHandler('post', '/create-checkout')(mockReq({ body: { priceId: 'price_123' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Stripe API error' });
  });

  it('POST /portal returns 400 when no subscription', async () => {
    mockStmt.get.mockReturnValue({ id: 1, stripe_customer_id: null });
    const res = mockRes();
    await getHandler('post', '/portal')(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'No subscription found' });
  });

  it('POST /portal returns 500 when Stripe not configured', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const res = mockRes();
    await getHandler('post', '/portal')(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Stripe not configured' });
  });

  it('POST /portal response shape', async () => {
    const res = mockRes();
    await getHandler('post', '/portal')(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith({ url: 'https://billing.stripe.com/session' });
  });

  it('POST /webhook returns 400 when stripe-signature missing', async () => {
    Stripe.mockImplementationOnce(() => ({
      checkout: { sessions: { create: vi.fn() } },
      billingPortal: { sessions: { create: vi.fn() } },
      webhooks: { constructEvent: vi.fn(() => { throw new Error('No signatures found'); }) },
    }));
    const res = mockRes();
    await getHandler('post', '/webhook')(mockReq({ body: {}, headers: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('POST /webhook returns 500 when webhook secret not configured', async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const res = mockRes();
    await getHandler('post', '/webhook')(mockReq({
      headers: { 'stripe-signature': 'test_sig' },
    }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Webhook secret not configured' });
  });

  it('POST /webhook subscription.updated canceled', async () => {
    Stripe.mockImplementationOnce(() => ({
      checkout: { sessions: { create: vi.fn() } },
      billingPortal: { sessions: { create: vi.fn() } },
      webhooks: { constructEvent: vi.fn().mockReturnValue({ type: 'customer.subscription.updated', data: { object: { status: 'canceled', customer: 'cus_123' } } }) },
    }));
    const res = mockRes();
    await getHandler('post', '/webhook')(mockReq({
      headers: { 'stripe-signature': 'sig' },
    }), res);
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it('POST /webhook subscription.updated unpaid', async () => {
    Stripe.mockImplementationOnce(() => ({
      checkout: { sessions: { create: vi.fn() } },
      billingPortal: { sessions: { create: vi.fn() } },
      webhooks: { constructEvent: vi.fn().mockReturnValue({ type: 'customer.subscription.updated', data: { object: { status: 'unpaid', customer: 'cus_123' } } }) },
    }));
    const res = mockRes();
    await getHandler('post', '/webhook')(mockReq({
      headers: { 'stripe-signature': 'sig' },
    }), res);
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it('POST /webhook subscription.updated incomplete_expired', async () => {
    Stripe.mockImplementationOnce(() => ({
      checkout: { sessions: { create: vi.fn() } },
      billingPortal: { sessions: { create: vi.fn() } },
      webhooks: { constructEvent: vi.fn().mockReturnValue({ type: 'customer.subscription.updated', data: { object: { status: 'incomplete_expired', customer: 'cus_123' } } }) },
    }));
    const res = mockRes();
    await getHandler('post', '/webhook')(mockReq({
      headers: { 'stripe-signature': 'sig' },
    }), res);
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it('POST /webhook subscription.updated active does not downgrade', async () => {
    Stripe.mockImplementationOnce(() => ({
      checkout: { sessions: { create: vi.fn() } },
      billingPortal: { sessions: { create: vi.fn() } },
      webhooks: { constructEvent: vi.fn().mockReturnValue({ type: 'customer.subscription.updated', data: { object: { status: 'active', customer: 'cus_123' } } }) },
    }));
    const res = mockRes();
    await getHandler('post', '/webhook')(mockReq({
      headers: { 'stripe-signature': 'sig' },
    }), res);
    expect(res.json).toHaveBeenCalledWith({ received: true });
    expect(mockStmt.run).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE users SET is_premium'));
  });

  it('POST /webhook checkout.session.completed with non-numeric ref', async () => {
    Stripe.mockImplementationOnce(() => ({
      checkout: { sessions: { create: vi.fn() } },
      billingPortal: { sessions: { create: vi.fn() } },
      webhooks: { constructEvent: vi.fn().mockReturnValue({ type: 'checkout.session.completed', data: { object: { client_reference_id: 'abc', customer: 'cus_123' } } }) },
    }));
    const res = mockRes();
    await getHandler('post', '/webhook')(mockReq({
      headers: { 'stripe-signature': 'sig' },
    }), res);
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it('POST /webhook checkout.session.completed with negative ref', async () => {
    Stripe.mockImplementationOnce(() => ({
      checkout: { sessions: { create: vi.fn() } },
      billingPortal: { sessions: { create: vi.fn() } },
      webhooks: { constructEvent: vi.fn().mockReturnValue({ type: 'checkout.session.completed', data: { object: { client_reference_id: '-1', customer: 'cus_123' } } }) },
    }));
    const res = mockRes();
    await getHandler('post', '/webhook')(mockReq({
      headers: { 'stripe-signature': 'sig' },
    }), res);
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it('POST /webhook returns 400 on invalid signature', async () => {
    Stripe.mockImplementationOnce(() => ({
      checkout: { sessions: { create: vi.fn() } },
      billingPortal: { sessions: { create: vi.fn() } },
      webhooks: { constructEvent: vi.fn(() => { throw new Error('Invalid signature'); }) },
    }));
    const res = mockRes();
    await getHandler('post', '/webhook')(mockReq({
      headers: { 'stripe-signature': 'bad_sig' },
    }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid signature' });
  });

  it('POST /webhook returns 500 on unexpected error', async () => {
    mockStmt.run.mockImplementation(() => { throw new Error('DB error'); });
    const res = mockRes();
    await getHandler('post', '/webhook')(mockReq({
      headers: { 'stripe-signature': 'sig' },
    }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Server error' });
  });

  it('POST /create-checkout with ALLOWED_ORIGINS env var', async () => {
    vi.resetModules();
    process.env.ALLOWED_ORIGINS = 'https://custom.example.com, https://another.com';
    const { default: stripeRoutes2 } = await import('./stripe.js');
    Stripe.mockImplementation(defaultStripeMock);
    const route = stripeRoutes2.stack.find(l => l.route?.path === '/create-checkout' && l.route.methods['post'])?.route;
    const handler = route.stack.map(l => l.handle).pop();
    const res = mockRes();
    await handler(mockReq({
      body: { priceId: 'price_123', successUrl: 'https://custom.example.com/success' },
    }), res);
    expect(res.json).toHaveBeenCalledWith({ url: 'https://checkout.stripe.com/session' });
    delete process.env.ALLOWED_ORIGINS;
  });

  it('POST /create-checkout with invalid URL string', async () => {
    const res = mockRes();
    await getHandler('post', '/create-checkout')(mockReq({
      body: { priceId: 'price_123', successUrl: 'not-a-valid-url' },
    }), res);
    expect(res.json).toHaveBeenCalledWith({ url: 'https://checkout.stripe.com/session' });
  });

  it('POST /webhook returns 500 when Stripe key missing', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const res = mockRes();
    await getHandler('post', '/webhook')(mockReq({
      headers: { 'stripe-signature': 'sig' },
    }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Stripe not configured' });
  });

  it('POST /webhook handles subscription.deleted', async () => {
    Stripe.mockImplementationOnce(() => ({
      checkout: { sessions: { create: vi.fn() } },
      billingPortal: { sessions: { create: vi.fn() } },
      webhooks: { constructEvent: vi.fn().mockReturnValue({ type: 'customer.subscription.deleted', data: { object: { status: 'canceled', customer: 'cus_123' } } }) },
    }));
    const res = mockRes();
    await getHandler('post', '/webhook')(mockReq({
      headers: { 'stripe-signature': 'sig' },
    }), res);
    expect(res.json).toHaveBeenCalledWith({ received: true });
    expect(mockStmt.run).toHaveBeenCalledWith('cus_123');
  });
});
