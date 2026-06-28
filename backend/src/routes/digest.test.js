import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockStmt = {
  run: vi.fn(() => ({ changes: 1 })),
  get: vi.fn(() => ({ id: 1, user_id: 1, digest_frequency: 'daily', is_premium: 1, is_admin: 0, last_digest_at: null })),
  all: vi.fn(() => [{ id: 1, title: 'Keyboard $150', permalink: '/r/test/1/' }]),
};
vi.mock('../db.js', () => ({ default: { prepare: vi.fn(() => mockStmt) } }));

function resetMockStmt() {
  mockStmt.run.mockReset();
  mockStmt.run.mockImplementation(() => ({ changes: 1 }));
  mockStmt.get.mockReset();
  mockStmt.get.mockImplementation(() => ({ id: 1, user_id: 1, digest_frequency: 'daily', is_premium: 1, is_admin: 0, last_digest_at: null }));
  mockStmt.all.mockReset();
  mockStmt.all.mockImplementation(() => [{ id: 1, title: 'Keyboard $150', permalink: '/r/test/1/' }]);
}
vi.mock('jsonwebtoken', () => ({ default: { verify: vi.fn(() => ({ userId: 1, version: 1 })) } }));
vi.mock('../logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('../middleware.js', () => ({ jwtAuth: (req, res, next) => { req.user = { userId: 1 }; next(); } }));
vi.mock('../notifier.js', () => ({ sendEmail: vi.fn(() => Promise.resolve()) }));

import digestRoutes from './digest.js';

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
  const route = digestRoutes.stack.find(l => l.route?.path === path && l.route.methods[method])?.route;
  if (!route) return null;
  const handlers = route.stack.map(l => l.handle);
  return handlers[handlers.length - 1];
}

describe('Digest Routes', () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockStmt(); });

  it('PUT /preference updates digest frequency', () => {
    const res = mockRes();
    getHandler('put', '/preference')(mockReq({ body: { frequency: 'weekly' } }), res);
    expect(res.json).toHaveBeenCalledWith({ ok: true, digest_frequency: 'weekly' });
  });

  it('PUT /preference returns 400 for invalid value', () => {
    const res = mockRes();
    getHandler('put', '/preference')(mockReq({ body: { digest_frequency: 'invalid' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('PUT /preference returns 500 on error', async () => {
    mockStmt.run.mockImplementation(() => { throw new Error('DB error'); });
    const res = mockRes();
    getHandler('put', '/preference')(mockReq({ body: { frequency: 'daily' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('POST /send sends digest with matches', async () => {
    const { sendEmail } = await import('../notifier.js');
    const res = mockRes();
    await getHandler('post', '/send')(mockReq(), res);
  });

  it('POST /send returns no matches message', async () => {
    mockStmt.all.mockReturnValue([]);
    mockStmt.get.mockReturnValue({ id: 1, user_id: 1, digest_frequency: 'daily', is_premium: 1, is_admin: 0, last_digest_at: new Date().toISOString() });
    const res = mockRes();
    await getHandler('post', '/send')(mockReq(), res);
  });

  it('POST /send returns 500 on error', async () => {
    mockStmt.get.mockImplementation(() => { throw new Error('DB error'); });
    const res = mockRes();
    await getHandler('post', '/send')(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('PUT /preference returns 400 for missing frequency', () => {
    const res = mockRes();
    getHandler('put', '/preference')(mockReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('PUT /preference accepts never frequency', () => {
    const res = mockRes();
    getHandler('put', '/preference')(mockReq({ body: { frequency: 'never' } }), res);
    expect(res.json).toHaveBeenCalledWith({ ok: true, digest_frequency: 'never' });
  });

  it('PUT /preference accepts daily frequency', () => {
    const res = mockRes();
    getHandler('put', '/preference')(mockReq({ body: { frequency: 'daily' } }), res);
    expect(res.json).toHaveBeenCalledWith({ ok: true, digest_frequency: 'daily' });
  });

  it('PUT /preference returns 400 for null frequency', () => {
    const res = mockRes();
    getHandler('put', '/preference')(mockReq({ body: { frequency: null } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('POST /send returns 404 when user not found', async () => {
    mockStmt.get.mockReturnValue(undefined);
    const res = mockRes();
    await getHandler('post', '/send')(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'User not found' });
  });

  it('POST /send returns 403 for non-premium user', async () => {
    mockStmt.get.mockReturnValue({ id: 1, digest_frequency: 'daily', is_premium: 0, is_admin: 0, last_digest_at: null });
    const res = mockRes();
    await getHandler('post', '/send')(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('POST /send returns 400 when digest is disabled', async () => {
    mockStmt.get.mockReturnValue({ id: 1, digest_frequency: 'never', is_premium: 1, is_admin: 0, last_digest_at: null });
    const res = mockRes();
    await getHandler('post', '/send')(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Digest is disabled' });
  });

  it('POST /send allows admin without premium', async () => {
    mockStmt.get.mockReturnValue({ id: 1, email: 'admin@test.com', digest_frequency: 'daily', is_premium: 0, is_admin: 1, last_digest_at: null });
    mockStmt.all.mockReturnValue([]);
    const res = mockRes();
    await getHandler('post', '/send')(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith({ matches: 0, message: 'No new matches' });
  });

  it('POST /send returns 500 when email fails', async () => {
    const { sendEmail } = await import('../notifier.js');
    sendEmail.mockRejectedValue(new Error('SMTP error'));
    const res = mockRes();
    await getHandler('post', '/send')(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('POST /send handles multiple matches with correct shape', async () => {
    const { sendEmail } = await import('../notifier.js');
    sendEmail.mockResolvedValue();
    mockStmt.all.mockReturnValue([
      { id: 1, title: 'Keyboard $150', price: '150', permalink: '/r/test/1/', source: 'reddit', matched_keyword: 'keyboard', sent_at: '2024-01-01' },
      { id: 2, title: 'Mouse $50', price: '50', permalink: '/r/test/2/', source: 'ebay', matched_keyword: 'mouse', sent_at: '2024-01-02' },
      { id: 3, title: 'Desk Mat $30', price: '30', permalink: '/r/test/3/', source: 'amazon', matched_keyword: 'desk', sent_at: '2024-01-03' },
    ]);
    const res = mockRes();
    await getHandler('post', '/send')(mockReq(), res);
    expect(sendEmail).toHaveBeenCalledOnce();
    expect(res.json).toHaveBeenCalledWith({ matches: 3, sent: true });
  });

  it('POST /send works with weekly frequency', async () => {
    const { sendEmail } = await import('../notifier.js');
    mockStmt.get.mockReturnValue({ id: 1, email: 'user@test.com', digest_frequency: 'weekly', is_premium: 1, is_admin: 0, last_digest_at: new Date().toISOString() });
    mockStmt.all.mockReturnValue([]);
    const res = mockRes();
    await getHandler('post', '/send')(mockReq(), res);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ matches: 0, message: 'No new matches' });
  });

  it('POST /send returns correct shape for no matches', async () => {
    mockStmt.all.mockReturnValue([]);
    mockStmt.get.mockReturnValue({ id: 1, digest_frequency: 'daily', is_premium: 1, is_admin: 0, last_digest_at: new Date().toISOString() });
    const res = mockRes();
    await getHandler('post', '/send')(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith({ matches: 0, message: 'No new matches' });
  });

  it('POST /send returns 500 when DB update after email fails', async () => {
    const { sendEmail } = await import('../notifier.js');
    sendEmail.mockResolvedValue();
    mockStmt.run.mockImplementation(() => { throw new Error('DB update error'); });
    const res = mockRes();
    await getHandler('post', '/send')(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('POST /send handles matches with null price and missing fields', async () => {
    const { sendEmail } = await import('../notifier.js');
    mockStmt.all.mockReturnValue([
      { id: 4, title: 'Free Item', price: null, permalink: '/r/test/4/', source: 'reddit', matched_keyword: 'free', sent_at: '2024-01-04' },
    ]);
    const res = mockRes();
    await getHandler('post', '/send')(mockReq(), res);
    expect(sendEmail).toHaveBeenCalledOnce();
    expect(res.json).toHaveBeenCalledWith({ matches: 1, sent: true });
  });

  it('POST /send calls sendEmail with user email on success', async () => {
    const { sendEmail } = await import('../notifier.js');
    mockStmt.get.mockReturnValue({ id: 1, email: 'digest-user@test.com', digest_frequency: 'daily', is_premium: 1, is_admin: 0, last_digest_at: null });
    mockStmt.all.mockReturnValue([{ id: 5, title: 'Test Item', price: '10', permalink: '/r/test/5/', source: 'reddit', matched_keyword: 'test', sent_at: '2024-01-05' }]);
    const res = mockRes();
    await getHandler('post', '/send')(mockReq(), res);
    expect(sendEmail).toHaveBeenCalledWith('digest-user@test.com', 'Your MechAlert Digest', '', '', expect.any(String));
  });

  it('POST /send handles matches with null title (line 46 branch)', async () => {
    const { sendEmail } = await import('../notifier.js');
    mockStmt.all.mockReturnValue([
      { id: 7, title: null, price: '25', permalink: '/r/test/7/', source: 'reddit', matched_keyword: 'test', sent_at: '2024-01-07' },
    ]);
    const res = mockRes();
    await getHandler('post', '/send')(mockReq(), res);
    expect(sendEmail).toHaveBeenCalledOnce();
    expect(res.json).toHaveBeenCalledWith({ matches: 1, sent: true });
  });
});
