import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  default: { existsSync: vi.fn(() => false), readFileSync: vi.fn() },
}));
vi.mock('node-fetch', () => ({ default: vi.fn() }));
vi.mock('fast-xml-parser', () => ({
  XMLParser: vi.fn(() => ({ parse: vi.fn() })),
}));

const mockFs = await import('fs');
const { XMLParser } = await import('fast-xml-parser');

describe('getAccessToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    delete process.env.REDDIT_CLIENT_ID;
    delete process.env.REDDIT_CLIENT_SECRET;
    delete process.env.REDDIT_USERNAME;
    delete process.env.REDDIT_PASSWORD;
    delete process.env.REDDIT_TOKEN;
  });

  it('fetches OAuth token with client credentials', async () => {
    process.env.REDDIT_CLIENT_ID = 'client123';
    process.env.REDDIT_CLIENT_SECRET = 'secret456';
    process.env.REDDIT_USERNAME = 'testuser';
    process.env.REDDIT_PASSWORD = 'testpass';
    const fetch = (await import('node-fetch')).default;
    fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: 'oauth_token_123', expires_in: 3600 }),
    });
    const { getAccessToken } = await import('./redditAuth.js');
    const token = await getAccessToken();
    expect(token).toBe('oauth_token_123');
  });

  it('caches OAuth token and reuses it', async () => {
    process.env.REDDIT_CLIENT_ID = 'client123';
    process.env.REDDIT_CLIENT_SECRET = 'secret456';
    process.env.REDDIT_USERNAME = 'testuser';
    process.env.REDDIT_PASSWORD = 'testpass';
    const fetch = (await import('node-fetch')).default;
    fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: 'cached_token', expires_in: 3600 }),
    });
    const { getAccessToken } = await import('./redditAuth.js');
    await getAccessToken();
    await getAccessToken();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('throws on OAuth error response', async () => {
    process.env.REDDIT_CLIENT_ID = 'client123';
    process.env.REDDIT_CLIENT_SECRET = 'secret456';
    process.env.REDDIT_USERNAME = 'testuser';
    process.env.REDDIT_PASSWORD = 'testpass';
    const fetch = (await import('node-fetch')).default;
    fetch.mockResolvedValue({ ok: false, status: 401 });
    const { getAccessToken } = await import('./redditAuth.js');
    await expect(getAccessToken()).rejects.toThrow('Reddit OAuth token error: 401');
  });

  it('falls back to REDDIT_TOKEN env var', async () => {
    const tokenData = { token: Buffer.from(JSON.stringify({ accessToken: 'env_token' })).toString('base64') };
    process.env.REDDIT_TOKEN = JSON.stringify(tokenData);
    const { getAccessToken } = await import('./redditAuth.js');
    await expect(getAccessToken()).resolves.toBe('env_token');
  });

  it('falls back to devvit file when env var missing', async () => {
    mockFs.default.existsSync.mockReturnValue(true);
    const wrapper = { token: Buffer.from(JSON.stringify({ accessToken: 'file_token' })).toString('base64') };
    mockFs.default.readFileSync.mockReturnValue(JSON.stringify(wrapper));
    const { getAccessToken } = await import('./redditAuth.js');
    await expect(getAccessToken()).resolves.toBe('file_token');
  });

  it('throws when devvit file has no accessToken', async () => {
    mockFs.default.existsSync.mockReturnValue(true);
    const wrapper = { token: Buffer.from(JSON.stringify({})).toString('base64') };
    mockFs.default.readFileSync.mockReturnValue(JSON.stringify(wrapper));
    const { getAccessToken } = await import('./redditAuth.js');
    await expect(getAccessToken()).rejects.toThrow('No Reddit auth configured');
  });

  it('throws when no credentials configured', async () => {
    const { getAccessToken } = await import('./redditAuth.js');
    await expect(getAccessToken()).rejects.toThrow('No Reddit auth configured');
  });
});

describe('fetchReddit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    delete process.env.REDDIT_CLIENT_ID;
  });

  it('uses RSS fallback when no client id', async () => {
    const mockParse = vi.fn().mockReturnValue({ feed: { entry: [] } });
    XMLParser.mockReturnValue({ parse: mockParse });
    const fetch = (await import('node-fetch')).default;
    fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('<feed></feed>') });
    const { fetchReddit } = await import('./redditAuth.js');
    const result = await fetchReddit('/r/mechmarket/new');
    expect(result).toEqual({ data: { children: [] } });
  });

  it('throws on invalid path', async () => {
    const { fetchReddit } = await import('./redditAuth.js');
    await expect(fetchReddit('invalid-path')).rejects.toThrow('Cannot parse subreddit from path');
  });

  it('fetches via OAuth and returns JSON', async () => {
    process.env.REDDIT_CLIENT_ID = 'client123';
    process.env.REDDIT_CLIENT_SECRET = 'secret456';
    process.env.REDDIT_USERNAME = 'testuser';
    process.env.REDDIT_PASSWORD = 'testpass';
    const fetch = (await import('node-fetch')).default;
    fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ access_token: 'oauth_token_abc', expires_in: 3600 }),
    });
    fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { children: [{ data: { id: '1' } }] } }),
    });
    const { fetchReddit } = await import('./redditAuth.js');
    const result = await fetchReddit('/r/mechmarket/new');
    expect(result.data.children).toHaveLength(1);
    expect(fetch).toHaveBeenLastCalledWith(
      'https://oauth.reddit.com/r/mechmarket/new',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer oauth_token_abc' }) })
    );
  });

  it('falls back to RSS when OAuth API returns error', async () => {
    process.env.REDDIT_CLIENT_ID = 'client123';
    process.env.REDDIT_CLIENT_SECRET = 'secret456';
    process.env.REDDIT_USERNAME = 'testuser';
    process.env.REDDIT_PASSWORD = 'testpass';
    const fetch = (await import('node-fetch')).default;
    fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ access_token: 'oauth_token_abc', expires_in: 3600 }),
    });
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: () => Promise.resolve(''),
    });
    const mockParse = vi.fn().mockReturnValue({ feed: { entry: [] } });
    XMLParser.mockReturnValue({ parse: mockParse });
    fetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve('<feed></feed>'),
    });
    const { fetchReddit } = await import('./redditAuth.js');
    const result = await fetchReddit('/r/mechmarket/new');
    expect(result).toEqual({ data: { children: [] } });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('falls back to RSS when OAuth token acquisition fails', async () => {
    process.env.REDDIT_CLIENT_ID = 'client123';
    const fetch = (await import('node-fetch')).default;
    const mockParse = vi.fn().mockReturnValue({ feed: { entry: [] } });
    XMLParser.mockReturnValue({ parse: mockParse });
    fetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('<feed></feed>'),
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { fetchReddit } = await import('./redditAuth.js');
    const result = await fetchReddit('/r/mechmarket/new');
    expect(result).toEqual({ data: { children: [] } });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('OAuth failed'));
    vi.restoreAllMocks();
  });
});

describe('RSS fallback parsing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.REDDIT_CLIENT_ID;
  });

  function setupParse(returnValue) {
    const mockParse = vi.fn().mockReturnValue(returnValue);
    XMLParser.mockReturnValue({ parse: mockParse });
    return mockParse;
  }

  it('parses RSS entries correctly', async () => {
    setupParse({
      feed: { entry: [{ id: 'https://www.reddit.com/r/mechmarket/comments/abc123/test/', title: 'Keychron Q1 - $150', content: { '#text': 'Like new condition' }, link: { '@_href': 'https://www.reddit.com/r/mechmarket/comments/abc123/test/' } }] },
    });
    const fetch = (await import('node-fetch')).default;
    fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('<feed></feed>') });
    const { fetchReddit } = await import('./redditAuth.js');
    const result = await fetchReddit('/r/mechmarket/new');
    expect(result.data.children).toHaveLength(1);
    expect(result.data.children[0].data.title).toBe('Keychron Q1 - $150');
  });

  it('handles empty RSS feed', async () => {
    setupParse({ feed: {} });
    const fetch = (await import('node-fetch')).default;
    fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('<feed></feed>') });
    const { fetchReddit } = await import('./redditAuth.js');
    const result = await fetchReddit('/r/mechmarket/new');
    expect(result.data.children).toEqual([]);
  });

  it('handles missing feed entry', async () => {
    setupParse({ feed: { entry: undefined } });
    const fetch = (await import('node-fetch')).default;
    fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('<feed></feed>') });
    const { fetchReddit } = await import('./redditAuth.js');
    const result = await fetchReddit('/r/mechmarket/new');
    expect(result.data.children).toEqual([]);
  });

  it('handles single entry', async () => {
    setupParse({
      feed: { entry: { id: 'https://reddit.com/r/test/comments/xyz/', title: 'Single', content: { '#text': 'desc' }, link: { '@_href': 'https://reddit.com/r/test/comments/xyz/' } } },
    });
    const fetch = (await import('node-fetch')).default;
    fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('<feed></feed>') });
    const { fetchReddit } = await import('./redditAuth.js');
    const result = await fetchReddit('/r/test/new');
    expect(result.data.children).toHaveLength(1);
  });

  it('extracts thumbnail from media:thumbnail', async () => {
    setupParse({
      feed: { entry: [{ id: 'tag:1', title: 'Test', content: { '#text': 'body' }, link: { '@_href': 'https://reddit.com/r/t/1/' }, 'media:thumbnail': { '@_url': 'https://i.redd.it/thumb.jpg' } }] },
    });
    const fetch = (await import('node-fetch')).default;
    fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('<feed></feed>') });
    const { fetchReddit } = await import('./redditAuth.js');
    const result = await fetchReddit('/r/test/new');
    expect(result.data.children[0].data.thumbnail).toBe('https://i.redd.it/thumb.jpg');
  });

  it('handles RSS 429 with retry', async () => {
    vi.stubGlobal('setTimeout', vi.fn((fn) => fn()));
    setupParse({ feed: { entry: [] } });
    const fetch = (await import('node-fetch')).default;
    fetch.mockResolvedValueOnce({ ok: false, status: 429, text: () => Promise.resolve('') })
      .mockResolvedValueOnce({ ok: false, status: 429, text: () => Promise.resolve('') })
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('<feed></feed>') });
    const { fetchReddit } = await import('./redditAuth.js');
    await fetchReddit('/r/test/new');
    expect(fetch).toHaveBeenCalledTimes(3);
    vi.unstubAllGlobals();
  });

  it('gives up after 3 RSS 429 attempts', async () => {
    vi.stubGlobal('setTimeout', vi.fn((fn) => fn()));
    setupParse({ feed: { entry: [] } });
    const fetch = (await import('node-fetch')).default;
    fetch.mockResolvedValue({ ok: false, status: 429, text: () => Promise.resolve('') });
    const { fetchReddit } = await import('./redditAuth.js');
    await expect(fetchReddit('/r/test/new')).rejects.toThrow('RSS fetch error: 429');
    vi.unstubAllGlobals();
  });

  it('strips HTML from RSS content', async () => {
    setupParse({
      feed: { entry: [{ id: 'tag:1', title: 'Test', content: { '#text': 'Hello <b>world</b> &amp; more' }, link: { '@_href': 'https://reddit.com/r/t/1/' } }] },
    });
    const fetch = (await import('node-fetch')).default;
    fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('<feed></feed>') });
    const { fetchReddit } = await import('./redditAuth.js');
    const result = await fetchReddit('/r/test/new');
    expect(result.data.children[0].data.selftext).toBe('Hello world & more');
  });

  it('handles string content type', async () => {
    setupParse({
      feed: { entry: [{ id: 'tag:1', title: 'Test', content: 'Plain string', link: { '@_href': 'https://reddit.com/r/t/1/' } }] },
    });
    const fetch = (await import('node-fetch')).default;
    fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('<feed></feed>') });
    const { fetchReddit } = await import('./redditAuth.js');
    const result = await fetchReddit('/r/test/new');
    expect(result.data.children[0].data.selftext).toBe('Plain string');
  });

  it('strips HTML entities from content', async () => {
    setupParse({
      feed: { entry: [{ id: 'tag:1', title: 'Test', content: { '#text': '&lt;script&gt;alert(1)&lt;/script&gt;' }, link: { '@_href': 'https://reddit.com/r/t/1/' } }] },
    });
    const fetch = (await import('node-fetch')).default;
    fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('<feed></feed>') });
    const { fetchReddit } = await import('./redditAuth.js');
    const result = await fetchReddit('/r/test/new');
    expect(result.data.children[0].data.selftext).toBe('<script>alert(1)</script>');
  });

  it('uses entry.id as fallback when link has no @_href', async () => {
    setupParse({
      feed: { entry: [{ id: 'https://www.reddit.com/r/test/comments/xyz123/', title: 'No href', content: { '#text': 'body' }, link: {} }] },
    });
    const fetch = (await import('node-fetch')).default;
    fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('<feed></feed>') });
    const { fetchReddit } = await import('./redditAuth.js');
    const result = await fetchReddit('/r/test/new');
    expect(result.data.children[0].data.id).toBe('xyz123');
  });

  it('handles entry with null content', async () => {
    setupParse({
      feed: { entry: [{ id: 'tag:nocontent', title: 'No content', content: null, link: { '@_href': 'https://reddit.com/r/t/1/' } }] },
    });
    const fetch = (await import('node-fetch')).default;
    fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('<feed></feed>') });
    const { fetchReddit } = await import('./redditAuth.js');
    const result = await fetchReddit('/r/test/new');
    expect(result.data.children[0].data.selftext).toBe('');
  });

  it('handles entry with undefined content', async () => {
    setupParse({
      feed: { entry: [{ id: 'tag:nocontent2', title: 'Undefined content', link: { '@_href': 'https://reddit.com/r/t/2/' } }] },
    });
    const fetch = (await import('node-fetch')).default;
    fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('<feed></feed>') });
    const { fetchReddit } = await import('./redditAuth.js');
    const result = await fetchReddit('/r/test/new');
    expect(result.data.children[0].data.selftext).toBe('');
  });

  it('uses raw id when entry id has no comments/ pattern', async () => {
    setupParse({
      feed: { entry: [{ id: 'simple-non-url-id', title: 'Plain ID', content: { '#text': 'body' }, link: { '@_href': 'https://reddit.com/r/t/3/' } }] },
    });
    const fetch = (await import('node-fetch')).default;
    fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('<feed></feed>') });
    const { fetchReddit } = await import('./redditAuth.js');
    const result = await fetchReddit('/r/test/new');
    expect(result.data.children[0].data.id).toBe('simple-non-url-id');
  });
});
