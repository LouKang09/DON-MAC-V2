// Cross-terminal live refresh layer for Coffee POS Web.
(() => {
  const SYNC_MS = 5000;
  const locks = new Set();
  let posFingerprint = null;
  let pendingPosChange = false;

  // Force every GET to bypass browser/proxy caches. The server already sends
  // no-store, but this also protects older browsers and embedded mobile views.
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
  function editingAdmin() {
    if (activeView() !== 'catalog' && activeView() !== 'users') return false;
    const a = document.activeElement;
    if (a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) return true;
    return ['productEditId','ingredientEditId','promoEditId','packageEditId','userEditId']
      .some(id => Number(document.getElementById(id)?.value || 0) > 0);
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

  async function refreshPosAvailability() {
    const r = await fetch('/api/catalog');
    if (!r.ok) return;
    const c = await r.json();
    const fingerprint = JSON.stringify({
      products: (c.products || []).map(x => [x.id,x.price,x.available,x.availabilityStatus,
        (x.availabilityDetails || []).map(d => [d.ingredientId,d.current,d.required,d.status])]),
      packages: (c.packages || []).map(x => [x.id,x.price,x.available,x.sellable,x.availabilityStatus]),
      promos: (c.promos || []).map(x => [x.id,x.price,x.foodLimit,x.coffeeLimit]),
      addOns: (c.addOns || []).map(x => [x.id,x.price])
    });
    if (posFingerprint === null) { posFingerprint = fingerprint; stamp(); return; }
    if (fingerprint !== posFingerprint) {
      posFingerprint = fingerprint;
      if (cartIsEmpty() && !dialogOpen()) {
        location.reload();
        return;
      }
      pendingPosChange = true;
      stamp('STOCK CHANGED');
      return;
    }
    if (pendingPosChange && cartIsEmpty() && !dialogOpen()) {
      location.reload();
      return;
    }
    stamp(pendingPosChange ? 'STOCK CHANGED' : 'LIVE SYNC');
  }

  async function refreshView(view, manual = false) {
    if (document.hidden || !document.getElementById('app') || document.getElementById('app').classList.contains('hidden')) return;
    if (locks.has(view)) return;
    if (!manual && editingAdmin()) return;
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

  // Make the existing Inventory refresh button refresh stock AND movements.
  const movementButton = document.getElementById('refreshMovements');
  if (movementButton) movementButton.addEventListener('click', () => {
    setTimeout(() => document.querySelector('.nav[data-view="inventory"]')?.click(), 0);
  });

  // Show users that refresh is actually happening.
  ['dashboardRefresh','refreshMovements','loadReport','refreshLogs'].forEach(id => {
    const b = document.getElementById(id);
    if (!b) return;
    b.addEventListener('click', () => stamp('REFRESHED'));
  });

  const run = () => refreshView(activeView());
  window.addEventListener('focus', run);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) run(); });
  setInterval(run, SYNC_MS);
  setTimeout(run, 1200);
  stamp();
})();
