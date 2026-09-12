# Upgrade from Coffee POS Web v1.2 to v1.3

There is no database schema-breaking change in v1.3. Your existing v1.2 SQLite database can be reused.

1. Close the old Coffee POS and all old Node/launcher windows.
2. In the v1.2 folder, make a safety copy of `data\pos.db`.
3. Extract **Coffee-POS-Web-v1.3.0-STABLE.zip** into a new folder.
4. Copy your old `data\pos.db` into the new v1.3 folder's `data\pos.db`.
5. Do **not** copy `data\runtime.json`.
6. Double-click **START COFFEE POS.bat** in the v1.3 folder.
7. Open Reports and confirm Audit Trail rows show **View**. If an old browser tab still shows Delete, press **Ctrl+F5** once.
8. Optional but recommended: run **CHECK COFFEE POS.bat** before live use.

Your sales, inventory, users, system logs, catalog, recipes and settings remain in the same database.
