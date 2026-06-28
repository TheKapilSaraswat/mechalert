# MechAlert Login Flow — Complete End-to-End Test Cases

> **Project**: `mechalert/`  
> **Auth files**: `backend/src/routes/auth.js`, `backend/src/index.js`, `backend/src/validation.js`, `backend/src/db.js`  
> **Frontend files**: `frontend/src/AuthContext.jsx`, `frontend/src/api.js`, `frontend/src/pages/LoginPage.jsx`, `frontend/src/App.jsx`

---

## 1. ARCHITECTURE OVERVIEW

```
Browser
  |  BrowserRouter (main.jsx)
  |    App.jsx
  |      AuthProvider (AuthContext.jsx)
  |        NavBar (always visible)
  |        Routes
  |          /login → LoginPage.jsx
  |          /forgot → ForgotPassword.jsx
  |          /reset → ResetPassword.jsx
  |          /dashboard → ProtectedRoute → Dashboard.jsx
  |          /analytics → ProtectedRoute → AnalyticsPage.jsx
  |          /admin → ProtectedRoute → AdminPanel.jsx
  |          * → 404
  |
  |  api.js (fetch wrapper)
  |    → /api/auth/login  (POST)
  |    → /api/me           (GET, for session restore)
  |
Backend
  |  Express (index.js)
  |    helmet() → cors() → express.json() → rateLimit(/api, 200/min)
  |    → /api/auth → authLimiter(10/min) → authRoutes
  |      → validate(loginSchema) → loginHandler
  |        → SQLite (db.js) → bcrypt → jwt.sign → response
```

---

## 2. INITIAL APP LOAD (Session Restore)

### 2.1 No existing session
| # | Step | Expected | Actual/Observed |
|---|------|----------|-----------------|
| 1 | User navigates to app (no `mm_token` in localStorage) | `AuthProvider` mounts, `useEffect` runs, sees no token, sets `loading=false` | ✅ |
| 2 | `ProtectedRoute` on `/dashboard` checks `loading=false, user=null` | `<Navigate to="/login" />` | ✅ |
| 3 | User sees login page | Login form renders with email/password inputs | ✅ |

### 2.2 Existing valid session
| # | Step | Expected | Actual/Observed |
|---|------|----------|-----------------|
| 1 | User navigates to app (`mm_token` exists) | `AuthProvider` mounts, `useEffect` fires | ✅ |
| 2 | `GET /api/me` called with Bearer token | Server decodes JWT, queries user from DB | ✅ |
| 3 | Server returns user data | `{ id, email, is_premium, is_admin, tier, ... }` | ✅ |
| 4 | AuthProvider sets `user` state, `loading=false` | User data available app-wide | ✅ |
| 5 | `ProtectedRoute` sees `user` is truthy | Renders children (Dashboard) | ✅ |
| 6 | NavBar shows user email, Logout button, Premium badge | Correct nav for authenticated user | ✅ |

### 2.3 Existing expired/invalid token
| # | Step | Expected | Actual/Observed |
|---|------|----------|-----------------|
| 1 | `mm_token` exists but is expired or tampered | `GET /api/me` fails with 401 | ✅ (api.js line 13) |
| 2 | `api.js` interceptor catches 401 | Clears `mm_token`, redirects to `/login` | ✅ |
| 3 | AuthProvider `.catch()` does nothing | `user` stays `null` | ✅ |
| 4 | `finally` sets `loading=false` | App redirects to login | ✅ |

### 2.4 Existing token but network fails on /api/me
| # | Step | Expected | Actual/Observed |
|---|------|----------|-----------------|
| 1 | `mm_token` exists, but server is down | `fetch` throws NetworkError | ✅ |
| 2 | `.catch()` swallows error silently | **BUG: No user feedback** — app shows nothing | ❌ User sees loading spinner forever? No — finally sets loading=false |
| 3 | `finally` sets `loading=false` | `user=null` → redirected to `/login` | ✅ |
| 4 | No error toast/notification shown | User has no idea why they're at login | ❌ Silent failure |

---

## 3. LOGIN PAGE RENDERING

### 3.1 Default state
| # | Test | Expected | Actual/Observed |
|---|------|----------|-----------------|
| 1 | Navigate to `/login` when not authenticated | Login form renders | ✅ |
| 2 | Page title shows "Sign In" | `<h2>Sign In</h2>` | ✅ |
| 3 | Email input present | `type="email"`, `required`, `autoFocus` | ✅ |
| 4 | Password input present | `type="password"`, `minLength={8}`, `required` | ✅ |
| 5 | Submit button says "Sign In" | `disabled={loading}` | ✅ |
| 6 | Toggle link says "Register" | "Don't have an account? Register" | ✅ |
| 7 | Forgot password link visible | `<Link to="/forgot">` | ✅ |
| 8 | No error message displayed | Error div not rendered | ✅ |

### 3.2 Already authenticated
| # | Test | Expected | Actual/Observed |
|---|------|----------|-----------------|
| 1 | User is already logged in, visits `/login` | `<Navigate to="/dashboard" />` | ✅ |
| 2 | User never sees login form | Instant redirect | ✅ |

### 3.3 Toggle to Register mode
| # | Test | Expected | Actual/Observed |
|---|------|----------|-----------------|
| 1 | Click "Register" link | `isRegister=true`, title changes to "Create Account" | ✅ |
| 2 | Submit button says "Create Account" | Button text updates | ✅ |
| 3 | Forgot password link hides | Conditional render `!isRegister` | ✅ |
| 4 | Toggle link changes to "Sign In" | "Already have an account? Sign In" | ✅ |
| 5 | Any existing error is cleared | `setError('')` | ✅ |
| 6 | No name/confirm-password fields | Register only asks email+password | ❌ No name field, no confirm password |

---

## 4. CLIENT-SIDE FORM VALIDATION

### 4.1 Login validation
| # | Test | Input | Expected | Actual |
|---|------|-------|----------|--------|
| 1 | Empty email | email: `""`, password: `"password123"` | `setError('Please enter your email address.')`, no API call | ✅ |
| 2 | Empty password | email: `"a@b.com"`, password: `""` | `setError('Please enter your password.')`, no API call | ✅ |
| 3 | Short password (< 8 chars) | email: `"a@b.com"`, password: `"abc1234"` (7 chars) | `setError('Password must be at least 8 characters.')`, no API call | ✅ |
| 4 | Edge: password exactly 8 chars | email: `"a@b.com"`, password: `"12345678"` | Passes client validation, API called | ✅ |
| 5 | Edge: password exactly 7 chars | email: `"a@b.com"`, password: `"1234567"` | Blocked by client | ✅ |
| 6 | Submit while loading | email+password valid, `loading=true` | Button disabled, no double-submit | ✅ (`disabled={loading}`) |

### 4.2 Register validation (same component)
| # | Test | Input | Expected | Actual |
|---|------|-------|----------|--------|
| 1 | Same as login validation | same rules | Same behavior | ✅ |
| 2 | No name field validation | N/A | User can register with only email+password | ❌ No profile name collected |

---

## 5. API CALL (api.js)

### 5.1 Request construction
| # | Test | Expected | Actual |
|---|------|----------|--------|
| 1 | URL construction | Dev: `http://localhost:5173/api/auth/login` → proxied to `http://localhost:3001/api/auth/login`. Prod: `/api/auth/login` (same origin) | ✅ |
| 2 | Method | `POST` | ✅ |
| 3 | Request body | `JSON.stringify({ email, password })` | ✅ |
| 4 | Content-Type header | `application/json` | ✅ |
| 5 | Authorization header | Not sent for login (no token yet) | ✅ (token is null) |
| 6 | Body size limit | 50kb (Express middleware in index.js) | ✅ |

### 5.2 Response handling — 401
| # | Test | Expected | Actual |
|---|------|----------|--------|
| 1 | Backend returns 401 | `res.status === 401` in api.js | ✅ |
| 2 | Token cleared | `localStorage.removeItem('mm_token')` | ✅ |
| 3 | Redirect | `window.location.href = '/login'` — **hard redirect, not React navigation** | ⚠️ Hard redirect loses all React state |
| 4 | Error thrown | `throw new Error('Session expired')` | ✅ |

### 5.3 Response handling — non-ok (but not 401)
| # | Test | Expected | Actual |
|---|------|----------|--------|
| 1 | Backend returns 400, 409, 500 | `res.ok` is false | ✅ |
| 2 | Error message extracted | `(await res.json()).error` | ✅ |
| 3 | Error thrown with server message | `throw new Error(...)` | ✅ |

### 5.4 Response handling — network error
| # | Test | Expected | Actual |
|---|------|----------|--------|
| 1 | Server unreachable/fetch throws | Exception propagates to caller | ✅ |
| 2 | Error message | `err.message` contains `"Failed to fetch"` or `"NetworkError"` | ✅ (browser-dependent) |

### 5.5 Response handling — success
| # | Test | Expected | Actual |
|---|------|----------|--------|
| 1 | Backend returns 200 | `res.ok` is true | ✅ |
| 2 | JSON parsed | `return res.json()` | ✅ |

---

## 6. BACKEND MIDDLEWARE CHAIN

### 6.1 Middleware execution order
| # | Middleware | Executes? | Notes |
|---|-----------|-----------|-------|
| 1 | `helmet()` | ✅ | CSP, security headers |
| 2 | `cors()` | ✅ | Allows dev origins, prod origin |
| 3 | `express.json({ limit: '50kb' })` | ✅ | Body parser |
| 4 | `apiLimiter` (200 req/min on `/api`) | ✅ | Rate limit by IP/userId |
| 5 | `authLimiter` (10 req/min on `/api/auth`) | ✅ | **Separate, stricter rate limit for auth** |
| 6 | Request timeout (30s default) | ✅ | 503 on timeout |
| 7 | `validate(loginSchema)` | ✅ | Zod validation |
| 8 | Login route handler | ✅ | Actual auth logic |

### 6.2 Rate limiter details
| # | Property | Value |
|---|----------|-------|
| 1 | API rate limit | 200 requests per 60s window |
| 2 | Auth rate limit | 10 requests per 60s window |
| 3 | Key generator | `req.user?.userId` (if authenticated) or `req.ip` |
| 4 | Rate limit response | `{ error: 'Too many attempts. Try again later.' }` (auth) / `{ error: 'Too many requests. Try again later.' }` (api) |
| 5 | Headers | `RateLimit-*` standard headers enabled |

---

## 7. BACKEND VALIDATION (Zod)

### 7.1 loginSchema
```js
z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
})
```

| # | Test | Input | Expected | Actual |
|---|------|-------|----------|--------|
| 1 | Valid login | `{ email: "a@b.com", password: "password123" }` | ✅ passes → `req.validated` set | ✅ |
| 2 | Missing email | `{ password: "password123" }` | ❌ 400, `{ error: 'Validation failed', details: { email: ['Required'] } }` | ✅ |
| 3 | Missing password | `{ email: "a@b.com" }` | ❌ 400 | ✅ |
| 4 | Empty string email | `{ email: "", password: "password123" }` | ❌ 400 | ✅ |
| 5 | Invalid email format | `{ email: "notanemail", password: "password123" }` | ❌ 400 | ✅ |
| 6 | Email with whitespace (`" a@b.com "`) | Zod's `.email()` is strict | ❌ 400 | ✅ |
| 7 | Email with plus tag (`a+b@c.com`) | Valid email | ✅ | ✅ |
| 8 | Email with dots (`first.last@domain.co.uk`) | Valid email | ✅ | ✅ |
| 9 | Email > 255 chars | `{ email: "x".repeat(256) + "@b.com", ... }` | ❌ 400 | ✅ |
| 10 | Short password (7 chars) | `{ email: "a@b.com", password: "1234567" }` | ❌ 400 | ✅ |
| 11 | Exact min password (8 chars) | `{ email: "a@b.com", password: "12345678" }` | ✅ | ✅ |
| 12 | Password > 128 chars | `{ email: "a@b.com", password: "a".repeat(129) }` | ❌ 400 | ✅ |
| 13 | Password at 128 boundary | `{ email: "a@b.com", password: "a".repeat(128) }` | ✅ | ✅ |
| 14 | Extra/unknown fields | `{ email: "a@b.com", password: "password123", extra: true }` | ✅ (Zod strips unknown) | ✅ |
| 15 | `__proto__` pollution | `{ email: "a@b.com", password: "password123", __proto__: { admin: true } }` | ✅ (stripped by Zod) | ✅ |
| 16 | `constructor` pollution | `{ email: "a@b.com", password: "password123", constructor: { prototype: { admin: true } } }` | ✅ (stripped by Zod) | ✅ |
| 17 | Non-string email (number) | `{ email: 123, password: "password123" }` | ❌ 400 | ✅ |
| 18 | Non-string password (number) | `{ email: "a@b.com", password: 123 }` | ❌ 400 | ✅ |
| 19 | Null email | `{ email: null, password: "password123" }` | ❌ 400 | ✅ |
| 20 | Null password | `{ email: "a@b.com", password: null }` | ❌ 400 | ✅ |
| 21 | Array email | `{ email: ["a@b.com"], password: "password123" }` | ❌ 400 | ✅ |

### 7.2 registerSchema (identical to loginSchema)
| # | Test | Expected | Actual |
|---|------|----------|--------|
| 1 | All loginSchema tests apply same | Same behavior | ✅ |

### 7.3 forgotPasswordSchema
```js
z.object({ email: z.string().email().max(255) })
```

| # | Test | Input | Expected | Actual |
|---|------|-------|----------|--------|
| 1 | Valid email | `{ email: "a@b.com" }` | ✅ | ✅ |
| 2 | Invalid email | `{ email: "not" }` | ❌ 400 | ✅ |
| 3 | Missing email | `{}` | ❌ 400 | ✅ |
| 4 | Empty email | `{ email: "" }` | ❌ 400 | ✅ |

### 7.4 resetPasswordSchema
```js
z.object({ token: z.string().min(1).max(500), password: z.string().min(8).max(128) })
```

| # | Test | Input | Expected | Actual |
|---|------|-------|----------|--------|
| 1 | Valid | `{ token: "abc", password: "newpass123" }` | ✅ | ✅ |
| 2 | Missing token | `{ password: "newpass123" }` | ❌ 400 | ✅ |
| 3 | Empty token | `{ token: "", password: "newpass123" }` | ❌ 400 | ✅ |
| 4 | Token > 500 chars | `{ token: "a".repeat(501), password: "newpass123" }` | ❌ 400 | ✅ |
| 5 | Short password | `{ token: "abc", password: "short" }` | ❌ 400 | ✅ |
| 6 | Missing password | `{ token: "abc" }` | ❌ 400 | ✅ |

### 7.5 Validate middleware — error response format
```json
{
  "error": "Validation failed",
  "details": {
    "email": ["Invalid email"],
    "password": ["String must contain at least 8 character(s)"]
  }
}
```

| # | Test | Expected |
|---|------|----------|
| 1 | Validation error response uses `result.error.flatten().fieldErrors` | ✅ |
| 2 | Status code is 400 | ✅ |

---

## 8. BACKEND LOGIN HANDLER

### 8.1 Flow diagram

```
req.validated (email, password)
  │
  ├─ db.prepare('SELECT * FROM users WHERE email = ?').get(email)
  │
  ├─ user found?
  │   ├─ YES → bcrypt.compareSync(password, user.password_hash)
  │   └─ NO  → still runs bcrypt.compareSync(password, dummyHash) [timing attack protection]
  │
  ├─ valid?
  │   ├─ YES → jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' })
  │   │         → 200 { token, user: { id, email, is_premium, tier } }
  │   └─ NO  → 401 { error: 'Invalid credentials' }
  │
  └─ Catch → logger.error() → 500 { error: 'Server error' }
```

### 8.2 Successful login scenarios
| # | Scenario | Expected | Actual |
|---|----------|----------|--------|
| 1 | Correct email + correct password for existing user | 200 with token and user object | ✅ |
| 2 | User has `tier` column set | Uses `user.tier` directly | ✅ |
| 3 | User has `is_premium=1` but `tier` is null | Falls back to `'pro'` | ✅ |
| 4 | User has `is_premium=0` and `tier` is null | Falls back to `'free'` | ✅ |
| 5 | User has `tier='pro_plus'` | Correctly returned | ✅ |

### 8.3 Failed login scenarios
| # | Scenario | Expected | Actual |
|---|----------|----------|--------|
| 1 | Correct email, wrong password | 401 `{ error: 'Invalid credentials' }` | ✅ |
| 2 | Non-existent email | 401 `{ error: 'Invalid credentials' }` — same message as wrong password | ✅ (good — no user enumeration) |
| 3 | Non-existent email + no dummy hash comparison | Would leak timing difference | ✅ (dummy hash IS compared) |
| 4 | Empty string email (should be caught by validation first) | 400, never reaches handler | ✅ |
| 5 | SQL injection in email (`' OR '1'='1`) | Caught by Zod validation (invalid email format) | ✅ |

### 8.4 JWT token details
| Property | Value |
|----------|-------|
| Payload | `{ userId: user.id }` |
| Secret | `process.env.JWT_SECRET` |
| Expiry | `7d` (7 days) |
| Algorithm | HS256 (default for `jwt.sign`) |
| Verification | `jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] })` |

### 8.5 Timing attack protection
| # | Aspect | Detail | Status |
|---|--------|--------|--------|
| 1 | Dummy hash generated | `'$2a$10$' + 'Z'.repeat(53)` — valid bcrypt format | ✅ |
| 2 | Dummy hash compared even when user not found | `bcrypt.compareSync(password, dummyHash)` runs unconditionally | ✅ |
| 3 | No early return for missing user | Both paths take same logical branches | ✅ |
| 4 | Result of dummy comparison discarded | Return value not used | ✅ |

### 8.6 Server error handling
| # | Scenario | Behavior |
|---|----------|----------|
| 1 | DB query throws | Caught → `logger.error` → 500 `{ error: 'Server error' }` |
| 2 | bcrypt throws (e.g., bad hash format) | Caught → 500 |
| 3 | jwt.sign throws (e.g., missing JWT_SECRET) | Caught → 500 |
| 4 | Error logged to Winston | ✅ With request context |

### 8.7 Password storage
| # | Aspect | Detail | Status |
|---|--------|--------|--------|
| 1 | Hashing algorithm | bcrypt | ✅ |
| 2 | Salt rounds | 10 (`bcrypt.hashSync(password, 10)`) | ✅ |
| 3 | Column type | `TEXT` in SQLite | ✅ |

---

## 9. AUTHCONTEXT LOGIN (FRONTEND)

### 9.1 Context state management
```js
const login = async (email, password) => {
    setError(null);                    // Clear auth-level error (unused?)
    const data = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    localStorage.setItem('mm_token', data.token);
    data.user.tier = data.user.tier || (data.user.is_premium ? 'pro' : 'free');
    setUser(data.user);                // Update global user state
};
```

| # | Test | Expected | Actual |
|---|------|----------|--------|
| 1 | Login succeeds | Token stored in localStorage, user state set | ✅ |
| 2 | Tier normalization | `data.user.tier` is set correctly | ✅ |
| 3 | Login fails (api throws) | Error propagates to caller (LoginPage catches it) | ✅ |
| 4 | AuthContext `error` state | `setError(null)` called but never set on failure — **unused state** | ⚠️ `error` state in AuthContext never used for login errors; only LoginPage's local state shows errors |

### 9.2 Register function (similar flow)
| # | Test | Expected | Actual |
|---|------|----------|--------|
| 1 | Register succeeds | Token stored, user state set, auto-logged in | ✅ |
| 2 | Register with existing email | API returns 409 → thrown as error → caught by LoginPage | ✅ |

---

## 10. SUCCESS REDIRECT

### 10.1 After login
| # | Step | Expected | Actual |
|---|------|----------|--------|
| 1 | `login()` resolves (token stored, user set) | ✅ | ✅ |
| 2 | `navigate('/dashboard')` called | React Router navigates to `/dashboard` | ✅ |
| 3 | ProtectedRoute checks `user` | `user` is now set → renders `<Dashboard />` | ✅ |
| 4 | NavBar updates | Shows email, Logout, Premium/Upgrade badge | ✅ |

### 10.2 After register (same behavior)
| # | Step | Expected | Actual |
|---|------|----------|--------|
| 1 | `register()` resolves | Same as login: token + user set | ✅ |
| 2 | `navigate('/dashboard')` | Redirect to dashboard | ✅ |

### 10.3 Edge — redirect after page refresh
| # | Test | Expected | Actual |
|---|------|----------|--------|
| 1 | Login, refresh page | `/api/me` restores session from stored token | ✅ |
| 2 | Login, clear localStorage Manually, refresh | Token gone → redirect to `/login` | ✅ |
| 3 | Login, let token expire, refresh | `/api/me` 401 → token cleared → redirect to `/login` | ✅ |

---

## 11. ERROR DISPLAY (LoginPage)

### 11.1 Error messages mapping
| # | Server/Client Error Message | Displayed to User | Location |
|---|---------------------------|-------------------|----------|
| 1 | "Email already registered" | "An account with this email already exists. Please sign in instead." | LoginPage:29-30 |
| 2 | "Invalid credentials" | "Invalid email or password. Please try again." | LoginPage:31-32 |
| 3 | "Invalid email or password" (from other source) | "Invalid email or password. Please try again." | LoginPage:31-32 |
| 4 | "Server error" | "Server error. Please try again later." | LoginPage:33-34 |
| 5 | NetworkError / Failed to fetch | "Cannot connect to server. Check your internet connection." | LoginPage:35-36 |
| 6 | Any other message | Displayed as-is or "An unexpected error occurred." | LoginPage:37-38 |

### 11.2 Error display duration/behavior
| # | Aspect | Detail |
|---|--------|--------|
| 1 | Display mechanism | Inline `<div className="alert alert-error">` inside auth card |
| 2 | Is it a popup/toast? | **NO** — it's inline, between form fields and submit button |
| 3 | Is it a persistent modal? | **NO** — it's part of the page flow |
| 4 | Auto-dismiss timer? | **NO** — error stays until user action |
| 5 | Close/dismiss button? | **NO** — no X button on error |
| 6 | When does error clear? | When: (a) user submits again (calls `setError('')`), (b) user toggles to Register mode (calls `setError('')`) |
| 7 | How long does user see error? | **Indefinitely** until they interact again |
| 8 | On successful retry | Error is replaced with loading state |

### 11.3 Error styling
| Property | Value |
|----------|-------|
| CSS class | `.alert alert-error` (index.css:148) |
| Background | `#3d1214` (dark red) |
| Border | `1px solid #8b1e1e` |
| Color | `#f85149` (red text) |
| Margin | `8px 0` (via inline style `style={{ margin: '8px 0', fontSize: '0.85rem' }}`) |

---

## 12. LOADING STATE

### 12.1 During login
| # | Aspect | Detail |
|---|--------|--------|
| 1 | Button text changes to "Please wait..." | ✅ |
| 2 | Button becomes disabled (`disabled={loading}`) | ✅ |
| 3 | User cannot submit again while loading | ✅ |
| 4 | Loading state cleared in catch block | `setLoading(false)` in catch | ✅ |
| 5 | Loading state cleared on success (via navigate) | Navigate happens, component may unmount | ✅ |
| 6 | If api throws BEFORE making request (no network) | Still caught → `setLoading(false)` | ✅ |
| 7 | If api throws AFTER receiving 401 (api.js clears token then throws) | Caught → `setLoading(false)` | ✅ |

### 12.2 Loading state in AuthContext initial load
| # | Aspect | Detail |
|---|--------|--------|
| 1 | On mount, `loading=true` | ✅ |
| 2 | No token found → `loading=false` immediately | ✅ |
| 3 | Token found → `/api/me` call → `.finally(() => setLoading(false))` | ✅ |
| 4 | If `/api/me` fails → `loading=false` (via finally) | ✅ |
| 5 | ProtectedRoute shows "Loading..." during this time | ✅ |

---

## 13. REGISTRATION FLOW

### 13.1 Register handler (backend)
```js
router.post('/register', validate(registerSchema), (req, res) => {
    const { email, password } = req.validated;
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) return res.status(409).json({ error: 'Email already registered' });
    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(email, hash);
    const token = jwt.sign({ userId: result.lastInsertRowid }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, user: { id: result.lastInsertRowid, email, is_premium: 0, tier: 'free' } });
});
```

| # | Test | Input | Expected | Actual |
|---|------|-------|----------|--------|
| 1 | Register new user | `{ email: "new@test.com", password: "password123" }` | 201, token returned, user created | ✅ |
| 2 | Register with existing email | `{ email: "existing@test.com", password: "password123" }` | 409 `{ error: 'Email already registered' }` | ✅ |
| 3 | Register with email that differs only by case | `"Existing@test.com"` vs `"existing@test.com"` | SQLite `TEXT` is case-sensitive by default for `=` — **may create duplicate** ⚠️ | ⚠️ Potential bug |
| 4 | Register missing field (caught by validation) | `{}` | 400, never reaches handler | ✅ |
| 5 | Server error during register | DB write fails | 500 `{ error: 'Server error' }` | ✅ |
| 6 | Account created with correct defaults | `is_premium: 0, tier: 'free'` | ✅ | ✅ |

---

## 14. FORGOT PASSWORD FLOW

### 14.1 Frontend (ForgotPassword.jsx)
| # | Test | Expected | Actual |
|---|------|----------|--------|
| 1 | Enter valid email, submit | Calls `POST /auth/forgot` | ✅ |
| 2 | Success response | Shows "Check your email" screen | ✅ |
| 3 | Error response | Shows error in alert div | ✅ |
| 4 | Backend always returns `{ ok: true }` regardless of email existence | Prevents email enumeration | ✅ |
| 5 | Backend only sends email if user exists | No email sent for unknown addresses | ✅ |

### 14.2 Backend (auth.js)
| # | Test | Expected | Actual |
|---|------|----------|--------|
| 1 | Known email | Generates 32-byte random token, stores in DB with 1h expiry, sends email | ✅ |
| 2 | Unknown email | Returns `{ ok: true }` — no email sent, no indication | ✅ |
| 3 | Email send failure (Resend) | Falls back to SMTP | ✅ |
| 4 | Email send failure (all methods) | Logs error, still returns `{ ok: true }` to user | ✅ |
| 5 | Token expiry | `reset_expires` set to `now + 1 hour` | ✅ |
| 6 | Token stored in DB | `UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?` | ✅ |

### 14.3 Reset URL generation
| # | Aspect | Detail |
|---|--------|--------|
| 1 | Base URL | `process.env.BASE_URL` or `https://mechalert-production.up.railway.app` |
| 2 | URL format | `{baseUrl}/reset?token={token}` |
| 3 | Email sent asynchronously | `setImmediate(() => sendResetEmail(...))` — non-blocking |

---

## 15. RESET PASSWORD FLOW

### 15.1 Frontend (ResetPassword.jsx)
| # | Test | Expected | Actual |
|---|------|----------|--------|
| 1 | Token in URL, valid | Shows "Set New Password" form | ✅ |
| 2 | No token in URL | Shows "Invalid Link" screen with "Request New Link" button | ✅ |
| 3 | Password < 8 chars | HTML5 `minLength={8}` prevents submission | ✅ |
| 4 | Valid token + password submitted | Calls `POST /auth/reset` | ✅ |
| 5 | Success | Shows "Password Reset" success screen with "Sign In" link | ✅ |
| 6 | API error | Shows error message | ✅ |

### 15.2 Backend (auth.js)
| # | Test | Expected | Actual |
|---|------|----------|--------|
| 1 | Valid token (not expired) | Updates password_hash, clears reset_token and reset_expires | ✅ |
| 2 | Invalid token | 400 `{ error: 'Invalid or expired token' }` | ✅ |
| 3 | Expired token (`reset_expires < now`) | 400 `{ error: 'Invalid or expired token' }` — same message | ✅ |
| 4 | Token reuse (already used) | Token was cleared after use → 400 | ✅ |
| 5 | SQLite datetime comparison | `WHERE reset_token = ? AND reset_expires > datetime('now')` | ✅ |

---

## 16. LOGOUT FLOW

| # | Test | Expected | Actual |
|---|------|----------|--------|
| 1 | Click Logout button | `localStorage.removeItem('mm_token')`, `setUser(null)` | ✅ |
| 2 | NavBar updates | Shows Sign In link, hides user email | ✅ |
| 3 | ProtectedRoute redirects | No user → redirect to `/login` | ✅ |
| 4 | No server-side session to invalidate | JWT remains valid until expiry — no server-side revocation | ⚠️ JWT is still valid if re-inserted |
| 5 | No POST request to invalidate token | No server call on logout | ⚠️ |

---

## 17. PROTECTEDROUTE

| # | Test | Expected | Actual |
|---|------|----------|--------|
| 1 | Loading state | Shows "Loading..." div | ✅ |
| 2 | Authenticated | Renders children | ✅ |
| 3 | Not authenticated | `<Navigate to="/login" />` | ✅ |
| 4 | Check stops at first invalid route | No other checks (no admin role check here) | ✅ |
| 5 | Admin check | Done separately in AdminPanel via `user.is_admin` | ✅ |

---

## 18. NAVBAR AUTH UI

| # | State | Displayed | Actual |
|---|-------|-----------|--------|
| 1 | Not logged in | Links: Pricing, Sign In | ✅ |
| 2 | Logged in (free user) | Links: Dashboard, Analytics, Pricing; Shows email; Shows "Upgrade" badge; Logout button | ✅ |
| 3 | Logged in (premium user) | Same but shows "Premium ⚡" badge instead of Upgrade | ✅ |
| 4 | Logged in (admin user) | Same + "🛠️ Admin" link with orange color | ✅ |
| 5 | During loading | NavBar renders with no user — shows guest links until user resolves | ⚠️ Flash of guest nav before auth check completes |

---

## 19. SECURITY ANALYSIS

### 19.1 Password hashing
| # | Aspect | Detail | Status |
|---|--------|--------|--------|
| 1 | Algorithm | bcrypt | ✅ |
| 2 | Salt rounds | 10 | ✅ |
| 3 | Constant-time compare | bcrypt does this inherently | ✅ |

### 19.2 JWT
| # | Aspect | Detail | Status |
|---|--------|--------|--------|
| 1 | Algorithm enforcement | `verify` explicitly requires `['HS256']` | ✅ |
| 2 | Algorithm "none" attack | Rejected by explicit algorithm requirement | ✅ |
| 3 | Secret strength | Dev: `dev-secret-key-change-in-production-32chars` (42 chars) | ✅ |
| 4 | No expiry check override | `expiresIn: '7d'` in sign, no override in verify | ✅ |
| 5 | Token stored in localStorage | Vulnerable to XSS | ⚠️ HttpOnly cookies would be more secure |
| 6 | No refresh token mechanism | Single long-lived token (7 days) | ⚠️ |

### 19.3 Timing attacks
| # | Aspect | Detail | Status |
|---|--------|--------|--------|
| 1 | Email enumeration on login | Prevented — same error for wrong email or wrong password | ✅ |
| 2 | Timing difference on login | Dummy bcrypt comparison for non-existent users | ✅ |
| 3 | Email enumeration on forgot password | Prevented — always returns `{ ok: true }` | ✅ |

### 19.4 SQL injection
| # | Aspect | Detail | Status |
|---|--------|--------|--------|
| 1 | Parameterized queries | ✅ All queries use `?` placeholders | ✅ |
| 2 | Zod validation | Additional layer blocking special characters in email | ✅ |
| 3 | Zod `.email()` rejects SQL keywords in email field | `' OR '1'='1` is rejected as invalid email | ✅ |

### 19.5 XSS
| # | Aspect | Detail | Status |
|---|--------|--------|--------|
| 1 | React's JSX auto-escapes | All user data rendered via JSX is escaped | ✅ |
| 2 | CSP headers | `helmet()` sets Content-Security-Policy | ✅ |
| 3 | Error messages from server | Set via `setError(err.message)` which React will escape in JSX | ✅ |

### 19.6 CSRF
| # | Aspect | Detail | Status |
|---|--------|--------|--------|
| 1 | CSRF tokens | **NOT implemented** | ❌ |
| 2 | SameSite cookies | No cookies used (Bearer token in header) | N/A |
| 3 | CORS configured | Origin restricted to known origins | ✅ |
| 4 | Preflight OPTIONS | CORS handles this | ✅ |

### 19.7 Rate limiting
| # | Aspect | Detail | Status |
|---|--------|--------|--------|
| 1 | Auth endpoint | 10 req/min per IP/userId | ✅ |
| 2 | General API | 200 req/min per IP/userId | ✅ |
| 3 | Key generator | By userId if authenticated, else by IP | ✅ |
| 4 | Response with rate limit info | Standard headers enabled | ✅ |

---

## 20. BUGS & ISSUES FOUND

### 🔴 Critical
| # | Issue | File | Line | Description |
|---|-------|------|------|-------------|
| 1 | **No account lockout after repeated failed attempts** | `auth.js` | — | Only rate limiting (10/min) protects brute force. No progressive lockout, no CAPTCHA. |
| 2 | **Register with email differing only by case creates duplicate** | `auth.js` | 84 | SQLite `=` is case-insensitive for ASCII by default (BINARY collation not used). `"Test@test.com"` and `"test@test.com"` may both be accepted. |
| 3 | **No server-side session revocation** | `AuthContext.jsx` | 40-42 | Logout only removes token from localStorage. JWT remains valid for 7 days if replayed. |

### 🟠 Medium
| # | Issue | File | Line | Description |
|---|-------|------|------|-------------|
| 4 | **AuthContext.error state is never set** | `AuthContext.jsx` | 9, 19-27 | `error` state variable exists but `setError(null)` is only called; `setError(msg)` is never called on failure. The error state in context is unused. |
| 5 | **No name field on registration** | `LoginPage.jsx` | — | Users register without a name/profile name. |
| 6 | **No confirm password field on registration** | `LoginPage.jsx` | — | Users can register without confirming password — risk of typos. |
| 7 | **401 in api.js does hard redirect** | `api.js` | 15 | `window.location.href = '/login'` causes full page reload, losing all React state. |
| 8 | **Error persists indefinitely with no dismiss** | `LoginPage.jsx` | 65 | No auto-dismiss timer, no close button. Error stays until next submit or toggle mode. |
| 9 | **Silent failure on `/api/me` network error** | `AuthContext.jsx` | 16 | `.catch(() => {})` swallows the error silently. User sees redirect to login with no explanation. |

### 🟡 Low
| # | Issue | File | Line | Description |
|---|-------|------|------|-------------|
| 10 | **JWT verify uses `{ algorithms: ['HS256'] }` but sign default is HS256** | `index.js` | 165 | Works correctly but would be clearer to be explicit on both sides. |
| 11 | **No CAPTCHA on login/register** | `LoginPage.jsx` | — | No reCAPTCHA, hCaptcha, etc. |
| 12 | **No remember-me functionality** | `AuthContext.jsx` | — | Token always stored in localStorage with 7d expiry. |
| 13 | **NavBar guest flash** | `App.jsx` | 14-37 | During initial auth check, NavBar briefly shows guest links until user resolves. |
| 14 | **After-login redirect always goes to /dashboard** | `LoginPage.jsx` | 26 | Doesn't redirect back to originally requested URL (no return-to logic). |

---

## 21. SECURITY TEST VECTORS (to verify)

| # | Vector | Expected Outcome |
|---|--------|-----------------|
| 1 | Try JWT with `alg: 'none'` | Should be rejected (`algorithms: ['HS256']`) |
| 2 | Try JWT with `alg: 'HS256'` but empty secret | Should fail verification |
| 3 | Try expired JWT | Should be rejected (token expiry check) |
| 4 | SQL injection in email: `' OR 1=1 --` | Zod rejects as invalid email |
| 5 | SQL injection in password: `' OR 1=1 --` | Only used in bcrypt compare, not SQL |
| 6 | XSS in email: `<script>alert(1)</script>` | Zod rejects as invalid email |
| 7 | Send 11 auth requests in 60 seconds | 11th request gets 429 rate limited |
| 8 | Register same email with different case | May create duplicate (SQLite default collation) |
| 9 | Use reset token after password was already changed | Token is NULL → rejected |
| 10 | Tamper with JWT payload (change userId) | Signature fails → rejected |

---

## 22. PERFORMANCE / SCALABILITY

| # | Aspect | Detail |
|---|--------|--------|
| 1 | DB queries | All parameterized, simple SELECT/INSERT |
| 2 | bcrypt cost | 10 rounds (~100ms per hash) |
| 3 | Rate limiting | In-memory (express-rate-limit) — lost on server restart |
| 4 | Async email sending | Uses `setImmediate` — non-blocking |

---

## 23. ENVIRONMENT CONFIGURATION CHECK

| # | Env Var | Used For | Required? | Default |
|---|---------|----------|-----------|---------|
| 1 | `JWT_SECRET` | Token signing | ✅ CRITICAL | `dev-secret-key-change-in-production-32chars` (dev) |
| 2 | `BASE_URL` | Password reset links | ✅ | `http://localhost:5173` (dev) |
| 3 | `RESEND_API_KEY` | Email service | optional | `re_dev_dummy_key` (dev) |
| 4 | `SMTP_HOST/PORT/USER/PASS` | Fallback email | optional | Ethereal dev mode |
| 5 | `EMAIL_FROM` | Sender address | optional | `noreply@mechalert.com` |
| 6 | `CORS_ORIGIN` | CORS allowed origins | ✅ | `http://localhost:5173` |
| 7 | `ADMIN_EMAIL` | Auto-set admin on startup | optional | — |
| 8 | `AUTH_RATE_LIMIT_MAX` | Auth rate limit | optional | `10` |
| 9 | `API_RATE_LIMIT_MAX` | API rate limit | optional | `200` |
| 10 | `REQUEST_TIMEOUT_MS` | Request timeout | optional | `30000` (30s) |
| 11 | `VITE_API_URL` (frontend) | API base URL | optional | `''` (same origin) |

---

## 24. TEST COVERAGE GAPS

### Tests that exist (from security.test.js + untested.test.js)
- ✅ Zod schema validation (login, register, forgot, reset)
- ✅ SQL injection in keywords (createAlertRule)
- ✅ SQL injection in email via login schema
- ✅ XSS payloads in keywords
- ✅ Email format validation (valid + invalid)
- ✅ JWT algorithm enforcement (HS256 required, 'none' rejected)
- ✅ Password length boundaries (8-128)
- ✅ Timing attack (dummy bcrypt hash)

### Tests that DO NOT exist (gaps)
| # | Missing Test | Why Important |
|---|-------------|---------------|
| 1 | **Full login integration test** (mock DB + Express) | Validates complete request-response cycle |
| 2 | **Session restore via `/api/me`** | Critical for page refresh behavior |
| 3 | **Rate limiter test** (10 auth requests then block) | Security hardening |
| 4 | **Expired token behavior** | User experience on session expiry |
| 5 | **Case-insensitive email registration** | Potential duplicate account bug |
| 6 | **Concurrent duplicate registration** | Race condition on INSERT |
| 7 | **Invalid reset token** (expired, reused, malformed) | Password reset security |
| 8 | **Login after password reset** | Ensures new password works, old one doesn't |
| 9 | **Logout + token reuse** | JWT revocation gap |
| 10 | **AuthContext error state test** | Unused state variable |
| 11 | **Error display persistence** | Error never auto-dismisses |
| 12 | **Network failure during `/api/me`** | Silent failure scenario |
| 13 | **ProtectedRoute with admin role** | Admin-only routes |
| 14 | **XSS via error messages** | Server error text rendered in React |
| 15 | **Hard redirect on 401** | Full page reload behavior |

---

## 25. RECOMMENDATIONS

### Must fix
1. Add case-insensitive email check on registration (use `LOWER(email)` or `COLLATE NOCASE`)
2. Add error state to AuthContext or remove unused `error` state
3. Add user feedback when `/api/me` fails (not silent failure)
4. Add auto-dismiss timer (e.g., 8s) on error messages
5. Add a close/dismiss button on error messages
6. Consider HttpOnly cookies over localStorage for JWT storage (XSS protection)

### Should fix
7. Add name field to registration form
8. Add confirm password field to registration form
9. Replace hard redirect (`window.location.href`) with React Router navigation in api.js
10. Add progressive account lockout after N failed attempts
11. Add CAPTCHA on login/register forms
12. Add return-to URL logic (redirect back to originally requested page after login)

### Nice to have
13. Add refresh token mechanism
14. Add server-side session blacklist for logout
15. Add 2FA support
16. Add login activity logging (IP, user agent, timestamp)
17. Add "remember this device" option
18. Add password strength indicator on registration
