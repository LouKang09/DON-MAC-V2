# Upgrade from Coffee POS Web v1.1 to v1.2

If you already have real sales in v1.1, **do not delete your existing `data/pos.db`**.

## Safest Windows upgrade

1. Close Coffee POS and stop the old black Node/launcher window.
2. Open the old v1.1 folder.
3. Make a separate copy of:

```text
data\pos.db
```

Keep that copy somewhere outside the POS folder as an emergency backup.

4. Extract the v1.2 ZIP into a **new folder**.
5. Copy your old v1.1:

```text
data\pos.db
```

into the new v1.2 folder's:

```text
data\pos.db
```

6. Do **not** copy `data\runtime.json` from the old installation.
7. Double-click **START COFFEE POS.bat** in the v1.2 folder.
8. Sign in with your existing Web Admin username/password.
9. Double-click **CHECK COFFEE POS.bat** once to validate the installed code.

The v1.2 server applies its schema migration automatically. Upgrade testing confirmed that a v1.1-created database kept its existing Admin account and setup state.

## If v1.1 has no real data you need

You can simply extract v1.2 and start it. A new `data/pos.db` will be created and seeded from the sanitized Coffee POS 0.4 migration data.

## Never copy these runtime files between versions

```text
data\runtime.json
data\pos.db-wal
data\pos.db-shm
```

Only copy the main `data\pos.db` while the old POS is fully stopped.
