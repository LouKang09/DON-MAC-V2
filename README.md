# Coffee POS 0.4 — Stable Web Migration v1.4

This is the hardened web migration of **Coffee POS 0.4.xlsm**. Version 1.4 adds ingredient-aware availability guidance and enforces recipe setup before a newly added product can be sold, while retaining the v1.3 Transaction Audit viewer and all prior checkout, layout, stock/account safety, upgrade and Windows startup fixes.

## Recommended Windows startup

1. Extract the ZIP completely.
2. Double-click **START COFFEE POS.bat**.
3. Keep the black launcher window open while the POS is in use.
4. The launcher looks for an existing Coffee POS instance first. If none is running, it selects a free local port beginning at **3100**, waits until `/api/health` confirms the app and database are ready, and then opens the exact `127.0.0.1` address.
5. On a fresh database, create the Web Admin account.
6. Press **Ctrl+C** in the launcher window when you want to stop the POS.

To validate the installation, double-click **CHECK COFFEE POS.bat**. A successful run ends with:

```text
FINAL SMOKE TEST PASSED
ALL AUTOMATED CHECKS PASSED
```

## v1.4 Product availability improvement

The POS now explains **why** an item is Not Available. Hover over, or keyboard-focus, the information marker on an unavailable product/package to see the exact issue. The tooltip can show:

- recipe/ingredients not configured yet
- ingredient out of stock
- ingredient stock below the quantity required for one sale
- exact required quantity, current quantity and shortage with UOM
- archived/unavailable ingredient or package component
- low-stock warnings when an ingredient is at or below its configured low-stock threshold

A newly added product is now deliberately **Not Available** until at least one valid recipe ingredient is saved in **Catalog Admin → Recipes & Costing**. This rule is enforced by both the browser and server, so a direct API request cannot bypass it. Products with zero recipe rows are also labeled **RECIPE REQUIRED · NOT SELLABLE** in Catalog Admin.

Packages inherit the same safety rule: a package cannot become sellable if one of its component products has no recipe/ingredients configured.

## v1.3 Transaction Audit improvement

The Reports → Audit Trail no longer presents **Delete** as the normal transaction action. Every listed transaction now has **View**.

The Transaction Audit viewer includes:

- transaction reference and Sold/Deleted status
- cashier snapshot
- exact Manila date/time including seconds when the stored timestamp provides them
- Cash/GCash mode and GCash reference
- cash tender and change
- every product/add-on/package line, quantity, unit price and line total
- package component products
- promo name
- Senior Citizen audit details and discount amount
- remark
- Gross / Adjustment / Actual
- deletion date and deleting user for previously deleted records
- per-transaction inventory movements, including original SALE deductions and any SALE_REVERSAL
- matching System Log audit events

The View action is available to signed-in report users; it does not mutate the sale or stock. Destructive deletion is no longer exposed as the Audit Trail's primary action.

## v1.2 fixes that affect daily use

### Transaction reset after every successful checkout

A completed sale now immediately resets the visible POS for the next customer. The reset includes:

- cart lines and quantities
- selected promo and promo upgrades
- Senior Citizen toggle, name and ID
- search text and category state
- Gross / Adjustment / Actual display
- Cash tender and GCash reference
- payment mode back to Cash
- pending checkout retry ID

The reset occurs before the receipt dialog is shown, so a successful transaction cannot leave the previous customer's order visible. Signing out also clears the current cashier's unsaved order.

### Catalog Admin layout containment

Promo, Package, Product, Ingredient, Recipe and Settings forms were hardened so controls stay inside their cards instead of extending past the container. The responsive layout was tested at **1366, 1100, 900, 760, 500, 390 and 320 px** widths.

### Safer live catalog changes

If an Admin archives or disables something that is still in a cashier's unsaved cart, the cart is reconciled against the current catalog on refresh instead of retaining invalid items. Active packages are protected from having a component product archived behind their back; remove the product from the package composition or disable the package first.

### Checkout and stock safety

- Checkout is locked while a payment is being processed.
- Every checkout carries a unique client request ID. A double-click, retry, or lost browser response returns the existing committed sale rather than creating a duplicate transaction or deducting inventory twice.
- Fast quote requests are sequenced so an older response cannot overwrite a newer cart state.
- PostgreSQL checkout/replenish/transfer paths use stock locks; SQLite operations are serialized around the single database connection.
- Deleting a web sale with **Restore Stock** restores the exact ingredient quantities originally deducted by that sale, even if its recipe was edited later.
- Imported historical sales that have no original web inventory movement do not fabricate a stock restoration.

---

## Completed system

### 1. POS and payments

- Coffee, Non Coffee, Food, Package and Promo selling flows.
- Server-validated prices and cart rules.
- Cash and GCash payments with transaction/payment references.
- Ingredient availability, reserved-quantity checking and atomic deduction at checkout.
- Gross / Adjustment / Actual calculations.
- Senior Citizen discount: **20% of Gross**, audited Senior Name/ID, blocked while a promo is active to match the VBA behavior.
- Existing promo rules including **143 Promo** and one-reference-per-promo reporting.
- Promo-only upgrades: **FLAVORED FRIES = PHP 7** and **PREMIUM COFFEE = PHP 10**; excluded from costing and charged on top of the promo amount.

### 2. Inventory, supply and transfers

- Live ingredient stock and Not Available product behavior, including hover/focus explanations for missing/low ingredients and recipe-required products.
- Replenishment with UOM-aware logs.
- Branch transfer with stock validation, uppercase UOM, Transfer To and Received By logging.
- Inventory movement history.
- Duplicate workbook display names such as FRUCTOSE and CONDENSED MILK remain separate internal ingredient IDs.

### 3. Catalog administration

- Add/update/archive products.
- Product names stay immutable while editing; rename is handled as archive + add, matching the Excel maintenance rule.
- Add/update/archive ingredients with recipe-use protection.
- Recipe editor for required quantity and cost contribution.
- Promo add/update/archive.
- Package add/update/archive and package composition editor.
- Package checkout aggregates component recipes for availability, inventory deduction and costing.

**Source-data limitation:** the workbook `PackageList` contains package names and prices but not package composition. The package engine is implemented, but migrated packages remain unavailable until their real contents are entered in **Catalog Admin → Packages**. The web app deliberately does not invent ingredients/products for them.

### 4. Reports, dashboard, costing and audit

- Daily / Weekly / Monthly / Yearly sales reports.
- Product report: Qty, Gross, Adjustment, Actual, Costing and Net.
- Promo report: Qty, Gross, Adjustment and Actual; one transaction reference counts as one promo purchase.
- Ingredient-grouped costing report with product-level details.
- Transaction logs retain Sold and Deleted references for audit.
- Each Audit Trail row has a read-only **View** action with complete transaction, item, payment, promo/discount, inventory-impact and system-event details.
- Previously deleted records clearly show deletion date/time and deleting user when available.
- Dashboard KPIs, 30-day trend, top products, category sales and low-stock view.
- Migrated workbook history: 29 transaction references / 86 sale lines / 207 System Logs.

### 5. PDF and email

- Server-generated Sales Report PDF.
- Server-generated Costing Report PDF.
- Report email endpoint with PDF attachment.
- Daily email default subject: **Daily Report Notification**.
- Daily email default body: **Hello, attached are the daily reports.**
- SMTP credentials remain server-side only.

### 6. Users and security

- First-run Web Admin setup.
- scrypt password hashing and server-side sessions.
- Excel usernames/roles can be retained while old Excel passwords are not migrated.
- Admin/User role controls.
- Login rate limiting and security response headers.
- Existing web accounts cannot be silently overwritten by the create-user flow.
- Current signed-in account and last active Admin are protected against accidental deactivation/demotion.

### 7. Backup, restore and deployment

- SQLite automatic daily backups; latest 30 automatic backups retained.
- Manual backup/download.
- Restore creates a pre-restore backup and has recovery handling if the replacement fails.
- PostgreSQL schema/adapter and Docker configuration included.
- `/api/health` performs a database probe and identifies the service as `coffee-pos-web`.

## Verified workbook parity

The automated regression suite verifies:

- 28 current sellable products, 52 ingredient records, 132 recipe mappings and 4 promos seed correctly.
- **143 Promo:** 2 DON DARKO + 2 CLASSIC WAFFLE + 1 FLAVORED FRIES + 1 PREMIUM COFFEE → Gross PHP 193.00 / Adjustment -PHP 33.00 / Actual PHP 160.00.
- A PHP 225.00 normal sale with Senior Discount → Adjustment -PHP 45.00 / Actual PHP 180.00.
- Historical **2026-08-19 Actual Sales = PHP 1,192.20**.
- Promo upgrades cannot be sold standalone.
- Duplicate checkout retry does not duplicate sale or inventory deduction.
- Exact original ingredient deduction is restored when a web sale is deleted with stock restoration.

## Upgrading from v1.1 without losing sales

Read **UPGRADE_FROM_v1.1.md** before replacing your existing folder. Your live SQLite database is `data/pos.db`; preserve that file. Version 1.2 migrates the existing database automatically on startup and was tested with a v1.1-created database and Web Admin account.

## Manual startup (advanced)

Requires **Node.js 22.5 or newer**. Normal Windows users should use `START COFFEE POS.bat`.

```bash
node server.js
```

The local server binds to `127.0.0.1`. If its default port is already occupied and `PORT` was not explicitly forced, it tries the next local port and prints the actual URL.

Run the automated backend/database suite with:

```bash
npm run smoke
```

## PostgreSQL production mode

Install dependencies:

```bash
npm install
```

Configure the environment, then start:

```text
DB_ENGINE=postgres
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE
COOKIE_SECURE=true
```

```bash
npm run start:postgres
```

The server applies `database/postgres-schema.sql` and seeds an empty database automatically.

## Docker

Create a private `.env` file with at least:

```text
POSTGRES_PASSWORD=use-a-strong-random-password
DATABASE_URL=postgresql://coffee_pos:use-a-strong-random-password@db:5432/coffee_pos
```

Then run:

```bash
docker compose up -d --build
```

For public deployment, put the application behind trusted HTTPS termination and set `COOKIE_SECURE=true`.

## Email configuration

For Gmail, use a Google App Password rather than the normal Gmail password:

```text
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=your-account@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=your-account@gmail.com
REPORT_EMAIL_TO=recipient@example.com
```

Real email delivery requires the owner's SMTP credentials and therefore is not exercised by the bundled offline regression test.

## Local data and backups

- Live SQLite database: `data/pos.db`
- Automatic/manual backups: `backups/`
- Do not delete `data/pos.db` unless you intentionally want a fresh POS database.

PostgreSQL deployments should additionally use provider snapshots or `pg_dump`; the built-in SQLite backup UI is not a substitute for a managed PostgreSQL backup policy.

## Folder guide

- `server.js` — API server and business rules
- `db.js` — SQLite/PostgreSQL adapter
- `public/` — responsive browser UI
- `lib/pdf.js` — PDF generation
- `lib/smtp.js` — SMTP/TLS email attachment delivery
- `data/seed-data.json` — sanitized Coffee POS 0.4 migration seed
- `database/` — SQLite and PostgreSQL schemas
- `scripts/start-pos.js` — safe Windows/local launcher
- `scripts/smoke-test.js` — end-to-end API/database regression suite
- `scripts/availability-test.js` — availability tooltip/recipe-gating frontend regression
- `MULTI_BRANCH_GUIDE.md` — recommended architecture for 5+ branches
- `backups/` — SQLite backups at runtime

## Security/data hygiene

The package contains **no Excel user passwords, Gmail/App Password, live runtime database, test backup, `.env`, or `node_modules`**. Create new web credentials and keep SMTP/database secrets in environment variables only.
