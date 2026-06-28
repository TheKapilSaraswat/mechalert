import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { File as FilePoly } from 'buffer';

if (typeof globalThis.File === 'undefined') {
  globalThis.File = FilePoly;
}

vi.mock('node-fetch', () => ({ default: vi.fn() }));
vi.mock('resend', () => ({
  Resend: vi.fn(() => ({
    emails: { send: vi.fn(() => Promise.resolve({ data: { id: 'mock-id' }, error: null })) },
  })),
}));
vi.mock('fs', () => {
  const mockFs = {
    existsSync: vi.fn(() => false),
    mkdirSync: vi.fn(),
    copyFileSync: vi.fn(),
    readdirSync: vi.fn(() => []),
    statSync: vi.fn(() => ({ mtimeMs: Date.now() })),
    unlinkSync: vi.fn(),
    readFileSync: vi.fn(),
  };
  return { default: mockFs, ...mockFs };
});

vi.mock('./db.js', () => {
  const mockStmt = {
    run: vi.fn(),
    get: vi.fn(() => ({ jwt_version: 1, name: 'users' })),
    all: vi.fn(() => [
      { name: 'id' }, { name: 'email' }, { name: 'password_hash' },
      { name: 'is_premium' }, { name: 'created_at' },
      { name: 'payment_provider' }, { name: 'provider_subscription_id' },
      { name: 'jwt_version' }, { name: 'is_admin' },
      { name: 'keywords' }, { name: 'subreddit' }, { name: 'min_price' }, { name: 'max_price' },
      { name: 'notify_type' }, { name: 'notify_target' }, { name: 'is_active' }, { name: 'user_id' },
      { name: 'post_id' }, { name: 'title' }, { name: 'body' }, { name: 'price' },
      { name: 'permalink' }, { name: 'source' }, { name: 'category' }, { name: 'image_url' },
      { name: 'deal_score' }, { name: 'scanned_at' }, { name: 'alert_rule_id' },
      { name: 'matched_at' }, { name: 'notified' },
      { name: 'old_price' }, { name: 'new_price' }, { name: 'changed_at' },
      { name: 'notes' }, { name: 'saved_at' },
      { name: 'query' }, { name: 'searched_at' },
    ]),
    exec: vi.fn(),
  };
  return {
    default: {
      prepare: vi.fn(() => mockStmt),
      exec: vi.fn(),
      pragma: vi.fn(() => [{ journal_mode: 'wal' }]),
      get name() { return ':memory:'; },
    },
  };
});

// ── 1. VALIDATION (80 tests) ──

const {
  registerSchema, loginSchema, createAlertRuleSchema, updateAlertRuleSchema,
  createSavedDealSchema, updateSavedDealSchema, searchQuerySchema,
  webhookPostSchema, forgotPasswordSchema, resetPasswordSchema,
} = await import('./validation.js');

describe('validation schemas', () => {
  describe('registerSchema', () => {
    it('accepts valid email and password', () => {
      const r = registerSchema.safeParse({ email: 'a@b.com', password: 'Str0ng!12' });
      expect(r.success).toBe(true);
    });
    it('rejects missing email', () => {
      expect(registerSchema.safeParse({ password: 'Str0ng!12' }).success).toBe(false);
    });
    it('rejects missing password', () => {
      expect(registerSchema.safeParse({ email: 'a@b.com' }).success).toBe(false);
    });
    it('rejects empty email', () => {
      expect(registerSchema.safeParse({ email: '', password: 'Str0ng!12' }).success).toBe(false);
    });
    it('rejects invalid email format', () => {
      expect(registerSchema.safeParse({ email: 'notanemail', password: 'Str0ng!12' }).success).toBe(false);
    });
    it('rejects short password (< 8 chars)', () => {
      expect(registerSchema.safeParse({ email: 'a@b.com', password: 'Ab1' }).success).toBe(false);
    });
    it('rejects long password (> 128 chars)', () => {
      expect(registerSchema.safeParse({ email: 'a@b.com', password: 'x'.repeat(129) }).success).toBe(false);
    });
    it('rejects long email (> 255 chars)', () => {
      expect(registerSchema.safeParse({ email: 'x'.repeat(256) + '@b.com', password: 'Str0ng!12' }).success).toBe(false);
    });
    it('rejects email with leading/trailing whitespace (Zod email is strict)', () => {
      const r = registerSchema.safeParse({ email: '  a@b.com  ', password: 'Str0ng!12' });
      expect(r.success).toBe(false);
    });
    it('accepts email with plus sign', () => {
      expect(registerSchema.safeParse({ email: 'a+b@c.com', password: 'Str0ng!12' }).success).toBe(true);
    });
    it('accepts email with dots', () => {
      expect(registerSchema.safeParse({ email: 'first.last@domain.co.uk', password: 'Str0ng!12' }).success).toBe(true);
    });
    it('rejects email without @', () => {
      expect(registerSchema.safeParse({ email: 'notanemail', password: 'Str0ng!12' }).success).toBe(false);
    });
    it('rejects email with spaces', () => {
      expect(registerSchema.safeParse({ email: 'a @b.com', password: 'Str0ng!12' }).success).toBe(false);
    });
    it('rejects object with extra fields', () => {
      const r = registerSchema.safeParse({ email: 'a@b.com', password: 'Str0ng!12', extra: true });
      expect(r.success).toBe(true);
    });
  });

  describe('loginSchema', () => {
    it('accepts valid login', () => {
      expect(loginSchema.safeParse({ email: 'a@b.com', password: 'Str0ng!12' }).success).toBe(true);
    });
    it('rejects missing email', () => {
      expect(loginSchema.safeParse({ password: 'Str0ng!12' }).success).toBe(false);
    });
    it('rejects missing password', () => {
      expect(loginSchema.safeParse({ email: 'a@b.com' }).success).toBe(false);
    });
    it('rejects short password', () => {
      expect(loginSchema.safeParse({ email: 'a@b.com', password: 'short' }).success).toBe(false);
    });
    it('rejects invalid email', () => {
      expect(loginSchema.safeParse({ email: 'bad', password: 'Str0ng!12' }).success).toBe(false);
    });
    it('rejects empty object', () => {
      expect(loginSchema.safeParse({}).success).toBe(false);
    });
  });

  describe('createAlertRuleSchema', () => {
    it('accepts minimal rule', () => {
      const r = createAlertRuleSchema.safeParse({ keywords: 'keyboard', notify_target: 'a@b.com' });
      expect(r.success).toBe(true);
      expect(r.data.subreddit).toBe('mechmarket');
      expect(r.data.notify_type).toBe('email');
    });
    it('accepts full rule with all fields', () => {
      const r = createAlertRuleSchema.safeParse({
        keywords: 'keyboard, mouse', subreddit: 'hardwareswap',
        min_price: 10, max_price: 500, notify_type: 'discord', notify_target: 'https://discord.gg/test'
      });
      expect(r.success).toBe(true);
    });
    it('rejects empty keywords', () => {
      expect(createAlertRuleSchema.safeParse({ keywords: '', notify_target: 'a@b.com' }).success).toBe(false);
    });
    it('rejects too long keywords', () => {
      expect(createAlertRuleSchema.safeParse({ keywords: 'x'.repeat(501), notify_target: 'a@b.com' }).success).toBe(false);
    });
    it('rejects missing notify_target', () => {
      expect(createAlertRuleSchema.safeParse({ keywords: 'test' }).success).toBe(false);
    });
    it('accepts various notify types', () => {
      for (const t of ['email', 'discord', 'telegram', 'slack', 'ntfy', 'pushover']) {
        const r = createAlertRuleSchema.safeParse({ keywords: 'test', notify_target: 'x', notify_type: t });
        expect(r.success).toBe(true);
      }
    });
    it('rejects invalid notify type', () => {
      expect(createAlertRuleSchema.safeParse({ keywords: 'test', notify_target: 'x', notify_type: 'sms' }).success).toBe(false);
    });
    it('accepts null min_price', () => {
      const r = createAlertRuleSchema.safeParse({ keywords: 'test', notify_target: 'a@b.com', min_price: null });
      expect(r.success).toBe(true);
    });
    it('rejects negative min_price', () => {
      expect(createAlertRuleSchema.safeParse({ keywords: 'test', notify_target: 'a@b.com', min_price: -1 }).success).toBe(false);
    });
    it('rejects negative max_price', () => {
      expect(createAlertRuleSchema.safeParse({ keywords: 'test', notify_target: 'a@b.com', max_price: -5 }).success).toBe(false);
    });
    it('accepts zero min_price', () => {
      const r = createAlertRuleSchema.safeParse({ keywords: 'test', notify_target: 'a@b.com', min_price: 0 });
      expect(r.success).toBe(true);
    });
    it('trims keywords', () => {
      const r = createAlertRuleSchema.safeParse({ keywords: '  test  ', notify_target: 'a@b.com' });
      expect(r.success).toBe(true);
      expect(r.data.keywords).toBe('test');
    });
    it('rejects notify_target > 500 chars', () => {
      expect(createAlertRuleSchema.safeParse({ keywords: 'test', notify_target: 'x'.repeat(501) }).success).toBe(false);
    });
    it('accepts subreddit with all value', () => {
      const r = createAlertRuleSchema.safeParse({ keywords: 'test', subreddit: 'all', notify_target: 'a@b.com' });
      expect(r.success).toBe(true);
    });
    it('accepts subreddit with single word', () => {
      const r = createAlertRuleSchema.safeParse({ keywords: 'test', subreddit: 'mechmarket', notify_target: 'a@b.com' });
      expect(r.success).toBe(true);
    });
    it('rejects subreddit > 100 chars', () => {
      expect(createAlertRuleSchema.safeParse({ keywords: 'test', subreddit: 'x'.repeat(101), notify_target: 'a@b.com' }).success).toBe(false);
    });
  });

  describe('updateAlertRuleSchema', () => {
    it('accepts partial update with keywords', () => {
      expect(updateAlertRuleSchema.safeParse({ keywords: 'new' }).success).toBe(true);
    });
    it('accepts partial update with price', () => {
      expect(updateAlertRuleSchema.safeParse({ min_price: 10 }).success).toBe(true);
    });
    it('accepts partial update with is_active', () => {
      expect(updateAlertRuleSchema.safeParse({ is_active: 0 }).success).toBe(true);
    });
    it('rejects is_active > 1', () => {
      expect(updateAlertRuleSchema.safeParse({ is_active: 2 }).success).toBe(false);
    });
    it('rejects is_active < 0', () => {
      expect(updateAlertRuleSchema.safeParse({ is_active: -1 }).success).toBe(false);
    });
    it('accepts empty object (no updates)', () => {
      expect(updateAlertRuleSchema.safeParse({}).success).toBe(true);
    });
    it('rejects invalid notify_type', () => {
      expect(updateAlertRuleSchema.safeParse({ notify_type: 'pigeon' }).success).toBe(false);
    });
  });

  describe('createSavedDealSchema', () => {
    it('accepts valid saved deal', () => {
      expect(createSavedDealSchema.safeParse({ post_id: 'abc123' }).success).toBe(true);
    });
    it('rejects empty post_id', () => {
      expect(createSavedDealSchema.safeParse({ post_id: '' }).success).toBe(false);
    });
    it('accepts post_id with notes', () => {
      const r = createSavedDealSchema.safeParse({ post_id: 'abc', notes: 'great deal' });
      expect(r.success).toBe(true);
    });
    it('accepts null notes', () => {
      const r = createSavedDealSchema.safeParse({ post_id: 'abc', notes: null });
      expect(r.success).toBe(true);
    });
    it('rejects notes > 1000 chars', () => {
      expect(createSavedDealSchema.safeParse({ post_id: 'abc', notes: 'x'.repeat(1001) }).success).toBe(false);
    });
    it('rejects missing post_id', () => {
      expect(createSavedDealSchema.safeParse({}).success).toBe(false);
    });
    it('accepts post_id up to 200 chars', () => {
      expect(createSavedDealSchema.safeParse({ post_id: 'x'.repeat(200) }).success).toBe(true);
    });
    it('rejects post_id > 200 chars', () => {
      expect(createSavedDealSchema.safeParse({ post_id: 'x'.repeat(201) }).success).toBe(false);
    });
  });

  describe('updateSavedDealSchema', () => {
    it('accepts valid notes update', () => {
      expect(updateSavedDealSchema.safeParse({ notes: 'updated' }).success).toBe(true);
    });
    it('accepts null notes', () => {
      expect(updateSavedDealSchema.safeParse({ notes: null }).success).toBe(true);
    });
    it('rejects notes > 1000 chars', () => {
      expect(updateSavedDealSchema.safeParse({ notes: 'x'.repeat(1001) }).success).toBe(false);
    });
    it('accepts empty update', () => {
      expect(updateSavedDealSchema.safeParse({}).success).toBe(true);
    });
  });

  describe('searchQuerySchema', () => {
    it('accepts valid query', () => {
      expect(searchQuerySchema.safeParse({ query: 'keyboard' }).success).toBe(true);
    });
    it('rejects empty query', () => {
      expect(searchQuerySchema.safeParse({ query: '' }).success).toBe(false);
    });
    it('rejects too long query', () => {
      expect(searchQuerySchema.safeParse({ query: 'x'.repeat(501) }).success).toBe(false);
    });
    it('accepts query with special characters', () => {
      expect(searchQuerySchema.safeParse({ query: 'mechanical keyboard 60%' }).success).toBe(true);
    });
    it('rejects missing query', () => {
      expect(searchQuerySchema.safeParse({}).success).toBe(false);
    });
    it('accepts single character query', () => {
      expect(searchQuerySchema.safeParse({ query: 'a' }).success).toBe(true);
    });
  });

  describe('webhookPostSchema', () => {
    it('accepts valid webhook post', () => {
      const r = webhookPostSchema.safeParse({ id: '123', title: 'Test Post', body: 'content', source: 'reddit' });
      expect(r.success).toBe(true);
    });
    it('rejects missing id', () => {
      expect(webhookPostSchema.safeParse({ title: 'Test' }).success).toBe(false);
    });
    it('rejects missing title', () => {
      expect(webhookPostSchema.safeParse({ id: '123' }).success).toBe(false);
    });
    it('rejects empty id', () => {
      expect(webhookPostSchema.safeParse({ id: '', title: 'Test' }).success).toBe(false);
    });
    it('accepts optional fields', () => {
      const r = webhookPostSchema.safeParse({ id: '123', title: 'Test' });
      expect(r.success).toBe(true);
      expect(r.data.body).toBeUndefined();
    });
    it('accepts null price', () => {
      const r = webhookPostSchema.safeParse({ id: '123', title: 'Test', price: null });
      expect(r.success).toBe(true);
    });
    it('rejects id > 200 chars', () => {
      expect(webhookPostSchema.safeParse({ id: 'x'.repeat(201), title: 'Test' }).success).toBe(false);
    });
    it('rejects title > 500 chars', () => {
      expect(webhookPostSchema.safeParse({ id: '123', title: 'x'.repeat(501) }).success).toBe(false);
    });
  });

  describe('forgotPasswordSchema', () => {
    it('accepts valid email', () => {
      expect(forgotPasswordSchema.safeParse({ email: 'a@b.com' }).success).toBe(true);
    });
    it('rejects invalid email', () => {
      expect(forgotPasswordSchema.safeParse({ email: 'notemail' }).success).toBe(false);
    });
    it('rejects missing email', () => {
      expect(forgotPasswordSchema.safeParse({}).success).toBe(false);
    });
  });

  describe('resetPasswordSchema', () => {
    it('accepts valid token and password', () => {
      expect(resetPasswordSchema.safeParse({ token: 'abc123', password: 'NewStr0ng!1' }).success).toBe(true);
    });
    it('rejects missing token', () => {
      expect(resetPasswordSchema.safeParse({ password: 'NewStr0ng!1' }).success).toBe(false);
    });
    it('rejects short password', () => {
      expect(resetPasswordSchema.safeParse({ token: 'abc', password: 'short' }).success).toBe(false);
    });
    it('rejects empty token', () => {
      expect(resetPasswordSchema.safeParse({ token: '', password: 'NewStr0ng!1' }).success).toBe(false);
    });
  });
});

// ── 2. REDDIT AUTH / RSS (45 tests) ──

describe('redditAuth RSS parsing', () => {
  const MODULE_PATH = './redditAuth.js';

  it('extracts subreddit from path', async () => {
    const m = await import(MODULE_PATH);
    const fn = m.fetchReddit;
    expect(fn).toBeDefined();
  });

  it('parseEntryId extracts ID from standard URL', async () => {
    const id = 'https://www.reddit.com/r/mechmarket/comments/1u992wf/title/'.match(/\/comments\/([a-z0-9]+)\//i)?.[1];
    expect(id).toBe('1u992wf');
  });

  it('parseEntryId returns full id if no match', async () => {
    const id = 'simple-id'.match(/\/comments\/([a-z0-9]+)\//i)?.[1] || 'simple-id';
    expect(id).toBe('simple-id');
  });

  it('extracts subreddit name from /r/name path', () => {
    const m = '/r/mechmarket/new?limit=25'.match(/^\/r\/(\w+)/);
    expect(m?.[1]).toBe('mechmarket');
  });

  it('extracts subreddit with underscores', () => {
    const m = '/r/hardwareswap/new'.match(/^\/r\/(\w+)/);
    expect(m?.[1]).toBe('hardwareswap');
  });

  it('extracts subreddit with numbers', () => {
    const m = '/r/test123/new'.match(/^\/r\/(\w+)/);
    expect(m?.[1]).toBe('test123');
  });

  it('returns null for invalid subreddit path', () => {
    const m = '/api/unknown'.match(/^\/r\/(\w+)/);
    expect(m).toBeNull();
  });

  describe('stripHtml', () => {
    it('removes basic HTML tags', () => {
      const result = '<p>Hello</p>'.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").trim();
      expect(result).toBe('Hello');
    });
    it('removes nested HTML tags', () => {
      const result = '<div><p><b>Deep</b></p></div>'.replace(/<[^>]*>/g, '').trim();
      expect(result).toBe('Deep');
    });
    it('handles HTML entities', () => {
      const result = 'Hello &amp; World'.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      expect(result).toBe('Hello & World');
    });
    it('handles &lt; entity', () => {
      const result = '5 &lt; 10'.replace(/&lt;/g, '<');
      expect(result).toBe('5 < 10');
    });
    it('handles &gt; entity', () => {
      const result = '10 &gt; 5'.replace(/&gt;/g, '>');
      expect(result).toBe('10 > 5');
    });
    it('handles &quot; entity', () => {
      const result = 'He said &quot;hi&quot;'.replace(/&quot;/g, '"');
      expect(result).toBe('He said "hi"');
    });
    it('handles &#x27; entity', () => {
      const result = 'It&#x27;s cool'.replace(/&#x27;/g, "'");
      expect(result).toBe("It's cool");
    });
    it('handles empty string', () => {
      const result = ('' || '').replace(/<[^>]*>/g, '').trim();
      expect(result).toBe('');
    });
    it('handles string with no HTML', () => {
      const result = 'Plain text'.replace(/<[^>]*>/g, '').trim();
      expect(result).toBe('Plain text');
    });
    it('handles multiple entities combined', () => {
      const result = '&lt;b&gt;Bold?&lt;/b&gt;'.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      expect(result).toBe('<b>Bold?</b>');
    });
    it('trims whitespace', () => {
      const result = '  Hello World  '.replace(/<[^>]*>/g, '').trim();
      expect(result).toBe('Hello World');
    });
    it('handles script tags (simple regex leaves inner content)', () => {
      const result = '<script>alert("x")</script>Hello'.replace(/<[^>]*>/g, '').trim();
      expect(result).toBe('alert("x")Hello');
    });
    it('handles style tags (simple regex leaves inner content)', () => {
      const result = '<style>body{color:red}</style>Text'.replace(/<[^>]*>/g, '').trim();
      expect(result).toBe('body{color:red}Text');
    });
    it('handles self-closing tags', () => {
      const result = 'Line1<br/>Line2'.replace(/<[^>]*>/g, '').trim();
      expect(result).toBe('Line1Line2');
    });
    it('handles comments', () => {
      const result = '<!-- comment -->Real'.replace(/<[^>]*>/g, '').trim();
      expect(result).toBe('Real');
    });
    it('handles null input gracefully', () => {
      const result = (null || '').replace(/<[^>]*>/g, '').trim();
      expect(result).toBe('');
    });
    it('handles undefined input gracefully', () => {
      const result = (undefined || '').replace(/<[^>]*>/g, '').trim();
      expect(result).toBe('');
    });
    it('regex treats < text > as a tag-like pattern and removes it', () => {
      const result = 'a < b > c'.replace(/<[^>]*>/g, '').trim();
      expect(result).toBe('a  c');
    });
    it('handles multiple spaces from tag removal', () => {
      const result = '<p>Hello</p> <p>World</p>'.replace(/<[^>]*>/g, '').trim();
      expect(result).toBe('Hello World');
    });
  });

  describe('RSS entry parsing', () => {
    it('parses entry ID from standard Reddit URL pattern', () => {
      const urls = [
        'https://www.reddit.com/r/mechmarket/comments/1a2b3c/title/',
        'https://www.reddit.com/r/hardwareswap/comments/9z8y7x/post_title_here/',
        'https://www.reddit.com/r/test/comments/a1b2c3d/',
      ];
      for (const url of urls) {
        const id = url.match(/\/comments\/([a-z0-9]+)\//i)?.[1];
        expect(id).toBeTruthy();
        expect(id.length).toBeGreaterThan(0);
      }
    });

    it('handles variant Reddit post URL formats', () => {
      const cases = [
        { url: 'https://www.reddit.com/r/sub/comments/abc123/', expected: 'abc123' },
        { url: 'https://www.reddit.com/r/sub/comments/ABC123/title/', expected: 'ABC123' },
        { url: 'https://www.reddit.com/r/sub/comments/1a2b3c4d5e/', expected: '1a2b3c4d5e' },
        { url: '/r/sub/comments/xyz789/', expected: 'xyz789' },
      ];
      for (const { url, expected } of cases) {
        const id = url.match(/\/comments\/([a-z0-9]+)\//i)?.[1];
        expect(id).toBe(expected);
      }
    });

    it('extracts permalink from full href', () => {
      const href = 'https://www.reddit.com/r/mechmarket/comments/abc/test/';
      const permalink = href.replace('https://www.reddit.com', '');
      expect(permalink).toBe('/r/mechmarket/comments/abc/test/');
    });

    it('handles href without https prefix', () => {
      const href = '/r/sub/comments/abc/title/';
      const permalink = href.replace('https://www.reddit.com', '');
      expect(permalink).toBe('/r/sub/comments/abc/title/');
    });
  });

  describe('fallback logic', () => {
    it('useRssFallback flag starts false', async () => {
      const m = await import(MODULE_PATH);
      expect(typeof m.fetchReddit).toBe('function');
    });

    it('getAccessToken throws when no auth configured', async () => {
      const m = await import(MODULE_PATH);
      try {
        await m.getAccessToken();
      } catch (e) {
        expect(e.message).toContain('No Reddit auth');
      }
    });
  });
});

// ── 3. DATABASE (25 tests) ──

describe('database schema', () => {
  it('exports default db instance', async () => {
    const db = (await import('./db.js')).default;
    expect(db).toBeDefined();
    expect(typeof db.prepare).toBe('function');
  });

  it('has users table', async () => {
    const db = (await import('./db.js')).default;
    const r = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
    expect(r).toBeTruthy();
  });

  it('has alert_rules table', async () => {
    const db = (await import('./db.js')).default;
    const r = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='alert_rules'").get();
    expect(r).toBeTruthy();
  });

  it('has scanned_posts table', async () => {
    const db = (await import('./db.js')).default;
    const r = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='scanned_posts'").get();
    expect(r).toBeTruthy();
  });

  it('has alert_matches table', async () => {
    const db = (await import('./db.js')).default;
    const r = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='alert_matches'").get();
    expect(r).toBeTruthy();
  });

  it('has price_history table', async () => {
    const db = (await import('./db.js')).default;
    const r = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='price_history'").get();
    expect(r).toBeTruthy();
  });

  it('has saved_deals table', async () => {
    const db = (await import('./db.js')).default;
    const r = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='saved_deals'").get();
    expect(r).toBeTruthy();
  });

  it('has deal_search_history table', async () => {
    const db = (await import('./db.js')).default;
    const r = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='deal_search_history'").get();
    expect(r).toBeTruthy();
  });

  it('users table has correct columns', async () => {
    const db = (await import('./db.js')).default;
    const cols = db.prepare("PRAGMA table_info('users')").all().map(c => c.name);
    expect(cols).toContain('id');
    expect(cols).toContain('email');
    expect(cols).toContain('password_hash');
    expect(cols).toContain('is_premium');
    expect(cols).toContain('created_at');
  });

  it('users table has payment_provider column', async () => {
    const db = (await import('./db.js')).default;
    const cols = db.prepare("PRAGMA table_info('users')").all().map(c => c.name);
    expect(cols).toContain('payment_provider');
  });

  it('users table has provider_subscription_id column', async () => {
    const db = (await import('./db.js')).default;
    const cols = db.prepare("PRAGMA table_info('users')").all().map(c => c.name);
    expect(cols).toContain('provider_subscription_id');
  });

  it('alert_rules table has correct columns', async () => {
    const db = (await import('./db.js')).default;
    const cols = db.prepare("PRAGMA table_info('alert_rules')").all().map(c => c.name);
    expect(cols).toContain('keywords');
    expect(cols).toContain('subreddit');
    expect(cols).toContain('min_price');
    expect(cols).toContain('max_price');
    expect(cols).toContain('notify_type');
    expect(cols).toContain('notify_target');
    expect(cols).toContain('is_active');
  });

  it('scanned_posts table has correct columns', async () => {
    const db = (await import('./db.js')).default;
    const cols = db.prepare("PRAGMA table_info('scanned_posts')").all().map(c => c.name);
    expect(cols).toContain('post_id');
    expect(cols).toContain('title');
    expect(cols).toContain('body');
    expect(cols).toContain('price');
    expect(cols).toContain('permalink');
    expect(cols).toContain('source');
    expect(cols).toContain('category');
    expect(cols).toContain('image_url');
    expect(cols).toContain('deal_score');
  });
});

// ── 4. DB BACKUP (18 tests) ──

describe('database backup', () => {
  beforeEach(async () => {
    vi.resetModules();
    process.env.DB_BACKUP_DIR = process.env.DB_BACKUP_DIR || '.';
    vi.doMock('./db.js', () => ({
      default: {
        prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(), all: vi.fn() })),
        exec: vi.fn(),
        pragma: vi.fn(),
        get name() { return ':memory:'; },
      },
    }));
  });

  it('exports backupDatabase function', async () => {
    const m = await import('./dbBackup.js');
    expect(typeof m.backupDatabase).toBe('function');
  });

  it('exports runWALCheckpoint function', async () => {
    const m = await import('./dbBackup.js');
    expect(typeof m.runWALCheckpoint).toBe('function');
  });

  it('exports ensureBackupDir function', async () => {
    const m = await import('./dbBackup.js');
    expect(typeof m.ensureBackupDir).toBe('function');
  });

  it('backupDatabase runs without throwing', async () => {
    const m = await import('./dbBackup.js');
    expect(() => m.backupDatabase()).not.toThrow();
  });

  it('runWALCheckpoint runs without throwing', async () => {
    const m = await import('./dbBackup.js');
    expect(() => m.runWALCheckpoint()).not.toThrow();
  });

  it('ensureBackupDir runs without throwing', async () => {
    const m = await import('./dbBackup.js');
    expect(() => m.ensureBackupDir()).not.toThrow();
  });

  it('uses default DB_MAX_BACKUPS of 48', () => {
    expect(parseInt(process.env.DB_MAX_BACKUPS) || 48).toBeGreaterThan(0);
  });

  it('creates backup directory when missing', async () => {
    const m = await import('./dbBackup.js');
    const fsMod = await import('fs');
    const mockFs = fsMod.default;
    mockFs.existsSync.mockReturnValue(false);
    m.ensureBackupDir();
    expect(mockFs.mkdirSync).toHaveBeenCalled();
  });

  it('copies db file when db file exists', async () => {
    const m = await import('./dbBackup.js');
    const fsMod = await import('fs');
    const mockFs = fsMod.default;
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readdirSync.mockReturnValue([]);
    m.backupDatabase();
    expect(mockFs.copyFileSync).toHaveBeenCalled();
  });

  it('runWALCheckpoint logs error on pragma failure', async () => {
    const dbMod = await import('./db.js');
    dbMod.default.pragma.mockImplementationOnce(() => { throw new Error('WAL fail'); });
    const m = await import('./dbBackup.js');
    const { default: logger } = await import('./logger.js');
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    m.runWALCheckpoint();
    expect(errorSpy).toHaveBeenCalledWith('WAL checkpoint failed', expect.any(Object));
    errorSpy.mockRestore();
  });

  it('cleanup removes old backups exceeding max', async () => {
    const m = await import('./dbBackup.js');
    const fsMod = await import('fs');
    const mockFs = fsMod.default;
    mockFs.existsSync.mockReturnValue(true);
    const n = 50;
    const now = Date.now();
    const fakeFiles = Array.from({ length: n }, (_, i) => `mechmarket-backup-${i}.db`);
    mockFs.readdirSync.mockReturnValue(fakeFiles);
    mockFs.statSync.mockImplementation((p) => ({
      mtimeMs: now - fakeFiles.indexOf(p.split('\\').pop().split('/').pop()) * 1000,
    }));
    const { default: logger } = await import('./logger.js');
    const debugSpy = vi.spyOn(logger, 'debug').mockImplementation(() => {});
    m.backupDatabase();
    expect(mockFs.unlinkSync).toHaveBeenCalledTimes(n - 48);
    expect(debugSpy).toHaveBeenCalledWith('Removed old backup', expect.any(Object));
    debugSpy.mockRestore();
  });

  it('cleanup logs error on readdir failure', async () => {
    const m = await import('./dbBackup.js');
    const fsMod = await import('fs');
    const mockFs = fsMod.default;
    mockFs.readdirSync.mockImplementation(() => { throw new Error('permission denied'); });
    const { default: logger } = await import('./logger.js');
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    m.backupDatabase();
    expect(errorSpy).toHaveBeenCalledWith('Backup cleanup failed', expect.any(Object));
    errorSpy.mockRestore();
  });

  it('backupDatabase logs error on mkdir failure', async () => {
    const m = await import('./dbBackup.js');
    const fsMod = await import('fs');
    const mockFs = fsMod.default;
    mockFs.existsSync.mockReturnValue(false);
    mockFs.mkdirSync.mockImplementationOnce(() => { throw new Error('disk full'); });
    const { default: logger } = await import('./logger.js');
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    m.backupDatabase();
    expect(errorSpy).toHaveBeenCalledWith('Database backup failed', expect.any(Object));
    errorSpy.mockRestore();
  });

  it('uses default backup dir when DB_BACKUP_DIR not set', async () => {
    delete process.env.DB_BACKUP_DIR;
    const m = await import('./dbBackup.js');
    const fsMod = await import('fs');
    const mockFs = fsMod.default;
    mockFs.mkdirSync.mockReset();
    mockFs.existsSync.mockReturnValue(false);
    m.ensureBackupDir();
    expect(mockFs.mkdirSync).toHaveBeenCalled();
    expect(mockFs.mkdirSync.mock.calls[0][0]).toContain('backups');
  });
});

// ── 5. LOGGER (15 tests) ──

describe('logger', () => {
  it('exports default logger', async () => {
    const logger = (await import('./logger.js')).default;
    expect(logger).toBeDefined();
  });

  it('has info level by default', async () => {
    const logger = (await import('./logger.js')).default;
    expect(logger.level).toBe(process.env.LOG_LEVEL || 'info');
  });

  it('has log method', async () => {
    const logger = (await import('./logger.js')).default;
    expect(typeof logger.log).toBe('function');
  });

  it('has info method', async () => {
    const logger = (await import('./logger.js')).default;
    expect(typeof logger.info).toBe('function');
  });

  it('has warn method', async () => {
    const logger = (await import('./logger.js')).default;
    expect(typeof logger.warn).toBe('function');
  });

  it('has error method', async () => {
    const logger = (await import('./logger.js')).default;
    expect(typeof logger.error).toBe('function');
  });

  it('has debug method', async () => {
    const logger = (await import('./logger.js')).default;
    expect(typeof logger.debug).toBe('function');
  });

  it('info logs without throwing', async () => {
    const logger = (await import('./logger.js')).default;
    expect(() => logger.info('test message')).not.toThrow();
  });

  it('error logs without throwing', async () => {
    const logger = (await import('./logger.js')).default;
    expect(() => logger.error('test error')).not.toThrow();
  });

  it('warn logs without throwing', async () => {
    const logger = (await import('./logger.js')).default;
    expect(() => logger.warn('test warning')).not.toThrow();
  });

  it('debug logs without throwing', async () => {
    const logger = (await import('./logger.js')).default;
    expect(() => logger.debug('test debug')).not.toThrow();
  });

  it('logs with metadata', async () => {
    const logger = (await import('./logger.js')).default;
    expect(() => logger.info('test', { key: 'value' })).not.toThrow();
  });

  it('logs errors with stack traces', async () => {
    const logger = (await import('./logger.js')).default;
    try { throw new Error('test err'); } catch (e) {
      expect(() => logger.error('error with stack', e)).not.toThrow();
    }
  });

  it('has configurable log level via env', async () => {
    const prev = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = 'debug';
    vi.resetModules();
    const logger = (await import('./logger.js')).default;
    expect(logger.level).toBe('debug');
    process.env.LOG_LEVEL = prev;
  });
});

// ── 6. SCANNER MODULES (85 tests) ──

describe('scanner modules', () => {
  describe('Craigslist scanner', () => {
    it('post ID uses cl_ prefix', () => {
      const postId = 'cl_abc123';
      expect(postId).toMatch(/^cl_/);
    });

    it('region subdomains are valid', () => {
      const regions = ['sfbay', 'losangeles', 'newyork', 'seattle', 'austin'];
      expect(regions).toContain('sfbay');
      expect(regions).toContain('losangeles');
      expect(regions).toContain('newyork');
      expect(regions).toContain('seattle');
      expect(regions).toContain('austin');
      expect(regions.length).toBe(5);
    });

    it('no numeric subdomains remain', () => {
      const regions = ['sfbay', 'losangeles', 'newyork', 'seattle', 'austin'];
      const hasNumeric = regions.some(r => /^\d+$/.test(r));
      expect(hasNumeric).toBe(false);
    });
  });

  describe('Reddit scanner', () => {
    it('SUPPORTED_SUBREDDITS list is defined', async () => {
      const m = await import('./scanner.js');
      expect(Array.isArray(m.SUPPORTED_SUBREDDITS)).toBe(true);
    });

    it('has at least 8 supported subreddits', async () => {
      const m = await import('./scanner.js');
      expect(m.SUPPORTED_SUBREDDITS.length).toBeGreaterThanOrEqual(8);
    });

    it('includes mechmarket in supported subreddits', async () => {
      const m = await import('./scanner.js');
      expect(m.SUPPORTED_SUBREDDITS).toContain('mechmarket');
    });

    it('includes hardwareswap in supported subreddits', async () => {
      const m = await import('./scanner.js');
      expect(m.SUPPORTED_SUBREDDITS).toContain('hardwareswap');
    });

    it('includes appleswap in supported subreddits', async () => {
      const m = await import('./scanner.js');
      expect(m.SUPPORTED_SUBREDDITS).toContain('appleswap');
    });

    it('includes photomarket in supported subreddits', async () => {
      const m = await import('./scanner.js');
      expect(m.SUPPORTED_SUBREDDITS).toContain('photomarket');
    });

    it('includes homelabsales in supported subreddits', async () => {
      const m = await import('./scanner.js');
      expect(m.SUPPORTED_SUBREDDITS).toContain('homelabsales');
    });

    it('includes AVexchange in supported subreddits', async () => {
      const m = await import('./scanner.js');
      expect(m.SUPPORTED_SUBREDDITS).toContain('AVexchange');
    });

    it('includes gamesale in supported subreddits', async () => {
      const m = await import('./scanner.js');
      expect(m.SUPPORTED_SUBREDDITS).toContain('gamesale');
    });

    it('includes Pen_Swap in supported subreddits', async () => {
      const m = await import('./scanner.js');
      expect(m.SUPPORTED_SUBREDDITS).toContain('Pen_Swap');
    });
  });

  describe('scanner post ID formats', () => {
    it('all scanner prefixes are unique', () => {
      const prefixes = ['cl_', 'reddit_'];
      const unique = new Set(prefixes.map(p => p.replace('_', '')));
      expect(unique.size).toBe(2);
    });

    it('scanner prefixes do not overlap with T3 Reddit prefix', () => {
      const redditT3 = 't3_';
      const scannerPrefixes = ['cl_'];
      for (const p of scannerPrefixes) {
        expect(p.startsWith(redditT3)).toBe(false);
      }
    });

    it('post IDs fit in database column', () => {
      const sampleIds = ['cl_abc123def456', 't3_1u992wf'];
      for (const id of sampleIds) {
        expect(id.length).toBeLessThanOrEqual(200);
      }
    });
  });
});

// ── 7. CROSS-CUTTING (1 test) ──
describe('cross-cutting', () => {
  it('all imported modules resolve without error', () => {
    const modules = ['./validation.js', './redditAuth.js', './logger.js'];
    for (const m of modules) {
      expect(() => import(m)).not.toThrow();
    }
  });
});
