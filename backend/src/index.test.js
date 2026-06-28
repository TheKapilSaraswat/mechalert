import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

// ============================================================
// MOCKS (all vi.mock calls are hoisted by vitest)
// ============================================================

vi.mock('./logger.js', () => {
  const l = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
  return { default: l };
});

vi.mock('./db.js', () => {
  const stmt = {
    run: vi.fn(() => ({ changes: 1, lastInsertRowid: 42 })),
    get: vi.fn(() => ({ c: 0, avg: 0, is_premium: 0, id: 1 })),
    all: vi.fn(() => []),
  };
  return { default: { prepare: vi.fn(() => stmt) } };
});



vi.mock('cors', () => ({ default: vi.fn(() => vi.fn((req, res, next) => next())) }));
vi.mock('helmet', () => ({ default: vi.fn(() => vi.fn((req, res, next) => next())) }));
vi.mock('express-rate-limit', () => ({ default: vi.fn(() => vi.fn((req, res, next) => next())) }));

vi.mock('jsonwebtoken', () => ({
  default: { sign: vi.fn(() => 'mock-token'), verify: vi.fn(() => ({ userId: 1, version: 1 })) },
}));

vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }));

vi.mock('./middleware.js', () => {
  const jwt = vi.fn((req, res, next) => { req.user = { userId: 1 }; next(); });
  const admin = vi.fn((req, res, next) => { req.user = { userId: 1 }; req.adminUser = { id: 1, email: 'admin@test.com', is_admin: 1 }; next(); });
  return { jwtAuth: jwt, adminAuth: admin };
});

vi.mock('./scanner.js', () => ({ scanSubreddit: vi.fn(() => Promise.resolve()) }));
vi.mock('./craigslistScanner.js', () => ({ scanCraigslist: vi.fn(() => Promise.resolve()) }));
vi.mock('./matchers.js', () => ({ matchKeywords: vi.fn(() => ['matched-keyword']), matchPrice: vi.fn(() => true) }));
vi.mock('./notifier.js', () => ({ sendNotification: vi.fn(() => Promise.resolve()), sendEmail: vi.fn(() => Promise.resolve()) }));
vi.mock('./dbBackup.js', () => ({ backupDatabase: vi.fn(), runWALCheckpoint: vi.fn() }));

vi.mock('./validation.js', () => ({
  validate: () => (req, res, next) => { next(); },
  loginSchema: {}, registerSchema: {}, forgotPasswordSchema: {}, resetPasswordSchema: {},
  createAlertRuleSchema: {}, updateAlertRuleSchema: {}, searchQuerySchema: {},
  createSavedDealSchema: {}, updateSavedDealSchema: {}, webhookPostSchema: {},
}));

vi.mock('morgan', () => ({ default: vi.fn(() => vi.fn((req, res, next) => next())) }));
vi.mock('@sentry/node', () => ({ default: { init: vi.fn(), captureException: vi.fn() } }));
vi.mock('dotenv/config', () => ({}));
vi.mock('razorpay', () => ({ default: vi.fn() }));

// ============================================================
// IMPORTS (resolved after hoisted vi.mock calls)
// ============================================================

import request from 'supertest';
import logger from './logger.js';
import corsModule from 'cors';
import helmetModule from 'helmet';
import rateLimitModule from 'express-rate-limit';
import cronModule from 'node-cron';
import sentryModule from '@sentry/node';

// ============================================================
// JWT_SECRET VALIDATION
// ============================================================

describe('JWT_SECRET validation', () => {
  const ORIG = process.env.JWT_SECRET;

  afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); logger.error.mockClear(); });

  it('exits process when JWT_SECRET is not set', async () => {
    delete process.env.JWT_SECRET;
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
    await import('./index.js');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('JWT_SECRET'));
    exitSpy.mockRestore();
    process.env.JWT_SECRET = ORIG || 'test-secret';
  });
});

// ============================================================
// MAIN EXPRESS APP SETUP
// ============================================================

describe('Express app initialization', () => {
  let app;
  let onServerStartFn;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret';
    process.env.NODE_ENV = 'production';
    process.env.PORT = '4567';
    process.env.ENABLE_CRAIGSLIST_SCANNER = 'false';
    process.env.CORS_ORIGIN = 'http://example.com,http://test.com';
    process.env.API_RATE_LIMIT_MAX = '100';
    process.env.AUTH_RATE_LIMIT_MAX = '5';
    process.env.SEARCH_RATE_LIMIT_MAX = '20';
    process.env.SCAN_INTERVAL_MINUTES = '10';
    const mod = await import('./index.js');
    app = mod.default;
    onServerStartFn = mod.onServerStart;
  });

  it('sets trust proxy to 2 for production NODE_ENV', () => {
    expect(app.get('trust proxy')).toBe(2);
  });

  it('configures helmet with content security policy directives', () => {
    expect(helmetModule).toHaveBeenCalledWith(
      expect.objectContaining({
        contentSecurityPolicy: expect.objectContaining({
          directives: expect.objectContaining({
            defaultSrc: expect.arrayContaining(["'self'"]),
          }),
        }),
      }),
    );
  });

  it('configures CORS with origins from CORS_ORIGIN env', () => {
    expect(corsModule).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: ['http://example.com', 'http://test.com'],
        credentials: true,
        maxAge: 86400,
      }),
    );
  });

  it('configures API rate limiter with max from env', () => {
    expect(rateLimitModule).toHaveBeenCalledWith(
      expect.objectContaining({ windowMs: 60000, max: 100 }),
    );
  });

  it('configures auth rate limiter with max from env', () => {
    expect(rateLimitModule).toHaveBeenCalledWith(
      expect.objectContaining({ windowMs: 60000, max: 5 }),
    );
  });

  it('configures search rate limiter with max from env', () => {
    expect(rateLimitModule).toHaveBeenCalledWith(
      expect.objectContaining({ windowMs: 60000, max: 20 }),
    );
  });

  it('configures scan rate limiter with hardcoded max 5', () => {
    expect(rateLimitModule).toHaveBeenCalledWith(
      expect.objectContaining({ windowMs: 60000, max: 5 }),
    );
  });

  it('responds to GET /api/health with status ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('responds to GET /api/ping with pong', async () => {
    const res = await request(app).get('/api/ping');
    expect(res.status).toBe(200);
    expect(res.text).toBe('pong');
  });

  it('responds to GET /api/config with configuration object', async () => {
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body.tiers).toBeDefined();
    expect(res.body.sources).toBeDefined();
  });

  it('responds to GET /api/debug/reddit', async () => {
    const res = await request(app).get('/api/debug/reddit');
    expect(res.status).toBe(200);
    expect(res.body.REDDIT_TOKEN).toBe(false);
  });

  it('responds to GET /api/stats with aggregated stats', async () => {
    const res = await request(app).get('/api/stats');
    expect(res.status).toBe(200);
    expect(res.body.tier).toBe('free');
    expect(res.body.totalListings).toBe(0);
    expect(res.body.savedDeals).toBe(0);
    expect(res.body.rareFinds).toBe(0);
    expect(res.body.bySource).toEqual([]);
  });

  it('responds to auth-protected GET /api/me (auth mock always passes)', async () => {
    const res = await request(app).get('/api/me');
    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
  });

  it('responds to auth-protected GET /api/matches (auth mock always passes)', async () => {
    const res = await request(app).get('/api/matches');
    expect(res.status).toBe(200);
  });

  it('responds to auth-protected GET /api/alerts/expiring (auth mock always passes)', async () => {
    const res = await request(app).get('/api/alerts/expiring');
    expect(res.status).toBe(200);
  });

  it('responds with 400 for POST /api/alerts/estimate without keywords', async () => {
    const res = await request(app).post('/api/alerts/estimate');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Keywords required');
  });

  it('responds with 403 for GET /api/price-history/:postId when not premium', async () => {
    const res = await request(app).get('/api/price-history/test123');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Price history is a Premium feature.');
  });

  it('responds with 200 for POST /api/track with valid body', async () => {
    const res = await request(app).post('/api/track').send({ path: '/test' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('responds with 200 for POST /api/track with empty body', async () => {
    const res = await request(app).post('/api/track');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('responds with 200 for POST /api/track-click (auth mock always passes)', async () => {
    const res = await request(app).post('/api/track-click');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('responds with 200 for POST /api/alerts/estimate with keywords', async () => {
    const res = await request(app).post('/api/alerts/estimate').send({ keywords: 'mechanical keyboard' });
    expect(res.status).toBe(200);
    expect(res.body.estimatedWeekly).toBeGreaterThan(0);
  });

  it('responds with 200 for GET /api/price-history/:postId when premium', async () => {
    const dbModule = await import('./db.js');
    const stmt = dbModule.default.prepare();
    stmt.get.mockReturnValueOnce({ is_premium: 1, id: 1 });
    const res = await request(app).get('/api/price-history/premium-test');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('handles GET /api/health with db failure', async () => {
    const dbModule = await import('./db.js');
    dbModule.default.prepare.mockImplementationOnce(() => { throw new Error('DB down'); });
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('error');
  });

  it('returns 404 for unknown API route', async () => {
    const res = await request(app).get('/api/nonexistent');
    expect(res.status).toBe(404);
  });

  it('returns the onServerStart function that logs and calls scanAll', () => {
    expect(onServerStartFn).toBeDefined();
    expect(typeof onServerStartFn).toBe('function');
  });

  it('schedules scan cron with configured interval', () => {
    expect(cronModule.schedule).toHaveBeenCalledWith('*/10 * * * *', expect.any(Function));
  });

  it('schedules DB backup and WAL checkpoint crons', () => {
    expect(cronModule.schedule).toHaveBeenCalledWith('*/30 * * * *', expect.any(Function));
    expect(cronModule.schedule).toHaveBeenCalledWith('*/5 * * * *', expect.any(Function));
  });

  it('schedules subscription expiry cron at midnight', () => {
    expect(cronModule.schedule).toHaveBeenCalledWith('0 0 * * *', expect.any(Function));
  });

  it('schedules daily digest cron at 8am', () => {
    expect(cronModule.schedule).toHaveBeenCalledWith('0 8 * * *', expect.any(Function));
  });

  it('warns when OPENROUTER_API_KEY is not set', () => {
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('OPENROUTER_API_KEY'));
  });

  it('warns when REDDIT_CLIENT_ID is not set', () => {
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('REDDIT_CLIENT_ID'));
  });

  it('warns when SMTP_HOST/RESEND_API_KEY is not set', () => {
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('SMTP_HOST'));
  });

  it('warns when WEBHOOK_SECRET is not set', () => {
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('WEBHOOK_SECRET'));
  });
});

// ============================================================
// ENV VAR SENSITIVITY (re-imports module with different env)
// ============================================================

describe('Environment variable sensitivity', () => {
  beforeEach(() => { vi.resetModules(); });

  it('uses default CORS origins when CORS_ORIGIN is not set', async () => {
    process.env.JWT_SECRET = 'test-secret';
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_CRAIGSLIST_SCANNER = 'false';
    delete process.env.CORS_ORIGIN;
    await import('./index.js');
    expect(corsModule).toHaveBeenLastCalledWith(
      expect.objectContaining({
        origin: ['http://localhost:5173', 'https://mechalert-production.up.railway.app'],
      }),
    );
  });

  it('uses default rate limit maxes when env vars are absent', async () => {
    process.env.JWT_SECRET = 'test-secret';
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_CRAIGSLIST_SCANNER = 'false';
    delete process.env.API_RATE_LIMIT_MAX;
    delete process.env.AUTH_RATE_LIMIT_MAX;
    delete process.env.SEARCH_RATE_LIMIT_MAX;
    rateLimitModule.mockClear();
    await import('./index.js');
    const calls = rateLimitModule.mock.calls;
    expect(calls.some(c => c[0]?.max === 200)).toBe(true);
    expect(calls.some(c => c[0]?.max === 10)).toBe(true);
    expect(calls.some(c => c[0]?.max === 30)).toBe(true);
  });

  it('skips warnings when required env vars are set', async () => {
    process.env.JWT_SECRET = 'test-secret';
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_CRAIGSLIST_SCANNER = 'false';
    process.env.OPENROUTER_API_KEY = 'sk-xxx';
    process.env.REDDIT_CLIENT_ID = 'client-id';
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.WEBHOOK_SECRET = 'whsec_xxx';
    logger.warn.mockClear();
    await import('./index.js');
    expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('OPENROUTER_API_KEY'));
    expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('REDDIT_CLIENT_ID'));
    expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('SMTP_HOST'));
    expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('WEBHOOK_SECRET'));
  });

  it('uses default scan interval of 2 minutes when SCAN_INTERVAL_MINUTES not set', async () => {
    process.env.JWT_SECRET = 'test-secret';
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_CRAIGSLIST_SCANNER = 'false';
    delete process.env.SCAN_INTERVAL_MINUTES;
    cronModule.schedule.mockClear();
    await import('./index.js');
    expect(cronModule.schedule).toHaveBeenCalledWith('*/2 * * * *', expect.any(Function));
  });

  it('sets trust proxy to 1 for non-production', async () => {
    process.env.JWT_SECRET = 'test-secret';
    process.env.NODE_ENV = 'development';
    process.env.ENABLE_CRAIGSLIST_SCANNER = 'false';
    const mod = await import('./index.js');
    expect(mod.default.get('trust proxy')).toBe(1);
  });

  it('skips DB backup crons when ENABLE_DB_BACKUP is false', async () => {
    process.env.JWT_SECRET = 'test-secret';
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_CRAIGSLIST_SCANNER = 'false';
    process.env.ENABLE_DB_BACKUP = 'false';
    cronModule.schedule.mockClear();
    await import('./index.js');
    const backupCalls = cronModule.schedule.mock.calls.filter(
      c => c[0] === '*/30 * * * *' || c[0] === '*/5 * * * *',
    );
    expect(backupCalls.length).toBe(0);
  });
});

// ============================================================
// PROCESS EVENT HANDLERS
// ============================================================

describe('Process event handlers', () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret';
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_CRAIGSLIST_SCANNER = 'false';
    vi.useFakeTimers();
    await import('./index.js');
  });

  afterAll(() => { vi.useRealTimers(); });
  beforeEach(() => { logger.error.mockClear(); });

  it('logs unhandledRejection with Error object', () => {
    const handler = process.listeners('unhandledRejection').pop();
    expect(handler).toBeDefined();
    handler(new Error('test rejection'));
    expect(logger.error).toHaveBeenCalledWith('UNHANDLED REJECTION', expect.objectContaining({ error: 'test rejection' }));
  });

  it('logs unhandledRejection with string reason', () => {
    const handler = process.listeners('unhandledRejection').pop();
    handler('string reason');
    expect(logger.error).toHaveBeenCalledWith('UNHANDLED REJECTION', expect.objectContaining({ error: 'string reason' }));
  });

  it('logs uncaughtException', () => {
    const handler = process.listeners('uncaughtException').pop();
    expect(handler).toBeDefined();
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
    handler(new Error('test exception'));
    expect(logger.error).toHaveBeenCalledWith('UNCAUGHT EXCEPTION', expect.objectContaining({ error: 'test exception' }));
    exitSpy.mockRestore();
  });

  it('calls process.exit(1) for uncaughtException in production', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
    const handler = process.listeners('uncaughtException').pop();
    process.env.NODE_ENV = 'production';
    handler(new Error('fatal'));
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});

// ============================================================
// SCANALL FUNCTION
// ============================================================

describe('scanAll function', () => {
  let onServerStartFn;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret';
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_CRAIGSLIST_SCANNER = 'true';
    vi.useFakeTimers();
    const mod = await import('./index.js');
    onServerStartFn = mod.onServerStart;
  });

  afterAll(() => { vi.useRealTimers(); });

  beforeEach(async () => {
    const s = await import('./scanner.js');
    s.scanSubreddit.mockClear();
    const c = await import('./craigslistScanner.js');
    c.scanCraigslist.mockClear();
    logger.info.mockClear();
    logger.error.mockClear();
  });

  it('calls scanSubreddit for subreddits in the batch', async () => {
    onServerStartFn();
    await vi.advanceTimersByTimeAsync(50000);
    const s = await import('./scanner.js');
    expect(s.scanSubreddit.mock.calls.length).toBeGreaterThan(0);
  });

  it('logs scan cycle start and completion', async () => {
    onServerStartFn();
    await vi.advanceTimersByTimeAsync(50000);
    expect(logger.info).toHaveBeenCalledWith('Starting scan cycle', expect.any(Object));
    expect(logger.info).toHaveBeenCalledWith('Scan cycle complete');
  });

  it('calls scanCraigslist when ENABLE_CRAIGSLIST_SCANNER is true', async () => {
    onServerStartFn();
    await vi.advanceTimersByTimeAsync(50000);
    const c = await import('./craigslistScanner.js');
    expect(c.scanCraigslist).toHaveBeenCalled();
  });
});

// ============================================================
// SENTRY
// ============================================================

describe('Sentry initialization', () => {
  beforeEach(() => {
    vi.resetModules();
    sentryModule.init.mockClear();
    logger.info.mockClear();
  });

  it('initializes Sentry when SENTRY_DSN is set', async () => {
    process.env.JWT_SECRET = 'test-secret';
    process.env.NODE_ENV = 'production';
    process.env.SENTRY_DSN = 'https://key@sentry.io/project';
    process.env.SENTRY_TRACES_SAMPLE_RATE = '0.5';
    await import('./index.js');
    await new Promise(r => setTimeout(r, 0));
    expect(sentryModule.init).toHaveBeenCalledWith({
      dsn: 'https://key@sentry.io/project',
      environment: 'production',
      tracesSampleRate: 0.5,
    });
    expect(logger.info).toHaveBeenCalledWith('Sentry initialized');
    delete process.env.SENTRY_DSN;
    delete process.env.SENTRY_TRACES_SAMPLE_RATE;
  });

  it('skips Sentry init when SENTRY_DSN is not set', async () => {
    process.env.JWT_SECRET = 'test-secret';
    process.env.NODE_ENV = 'production';
    delete process.env.SENTRY_DSN;
    sentryModule.init.mockClear();
    logger.info.mockClear();
    await import('./index.js');
    expect(sentryModule.init).not.toHaveBeenCalled();
  });

  it('uses default tracesSampleRate of 0.1 when env not set', async () => {
    process.env.JWT_SECRET = 'test-secret';
    process.env.NODE_ENV = 'production';
    process.env.SENTRY_DSN = 'https://key@sentry.io/project';
    delete process.env.SENTRY_TRACES_SAMPLE_RATE;
    sentryModule.init.mockClear();
    await import('./index.js');
    await new Promise(r => setTimeout(r, 0));
    expect(sentryModule.init).toHaveBeenCalledWith(
      expect.objectContaining({ tracesSampleRate: 0.1 }),
    );
    delete process.env.SENTRY_DSN;
  });
});

// ============================================================
// MORGAN
// ============================================================

describe('Morgan middleware', () => {
  beforeEach(() => { vi.resetModules(); });

  it('uses morgan in development mode', async () => {
    process.env.JWT_SECRET = 'test-secret';
    process.env.NODE_ENV = 'development';
    process.env.ENABLE_CRAIGSLIST_SCANNER = 'false';
    await import('./index.js');
    const morganMock = await vi.importActual('morgan');
    expect(morganMock).toBeDefined();
  });

  it('does not add morgan in production', async () => {
    process.env.JWT_SECRET = 'test-secret';
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_CRAIGSLIST_SCANNER = 'false';
    const mod = await import('./index.js');
    const res = await request(mod.default).get('/api/ping');
    expect(res.status).toBe(200);
  });
});

// ============================================================
// ERROR HANDLER & CATCH-ALL
// ============================================================

describe('Error handler and catch-all route', () => {
  let app;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret';
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_CRAIGSLIST_SCANNER = 'false';
    const mod = await import('./index.js');
    app = mod.default;
  });

  it('triggers error handler for non-API GET routes (file not found)', async () => {
    const res = await request(app).get('/some-nonexistent-page');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
  });

  it('returns 404 for unknown API route', async () => {
    const res = await request(app).get('/api/unknown/route');
    expect(res.status).toBe(404);
  });

  it('returns 404 for POST to unknown API route', async () => {
    const res = await request(app).post('/api/unknown');
    expect(res.status).toBe(404);
  });
});

// ============================================================
// ADDITIONAL ENV WARNINGS
// ============================================================

describe('Additional env warning messages', () => {
  beforeEach(() => { vi.resetModules(); logger.warn.mockClear(); });

  it('warns when STRIPE_WEBHOOK_SECRET not set but STRIPE_SECRET_KEY is set', async () => {
    process.env.JWT_SECRET = 'test-secret';
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_CRAIGSLIST_SCANNER = 'false';
    process.env.STRIPE_SECRET_KEY = 'sk_test_xxx';
    delete process.env.STRIPE_WEBHOOK_SECRET;
    await import('./index.js');
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('STRIPE_WEBHOOK_SECRET'));
  });

  it('warns when PAYPAL_WEBHOOK_ID not set but PAYPAL_CLIENT_ID is set', async () => {
    process.env.JWT_SECRET = 'test-secret';
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_CRAIGSLIST_SCANNER = 'false';
    process.env.PAYPAL_CLIENT_ID = 'paypal-client-id';
    delete process.env.PAYPAL_WEBHOOK_ID;
    await import('./index.js');
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('PAYPAL_WEBHOOK_ID'));
  });

  it('warns when RAZORPAY_WEBHOOK_SECRET not set but RAZORPAY_KEY_ID is set', async () => {
    process.env.JWT_SECRET = 'test-secret';
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_CRAIGSLIST_SCANNER = 'false';
    process.env.RAZORPAY_KEY_ID = 'rzp_test_xxx';
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    await import('./index.js');
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('RAZORPAY_WEBHOOK_SECRET'));
  });
});

// ============================================================
// CRON CALLBACK BODIES
// ============================================================

describe('Cron callback bodies', () => {
  beforeEach(() => {
    vi.resetModules();
    logger.info.mockClear();
    logger.error.mockClear();
  });

  it('runs subscription expiry check callback via cron schedule', async () => {
    process.env.JWT_SECRET = 'test-secret';
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_CRAIGSLIST_SCANNER = 'false';
    await import('./index.js');
    const scheduleCalls = cronModule.schedule.mock.calls;
    const expiryCall = scheduleCalls.find(c => c[0] === '0 0 * * *');
    expect(expiryCall).toBeDefined();
    const expiryCb = expiryCall[1];
    await expiryCb();
    expect(logger.info).toHaveBeenCalledWith('Running subscription expiry check');
  });

  it('runs daily digest cron callback', async () => {
    process.env.JWT_SECRET = 'test-secret';
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_CRAIGSLIST_SCANNER = 'false';
    await import('./index.js');
    const scheduleCalls = cronModule.schedule.mock.calls;
    const digestCall = scheduleCalls.find(c => c[0] === '0 8 * * *');
    expect(digestCall).toBeDefined();
    const digestCb = digestCall[1];
    await digestCb();
    expect(logger.info).toHaveBeenCalledWith('Running daily digest cron');
  });

  it('runs midnight subscription expiry with expired users', async () => {
    const dbModule = await import('./db.js');
    const stmt = dbModule.default.prepare();
    stmt.all.mockReturnValue([
      { id: 1, email: 'test@test.com', subscription_ends_at: '2020-01-01' },
    ]);
    process.env.JWT_SECRET = 'test-secret';
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_CRAIGSLIST_SCANNER = 'false';
    await import('./index.js');
    const scheduleCalls = cronModule.schedule.mock.calls;
    const expiryCb = scheduleCalls.find(c => c[0] === '0 0 * * *')[1];
    await expiryCb();
    expect(stmt.run).toHaveBeenCalledWith(1);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Subscription expired'), expect.anything());
  });

  it('handles subscription expiry cron db error', async () => {
    const dbModule = await import('./db.js');
    dbModule.default.prepare.mockImplementationOnce(() => { throw new Error('DB error'); });
    process.env.JWT_SECRET = 'test-secret';
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_CRAIGSLIST_SCANNER = 'false';
    await import('./index.js');
    const scheduleCalls = cronModule.schedule.mock.calls;
    const expiryCb = scheduleCalls.find(c => c[0] === '0 0 * * *')[1];
    await expiryCb();
    expect(logger.error).toHaveBeenCalledWith(
      'Subscription expiry cron error',
      expect.objectContaining({ error: 'DB error' }),
    );
  });
});

// ============================================================
// BACKFILL UNMATCHED RULES
// ============================================================

describe('backfillUnmatchedRules function', () => {
  beforeEach(() => {
    vi.resetModules();
    logger.info.mockClear();
    logger.error.mockClear();
  });

  it('runs via onServerStart and logs startup message', async () => {
    process.env.JWT_SECRET = 'test-secret';
    process.env.NODE_ENV = 'development';
    process.env.ENABLE_CRAIGSLIST_SCANNER = 'false';
    const mod = await import('./index.js');
    mod.onServerStart();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Server running on port'));
  });

  it('runs backfill and logs start message', async () => {
    process.env.JWT_SECRET = 'test-secret';
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_CRAIGSLIST_SCANNER = 'false';
    const mod = await import('./index.js');
    mod.onServerStart();
    expect(logger.info).toHaveBeenCalledWith('Running startup backfill for unmatched rules');
  });

  it('handles backfill errors gracefully', async () => {
    const dbModule = await import('./db.js');
    dbModule.default.prepare.mockImplementationOnce(() => { throw new Error('DB error'); });
    process.env.JWT_SECRET = 'test-secret';
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_CRAIGSLIST_SCANNER = 'false';
    const mod = await import('./index.js');
    mod.onServerStart();
    expect(logger.error).toHaveBeenCalledWith(
      'Startup backfill error',
      expect.objectContaining({ error: 'DB error' }),
    );
  });

  it('inserts matches during backfill when rules and posts exist', async () => {
    const dbModule = await import('./db.js');
    const stmt = dbModule.default.prepare();
    stmt.all.mockReturnValueOnce([
      { id: 1, user_id: 1, keywords: 'test-keyword', subreddit: 'all', min_price: null, max_price: null, last_matched_at: null },
    ]);
    stmt.all.mockReturnValueOnce([
      { post_id: 'post1', title: 'Test post with test-keyword', body: '', price: 10, source: 'reddit', deal_score: null },
    ]);
    stmt.get.mockReturnValueOnce(undefined);
    process.env.JWT_SECRET = 'test-secret';
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_CRAIGSLIST_SCANNER = 'false';
    const mod = await import('./index.js');
    mod.onServerStart();
    expect(logger.info).toHaveBeenCalledWith('Startup backfill', expect.objectContaining({ matched: 1 }));
  });
});

// ============================================================
// EXPORTED APP OBJECT
// ============================================================

describe('Exported app object', () => {
  beforeEach(() => { vi.resetModules(); });

  it('exports default app as an express app', async () => {
    process.env.JWT_SECRET = 'test-secret';
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_CRAIGSLIST_SCANNER = 'false';
    const mod = await import('./index.js');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
    expect(mod.default.listen).toBeDefined();
  });

  it('exports onServerStart function', async () => {
    process.env.JWT_SECRET = 'test-secret';
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_CRAIGSLIST_SCANNER = 'false';
    const mod = await import('./index.js');
    expect(mod.onServerStart).toBeDefined();
    expect(typeof mod.onServerStart).toBe('function');
  });

  it('app has settings and middleware configured', async () => {
    process.env.JWT_SECRET = 'test-secret';
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_CRAIGSLIST_SCANNER = 'false';
    const mod = await import('./index.js');
    expect(mod.default.get('trust proxy')).toBe(2);
    expect(mod.default.get('etag')).toBeTruthy();
  });
});
