# Coffee POS Web v1.2.0-stable — Release Notes

## User-reported fixes

### Order now clears after every successful transaction

The prior UI reset cleared JavaScript state but did not reliably repaint the order panel after checkout. v1.2 resets and re-renders the next-customer state immediately after the server confirms the sale.

It also clears tender, GCash reference, promo, Senior fields, search and stale checkout retry state.

### Catalog Admin Promo/Package overflow fixed

Admin form cards and their controls now use constrained grid sizing, `min-width: 0`, `max-width: 100%` and consistent border-box sizing. The same hardening was applied across Product, Ingredient, Recipe and Settings panels rather than only the two visibly broken forms.

## Additional repairs found during audit

- Prevented stale cashier carts surviving sign-out.
- Prevented old Cash/GCash field values carrying into the next transaction.
- Prevented older asynchronous quote responses overwriting a newer cart.
- Added sequencing protection to recipe loading.
- Reconciles unsaved cart items against catalog changes.
- Prevents a product from being archived while an active package still uses it.
- Prevents inactive ingredients/products from being inserted into recipes/package compositions.
- Added duplicate-click locks to destructive/admin actions.
- Hardened checkout idempotency and concurrent retry handling.
- SQLite database access serialized around the single connection.
- PostgreSQL inventory paths use row/advisory locking where required.
- Sale stock reversal now uses the original recorded inventory movement rather than the current recipe.
- Historical imported transactions do not create fictitious stock restoration.
- Strengthened numeric, date, role, email, text-length and movement validation.
- Protected current signed-in user and final active Admin.
- Prevented create-user from overwriting an existing web account.
- Hardened restore with pre-restore backup/recovery behavior.
- Hardened static path handling and response/client error behavior.
- Improved local login-rate-limit scoping.
- Safe launcher verifies that an existing service is actually Coffee POS before reusing its URL.
- Windows self-check now reports a clear pass/fail status.

## Compatibility

- Node.js 22.5+
- Existing v1.1 SQLite database upgrades automatically.
- Fresh local installs use SQLite with no package installation required.
- PostgreSQL/Docker files remain included for production deployment.
