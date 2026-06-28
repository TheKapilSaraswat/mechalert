import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./db.js', () => {
  const mockStmt = {
    run: vi.fn(),
    get: vi.fn(() => ({ jwt_version: 1, id: 1, email: 'admin@test.com', is_admin: 0 })),
    all: vi.fn(),
  };
  const mockDb = {
    prepare: vi.fn(() => mockStmt),
    exec: vi.fn(),
    pragma: vi.fn(() => [{ journal_mode: 'wal' }]),
    get name() { return ':memory:'; },
  };
  return { default: mockDb };
});

vi.mock('jsonwebtoken', () => ({
  default: {
    verify: vi.fn(() => ({ userId: 1, version: 1 })),
  },
}));

import { jwtAuth, adminAuth } from './middleware.js';

function mockReq(overrides = {}) {
  return {
    headers: { authorization: 'Bearer test-token' },
    body: {},
    params: {},
    user: null,
    ...overrides,
  };
}

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe('jwtAuth', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('returns 401 when no authorization header', () => {
    const req = mockReq({ headers: {} });
    const res = mockRes();
    jwtAuth(req, res, () => {});
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'No token' });
  });

  it('returns 401 with empty authorization', () => {
    const req = mockReq({ headers: { authorization: '' } });
    const res = mockRes();
    jwtAuth(req, res, () => {});
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('calls next on valid token', () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();
    jwtAuth(req, req, next);
    expect(next).toHaveBeenCalled();
  });

  it('sets req.user on valid token', () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();
    jwtAuth(req, res, next);
    expect(req.user).toBeDefined();
    expect(req.user.userId).toBe(1);
  });

  it('returns 401 when user not found in db', async () => {
    const db = (await vi.importMock('./db.js')).default;
    db.prepare().get.mockReturnValue(undefined);
    const req = mockReq();
    const res = mockRes();
    jwtAuth(req, res, () => {});
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 401 when jwt_version mismatch', async () => {
    const db = (await vi.importMock('./db.js')).default;
    db.prepare().get.mockReturnValue({ jwt_version: 2 });
    const req = mockReq();
    const res = mockRes();
    jwtAuth(req, res, () => {});
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Token revoked' });
  });

  it('returns 401 on invalid token (jwt throws)', async () => {
    const jwt = await import('jsonwebtoken');
    vi.mocked(jwt.default.verify).mockImplementation(() => { throw new Error('jwt malformed'); });
    const req = mockReq();
    const res = mockRes();
    jwtAuth(req, res, () => {});
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token' });
  });

  it('handles Bearer token extraction', () => {
    const req = mockReq({ headers: { authorization: 'Bearer mytoken123' } });
    const res = mockRes();
    const next = vi.fn();
    jwtAuth(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('handles token without Bearer prefix', () => {
    const req = mockReq({ headers: { authorization: 'mytoken123' } });
    const res = mockRes();
    const next = vi.fn();
    jwtAuth(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('does not crash on malformed authorization header', () => {
    const req = mockReq({ headers: { authorization: 123 } });
    const res = mockRes();
    jwtAuth(req, res, () => {});
    expect(res.status).toHaveBeenCalled();
  });
});

describe('adminAuth', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('returns 401 when no authorization header', () => {
    const req = mockReq({ headers: {} });
    const res = mockRes();
    adminAuth(req, res, () => {});
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'No token' });
  });

  it('returns 404 when user not found', async () => {
    const db = (await vi.importMock('./db.js')).default;
    db.prepare().get.mockReturnValue(undefined);
    const req = mockReq();
    const res = mockRes();
    adminAuth(req, res, () => {});
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'User not found' });
  });

  it('returns 403 when user is not admin', async () => {
    const db = (await vi.importMock('./db.js')).default;
    db.prepare().get.mockReturnValue({ id: 1, email: 'user@test.com', is_admin: 0, jwt_version: 1 });
    const req = mockReq();
    const res = mockRes();
    adminAuth(req, res, () => {});
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Admin access required' });
  });

  it('calls next when user is admin', async () => {
    const db = (await vi.importMock('./db.js')).default;
    db.prepare().get.mockReturnValue({ id: 1, email: 'admin@test.com', is_admin: 1, jwt_version: 1 });
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();
    adminAuth(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('promotes user to admin if email matches ADMIN_EMAIL', async () => {
    process.env.ADMIN_EMAIL = 'user@test.com';
    const db = (await vi.importMock('./db.js')).default;
    db.prepare().get.mockReturnValue({ id: 1, email: 'user@test.com', is_admin: 0, jwt_version: 1 });
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();
    adminAuth(req, res, next);
    expect(next).toHaveBeenCalled();
    delete process.env.ADMIN_EMAIL;
  });

  it('returns 401 on jwt verify error', async () => {
    const jwt = await import('jsonwebtoken');
    vi.mocked(jwt.default.verify).mockImplementation(() => { throw new Error('jwt error'); });
    const req = mockReq();
    const res = mockRes();
    adminAuth(req, res, () => {});
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('sets req.user and req.adminUser', async () => {
    const db = (await vi.importMock('./db.js')).default;
    db.prepare().get.mockReturnValue({ id: 1, email: 'admin@test.com', is_admin: 1, jwt_version: 1 });
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();
    adminAuth(req, res, next);
    expect(req.user).toBeDefined();
    expect(req.adminUser).toBeDefined();
  });

  it('returns 401 on jwt_version mismatch in admin', async () => {
    const db = (await vi.importMock('./db.js')).default;
    db.prepare().get.mockReturnValue({ id: 1, email: 'admin@test.com', is_admin: 1, jwt_version: 2 });
    const req = mockReq();
    const res = mockRes();
    adminAuth(req, res, () => {});
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('handles missing authorization header in admin', () => {
    const req = mockReq({ headers: {} });
    const res = mockRes();
    adminAuth(req, res, () => {});
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'No token' });
  });

  it('handles admin auth with empty header', () => {
    const req = mockReq({ headers: { authorization: '' } });
    const res = mockRes();
    adminAuth(req, res, () => {});
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('handles jwt verify throwing in admin', async () => {
    const jwt = await import('jsonwebtoken');
    vi.mocked(jwt.default.verify).mockImplementation(() => { throw new Error('jwt error'); });
    const req = mockReq();
    const res = mockRes();
    adminAuth(req, res, () => {});
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('handles db error in admin', async () => {
    const db = (await vi.importMock('./db.js')).default;
    db.prepare().get.mockImplementation(() => { throw new Error('DB error'); });
    const req = mockReq();
    const res = mockRes();
    adminAuth(req, res, () => {});
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe('jwtAuth additional edge cases', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('handles token with extra Bearer spaces', () => {
    const req = mockReq({ headers: { authorization: 'Bearer  mytoken123' } });
    const res = mockRes();
    const next = vi.fn();
    jwtAuth(req, res, next);
  });

  it('handles db get returning null for jwt version', () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();
    jwtAuth(req, res, next);
  });

  it('does not call next on jwt verify throw', () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();
    jwtAuth(req, res, next);
  });

  it('handles malformed authorization object', () => {
    const req = mockReq({ headers: { authorization: 123 } });
    const res = mockRes();
    jwtAuth(req, res, () => {});
    expect(res.status).toHaveBeenCalled();
  });

  it('handles missing req object', () => {
    const res = mockRes();
    expect(() => jwtAuth(undefined, res, () => {})).toThrow();
  });
});

describe('adminAuth additional edge cases', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('handles token with special characters', () => {
    const req = mockReq({ headers: { authorization: 'Bearer token+special/chars=123' } });
    const res = mockRes();
    adminAuth(req, res, () => {});
  });

  it('handles null decoded token', () => {
    const req = mockReq();
    const res = mockRes();
    adminAuth(req, res, () => {});
  });

  it('handles user found with null email', async () => {
    const db = (await vi.importMock('./db.js')).default;
    db.prepare().get.mockReturnValue({ id: 1, email: null, is_admin: 0, jwt_version: 1 });
    const req = mockReq();
    const res = mockRes();
    adminAuth(req, res, () => {});
  });

  it('handles missing adminUser properties', async () => {
    const db = (await vi.importMock('./db.js')).default;
    db.prepare().get.mockReturnValue({ id: 1, email: 'test@test.com', is_admin: 1, jwt_version: 1 });
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();
    adminAuth(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.user).toBeDefined();
    expect(req.adminUser).toBeDefined();
  });
});
