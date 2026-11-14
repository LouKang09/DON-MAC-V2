# Don Mac POS isolation — deployment record (2026-11-14)

## Data preservation and verified recovery

A full PostgreSQL 18 custom-format dump was produced from Railway production:
- Private bucket: `DonMacBackups` (separate from Postgres volume, same provider)
- First verified archive: `verified-postgres/20261114T064342Z.dump`
- Compressed archive size: **4,351,861 bytes**
- SHA-256 digest prefix: `9326bba1fa9bdf4d`
- Full `pg_restore` succeeded into a **disposable separate PostgreSQL instance** in the backup job container.
- The restored snapshot passed integrity checks for 15 required tables, including **57 historical sales** and **156 isolated branch ingredient records**.
- The dump was uploaded and downloaded back from the private S3 bucket, with matching SHA-256 checksum.
- Production tables, rows, stock and historical sales were not modified by the backup job.
- Dedicated Railway service `DonMac-Backup-Verify` schedules daily at **02:00 Asia/Manila** (`0 18 * * *` UTC). **This schedule does not prove future backups will succeed; monitor its job status and logs.**
- Temporary public diagnostic service was deleted after confirming a verified archive.

## Implemented isolation protections

- `lib/branch-support.js`: branch selection requires authenticated user membership in exactly one workspace and a branch belonging to that workspace. A cashier's client-supplied branch is ignored in favor of their assigned branch.
- `lib/legacy-catalog-guard.js`: until live read/write migration is ready, future franchise accounts cannot read the shared catalog, stock, reports, sales or backups. Current master `marlou09` workspace continues with the legacy application.
- `lib/branch-isolation-audit.js`: authenticated Admin/Co-Owner can read isolated branch catalog reconciliation and costing preview.
- `lib/branch-catalog-read.js`: isolated catalog and inventory read adapter, accessed through authenticated `GET /api/isolation/catalog?branchId=...` and `GET /api/isolation/inventory?branchId=...`. All queries are workspace + branch scoped.
- Branch initialization unchanged: existing `marlou09` branches have 5 units per ingredient; future account templates use zero stock and independently copied recipe costing.
- Isolation tests and GitHub Actions workflow added.

## Still **NOT** cut over

- The existing `/api/catalog`, `/api/quote`, `/api/sales`, `/api/inventory`, Admin catalog editing, replenish/transfer, exports and costing reports still have legacy global-table paths for `marlou09`.
- The new read API is preparation/verification only. **Do not assume full live tenant isolation yet.**
- Before turning it on for all franchisees, implement corresponding branch-scoped transactional writes and stock locks; migrate sale item FK associations and cost snapshots; update reporting/admin CRUD and UI branch selectors; verify historical reconciliation and rollback.
- Don't delete legacy tables or switch checkout until the full end-to-end transaction test suite succeeds.
- An off-provider encrypted backup is recommended in addition to the independent Railway bucket.

For checks, use Admin `GET /api/admin/isolation/preflight`, `GET /api/admin/isolation/catalog-audit`, and `GET /api/admin/isolation/catalog-preview?branchId=...`.
