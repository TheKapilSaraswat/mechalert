import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockStmt = {
  run: vi.fn(() => ({ changes: 1 })),
  get: vi.fn(() => ({ id: 1 })),
  all: vi.fn(() => []),
};
vi.mock('../db.js', () => ({
  default: { prepare: vi.fn(() => mockStmt) },
}));
vi.mock('jsonwebtoken', () => ({ default: { verify: vi.fn(() => ({ userId: 1, version: 1 })) } }));
vi.mock('../logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));

import feedbackRoutes from './feedback.js';

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
  const route = feedbackRoutes.stack.find(l => l.route?.path === path && l.route.methods[method])?.route;
  if (!route) return null;
  const handlers = route.stack.map(l => l.handle);
  return handlers[handlers.length - 1];
}
function getAuthMiddleware(method, path) {
  const route = feedbackRoutes.stack.find(l => l.route?.path === path && l.route.methods[method])?.route;
  if (!route) return null;
  return route.stack[0].handle;
}

describe('Feedback Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStmt.get.mockReset();
    mockStmt.get.mockImplementation(() => ({ id: 1 }));
    mockStmt.run.mockReset();
    mockStmt.run.mockImplementation(() => ({ changes: 1 }));
  });

  it('POST / submits feedback', () => {
    const res = mockRes();
    getHandler('post', '/')(mockReq({ body: { match_id: 1, relevant: 1 } }), res);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('POST / handles irrelevant feedback', () => {
    const res = mockRes();
    getHandler('post', '/')(mockReq({ body: { match_id: 1, relevant: 0 } }), res);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('POST / returns 404 when match not found', () => {
    mockStmt.get.mockReturnValue(undefined);
    const res = mockRes();
    getHandler('post', '/')(mockReq({ body: { match_id: 999, relevant: 1 } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('POST / returns 500 on db error', () => {
    mockStmt.get.mockImplementation(() => { throw new Error('DB error'); });
    const res = mockRes();
    getHandler('post', '/')(mockReq({ body: { match_id: 1, relevant: 1 } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('POST / returns 401 when no auth token', () => {
    const auth = getAuthMiddleware('post', '/');
    const res = mockRes();
    const req = mockReq({ headers: {} });
    auth(req, res, () => {});
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'No token' });
  });

  it('POST / returns 401 with invalid token', async () => {
    const jwt = (await import('jsonwebtoken')).default;
    jwt.verify.mockImplementation(() => { throw new Error('jwt malformed'); });
    const auth = getAuthMiddleware('post', '/');
    const res = mockRes();
    auth(mockReq(), res, () => {});
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token' });
  });

  it('POST / returns 400 for empty body', () => {
    const res = mockRes();
    getHandler('post', '/')(mockReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('POST / returns 400 for missing match_id', () => {
    const res = mockRes();
    getHandler('post', '/')(mockReq({ body: { relevant: 1 } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('POST / returns 400 for match_id = 0', () => {
    const res = mockRes();
    getHandler('post', '/')(mockReq({ body: { match_id: 0, relevant: 1 } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('POST / returns 400 for missing relevant', () => {
    const res = mockRes();
    getHandler('post', '/')(mockReq({ body: { match_id: 1 } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('POST / returns 400 for relevant = -1', () => {
    const res = mockRes();
    getHandler('post', '/')(mockReq({ body: { match_id: 1, relevant: -1 } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('POST / returns 400 for relevant = 2', () => {
    const res = mockRes();
    getHandler('post', '/')(mockReq({ body: { match_id: 1, relevant: 2 } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('POST / returns 400 for relevant as string', () => {
    const res = mockRes();
    getHandler('post', '/')(mockReq({ body: { match_id: 1, relevant: 'bad' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('POST / returns 500 on db error during insert', () => {
    mockStmt.get.mockReturnValue({ id: 1 });
    mockStmt.run.mockImplementation(() => { throw new Error('Insert error'); });
    const res = mockRes();
    getHandler('post', '/')(mockReq({ body: { match_id: 1, relevant: 1 } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('POST / logs feedback on success', async () => {
    const logger = (await import('../logger.js')).default;
    const res = mockRes();
    getHandler('post', '/')(mockReq({ body: { match_id: 1, relevant: 1 } }), res);
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Feedback: user 1 marked match 1 as relevant')
    );
  });

  it('POST / logs irrelevant feedback on success', async () => {
    const logger = (await import('../logger.js')).default;
    const res = mockRes();
    getHandler('post', '/')(mockReq({ body: { match_id: 1, relevant: 0 } }), res);
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('irrelevant')
    );
  });

  it('POST / handles match_id as string number', () => {
    const res = mockRes();
    getHandler('post', '/')(mockReq({ body: { match_id: '42', relevant: 1 } }), res);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('POST / returns correct response shape on success', () => {
    const res = mockRes();
    getHandler('post', '/')(mockReq({ body: { match_id: 1, relevant: 1 } }), res);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('POST / calls db.prepare with insert SQL', async () => {
    const db = (await import('../db.js')).default;
    const res = mockRes();
    getHandler('post', '/')(mockReq({ body: { match_id: 1, relevant: 1 } }), res);
    expect(db.prepare).toHaveBeenCalledWith(
      expect.stringContaining('INSERT OR REPLACE INTO feedback')
    );
  });
});
