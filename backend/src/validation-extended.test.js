import { describe, it, expect, vi } from 'vitest';

const {
  registerSchema, loginSchema, createAlertRuleSchema, updateAlertRuleSchema,
  createSavedDealSchema, updateSavedDealSchema, searchQuerySchema,
  webhookPostSchema, forgotPasswordSchema, resetPasswordSchema,
} = await import('./validation.js');

const knownValidEmails = ['a@b.com', 'user.name+tag@domain.com', 'test@example.com', '123@456.com', 'test-user@test.com', 'user_name@test.com', 'test@test.co.uk', 'name@domain.io', 'email@domain.dev', 'admin@company.com'];
const knownInvalidEmails = ['', 'notanemail', '@test.com', 'test@', 'test@.com', 'test@com', 'a@b', '  spaced@test.com', 'test@ test.com'];

describe('registerSchema extended', () => {
  for (const email of knownValidEmails) {
    it(`accepts valid registration email: ${email}`, () => {
      expect(registerSchema.safeParse({ email, password: 'Str0ng!12' }).success).toBe(true);
    });
  }
  for (const email of knownInvalidEmails) {
    it(`rejects invalid email: ${email || '(empty)'}`, () => {
      expect(registerSchema.safeParse({ email: email || 'x', password: 'Str0ng!12' }).success).toBe(false);
    });
  }
  const validPasswords = ['Abcdef12!', 'LongPassword123!', '12345678!a', 'short1A!', 'abcdefgh1!A', 'Mix3dC4se!', 'Symbols!@#$%^&*()_+a1', 'Spaces 123!'];
  const invalidPasswords = ['short', '1234567', 'x'.repeat(129), '', '      '];
  for (const pw of validPasswords) {
    it(`accepts valid password: ${pw.substring(0, 10)}...`, () => {
      expect(registerSchema.safeParse({ email: 'a@b.com', password: pw }).success).toBe(true);
    });
  }
  for (const pw of invalidPasswords) {
    it(`rejects invalid password (${pw.substring(0, 8)}...)`, () => {
      expect(registerSchema.safeParse({ email: 'a@b.com', password: pw }).success).toBe(false);
    });
  }
  it('rejects null password', () => expect(registerSchema.safeParse({ email: 'a@b.com', password: null }).success).toBe(false));
  it('rejects number password', () => expect(registerSchema.safeParse({ email: 'a@b.com', password: 12345678 }).success).toBe(false));
  it('rejects null email', () => expect(registerSchema.safeParse({ email: null, password: 'Str0ng!12' }).success).toBe(false));
  it('rejects number email', () => expect(registerSchema.safeParse({ email: 123, password: 'Str0ng!12' }).success).toBe(false));
});

describe('loginSchema extended', () => {
  for (const email of knownValidEmails.slice(0, 6)) {
    it(`accepts login with email: ${email}`, () => {
      expect(loginSchema.safeParse({ email, password: 'Str0ng!12' }).success).toBe(true);
    });
  }
  for (const email of knownInvalidEmails.slice(0, 6)) {
    it(`rejects login invalid email: ${email || '(empty)'}`, () => {
      expect(loginSchema.safeParse({ email: email || 'x', password: 'Str0ng!12' }).success).toBe(false);
    });
  }
  it('rejects null email', () => expect(loginSchema.safeParse({ email: null, password: 'Str0ng!12' }).success).toBe(false));
  it('rejects null password', () => expect(loginSchema.safeParse({ email: 'a@b.com', password: null }).success).toBe(false));
  it('rejects boolean password', () => expect(loginSchema.safeParse({ email: 'a@b.com', password: true }).success).toBe(false));
});

describe('createAlertRuleSchema extended', () => {
  const validKeywords = ['test', 'a', 'x'.repeat(500), 'keyboard, mouse', 'gaming chair', 'RTX 3080', 'mechanical keyboard 60%', 'DDR5 RAM 32GB', 'GPU + CPU combo'];
  const invalidKeywords = ['', 'x'.repeat(501), null, undefined, 123, [], {}];
  for (const kw of validKeywords) {
    it(`accepts keywords: ${typeof kw === 'string' ? kw.substring(0, 15) : 'type'}`, () => {
      expect(createAlertRuleSchema.safeParse({ keywords: kw, notify_target: 'a@b.com' }).success).toBe(true);
    });
  }
  for (const kw of invalidKeywords) {
    it(`rejects invalid keywords: ${kw === '' ? '(empty)' : typeof kw}`, () => {
      const result = createAlertRuleSchema.safeParse({ keywords: kw, notify_target: 'a@b.com' });
      expect(result.success).toBe(false);
    });
  }
  const validTargets = ['test@example.com', 'https://discord.gg/webhook', 'https://hooks.slack.com/xxx', 'bot123::chat456', 'mytopic', 'userkey::apitoken', 'https://example.com/webhook'];
  const invalidTargets = ['', 'x'.repeat(501), null, undefined, 123];
  for (const t of validTargets) {
    it(`accepts notify_target: ${t.substring(0, 15)}...`, () => {
      expect(createAlertRuleSchema.safeParse({ keywords: 'test', notify_target: t }).success).toBe(true);
    });
  }
  for (const t of invalidTargets) {
    it(`rejects invalid notify_target: ${t === '' ? '(empty)' : typeof t}`, () => {
      expect(createAlertRuleSchema.safeParse({ keywords: 'test', notify_target: t || '' }).success).toBe(false);
    });
  }
  const validPrices = [0, 1, 10, 50, 100, 999.99, 10000, null];
  const invalidPrices = [-1, -0.01, -100];
  for (const p of validPrices) {
    it(`accepts min_price: ${p}`, () => {
      expect(createAlertRuleSchema.safeParse({ keywords: 'test', notify_target: 'a@b.com', min_price: p ?? undefined }).success).toBe(true);
    });
  }
  for (const p of invalidPrices) {
    it(`rejects negative min_price: ${p}`, () => {
      expect(createAlertRuleSchema.safeParse({ keywords: 'test', notify_target: 'a@b.com', min_price: p }).success).toBe(false);
    });
  }
  const validSubreddits = ['mechmarket', 'hardwareswap', 'all', 'a', 'x'.repeat(100), 'test_sub'];
  const invalidSubreddits = ['x'.repeat(101), 123, true];
  for (const s of validSubreddits) {
    it(`accepts subreddit: ${s.substring(0, 10)}...`, () => {
      expect(createAlertRuleSchema.safeParse({ keywords: 'test', notify_target: 'a@b.com', subreddit: s }).success).toBe(true);
    });
  }
  for (const s of invalidSubreddits) {
    it(`rejects invalid subreddit: ${typeof s === 'string' ? '(too long)' : typeof s}`, () => {
      const result = createAlertRuleSchema.safeParse({ keywords: 'test', notify_target: 'a@b.com', subreddit: s });
      expect(result.success).toBe(false);
    });
  }
  it('accepts empty string subreddit (stays empty string)', () => {
    const r = createAlertRuleSchema.safeParse({ keywords: 'test', notify_target: 'a@b.com', subreddit: '' });
    expect(r.success).toBe(true);
    expect(r.data.subreddit).toBe('');
  });
  const validNotifyTypes = ['email', 'discord', 'telegram', 'slack', 'ntfy', 'pushover'];
  const invalidNotifyTypes = ['sms', 'whatsapp', '', 'EMAIL', 'Discord', 'push', 'signal'];
  for (const t of validNotifyTypes) {
    it(`accepts notify_type: ${t}`, () => {
      expect(createAlertRuleSchema.safeParse({ keywords: 'test', notify_target: 'x', notify_type: t }).success).toBe(true);
    });
  }
  for (const t of invalidNotifyTypes) {
    it(`rejects invalid notify_type: ${t}`, () => {
      expect(createAlertRuleSchema.safeParse({ keywords: 'test', notify_target: 'x', notify_type: t }).success).toBe(false);
    });
  }
  it('defaults subreddit to mechmarket', () => {
    const r = createAlertRuleSchema.safeParse({ keywords: 'test', notify_target: 'a@b.com' });
    expect(r.data.subreddit).toBe('mechmarket');
  });
  it('defaults notify_type to email', () => {
    const r = createAlertRuleSchema.safeParse({ keywords: 'test', notify_target: 'a@b.com' });
    expect(r.data.notify_type).toBe('email');
  });
  it('trims keywords', () => {
    const r = createAlertRuleSchema.safeParse({ keywords: '  test  ', notify_target: 'a@b.com' });
    expect(r.data.keywords).toBe('test');
  });
  it('accepts min_score', () => expect(createAlertRuleSchema.safeParse({ keywords: 'test', notify_target: 'a@b.com', min_score: 50 }).success).toBe(true));
  it('rejects min_score > 100', () => expect(createAlertRuleSchema.safeParse({ keywords: 'test', notify_target: 'a@b.com', min_score: 101 }).success).toBe(false));
  it('rejects min_score < 0', () => expect(createAlertRuleSchema.safeParse({ keywords: 'test', notify_target: 'a@b.com', min_score: -1 }).success).toBe(false));
  it('accepts scan_interval', () => expect(createAlertRuleSchema.safeParse({ keywords: 'test', notify_target: 'a@b.com', scan_interval: 30 }).success).toBe(true));
  it('rejects scan_interval > 1440', () => expect(createAlertRuleSchema.safeParse({ keywords: 'test', notify_target: 'a@b.com', scan_interval: 1500 }).success).toBe(false));
  it('rejects scan_interval < 1', () => expect(createAlertRuleSchema.safeParse({ keywords: 'test', notify_target: 'a@b.com', scan_interval: 0 }).success).toBe(false));
  it('rejects decimal scan_interval', () => expect(createAlertRuleSchema.safeParse({ keywords: 'test', notify_target: 'a@b.com', scan_interval: 1.5 }).success).toBe(false));
  it('accepts min_price = 0', () => expect(createAlertRuleSchema.safeParse({ keywords: 'test', notify_target: 'a@b.com', min_price: 0 }).success).toBe(true));
  it('accepts max_price = 0', () => expect(createAlertRuleSchema.safeParse({ keywords: 'test', notify_target: 'a@b.com', max_price: 0 }).success).toBe(true));
  it('accepts decimal prices', () => expect(createAlertRuleSchema.safeParse({ keywords: 'test', notify_target: 'a@b.com', min_price: 10.50, max_price: 100.99 }).success).toBe(true));
});

describe('updateAlertRuleSchema extended', () => {
  it('is_active = 0', () => expect(updateAlertRuleSchema.safeParse({ is_active: 0 }).success).toBe(true));
  it('is_active = 1', () => expect(updateAlertRuleSchema.safeParse({ is_active: 1 }).success).toBe(true));
  it('rejects is_active = 2', () => expect(updateAlertRuleSchema.safeParse({ is_active: 2 }).success).toBe(false));
  it('rejects is_active = -1', () => expect(updateAlertRuleSchema.safeParse({ is_active: -1 }).success).toBe(false));
  it('rejects is_active = true', () => expect(updateAlertRuleSchema.safeParse({ is_active: true }).success).toBe(false));
  it('rejects invalid notify_type', () => expect(updateAlertRuleSchema.safeParse({ notify_type: 'pigeon' }).success).toBe(false));
  it('accepts update subreddit', () => expect(updateAlertRuleSchema.safeParse({ subreddit: 'hardwareswap' }).success).toBe(true));
  it('accepts update notify_type', () => expect(updateAlertRuleSchema.safeParse({ notify_type: 'discord' }).success).toBe(true));
  it('accepts update target', () => expect(updateAlertRuleSchema.safeParse({ notify_target: 'new@target.com' }).success).toBe(true));
  it('accepts update min_price', () => expect(updateAlertRuleSchema.safeParse({ min_price: 10 }).success).toBe(true));
  it('accepts update all fields', () => {
    expect(updateAlertRuleSchema.safeParse({ keywords: 'new', subreddit: 'hw', min_price: 10, max_price: 100, min_score: 50, scan_interval: 30, notify_type: 'discord', notify_target: 'url', is_active: 0 }).success).toBe(true);
  });
});

describe('createSavedDealSchema extended', () => {
  const validIds = ['abc123', 'x'.repeat(200), 't3_1u992wf', 'cl_abc123def456', 'post-id-with-dashes', '1234567890', 'ABCXYZ'];
  const invalidIds = ['', 'x'.repeat(201), null, undefined, 123, []];
  for (const id of validIds) {
    it(`accepts post_id: ${id.substring(0, 10)}...`, () => expect(createSavedDealSchema.safeParse({ post_id: id }).success).toBe(true));
  }
  for (const id of invalidIds) {
    it(`rejects invalid post_id: ${id === '' ? '(empty)' : typeof id}`, () => {
      expect(createSavedDealSchema.safeParse({ post_id: id || '' }).success).toBe(false);
    });
  }
  it('rejects notes > 1000', () => expect(createSavedDealSchema.safeParse({ post_id: 'abc', notes: 'x'.repeat(1001) }).success).toBe(false));
});

describe('webhookPostSchema extended', () => {
  it('accepts optional permalink', () => expect(webhookPostSchema.safeParse({ id: '123', title: 'Test', permalink: '/r/test/123/' }).success).toBe(true));
  it('rejects permalink > 1000', () => expect(webhookPostSchema.safeParse({ id: '123', title: 'Test', permalink: 'x'.repeat(1001) }).success).toBe(false));
  it('accepts optional subreddit', () => expect(webhookPostSchema.safeParse({ id: '123', title: 'Test', subreddit: 'mechmarket' }).success).toBe(true));
  it('accepts number price', () => { const r = webhookPostSchema.safeParse({ id: '123', title: 'Test', price: 150 }); expect(r.success).toBe(true); });
  it('accepts null price', () => { const r = webhookPostSchema.safeParse({ id: '123', title: 'Test', price: null }); expect(r.success).toBe(true); expect(r.data.price).toBeNull(); });
});

describe('resetPasswordSchema extended', () => {
  it('rejects null token', () => expect(resetPasswordSchema.safeParse({ token: null, password: 'NewStr0ng!1' }).success).toBe(false));
  it('rejects number token', () => expect(resetPasswordSchema.safeParse({ token: 123, password: 'NewStr0ng!1' }).success).toBe(false));
  it('rejects empty password', () => expect(resetPasswordSchema.safeParse({ token: 'abc', password: '' }).success).toBe(false));
  it('rejects null password', () => expect(resetPasswordSchema.safeParse({ token: 'abc', password: null }).success).toBe(false));
});

describe('validate function', () => {
  it('returns middleware that validates valid data', async () => {
    const { validate } = await import('./validation.js');
    const { z } = await import('zod');
    const schema = z.object({ name: z.string() });
    const middleware = validate(schema);
    const req = { body: { name: 'test' } };
    const res = { status: vi.fn(() => res), json: vi.fn(() => res) };
    const next = vi.fn();
    await middleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.validated).toEqual({ name: 'test' });
  });
  it('returns 400 on invalid data', async () => {
    const { validate } = await import('./validation.js');
    const { z } = await import('zod');
    const schema = z.object({ name: z.string() });
    const middleware = validate(schema);
    const req = { body: {} };
    const res = { status: vi.fn(() => res), json: vi.fn(() => res) };
    const next = vi.fn();
    await middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Validation failed' }));
  });
  it('returns field error details', async () => {
    const { validate } = await import('./validation.js');
    const { z } = await import('zod');
    const schema = z.object({ name: z.string(), age: z.number() });
    const middleware = validate(schema);
    const req = { body: { name: 123 } };
    const res = { status: vi.fn(() => res), json: vi.fn(() => res) };
    await middleware(req, res, () => {});
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ details: expect.any(Object) }));
  });
  it('handles null body', async () => {
    const { validate } = await import('./validation.js');
    const { z } = await import('zod');
    const schema = z.object({ name: z.string() });
    const middleware = validate(schema);
    const req = { body: null };
    const res = { status: vi.fn(() => res), json: vi.fn(() => res) };
    await middleware(req, res, () => {});
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
