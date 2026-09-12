// Coffee POS v1.5.4 small UX tuning layer.
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const notes=[
    'Background auto-refresh is now every 1 minute 30 seconds instead of every 5 seconds.',
    'Manual Refresh buttons still fetch immediately, and saving sales/inventory changes still writes to PostgreSQL immediately.',
    'System Log View is now reserved for Inventory, Catalog/Setup, Users/Access, and Database/Backup audit entries.',
    'Sales details remain in Reports → Audit Trail, where the full transaction viewer is more complete.'
  ];

  function tuneLogHelp(){
    const help=$('logCategoryHelp');
    if(help){
      help.innerHTML='<b>Other</b> = general or legacy system activity that does not clearly belong to a named category. <b>View</b> is shown only for Inventory, Catalog/Setup, Users/Access, and Database/Backup because those entries benefit from deeper audit review. Sales are reviewed in Reports → Audit Trail.';
    }
    if(!$('logAuditScopeNote')){
      const toolbar=document.querySelector('.logs-toolbar');
      if(toolbar){
        const note=document.createElement('div');
        note.id='logAuditScopeNote';
        note.className='log-audit-scope-note';
        note.innerHTML='<b>Audit View:</b> available for Inventory, Catalog/Setup, Users/Access, and Database/Backup. Sales use the full Reports → Audit Trail viewer.';
        (help||toolbar).insertAdjacentElement('afterend',note);
      }
    }
  }

  function updateReleaseNotice(){
    const list=$('whatsNewList');
    if(list) list.innerHTML=notes.map(x=>`<li>${String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}</li>`).join('');
  }

  function init(){
    tuneLogHelp();
    updateReleaseNotice();
    document.querySelector('.nav[data-view="logs"]')?.addEventListener('click',()=>setTimeout(tuneLogHelp,60));
    console.info('Coffee POS v1.5.4 tuning initialized.');
  }
  init();
})();
