# Marlou09 test-stock reset and transfer branch selector

As requested, all existing isolated ingredients in marlou09's three branches have a **starting test balance of 5 each**. This was confirmed via Railway startup logs on 2026-11-14: `status=already_applied`, `branches=3`, `ingredients=156`, `changed=0`. The one-time marker prevents later deployments from resetting real activity back to five. New marlou09 branches continue to inherit five; unrelated future franchisees continue to inherit names, designs and costing with **zero** stock.

Inventory transfer inputs are selects: **Transfer From**, **Transfer To**, **Received By (Branch)**. The backend lists only active branches assigned to the authenticated user's workspace. Cashiers are limited to their assigned source; owners can select among their own active sources. Destination must differ from source, and the receiving branch must equal the destination. The backend validates this even if the client sends manual IDs. Business plan gate remains unchanged.

**Important remaining limitation:** The existing `/api/inventory/transfer` process still deducts from the legacy global `ingredients` table and writes to the legacy movement log. It does **not yet** credit the isolated destination branch. The UI explicitly notes this. Do not interpret the selection change as completion of Phase 2 inventory transfer cutover. The prepared isolated stock reset affects `branch_ingredients`, not live legacy `ingredients` read by the existing inventory screen and checkout.

No sales, shared stock, or historical transaction records were deleted or reset. The user proposed a possible wipe **later**, which has **not been performed or scheduled**. After full cutover tests pass, archive and reconcile original records, take another independently verified backup, and request a separate explicitly authorized clean-up.

Regression tests: `node scripts/inventory-transfer-branches-test.js` and `node scripts/marlou-test-stock-reset-test.js`.
