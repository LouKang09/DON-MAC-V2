# OTP and Resend: franchise isolation safeguards

## Configuration
Main POS service requires `RESEND_API_KEY` and `RESEND_FROM_EMAIL`, the latter set to a sender belonging to a **verified Resend domain**. Service variables being present does not guarantee message delivery. Never put API keys in code, endpoints or logs. Supply Office does not need the OTP sending key.

## Password reset
- OTP identity is **user ID + workspace ID + normalized registered email fingerprint**; no tenant can reuse another tenant's code.
- An ambiguous email address shared by multiple accounts does not pick a random user or tenant. Request the exact username.
- Codes last 10 minutes, are single use, hashed and capped at five attempts.
- A distributed per-user 60-second resend cooldown is enforced atomically in PostgreSQL. IP throttling is additionally enforced in-process (not a replacement for WAF/rate-limit gateway when scaling).
- Moving an account to another franchise or updating its registered email invalidates the old code. Previously issued unscoped codes are not migrated.
- Password reset never changes the user's assigned franchise or branch.

## Franchise signup
- Registration returns an opaque `applicationId` for newly submitted applications; OTP request and verification carry it back.
- Hashed OTP data remains on `public_franchise_requests`, keyed by that **specific application ID**, not by a global shared email record.
- Email-only compatibility is limited to a single unambiguous pending application; it cannot silently choose another franchise application.
- The OTP confirms the applicant's email only. It **does not** grant owner login, subscribe, provision a workspace or activate a POS.
- Resend is the preferred delivery transport, SMTP is used only if Resend is absent. Failures log provider category/status (not OTP, key, recipient email or raw response).

## Verification
Use GitHub Action **Don Mac OTP isolation checks** or `node scripts/otp-isolation-test.js`. Unit tests mock Resend delivery (never send real mail). Railway startup/health confirms the application is online, but **real delivery acceptance and inbox arrival require a controlled test to a known recipient**. Do not infer provider verification merely from variable names.

The live POS still uses legacy catalog until franchise isolation cutover is separately verified.
