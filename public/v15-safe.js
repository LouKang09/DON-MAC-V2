// Coffee POS v1.5.2 safe feature layer.
// No document-wide MutationObserver: features attach only to their own controls.
(() => {
  'use strict';

  const VERSION_FALLBACK = '1.5.2';
  const UI = globalThis.CoffeePosUiUtils || {};
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'
  }[c]));

  const releaseNotes = [
    'System Logs now use categories, search, result counts, and a fixed-height scroll area.',
    'Replenish and Transfer support multiple ingredients in one batch transaction.',
    'Delivered By / Received By and Remarks include required validation and clearer examples.',
    'Inventory selections and batch entries stay stable during live synchronization.',
    'Live updates no longer reload or freeze the sign-in screen.'
  ];
  const upcoming = 'Future improvements will appear here before or when they are released.';

  function toast(message) {
    const el = $('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => el.classList.remove('show'), 3600);
  }

  async function api(url, options = {}) {
    const opts = { ...options, headers: { ...(options.headers || {}) } };
    if (options.body && typeof options.body !== 'string') {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(options.body);
    }
    const response = await fetch(url, opts);
    let data = {};
    try { data = await response.json(); } catch (_) {}
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }

  let currentVersion = VERSION_FALLBACK;
  let updateAnnounced = false;

  function seenVersion() {
    try { return localStorage.getItem('coffeePosSeenVersion') || ''; }
    catch (_) { return ''; }
  }
  function setSeenVersion(v) {
    try { localStorage.setItem('coffeePosSeenVersion', v); } catch (_) {}
  }
  function unread() {
    return UI.isUpdateUnread
      ? UI.isUpdateUnread(currentVersion, seenVersion())
      : currentVersion !== seenVersion();
  }

  function ensureWhatsNew() {
    const top = document.querySelector('.topbar-right');
    if (!top) return;

    if (!$('whatsNewButton')) {
      const button = document.createElement('button');
      button.id = 'whatsNewButton';
      button.type = 'button';
      button.className = 'whats-new-button';
      button.setAttribute('aria-label', 'Open system updates');
      button.innerHTML = '<span class="whats-new-icon">◉</span><span class="whats-new-label">What\'s New</span><span id="whatsNewBadge" class="update-badge hidden">NEW</span>';
      const clock = $('clock');
      if (clock) top.insertBefore(button, clock);
      else top.appendChild(button);
    }

    if (!$('whatsNewDialog')) {
      const dialog = document.createElement('dialog');
      dialog.id = 'whatsNewDialog';
      dialog.innerHTML = `<div class="modal-card whats-new-card"><button type="button" class="modal-close" id="whatsNewClose">×</button><p class="eyebrow">SYSTEM UPDATE</p><div class="whats-new-title"><h2>What's New</h2><span id="whatsNewVersion" class="db-pill">v${esc(currentVersion)}</span></div><p class="muted">New features and important POS changes appear here.</p><section class="update-section"><h3>New in this version</h3><ul id="whatsNewList">${releaseNotes.map(x => `<li>${esc(x)}</li>`).join('')}</ul></section><section class="update-section upcoming"><h3>Upcoming</h3><div class="upcoming-copy">${esc(upcoming)}</div></section><button id="whatsNewGotIt" class="primary big" type="button">Got it</button></div>`;
      document.body.appendChild(dialog);
      $('whatsNewClose').onclick = () => dialog.close();
      $('whatsNewGotIt').onclick = () => dialog.close();
      dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
    }

    $('whatsNewButton').onclick = () => {
      setSeenVersion(currentVersion);
      updateWhatsNewBadge();
      if ($('whatsNewVersion')) $('whatsNewVersion').textContent = `v${currentVersion}`;
      if (!$('whatsNewDialog').open) $('whatsNewDialog').showModal();
    };
    updateWhatsNewBadge();
  }

  function updateWhatsNewBadge() {
    const badge = $('whatsNewBadge');
    const button = $('whatsNewButton');
    const isUnread = unread();
    badge?.classList.toggle('hidden', !isUnread);
    button?.classList.toggle('has-update', isUnread);
    if ($('whatsNewVersion')) $('whatsNewVersion').textContent = `v${currentVersion}`;
    if (isUnread && !updateAnnounced) {
      updateAnnounced = true;
      setTimeout(() => toast(`What's New in v${currentVersion} — open the update notice for details.`), 700);
    }
  }

  async function loadVersion() {
    try {
      const status = await api('/api/status');
      currentVersion = String(status.version || VERSION_FALLBACK);
    } catch (_) {
      currentVersion = VERSION_FALLBACK;
    }
    ensureWhatsNew();
  }

  let savedLogScroll = 0;
  function categoryLabel(category) {
    return ({sales:'Sales',reports:'Reports',inventory:'Inventory',catalog:'Catalog / Setup',users:'Users / Access',database:'Database / Backup',other:'Other'})[category] || 'Other';
  }

  function ensureLogFilters() {
    const list = $('logsList');
    if (!list || $('logCategoryFilter')) return;
    list.closest('.card')?.classList.add('logs-card');
    const toolbar = document.createElement('div');
    toolbar.className = 'logs-toolbar';
    toolbar.innerHTML = `<label>Category<select id="logCategoryFilter"><option value="all">All Activity</option><option value="sales">Sales</option><option value="reports">Reports</option><option value="inventory">Inventory</option><option value="catalog">Catalog & Setup</option><option value="users">Users & Access</option><option value="database">Database & Backup</option><option value="other">Other</option></select></label><label class="logs-search-label">Search<input id="logSearch" type="search" placeholder="Search status, user, reference, remarks..." /></label><div id="logResultCount" class="log-result-count">0 logs</div>`;
    list.parentNode.insertBefore(toolbar, list);
    list.setAttribute('tabindex', '0');
    list.addEventListener('scroll', () => { savedLogScroll = list.scrollTop; });
    $('logCategoryFilter').addEventListener('change', filterLogRows);
    $('logSearch').addEventListener('input', filterLogRows);
    const observer = new MutationObserver(() => {
      filterLogRows();
      requestAnimationFrame(() => { list.scrollTop = savedLogScroll; });
    });
    observer.observe(list, { childList: true });
    filterLogRows();
  }

  function filterLogRows() {
    const list = $('logsList');
    if (!list) return;
    const category = $('logCategoryFilter')?.value || 'all';
    const query = String($('logSearch')?.value || '').trim().toUpperCase();
    const rows = [...list.querySelectorAll('.log-row')];
    let visible = 0;
    for (const row of rows) {
      const text = row.textContent || '';
      const cat = UI.classifyLogEntry ? UI.classifyLogEntry({ activity: text }) : 'other';
      row.dataset.category = cat;
      let pill = row.querySelector('.log-category');
      if (!pill) {
        pill = document.createElement('span');
        pill.className = 'log-category';
        row.querySelector('.log-meta')?.prepend(pill);
      }
      if (pill) pill.textContent = categoryLabel(cat);
      const show = (category === 'all' || category === cat) && (!query || text.toUpperCase().includes(query));
      row.style.display = show ? '' : 'none';
      if (show) visible++;
    }
    if ($('logResultCount')) $('logResultCount').textContent = `${visible} of ${rows.length} log${rows.length === 1 ? '' : 's'}`;
    let empty = $('logFilterEmpty');
    if (!empty) {
      empty = document.createElement('div');
      empty.id = 'logFilterEmpty';
      empty.className = 'empty-state hidden';
      empty.innerHTML = '<div><b>No matching logs</b>Try another category or search.</div>';
      list.parentNode.insertBefore(empty, list.nextSibling);
    }
    empty.classList.toggle('hidden', !(rows.length && visible === 0));
  }

  const batches = { replenish: [], transfer: [] };
  const selected = { replenish: '', transfer: '' };

  function formIds(kind) {
    return kind === 'replenish'
      ? {form:'replenishForm',select:'replenishIngredient',qty:'replenishQty',batch:'replenishBatch',count:'replenishBatchCount',add:'replenishAddItem',clear:'replenishClearBatch'}
      : {form:'transferForm',select:'transferIngredient',qty:'transferQty',batch:'transferBatch',count:'transferBatchCount',add:'transferAddItem',clear:'transferClearBatch'};
  }

  function ingredientMeta(select) {
    const opt = select?.selectedOptions?.[0];
    if (!opt) return { name:'Ingredient', uom:'' };
    const match = opt.textContent.match(/^(.*?)\s*\((.*?)\)\s*$/);
    return { name:(match?.[1] || opt.textContent).trim(), uom:(match?.[2] || '').trim() };
  }

  function mergeBatch(kind, item) {
    if (UI.mergeBatchItem) {
      batches[kind] = UI.mergeBatchItem(batches[kind], item);
      return;
    }
    const out = batches[kind].map(x => ({...x}));
    const found = out.find(x => x.ingredientId === item.ingredientId);
    if (found) found.qty += item.qty;
    else out.push(item);
    batches[kind] = out;
  }

  function renderBatch(kind) {
    const ids = formIds(kind), box = $(ids.batch), count = $(ids.count);
    if (!box || !count) return;
    const items = batches[kind];
    count.textContent = items.length ? `${items.length} ingredient${items.length === 1 ? '' : 's'} ready` : 'No items added';
    box.innerHTML = items.length ? items.map(x => `<div class="batch-row"><div class="batch-name"><b>${esc(x.name)}</b><span>${esc(String(x.uom || '').toUpperCase())}</span></div><input type="number" min="0.000001" step="any" value="${esc(x.qty)}" data-batch-qty="${x.ingredientId}" aria-label="Quantity" /><button class="batch-remove" type="button" data-batch-remove="${x.ingredientId}" aria-label="Remove">×</button></div>`).join('') : '<div class="batch-empty">Add one or more ingredients above.</div>';
    box.querySelectorAll('[data-batch-remove]').forEach(button => {
      button.onclick = () => {
        const id = Number(button.dataset.batchRemove);
        batches[kind] = batches[kind].filter(x => x.ingredientId !== id);
        renderBatch(kind);
      };
    });
    box.querySelectorAll('[data-batch-qty]').forEach(input => {
      input.onchange = () => {
        const id = Number(input.dataset.batchQty), qty = Number(input.value);
        if (!Number.isFinite(qty) || qty <= 0) { toast('Quantity must be greater than zero.'); renderBatch(kind); return; }
        batches[kind] = batches[kind].map(x => x.ingredientId === id ? {...x, qty} : x);
        renderBatch(kind);
      };
    });
  }

  function addBatchItem(kind, silent = false) {
    const ids = formIds(kind), select = $(ids.select), qtyInput = $(ids.qty);
    const ingredientId = Number(select?.value), qty = Number(qtyInput?.value);
    if (!Number.isInteger(ingredientId) || ingredientId <= 0) { if (!silent) toast('Choose an ingredient first.'); return false; }
    if (!Number.isFinite(qty) || qty <= 0) { if (!silent) toast('Enter a quantity greater than zero.'); return false; }
    const meta = ingredientMeta(select);
    mergeBatch(kind, { ingredientId, qty, name:meta.name, uom:meta.uom });
    qtyInput.value = '';
    renderBatch(kind);
    return true;
  }

  function clearBatch(kind) {
    batches[kind] = [];
    const ids = formIds(kind);
    if ($(ids.qty)) $(ids.qty).value = '';
    renderBatch(kind);
  }

  function preserveSelect(kind) {
    const select = $(formIds(kind).select);
    if (!select || select.dataset.safePreserve === '1') return;
    select.dataset.safePreserve = '1';
    selected[kind] = select.value;
    select.addEventListener('change', () => { selected[kind] = select.value; });
    const observer = new MutationObserver(() => {
      const wanted = selected[kind];
      queueMicrotask(() => {
        if (wanted && [...select.options].some(o => o.value === wanted)) select.value = wanted;
        else if (!selected[kind]) selected[kind] = select.value;
      });
    });
    observer.observe(select, { childList:true });
  }

  function replaceInventoryForms() {
    const replenish = $('replenishForm'), transfer = $('transferForm');
    if (!replenish || !transfer || replenish.dataset.v15safe === '1') return;
    replenish.dataset.v15safe = '1';
    transfer.dataset.v15safe = '1';
    replenish.innerHTML = `<p class="eyebrow">SUPPLY</p><h3>Replenish</h3><div class="batch-entry"><label>Ingredient<select id="replenishIngredient"></select></label><label>Quantity<input id="replenishQty" type="number" min="0.000001" step="any" placeholder="Qty" /></label><button id="replenishAddItem" class="ghost batch-add" type="button">+ Add Item</button></div><div id="replenishBatch" class="batch-list"></div><div class="batch-footer"><span id="replenishBatchCount" class="tiny muted">No items added</span><button id="replenishClearBatch" class="text-button" type="button">Clear List</button></div><label>Delivered By<input id="deliveredBy" maxlength="150" required placeholder="Who will deliver? e.g. Marlou" /></label><label>Remarks<textarea id="replenishRemarks" rows="2" maxlength="500" required placeholder="Product was delivered by Marlou, phone: 09XXXXXXXXX"></textarea></label><button class="primary" type="submit">Replenish Selected Items</button>`;
    transfer.innerHTML = `<p class="eyebrow">BRANCH MOVEMENT</p><h3>Transfer</h3><div class="batch-entry"><label>Ingredient<select id="transferIngredient"></select></label><label>Quantity<input id="transferQty" type="number" min="0.000001" step="any" placeholder="Qty" /></label><button id="transferAddItem" class="ghost batch-add" type="button">+ Add Item</button></div><div id="transferBatch" class="batch-list"></div><div class="batch-footer"><span id="transferBatchCount" class="tiny muted">No items added</span><button id="transferClearBatch" class="text-button" type="button">Clear List</button></div><label>Transfer To<input id="transferBranch" maxlength="150" required placeholder="Branch / destination" /></label><label>Received By<input id="receivedBy" maxlength="150" required placeholder="Who will receive? e.g. Marlou" /></label><label>Remarks<textarea id="transferRemarks" rows="2" maxlength="500" required placeholder="Product will be delivered by 2 PM by Marlou"></textarea></label><button class="primary" type="submit">Transfer Selected Items</button>`;
    preserveSelect('replenish');
    preserveSelect('transfer');
    $('replenishAddItem').onclick = () => addBatchItem('replenish');
    $('transferAddItem').onclick = () => addBatchItem('transfer');
    $('replenishClearBatch').onclick = () => clearBatch('replenish');
    $('transferClearBatch').onclick = () => clearBatch('transfer');
    renderBatch('replenish');
    renderBatch('transfer');
    replenish.addEventListener('submit', e => submitMovement(e, 'replenish'), true);
    transfer.addEventListener('submit', e => submitMovement(e, 'transfer'), true);
  }

  async function submitMovement(event, kind) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const form = event.currentTarget, ids = formIds(kind);
    if (!form.reportValidity()) return;
    if (!batches[kind].length && Number($(ids.qty)?.value) > 0) addBatchItem(kind, true);
    if (!batches[kind].length) { toast(`Add at least one ingredient to the ${kind} list.`); return; }
    const controls = [...form.querySelectorAll('button,input,select,textarea')];
    const prior = controls.map(x => x.disabled);
    controls.forEach(x => { x.disabled = true; });
    try {
      const items = batches[kind].map(x => ({ ingredientId:x.ingredientId, qty:x.qty }));
      if (kind === 'replenish') {
        await api('/api/inventory/replenish', {method:'POST', body:{items, deliveredBy:$('deliveredBy').value.trim(), remarks:$('replenishRemarks').value.trim()}});
        toast(`${items.length} ingredient(s) replenished successfully.`);
        clearBatch(kind);
        $('deliveredBy').value = '';
        $('replenishRemarks').value = '';
      } else {
        await api('/api/inventory/transfer', {method:'POST', body:{items, branch:$('transferBranch').value.trim(), receivedBy:$('receivedBy').value.trim(), remarks:$('transferRemarks').value.trim()}});
        toast(`${items.length} ingredient(s) transferred successfully.`);
        clearBatch(kind);
        $('transferBranch').value = '';
        $('receivedBy').value = '';
        $('transferRemarks').value = '';
      }
      setTimeout(() => document.querySelector('.nav[data-view="inventory"]')?.click(), 0);
    } catch (err) {
      toast(err.message);
    } finally {
      controls.forEach((x, i) => { x.disabled = prior[i]; });
    }
  }

  function init() {
    if (document.documentElement.dataset.v15SafeInit === '1') return;
    document.documentElement.dataset.v15SafeInit = '1';
    ensureWhatsNew();
    ensureLogFilters();
    replaceInventoryForms();
    loadVersion();
    document.querySelector('.nav[data-view="logs"]')?.addEventListener('click', () => setTimeout(() => { ensureLogFilters(); filterLogRows(); }, 40));
    document.querySelector('.nav[data-view="inventory"]')?.addEventListener('click', () => setTimeout(() => { preserveSelect('replenish'); preserveSelect('transfer'); }, 40));
    console.info('Coffee POS v1.5.2 safe features initialized.');
  }

  init();
})();
