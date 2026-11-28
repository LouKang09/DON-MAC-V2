# Commercial Phase 2 — role audit and first refinement pass

## Scope and decisions
The cashier Sales Report is now personal rather than branch-wide, per the product owner's clarification. This applies to current report JSON, sales PDF and today's print shortcut, in both isolated and legacy paths. The cashier user ID is derived from the authenticated session, never a supplied name or ID. Cost totals and recorded deposits are filtered by that same cashier. The existing operational dashboard, inventory, expense and transaction permissions are not expanded or redefined by this change.

Owner-only report fields, history export, cost breakdown, transaction logs, subscription notices and inventory audit are hidden for cashier accounts. The report date is fixed to today; only owner-approved daily/weekly/monthly choices are offered. Initial stock is owner-only; the transfer action is hidden for staff when the plan or authorized destination list does not support it. Owners retain the upgrade interface.

Phase 2 first pass aligns POS/product cards, dashboard and metric cards, report filters, inventory surfaces, Supply Office and Admin Control tables and panels through one shared stylesheet. This is a controlled initial rollout; remaining screen-by-screen redesign and authenticated device regression testing are separate work.

## Tests
- JavaScript syntax checked for edited scripts.
- Mocked query tests exercised live staff and owner scope, unauthorized dates/periods, cost/deposit scope, tampered PDF request selection and legacy staff/owner filtering. No production records were written.
- Repository regression script: node scripts/commercial-cashier-role-scope-regression.js
- Existing cashier privacy regression assertions updated for the shared print exporter.
- Real browser layout, two-cashier authenticated comparisons, every role/grant combination and hardware/APK behavior require further end-to-end verification.

## Known follow-up
The existing isolated owner on-screen cashier filter was not forwarded by the compatibility adapter (owner PDF already accepts selected cashier names). This separate owner-report filter consistency issue requires a follow-up that aligns all aggregates, cost and deposit semantics. Do not claim full cross-role end-to-end certification from the mock tests.
