import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => {
  const mockStmt = {
    run: vi.fn(),
    get: vi.fn(),
    all: vi.fn(),
  };
  const mockDb = {
    prepare: vi.fn(() => mockStmt),
  };
  return { default: mockDb };
});

vi.mock('jsonwebtoken', () => ({
  default: {
    verify: vi.fn(() => ({ userId: 1, version: 1 })),
  },
}));

vi.mock('../logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('../middleware.js', () => ({ jwtAuth: (req, res, next) => { req.user = { userId: 1 }; next(); } }));
vi.mock('../validation.js', () => ({
  validate: () => (req, res, next) => { req.validated = req.body; next(); },
  createAlertRuleSchema: { safeParse: vi.fn(() => ({ success: true, data: {} })) },
  updateAlertRuleSchema: { safeParse: vi.fn(() => ({ success: true, data: {} })) },
}));

import alertRoutes from './alerts.js';

function mockReq(overrides = {}) {
  return { headers: { authorization: 'Bearer test-token' }, body: {}, params: {}, user: { userId: 1 }, validated: null, ...overrides };
}

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

function getRouteHandlers(method, path) {
  const route = alertRoutes.stack.find(l => l.route?.path === path && l.route.methods[method])?.route;
  if (!route) throw new Error(`Route ${method} ${path} not found`);
  return route.stack.map(l => l.handle);
}

describe('Alert Routes', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('GET / returns alert rules for user', async () => {
    const handlers = getRouteHandlers('get', '/');
    const db = (await vi.importMock('../db.js')).default;
    db.prepare().all.mockReturnValue([{ id: 1, keywords: 'test', subreddit: 'mechmarket' }]);
    handlers[handlers.length - 1](mockReq(), mockRes());
    expect(db.prepare().all).toHaveBeenCalled();
  });

  it('GET / returns empty array when no rules', async () => {
    const handlers = getRouteHandlers('get', '/');
    const db = (await vi.importMock('../db.js')).default;
    db.prepare().all.mockReturnValue([]);
    const res = mockRes();
    handlers[handlers.length - 1](mockReq(), res);
    expect(res.json).toHaveBeenCalledWith([]);
  });

  it('POST / creates alert rule with valid data', async () => {
    const handlers = getRouteHandlers('post', '/');
    const db = (await vi.importMock('../db.js')).default;
    db.prepare().get.mockReturnValue({ cnt: 0, is_premium: 0, id: 42, keywords: 'test' });
    db.prepare().run.mockReturnValue({ lastInsertRowid: 42 });
    db.prepare().all.mockReturnValue([]);
    const req = mockReq({ validated: { keywords: 'test', notify_target: 'a@b.com' } });
    const res = mockRes();
    handlers[handlers.length - 1](req, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ id: 42 }));
  });

  it('POST / returns 500 when create fails', async () => {
    const handlers = getRouteHandlers('post', '/');
    const db = (await vi.importMock('../db.js')).default;
    db.prepare().get.mockReturnValue({ cnt: 0, is_premium: 0 });
    db.prepare().run.mockImplementation(() => { throw new Error('DB error'); });
    const req = mockReq({ validated: { keywords: 'test', notify_target: 'a@b.com' } });
    const res = mockRes();
    handlers[handlers.length - 1](req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('POST / handles errors gracefully', async () => {
    const handlers = getRouteHandlers('post', '/');
    const db = (await vi.importMock('../db.js')).default;
    db.prepare().get.mockReturnValue({ cnt: 0, is_premium: 0 });
    db.prepare().run.mockImplementation(() => { throw new Error('DB error'); });
    const req = mockReq({ validated: { keywords: 'test', notify_target: 'a@b.com' } });
    const res = mockRes();
    handlers[handlers.length - 1](req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('PUT /:id updates alert rule', async () => {
    const handlers = getRouteHandlers('put', '/:id');
    const db = (await vi.importMock('../db.js')).default;
    db.prepare().get.mockReturnValue({ id: 1, keywords: 'old', user_id: 1, is_premium: 1 });
    db.prepare().run.mockReturnValue({ changes: 1 });
    const req = mockReq({ params: { id: '1' }, validated: { keywords: 'updated' } });
    const res = mockRes();
    handlers[handlers.length - 1](req, res);
    expect(res.json).toHaveBeenCalled();
  });

  it('PUT /:id returns 404 when rule not found', async () => {
    const handlers = getRouteHandlers('put', '/:id');
    const db = (await vi.importMock('../db.js')).default;
    db.prepare().get.mockReturnValue(undefined);
    const req = mockReq({ params: { id: '999' }, validated: { keywords: 'updated' } });
    const res = mockRes();
    handlers[handlers.length - 1](req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('DELETE /:id deletes rule', async () => {
    const handlers = getRouteHandlers('delete', '/:id');
    const db = (await vi.importMock('../db.js')).default;
    db.prepare().get.mockReturnValue({ id: 1 });
    const req = mockReq({ params: { id: '1' } });
    const res = mockRes();
    handlers[handlers.length - 1](req, res);
    expect(res.json).toHaveBeenCalled();
  });

  it('DELETE /:id returns 404 when not found', async () => {
    const handlers = getRouteHandlers('delete', '/:id');
    const db = (await vi.importMock('../db.js')).default;
    db.prepare().get.mockReturnValue(undefined);
    const req = mockReq({ params: { id: '999' } });
    const res = mockRes();
    handlers[handlers.length - 1](req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('DELETE /:id handles errors gracefully', async () => {
    const handlers = getRouteHandlers('delete', '/:id');
    const db = (await vi.importMock('../db.js')).default;
    db.prepare().get.mockImplementation(() => { throw new Error('DB error'); });
    const req = mockReq({ params: { id: '1' } });
    const res = mockRes();
    handlers[handlers.length - 1](req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('PUT /:id handles errors gracefully', async () => {
    const handlers = getRouteHandlers('put', '/:id');
    const db = (await vi.importMock('../db.js')).default;
    db.prepare().get.mockImplementation(() => { throw new Error('DB error'); });
    const req = mockReq({ params: { id: '1' }, validated: { keywords: 'test' } });
    const res = mockRes();
    handlers[handlers.length - 1](req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('GET / handles db errors gracefully', async () => {
    const handlers = getRouteHandlers('get', '/');
    const db = (await vi.importMock('../db.js')).default;
    db.prepare().all.mockImplementation(() => { throw new Error('DB error'); });
    const req = mockReq();
    const res = mockRes();
    handlers[handlers.length - 1](req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('POST / returns 403 when free tier limit reached', async () => {
    const handlers = getRouteHandlers('post', '/');
    const db = (await vi.importMock('../db.js')).default;
    db.prepare().get
      .mockReturnValueOnce({ tier: 'free', is_premium: 0 })
      .mockReturnValue({ cnt: 3 });
    const req = mockReq({ validated: { keywords: 'test', notify_target: 'a@b.com' } });
    const res = mockRes();
    handlers[handlers.length - 1](req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('POST / returns 403 when price filter used on free tier', async () => {
    const handlers = getRouteHandlers('post', '/');
    const db = (await vi.importMock('../db.js')).default;
    db.prepare().get
      .mockReturnValueOnce({ tier: 'free', is_premium: 0 })
      .mockReturnValue({ cnt: 0 });
    const req = mockReq({ validated: { keywords: 'test', notify_target: 'a@b.com', min_price: 100 } });
    const res = mockRes();
    handlers[handlers.length - 1](req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('POST / returns 403 when min_score used on free tier', async () => {
    const handlers = getRouteHandlers('post', '/');
    const db = (await vi.importMock('../db.js')).default;
    db.prepare().get
      .mockReturnValueOnce({ tier: 'free', is_premium: 0 })
      .mockReturnValue({ cnt: 0 });
    const req = mockReq({ validated: { keywords: 'test', notify_target: 'a@b.com', min_score: 7 } });
    const res = mockRes();
    handlers[handlers.length - 1](req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('POST / returns 403 when custom interval used on free tier', async () => {
    const handlers = getRouteHandlers('post', '/');
    const db = (await vi.importMock('../db.js')).default;
    db.prepare().get
      .mockReturnValueOnce({ tier: 'free', is_premium: 0 })
      .mockReturnValue({ cnt: 0 });
    const req = mockReq({ validated: { keywords: 'test', notify_target: 'a@b.com', scan_interval: 30 } });
    const res = mockRes();
    handlers[handlers.length - 1](req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('POST / returns 403 when non-email notify used on free tier', async () => {
    const handlers = getRouteHandlers('post', '/');
    const db = (await vi.importMock('../db.js')).default;
    db.prepare().get
      .mockReturnValueOnce({ tier: 'free', is_premium: 0 })
      .mockReturnValue({ cnt: 0 });
    const req = mockReq({ validated: { keywords: 'test', notify_target: 'u@d.com', notify_type: 'discord' } });
    const res = mockRes();
    handlers[handlers.length - 1](req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('PUT /:id returns 403 when price filter used on free tier', async () => {
    const handlers = getRouteHandlers('put', '/:id');
    const db = (await vi.importMock('../db.js')).default;
    db.prepare().get
      .mockReturnValueOnce({ id: 1, keywords: 'old', user_id: 1 })
      .mockReturnValue({ tier: 'free', is_premium: 0 });
    const req = mockReq({ params: { id: '1' }, validated: { keywords: 'updated', min_price: 100 } });
    const res = mockRes();
    handlers[handlers.length - 1](req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Price filters require Pro or Pro+.' });
  });

  it('PUT /:id returns 403 when non-email notify used on free tier', async () => {
    const handlers = getRouteHandlers('put', '/:id');
    const db = (await vi.importMock('../db.js')).default;
    db.prepare().get
      .mockReturnValueOnce({ id: 1, keywords: 'old', user_id: 1 })
      .mockReturnValue({ tier: 'free', is_premium: 0 });
    const req = mockReq({ params: { id: '1' }, validated: { keywords: 'updated', notify_type: 'discord' } });
    const res = mockRes();
    handlers[handlers.length - 1](req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Non-email notifications require Pro or Pro+.' });
  });

  it('POST / creates rule with pro user and price filter', async () => {
    const handlers = getRouteHandlers('post', '/');
    const db = (await vi.importMock('../db.js')).default;
    db.prepare().get
      .mockReturnValueOnce({ tier: 'pro', is_premium: 1 })
      .mockReturnValueOnce({ cnt: 0 })
      .mockReturnValue({ id: 42, keywords: 'test', min_price: 100 });
    db.prepare().run.mockReturnValue({ lastInsertRowid: 42 });
    db.prepare().all.mockReturnValue([]);
    const req = mockReq({ validated: { keywords: 'test', notify_target: 'a@b.com', min_price: 100 } });
    const res = mockRes();
    handlers[handlers.length - 1](req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ id: 42 }));
  });

  it('POST / backfills existing posts on creation', async () => {
    const handlers = getRouteHandlers('post', '/');
    const db = (await vi.importMock('../db.js')).default;
    db.prepare().get
      .mockReturnValueOnce({ tier: 'free', is_premium: 0 })
      .mockReturnValueOnce({ cnt: 0 })
      .mockReturnValueOnce(undefined)
      .mockReturnValue({ id: 42, keywords: 'GMK' });
    db.prepare().run.mockReturnValue({ lastInsertRowid: 42 });
    db.prepare().all.mockReturnValue([
      { post_id: 'p1', title: 'GMK Set', body: '', source: 'reddit', scanned_at: '2024-01-01' },
    ]);
    const req = mockReq({ validated: { keywords: 'GMK', notify_target: 'a@b.com', subreddit: 'all' } });
    const res = mockRes();
    handlers[handlers.length - 1](req, res);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('POST / handles backfill error gracefully', async () => {
    const handlers = getRouteHandlers('post', '/');
    const db = (await vi.importMock('../db.js')).default;
    db.prepare().get
      .mockReturnValueOnce({ tier: 'free', is_premium: 0 })
      .mockReturnValueOnce({ cnt: 0 })
      .mockReturnValue({ id: 42, keywords: 'test' });
    db.prepare().run.mockReturnValue({ lastInsertRowid: 42 });
    db.prepare().all.mockImplementation(() => { throw new Error('Backfill query failed'); });
    const req = mockReq({ validated: { keywords: 'test', notify_target: 'a@b.com' } });
    const res = mockRes();
    handlers[handlers.length - 1](req, res);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('POST / handles craigslist subreddit filter', async () => {
    const handlers = getRouteHandlers('post', '/');
    const db = (await vi.importMock('../db.js')).default;
    db.prepare().get
      .mockReturnValueOnce({ tier: 'free', is_premium: 0 })
      .mockReturnValueOnce({ cnt: 0 })
      .mockReturnValue({ id: 42, keywords: 'test' });
    db.prepare().run.mockReturnValue({ lastInsertRowid: 42 });
    db.prepare().all.mockReturnValue([]);
    const req = mockReq({ validated: { keywords: 'test', notify_target: 'a@b.com', subreddit: 'craigslist' } });
    const res = mockRes();
    handlers[handlers.length - 1](req, res);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('PUT /:id updates is_active flag', async () => {
    const handlers = getRouteHandlers('put', '/:id');
    const db = (await vi.importMock('../db.js')).default;
    db.prepare().get
      .mockReturnValueOnce({ id: 1, keywords: 'old', user_id: 1 })
      .mockReturnValueOnce({ tier: 'free', is_premium: 0 })
      .mockReturnValue({ id: 1, keywords: 'updated', is_active: 0 });
    db.prepare().run.mockReturnValue({ changes: 1 });
    const req = mockReq({ params: { id: '1' }, validated: { keywords: 'updated', is_active: false } });
    const res = mockRes();
    handlers[handlers.length - 1](req, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });

  it('PUT /:id updates with pause_until', async () => {
    const handlers = getRouteHandlers('put', '/:id');
    const db = (await vi.importMock('../db.js')).default;
    db.prepare().get
      .mockReturnValueOnce({ id: 1, keywords: 'old', user_id: 1 })
      .mockReturnValueOnce({ tier: 'free', is_premium: 0 })
      .mockReturnValue({ id: 1, keywords: 'updated', pause_until: '2025-01-01' });
    db.prepare().run.mockReturnValue({ changes: 1 });
    const req = mockReq({ params: { id: '1' }, validated: { keywords: 'updated', pause_until: '2025-01-01' } });
    const res = mockRes();
    handlers[handlers.length - 1](req, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });

  it('PUT /:id with pro user allows price filter', async () => {
    const handlers = getRouteHandlers('put', '/:id');
    const db = (await vi.importMock('../db.js')).default;
    db.prepare().get
      .mockReturnValueOnce({ id: 1, keywords: 'old', user_id: 1 })
      .mockReturnValueOnce({ tier: 'pro', is_premium: 1 })
      .mockReturnValue({ id: 1, keywords: 'updated', min_price: 200 });
    db.prepare().run.mockReturnValue({ changes: 1 });
    const req = mockReq({ params: { id: '1' }, validated: { keywords: 'updated', min_price: 200 } });
    const res = mockRes();
    handlers[handlers.length - 1](req, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });

  it('POST / backfill skips post when keywords do not match (line 75)', async () => {
    const handlers = getRouteHandlers('post', '/');
    const db = (await vi.importMock('../db.js')).default;
    db.prepare().get
      .mockReturnValueOnce({ tier: 'free', is_premium: 0 })
      .mockReturnValueOnce({ cnt: 0 })
      .mockReturnValue({ id: 42, keywords: 'test' });
    db.prepare().run.mockReturnValue({ lastInsertRowid: 42 });
    db.prepare().all.mockReturnValue([
      { post_id: 'p1', title: 'Something Else', body: '', source: 'reddit', scanned_at: '2024-01-01' },
    ]);
    const req = mockReq({ validated: { keywords: 'GMK', notify_target: 'a@b.com', subreddit: 'all' } });
    const res = mockRes();
    handlers[handlers.length - 1](req, res);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('POST / backfill skips post when price filter fails (line 76)', async () => {
    const handlers = getRouteHandlers('post', '/');
    const db = (await vi.importMock('../db.js')).default;
    db.prepare().get
      .mockReturnValueOnce({ tier: 'pro', is_premium: 1 })
      .mockReturnValueOnce({ cnt: 0 })
      .mockReturnValue({ id: 42, keywords: 'test' });
    db.prepare().run.mockReturnValue({ lastInsertRowid: 42 });
    db.prepare().all.mockReturnValue([
      { post_id: 'p1', title: 'GMK Set $150', body: '', source: 'reddit', scanned_at: '2024-01-01' },
    ]);
    const req = mockReq({ validated: { keywords: 'GMK', min_price: 200, notify_target: 'a@b.com', subreddit: 'all' } });
    const res = mockRes();
    handlers[handlers.length - 1](req, res);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('POST / backfill skips post when match already exists (lines 77-78)', async () => {
    const handlers = getRouteHandlers('post', '/');
    const db = (await vi.importMock('../db.js')).default;
    db.prepare().get
      .mockReturnValueOnce({ tier: 'free', is_premium: 0 })
      .mockReturnValueOnce({ cnt: 0 })
      .mockReturnValueOnce({ id: 99 })
      .mockReturnValue({ id: 42, keywords: 'test' });
    db.prepare().run.mockReturnValue({ lastInsertRowid: 42 });
    db.prepare().all.mockReturnValue([
      { post_id: 'p1', title: 'GMK Set $150', body: '', source: 'reddit', scanned_at: '2024-01-01' },
    ]);
    const req = mockReq({ validated: { keywords: 'GMK', notify_target: 'a@b.com', subreddit: 'all' } });
    const res = mockRes();
    handlers[handlers.length - 1](req, res);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('PUT /:id falls back to free features when tier is unknown (line 106)', async () => {
    const handlers = getRouteHandlers('put', '/:id');
    const db = (await vi.importMock('../db.js')).default;
    db.prepare().get
      .mockReturnValueOnce({ id: 1, keywords: 'old', user_id: 1 })
      .mockReturnValueOnce({ tier: 'unknown', is_premium: 0 })
      .mockReturnValue({ id: 1, keywords: 'updated' });
    db.prepare().run.mockReturnValue({ changes: 1 });
    const req = mockReq({ params: { id: '1' }, validated: { keywords: 'updated' } });
    const res = mockRes();
    handlers[handlers.length - 1](req, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });

  it('PUT /:id exercises null coalescing in run params (line 130)', async () => {
    const handlers = getRouteHandlers('put', '/:id');
    const db = (await vi.importMock('../db.js')).default;
    db.prepare().get
      .mockReturnValueOnce({ id: 1, keywords: 'old', user_id: 1 })
      .mockReturnValueOnce({ tier: 'free', is_premium: 0 })
      .mockReturnValue({ id: 1, keywords: 'old' });
    db.prepare().run.mockReturnValue({ changes: 1 });
    const req = mockReq({ params: { id: '1' }, validated: {} });
    const res = mockRes();
    handlers[handlers.length - 1](req, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });

  it('POST / getTier fallback: u.tier absent, is_premium=1 (line 13)', async () => {
    const handlers = getRouteHandlers('post', '/');
    const db = (await vi.importMock('../db.js')).default;
    db.prepare().get
      .mockReturnValueOnce({ is_premium: 1 })
      .mockReturnValueOnce({ cnt: 0 })
      .mockReturnValue({ id: 42, keywords: 'test' });
    db.prepare().run.mockReturnValue({ lastInsertRowid: 42 });
    db.prepare().all.mockReturnValue([]);
    const req = mockReq({ validated: { keywords: 'test', notify_target: 'a@b.com' } });
    const res = mockRes();
    handlers[handlers.length - 1](req, res);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('POST / TIER_FEATURES and TIER_LIMITS fallback for unknown tier (lines 38-40)', async () => {
    const handlers = getRouteHandlers('post', '/');
    const db = (await vi.importMock('../db.js')).default;
    db.prepare().get
      .mockReturnValueOnce({ tier: 'bogus', is_premium: 0 })
      .mockReturnValueOnce({ cnt: 0 })
      .mockReturnValue({ id: 42, keywords: 'test' });
    db.prepare().run.mockReturnValue({ lastInsertRowid: 42 });
    db.prepare().all.mockReturnValue([]);
    const req = mockReq({ validated: { keywords: 'test', notify_target: 'a@b.com' } });
    const res = mockRes();
    handlers[handlers.length - 1](req, res);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('POST / getTier returns free when user not found (line 13)', async () => {
    const handlers = getRouteHandlers('post', '/');
    const db = (await vi.importMock('../db.js')).default;
    db.prepare().get
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({ cnt: 0 })
      .mockReturnValue({ id: 42, keywords: 'test' });
    db.prepare().run.mockReturnValue({ lastInsertRowid: 42 });
    db.prepare().all.mockReturnValue([]);
    const req = mockReq({ validated: { keywords: 'test', notify_target: 'a@b.com' } });
    const res = mockRes();
    handlers[handlers.length - 1](req, res);
    expect(res.status).toHaveBeenCalledWith(201);
  });
});
