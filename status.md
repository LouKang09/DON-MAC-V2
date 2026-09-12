# Migration Status — Coffee POS 0.4

## Status: all software phases implemented

| Excel/VBA area | Final web implementation |
|---|---|
| CoffeeList / CoffeeListNC / FoodList | Product catalog + admin CRUD |
| Ingredients | Live inventory + ingredient admin |
| ProductListWithIngredients | Recipe editor + stock validation |
| CostingListWithIngredients | Cost contributions + detailed costing report/PDF |
| IngredientMeasurement | UOM retained in inventory/logs |
| Orders | Per-session server-validated cart payload |
| PromoList | Promo CRUD + inclusion limits + reporting |
| 143 Promo | Fixed promo pricing + upgrades + one-reference reporting |
| Senior Discount | 20% Gross adjustment + audit details + promo exclusion |
| PackageList | Package CRUD + composition engine/editor |
| Payment | Cash / GCash server validation |
| Sale Logs | Normalized sales/items/components + historical migration |
| System Logs | Historical + new web audit events |
| Supply/Replenish | Atomic stock increase + movement logs |
| TransferSupply | Atomic stock decrease + formatted transfer logs |
| Users | Secure web users/roles/password reset |
| Dashboard | KPI/trend/category/top-product/low-stock views |
| Reports | Daily/Weekly/Monthly/Yearly + costing + PDFs |
| Gmail report | TLS SMTP with server-only secrets |
| Deleted sales | Admin audit delete + explicit stock reversal |
| Backup/Restore | Automatic/manual SQLite backup + pre-restore protection |
| Deployment | SQLite local, PostgreSQL production, Docker |

## Source-data exception, not an unfinished software phase

The workbook's `PackageList` supplies package names and prices but does not supply the component products/quantities. The package engine and UI are complete; the migrated package rows remain unavailable until the real composition is entered by an Admin. No composition is fabricated because it would change inventory/costing incorrectly.

## External configuration still required by the owner

- New secure web passwords for legacy Excel users.
- SMTP account/app password if report email delivery will be used.
- Real package contents for the three PackageList rows.
- Hosting domain/TLS/database credentials for public production deployment.

## Verified workbook parity

- 28 current sellable products.
- 52 ingredient records without merging duplicate display names.
- 132 recipe mappings.
- 4 promos.
- 3 package rows.
- 29 historical references / 86 sale lines.
- 207 historical System Logs.
- 143 example = Gross 193 / Adjustment -33 / Actual 160.
- Senior test = Gross 225 / Adjustment -45 / Actual 180.
- 2026-08-19 Actual = 1,192.20, matching the workbook Dashboard.
