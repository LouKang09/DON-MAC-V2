/* Supply Office animation bridge (2026-11-26).
 * Reuses the existing DonMac useAnimations JSON/Lottie player.
 * Does NOT replace controls, event listeners or navigational destinations.
 * SVG fallbacks remain visible if an animation bundle is unavailable.
 */
(()=>{
 'use strict';
 if(window.donmacSupplyIconBridge)return;
 const root=document.getElementById('officeApp');
 if(!root)return;
 const icons={
  dashboard:'grid',requests:'clipboard',distribution:'clock',franchisees:'users',
  promotions:'notification',warehouse:'package',catalog:'clipboard',logs:'fileText',
  billing:'dollarSign',settings:'settings',security:'lock'
 };
 // These paths exist only as safe native fallback until Lottie mounts.
 const vector={
  refresh:'<path d="M20 7v5h-5M4 17v-5h5M5 10a8 8 0 0 1 13-4l2 6M4 14a8 8 0 0 0 13 4l-2-6"/>',
  menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
  logOut:'<path d="M10 4H5v16h5M13 8l4 4-4 4M8 12h9"/>',
  save:'<path d="M5 3h13l3 3v15H3V3h2M7 3v7h10V3M7 21v-8h10v8"/>',
  checkCircle:'<circle cx="12" cy="12" r="9"/><path d="m7 12 3 3 7-7"/>',
  plusCircle:'<circle cx="12" cy="12" r="9"/><path d="M12 7v10M7 12h10"/>',
  download:'<path d="M12 3v12m-4-4 4 4 4-4M4 17v4h16v-4"/>',
  edit:'<path d="m4 20 5-1 11-11-4-4L5 15l-1 5Z"/>',
  trash2:'<path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3"/>',
  searchToX:'<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 6 6M4 20h4"/>',
  settings:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M19 5l-2 2M7 17l-2 2"/>',
  clipboard:'<rect x="4" y="5" width="16" height="17" rx="2"/><path d="M9 3h6v4H9zM8 12h8M8 16h6"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  chevronRight:'<path d="m9 5 7 7-7 7"/>'
 };
 const svgMarkup=name=>'<svg class="dm-ua-native" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(vector[name]||vector.info)+'</svg>';
 const mark=(element,name,existing)=>{
  if(!element||!name||element.dataset.dmUaMounted==='ready')return false;
  if(element.dataset.dmIcon&&element.dataset.dmIcon!==name)return false;
  if(element.dataset.dmIcon===name&&element.querySelector(':scope > .dm-ua-native,:scope > .dm-ua-icon'))return false;
  const native=existing||element.querySelector(':scope > svg');
  element.dataset.dmIcon=name;
  if(native){
   native.classList.add('dm-ua-native');
   return true;
  }
  // Do not add duplicates on repeated mutations or remounts.
  if(element.querySelector(':scope > .dm-ua-native,:scope > .dm-ua-icon'))return false;
  element.insertAdjacentHTML('afterbegin',svgMarkup(name));
  return true;
 };
 const explicit=[
  ['officeSidebarToggle','menu'],['officeMobileToggle','menu'],
  ['officeLogout','logOut'],['officeRefresh','refresh'],
  ['warehouseRefresh','refresh'],['warehouseOperationsRefresh','refresh'],
  ['warehouseApply','checkCircle'],['tenantBillingReload','refresh'],
  ['officeStatusSave','checkCircle'],['officeNewProductSave','save'],
  ['officeCampaignClearIcon','trash2']
 ];
 function choose(button){
  if(button.dataset.dmIcon||button.classList.contains('warehouse-kpi')||
     button.classList.contains('warehouse-op-tab')||
     button.classList.contains('side-link')||
     button.closest('.pagination,.warehouse-ops-tabs,.office-nav'))return null;
  const id=button.id||'',act=button.dataset.act||'';
  const label=(button.textContent||'').replace(/\s+/g,' ').trim();
  const title=button.title||'';
  if(/refresh|reload/i.test(id)||/^refresh\b/i.test(label)||/refresh/i.test(title))return 'refresh';
  if(/reset-staff|remove-line|clear-icon|delete|remove\b/i.test(act)||/^(delete|remove|clear)\b/i.test(label))return 'trash2';
  if(/^(download|export|print\s*\/\s*save)/i.test(label))return 'download';
  if(/^(search|find)/i.test(label))return 'searchToX';
  if(/^(add|create|new)\b/i.test(label)||/^add-/.test(act))return 'plusCircle';
  if(/^(save|update|record|reset password|change password)/i.test(label)||/save-staff-role/.test(act))return 'save';
  if(/^(apply|confirm|receive|approve|submit|send|mark dispatched|mark delivered|finish)/i.test(label)||act==='receive')return 'checkCircle';
  if(/^(edit|set levels|manage)/i.test(label)||act==='reorder')return 'edit';
  if(/^(open|view|details|inspect)/i.test(label))return 'chevronRight';
  return null;
 }
 let pending=false;
 function scan(){
  if(!root.isConnected)return;
  let changed=false;
  root.querySelectorAll('#officeNav [data-office-page]').forEach(btn=>{
   const el=btn.querySelector(':scope > .side-icon'),name=icons[btn.dataset.officePage];
   if(el&&name)changed=mark(el,name,el.querySelector(':scope > svg'))||changed;
  });
  for(const [id,name] of explicit){
   const button=document.getElementById(id);
   if(button&&root.contains(button))
    changed=mark(button,name,button.querySelector(':scope > svg'))||changed;
  }
  // Also cover buttons inserted later by the requests, warehouse, campaigns,
  // catalog, security and billing modules; skip pagination and KPI cards.
  root.querySelectorAll('.office-main button').forEach(button=>{
   const name=choose(button);
   if(name)changed=mark(button,name,button.querySelector(':scope > svg'))||changed;
  });
  if(changed)window.donmacAnimatedIcons?.refresh?.();
 }
 function queue(){
  if(pending)return;
  pending=true;
  requestAnimationFrame(()=>{pending=false;scan()});
 }
 const observer=new MutationObserver(records=>{
  if(records.some(r=>[...r.addedNodes].some(n=>
   n.nodeType===1&&(n.matches?.('button,.side-icon,svg,[data-office-page],.warehouse-ops-body')||
    n.querySelector?.('button,.side-icon')))))queue();
 });
 const start=()=>{
  scan();
  observer.observe(root,{childList:true,subtree:true});
  window.donmacAnimatedIcons?.refresh?.();
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
 else start();
 window.donmacSupplyIconBridge={refresh:queue};
})();
