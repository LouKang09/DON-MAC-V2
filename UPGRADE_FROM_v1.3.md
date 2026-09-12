# Upgrade from Coffee POS Web v1.3 to v1.4

v1.4 has no schema-breaking database change. Keep your existing live database.

1. Close Coffee POS v1.3 completely.
2. Make a backup copy of `data\pos.db`.
3. Extract `Coffee-POS-Web-v1.4.0-STABLE.zip` into a new folder.
4. Copy the old `data\pos.db` into the new v1.4 folder as `data\pos.db`.
5. Do not copy `data\runtime.json`.
6. Double-click `START COFFEE POS.bat` in the v1.4 folder.
7. Confirm the version shown by the app/server is `1.4.0-stable`.
8. If the browser still shows cached v1.3 assets, press `Ctrl+F5` once.

Your existing sales, users, inventory, recipes, promos, packages, reports and logs remain in the preserved database.
