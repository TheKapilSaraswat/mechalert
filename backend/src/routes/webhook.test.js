import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockStmt = {
  run: vi.fn(() => ({ changes: 1, lastInsertRowid: 42 })),
  get: vi.fn(() => ({ id: 1, keywords: 'test', min_price: null, max_price: null, user_id: 1, notify_type: 'discord', notify_target: 'https://discord.com/api/webhooks/123' })),
  all: vi.fn(() => []),
};
vi.mock('../db.js', () => ({ default: { prepare: vi.fn(() => mockStmt) } }));

function resetMockStmt() {
  mockStmt.run.mockReset();
  mockStmt.run.mockImplementation(() => ({ changes: 1, lastInsertRowid: 42 }));
  mockStmt.get.mockReset();
  mockStmt.get.mockImplementation(() => ({ id: 1, keywords: 'test', min_price: null, max_price: null, user_id: 1, notify_type: 'discord', notify_target: 'https://discord.com/api/webhooks/123' }));
  mockStmt.all.mockReset();
  mockStmt.all.mockImplementation(() => []);
}
vi.mock('../logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('../notifier.js', () => ({ sendNotification: vi.fn(() => Promise.resolve()) }));
vi.mock('../matchers.js', () => ({
  extractPrice: vi.fn(() => 150),
  matchKeywords: vi.fn(() => ['keyboard']),
  matchPrice: vi.fn(() => true),
}));
vi.mock('../aiScorer.js', () => ({ scoreDeal: vi.fn(() => Promise.resolve({ score: 80, reasoning: 'Good', market_value: 200, scam_signals: [], scam_risk: 'low' })) }));

vi.hoisted(() => {
  process.env.WEBHOOK_SECRET = 'test-secret';
});

import webhookRoutes from './webhook.js';

function mockReq(overrides = {}) {
  const req = { headers: { 'x-webhook-secret': 'test-secret' }, body: {}, params: {}, ...overrides };
  if (!req.validated) req.validated = req.body;
  return req;
}
function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}
function getHandler(method, path) {
  const route = webhookRoutes.stack.find(l => l.route?.path === path && l.route.methods[method])?.route;
  if (!route) return null;
  const handlers = route.stack.map(l => l.handle);
  return handlers[handlers.length - 1];
}
function callRoute(method, path, req, res) {
  const route = webhookRoutes.stack.find(l => l.route?.path === path && l.route.methods[method])?.route;
  if (!route) return;
  const handlers = route.stack.map(l => l.handle);
  let i = 0;
  function next() {
    if (i < handlers.length) {
      handlers[i++](req, res, next);
    }
  }
  next();
}

describe('Webhook Routes', () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockStmt(); });

  it('POST /post processes incoming webhook post', async () => {
    mockStmt.run.mockReturnValue({ changes: 1, lastInsertRowid: 42 });
    const res = mockRes();
    await getHandler('post', '/post')(mockReq({
      body: { id: 'wh123', title: 'Keyboard for sale $150', permalink: '/r/test/1/', subreddit: 'mechmarket', source: 'reddit' },
    }), res);
    expect(res.json).toHaveBeenCalled();
  });

  it('POST /post handles duplicate webhook post', async () => {
    mockStmt.run.mockReturnValue({ changes: 0 });
    mockStmt.get.mockReturnValue({ price: 150 });
    const res = mockRes();
    getHandler('post', '/post')(mockReq({
      body: { id: 'wh_dup', title: 'Duplicate', permalink: '/r/test/2/', subreddit: 'test' },
    }), res);
    expect(res.json).toHaveBeenCalled();
  });

  it('POST /post handles webhook with all fields', async () => {
    mockStmt.run.mockReturnValue({ changes: 1 });
    const { matchKeywords } = await import('../matchers.js');
    matchKeywords.mockReturnValue(['test']);
    const res = mockRes();
    await getHandler('post', '/post')(mockReq({
      body: { id: 'wh3', title: 'Test item $100', body: 'Description here', price: 100, permalink: '/r/t/3/', subreddit: 'test', source: 'custom' },
    }), res);
    expect(res.json).toHaveBeenCalled();
  });

  it('POST /post returns 500 on error', async () => {
    mockStmt.run.mockImplementation(() => { throw new Error('DB error'); });
    const res = mockRes();
    getHandler('post', '/post')(mockReq({
      body: { id: 'wh_err', title: 'Error', permalink: '/r/t/e/', subreddit: 'test' },
    }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('POST /post processes AI scoring', async () => {
    mockStmt.run.mockReturnValue({ changes: 1 });
    const res = mockRes();
    getHandler('post', '/post')(mockReq({
      body: { id: 'wh_ai', title: 'AI scored item $200', body: 'Description', price: 200, permalink: '/r/t/ai/', subreddit: 'test' },
    }), res);
  });

  it('POST /post handles no price in body', async () => {
    const { extractPrice } = await import('../matchers.js');
    extractPrice.mockReturnValue(null);
    mockStmt.run.mockReturnValue({ changes: 1 });
    const res = mockRes();
    getHandler('post', '/post')(mockReq({
      body: { id: 'wh_np', title: 'No price item', permalink: '/r/t/np/', subreddit: 'test' },
    }), res);
  });

  it('POST /post returns 401 when webhook secret missing', async () => {
    const res = mockRes();
    callRoute('post', '/post', mockReq({ headers: {}, body: { id: 'wh_a1', title: 'Test', permalink: '/r/t/a1/' } }), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Missing webhook secret' });
  });

  it('POST /post returns 401 when webhook secret invalid', async () => {
    const res = mockRes();
    callRoute('post', '/post', mockReq({ headers: { 'x-webhook-secret': 'wrong-secret' }, body: { id: 'wh_a2', title: 'Test', permalink: '/r/t/a2/' } }), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid webhook secret' });
  });

  it('POST /post returns 400 when id is missing', async () => {
    const res = mockRes();
    callRoute('post', '/post', mockReq({ body: { title: 'Test' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Validation failed' }));
  });

  it('POST /post returns 400 when title is missing', async () => {
    const res = mockRes();
    callRoute('post', '/post', mockReq({ body: { id: 'wh_v2' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Validation failed' }));
  });

  it('POST /post returns 400 when id is empty', async () => {
    const res = mockRes();
    callRoute('post', '/post', mockReq({ body: { id: '', title: 'Test' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Validation failed' }));
  });

  it('POST /post returns 400 when id exceeds max length', async () => {
    const res = mockRes();
    callRoute('post', '/post', mockReq({ body: { id: 'x'.repeat(201), title: 'Test' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Validation failed' }));
  });

  it('POST /post handles no matching alert rules', async () => {
    mockStmt.run.mockReturnValue({ changes: 1, lastInsertRowid: 42 });
    mockStmt.all.mockReturnValue([]);
    const res = mockRes();
    await getHandler('post', '/post')(mockReq({
      body: { id: 'wh_nr', title: 'No rules match', permalink: '/r/t/nr/' },
    }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true, new: true }));
  });

  it('POST /post handles rule with no keyword match', async () => {
    const { matchKeywords } = await import('../matchers.js');
    matchKeywords.mockReturnValueOnce([]);
    mockStmt.run.mockReturnValue({ changes: 1, lastInsertRowid: 42 });
    mockStmt.all.mockReturnValue([{ id: 1, keywords: 'test', min_price: null, max_price: null, user_id: 1, notify_type: 'discord', notify_target: 'https://discord.com/api/webhooks/123', email: 'test@example.com' }]);
    const res = mockRes();
    await getHandler('post', '/post')(mockReq({
      body: { id: 'wh_nk', title: 'No keyword match', permalink: '/r/t/nk/' },
    }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });

  it('POST /post handles rule where price filter fails', async () => {
    const { matchPrice } = await import('../matchers.js');
    matchPrice.mockReturnValueOnce(false);
    mockStmt.run.mockReturnValue({ changes: 1, lastInsertRowid: 42 });
    mockStmt.all.mockReturnValue([{ id: 1, keywords: 'test', min_price: null, max_price: null, user_id: 1, notify_type: 'discord', notify_target: 'https://discord.com/api/webhooks/123', email: 'test@example.com' }]);
    const res = mockRes();
    await getHandler('post', '/post')(mockReq({
      body: { id: 'wh_pf', title: 'Price filter fails', permalink: '/r/t/pf/' },
    }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });

  it('POST /post handles null AI score', async () => {
    const { scoreDeal } = await import('../aiScorer.js');
    scoreDeal.mockResolvedValueOnce(null);
    mockStmt.run.mockReturnValue({ changes: 1, lastInsertRowid: 42 });
    const res = mockRes();
    await getHandler('post', '/post')(mockReq({
      body: { id: 'wh_na', title: 'No AI score', permalink: '/r/t/na/' },
    }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true, aiScore: null }));
  });

  it('POST /post handles no price via extraction', async () => {
    const { extractPrice } = await import('../matchers.js');
    extractPrice.mockReturnValue(null);
    mockStmt.run.mockReturnValue({ changes: 1, lastInsertRowid: 42 });
    const res = mockRes();
    await getHandler('post', '/post')(mockReq({
      body: { id: 'wh_npe', title: 'No price extracted', permalink: '/r/t/npe/' },
    }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });

  it('POST /post inserts price history when price provided', async () => {
    mockStmt.run.mockReturnValue({ changes: 1, lastInsertRowid: 42 });
    const res = mockRes();
    await getHandler('post', '/post')(mockReq({
      body: { id: 'wh_ph', title: 'Price history test', price: 200, permalink: '/r/t/ph/' },
    }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });

  it('POST /post calls sendNotification for matching rule', async () => {
    const { sendNotification } = await import('../notifier.js');
    mockStmt.run.mockReturnValue({ changes: 1, lastInsertRowid: 42 });
    mockStmt.all.mockReturnValue([{ id: 1, keywords: 'test', min_price: null, max_price: null, user_id: 1, notify_type: 'discord', notify_target: 'https://discord.com/api/webhooks/123', email: 'test@example.com' }]);
    const res = mockRes();
    await getHandler('post', '/post')(mockReq({
      body: { id: 'wh_sn', title: 'Send notification test', permalink: '/r/t/sn/' },
    }), res);
    expect(sendNotification).toHaveBeenCalled();
  });

  it('POST /post handles multiple matching rules', async () => {
    mockStmt.run.mockReturnValue({ changes: 1, lastInsertRowid: 42 });
    mockStmt.all.mockReturnValue([
      { id: 1, keywords: 'test', min_price: null, max_price: null, user_id: 1, notify_type: 'discord', notify_target: 'https://discord.com/api/webhooks/123', email: 'test@example.com' },
      { id: 2, keywords: 'test', min_price: null, max_price: null, user_id: 2, notify_type: 'email', notify_target: 'user2@test.com', email: 'user2@test.com' },
    ]);
    const { sendNotification } = await import('../notifier.js');
    const res = mockRes();
    await getHandler('post', '/post')(mockReq({
      body: { id: 'wh_mr', title: 'Multiple rules test', permalink: '/r/t/mr/' },
    }), res);
    expect(sendNotification).toHaveBeenCalledTimes(2);
  });

  it('POST /post defaults subreddit to mechmarket when not provided', async () => {
    mockStmt.run.mockReturnValue({ changes: 1, lastInsertRowid: 42 });
    const res = mockRes();
    await getHandler('post', '/post')(mockReq({
      body: { id: 'wh_ns', title: 'No subreddit', permalink: '/r/t/ns/' },
    }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });

  it('POST /post defaults source to reddit when not provided', async () => {
    mockStmt.run.mockReturnValue({ changes: 1, lastInsertRowid: 42 });
    const res = mockRes();
    await getHandler('post', '/post')(mockReq({
      body: { id: 'wh_nsrc', title: 'No source', permalink: '/r/t/nsrc/' },
    }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });

  it('POST /post defaults body to empty string when not provided', async () => {
    mockStmt.run.mockReturnValue({ changes: 1, lastInsertRowid: 42 });
    const res = mockRes();
    await getHandler('post', '/post')(mockReq({
      body: { id: 'wh_nb', title: 'No body field', permalink: '/r/t/nb/' },
    }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });

  it('POST /post returns duplicate response when post already exists', async () => {
    mockStmt.run.mockReturnValue({ changes: 0 });
    const res = mockRes();
    await getHandler('post', '/post')(mockReq({
      body: { id: 'wh_dup2', title: 'Duplicate check', permalink: '/r/t/dup2/' },
    }), res);
    expect(res.json).toHaveBeenCalledWith({ ok: true, new: false });
  });

  it('webhookAuth skips auth when WEBHOOK_SECRET is not configured (line 13)', async () => {
    const orig = process.env.WEBHOOK_SECRET;
    delete process.env.WEBHOOK_SECRET;
    vi.resetModules();
    const freshWebhook = (await import('./webhook.js')).default;
    const route = freshWebhook.stack.find(l => l.route?.path === '/post' && l.route.methods.post)?.route;
    const [webhookAuthHandler] = route.stack.map(l => l.handle);
    const next = vi.fn();
    const req = mockReq({ headers: {}, body: { id: 't', title: 'T', permalink: '/r/t/' } });
    webhookAuthHandler(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
    process.env.WEBHOOK_SECRET = orig;
  });
});
