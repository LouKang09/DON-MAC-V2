# Coffee POS Web API

All operational endpoints except setup/login/status/health require an authenticated session. Admin maintenance endpoints require the Admin role.

## Authentication
- `GET /api/status`
- `GET /api/health`
- `POST /api/setup`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

## POS
- `GET /api/catalog`
- `POST /api/quote`
- `POST /api/sales`
- `GET /api/sales/:reference` — authenticated, read-only transaction audit detail including sale items, package components, inventory movements and related System Log events
- `POST /api/sales/:reference/delete` — Admin maintenance/backward compatibility; explicit `restoreStock` decision; not exposed by the normal Reports Audit Trail UI

## Inventory
- `GET /api/inventory`
- `GET /api/inventory/movements`
- `POST /api/inventory/replenish`
- `POST /api/inventory/transfer`

## Dashboard and reports
- `GET /api/dashboard`
- `GET /api/reports/sales?period=daily|weekly|monthly|yearly&date=YYYY-MM-DD&cashier=...`
- `GET /api/reports/costing?period=daily|weekly|monthly|yearly&date=YYYY-MM-DD&cashier=...`
- `GET /api/reports/sales.pdf?...`
- `GET /api/reports/costing.pdf?...`
- `POST /api/reports/email`
- `GET /api/system-logs`

## Users — Admin
- `GET /api/users`
- `POST /api/users`
- `PUT /api/users/:id`

## Catalog administration — Admin
Products:
- `GET /api/admin/products`
- `POST /api/admin/products`
- `PUT /api/admin/products/:id`
- `DELETE /api/admin/products/:id`
- `GET /api/admin/products/:id/recipe`
- `PUT /api/admin/products/:id/recipe`

Ingredients:
- `GET /api/admin/ingredients`
- `POST /api/admin/ingredients`
- `PUT /api/admin/ingredients/:id`
- `DELETE /api/admin/ingredients/:id`

Promos:
- `GET /api/admin/promos`
- `POST /api/admin/promos`
- `PUT /api/admin/promos/:id`
- `DELETE /api/admin/promos/:id`

Packages:
- `GET /api/admin/packages`
- `POST /api/admin/packages`
- `PUT /api/admin/packages/:id`
- `DELETE /api/admin/packages/:id`
- `PUT /api/admin/packages/:id/items`

Settings/backups:
- `GET /api/admin/settings`
- `PUT /api/admin/settings`
- `GET /api/backups`
- `POST /api/backups`
- `GET /api/backups/:filename`
- `POST /api/backups/:filename/restore`

## Transaction safety

PostgreSQL ingredient rows are locked in stable ID order with `FOR UPDATE` before checkout/stock writes. Local SQLite uses `BEGIN IMMEDIATE`. Current stock is re-read inside the write transaction before commit, preventing stale browser state from overselling ingredients.
