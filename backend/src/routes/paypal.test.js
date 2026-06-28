import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({
  default: {
    prepare: vi.fn(() => ({
      run: vi.fn(() => ({ changes: 1 })),
      get: vi.fn(() => ({ id: 1, is_premium: 0, tier: 'free', email: 'test@example.com' })),
      all: vi.fn(() => []),
    })),
  },
}));
vi.mock('jsonwebtoken', () => ({ default: { verify: vi.fn(() => ({ userId: 1, version: 1 })) } }));
vi.mock('../logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('../middleware.js', () => ({ jwtAuth: (req, res, next) => { req.user = { userId: 1 }; next(); } }));

import paypalRoutes from './paypal.js';

function mockReq(overrides = {}) {
  return { headers: { authorization: 'Bearer test' }, body: {}, params: {}, user: { userId: 1 }, query: {}, ...overrides };
}
function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  res.redirect = vi.fn(() => res);
  return res;
}
function getHandler(method, path) {
  const route = paypalRoutes.stack.find(l => l.route?.path === path && l.route.methods[method])?.route;
  if (!route) return null;
  const handlers = route.stack.map(l => l.handle);
  return handlers[handlers.length - 1];
}

function mockFetchOk(data) {
  return { ok: true, json: () => Promise.resolve(data), text: () => Promise.resolve(JSON.stringify(data)) };
}
function mockFetchError(status, data) {
  return { ok: false, status, json: () => Promise.resolve(data), text: () => Promise.resolve(JSON.stringify(data)) };
}

describe('PayPal Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    process.env.PAYPAL_CLIENT_ID = 'test-client-id';
    process.env.PAYPAL_CLIENT_SECRET = 'test-client-secret';
    process.env.PAYPAL_WEBHOOK_ID = 'test-webhook-id';
    process.env.PAYPAL_SANDBOX = 'true';
    process.env.BASE_URL = 'http://localhost:5173';
  });

  it('POST /create-order creates PayPal order', async () => {
    global.fetch.mockResolvedValueOnce(mockFetchOk({ access_token: 'pp_token' }));
    global.fetch.mockResolvedValueOnce(mockFetchOk({ id: 'order_123', links: [{ rel: 'payer-action', href: 'https://paypal.com/checkout/123' }] }));
    const res = mockRes();
    await getHandler('post', '/create-order')(mockReq({ body: { plan: 'pro' } }), res);
    expect(res.json).toHaveBeenCalledWith({ order_id: 'order_123', approval_url: 'https://paypal.com/checkout/123' });
  });

  it('POST /create-order handles PayPal API error', async () => {
    global.fetch.mockResolvedValueOnce(mockFetchOk({ access_token: 'pp_token' }));
    global.fetch.mockResolvedValueOnce(mockFetchError(400, { message: 'INVALID_ORDER' }));
    const res = mockRes();
    await getHandler('post', '/create-order')(mockReq({ body: { plan: 'pro' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('POST /capture-order captures PayPal order', async () => {
    global.fetch.mockResolvedValueOnce(mockFetchOk({ access_token: 'pp_token' }));
    global.fetch.mockResolvedValueOnce(mockFetchOk({ status: 'COMPLETED' }));
    const res = mockRes();
    await getHandler('post', '/capture-order')(mockReq({ body: { order_id: 'order_123', plan: 'pro' } }), res);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('POST /capture-order handles capture failure', async () => {
    global.fetch.mockResolvedValueOnce(mockFetchOk({ access_token: 'pp_token' }));
    global.fetch.mockResolvedValueOnce(mockFetchOk({ status: 'FAILED' }));
    const res = mockRes();
    await getHandler('post', '/capture-order')(mockReq({ body: { order_id: 'order_123', plan: 'pro' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('POST /webhook handles PayPal webhook', async () => {
    global.fetch.mockResolvedValueOnce(mockFetchOk({ access_token: 'pp_token' }));
    global.fetch.mockResolvedValueOnce(mockFetchOk({ verification_status: 'SUCCESS' }));
    const res = mockRes();
    const body = JSON.stringify({ event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { custom_id: '1', id: 'cap_456' } });
    await getHandler('post', '/webhook')(mockReq({
      body,
      headers: { 'paypal-auth-algo': 'SHA256', 'paypal-cert-url': 'https://api.paypal.com/cert', 'paypal-transmission-id': 'txn1', 'paypal-transmission-sig': 'sig1', 'paypal-transmission-time': '2024-01-01T00:00:00Z' },
    }), res);
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it('POST /create-order returns 400 for invalid plan', async () => {
    global.fetch.mockResolvedValueOnce(mockFetchOk({ access_token: 'pp_token' }));
    const res = mockRes();
    await getHandler('post', '/create-order')(mockReq({ body: { plan: 'invalid_plan' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid plan.' });
  });

  it('POST /create-order returns 400 for missing plan', async () => {
    global.fetch.mockResolvedValueOnce(mockFetchOk({ access_token: 'pp_token' }));
    const res = mockRes();
    await getHandler('post', '/create-order')(mockReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid plan.' });
  });

  it('POST /create-order works with pro_plus plan', async () => {
    global.fetch.mockResolvedValueOnce(mockFetchOk({ access_token: 'pp_token' }));
    global.fetch.mockResolvedValueOnce(mockFetchOk({ id: 'order_pp_456', links: [{ rel: 'payer-action', href: 'https://paypal.com/checkout/456' }] }));
    const res = mockRes();
    await getHandler('post', '/create-order')(mockReq({ body: { plan: 'pro_plus' } }), res);
    expect(res.json).toHaveBeenCalledWith({ order_id: 'order_pp_456', approval_url: 'https://paypal.com/checkout/456' });
  });

  it('POST /create-order handles missing approval link', async () => {
    global.fetch.mockResolvedValueOnce(mockFetchOk({ access_token: 'pp_token' }));
    global.fetch.mockResolvedValueOnce(mockFetchOk({ id: 'order_no_link', links: [] }));
    const db = (await import('../db.js')).default;
    const res = mockRes();
    await getHandler('post', '/create-order')(mockReq({ body: { plan: 'pro' } }), res);
    expect(res.json).toHaveBeenCalledWith({ order_id: 'order_no_link', approval_url: undefined });
  });

  it('POST /create-order returns 500 when PayPal not configured', async () => {
    delete process.env.PAYPAL_CLIENT_ID;
    delete process.env.PAYPAL_CLIENT_SECRET;
    const res = mockRes();
    await getHandler('post', '/create-order')(mockReq({ body: { plan: 'pro' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'PayPal not configured' });
  });

  it('POST /create-order logs checkout event', async () => {
    global.fetch.mockResolvedValueOnce(mockFetchOk({ access_token: 'pp_token' }));
    global.fetch.mockResolvedValueOnce(mockFetchOk({ id: 'order_log', links: [{ rel: 'payer-action', href: 'https://paypal.com/checkout/log' }] }));
    const db = (await import('../db.js')).default;
    const res = mockRes();
    await getHandler('post', '/create-order')(mockReq({ body: { plan: 'pro' } }), res);
    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO checkout_events'));
  });

  it('POST /capture-order returns 400 for missing order_id', async () => {
    global.fetch.mockResolvedValueOnce(mockFetchOk({ access_token: 'pp_token' }));
    const res = mockRes();
    await getHandler('post', '/capture-order')(mockReq({ body: { plan: 'pro' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Missing order_id' });
  });

  it('POST /capture-order returns 500 when PayPal not configured', async () => {
    delete process.env.PAYPAL_CLIENT_ID;
    delete process.env.PAYPAL_CLIENT_SECRET;
    const res = mockRes();
    await getHandler('post', '/capture-order')(mockReq({ body: { order_id: 'order_123', plan: 'pro' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'PayPal not configured' });
  });

  it('POST /capture-order returns 400 for non-completed status', async () => {
    global.fetch.mockResolvedValueOnce(mockFetchOk({ access_token: 'pp_token' }));
    global.fetch.mockResolvedValueOnce(mockFetchOk({ status: 'PENDING' }));
    const res = mockRes();
    await getHandler('post', '/capture-order')(mockReq({ body: { order_id: 'order_123', plan: 'pro' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Payment not completed: PENDING' });
  });

  it('POST /capture-order works with pro_plus plan', async () => {
    global.fetch.mockResolvedValueOnce(mockFetchOk({ access_token: 'pp_token' }));
    global.fetch.mockResolvedValueOnce(mockFetchOk({ status: 'COMPLETED' }));
    const db = (await import('../db.js')).default;
    const res = mockRes();
    await getHandler('post', '/capture-order')(mockReq({ body: { order_id: 'order_pp', plan: 'pro_plus' } }), res);
    expect(res.json).toHaveBeenCalledWith({ success: true });
    expect(db.prepare.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('POST /capture-order handles network error', async () => {
    global.fetch.mockRejectedValue(new Error('Network error'));
    const res = mockRes();
    await getHandler('post', '/capture-order')(mockReq({ body: { order_id: 'order_123', plan: 'pro' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('POST /webhook returns 400 when verification fails', async () => {
    global.fetch.mockResolvedValueOnce(mockFetchOk({ access_token: 'pp_token' }));
    global.fetch.mockResolvedValueOnce(mockFetchOk({ verification_status: 'FAILURE' }));
    const res = mockRes();
    const body = JSON.stringify({ event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { custom_id: '1', id: 'cap_456' } });
    await getHandler('post', '/webhook')(mockReq({
      body,
      headers: { 'paypal-auth-algo': 'SHA256', 'paypal-cert-url': 'https://api.paypal.com/cert', 'paypal-transmission-id': 'txn1', 'paypal-transmission-sig': 'sig1' },
    }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Verification failed' });
  });

  it('POST /webhook handles DENIED event and removes premium', async () => {
    global.fetch.mockResolvedValueOnce(mockFetchOk({ access_token: 'pp_token' }));
    global.fetch.mockResolvedValueOnce(mockFetchOk({ verification_status: 'SUCCESS' }));
    const db = (await import('../db.js')).default;
    const res = mockRes();
    const body = JSON.stringify({ event_type: 'PAYMENT.CAPTURE.DENIED', resource: { custom_id: '2', id: 'cap_denied' } });
    await getHandler('post', '/webhook')(mockReq({
      body,
      headers: { 'paypal-auth-algo': 'SHA256', 'paypal-cert-url': 'https://api.paypal.com/cert', 'paypal-transmission-id': 'txn1', 'paypal-transmission-sig': 'sig1' },
    }), res);
    expect(res.json).toHaveBeenCalledWith({ received: true });
    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE users SET is_premium = 0'));
  });

  it('POST /webhook handles REFUNDED event', async () => {
    global.fetch.mockResolvedValueOnce(mockFetchOk({ access_token: 'pp_token' }));
    global.fetch.mockResolvedValueOnce(mockFetchOk({ verification_status: 'SUCCESS' }));
    const db = (await import('../db.js')).default;
    const res = mockRes();
    const body = JSON.stringify({ event_type: 'PAYMENT.CAPTURE.REFUNDED', resource: { custom_id: '3', id: 'cap_refunded' } });
    await getHandler('post', '/webhook')(mockReq({
      body,
      headers: { 'paypal-auth-algo': 'SHA256', 'paypal-cert-url': 'https://api.paypal.com/cert', 'paypal-transmission-id': 'txn1', 'paypal-transmission-sig': 'sig1' },
    }), res);
    expect(res.json).toHaveBeenCalledWith({ received: true });
    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('is_premium = 0'));
  });

  it('POST /webhook handles REVERSED event', async () => {
    global.fetch.mockResolvedValueOnce(mockFetchOk({ access_token: 'pp_token' }));
    global.fetch.mockResolvedValueOnce(mockFetchOk({ verification_status: 'SUCCESS' }));
    const db = (await import('../db.js')).default;
    const res = mockRes();
    const body = JSON.stringify({ event_type: 'PAYMENT.CAPTURE.REVERSED', resource: { custom_id: '4', id: 'cap_reversed' } });
    await getHandler('post', '/webhook')(mockReq({
      body,
      headers: { 'paypal-auth-algo': 'SHA256', 'paypal-cert-url': 'https://api.paypal.com/cert', 'paypal-transmission-id': 'txn1', 'paypal-transmission-sig': 'sig1' },
    }), res);
    expect(res.json).toHaveBeenCalledWith({ received: true });
    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('is_premium = 0'));
  });

  it('GET /return redirects with error when token missing', async () => {
    const res = mockRes();
    await getHandler('get', '/return')(mockReq({ query: { userId: '1' } }), res);
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('error=missing_params'));
  });

  it('GET /return redirects with error when userId missing', async () => {
    const res = mockRes();
    await getHandler('get', '/return')(mockReq({ query: { token: 'abc' } }), res);
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('error=missing_params'));
  });

  it('GET /return redirects with error for invalid userId', async () => {
    const res = mockRes();
    await getHandler('get', '/return')(mockReq({ query: { token: 'abc', userId: 'not-a-number' } }), res);
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('error=invalid_user'));
  });

  it('POST /webhook COMPLETED event upgrades user via db', async () => {
    global.fetch.mockResolvedValueOnce(mockFetchOk({ access_token: 'pp_token' }));
    global.fetch.mockResolvedValueOnce(mockFetchOk({ verification_status: 'SUCCESS' }));
    const db = (await import('../db.js')).default;
    const res = mockRes();
    const body = JSON.stringify({ event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { custom_id: '5', id: 'cap_upgrade' } });
    await getHandler('post', '/webhook')(mockReq({
      body,
      headers: { 'paypal-auth-algo': 'SHA256', 'paypal-cert-url': 'https://api.paypal.com/cert', 'paypal-transmission-id': 'txn1', 'paypal-transmission-sig': 'sig1' },
    }), res);
    expect(res.json).toHaveBeenCalledWith({ received: true });
    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE users SET is_premium = 1'));
  });

  it('POST /webhook COMPLETED with invalid custom_id does not upgrade', async () => {
    global.fetch.mockResolvedValueOnce(mockFetchOk({ access_token: 'pp_token' }));
    global.fetch.mockResolvedValueOnce(mockFetchOk({ verification_status: 'SUCCESS' }));
    const db = (await import('../db.js')).default;
    const res = mockRes();
    const body = JSON.stringify({ event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { custom_id: 'invalid', id: 'cap_noop' } });
    await getHandler('post', '/webhook')(mockReq({
      body,
      headers: { 'paypal-auth-algo': 'SHA256', 'paypal-cert-url': 'https://api.paypal.com/cert', 'paypal-transmission-id': 'txn1', 'paypal-transmission-sig': 'sig1' },
    }), res);
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it('GET /return redirects with config error when access token null', async () => {
    delete process.env.PAYPAL_CLIENT_ID;
    delete process.env.PAYPAL_CLIENT_SECRET;
    const res = mockRes();
    await getHandler('get', '/return')(mockReq({ query: { token: 'abc123', userId: '1' } }), res);
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('error=config'));
  });

  it('GET /return redirects with invalid_order when order fetch fails', async () => {
    global.fetch.mockResolvedValueOnce(mockFetchOk({ access_token: 'pp_token' }));
    global.fetch.mockResolvedValueOnce(mockFetchError(404, { message: 'Not found' }));
    const res = mockRes();
    await getHandler('get', '/return')(mockReq({ query: { token: 'bad', userId: '1' } }), res);
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('error=invalid_order'));
  });

  it('GET /return redirects with forbidden on user ID mismatch', async () => {
    global.fetch.mockResolvedValueOnce(mockFetchOk({ access_token: 'pp_token' }));
    global.fetch.mockResolvedValueOnce(mockFetchOk({ purchase_units: [{ custom_id: '999' }] }));
    const logger = (await import('../logger.js')).default;
    const res = mockRes();
    await getHandler('get', '/return')(mockReq({ query: { token: 'abc', userId: '1' } }), res);
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('error=forbidden'));
    expect(logger.warn).toHaveBeenCalledWith('PayPal return ID mismatch', expect.objectContaining({ orderUserId: 999, requestUserId: 1 }));
  });

  it('GET /return upgrades user on COMPLETED capture', async () => {
    global.fetch.mockResolvedValueOnce(mockFetchOk({ access_token: 'pp_token' }));
    global.fetch.mockResolvedValueOnce(mockFetchOk({ purchase_units: [{ custom_id: '1' }] }));
    global.fetch.mockResolvedValueOnce(mockFetchOk({ status: 'COMPLETED' }));
    const db = (await import('../db.js')).default;
    const logger = (await import('../logger.js')).default;
    const res = mockRes();
    await getHandler('get', '/return')(mockReq({ query: { token: 'abc', userId: '1', plan: 'pro' } }), res);
    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE users SET is_premium = 1'));
    expect(logger.info).toHaveBeenCalledWith('User 1 upgraded to premium (PayPal return)');
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('/dashboard'));
  });

  it('GET /return handles pro_plus plan on return', async () => {
    global.fetch.mockResolvedValueOnce(mockFetchOk({ access_token: 'pp_token' }));
    global.fetch.mockResolvedValueOnce(mockFetchOk({ purchase_units: [{ custom_id: '1' }] }));
    global.fetch.mockResolvedValueOnce(mockFetchOk({ status: 'COMPLETED' }));
    const res = mockRes();
    await getHandler('get', '/return')(mockReq({ query: { token: 'abc', userId: '1', plan: 'pro_plus' } }), res);
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('/dashboard'));
  });

  it('GET /return redirects to dashboard when capture not completed', async () => {
    global.fetch.mockResolvedValueOnce(mockFetchOk({ access_token: 'pp_token' }));
    global.fetch.mockResolvedValueOnce(mockFetchOk({ purchase_units: [{ custom_id: '1' }] }));
    global.fetch.mockResolvedValueOnce(mockFetchOk({ status: 'PENDING' }));
    const res = mockRes();
    await getHandler('get', '/return')(mockReq({ query: { token: 'abc', userId: '1' } }), res);
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('/dashboard'));
  });

  it('GET /return redirects with payment_failed on network error', async () => {
    global.fetch.mockRejectedValue(new Error('Network failure'));
    const logger = (await import('../logger.js')).default;
    const res = mockRes();
    await getHandler('get', '/return')(mockReq({ query: { token: 'abc', userId: '1' } }), res);
    expect(logger.error).toHaveBeenCalledWith('PayPal return error', expect.objectContaining({ error: 'Network failure' }));
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('error=payment_failed'));
  });

  it('POST /webhook returns 500 when webhook id missing', async () => {
    delete process.env.PAYPAL_WEBHOOK_ID;
    const res = mockRes();
    await getHandler('post', '/webhook')(mockReq({ body: '{}' }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Webhook not configured' });
  });

  it('POST /webhook returns 500 when access token null', async () => {
    delete process.env.PAYPAL_CLIENT_ID;
    delete process.env.PAYPAL_CLIENT_SECRET;
    const res = mockRes();
    await getHandler('post', '/webhook')(mockReq({ body: '{}' }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'PayPal not configured' });
  });

  it('POST /webhook returns 500 on invalid JSON body', async () => {
    global.fetch.mockResolvedValueOnce(mockFetchOk({ access_token: 'pp_token' }));
    const res = mockRes();
    await getHandler('post', '/webhook')(mockReq({ body: 'not-json', headers: {} }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('POST /webhook returns 500 on verification fetch error', async () => {
    global.fetch.mockResolvedValueOnce(mockFetchOk({ access_token: 'pp_token' }));
    global.fetch.mockRejectedValueOnce(new Error('Verify network error'));
    const res = mockRes();
    const body = JSON.stringify({ event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { custom_id: '1' } });
    await getHandler('post', '/webhook')(mockReq({
      body,
      headers: { 'paypal-auth-algo': 'SHA256', 'paypal-cert-url': 'https://api.paypal.com/cert', 'paypal-transmission-id': 'txn1', 'paypal-transmission-sig': 'sig1', 'paypal-transmission-time': '2024-01-01T00:00:00Z' },
    }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('POST /webhook COMPLETED with pro_plus custom_id sets pro_plus tier', async () => {
    global.fetch.mockResolvedValueOnce(mockFetchOk({ access_token: 'pp_token' }));
    global.fetch.mockResolvedValueOnce(mockFetchOk({ verification_status: 'SUCCESS' }));
    const db = (await import('../db.js')).default;
    const res = mockRes();
    const body = JSON.stringify({ event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { custom_id: '42_pro_plus', id: 'cap_proplus' } });
    await getHandler('post', '/webhook')(mockReq({
      body,
      headers: { 'paypal-auth-algo': 'SHA256', 'paypal-cert-url': 'https://api.paypal.com/cert', 'paypal-transmission-id': 'txn1', 'paypal-transmission-sig': 'sig1', 'paypal-transmission-time': '2024-01-01T00:00:00Z' },
    }), res);
    expect(res.json).toHaveBeenCalledWith({ received: true });
    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('is_premium = 1'));
  });

  it('POST /create-order handles getAccessToken HTTP error (401)', async () => {
    global.fetch.mockResolvedValueOnce(mockFetchError(401, 'invalid_client'));
    const res = mockRes();
    await getHandler('post', '/create-order')(mockReq({ body: { plan: 'pro' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('POST /capture-order handles capture API HTTP error', async () => {
    global.fetch.mockResolvedValueOnce(mockFetchOk({ access_token: 'pp_token' }));
    global.fetch.mockResolvedValueOnce(mockFetchError(400, { message: 'CAPTURE_FAILED' }));
    const res = mockRes();
    await getHandler('post', '/capture-order')(mockReq({ body: { order_id: 'order_123', plan: 'pro' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('getPrice returns custom PAYPAL_PROPLUS_MONTHLY when set', async () => {
    process.env.PAYPAL_PROPLUS_MONTHLY = '9.99';
    global.fetch.mockResolvedValueOnce(mockFetchOk({ access_token: 'pp_token' }));
    global.fetch.mockResolvedValueOnce(mockFetchOk({ id: 'order_pp', links: [{ rel: 'payer-action', href: 'https://paypal.com/checkout/pp' }] }));
    const db = (await import('../db.js')).default;
    const res = mockRes();
    await getHandler('post', '/create-order')(mockReq({ body: { plan: 'pro_plus' } }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ order_id: 'order_pp' }));
  });

  it('getPrice returns custom PAYPAL_PRO_MONTHLY when set', async () => {
    process.env.PAYPAL_PRO_MONTHLY = '5.99';
    global.fetch.mockResolvedValueOnce(mockFetchOk({ access_token: 'pp_token' }));
    global.fetch.mockResolvedValueOnce(mockFetchOk({ id: 'order_pro', links: [{ rel: 'payer-action', href: 'https://paypal.com/checkout/pro' }] }));
    const res = mockRes();
    await getHandler('post', '/create-order')(mockReq({ body: { plan: 'pro' } }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ order_id: 'order_pro' }));
  });

  it('GET /return uses fallback BASE_URL when env var missing', async () => {
    delete process.env.BASE_URL;
    global.fetch.mockResolvedValueOnce(mockFetchOk({ access_token: 'pp_token' }));
    global.fetch.mockResolvedValueOnce(mockFetchOk({ purchase_units: [{ custom_id: '1' }] }));
    global.fetch.mockResolvedValueOnce(mockFetchOk({ status: 'COMPLETED' }));
    const res = mockRes();
    await getHandler('get', '/return')(mockReq({ query: { token: 'abc', userId: '1', plan: 'pro' } }), res);
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('/dashboard'));
  });

  it('GET /return uses fallback BASE_URL on forbidden', async () => {
    delete process.env.BASE_URL;
    global.fetch.mockResolvedValueOnce(mockFetchOk({ access_token: 'pp_token' }));
    global.fetch.mockResolvedValueOnce(mockFetchOk({ purchase_units: [{ custom_id: '999' }] }));
    const res = mockRes();
    await getHandler('get', '/return')(mockReq({ query: { token: 'abc', userId: '1' } }), res);
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('error=forbidden'));
  });

  it('GET /return uses fallback BASE_URL on network error', async () => {
    delete process.env.BASE_URL;
    global.fetch.mockRejectedValue(new Error('fail'));
    const res = mockRes();
    await getHandler('get', '/return')(mockReq({ query: { token: 'abc', userId: '1' } }), res);
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('error=payment_failed'));
  });

  it('GET /return uses fallback BASE_URL on invalid user', async () => {
    delete process.env.BASE_URL;
    const res = mockRes();
    await getHandler('get', '/return')(mockReq({ query: { token: 'abc', userId: 'not-a-number' } }), res);
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('error=invalid_user'));
  });

  it('GET /return uses fallback BASE_URL on config error', async () => {
    delete process.env.BASE_URL;
    delete process.env.PAYPAL_CLIENT_ID;
    delete process.env.PAYPAL_CLIENT_SECRET;
    const res = mockRes();
    await getHandler('get', '/return')(mockReq({ query: { token: 'abc', userId: '1' } }), res);
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('error=config'));
  });

  it('GET /return uses fallback BASE_URL on invalid order', async () => {
    delete process.env.BASE_URL;
    global.fetch.mockResolvedValueOnce(mockFetchOk({ access_token: 'pp_token' }));
    global.fetch.mockResolvedValueOnce(mockFetchError(404, {}));
    const res = mockRes();
    await getHandler('get', '/return')(mockReq({ query: { token: 'bad', userId: '1' } }), res);
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('error=invalid_order'));
  });

  it('GET /return redirects for userId <= 0', async () => {
    const res = mockRes();
    await getHandler('get', '/return')(mockReq({ query: { token: 'abc', userId: '0' } }), res);
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('error=invalid_user'));
  });

  it('GET /return redirects for negative userId', async () => {
    const res = mockRes();
    await getHandler('get', '/return')(mockReq({ query: { token: 'abc', userId: '-5' } }), res);
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('error=invalid_user'));
  });

  it('getAccessToken returns null when only client id is missing', async () => {
    delete process.env.PAYPAL_CLIENT_ID;
    const res = mockRes();
    await getHandler('post', '/create-order')(mockReq({ body: { plan: 'pro' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'PayPal not configured' });
  });

  it('getAccessToken returns null when only secret is missing', async () => {
    delete process.env.PAYPAL_CLIENT_SECRET;
    const res = mockRes();
    await getHandler('post', '/create-order')(mockReq({ body: { plan: 'pro' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'PayPal not configured' });
  });

  it('POST /create-order handles order API error without message', async () => {
    global.fetch.mockResolvedValueOnce(mockFetchOk({ access_token: 'pp_token' }));
    global.fetch.mockResolvedValueOnce(mockFetchError(400, { details: 'no message field' }));
    const res = mockRes();
    await getHandler('post', '/create-order')(mockReq({ body: { plan: 'pro' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('POST /capture-order handles capture API error without message', async () => {
    global.fetch.mockResolvedValueOnce(mockFetchOk({ access_token: 'pp_token' }));
    global.fetch.mockResolvedValueOnce(mockFetchError(400, { details: 'no message field' }));
    const res = mockRes();
    await getHandler('post', '/capture-order')(mockReq({ body: { order_id: 'order_123', plan: 'pro' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('POST /webhook COMPLETED catches DB insert error gracefully', async () => {
    global.fetch.mockResolvedValueOnce(mockFetchOk({ access_token: 'pp_token' }));
    global.fetch.mockResolvedValueOnce(mockFetchOk({ verification_status: 'SUCCESS' }));
    const db = (await import('../db.js')).default;
    db.prepare.mockImplementationOnce(() => ({ run: vi.fn(() => ({ changes: 1 })), get: vi.fn(), all: vi.fn() }));
    db.prepare.mockImplementationOnce(() => ({ run: vi.fn(() => { throw new Error('insert fail'); }), get: vi.fn(), all: vi.fn() }));
    const res = mockRes();
    const body = JSON.stringify({ event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { custom_id: '1', id: 'cap_456' } });
    await getHandler('post', '/webhook')(mockReq({
      body,
      headers: { 'paypal-auth-algo': 'SHA256', 'paypal-cert-url': 'https://api.paypal.com/cert', 'paypal-transmission-id': 'txn1', 'paypal-transmission-sig': 'sig1', 'paypal-transmission-time': '2024-01-01T00:00:00Z' },
    }), res);
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it('GET /return uses fallback BASE_URL on missing params', async () => {
    delete process.env.BASE_URL;
    const res = mockRes();
    await getHandler('get', '/return')(mockReq({ query: {} }), res);
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('error=missing_params'));
  });
});
