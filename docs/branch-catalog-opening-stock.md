# Branch catalog initialization rules — Phase 2 preparation

The live POS still reads the legacy catalog. This phase populates only the already isolated tables; no old transactions or catalog data is deleted.

- **Existing verified `marlou09` Owner workspace**: Each branch receives a separate copy of **all** existing ingredients, with opening stock of **5 per ingredient in its own UOM** (e.g., 5 kg for a kg ingredient). Products, category assignments, recipes, recipe quantities, per-product recipe cost contributions, add-ons, promos, packages and prices are copied independently for every branch.
- **Future franchise Owner accounts**: A sanitized, versioned original catalog template is used for onboarding. Ingredients start with **0 stock**. Recipe quantities and cost contributions are copied, then editable independently.
- **Original users, branches, sales, payments, existing stock and historical reports** remain untouched. No live catalog switch yet.
- Unit cost in new ingredient rows starts at zero because the legacy ingredient table has no per-unit purchase-cost field. Exact costing is inherited from `product_ingredients.cost_contribution`.
- A first-time opening stock ledger movement records the five-unit seed for the existing Marlou branches.
- `branch_catalog_provisioning` records initialization, preventing restarts from resetting changed stock back to 5.
- Startup preparation only happens if the original Owner's verified account name resolves uniquely to `marlou09`. A shared source catalog will not be copied if any sales belong outside that Owner's workspace; it fails closed for manual review.
- New franchise application staging now consumes the saved versioned template instead of the unscoped shared catalog. The application staging remains view-only and does not grant login access.

Tests: `node scripts/branch-catalog-seeding-test.js`.

Before enabling checkout and replacing legacy table reads, verify a recoverable PostgreSQL backup and test restoration. Check Railway startup logs for `[Branch Catalog Phase 2 Preparation]`.
