/* v1.5.73 — branch-aware dashboard presentation and icon-only refresh controls.
 * Runs after the existing dashboard filter enhancement; does not replace chart/report logic. */
(()=>{
 'use strict';
 const $=id=>document.getElementById(id);
 const board=$('view-dashboard'),select=$('dashboardBranch');
 if(!board||!select||window.donmacDashboardExperience)return;
 const summary=$('dashboardSummary');
 const scope=document.createElement('div');
 scope.id='dashboardScope';scope.className='dashboard-account-filter hidden';
 const timeline=document.createElement('div');timeline.className='dm-dashboard-timeline';
 const timelineLabel=$('trendView')?.closest('label');
 if(timelineLabel)timeline.appendChild(timelineLabel);
 for(const id of ['trendFromWrap','trendToWrap']){const field=$(id);if(field)timeline.appendChild(field);}
 scope.appendChild(timeline);
 const branchGroup=document.createElement('div');branchGroup.className='dm-dashboard-branch-group';
 const label=document.createElement('label');label.htmlFor='dashboardBranch';label.textContent='Select Branch';
 branchGroup.appendChild(label);
 const wrap=$('dashboardBranchWrap');branchGroup.appendChild(wrap);scope.appendChild(branchGroup);
 board.insertBefore(scope,summary);
 const heading=$('planWidgetHeading')?.closest('.plan-widget-heading');
 if(heading)heading.classList.add('pending-account-analytics');
 const list=$('planWidgetFeatureCards');
 if(list){
   const watcher=new MutationObserver(()=>{
     // Eliminate the flash of the default Pro heading before the actual account plan resolves.
     if(list.querySelector('[data-pw-card]'))heading?.classList.remove('pending-account-analytics');
   });
   watcher.observe(list,{childList:true});
 }
 const tooltip='Use Customize Widgets to hide or reorder cards. Changes are saved per franchise account across devices.';
 const custom=$('planWidgetCustomize');
 if(custom){custom.setAttribute('title',tooltip);custom.setAttribute('aria-label','Customize account dashboard widgets');}
 const inventoryNote=$('dashboardInventoryCount');
 if(inventoryNote){inventoryNote.setAttribute('title','Inventory quantities are maintained as shared company-wide stock, not separate branch balances.');}
 let lastBranch='',reconcileScheduled=false;
 function reconcile(){
   reconcileScheduled=false;
   const choices=[...select.options].filter(o=>o.value&&o.value!=='all');
   // Keep All as a first-class filter. Backend totals are scoped to this franchise.
   let all=select.querySelector('option[value="all"]');
   if(!all){
     all=document.createElement('option');
     all.value='all';
     select.insertBefore(all,select.firstChild);
   }
   if(all.textContent!=='All')all.textContent='All';
   const available=[...select.options].some(o=>o.value===select.value);
   if(!available)select.value='all';
   const admin=!wrap.classList.contains('hidden');
   branchGroup.hidden=!admin||!choices.length;
   scope.classList.remove('hidden');
   if(choices.length&&lastBranch!==select.value){
     lastBranch=select.value;
     if(board.classList.contains('active'))$('applyTrend')?.click();
   }
 }
 function scheduleReconcile(){if(reconcileScheduled)return;reconcileScheduled=true;queueMicrotask(reconcile);}
 const observer=new MutationObserver(scheduleReconcile);
 observer.observe(select,{childList:true,subtree:true});
 observer.observe(wrap,{attributes:true,attributeFilter:['class']});
 // Branch switch controls the dashboard, not the active POS checkout branch.
 select.onchange=()=>{$('applyTrend')?.click();};
 let dateTimer;
 for(const id of ['trendFrom','trendTo'])$(id)?.addEventListener('change',()=>{
   clearTimeout(dateTimer);
   dateTimer=setTimeout(()=>{
     const from=$('trendFrom'),to=$('trendTo');
     if($('trendView').value==='custom'&&from.value&&to.value&&from.value<=to.value&&from.checkValidity()&&to.checkValidity())$('applyTrend')?.click();
   },150);
 });
 scheduleReconcile();
 // The performance chart was explicitly removed. Retain its saved product
 // quantities and the existing legend beneath the heading.
 const radar=$('dashboardRadar');
 if(radar){radar.replaceChildren();radar.setAttribute('aria-hidden','true');}
 // Existing refresh actions and IDs are retained so listeners still work.
 const refreshSvg='<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.4 9A7.5 7.5 0 0 1 18.8 7L20 12M4 12l1.2 5a7.5 7.5 0 0 0 13.4-2"/></svg>';
 function iconize(button){
   if(button.dataset.refreshIconized)return;
   button.dataset.refreshIconized='true';
   const existing=button.getAttribute('aria-label')||button.getAttribute('title')||button.textContent.trim()||'Refresh';
   button.title=existing;
   button.setAttribute('aria-label',existing);
   button.classList.add('unified-refresh-circle');
   // Keep the SVG available for the shared useAnimations renderer.
   if(!button.querySelector(':scope > .dm-ua-icon')){
     button.innerHTML=refreshSvg.replace('<svg ','<svg class="dm-ua-native" ');
   }
   button.dataset.dmIcon='refresh';
   window.donmacIconControls?.refresh?.();
 }
 function updateRefresh(){
   document.querySelectorAll('button[id]').forEach(btn=>{
     const id=btn.id;
     if(/refresh/i.test(id)||(/^refresh\b/i.test(btn.textContent.trim())))iconize(btn);
   });
 }
 updateRefresh();
 window.donmacDashboardExperience={refresh:updateRefresh,reconcile:scheduleReconcile};
})();
