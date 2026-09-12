# Coffee POS Web v1.4 Troubleshooting

## Recommended startup

Use **START COFFEE POS.bat**. It checks for an already-running Coffee POS, selects a free loopback port if needed, waits for the database health check and opens the exact working address.

Keep its black window open while using the POS.

## Browser says ERR_EMPTY_RESPONSE / cannot connect

1. Close old Coffee POS / Node windows.
2. Double-click **START COFFEE POS.bat**.
3. Use only the browser address opened by the launcher, normally `http://127.0.0.1:3100` or the next free port.
4. Do not assume port 3000 belongs to the POS.

## Order did not clear after payment

v1.2 resets the order immediately after a successful sale. Confirm the header/settings show **1.4.0-stable** and that you are not still launching an older extracted v1.0/v1.1 folder.

If in doubt, close all old Node windows and start only the v1.4 folder with `START COFFEE POS.bat`.

## Promo/Package fields extend outside their card

This was repaired in v1.2. If the old layout remains, force-refresh the browser with **Ctrl+F5** so cached CSS/JavaScript is replaced.


## Audit Trail still shows Delete instead of View

You are running an older frontend. Close the old POS, start the v1.4 folder, then press **Ctrl+F5** in the browser. Version 1.3 shows **View** on every Audit Trail transaction and opens the read-only Transaction Audit dialog.


## New product shows Not Available / Recipe Required

That is intentional in v1.4. A new product cannot be sold until at least one valid ingredient is saved in **Catalog Admin → Recipes & Costing**. After the recipe is saved, the product becomes available only when all required ingredients have enough stock. Hover/focus the information marker on the product card to see the exact reason.

## Not Available card does not show ingredient details

Confirm you are running **1.4.0-stable**, then press **Ctrl+F5** once to clear cached frontend files. On desktop, hover the product card/information marker. On keyboard/touch devices, focus or tap the information area.

## Run the full self-test

Double-click **CHECK COFFEE POS.bat** or run:

```text
npm run smoke
```

The backend/database validation must end with:

```text
FINAL SMOKE TEST PASSED
```

The `.bat` wrapper then prints:

```text
ALL AUTOMATED CHECKS PASSED
```

## Node.js not found

Install Node.js **22.5 or newer**, close/reopen Windows Terminal, then run the starter again.

## Where data is stored

Local SQLite data is stored in:

```text
data\pos.db
```

Backups are stored in:

```text
backups\
```

Do not delete `data\pos.db` unless you intentionally want a fresh database.

## Moving from v1.1

Read `UPGRADE_FROM_v1.1.md`. Stop the old POS first and preserve/copy only the main `data\pos.db` into the new v1.2 folder.

## Email is not sending

The POS itself can run without email. Email requires server-side SMTP configuration. For Gmail, use a Google App Password rather than your normal Gmail password.
