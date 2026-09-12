# Recommended Multi-Branch Architecture

## Current release

Coffee POS Web v1.4 is still a **single-branch application**. Its current `Ingredients.stock_qty`, sales and inventory movements are not yet partitioned by branch. Do not point five live branches at the same v1.4 database without adding branch scoping first, because all five branches would share one stock balance.

## Recommended design for 5 branches

Use **one central PostgreSQL database**, not five independent databases, when the branches have reliable internet. Every operational record should carry a branch identity.

Recommended additions:

- `branches` — branch master data, code/name/address/status.
- `user_branches` — which branch(es) a user may access; Head Office users may access all.
- `branch_inventory` — one stock balance per `(branch_id, ingredient_id)` instead of a single global ingredient stock number.
- `sales.branch_id` — every transaction belongs to exactly one branch.
- `inventory_movements.branch_id` — replenishment, sale deduction and adjustment are branch-scoped.
- `transfers` + `transfer_items` — source branch, destination branch, sender, receiver, sent/received timestamps and status.
- branch-aware reports and dashboards, with both per-branch and consolidated Head Office views.
- branch-aware user roles such as Super Admin / Branch Admin / Cashier.
- optional branch-specific prices/promos while keeping one shared product/recipe master when desired.

## Why one central database is preferable

- one source of truth for products, recipes, users and promos
- real-time consolidated sales and inventory
- easier branch-to-branch transfer tracking
- no manual report merging
- no duplicate/conflicting product maintenance
- easier backups and security controls

## When separate branch databases make sense

Separate local databases are useful only when branches must continue selling during frequent internet outages. That becomes an **offline-first synchronization system**, which is materially more complex: globally unique references, conflict resolution, queued inventory movements, central reconciliation and sync health monitoring are required. Five unrelated databases with occasional manual merging are not recommended for a live POS.

## Practical deployment

For five internet-connected branches, deploy one HTTPS application/API and one managed PostgreSQL database in the cloud. Each branch opens the same POS URL, signs in, and is assigned to its branch. The server determines `branch_id` from the authenticated session rather than trusting a branch ID sent by the browser.

A Head Office dashboard can then show all branches together while ordinary cashiers see only their assigned branch.
