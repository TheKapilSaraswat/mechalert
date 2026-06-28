import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockStmt = {
  run: vi.fn(() => ({ changes: 1 })),
  get: vi.fn(() => ({})),
  all: vi.fn(() => []),
};
vi.mock('../db.js', () => ({ default: { prepare: vi.fn(() => mockStmt) } }));

function resetMockStmt() {
  mockStmt.get.mockReset();
  mockStmt.get.mockImplementation(() => ({}));
  mockStmt.all.mockReset();
  mockStmt.all.mockImplementation(() => []);
  mockStmt.run.mockReset();
  mockStmt.run.mockImplementation(() => ({ changes: 1 }));
}

vi.mock('../logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));

import analyticsRoutes from './analytics.js';

function mockReq(overrides = {}) {
  return { headers: {}, body: {}, params: {}, query: {}, ...overrides };
}

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

function getHandler(method, path) {
  const route = analyticsRoutes.stack.find(l => l.route?.path === path && l.route.methods[method])?.route;
  if (!route) return null;
  return route.stack[route.stack.length - 1].handle;
}

describe('GET /price-history/:postId', () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockStmt(); });

  it('returns price history for a post', async () => {
    mockStmt.all.mockReturnValue([{ price: 100, recorded_at: '2025-01-01' }, { price: 90, recorded_at: '2025-01-02' }]);
    const handler = getHandler('get', '/price-history/:postId');
    const req = mockReq({ params: { postId: 'abc123' } });
    const res = mockRes();
    handler(req, res);
    expect(res.json).toHaveBeenCalledWith([{ price: 100, recorded_at: '2025-01-01' }, { price: 90, recorded_at: '2025-01-02' }]);
  });

  it('returns empty array when no history', () => {
    const handler = getHandler('get', '/price-history/:postId');
    const req = mockReq({ params: { postId: 'nonexistent' } });
    const res = mockRes();
    handler(req, res);
    expect(res.json).toHaveBeenCalledWith([]);
  });

  it('returns 500 on db error', async () => {
    mockStmt.all.mockImplementation(() => { throw new Error('DB error'); });
    const handler = getHandler('get', '/price-history/:postId');
    const req = mockReq({ params: { postId: '1' } });
    const res = mockRes();
    handler(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('returns single entry correctly', () => {
    mockStmt.all.mockReturnValue([{ price: 75, recorded_at: '2025-01-01' }]);
    const handler = getHandler('get', '/price-history/:postId');
    const req = mockReq({ params: { postId: 'single' } });
    const res = mockRes();
    handler(req, res);
    expect(res.json).toHaveBeenCalledWith([{ price: 75, recorded_at: '2025-01-01' }]);
  });

  it('returns entries ordered by recorded_at ascending', () => {
    mockStmt.all.mockReturnValue([
      { price: 100, recorded_at: '2025-01-01' },
      { price: 90, recorded_at: '2025-01-02' },
      { price: 80, recorded_at: '2025-01-03' },
    ]);
    const handler = getHandler('get', '/price-history/:postId');
    const req = mockReq({ params: { postId: 'ordered' } });
    const res = mockRes();
    handler(req, res);
    const result = res.json.mock.calls[0][0];
    expect(result.length).toBe(3);
    expect(result[0].price).toBe(100);
    expect(result[2].price).toBe(80);
  });

  it('handles null price values', () => {
    mockStmt.all.mockReturnValue([{ price: null, recorded_at: '2025-01-01' }, { price: 50, recorded_at: '2025-01-02' }]);
    const handler = getHandler('get', '/price-history/:postId');
    const req = mockReq({ params: { postId: 'nullprice' } });
    const res = mockRes();
    handler(req, res);
    expect(res.json).toHaveBeenCalledWith([{ price: null, recorded_at: '2025-01-01' }, { price: 50, recorded_at: '2025-01-02' }]);
  });

  it('handles postId with special characters', () => {
    mockStmt.all.mockReturnValue([{ price: 100, recorded_at: '2025-01-01' }]);
    const handler = getHandler('get', '/price-history/:postId');
    const req = mockReq({ params: { postId: 'abc/def?query=1' } });
    const res = mockRes();
    handler(req, res);
    expect(res.json).toHaveBeenCalled();
  });

  it('returns 500 when db prepare throws', async () => {
    const db = (await vi.importMock('../db.js')).default;
    db.prepare.mockImplementationOnce(() => { throw new Error('prepare error'); });
    const handler = getHandler('get', '/price-history/:postId');
    const req = mockReq({ params: { postId: '1' } });
    const res = mockRes();
    handler(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('GET /price-trends', () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockStmt(); });

  it('returns price trends with default 30 days', async () => {
    mockStmt.all.mockReturnValue([{ day: '2025-01-01', avg_price: 150, min_price: 100, max_price: 200, samples: 5 }]);
    const handler = getHandler('get', '/price-trends');
    const req = mockReq({ query: {} });
    const res = mockRes();
    handler(req, res);
    expect(res.json).toHaveBeenCalled();
  });

  it('accepts custom days parameter', () => {
    const handler = getHandler('get', '/price-trends');
    const req = mockReq({ query: { days: '7' } });
    const res = mockRes();
    handler(req, res);
    expect(res.json).toHaveBeenCalled();
  });

  it('filters by category', () => {
    const handler = getHandler('get', '/price-trends');
    const req = mockReq({ query: { days: '30', category: 'mechmarket' } });
    const res = mockRes();
    handler(req, res);
    expect(res.json).toHaveBeenCalled();
  });

  it('returns 500 on db error', async () => {
    mockStmt.all.mockImplementation(() => { throw new Error('DB error'); });
    const handler = getHandler('get', '/price-trends');
    const req = mockReq({ query: {} });
    const res = mockRes();
    handler(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('returns multiple trend entries', () => {
    mockStmt.all.mockReturnValue([
      { day: '2025-01-01', avg_price: 150, min_price: 100, max_price: 200, samples: 5 },
      { day: '2025-01-02', avg_price: 160, min_price: 120, max_price: 210, samples: 8 },
      { day: '2025-01-03', avg_price: 140, min_price: 90, max_price: 190, samples: 3 },
    ]);
    const handler = getHandler('get', '/price-trends');
    const req = mockReq({ query: { days: '7' } });
    const res = mockRes();
    handler(req, res);
    expect(res.json).toHaveBeenCalled();
    const result = res.json.mock.calls[0][0];
    expect(result.length).toBe(3);
  });

  it('response entries have correct shape', () => {
    mockStmt.all.mockReturnValue([{ day: '2025-01-01', avg_price: 150, min_price: 100, max_price: 200, samples: 5 }]);
    const handler = getHandler('get', '/price-trends');
    const req = mockReq({ query: {} });
    const res = mockRes();
    handler(req, res);
    expect(res.json).toHaveBeenCalledWith([{ day: '2025-01-01', avg_price: 150, min_price: 100, max_price: 200, samples: 5 }]);
  });

  it('handles days=0 parameter', () => {
    mockStmt.all.mockReturnValue([{ day: '2025-01-01', avg_price: 150, min_price: 100, max_price: 200, samples: 5 }]);
    const handler = getHandler('get', '/price-trends');
    const req = mockReq({ query: { days: '0' } });
    const res = mockRes();
    handler(req, res);
    expect(res.json).toHaveBeenCalled();
  });

  it('handles non-numeric days parameter (falls back to 30)', () => {
    mockStmt.all.mockReturnValue([{ day: '2025-01-01', avg_price: 150, min_price: 100, max_price: 200, samples: 5 }]);
    const handler = getHandler('get', '/price-trends');
    const req = mockReq({ query: { days: 'invalid' } });
    const res = mockRes();
    handler(req, res);
    expect(res.json).toHaveBeenCalled();
  });

  it('handles category with no results', () => {
    mockStmt.all.mockReturnValue([]);
    const handler = getHandler('get', '/price-trends');
    const req = mockReq({ query: { days: '30', category: 'nonexistent' } });
    const res = mockRes();
    handler(req, res);
    expect(res.json).toHaveBeenCalledWith([]);
  });

  it('handles days=1 single day parameter', () => {
    mockStmt.all.mockReturnValue([{ day: '2025-01-01', avg_price: 150, min_price: 100, max_price: 200, samples: 5 }]);
    const handler = getHandler('get', '/price-trends');
    const req = mockReq({ query: { days: '1' } });
    const res = mockRes();
    handler(req, res);
    expect(res.json).toHaveBeenCalled();
  });

  it('returns 500 when db prepare throws on trends', async () => {
    const db = (await vi.importMock('../db.js')).default;
    db.prepare.mockImplementationOnce(() => { throw new Error('prepare error'); });
    const handler = getHandler('get', '/price-trends');
    const req = mockReq({ query: {} });
    const res = mockRes();
    handler(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('GET /deal-distribution', () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockStmt(); });

  it('returns deal distribution stats', async () => {
    mockStmt.all
      .mockReturnValueOnce([{ source: 'reddit', c: 100 }])
      .mockReturnValueOnce([{ category: 'mechmarket', c: 80 }])
      .mockReturnValueOnce([{ bucket: 'good (50-79)', c: 30 }])
      .mockReturnValueOnce([{ bucket: 'under $50', c: 10 }]);
    const handler = getHandler('get', '/deal-distribution');
    const req = mockReq();
    const res = mockRes();
    handler(req, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      bySource: expect.any(Array),
      byCategory: expect.any(Array),
      scoreDistribution: expect.any(Array),
      priceRange: expect.any(Array),
    }));
  });

  it('returns 500 on db error', async () => {
    mockStmt.all.mockImplementation(() => { throw new Error('DB error'); });
    const handler = getHandler('get', '/deal-distribution');
    const req = mockReq();
    const res = mockRes();
    handler(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('returns empty arrays when no data exists', () => {
    mockStmt.all.mockReturnValue([]);
    const handler = getHandler('get', '/deal-distribution');
    const req = mockReq();
    const res = mockRes();
    handler(req, res);
    expect(res.json).toHaveBeenCalledWith({ bySource: [], byCategory: [], scoreDistribution: [], priceRange: [] });
  });

  it('returns multiple sources', () => {
    mockStmt.all
      .mockReturnValueOnce([{ source: 'reddit', c: 100 }, { source: 'craigslist', c: 50 }])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([]);
    const handler = getHandler('get', '/deal-distribution');
    const req = mockReq();
    const res = mockRes();
    handler(req, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      bySource: [{ source: 'reddit', c: 100 }, { source: 'craigslist', c: 50 }],
    }));
  });

  it('returns multiple categories', () => {
    mockStmt.all
      .mockReturnValueOnce([])
      .mockReturnValueOnce([{ category: 'mechmarket', c: 80 }, { category: 'photomarket', c: 40 }])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([]);
    const handler = getHandler('get', '/deal-distribution');
    const req = mockReq();
    const res = mockRes();
    handler(req, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      byCategory: [{ category: 'mechmarket', c: 80 }, { category: 'photomarket', c: 40 }],
    }));
  });

  it('returns all four score distribution buckets', () => {
    mockStmt.all
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([
        { bucket: 'hot (80-100)', c: 10 },
        { bucket: 'good (50-79)', c: 20 },
        { bucket: 'ok (20-49)', c: 15 },
        { bucket: 'skip (<20)', c: 5 },
      ])
      .mockReturnValueOnce([]);
    const handler = getHandler('get', '/deal-distribution');
    const req = mockReq();
    const res = mockRes();
    handler(req, res);
    const result = res.json.mock.calls[0][0];
    expect(result.scoreDistribution.length).toBe(4);
    expect(result.scoreDistribution[0].bucket).toBe('hot (80-100)');
  });

  it('returns all four price range buckets', () => {
    mockStmt.all
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([
        { bucket: 'under $50', c: 10 },
        { bucket: '$50-$100', c: 20 },
        { bucket: '$100-$500', c: 15 },
        { bucket: '$500+', c: 5 },
      ]);
    const handler = getHandler('get', '/deal-distribution');
    const req = mockReq();
    const res = mockRes();
    handler(req, res);
    const result = res.json.mock.calls[0][0];
    expect(result.priceRange.length).toBe(4);
    expect(result.priceRange[0].bucket).toBe('under $50');
  });

  it('handles partial data with only bySource populated', () => {
    mockStmt.all
      .mockReturnValueOnce([{ source: 'reddit', c: 100 }])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([]);
    const handler = getHandler('get', '/deal-distribution');
    const req = mockReq();
    const res = mockRes();
    handler(req, res);
    expect(res.json).toHaveBeenCalledWith({
      bySource: [{ source: 'reddit', c: 100 }],
      byCategory: [],
      scoreDistribution: [],
      priceRange: [],
    });
  });

  it('returns 500 when db prepare throws on distribution', async () => {
    const db = (await vi.importMock('../db.js')).default;
    db.prepare.mockImplementationOnce(() => { throw new Error('prepare error'); });
    const handler = getHandler('get', '/deal-distribution');
    const req = mockReq();
    const res = mockRes();
    handler(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
