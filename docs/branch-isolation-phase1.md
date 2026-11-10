# Branch Isolation — Phase 1 (Schema Only)

Status: additive migration only. No catalog, stock, sales, cashier, expense or financial record has been copied, deleted, reassigned or moved.

## New tables
1. branch_categories
2. branch_products
3. branch_ingredients
4. branch_recipes
5. branch_category_products
6. branch_addons
7. branch_promos
8. branch_packages
9. branch_package_items
10. branch_inventory_movements
11. starter_catalog_templates

All operational rows require `workspace_id` and `branch_id` with a composite foreign key into `chat_workspace_branches`. Child references for recipes, categories, packages and inventory movements enforce the same scope. Names/SKUs/codes are unique only within their branch and franchise. The sole schema adjustment to existing structures is a unique index on `chat_workspace_branches(branch_id,workspace_id)`, which already has `branch_id` as its primary key; it modifies no data.

## Execution and checks
- Imported by `server.js` after existing branch and chat migrations, on normal boot and SQLite restore.
- Multiple service startup serialized with a PostgreSQL advisory transaction lock.
- Idempotent `CREATE ... IF NOT EXISTS` statements; errors roll back the new table transaction.
- Run local test: `node scripts/branch-isolated-schema-test.js`.
- Startup log: `[Branch Isolation Phase 1]` with `ready:true` and `tablesCreated:11`.
- Authenticated Admin: `GET /api/admin/isolation/preflight` includes `isolatedSchema.ready` and `livePosCutover:false`.

## Deliberately NOT done
- No template populated and no `marlou09` account migration yet.
- No checkout, costing, reporting or inventory route switched.
- No legacy products or ingredients deleted.
- No direct PostgreSQL backup created.

Before Phase 2, independently back up and test-restore PostgreSQL, verify the source owner/branch, map old IDs, test scoped endpoints and plan rollback. No destructive cleanup before reconciliation.
