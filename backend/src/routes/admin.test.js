import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockStmt = {
  run: vi.fn(() => ({ changes: 1 })),
  get: vi.fn(() => ({ c: 0, id: 1, email: 'admin@test.com', is_admin: 1, is_premium: 0, tier: 'free', is_active: 1 })),
  all: vi.fn(() => []),
};
vi.mock('../db.js', () => ({
  default: {
    prepare: vi.fn(() => mockStmt),
  },
}));
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(() => true),
    statSync: vi.fn(() => ({ size: 1024 })),
  },
}));
vi.mock('../logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('../middleware.js', () => ({ adminAuth: (req, res, next) => { req.user = { userId: 1 }; req.adminUser = { id: 1, email: 'admin@test.com', is_admin: 1 }; next(); } }));
vi.mock('../notifier.js', () => ({ sendEmail: vi.fn(() => Promise.resolve()) }));

import adminRoutes from './admin.js';

function mockReq(overrides = {}) {
  return { headers: { authorization: 'Bearer test' }, body: {}, params: {}, user: { userId: 1 }, adminUser: { id: 1, is_admin: 1 }, query: {}, ...overrides };
}
function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}
function getHandler(method, path) {
  const route = adminRoutes.stack.find(l => l.route?.path === path && l.route.methods[method])?.route;
  if (!route) return null;
  const handlers = route.stack.map(l => l.handle);
  return handlers[handlers.length - 1];
}

function resetMockStmt() {
  mockStmt.get.mockReset();
  mockStmt.get.mockImplementation(() => ({ c: 0, id: 1, email: 'admin@test.com', is_admin: 1, is_premium: 0, tier: 'free', is_active: 1 }));
  mockStmt.all.mockReset();
  mockStmt.all.mockImplementation(() => []);
  mockStmt.run.mockReset();
  mockStmt.run.mockImplementation(() => ({ changes: 1 }));
}

describe('Admin Routes', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const db = (await vi.importMock('../db.js')).default;
    db.prepare.mockReset();
    db.prepare.mockImplementation(() => mockStmt);
    resetMockStmt();
  });

  it('GET /stats returns platform stats', async () => {
    const db = (await vi.importMock('../db.js')).default;
    db.prepare().get
      .mockReturnValueOnce({ c: 100 })
      .mockReturnValueOnce({ c: 10 })
      .mockReturnValueOnce({ c: 1000 })
      .mockReturnValueOnce({ c: 500 })
      .mockReturnValueOnce({ c: 200 })
      .mockReturnValueOnce({ c: 150 })
      .mockReturnValueOnce({ c: 10 })
      .mockReturnValueOnce({ c: 5 })
      .mockReturnValueOnce({ c: 50 })
      .mockReturnValueOnce({ c: 20 });
    const res = mockRes();
    getHandler('get', '/stats')(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      users: expect.objectContaining({ total: 100 }),
      content: expect.objectContaining({ posts: 1000 }),
    }));
  });

  it('GET /stats returns 500 on error', async () => {
    const db = (await vi.importMock('../db.js')).default;
    db.prepare.mockImplementationOnce(() => { throw new Error('DB error'); });
    const res = mockRes();
    getHandler('get', '/stats')(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('GET /users returns user list', async () => {
    const db = (await vi.importMock('../db.js')).default;
    db.prepare().all.mockReturnValue([{ id: 1, email: 'user@test.com', rule_count: 2 }]);
    const res = mockRes();
    getHandler('get', '/users')(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith([{ id: 1, email: 'user@test.com', rule_count: 2 }]);
  });

  it('GET /recent-activity returns activity', async () => {
    const db = (await vi.importMock('../db.js')).default;
    db.prepare().all.mockReturnValueOnce([{ id: 1, title: 'Post' }]).mockReturnValueOnce([{ id: 1, title: 'Match' }]);
    const res = mockRes();
    getHandler('get', '/recent-activity')(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ recentPosts: expect.any(Array), recentMatches: expect.any(Array) }));
  });

  it('GET /recent-activity returns 500 on error', async () => {
    const db = (await vi.importMock('../db.js')).default;
    db.prepare.mockImplementationOnce(() => { throw new Error('DB error'); });
    const res = mockRes();
    getHandler('get', '/recent-activity')(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('GET /source-health returns health stats', async () => {
    const db = (await vi.importMock('../db.js')).default;
    db.prepare().all.mockReturnValue([{ source: 'reddit', total: 500, last24h: 10 }]);
    const res = mockRes();
    getHandler('get', '/source-health')(mockReq(), res);
    expect(res.json).toHaveBeenCalled();
  });

  it('GET /source-health returns 500 on error', async () => {
    const db = (await vi.importMock('../db.js')).default;
    db.prepare.mockImplementationOnce(() => { throw new Error('DB error'); });
    const res = mockRes();
    getHandler('get', '/source-health')(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('GET /analytics returns analytics', async () => {
    const res = mockRes();
    getHandler('get', '/analytics')(mockReq(), res);
    expect(res.json).toHaveBeenCalled();
  });

  it('GET /analytics returns 500 on error', async () => {
    const db = (await vi.importMock('../db.js')).default;
    db.prepare.mockImplementationOnce(() => { throw new Error('DB error'); });
    const res = mockRes();
    getHandler('get', '/analytics')(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('PUT /users/:id updates user', async () => {
    const db = (await vi.importMock('../db.js')).default;
    db.prepare().get.mockReturnValue({ id: 1, email: 'test@test.com', is_admin: 0, is_premium: 0, tier: 'free', is_active: 1 });
    const res = mockRes();
    getHandler('put', '/users/:id')(mockReq({ params: { id: '1' }, body: { is_admin: true } }), res);
    expect(res.json).toHaveBeenCalled();
  });

  it('PUT /users/:id returns 404 when not found', async () => {
    const db = (await vi.importMock('../db.js')).default;
    db.prepare().get.mockReturnValue(undefined);
    const res = mockRes();
    getHandler('put', '/users/:id')(mockReq({ params: { id: '999' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('PUT /users/:id returns 500 on error', async () => {
    const db = (await vi.importMock('../db.js')).default;
    db.prepare.mockImplementationOnce(() => { throw new Error('DB error'); });
    const res = mockRes();
    getHandler('put', '/users/:id')(mockReq({ params: { id: '1' }, body: { is_admin: true } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('DELETE /users/:id deletes user', () => {
    const res = mockRes();
    getHandler('delete', '/users/:id')(mockReq({ params: { id: '1' } }), res);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('POST /cleanup cleans stale data', async () => {
    const db = (await vi.importMock('../db.js')).default;
    db.prepare().run.mockReturnValue({ changes: 5 });
    const res = mockRes();
    getHandler('post', '/cleanup')(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ removedMatches: expect.any(Number), removedPosts: expect.any(Number) }));
  });

  it('POST /cleanup returns 500 on error', async () => {
    const db = (await vi.importMock('../db.js')).default;
    db.prepare.mockImplementationOnce(() => { throw new Error('DB error'); });
    const res = mockRes();
    getHandler('post', '/cleanup')(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('GET /users returns 500 on error', async () => {
    const db = (await vi.importMock('../db.js')).default;
    db.prepare.mockImplementationOnce(() => { throw new Error('DB error'); });
    const res = mockRes();
    getHandler('get', '/users')(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('DELETE /users/:id returns 400 for invalid ID', () => {
    const res = mockRes();
    getHandler('delete', '/users/:id')(mockReq({ params: { id: 'abc' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('DELETE /users/:id returns 404 when not found', () => {
    mockStmt.get.mockReturnValueOnce(undefined);
    const res = mockRes();
    getHandler('delete', '/users/:id')(mockReq({ params: { id: '999' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('DELETE /users/:id returns 500 on error', async () => {
    const db = (await vi.importMock('../db.js')).default;
    db.prepare.mockImplementationOnce(() => { throw new Error('DB error'); });
    const res = mockRes();
    getHandler('delete', '/users/:id')(mockReq({ params: { id: '1' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('GET /tracking-stats returns tracking stats', async () => {
    const db = (await vi.importMock('../db.js')).default;
    db.prepare().get
      .mockReturnValueOnce({ c: 100 })
      .mockReturnValueOnce({ c: 10 })
      .mockReturnValueOnce({ c: 5 })
      .mockReturnValueOnce({ c: 3 })
      .mockReturnValueOnce({ c: 1 })
      .mockReturnValueOnce({ c: 0 });
    db.prepare().all
      .mockReturnValueOnce([{ source: 'reddit', c: 80 }])
      .mockReturnValueOnce([{ user_id: 1, email: 'u@t.com', clicks: 20 }]);
    const res = mockRes();
    getHandler('get', '/tracking-stats')(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      clicks: expect.objectContaining({ total: 100, today: 10 }),
      checkout: expect.objectContaining({ started: 5, completed: 3, cancelled: 1, failed: 0 }),
    }));
  });

  it('GET /tracking-stats returns 500 on error', async () => {
    const db = (await vi.importMock('../db.js')).default;
    db.prepare.mockImplementationOnce(() => { throw new Error('DB error'); });
    const res = mockRes();
    getHandler('get', '/tracking-stats')(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('GET /user-activity returns activity', async () => {
    const db = (await vi.importMock('../db.js')).default;
    db.prepare().all.mockReturnValue([{ id: 1, email: 'u@t.com', search_count: 5 }]);
    const res = mockRes();
    getHandler('get', '/user-activity')(mockReq(), res);
    expect(res.json).toHaveBeenCalled();
  });

  it('GET /user-searches/:userId returns searches', () => {
    const res = mockRes();
    getHandler('get', '/user-searches/:userId')(mockReq({ params: { userId: '1' } }), res);
    expect(res.json).toHaveBeenCalled();
  });

  it('GET /user-clicks/:userId returns clicks', () => {
    const res = mockRes();
    getHandler('get', '/user-clicks/:userId')(mockReq({ params: { userId: '1' } }), res);
    expect(res.json).toHaveBeenCalled();
  });

  it('GET /user-checkout-events/:userId returns events', () => {
    const res = mockRes();
    getHandler('get', '/user-checkout-events/:userId')(mockReq({ params: { userId: '1' } }), res);
    expect(res.json).toHaveBeenCalled();
  });

  it('GET /user-notifications/:userId returns notifications', () => {
    const res = mockRes();
    getHandler('get', '/user-notifications/:userId')(mockReq({ params: { userId: '1' } }), res);
    expect(res.json).toHaveBeenCalled();
  });

  it('POST /marketing-email returns 400 when subject or body missing', async () => {
    const res = mockRes();
    await getHandler('post', '/marketing-email')(mockReq({ body: { body: 'Hello' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('POST /marketing-email returns message when no free users', async () => {
    const db = (await vi.importMock('../db.js')).default;
    db.prepare().all.mockReturnValue([]);
    const res = mockRes();
    await getHandler('post', '/marketing-email')(mockReq({ body: { subject: 'Hi', body: 'Hello' } }), res);
    expect(res.json).toHaveBeenCalledWith({ sent: 0, message: 'No free users to email' });
  });

  it('POST /marketing-email sends to free users', async () => {
    const db = (await vi.importMock('../db.js')).default;
    db.prepare().all.mockReturnValue([{ id: 2, email: 'free@test.com' }]);
    const res = mockRes();
    await getHandler('post', '/marketing-email')(mockReq({ body: { subject: 'Sale', body: 'Check this out' } }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ sent: 0, total: 1 }));
  });

  it('POST /marketing-email logs error on db failure', async () => {
    const db = (await vi.importMock('../db.js')).default;
    const logger = (await vi.importMock('../logger.js')).default;
    db.prepare.mockImplementationOnce(() => { throw new Error('DB error'); });
    const res = mockRes();
    await getHandler('post', '/marketing-email')(mockReq({ body: { subject: 'Hi', body: 'Hello' } }), res);
    expect(logger.error).toHaveBeenCalledWith('Admin marketing-email error', expect.objectContaining({ error: 'DB error' }));
  });

  it('POST /user-email/:id returns 400 for invalid ID', async () => {
    const res = mockRes();
    await getHandler('post', '/user-email/:id')(mockReq({ params: { id: 'abc' }, body: { subject: 'Hi', body: 'Hello' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('POST /user-email/:id returns 400 when body missing', async () => {
    const res = mockRes();
    await getHandler('post', '/user-email/:id')(mockReq({ params: { id: '1' }, body: { subject: 'Hi' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('POST /user-email/:id returns 404 when user not found', async () => {
    const db = (await vi.importMock('../db.js')).default;
    db.prepare().get.mockReturnValue(undefined);
    const res = mockRes();
    await getHandler('post', '/user-email/:id')(mockReq({ params: { id: '999' }, body: { subject: 'Hi', body: 'Hello' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('POST /user-email/:id queues email successfully', async () => {
    const res = mockRes();
    await getHandler('post', '/user-email/:id')(mockReq({ params: { id: '1' }, body: { subject: 'Hi', body: 'Hello' } }), res);
    expect(res.json).toHaveBeenCalledWith({ ok: true, message: 'Email queued' });
  });

  it('POST /user-email/:id returns 500 on error', async () => {
    const db = (await vi.importMock('../db.js')).default;
    db.prepare.mockImplementationOnce(() => { throw new Error('DB error'); });
    const res = mockRes();
    await getHandler('post', '/user-email/:id')(mockReq({ params: { id: '1' }, body: { subject: 'Hi', body: 'Hello' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('GET /user-activity returns 500 on error', async () => {
    const db = (await vi.importMock('../db.js')).default;
    db.prepare.mockImplementationOnce(() => { throw new Error('DB error'); });
    const res = mockRes();
    getHandler('get', '/user-activity')(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('GET /user-searches/:userId returns 500 on error', async () => {
    const db = (await vi.importMock('../db.js')).default;
    db.prepare.mockImplementationOnce(() => { throw new Error('DB error'); });
    const res = mockRes();
    getHandler('get', '/user-searches/:userId')(mockReq({ params: { userId: '1' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('GET /user-notifications/:userId returns 500 on error', async () => {
    const db = (await vi.importMock('../db.js')).default;
    db.prepare.mockImplementationOnce(() => { throw new Error('DB error'); });
    const res = mockRes();
    getHandler('get', '/user-notifications/:userId')(mockReq({ params: { userId: '1' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('GET /user-clicks/:userId returns 500 on error', async () => {
    const db = (await vi.importMock('../db.js')).default;
    db.prepare.mockImplementationOnce(() => { throw new Error('DB error'); });
    const res = mockRes();
    getHandler('get', '/user-clicks/:userId')(mockReq({ params: { userId: '1' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('GET /user-checkout-events/:userId returns 500 on error', async () => {
    const db = (await vi.importMock('../db.js')).default;
    db.prepare.mockImplementationOnce(() => { throw new Error('DB error'); });
    const res = mockRes();
    getHandler('get', '/user-checkout-events/:userId')(mockReq({ params: { userId: '1' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('POST /marketing-email handles sendEmail rejection', async () => {
    const db = (await vi.importMock('../db.js')).default;
    const notifier = (await vi.importMock('../notifier.js'));
    notifier.sendEmail.mockRejectedValueOnce(new Error('SMTP error'));
    db.prepare().all.mockReturnValue([{ id: 2, email: 'free@test.com' }]);
    const logger = (await vi.importMock('../logger.js')).default;
    const res = mockRes();
    await getHandler('post', '/marketing-email')(mockReq({ body: { subject: 'Sale', body: 'Check this out' } }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ sent: 0, total: 1 }));
    expect(logger.error).toHaveBeenCalledWith('Marketing email failed for', expect.objectContaining({ email: 'free@test.com' }));
  });

  it('GET /stats calculates dbSize when DATABASE_PATH is set (lines 31-32)', async () => {
    const orig = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = 'test.db';
    const res = mockRes();
    getHandler('get', '/stats')(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      dbSize: expect.stringMatching(/^\d+\.\d{2} MB$/),
    }));
    process.env.DATABASE_PATH = orig;
  });
});
