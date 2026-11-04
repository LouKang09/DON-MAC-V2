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
 const UNIVERSAL=[
  ['standout-insights','Business Insights Assistant'],
  ['standout-custom','Customizable Dashboard']
 ];
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
 let orderState={},hiddenState={};
 const configKey=()=>('donmac_v1570_widgets_'+(subscription?.plan==='BUSINESS'?'business':'pro'));
 const features=()=>subscription?.plan==='BUSINESS'?[...PRO,...BUSINESS,...UNIVERSAL]:[...PRO,...UNIVERSAL];
 function getSettings(){
   try{const raw=JSON.parse(localStorage.getItem(configKey())||'{}');orderState=raw.order||{};hiddenState=raw.hidden||{};}
   catch(_){orderState={};hiddenState={};}
 }
 function saveSettings(){
   try{localStorage.setItem(configKey(),JSON.stringify({order:orderState,hidden:hiddenState}));}catch(_){}
 }
 const ordered=()=>{
   const entries=features();const ids=entries.map(x=>x[0]);
   const order=Array.isArray(orderState.ids)?orderState.ids.filter(id=>ids.includes(id)):[];
   return [...order,...ids.filter(id=>!order.includes(id))].map(id=>entries.find(x=>x[0]===id));
 };
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
     return rows(items.slice(0,8),x=>line(x.name,x.branch,number(x.qty)+' units'))+
       note('Top recorded menu-item quantities by branch in the last 30 days.');
   }
   if(id==='biz-cash-variance')return empty(b?.cashVariance?.reason||'No counted-cash data has been recorded.')+
      note('Expected POS cash alone cannot establish a variance; a cashier cash-count feature is required.');
   if(id==='biz-transaction-monitor')return two(
      metric('Voided orders',number(b?.reviewSignals?.voided),'Last 30 days'),
      metric('Discounted orders',number(b?.reviewSignals?.discounted),'Last 30 days'))+
      note('Review signals only. They are not proof of fraud or wrongdoing, and no automatic accusation is made.');
   if(id==='biz-stock-transfers')return rows((b?.transfers||[]).slice(0,6),x=>line(x.reference||'Transfer',x.branch||'Destination not recorded',
      number(x.items)+' ingredient lines'))+
      note('Saved transfer movements only. Delivery and receipt status are not yet tracked.');
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
   if(id==='standout-custom')return '<div class="pw-custom-hint"><strong>Choose the dashboard you need.</strong><span>Use Customize Widgets above to hide or reorder cards. Preferences are local to this browser.</span></div>';
   return empty('No data available.');
 }
 const badge=(id)=>id==='biz-cash-variance'||id==='biz-branch-health'?'NEEDS CONFIGURATION':'LIVE DATA';
 function cardHTML(item,p,b){
   const [id,title]=item;
   return '<article class="pw-card" data-pw-card="'+esc(id)+'"><div class="pw-card-title"><h4>'+esc(title)+
    '</h4><span class="pw-badge'+(badge(id)==='NEEDS CONFIGURATION'?' planned':'')+'">'+badge(id)+'</span></div>'+
    '<div class="pw-card-body">'+renderCardBody(id,p,b)+'</div></article>';
 }
 function renderCustom(){
   const el=$('planWidgetCustomizer');el.classList.toggle('hidden',!customizing);
   if(!customizing)return;
   const entries=ordered();
   el.innerHTML='<div class="pw-custom-head"><strong>Customize Dashboard</strong><span>Show, hide, or change display order</span></div>'+
    '<div class="pw-custom-grid">'+entries.map((entry,i)=>
      '<div class="pw-custom-row"><label><input type="checkbox" data-pw-visibility="'+esc(entry[0])+'" '+
      (hiddenState[entry[0]]?'':'checked')+(entry[0]==='standout-custom'?' disabled':'')+'/>'+
      '<span>'+esc(entry[1])+'</span></label>'+
      '<div><button type="button" data-pw-move="'+esc(entry[0])+'" data-direction="-1" '+(i===0?'disabled':'')+' aria-label="Move '+esc(entry[1])+' up">↑</button>'+
      '<button type="button" data-pw-move="'+esc(entry[0])+'" data-direction="1" '+(i===entries.length-1?'disabled':'')+' aria-label="Move '+esc(entry[1])+' down">↓</button></div></div>').join('')+'</div>';
 }
 function redraw(){
   const data=analytics,plan=subscription?.plan;
   root.hidden=!roleAllowed||!subscription||!data;
   if(root.hidden)return;
   $('planWidgetHeading').textContent=(plan==='BUSINESS'?'Business':'Pro')+' Dashboard Insights';
   $('planWidgetDescription').textContent=plan==='BUSINESS'
     ?'Pro analytics plus the selected Business concepts, calculated from recorded POS data where supported.'
     :'Your selected Pro analytics, calculated from recorded POS data where supported.';
   const selected=ordered().filter(([id])=>!hiddenState[id]);
   const p=data.pro||{},b=plan==='BUSINESS'?data.business:null;
   $('planWidgetCards').innerHTML=selected.map(item=>cardHTML(item,p,b)).join('');
   const warn=$('planWidgetError');
   warn.classList.toggle('hidden',!data.partial);
   if(data.partial)warn.textContent='High transaction volume: this analysis was capped to recent records. Verify detailed reports for a complete period.';
   renderCustom();
 }
 function updateReference(){
   const container=$('advancedReferenceContent'),frame=$('advancedReferenceFrame');
   if(!container||!frame)return;
   const business=subscription?.plan==='BUSINESS';
   frame.classList.toggle('is-locked',!business);
   $('advancedReferenceLock').hidden=business;
   $('advancedReferencePlan').textContent=business?'Business · Full preview':'Pro · Upgrade to unlock';
   if(window.DonmacReferenceDashboard?.renderInto){
     if(!container.querySelector('[data-rd-root]'))window.DonmacReferenceDashboard.renderInto(container);
   }else container.innerHTML='<p>The design preview is temporarily unavailable.</p>';
   if(business)container.removeAttribute('inert');else container.setAttribute('inert','');
 }
 async function fetchAnalytics(){
   if(!subscription||!roleAllowed)return;
   const token=++seq;
   loading=true;
   root.hidden=false;
   $('planWidgetError').textContent='Loading saved sales insights…';
   $('planWidgetError').classList.remove('hidden');
   try{
     const q=new URLSearchParams();
     if($('dashboardBranch')?.value&&$('dashboardBranch').value!=='all')q.set('branchId',$('dashboardBranch').value);
     const r=await fetch('/api/dashboard/plan-insights?'+q.toString(),{credentials:'same-origin',cache:'no-store'});
     if(!r.ok){if(r.status===403)roleAllowed=false;throw Error('Analytics unavailable ('+r.status+').');}
     const d=await r.json();
     if(token!==seq)return;
     analytics=d;loading=false;
     if(d.plan!==subscription.plan){subscription={...subscription,plan:d.plan};getSettings();}
     redraw();
   }catch(e){
     if(token!==seq)return;loading=false;root.hidden=!roleAllowed;
     $('planWidgetCards').innerHTML='';
     $('planWidgetError').classList.remove('hidden');
     $('planWidgetError').textContent=e.message||'Unable to load analytics.';
   }
 }
 function setSubscription(next){
   if(!next)return;
   const changed=!subscription||subscription.plan!==next.plan;
   subscription=next;
   if(changed)getSettings();
   updateReference();
   if(changed&&$('view-dashboard')?.classList.contains('active'))fetchAnalytics();
   else if(analytics)redraw();
 }
 function render(d){
   if(!d||!subscription)return;
   if(!loading)fetchAnalytics();
 }
 function onViewChange(view){
   if(view==='advanced')updateReference();
   if(view==='dashboard'&&subscription&&!loading&&!analytics)fetchAnalytics();
 }
 $('planWidgetCustomize').addEventListener('click',()=>{
   customizing=!customizing;renderCustom();
   $('planWidgetCustomize').textContent=customizing?'Done Customizing':'Customize Widgets';
 });
 $('planWidgetCustomizer').addEventListener('change',event=>{
   const box=event.target.closest('input[data-pw-visibility]');if(!box)return;
   hiddenState[box.dataset.pwVisibility]=!box.checked;saveSettings();redraw();
 });
 $('planWidgetCustomizer').addEventListener('click',event=>{
   const button=event.target.closest('button[data-pw-move]');if(!button||button.disabled)return;
   const entries=ordered().map(x=>x[0]);
   const current=entries.indexOf(button.dataset.pwMove),next=current+Number(button.dataset.direction);
   if(current<0||next<0||next>=entries.length)return;
   [entries[current],entries[next]]=[entries[next],entries[current]];
   orderState.ids=entries;saveSettings();redraw();
 });
 $('advancedReferenceUpgrade')?.addEventListener('click',()=>{
   const nav=document.querySelector('.nav[data-view="account"]');
   if(nav){nav.click();const sel=$('accountPlanSelect');if(sel){sel.value='BUSINESS';sel.focus();}}
 });
 window.donmacPlanWidgets={setSubscription,render,onViewChange};
 fetch('/api/account/subscription',{credentials:'same-origin',cache:'no-store'})
   .then(r=>r.ok?r.json():null).then(setSubscription).catch(()=>{});
})();
