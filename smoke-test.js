const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coffee-pos-final-'));
const dbPath = path.join(tempDir, 'smoke.db');
const backupDir = path.join(tempDir, 'backups');
const port = 3187;
const base = `http://127.0.0.1:${port}`;
let cookie = '';

const child = spawn(process.execPath, ['server.js'], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    DB_ENGINE: 'sqlite',
    SQLITE_PATH: dbPath,
    BACKUP_DIR: backupDir
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
child.stdout.on('data', d => process.stdout.write(d));
child.stderr.on('data', d => process.stderr.write(d));

async function request(url, opts = {}, expectOk = true) {
  const headers = { ...(opts.headers || {}) };
  if (cookie) headers.cookie = cookie;
  if (opts.body && typeof opts.body !== 'string' && !(opts.body instanceof Buffer)) {
    headers['content-type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  const r = await fetch(base + url, { ...opts, headers });
  const setCookie = r.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await r.json() : Buffer.from(await r.arrayBuffer());
  if (expectOk && !r.ok) throw new Error(`${r.status} ${data?.error || 'request failed'}`);
  return { r, data };
}
async function api(url, opts = {}) { return (await request(url, opts, true)).data; }
async function waitForServer() {
  for (let i = 0; i < 80; i++) {
    try { return await api('/api/status'); }
    catch (_) { await new Promise(r => setTimeout(r, 100)); }
  }
  throw new Error('Server did not start.');
}

(async () => {
  try {
    const status = await waitForServer();
    assert.equal(status.setupRequired, true);
    assert.equal(status.version, '1.4.0-stable');

    // Static frontend.
    for (const file of ['/', '/app.js', '/styles.css']) {
      const x = await request(file);
      assert.equal(x.r.status, 200);
      assert(x.data.length > 100);
    }

    await api('/api/setup', { method: 'POST', body: { username: 'SmokeAdmin', password: 'StrongPass123!' } });
    await api('/api/auth/login', { method: 'POST', body: { username: 'SmokeAdmin', password: 'StrongPass123!' } });
    const me = await api('/api/auth/me');
    assert.equal(me.user.role, 'Admin');

    // Workbook catalog and exact accounting parity.
    let catalog = await api('/api/catalog');
    assert.equal(catalog.products.length, 28);
    assert.equal(catalog.promos.length, 4);
    assert.equal(catalog.addOns.length, 2);
    assert.equal(catalog.packages.length, 3);

    const darko = catalog.products.find(x => x.name === 'DON DARKO');
    const waffle = catalog.products.find(x => x.name === 'CLASSIC WAFFLE');
    const promo143 = catalog.promos.find(x => x.name === '143 Promo');
    const fries = catalog.addOns.find(x => x.name === 'FLAVORED FRIES');
    const premium = catalog.addOns.find(x => x.name === 'PREMIUM COFFEE');
    assert(darko && waffle && promo143 && fries && premium);

    const promoOrder = {
      items: [
        { kind: 'product', id: darko.id, qty: 2 },
        { kind: 'product', id: waffle.id, qty: 2 },
        { kind: 'addon', id: fries.id, qty: 1 },
        { kind: 'addon', id: premium.id, qty: 1 }
      ],
      promoId: promo143.id,
      senior: { enabled: false }
    };
    const pq = await api('/api/quote', { method: 'POST', body: promoOrder });
    assert.deepEqual([pq.gross, pq.adjustment, pq.actual], [193, -33, 160]);

    const standaloneAddon = await request('/api/quote', { method: 'POST', body: { items: [{ kind: 'addon', id: fries.id, qty: 1 }] } }, false);
    assert.equal(standaloneAddon.r.status, 400);

    const seniorProduct = catalog.products.find(x => x.name === 'C CHEESE FRIES');
    const sq = await api('/api/quote', { method: 'POST', body: {
      items: [{ kind: 'product', id: seniorProduct.id, qty: 5 }],
      senior: { enabled: true, name: 'Test Senior', id: '123456' }
    }});
    assert.deepEqual([sq.gross, sq.adjustment, sq.actual], [225, -45, 180]);
    const longSenior = await request('/api/quote', { method: 'POST', body: { items: [{ kind: 'product', id: seniorProduct.id, qty: 1 }], senior: { enabled: true, name: 'X'.repeat(151), id: '123456' } } }, false);
    assert.equal(longSenior.r.status, 400);

    const report = await api('/api/reports/sales?period=daily&date=2026-08-19');
    assert.equal(report.actual, 1192.2);
    assert.equal(report.transactionCount, 7);
    const historicalDetail = await api(`/api/sales/${encodeURIComponent(report.transactions[0].reference)}`);
    assert.equal(historicalDetail.reference, report.transactions[0].reference);
    assert(historicalDetail.items.length > 0);
    assert(historicalDetail.cashier);
    assert(historicalDetail.soldAt);
    const badDate = await request('/api/reports/sales?period=weekly&date=2026-99-99', {}, false);
    assert.equal(badDate.r.status, 400);
    const longCashier = await request('/api/reports/sales?period=daily&date=2026-08-19&cashier=' + 'X'.repeat(81), {}, false);
    assert.equal(longCashier.r.status, 400);
    const costing = await api('/api/reports/costing?period=daily&date=2026-08-19');
    assert(costing.totalCost > 0 && costing.ingredients.length > 0);

    // PDFs are server generated, not browser print output.
    const salesPdf = await request('/api/reports/sales.pdf?period=daily&date=2026-08-19');
    assert.equal(salesPdf.r.headers.get('content-type'), 'application/pdf');
    assert.equal(salesPdf.data.subarray(0, 4).toString(), '%PDF');
    const costingPdf = await request('/api/reports/costing.pdf?period=daily&date=2026-08-19');
    assert.equal(costingPdf.data.subarray(0, 4).toString(), '%PDF');

    // Package engine: workbook composition is blank, then Admin supplies real composition.
    const firstPackage = catalog.packages[0];
    assert.equal(firstPackage.sellable, false);
    await api(`/api/admin/packages/${firstPackage.id}/items`, { method: 'PUT', body: { items: [{ productId: darko.id, qty: 1 }] } });
    catalog = await api('/api/catalog');
    const configuredPackage = catalog.packages.find(x => x.id === firstPackage.id);
    assert.equal(configuredPackage.sellable, true);
    const packageQuote = await api('/api/quote', { method: 'POST', body: { items: [{ kind: 'package', id: firstPackage.id, qty: 1 }] } });
    assert.equal(packageQuote.actual, configuredPackage.price);
    const blockedPackageComponentDisable = await request(`/api/admin/products/${darko.id}`, { method: 'PUT', body: { category: darko.category, price: darko.price, active: false } }, false);
    assert.equal(blockedPackageComponentDisable.r.status, 409);

    // Product + ingredient + recipe lifecycle.
    const newIng = await api('/api/admin/ingredients', { method: 'POST', body: { name: 'WEB TEST ING', uom: 'pcs', lowStockThreshold: 10 } });
    const newProd = await api('/api/admin/products', { method: 'POST', body: { name: 'WEB TEST PRODUCT', category: 'Food', price: 101 } });
    catalog = await api('/api/catalog');
    const newWithoutRecipe = catalog.products.find(x => x.id === newProd.id);
    assert.equal(newWithoutRecipe.available, false);
    assert.equal(newWithoutRecipe.recipeConfigured, false);
    assert.equal(newWithoutRecipe.availabilityStatus, 'recipe_required');
    const noRecipeQuote = await request('/api/quote', { method: 'POST', body: { items: [{ kind: 'product', id: newProd.id, qty: 1 }] } }, false);
    assert.equal(noRecipeQuote.r.status, 409);
    assert.equal(noRecipeQuote.data.details.reason, 'recipe_required');
    await api(`/api/admin/products/${newProd.id}/recipe`, { method: 'PUT', body: { items: [{ ingredientId: newIng.id, quantity: 1, cost: 10 }] } });
    catalog = await api('/api/catalog');
    const newWithEmptyStock = catalog.products.find(x => x.id === newProd.id);
    assert.equal(newWithEmptyStock.available, false);
    assert.equal(newWithEmptyStock.recipeConfigured, true);
    assert.equal(newWithEmptyStock.availabilityStatus, 'insufficient_stock');
    assert(newWithEmptyStock.availabilityDetails.some(x => x.name === 'WEB TEST ING' && x.status === 'out_of_stock'));
    await api('/api/inventory/replenish', { method: 'POST', body: { items: [{ ingredientId: newIng.id, qty: 5 }], deliveredBy: 'Smoke Supplier', remarks: 'Smoke test' } });
    catalog = await api('/api/catalog');
    const replenishedProduct = catalog.products.find(x => x.id === newProd.id);
    assert.equal(replenishedProduct.available, true);
    assert(replenishedProduct.stockWarnings.some(x => x.name === 'WEB TEST ING' && x.status === 'low_stock_warning'));

    // Recipe-used ingredient cannot be silently archived.
    const blockedArchive = await request(`/api/admin/ingredients/${newIng.id}`, { method: 'DELETE' }, false);
    assert.equal(blockedArchive.r.status, 409);
    const blockedDisable = await request(`/api/admin/ingredients/${newIng.id}`, { method: 'PUT', body: { name: 'WEB TEST ING', uom: 'pcs', lowStockThreshold: 1, active: false } }, false);
    assert.equal(blockedDisable.r.status, 409);

    // Sale + explicit stock reversal.
    const beforeInv = await api('/api/inventory');
    const beforeQty = beforeInv.items.find(x => x.id === newIng.id).stock;
    const retryKey = 'smoke-sale-idempotency-001';
    const saleBody = { items: [{ kind: 'product', id: newProd.id, qty: 1 }], paymentMode: 'Cash', tender: 200, clientRequestId: retryKey };
    const [soldA, soldB] = await Promise.all([
      api('/api/sales', { method: 'POST', body: saleBody }),
      api('/api/sales', { method: 'POST', body: saleBody })
    ]);
    assert.equal(soldA.reference, soldB.reference);
    assert.equal([!!soldA.idempotent, !!soldB.idempotent].filter(Boolean).length, 1);
    const sold = soldA.idempotent ? soldB : soldA;
    const saleDetail = await api(`/api/sales/${encodeURIComponent(sold.reference)}`);
    assert.equal(saleDetail.reference, sold.reference);
    assert.equal(saleDetail.status, 'Sold');
    assert.equal(saleDetail.cashier, 'SmokeAdmin');
    assert.equal(saleDetail.paymentMode, 'Cash');
    assert.equal(saleDetail.items.length, 1);
    assert.equal(saleDetail.items[0].name, 'WEB TEST PRODUCT');
    assert.equal(saleDetail.items[0].qty, 1);
    assert.equal(saleDetail.items[0].lineTotal, 101);
    assert(saleDetail.inventoryMovements.some(x => x.type === 'SALE' && x.ingredient === 'WEB TEST ING' && x.quantityChange === -1));
    assert(saleDetail.auditEvents.some(x => String(x.activity).includes(sold.reference)));
    const afterSale = await api('/api/inventory');
    assert.equal(afterSale.items.find(x => x.id === newIng.id).stock, beforeQty - 1);
    // Change the recipe after the sale; deletion must restore the ORIGINAL deduction, not today's recipe.
    await api(`/api/admin/products/${newProd.id}/recipe`, { method: 'PUT', body: { items: [{ ingredientId: newIng.id, quantity: 2, cost: 10 }] } });
    const deletion = await api(`/api/sales/${encodeURIComponent(sold.reference)}/delete`, { method: 'POST', body: { restoreStock: true } });
    assert.equal(deletion.stockRestored, true);
    const deletedDetail = await api(`/api/sales/${encodeURIComponent(sold.reference)}`);
    assert.equal(deletedDetail.status, 'Deleted');
    assert.equal(deletedDetail.deletedBy, 'SmokeAdmin');
    assert(deletedDetail.deletedAt);
    assert(deletedDetail.inventoryMovements.some(x => x.type === 'SALE_REVERSAL' && x.quantityChange === 1));
    assert(deletedDetail.auditEvents.some(x => String(x.activity).includes('Sale deleted:')));
    const afterDelete = await api('/api/inventory');
    assert.equal(afterDelete.items.find(x => x.id === newIng.id).stock, beforeQty);
    await api(`/api/admin/products/${newProd.id}/recipe`, { method: 'PUT', body: { items: [{ ingredientId: newIng.id, quantity: 1, cost: 10 }] } });

    // Imported historical transactions have no web stock-deduction movements; deletion must not invent stock restoration.
    const historicalRef = report.transactions.find(x => x.status === 'Sold')?.reference;
    assert(historicalRef);
    const invBeforeHistoricalDelete = (await api('/api/inventory')).items.map(x => [x.id, x.stock]);
    const historicalDeletion = await api(`/api/sales/${encodeURIComponent(historicalRef)}/delete`, { method: 'POST', body: { restoreStock: true } });
    assert.equal(historicalDeletion.stockRestored, false);
    const invAfterHistoricalDelete = (await api('/api/inventory')).items.map(x => [x.id, x.stock]);
    assert.deepEqual(invAfterHistoricalDelete, invBeforeHistoricalDelete);

    // Promo and user maintenance.
    const testPromo = await api('/api/admin/promos', { method: 'POST', body: { name: 'WEB TEST PROMO', inclusion: '1 Food', price: 50, foodLimit: 1, coffeeLimit: 0 } });
    await api(`/api/admin/promos/${testPromo.id}`, { method: 'DELETE' });
    const overwriteAdmin = await request('/api/users', { method: 'POST', body: { username: 'SmokeAdmin', password: 'DifferentPass123!', role: 'User', active: false } }, false);
    assert.equal(overwriteAdmin.r.status, 409);
    const badRole = await request('/api/users', { method: 'POST', body: { username: 'BadRoleUser', password: 'CashierPass123!', role: 'Owner', active: true } }, false);
    assert.equal(badRole.r.status, 400);
    const testUser = await api('/api/users', { method: 'POST', body: { username: 'SmokeCashier', password: 'CashierPass123!', role: 'User', active: false } });
    assert.equal(testUser.user.active, false);
    await api(`/api/users/${testUser.user.id}`, { method: 'PUT', body: { role: 'User', active: true } });
    await api(`/api/users/${testUser.user.id}`, { method: 'PUT', body: { role: 'User', active: false } });

    const badSettings = await request('/api/admin/settings', { method: 'PUT', body: { shopName: 'X'.repeat(101), defaultReportEmail: '' } }, false);
    assert.equal(badSettings.r.status, 400);

    // Backup + restore actually rolls back a later mutation.
    const backup = await api('/api/backups', { method: 'POST' });
    assert(fs.existsSync(path.join(backupDir, backup.name)));
    await api(`/api/admin/products/${newProd.id}`, { method: 'PUT', body: { category: 'Food', price: 777, active: true } });
    let products = (await api('/api/admin/products')).products;
    assert.equal(products.find(x => x.id === newProd.id).price, 777);
    await api(`/api/backups/${encodeURIComponent(backup.name)}/restore`, { method: 'POST' });
    const afterRestoreMe = await request('/api/auth/me', {}, false);
    assert.equal(afterRestoreMe.r.status, 401);
    cookie = '';
    await api('/api/auth/login', { method: 'POST', body: { username: 'SmokeAdmin', password: 'StrongPass123!' } });
    products = (await api('/api/admin/products')).products;
    assert.equal(products.find(x => x.id === newProd.id).price, 101);

    const health = await api('/api/health');
    assert.equal(health.ok, true);
    assert.equal(health.app, 'coffee-pos-web');
    const dashboard = await api('/api/dashboard');
    assert(dashboard.metrics && Array.isArray(dashboard.trend));

    console.log('FINAL SMOKE TEST PASSED');
  } catch (err) {
    console.error('FINAL SMOKE TEST FAILED', err);
    process.exitCode = 1;
  } finally {
    child.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 250));
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
  }
})();
