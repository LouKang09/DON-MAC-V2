(() => {
 'use strict';
 // Shared controls retain the underlying page's existing refresh handlers.
 // The owner's supplied clockwise icon is displayed by the CSS mask.
 const $=id=>document.getElementById(id);
 const portal=$('platformApp')?'admin':$('officeApp')?'office':'pos';
 const MATCH=/refresh|reload/i;
 function iconize(button){
  if(!button||button.dataset.dmRefreshReady==='1')return button;
  button.dataset.dmRefreshReady='1';
  button.classList.add('dm-refresh');
  button.title='Refresh';button.setAttribute('aria-label','Refresh');
  button.setAttribute('data-tooltip','Refresh');
  button.replaceChildren();
  return button;
 }
 function makeRefresh(action){
  const button=document.createElement('button');
  button.type='button';
  iconize(button);
  button.addEventListener('click',()=>{
   if(button.disabled)return;
   try{action();}catch(error){console.error('Refresh failed',error);}
  });
  return button;
 }
 function move(button,selector){
  const heading=document.querySelector(selector);
  if(!button||!heading||heading.contains(button))return;
  heading.classList.add('dm-refresh-heading');
  heading.appendChild(button);
 }
 function repositionBilling(){
  const refresh=$('tenantBillingReload'),heading=document.querySelector('#tenantBilling .tenant-billing-history-head');
  if(!refresh||!heading)return;
  let row=heading.parentElement;
  if(!row.classList.contains('dm-billing-refresh-heading')){
   row=document.createElement('div');
   row.className='dm-refresh-heading dm-billing-refresh-heading';
   heading.parentNode.insertBefore(row,heading);
   row.appendChild(heading);
  }
  if(!row.contains(refresh))row.appendChild(refresh);
  iconize(refresh);
 }
 const currentView=card=>card.closest('.view')?.id?.replace(/^view-/,'')||'';
 function posRefresh(view){
  const id=({dashboard:'dashboardRefresh',reports:'loadReport',transactions:'financeTransactionRefresh',
   expenses:'financeExpenseRefresh',supply:'supplyRefresh',account:'tenantBillingReload',
   logs:'refreshLogs',chat:'chatRefresh'})[view];
  if(id&&$(id)){ $(id).click();return; }
  const nav=document.querySelector('#mainNav .nav[data-view="'+view+'"]');
  if(nav){nav.click();return;}
  console.warn('Refresh unavailable for view:',view);
 }
 function panelAction(panel){
  if(portal==='pos'){const view=currentView(panel);return ()=>posRefresh(view);}
  if(portal==='office'){
   const page=panel.closest('.office-page')?.id;
   if(page==='page-billing')return ()=>$('tenantBillingReload')?.click();
   return ()=>$('officeRefresh')?.click();
  }
  if(panel.closest('#platformBilling'))return ()=>window.donmacPlatformAdmin?.refreshBilling?.();
  return ()=>window.donmacPlatformAdmin?.refreshAccounts?.();
 }
 function findHeading(panel,table){
  const adjacent=table.closest('.table-wrap, .table-scroll, .tenant-billing-scroll')?.previousElementSibling;
  if(adjacent?.matches('.section-header,.card-head,.panel-head'))return adjacent;
  const queries=[':scope > .card-head',':scope > .panel-head',':scope > .section-header',
   ':scope > .inv-toolbar',':scope > .supply-head',':scope > .chat-people-heading'];
  for(const q of queries){const head=panel.querySelector(q);if(head)return head;}
  return null;
 }
 function addForTable(table){
  if(table.closest('dialog, .overlay, .drawer, .hidden-print'))return;
  let panel=portal==='office'?table.closest('.office-page .panel, .office-page #tenantBilling'):
    portal==='admin'?table.closest('.main-card'):
    table.closest('.view .card, .view .panel');
  if(!panel)return;
  // One refresh per table container; reuse existing controls and event listeners.
  if(panel.querySelector(':scope > .dm-refresh-toolbar, :scope > .dm-refresh-heading > .dm-refresh'))return;
  if(panel.querySelector('button.dm-refresh'))return;
  const action=panelAction(panel),button=makeRefresh(action);
  button.dataset.dmTableRefresh='1';
  let head=findHeading(panel,table);
  if(head){head.classList.add('dm-refresh-heading');head.appendChild(button);}
  else {
   const bar=document.createElement('div');bar.className='dm-refresh-toolbar';
   bar.appendChild(button);
   const scroll=table.closest('.table-wrap, .table-scroll, .tenant-billing-scroll')||table;
   // The table can be inside multiple wrappers; insert before the direct
   // child container rather than calling insertBefore on an unrelated node.
   let anchor=scroll;
   while(anchor.parentElement&&anchor.parentElement!==panel)anchor=anchor.parentElement;
   if(anchor.parentElement===panel)panel.insertBefore(bar,anchor);
   else panel.appendChild(bar);
  }
 }
 function iconizeExisting(){
  const buttons=document.querySelectorAll('button');
  for(const button of buttons){
   if(button.classList.contains('dm-refresh'))continue;
   const id=button.id||'',text=(button.textContent||'').trim();
   if(MATCH.test(id)||/^refresh\b/i.test(text))iconize(button);
  }
 }
 function mainPosSetup(){
  // Main POS does not use a header refresh. The update-required action
  // appears inside the POS product area instead of the topbar.
  move($('posSyncRefresh'),'#view-pos .catalog-tools');
  move($('supplyRefresh'),'#view-supply .supply-history .card-head');
  move($('refreshMovements'),'#view-inventory .inv-audit-card .card-head');
  repositionBilling();
 }
 function officeSetup(){
  move($('officeRefresh'),'#page-requests .panel-head');
  repositionBilling();
 }
 function adminSetup(){
  const account=document.querySelector('#ownersBody')?.closest('.main-card');
  const header=account?.querySelector(':scope > .section-header');
  if($('refreshAccounts')&&header&&!header.contains($('refreshAccounts'))){
   header.classList.add('dm-refresh-heading');
   header.appendChild($('refreshAccounts'));
  }
 }
 function scan(){
  if(portal==='pos')mainPosSetup();
  else if(portal==='office')officeSetup();
  else adminSetup();
  iconizeExisting();
  let target=portal==='pos'?'#app .view table':portal==='office'?'#officeApp .office-page table':'#platformApp .main-card table';
  document.querySelectorAll(target).forEach(addForTable);
 }
 let pending=false;
 function schedule(){
  if(pending)return;
  pending=true;
  queueMicrotask(()=>{pending=false;scan();});
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',schedule,{once:true});
 else schedule();
 // Tables and secondary toolbars are rendered lazily after opening pages.
 const observer=new MutationObserver(schedule);
 observer.observe(document.body,{childList:true,subtree:true});
 window.donmacRefreshControls={refresh:scan};
})();