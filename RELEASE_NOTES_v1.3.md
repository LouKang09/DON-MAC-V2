# Coffee POS Web v1.3.0-stable — Release Notes

## Reports / Audit Trail

The Reports → Audit Trail action has been redesigned from a destructive **Delete** button into a read-only **View** button.

Selecting **View** opens a detailed Transaction Audit window containing the transaction reference/status, cashier, exact timestamp, payment details, tender/change, all ordered product lines, quantities/prices, package components, promo, Senior Citizen details, discount, remarks, Gross/Adjustment/Actual totals, deletion metadata for previously deleted records, inventory movements tied to the reference, and matching System Log events.

The normal Audit Trail UI no longer exposes transaction deletion.

## Compatibility

- No database schema change is required from v1.2.
- Existing `data/pos.db` files are compatible.
- Existing sales, users, recipes, inventory, promos, packages, logs and backups are preserved.
- All v1.2 checkout reset, responsive layout, retry protection and stock-safety fixes remain in place.

## Validation

- JavaScript syntax checks pass.
- The complete SQLite/API smoke suite passes.
- The smoke suite now verifies transaction detail retrieval for both Sold and Deleted transactions, item lines, inventory SALE/SALE_REVERSAL movements, deletion metadata and related audit events.
- A dedicated frontend source regression confirms that the Audit Trail exposes View, not Delete, and that the detailed audit dialog and required fields are present.
