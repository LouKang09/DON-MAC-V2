// Cross-terminal live refresh layer for Coffee POS Web.
// IMPORTANT: background sync must never navigate/reload the page.
(() => {
  const SYNC_MS = 5000;
  const locks = new Set();
  let posFingerprint = null;
  let pendingPosChange = false;

  // Force GET requests to bypass browser/proxy caches.
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const method = String(init.method || 'GET').toUpperCase();
    if (method !== 'GET') return nativeFetch(input, init);
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin === location.origin) url.searchParams.set('_live', String(Date.now()));
    const headers = new Headers(init.headers || (typeof input !== 'string' ? input.headers : undefined) || {});
    headers.set('Cache-Control', 'no-cache, no-store, max-age=0');
    headers.set('Pragma', 'no-cache');
    return nativeFetch(url.toString(), { ...init, cache: 'no-store', headers });
  };

  function activeView() {
    return document.querySelector('.view.active')?.id?.replace(/^view-/, '') || 'pos';
  }
  function cartIsEmpty() {
    const list = document.getElementById('orderList');
    return !list || !!list.querySelector('.empty-state');
  }
  function dialogOpen() {
    return !!document.querySelector('dialog[open]');
  }
  function isTypingInside(selector) {
    const root = document.querySelector(selector);
    const a = document.activeElement;
    return !!(root && a && root.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName));
  }
  function editingAdmin() {
    if (activeView() !== 'catalog' && activeView() !== 'users') return false;
    const a = document.activeElement;
    if (a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) return true;
    return ['productEditId','ingredientEditId','promoEditId','packageEditId','userEditId']
      .some(id => Number(document.getElementById(id)?.value || 0) > 0);
  }
  function editingInventory() {
    // Do not rebuild inventory dropdowns while the cashier/admin is entering a batch.
    if (activeView() !== 'inventory') return false;
    if (isTypingInside('#view-inventory')) return true;
    const rep = document.querySelectorAll('#replenishBatch .batch-row').length;
    const trn = document.querySelectorAll('#transferBatch .batch-row').length;
    return rep > 0 || trn > 0;
  }

  function ensureStatus() {
    let el = document.getElementById('liveSyncStatus');
    if (el) return el;
    el = document.createElement('span');
    el.id = 'liveSyncStatus';
    el.className = 'db-pill';
    el.style.whiteSpace = 'nowrap';
    el.textContent = 'LIVE SYNC';
    document.querySelector('.topbar-right')?.prepend(el);
    return el;
  }
  function stamp(message = 'LIVE SYNC') {
    const el = ensureStatus();
    const time = new Intl.DateTimeFormat('en-PH', {
      timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit', second: '2-digit'
    }).format(new Date());
    el.textContent = `${message} · ${time}`;
  }

  function stableCatalogFingerprint(c) {
    const byId = (a, b) => Number(a?.id || 0) - Number(b?.id || 0);
    const detail = d => [Number(d.ingredientId || 0), Number(d.current || 0), Number(d.required || 0), String(d.status || '')];
    return JSON.stringify({
      products: [...(c.products || [])].sort(byId).map(x => [
        Number(x.id), Number(x.price), !!x.available, String(x.availabilityStatus || ''),
        [...(x.availabilityDetails || [])].sort((a,b)=>Number(a.ingredientId||0)-Number(b.ingredientId||0)).map(detail),
        [...(x.stockWarnings || [])].sort((a,b)=>Number(a.ingredientId||0)-Number(b.ingredientId||0)).map(detail)
      ]),
      packages: [...(c.packages || [])].sort(byId).map(x => [Number(x.id),Number(x.price),!!x.available,!!x.sellable,String(x.availabilityStatus||'')]),
      promos: [...(c.promos || [])].sort(byId).map(x => [Number(x.id),Number(x.price),Number(x.foodLimit||0),Number(x.coffeeLimit||0)]),
      addOns: [...(c.addOns || [])].sort(byId).map(x => [Number(x.id),Number(x.price)])
    });
  }

  function ensurePosUpdateButton() {
    let b = document.getElementById('posSyncRefresh');
    if (b) return b;
    b = document.createElement('button');
    b.id = 'posSyncRefresh';
    b.type = 'button';
    b.className = 'ghost';
    b.style.padding = '6px 9px';
    b.style.fontSize = '9px';
    b.textContent = 'Refresh POS';
    b.title = 'Catalog or stock changed on another terminal. Click to safely reload the POS.';
    b.onclick = () => location.reload(); // Explicit user action only; never called by background sync.
    b.hidden = true;
    const status = ensureStatus();
    status.parentNode?.insertBefore(b, status.nextSibling);
    return b;
  }
  function setPosUpdateReady(ready) {
    pendingPosChange = !!ready;
    const b = ensurePosUpdateButton();
    b.hidden = !ready;
    if (ready) stamp(cartIsEmpty() && !dialogOpen() ? 'UPDATE READY' : 'STOCK CHANGED');
  }

  async function refreshPosAvailability() {
    const r = await fetch('/api/catalog');
    if (!r.ok) return;
    const c = await r.json();
    const fingerprint = stableCatalogFingerprint(c);
    if (posFingerprint === null) {
      posFingerprint = fingerprint;
      stamp();
      return;
    }
    if (fingerprint !== posFingerprint) {
      posFingerprint = fingerprint;
      setPosUpdateReady(true);
      return;
    }
    if (pendingPosChange) {
      stamp(cartIsEmpty() && !dialogOpen() ? 'UPDATE READY' : 'STOCK CHANGED');
      return;
    }
    stamp();
  }

  async function refreshView(view, manual = false) {
    if (document.hidden || !document.getElementById('app') || document.getElementById('app').classList.contains('hidden')) return;
    if (locks.has(view)) return;
    if (!manual && editingAdmin()) return;
    if (!manual && editingInventory()) { stamp('EDITING'); return; }
    locks.add(view);
    try {
      if (view === 'pos') {
        await refreshPosAvailability();
      } else if (view === 'dashboard') {
        document.getElementById('dashboardRefresh')?.click();
        stamp();
      } else if (view === 'inventory') {
        document.querySelector('.nav[data-view="inventory"]')?.click();
        stamp();
      } else if (view === 'reports') {
        document.getElementById('loadReport')?.click();
        stamp();
      } else if (view === 'catalog') {
        document.querySelector('.nav[data-view="catalog"]')?.click();
        stamp();
      } else if (view === 'users') {
        document.querySelector('.nav[data-view="users"]')?.click();
        stamp();
      } else if (view === 'logs') {
        document.getElementById('refreshLogs')?.click();
        stamp();
      }
    } catch (err) {
      console.error('Live refresh failed:', view, err);
      stamp('SYNC RETRY');
    } finally {
      setTimeout(() => locks.delete(view), 500);
    }
  }

  // Existing movement button refreshes stock + movement history, but never forces navigation/reload while editing.
  const movementButton = document.getElementById('refreshMovements');
  if (movementButton) movementButton.addEventListener('click', () => {
    if (!editingInventory()) setTimeout(() => document.querySelector('.nav[data-view="inventory"]')?.click(), 0);
  });

  ['dashboardRefresh','refreshMovements','loadReport','refreshLogs'].forEach(id => {
    const b = document.getElementById(id);
    if (!b) return;
    b.addEventListener('click', () => stamp('REFRESHED'));
  });

  ensurePosUpdateButton();
  const run = () => refreshView(activeView());
  window.addEventListener('focus', run);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) run(); });
  setInterval(run, SYNC_MS);
  setTimeout(run, 1200);
  stamp();
})();
