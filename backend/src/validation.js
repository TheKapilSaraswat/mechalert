import { z } from 'zod';

export function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = result.error.flatten().fieldErrors;
      return res.status(400).json({ error: 'Validation failed', details: errors });
    }
    req.validated = result.data;
    next();
  };
}

export const createAlertRuleSchema = z.object({
  keywords: z.string().trim().min(1).max(500),
  subreddit: z.string().max(100).optional().default('mechmarket'),
  min_price: z.number().min(0).nullable().optional(),
  max_price: z.number().min(0).nullable().optional(),
  min_score: z.number().min(0).max(100).nullable().optional(),
  scan_interval: z.number().int().min(1).max(1440).nullable().optional(),
  notify_type: z.enum(['email', 'discord', 'telegram', 'slack', 'ntfy', 'pushover']).optional().default('email'),
  notify_target: z.string().min(1).max(500),
});

export const updateAlertRuleSchema = z.object({
  keywords: z.string().trim().min(1).max(500).optional(),
  subreddit: z.string().max(100).optional(),
  min_price: z.number().min(0).nullable().optional(),
  max_price: z.number().min(0).nullable().optional(),
  min_score: z.number().min(0).max(100).nullable().optional(),
  scan_interval: z.number().int().min(1).max(1440).nullable().optional(),
  notify_type: z.enum(['email', 'discord', 'telegram', 'slack', 'ntfy', 'pushover']).optional(),
  notify_target: z.string().min(1).max(500).optional(),
  is_active: z.number().int().min(0).max(1).optional(),
});

export const createSavedDealSchema = z.object({
  post_id: z.string().min(1).max(200),
  notes: z.string().max(1000).nullable().optional(),
});

export const updateSavedDealSchema = z.object({
  notes: z.string().max(1000).nullable().optional(),
});

export const searchQuerySchema = z.object({
  query: z.string().min(1).max(500),
});

export const webhookPostSchema = z.object({
  id: z.string().min(1).max(200),
  title: z.string().min(1).max(500),
  body: z.string().optional(),
  price: z.number().nullable().optional(),
  permalink: z.string().max(1000).optional(),
  subreddit: z.string().max(100).optional(),
  source: z.string().max(100).optional(),
});

export const loginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
});

export const registerSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email().max(255),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1).max(500),
  password: z.string().min(8).max(128),
});