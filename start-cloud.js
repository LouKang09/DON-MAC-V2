// Railway/PostgreSQL startup shim.
// node-postgres normally returns TIMESTAMPTZ as Date objects. The legacy report
// filter expected ISO strings, so normalize TIMESTAMPTZ values to ISO before
// loading the application. This keeps Manila date filtering correct.
try {
  const { types } = require('pg');
  types.setTypeParser(1184, value => new Date(value).toISOString());
} catch (err) {
  console.error('Unable to configure PostgreSQL timestamp parser:', err.message);
}
require('./server');
