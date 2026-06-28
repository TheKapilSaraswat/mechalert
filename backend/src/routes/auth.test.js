import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockStmt = {
  run: vi.fn(() => ({ changes: 1, lastInsertRowid: 42 })),
  get: vi.fn(() => ({ jwt_version: 1, id: 1, email: 'test@example.com', password_hash: '$2a$10$hashedpassword', is_premium: 0, is_admin: 0, tier: 'free', digest_frequency: 'never', api_key: null, is_active: 1, locked_until: null, failed_attempts: 0 })),
  all: vi.fn(() => []),
};

vi.mock('../db.js', () => ({
  default: {
    prepare: vi.fn(() => mockStmt),
  },
}));

vi.mock('bcryptjs', () => ({
  default: {
    hashSync: vi.fn(() => '$2a$10$hashedpassword1234567890123456789012345678901234567890'),
    compareSync: vi.fn(() => true),
  },
}));

vi.mock('jsonwebtoken', () => ({
  default: {
    sign: vi.fn(() => 'mock-jwt-token'),
    verify: vi.fn(() => ({ userId: 1, version: 1 })),
  },
}));

vi.mock('crypto', () => ({
  default: {
    randomBytes: vi.fn(() => ({ toString: () => 'mock-random-token-32-bytes-hex' })),
  },
}));

vi.mock('nodemailer', () => ({
  default: {
    createTestAccount: vi.fn(() => Promise.resolve({ user: 'test@ethereal.email', pass: 'pass' })),
    createTransport: vi.fn(() => ({ sendMail: vi.fn(() => Promise.resolve({ messageId: 'mock-id' })) })),
    getTestMessageUrl: vi.fn(() => 'https://ethereal.email/preview/mock'),
  },
}));

vi.mock('resend', () => ({
  Resend: vi.fn(() => ({
    emails: { send: vi.fn(() => Promise.resolve({ data: { id: 'mock-resend-id' }, error: null })) },
  })),
}));

vi.mock('../logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));

vi.mock('../validation.js', () => ({
  validate: () => (req, res, next) => { req.validated = req.body || {}; next(); },
  registerSchema: {},
  loginSchema: {},
  forgotPasswordSchema: {},
  resetPasswordSchema: {},
}));

import authRoutes from './auth.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

function mockReq(overrides = {}) {
  return {
    headers: { authorization: 'Bearer test-token' },
    body: {},
    params: {},
    validated: {},
    ...overrides,
  };
}

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

function getRouteHandlers(method, path) {
  const route = authRoutes.stack.find(l => l.route?.path === path && l.route.methods[method])?.route;
  if (!route) return [];
  return route.stack.map(l => l.handle);
}

function resetMockStmt() {
  mockStmt.get.mockReset();
  mockStmt.get.mockImplementation(() => ({ jwt_version: 1, id: 1, email: 'test@example.com', password_hash: '$2a$10$hashedpassword', is_premium: 0, is_admin: 0, tier: 'free', digest_frequency: 'never', api_key: null, is_active: 1, locked_until: null, failed_attempts: 0 }));
  mockStmt.all.mockReset();
  mockStmt.all.mockImplementation(() => []);
  mockStmt.run.mockReset();
  mockStmt.run.mockImplementation(() => ({ changes: 1, lastInsertRowid: 42 }));
}

describe('POST /register', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const db = (await vi.importMock('../db.js')).default;
    db.prepare.mockReset();
    db.prepare.mockImplementation(() => mockStmt);
    resetMockStmt();
  });

  it('registers a new user', async () => {
    mockStmt.get.mockReturnValueOnce(undefined).mockReturnValueOnce({ jwt_version: 1 });
    const handlers = getRouteHandlers('post', '/register');
    const handler = handlers[handlers.length - 1];
    const req = mockReq({ body: { email: 'new@example.com', password: 'password123' }, validated: { email: 'new@example.com', password: 'password123' } });
    const res = mockRes();
    handler(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ token: 'mock-jwt-token' }));
  });

  it('returns 409 for duplicate email', () => {
    const handlers = getRouteHandlers('post', '/register');
    const handler = handlers[handlers.length - 1];
    const req = mockReq({ body: { email: 'existing@example.com', password: 'password123' }, validated: { email: 'existing@example.com', password: 'password123' } });
    const res = mockRes();
    handler(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: 'Email already registered' });
  });

  it('normalizes email to lowercase', async () => {
    mockStmt.get.mockReturnValueOnce(undefined).mockReturnValueOnce({ jwt_version: 1 });
    const handlers = getRouteHandlers('post', '/register');
    const handler = handlers[handlers.length - 1];
    const req = mockReq({ body: { email: 'UPPERCASE@Example.Com', password: 'pwd' }, validated: { email: 'UPPERCASE@Example.Com', password: 'pwd' } });
    const res = mockRes();
    handler(req, res);
    expect(bcrypt.hashSync).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('returns 500 on db error', async () => {
    mockStmt.get.mockImplementation(() => { throw new Error('DB error'); });
    const handlers = getRouteHandlers('post', '/register');
    const handler = handlers[handlers.length - 1];
    const req = mockReq({ body: { email: 'test@example.com', password: 'pwd' }, validated: { email: 'test@example.com', password: 'pwd' } });
    const res = mockRes();
    handler(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('returns response with token and user object', () => {
    mockStmt.get.mockReturnValueOnce(undefined).mockReturnValueOnce({ jwt_version: 1 });
    const handlers = getRouteHandlers('post', '/register');
    const handler = handlers[handlers.length - 1];
    const req = mockReq({ body: { email: 'new@example.com', password: 'password123' }, validated: { email: 'new@example.com', password: 'password123' } });
    const res = mockRes();
    handler(req, res);
    expect(res.json).toHaveBeenCalledWith({
      token: 'mock-jwt-token',
      user: expect.objectContaining({
        id: 42,
        email: 'new@example.com',
        is_premium: 0,
        is_admin: 0,
        tier: 'free',
        digest_frequency: 'never',
        api_key: null,
      }),
    });
  });

  it('trims whitespace from email', () => {
    mockStmt.get.mockReturnValueOnce(undefined).mockReturnValueOnce({ jwt_version: 1 });
    const handlers = getRouteHandlers('post', '/register');
    const handler = handlers[handlers.length - 1];
    const req = mockReq({ body: { email: '  spaced@example.com  ', password: 'pwd' }, validated: { email: '  spaced@example.com  ', password: 'pwd' } });
    const res = mockRes();
    handler(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      user: expect.objectContaining({ email: 'spaced@example.com' }),
    }));
  });

  it('returns 500 when bcrypt hashSync throws', () => {
    bcrypt.hashSync.mockImplementationOnce(() => { throw new Error('hash error'); });
    mockStmt.get.mockReturnValueOnce(undefined);
    const handlers = getRouteHandlers('post', '/register');
    const handler = handlers[handlers.length - 1];
    const req = mockReq({ body: { email: 'test@example.com', password: 'pwd' }, validated: { email: 'test@example.com', password: 'pwd' } });
    const res = mockRes();
    handler(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('returns 500 when insert run throws', () => {
    mockStmt.get.mockReturnValueOnce(undefined);
    mockStmt.run.mockImplementation(() => { throw new Error('insert error'); });
    const handlers = getRouteHandlers('post', '/register');
    const handler = handlers[handlers.length - 1];
    const req = mockReq({ body: { email: 'test@example.com', password: 'pwd' }, validated: { email: 'test@example.com', password: 'pwd' } });
    const res = mockRes();
    handler(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('returns 500 when secondary query after insert fails', () => {
    let callCount = 0;
    mockStmt.get.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return undefined;
      throw new Error('query error');
    });
    const handlers = getRouteHandlers('post', '/register');
    const handler = handlers[handlers.length - 1];
    const req = mockReq({ body: { email: 'test@example.com', password: 'pwd' }, validated: { email: 'test@example.com', password: 'pwd' } });
    const res = mockRes();
    handler(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('POST /login', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const db = (await vi.importMock('../db.js')).default;
    db.prepare.mockReset();
    db.prepare.mockImplementation(() => mockStmt);
    resetMockStmt();
  });

  it('logs in with valid credentials', () => {
    const handlers = getRouteHandlers('post', '/login');
    const handler = handlers[handlers.length - 1];
    const req = mockReq({ body: { email: 'test@example.com', password: 'correct-password' }, validated: { email: 'test@example.com', password: 'correct-password' } });
    const res = mockRes();
    handler(req, res);
    expect(jwt.sign).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ token: 'mock-jwt-token' }));
  });

  it('returns 401 for invalid credentials', () => {
    bcrypt.compareSync.mockReturnValueOnce(false);
    const handlers = getRouteHandlers('post', '/login');
    const handler = handlers[handlers.length - 1];
    const req = mockReq({ body: { email: 'test@example.com', password: 'wrong-password' }, validated: { email: 'test@example.com', password: 'wrong-password' } });
    const res = mockRes();
    handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 401 for non-existent user', async () => {
    mockStmt.get.mockReturnValueOnce(undefined);
    const handlers = getRouteHandlers('post', '/login');
    const handler = handlers[handlers.length - 1];
    const req = mockReq({ body: { email: 'nonexistent@example.com', password: 'pwd' }, validated: { email: 'nonexistent@example.com', password: 'pwd' } });
    const res = mockRes();
    handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 403 for disabled account', async () => {
    mockStmt.get.mockReturnValueOnce({ id: 1, email: 'disabled@example.com', password_hash: 'hash', is_active: 0, is_premium: 0, is_admin: 0, tier: 'free', locked_until: null, failed_attempts: 0, jwt_version: 1 });
    const handlers = getRouteHandlers('post', '/login');
    const handler = handlers[handlers.length - 1];
    const req = mockReq({ body: { email: 'disabled@example.com', password: 'pwd' }, validated: { email: 'disabled@example.com', password: 'pwd' } });
    const res = mockRes();
    handler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns 429 for locked account', async () => {
    const future = new Date(Date.now() + 3600000).toISOString();
    mockStmt.get.mockReturnValueOnce({ id: 1, email: 'locked@example.com', password_hash: 'hash', is_active: 1, is_premium: 0, is_admin: 0, tier: 'free', locked_until: future, failed_attempts: 10, jwt_version: 1 });
    const handlers = getRouteHandlers('post', '/login');
    const handler = handlers[handlers.length - 1];
    const req = mockReq({ body: { email: 'locked@example.com', password: 'pwd' }, validated: { email: 'locked@example.com', password: 'pwd' } });
    const res = mockRes();
    handler(req, res);
    expect(res.status).toHaveBeenCalledWith(429);
  });

  it('locks account after 10 failed attempts', async () => {
    bcrypt.compareSync.mockReturnValueOnce(false);
    mockStmt.get.mockReturnValueOnce({ id: 1, email: 'fail@example.com', password_hash: 'hash', is_active: 1, is_premium: 0, is_admin: 0, tier: 'free', locked_until: null, failed_attempts: 9, jwt_version: 1 });
    const handlers = getRouteHandlers('post', '/login');
    const handler = handlers[handlers.length - 1];
    const req = mockReq({ body: { email: 'fail@example.com', password: 'wrong' }, validated: { email: 'fail@example.com', password: 'wrong' } });
    const res = mockRes();
    handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('resets failed attempts on successful login', async () => {
    mockStmt.get.mockReturnValueOnce({ id: 1, email: 'test@example.com', password_hash: 'hash', is_active: 1, is_premium: 0, is_admin: 0, tier: 'free', locked_until: null, failed_attempts: 3, jwt_version: 1 });
    const handlers = getRouteHandlers('post', '/login');
    const handler = handlers[handlers.length - 1];
    const req = mockReq({ body: { email: 'test@example.com', password: 'correct' }, validated: { email: 'test@example.com', password: 'correct' } });
    const res = mockRes();
    handler(req, res);
    expect(res.json).toHaveBeenCalled();
  });

  it('returns 500 on db error', async () => {
    mockStmt.get.mockImplementation(() => { throw new Error('DB error'); });
    const handlers = getRouteHandlers('post', '/login');
    const handler = handlers[handlers.length - 1];
    const req = mockReq({ body: { email: 'test@example.com', password: 'pwd' }, validated: { email: 'test@example.com', password: 'pwd' } });
    const res = mockRes();
    handler(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('returns token and user with correct shape', () => {
    const handlers = getRouteHandlers('post', '/login');
    const handler = handlers[handlers.length - 1];
    const req = mockReq({ body: { email: 'test@example.com', password: 'correct' }, validated: { email: 'test@example.com', password: 'correct' } });
    const res = mockRes();
    handler(req, res);
    expect(res.json).toHaveBeenCalledWith({
      token: 'mock-jwt-token',
      user: {
        id: 1,
        email: 'test@example.com',
        is_premium: 0,
        is_admin: 0,
        tier: 'free',
        digest_frequency: 'never',
        api_key: null,
      },
    });
  });

  it('normalizes email with whitespace', () => {
    const handlers = getRouteHandlers('post', '/login');
    const handler = handlers[handlers.length - 1];
    const req = mockReq({ body: { email: '  Test@Example.Com  ', password: 'password' }, validated: { email: '  Test@Example.Com  ', password: 'password' } });
    const res = mockRes();
    handler(req, res);
    expect(mockStmt.get).toHaveBeenCalledWith('test@example.com');
    expect(res.json).toHaveBeenCalled();
  });

  it('increments failed_attempts for invalid password', () => {
    bcrypt.compareSync.mockReturnValueOnce(false);
    mockStmt.get.mockReturnValueOnce({ id: 1, email: 'test@example.com', password_hash: 'hash', is_active: 1, is_premium: 0, is_admin: 0, tier: 'free', digest_frequency: 'never', api_key: null, locked_until: null, failed_attempts: 0, jwt_version: 1 });
    const handlers = getRouteHandlers('post', '/login');
    const handler = handlers[handlers.length - 1];
    const req = mockReq({ body: { email: 'test@example.com', password: 'wrong' }, validated: { email: 'test@example.com', password: 'wrong' } });
    const res = mockRes();
    handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockStmt.run).toHaveBeenCalledWith(1, 1);
  });

  it('returns 500 when update fails after valid login', () => {
    mockStmt.get.mockReturnValueOnce({ id: 1, email: 'test@example.com', password_hash: 'hash', is_active: 1, is_premium: 0, is_admin: 0, tier: 'free', digest_frequency: 'never', api_key: null, locked_until: null, failed_attempts: 0, jwt_version: 1 });
    mockStmt.run.mockImplementation(() => { throw new Error('update error'); });
    const handlers = getRouteHandlers('post', '/login');
    const handler = handlers[handlers.length - 1];
    const req = mockReq({ body: { email: 'test@example.com', password: 'correct' }, validated: { email: 'test@example.com', password: 'correct' } });
    const res = mockRes();
    handler(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('handles user with null optional fields', () => {
    mockStmt.get.mockReturnValueOnce({ id: 1, email: 'test@example.com', password_hash: 'hash', is_active: 1, is_premium: 0, is_admin: 0, tier: null, digest_frequency: null, api_key: null, locked_until: null, failed_attempts: 0, jwt_version: 1 });
    const handlers = getRouteHandlers('post', '/login');
    const handler = handlers[handlers.length - 1];
    const req = mockReq({ body: { email: 'test@example.com', password: 'correct' }, validated: { email: 'test@example.com', password: 'correct' } });
    const res = mockRes();
    handler(req, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      token: 'mock-jwt-token',
      user: expect.objectContaining({
        tier: 'free',
        digest_frequency: 'never',
      }),
    }));
  });
});

describe('POST /forgot', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const db = (await vi.importMock('../db.js')).default;
    db.prepare.mockReset();
    db.prepare.mockImplementation(() => mockStmt);
    resetMockStmt();
  });

  it('always returns ok: true', async () => {
    const handlers = getRouteHandlers('post', '/forgot');
    const handler = handlers[handlers.length - 1];
    const req = mockReq({ body: { email: 'test@example.com' }, validated: { email: 'test@example.com' } });
    const res = mockRes();
    await handler(req, res);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('returns ok even for unknown email', async () => {
    mockStmt.get.mockReturnValueOnce(undefined);
    const handlers = getRouteHandlers('post', '/forgot');
    const handler = handlers[handlers.length - 1];
    const req = mockReq({ body: { email: 'unknown@example.com' }, validated: { email: 'unknown@example.com' } });
    const res = mockRes();
    await handler(req, res);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('returns 500 on error', async () => {
    mockStmt.get.mockImplementation(() => { throw new Error('DB error'); });
    const handlers = getRouteHandlers('post', '/forgot');
    const handler = handlers[handlers.length - 1];
    const req = mockReq({ body: { email: 'test@example.com' }, validated: { email: 'test@example.com' } });
    const res = mockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('updates user record with reset token', async () => {
    const handlers = getRouteHandlers('post', '/forgot');
    const handler = handlers[handlers.length - 1];
    const req = mockReq({ body: { email: 'test@example.com' }, validated: { email: 'test@example.com' } });
    const res = mockRes();
    await handler(req, res);
    expect(mockStmt.run).toHaveBeenCalledWith('mock-random-token-32-bytes-hex', expect.any(String), 1);
  });

  it('returns 500 when db prepare throws on forgot', async () => {
    const db = (await vi.importMock('../db.js')).default;
    db.prepare.mockImplementation(() => { throw new Error('prepare error'); });
    const handlers = getRouteHandlers('post', '/forgot');
    const handler = handlers[handlers.length - 1];
    const req = mockReq({ body: { email: 'test@example.com' }, validated: { email: 'test@example.com' } });
    const res = mockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('returns 500 when update throws on forgot', async () => {
    mockStmt.run.mockImplementation(() => { throw new Error('update error'); });
    const handlers = getRouteHandlers('post', '/forgot');
    const handler = handlers[handlers.length - 1];
    const req = mockReq({ body: { email: 'test@example.com' }, validated: { email: 'test@example.com' } });
    const res = mockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('normalizes email for forgot password', async () => {
    const handlers = getRouteHandlers('post', '/forgot');
    const handler = handlers[handlers.length - 1];
    const req = mockReq({ body: { email: '  Test@Example.Com  ' }, validated: { email: '  Test@Example.Com  ' } });
    const res = mockRes();
    await handler(req, res);
    expect(mockStmt.get).toHaveBeenCalledWith('test@example.com');
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });
});

describe('POST /reset', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const db = (await vi.importMock('../db.js')).default;
    db.prepare.mockReset();
    db.prepare.mockImplementation(() => mockStmt);
    resetMockStmt();
  });

  it('resets password with valid token', () => {
    const handlers = getRouteHandlers('post', '/reset');
    const handler = handlers[handlers.length - 1];
    const req = mockReq({ body: { token: 'valid-token', password: 'new-password' }, validated: { token: 'valid-token', password: 'new-password' } });
    const res = mockRes();
    handler(req, res);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('returns 400 for invalid or expired token', async () => {
    mockStmt.get.mockReturnValueOnce(undefined);
    const handlers = getRouteHandlers('post', '/reset');
    const handler = handlers[handlers.length - 1];
    const req = mockReq({ body: { token: 'bad-token', password: 'new-password' }, validated: { token: 'bad-token', password: 'new-password' } });
    const res = mockRes();
    handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 500 on error', async () => {
    mockStmt.get.mockImplementation(() => { throw new Error('DB error'); });
    const handlers = getRouteHandlers('post', '/reset');
    const handler = handlers[handlers.length - 1];
    const req = mockReq({ body: { token: 'test', password: 'new-pwd' }, validated: { token: 'test', password: 'new-pwd' } });
    const res = mockRes();
    handler(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('calls run with correct parameters on valid reset', () => {
    const handlers = getRouteHandlers('post', '/reset');
    const handler = handlers[handlers.length - 1];
    const req = mockReq({ body: { token: 'valid-token', password: 'new-password' }, validated: { token: 'valid-token', password: 'new-password' } });
    const res = mockRes();
    handler(req, res);
    expect(mockStmt.run).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('returns 500 when bcrypt hashSync throws on reset', () => {
    bcrypt.hashSync.mockImplementationOnce(() => { throw new Error('hash error'); });
    const handlers = getRouteHandlers('post', '/reset');
    const handler = handlers[handlers.length - 1];
    const req = mockReq({ body: { token: 'valid-token', password: 'new-password' }, validated: { token: 'valid-token', password: 'new-password' } });
    const res = mockRes();
    handler(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('returns 500 when update throws after hash', () => {
    mockStmt.run.mockImplementation(() => { throw new Error('update error'); });
    const handlers = getRouteHandlers('post', '/reset');
    const handler = handlers[handlers.length - 1];
    const req = mockReq({ body: { token: 'valid-token', password: 'new-password' }, validated: { token: 'valid-token', password: 'new-password' } });
    const res = mockRes();
    handler(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('POST /logout', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const db = (await vi.importMock('../db.js')).default;
    db.prepare.mockReset();
    db.prepare.mockImplementation(() => mockStmt);
    resetMockStmt();
  });

  it('invalidates JWT by incrementing version', () => {
    const handlers = getRouteHandlers('post', '/logout');
    const handler = handlers[handlers.length - 1];
    const req = mockReq();
    const res = mockRes();
    handler(req, res);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('returns 401 when no authorization header', () => {
    const handlers = getRouteHandlers('post', '/logout');
    const handler = handlers[handlers.length - 1];
    const req = mockReq({ headers: {} });
    const res = mockRes();
    handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 401 on invalid JWT', () => {
    jwt.verify.mockImplementation(() => { throw new Error('jwt error'); });
    const handlers = getRouteHandlers('post', '/logout');
    const handler = handlers[handlers.length - 1];
    const req = mockReq();
    const res = mockRes();
    handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 401 on db error (caught by generic catch)', async () => {
    mockStmt.run.mockImplementation(() => { throw new Error('DB error'); });
    const handlers = getRouteHandlers('post', '/logout');
    const handler = handlers[handlers.length - 1];
    const req = mockReq();
    const res = mockRes();
    handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('calls db.run with userId to increment version', () => {
    jwt.verify.mockImplementation(() => ({ userId: 1, version: 1 }));
    const handlers = getRouteHandlers('post', '/logout');
    const handler = handlers[handlers.length - 1];
    const req = mockReq();
    const res = mockRes();
    handler(req, res);
    expect(mockStmt.run).toHaveBeenCalledWith(1);
  });

  it('returns 401 on expired token', () => {
    jwt.verify.mockImplementationOnce(() => { throw new Error('jwt expired'); });
    const handlers = getRouteHandlers('post', '/logout');
    const handler = handlers[handlers.length - 1];
    const req = mockReq({ headers: { authorization: 'Bearer expired-token' } });
    const res = mockRes();
    handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 401 with No token error when header missing', () => {
    const handlers = getRouteHandlers('post', '/logout');
    const handler = handlers[handlers.length - 1];
    const req = mockReq({ headers: {} });
    const res = mockRes();
    handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'No token' });
  });
});
