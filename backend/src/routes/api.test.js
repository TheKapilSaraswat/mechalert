import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockStmt = {
  run: vi.fn(() => ({ changes: 1 })),
  get: vi.fn(() => ({ id: 1, is_premium: 1, api_key: 'existing-api-key' })),
  all: vi.fn(() => [{ id: 1, title: 'Keyboard', price: 150, keywords: 'keyboard' }]),
};
vi.mock('../db.js', () => ({ default: { prepare: vi.fn(() => mockStmt) } }));

function resetMockStmt() {
  mockStmt.run.mockReset();
  mockStmt.run.mockImplementation(() => ({ changes: 1 }));
  mockStmt.get.mockReset();
  mockStmt.get.mockImplementation(() => ({ id: 1, is_premium: 1, api_key: 'existing-api-key' }));
  mockStmt.all.mockReset();
  mockStmt.all.mockImplementation(() => [{ id: 1, title: 'Keyboard', price: 150, keywords: 'keyboard' }]);
}
vi.mock('jsonwebtoken', () => ({ default: { verify: vi.fn(() => ({ userId: 1, version: 1 })) } }));
vi.mock('../logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('../middleware.js', () => ({ jwtAuth: (req, res, next) => { req.user = { userId: 1 }; next(); } }));

import logger from '../logger.js';
import apiRoutes from './api.js';

function mockReq(overrides = {}) {
  return { headers: { authorization: 'Bearer test' }, body: {}, params: {}, user: { userId: 1 }, query: {}, ...overrides };
}
function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  res.set = vi.fn(() => res);
  res.type = vi.fn(() => res);
  return res;
}
function getHandler(method, path) {
  const route = apiRoutes.stack.find(l => l.route?.path === path && l.route.methods[method])?.route;
  if (!route) return null;
  const handlers = route.stack.map(l => l.handle);
  return handlers[handlers.length - 1];
}
function getHandlers(method, path) {
  const route = apiRoutes.stack.find(l => l.route?.path === path && l.route.methods[method])?.route;
  if (!route) return [];
  return route.stack.map(l => l.handle);
}

describe('API Routes', () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockStmt(); });

  it('GET /settings/api-key returns existing key', () => {
    const res = mockRes();
    getHandler('get', '/settings/api-key')(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith({ api_key: 'existing-api-key' });
  });

  it('GET /settings/api-key generates new key for premium user', async () => {
    mockStmt.get
      .mockReturnValueOnce({ id: 1, is_premium: 1, api_key: null })
      .mockReturnValueOnce({ api_key: 'new-generated-key' });
    const res = mockRes();
    getHandler('get', '/settings/api-key')(mockReq(), res);
    expect(res.json).toHaveBeenCalled();
  });

  it('GET /settings/api-key returns 403 for non-premium', async () => {
    mockStmt.get.mockReturnValue({ id: 1, is_premium: 0, api_key: null });
    const res = mockRes();
    getHandler('get', '/settings/api-key')(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('GET /settings/api-key returns 500 on error', async () => {
    mockStmt.get.mockImplementation(() => { throw new Error('DB error'); });
    const res = mockRes();
    getHandler('get', '/settings/api-key')(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('GET /v1/matches returns matches with API key', async () => {
    mockStmt.get.mockReturnValue({ id: 1, is_premium: 1, api_key: 'key' });
    const res = mockRes();
    getHandler('get', '/v1/matches')(mockReq({ query: { api_key: 'test-key' } }), res);
    expect(res.json).toHaveBeenCalled();
  });

  it('GET /v1/matches returns empty array when no matches', async () => {
    mockStmt.get.mockReturnValue({ id: 1, is_premium: 1, api_key: 'key' });
    mockStmt.all.mockReturnValue([]);
    const res = mockRes();
    getHandler('get', '/v1/matches')(mockReq({ query: { api_key: 'test-key' } }), res);
    expect(res.json).toHaveBeenCalledWith([]);
  });

  it('GET /settings/api-key returns 404 when user not found', async () => {
    mockStmt.get.mockReturnValue(undefined);
    const res = mockRes();
    getHandler('get', '/settings/api-key')(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'User not found' });
  });

  it('GET /settings/api-key calls logger.error on DB error', async () => {
    mockStmt.get.mockImplementation(() => { throw new Error('DB fail'); });
    const res = mockRes();
    getHandler('get', '/settings/api-key')(mockReq(), res);
    expect(logger.error).toHaveBeenCalled();
  });

  it('GET /v1/matches returns 401 when no API key provided', async () => {
    const res = mockRes();
    getHandler('get', '/v1/matches')(mockReq({ query: {}, headers: {} }), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'API key required' });
  });

  it('GET /v1/matches returns 401 when invalid API key in query', async () => {
    mockStmt.get.mockReturnValue(undefined);
    const res = mockRes();
    getHandler('get', '/v1/matches')(mockReq({ query: { api_key: 'bad-key' } }), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid API key' });
  });

  it('GET /v1/matches returns 401 when invalid API key in header', async () => {
    mockStmt.get.mockReturnValue(undefined);
    const res = mockRes();
    getHandler('get', '/v1/matches')(mockReq({ headers: { 'x-api-key': 'bad-key' }, query: {} }), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid API key' });
  });

  it('GET /v1/matches returns 401 when non-premium API key', async () => {
    mockStmt.get.mockReturnValue({ id: 1, is_premium: 0 });
    const res = mockRes();
    getHandler('get', '/v1/matches')(mockReq({ query: { api_key: 'free-key' } }), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Premium account required' });
  });

  it('GET /v1/matches returns 500 on user lookup error', async () => {
    mockStmt.get.mockImplementation(() => { throw new Error('DB error'); });
    const res = mockRes();
    getHandler('get', '/v1/matches')(mockReq({ query: { api_key: 'test-key' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('GET /v1/matches sets Cache-Control header', async () => {
    mockStmt.get.mockReturnValue({ id: 1, is_premium: 1 });
    const res = mockRes();
    getHandler('get', '/v1/matches')(mockReq({ query: { api_key: 'test-key' } }), res);
    expect(res.set).toHaveBeenCalledWith('Cache-Control', 'public, max-age=60');
  });

  it('GET /v1/matches returns all expected fields in match objects', async () => {
    const match = { id: 1, post_id: 'p1', title: 'Deal', price: 50, permalink: '/r/deal', deal_score: 90, source: 'reddit', keywords: 'key', sent_at: '2024-06-01T00:00:00Z' };
    mockStmt.get.mockReturnValue({ id: 1, is_premium: 1 });
    mockStmt.all.mockReturnValue([match]);
    const res = mockRes();
    getHandler('get', '/v1/matches')(mockReq({ query: { api_key: 'test-key' } }), res);
    expect(res.json).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining(match)]));
  });

  it('GET /v1/matches works with x-api-key header', async () => {
    mockStmt.get.mockReturnValue({ id: 1, is_premium: 1 });
    mockStmt.all.mockReturnValue([{ id: 1, title: 'Headphones' }]);
    const res = mockRes();
    getHandler('get', '/v1/matches')(mockReq({ headers: { 'x-api-key': 'header-key' }, query: {} }), res);
    expect(res.json).toHaveBeenCalled();
  });

  it('GET /v1/matches returns 500 on matches query error', async () => {
    mockStmt.get.mockReturnValue({ id: 1, is_premium: 1 });
    mockStmt.all.mockImplementation(() => { throw new Error('Query failed'); });
    const res = mockRes();
    getHandler('get', '/v1/matches')(mockReq({ query: { api_key: 'test-key' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('apiKeyRateLimit calls next when under limit', () => {
    const [rateLimit] = getHandlers('get', '/v1/matches');
    const req = mockReq({ query: { api_key: 'test' }, apiKey: 'under_limit_test' });
    const res = mockRes();
    const next = vi.fn();
    rateLimit(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('apiKeyRateLimit returns 429 when rate limit exceeded', () => {
    const [rateLimit] = getHandlers('get', '/v1/matches');
    const req = mockReq({ query: { api_key: 'test' }, apiKey: 'rate_limit_test' });
    const res = mockRes();
    const next = vi.fn();
    for (let i = 0; i < 100; i++) {
      rateLimit(req, res, next);
    }
    rateLimit(req, res, next);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith({ error: expect.stringContaining('Too many requests') });
  });

  it('apiKeyRateLimit uses req.apiKey as rate limit key when available', () => {
    const [rateLimit] = getHandlers('get', '/v1/matches');
    const req = mockReq({ query: { api_key: 'test' }, apiKey: 'custom_user_key' });
    const res = mockRes();
    const next = vi.fn();
    rateLimit(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('apiKeyRateLimit falls back to req.ip when apiKey not set', () => {
    const [rateLimit] = getHandlers('get', '/v1/matches');
    const req = mockReq({ query: { api_key: 'test' }, ip: '10.0.0.1' });
    const res = mockRes();
    const next = vi.fn();
    rateLimit(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('apiKeyRateLimit resets window after time expires (lines 22-24)', () => {
    vi.useFakeTimers();
    const [rateLimit] = getHandlers('get', '/v1/matches');
    const req = mockReq({ query: { api_key: 'test' }, apiKey: 'window_reset_key' });
    const res = mockRes();
    const next = vi.fn();
    rateLimit(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60001);
    rateLimit(req, res, next);
    expect(next).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
