# Coffee POS Web v1.4.0-stable — Release Notes

## Product availability explanations

- Not Available products now expose a hover/focus information tooltip.
- The tooltip lists exact ingredient issues including required quantity, current stock, shortage and UOM.
- Zero stock is shown as OUT OF STOCK; partial but insufficient stock is shown as LOW/INSUFFICIENT.
- Configured low-stock thresholds can show a LOW STOCK warning while the product is still sellable.
- Package availability explains missing composition, component recipe requirements and ingredient shortages.

## Recipe-required safety

- A newly created active product is Not Available until at least one valid recipe ingredient is saved.
- The Catalog Admin product table marks zero-recipe products as RECIPE REQUIRED · NOT SELLABLE.
- Server-side quote/checkout validation blocks products with no recipe, so the rule cannot be bypassed by calling the API directly.
- Packages containing a component product with no recipe remain unavailable.

## Compatibility

There is no schema-breaking database change in v1.4. Existing v1.3 SQLite databases can be copied into v1.4 and will be reused on startup.
