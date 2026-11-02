// Coffee POS v1.5.3 workspace/audit enhancements.
// Runs only after authentication and after the safe v1.5.2 features.
(() => {
  'use strict';
  const UI=globalThis.CoffeePosUiUtils||{};
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  let systemLogs=[],currentViewedLog=null,movementScroll=0;

  const classifyLog=log=>{
    const t=`${log?.status||''} ${log?.activity||''} ${log?.remark||''} ${log?.actor||''}`.toUpperCase();
    if(/\b(REPORT|EMAIL SENT|EMAIL FAILED|SALES PDF|COSTING PDF|DAILY REPORT|WEEKLY REPORT|MONTHLY REPORT|YEARLY REPORT)\b/.test(t))return'reports';
    if(/\b(REPLENISH|REPLENISHED|TRANSFER|TRANSFERRED|STOCK|INVENTORY|SALE_REVERSAL)\b/.test(t))return'inventory';
    if(/\b(DATABASE|BACKUP|RESTORE|RESTORED|DATABASE SAVED)\b/.test(t))return'database';
    if(/\b(USER|ACCOUNT|PASSWORD|LOGIN|LOGGED IN|LOGGED OUT|SIGN IN|SIGNED IN|SIGN OUT|SIGNED OUT|ACCESS)\b/.test(t))return'users';
    if(/\b(PRODUCT|PROMO|PACKAGE|RECIPE|INGREDIENT|SETTINGS|SETUP|CATALOG|MEASUREMENT)\b/.test(t))return'catalog';
    if(/\b(SALE|SALES|SOLD|DELETED|TRANSACTION|PAYMENT|CHECKOUT|ORDER COMPLETED|ORDER PAID|SALE COMPLETED)\b/.test(t))return'sales';
    return'other';
  };
  UI.classifyLogEntry=classifyLog;

  const categoryLabel=c=>({sales:'Sales',reports:'Reports',inventory:'Inventory',catalog:'Catalog / Setup',users:'Users / Access',database:'Database / Backup',other:'Other'})[c]||'Other';
  const formatDateTime=v=>{if(!v)return'—';const d=new Date(v);if(Number.isNaN(d.getTime()))return String(v).replace('T',' ');return new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',year:'numeric',month:'short',day:'2-digit',hour:'numeric',minute:'2-digit',second:'2-digit'}).format(d);};
  const toast=m=>{const e=$('toast');if(!e)return;e.textContent=m;e.classList.add('show');clearTimeout(toast._t);toast._t=setTimeout(()=>e.classList.remove('show'),3500);};
  async function api(url){const r=await fetch(url,{cache:'no-store'});let d={};try{d=await r.json();}catch(_){}if(!r.ok)throw new Error(d.error||`Request failed (${r.status})`);return d;}

  function extractReference(log){return `${log?.activity||''} ${log?.remark||''}`.match(/\bREF[#A-Z0-9_-]*[-A-Z0-9#_]+\b/i)?.[0]||'';}
  function ensureLogHelp(){const tb=document.querySelector('.logs-toolbar');if(!tb||$('logCategoryHelp'))return;const h=document.createElement('div');h.id='logCategoryHelp';h.className='filter-help';h.innerHTML='<b>Other</b> = general or legacy system activity that does not clearly belong to Sales, Reports, Inventory, Catalog/Setup, Users/Access, or Database/Backup.';tb.insertAdjacentElement('afterend',h);}
  function detailInfo(label,value,wide=false){const shown=value===null||value===undefined||value===''?'—':esc(value);return`<div class="transaction-info ${wide?'wide':''}"><span>${esc(label)}</span><strong>${shown}</strong></div>`;}

  function ensureLogDialog(){
    if($('systemLogDialog'))return;
    const d=document.createElement('dialog');d.id='systemLogDialog';d.innerHTML=`<div class="modal-card log-detail-card"><button type="button" class="modal-close" id="systemLogClose">×</button><div class="transaction-title"><div><p class="eyebrow">SYSTEM LOG AUDIT</p><h2 id="systemLogTitle">Log Details</h2></div><span id="systemLogCategory" class="transaction-status sold">Other</span></div><div id="systemLogDetailBody"></div><div class="detail-actions"><button id="systemLogPrint" class="ghost" type="button">Print</button><button id="systemLogDone" class="primary" type="button">Close</button></div></div>`;document.body.appendChild(d);
    $('systemLogClose').onclick=()=>d.close();$('systemLogDone').onclick=()=>d.close();$('systemLogPrint').onclick=()=>currentViewedLog&&printLog(currentViewedLog);d.addEventListener('click',e=>{if(e.target===d)d.close();});
  }
  function viewLog(id){const log=systemLogs.find(x=>Number(x.id)===Number(id));if(!log)return;currentViewedLog=log;ensureLogDialog();const c=classifyLog(log),ref=extractReference(log);$('systemLogTitle').textContent=`Log #${log.id}`;$('systemLogCategory').textContent=categoryLabel(c);$('systemLogDetailBody').innerHTML=`<div class="transaction-info-grid log-info-grid">${detailInfo('Log ID',log.id)}${detailInfo('Category',categoryLabel(c))}${detailInfo('Status',log.status||'LOG')}${detailInfo('User / Actor',log.actor||'')}${detailInfo('Date & Time',formatDateTime(log.createdAt))}${detailInfo('Reference',ref||'')}${detailInfo('Remark',log.remark||'',true)}</div><section class="transaction-section"><div class="transaction-section-title"><h3>Activity / Details</h3></div><pre class="log-detail-activity">${esc(log.activity||'')}</pre></section>`;if(!$('systemLogDialog').open)$('systemLogDialog').showModal();}
  function printLog(log){
    const c=classifyLog(log),ref=extractReference(log)||'—';const w=window.open('','_blank','width=900,height=700');if(!w){toast('Print window was blocked. Allow pop-ups for this POS and try again.');return;}
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>System Log #${esc(log.id)}</title><style>body{font-family:Arial,sans-serif;color:#17231e;margin:36px}h1{margin:0 0 4px;font-size:24px}p.sub{color:#66716b;margin:0 0 24px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 22px;margin-bottom:24px}.item{border-bottom:1px solid #ddd;padding:8px 0}.item span{display:block;color:#777;font-size:11px;text-transform:uppercase;letter-spacing:.08em}.item b{display:block;margin-top:4px;font-size:14px}.wide{grid-column:1/-1}pre{white-space:pre-wrap;border:1px solid #ddd;background:#fafafa;padding:16px;border-radius:8px;font:14px/1.5 Arial,sans-serif}@media print{body{margin:18mm}.no-print{display:none}}</style></head><body><h1>System Log Audit</h1><p class="sub">Don Macchiatos Web POS</p><div class="grid"><div class="item"><span>Log ID</span><b>${esc(log.id)}</b></div><div class="item"><span>Category</span><b>${esc(categoryLabel(c))}</b></div><div class="item"><span>Status</span><b>${esc(log.status||'LOG')}</b></div><div class="item"><span>User / Actor</span><b>${esc(log.actor||'—')}</b></div><div class="item"><span>Date & Time</span><b>${esc(formatDateTime(log.createdAt))}</b></div><div class="item"><span>Reference</span><b>${esc(ref)}</b></div><div class="item wide"><span>Remark</span><b>${esc(log.remark||'—')}</b></div></div><h3>Activity / Details</h3><pre>${esc(log.activity||'')}</pre><p class="no-print"><button onclick="window.print()">Print</button> <button onclick="window.close()">Close</button></p><script>window.addEventListener('load',()=>setTimeout(()=>window.print(),150));<\/script></body></html>`);w.document.close();
  }
  function renderEnhancedLogs(logs){systemLogs=Array.isArray(logs)?logs:[];const list=$('logsList');if(!list)return;list.innerHTML=systemLogs.map(log=>{const c=classifyLog(log);return`<div class="log-row" data-log-id="${Number(log.id)}" data-category="${esc(c)}"><div class="log-meta"><span class="log-category">${esc(categoryLabel(c))}</span><b>${esc(log.status||'LOG')}</b><span>${esc(log.actor||'')}</span><span>${esc(formatDateTime(log.createdAt))}</span>${log.remark?`<span>· ${esc(log.remark)}</span>`:''}<button class="table-btn log-view-button" type="button" data-view-log="${Number(log.id)}">View</button></div><pre>${esc(log.activity||'')}</pre></div>`;}).join('')||'<div class="empty-state">No system logs.</div>';list.querySelectorAll('[data-view-log]').forEach(b=>b.onclick=()=>viewLog(Number(b.dataset.viewLog)));ensureLogHelp();}
  async function loadEnhancedLogs(){try{const d=await api('/api/system-logs?limit=500');renderEnhancedLogs(d.logs||[]);}catch(e){toast(e.message);}}
  function hookSystemLogs(){ensureLogDialog();ensureLogHelp();const r=$('refreshLogs');if(r&&r.dataset.v153!=='1'){r.dataset.v153='1';r.addEventListener('click',()=>setTimeout(loadEnhancedLogs,30));}const n=document.querySelector('.nav[data-view="logs"]');if(n&&n.dataset.v153!=='1'){n.dataset.v153='1';n.addEventListener('click',()=>setTimeout(loadEnhancedLogs,80));}if($('view-logs')?.classList.contains('active'))loadEnhancedLogs();}

  // Inventory Audit now uses the canonical unified toolbar rendered in the page.
  // Do not inject a second search field, count, or row-level filter: those would
  // conflict with transaction grouping, pagination, and expanded ingredient rows.
  function hookInventoryAudit(){
    const body=$('movementBody');
    body?.closest('.table-wrap')?.classList.add('inventory-audit-scroll');
  }

  function hookCostingScroll(){const list=$('costingList');if(list)list.classList.add('costing-scroll-panel');}
  function updateReleaseNotice(){const l=$('whatsNewList');if(l)l.innerHTML=['Left navigation now stays fixed while only the right workspace scrolls.','Inventory Audit now has one movement filter, one search, transaction-based pagination, and contained scrolling.','Costing Report is now contained in its own scrollable panel for long ingredient lists.','System Logs now have a detailed View action and printable per-log audit view.','The Other log category is now reserved for general or legacy activity that does not match a named category.'].map(x=>`<li>${esc(x)}</li>`).join('');const u=document.querySelector('.upcoming-copy');if(u)u.textContent='Planned: branch-aware inventory, branch dashboards, and safer branch-to-branch transfers before multi-store rollout.';}
  function init(){if(document.documentElement.dataset.v153Init==='1')return;document.documentElement.dataset.v153Init='1';hookSystemLogs();hookInventoryAudit();hookCostingScroll();updateReleaseNotice();console.info('Coffee POS v1.5.3 workspace/audit enhancements initialized.');}
  init();
})();
