# Don Mac POS — Commercial rollout and migration acceptance (2026-11-17)

## Release decision

**Existing live production deployment:** operational for the current isolated-workspace POS implementation.

**Commercial onboarding at scale:** **conditional go-live**, not an unconditional final approval. Manual Admin Control payment verification is accepted; PayMongo activation is not a prerequisite. The franchise owner has reported successful manual cross-account / cross-branch verification. This acceptance is treated as the verified functional baseline, but is not a replacement for backup, monitoring, billing, security and capacity checks.

No legacy tables or production data should be deleted as part of this milestone.

## Verified or implemented

- New franchise accounts with `data_mode=NEW` use tenant-scoped `/api/live/*` handlers. Server-side workspace identity is obtained from the authenticated session. Product, ingredient, recipe, branch stock, checkout, receipt, reports, employee controls and finance queries are scoped by workspace and branch.
- Existing user acceptance: accounts and branches do not display one another's business records; user confirms the tested flows work as expected.
- Main POS layout, checkout, branch costing, payroll/attendance and message permissions have passed GitHub automated regressions.
- Sidebar collapse now loads independently for **both** original and isolated accounts. The old enhancement does not install a duplicate click listener.
- System Logs has a new read-only isolated route: `GET /api/live/system-logs`, Owner/Co-Owner only. It reports authenticated-workspace checkout events, inventory movements and saved expenses, with search, category filtering and pagination. It does **not** invent historical logs that were never stored.
- The franchise login remains restricted by Admin Control plan status. Cashiers retain assigned branch restrictions and explicit permission grants.
- Original POS remains on its legacy routes. The new-workspace routing fails closed if a legacy operation does not have an isolated counterpart.

## Remaining release gates — resolve before unrestricted paid signups

### 1. Backups and recovery — **BLOCKER for broad paid onboarding**

Independent backup service: `DonMac-Backup-Verify` (Railway), scheduled at 02:00 Asia/Manila (`0 18 * * *` UTC), with a private `DonMacBackups` bucket.

- Earlier verified full custom-format PostgreSQL dump: 2026-11-14, successfully restored to an independent scratch database, with checksums and 15-table integrity validation.
- **Status checked November 17:** Railway reports the most recent scheduled execution as `running` (start 2026-11-16 18:02 UTC). The status alone does not prove it completed, nor that a fresh remote archive is restorable.
- Confirm a current scheduled archive, its remote SHA-256 metadata, complete restore into a scratch database, representative live `branch_live_*` / payroll / chat table counts and application login to a recovery clone. Do not place backup archive URLs or credentials in client-side files.
- Add off-provider encrypted backup replication, test restore latency, define RPO/RTO and alert on a missed or failed daily backup.

### 2. Legacy master-account cutover — **NOT yet performed**

`marlou09` and any other intentionally retained legacy shared-data workspace still use legacy POS records; they are **not** automatically migrated by enabling isolated new franchise signup.

- Prepare an ownership-mapped, read-only reconciliation of products, recipes, ingredients, stock, sales, expenses, attachments and exports.
- Restore a fresh production snapshot to staging; explicitly map each legacy branch to a workspace; identify ambiguous references.
- Verify parity by branch for stock units, recipe costs, financial totals, sales references and cashier permissions.
- Cut over the original account through a separate approved migration with rollback. Never zero out or delete shared production stock/sales as a shortcut.

### 3. Audit coverage — **PARTIAL**

Current isolated System Logs covers saved sale audit events, branch inventory movements and recorded expenses. Historical legacy logs are not backfilled, and it is not yet a comprehensive platform security audit of every account-creation, permission, login, password reset, data export, payroll edit or Admin Control plan change.

- Add server-side append-only entries for privileged changes, billing updates, permission changes, archive and restore actions, and user account changes.
- Verify retention, access control, export, tamper resistance and incident traceability.

### 4. Manual payments and account recovery — **MANUAL BILLING ACCEPTED FOR PILOT**

**Commercial decision (2026-11-17):** PayMongo is deferred. All franchise subscription payments are verified manually by the platform owner, then approved and renewed through Admin Control. The PayMongo application is hidden in every Main POS Account Settings page. Customer online checkout is disabled until the platform owner explicitly opts in to future PayMongo integration with `PAYMONGO_CHECKOUT_ENABLED=true` and valid API/webhook credentials. This **does not change** cashier customer checkout (Cash/GCash) or stock deduction.

Required manual control per payment:
1. Confirm externally received funds (bank/GCash or agreed payment channel), not merely a submitted screenshot.
2. Match amount and reference to the **correct franchise workspace**, selected plan and branch fees.
3. Set the account plan, subscription status (`PAID` / `UNPAID` / `ON_HOLD`) and next renewal date using **Admin Control**, with an auditable payment reference and remark.
4. Retain an independent finance receipt/ledger and reconcile manual receipts to external bank statements. The legacy PayMongo invoices/verified revenue metrics do **not** automatically count manual payments.
5. Run manual status/expiry, Pro-vs-Business, extra-branch and downgrade tests; confirm Cashier POS access is suspended on Unpaid/Hold without hiding Owner setup access.

Account recovery checks remain separate: OTP delivery, employees without email, admin-initiated recovery, and production email-provider health still require verification before broad onboarding.

### 5. Scale, security, availability and commercial operations — **NEEDS testing**

- Load-test against realistic concurrent terminals (target previously discussed: 800 franchisees with up to two branches); include checkout locking, chat polling, report queries, PostgreSQL connection usage, storage growth and backup duration.
- Set performance budgets, indexing/slow-query alerts, app error monitoring, independent uptime and disk alerts, database storage thresholds and deploy rollback plan.
- Complete a security review of tenant authorization, direct API access, session/logout/OTP, file uploads, rate limits and credentials. User acceptance tests are valuable but do not replace security or compliance review.
- Publish customer terms, data retention/privacy notices, billing policies, deployment/change management and support escalation.

## Safe rollout sequence

1. Keep the presently tested isolated accounts live; preserve the current PostgreSQL volume and verified backup archive.
2. Resolve the latest backup-job status and complete a fresh restore verification.
3. Use approval-only paid onboarding for a small pilot cohort, with activity and error monitoring.
4. Check checkout reconciliation and stock movements daily during the pilot; log and resolve anomalies before increasing scope.
5. Expand enrollment gradually only after the backup, audit, payments, recovery, operational and load-test gates above are satisfied.
6. Migrate the original master account only through a separately approved, reversible cutover with explicit ownership mapping.

## Rollback

- Preserve the prior successful Railway deployment and database snapshot before any schema/data migration.
- For an application-only regression, roll back the service deployment without restoring over newer transaction data.
- For a database migration, use staged additive migrations and a documented forward-fix or recovery-to-clone plan; never overwrite a live database with an older snapshot without accounting for new sales.
- Fail closed on cross-tenant permission errors; do not route around the isolated API adapter to restore a broken feature.

## Evidence recorded

- Owner/user acceptance: manually tested franchise/branch isolation, reported successful on November 17, 2026.
- GitHub: `Paid franchise live POS cutover` regression and real PostgreSQL cross-franchise tests.
- Railway production: `DON-MAC-V2` and `Postgres` online at the time of this review.
- Independent backup restore proof: `docs/branch-isolation-phase2-status-20261114.md`.
