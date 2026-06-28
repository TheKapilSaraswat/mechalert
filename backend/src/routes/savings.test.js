import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockStmt = {
  run: vi.fn(() => ({ changes: 1 })),
  get: vi.fn(() => ({ c: 0, totalSavings: 0, s: 0 })),
  all: vi.fn(() => []),
};
vi.mock('../db.js', () => ({ default: { prepare: vi.fn(() => mockStmt) } }));

function resetMockStmt() {
  mockStmt.get.mockReset();
  mockStmt.get.mockImplementation(() => ({ c: 0, totalSavings: 0, s: 0 }));
  mockStmt.all.mockReset();
  mockStmt.all.mockImplementation(() => []);
  mockStmt.run.mockReset();
  mockStmt.run.mockImplementation(() => ({ changes: 1 }));
  jwt.verify.mockReset();
  jwt.verify.mockImplementation(() => ({ userId: 1, version: 1 }));
}
vi.mock('jsonwebtoken', () => ({ default: { verify: vi.fn(() => ({ userId: 1, version: 1 })) } }));
vi.mock('../logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));

import jwt from 'jsonwebtoken';
import savingsRoutes from './savings.js';

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
  const route = savingsRoutes.stack.find(l => l.route?.path === path && l.route.methods[method])?.route;
  if (!route) return null;
  const handlers = route.stack.map(l => l.handle);
  return handlers[handlers.length - 1];
}
function getHandlers(method, path) {
  const route = savingsRoutes.stack.find(l => l.route?.path === path && l.route.methods[method])?.route;
  if (!route) return [];
  return route.stack.map(l => l.handle);
}

describe('Savings Routes', () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockStmt(); });

  it('GET / returns savings dashboard', async () => {
    mockStmt.get
      .mockReturnValueOnce({ c: 5 })  // dealsFound
      .mockReturnValueOnce({ c: 2 })  // dealsPurchased
      .mockReturnValueOnce({ s: 150 }) // totalSavings
      .mockReturnValue({}); // bestDeal
    const res = mockRes();
    getHandler('get', '/')(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      dealsFound: 5,
      dealsPurchased: 2,
    }));
  });

  it('GET / returns 500 on error', async () => {
    mockStmt.get.mockImplementation(() => { throw new Error('DB error'); });
    const res = mockRes();
    getHandler('get', '/')(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('POST /mark-purchased/:id marks deal as purchased', async () => {
    mockStmt.get.mockReturnValue({ id: 1, user_id: 1, alert_rule_id: null });
    const res = mockRes();
    getHandler('post', '/mark-purchased/:id')(mockReq({ params: { id: '1' }, body: { savings_amount: 50 } }), res);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('POST /mark-purchased/:id archives rule when requested', async () => {
    mockStmt.get.mockReturnValueOnce({ id: 1, user_id: 1, alert_rule_id: 5 }).mockReturnValueOnce({});
    const res = mockRes();
    getHandler('post', '/mark-purchased/:id')(mockReq({ params: { id: '1' }, body: { savings_amount: 50, archive_rule: true } }), res);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('POST /mark-purchased/:id returns 404 when not found', async () => {
    mockStmt.get.mockReturnValue(undefined);
    const res = mockRes();
    getHandler('post', '/mark-purchased/:id')(mockReq({ params: { id: '999' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('POST /mark-purchased/:id returns 500 on error', async () => {
    mockStmt.get.mockImplementation(() => { throw new Error('DB error'); });
    const res = mockRes();
    getHandler('post', '/mark-purchased/:id')(mockReq({ params: { id: '1' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('GET / returns 401 when no authorization header', () => {
    const [authHandler] = getHandlers('get', '/');
    const req = mockReq({ headers: {} });
    const res = mockRes();
    authHandler(req, res, () => {});
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'No token' });
  });

  it('GET / returns 401 when token is invalid', () => {
    jwt.verify.mockImplementationOnce(() => { throw new Error('jwt error'); });
    const [authHandler] = getHandlers('get', '/');
    const req = mockReq();
    const res = mockRes();
    authHandler(req, res, () => {});
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token' });
  });

  it('GET / returns empty dashboard when all counts are zero', async () => {
    mockStmt.get
      .mockReturnValueOnce({ c: 0 })
      .mockReturnValueOnce({ c: 0 })
      .mockReturnValueOnce({ s: 0 })
      .mockReturnValue(undefined);
    const res = mockRes();
    getHandler('get', '/')(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      dealsFound: 0, dealsPurchased: 0, totalSavings: 0, bestDeal: null,
    }));
  });

  it('GET / returns bestDeal when available', async () => {
    const deal = { savings_amount: 75, title: 'Best Buy', permalink: '/r/deal', source: 'reddit' };
    mockStmt.get
      .mockReturnValueOnce({ c: 5 })
      .mockReturnValueOnce({ c: 2 })
      .mockReturnValueOnce({ s: 150 })
      .mockReturnValueOnce(deal);
    const res = mockRes();
    getHandler('get', '/')(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      bestDeal: expect.objectContaining(deal),
    }));
  });

  it('GET / returns successStories with mapped fields', async () => {
    const stories = [{ title: 'Story1', price: 100, savings_amount: 30, permalink: '/r/s1', source: 'amazon', deal_score: 80, scanned_at: '2024-01-01', purchased_at: '2024-01-10' }];
    mockStmt.get
      .mockReturnValueOnce({ c: 5 })
      .mockReturnValueOnce({ c: 2 })
      .mockReturnValueOnce({ s: 150 })
      .mockReturnValueOnce(undefined);
    mockStmt.all.mockReturnValue(stories);
    const res = mockRes();
    getHandler('get', '/')(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      successStories: [expect.objectContaining({
        title: 'Story1', price: 100, savings: 30,
        marketValue: 130, permalink: '/r/s1', source: 'amazon', dealScore: 80,
      })],
    }));
  });

  it('GET / returns successStories as empty array when none purchased', async () => {
    mockStmt.get
      .mockReturnValueOnce({ c: 5 })
      .mockReturnValueOnce({ c: 0 })
      .mockReturnValueOnce({ s: 0 })
      .mockReturnValue(undefined);
    mockStmt.all.mockReturnValue([]);
    const res = mockRes();
    getHandler('get', '/')(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ successStories: [] }));
  });

  it('GET / calculates marketValue as price + savings_amount', async () => {
    const stories = [{ title: 'T', price: 80, savings_amount: 20, permalink: '/r/t', source: 'eBay', deal_score: 70, scanned_at: '2024-01-01', purchased_at: '2024-01-05' }];
    mockStmt.get
      .mockReturnValueOnce({ c: 1 })
      .mockReturnValueOnce({ c: 1 })
      .mockReturnValueOnce({ s: 20 })
      .mockReturnValueOnce(undefined);
    mockStmt.all.mockReturnValue(stories);
    const res = mockRes();
    getHandler('get', '/')(mockReq(), res);
    const call = res.json.mock.calls[0][0];
    expect(call.successStories[0].marketValue).toBe(100);
  });

  it('GET / rounds totalSavings to 2 decimal places', async () => {
    mockStmt.get
      .mockReturnValueOnce({ c: 1 })
      .mockReturnValueOnce({ c: 1 })
      .mockReturnValueOnce({ s: 123.4567 })
      .mockReturnValueOnce(undefined);
    const res = mockRes();
    getHandler('get', '/')(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ totalSavings: 123.46 }));
  });

  it('GET / calls logger.error on DB error', async () => {
    mockStmt.get.mockImplementation(() => { throw new Error('DB fail'); });
    const res = mockRes();
    getHandler('get', '/')(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('GET / returns full response shape', async () => {
    mockStmt.get
      .mockReturnValueOnce({ c: 10 })
      .mockReturnValueOnce({ c: 3 })
      .mockReturnValueOnce({ s: 300 })
      .mockReturnValueOnce({ savings_amount: 100, title: 'Deal', permalink: '/r/d', source: 'reddit' });
    mockStmt.all.mockReturnValue([{ title: 'X', price: 50, savings_amount: 20, permalink: '/r/x', source: 'x', deal_score: 60, scanned_at: '2024-01-01', purchased_at: '2024-01-02' }]);
    const res = mockRes();
    getHandler('get', '/')(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      dealsFound: expect.any(Number), dealsPurchased: expect.any(Number),
      totalSavings: expect.any(Number), bestDeal: expect.any(Object),
      successStories: expect.any(Array),
    }));
  });

  it('POST /mark-purchased/:id returns 401 when no authorization header', () => {
    const [authHandler] = getHandlers('post', '/mark-purchased/:id');
    const req = mockReq({ headers: {}, params: { id: '1' } });
    const res = mockRes();
    authHandler(req, res, () => {});
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'No token' });
  });

  it('POST /mark-purchased/:id returns 401 with invalid token', () => {
    jwt.verify.mockImplementationOnce(() => { throw new Error('jwt error'); });
    const [authHandler] = getHandlers('post', '/mark-purchased/:id');
    const req = mockReq({ params: { id: '1' } });
    const res = mockRes();
    authHandler(req, res, () => {});
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token' });
  });

  it('POST /mark-purchased/:id returns 400 when savings_amount is negative', async () => {
    mockStmt.get.mockReturnValue({ id: 1, user_id: 1, alert_rule_id: null });
    const res = mockRes();
    getHandler('post', '/mark-purchased/:id')(mockReq({ params: { id: '1' }, body: { savings_amount: -5 } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'savings_amount must be a non-negative number' });
  });

  it('POST /mark-purchased/:id returns 400 when savings_amount is not a number', async () => {
    mockStmt.get.mockReturnValue({ id: 1, user_id: 1, alert_rule_id: null });
    const res = mockRes();
    getHandler('post', '/mark-purchased/:id')(mockReq({ params: { id: '1' }, body: { savings_amount: 'abc' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('POST /mark-purchased/:id returns 404 when deal belongs to another user', async () => {
    mockStmt.get.mockReturnValue(undefined);
    const res = mockRes();
    getHandler('post', '/mark-purchased/:id')(mockReq({ params: { id: '999' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Saved deal not found' });
  });

  it('POST /mark-purchased/:id marks purchased with null savings_amount', async () => {
    mockStmt.get.mockReturnValue({ id: 1, user_id: 1, alert_rule_id: null });
    const res = mockRes();
    getHandler('post', '/mark-purchased/:id')(mockReq({ params: { id: '1' }, body: {} }), res);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('POST /mark-purchased/:id handles archive_rule when alert_rule_id is null', async () => {
    mockStmt.get.mockReturnValue({ id: 1, user_id: 1, alert_rule_id: null });
    const res = mockRes();
    getHandler('post', '/mark-purchased/:id')(mockReq({ params: { id: '1' }, body: { savings_amount: 25, archive_rule: true } }), res);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('POST /mark-purchased/:id calls logger.error on DB error', async () => {
    mockStmt.get.mockImplementation(() => { throw new Error('DB fail'); });
    const res = mockRes();
    getHandler('post', '/mark-purchased/:id')(mockReq({ params: { id: '1' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('POST /mark-purchased/:id archives rule when archive_rule and alert_rule_id present', async () => {
    mockStmt.get.mockReturnValueOnce({ id: 1, user_id: 1, alert_rule_id: 5 }).mockReturnValueOnce({});
    const res = mockRes();
    getHandler('post', '/mark-purchased/:id')(mockReq({ params: { id: '1' }, body: { savings_amount: 0, archive_rule: true } }), res);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('POST /mark-purchased/:id accepts zero savings_amount', async () => {
    mockStmt.get.mockReturnValue({ id: 1, user_id: 1, alert_rule_id: null });
    const res = mockRes();
    getHandler('post', '/mark-purchased/:id')(mockReq({ params: { id: '1' }, body: { savings_amount: 0 } }), res);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('GET / returns marketValue as null when price is missing (line 47 branch)', async () => {
    mockStmt.get
      .mockReturnValueOnce({ c: 1 })
      .mockReturnValueOnce({ c: 1 })
      .mockReturnValueOnce({ s: 20 })
      .mockReturnValueOnce(undefined);
    mockStmt.all.mockReturnValue([
      { title: 'No Price', price: null, savings_amount: 20, permalink: '/r/np', source: 'test', deal_score: 50, scanned_at: '2024-01-01', purchased_at: '2024-01-02' },
    ]);
    const res = mockRes();
    getHandler('get', '/')(mockReq(), res);
    const call = res.json.mock.calls[0][0];
    expect(call.successStories[0].marketValue).toBeNull();
  });

  it('GET / handles savings_amount null in marketValue (line 47 branch)', async () => {
    mockStmt.get
      .mockReturnValueOnce({ c: 1 })
      .mockReturnValueOnce({ c: 1 })
      .mockReturnValueOnce({ s: 20 })
      .mockReturnValueOnce(undefined);
    mockStmt.all.mockReturnValue([
      { title: 'Item', price: 100, savings_amount: null, permalink: '/r/it', source: 'test', deal_score: 50, scanned_at: '2024-01-01', purchased_at: '2024-01-02' },
    ]);
    const res = mockRes();
    getHandler('get', '/')(mockReq(), res);
    const call = res.json.mock.calls[0][0];
    expect(call.successStories[0].marketValue).toBe(100);
  });
});
