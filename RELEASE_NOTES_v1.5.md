# Coffee POS Web v1.5.0

## System Logs
- Added category filters for Sales, Reports, Inventory, Catalog & Setup, Users & Access, Database & Backup, and Other.
- Added log search, result counts, and a fixed-height scrollable log panel.
- Live refresh preserves the active filter, search text, and scroll position.

## What's New
- Added a What's New notification in the top bar for all users.
- The unread badge is version-aware and is acknowledged per browser using localStorage.
- Added an Upcoming section for future release notices.

## Inventory
- Replenish now requires Delivered By and Remarks.
- Transfer now requires Received By and Remarks.
- Added instruction placeholders for delivery and transfer details.
- Replenish and Transfer now support multiple ingredients in one atomic batch.
- Fixed ingredient dropdowns resetting to the first item during 5-second live refresh.
- In-progress quantities, metadata, and batch entries remain intact during live refresh.
