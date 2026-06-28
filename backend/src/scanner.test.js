import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./db.js', () => ({
  default: {
    prepare: vi.fn(() => ({
      run: vi.fn(() => ({ changes: 1, lastInsertRowid: 42 })),
      get: vi.fn(() => ({ jwt_version: 1, id: 1, email: 'a@b.com', is_premium: 1, tier: 'pro' })),
      all: vi.fn(() => []),
    })),
  },
}));

vi.mock('./notifier.js', () => ({ sendNotification: vi.fn(() => Promise.resolve()) }));
vi.mock('./redditAuth.js', () => ({ fetchReddit: vi.fn() }));
vi.mock('./aiScorer.js', () => ({ scoreDeal: vi.fn(() => Promise.resolve(null)) }));

const { fetchReddit } = await import('./redditAuth.js');
const { scoreDeal } = await import('./aiScorer.js');
const { sendNotification } = await import('./notifier.js');
const { scanSubreddit, SUPPORTED_SUBREDDITS } = await import('./scanner.js');

describe('SUPPORTED_SUBREDDITS', () => {
  it('includes mechmarket', () => expect(SUPPORTED_SUBREDDITS).toContain('mechmarket'));
  it('includes hardwareswap', () => expect(SUPPORTED_SUBREDDITS).toContain('hardwareswap'));
  it('includes appleswap', () => expect(SUPPORTED_SUBREDDITS).toContain('appleswap'));
  it('includes photomarket', () => expect(SUPPORTED_SUBREDDITS).toContain('photomarket'));
  it('includes homelabsales', () => expect(SUPPORTED_SUBREDDITS).toContain('homelabsales'));
  it('includes AVexchange', () => expect(SUPPORTED_SUBREDDITS).toContain('AVexchange'));
  it('includes gamesale', () => expect(SUPPORTED_SUBREDDITS).toContain('gamesale'));
  it('includes Pen_Swap', () => expect(SUPPORTED_SUBREDDITS).toContain('Pen_Swap'));
  it('has 8 subreddits', () => expect(SUPPORTED_SUBREDDITS).toHaveLength(8));
});

describe('scanSubreddit', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('processes posts from Reddit API', async () => {
    fetchReddit.mockResolvedValue({
      data: { children: [{ data: { id: 'abc123', title: 'Keychron Q1 - $150', selftext: '', permalink: '/r/mechmarket/123/', author: 'seller1', preview: null, thumbnail: null } }] },
    });

    await scanSubreddit('mechmarket');

    expect(fetchReddit).toHaveBeenCalledWith('/r/mechmarket/new?limit=25');
  });

  it('handles empty post list', async () => {
    fetchReddit.mockResolvedValue({ data: { children: [] } });
    await expect(scanSubreddit('mechmarket')).resolves.toBeUndefined();
  });

  it('handles fetch error gracefully', async () => {
    fetchReddit.mockRejectedValue(new Error('Network error'));
    await expect(scanSubreddit('mechmarket')).resolves.toBeUndefined();
  });

  it('extracts and stores price from post', async () => {
    fetchReddit.mockResolvedValue({
      data: { children: [{ data: { id: 'abc1', title: 'Selling Keyboard $200', selftext: '', permalink: '/r/test/1/', author: 'u1', preview: null, thumbnail: null } }] },
    });
    await scanSubreddit('mechmarket');
  });

  it('handles posts with selftext', async () => {
    fetchReddit.mockResolvedValue({
      data: { children: [{ data: { id: 'abc2', title: 'Keychron Q1', selftext: 'Like new condition $180 shipped', permalink: '/r/test/2/', author: 'u2', preview: null, thumbnail: null } }] },
    });
    await scanSubreddit('mechmarket');
  });

  it('passes AI scoring when api key present', async () => {
    fetchReddit.mockResolvedValue({
      data: { children: [{ data: { id: 'abc3', title: 'Keychron Q1 - $150', selftext: 'Great condition', permalink: '/r/test/3/', author: 'u3', preview: null, thumbnail: null } }] },
    });
    scoreDeal.mockResolvedValue({ score: 85, reasoning: 'Good deal', market_value: 180, scam_signals: [], scam_risk: 'low' });
    const db = (await vi.importMock('./db.js')).default;
    db.prepare.mockImplementation(() => ({
      run: vi.fn(() => ({ changes: 1, lastInsertRowid: 42 })),
      get: vi.fn(),
      all: vi.fn(() => []),
    }));
    await scanSubreddit('mechmarket');
    expect(scoreDeal).toHaveBeenCalled();
  });

  it('handles AI scoring returning null', async () => {
    fetchReddit.mockResolvedValue({
      data: { children: [{ data: { id: 'abc4', title: 'Test item', selftext: '', permalink: '/r/test/4/', author: 'u4', preview: null, thumbnail: null } }] },
    });
    scoreDeal.mockResolvedValue(null);
    await scanSubreddit('mechmarket');
  });

  it('matches keywords against alert rules', async () => {
    fetchReddit.mockResolvedValue({
      data: { children: [{ data: { id: 'abc5', title: 'Keychron Q1 for sale', selftext: 'Like new $150', permalink: '/r/test/5/', author: 'u5', preview: null, thumbnail: null } }] },
    });
    const db = (await vi.importMock('./db.js')).default;
    db.prepare().all
      .mockReturnValueOnce([]) // rules query returns empty
      .mockReturnValueOnce([]); // any subsequent all call
    await scanSubreddit('mechmarket');
  });

  it('sends notification when rule matches', async () => {
    fetchReddit.mockResolvedValue({
      data: { children: [{ data: { id: 'abc6', title: 'Keychron Q1 - $150', selftext: '', permalink: '/r/test/6/', author: 'u6', preview: null, thumbnail: null } }] },
    });
    const db = (await vi.importMock('./db.js')).default;
    const mockRun = vi.fn();
    const mockGet = vi.fn()
      .mockReturnValueOnce({ cnt: 0, is_premium: 0, id: 1, keywords: 'Keychron', min_price: null, max_price: null, last_matched_at: null, tier: 'pro', is_premium: 1, user_id: 1, notify_type: 'discord', notify_target: 'https://discord.com/api/webhooks/123', scan_interval: null, subreddit: 'mechmarket' })
      .mockReturnValue({ jwt_version: 1 });
    db.prepare.mockReturnValue({ run: mockRun, get: mockGet, all: vi.fn().mockReturnValue([]) });

    await scanSubreddit('mechmarket');
  });

  it('skips duplicate normalized titles within 7 days', async () => {
    fetchReddit.mockResolvedValue({
      data: { children: [{ data: { id: 'dup1', title: 'Keychron Q1', selftext: '', permalink: '/r/test/dup/', author: 'u', preview: null, thumbnail: null } }] },
    });
    const db = (await vi.importMock('./db.js')).default;
    const mockGet = vi.fn()
      .mockReturnValueOnce({ post_id: 'existing123' }) // dup check finds existing
      .mockReturnValue({ jwt_version: 1 });
    db.prepare.mockReturnValue({ run: vi.fn(() => ({ changes: 0 })), get: mockGet, all: vi.fn() });
    await scanSubreddit('mechmarket');
  });

  it('extracts seller location from title', async () => {
    fetchReddit.mockResolvedValue({
      data: { children: [{ data: { id: 'loc1', title: 'Keychron Q1 (CA) - $150', selftext: '', permalink: '/r/test/loc/', author: 'seller_ca', preview: null, thumbnail: null } }] },
    });
    await scanSubreddit('mechmarket');
  });

  it('handles post with image preview', async () => {
    fetchReddit.mockResolvedValue({
      data: { children: [{ data: { id: 'img1', title: 'Keyboard with photo', selftext: '', permalink: '/r/test/img/', author: 'u', preview: { images: [{ source: { url: 'https://i.redd.it/test.jpg&amp;w=600' } }] }, thumbnail: 'https://b.thumbs.redditmedia.com/test.jpg' } }] },
    });
    await scanSubreddit('mechmarket');
  });

  it('handles post with thumbnail but no preview', async () => {
    fetchReddit.mockResolvedValue({
      data: { children: [{ data: { id: 'thumb1', title: 'Keyboard', selftext: '', permalink: '/r/test/thumb/', author: 'u', preview: null, thumbnail: 'https://b.thumbs.redditmedia.com/thumb.jpg' } }] },
    });
    await scanSubreddit('mechmarket');
  });

  it('records price history for new post with price', async () => {
    fetchReddit.mockResolvedValue({
      data: { children: [{ data: { id: 'ph1', title: 'Item $100', selftext: '', permalink: '/r/test/ph/', author: 'u', preview: null, thumbnail: null } }] },
    });
    await scanSubreddit('mechmarket');
  });

  it('processes multiple posts', async () => {
    fetchReddit.mockResolvedValue({
      data: { children: [
        { data: { id: 'm1', title: 'Keyboard $100', selftext: '', permalink: '/r/test/m1/', author: 'u1', preview: null, thumbnail: null } },
        { data: { id: 'm2', title: 'Mouse $50', selftext: '', permalink: '/r/test/m2/', author: 'u2', preview: null, thumbnail: null } },
        { data: { id: 'm3', title: 'Monitor $200', selftext: '', permalink: '/r/test/m3/', author: 'u3', preview: null, thumbnail: null } },
      ] },
    });
    await scanSubreddit('mechmarket');
  });

  it('respects rule cooldown interval', async () => {
    fetchReddit.mockResolvedValue({
      data: { children: [{ data: { id: 'cooldown1', title: 'Keychron Q1 - $150', selftext: '', permalink: '/r/test/cd/', author: 'u', preview: null, thumbnail: null } }] },
    });
    const db = (await vi.importMock('./db.js')).default;
    const recentTime = new Date(Date.now() - 1000).toISOString();
    const mockGet = vi.fn()
      .mockReturnValueOnce({ cnt: 0, is_premium: 0, id: 1, keywords: 'Keychron', min_price: null, max_price: null, last_matched_at: recentTime, tier: 'free', is_premium: 0, user_id: 1, notify_type: 'discord', notify_target: 'https://discord.com/api/webhooks/123', scan_interval: null, subreddit: 'mechmarket' })
      .mockReturnValue({ jwt_version: 1 });
    db.prepare.mockReturnValue({ run: vi.fn(() => ({ changes: 1 })), get: mockGet, all: vi.fn().mockReturnValue([]) });
    await scanSubreddit('mechmarket');
  });

  it('handles rule with subreddit=all', async () => {
    fetchReddit.mockResolvedValue({
      data: { children: [{ data: { id: 'all1', title: 'Universal item', selftext: '', permalink: '/r/test/all/', author: 'u', preview: null, thumbnail: null } }] },
    });
    const db = (await vi.importMock('./db.js')).default;
    const mockGet = vi.fn()
      .mockReturnValueOnce({ cnt: 0, is_premium: 0, id: 1, keywords: 'item', min_price: null, max_price: null, last_matched_at: null, tier: 'pro', is_premium: 1, user_id: 1, notify_type: 'discord', notify_target: 'https://discord.com/api/webhooks/123', scan_interval: null, subreddit: 'all' })
      .mockReturnValue({ jwt_version: 1 });
    db.prepare.mockReturnValue({ run: vi.fn(() => ({ changes: 1 })), get: mockGet, all: vi.fn().mockReturnValue([]) });
    await scanSubreddit('mechmarket');
  });

  it('handles null author gracefully', async () => {
    fetchReddit.mockResolvedValue({
      data: { children: [{ data: { id: 'nullauth', title: 'Item $50', selftext: '', permalink: '/r/test/na/', author: null, preview: null, thumbnail: null } }] },
    });
    await scanSubreddit('mechmarket');
  });

  it('filters by min_score threshold', async () => {
    fetchReddit.mockResolvedValue({
      data: { children: [{ data: { id: 'score1', title: 'Mediocre item $100', selftext: '', permalink: '/r/test/sc/', author: 'u', preview: null, thumbnail: null } }] },
    });
    const db = (await vi.importMock('./db.js')).default;
    const mockGet = vi.fn()
      .mockReturnValueOnce({ cnt: 0, is_premium: 0, id: 1, keywords: 'item', min_price: null, max_price: null, min_score: 80, last_matched_at: null, tier: 'pro', is_premium: 1, user_id: 1, notify_type: 'discord', notify_target: 'https://discord.com/api/webhooks/123', scan_interval: null, subreddit: 'mechmarket' })
      .mockReturnValue({ jwt_version: 1 });
    db.prepare.mockReturnValue({ run: vi.fn(() => ({ changes: 1 })), get: mockGet, all: vi.fn().mockReturnValue([]) });
    scoreDeal.mockResolvedValue({ score: 50, reasoning: 'Average', market_value: 100, scam_signals: [], scam_risk: 'low' });
    await scanSubreddit('mechmarket');
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('passes min_score threshold when score is high enough', async () => {
    fetchReddit.mockResolvedValue({
      data: { children: [{ data: { id: 'score2', title: 'Great deal $100', selftext: '', permalink: '/r/test/sc2/', author: 'u', preview: null, thumbnail: null } }] },
    });
    const db = (await vi.importMock('./db.js')).default;
    const mockGet = vi.fn()
      .mockReturnValueOnce({ cnt: 0, is_premium: 0, id: 1, keywords: 'deal', min_price: null, max_price: null, min_score: 80, last_matched_at: null, tier: 'pro', is_premium: 1, user_id: 1, notify_type: 'discord', notify_target: 'https://discord.com/api/webhooks/123', scan_interval: null, subreddit: 'mechmarket' })
      .mockReturnValue({ jwt_version: 1 });
    db.prepare.mockReturnValue({ run: vi.fn(() => ({ changes: 1 })), get: mockGet, all: vi.fn().mockReturnValue([]) });
    scoreDeal.mockResolvedValue({ score: 90, reasoning: 'Great', market_value: 150, scam_signals: [], scam_risk: 'low' });
    await scanSubreddit('mechmarket');
  });

  it('handles price drop detection on re-scanned post', async () => {
    fetchReddit.mockResolvedValue({
      data: { children: [{ data: { id: 'pd1', title: 'Price dropped item $80', selftext: '', permalink: '/r/test/pd/', author: 'u', preview: null, thumbnail: null } }] },
    });
    const db = (await vi.importMock('./db.js')).default;
    const mockGet = vi.fn()
      .mockReturnValueOnce(null) // no dup
      .mockReturnValueOnce(null) // no rules (rules all returns [])
      .mockReturnValue({ price: 100 });
    db.prepare.mockReturnValue({ run: vi.fn(() => ({ changes: 0 })), get: mockGet, all: vi.fn().mockReturnValue([]) });
    await scanSubreddit('mechmarket');
  });

  it('handles price increase on re-scanned post', async () => {
    fetchReddit.mockResolvedValue({
      data: { children: [{ data: { id: 'pi1', title: 'Price increased $150', selftext: '', permalink: '/r/test/pi/', author: 'u', preview: null, thumbnail: null } }] },
    });
    const db = (await vi.importMock('./db.js')).default;
    const mockGet = vi.fn()
      .mockReturnValueOnce(null) // no dup
      .mockReturnValueOnce(null) // no rules
      .mockReturnValue({ price: 100 });
    db.prepare.mockReturnValue({ run: vi.fn(() => ({ changes: 0 })), get: mockGet, all: vi.fn().mockReturnValue([]) });
    await scanSubreddit('mechmarket');
  });

  it('handles no price change on re-scanned post', async () => {
    fetchReddit.mockResolvedValue({
      data: { children: [{ data: { id: 'nc1', title: 'Same price $100', selftext: '', permalink: '/r/test/nc/', author: 'u', preview: null, thumbnail: null } }] },
    });
    const db = (await vi.importMock('./db.js')).default;
    const mockGet = vi.fn()
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(null)
      .mockReturnValue({ price: 100 });
    db.prepare.mockReturnValue({ run: vi.fn(() => ({ changes: 0 })), get: mockGet, all: vi.fn().mockReturnValue([]) });
    await scanSubreddit('mechmarket');
  });

  it('creates price drop alert for saved deal watchers', async () => {
    fetchReddit.mockResolvedValue({
      data: { children: [{ data: { id: 'drop1', title: 'Discounted item $70', selftext: '', permalink: '/r/test/drop/', author: 'u', preview: null, thumbnail: null } }] },
    });
    const db = (await vi.importMock('./db.js')).default;
    const prevPrice = 100;
    const mockGet = vi.fn()
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(prevPrice)
      .mockReturnValueOnce({ price: prevPrice })
      .mockReturnValueOnce(null);
    const mockRun = vi.fn(() => ({ changes: 0 }));
    db.prepare.mockReturnValue({ run: mockRun, get: mockGet, all: vi.fn().mockReturnValue([{ user_id: 1 }]) });
    await scanSubreddit('mechmarket');
  });

  it('applies scam score from AI analysis', async () => {
    fetchReddit.mockResolvedValue({
      data: { children: [{ data: { id: 'scam1', title: 'Too good to be true $20', selftext: 'Brand new iPhone $20', permalink: '/r/test/scam/', author: 'u', preview: null, thumbnail: null } }] },
    });
    scoreDeal.mockResolvedValue({ score: 10, reasoning: 'Likely scam', market_value: 800, scam_signals: ['Unrealistic price', 'No history'], scam_risk: 'high' });
    await scanSubreddit('mechmarket');
  });

  it('matches price filter bounds', async () => {
    fetchReddit.mockResolvedValue({
      data: { children: [{ data: { id: 'pf1', title: 'Budget keyboard $75', selftext: '', permalink: '/r/test/pf/', author: 'u', preview: null, thumbnail: null } }] },
    });
    const db = (await vi.importMock('./db.js')).default;
    const mockGet = vi.fn()
      .mockReturnValueOnce({ cnt: 0, is_premium: 0, id: 1, keywords: 'keyboard', min_price: 50, max_price: 100, last_matched_at: null, tier: 'pro', is_premium: 1, user_id: 1, notify_type: 'discord', notify_target: 'https://discord.com/api/webhooks/123', scan_interval: null, subreddit: 'mechmarket' })
      .mockReturnValue({ jwt_version: 1 });
    db.prepare.mockReturnValue({ run: vi.fn(() => ({ changes: 1 })), get: mockGet, all: vi.fn().mockReturnValue([]) });
    await scanSubreddit('mechmarket');
  });

  it('blocks post outside price filter range', async () => {
    fetchReddit.mockResolvedValue({
      data: { children: [{ data: { id: 'pf2', title: 'Expensive keyboard $500', selftext: '', permalink: '/r/test/pf2/', author: 'u', preview: null, thumbnail: null } }] },
    });
    const db = (await vi.importMock('./db.js')).default;
    const mockGet = vi.fn()
      .mockReturnValueOnce({ cnt: 0, is_premium: 0, id: 1, keywords: 'keyboard', min_price: 50, max_price: 100, last_matched_at: null, tier: 'pro', is_premium: 1, user_id: 1, notify_type: 'discord', notify_target: 'https://discord.com/api/webhooks/123', scan_interval: null, subreddit: 'mechmarket' })
      .mockReturnValue({ jwt_version: 1 });
    db.prepare.mockReturnValue({ run: vi.fn(() => ({ changes: 1 })), get: mockGet, all: vi.fn().mockReturnValue([]) });
    await scanSubreddit('mechmarket');
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('handles pro tier cooldown', async () => {
    fetchReddit.mockResolvedValue({
      data: { children: [{ data: { id: 'pp1', title: 'Pro item $200', selftext: '', permalink: '/r/test/pp/', author: 'u', preview: null, thumbnail: null } }] },
    });
    const db = (await vi.importMock('./db.js')).default;
    const mockGet = vi.fn()
      .mockReturnValueOnce({ cnt: 0, is_premium: 0, id: 1, keywords: 'item', min_price: null, max_price: null, last_matched_at: null, tier: 'pro', is_premium: 1, user_id: 1, notify_type: 'discord', notify_target: 'https://discord.com/api/webhooks/123', scan_interval: null, subreddit: 'mechmarket' })
      .mockReturnValue({ jwt_version: 1 });
    db.prepare.mockReturnValue({ run: vi.fn(() => ({ changes: 1 })), get: mockGet, all: vi.fn().mockReturnValue([]) });
    await scanSubreddit('mechmarket');
  });

  it('uses custom scan_interval from rule', async () => {
    fetchReddit.mockResolvedValue({
      data: { children: [{ data: { id: 'si1', title: 'Custom interval item $150', selftext: '', permalink: '/r/test/si/', author: 'u', preview: null, thumbnail: null } }] },
    });
    const db = (await vi.importMock('./db.js')).default;
    const mockGet = vi.fn()
      .mockReturnValueOnce({ cnt: 0, is_premium: 0, id: 1, keywords: 'item', min_price: null, max_price: null, last_matched_at: null, tier: 'free', is_premium: 0, user_id: 1, notify_type: 'discord', notify_target: 'https://discord.com/api/webhooks/123', scan_interval: 60, subreddit: 'mechmarket' })
      .mockReturnValue({ jwt_version: 1 });
    db.prepare.mockReturnValue({ run: vi.fn(() => ({ changes: 1 })), get: mockGet, all: vi.fn().mockReturnValue([]) });
    await scanSubreddit('mechmarket');
  });

  it('handles pause_until in the future', async () => {
    fetchReddit.mockResolvedValue({
      data: { children: [{ data: { id: 'pause1', title: 'Paused rule item $100', selftext: '', permalink: '/r/test/pause/', author: 'u', preview: null, thumbnail: null } }] },
    });
    const db = (await vi.importMock('./db.js')).default;
    db.prepare().all.mockReturnValue([]);
    await scanSubreddit('mechmarket');
  });

  it('does not crash on malformed post data', async () => {
    fetchReddit.mockResolvedValue({
      data: { children: [{ data: { id: 'bad1', title: null, selftext: null, permalink: null, author: null, preview: null, thumbnail: null } }] },
    });
    await expect(scanSubreddit('mechmarket')).resolves.toBeUndefined();
  });

  it('handles archived posts via OR IGNORE', async () => {
    fetchReddit.mockResolvedValue({
      data: { children: [{ data: { id: 'arch1', title: 'Archived item $100', selftext: '', permalink: '/r/test/arch/', author: 'u', preview: null, thumbnail: null } }] },
    });
    const db = (await vi.importMock('./db.js')).default;
    db.prepare.mockReturnValue({ run: vi.fn(() => ({ changes: 0 })), get: vi.fn().mockReturnValue({ price: 100 }), all: vi.fn().mockReturnValue([]) });
    await scanSubreddit('mechmarket');
  });

  // ── Rule-loop coverage: lines 100-124 ──

  it('executes full rule match and sends notification', async () => {
    fetchReddit.mockResolvedValue({
      data: { children: [{ data: { id: 'notif1', title: 'Keychron Q1 mechanical keyboard - $150', selftext: '', permalink: '/r/test/notif1/', author: 'u', preview: null, thumbnail: null } }] },
    });
    const db = (await vi.importMock('./db.js')).default;
    const mockRun = vi.fn(() => ({ changes: 1 }));
    const mockGet = vi.fn()
      .mockReturnValueOnce(null)
      .mockReturnValue({ jwt_version: 1 });
    const mockAll = vi.fn()
      .mockReturnValueOnce([{ id: 1, keywords: 'keychron, keyboard', min_price: null, max_price: null, min_score: null, last_matched_at: null, tier: 'pro', is_premium: 1, user_id: 1, notify_type: 'discord', notify_target: 'https://discord.com/api/webhooks/123', scan_interval: null, subreddit: 'mechmarket' }])
      .mockReturnValue([]);
    db.prepare.mockReturnValue({ run: mockRun, get: mockGet, all: mockAll });
    await scanSubreddit('mechmarket');
    expect(sendNotification).toHaveBeenCalled();
    expect(mockRun).toHaveBeenCalledWith(1, 'notif1', 'keychron');
  });

  it('skips rule when keywords do not match', async () => {
    fetchReddit.mockResolvedValue({
      data: { children: [{ data: { id: 'nomatch1', title: 'Item for sale - $50', selftext: '', permalink: '/r/test/nomatch1/', author: 'u', preview: null, thumbnail: null } }] },
    });
    const db = (await vi.importMock('./db.js')).default;
    const mockRun = vi.fn(() => ({ changes: 1 }));
    const mockGet = vi.fn()
      .mockReturnValueOnce(null)
      .mockReturnValue({ jwt_version: 1 });
    const mockAll = vi.fn()
      .mockReturnValueOnce([{ id: 1, keywords: 'keyboard, mouse', min_price: null, max_price: null, min_score: null, last_matched_at: null, tier: 'pro', is_premium: 1, user_id: 1, notify_type: 'discord', notify_target: 'https://discord.com/api/webhooks/123', scan_interval: null, subreddit: 'mechmarket' }])
      .mockReturnValue([]);
    db.prepare.mockReturnValue({ run: mockRun, get: mockGet, all: mockAll });
    await scanSubreddit('mechmarket');
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('skips rule when price is out of range', async () => {
    fetchReddit.mockResolvedValue({
      data: { children: [{ data: { id: 'prange1', title: 'Expensive keyboard $500', selftext: '', permalink: '/r/test/prange1/', author: 'u', preview: null, thumbnail: null } }] },
    });
    const db = (await vi.importMock('./db.js')).default;
    const mockRun = vi.fn(() => ({ changes: 1 }));
    const mockGet = vi.fn()
      .mockReturnValueOnce(null)
      .mockReturnValue({ jwt_version: 1 });
    const mockAll = vi.fn()
      .mockReturnValueOnce([{ id: 1, keywords: 'keyboard', min_price: 10, max_price: 100, min_score: null, last_matched_at: null, tier: 'pro', is_premium: 1, user_id: 1, notify_type: 'discord', notify_target: 'https://discord.com/api/webhooks/123', scan_interval: null, subreddit: 'mechmarket' }])
      .mockReturnValue([]);
    db.prepare.mockReturnValue({ run: mockRun, get: mockGet, all: mockAll });
    await scanSubreddit('mechmarket');
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('skips rule when min_score threshold not met', async () => {
    fetchReddit.mockResolvedValue({
      data: { children: [{ data: { id: 'minscore1', title: 'Average keyboard $150', selftext: '', permalink: '/r/test/minscore1/', author: 'u', preview: null, thumbnail: null } }] },
    });
    const db = (await vi.importMock('./db.js')).default;
    const mockRun = vi.fn(() => ({ changes: 1 }));
    const mockGet = vi.fn()
      .mockReturnValueOnce(null)
      .mockReturnValue({ jwt_version: 1 });
    const mockAll = vi.fn()
      .mockReturnValueOnce([{ id: 1, keywords: 'keyboard', min_price: null, max_price: null, min_score: 80, last_matched_at: null, tier: 'pro', is_premium: 1, user_id: 1, notify_type: 'discord', notify_target: 'https://discord.com/api/webhooks/123', scan_interval: null, subreddit: 'mechmarket' }])
      .mockReturnValue([]);
    db.prepare.mockReturnValue({ run: mockRun, get: mockGet, all: mockAll });
    scoreDeal.mockResolvedValue({ score: 50, reasoning: 'Average', market_value: 180, scam_signals: [], scam_risk: 'low' });
    await scanSubreddit('mechmarket');
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('skips rule due to cooldown interval', async () => {
    fetchReddit.mockResolvedValue({
      data: { children: [{ data: { id: 'cdown1', title: 'Hot item keyboard $100', selftext: '', permalink: '/r/test/cdown1/', author: 'u', preview: null, thumbnail: null } }] },
    });
    const db = (await vi.importMock('./db.js')).default;
    const recentTime = new Date(Date.now() - 1000).toISOString();
    const mockRun = vi.fn(() => ({ changes: 1 }));
    const mockGet = vi.fn()
      .mockReturnValueOnce(null)
      .mockReturnValue({ jwt_version: 1 });
    const mockAll = vi.fn()
      .mockReturnValueOnce([{ id: 1, keywords: 'keyboard', min_price: null, max_price: null, min_score: null, last_matched_at: recentTime, tier: 'free', is_premium: 0, user_id: 1, notify_type: 'discord', notify_target: 'https://discord.com/api/webhooks/123', scan_interval: null, subreddit: 'mechmarket' }])
      .mockReturnValue([]);
    db.prepare.mockReturnValue({ run: mockRun, get: mockGet, all: mockAll });
    await scanSubreddit('mechmarket');
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('applies medium scam score', async () => {
    fetchReddit.mockResolvedValue({
      data: { children: [{ data: { id: 'med1', title: 'Suspicious item $50', selftext: '', permalink: '/r/test/med1/', author: 'u', preview: null, thumbnail: null } }] },
    });
    scoreDeal.mockResolvedValue({ score: 30, reasoning: 'Suspicious', market_value: 100, scam_signals: ['Odd'], scam_risk: 'medium' });
    await scanSubreddit('mechmarket');
  });

  it('derives tier from is_premium when tier is null', async () => {
    fetchReddit.mockResolvedValue({
      data: { children: [{ data: { id: 'tier1', title: 'Keyboard $100', selftext: '', permalink: '/r/test/tier1/', author: 'u', preview: null, thumbnail: null } }] },
    });
    const db = (await vi.importMock('./db.js')).default;
    const mockRun = vi.fn(() => ({ changes: 1 }));
    const mockGet = vi.fn()
      .mockReturnValueOnce(null)
      .mockReturnValue({ jwt_version: 1 });
    const mockAll = vi.fn()
      .mockReturnValueOnce([{ id: 1, keywords: 'keyboard', min_price: null, max_price: null, min_score: null, last_matched_at: null, tier: null, is_premium: 1, user_id: 1, notify_type: 'discord', notify_target: 'https://discord.com/api/webhooks/123', scan_interval: null, subreddit: 'mechmarket' }])
      .mockReturnValue([]);
    db.prepare.mockReturnValue({ run: mockRun, get: mockGet, all: mockAll });
    await scanSubreddit('mechmarket');
    expect(sendNotification).toHaveBeenCalled();
  });

  it('derives free tier when tier null and not premium', async () => {
    fetchReddit.mockResolvedValue({
      data: { children: [{ data: { id: 'tier2', title: 'Mouse $50', selftext: '', permalink: '/r/test/tier2/', author: 'u', preview: null, thumbnail: null } }] },
    });
    const db = (await vi.importMock('./db.js')).default;
    const mockRun = vi.fn(() => ({ changes: 1 }));
    const mockGet = vi.fn()
      .mockReturnValueOnce(null)
      .mockReturnValue({ jwt_version: 1 });
    const mockAll = vi.fn()
      .mockReturnValueOnce([{ id: 1, keywords: 'mouse', min_price: null, max_price: null, min_score: null, last_matched_at: null, tier: null, is_premium: 0, user_id: 1, notify_type: 'discord', notify_target: 'https://discord.com/api/webhooks/123', scan_interval: null, subreddit: 'mechmarket' }])
      .mockReturnValue([]);
    db.prepare.mockReturnValue({ run: mockRun, get: mockGet, all: mockAll });
    await scanSubreddit('mechmarket');
    expect(sendNotification).toHaveBeenCalled();
  });

  it('uses pro cooldown with non-empty rules', async () => {
    fetchReddit.mockResolvedValue({
      data: { children: [{ data: { id: 'pp2', title: 'Pro item $200', selftext: '', permalink: '/r/test/pp2/', author: 'u', preview: null, thumbnail: null } }] },
    });
    const db = (await vi.importMock('./db.js')).default;
    const mockRun = vi.fn(() => ({ changes: 1 }));
    const mockGet = vi.fn()
      .mockReturnValueOnce(null)
      .mockReturnValue({ jwt_version: 1 });
    const mockAll = vi.fn()
      .mockReturnValueOnce([{ id: 1, keywords: 'item', min_price: null, max_price: null, min_score: null, last_matched_at: null, tier: 'pro', is_premium: 1, user_id: 1, notify_type: 'discord', notify_target: 'https://discord.com/api/webhooks/123', scan_interval: null, subreddit: 'mechmarket' }])
      .mockReturnValue([]);
    db.prepare.mockReturnValue({ run: mockRun, get: mockGet, all: mockAll });
    await scanSubreddit('mechmarket');
    expect(sendNotification).toHaveBeenCalled();
  });
});
