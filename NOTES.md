# MechAlert — Dev Notes

## Last Session: CI Fixes & Razorpay Test

### What Was Done
- Fixed GitHub Actions CI: added `@vitest/coverage-v8` to `backend/devDependencies`
- Fixed Dockerfile: upgraded `libcrypto3`/`libssl3` via `apk upgrade`, removed bundled `npm` from final image to eliminate 13 Trivy HIGH vulnerabilities
- CI now fully passing (Tests + Docker Build & Scan + Notify)

### Current Blockers
- **Razorpay test keys are invalid** — `rzp_test_T1skulLggAcO2b` returns "Authentication failed" from Razorpay API
- Need user to regenerate test API keys from https://dashboard.razorpay.com → Settings → API Keys (Test Mode)
- Once new keys are provided, set them on Railway via: `railway variable set RAZORPAY_KEY_ID=rzp_test_xxxxx RAZORPAY_KEY_SECRET=xxxxx`

### Test Credentials for Razorpay Checkout (when keys work)
- Email: `success@razorpay.com`
- Password: anything (e.g. `Test@123`)
- Test card: `4111 1111 1111 1111` (any future expiry, any 3-digit CVV)

### Railway Env Vars Already Set
- `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` — set but need to be updated (currently invalid)
- `RAZORPAY_AMOUNT_MONTHLY=39900` / `RAZORPAY_AMOUNT_YEARLY=399900`
- `JWT_SECRET`, `SMTP_*`, `BASE_URL`, `CORS_ORIGIN`, `LOG_LEVEL`, `NODE_ENV`, `WEBHOOK_SECRET` — all set and working

### Deployment
- URL: https://mechalert-production.up.railway.app
- Deploy via: `railway up --yes` (from Windows: `railway up --yes` without `--json` flag)
- Railway sets `PORT=8080` internally; Dockerfile `EXPOSE 3001` is informational

### Next Steps (blocked on user)
1. User provides new Razorpay test API keys → set on Railway → verify create-order works
2. Test full payment flow end-to-end (create-order → Razorpay checkout → verify/webhook)
3. PayPal integration — user needs to create PayPal Business account → developer dashboard → get Client ID/Secret
4. Set PayPal env vars on Railway
5. Create webhooks on both Razorpay and PayPal dashboards pointing to `https://mechalert-production.up.railway.app/api/{razorpay,paypal}/webhook`

### Project Structure
- `backend/src/index.js` — main app, all route mounts, async startup
- `backend/src/routes/razorpay.js` — Razorpay payment routes (create-order, verify, webhook)
- `backend/src/routes/paypal.js` — PayPal payment routes (create-order, capture, webhook, upgrade)
- `backend/src/validation.js` — 11 Zod schemas + `validate()` middleware
- `backend/src/logger.js` — Winston structured JSON logger
- `backend/src/dbBackup.js` — auto-backup every 30 min
- `Dockerfile` — multi-stage build (frontend static + backend)
- `frontend/src/pages/PricingPage.jsx` — pricing/payment UI
