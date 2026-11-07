/* Business Advanced Analytics — genuine workspace data only. */
(() => {
 'use strict';
 const $=id=>document.getElementById(id);
 const root=$('advancedReferenceContent'),frame=$('advancedReferenceFrame');
 if(!root||!frame||window.donmacAdvancedAnalytics)return;
 const sections=[
  ['dashboard','Dashboard','▦'],['financials','Financials','▤'],
  ['store','Store Performance','▣'],['sales','Sales & Menu','▥'],
  ['customers','Customers','♧'],['operations','Operations','⚒'],
  ['staff','Staff & Labour','♙'],['alerts','Alerts','⚑']
 ];
 const navSvg={"dashboard":"<svg viewBox=\"0 0 24 24\" width=\"21\" height=\"21\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.75\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><rect x=\"3\" y=\"3\" width=\"7.5\" height=\"7.5\" rx=\"1.7\"/><rect x=\"13.5\" y=\"3\" width=\"7.5\" height=\"7.5\" rx=\"1.7\"/><rect x=\"3\" y=\"13.5\" width=\"7.5\" height=\"7.5\" rx=\"1.7\"/><rect x=\"13.5\" y=\"13.5\" width=\"7.5\" height=\"7.5\" rx=\"1.7\"/></svg>","financials":"<svg viewBox=\"0 0 24 24\" width=\"21\" height=\"21\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.75\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M15 9c-1-1.3-5-1.3-5 .7 0 2.2 4.9 1 4.9 3.7 0 2.2-4.1 2.3-5.3.8M12 6v12\"/></svg>","store":"<svg viewBox=\"0 0 24 24\" width=\"21\" height=\"21\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.75\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M3 9 12 4l9 5-9 5-9-5Z\"/><path d=\"M4 13v7h16v-7M9 20v-5h6v5\"/></svg>","sales":"<svg viewBox=\"0 0 24 24\" width=\"21\" height=\"21\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.75\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M3.8 20.5h16.4M6.2 16.5v-5M11.8 16.5v-9M17.4 16.5V4\"/><path d=\"M5.2 16.5h2M10.8 16.5h2M16.4 16.5h2\"/></svg>","customers":"<svg viewBox=\"0 0 24 24\" width=\"21\" height=\"21\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.75\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M17.2 19.5v-1.8a3.6 3.6 0 0 0-3.6-3.6H8a3.6 3.6 0 0 0-3.6 3.6v1.8\"/><circle cx=\"10.8\" cy=\"7.5\" r=\"3.2\"/><path d=\"M20.5 19.5v-1.8a3.6 3.6 0 0 0-2.7-3.5M16.1 4.3a3.1 3.1 0 0 1 0 6\"/></svg>","operations":"<svg viewBox=\"0 0 24 24\" width=\"21\" height=\"21\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.75\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"m12 2.75 9 5.15-9 5.15-9-5.15 9-5.15Z\"/><path d=\"M3 7.9v8.3l9 5.1 9-5.1V7.9M12 13.05v8.25\"/></svg>","staff":"<svg viewBox=\"0 0 24 24\" width=\"21\" height=\"21\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.75\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M17.2 19.5v-1.8a3.6 3.6 0 0 0-3.6-3.6H8a3.6 3.6 0 0 0-3.6 3.6v1.8\"/><circle cx=\"10.8\" cy=\"7.5\" r=\"3.2\"/><path d=\"M20.5 19.5v-1.8a3.6 3.6 0 0 0-2.7-3.5M16.1 4.3a3.1 3.1 0 0 1 0 6\"/></svg>","alerts":"<svg viewBox=\"0 0 24 24\" width=\"21\" height=\"21\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.75\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M12 3 2.5 20.5h19L12 3Z\"/><path d=\"M12 9v5M12 17.2h.01\"/></svg>"};
 const navIcon=key=>navSvg[key]||navSvg.dashboard;
 const tones=['#138a62','#df9955','#3678b5','#8d67b2','#d36c64','#489eab','#a58c40','#637987'];
 const fmt=n=>Number(n||0).toLocaleString('en-PH',{maximumFractionDigits:1});
 const peso=n=>'₱'+Number(n||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const date=x=>{const d=new Date(x);return Number.isNaN(d.getTime())?String(x||'—'):new Intl.DateTimeFormat('en-PH',{dateStyle:'medium',timeZone:'Asia/Manila'}).format(d);};
 let subscription=null,model=null,section='dashboard',branch='all',days='30',busy=false,requestId=0,lastLoad=0,error='';
 const business=()=>subscription?.plan==='BUSINESS'&&subscription?.status==='PAID'&&subscription?.configured;
 const empty=message=>'<div class="aa-empty">'+esc(message)+'</div>';
 const note=message=>'<p class="aa-data-note">'+esc(message)+'</p>';
 const title=(heading,description)=>'<div class="rd-section-title"><div><h3>'+esc(heading)+'</h3><p>'+esc(description)+'</p></div><span class="aa-recorded-label">POS RECORDS</span></div>';
 function sparkline(values,color=tones[0]){
  const nums=values.map(Number),max=Math.max(1,...nums),w=184,h=52;
  const p=nums.map((n,i)=>(4+i*(w-8)/Math.max(1,nums.length-1)).toFixed(1)+','+
    (h-4-n/max*(h-8)).toFixed(1)).join(' ');
  return '<svg class="rd-spark" viewBox="0 0 '+w+' '+h+'" aria-hidden="true"><polyline points="'+p+
    '" fill="none" stroke="'+color+'" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
 }
 function metric(label,value,caption,values,idx=0){
  return '<article class="rd-kpi"><div class="rd-kpi-upper"><span>'+esc(label)+'</span><span aria-hidden="true">⋮</span></div>'+
    '<strong>'+esc(value)+'</strong><div class="aa-kpi-caption">'+esc(caption)+'</div>'+
    sparkline(values||model.months.map(m=>m.net),tones[idx%tones.length])+'</article>';
 }
 const kpis=list=>'<div class="rd-kpi-grid">'+list.map((x,i)=>metric(x[0],x[1],x[2],null,i)).join('')+'</div>';
 const panel=(name,content,extra='')=>'<article class="rd-panel '+extra+'"><div class="rd-panel-title">'+esc(name)+'</div>'+content+'</article>';
 function comparisonChart(rows,series){
  if(!rows.length)return empty('No recorded sales for the selected period.');
  const width=900,height=260,l=67,r=18,t=15,b=40,plotW=width-l-r,plotH=height-t-b;
  const max=Math.max(1,...series.flatMap(s=>rows.map(x=>Number(x[s.key]||0))));
  const y=v=>t+plotH-(Number(v||0)/max)*plotH;
  const xx=i=>l+(rows.length===1?plotW/2:i*plotW/(rows.length-1));
  const grid=[0,.25,.5,.75,1].map(v=>{
   const yy=y(v*max);
   return '<line x1="'+l+'" x2="'+(width-r)+'" y1="'+yy+'" y2="'+yy+'" stroke="#e4e9e6"/>'+
     '<text text-anchor="end" x="'+(l-10)+'" y="'+(yy+4)+'" fill="#829088" font-size="11">'+fmt(v*max)+'</text>';
  }).join('');
  const paths=series.map((s,j)=>{
    const color=tones[j%tones.length],points=rows.map((x,i)=>[xx(i),y(x[s.key]||0),Number(x[s.key]||0)]);
    const d=points.map((p,i)=>(i?'L':'M')+p[0].toFixed(2)+','+p[1].toFixed(2)).join(' ');
    const dots=points.map((p,i)=>'<circle cx="'+p[0]+'" cy="'+p[1]+'" r="4.2" fill="'+color+'" tabindex="0">'+
      '<title>'+esc(rows[i].month||rows[i].day)+' · '+esc(s.name)+': '+peso(p[2])+'</title></circle>').join('');
    return '<path d="'+d+'" stroke="'+color+'" stroke-width="3" fill="none" stroke-linejoin="round" stroke-linecap="round"/>'+dots;
  }).join('');
  const every=Math.max(1,Math.ceil(rows.length/12));
  const labels=rows.map((row,i)=>i%every===0||i===rows.length-1?
   '<text x="'+xx(i)+'" y="'+(height-12)+'" fill="#67766c" font-size="11" text-anchor="middle">'+
    esc(row.month||row.day.slice(5))+'</text>':'').join('');
  return '<div class="aa-chart-scroll"><svg viewBox="0 0 '+width+' '+height+'" role="img" '+
    'aria-label="Recorded sales comparison chart">'+grid+paths+labels+'</svg></div>'+
    '<div class="aa-chart-legend">'+series.map((s,i)=>'<span><i style="background:'+tones[i%tones.length]+'"></i>'+esc(s.name)+'</span>').join('')+'</div>';
 }
 function lines(rows,headings,renderRow){
  if(!rows.length)return empty('No records for this selection.');
  return '<div class="aa-table-scroll"><table class="aa-table"><thead><tr>'+headings.map(h=>'<th>'+esc(h)+'</th>').join('')+
   '</tr></thead><tbody>'+rows.map(renderRow).join('')+'</tbody></table></div>';
 }
 function ranking(rows,labelFn,valueFn,max=8){
  if(!rows.length)return empty('No recorded activity for the selected period.');
  const selected=rows.slice(0,max),highest=Math.max(1,...selected.map(valueFn));
  return '<div class="aa-ranking">'+selected.map((x,i)=>{
   const amount=valueFn(x),percentage=Math.max(0,Math.min(100,amount/highest*100));
   return '<div class="aa-rank-row"><div><strong>'+esc(labelFn(x))+'</strong><span>'+esc(fmt(amount))+'</span></div>'+
     '<div class="aa-progress"><span style="width:'+percentage.toFixed(2)+'%;background:'+tones[i%tones.length]+'"></span></div></div>';
  }).join('')+'</div>';
 }
 const percent=(part,total)=>total?fmt(part/total*100)+'%':'—';
 function donut(rows,field='amount'){
  if(!rows.length)return empty('No payment transactions for this selection.');
  const sum=rows.reduce((n,x)=>n+Number(x[field]||0),0);
  if(!sum)return empty('No revenue recorded.');
  let acc=0;
  const colors=rows.map((x,i)=>{
    const from=acc;acc+=Number(x[field]||0)/sum*100;
    return tones[i%tones.length]+' '+from.toFixed(2)+'% '+acc.toFixed(2)+'%';
  });
  return '<div class="aa-donut-layout"><div class="aa-donut" role="img" aria-label="'+
   esc(rows.map(x=>x.name+' '+percent(x[field],sum)).join(', '))+'" style="background:conic-gradient('+
   colors.join(',')+')"><div><strong>'+peso(sum)+'</strong><span>Net sales</span></div></div>'+
   '<div class="aa-donut-legend">'+rows.map((x,i)=>'<div><i style="background:'+tones[i%tones.length]+'"></i>'+
     '<span>'+esc(x.name)+'</span><strong>'+esc(percent(x[field],sum))+'</strong></div>').join('')+'</div></div>';
 }
 function dashboard(d){
  const s=d.summary;
  return title('Business overview','Completed transactions and recorded expenses for the selected period.')+
   kpis([['Net sales',peso(s.net),fmt(s.orders)+' completed orders'],
    ['Recorded expenses',peso(s.expenses),'Expense ledger entries'],
    ['Operating balance',peso(s.operatingBalance),'Before cost of goods and unrecorded costs'],
    ['Average ticket',peso(s.avgTicket),'Net sales per completed order']])+
   '<div class="rd-section-grid">'+panel('12-month net sales / expenses',comparisonChart(d.months,[{key:'net',name:'Net sales'},{key:'expenses',name:'Recorded expenses'}]))+
    panel('Branch sales ranking',ranking(d.branchesPerformance,x=>x.name,x=>x.net))+'</div>'+
    panel('Recent attention items',alertRows(d.alerts.slice(0,5)))+note(d.sourceNotes.costs);
 }
 function financials(d){
  const s=d.summary;
  return title('Financials','Net sales, discounts, recorded expense categories and payment mix.')+
   kpis([['Gross sales',peso(s.gross),'Before recorded discounts'],
    ['Discount amount',peso(s.discount),'Recorded POS discounts'],
    ['Net sales',peso(s.net),'Completed transactions only'],
    ['Operating balance',peso(s.operatingBalance),'Before COGS and other unrecorded costs']])+
   '<div class="rd-section-grid">'+panel('Recorded expenses by category',
     ranking(d.expenseCategories,x=>x.name[0].toUpperCase()+x.name.slice(1),x=>x.amount))+
     panel('Payment method share',donut(d.paymentMix))+'</div>'+
   panel('Financial trend · 12 months',comparisonChart(d.months,[{key:'net',name:'Net sales'},{key:'expenses',name:'Expenses'}]))+
   note(d.sourceNotes.costs);
 }
 function store(d){
  const branches=d.branchesPerformance,s=d.summary;
  return title('Store performance','Compare actual performance across franchise branches.')+
   kpis([['Branches in view',fmt(branches.length),'Franchise-scoped locations'],
    ['Top branch',branches[0]?.name||'—','By recorded net sales'],
    ['Combined net sales',peso(s.net),'Selected locations'],
    ['Voided / cancelled',fmt(s.voided),'Recorded exceptions']])+
   '<div class="rd-section-grid">'+panel('Branch leaderboard',ranking(branches,x=>x.name,x=>x.net,15))+
   panel('Branch sales and expenses',lines(branches,['Location','Orders','Net sales','Expenses'],x=>
    '<tr><td><strong>'+esc(x.name)+'</strong></td><td>'+fmt(x.orders)+'</td><td>'+peso(x.net)+'</td><td>'+peso(x.expenses)+'</td></tr>'))+'</div>'+
   panel('Historical sales by month',comparisonChart(d.months,[{key:'net',name:'Net sales'}]))+
   note('Branch expenses reflect only entries recorded in the expense ledger. Shared inventory cannot be allocated to individual locations.');
 }
 function sales(d){
  const s=d.summary;
  return title('Sales & Menu','Recorded menu quantities, item line totals and order channels.')+
   kpis([['Completed orders',fmt(s.orders),'Selected period'],
    ['Net sales',peso(s.net),'After POS adjustments'],
    ['Discount amount',peso(s.discount),'All completed discounted orders'],
    ['Items analyzed',fmt(d.topProducts.reduce((n,x)=>n+x.qty,0)),'Top 20 displayed items only']])+
   '<div class="rd-section-grid">'+panel('Top menu items · line subtotals',
    ranking(d.topProducts,x=>x.name,x=>x.amount,12))+
   panel('Order types',donut(d.orderTypes))+'</div>'+
   panel('Branch product comparison',lines(d.branchProducts.slice(0,20),
    ['Branch','Menu item','Units','Line subtotal'],x=>'<tr><td>'+esc(x.branch)+'</td><td>'+esc(x.name)+
    '</td><td>'+fmt(x.qty)+'</td><td>'+peso(x.amount)+'</td></tr>'))+
   note('Menu item line subtotals are before transaction-level discounts. Item subtotals must not be added to the net-sales KPI.');
 }
 function customers(d){
  const s=d.summary;
  return title('Customers','Insights from optional customer names entered on completed checkouts.')+
   kpis([['Identified customers',fmt(s.recordedCustomers),'Distinct recorded names'],
    ['Returning names',fmt(s.repeatCustomers),'Names appearing in multiple orders'],
    ['Named order records',fmt(d.namedCustomers.reduce((n,x)=>n+x.orders,0)),'Top 15 names displayed only'],
    ['Completed orders',fmt(s.orders),'Includes anonymous orders']])+
   panel('Customer history · recorded names only',
    lines(d.namedCustomers,['Customer name','Orders','Net spend'],x=>'<tr><td><strong>'+esc(x.name)+
    '</strong></td><td>'+fmt(x.orders)+'</td><td>'+peso(x.net)+'</td></tr>'))+
   note(d.sourceNotes.customers);
 }
 function operations(d){
  const m=d.movementSummary;
  return title('Operations','Recorded replenishments, transfers and the shared ingredient stock ledger.')+
   kpis([['Stock transfers',fmt(m.transfer),'Inventory movement records'],
    ['Replenishment movements',fmt(m.replenish),'Recorded entries'],
    ['Sales stock movements',fmt(m.sale),'Movement records'],
    ['Stock alerts',fmt(d.stockAlerts.length),'Up to 12 shared-stock warnings']])+
   '<div class="rd-section-grid">'+panel('Ingredient stock attention',lines(d.stockAlerts,
    ['Ingredient','On hand','Threshold'],x=>'<tr><td>'+esc(x.name)+'</td><td>'+fmt(x.stock)+' '+esc(x.uom)+
    '</td><td>'+fmt(x.threshold)+'</td></tr>'))+
    panel('Recent inventory movements',lines(d.movements.slice(0,12),
     ['Date','Movement','Ingredient','Qty'],x=>'<tr><td>'+esc(date(x.date))+'</td><td>'+esc(x.type)+
     '</td><td>'+esc(x.ingredient)+'</td><td>'+fmt(x.qty)+' '+esc(x.uom)+'</td></tr>'))+'</div>'+
   note(d.sourceNotes.stock);
 }
 function staff(d){
  const s=d.summary;
  return title('Staff & Labour','Recorded cashier transaction throughput; no invented attendance or payroll hours.')+
   kpis([['Cashiers with sales',fmt(d.cashiers.length),'Up to 25 names'],
    ['Sales processed',peso(s.net),'Completed orders'],
    ['Completed transactions',fmt(s.orders),'Recorded cashier activity'],
    ['Average order value',peso(s.avgTicket),'Net sales per order']])+
   panel('Cashier performance',lines(d.cashiers,['Cashier','Completed orders','Net sales','Average sale'],x=>
    '<tr><td><strong>'+esc(x.name)+'</strong></td><td>'+fmt(x.orders)+'</td><td>'+
    peso(x.net)+'</td><td>'+peso(x.orders?x.net/x.orders:0)+'</td></tr>'))+
   note(d.sourceNotes.staff);
 }
 function alertRows(alerts){
  return alerts.length?'<div class="rd-alert-list">'+alerts.map((a,i)=>
   '<div><span class="rd-alert-dot '+(i<2?'urgent':'')+'"></span><strong>'+esc(a.title)+
   '</strong><span>'+esc(a.location)+'</span><p>'+esc(a.detail)+'</p></div>').join('')+'</div>':
   empty('No recorded exceptions match the current filters.');
 }
 function alerts(d){
  return title('Alerts & Action Center','Exceptions based only on recorded stock and sales events.')+
   kpis([['Stock thresholds',fmt(d.stockAlerts.length),'Shared ingredients needing attention'],
    ['Voided transactions',fmt(d.summary.voided),'Current reporting range'],
    ['Branches reviewed',fmt(d.branchesPerformance.length),'Selected franchise scope'],
    ['Active alerts',fmt(d.alerts.length),'Derived from real records']])+
   panel('Recorded exceptions',alertRows(d.alerts))+
   note('Attention items are indicators, not an automated fraud judgement. Shared stock warnings are not branch-specific.');
 }
 const views={dashboard,financials,store,sales,customers,operations,staff,alerts};
 function showModel(){
  if(!model){root.innerHTML=empty(error||'Loading advanced analytics…');return;}
  const d=model;
  const header='<div class="aa-report-controls"><label>Branch <select data-aa-branch><option value="all">ALL</option>'+
   d.branches.map(b=>'<option value="'+b.id+'" '+(String(b.id)===branch?'selected':'')+'>'+esc(b.name)+'</option>').join('')+
   '</select></label><label>Period <select data-aa-days>'+
   [7,30,90].map(n=>'<option value="'+n+'" '+(String(n)===days?'selected':'')+'>'+n+' days</option>').join('')+
   '</select></label><button type="button" data-aa-refresh aria-label="Refresh Advanced Analytics">↻ Refresh</button></div>';
  const notice=!d.complete?'<p class="aa-warning" role="status">High-volume record limit reached. The figures below reflect only the retrieved data; use the full reports for an exact uncapped total.</p>':'';
  const markup='<section class="rd-shell dm-advanced-shell" data-aa-root>'+
   '<aside class="rd-sidebar"><nav aria-label="Advanced sections">'+sections.map(s=>
    '<button type="button" data-aa-section="'+s[0]+'" class="'+(section===s[0]?'active':'')+'" aria-current="'+
    (section===s[0]?'page':'false')+'"><span class="rd-nav-glyph">'+navIcon(s[0])+'</span>'+esc(s[1])+'</button>').join('')+
   '</nav></aside>'+
   '<main class="rd-main">'+header+
   '<p class="aa-period-caption">Completed POS transactions · '+esc(d.period.start)+' to '+esc(d.period.end)+'</p>'+
   notice+'<div class="rd-body">'+(views[section]||views.dashboard)(d)+'</div>'+
   '<div class="rd-bottom-note">Read-only analytical workspace. Reports reflect saved POS records and do not replace physical inventory counting or financial reconciliation.</div>'+
   '</main></section>';
  root.innerHTML=markup;
 }
 async function load(force=false){
  if(!business())return;
  if(busy&&!force)return;
  if(!force&&model&&Date.now()-lastLoad<15000){showModel();return;}
  const token=++requestId;busy=true;
  if(!model)root.innerHTML='<div class="aa-loading">Loading recorded franchise analytics…</div>';
  try{
   const params=new URLSearchParams({days});
   if(branch!=='all')params.set('branchId',branch);
   const response=await fetch('/api/advanced/analytics?'+params,{credentials:'same-origin',cache:'no-store'});
   const data=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(data.error||'Unable to load advanced analytics.');
   if(token!==requestId)return;
   model=data;error='';lastLoad=Date.now();showModel();
  }catch(e){
   if(token!==requestId)return;
   error=e.message;model=null;root.innerHTML=empty('Advanced analytics unavailable: '+error);
  }finally{if(token===requestId)busy=false;}
 }
 function setSubscription(sub){
  if(!sub)return;
  const wasBusiness=business();
  subscription=sub;
  const enabled=business();
  const view=$('view-advanced');view?.classList.toggle('is-business',enabled);
  $('advancedPlanComparison').hidden=enabled;
  frame.classList.toggle('is-locked',!enabled);
  $('advancedReferenceLock').hidden=enabled;
  $('advancedReferencePlan').textContent=enabled?'Business · Recorded Data':'Business plan required';
  if(!enabled){++requestId;model=null;root.innerHTML='';return;}
  if(!wasBusiness||!model)load();
 }
 function open(){
  if(business()){load();return;}
  if(!subscription){
   fetch('/api/account/subscription',{credentials:'same-origin',cache:'no-store'})
    .then(r=>r.ok?r.json():null).then(setSubscription).catch(()=>{});
  }
 }
 root.addEventListener('click',event=>{
  const action=event.target.closest('[data-aa-section],[data-aa-refresh]');
  if(!action||!business())return;
  if(action.hasAttribute('data-aa-section')){
   const next=action.dataset.aaSection;
   if(!views[next])return;
   section=next;showModel();
  }else if(action.hasAttribute('data-aa-refresh')){lastLoad=0;load(true);}
 });
 root.addEventListener('change',event=>{
  const target=event.target;
  if(target.matches('[data-aa-branch]'))branch=target.value;
  else if(target.matches('[data-aa-days]'))days=target.value;
  else return;
  model=null;lastLoad=0;load(true);
 });
 window.donmacAdvancedAnalytics={setSubscription,open,refresh:()=>{lastLoad=0;return load(true);}};
 fetch('/api/account/subscription',{credentials:'same-origin',cache:'no-store'})
  .then(r=>r.ok?r.json():null).then(sub=>{if(sub)setSubscription(sub);})
  .catch(()=>{});
 if($('view-advanced')?.classList.contains('active'))open();
})();
