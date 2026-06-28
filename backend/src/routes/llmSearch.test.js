import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../db.js', () => ({
  default: {
    prepare: vi.fn(() => ({
      run: vi.fn(() => ({ changes: 1, lastInsertRowid: 42 })),
      get: vi.fn(() => ({ c: 0 })),
      all: vi.fn(() => [{ id: 1, title: 'Keyboard $150', price: 150, permalink: '/r/t/1/' }]),
    })),
  },
}));
vi.mock('jsonwebtoken', () => ({ default: { verify: vi.fn(() => ({ userId: 1, version: 1 })) } }));
vi.mock('../logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('../middleware.js', () => ({ jwtAuth: (req, res, next) => { req.user = { userId: 1 }; next(); } }));
vi.mock('../validation.js', () => ({
  validate: () => (req, res, next) => { req.validated = req.body; next(); },
  searchQuerySchema: {},
}));
vi.mock('node-fetch', () => ({ default: vi.fn() }));

import llmSearchRoutes from './llmSearch.js';

function mockReq(overrides = {}) {
  return { headers: { authorization: 'Bearer test' }, body: {}, params: {}, user: { userId: 1 }, validated: null, ...overrides };
}
function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}
function getHandler(method, path) {
  const route = llmSearchRoutes.stack.find(l => l.route?.path === path && l.route.methods[method])?.route;
  if (!route) return null;
  const handlers = route.stack.map(l => l.handle);
  return handlers[handlers.length - 1];
}

describe('LLM Search Routes', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('POST / performs search with query', async () => {
    const res = mockRes();
    await getHandler('post', '/')(mockReq({ body: { query: 'mechanical keyboard under 200' }, validated: { query: 'mechanical keyboard under 200' } }), res);
    expect(res.json).toHaveBeenCalled();
  });

  it('POST / handles short query', async () => {
    const db = vi.mocked(await import('../db.js')).default;
    db.prepare().all.mockReturnValue([{ id: 1, title: 'Keyboard', price: 150 }]);
    const res = mockRes();
    await getHandler('post', '/')(mockReq({ body: { query: 'ab' }, validated: { query: 'ab' } }), res);
    expect(res.json).toHaveBeenCalled();
  });

  it('POST / returns 500 on db error', async () => {
    const db = vi.mocked(await import('../db.js')).default;
    db.prepare.mockImplementationOnce(() => { throw new Error('DB error'); });
    const res = mockRes();
    await getHandler('post', '/')(mockReq({ body: { query: 'test query' }, validated: { query: 'test query' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('POST / handles empty query gracefully', async () => {
    const res = mockRes();
    await getHandler('post', '/')(mockReq({ body: { query: '' }, validated: { query: '' } }), res);
    expect(res.json).toHaveBeenCalled();
  });

  it('returns correct response shape with all fields', async () => {
    const res = mockRes();
    await getHandler('post', '/')(mockReq({ body: { query: 'keyboard' }, validated: { query: 'keyboard' } }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      query: 'keyboard',
      filters: expect.any(Object),
      results: expect.any(Array),
      interpreted: expect.any(Boolean),
    }));
  });

  it('has interpreted: false for short query', async () => {
    const res = mockRes();
    await getHandler('post', '/')(mockReq({ body: { query: 'ab' }, validated: { query: 'ab' } }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ interpreted: false }));
  });

  it('has interpreted: true for long query when basicParse succeeds', async () => {
    const res = mockRes();
    await getHandler('post', '/')(mockReq({ body: { query: 'keyboard under 200' }, validated: { query: 'keyboard under 200' } }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ interpreted: true }));
  });

  it('returns results as an array', async () => {
    const res = mockRes();
    await getHandler('post', '/')(mockReq({ body: { query: 'test' }, validated: { query: 'test' } }), res);
    const call = res.json.mock.calls[0][0];
    expect(Array.isArray(call.results)).toBe(true);
  });

  it('returns empty results array when db returns empty', async () => {
    const emptyStmt = { run: vi.fn(() => ({ changes: 1, lastInsertRowid: 42 })), get: vi.fn(() => ({ c: 0 })), all: vi.fn(() => []) };
    const db = vi.mocked(await import('../db.js')).default;
    const origPrepareImpl = db.prepare.getMockImplementation();
    db.prepare.mockImplementation(() => emptyStmt);
    const res = mockRes();
    await getHandler('post', '/')(mockReq({ body: { query: 'zz' }, validated: { query: 'zz' } }), res);
    const call = res.json.mock.calls[0][0];
    expect(call.results).toEqual([]);
    db.prepare.mockImplementation(origPrepareImpl);
  });

  it('returns multiple results', async () => {
    const multiStmt = { run: vi.fn(() => ({ changes: 1, lastInsertRowid: 42 })), get: vi.fn(() => ({ c: 0 })), all: vi.fn(() => [
      { id: 1, title: 'Keyboard', price: 150, permalink: '/r/t/1/' },
      { id: 2, title: 'Mouse', price: 50, permalink: '/r/t/2/' },
      { id: 3, title: 'Monitor', price: 300, permalink: '/r/t/3/' },
    ]) };
    const db = vi.mocked(await import('../db.js')).default;
    const origPrepareImpl = db.prepare.getMockImplementation();
    db.prepare.mockImplementation(() => multiStmt);
    const res = mockRes();
    await getHandler('post', '/')(mockReq({ body: { query: 'ab' }, validated: { query: 'ab' } }), res);
    const call = res.json.mock.calls[0][0];
    expect(call.results.length).toBe(3);
    db.prepare.mockImplementation(origPrepareImpl);
  });

  it('saves search history on query', async () => {
    const db = vi.mocked(await import('../db.js')).default;
    const res = mockRes();
    await getHandler('post', '/')(mockReq({ body: { query: 'mechanical keyboard' }, validated: { query: 'mechanical keyboard' } }), res);
    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO deal_search_history'));
  });

  it('returns 500 when history insert fails', async () => {
    const db = vi.mocked(await import('../db.js')).default;
    db.prepare.mockImplementationOnce(() => { throw new Error('insert error'); });
    const res = mockRes();
    await getHandler('post', '/')(mockReq({ body: { query: 'test query' }, validated: { query: 'test query' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('short query returns filters with keywords', async () => {
    const res = mockRes();
    await getHandler('post', '/')(mockReq({ body: { query: 'xy' }, validated: { query: 'xy' } }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      filters: { keywords: 'xy' },
    }));
  });

  it('long query returns filters in response', async () => {
    const res = mockRes();
    await getHandler('post', '/')(mockReq({ body: { query: 'keyboard cheap' }, validated: { query: 'keyboard cheap' } }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      filters: { keywords: 'keyboard' },
      interpreted: true,
    }));
  });

  it('handles query exactly 2 characters (short path)', async () => {
    const res = mockRes();
    await getHandler('post', '/')(mockReq({ body: { query: 'qw' }, validated: { query: 'qw' } }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ interpreted: false }));
  });

  it('handles query exactly 3 characters (long path)', async () => {
    const res = mockRes();
    await getHandler('post', '/')(mockReq({ body: { query: 'key' }, validated: { query: 'key' } }), res);
    expect(res.json).toHaveBeenCalled();
  });

  it('handles query with only whitespace', async () => {
    const wsStmt = { run: vi.fn(() => ({ changes: 1, lastInsertRowid: 42 })), get: vi.fn(() => ({ c: 0 })), all: vi.fn(() => []) };
    const db = vi.mocked(await import('../db.js')).default;
    const origPrepareImpl = db.prepare.getMockImplementation();
    db.prepare.mockImplementation(() => wsStmt);
    const res = mockRes();
    await getHandler('post', '/')(mockReq({ body: { query: '   ' }, validated: { query: '   ' } }), res);
    expect(res.json).toHaveBeenCalled();
    db.prepare.mockImplementation(origPrepareImpl);
  });

  it('handles query with special characters', async () => {
    const res = mockRes();
    await getHandler('post', '/')(mockReq({ body: { query: '<script>alert(1)</script>' }, validated: { query: '<script>alert(1)</script>' } }), res);
    expect(res.json).toHaveBeenCalled();
  });

  it('returns 500 when db.all throws in buildQuery', async () => {
    const throwingStmt = {
      run: vi.fn(() => ({ changes: 1, lastInsertRowid: 42 })),
      get: vi.fn(() => ({ c: 0 })),
      all: vi.fn(() => { throw new Error('all error'); }),
    };
    const db = vi.mocked(await import('../db.js')).default;
    const origPrepareImpl = db.prepare.getMockImplementation();
    db.prepare.mockImplementation(() => throwingStmt);
    const res = mockRes();
    await getHandler('post', '/')(mockReq({ body: { query: 'test query' }, validated: { query: 'test query' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    db.prepare.mockImplementation(origPrepareImpl);
  });

  it('returns 500 on generic prepare error', async () => {
    const db = vi.mocked(await import('../db.js')).default;
    db.prepare.mockImplementationOnce(() => { throw new Error('prepare error'); });
    const res = mockRes();
    await getHandler('post', '/')(mockReq({ body: { query: 'some query' }, validated: { query: 'some query' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('returns query string in response', async () => {
    const res = mockRes();
    await getHandler('post', '/')(mockReq({ body: { query: 'gaming mouse' }, validated: { query: 'gaming mouse' } }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      query: 'gaming mouse',
    }));
  });

  describe('when parseQuery succeeds (interpreted: true)', () => {
    let origFetch;

    beforeEach(() => {
      origFetch = global.fetch;
      process.env.OPENROUTER_API_KEY = 'test-key';
    });

    afterEach(() => {
      global.fetch = origFetch;
      delete process.env.OPENROUTER_API_KEY;
    });

    it('returns interpreted: true with correct response shape', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: '{"keywords":"test deal"}' } }],
        }),
      });
      const res = mockRes();
      await getHandler('post', '/')(mockReq({ body: { query: 'test deal' }, validated: { query: 'test deal' } }), res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        query: 'test deal',
        filters: { keywords: 'test deal' },
        results: expect.any(Array),
        interpreted: true,
      }));
    });

    it('includes category filter in buildQuery and response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: '{"keywords":"camera","category":"photomarket"}' } }],
        }),
      });
      const db = vi.mocked(await import('../db.js')).default;
      const res = mockRes();
      await getHandler('post', '/')(mockReq({ body: { query: 'camera' }, validated: { query: 'camera' } }), res);
      expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('sp.category = ?'));
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        interpreted: true,
        filters: expect.objectContaining({ category: 'photomarket' }),
      }));
    });

    it('includes min_price filter in buildQuery and response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: '{"keywords":"camera","min_price":100}' } }],
        }),
      });
      const db = vi.mocked(await import('../db.js')).default;
      const res = mockRes();
      await getHandler('post', '/')(mockReq({ body: { query: 'camera' }, validated: { query: 'camera' } }), res);
      expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('sp.price >= ?'));
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        interpreted: true,
        filters: expect.objectContaining({ min_price: 100 }),
      }));
    });

    it('includes max_price filter in buildQuery and response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: '{"keywords":"keyboard","max_price":200}' } }],
        }),
      });
      const db = vi.mocked(await import('../db.js')).default;
      const res = mockRes();
      await getHandler('post', '/')(mockReq({ body: { query: 'keyboard' }, validated: { query: 'keyboard' } }), res);
      expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('sp.price <= ?'));
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        interpreted: true,
        filters: expect.objectContaining({ max_price: 200 }),
      }));
    });

    it('includes source filter in buildQuery and response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: '{"keywords":"keyboard","source":"reddit"}' } }],
        }),
      });
      const db = vi.mocked(await import('../db.js')).default;
      const res = mockRes();
      await getHandler('post', '/')(mockReq({ body: { query: 'reddit keyboard' }, validated: { query: 'reddit keyboard' } }), res);
      expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('sp.source = ?'));
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        interpreted: true,
        filters: expect.objectContaining({ source: 'reddit' }),
      }));
    });

    it('sorts by cheapest (sp.price ASC)', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: '{"keywords":"keyboard","sort":"cheapest"}' } }],
        }),
      });
      const db = vi.mocked(await import('../db.js')).default;
      const res = mockRes();
      await getHandler('post', '/')(mockReq({ body: { query: 'cheapest keyboard' }, validated: { query: 'cheapest keyboard' } }), res);
      expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('sp.price ASC'));
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ interpreted: true }));
    });

    it('sorts by best_score (sp.deal_score DESC)', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: '{"keywords":"keyboard","sort":"best_score"}' } }],
        }),
      });
      const db = vi.mocked(await import('../db.js')).default;
      const res = mockRes();
      await getHandler('post', '/')(mockReq({ body: { query: 'best keyboard' }, validated: { query: 'best keyboard' } }), res);
      expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('sp.deal_score DESC'));
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ interpreted: true }));
    });

    it('defaults to newest sort (sp.scanned_at DESC)', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: '{"keywords":"keyboard"}' } }],
        }),
      });
      const db = vi.mocked(await import('../db.js')).default;
      const res = mockRes();
      await getHandler('post', '/')(mockReq({ body: { query: 'keyboard' }, validated: { query: 'keyboard' } }), res);
      expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('sp.scanned_at DESC'));
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ interpreted: true }));
    });

    it('caps limit at 50', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: '{"keywords":"keyboard","limit":100}' } }],
        }),
      });
      const res = mockRes();
      await getHandler('post', '/')(mockReq({ body: { query: 'many keyboards' }, validated: { query: 'many keyboards' } }), res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ interpreted: true }));
    });

    it('returns multiple results when interpreted: true', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: '{"keywords":"deals"}' } }],
        }),
      });
      const multiStmt = { run: vi.fn(() => ({ changes: 1, lastInsertRowid: 42 })), get: vi.fn(() => ({ c: 0 })), all: vi.fn(() => [
        { id: 1, title: 'Keyboard', price: 150 },
        { id: 2, title: 'Mouse', price: 50 },
        { id: 3, title: 'Monitor', price: 300 },
      ]) };
      const db = vi.mocked(await import('../db.js')).default;
      const origPrepareImpl = db.prepare.getMockImplementation();
      db.prepare.mockImplementation(() => multiStmt);
      const res = mockRes();
      await getHandler('post', '/')(mockReq({ body: { query: 'deals' }, validated: { query: 'deals' } }), res);
      const call = res.json.mock.calls[0][0];
      expect(call.results.length).toBe(3);
      expect(call.interpreted).toBe(true);
      expect(call.filters).toEqual({ keywords: 'deals' });
      db.prepare.mockImplementation(origPrepareImpl);
    });

    it('returns empty results when interpreted: true', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: '{"keywords":"zzz"}' } }],
        }),
      });
      const emptyStmt = { run: vi.fn(() => ({ changes: 1, lastInsertRowid: 42 })), get: vi.fn(() => ({ c: 0 })), all: vi.fn(() => []) };
      const db = vi.mocked(await import('../db.js')).default;
      const origPrepareImpl = db.prepare.getMockImplementation();
      db.prepare.mockImplementation(() => emptyStmt);
      const res = mockRes();
      await getHandler('post', '/')(mockReq({ body: { query: 'zzz' }, validated: { query: 'zzz' } }), res);
      const call = res.json.mock.calls[0][0];
      expect(call.results).toEqual([]);
      expect(call.interpreted).toBe(true);
      db.prepare.mockImplementation(origPrepareImpl);
    });

    it('updates results_count in search history', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: '{"keywords":"keyboard"}' } }],
        }),
      });
      const db = vi.mocked(await import('../db.js')).default;
      const res = mockRes();
      await getHandler('post', '/')(mockReq({ body: { query: 'keyboard' }, validated: { query: 'keyboard' } }), res);
      expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE deal_search_history'));
      expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('results_count'));
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ interpreted: true }));
    });

    it('saves search history when interpreted: true', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: '{"keywords":"test"}' } }],
        }),
      });
      const db = vi.mocked(await import('../db.js')).default;
      const res = mockRes();
      await getHandler('post', '/')(mockReq({ body: { query: 'test' }, validated: { query: 'test' } }), res);
      expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO deal_search_history'));
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ interpreted: true }));
    });

    it('handles all filter types simultaneously', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: JSON.stringify({
            keywords: 'keyboard', min_price: 50, max_price: 200,
            source: 'reddit', category: 'mechmarket', sort: 'cheapest', limit: 10,
          }) } }],
        }),
      });
      const db = vi.mocked(await import('../db.js')).default;
      const res = mockRes();
      await getHandler('post', '/')(mockReq({ body: { query: 'cheap keyboard on reddit' }, validated: { query: 'cheap keyboard on reddit' } }), res);
      expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('sp.category = ?'));
      expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('sp.source = ?'));
      expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('sp.price >= ?'));
      expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('sp.price <= ?'));
      expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('sp.price ASC'));
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        interpreted: true,
        filters: { keywords: 'keyboard', min_price: 50, max_price: 200, source: 'reddit', category: 'mechmarket', sort: 'cheapest', limit: 10 },
      }));
    });

    it('falls back to basicParse when LLM returns empty filters', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: '{}' } }],
        }),
      });
      const res = mockRes();
      await getHandler('post', '/')(mockReq({ body: { query: 'anything' }, validated: { query: 'anything' } }), res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        filters: { keywords: 'anything' },
        interpreted: true,
      }));
    });

    it('sorts by newest when specified explicitly', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: '{"keywords":"keyboard","sort":"newest"}' } }],
        }),
      });
      const db = vi.mocked(await import('../db.js')).default;
      const res = mockRes();
      await getHandler('post', '/')(mockReq({ body: { query: 'newest keyboard' }, validated: { query: 'newest keyboard' } }), res);
      expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('sp.scanned_at DESC'));
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        interpreted: true,
        filters: expect.objectContaining({ sort: 'newest' }),
      }));
    });
  });

  describe('error handling in interpreted: true path', () => {
    afterEach(() => {
      delete process.env.OPENROUTER_API_KEY;
      if (global.fetch !== undefined) {
        global.fetch = undefined;
      }
    });

    it('returns 500 when UPDATE fails in interpreted: true path', async () => {
      process.env.OPENROUTER_API_KEY = 'test-key';
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: '{"keywords":"test"}' } }],
        }),
      });
      const db = vi.mocked(await import('../db.js')).default;
      const origPrepareImpl = db.prepare.getMockImplementation();
      db.prepare.mockImplementation((sql) => {
        const stmt = { run: vi.fn(() => ({ changes: 1, lastInsertRowid: 42 })), get: vi.fn(() => ({ c: 0 })), all: vi.fn(() => [{ id: 1 }]) };
        if (sql.includes('UPDATE')) stmt.run = vi.fn(() => { throw new Error('update err'); });
        return stmt;
      });
      const res = mockRes();
      await getHandler('post', '/')(mockReq({ body: { query: 'test' }, validated: { query: 'test' } }), res);
      expect(res.status).toHaveBeenCalledWith(500);
      db.prepare.mockImplementation(origPrepareImpl);
    });

    it('returns 500 when buildQuery throws in interpreted: true path', async () => {
      process.env.OPENROUTER_API_KEY = 'test-key';
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: '{"keywords":"test"}' } }],
        }),
      });
      const db = vi.mocked(await import('../db.js')).default;
      const origPrepareImpl = db.prepare.getMockImplementation();
      db.prepare.mockImplementation(() => ({
        run: vi.fn(() => ({ changes: 1, lastInsertRowid: 42 })),
        get: vi.fn(() => ({ c: 0 })),
        all: vi.fn(() => { throw new Error('all err'); }),
      }));
      const res = mockRes();
      await getHandler('post', '/')(mockReq({ body: { query: 'test' }, validated: { query: 'test' } }), res);
      expect(res.status).toHaveBeenCalledWith(500);
      db.prepare.mockImplementation(origPrepareImpl);
    });

    it('returns 500 when req.user is missing (simulates auth bypass)', async () => {
      const res = mockRes();
      await getHandler('post', '/')(mockReq({ body: { query: 'test' }, validated: { query: 'test' }, user: undefined }), res);
      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('returns 500 when query is undefined in validated body', async () => {
      const res = mockRes();
      await getHandler('post', '/')(mockReq({ body: {}, validated: {} }), res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});
