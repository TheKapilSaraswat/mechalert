import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockStmt = {
  run: vi.fn(() => ({ changes: 1 })),
  get: vi.fn(() => ({ referral_code: 'abc123', referrer_id: null })),
  all: vi.fn(() => [{ email: 'ref@example.com', referred_at: '2025-01-01' }]),
};
vi.mock('../db.js', () => ({ default: { prepare: vi.fn(() => mockStmt) } }));

function resetMockStmt() {
  mockStmt.run.mockReset();
  mockStmt.run.mockImplementation(() => ({ changes: 1 }));
  mockStmt.get.mockReset();
  mockStmt.get.mockImplementation(() => ({ referral_code: 'abc123', referrer_id: null }));
  mockStmt.all.mockReset();
  mockStmt.all.mockImplementation(() => [{ email: 'ref@example.com', referred_at: '2025-01-01' }]);
}
vi.mock('jsonwebtoken', () => ({ default: { verify: vi.fn(() => ({ userId: 1, version: 1 })) } }));
vi.mock('../logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));

import referralsRoutes from './referrals.js';

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
  const route = referralsRoutes.stack.find(l => l.route?.path === path && l.route.methods[method])?.route;
  if (!route) return null;
  const handlers = route.stack.map(l => l.handle);
  return handlers[handlers.length - 1];
}
function callRoute(method, path, req, res) {
  const route = referralsRoutes.stack.find(l => l.route?.path === path && l.route.methods[method])?.route;
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

describe('Referrals Routes', () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockStmt(); });

  it('GET /code returns existing code', () => {
    const res = mockRes();
    getHandler('get', '/code')(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'abc123' }));
  });

  it('GET /code creates new code when none exists', async () => {
    mockStmt.get.mockReturnValueOnce({ id: 1, referral_code: null }).mockReturnValueOnce({ id: 1, referral_code: 'def456' });
    const res = mockRes();
    getHandler('get', '/code')(mockReq(), res);
    expect(res.json).toHaveBeenCalled();
  });

  it('GET /code returns 500 on error', async () => {
    mockStmt.get.mockImplementation(() => { throw new Error('DB error'); });
    const res = mockRes();
    getHandler('get', '/code')(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('POST /claim claims a referral', async () => {
    mockStmt.get
      .mockReturnValueOnce({ id: 2, user_id: 2, referral_code: 'xyz789' }) // code lookup
      .mockReturnValueOnce(undefined) // no existing claim
      .mockReturnValueOnce({ c: 1 }); // referral count
    const res = mockRes();
    getHandler('post', '/claim')(mockReq({ body: { code: 'xyz789' } }), res);
  });

  it('POST /claim returns 500 on error', async () => {
    mockStmt.get.mockImplementation(() => { throw new Error('DB error'); });
    const res = mockRes();
    getHandler('post', '/claim')(mockReq({ body: { code: 'test' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('GET /stats returns referral stats', async () => {
    mockStmt.get.mockReturnValueOnce({ c: 5 });
    const res = mockRes();
    getHandler('get', '/stats')(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      invitesSent: expect.any(Number),
      claimedUsers: expect.any(Array),
    }));
  });

  it('GET /stats returns 500 on error', async () => {
    mockStmt.get.mockImplementation(() => { throw new Error('DB error'); });
    const res = mockRes();
    getHandler('get', '/stats')(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('GET /code returns 401 without auth header', async () => {
    const res = mockRes();
    callRoute('get', '/code', mockReq({ headers: {} }), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'No token' });
  });

  it('GET /code returns 401 with invalid token', async () => {
    const jwt = (await import('jsonwebtoken')).default;
    jwt.verify.mockImplementationOnce(() => { throw new Error('jwt malformed'); });
    const res = mockRes();
    callRoute('get', '/code', mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token' });
  });

  it('GET /code response includes url', async () => {
    const res = mockRes();
    getHandler('get', '/code')(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'abc123', url: expect.any(String) }));
  });

  it('GET /code returns proper referral URL format', async () => {
    const res = mockRes();
    getHandler('get', '/code')(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      url: expect.stringContaining('mechalert.app?ref='),
    }));
  });

  it('POST /claim returns 401 without auth header', async () => {
    const res = mockRes();
    callRoute('post', '/claim', mockReq({ headers: {}, body: { code: 'test' } }), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'No token' });
  });

  it('POST /claim returns 401 with invalid token', async () => {
    const jwt = (await import('jsonwebtoken')).default;
    jwt.verify.mockImplementationOnce(() => { throw new Error('jwt malformed'); });
    const res = mockRes();
    callRoute('post', '/claim', mockReq({ body: { code: 'test' } }), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token' });
  });

  it('POST /claim returns 400 when code missing', async () => {
    const res = mockRes();
    getHandler('post', '/claim')(mockReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Referral code required' });
  });

  it('POST /claim returns 404 when code not found', async () => {
    mockStmt.get.mockReturnValueOnce(undefined);
    const res = mockRes();
    getHandler('post', '/claim')(mockReq({ body: { code: 'invalid' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid referral code' });
  });

  it('POST /claim returns 400 when referring yourself', async () => {
    mockStmt.get.mockReturnValueOnce({ id: 1, is_premium: 0 });
    const res = mockRes();
    getHandler('post', '/claim')(mockReq({ body: { code: 'self' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Cannot refer yourself' });
  });

  it('POST /claim returns 409 when already claimed', async () => {
    mockStmt.get
      .mockReturnValueOnce({ id: 2, is_premium: 0 })
      .mockReturnValueOnce({ id: 99 });
    const res = mockRes();
    getHandler('post', '/claim')(mockReq({ body: { code: 'dup' } }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: 'Already claimed a referral' });
  });

  it('POST /claim returns reward for first referral', async () => {
    mockStmt.get
      .mockReturnValueOnce({ id: 2, is_premium: 0 })
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce({ c: 0 });
    const res = mockRes();
    getHandler('post', '/claim')(mockReq({ body: { code: 'first' } }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true, reward: expect.any(String) }));
  });

  it('POST /claim returns null reward for subsequent referral', async () => {
    mockStmt.get
      .mockReturnValueOnce({ id: 2, is_premium: 0 })
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce({ c: 3 });
    const res = mockRes();
    getHandler('post', '/claim')(mockReq({ body: { code: 'subsequent' } }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true, reward: null }));
  });

  it('POST /claim returns 500 on insert error', async () => {
    mockStmt.get
      .mockReturnValueOnce({ id: 2, is_premium: 0 })
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce({ c: 0 });
    mockStmt.run.mockImplementation(() => { throw new Error('Insert failed'); });
    const res = mockRes();
    getHandler('post', '/claim')(mockReq({ body: { code: 'err' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('GET /stats returns 401 without auth header', async () => {
    const res = mockRes();
    callRoute('get', '/stats', mockReq({ headers: {} }), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'No token' });
  });

  it('GET /stats returns 401 with invalid token', async () => {
    const jwt = (await import('jsonwebtoken')).default;
    jwt.verify.mockImplementationOnce(() => { throw new Error('jwt malformed'); });
    const res = mockRes();
    callRoute('get', '/stats', mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token' });
  });

  it('GET /stats returns empty stats', async () => {
    mockStmt.get.mockReturnValueOnce({ c: 0 });
    mockStmt.all.mockReturnValueOnce([]);
    const res = mockRes();
    getHandler('get', '/stats')(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ invitesSent: 0, claimedUsers: [] }));
  });

  it('GET /stats returns multiple claimed users', async () => {
    mockStmt.get.mockReturnValueOnce({ c: 2 });
    mockStmt.all.mockReturnValueOnce([
      { email: 'user1@test.com', created_at: '2025-06-01' },
      { email: 'user2@test.com', created_at: '2025-06-02' },
    ]);
    const res = mockRes();
    getHandler('get', '/stats')(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      invitesSent: 2,
      claimedUsers: expect.arrayContaining([
        expect.objectContaining({ email: 'user1@test.com' }),
        expect.objectContaining({ email: 'user2@test.com' }),
      ]),
    }));
  });

  it('GET /stats returns 500 on all query error', async () => {
    mockStmt.get.mockReturnValueOnce({ c: 0 });
    mockStmt.all.mockImplementation(() => { throw new Error('All error'); });
    const res = mockRes();
    getHandler('get', '/stats')(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
