/* DonMac icon coverage: reuse the installed MIT-licensed useAnimations assets.
 * Preserve each button's text, listener, disabled state and navigation target. */
(() => {
 'use strict';
 if(window.donmacIconControls)return;
 const fallbacks={
  refresh:'<path d="M20 7v5h-5M4 17v-5h5M5 10a8 8 0 0 1 13-4l2 6M4 14a8 8 0 0 0 13 4l-2-6"/>',
  save:'<path d="M4 3h14l3 3v15H3zM8 3v6h8V3M8 21v-8h8v8"/>',
  searchToX:'<path d="M4 6h16M9 6V4h6v2M7 6l1 14h8l1-14M10 10v6m4-6v6"/>',
  download:'<path d="M12 3v12m-4-4 4 4 4-4M4 17v4h16v-4"/>',
  checkCircle:'<circle cx="12" cy="12" r="9"/><path d="m7 12 3 3 7-7"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
  chevronRight:'<path d="m9 5 7 7-7 7"/>',
  trash2:'<path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3"/>',
  plusCircle:'<circle cx="12" cy="12" r="9"/><path d="M12 7v10M7 12h10"/>'
 };
 function add(name,element,original){
  if(!element||element.dataset.dmUaMounted||element.dataset.dmIcon&&element.dataset.dmIcon!==name)return false;
  if(element.dataset.dmIcon===name&&element.querySelector(':scope > .dm-ua-native'))return false;
  element.dataset.dmIcon=name;
  const source=original||element.querySelector(':scope > svg,:scope > img.catalog-save-icon,:scope > span.catalog-btn-icon');
  if(source){source.classList.add('dm-ua-native');return true;}
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 24 24');
  svg.setAttribute('width','19');svg.setAttribute('height','19');
  svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');
  svg.setAttribute('stroke-width','2');svg.setAttribute('stroke-linecap','round');
  svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');
  svg.classList.add('dm-ua-native');
  svg.innerHTML=fallbacks[name]||fallbacks.info;
  element.prepend(svg);return true;
 }
 const kpiIcons={
  revenue:'dollarSign',orders:'fileText',today:'barChart',month:'calendar',
  expenses:'dollarSign',deposited:'save',discount:'checkCircle',alerts:'alertTriangle'
 };
 const analyticsIcons={
  dashboard:'grid',financials:'dollarSign',sales:'barChart',
  operations:'package',staff:'users',alerts:'alertTriangle'
 };
 function prepare(){
  let changed=false;
  const mark=(name,element,original)=>{if(add(name,element,original))changed=true;};
  document.querySelectorAll('#dashboardSummary .dash-summary-icon').forEach(el=>{
   const card=el.closest('.dm-kpi-button');
   mark(card?.hasAttribute('data-business-store')?'package':
    kpiIcons[card?.dataset.dmKpi]||'grid',el,el.querySelector(':scope > svg'));
  });
  document.querySelectorAll('#dashboardSummary .dm-kpi-arrow').forEach(el=>
   mark('chevronRight',el,el.querySelector(':scope > svg')));
  // Animated back arrows face left, in the original button, across KPI and Store Performance.
  document.querySelectorAll('#dmKpiBack,#dmBusinessStoreDetail .dm-bs-back,#dmBusinessStoreDetail [data-bs-history-back]').forEach(btn=>{
   btn.classList.add('dm-animated-back');
   mark('chevronRight',btn,btn.querySelector(':scope > svg'));
  });
  // Keep Replenish/Transfer symbols in their exact original card/button positions.
  [['replenish','plusCircle'],['transfer','refresh']].forEach(([type,name])=>{
   const card=document.querySelector('#view-inventory .inv-operation-'+type);
   const top=card?.querySelector('.inv-operation-top');
   mark(name,top,top?.querySelector(':scope > svg'));
   const launcher=card?.querySelector('.inv-operation-launch');
   mark(name,launcher,launcher?.querySelector(':scope > span'));
  });
  document.querySelectorAll('#advancedReferenceContent button[data-aa-section] .rd-nav-glyph').forEach(el=>{
   const section=el.closest('[data-aa-section]')?.dataset.aaSection;
   mark(analyticsIcons[section]||'grid',el,el.querySelector(':scope > svg'));
  });
  // Respect every existing refresh handler; only the icon node is swapped.
  document.querySelectorAll('#app button,#officeApp button,#platformApp button').forEach(btn=>{
   const label=btn.textContent?.trim()||'';
   const title=btn.getAttribute('title')||'';
   if(/refresh|reload/i.test(btn.id||'')||btn.hasAttribute('data-aa-refresh')||
      /^refresh\b/i.test(label)||/^refresh\b/i.test(title))
    mark('refresh',btn,btn.querySelector(':scope > svg'));
  });
  document.querySelectorAll('#view-reports .report-download,#historicalExportDownload,#view-catalog .catalog-download-button').forEach(btn=>
   mark('download',btn,btn.querySelector(':scope > svg')));
  const order=document.getElementById('supplyPlaceOrder');
  mark('checkCircle',order,order?.querySelector(':scope > svg'));
  document.querySelectorAll('#view-catalog button').forEach(btn=>{
   const label=btn.textContent?.trim()||'';
   const img=btn.querySelector(':scope > img.catalog-save-icon');
   const clear=btn.querySelector(':scope > span.catalog-btn-icon');
   const isSave=!!img||/^save\b/i.test(label);
   const isClear=!!clear||/\bclear\b/i.test(label)||/formclear|categoryclear/i.test(btn.id||'');
   if(isSave||isClear)mark(isSave?'save':'trash2',btn,
    img||clear||btn.querySelector(':scope > svg'));
  });
  document.querySelectorAll('#view-users button.users-action').forEach(btn=>{
   if(btn.classList.contains('users-action-save'))mark('save',btn,btn.querySelector(':scope > svg'));
   else if(btn.classList.contains('users-action-clear'))mark('trash2',btn,btn.querySelector(':scope > svg'));
  });
  if(changed)window.donmacAnimatedIcons?.refresh?.();
 }
 let scheduled=false;
 function queue(){
  if(scheduled)return;
  scheduled=true;
  requestAnimationFrame(()=>{scheduled=false;prepare();});
 }
 const observer=new MutationObserver(changes=>{
  const match='.dm-kpi-button,[data-aa-section],[data-aa-refresh],.report-download,.catalog-save-icon,.catalog-btn-icon,button[id],button.users-action,.inv-operation-top,.inv-operation-launch,[data-bs-history-back]';
  if(changes.some(c=>[...c.addedNodes].some(n=>
    n.nodeType===1&&(n.matches?.(match)||n.querySelector?.(match)))))queue();
 });
 const init=()=>{
  queue();
  observer.observe(document.body,{childList:true,subtree:true});
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
 else init();
 window.donmacIconControls={refresh:queue};
})();