# Don Mac POS — Forgot Password OTP (account & branch scoped)

## API and provider routing
`public/auth-login-v1574.js` posts `{username,email}` to `POST /api/auth/forgot/request`.
The backend in `lib/account-recovery.js` looks up the exact combination against
`users`, validates `chat_memberships` and `chat_workspace_branches`, then
submits an HTTPS request using `lib/resend-otp.js` to `https://api.resend.com/emails`.
The destination is the account's registered `users.email`, not the username
and not the Admin Control email. The sender is `RESEND_FROM_EMAIL` on the Main
POS Railway service; the key is `RESEND_API_KEY`. Values remain secret.

## Rules
- Reset requires the POS account username **and** its exact registered email
  address. Gmail is accepted; other registered email providers also work.
- The same address can belong to users in separate franchises because the
  username and validated workspace/branch association identify the account.
  Reused username/address combinations or missing/mismatched ownership fail
  closed rather than selecting a random branch.
- "User not found" responds to a mismatch or inaccessible account, never an
  OTP success. Public failures are rate limited; consider a centralized rate
  limiter or WAF before adding more horizontal replicas.
- Admin/Co-Owner can be workspace-scoped without a branch. Cashiers must have
  active branch membership in the same workspace.
- Password OTPs bind user ID, workspace ID, branch ID, and normalized registered
  email SHA-256 fingerprint. Expire after 10 minutes, 5 attempts, 60-second
  DB-backed resend cooldown; reset invalidates sessions and used OTP.
- An OTP created before this migration lacks the branch binding. It cannot be
  confirmed; user must request a fresh code.
- Only advance UI after the provider accepts the mail or an unexpired cooldown
  applies from a prior request. Provider acceptance != inbox delivery.
- Provider failure logs safe metadata: status, provider reason, workspace/scope,
  never OTP, email, credentials, API response body.
- Franchise signup OTP remains associated with the specific application ID and
  cannot enable POS login until isolation and Admin Control approval.

## Verification
Run `node scripts/otp-isolation-test.js` (mock Resend), then use a real
registered **test** account to send a single OTP and verify delivery via
Resend's Logs and inbox (including Spam). Real delivery isn't proven by having
the `RESEND_API_KEY` and `RESEND_FROM_EMAIL` variable names in Railway.
