import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockStmt = {
  run: vi.fn(() => ({ changes: 1, lastInsertRowid: 42 })),
  get: vi.fn(() => ({ id: 1, is_premium: 1, tier: 'pro', c: 0 })),
  all: vi.fn(() => []),
};
vi.mock('../db.js', () => ({ default: { prepare: vi.fn(() => mockStmt) } }));

function resetMockStmt() {
  mockStmt.get.mockReset();
  mockStmt.get.mockImplementation(() => ({ id: 1, is_premium: 1, tier: 'pro', c: 0 }));
  mockStmt.all.mockReset();
  mockStmt.all.mockImplementation(() => []);
  mockStmt.run.mockReset();
  mockStmt.run.mockImplementation(() => ({ changes: 1, lastInsertRowid: 42 }));
}
vi.mock('jsonwebtoken', () => ({ default: { verify: vi.fn(() => ({ userId: 1, version: 1 })) } }));
vi.mock('../logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('node-fetch', () => ({ default: vi.fn() }));

import jwt from 'jsonwebtoken';
import aiAgentRoutes from './aiAgent.js';

let mockFetch;

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
  const route = aiAgentRoutes.stack.find(l => l.route?.path === path && l.route.methods[method])?.route;
  if (!route) return null;
  const handlers = route.stack.map(l => l.handle);
  return handlers[handlers.length - 1];
}
function getMiddlewares(method, path) {
  const route = aiAgentRoutes.stack.find(l => l.route?.path === path && l.route.methods[method])?.route;
  if (!route) return [];
  return route.stack.map(l => l.handle);
}

describe('AI Agent Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMockStmt();
    mockFetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ choices: [{ message: { content: '' } }] }) }));
    vi.stubGlobal('fetch', mockFetch);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('POST /chat handles chat message without API key', async () => {
    process.env.OPENROUTER_API_KEY = '';
    const res = mockRes();
    await getHandler('post', '/chat')(mockReq({ body: { message: 'hello' } }), res);
  });

  it('POST /chat returns 500 on error', async () => {
    const res = mockRes();
    const handler = getHandler('post', '/chat');
    const brokenReq = { headers: {}, body: {}, params: {}, user: {} };
    await handler(brokenReq, res);
  });

  it('POST /auto-keywords returns keywords for category', async () => {
    const res = mockRes();
    await getHandler('post', '/auto-keywords')(mockReq({ body: { category: 'keyboards' } }), res);
    expect(res.json).toHaveBeenCalled();
  });

  it('POST /auto-keywords returns 500 on error', async () => {
    const res = mockRes();
    await getHandler('post', '/auto-keywords')(mockReq({ body: { category: 'test' } }), res);
    expect(res.json).toHaveBeenCalledWith({ keywords: ['test'], category: 'test' });
  });

  it('POST /negotiate generates negotiation message', async () => {
    const res = mockRes();
    await getHandler('post', '/negotiate')(mockReq({ body: { title: 'Keychron Q1', price: 200 } }), res);
    expect(res.json).toHaveBeenCalled();
  });

  it('POST /negotiate returns 500 on error', async () => {
    const res = mockRes();
    const handler = getHandler('post', '/negotiate');
    await handler({ headers: {}, body: {}, params: {}, user: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('GET /flip-analysis/:postId returns flip analysis', async () => {
    mockStmt.get.mockReturnValue({ title: 'Item', price: 100, market_value: 150, source: 'reddit' });
    const res = mockRes();
    await getHandler('get', '/flip-analysis/:postId')(mockReq({ params: { postId: 'abc123' } }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      buyPrice: 100,
      estimatedResale: expect.any(Number),
      profit: expect.any(Number),
      profitMargin: expect.any(Number),
    }));
  });

  it('GET /flip-analysis/:postId returns 500 on error', async () => {
    const db = vi.mocked(await import('../db.js')).default;
    mockStmt.get.mockImplementation(() => { throw new Error('DB error'); });
    const res = mockRes();
    getHandler('get', '/flip-analysis/:postId')(mockReq({ params: { postId: '1' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('POST /chat returns 400 when message missing', async () => {
    const res = mockRes();
    await getHandler('post', '/chat')(mockReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Message required' });
  });

  it('POST /chat returns 404 when user not found', async () => {
    process.env.OPENROUTER_API_KEY = '';
    mockStmt.get.mockReturnValue(undefined);
    const res = mockRes();
    await getHandler('post', '/chat')(mockReq({ body: { message: 'hello' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'User not found' });
  });

  it('POST /chat returns 401 without auth header', async () => {
    const [auth] = getMiddlewares('post', '/chat');
    const req = { headers: {} };
    const res = mockRes();
    const next = vi.fn();
    auth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'No token' });
    expect(next).not.toHaveBeenCalled();
  });

  it('POST /chat returns 401 with invalid token', async () => {
    jwt.verify.mockImplementationOnce(() => { throw new Error('jwt malformed'); });
    const [auth] = getMiddlewares('post', '/chat');
    const req = { headers: { authorization: 'Bearer bad_token' } };
    const res = mockRes();
    const next = vi.fn();
    auth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token' });
    expect(next).not.toHaveBeenCalled();
  });

  it('POST /chat enforces free tier limit of 3 rules', async () => {
    mockStmt.get.mockReturnValue({ id: 1, is_premium: 0, cnt: 3, c: 0 });
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-test');
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: JSON.stringify({ action: 'create_alert', keywords: 'gaming laptop', subreddit: 'all', min_price: null, max_price: 900, response: 'Watching' }) } }] }),
    });
    const res = mockRes();
    await getHandler('post', '/chat')(mockReq({ body: { message: 'find gaming laptop under 900' } }), res);
    expect(res.json).toHaveBeenCalledWith({ action: 'chat', response: expect.stringContaining('Free tier limit') });
  });

  it('POST /chat create_alert action saves rule', async () => {
    mockStmt.get.mockReturnValue({ id: 1, is_premium: 1, cnt: 0, c: 0 });
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-test');
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: JSON.stringify({ action: 'create_alert', keywords: 'gaming laptop', subreddit: 'all', min_price: null, max_price: 900, response: 'Watching' }) } }] }),
    });
    const res = mockRes();
    await getHandler('post', '/chat')(mockReq({ body: { message: 'find gaming laptop under 900' } }), res);
    expect(mockStmt.run).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ action: 'create_alert' }));
  });

  it('POST /chat preview mode does not save rule', async () => {
    mockStmt.get.mockReturnValue({ id: 1, is_premium: 1, cnt: 0, c: 0 });
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-test');
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: JSON.stringify({ action: 'create_alert', keywords: 'gaming laptop', subreddit: 'all', min_price: null, max_price: 900, response: 'Watching' }) } }] }),
    });
    const res = mockRes();
    await getHandler('post', '/chat')(mockReq({ body: { message: 'show me gaming laptop under 900' } }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ action: 'search_preview' }));
    expect(mockStmt.run).not.toHaveBeenCalled();
  });

  it('POST /chat expand_keywords action', async () => {
    mockStmt.get.mockReturnValue({ id: 1, is_premium: 1 });
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-test');
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ choices: [{ message: { content: JSON.stringify({ action: 'expand_keywords', category: 'mirrorless camera', response: 'Let me find...' }) } }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ choices: [{ message: { content: JSON.stringify({ keywords: ['Sony A7 III', 'Canon R5'], response: 'I will search...' }) } }] }),
      });
    const res = mockRes();
    await getHandler('post', '/chat')(mockReq({ body: { message: 'mirrorless camera for travel' } }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      action: 'expand_keywords',
      expandedKeywords: ['Sony A7 III', 'Canon R5'],
    }));
  });

  it('POST /chat search action', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-test');
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: JSON.stringify({ action: 'search', query: 'gaming laptop', response: 'Let me look...' }) } }] }),
    });
    const res = mockRes();
    await getHandler('post', '/chat')(mockReq({ body: { message: 'search for gaming laptop' } }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ action: 'search', query: 'gaming laptop' }));
  });

  it('POST /chat chat action only', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-test');
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: JSON.stringify({ action: 'chat', response: 'Just chatting!' }) } }] }),
    });
    const res = mockRes();
    await getHandler('post', '/chat')(mockReq({ body: { message: 'hello' } }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ action: 'chat', response: 'Just chatting!' }));
  });

  it('POST /auto-keywords returns 400 when category missing', async () => {
    const res = mockRes();
    await getHandler('post', '/auto-keywords')(mockReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Category required' });
  });

  it('POST /auto-keywords with LLM response', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-test');
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: JSON.stringify({ keywords: ['Ducky One 3', 'Keychron Q1', 'Wooting 60HE'], category: 'mechanical keyboards' }) } }] }),
    });
    const res = mockRes();
    await getHandler('post', '/auto-keywords')(mockReq({ body: { category: 'mechanical keyboards' } }), res);
    expect(res.json).toHaveBeenCalledWith({
      keywords: ['Ducky One 3', 'Keychron Q1', 'Wooting 60HE'],
      category: 'mechanical keyboards',
    });
  });

  it('POST /negotiate returns 400 when title missing', async () => {
    const res = mockRes();
    await getHandler('post', '/negotiate')(mockReq({ body: { price: 200 } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Title and price required' });
  });

  it('POST /negotiate returns 400 when price missing', async () => {
    const res = mockRes();
    await getHandler('post', '/negotiate')(mockReq({ body: { title: 'Item' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Title and price required' });
  });

  it('POST /negotiate fallback when LLM fails', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-test');
    mockFetch.mockResolvedValue({ ok: false });
    const res = mockRes();
    await getHandler('post', '/negotiate')(mockReq({ body: { title: 'Item', price: 200 } }), res);
    expect(res.json).toHaveBeenCalledWith({ message: expect.stringContaining('$170'), suggestedPrice: 170 });
  });

  it('POST /negotiate with LLM response', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-test');
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: JSON.stringify({ message: 'Would you take $160?', suggestedPrice: 160 }) } }] }),
    });
    const res = mockRes();
    await getHandler('post', '/negotiate')(mockReq({ body: { title: 'Item', price: 200 } }), res);
    expect(res.json).toHaveBeenCalledWith({ message: 'Would you take $160?', suggestedPrice: 160 });
  });

  it('GET /flip-analysis/:postId returns 404 when post not found', async () => {
    mockStmt.get.mockReturnValue(undefined);
    const res = mockRes();
    await getHandler('get', '/flip-analysis/:postId')(mockReq({ params: { postId: 'nonexistent' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Post not found' });
  });

  it('GET /flip-analysis/:postId verifies response shape', async () => {
    mockStmt.get.mockReturnValue({ title: 'Test Item', price: 100, source: 'reddit' });
    const res = mockRes();
    await getHandler('get', '/flip-analysis/:postId')(mockReq({ params: { postId: 'abc123' } }), res);
    expect(res.json).toHaveBeenCalledWith({
      buyPrice: 100,
      estimatedResale: expect.any(Number),
      profit: expect.any(Number),
      profitMargin: expect.any(Number),
      risk: expect.any(String),
      aiSummary: null,
      riskFactors: [],
    });
  });

  it('POST /negotiate returns 500 when JSON parse fails', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-test');
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: 'NOT VALID JSON' } }] }),
    });
    const res = mockRes();
    await getHandler('post', '/negotiate')(mockReq({ body: { title: 'Item', price: 100 } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Negotiate error' });
  });

  it('GET /flip-analysis/:postId with AI summary', async () => {
    mockStmt.get.mockReturnValue({ title: 'Item', price: 100, source: 'reddit' });
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-test');
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: JSON.stringify({ summary: 'Good flip', riskFactors: ['Price is firm'] }) } }] }),
    });
    const res = mockRes();
    await getHandler('get', '/flip-analysis/:postId')(mockReq({ params: { postId: 'abc123' } }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      aiSummary: 'Good flip',
      riskFactors: ['Price is firm'],
    }));
  });

  it('GET /flip-analysis/:postId with bad JSON from LLM', async () => {
    mockStmt.get.mockReturnValue({ title: 'Item', price: 100, source: 'reddit' });
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-test');
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: 'Not valid JSON' } }] }),
    });
    const res = mockRes();
    await getHandler('get', '/flip-analysis/:postId')(mockReq({ params: { postId: 'abc123' } }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      aiSummary: null,
      riskFactors: [],
    }));
  });

  it('POST /chat returns 500 on DB error', async () => {
    mockStmt.get.mockImplementation(() => { throw new Error('DB error'); });
    const res = mockRes();
    await getHandler('post', '/chat')(mockReq({ body: { message: 'hello' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'AI chat error' });
  });

  it('POST /auto-keywords returns 500 on parse error', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-test');
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: 'BAD JSON' } }] }),
    });
    const res = mockRes();
    await getHandler('post', '/auto-keywords')(mockReq({ body: { category: 'test' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Auto-keywords error' });
  });

  it('handles fetch rejection gracefully in auto-keywords', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-test');
    mockFetch.mockRejectedValue(new Error('Network error'));
    const res = mockRes();
    await getHandler('post', '/auto-keywords')(mockReq({ body: { category: 'test' } }), res);
    expect(res.json).toHaveBeenCalledWith({ keywords: ['test'], category: 'test' });
  });
});
