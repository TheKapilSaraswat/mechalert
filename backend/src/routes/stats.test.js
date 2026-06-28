import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockStmt = {
  run: vi.fn(),
  get: vi.fn(() => ({ c: 0, tier: 'free', savings: 0 })),
  all: vi.fn(() => []),
};
vi.mock('../db.js', () => ({ default: { prepare: vi.fn(() => mockStmt) } }));

function resetMockStmt() {
  mockStmt.run.mockReset();
  mockStmt.run.mockImplementation(() => undefined);
  mockStmt.get.mockReset();
  mockStmt.get.mockImplementation(() => ({ c: 0, tier: 'free', savings: 0 }));
  mockStmt.all.mockReset();
  mockStmt.all.mockImplementation(() => []);
}
vi.mock('jsonwebtoken', () => ({ default: { verify: vi.fn(() => ({ userId: 1, version: 1 })) } }));
vi.mock('../logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('../middleware.js', () => ({ jwtAuth: (req, res, next) => { req.user = { userId: 1 }; next(); }, requirePremium: (req, res, next) => next() }));

import statsRoutes from './stats.js';

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
  const route = statsRoutes.stack.find(l => l.route?.path === path && l.route.methods[method])?.route;
  if (!route) return null;
  const handlers = route.stack.map(l => l.handle);
  return handlers[handlers.length - 1];
}

describe('Stats Routes', () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockStmt(); });

  it('GET / returns personal stats', async () => {
    mockStmt.get
      .mockReturnValueOnce({ c: 0, tier: 'free' }) // user lookup
      .mockReturnValueOnce({ c: 42 }) // totalListings
      .mockReturnValueOnce({ c: 5 })  // watchedListings
      .mockReturnValueOnce({ c: 10 }) // matchesFound
      .mockReturnValueOnce({ c: 3 })  // rulesActive
      .mockReturnValueOnce({ c: 7 })  // savedDeals
      .mockReturnValueOnce({ c: 20 }) // searchesDone
      .mockReturnValueOnce({ savings: 500 }) // totalSavings
      .mockReturnValueOnce({ c: 2 })  // rareFinds
      .mockReturnValueOnce({ c: 3 })  // priceDrops
      .mockReturnValueOnce({ c: 15 }) // notificationsSent
      .mockReturnValue({ c: 0 });     // final get
    const res = mockRes();
    getHandler('get', '/')(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      tier: 'free',
      totalListings: 42,
      watchedListings: 5,
    }));
  });

  it('GET / returns 500 on error', async () => {
    mockStmt.get.mockImplementation(() => { throw new Error('DB error'); });
    const res = mockRes();
    getHandler('get', '/')(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('GET /insights returns premium insights', async () => {
    mockStmt.all.mockReturnValue([{ source: 'reddit', c: 10 }]);
    mockStmt.get.mockReturnValueOnce({ tier: 'pro' }).mockReturnValue({});
    const res = mockRes();
    getHandler('get', '/insights')(mockReq(), res);
    expect(res.json).toHaveBeenCalled();
  });

  it('GET /insights returns 500 on error', async () => {
    mockStmt.get.mockImplementation(() => { throw new Error('DB error'); });
    const res = mockRes();
    getHandler('get', '/insights')(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('GET / returns tier from DB tier field', async () => {
    mockStmt.get
      .mockReturnValueOnce({ tier: 'pro' })
      .mockReturnValueOnce({ c: 100 })
      .mockReturnValueOnce({ c: 10 })
      .mockReturnValueOnce({ c: 25 })
      .mockReturnValueOnce({ c: 5 })
      .mockReturnValueOnce({ c: 15 })
      .mockReturnValueOnce({ c: 50 })
      .mockReturnValueOnce({ savings: 750 })
      .mockReturnValueOnce({ c: 3 })
      .mockReturnValueOnce({ c: 8 })
      .mockReturnValueOnce({ c: 42 });
    mockStmt.all.mockReturnValue([{ title: 'Price Drop', price: 99 }]);
    const res = mockRes();
    getHandler('get', '/')(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ tier: 'pro', totalListings: 100, totalSavings: 750 }));
  });

  it('GET / derives pro tier from is_premium when tier field absent', async () => {
    mockStmt.get
      .mockReturnValueOnce({ is_premium: 1 })
      .mockReturnValueOnce({ c: 0 })
      .mockReturnValueOnce({ c: 0 })
      .mockReturnValueOnce({ c: 0 })
      .mockReturnValueOnce({ c: 0 })
      .mockReturnValueOnce({ c: 0 })
      .mockReturnValueOnce({ c: 0 })
      .mockReturnValueOnce({ savings: 0 })
      .mockReturnValueOnce({ c: 0 })
      .mockReturnValueOnce({ c: 0 })
      .mockReturnValueOnce({ c: 0 });
    const res = mockRes();
    getHandler('get', '/')(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ tier: 'pro' }));
  });

  it('GET / derives free tier when not premium and no tier field', async () => {
    mockStmt.get
      .mockReturnValueOnce({ is_premium: 0 })
      .mockReturnValueOnce({ c: 0 })
      .mockReturnValueOnce({ c: 0 })
      .mockReturnValueOnce({ c: 0 })
      .mockReturnValueOnce({ c: 0 })
      .mockReturnValueOnce({ c: 0 })
      .mockReturnValueOnce({ c: 0 })
      .mockReturnValueOnce({ savings: 0 })
      .mockReturnValueOnce({ c: 0 })
      .mockReturnValueOnce({ c: 0 })
      .mockReturnValueOnce({ c: 0 });
    const res = mockRes();
    getHandler('get', '/')(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ tier: 'free' }));
  });

  it('GET / handles null user lookup with free tier', async () => {
    mockStmt.get
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({ c: 0 })
      .mockReturnValueOnce({ c: 0 })
      .mockReturnValueOnce({ c: 0 })
      .mockReturnValueOnce({ c: 0 })
      .mockReturnValueOnce({ c: 0 })
      .mockReturnValueOnce({ c: 0 })
      .mockReturnValueOnce({ savings: 0 })
      .mockReturnValueOnce({ c: 0 })
      .mockReturnValueOnce({ c: 0 })
      .mockReturnValueOnce({ c: 0 });
    const res = mockRes();
    getHandler('get', '/')(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ tier: 'free' }));
  });

  it('GET / returns all response shape fields', async () => {
    mockStmt.get
      .mockReturnValueOnce({ tier: 'pro' })
      .mockReturnValueOnce({ c: 10 })
      .mockReturnValueOnce({ c: 10 })
      .mockReturnValueOnce({ c: 10 })
      .mockReturnValueOnce({ c: 10 })
      .mockReturnValueOnce({ c: 10 })
      .mockReturnValueOnce({ c: 10 })
      .mockReturnValueOnce({ savings: 100 })
      .mockReturnValueOnce({ c: 10 })
      .mockReturnValueOnce({ c: 10 })
      .mockReturnValueOnce({ c: 10 });
    mockStmt.all.mockReturnValue([{ title: 'Drop', price: 50 }]);
    const res = mockRes();
    getHandler('get', '/')(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      tier: expect.any(String), totalListings: expect.any(Number), watchedListings: expect.any(Number),
      matchesFound: expect.any(Number), rulesActive: expect.any(Number), savedDeals: expect.any(Number),
      searchesDone: expect.any(Number), totalSavings: expect.any(Number), rareFinds: expect.any(Number),
      priceDrops: expect.any(Number), notificationsSent: expect.any(Number),
      recentDrops: expect.any(Array), bySource: expect.any(Array),
    }));
  });

  it('GET / returns recentDrops with data', async () => {
    const drops = [{ id: 1, title: 'Drop Alert', old_price: 100, new_price: 80 }];
    mockStmt.get
      .mockReturnValueOnce({ tier: 'free' })
      .mockReturnValueOnce({ c: 0 })
      .mockReturnValueOnce({ c: 0 })
      .mockReturnValueOnce({ c: 0 })
      .mockReturnValueOnce({ c: 0 })
      .mockReturnValueOnce({ c: 0 })
      .mockReturnValueOnce({ c: 0 })
      .mockReturnValueOnce({ savings: 0 })
      .mockReturnValueOnce({ c: 0 })
      .mockReturnValueOnce({ c: 0 })
      .mockReturnValueOnce({ c: 0 });
    mockStmt.all.mockReturnValue(drops);
    const res = mockRes();
    getHandler('get', '/')(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ recentDrops: drops }));
  });

  it('GET / returns bySource grouped data', async () => {
    const sources = [{ source: 'reddit', c: 5 }, { source: 'amazon', c: 3 }];
    mockStmt.get
      .mockReturnValueOnce({ tier: 'free' })
      .mockReturnValueOnce({ c: 0 })
      .mockReturnValueOnce({ c: 0 })
      .mockReturnValueOnce({ c: 0 })
      .mockReturnValueOnce({ c: 0 })
      .mockReturnValueOnce({ c: 0 })
      .mockReturnValueOnce({ c: 0 })
      .mockReturnValueOnce({ savings: 0 })
      .mockReturnValueOnce({ c: 0 })
      .mockReturnValueOnce({ c: 0 })
      .mockReturnValueOnce({ c: 0 });
    mockStmt.all.mockReturnValue(sources);
    const res = mockRes();
    getHandler('get', '/')(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ bySource: sources }));
  });

  it('GET / calls logger.error on DB error', async () => {
    mockStmt.get.mockImplementation(() => { throw new Error('DB fail'); });
    const res = mockRes();
    getHandler('get', '/')(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('GET /insights returns 403 for free tier user', async () => {
    mockStmt.get.mockReturnValueOnce({ tier: 'free' });
    const res = mockRes();
    getHandler('get', '/insights')(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Daily insights require Pro.' });
  });

  it('GET /insights returns insights for pro+ tier user', async () => {
    mockStmt.get
      .mockReturnValueOnce({ tier: 'pro+' })
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({ saved: 0 });
    mockStmt.all.mockReturnValue([]);
    const res = mockRes();
    getHandler('get', '/insights')(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      date: expect.any(String),
      bestDeal: null,
      trending: expect.any(Array),
      cheapestBySource: expect.any(Array),
      topSeller: null,
      yourActivity: expect.objectContaining({ savedToday: expect.any(Number) }),
    }));
  });

  it('GET /insights returns bestDeal with full fields', async () => {
    const deal = { title: 'Best Deal', price: 50, market_value: 100, deal_score: 95, permalink: '/r/deal', ai_explanation: 'Great deal' };
    mockStmt.get
      .mockReturnValueOnce({ tier: 'pro' })
      .mockReturnValueOnce(deal);
    mockStmt.all.mockReturnValue([{ title: 'Trending', price: 75, permalink: '/r/trend', deal_score: 80 }]);
    const res = mockRes();
    getHandler('get', '/insights')(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      bestDeal: expect.objectContaining(deal),
    }));
  });

  it('GET /insights returns trending and cheapestBySource arrays', async () => {
    const trending = [{ title: 'Hot Deal', price: 20, permalink: '/r/hot', deal_score: 85 }];
    const cheapest = [{ source: 'amazon', min_price: 10, count: 5 }];
    mockStmt.get
      .mockReturnValueOnce({ tier: 'pro' })
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({ saved: 3 });
    mockStmt.all
      .mockReturnValueOnce(trending)
      .mockReturnValueOnce(cheapest);
    const res = mockRes();
    getHandler('get', '/insights')(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      trending,
      cheapestBySource: cheapest,
    }));
  });

  it('GET /insights returns topSeller object', async () => {
    const seller = { source: 'reddit', posts: 42 };
    mockStmt.get
      .mockReturnValueOnce({ tier: 'pro' })
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(seller)
      .mockReturnValueOnce({ saved: 1 });
    mockStmt.all.mockReturnValue([]);
    const res = mockRes();
    getHandler('get', '/insights')(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ topSeller: seller }));
  });

  it('GET /insights returns date in YYYY-MM-DD format', async () => {
    mockStmt.get
      .mockReturnValueOnce({ tier: 'pro' })
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({ saved: 0 });
    mockStmt.all.mockReturnValue([]);
    const res = mockRes();
    getHandler('get', '/insights')(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    }));
  });

  it('GET / returns empty arrays when no data exists', async () => {
    mockStmt.get
      .mockReturnValueOnce({ tier: 'free' })
      .mockReturnValueOnce({ c: 0 })
      .mockReturnValueOnce({ c: 0 })
      .mockReturnValueOnce({ c: 0 })
      .mockReturnValueOnce({ c: 0 })
      .mockReturnValueOnce({ c: 0 })
      .mockReturnValueOnce({ c: 0 })
      .mockReturnValueOnce({ savings: 0 })
      .mockReturnValueOnce({ c: 0 })
      .mockReturnValueOnce({ c: 0 })
      .mockReturnValueOnce({ c: 0 });
    mockStmt.all.mockReturnValue([]);
    const res = mockRes();
    getHandler('get', '/')(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      recentDrops: [], bySource: [],
    }));
  });

  it('GET /insights derives pro tier from is_premium when tier absent (line 62)', async () => {
    mockStmt.get
      .mockReturnValueOnce({ is_premium: 1 })
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({ saved: 0 });
    mockStmt.all.mockReturnValue([]);
    const res = mockRes();
    getHandler('get', '/insights')(mockReq(), res);
    expect(res.json).toHaveBeenCalled();
  });

  it('GET /insights derives free tier from is_premium=0 when tier absent (line 62)', async () => {
    mockStmt.get
      .mockReturnValueOnce({ is_premium: 0 })
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({ saved: 0 });
    mockStmt.all.mockReturnValue([]);
    const res = mockRes();
    getHandler('get', '/insights')(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
