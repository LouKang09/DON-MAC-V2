// Coffee POS v1.5.0 feature layer: filtered logs, What's New, and batch inventory movement.
(() => {
  const VERSION_FALLBACK = '1.5.0';
  const UI = globalThis.CoffeePosUiUtils || {};
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const releaseNotes = [
    'System Logs now have category filters, search, result counts, and an internal scroll area.',
    'Replenish and Transfer now support multiple ingredients in one batch operation.',
    'Delivered By / Received By and Remarks now include clearer instructions and required-field validation.',
    'Inventory ingredient selections and in-progress batch entries now stay stable during live refresh.'
  ];
  const upcoming = 'Future POS improvements and scheduled updates will be announced here when they are ready.';

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
    const r = await fetch(url, opts);
    let data = {};
    try { data = await r.json(); } catch (_) {}
    if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
    return data;
  }

  // ---------- What's New ----------
  let currentVersion = VERSION_FALLBACK;
  let updateAnnounced = false;
  function seenVersion() { try { return localStorage.getItem('coffeePosSeenVersion') || ''; } catch (_) { return ''; } }
  function setSeenVersion(v) { try { localStorage.setItem('coffeePosSeenVersion', v); } catch (_) {} }
  function unread() { return UI.isUpdateUnread ? UI.isUpdateUnread(currentVersion, seenVersion()) : currentVersion !== seenVersion(); }

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
      const live = $('liveSyncStatus');
      if (live && live.nextSibling) top.insertBefore(button, live.nextSibling); else top.prepend(button);
    }
    if (!$('whatsNewDialog')) {
      const dialog = document.createElement('dialog');
      dialog.id = 'whatsNewDialog';
      dialog.innerHTML = `<div class="modal-card whats-new-card"><button type="button" class="modal-close" id="whatsNewClose">×</button><p class="eyebrow">SYSTEM UPDATE</p><div class="whats-new-title"><h2>What's New</h2><span id="whatsNewVersion" class="db-pill">v${esc(currentVersion)}</span></div><p class="muted">New features and important changes for your POS will appear here after each update.</p><section class="update-section"><h3>New in this version</h3><ul id="whatsNewList">${releaseNotes.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></section><section class="update-section upcoming"><h3>Upcoming</h3><div id="upcomingUpdates" class="upcoming-copy">${esc(upcoming)}</div></section><button id="whatsNewGotIt" class="primary big" type="button">Got it</button></div>`;
      document.body.appendChild(dialog);
      $('whatsNewClose').onclick = () => dialog.close();
      $('whatsNewGotIt').onclick = () => dialog.close();
      dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
    }
    $('whatsNewButton').onclick = () => {
      setSeenVersion(currentVersion);
      updateWhatsNewBadge();
      $('whatsNewVersion').textContent = `v${currentVersion}`;
      if (!$('whatsNewDialog').open) $('whatsNewDialog').showModal();
    };
    updateWhatsNewBadge();
  }
  function updateWhatsNewBadge() {
    const badge = $('whatsNewBadge'), button = $('whatsNewButton'), isUnread = unread();
    badge?.classList.toggle('hidden', !isUnread);
    button?.classList.toggle('has-update', isUnread);
    if ($('whatsNewVersion')) $('whatsNewVersion').textContent = `v${currentVersion}`;
    if (isUnread && !updateAnnounced) {
      updateAnnounced = true;
      setTimeout(() => toast(`What's New in v${currentVersion} — open the update notice to see the changes.`), 800);
    }
  }
  async function loadVersion() {
    try { currentVersion = String((await api('/api/status')).version || VERSION_FALLBACK); } catch (_) {}
    ensureWhatsNew();
  }

  // ---------- System Log filters ----------
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
    toolbar.innerHTML = `<label>Category<select id="logCategoryFilter"><option value="all">All Activity</option><option value="sales">Sales</option><option value="reports">Reports (Daily / Weekly / Monthly / Yearly)</option><option value="inventory">Inventory</option><option value="catalog">Catalog & Setup</option><option value="users">Users & Access</option><option value="database">Database & Backup</option><option value="other">Other</option></select></label><label class="logs-search-label">Search<input id="logSearch" type="search" placeholder="Search status, user, reference, remarks..." /></label><div id="logResultCount" class="log-result-count">0 logs</div>`;
    list.parentNode.insertBefore(toolbar, list);
    list.setAttribute('tabindex','0');
    list.addEventListener('scroll', () => { savedLogScroll = list.scrollTop; });
    $('logCategoryFilter').addEventListener('change', filterLogRows);
    $('logSearch').addEventListener('input', filterLogRows);
    const observer = new MutationObserver(() => {
      filterLogRows();
      requestAnimationFrame(() => { list.scrollTop = savedLogScroll; });
    });
    observer.observe(list, { childList:true });
    filterLogRows();
  }
  function filterLogRows() {
    const list = $('logsList'); if (!list) return;
    const category = $('logCategoryFilter')?.value || 'all';
    const q = String($('logSearch')?.value || '').trim().toUpperCase();
    const rows = [...list.querySelectorAll('.log-row')];
    let visible = 0;
    for (const row of rows) {
      const text = row.textContent || '';
      const cat = UI.classifyLogEntry ? UI.classifyLogEntry({activity:text}) : 'other';
      row.dataset.category = cat;
      let pill = row.querySelector('.log-category');
      if (!pill) {
        pill = document.createElement('span'); pill.className = 'log-category';
        row.querySelector('.log-meta')?.prepend(pill);
      }
      if (pill) pill.textContent = categoryLabel(cat);
      const show = (category === 'all' || category === cat) && (!q || text.toUpperCase().includes(q));
      row.style.display = show ? '' : 'none';
      if (show) visible++;
    }
    if ($('logResultCount')) $('logResultCount').textContent = `${visible} of ${rows.length} log${rows.length===1?'':'s'}`;
    let empty = $('logFilterEmpty');
    if (!empty) {
      empty = document.createElement('div'); empty.id = 'logFilterEmpty'; empty.className = 'empty-state hidden';
      empty.innerHTML = '<div><b>No matching logs</b>Try another category or search.</div>';
      list.parentNode.insertBefore(empty, list.nextSibling);
    }
    empty.classList.toggle('hidden', !(rows.length && visible === 0));
  }

  // ---------- Inventory batching ----------
  const batches = { replenish: [], transfer: [] };
  const selected = { replenish: '', transfer: '' };
  function ingredientMeta(select) {
    const opt = select?.selectedOptions?.[0];
    if (!opt) return { name:'Ingredient', uom:'' };
    const m = opt.textContent.match(/^(.*?)\s*\((.*?)\)\s*$/);
    return { name:(m?.[1]||opt.textContent).trim(), uom:(m?.[2]||'').trim() };
  }
  function formIds(kind) {
    return kind === 'replenish'
      ? {form:'replenishForm',select:'replenishIngredient',qty:'replenishQty',batch:'replenishBatch',count:'replenishBatchCount',add:'replenishAddItem',clear:'replenishClearBatch'}
      : {form:'transferForm',select:'transferIngredient',qty:'transferQty',batch:'transferBatch',count:'transferBatchCount',add:'transferAddItem',clear:'transferClearBatch'};
  }
  function mergeBatch(kind,item) {
    batches[kind] = UI.mergeBatchItem ? UI.mergeBatchItem(batches[kind], item) : (() => {
      const out = batches[kind].map(x=>({...x})); const found=out.find(x=>x.ingredientId===item.ingredientId); if(found)found.qty+=item.qty; else out.push(item); return out;
    })();
  }
  function renderBatch(kind) {
    const ids=formIds(kind), box=$(ids.batch), count=$(ids.count); if (!box) return;
    const items=batches[kind];
    count.textContent = items.length ? `${items.length} ingredient${items.length===1?'':'s'} ready` : 'No items added';
    box.innerHTML = items.length ? items.map(x=>`<div class="batch-row"><div class="batch-name"><b>${esc(x.name)}</b><span>${esc(String(x.uom||'').toUpperCase())}</span></div><input type="number" min="0.000001" step="any" value="${esc(x.qty)}" data-batch-qty="${x.ingredientId}" aria-label="Quantity" /><button class="batch-remove" type="button" data-batch-remove="${x.ingredientId}" aria-label="Remove">×</button></div>`).join('') : '<div class="batch-empty">Add one or more ingredients above.</div>';
    box.querySelectorAll('[data-batch-remove]').forEach(b=>b.onclick=()=>{batches[kind]=items.filter(x=>x.ingredientId!==Number(b.dataset.batchRemove));renderBatch(kind);});
    box.querySelectorAll('[data-batch-qty]').forEach(input=>input.onchange=()=>{const id=Number(input.dataset.batchQty),qty=Number(input.value);if(!Number.isFinite(qty)||qty<=0){toast('Quantity must be greater than zero.');renderBatch(kind);return;}batches[kind]=items.map(x=>x.ingredientId===id?{...x,qty}:x);renderBatch(kind);});
  }
  function addBatchItem(kind, silent=false) {
    const ids=formIds(kind), select=$(ids.select), qtyInput=$(ids.qty), ingredientId=Number(select?.value), qty=Number(qtyInput?.value);
    if (!Number.isInteger(ingredientId)||ingredientId<=0) { if(!silent)toast('Choose an ingredient first.'); return false; }
    if (!Number.isFinite(qty)||qty<=0) { if(!silent)toast('Enter a quantity greater than zero.'); return false; }
    const meta=ingredientMeta(select); mergeBatch(kind,{ingredientId,qty,name:meta.name,uom:meta.uom}); qtyInput.value=''; renderBatch(kind); return true;
  }
  function clearBatch(kind){batches[kind]=[];const ids=formIds(kind);if($(ids.qty))$(ids.qty).value='';renderBatch(kind);}
  function preserveSelect(kind) {
    const id=formIds(kind).select, select=$(id); if(!select)return;
    selected[kind]=select.value;
    select.addEventListener('change',()=>{selected[kind]=select.value;});
    const observer=new MutationObserver(()=>{
      const wanted=selected[kind];
      if(wanted&&[...select.options].some(o=>o.value===wanted))select.value=wanted;
      else selected[kind]=select.value;
    });
    observer.observe(select,{childList:true});
  }
  function replaceInventoryForms() {
    const replenish=$('replenishForm'), transfer=$('transferForm'); if(!replenish||!transfer||replenish.dataset.v15==='1')return;
    replenish.dataset.v15='1';transfer.dataset.v15='1';
    replenish.innerHTML = `<p class="eyebrow">SUPPLY</p><h3>Replenish</h3><div class="batch-entry"><label>Ingredient<select id="replenishIngredient"></select></label><label>Quantity<input id="replenishQty" type="number" min="0.000001" step="any" placeholder="Qty" /></label><button id="replenishAddItem" class="ghost batch-add" type="button">+ Add Item</button></div><div id="replenishBatch" class="batch-list"></div><div class="batch-footer"><span id="replenishBatchCount" class="tiny muted">No items added</span><button id="replenishClearBatch" class="text-button" type="button">Clear List</button></div><label>Delivered By<input id="deliveredBy" maxlength="150" required placeholder="Who will deliver? e.g. Marlou" /></label><label>Remarks<textarea id="replenishRemarks" rows="2" maxlength="500" required placeholder="Product was delivered by Marlou, phone: 09XXXXXXXXX"></textarea></label><button class="primary" type="submit">Replenish Selected Items</button>`;
    transfer.innerHTML = `<p class="eyebrow">BRANCH MOVEMENT</p><h3>Transfer</h3><div class="batch-entry"><label>Ingredient<select id="transferIngredient"></select></label><label>Quantity<input id="transferQty" type="number" min="0.000001" step="any" placeholder="Qty" /></label><button id="transferAddItem" class="ghost batch-add" type="button">+ Add Item</button></div><div id="transferBatch" class="batch-list"></div><div class="batch-footer"><span id="transferBatchCount" class="tiny muted">No items added</span><button id="transferClearBatch" class="text-button" type="button">Clear List</button></div><label>Transfer To<input id="transferBranch" maxlength="150" required placeholder="Branch / destination" /></label><label>Received By<input id="receivedBy" maxlength="150" required placeholder="Who will receive? e.g. Marlou" /></label><label>Remarks<textarea id="transferRemarks" rows="2" maxlength="500" required placeholder="Product will be delivered by 2 PM by Marlou"></textarea></label><button class="primary" type="submit">Transfer Selected Items</button>`;
    document.querySelector('.nav[data-view="inventory"]')?.addEventListener('click',()=>setTimeout(()=>{ preserveValuesAfterRefresh(); },20));
    preserveSelect('replenish'); preserveSelect('transfer');
    $(formIds('replenish').add).onclick=()=>addBatchItem('replenish');
    $(formIds('transfer').add).onclick=()=>addBatchItem('transfer');
    $(formIds('replenish').clear).onclick=()=>clearBatch('replenish');
    $(formIds('transfer').clear).onclick=()=>clearBatch('transfer');
    renderBatch('replenish');renderBatch('transfer');

    replenish.addEventListener('submit',e=>submitMovement(e,'replenish'),true);
    transfer.addEventListener('submit',e=>submitMovement(e,'transfer'),true);
    if(document.querySelector('.view.active')?.id==='view-inventory') setTimeout(()=>document.querySelector('.nav[data-view="inventory"]')?.click(),0);
  }
  function preserveValuesAfterRefresh(){
    for(const kind of ['replenish','transfer']){
      const select=$(formIds(kind).select),wanted=selected[kind];
      if(select&&wanted&&[...select.options].some(o=>o.value===wanted))select.value=wanted;
    }
  }
  async function submitMovement(e,kind) {
    e.preventDefault(); e.stopImmediatePropagation();
    const form=e.currentTarget, ids=formIds(kind);
    if(!form.reportValidity())return;
    if(!batches[kind].length && Number($(ids.qty)?.value)>0)addBatchItem(kind,true);
    if(!batches[kind].length){toast(`Add at least one ingredient to the ${kind} list.`);return;}
    const controls=[...form.querySelectorAll('button,input,select,textarea')], prior=controls.map(x=>x.disabled);controls.forEach(x=>x.disabled=true);
    try {
      const items=batches[kind].map(x=>({ingredientId:x.ingredientId,qty:x.qty}));
      if(kind==='replenish'){
        await api('/api/inventory/replenish',{method:'POST',body:{items,deliveredBy:$('deliveredBy').value.trim(),remarks:$('replenishRemarks').value.trim()}});
        toast(`${items.length} ingredient(s) replenished successfully.`);clearBatch(kind);$('deliveredBy').value='';$('replenishRemarks').value='';
      } else {
        await api('/api/inventory/transfer',{method:'POST',body:{items,branch:$('transferBranch').value.trim(),receivedBy:$('receivedBy').value.trim(),remarks:$('transferRemarks').value.trim()}});
        toast(`${items.length} ingredient(s) transferred successfully.`);clearBatch(kind);$('transferBranch').value='';$('receivedBy').value='';$('transferRemarks').value='';
      }
      setTimeout(()=>document.querySelector('.nav[data-view="inventory"]')?.click(),0);
    } catch(err) { toast(err.message); }
    finally { controls.forEach((x,i)=>x.disabled=prior[i]); }
  }

  function init() {
    ensureWhatsNew(); ensureLogFilters(); replaceInventoryForms(); loadVersion();
    const appObserver = new MutationObserver(()=>{ensureWhatsNew();ensureLogFilters();if(!$('replenishForm')?.dataset.v15)replaceInventoryForms();});
    appObserver.observe(document.body,{childList:true,subtree:true});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(init,0));else setTimeout(init,0);
})();
