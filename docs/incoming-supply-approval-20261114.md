# Incoming Supply — branch-specific approval and receiving

This workflow replaces the old immediate legacy stock edits with requests and confirmed delivery on isolated branch ingredients. Replenish and transfer are now **not** legacy-global stock operations.

**Replenish:** branch staff selects a receiving branch (owner choices are restricted to owned active branches; cashier is locked to assigned branch), selects the ingredients and quantity, enters supplier/from and optional expected deliverer, then submits. Pending request is visible in the branch's Incoming Supply panel. Staff in the receiving branch (or owner) Accept or Reject. Reject has zero inventory impact. Accept keeps supplier stock unchanged. Upon physical delivery, staff enters **Delivered By**, clicks Save Received Stock, and only then the quantity is credited to that branch.

**Transfer:** originating branch is disabled/read-only, destination is a dropdown of other active branches in the same franchise. The transfer request stores the requesting authenticated user, origin, destination, expected deliverer, ingredient items, quantities, and notes. The receiving branch Accepts or Rejects. On Accept, source isolated ingredient stock is atomically deducted with sufficient-stock check. The receiving branch later enters actual deliverer and saves receipt; only then destination branch stock is credited. A second Accept/Receive fails because status is locked transactionally. Rejected requests do not change stock. An accepted-but-not-delivered transfer remains in transit. Do not interpret this as a completed delivery.

All mutations query or update `branch_ingredients`, `branch_supply_requests`, `branch_supply_request_items`, `branch_inventory_movements`; ownership is checked via `chat_memberships` and `chat_workspace_branches` on every stage. No endpoint takes a workspace ID from the client.

**Test stock:** `marlou09` 3 branches × 52 existing ingredients = 156 isolated branch ingredient records at initial 5 each; one-time marker ensures balances are not reset on deployment. Other newly created franchise workspaces use zero opening stock and inherit sanitized original catalog recipes, names, images and costing.

**Remaining Phase 2 caveat:** POS checkout/product availability and some Admin catalog editors still use historical global tables. The Inventory screen is now branch-scoped, but checkout deductions must be cut over separately. Do not advertise end-to-end inventory isolation until checkout/catalog edit paths are migrated and verified.

Use `node scripts/branch-incoming-supply-test.js` for transactional simulation, then test two real branch logins with nonproduction ingredients and verify the isolated ledger. Historical transactions were not deleted and no separate data wipe was requested.
