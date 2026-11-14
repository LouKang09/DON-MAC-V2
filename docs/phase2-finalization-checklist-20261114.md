# Don Macchiatos POS — Phase 2 finalization checklist
Updated: 2026-11-14 (Asia/Manila). Status is based on the connected GitHub implementation and Railway deployments.

## Deployed / built
- [x] Add branch/workspace-scoped PostgreSQL catalog, recipe, ingredient, movement, and starter-template tables without deleting global records.
- [x] Prepare three marlou09 branch catalogs with 52 ingredients per branch; one-time initial test stock of 5 units each (156 records), while future franchise templates start at 0.
- [x] Produce and independently restore a private PostgreSQL backup, verify 15 tables, and schedule daily Railway backups. (Off-provider copy is still a separate hardening item.)
- [x] Enforce owner/workspace authorization on branch selection and inventory transfers.
- [x] Display isolated stock in the Inventory screen (distinct from the not-yet-cutover checkout engine).
- [x] Build branch-scoped incoming supply requests and Accept / Reject / Save Received Stock with transactional source deduction and destination credit.
- [x] Provide account-scoped email OTP workflow and error handling.
- [x] Add cashier-specific **View Transactions**, **View Expenses**, **Record/Edit Expenses** checkboxes; guard finance APIs and pin cashier finance data to their assigned branch. Owners/Co-Owners retain admin access.
- [x] Enable **explicit Phase 2 TEST accounts** for reviewed, OTP-verified, staged applications. Admin Control issues a one-time password, a unique workspace, one independently seeded branch with zero stock, and an isolated test portal; login can be disabled immediately. Test-only stock replenishment, simulated checkout deduction, product price edits and private test-sales reports are supported. All normal checkout, global catalog editing, billing and exports remain blocked for test tenants. These tests do NOT replace real POS cross-franchise cutover testing.

## User acceptance — functional isolation (2026-11-14)
- [x] **User-reported acceptance beyond the test portal**: ingredients, product pricing, checkout and stock deduction were observed to behave independently in the tested accounts/branches. Accept this as completed user testing; do not request an identical manual retest. Precise production route and database table usage were not established by the report alone.
- [ ] **Code-level production checkout alignment (separate from user acceptance)**: as of commit `dbbdda3afe514638fdc52bac54b8d88e0d398f76`, `getCatalog`, `quoteOrder` and `createSale` still query legacy global `products`/`ingredients`/`product_ingredients` paths. Complete scoped API conversion and verify through integration tests before declaring full franchise isolation.

## Additional manual acceptance — independent franchise data (2026-11-14)
- [x] **User-confirmed catalog/recipe/costing isolation:** Created product `test1` with its own ingredients and costing. The user observed that the product remained within the intended account and was not visible in the separate `test1` and `test123` accounts.
- [x] **User-confirmed transaction isolation:** Completed transactions using Mike and SarahG; each account displayed only its own transaction records in the tested views.
- [x] **User-confirmed isolated testing:** Ingredients, pricing, checkout, and deduction were tested across the accounts as reported. These are accepted manual results; do not request identical retesting merely because the legacy production API migration is still outstanding.
- [x] **`marlou09` checkout-to-inventory deduction bridge built and PostgreSQL-tested 2026-11-14**: regular checkout updates `ingredients` and the matching `branch_ingredients` record (resolved by source ingredient code) in the **same sale transaction**. Scope is restricted to the original `marlou09` workspace and the sale branch. A matching `POS_SALE` branch movement is recorded, and deleting a sale with stock restoration credits back both stock stores in the same transaction. If isolated stock is insufficient or a mapping is missing, the sale rolls back. This does **not** reset or retroactively rewrite pre-bridge stock/receipts.
- [ ] **Post-deployment acceptance — `marlou09` only**: confirm one NEW completed sale decreases the matching selected branch ingredient balance from its currently visible value. Verify the change with six-decimal Inventory display and a `POS_SALE` movement; do not infer historical deductions were automatically backfilled.

## User acceptance — isolated test portal (2026-11-14)
- [x] **User-confirmed**: test franchise ingredients, product pricing, simulated checkout and corresponding stock deductions behave independently in the Phase 2 test portal. This is a manual acceptance report, not independently observed live transaction logs.
- [x] **Security denial button — user-confirmed 2026-11-14**: **Test shared-catalog access denial** returned `PASS · shared catalog blocked (403)` for an isolated Phase 2 test account. This verifies denial of `/api/catalog` from the test portal; it does not validate every production endpoint.
- [ ] **Production checkout code verification (not a request to repeat user testing)**: reconcile the regular cash/GCash/add-on/promo/package checkout and reporting implementations with isolated `branch_*` data. The portal's simulated test sales are stored separately from live POS sales.

## Phase 2 isolated test workspace stock enforcement (2026-11-14)
- [x] **Implemented**: Test-only simulated checkout now computes the maximum whole-number product quantity from the isolated `branch_recipes` and `branch_ingredients` snapshots. Quantity input auto-clamps to the available stock limit (maximum 25 per test simulation).
- [x] **Implemented**: When any required ingredient is exhausted or inactive, the simulated-checkout button and quantity input disable; the product selection and warning display show `OUT OF STOCK`, specific ingredient balances, and recipe-required status. Low-stock warnings appear before the final unit.
- [x] **Implemented**: Successful simulated sale reloads stock and re-applies the disabled state; a 409 race also reloads availability, and the submit button is not inadvertently re-enabled in cleanup.
- [x] **Automated**: branch-catalog-read test and Phase 2 test checkout quantity regression passed.
- [ ] **Live account acceptance**: Verify the disabled button/quantity in a real Phase 2 test workspace such as SarahG after the last usable ingredient is sold. This is separate from already-accepted franchise isolation tests.

## New-product POS stock availability correction (2026-11-14)
- [x] **Implemented**: Newly added and existing recipe products now provide complete ingredient stock/recipe data to the POS cart planner, including shared ingredient use across multiple product lines and packages. Product cards and plus buttons disable before adding quantities beyond stock; out-of-stock and low-stock warnings show ingredient details.
- [x] **Server-side quote preflight**: The original Marlou09 workspace checks both legacy checkout stock and its actual branch stock before payment, with transactional checkout deductions unchanged. Final checkout continues to enforce stock safety.
- [x] **Automatic cross-terminal UI refresh**: POS availability updates every 10 seconds while visible and on focus, plus immediately after successful checkout, without discarding the current cart.
- [x] **Automated regression**: zero/low stock, new recipes, shared/cart aggregate quantities, package ingredient overlaps, cross-franchise client state, branch source consistency, and quote guard.
- [ ] **Live UI acceptance**: Test a newly created product with insufficient inventory in the actual POS; verify disabled product button, accurate hover warning, disabled quantity +, and automatic refresh after a different cashier completes the last-item sale. Do not mark this live acceptance complete solely from CI.

## Must finish before Phase 2 can be called complete
- [ ] **Checkout critical path**: switch all /api/catalog, /api/quote, /api/sales, product recipes, stock reservations/deductions, returns/reversals, and checkout stock-availability checks to the branch catalog in a single coordinated plan; confirm cash, GCash, addons, promos and packages do not mix legacy stock.
- [ ] **Admin CRUD and costing**: isolate every product/ingredient edit, image/category edit, recipe & unit-cost update, promos, packages, cost reports, replenish and transfer audit views per workspace+branch; avoid global writes.
- [ ] **Historical sales integrity**: preserve legacy product IDs and past receipts; map branch catalog IDs to new-sale snapshots, update all reports and exports, and ensure past totals do not change when catalog changes.
- [ ] **End-to-end inventory transactions**: test concurrent checkout, insufficient stock, double-click retries, transfers accepted/not received, rejected requests, supplier receiving, branch deactivation, invalid destination, and complete stock movement reconciliation.
- [ ] **Finance and staff acceptance**: sign in as an owner and at least two real cashier accounts from distinct branches, grant/revoke Transactions and Expenses, verify navigation and API 403s, and check non-owner branch filters and edit logs.
- [ ] **Cross-franchise isolation**: test two independent franchise workspaces, one shared-looking product name, overlapping emails/branches, and ensure no cross-tenant reads/writes from APIs, exports, chat, backup, or reports.
- [ ] **New franchise provisioning**: create a clean demo franchise and verify stock=0, independent catalog names/images/recipes/costing, and no copied sales, credentials, or old history.
- [ ] **Operational recovery gate**: fresh backup immediately before cutover; independently restore and reconcile a representative sales/stock snapshot; off-provider encrypted backup and tested rollback.
- [ ] **Controlled launch**: feature flag, deployment smoke tests, monitor API errors and stock variances, test deactivate/reactivate/plan changes, confirm production rollout to one branch before all branches.
- [ ] **Security regression**: owner-only permission editing, inactive-account denial, per-branch finance filters, live revocation and server-side access checks, rate limits and audit history.

## Deferred cleanup (not authorized)
- [ ] Only **after** completed Phase 2 validation and a fresh verified backup, ask for separate explicit authorization before deleting/resetting marlou09's test stock and transactions. Keep starter template names, costing, images, recipe design and future-account stock=0 unchanged.

> This checklist is not a declaration of full production isolation. The legacy checkout engine is still the top outstanding risk. Completing the new cashier finance controls does not cut over checkout.
