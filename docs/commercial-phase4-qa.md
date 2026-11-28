# Commercial QA — Phase 4

Scope: Main POS, Android WebView, Supply Chain and Admin Control. Use a disposable test database for all write/concurrency tests; never exercise live checkout or account creation merely to test production.

## Release acceptance
- [ ] Commercial release gate: asset integrity, responsive browser matrix, authenticated account-switch privacy, cashier report and PDF redaction, PostgreSQL scoped reports.
- [ ] Paid franchise cutover: PostgreSQL checkout/stock concurrency, voids, inventory receipts/transfers, unpaid checkout denial, OTP signup, role visibility.
- [ ] Real mobile navigation: Attendance active tab, Transactions group collapsed on reopen, More active state, Escape dismissal.
- [ ] Confirm Railway deploy success for the exact merged SHA in both services; inspect sampled runtime/HTTP errors after deployment.
- [ ] Physical Android: portrait/landscape, keyboard open/closed, system back, Exit, login/logout, GCash/Cash checkout and print/download; use a designated test franchise.
- [ ] Owner/co-owner/cashier permissions and subscription lifecycle on approved test accounts.
- [ ] Supply office and Admin Control: receiving, promotion lifecycle, billing, office permissions, downloads.
- [ ] Backup/recovery rehearsal against disposable recovery database, not production.
- [ ] Performance/capacity testing with representative branch/catalog/history volumes; record latency/error rate and resource headroom.
- [ ] Resolve historical version-specific assertions or replace them with equivalent current behavioral tests, retaining coverage of security and data integrity.

## Legacy regression debt
Six historical suites already fail on baseline 110f9ea7e1906ea424f2ab6bf234b41e246aaf7a. The comparison job records and rejects a changed first exception; it does not certify remaining assertions in those suites. Do not interpret a successful comparison as six passing suites.

## Release notes
The Phase 3 review identified mobile active-tab selection relying on desktop navigation (no Attendance item) and More not highlighting transaction/expense destinations. Phase 4 corrects these and explicitly resets the Transactions drawer on reopening. No production schema or stored-data changes are needed for this iteration.
