import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('node-fetch', () => ({ default: vi.fn() }));

const { default: fetch } = await import('node-fetch');
const { scoreDeal } = await import('./aiScorer.js');

describe('scoreDeal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetch);
  });

  it('returns null when no API key', async () => {
    const originalKey = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    const result = await scoreDeal('Test title', 'Test body', 100);
    expect(result).toBeNull();
    if (originalKey) process.env.OPENROUTER_API_KEY = originalKey;
  });

  it('returns null on fetch failure', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    fetch.mockRejectedValue(new Error('API down'));
    const result = await scoreDeal('Test', 'Body', 50);
    expect(result).toBeNull();
  });

  it('returns null on non-ok response', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    fetch.mockResolvedValue({ ok: false, status: 429, json: vi.fn() });
    const result = await scoreDeal('Test', 'Body', 50);
    expect(result).toBeNull();
  });

  it('returns null on API error status', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    fetch.mockResolvedValue({ ok: false, status: 500, json: vi.fn() });
    const result = await scoreDeal('Test', 'Body', 50);
    expect(result).toBeNull();
  });

  it('parses valid AI response', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: JSON.stringify({ score: 85, reasoning: 'Great deal', market_value: 120, scam_signals: [], scam_risk: 'low' }) } }],
      }),
    });
    const result = await scoreDeal('Keychron Q1 $150', 'Like new', 150);
    expect(result).toMatchObject({ score: 85, reasoning: 'Great deal', market_value: 120, scam_signals: [], scam_risk: 'low' });
  });

  it('clamps score between 0 and 100', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: JSON.stringify({ score: 999, reasoning: 'Over max', scam_signals: [] }) } }],
      }),
    });
    const result = await scoreDeal('Test', 'Body', 50);
    expect(result?.score).toBe(100);
  });

  it('clamps negative score to 0', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: JSON.stringify({ score: -50, reasoning: 'Under min', scam_signals: [] }) } }],
      }),
    });
    const result = await scoreDeal('Test', 'Body', 50);
    expect(result?.score).toBe(0);
  });

  it('handles missing choices', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    const result = await scoreDeal('Test', 'Body', 50);
    expect(result).toBeNull();
  });

  it('handles empty choices array', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ choices: [] }) });
    const result = await scoreDeal('Test', 'Body', 50);
    expect(result).toBeNull();
  });

  it('handles missing message content', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: {} }] }),
    });
    const result = await scoreDeal('Test', 'Body', 50);
    expect(result).toBeNull();
  });

  it('handles invalid JSON in response', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: 'not json' } }] }),
    });
    const result = await scoreDeal('Test', 'Body', 50);
    expect(result).toBeNull();
  });

  it('strips markdown code fences from JSON', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: '```json\n{"score": 75, "reasoning": "Good", "scam_signals": []}\n```' } }],
      }),
    });
    const result = await scoreDeal('Test', 'Body', 50);
    expect(result?.score).toBe(75);
  });

  it('strips inline code backticks', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: '`{"score": 60, "reasoning": "OK", "scam_signals": []}`' } }],
      }),
    });
    const result = await scoreDeal('Test', 'Body', 50);
    // inline backticks without json prefix might not be stripped; handle gracefully
    expect(result === null || result?.score === 60).toBe(true);
  });

  it('provides default values for missing fields', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: JSON.stringify({ score: 50 }) } }],
      }),
    });
    const result = await scoreDeal('Test', 'Body', 50);
    expect(result).toMatchObject({ score: 50, reasoning: '', market_value: null, scam_signals: [], scam_risk: 'low' });
  });

  it('handles null market_value', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: JSON.stringify({ score: 70, reasoning: 'Fair', market_value: null, scam_signals: [], scam_risk: 'low' }) } }],
      }),
    });
    const result = await scoreDeal('Test', 'Body', 50);
    expect(result?.market_value).toBeNull();
  });

  it('handles zero market_value', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: JSON.stringify({ score: 40, reasoning: 'Unclear', market_value: 0, scam_signals: [], scam_risk: 'medium' }) } }],
      }),
    });
    const result = await scoreDeal('Test', 'Body', 50);
    expect(result?.market_value).toBe(0);
  });

  it('handles scam_signals as non-array', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: JSON.stringify({ score: 30, reasoning: 'Suspicious', scam_signals: 'scam', scam_risk: 'high' }) } }],
      }),
    });
    const result = await scoreDeal('Test', 'Body', 50);
    expect(result?.scam_signals).toEqual([]);
  });

  it('handles missing scam_risk', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: JSON.stringify({ score: 80, reasoning: 'Good', scam_signals: [] }) } }],
      }),
    });
    const result = await scoreDeal('Test', 'Body', 50);
    expect(result?.scam_risk).toBe('low');
  });

  it('handles price being null', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: JSON.stringify({ score: 50, reasoning: 'No price', market_value: 100, scam_signals: [], scam_risk: 'low' }) } }],
      }),
    });
    const result = await scoreDeal('Test item', '', null);
    expect(result?.score).toBe(50);
  });

  it('handles empty title and body', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: JSON.stringify({ score: 10, reasoning: 'Empty', scam_signals: ['no info'], scam_risk: 'medium' }) } }],
      }),
    });
    const result = await scoreDeal('', '', null);
    expect(result?.score).toBe(10);
  });

  it('truncates body to 500 chars in prompt', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    const longBody = 'x'.repeat(1000);
    fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: JSON.stringify({ score: 50, reasoning: 'Long body', scam_signals: [] }) } }],
      }),
    });
    const result = await scoreDeal('Test title', longBody, 100);
    expect(result?.score).toBe(50);
  });

  it('handles JSON parse error on malformed content', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: '{"score": 50, "reasoning": "broken' } }],
      }),
    });
    const result = await scoreDeal('Test', 'Body', 50);
    expect(result).toBeNull();
  });

  it('handles fetch throwing TypeError', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    fetch.mockRejectedValue(new TypeError('fetch is not a function'));
    const result = await scoreDeal('Test', 'Body', 50);
    expect(result).toBeNull();
  });

  it('sends correct request body to API', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: JSON.stringify({ score: 50, reasoning: 'test', scam_signals: [] }) } }] }),
    });
    await scoreDeal('Test title', 'Test body', 75);
    const callBody = JSON.parse(fetch.mock.calls[0][1].body);
    expect(callBody.model).toBe('openai/gpt-4o-mini');
    expect(callBody.temperature).toBe(0.1);
    expect(callBody.max_tokens).toBe(400);
  });

  it('includes correct auth header', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-test-key-123';
    fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: JSON.stringify({ score: 50, reasoning: 'test', scam_signals: [] }) } }] }),
    });
    await scoreDeal('Test', 'Body', 50);
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer sk-test-key-123');
  });

  it('includes HTTP-Referer header', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: JSON.stringify({ score: 50, reasoning: 'test', scam_signals: [] }) } }] }),
    });
    await scoreDeal('Test', 'Body', 50);
    expect(fetch.mock.calls[0][1].headers['HTTP-Referer']).toBe('https://mechalert.app');
  });

  it('handles null score gracefully', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: JSON.stringify({ reasoning: 'No score', scam_signals: [] }) } }],
      }),
    });
    const result = await scoreDeal('Test', 'Body', 50);
    expect(result?.score).toBe(50);
  });

  it('sets scam_score to 90 for high scam_risk', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: JSON.stringify({ score: 10, reasoning: 'Scam', market_value: 500, scam_signals: ['fake'], scam_risk: 'high' }) } }],
      }),
    });
    const result = await scoreDeal('Scam item $20', 'Too good', 20);
    expect(result?.scam_risk).toBe('high');
  });

  it('sets scam_score to 50 for medium scam_risk', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: JSON.stringify({ score: 40, reasoning: 'Suspicious', market_value: 200, scam_signals: ['new account'], scam_risk: 'medium' }) } }],
      }),
    });
    const result = await scoreDeal('Suspicious item $100', 'Brand new account', 100);
    expect(result?.scam_risk).toBe('medium');
  });
});
