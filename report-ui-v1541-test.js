const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PAGE_SIZE, paginate, visiblePageNumbers } = require('./public/report-pagination-v1541');

const read = path => fs.readFileSync(path, 'utf8');
const html = read('public/index.html');
const core = read('public/app-core.js');
const loader = read('public/app.js');
const css = read('public/sales-report-v1541.css');

assert.equal(PAGE_SIZE, 10);
const input = Array.from({length: 34}, (_, index) => 'item-' + (index + 1));
for (const [requested,expectedFirst,expectedLast,expectedCount] of [
  [1, 'item-1', 'item-10', 10], [2, 'item-11', 'item-20', 10],
  [3, 'item-21', 'item-30', 10], [4, 'item-31', 'item-34', 4]
]) {
  const out = paginate(input, requested);
  assert.equal(out.page, requested);
  assert.equal(out.pages, 4);
  assert.equal(out.rows.length, expectedCount);
  assert.equal(out.rows[0], expectedFirst);
  assert.equal(out.rows.at(-1), expectedLast);
}
assert.equal(paginate(input, 999).page, 4);
assert.equal(paginate(input, -3).page, 1);
assert.deepEqual(paginate([], 1).rows, []);
assert.deepEqual(visiblePageNumbers(1, 5), [1,2,3,4,5]);
assert.deepEqual(visiblePageNumbers(1, 21), [1,2,'…',20,21]);
assert.deepEqual(visiblePageNumbers(10, 21), [1,2,'…',9,10,11,'…',20,21]);

const count = (text, pattern) => [...text.matchAll(pattern)].length;
assert.equal(count(html, /id="movementSearch"/g), 1, 'Inventory audit should have one search field');
assert.equal(count(html, /id="movementTypeFilter"/g), 1);
assert.equal(count(html, /id="refreshMovements"/g), 1);
assert.equal(count(html, /id="auditSearch"/g), 0, 'Duplicate audit search must be removed');
assert.match(html, /class="audit-filter-toolbar inv-audit-unified-toolbar"[\s\S]*id="movementSearch"[\s\S]*id="refreshMovements"/);
assert.match(html, /class="primary inv-audit-refresh"/);
assert.match(core, /pageSize:10,query:''/);
assert.match(core, /auditUI\.type/);
assert.equal(count(html, /id="reportPeriod"/g), 1);
assert.equal(count(html, /id="reportDate"/g), 1);
assert.equal(count(html, /id="reportBranch"/g), 1);
assert.equal(count(html, /id="reportCashierSelect"/g), 1);
assert.equal(count(html, /id="reportCashierAll"/g), 1);
assert.equal(count(html, /id="salesPdf"/g), 1);
assert.equal(count(html, /id="costingPdf"/g), 1);
assert.doesNotMatch(html, /id="loadReport"|id="emailReport"|Sales \+ Costing|Gross \/ Adjusted \/ Actual \/ Costing \/ Net/i);
assert.match(html, />Sales Report<\/span>/);
assert.match(html, />Costing Report<\/span>/);
assert.match(html, /data-view="reports" data-tooltip="Sales Report"/);
assert.match(html, /report-pagination-v1541\.js\?v=1\.5\.41/);

for (const kind of ['products','promos','ingredients','transactions']) {
  assert.match(core, new RegExp("reportPageSlice\\('"+kind+"'"));
  assert.match(html, new RegExp('data-report-section="'+kind+'"'));
}
for (const id of ['reportProductsPagination','reportPromosPagination','reportIngredientsPagination','reportTransactionsPagination']) {
  assert.equal(count(html, new RegExp('id="'+id+'"', 'g')), 1);
}
assert.match(core, /\['reportPeriod','reportDate'\]\.forEach/);
assert.match(core, /\$\('reportCashierList'\)\.addEventListener\('change'/);
assert.match(core, /reportUI\.request/);
assert.match(core, /resetReportPages\(\)/);
assert.doesNotMatch(core, /\$\('loadReport'\)|\$\('emailReport'\)/);
assert.match(loader, /salesReportV1541Css/);
assert.match(css, /\.report-filter-fields/);
assert.match(css, /\.inv-audit-refresh/);
console.log('Don Mac audit and Sales Report regression tests passed.');
