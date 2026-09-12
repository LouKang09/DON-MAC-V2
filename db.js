const fs = require('fs');
const path = require('path');

function sqliteSql(sql) {
  return sql.replace(/\$\d+/g, '?');
}

async function createSqlite() {
  const { DatabaseSync, backup } = require('node:sqlite');
  const dbPath = path.resolve(process.env.SQLITE_PATH || path.join(__dirname, 'data', 'pos.db'));
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const native = new DatabaseSync(dbPath);
  native.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');

  // One DatabaseSync connection is shared by the local server. Serialize public DB
  // operations so a second HTTP request can never accidentally run inside another
  // request's open transaction.
  let queue = Promise.resolve();
  const serialize = task => {
    const run = queue.then(task, task);
    queue = run.then(() => undefined, () => undefined);
    return run;
  };
  const directQuery = (sql, params = []) => {
    const normalized = sqliteSql(sql).trim();
    const stmt = native.prepare(normalized);
    params = params.map(v => typeof v === 'boolean' ? (v ? 1 : 0) : (v === undefined ? null : v));
    const returnsRows = /^(SELECT|WITH|PRAGMA)\b/i.test(normalized) || /\bRETURNING\b/i.test(normalized);
    if (returnsRows) {
      const rows = stmt.all(...params);
      return { rows, rowCount: rows.length };
    }
    const result = stmt.run(...params);
    return { rows: [], rowCount: Number(result.changes || 0), lastInsertRowid: result.lastInsertRowid };
  };
  const directExec = sql => native.exec(sql);
  const tx = {
    engine: 'sqlite',
    filePath: dbPath,
    query: async (sql, params = []) => directQuery(sql, params),
    exec: async sql => directExec(sql)
  };

  const adapter = {
    engine: 'sqlite',
    filePath: dbPath,
    query(sql, params = []) { return serialize(() => directQuery(sql, params)); },
    exec(sql) { return serialize(() => directExec(sql)); },
    transaction(fn) {
      return serialize(async () => {
        directExec('BEGIN IMMEDIATE');
        try {
          const value = await fn(tx);
          directExec('COMMIT');
          return value;
        } catch (err) {
          try { directExec('ROLLBACK'); } catch (_) {}
          throw err;
        }
      });
    },
    backupTo(destination) {
      return serialize(async () => {
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        await backup(native, destination);
        return destination;
      });
    },
    checkpoint() { return serialize(() => { try { directExec('PRAGMA wal_checkpoint(FULL);'); } catch (_) {} }); },
    close() { return serialize(() => native.close()); }
  };
  return adapter;
}

async function createPostgres() {
  let Pool;
  try {
    ({ Pool } = require('pg'));
  } catch (err) {
    throw new Error('PostgreSQL mode requires the "pg" package. Run: npm install');
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required when DB_ENGINE=postgres.');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = {
    engine: 'postgres',
    filePath: null,
    async query(sql, params = []) { return pool.query(sql, params); },
    async exec(sql) { return pool.query(sql); },
    async transaction(fn) {
      const client = await pool.connect();
      const tx = {
        engine: 'postgres',
        filePath: null,
        query: (sql, params = []) => client.query(sql, params),
        exec: sql => client.query(sql)
      };
      try {
        await client.query('BEGIN');
        const value = await fn(tx);
        await client.query('COMMIT');
        return value;
      } catch (err) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        throw err;
      } finally {
        client.release();
      }
    },
    async close() { await pool.end(); }
  };
  return adapter;
}

async function createDb() {
  const engine = String(process.env.DB_ENGINE || 'sqlite').toLowerCase();
  if (engine === 'postgres' || engine === 'postgresql') return createPostgres();
  return createSqlite();
}

module.exports = { createDb };
