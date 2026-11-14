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

## User acceptance — isolated test portal (2026-11-14)
- [x] **User-confirmed**: test franchise ingredients, product pricing, simulated checkout and corresponding stock deductions behave independently in the Phase 2 test portal. This is a manual acceptance report, not independently observed live transaction logs.
- [ ] **Security denial button**: confirm **Test shared-catalog access denial** returns `403 Forbidden` for an isolated test account (not yet explicitly reported).
- [ ] **Production checkout cutover**: independently verify the full real cash/GCash/add-on/promo/package checkout and reports operate on branch-scoped data. The portal's simulated test sales are stored separately from live POS sales.

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
