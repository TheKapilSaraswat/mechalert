import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockStmt = {
  run: vi.fn(() => ({ changes: 1, lastInsertRowid: 42 })),
  get: vi.fn(() => ({ id: 1, name: 'Test Collection', user_id: 1 })),
  all: vi.fn(() => []),
};
vi.mock('../db.js', () => ({
  default: {
    prepare: vi.fn(() => mockStmt),
  },
}));
vi.mock('jsonwebtoken', () => ({ default: { verify: vi.fn(() => ({ userId: 1, version: 1 })) } }));
vi.mock('../logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('../middleware.js', () => ({ jwtAuth: (req, res, next) => { req.user = { userId: 1 }; next(); }, requirePremium: (req, res, next) => next() }));

import collectionsRoutes from './collections.js';

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
  const route = collectionsRoutes.stack.find(l => l.route?.path === path && l.route.methods[method])?.route;
  if (!route) return null;
  const handlers = route.stack.map(l => l.handle);
  return handlers[handlers.length - 1];
}
function getHandlers(method, path) {
  const route = collectionsRoutes.stack.find(l => l.route?.path === path && l.route.methods[method])?.route;
  if (!route) return [];
  return route.stack.map(l => l.handle);
}

function resetMockStmt() {
  mockStmt.get.mockReset();
  mockStmt.get.mockImplementation(() => ({ id: 1, name: 'Test Collection', user_id: 1 }));
  mockStmt.all.mockReset();
  mockStmt.all.mockImplementation(() => []);
  mockStmt.run.mockReset();
  mockStmt.run.mockImplementation(() => ({ changes: 1, lastInsertRowid: 42 }));
}

describe('Collections Routes', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const db = (await vi.importMock('../db.js')).default;
    db.prepare.mockReset();
    db.prepare.mockImplementation(() => mockStmt);
    resetMockStmt();
  });

  it('GET / returns all collections', () => {
    mockStmt.all.mockReturnValue([{ id: 1, name: 'Collection 1' }, { id: 2, name: 'Collection 2' }]);
    const res = mockRes();
    getHandler('get', '/')(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith([{ id: 1, name: 'Collection 1' }, { id: 2, name: 'Collection 2' }]);
  });

  it('GET / returns empty array when no collections', () => {
    const res = mockRes();
    getHandler('get', '/')(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith([]);
  });

  it('POST / creates a new collection', () => {
    mockStmt.run.mockReturnValue({ lastInsertRowid: 42 });
    const res = mockRes();
    getHandler('post', '/')(mockReq({ body: { name: 'My Collection' } }), res);
    expect(res.json).toHaveBeenCalled();
  });

  it('POST / returns 500 on creation error', () => {
    mockStmt.run.mockImplementation(() => { throw new Error('DB error'); });
    const res = mockRes();
    getHandler('post', '/')(mockReq({ body: { name: 'Test' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('PUT /:id updates collection name', () => {
    const res = mockRes();
    getHandler('put', '/:id')(mockReq({ params: { id: '1' }, body: { name: 'Updated Name' } }), res);
    expect(res.json).toHaveBeenCalled();
  });

  it('PUT /:id returns 404 when not found', () => {
    mockStmt.get.mockReturnValueOnce(undefined);
    const res = mockRes();
    getHandler('put', '/:id')(mockReq({ params: { id: '999' }, body: { name: 'Updated' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('PUT /:id returns 500 on error', () => {
    mockStmt.get.mockImplementationOnce(() => { throw new Error('DB error'); });
    const res = mockRes();
    getHandler('put', '/:id')(mockReq({ params: { id: '1' }, body: { name: 'Updated' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('DELETE /:id deletes collection', () => {
    const res = mockRes();
    getHandler('delete', '/:id')(mockReq({ params: { id: '1' } }), res);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('DELETE /:id returns 404 when not found', () => {
    mockStmt.run.mockReturnValueOnce({ changes: 0 });
    const res = mockRes();
    getHandler('delete', '/:id')(mockReq({ params: { id: '999' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('GET /:id/items returns items', () => {
    mockStmt.all.mockReturnValue([{ id: 1, title: 'Item', price: 100 }]);
    const res = mockRes();
    getHandler('get', '/:id/items')(mockReq({ params: { id: '1' } }), res);
    expect(res.json).toHaveBeenCalled();
  });

  it('GET /:id/items returns 404 when collection not found', () => {
    mockStmt.get.mockReturnValueOnce(undefined);
    const res = mockRes();
    getHandler('get', '/:id/items')(mockReq({ params: { id: '999' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('POST /:id/items adds item to collection', () => {
    mockStmt.get
      .mockReturnValueOnce({ id: 1, user_id: 1 })
      .mockReturnValueOnce({ id: 5, user_id: 1 })
      .mockReturnValueOnce(undefined);
    const res = mockRes();
    getHandler('post', '/:id/items')(mockReq({ params: { id: '1' }, body: { saved_deal_id: 5 } }), res);
    expect(res.json).toHaveBeenCalled();
  });

  it('POST /:id/items returns 409 for duplicate', () => {
    mockStmt.get
      .mockReturnValueOnce({ id: 1, user_id: 1 })
      .mockReturnValueOnce({ id: 5, user_id: 1 })
      .mockReturnValueOnce({ id: 99 });
    const res = mockRes();
    getHandler('post', '/:id/items')(mockReq({ params: { id: '1' }, body: { saved_deal_id: 5 } }), res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('DELETE /items/:itemId removes item', () => {
    mockStmt.get.mockReturnValue({ id: 1, collection_id: 1 });
    const res = mockRes();
    getHandler('delete', '/items/:itemId')(mockReq({ params: { itemId: '1' } }), res);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('GET / returns 500 on error', () => {
    mockStmt.all.mockImplementation(() => { throw new Error('DB error'); });
    const res = mockRes();
    getHandler('get', '/')(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('POST / returns 400 when name missing', () => {
    const res = mockRes();
    getHandler('post', '/')(mockReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('POST / returns 400 when name is whitespace', () => {
    const res = mockRes();
    getHandler('post', '/')(mockReq({ body: { name: '  ' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('PUT /:id returns 400 when name missing', () => {
    const res = mockRes();
    getHandler('put', '/:id')(mockReq({ params: { id: '1' }, body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('PUT /:id returns 400 when name is empty string', () => {
    const res = mockRes();
    getHandler('put', '/:id')(mockReq({ params: { id: '1' }, body: { name: '' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('DELETE /:id returns 500 on error', () => {
    mockStmt.run.mockImplementation(() => { throw new Error('DB error'); });
    const res = mockRes();
    getHandler('delete', '/:id')(mockReq({ params: { id: '1' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('GET /:id/items returns 500 on error', () => {
    mockStmt.get.mockImplementation(() => { throw new Error('DB error'); });
    const res = mockRes();
    getHandler('get', '/:id/items')(mockReq({ params: { id: '1' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('POST /:id/items returns 400 when saved_deal_id missing', () => {
    const res = mockRes();
    getHandler('post', '/:id/items')(mockReq({ params: { id: '1' }, body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('POST /:id/items returns 404 when collection not found', () => {
    mockStmt.get.mockReturnValueOnce(undefined);
    const res = mockRes();
    getHandler('post', '/:id/items')(mockReq({ params: { id: '999' }, body: { saved_deal_id: 5 } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('POST /:id/items returns 404 when saved deal not found', () => {
    mockStmt.get
      .mockReturnValueOnce({ id: 1, user_id: 1 })
      .mockReturnValueOnce(undefined);
    const res = mockRes();
    getHandler('post', '/:id/items')(mockReq({ params: { id: '1' }, body: { saved_deal_id: 999 } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('POST /:id/items returns 500 on error', () => {
    mockStmt.get.mockImplementation(() => { throw new Error('DB error'); });
    const res = mockRes();
    getHandler('post', '/:id/items')(mockReq({ params: { id: '1' }, body: { saved_deal_id: 5 } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('DELETE /items/:itemId returns 404 when not found', () => {
    mockStmt.get.mockReturnValue(undefined);
    const res = mockRes();
    getHandler('delete', '/items/:itemId')(mockReq({ params: { itemId: '999' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('DELETE /items/:itemId returns 500 on error', () => {
    mockStmt.get.mockImplementation(() => { throw new Error('DB error'); });
    const res = mockRes();
    getHandler('delete', '/items/:itemId')(mockReq({ params: { itemId: '1' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('POST /:id/items returns 400 when saved_deal_id is null', () => {
    const res = mockRes();
    getHandler('post', '/:id/items')(mockReq({ params: { id: '1' }, body: { saved_deal_id: null } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('DELETE /:id returns 404 when user mismatch (changes=0)', () => {
    mockStmt.run.mockReturnValueOnce({ changes: 0 });
    const res = mockRes();
    getHandler('delete', '/:id')(mockReq({ params: { id: '999' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('POST / handles undefined req.body (line 26)', () => {
    const res = mockRes();
    getHandler('post', '/')(mockReq({ body: undefined }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('PUT /:id handles undefined req.body (line 41)', () => {
    const res = mockRes();
    getHandler('put', '/:id')(mockReq({ params: { id: '1' }, body: undefined }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('POST /:id/items handles undefined req.body (line 88)', () => {
    const res = mockRes();
    getHandler('post', '/:id/items')(mockReq({ params: { id: '1' }, body: undefined }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('requirePremium returns 403 when user is not premium (line 10)', () => {
    const [, requirePremium] = getHandlers('get', '/');
    mockStmt.get.mockReturnValue({ is_premium: 0 });
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();
    requirePremium(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Collections are a Premium feature.' });
    expect(next).not.toHaveBeenCalled();
  });

  it('requirePremium calls next when user is premium (line 11)', () => {
    const [, requirePremium] = getHandlers('get', '/');
    mockStmt.get.mockReturnValue({ is_premium: 1 });
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();
    requirePremium(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('requirePremium returns 403 when user is null (line 10)', () => {
    const [, requirePremium] = getHandlers('get', '/');
    mockStmt.get.mockReturnValue(null);
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();
    requirePremium(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
