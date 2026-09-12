// Coffee POS v1.5.5 — version history + reliable system-log PDF export.
// Loaded only after the authenticated POS and previous safe enhancement layers.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

  const CURRENT_NOTES = [
    'What’s New now includes an expandable version history so users can follow the POS development progress.',
    'System Log audit records can now be saved directly as PDF without requiring a physical printer.',
    'Print remains available separately for users with a configured printer.',
    'Background synchronization remains at 1 minute 30 seconds while manual Refresh buttons fetch immediately.'
  ];

  const HISTORY = [
    {v:'1.5.5', current:true, title:'Version history & PDF audit export', items:CURRENT_NOTES},
    {v:'1.5.4', title:'Smarter refresh & selective audit actions', items:[
      'Reduced passive screen polling from 5 seconds to 90 seconds.',
      'Kept immediate PostgreSQL writes and manual Refresh actions.',
      'Limited System Log View actions to audit-sensitive categories.'
    ]},
    {v:'1.5.3', title:'Workspace & audit usability', items:[
      'Fixed the left navigation pane while only the right workspace scrolls.',
      'Added Inventory Audit filters, search, contained scrolling and sticky headers.',
      'Made Costing Report ingredient usage scrollable for long lists.',
      'Added detailed System Log audit viewing and printing.'
    ]},
    {v:'1.5.2', title:'Safe browser feature recovery', items:[
      'Reintroduced v1.5 features only after authentication.',
      'Removed broad document observers that had caused browser freezes.',
      'Kept login and core POS available even if an enhancement fails.'
    ]},
    {v:'1.5.0', title:'Operations workflow upgrade', items:[
      'Added System Log filters and search.',
      'Added What’s New update notifications.',
      'Added multi-item Replenish and Transfer batches.',
      'Added required delivery/receiving remarks and safer inventory form behavior.'
    ]},
    {v:'1.4.2', title:'Live data reliability', items:[
      'Fixed PostgreSQL date filtering used by Reports.',
      'Improved cross-terminal refresh for Dashboard, Reports, Logs and Inventory.',
      'Added cache bypass for live GET requests.'
    ]},
    {v:'1.4.1', title:'Cloud deployment hardening', items:[
      'Prepared the POS for Railway deployment and PostgreSQL.',
      'Added cloud-safe binding, health checks and deployment validation.',
      'Improved startup behavior for hosted environments.'
    ]},
    {v:'1.4.0', title:'Product availability intelligence', items:[
      'Added hover explanations for unavailable and low-stock products.',
      'Required new products to have a valid recipe before they can be sold.',
      'Extended availability protection to package components.'
    ]},
    {v:'1.3.0', title:'Transaction Audit viewer', items:[
      'Replaced the normal Audit Trail Delete action with View.',
      'Added detailed sale, cashier, payment, item, stock movement and deletion information.',
      'Kept destructive recovery actions out of the normal reporting workflow.'
    ]},
    {v:'1.2.0', title:'Checkout & responsive stability', items:[
      'Fixed transaction state not clearing after payment.',
      'Fixed Catalog Admin overflow and responsive layouts.',
      'Strengthened checkout, stock restoration, validation and async state handling.'
    ]},
    {v:'1.1.0', title:'Windows startup & transaction safety', items:[
      'Resolved local port conflicts and improved Windows startup.',
      'Added safer payment retry / duplicate checkout protection.',
      'Improved database health and launcher reliability.'
    ]},
    {v:'1.0.0', title:'Initial Excel-to-Web POS migration', items:[
      'Migrated the Excel/VBA POS into a browser-based application.',
      'Introduced web authentication, catalog, POS checkout, inventory, reports, audit logs and database persistence.',
      'Added SQLite for local use and PostgreSQL support for hosted operation.'
    ]}
  ];

  function updateWhatsNew() {
    const list = $('whatsNewList');
    if (list) list.innerHTML = CURRENT_NOTES.map(x => `<li>${esc(x)}</li>`).join('');
    const version = $('whatsNewVersion');
    if (version) version.textContent = 'v1.5.5';
    const upcoming = document.querySelector('.upcoming-copy');
    if (upcoming) upcoming.textContent = 'Upcoming: multi-branch inventory, branch-specific dashboards, branch permissions, and controlled branch-to-branch transfer receiving.';

    const dialogCard = $('whatsNewDialog')?.querySelector('.whats-new-card');
    if (!dialogCard || $('versionHistorySection')) return;
    const section = document.createElement('section');
    section.id = 'versionHistorySection';
    section.className = 'version-history-section';
    section.innerHTML = `<h3>Version History</h3><p class="version-history-intro">Track how the Coffee POS has progressed from the original web migration to the current production build.</p><div class="version-history">${HISTORY.map((r,i)=>`<details class="version-entry ${r.current?'current':''}" ${i===0?'open':''}><summary><span class="version-meta"><span class="version-chip">v${esc(r.v)}</span><span>${esc(r.title)}</span></span></summary><ul>${r.items.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></details>`).join('')}</div>`;
    const upcomingSection = dialogCard.querySelector('.update-section.upcoming');
    if (upcomingSection) upcomingSection.insertAdjacentElement('beforebegin', section);
    else dialogCard.querySelector('#whatsNewGotIt')?.insertAdjacentElement('beforebegin', section);
  }

  function ascii(v) {
    return String(v ?? '').normalize('NFKD').replace(/[^\x20-\x7E]/g, '?');
  }
  function pdfEsc(v) { return ascii(v).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)'); }
  function wrap(text, width=82) {
    const out=[];
    for (const raw of String(text ?? '').split(/\r?\n/)) {
      if (!raw) { out.push(''); continue; }
      let line='';
      for (const word of ascii(raw).split(/\s+/)) {
        if (!line) line=word;
        else if ((line+' '+word).length<=width) line+=' '+word;
        else { out.push(line); line=word; }
      }
      if (line) out.push(line);
    }
    return out;
  }
  function fmtDate(v) {
    if (!v) return '—';
    const d=new Date(v);
    if (Number.isNaN(d.getTime())) return String(v).replace('T',' ');
    return new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',year:'numeric',month:'short',day:'2-digit',hour:'numeric',minute:'2-digit',second:'2-digit'}).format(d);
  }
  function categoryFromText(log) {
    const ui=globalThis.CoffeePosUiUtils;
    return ui?.classifyLogEntry ? ui.classifyLogEntry(log) : 'other';
  }
  function categoryLabel(c) { return ({sales:'Sales',reports:'Reports',inventory:'Inventory',catalog:'Catalog / Setup',users:'Users / Access',database:'Database / Backup',other:'Other'})[c] || 'Other'; }
  function refFrom(log) { return `${log?.activity||''} ${log?.remark||''}`.match(/\bREF[#A-Z0-9_-]*[-A-Z0-9#_]+\b/i)?.[0] || '—'; }

  function makeAuditPdf(log) {
    const lines=[];
    const add=(text,bold=false)=>lines.push({text,bold});
    const cat=categoryLabel(categoryFromText(log));
    add('DON MACCHIATOS WEB POS',true);
    add('SYSTEM LOG AUDIT',true);
    add('');
    add(`Log ID: ${log.id ?? '—'}`);
    add(`Category: ${cat}`);
    add(`Status: ${log.status || 'LOG'}`);
    add(`User / Actor: ${log.actor || '—'}`);
    add(`Date & Time: ${fmtDate(log.createdAt)}`);
    add(`Reference: ${refFrom(log)}`);
    add(`Remark: ${log.remark || '—'}`);
    add('');
    add('ACTIVITY / DETAILS',true);
    for (const line of wrap(log.activity || 'No activity details.',82)) add(line);
    add('');
    add(`Generated: ${fmtDate(new Date().toISOString())}`);

    const pageWidth=595.28,pageHeight=841.89,marginX=38,top=800,bottom=42,fontSize=9,leading=13;
    const perPage=Math.floor((top-bottom)/leading);
    const pages=[];
    for(let i=0;i<lines.length;i+=perPage)pages.push(lines.slice(i,i+perPage));
    if(!pages.length)pages.push([{text:'No data.',bold:false}]);
    const objects=[];const addObj=o=>{objects.push(o);return objects.length;};
    const regular=addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>');
    const bold=addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >>');
    const pagesTree=addObj('PAGES_PLACEHOLDER');
    const pageRefs=[];
    for(const pageLines of pages){
      let y=top,stream='BT\n';
      for(const line of pageLines){
        stream+=`/${line.bold?'F2':'F1'} ${fontSize} Tf\n1 0 0 1 ${marginX} ${y.toFixed(2)} Tm\n(${pdfEsc(line.text)}) Tj\n`;
        y-=leading;
      }
      stream+='ET\n';
      const content=addObj(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`);
      const page=addObj(`<< /Type /Page /Parent ${pagesTree} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> >> /Contents ${content} 0 R >>`);
      pageRefs.push(`${page} 0 R`);
    }
    objects[pagesTree-1]=`<< /Type /Pages /Count ${pageRefs.length} /Kids [${pageRefs.join(' ')}] >>`;
    const catalog=addObj(`<< /Type /Catalog /Pages ${pagesTree} 0 R >>`);
    const info=addObj(`<< /Title (${pdfEsc(`System Log ${log.id}`)}) /Producer (Coffee POS Web) >>`);
    let out='%PDF-1.4\n';const offsets=[0];
    for(let i=0;i<objects.length;i++){offsets.push(out.length);out+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
    const xref=out.length;out+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
    for(let i=1;i<=objects.length;i++)out+=`${String(offsets[i]).padStart(10,'0')} 00000 n \n`;
    out+=`trailer\n<< /Size ${objects.length+1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return new Blob([out],{type:'application/pdf'});
  }

  async function fetchViewedLog() {
    const id=Number(String($('systemLogTitle')?.textContent||'').match(/\d+/)?.[0]||0);
    if(!id)throw new Error('Unable to identify this System Log record.');
    const r=await fetch('/api/system-logs?limit=1000',{cache:'no-store'});
    if(!r.ok)throw new Error(`Unable to load System Log (${r.status}).`);
    const d=await r.json();
    const log=(d.logs||[]).find(x=>Number(x.id)===id);
    if(!log)throw new Error('This System Log record is no longer available in the current audit window.');
    return log;
  }

  function notify(message) {
    const t=$('toast');if(!t)return;t.textContent=message;t.classList.add('show');clearTimeout(notify._t);notify._t=setTimeout(()=>t.classList.remove('show'),3500);
  }

  async function savePdf() {
    try {
      const log=await fetchViewedLog();
      const blob=makeAuditPdf(log);const url=URL.createObjectURL(blob);const a=document.createElement('a');
      a.href=url;a.download=`System-Log-${String(log.id).padStart(5,'0')}.pdf`;document.body.appendChild(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1500);notify('System Log PDF saved.');
    } catch(err) { notify(err.message); }
  }

  async function printViewedLog() {
    // Open synchronously so Brave/Chrome does not block the print window after awaiting data.
    const w=window.open('','_blank','width=900,height=700');
    if(!w){notify('Print window was blocked. Allow pop-ups for this POS or use Save PDF instead.');return;}
    w.document.write('<p style="font-family:Arial;padding:24px">Preparing audit record…</p>');
    try {
      const log=await fetchViewedLog();const cat=categoryLabel(categoryFromText(log));
      w.document.open();
      w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>System Log ${esc(log.id)}</title><style>body{font-family:Arial,sans-serif;color:#17231e;margin:36px}h1{margin:0 0 4px;font-size:24px}.sub{color:#66716b;margin:0 0 24px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 22px}.item{border-bottom:1px solid #ddd;padding:8px 0}.item span{display:block;color:#777;font-size:11px;text-transform:uppercase}.item b{display:block;margin-top:4px}.wide{grid-column:1/-1}pre{white-space:pre-wrap;border:1px solid #ddd;background:#fafafa;padding:16px;border-radius:8px;font:14px/1.5 Arial,sans-serif}@media print{body{margin:18mm}.no-print{display:none}}</style></head><body><h1>System Log Audit</h1><p class="sub">Don Macchiatos Web POS</p><div class="grid"><div class="item"><span>Log ID</span><b>${esc(log.id)}</b></div><div class="item"><span>Category</span><b>${esc(cat)}</b></div><div class="item"><span>Status</span><b>${esc(log.status||'LOG')}</b></div><div class="item"><span>User / Actor</span><b>${esc(log.actor||'—')}</b></div><div class="item"><span>Date & Time</span><b>${esc(fmtDate(log.createdAt))}</b></div><div class="item"><span>Reference</span><b>${esc(refFrom(log))}</b></div><div class="item wide"><span>Remark</span><b>${esc(log.remark||'—')}</b></div></div><h3>Activity / Details</h3><pre>${esc(log.activity||'')}</pre><p class="no-print">Choose your physical printer in the browser print dialog. If you only need a file, close this window and use <b>Save PDF</b> in the POS.</p><script>window.addEventListener('load',()=>setTimeout(()=>window.print(),250));<\/script></body></html>`);
      w.document.close();
    } catch(err) { w.close();notify(err.message); }
  }

  function enhanceLogDialog() {
    const dialog=$('systemLogDialog');const print=$('systemLogPrint');const done=$('systemLogDone');
    if(!dialog||!print||!done||$('systemLogSavePdf'))return;
    const group=document.createElement('div');group.className='log-export-actions';
    const save=document.createElement('button');save.id='systemLogSavePdf';save.type='button';save.className='primary';save.textContent='Save PDF';
    save.onclick=savePdf;print.onclick=printViewedLog;print.textContent='Print';
    const actions=done.parentElement;actions.insertBefore(group,done);group.append(save,print);
  }

  function init() {
    if(document.documentElement.dataset.v155Init==='1')return;
    document.documentElement.dataset.v155Init='1';
    updateWhatsNew();enhanceLogDialog();
    document.querySelector('.nav[data-view="logs"]')?.addEventListener('click',()=>setTimeout(enhanceLogDialog,80));
    console.info('Coffee POS v1.5.5 history/PDF enhancements initialized.');
  }
  init();
})();
