# Final Validation Results — v1.4.0-stable

Source: Coffee POS 0.4.xlsm sanitized migration seed

## JavaScript syntax validation — PASS

Validated with `node --check` for the server, browser application and regression scripts.

## Complete API/database smoke regression — PASS

Command:

```bash
npm run smoke
```

Result:

```text
FINAL SMOKE TEST PASSED
```

The full prior regression suite remains active: first-run authentication, catalog seed, exact 143 Promo and Senior Discount parity, reports/PDFs, package composition, inventory, concurrent checkout/idempotency, exact stock reversal, users, backup/restore, dashboard, transaction audit and health checks.

New v1.4 assertions verify:

- a newly created product with zero recipe rows returns `available=false`
- that product returns `recipeConfigured=false` and `availabilityStatus=recipe_required`
- direct server quote attempts for the no-recipe product are rejected with HTTP 409
- after a recipe is saved but ingredient stock is zero, the product remains unavailable and exposes the exact out-of-stock ingredient detail
- after replenishment, the product becomes available
- configured low-stock thresholds are exposed as product stock warnings

Workbook parity still verifies:

- 143 Promo: Gross 193 / Adjustment -33 / Actual 160
- Senior 20% test: Gross 225 / Adjustment -45 / Actual 180
- Historical 2026-08-19 Actual = 1,192.20 with 7 Sold transactions

## Transaction Audit regression — PASS

```text
TRANSACTION AUDIT VIEW TEST PASSED
```

The v1.3 read-only View Transaction workflow remains intact.

## Product availability frontend regression — PASS

Command:

```bash
npm run test:availability
```

Result:

```text
PRODUCT AVAILABILITY UI TEST PASSED
```

Validated that the packaged browser source contains the ingredient availability tooltip, recipe-required messaging, low/insufficient stock detail renderer and required tooltip styles.

## Security/data hygiene

The release contains no live `pos.db`, `.env`, Excel passwords, Gmail/App Password, runtime file, WAL/SHM files, `node_modules`, or runtime backups.

## Multi-branch status

v1.4 remains single-branch. See `MULTI_BRANCH_GUIDE.md` before deploying to multiple branches. A shared database must first be made branch-aware; five branches must not share the current single global ingredient stock balance.
