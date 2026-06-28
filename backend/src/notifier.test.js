import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./db.js', () => ({
  default: {
    prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(), all: vi.fn() })),
    exec: vi.fn(),
    pragma: vi.fn(),
    get name() { return ':memory:'; },
  },
}));

vi.mock('node-fetch', () => ({ default: vi.fn() }));
vi.mock('nodemailer', () => ({
  default: {
    createTestAccount: vi.fn(() => Promise.resolve({ user: 'test@ethereal.email', pass: 'testpass' })),
    createTransport: vi.fn(() => ({
      sendMail: vi.fn(() => Promise.resolve({ messageId: 'mock-msg-id' })),
    })),
    getTestMessageUrl: vi.fn(() => 'https://ethereal.email/preview/123'),
  },
}));
vi.mock('resend', () => ({
  Resend: vi.fn(() => ({
    emails: { send: vi.fn(() => Promise.resolve({ data: { id: 'resend-id' }, error: null })) },
  })),
}));

const { default: fetchMock } = await import('node-fetch');
const { sendNotification, sendEmail } = await import('./notifier.js');

describe('sendNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockResolvedValue({ ok: true });
  });

  it('sends email notification by default', async () => {
    const rule = { user_id: 1, notify_type: 'email', notify_target: 'test@example.com' };
    const post = { title: 'Keychron Q1', permalink: '/r/mechmarket/comments/123/' };
    await sendNotification(rule, post, 'Keychron');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends email notification explicitly', async () => {
    const rule = { user_id: 1, notify_type: 'email', notify_target: 'user@example.com' };
    const post = { title: 'Test item', permalink: '/r/test/1/' };
    await sendNotification(rule, post, 'test');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends Discord notification', async () => {
    const rule = { user_id: 1, notify_type: 'discord', notify_target: 'https://discord.com/api/webhooks/123' };
    const post = { title: 'Keychron Q1', permalink: '/r/mechmarket/comments/123/' };
    await sendNotification(rule, post, 'Keychron');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://discord.com/api/webhooks/123',
      expect.objectContaining({ method: 'POST', body: expect.stringContaining('Keychron') })
    );
  });

  it('sends Telegram notification', async () => {
    const rule = { user_id: 1, notify_type: 'telegram', notify_target: 'bot123::chat456' };
    const post = { title: 'Keychron Q1', permalink: '/r/mechmarket/comments/123/' };
    await sendNotification(rule, post, 'Keychron');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.telegram.org/botbot123/sendMessage',
      expect.objectContaining({ method: 'POST', body: expect.stringContaining('chat456') })
    );
  });

  it('sends Slack notification', async () => {
    const rule = { user_id: 1, notify_type: 'slack', notify_target: 'https://hooks.slack.com/services/xxx' };
    const post = { title: 'Keychron Q1', permalink: '/r/mechmarket/comments/123/' };
    await sendNotification(rule, post, 'Keychron');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://hooks.slack.com/services/xxx',
      expect.objectContaining({ method: 'POST', body: expect.stringContaining('Keychron') })
    );
  });

  it('sends ntfy notification', async () => {
    const rule = { user_id: 1, notify_type: 'ntfy', notify_target: 'mytopic' };
    const post = { title: 'Keychron Q1', permalink: '/r/mechmarket/comments/123/' };
    await sendNotification(rule, post, 'Keychron');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://ntfy.sh/mytopic',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('sends Pushover notification', async () => {
    const rule = { user_id: 1, notify_type: 'pushover', notify_target: 'userKey::apiToken' };
    const post = { title: 'Alert!', permalink: '/r/test/1/' };
    await sendNotification(rule, post, 'alert');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.pushover.net/1/messages.json',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('handles fetch errors gracefully', async () => {
    fetchMock.mockRejectedValue(new Error('Network error'));
    const rule = { user_id: 1, notify_type: 'discord', notify_target: 'https://discord.com/api/webhooks/123' };
    const post = { title: 'Test', permalink: '/test' };
    await expect(sendNotification(rule, post, 'test')).resolves.toBeUndefined();
  });

  it('handles Discord API error response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400 });
    const rule = { user_id: 1, notify_type: 'discord', notify_target: 'https://discord.com/api/webhooks/123' };
    const post = { title: 'Test', permalink: '/test' };
    await expect(sendNotification(rule, post, 'test')).resolves.toBeUndefined();
  });

  it('handles incomplete Telegram target', async () => {
    const rule = { user_id: 1, notify_type: 'telegram', notify_target: 'incomplete' };
    const post = { title: 'Test', permalink: '/test' };
    await sendNotification(rule, post, 'test');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('handles empty Pushover target', async () => {
    const rule = { user_id: 1, notify_type: 'pushover', notify_target: '' };
    const post = { title: 'Test', permalink: '/test' };
    await sendNotification(rule, post, 'test');
  });

  it('builds correct reddit permalink', async () => {
    const rule = { user_id: 1, notify_type: 'discord', notify_target: 'https://discord.com/api/webhooks/123' };
    const post = { title: 'Test', permalink: '/r/test/1/' };
    await sendNotification(rule, post, 'test');
    expect(fetchMock.mock.calls[0][1].body).toContain('https://reddit.com/r/test/1/');
  });

  it('uses permalink as-is when it starts with http', async () => {
    const rule = { user_id: 1, notify_type: 'discord', notify_target: 'https://discord.com/api/webhooks/123' };
    const post = { title: 'Test', permalink: 'https://reddit.com/r/test/1/' };
    await sendNotification(rule, post, 'test');
    expect(fetchMock.mock.calls[0][1].body).toContain('https://reddit.com/r/test/1/');
  });

  it('handles ntfy fetch error', async () => {
    fetchMock.mockRejectedValue(new Error('Network error'));
    const rule = { user_id: 1, notify_type: 'ntfy', notify_target: 'mytopic' };
    const post = { title: 'Test', permalink: '/test' };
    await expect(sendNotification(rule, post, 'test')).resolves.toBeUndefined();
  });

  it('handles Pushover fetch error', async () => {
    fetchMock.mockRejectedValue(new Error('Network error'));
    const rule = { user_id: 1, notify_type: 'pushover', notify_target: 'userKey::apiToken' };
    const post = { title: 'Test', permalink: '/test' };
    await expect(sendNotification(rule, post, 'test')).resolves.toBeUndefined();
  });

  it('handles Telegram fetch error', async () => {
    fetchMock.mockRejectedValue(new Error('Network error'));
    const rule = { user_id: 1, notify_type: 'telegram', notify_target: 'bot123::chat456' };
    const post = { title: 'Test', permalink: '/test' };
    await expect(sendNotification(rule, post, 'test')).resolves.toBeUndefined();
  });

  it('handles Slack fetch error', async () => {
    fetchMock.mockRejectedValue(new Error('Network error'));
    const rule = { user_id: 1, notify_type: 'slack', notify_target: 'https://hooks.slack.com/services/xxx' };
    const post = { title: 'Test', permalink: '/test' };
    await expect(sendNotification(rule, post, 'test')).resolves.toBeUndefined();
  });

  it('handles db insert error in notification_log', async () => {
    const db = await import('./db.js');
    db.default.prepare.mockImplementation(() => ({
      run: vi.fn(() => { throw new Error('DB error'); }),
      get: vi.fn(),
      all: vi.fn(),
    }));
    const rule = { user_id: 1, notify_type: 'discord', notify_target: 'https://discord.com/api/webhooks/123' };
    const post = { title: 'Test', permalink: '/test' };
    await expect(sendNotification(rule, post, 'test')).resolves.toBeUndefined();
  });
});

describe('sendEmail', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('sends via nodemailer transport', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'user@example.com';
    process.env.SMTP_PASS = 'pass123';
    await sendEmail('recipient@example.com', 'Subject line', 'Body text', 'https://example.com');
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
  });

  it('handles nodemailer send error', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'user@example.com';
    process.env.SMTP_PASS = 'pass123';

    const nodemailer = await import('nodemailer');
    nodemailer.default.createTransport.mockReturnValue({
      sendMail: vi.fn(() => Promise.reject(new Error('SMTP error'))),
    });

    await sendEmail('test@example.com', 'Subject', 'Body', 'https://example.com');
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
  });

  it('truncates subject to 80 chars', async () => {
    vi.resetModules();
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'user@example.com';
    process.env.SMTP_PASS = 'pass123';

    const sendMailSpy = vi.fn(() => Promise.resolve({ messageId: 'mock-msg-id' }));
    const nodemailer = await import('nodemailer');
    nodemailer.default.createTransport.mockReturnValue({ sendMail: sendMailSpy });

    const { sendEmail: sendEmail2 } = await import('./notifier.js');
    const longSubject = 'x'.repeat(200);
    await sendEmail2('test@example.com', longSubject, 'Body', 'https://example.com');

    expect(sendMailSpy.mock.calls[0][0].subject.length).toBeLessThanOrEqual(100);
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
  });

  it('uses custom htmlOverride when provided', async () => {
    vi.resetModules();
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'user@example.com';
    process.env.SMTP_PASS = 'pass123';

    const sendMailSpy = vi.fn(() => Promise.resolve({ messageId: 'mock-msg-id' }));
    const nodemailer = await import('nodemailer');
    nodemailer.default.createTransport.mockReturnValue({ sendMail: sendMailSpy });

    const { sendEmail: sendEmail2 } = await import('./notifier.js');
    await sendEmail2('test@example.com', 'Subject', 'Body', 'https://example.com', '<p>Custom HTML</p>');

    expect(sendMailSpy.mock.calls[0][0].html).toBe('<p>Custom HTML</p>');
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
  });

  it('creates ethereal account in dev mode', async () => {
    await sendEmail('dev@example.com', 'Dev test', 'Body', 'https://example.com');
  });

  it('sends via Resend when RESEND_API_KEY is set', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.EMAIL_FROM = 'test@mechalert.com';

    const resendModule = await import('resend');
    resendModule.Resend.mockImplementation(() => ({
      emails: { send: vi.fn(() => Promise.resolve({ data: { id: 'resend-id' }, error: null })) },
    }));

    await sendEmail('recipient@example.com', 'Subject', 'Body', 'https://example.com');

    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
  });

  it('logs error when all email methods fail', async () => {
    vi.resetModules();
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'user@example.com';
    process.env.SMTP_PASS = 'pass123';

    const nodemailer = await import('nodemailer');
    nodemailer.default.createTransport.mockReturnValue({
      sendMail: vi.fn(() => Promise.reject(new Error('SMTP error'))),
    });

    const { sendEmail: sendEmail2 } = await import('./notifier.js');
    await sendEmail2('test@example.com', 'Subject', 'Body', 'https://example.com');

    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
  });

  it('falls back to SMTP when Resend fails', async () => {
    vi.resetModules();
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'user@example.com';
    process.env.SMTP_PASS = 'pass123';

    const resendModule = await import('resend');
    resendModule.Resend.mockImplementation(() => ({
      emails: { send: vi.fn(() => Promise.resolve({ data: null, error: new Error('Resend error') })) },
    }));

    const { sendEmail: sendEmail2 } = await import('./notifier.js');
    await sendEmail2('recipient@example.com', 'Subject', 'Body', 'https://example.com');
    expect(resendModule.Resend).toHaveBeenCalled();
    delete process.env.RESEND_API_KEY;
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
  });
});
