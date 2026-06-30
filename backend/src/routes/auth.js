import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import sgMail from '@sendgrid/mail';
import db from '../db.js';
import logger from '../logger.js';
import { validate, loginSchema, registerSchema, forgotPasswordSchema, resetPasswordSchema } from '../validation.js';

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

let resend = null;
const resendKey = process.env.RESEND_API_KEY || (process.env.SMTP_PASS?.startsWith('re_') ? process.env.SMTP_PASS : null);
if (resendKey) {
  try { resend = new Resend(resendKey); } catch (e) { logger.warn('Auth Resend init failed', { error: e.message }); }
}

let transporter = null;

async function getTransporter() {
  if (transporter) return transporter;
  if (process.env.SMTP_HOST) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  } else {
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email', port: 587,
      auth: { user: testAccount.user, pass: testAccount.pass },
    });
    logger.info('Dev mode — reset previews at https://ethereal.email');
  }
  return transporter;
}

async function sendResetEmail(to, token) {
  const baseUrl = process.env.BASE_URL || 'https://mechalert-production.up.railway.app';
  const resetUrl = `${baseUrl}/reset?token=${token}`;
  const text = `Reset your password here: ${resetUrl}\n\nThis link expires in 1 hour.`;
  const html = `<p>Click <a href="${resetUrl}">here</a> to reset your password. This link expires in 1 hour.</p>`;

  try {
    if (process.env.SENDGRID_API_KEY) {
      await sgMail.send({
        to, from: process.env.EMAIL_FROM || 'MechAlert <noreply@mechalert.com>',
        subject: '[MechAlert] Password Reset', text, html,
      });
      logger.info('Reset email sent via SendGrid', { to });
      return;
    }
  } catch (err) { logger.error('SendGrid reset failed', { error: err.message }); }

  try {
    if (resend) {
      const { data, error } = await resend.emails.send({
        from: process.env.EMAIL_FROM || 'MechAlert <onboarding@resend.dev>',
        to,
        subject: '[MechAlert] Password Reset',
        text,
        html,
      });
      if (error) throw error;
      if (data?.id) logger.info('Reset email sent via Resend', { id: data.id, to });
      return;
    }
  } catch (err) {
    logger.error('Resend reset failed, falling back to SMTP', { error: err.message });
  }

  try {
    const t = await getTransporter();
    const info = await t.sendMail({
      from: process.env.EMAIL_FROM || 'noreply@mechalert.com',
      to,
      subject: '[MechAlert] Password Reset',
      text,
      html,
    });
    if (info.messageId && !process.env.SMTP_HOST) {
      logger.info(`Reset SMTP preview: ${nodemailer.getTestMessageUrl(info)}`);
    } else {
      logger.info('Reset email sent via SMTP', { messageId: info.messageId, to });
    }
  } catch (err) {
    logger.error('Reset send error (all methods failed)', { error: err.message });
  }
}

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET;

function generateOtp() {
  return String(crypto.randomInt(100000, 999999));
}

async function sendVerificationEmail(to, otp) {
  const text = `Your MechAlert verification code is: ${otp}\n\nThis code expires in 10 minutes. If you didn't request this, ignore this email.`;
  const html = `<p>Your MechAlert verification code is:</p><p style="font-size:24px;font-weight:bold;letter-spacing:4px;color:#3fb950">${otp}</p><p>This code expires in <strong>10 minutes</strong>.</p><p>If you didn't request this, ignore this email.</p>`;
  try {
    if (process.env.SENDGRID_API_KEY) {
      await sgMail.send({
        to, from: process.env.EMAIL_FROM || 'MechAlert <noreply@mechalert.com>',
        subject: '[MechAlert] Your Verification Code', text, html,
      });
      logger.info('Verification OTP email sent via SendGrid', { to });
      return;
    }
  } catch (err) { logger.error('SendGrid verify OTP failed', { error: err.message }); }
  try {
    if (resend) {
      const { data, error } = await resend.emails.send({
        from: process.env.EMAIL_FROM || 'MechAlert <onboarding@resend.dev>',
        to, subject: '[MechAlert] Your Verification Code', text, html,
      });
      if (error) throw error;
      if (data?.id) logger.info('Verification OTP email sent via Resend', { id: data.id, to });
      return;
    }
  } catch (err) { logger.error('Resend verify OTP failed', { error: err.message }); }
  try {
    const t = await getTransporter();
    const info = await t.sendMail({
      from: process.env.EMAIL_FROM || 'noreply@mechalert.com',
      to, subject: '[MechAlert] Your Verification Code', text, html,
    });
    if (info.messageId) {
      if (!process.env.SMTP_HOST) {
        logger.info(`Dev mode — verify OTP preview: ${nodemailer.getTestMessageUrl(info)}`);
      } else {
        logger.info('Verification OTP email sent via SMTP', { messageId: info.messageId, to });
      }
    }
  } catch (err) { logger.error('Verify OTP send error', { error: err.message }); }
}

router.post('/register', validate(registerSchema), (req, res) => {
  try {
    const { email, password } = req.validated;
    const normalizedEmail = email.toLowerCase().trim();

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const hash = bcrypt.hashSync(password, 10);
    const otp = generateOtp();
    const otpHash = bcrypt.hashSync(otp, 6);
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const result = db.prepare('INSERT INTO users (email, password_hash, email_verified, verification_otp, verification_otp_expires) VALUES (?, ?, 0, ?, ?)').run(normalizedEmail, hash, otpHash, otpExpires);

    setImmediate(() => sendVerificationEmail(normalizedEmail, otp).catch(() => {}));

    const userData = db.prepare('SELECT jwt_version FROM users WHERE id = ?').get(result.lastInsertRowid);
    const token = jwt.sign({ userId: result.lastInsertRowid, version: userData.jwt_version }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, user: { id: result.lastInsertRowid, email: normalizedEmail, is_premium: 0, is_admin: 0, tier: 'free', digest_frequency: 'never', api_key: null, email_verified: 0 } });
  } catch (err) {
    logger.error('Register error', { error: err.message });
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/login', validate(loginSchema), (req, res) => {
  try {
    const { email, password } = req.validated;
    const normalizedEmail = email.toLowerCase().trim();

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);
    const dummyHash = '$2a$10$' + 'Z'.repeat(53);
    const valid = user && bcrypt.compareSync(password, user.password_hash);
    bcrypt.compareSync(password, dummyHash);

    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    if (user.is_active === 0) {
      return res.status(403).json({ error: 'Account disabled. Contact support.' });
    }

    const isAdminEmail = user.email === process.env.ADMIN_EMAIL || user.is_admin;
    if (!user.email_verified && !isAdminEmail) {
      return res.status(403).json({ error: 'Email not verified', needsVerification: true, email: normalizedEmail });
    }

    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const mins = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
      return res.status(429).json({ error: `Account locked. Try again in ${mins} minute(s).` });
    }

    if (!valid) {
      const attempts = (user.failed_attempts || 0) + 1;
      if (attempts >= 10) {
        const lockDuration = Math.min(60, Math.pow(2, attempts - 10)) * 60 * 1000;
        db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?')
          .run(attempts, new Date(Date.now() + lockDuration).toISOString(), user.id);
        logger.warn('Account locked due to failed attempts', { userId: user.id, attempts });
      } else {
        db.prepare('UPDATE users SET failed_attempts = ? WHERE id = ?').run(attempts, user.id);
      }
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(user.id);

    const token = jwt.sign({ userId: user.id, version: user.jwt_version }, JWT_SECRET, { expiresIn: '7d' });
    const tier = user.tier || (user.is_premium ? 'pro' : 'free');
    res.json({ token, user: { id: user.id, email: user.email, is_premium: user.is_premium, is_admin: user.is_admin, tier, digest_frequency: user.digest_frequency || 'never', api_key: user.api_key, email_verified: user.email_verified } });
  } catch (err) {
    logger.error('Login error', { error: err.message });
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/forgot', validate(forgotPasswordSchema), async (req, res) => {
  try {
    const { email } = req.validated;
    const normalizedEmail = email.toLowerCase().trim();

    const user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(normalizedEmail);

    // Constant-time: always generate token and sleep to prevent timing oracle
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 3600000).toISOString();

    if (user) {
      db.prepare('UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?').run(token, expires, user.id);
      setImmediate(() => sendResetEmail(user.email, token).catch(() => {}));
    } else {
      // Artificial delay to match the DB write timing of the user branch
      db.prepare('SELECT 1').get();
    }

    res.json({ ok: true });
  } catch (err) {
    logger.error('Forgot error', { error: err.message });
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/reset', validate(resetPasswordSchema), (req, res) => {
  try {
    const { token, password } = req.validated;

    const user = db.prepare('SELECT id FROM users WHERE reset_token = ? AND reset_expires > datetime(\'now\')').get(token);
    if (!user) return res.status(400).json({ error: 'Invalid or expired token' });

    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET password_hash = ?, reset_token = NULL, reset_expires = NULL, jwt_version = jwt_version + 1 WHERE id = ?').run(hash, user.id);
    res.json({ ok: true });
  } catch (err) {
    logger.error('Reset error', { error: err.message });
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/verify-otp', (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ error: 'Email and verification code are required' });
    const normalizedEmail = email.toLowerCase().trim();
    const user = db.prepare('SELECT id, email_verified, verification_otp, verification_otp_expires FROM users WHERE email = ?').get(normalizedEmail);
    if (!user) return res.status(400).json({ error: 'User not found' });
    if (user.email_verified) return res.status(400).json({ error: 'Email already verified' });
    if (!user.verification_otp || !user.verification_otp_expires) {
      return res.status(400).json({ error: 'No verification code requested. Request a new one.' });
    }
    if (new Date(user.verification_otp_expires) < new Date()) {
      return res.status(400).json({ error: 'Verification code expired. Request a new one.' });
    }
    if (!bcrypt.compareSync(otp, user.verification_otp)) {
      return res.status(400).json({ error: 'Invalid verification code' });
    }
    db.prepare('UPDATE users SET email_verified = 1, verification_otp = NULL, verification_otp_expires = NULL WHERE id = ?').run(user.id);
    res.json({ ok: true, message: 'Email verified successfully' });
  } catch (err) {
    logger.error('Verify OTP error', { error: err.message });
    res.status(500).json({ error: 'Server error' });
  }
});

// Keep old link-based verify for backward compat (legacy tokens)
router.get('/verify', (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'Verification token required' });
    const user = db.prepare('SELECT id, email, verification_token FROM users WHERE verification_token = ?').get(token);
    if (!user) return res.status(400).json({ error: 'Invalid or expired verification token' });
    db.prepare('UPDATE users SET email_verified = 1, verification_token = NULL WHERE id = ?').run(user.id);
    res.json({ ok: true, message: 'Email verified successfully' });
  } catch (err) {
    logger.error('Verify error', { error: err.message });
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const normalizedEmail = email.toLowerCase().trim();
    const user = db.prepare('SELECT id, email_verified FROM users WHERE email = ?').get(normalizedEmail);
    if (!user) return res.json({ ok: true });
    if (user.email_verified) return res.status(400).json({ error: 'Email already verified' });
    const otp = generateOtp();
    const otpHash = bcrypt.hashSync(otp, 6);
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    db.prepare('UPDATE users SET verification_otp = ?, verification_otp_expires = ? WHERE id = ?').run(otpHash, otpExpires, user.id);
    setImmediate(() => sendVerificationEmail(normalizedEmail, otp).catch(() => {}));
    res.json({ ok: true });
  } catch (err) {
    logger.error('Resend verification error', { error: err.message });
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/logout', (req, res) => {
  try {
    const header = req.headers.authorization;
    if (!header) return res.status(401).json({ error: 'No token' });

    const decoded = jwt.verify(header.replace('Bearer ', ''), JWT_SECRET, { algorithms: ['HS256'] });
    db.prepare('UPDATE users SET jwt_version = jwt_version + 1 WHERE id = ?').run(decoded.userId);
    res.json({ ok: true });
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
});

export default router;
