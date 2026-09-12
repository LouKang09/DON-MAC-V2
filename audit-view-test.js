const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

assert(html.includes('id="transactionDialog"'), 'Transaction detail dialog is missing.');
assert(html.includes('<th>Action</th>'), 'Audit Trail action column is missing.');
assert(!html.includes('<th class="admin-only">Action</th>'), 'Audit Trail action is still admin-only.');
assert(js.includes('data-view-sale='), 'Audit Trail View button is missing.');
assert(js.includes('async function viewTransaction(reference)'), 'View Transaction handler is missing.');
assert(js.includes('function renderTransactionDetail(d)'), 'Transaction detail renderer is missing.');
assert(!js.includes('data-delete-sale='), 'Delete button is still exposed in the Audit Trail.');
assert(!js.includes('function deleteTransaction(reference)'), 'Old Audit Trail delete handler is still present.');
assert(css.includes('.transaction-detail-card'), 'Transaction detail responsive styling is missing.');
assert(server.includes('async function getSaleDetail(reference)'), 'Transaction detail API implementation is missing.');
assert(server.includes("p.match(/^\\/api\\/sales\\/([^/]+)$/)"), 'Transaction detail API route is missing.');

for (const required of [
  'Cashier','Date / Time','Payment Mode','Payment Reference','Cash Tender','Change',
  'Promo','Senior Citizen','Discount','Remark','Products Ordered','Inventory Impact','Audit Events'
]) {
  assert(js.includes(required), `Transaction View is missing ${required}.`);
}

console.log('TRANSACTION AUDIT VIEW TEST PASSED');
