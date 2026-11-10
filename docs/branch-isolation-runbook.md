# Tenant and branch data migration - safe runbook

Current stage: **read-only preflight only**. This is not a completed isolation migration.

- New owner-accessible endpoint: GET /api/admin/isolation/preflight
- Existing historical sales CSV: GET /api/historical-sales/export.csv?year=2025
- Historical online viewing policy: Pro 12 months; Business 24 months. Free CSV export remains available.

Before migration:
1. Create a complete PostgreSQL pg_dump to independently durable storage, verify checksums and restore into a disposable database. The in-app JSON archive is not a restorable database dump.
2. Confirm the actual workspace and ownership of username marlou09, including all branches and unmapped sales; do not rely on username guesses.
3. Snapshot the original recipes, products, ingredient details, costing and category assignments with a versioned, owner-scoped manifest.
4. Create branch-scoped tables keyed by workspace_id and branch_id, including product definitions, ingredient balances, recipes, costing, promos, packages, categories and audit movements.
5. Backfill with transactional old/new ID mapping and row reconciliation. Preserve old sales history; never copy stock balances to another franchise or unrelated branch.
6. Initialize each branch with independent editable catalog copies. Store sanitized Marlou template definitions; new accounts receive copies with zero opening stock, no users, payments, history or credentials.
7. Verify all reads/writes, checkouts, reports, backup exports and stock transfers are scoped to the authenticated workspace and selected branch. Cut over with rollback controls and only retire legacy rows after a verified snapshot.

Never run DELETE/TRUNCATE on global operational tables until all steps pass.
