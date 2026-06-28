import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockStmt = {
  run: vi.fn(() => ({ changes: 1, lastInsertRowid: 42 })),
  get: vi.fn(() => ({ id: 1, post_id: 'abc123', user_id: 1 })),
  all: vi.fn(() => []),
};
vi.mock('../db.js', () => ({ default: { prepare: vi.fn(() => mockStmt) } }));

function resetMockStmt() {
  mockStmt.get.mockReset();
  mockStmt.get.mockImplementation(() => ({ id: 1, post_id: 'abc123', user_id: 1 }));
  mockStmt.all.mockReset();
  mockStmt.all.mockImplementation(() => []);
  mockStmt.run.mockReset();
  mockStmt.run.mockImplementation(() => ({ changes: 1, lastInsertRowid: 42 }));
}
vi.mock('jsonwebtoken', () => ({ default: { verify: vi.fn(() => ({ userId: 1, version: 1 })) } }));
vi.mock('../logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('../middleware.js', () => ({ jwtAuth: (req, res, next) => { req.user = { userId: 1 }; next(); } }));
vi.mock('../validation.js', () => ({
  validate: () => (req, res, next) => { req.validated = req.body; next(); },
  createSavedDealSchema: {},
  updateSavedDealSchema: {},
}));

import savedDealsRoutes from './savedDeals.js';

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
  const route = savedDealsRoutes.stack.find(l => l.route?.path === path && l.route.methods[method])?.route;
  if (!route) return null;
  const handlers = route.stack.map(l => l.handle);
  return handlers[handlers.length - 1];
}

describe('Saved Deals Routes', () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockStmt(); });

  it('GET / returns saved deals', async () => {
    mockStmt.all.mockReturnValue([{ id: 1, title: 'Keyboard', price: 150 }]);
    const res = mockRes();
    getHandler('get', '/')(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith([{ id: 1, title: 'Keyboard', price: 150 }]);
  });

  it('GET / returns empty array', () => {
    const res = mockRes();
    getHandler('get', '/')(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith([]);
  });

  it('POST / saves a new deal', async () => {
    mockStmt.get.mockReturnValue({ id: 1, post_id: 'abc123' });
    const res = mockRes();
    getHandler('post', '/')(mockReq({ validated: { post_id: 'abc123' } }), res);
    expect(res.json).toHaveBeenCalled();
  });

  it('POST / returns 409 for duplicate', async () => {
    mockStmt.get
      .mockReturnValueOnce({ id: 1 }) // post exists
      .mockReturnValueOnce({ id: 5 }); // already saved
    const res = mockRes();
    getHandler('post', '/')(mockReq({ validated: { post_id: 'abc123' } }), res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('POST / returns 500 on error', async () => {
    mockStmt.get.mockImplementation(() => { throw new Error('DB error'); });
    const res = mockRes();
    getHandler('post', '/')(mockReq({ validated: { post_id: 'abc' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('PUT /:id updates deal notes', async () => {
    mockStmt.get.mockReturnValue({ id: 1, user_id: 1 });
    const res = mockRes();
    getHandler('put', '/:id')(mockReq({ params: { id: '1' }, validated: { notes: 'Great deal!' } }), res);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('PUT /:id returns 404 when not found', async () => {
    mockStmt.get.mockReturnValue(undefined);
    const res = mockRes();
    getHandler('put', '/:id')(mockReq({ params: { id: '999' }, validated: { notes: 'test' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('DELETE /:id deletes saved deal', async () => {
    mockStmt.get.mockReturnValue({ id: 1, user_id: 1 });
    const res = mockRes();
    getHandler('delete', '/:id')(mockReq({ params: { id: '1' } }), res);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('DELETE /:id returns 404 when not found', async () => {
    mockStmt.run.mockReturnValue({ changes: 0 });
    const res = mockRes();
    getHandler('delete', '/:id')(mockReq({ params: { id: '999' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns 500 on unexpected error', async () => {
    mockStmt.run.mockImplementation(() => { throw new Error('DB error'); });
    const res = mockRes();
    getHandler('delete', '/:id')(mockReq({ params: { id: '1' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('GET / returns 500 on DB error', async () => {
    mockStmt.all.mockImplementation(() => { throw new Error('DB error'); });
    const res = mockRes();
    getHandler('get', '/')(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Server error' });
  });

  it('GET / returns multiple deals with expected fields', async () => {
    const deals = [
      { id: 1, post_id: 'abc', title: 'Keyboard', price: 150, source: 'reddit', deal_score: 85, permalink: '/r/abc', image_url: 'img.jpg', scanned_at: '2024-01-01', notes: 'nice' },
      { id: 2, post_id: 'def', title: 'Mouse', price: 50, source: 'ebay', deal_score: 70, permalink: '/r/def', image_url: null, scanned_at: '2024-01-02', notes: null },
    ];
    mockStmt.all.mockReturnValue(deals);
    const res = mockRes();
    getHandler('get', '/')(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith(deals);
    expect(deals).toHaveLength(2);
  });

  it('GET / returns deals with all expected properties', async () => {
    const deal = { id: 1, post_id: 'abc123', title: 'Test', price: 100, permalink: '/r/test', deal_score: 80, source: 'reddit', image_url: 'img.jpg', scanned_at: '2024-01-01', notes: 'test', created_at: '2024-01-01' };
    mockStmt.all.mockReturnValue([deal]);
    const res = mockRes();
    getHandler('get', '/')(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith([expect.objectContaining({
      id: 1, post_id: 'abc123', title: 'Test', price: 100,
    })]);
  });

  it('POST / returns 404 when post not found', async () => {
    mockStmt.get.mockReturnValue(undefined);
    const res = mockRes();
    getHandler('post', '/')(mockReq({ validated: { post_id: 'nonexistent' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Post not found' });
  });

  it('POST / returns 201 status on creation', async () => {
    mockStmt.get
      .mockReturnValueOnce({ id: 1, post_id: 'abc123' })
      .mockReturnValueOnce(undefined);
    const res = mockRes();
    getHandler('post', '/')(mockReq({ validated: { post_id: 'abc123' } }), res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('POST / saves with notes', async () => {
    mockStmt.get
      .mockReturnValueOnce({ id: 1, post_id: 'abc123' })
      .mockReturnValueOnce(undefined);
    mockStmt.run.mockReturnValue({ changes: 1, lastInsertRowid: 42 });
    const res = mockRes();
    getHandler('post', '/')(mockReq({ validated: { post_id: 'abc123', notes: 'Great keyboard!' } }), res);
    expect(mockStmt.run).toHaveBeenCalledWith(1, 'abc123', 'Great keyboard!');
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('POST / returns 500 on insert DB error', async () => {
    mockStmt.get
      .mockReturnValueOnce({ id: 1, post_id: 'abc123' })
      .mockReturnValueOnce(undefined);
    mockStmt.run.mockImplementation(() => { throw new Error('Insert failed'); });
    const res = mockRes();
    getHandler('post', '/')(mockReq({ validated: { post_id: 'abc123' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Server error' });
  });

  it('POST / returns 404 for empty post_id', async () => {
    mockStmt.get.mockReturnValue(undefined);
    const res = mockRes();
    getHandler('post', '/')(mockReq({ validated: { post_id: '' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('POST / verifies db call order', async () => {
    mockStmt.get
      .mockReturnValueOnce({ id: 1, post_id: 'abc123' })
      .mockReturnValueOnce(undefined);
    const res = mockRes();
    getHandler('post', '/')(mockReq({ validated: { post_id: 'abc123' } }), res);
    expect(mockStmt.get).toHaveBeenNthCalledWith(1, 'abc123');
    expect(mockStmt.get).toHaveBeenNthCalledWith(2, 1, 'abc123');
    expect(mockStmt.run).toHaveBeenCalledWith(1, 'abc123', null);
  });

  it('POST / response body is { ok: true }', async () => {
    mockStmt.get
      .mockReturnValueOnce({ id: 1, post_id: 'abc123' })
      .mockReturnValueOnce(undefined);
    const res = mockRes();
    getHandler('post', '/')(mockReq({ validated: { post_id: 'abc123' } }), res);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('PUT /:id returns 500 on DB error', async () => {
    mockStmt.get.mockReturnValue({ id: 1, user_id: 1 });
    mockStmt.run.mockImplementation(() => { throw new Error('Update failed'); });
    const res = mockRes();
    getHandler('put', '/:id')(mockReq({ params: { id: '1' }, validated: { notes: 'test' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Server error' });
  });

  it('PUT /:id updates notes to null', async () => {
    mockStmt.get.mockReturnValue({ id: 1, user_id: 1 });
    const res = mockRes();
    getHandler('put', '/:id')(mockReq({ params: { id: '1' }, validated: { notes: null } }), res);
    expect(mockStmt.run).toHaveBeenCalledWith(null, '1');
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('PUT /:id handles empty string notes', async () => {
    mockStmt.get.mockReturnValue({ id: 1, user_id: 1 });
    const res = mockRes();
    getHandler('put', '/:id')(mockReq({ params: { id: '1' }, validated: { notes: '' } }), res);
    expect(mockStmt.run).toHaveBeenCalledWith(null, '1');
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('PUT /:id verifies response body', async () => {
    mockStmt.get.mockReturnValue({ id: 1, user_id: 1 });
    const res = mockRes();
    getHandler('put', '/:id')(mockReq({ params: { id: '1' }, validated: { notes: 'updated' } }), res);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('DELETE /:id returns 500 on DB error', async () => {
    mockStmt.run.mockImplementation(() => { throw new Error('Delete failed'); });
    const res = mockRes();
    getHandler('delete', '/:id')(mockReq({ params: { id: '1' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Server error' });
  });

  it('DELETE /:id verifies response body', async () => {
    mockStmt.run.mockReturnValue({ changes: 1 });
    const res = mockRes();
    getHandler('delete', '/:id')(mockReq({ params: { id: '1' } }), res);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('DELETE /:id verifies db params', async () => {
    mockStmt.run.mockReturnValue({ changes: 1 });
    const res = mockRes();
    getHandler('delete', '/:id')(mockReq({ params: { id: '42' } }), res);
    expect(mockStmt.run).toHaveBeenCalledWith('42', 1);
  });

  it('POST / with notes as undefined passes null to db', async () => {
    mockStmt.get
      .mockReturnValueOnce({ id: 1, post_id: 'abc123' })
      .mockReturnValueOnce(undefined);
    const res = mockRes();
    getHandler('post', '/')(mockReq({ validated: { post_id: 'abc123' } }), res);
    expect(mockStmt.run).toHaveBeenCalledWith(1, 'abc123', null);
  });
});
