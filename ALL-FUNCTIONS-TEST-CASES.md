# MechAlert — Complete Function Audit & Test Cases

> Generated from full codebase analysis: backend routes, frontend pages, core modules, infra, env.
> Every endpoint, every component, every module. Bugs, gaps, security issues, edge cases documented.

---

## 1. AUTHENTICATION (`backend/src/routes/auth.js`)

### 1.1 POST /auth/register
- [ ] Valid email + password ≥6 chars → 201 + JWT + user
- [ ] Duplicate email (case-insensitive) → **BUG: "Email already registered" but query `WHERE email = LOWER(?)` while unique constraint is case-sensitive → creates duplicate if case differs**
- [ ] Password <6 chars → 400 Zod error
- [ ] Invalid email format → 400 Zod error
- [ ] No body → 400
- [ ] XSS in email field → stored as-is in DB, reflected in UI
- [ ] SQL injection in email/password → should be prevented by parameterized queries
- [ ] Race condition: same email registered twice simultaneously → should use SQLite UNIQUE constraint
- [ ] Token returned in response body (not HttpOnly cookie) → vulnerable to XSS token theft
- [ ] No email verification step → user can access immediately

### 1.2 POST /auth/login
- [ ] Valid credentials → 200 + JWT + user
- [ ] Wrong password → 401 "Invalid email or password"
- [ ] Non-existent email → 401 "Invalid email or password"
- [ ] Empty body → 400
- [ ] Brute force: no account lockout, no IP-based rate limiting per-user
- [ ] Token re-use after password change → JWT is still valid (7d expiry, no revocation)
- [ ] Login with disabled/banned user → no `is_active` check in query
- [ ] Case-insensitive email lookup → `WHERE LOWER(email) = LOWER(?)` (matches register behavior)
- [ ] Response includes `user` object — verify no sensitive fields leaked (password hash not returned)

### 1.3 GET /auth/me
- [ ] Valid token → 200 + user object
- [ ] Expired token → 401
- [ ] Malformed token → 401
- [ ] No Authorization header → 401
- [ ] Token from deleted user → 401 but no explicit check if user still exists in DB
- [ ] Token manipulation (alg:none attack) → library should reject
- [ ] Weak JWT secret → HS256 with `change-this-to-a-random-string-at-least-32-chars` default
- [ ] No user tier enrichment → frontend adds fallback: `data.tier = data.tier || (data.is_premium ? 'pro' : 'free')`

### 1.4 POST /auth/forgot
- [ ] Valid email → 200, email sent with reset link
- [ ] Non-existent email → **BUG: returns 200 with "If an account exists..." — but also returns same for non-existent → timing side-channel possible if DB query differs**
- [ ] Invalid email format → 400 Zod
- [ ] Rate limiting exhausted → 429
- [ ] Token stored in DB with 1h TTL — verify token cleanup
- [ ] Reset link includes token in URL query param → logged in server logs, referer headers
- [ ] SMTP failure → caught by try/catch, returns 200 but no email sent (silent failure)

### 1.5 POST /auth/reset
- [ ] Valid token + new password → 200, password changed
- [ ] Expired token → 400 "Invalid or expired token"
- [ ] Already-used token → token deleted after use, so 400
- [ ] Weak password (<6 chars) → 400 Zod
- [ ] Token brute-force → 32-byte random hex (64 chars), impractical
- [ ] No confirmation field in request → single password field, no typo protection on frontend

### 1.6 Auth Middleware (`authenticateToken`)
- [ ] Skips token verification if `WEBHOOK_SECRET` header matches (for webhook bypass) → verify this doesn't bypass auth on non-webhook routes
- [ ] Sets `req.user` with payload — verify all routes check `req.user` properly
- [ ] Some routes pass `req.user?.id` — optional chaining masks missing auth

---

## 2. ALERTS (`backend/src/routes/alerts.js`)

### 2.1 GET /api/alerts
- [ ] Returns all alerts for authenticated user
- [ ] Respects tier limits (free=5, pro=unlimited) — query uses user_tier from DB
- [ ] Empty list → 200 []
- [ ] No auth → 401
- [ ] Pagination? Not implemented — returns all at once
- [ ] Includes matches per alert? No — separate endpoint

### 2.2 POST /api/alerts
- [ ] Create alert with keywords, source, max_price, min_price, subreddit
- [ ] Over tier limit → **BUG: Returns whatever error, check if message is user-friendly**
- [ ] Zod validation failure → 400
- [ ] Missing keywords → 400
- [ ] XSS in keywords field → stored, rendered in Dashboard
- [ ] Create with duplicate keywords for same user → should be allowed (no unique constraint on keywords per user)
- [ ] `is_active` defaults to `true`

### 2.3 PUT /api/alerts/:id
- [ ] Update owned alert → 200
- [ ] Update another user's alert → **BUG: `WHERE id = ? AND user_id = ?` — should 404/403, verify behavior**
- [ ] Update non-existent id → 0 rows affected, returns 200 with empty? Check response
- [ ] Partial update → verify only provided fields updated

### 2.4 DELETE /api/alerts/:id
- [ ] Delete owned alert → 200
- [ ] Delete another user's alert → user_id check prevents
- [ ] Delete non-existent → 0 rows

### 2.5 POST /api/alerts/:id/toggle
- [ ] Toggle active/paused → flips `is_active`
- [ ] Toggle non-owned → user_id check

### 2.6 POST /api/alerts/:id/test
- [ ] Runs matcher against recent deals
- [ ] Returns matches without persisting
- [ ] Timeout for large result sets?

### 2.7 GET /api/alerts/matches
- [ ] Returns matches for user's alerts
- [ ] Ordered by recency
- [ ] Empty → []

### 2.8 Edge cases
- [ ] Concurrent create → SQLite WAL mode handles
- [ ] Special characters in keywords (regex injection?) — not using regex, uses `LIKE '%keyword%'`
- [ ] Very long keywords → truncation? No max length in Zod schema

---

## 3. API KEYS (`backend/src/routes/api.js`)

### 3.1 POST /api/keys
- [ ] Generate API key for authenticated user
- [ ] Returns full key once (not stored in plaintext in response later)
- [ ] Key format: random UUID without dashes
- [ ] Over limit → free users limited? Check tier enforcement
- [ ] No auth → 401

### 3.2 GET /api/keys
- [ ] List user's API keys (masked? or full key?)
- [ ] Empty → []
- [ ] No auth → 401

### 3.3 DELETE /api/keys/:id
- [ ] Revoke own key
- [ ] Revoke another user's key → user_id check

### 3.4 API Key Auth (for external API access)
- [ ] `x-api-key` header → authenticates user
- [ ] Invalid key → 401
- [ ] Revoked key → 401

### 3.5 GET /api/search — External search endpoint
- [ ] Accepts query param, returns deals
- [ ] Rate limited separately (SEARCH_RATE_LIMIT_MAX=30)
- [ ] No auth → 401

---

## 4. ANALYTICS (`backend/src/routes/analytics.js`)

### 4.1 GET /api/analytics
- [ ] Returns user analytics: total alerts, active alerts, total matches, sources breakdown
- [ ] No auth → 401
- [ ] DB query failure → 500
- [ ] Empty stats → all zeros
- [ ] Pro vs free user differences? Stats should reflect tier limits

### 4.2 GET /api/analytics/overview
- [ ] Time-series data (daily matches, etc.)
- [ ] Date range filtering?
- [ ] Large date range → performance on SQLite

### 4.3 GET /api/analytics/sources
- [ ] Source distribution
- [ ] No data → empty

### 4.4 GET /api/analytics/activity
- [ ] Recent activity timeline
- [ ] Empty → []

---

## 5. ADMIN PANEL (`backend/src/routes/admin.js`)

### 5.1 Auth check: `req.user.is_admin`
- [ ] Non-admin → 403
- [ ] No auth → 401 (caught by authenticateToken first)
- [ ] Self-elevation? Should not be possible

### 5.2 GET /api/admin/users
- [ ] List all users
- [ ] Pagination? Not implemented — returns all
- [ ] Sensitive data exposure (password hashes?) — verify excluded from query
- [ ] Empty → []

### 5.3 PUT /api/admin/users/:id
- [ ] Update user fields (is_admin, is_premium, tier, alerts_limit)
- [ ] Invalid id → 404
- [ ] Remove own admin → possible, irreversible

### 5.4 DELETE /api/admin/users/:id
- [ ] Delete user + cascade their alerts, etc.
- [ ] Delete self → allowed? Check
- [ ] Delete non-existent → 0 rows

### 5.5 GET /api/admin/stats
- [ ] System-wide stats: total users, alerts, matches, payments
- [ ] DB heavy query — performance at scale

### 5.6 GET /api/admin/deals
- [ ] List all deals in system
- [ ] Pagination? Not implemented

### 5.7 POST /api/admin/deal/:id/delete
- [ ] Delete specific deal

---

## 6. COLLECTIONS (`backend/src/routes/collections.js`)

### 6.1 GET /api/collections
- [ ] List user's collections
- [ ] Includes deal count per collection?
- [ ] No collections → []

### 6.2 POST /api/collections
- [ ] Create named collection
- [ ] Duplicate name for same user?
- [ ] XSS in collection name

### 6.3 PUT /api/collections/:id
- [ ] Rename collection
- [ ] Non-owned → user_id check

### 6.4 DELETE /api/collections/:id
- [ ] Delete collection (cascade remove collection_deals)
- [ ] Non-owned → user_id check

### 6.5 POST /api/collections/:id/deals
- [ ] Add deal to collection (by deal_id)
- [ ] Duplicate deal in collection → handled by UNIQUE? Check
- [ ] Non-existent deal → 500 or graceful?

### 6.6 DELETE /api/collections/:id/deals/:dealId
- [ ] Remove deal from collection

---

## 7. DIGEST (`backend/src/routes/digest.js`)

### 7.1 GET /api/digest
- [ ] Returns digest settings for user
- [ ] Default: enabled? Check DB defaults

### 7.2 POST /api/digest
- [ ] Update digest frequency, enabled, time
- [ ] Invalid frequency → Zod validation
- [ ] Only pro users? Check tier enforcement

### 7.3 Digest cron job (in index.js or notifier)
- [ ] Scheduled execution (node-cron)
- [ ] Sends email with top matches since last digest
- [ ] Empty digest → should skip email
- [ ] SMTP failure → logged only
- [ ] Missed digests if server down → no catch-up
- [ ] Only for opted-in users

---

## 8. LLM SEARCH (`backend/src/routes/llmSearch.js`)

### 8.1 POST /api/llm/search
- [ ] Natural language query → AI-powered deal search
- [ ] No OPENROUTER_API_KEY → **BUG: Returns error "AI search is not configured" — but frontend may not handle gracefully**
- [ ] OpenRouter failure → 500
- [ ] Very long query → truncation?
- [ ] Rate limited (SEARCH_RATE_LIMIT_MAX=30)
- [ ] Expensive API call — no caching
- [ ] Results parsed from AI response — format could break if AI changes output

### 8.2 POST /api/llm/explain
- [ ] Explain why a deal matches the user's preferences
- [ ] Same failure modes as search

---

## 9. PAYMENT — PAYPAL (`backend/src/routes/paypal.js`)

### 9.1 POST /api/paypal/create-order
- [ ] Creates PayPal order for subscription
- [ ] `PAYPAL_CLIENT_ID` not set → **BUG: 500 "PayPal is not configured"**
- [ ] Monthly vs yearly pricing
- [ ] No auth → 401
- [ ] Existing subscriber → should prevent double-charge? Check

### 9.2 POST /api/paypal/capture-order
- [ ] Captures PayPal order after user approval
- [ ] Invalid order ID → 400
- [ ] Order already captured → PayPal API error
- [ ] On success: creates DB subscription record

### 9.3 POST /api/paypal/webhook
- [ ] Verifies webhook signature via `PAYPAL_WEBHOOK_ID`
- [ ] Handles BILLING.SUBSCRIPTION.* events
- [ ] No `PAYPAL_WEBHOOK_ID` → webhook not verified (security gap)
- [ ] Malformed payload → 400

---

## 10. PAYMENT — RAZORPAY (`backend/src/routes/razorpay.js`)

### 10.1 POST /api/razorpay/create-order
- [ ] Creates Razorpay order
- [ ] `RAZORPAY_KEY_ID` not set → 500
- [ ] Creates pending subscription in DB

### 10.2 POST /api/razorpay/verify
- [ ] Verifies payment signature
- [ ] Invalid signature → 400
- [ ] Updates subscription to active

### 10.3 POST /api/razorpay/webhook
- [ ] Verifies webhook secret
- [ ] Handles `payment.captured`, `subscription.*` events
- [ ] Idempotency — same event delivered twice? No idempotency key checking
- [ ] Webhook secret not configured → webhook unauthenticated

---

## 11. PAYMENT — STRIPE (`backend/src/routes/stripe.js`)

### 11.1 POST /api/create-checkout-session
- [ ] Creates Stripe Checkout Session
- [ ] `STRIPE_SECRET_KEY` not set → 500
- [ ] Monthly vs yearly
- [ ] Success/cancel URLs use `BASE_URL`
- [ ] No auth → 401
- [ ] Creates pending subscription in DB before redirect

### 11.2 POST /api/portal
- [ ] Creates Stripe Customer Portal session
- [ ] No active Stripe subscription → error
- [ ] No auth → 401

### 11.3 Webhook handler (`routes/webhook.js`)
- [ ] Verifies Stripe signature via `STRIPE_WEBHOOK_SECRET`
- [ ] Handles: `checkout.session.completed`, `invoice.paid`, `customer.subscription.deleted`, `customer.subscription.updated`
- [ ] Signature verification failure → 400
- [ ] Idempotency — Stripe guarantees at-least-once delivery, needs idempotency
- [ ] No webhook secret → verification skipped

---

## 12. SAVED DEALS (`backend/src/routes/savedDeals.js`)

### 12.1 GET /api/saved-deals
- [ ] Returns user's saved deals
- [ ] Pagination? Not implemented
- [ ] Empty → []

### 12.2 POST /api/saved-deals
- [ ] Save a deal by deal_id
- [ ] Duplicate → should error gracefully or be idempotent
- [ ] Non-existent deal_id → FK constraint likely

### 12.3 DELETE /api/saved-deals/:id
- [ ] Remove saved deal
- [ ] Non-owned → user_id check

---

## 13. STATS (`backend/src/routes/stats.js`)

### 13.1 GET /api/stats
- [ ] Returns dashboard stats: total_alerts, active_alerts, total_matches, recent_matches
- [ ] No auth → 401
- [ ] Empty → zeros
- [ ] DB query failure → 500

---

## 14. SCANNER — CORE (`backend/src/scanner.js`)

### 14.1 Initialization
- [ ] Reads scan interval from env (default 10min)
- [ ] Respects ENABLE_*_SCANNER flags
- [ ] Cron schedule from SCAN_INTERVAL_MINUTES
- [ ] Graceful shutdown: stop cron on SIGTERM

### 14.2 Scan execution
- [ ] Fetches deals from enabled sources (currently stubbed/placeholder for eBay, Slickdeals, Facebook, OfferUp)
- [ ] Sources that are stubs → no-op, only Reddit + Craigslist actually work
- [ ] Error in one source → continues others
- [ ] Network timeout (REQUEST_TIMEOUT_MS=30000)
- [ ] Concurrent scans → should not overlap (cron ensures sequential)

### 14.3 Deal deduplication
- [ ] Same URL not inserted twice
- [ ] URL normalization? Different URLs same deal → duplicates possible
- [ ] Old deal cleanup? Not implemented

### 14.4 After scan
- [ ] Runs matchers on new deals
- [ ] Sends notifications
- [ ] Updates AI scores

---

## 15. SCANNER — REDDIT (`backend/src/redditAuth.js`)

### 15.1 Authentication
- [ ] OAuth password grant with `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USERNAME`, `REDDIT_PASSWORD`
- [ ] Token refresh on expiry
- [ ] Missing credentials → **BUG: silently falls back to RSS feed, user may not know**
- [ ] Rate limit handling (429) — exponential backoff?

### 15.2 Deal fetching
- [ ] Fetches from configured subreddits (likely r/mechmarket, r/hardwareswap)
- [ ] Parses Reddit API JSON response
- [ ] Extracts price from title using regex
- [ ] No price found → deal stored with null price
- [ ] Pagination (after/before params)? Not implemented — only latest
- [ ] Network failure → logged, retry on next interval

---

## 16. SCANNER — CRAIGSLIST (`backend/src/craigslistScanner.js`)

### 16.1 Deal fetching
- [ ] Scrapes Craigslist search pages with Cheerio
- [ ] Area/city configuration
- [ ] Parses HTML — brittle (Craigslist HTML changes break scraper)
- [ ] No API key needed
- [ ] Rate limiting — Craigslist may block aggressive scraping
- [ ] User-agent rotation? Not implemented
- [ ] IP blocking detection? Not implemented

---

## 17. AI SCORER (`backend/src/aiScorer.js`)

### 17.1 Initialization
- [ ] Reads `OPENROUTER_API_KEY` from env
- [ ] No API key → **Silently returns null scores (no error logged)**
- [ ] Invalid API key → error logged, scoring disabled

### 17.2 Scoring
- [ ] Sends deal data to OpenRouter (GPT-4o-mini)
- [ ] Parses JSON response for score (1-100) and reasoning
- [ ] Malformed AI response → error logged, score skipped
- [ ] Rate limited by OpenRouter → 429, should retry
- [ ] Expensive — every new deal triggers API call
- [ ] Timeout — network failure → error logged
- [ ] Updates deal in DB with score

### 17.3 Batch scoring
- [ ] Scores all unscored deals on startup? Check
- [ ] Throttling between API calls?

---

## 18. MATCHERS (`backend/src/matchers.js`)

### 18.1 matchDealsForUser(userId)
- [ ] Fetches user's active alerts
- [ ] Fetches all unscored/unmatched deals or recent deals
- [ ] For each alert, checks if deal matches criteria

### 18.2 Matching logic
- [ ] Keyword matching: `LIKE '%keyword%'` (case-insensitive by default)
- [ ] Case sensitivity: SQLite `LIKE` is case-insensitive for ASCII
- [ ] Price range: `min_price <= deal_price <= max_price`
- [ ] Source filtering: matches deal.source to alert.source
- [ ] Subreddit filtering: matches deal.subreddit to alert.subreddit
- [ ] Multi-keyword alert: matches on ANY keyword

### 18.3 Match recording
- [ ] Creates entry in `matches` table
- [ ] Prevents duplicate matches (same deal_id + alert_id)
- [ ] Batch insert for efficiency

### 18.4 Edge cases
- [ ] Deal title is null → skipped
- [ ] Price is null but alert has price range → behavior? Should skip price check
- [ ] Alert has no keywords → should not match anything
- [ ] Very large number of deals → performance on SQLite

---

## 19. NOTIFIER (`backend/src/notifier.js`)

### 19.1 Notification types
- [ ] In-app: stored in DB `notifications` table
- [ ] Email: via Nodemailer (SMTP or Ethereal)
- [ ] Digest: periodic email summary

### 19.2 Email sending
- [ ] SMTP configured → uses SMTP
- [ ] No SMTP → Ethereal dev mode (catches in dev, silent in prod)
- [ ] Send failure → logged, retry? Not implemented
- [ ] HTML email template → inline styles? Check for rendering issues
- [ ] Plain text fallback?

### 19.3 Notification deduplication
- [ ] Same deal match → not notified twice
- [ ] Notifications cleaned up after N days?

### 19.4 Push notifications? Not implemented — only in-app + email

---

## 20. DATABASE (`backend/src/db.js`)

### 20.1 Initialization
- [ ] `better-sqlite3` with WAL mode enabled
- [ ] `DATABASE_PATH` from env (default `./data/mechmarket.db`)
- [ ] Directory creation for DB file
- [ ] Foreign keys enabled via `PRAGMA foreign_keys = ON`

### 20.2 Schema (defined in db.js)
- [ ] Tables: users, alerts, deals, matches, subscriptions, notifications, reset_tokens, api_keys, collections, collection_deals, saved_deals
- [ ] Indexes on frequently queried columns
- [ ] Migrations? Not implemented — schema defined in code, changes require manual migration

### 20.3 Backups (`dbBackup.js`)
- [ ] Cron-based backup via `ENABLE_DB_BACKUP`
- [ ] Uses `db.backup()` API
- [ ] Cleanup old backups (max 48)
- [ ] Backup during write-heavy period → potential WAL contention
- [ ] Backup failure → logged only

### 20.4 WAL checkpoint
- [ ] Runs periodically
- [ ] `wal_checkpoint(TRUNCATE)` — blocks writes during checkpoint

---

## 21. VALIDATION (`backend/src/validation.js`)

### 21.1 Schemas
- [ ] Zod schemas for all route inputs
- [ ] `emailSchema`: valid email, max length?
- [ ] `passwordSchema`: ≥6 chars, max length?
- [ ] `alertSchema`: keywords (array of strings), source, price range, subreddit
- [ ] `alertUpdateSchema`: partial version of create

### 21.2 Error handling
- [ ] Schema parse failure → 400 with Zod error message
- [ ] Exposes internal field names in error messages
- [ ] Strips unknown fields (Zod `strip()` by default)

---

## 22. LOGGER (`backend/src/logger.js`)

### 22.1 Winston logger
- [ ] `LOG_LEVEL` from env (default info)
- [ ] `LOG_FILE` — optional file transport
- [ ] Console transport always on
- [ ] Structured JSON logging
- [ ] Sensitive data (passwords, tokens) — check no logging of request bodies

### 22.2 Sentry (`@sentry/node`)
- [ ] `SENTRY_DSN` from env
- [ ] Only initialized if DSN present
- [ ] Traces sample rate from env
- [ ] Error capture — are all 500s captured?

---

## 23. SERVER / INDEX (`backend/src/index.js`)

### 23.1 Startup
- [ ] dotenv loads `.env`
- [ ] Sentry init
- [ ] Express app creation
- [ ] Middleware order: helmet, cors, morgan, rate-limit, json parser, routes, error handler

### 23.2 Middleware
- [ ] `helmet()` — security headers (CSP, X-Frame-Options, etc.)
- [ ] `cors()` — `CORS_ORIGIN` from env (comma-separated)
- [ ] `morgan('combined')` — request logging
- [ ] Global rate limit: 200/min (API_RATE_LIMIT_MAX)
- [ ] Auth rate limit: 10/min (AUTH_RATE_LIMIT_MAX)
- [ ] `express.json()` — body parser

### 23.3 Routes
- [ ] All route files mounted at correct paths
- [ ] `routes/webhook.js` before `express.json()` — needs raw body for Stripe signature verification
- [ ] 404 handler for unmatched routes
- [ ] Global error handler (returns 500 JSON)

### 23.4 Scanner initialization
- [ ] Starts scan cron on startup
- [ ] Runs initial scan immediately
- [ ] AI scorer initialized
- [ ] Notifier initialized
- [ ] Backup scheduler started

### 23.5 Graceful shutdown
- [ ] SIGTERM/SIGINT handler
- [ ] Stops cron jobs
- [ ] Closes DB connection
- [ ] Exits process

---

## 24. FRONTEND — SHARED

### 24.1 `api.js`
- [ ] Reads token from `localStorage` — XSS vulnerable
- [ ] `Bearer` token in Authorization header
- [ ] 401 response → clears token, redirects to /login
- [ ] Non-ok response → throws error with message from `(await res.json()).error`
- [ ] Network error → no retry, throws generic error
- [ ] `VITE_API_URL` fallback to `/api`

### 24.2 `AuthContext.jsx`
- [ ] Loads user on mount (via `/me`)
- [ ] Silent fail on `/me` error (`.catch(() => {})`) → user shown as logged out
- [ ] `login` stores token, sets user
- [ ] `register` stores token, sets user (auto-login after register)
- [ ] `logout` removes token, clears user (does NOT call backend — token remains valid)
- [ ] Tier fallback: `data.tier = data.tier || (data.is_premium ? 'pro' : 'free')`

### 24.3 `App.jsx`
- [ ] Route definitions: /, /login, /pricing, /forgot, /privacy, /reset, /dashboard, /analytics, /admin
- [ ] ProtectedRoute: shows loading, then user ? children : redirect to /login
- [ ] NavBar: conditional links based on auth state
- [ ] Admin link only for `user.is_admin`
- [ ] 404 catch-all route
- [ ] Premium badge vs Upgrade link

### 24.4 `main.jsx`
- [ ] BrowserRouter wrapping App
- [ ] No StrictMode? Removed

### 24.5 Service Worker (`sw.js`)
- [ ] Caches /, /login, /dashboard, /pricing on install
- [ ] Does NOT cache /api/ routes (correct)
- [ ] Network-first with cache fallback for navigations
- [ ] Cache fallback to `/` if offline
- [ ] Updates activate immediately (skipWaiting + clients.claim)
- [ ] Static cache name — no version bump mechanism → stale cache on deploy
- [ ] No cleanup for old cache entries (except on activate, only for different CACHE_NAME)

---

## 25. FRONTEND — DASHBOARD (`frontend/src/pages/Dashboard.jsx`)

- [ ] Loading state
- [ ] Empty state (no alerts)
- [ ] Alert list with cards
- [ ] Create alert modal
- [ ] Edit alert modal
- [ ] Delete alert with confirmation
- [ ] Toggle active/paused
- [ ] Tab bar: My Alerts, Matches, Settings
- [ ] Matches list with source, price, keyword, time
- [ ] Remaining alert count + progress bar (tier limit)
- [ ] Test alert button
- [ ] Error state on API failure
- [ ] Network error → toast
- [ ] State persistence across navigation? Not via React state (remounts on route change)
- [ ] Form validation before submit

---

## 26. FRONTEND — HOMEPAGE (`frontend/src/pages/HomePage.jsx`)

- [ ] Hero section with CTA
- [ ] Features grid (3 cards)
- [ ] How it works steps
- [ ] Pricing CTA section
- [ ] Responsive layout
- [ ] Authenticated vs anonymous view differences?

---

## 27. FRONTEND — LOGIN PAGE (`frontend/src/pages/LoginPage.jsx`)

- [ ] Login form: email + password
- [ ] Register form: email + password (no confirm password field — **BUG: typo risk**)
- [ ] Toggle between login/register
- [ ] Forgot password link
- [ ] Error display
- [ ] Loading state during submit
- [ ] Redirect to dashboard after success
- [ ] Auto-redirect if already logged in
- [ ] Form validation (empty fields)

---

## 28. FRONTEND — PRICING PAGE (`frontend/src/pages/PricingPage.jsx`)

- [ ] Three pricing cards: Free, Pro Monthly, Pro Yearly
- [ ] Payment method selector: Stripe, PayPal, Razorpay
- [ ] Checkout flow for each provider
- [ ] Popular badge on recommended plan
- [ ] Feature lists per tier
- [ ] Pricing FAQ section
- [ ] Already subscribed → shows manage button (portal)
- [ ] Error during checkout

---

## 29. FRONTEND — FORGOT PASSWORD (`frontend/src/pages/ForgotPassword.jsx`)

- [ ] Email input form
- [ ] Success message after submit
- [ ] Rate limit feedback
- [ ] Link back to login
- [ ] Error state

---

## 30. FRONTEND — RESET PASSWORD (`frontend/src/pages/ResetPassword.jsx`)

- [ ] Reads token from URL query param
- [ ] New password input
- [ ] No confirm password input — **BUG: typo risk**
- [ ] Success → redirects to login
- [ ] Invalid/expired token → error
- [ ] Error state

---

## 31. FRONTEND — ADMIN PANEL (`frontend/src/pages/AdminPanel.jsx`)

- [ ] Users list table
- [ ] User editing: is_admin, is_premium, tier, alerts_limit
- [ ] Delete user button
- [ ] System stats display
- [ ] Deals list
- [ ] Delete deal
- [ ] Non-admin access → API returns 403, frontend should handle
- [ ] Error states

---

## 32. FRONTEND — ANALYTICS PAGE (`frontend/src/pages/AnalyticsPage.jsx`)

- [ ] Stats cards: total alerts, active alerts, total matches
- [ ] Source breakdown chart/table
- [ ] Activity timeline
- [ ] Loading/empty/error states
- [ ] Real-time updates? No — fetches on mount

---

## 33. FRONTEND — PRIVACY PAGE (`frontend/src/pages/PrivacyPage.jsx`)

- [ ] Static content — no API calls
- [ ] Renders privacy policy text

---

## 34. INFRASTRUCTURE

### 34.1 `Dockerfile`
- [ ] Multi-stage build: frontend (vite build) + backend (node)
- [ ] Correct base images
- [ ] Exposes port 3001
- [ ] Node engine ≥18 per package.json

### 34.2 `docker-compose.yml`
- [ ] Single service (no DB container — uses SQLite file)
- [ ] Volume mount for persistent data (DB file)
- [ ] Environment variables from `.env`

### 34.3 `nginx.conf`
- [ ] Serves static frontend build
- [ ] Proxies `/api` requests to backend
- [ ] Security headers (X-Frame-Options, etc.)?
- [ ] Gzip compression?
- [ ] Cache headers for static assets?

### 34.4 `fly.toml`
- [ ] App name: mechalert
- [ ] Region: ord
- [ ] Internal port 3001
- [ ] HTTP→HTTPS redirect
- [ ] Health check (tcp, 15s interval)
- [ ] Single machine, no replicas
- [ ] SQLite on Fly.io → volume needed for persistence, check if configured

### 34.5 `vite.config.js`
- [ ] React plugin
- [ ] Dev proxy: `/api` → `localhost:3001`
- [ ] Build output to `dist`

---

## 35. CROSS-CUTTING SECURITY CONCERNS

- [ ] **No CSRF protection** — any site can make requests on behalf of logged-in user
- [ ] **JWT in localStorage** — stolen via XSS, no HttpOnly option
- [ ] **JWT never revocable** — no blocklist/allowlist, 7d expiry hardcoded
- [ ] **No rate limiting per-user** — global rate limit only, one user can exhaust all 200 req/min
- [ ] **Auth rate limit is 10/min TOTAL** — not per-IP, one attacker blocks all logins
- [ ] **No refresh tokens** — token rotation not implemented
- [ ] **Password: no min-length beyond 6 chars, no complexity requirement**
- [ ] **No account lockout** — unlimited brute-force attempts (within rate limit)
- [ ] **No email verification** — anyone can register with any email
- [ ] **Logout is client-side only** — backend token remains valid until expiry
- [ ] **Webhook secrets not validated if env vars empty** — Stripe/PayPal/Razorpay webhooks would accept unauthenticated requests
- [ ] **CORS origin list** — `ALLOWED_ORIGINS` comma-separated, check for origin validation bypass
- [ ] **Helmet** — verify all security headers are applied (CSP, HSTS, etc.)
- [ ] **Sentry DSN in env** — could leak if error responses include Sentry details
- [ ] **Default JWT secret in .env.example** — production might still use default
- [ ] **SQLite single-file** — no encryption at rest (not expected for SQLite but worth noting)

---

## 36. EXISTING TEST COVERAGE GAPS

### 36.1 `security.test.js` — covers:
- Zod validation (email, password)
- SQL injection (login, register, alert creation)
- XSS (email, alert fields)
- JWT tampering (alg none, expired, malformed)
- Timing attack (password comparison)
- Auth middleware (missing/expired token)

### 36.2 `untested.test.js` — covers:
- Validation schemas (alert, forgot, reset, api key)
- OpenRouter key missing
- Scanner initialization
- AI scorer disabled

### 36.3 `alerts.test.js` — mocks:
- Create, read, update, delete alerts
- Toggle, test alert
- Fails for unauthenticated users
- Tier limit enforcement

### 36.4 `matchers.test.js` — likely tests match logic
### 36.5 `notifier.test.js` — likely tests notification sending
### 36.6 `aiScorer.test.js` — likely tests AI scoring

### 36.7 NOT tested at all:
- All payment routes (Stripe, PayPal, Razorpay)
- All admin routes
- Analytics routes
- Collections routes
- Digest routes
- LLM search routes
- API key management routes
- Saved deals routes
- Stats routes
- Webhook handling (all providers)
- Forgot/reset password flow
- Frontend components (no frontend tests at all)
- Service worker behavior
- Docker/nginx configuration
- Database migration/backup
- Scanner real integration (uses mocks)
- Concurrent user scenarios
- Rate limiter behavior
- Graceful shutdown
- Error handler middleware

---

## 37. BUG SUMMARY (Critical)

| # | Severity | File | Description |
|---|----------|------|-------------|
| B1 | **Critical** | `routes/auth.js` | Case-insensitive email duplicates: register uses `LOWER(email)` in UNIQUE query but SQLite constraint is case-sensitive → `Test@test.com` and `test@test.com` both register |
| B2 | **High** | `routes/auth.js` | Forgot password: returns 200 for non-existent emails but DB query may differ in timing → timing oracle |
| B3 | **High** | Frontend login | No confirm-password on register or reset → user can lock themselves out with typo |
| B4 | **High** | `src/aiScorer.js` | Missing API key → silent no-op (no error logged, no indicator to user/admin) |
| B5 | **High** | `src/redditAuth.js` | Missing Reddit credentials → silent RSS fallback (user never knows API mode failed) |
| B6 | **High** | `src/notifier.js` | No SMTP config → Ethereal in dev works, in prod silently fails (no email sent, no error unless log inspected) |
| B7 | **High** | ALL webhooks | Webhook secrets optional → if env not set, webhooks accept unauthenticated payloads |
| B8 | **Medium** | `AuthContext.jsx` | `/me` failure silently ignored (`catch(() => {})`) — user shown as logged out if API temporarily down |
| B9 | **Medium** | `api.js` | Token in localStorage — any XSS leaks JWT permanently |
| B10 | **Medium** | `routes/auth.js` | No account lockout — brute force unlimited within rate limit |
| B11 | **Medium** | ALL routes | JWT never revocable — password change, logout, admin disable → token still works |
| B12 | **Low** | `sw.js` | Static cache name `mechalert-v1` — deploy doesn't auto-invalidate old cache |
| B13 | **Low** | `routes/alerts.js` | Delete/update non-owned alert returns 200 with 0 rows — should return 404 |
| B14 | **Low** | Frontend pages | No loading/error states on several pages (AdminPanel, AnalyticsPage) |
| B15 | **Low** | `public/manifest.json` | Single SVG icon — may not render correctly on all platforms |

---

## 38. RECOMMENDATIONS (Priority Order)

### P0 — Fix before launch
1. Case-insensitive email deduplication — use `COLLATE NOCASE` or normalize before insert
2. Make webhook secrets **required** in production (validate at startup)
3. Add confirm-password field on register and reset screens
4. Add JWT revocation mechanism (blocklist table or short-lived + refresh tokens)
5. Log warning when AI scorer / Reddit API / SMTP are unconfigured

### P1 — Security hardening
6. Move JWT to HttpOnly cookie (mitigate XSS token theft)
7. Add account lockout after N failed attempts
8. Add CSRF tokens
9. Rate limit per-IP for auth endpoints (not global)
10. Add `is_active` check on login (account disable/enable)

### P2 — Error handling & UX
11. Better error on alert limit reached (don't expose raw DB error)
12. Loading/error states on AdminPanel and AnalyticsPage
13. Auto-dismiss toasts after timeout
14. Disable submit button while loading on all forms

### P3 — Reliability
15. Add idempotency keys for webhook handling
16. Add retry logic for email sending
17. Add pagination for alerts, deals, users lists
18. Service worker cache versioning on deploy
19. Database migration system
20. Add health check endpoint

### P4 — Testing
21. Add integration tests for all payment flows
22. Add frontend component tests
23. Add webhook handling tests
24. Add concurrent user scenario tests
25. Add rate limiter tests
26. Add e2e tests for critical paths (login, create alert, receive match)
