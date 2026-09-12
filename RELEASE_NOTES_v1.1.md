# Coffee POS Web v1.1.0-stable

This build is the reliability repair release for Coffee POS 0.4 web migration.

## Critical fixes

- Fixed Windows localhost/port collision that could show `ERR_EMPTY_RESPONSE` even while Node printed that it was running.
- Local mode binds to `127.0.0.1` rather than wildcard `0.0.0.0`.
- One-click `START COFFEE POS.bat` finds a free port starting at 3100, waits for a healthy server, then opens the correct browser URL.
- Direct `node server.js` can move to the next port automatically unless `STRICT_PORT=true`.
- Added database-backed `/api/health` response and runtime diagnostics.
- Added safe checkout idempotency so retries/double-clicks do not create duplicate sales or duplicate ingredient deductions.
- Payment confirmation is disabled while a checkout is processing.
- Frontend requests now time out cleanly and show meaningful server/session errors instead of silently failing.
- Promo upgrade quantities are validated immediately in the UI as well as on the backend.
- `.env` files are now loaded directly by the server without requiring another package.
- PostgreSQL start script is Windows-compatible.
- Docker keeps explicit `0.0.0.0:3000` binding and now has a health check.

## Validation

- Every JavaScript file passes `node --check`.
- `package.json` and the migration seed parse successfully.
- The full fresh-database smoke suite passes after the repair.
- The smoke test covers setup/login, catalog, 143 Promo math, Senior Discount math, stock availability/deduction/reversal, CRUD, recipe protection, packages, users, promos, reports, PDFs, dashboard, backup/restore, and checkout retry idempotency.
- The launcher was separately verified to reach `/api/health` successfully on its selected local port.

For normal Windows use, run `START COFFEE POS.bat`.
