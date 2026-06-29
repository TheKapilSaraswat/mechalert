import fetch from 'node-fetch';
import nodemailer from 'nodemailer';
import sgMail from '@sendgrid/mail';
import { Resend } from 'resend';
import 'dotenv/config';
import db from './db.js';
import logger from './logger.js';

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

let resend = null;
const resendKey = process.env.RESEND_API_KEY || (process.env.SMTP_PASS?.startsWith('re_') ? process.env.SMTP_PASS : null);
if (resendKey) {
  try { resend = new Resend(resendKey); } catch (e) { logger.warn('Resend init failed', { error: e.message }); }
}

let transporter = null;

async function getTransporter() {
  if (transporter) return transporter;
  if (process.env.SMTP_HOST) {
    const port = parseInt(process.env.SMTP_PORT || '587');
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  } else {
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email', port: 587,
      auth: { user: testAccount.user, pass: testAccount.pass },
    });
    logger.info('Dev mode — preview emails at https://ethereal.email');
    logger.info(`Dev login: ${testAccount.user} / ${testAccount.pass}`);
  }
  return transporter;
}

export async function sendNotification(rule, post, matchedKeyword) {
  const title = post.title;
  const url = post.permalink?.startsWith('http') ? post.permalink : `https://reddit.com${post.permalink}`;
  const text = `Deal Match!\n\nMatched: "${matchedKeyword}"\n${title}\n${url}`;

  try {
    db.prepare('INSERT INTO notification_log (user_id, type, channel, subject, body) VALUES (?, ?, ?, ?, ?)')
      .run(rule.user_id, 'match', rule.notify_type, `Match: ${matchedKeyword}`, text);
  } catch {}

  switch (rule.notify_type) {
    case 'discord':
      await sendDiscord(rule.notify_target, text);
      break;
    case 'telegram':
      await sendTelegram(rule.notify_target, text);
      break;
    case 'slack':
      await sendSlack(rule.notify_target, text);
      break;
    case 'ntfy':
      await sendNtfy(rule.notify_target, title);
      break;
    case 'pushover':
      await sendPushover(rule.notify_target, title, text);
      break;
    case 'email':
      db.prepare('INSERT INTO email_queue (user_id, rule_id, post_id, matched_keyword, title, price, permalink) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(rule.user_id, rule.id, post.post_id || post.id, matchedKeyword, post.title, post.price || null, url);
      break;
    default:
      logger.warn('Unknown notify_type', { type: rule.notify_type });
      break;
  }
}

export async function sendEmail(to, subject, text, url, htmlOverride) {
  const from = process.env.EMAIL_FROM || 'MechAlert <noreply@mechalert.com>';
  const subjectPrefixed = `[MechAlert] ${subject.substring(0, 80)}`;
  const html = htmlOverride || `<p><strong>Deal Match!</strong></p><p>${text.replace(/\n/g, '<br>')}</p>`;

  if (process.env.SENDGRID_API_KEY) {
    try {
      await sgMail.send({
        to,
        from,
        subject: subjectPrefixed,
        text,
        html,
      });
      logger.info('Email sent via SendGrid', { to });
      return;
    } catch (err) {
      logger.error('SendGrid error, falling back', { error: err.message, details: err.response?.body });
    }
  }

  if (resend) {
    try {
      const { data, error } = await resend.emails.send({
        from,
        to,
        subject: subjectPrefixed,
        text,
        html,
      });
      if (error) {
        logger.error('Resend API error', { error: error.message, details: error });
        throw error;
      }
      logger.info('Email sent via Resend API', { id: data?.id, to });
      return;
    } catch (err) {
      logger.error('Resend API failed, falling back to SMTP', { error: err.message });
    }
  }

  try {
    const t = await getTransporter();
    const info = await t.sendMail({
      from,
      to,
      subject: subjectPrefixed,
      text,
      html,
    });
    if (info.messageId && !process.env.SMTP_HOST) {
      logger.warn(`Email NOT delivered to ${to} — no SMTP_HOST configured. Preview in Ethereal: ${nodemailer.getTestMessageUrl(info)}`);
    } else {
      logger.info('Email sent via SMTP', { messageId: info.messageId, to });
    }
  } catch (err) {
    logger.error('Send error (all methods failed)', { error: err.message, stack: err.stack });
  }
}

async function sendDiscord(webhookUrl, text) {
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text })
    });
  } catch (err) {
    logger.error('Discord error', { error: err.message });
  }
}

async function sendTelegram(target, text) {
  try {
    const [botToken, chatId] = target.split('::');
    if (!botToken || !chatId) return;
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text })
    });
  } catch (err) {
    logger.error('Telegram error', { error: err.message });
  }
}

async function sendSlack(webhookUrl, text) {
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
  } catch (err) {
    logger.error('Slack error', { error: err.message });
  }
}

async function sendNtfy(topic, title) {
  try {
    const url = `https://ntfy.sh/${topic}`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Title': `[MechAlert] ${title.substring(0, 80)}`, 'Priority': 'high' },
      body: 'New deal match found!'
    });
  } catch (err) {
    logger.error('Ntfy error', { error: err.message });
  }
}

async function sendPushover(target, title, text) {
  try {
    const [userKey, apiToken] = target.split('::');
    if (!userKey || !apiToken) return;
    await fetch('https://api.pushover.net/1/messages.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: apiToken,
        user: userKey,
        title: `[MechAlert] ${title.substring(0, 80)}`,
        message: text,
        priority: 1,
      })
    });
  } catch (err) {
    logger.error('Pushover error', { error: err.message });
  }
}
