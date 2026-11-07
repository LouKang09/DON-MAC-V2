# Franchise-level isolation and secure account activation

**Status: staged implementation. Public request and email OTP verification are available; isolated starter-catalog preparation is available to Admin Control. Full public account activation remains disabled until live POS workspace isolation is complete.**
Current public signup submits an Admin Control request only. Do not activate new accounts until the isolation tests below pass. Never clear shared production tables to initialize a new franchise.

## Existing boundaries and risks

- `chat_workspaces`, `chat_memberships`, and `chat_workspace_branches` already model franchise/team and branch membership.
- Many POS tables currently contain global records, including `products`, `add_ons`, `ingredients`, `product_ingredients`, `packages`, `package_items`, and `promos`. `app_settings` is global.
- Inventory balances and many inventory movements are not yet franchise-scoped. `sales` has branch attribution, but must consistently be checked against the authenticated workspace.
- `lib/franchise-starter-catalog.js` is a **read-only blueprint preview**, not a tenant-safe provisioning API.
- Password reset uses `account-recovery` with Resend/SMTP support. New-account email verification requires an independent, audited token lifecycle.

## Implemented safeguards (v1.5.98)

- New self-service signup requests remain separate from `users`; no credentials are issued.
- `lib/franchise-email-verification.js` supplies six-digit OTP verification (10-minute expiry, five-attempt budget, one-minute resend cooldown, hashed code, Resend/SMTP). Admin Control sees whether an email is verified.
- `lib/franchise-tenant-staging.js` allows only an authenticated Admin Control operator to explicitly approve a starter catalog after email verification. Each application obtains a separate staging key and fresh product/ingredient/recipe/add-on IDs. Opening stock is constrained to zero. No existing products, stock, sales, users, payments or chat rows are updated.
- `franchise_provisioning_stages.stage_status=PREPARED_NO_ACCESS` means **not** activated: the staged catalog is not yet connected to the live POS route.
- CI regression tests cover OTP and isolated idempotent staging.

## Step 1 — Audit and snapshot

1. Take an encrypted, restorable database backup and record table counts and checksums before migration.
2. Inventory every API, report, job, export, WebSocket/chat process, and cache that reads or writes catalog, inventory, sales, billing or attachments without a workspace condition.
3. Produce a backfill report mapping existing sales by `branch_id -> chat_workspace_branches.workspace_id`. Flag missing, duplicate or ambiguous mappings for manual review.
4. Do **not** attribute old shared products/stock to a franchise based solely on a logged-in user or the current Owner. Explicitly identify the business owning each legacy record.

## Step 2 — Isolate all business data

1. Introduce `workspace_id` on tenant-owned root entities: catalog products and categories, ingredients and ingredient balances, add-ons, packages, promotions, orders/sales, expense entries, ledger entries, reports and configurable settings. Keep branch_id for branch-scoped sales and transfers.
2. Scope recipe and package joins to products and ingredients in the **same** workspace. Add composite unique indexes such as `(workspace_id, sku)`, `(workspace_id, product_name)`, `(workspace_id, ingredient_code)` instead of global uniqueness.
3. Backfill after explicit ownership mapping; preserve historical IDs and references, or maintain an immutable mapping table for any cloned catalog records. Put ambiguous legacy rows into a restricted reconciliation state.
4. Change reads and writes together: `getCatalog`, quote/checkout, product admin, recipe & costing, replenishment, transfers, every dashboard, reports, exports, backups, restore, app settings and images.
5. Resolve the workspace from the **authenticated server session**, never from user-provided `workspaceId`. Verify every requested branch is mapped to it.
6. Enforce workspace-aware foreign keys and, if practical, PostgreSQL Row Level Security as defense in depth. Test pooled connections so no workspace context can leak between requests.

## Step 3 — Starter catalog and independent stock

1. Approve and version an explicit master starter template (Coffee, Non Coffee, recipes, essential ingredients). Template maintenance belongs to platform Admin Control, not to any arbitrary franchise.
2. In a single idempotent transaction, create one workspace and an independent catalog (with new IDs and a source-to-new ID mapping) and copy only approved template definitions and optionally public default image assets.
3. Initialize every new franchise ingredient balance at **zero**. An Owner enters opening inventory or imports a verified count, creating an OPENING_BALANCE audit movement.
4. Products without validated recipes/ingredients remain Not Available until properly configured and replenished.
5. Never copy source franchise customers, users, payment references, sales, inventory quantities, expense ledgers, bank balances, reports, chat history, or credentials.
6. Scope backups/restores and stock movements to one workspace; branch transfers must not transfer between unrelated franchises.

## Step 4 — Email verification and secure activation

1. A public request remains `REQUESTED`; introduce statuses such as `EMAIL_PENDING`, `EMAIL_VERIFIED`, `ADMIN_APPROVED`, `PROVISIONING`, `READY`, `ON_HOLD`, and `REJECTED`.
2. Verify ownership of the requested email using a separately hashed, single-use OTP or signed token (for example 10-minute expiry, 5 attempts, 60-second resend cooldown, IP/email throttling, no user enumeration). Configure Resend or SMTP and verified domain.
3. Only after verified email and Admin Control approval, provision the workspace, catalog, opening stock ledger and inactive Owner user atomically. Use an idempotency key and safe rollback/cleanup on failure.
4. Invite Owner to set their **own** strong password through a time-limited one-use link; never transmit or store plaintext credentials or create a default password.
5. Activate sign-in only when the workspace isolation test passes, onboarding has completed, and the platform plan is permitted by subscription policy. New workspaces start UNPAID unless an explicitly approved trial is configured; this must never bypass payment-status enforcement.
6. Record every approval, email verification, activation, plan change and provisioning failure in an Admin Control audit.

## Step 5 — Mandatory pre-launch tests

- Two workspaces A/B can reuse the same product names and ingredient codes without data collisions.
- A's Owner/Cashier cannot read or mutate B's products, recipes, inventory, sales, expenses, backups, reports or chats via normal UI or direct API.
- Cashiers can access only permitted branch operations; owners/coowners have view-only POS order access while cashiers alone can submit checkout.
- A freshly created franchise shows **zero** sales and zero stock, even when A's existing catalog has 10,000 sales.
- Cross-workspace ingredient IDs or product IDs in a checkout return 403/404 and do not adjust stock.
- An interrupted provisioning retry does not create duplicate workspaces, users, templates, or opening stock.
- Email replay, expired token, brute force, rate-limit, unverified signup and unpaid/on-hold account tests all fail closed.
- Run backup restoration dry-run and count/checksum reconciliation before live launch.

## Rollout

Use an additive schema migration and shadow-scoped read validation on a staging clone first. Reconcile legacy ambiguous records; then make all read paths workspace-scoped and all write paths atomic. Roll out to existing franchise accounts with active monitoring, then enable approval-only activation for a test workspace. Enable unrestricted self-service activation only after audit and payment policy are verified.

**Never delete or reset existing catalog, stock or sales to create a tenant.**
