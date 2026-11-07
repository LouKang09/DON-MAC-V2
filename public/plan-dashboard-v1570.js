/* Don Mac v1.5.70 — tier-specific dashboard widgets.
   Live figures are read-only from /api/dashboard/plan-insights.
   Reference Design is separately and conspicuously SAMPLE DATA. */
(()=>{
 'use strict';
 const $=id=>document.getElementById(id);
 const root=$('planDashboardWidgets');
 if(!root||window.donmacPlanWidgets)return;
 const PRO=[
  ['pro-bought-together','Frequently Bought Together'],
  ['pro-addon-conversion','Add-on Conversion Rate'],
  ['pro-sales-growth','Sales Growth Comparison'],
  ['pro-opportunity-hours','Sales Opportunity Hours'],
  ['pro-product-pairings','Product Pairing Recommendations'],
  ['pro-daily-insights','Daily Business Insights']
 ];
 const BUSINESS=[
  ['biz-branch-health','Branch Health Score'],
  ['biz-same-store','Same-Store Sales Growth'],
  ['biz-product-comparison','Branch Product Comparison'],
  ['biz-cash-variance','Cash Drawer Variance'],
  ['biz-transaction-monitor','Suspicious Transaction Monitor'],
  ['biz-stock-transfers','Inter-Branch Stock Transfers']
 ];
 const UNIVERSAL=[['standout-insights','Business Insights Assistant']];
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const php=v=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP',maximumFractionDigits:0}).format(Number(v)||0);
 const number=v=>new Intl.NumberFormat('en-PH',{maximumFractionDigits:0}).format(Number(v)||0);
 const percent=v=>v==null?'No comparison':(v>0?'+':'')+v.toFixed(1)+'%';
 const line=(label,value,detail='')=>'<div class="pw-line"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong>'+(detail?'<small>'+esc(detail)+'</small>':'')+'</div>';
 const note=(text)=>'<p class="pw-note">'+esc(text)+'</p>';
 const empty=(text)=>'<p class="pw-empty">'+esc(text)+'</p>';
 const two=(a,b)=>'<div class="pw-pair-metrics">'+a+b+'</div>';
 const metric=(label,value,sub='')=>'<div class="pw-metric"><small>'+esc(label)+'</small><strong>'+esc(value)+'</strong>'+(sub?'<span>'+esc(sub)+'</span>':'')+'</div>';
 const rows=(list,cb)=>list.length?'<div class="pw-lines">'+list.map(cb).join('')+'</div>':empty('No recorded transactions available for this calculation.');
 let subscription=null,analytics=null,loading=false,seq=0,customizing=false,roleAllowed=true;
 let orderState={},hiddenState={},prefsLoaded=false,prefsSeq=0,saveQueue=Promise.resolve();
 const features=()=>subscription?.plan==='BUSINESS'?[...PRO,...BUSINESS,...UNIVERSAL]:[...PRO,...UNIVERSAL];
 const ordered=()=>{
  const entries=features(),ids=entries.map(x=>x[0]);
  const order=Array.isArray(orderState.ids)?orderState.ids.filter(id=>ids.includes(id)):[];
  return [...order,...ids.filter(id=>!order.includes(id))].map(id=>entries.find(x=>x[0]===id));
 };
 async function loadSettings(plan){
  const token=++prefsSeq;prefsLoaded=false;orderState={ids:[]};hiddenState={};
  try{
   const resp=await fetch('/api/dashboard/widgets?plan='+encodeURIComponent(plan),
    {credentials:'same-origin',cache:'no-store'});
   if(!resp.ok)throw Error('Unable to load account widget settings (HTTP '+resp.status+').');
   const saved=await resp.json();
   if(token!==prefsSeq||subscription?.plan!==plan)return;
   orderState.ids=Array.isArray(saved.order)?saved.order:[];
   hiddenState=Object.fromEntries((saved.hidden||[]).map(id=>[id,true]));
  }catch(e){
   if(token===prefsSeq){
    const warn=$('planWidgetError');warn.textContent=e.message;warn.classList.remove('hidden');
   }
  }finally{
   if(token===prefsSeq){
    prefsLoaded=true;
    if($('view-dashboard')?.classList.contains('active'))fetchAnalytics();
   }
  }
 }
 function saveSettings(){
  if(!prefsLoaded||!subscription)return;
  const plan=subscription.plan;
  const values={order:ordered().map(x=>x[0]),hidden:Object.keys(hiddenState).filter(x=>hiddenState[x])};
  const status=$('planWidgetSaveState');
  if(status)status.textContent='Saving changes to your account…';
  saveQueue=saveQueue.catch(()=>{}).then(async()=>{
    const resp=await fetch('/api/dashboard/widgets?plan='+encodeURIComponent(plan),{
      method:'PUT',credentials:'same-origin',cache:'no-store',
      headers:{'Content-Type':'application/json'},body:JSON.stringify(values)
    });
    if(!resp.ok){const failure=await resp.json().catch(()=>({}));throw Error(failure.error||'Could not save widgets.');}
    if(subscription?.plan===plan){const current=$('planWidgetSaveState');if(current)current.textContent='Saved to your franchise account.';}
  }).catch(e=>{
    if(subscription?.plan===plan){const current=$('planWidgetSaveState');if(current)current.textContent='Not saved: '+e.message;}
    const warn=$('planWidgetError');warn.textContent='Widget preferences not saved: '+e.message;warn.classList.remove('hidden');
  });
 }
 function transferTable(list){
  if(!list.length)return empty('No inter-branch transfers recorded for this location.');
  return '<div class="pw-transfer-scroll"><table class="pw-transfer-table"><thead>'+
   '<tr><th>Description</th><th>Location</th><th>Date &amp; Time</th><th>Details</th></tr></thead><tbody>'+
   list.map((x,i)=>{
    const when=x.dateTime?new Date(x.dateTime).toLocaleString('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}):'—';
    const lines=(x.lines||[]).map(y=>'<tr><td>'+esc(y.description||'Ingredient')+'</td><td>'+
     esc(number(y.quantity))+' '+esc(y.uom||'')+'</td></tr>').join('');
    return '<tr><td>'+esc(x.description||x.reference||'Stock transfer')+'</td><td>'+esc(x.location||'Unknown')+'</td>'+
     '<td>'+esc(when)+'</td><td><button type="button" data-transfer-view="'+i+'" aria-expanded="false">View</button></td></tr>'+
     '<tr data-transfer-detail="'+i+'" hidden><td colspan="4"><div class="pw-transfer-detail"><strong>'+esc(x.reference||'Transfer')+'</strong>'+
     '<p>Received by: '+esc(x.receivedBy||'Not provided')+'</p><table><thead><tr><th>Ingredient</th><th>Quantity</th></tr></thead>'+
     '<tbody>'+lines+'</tbody></table>'+(x.remarks?'<p>Remarks: '+esc(x.remarks)+'</p>':'')+'</div></td></tr>';
   }).join('')+'</tbody></table></div>';
 }
 function renderCardBody(id,p,b){
   if(id==='pro-bought-together')return rows(p.pairs||[],x=>line(x.items.join(' + '),number(x.orders)+' orders'))+
     note('Products counted together in completed orders during the last 30 days.');
   if(id==='pro-addon-conversion')return two(metric('Order conversion',p.addonRate==null?'—':percent(p.addonRate),
      number(p.addOnOrders)+' with add-ons'),
     metric('Add-on line sales',php(p.addOnSales),number(p.ordersAnalyzed)+' baskets analyzed'))+
     note('Uses add-on flags saved on transaction line items.');
   if(id==='pro-sales-growth')return two(metric('Past 7 days',php(p.salesWindow?.current),percent(p.salesWindow?.growthPercent)+' vs prior 7 days'),
      metric('Previous 7 days',php(p.salesWindow?.previous),'Completed sales only'))+
      note(p.salesWindow?.growthPercent==null?'No percentage when prior-week revenue is zero.':'Both windows include the same number of days.');
   if(id==='pro-opportunity-hours'){
     const active=(p.hours||[]).filter(x=>x.orders>0);
     if(!active.length)return empty('No orders between 9 AM and 6 PM in the last 30 days.');
     const low=[...p.hours].sort((x,y)=>x.orders-y.orders).slice(0,3);
     const highest=[...p.hours].sort((x,y)=>y.orders-x.orders)[0];
     return rows(low,x=>line((x.hour%12||12)+(x.hour<12?' AM':' PM'),number(x.orders)+' orders'))+
      note('Lowest-traffic observed hours; highest: '+(highest.hour%12||12)+(highest.hour<12?' AM':' PM')+' ('+highest.orders+' orders).');
   }
   if(id==='pro-product-pairings')return rows((p.pairs||[]).slice(0,4),x=>line(x.items.join(' + '),'Pairing idea',number(x.orders)+' recorded baskets'))+
      note('Suggested based only on co-purchase patterns; no automatic pricing or product changes.');
   if(id==='pro-daily-insights'){
     const current=p.today||{},diff=Number(current.actual||0)-Number(current.previousActual||0);
     return two(metric('Today',php(current.actual),number(current.orders)+' orders'),metric('Yesterday',php(current.previousActual),number(current.previousOrders)+' orders'))+
       '<p class="pw-insight">Sales '+(diff>0?'increased':diff<0?'decreased':'were unchanged')+
       ' by '+esc(php(Math.abs(diff)))+' compared with yesterday.</p>';
   }
   if(id==='biz-branch-health'){
     return empty('A formal health score requires a defined scoring formula and branch-level stock metrics.')+
       rows((b?.branches||[]).slice(0,5),x=>line(x.name,number(x.orders)+' orders',php(x.current)+' over 30 days'))+
       note('These are real branch sales indicators, not a calculated health score.');
   }
   if(id==='biz-same-store'){
     const eligible=(b?.branches||[]).filter(x=>x.comparable);
     return rows(eligible,x=>line(x.name,php(x.current),percent(x.growthPercent)+' vs previous 30 days'))+
       note('Only branches operating before both 30-day windows are eligible. No growth percentage without a prior baseline.');
   }
   if(id==='biz-product-comparison'){
     const items=b?.products||[];
     return rows(items.slice(0,5),x=>line(x.name,x.branch,number(x.qty)+' units'))+
       note('Top recorded menu-item quantities by branch in the last 30 days.');
   }
   if(id==='biz-cash-variance')return empty(b?.cashVariance?.reason||'No counted-cash data has been recorded.')+
      note('Expected POS cash alone cannot establish a variance; a cashier cash-count feature is required.');
   if(id==='biz-transaction-monitor')return two(
      metric('Voided orders',number(b?.reviewSignals?.voided),'Last 30 days'),
      metric('Discounted orders',number(b?.reviewSignals?.discounted),'Last 30 days'))+
      note('Review signals only. They are not proof of fraud or wrongdoing, and no automatic accusation is made.');
   if(id==='biz-stock-transfers')return transferTable((b?.transfers||[]).slice(0,5))+
      note('View opens the ingredient breakdown recorded for the selected transfer.');
   if(id==='standout-insights'){
      const delta=p.salesWindow?.growthPercent;
      const change=delta==null?'A prior-week baseline is not yet available.':
       delta>0?'Past-week revenue rose '+percent(delta)+' from the previous week.':
       delta<0?'Past-week revenue fell '+percent(delta)+' from the previous week.':
       'Past-week revenue matched the prior week.';
      const add=p.addonRate==null?'Add-on conversion is unavailable until completed baskets are recorded.':
       'Add-ons appeared in '+percent(p.addonRate)+' of recorded baskets.';
      return '<p class="pw-insight">'+esc(change)+'</p><p class="pw-insight">'+esc(add)+'</p>'+
        note('Automated rules-based summary of saved POS figures, not a generative AI analysis.');
   }
   return empty('No data available.');
 }
 const badge=(id)=>id==='biz-cash-variance'||id==='biz-branch-health'?'NEEDS CONFIGURATION':'LIVE DATA';
 function cardHTML(item,p,b){
  const [id,title]=item;
  return '<article class="pw-card" data-pw-card="'+esc(id)+'"><div class="pw-card-title"><h4>'+esc(title)+
   '</h4></div><div class="pw-card-body">'+renderCardBody(id,p,b)+'</div></article>';
 }
 function renderCustom(){
   const el=$('planWidgetCustomizer');el.classList.toggle('hidden',!customizing);
   if(!customizing)return;
   const entries=ordered();
   el.innerHTML='<div class="pw-custom-head"><strong>Customize Dashboard</strong>'+
    '<span>Drag a widget by its grip to reorder · changes save automatically</span></div>'+
    '<p id="planWidgetSaveState" class="pw-save-state" role="status">Changes save automatically to your franchise account.</p>'+
    '<div class="pw-custom-grid" role="list" aria-label="Reorder Dashboard widgets">'+entries.map(entry=>
      '<div class="pw-custom-row" draggable="true" data-pw-sort-row="'+esc(entry[0])+'" role="listitem">'+
      '<span class="pw-drag-grip" data-pw-drag-handle="'+esc(entry[0])+'" tabindex="0" role="button" '+
        'aria-label="Drag '+esc(entry[1])+' to reorder; or press Alt plus arrow keys" title="Drag to change order">⠿</span>'+
      '<label><input type="checkbox" data-pw-visibility="'+esc(entry[0])+'" '+
      (hiddenState[entry[0]]?'':'checked')+'/>'+
      '<span>'+esc(entry[1])+'</span></label></div>').join('')+'</div>';
 }
 function reorderWidget(source,target,after=false){
   if(!source||!target||source===target)return;
   const ids=ordered().map(x=>x[0]);
   const from=ids.indexOf(source),to=ids.indexOf(target);
   if(from<0||to<0)return;
   ids.splice(from,1);
   const targetIndex=ids.indexOf(target)+(after?1:0);
   ids.splice(targetIndex,0,source);
   orderState.ids=ids;saveSettings();redraw();
 }
 let draggingWidget=null,touchDrag=null;
 const widgetCustomizer=$('planWidgetCustomizer');
 function clearDragIndicators(){
   widgetCustomizer.querySelectorAll('.pw-custom-row').forEach(x=>x.classList.remove('pw-drop-before','pw-drop-after','pw-dragging'));
 }
 function dragDestination(event){
   const row=event.target.closest?.('[data-pw-sort-row]');
   if(!row||!draggingWidget||row.dataset.pwSortRow===draggingWidget)return null;
   const bounds=row.getBoundingClientRect();
   return{row,after:event.clientY>bounds.top+bounds.height/2};
 }
 widgetCustomizer.addEventListener('dragstart',event=>{
   const row=event.target.closest?.('[data-pw-sort-row]');
   if(!row)return;
   draggingWidget=row.dataset.pwSortRow;
   event.dataTransfer?.setData('text/plain',draggingWidget);
   if(event.dataTransfer)event.dataTransfer.effectAllowed='move';
   row.classList.add('pw-dragging');
 });
 widgetCustomizer.addEventListener('dragover',event=>{
   const target=dragDestination(event);
   if(!target)return;
   event.preventDefault();
   if(event.dataTransfer)event.dataTransfer.dropEffect='move';
   clearDragIndicators();
   target.row.classList.add(target.after?'pw-drop-after':'pw-drop-before');
 });
 widgetCustomizer.addEventListener('drop',event=>{
   const target=dragDestination(event);
   if(target){
     event.preventDefault();
     reorderWidget(draggingWidget,target.row.dataset.pwSortRow,target.after);
   }
   draggingWidget=null;clearDragIndicators();
 });
 widgetCustomizer.addEventListener('dragend',()=>{draggingWidget=null;clearDragIndicators()});
 // Touchscreens do not reliably support native HTML drag/drop. Use a grip-only pointer fallback.
 widgetCustomizer.addEventListener('pointerdown',event=>{
   if(event.pointerType==='mouse'||!customizing)return;
   const grip=event.target.closest?.('[data-pw-drag-handle]');
   if(!grip)return;
   touchDrag={source:grip.dataset.pwDragHandle,target:null,after:false};
   grip.setPointerCapture?.(event.pointerId);
 });
 widgetCustomizer.addEventListener('pointermove',event=>{
   if(!touchDrag||!customizing)return;
   const row=document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-pw-sort-row]');
   clearDragIndicators();
   if(!row||row.dataset.pwSortRow===touchDrag.source)return;
   const bounds=row.getBoundingClientRect();
   touchDrag.target=row.dataset.pwSortRow;
   touchDrag.after=event.clientY>bounds.top+bounds.height/2;
   row.classList.add(touchDrag.after?'pw-drop-after':'pw-drop-before');
   event.preventDefault();
 });
 widgetCustomizer.addEventListener('pointerup',()=>{
   if(!touchDrag)return;
   const item=touchDrag;touchDrag=null;clearDragIndicators();
   if(item.target)reorderWidget(item.source,item.target,item.after);
 });
 widgetCustomizer.addEventListener('pointercancel',()=>{touchDrag=null;clearDragIndicators()});
 widgetCustomizer.addEventListener('keydown',event=>{
   const handle=event.target.closest?.('[data-pw-drag-handle]');
   if(!handle||!event.altKey||!['ArrowUp','ArrowDown'].includes(event.key))return;
   event.preventDefault();
   const ids=ordered().map(x=>x[0]),pos=ids.indexOf(handle.dataset.pwDragHandle);
   const target=ids[pos+(event.key==='ArrowUp'?-1:1)];
   if(target)reorderWidget(handle.dataset.pwDragHandle,target,event.key==='ArrowDown');
   widgetCustomizer.querySelector('[data-pw-drag-handle="'+handle.dataset.pwDragHandle+'"]')?.focus();
 });

 function redraw(){
  const data=analytics,plan=subscription?.plan;
  root.hidden=false;
  const holder=$('planWidgetFeatureCards');
  if(!roleAllowed||!subscription||!data){holder.replaceChildren();return;}
  $('planWidgetHeading').textContent=(plan==='BUSINESS'?'Business':'Pro')+' Dashboard Insights';
  const selected=ordered().filter(([id])=>!hiddenState[id]);
  holder.innerHTML=selected.map(item=>cardHTML(item,data.pro||{},plan==='BUSINESS'?data.business:null)).join('');
  const warning=$('planWidgetError');
  warning.classList.toggle('hidden',!data.partial);
  if(data.partial)warning.textContent='High volume analysis cap reached; detailed reports contain the full history.';
  $('planWidgetHeading')?.closest('.plan-widget-heading')?.classList.remove('pending-account-analytics');
  renderCustom();
 }
 function updateReference(){
   // Advanced uses its own scoped, server-backed renderer. Sample gallery stays independent.
   window.donmacAdvancedAnalytics?.setSubscription(subscription);
 }
 async function fetchAnalytics(){
   if(!subscription||!roleAllowed||!prefsLoaded)return;
   const token=++seq;
   loading=true;
   root.hidden=false;
   // Do not flash a temporary loading callout before Business/Pro insights.
   // Preserve the last complete cards until new data is ready.
   $('planWidgetError').classList.add('hidden');
   try{
     const q=new URLSearchParams();
     if($('dashboardBranch')?.value&&$('dashboardBranch').value!=='all')q.set('branchId',$('dashboardBranch').value);
     const r=await fetch('/api/dashboard/plan-insights?'+q.toString(),{credentials:'same-origin',cache:'no-store'});
     if(!r.ok){if(r.status===403)roleAllowed=false;throw Error('Analytics unavailable ('+r.status+').');}
     const d=await r.json();
     if(token!==seq)return;
     analytics=d;loading=false;
     if(d.plan!==subscription.plan){setSubscription({...subscription,plan:d.plan});return;}
     redraw();
   }catch(e){
     if(token!==seq)return;loading=false;root.hidden=false;
     $('planWidgetFeatureCards').replaceChildren();
     $('planWidgetError').classList.remove('hidden');
     $('planWidgetError').textContent=e.message||'Unable to load analytics.';
   }
 }
 function setSubscription(next){
   if(!next)return;
   const changed=!subscription||subscription.plan!==next.plan;
   subscription=next;updateReference();
   if(changed){
     analytics=null;
     $('planWidgetHeading')?.closest('.plan-widget-heading')?.classList.add('pending-account-analytics');
     $('planWidgetFeatureCards')?.replaceChildren();
     loadSettings(next.plan);
   }else if(analytics)redraw();
 }
 function render(data){
   if(!data||!subscription||!prefsLoaded)return;
   if(!loading&&roleAllowed)fetchAnalytics();
 }
 function onViewChange(view){
   if(view==='advanced')updateReference();
   if(view==='dashboard'&&subscription&&prefsLoaded&&!loading&&!analytics)fetchAnalytics();
 }
 $('planWidgetCustomize').addEventListener('click',()=>{
   customizing=!customizing;renderCustom();
   $('planWidgetCustomize').textContent=customizing?'Done Customizing':'Customize Widgets';
 });
 $('planWidgetCustomizer').addEventListener('change',event=>{
   const box=event.target.closest('input[data-pw-visibility]');if(!box)return;
   hiddenState[box.dataset.pwVisibility]=!box.checked;saveSettings();redraw();
 });
 $('planWidgetFeatureCards').addEventListener('click',event=>{
    const button=event.target.closest('button[data-transfer-view]');
    if(!button)return;
    const card=button.closest('[data-pw-card="biz-stock-transfers"]');
    const details=card?.querySelector('tr[data-transfer-detail="'+button.dataset.transferView+'"]');
    if(!details)return;
    const open=button.getAttribute('aria-expanded')==='true';
    details.hidden=open;button.setAttribute('aria-expanded',String(!open));
    button.textContent=open?'View':'Hide';
 });
 $('advancedReferenceUpgrade')?.addEventListener('click',()=>{
   const nav=document.querySelector('.nav[data-view="account"]');
   if(nav){nav.click();const sel=$('accountPlanSelect');if(sel){sel.value='BUSINESS';sel.focus();}}
 });
 window.donmacPlanWidgets={setSubscription,render,onViewChange};
 fetch('/api/account/subscription',{credentials:'same-origin',cache:'no-store'})
   .then(r=>r.ok?r.json():null).then(setSubscription).catch(()=>{});
})();
