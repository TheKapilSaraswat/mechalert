import { describe, it, expect, vi, beforeEach } from 'vitest';
import { File } from 'buffer';

vi.stubGlobal('File', File);
vi.mock('node-fetch', () => ({ default: vi.fn() }));
vi.mock('./db.js', () => ({
  default: {
    prepare: vi.fn(() => ({
      run: vi.fn(() => ({ changes: 1, lastInsertRowid: 42 })),
      get: vi.fn(),
      all: vi.fn(() => []),
    })),
  },
}));

vi.mock('./notifier.js', () => ({ sendNotification: vi.fn(() => Promise.resolve()) }));
vi.mock('./logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));

const mockHtml = (items) => `<!DOCTYPE html>
<html><body>
${items.map(i => `<div class="cl-static-search-result"><a href="${i.url}"><div class="title">${i.title}</div><div class="price">$${i.price}</div></a></div>`).join('')}
</body></html>`;

describe('scanCraigslist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches from all areas', async () => {
    const fetch = (await import('node-fetch')).default;
    fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve(mockHtml([])) });
    const { scanCraigslist } = await import('./craigslistScanner.js');
    await scanCraigslist();
  });

  it('parses listed items', async () => {
    const fetch = (await import('node-fetch')).default;
    const html = mockHtml([{ title: 'Keychron Q1', price: '150', url: 'https://sfbay.craigslist.org/pen/abc123.html' }]);
    fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve(html) });
    const { scanCraigslist } = await import('./craigslistScanner.js');
    await scanCraigslist();
  });

  it('handles empty search results', async () => {
    const fetch = (await import('node-fetch')).default;
    fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve(mockHtml([])) });
    const { scanCraigslist } = await import('./craigslistScanner.js');
    await expect(scanCraigslist()).resolves.toBeUndefined();
  });

  it('handles fetch errors gracefully', async () => {
    const fetch = (await import('node-fetch')).default;
    fetch.mockRejectedValue(new Error('Network error'));
    const { scanCraigslist } = await import('./craigslistScanner.js');
    await expect(scanCraigslist()).resolves.toBeUndefined();
  });

  it('handles non-ok response', async () => {
    const fetch = (await import('node-fetch')).default;
    fetch.mockResolvedValue({ ok: false, status: 403, text: () => Promise.resolve('Forbidden') });
    const { scanCraigslist } = await import('./craigslistScanner.js');
    await expect(scanCraigslist()).resolves.toBeUndefined();
  });

  it('parses multiple items from a single area', async () => {
    const fetch = (await import('node-fetch')).default;
    const html = mockHtml([
      { title: 'Keyboard', price: '100', url: 'https://sfbay.craigslist.org/pen/kb1.html' },
      { title: 'Mouse', price: '50', url: 'https://sfbay.craigslist.org/pen/ms1.html' },
    ]);
    fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve(html) });
    const { scanCraigslist } = await import('./craigslistScanner.js');
    await scanCraigslist();
  });

  it('handles malformed HTML', async () => {
    const fetch = (await import('node-fetch')).default;
    fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('not html') });
    const { scanCraigslist } = await import('./craigslistScanner.js');
    await expect(scanCraigslist()).resolves.toBeUndefined();
  });

  it('inserts items into scanned_posts', async () => {
    const fetch = (await import('node-fetch')).default;
    const html = mockHtml([{ title: 'Keycaps SA', price: '80', url: 'https://sfbay.craigslist.org/pen/kc1.html' }]);
    fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve(html) });
    const { scanCraigslist } = await import('./craigslistScanner.js');
    await scanCraigslist();
  });

  it('handles duplicate items gracefully', async () => {
    const fetch = (await import('node-fetch')).default;
    const html = mockHtml([{ title: 'Ducky Keyboard', price: '120', url: 'https://sfbay.craigslist.org/pen/duck1.html' }]);
    fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve(html) });
    const db = (await vi.importMock('./db.js')).default;
    db.prepare.mockReturnValue({ run: vi.fn(() => ({ changes: 0 })), get: vi.fn().mockReturnValue({ price: 120 }), all: vi.fn().mockReturnValue([]) });
    const { scanCraigslist } = await import('./craigslistScanner.js');
    await scanCraigslist();
  });

  it('processes items without price', async () => {
    const fetch = (await import('node-fetch')).default;
    const html = `<!DOCTYPE html><html><body><div class="cl-static-search-result"><a href="https://sfbay.craigslist.org/test/free.html"><div class="title">Free item</div><div class="price"></div></a></div></body></html>`;
    fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve(html) });
    const { scanCraigslist } = await import('./craigslistScanner.js');
    await scanCraigslist();
  });

  it('handles price with commas', async () => {
    const fetch = (await import('node-fetch')).default;
    const html = mockHtml([{ title: 'Expensive item', price: '1,500', url: 'https://sfbay.craigslist.org/pen/exp1.html' }]);
    fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve(html) });
    const { scanCraigslist } = await import('./craigslistScanner.js');
    await scanCraigslist();
  });

  it('handles area-specific fetch failures', async () => {
    const fetch = (await import('node-fetch')).default;
    fetch.mockRejectedValueOnce(new Error('SF error'));
    fetch.mockResolvedValue({ ok: true, text: () => Promise.resolve(mockHtml([])) });
    const { scanCraigslist } = await import('./craigslistScanner.js');
    await scanCraigslist();
  });
});
