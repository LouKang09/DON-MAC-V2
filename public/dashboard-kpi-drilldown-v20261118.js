/* Don Mac POS dashboard KPI drill-down. Same-session, read-only and tenant-scoped. */
(() => {
 'use strict';
 const root=document.getElementById('view-dashboard');
 const summary=document.getElementById('dashboardSummary');
 const app=document.getElementById('app');
 if(!root||!summary||!app||window.donmacDashboardDrilldown)return;
 const $=id=>document.getElementById(id);
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
 const money=x=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(x||0));
 const count=x=>Number(x||0).toLocaleString('en-PH',{maximumFractionDigits:0});
 const pct=(n,d)=>d>0?(100*Number(n||0)/d).toFixed(1)+'%':'0.0%';
 const number=x=>Number(x||0);
 const titles={revenue:'Total Revenue',orders:'Orders',today:'Today Sales',month:'Month Revenue',
  expenses:'Total Expenses',discount:'Discount',alerts:'Low Stock Alerts'};
 const expenses=['rent','stocks','salary','transportation','electricity','ice','water','misc'];
 const detail=document.createElement('section');
 detail.id='dmKpiDetail';detail.className='dm-kpi-detail hidden';
 detail.setAttribute('aria-label','Dashboard KPI detailed breakdown');
 detail.innerHTML='<div class="dm-kpi-detail-heading">'+
  '<button type="button" class="dm-kpi-back" id="dmKpiBack" aria-label="Back to dashboard">'+
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" width="18" height="18" aria-hidden="true"><path d="m14 5-7 7 7 7"/></svg> Back to Dashboard</button>'+
  '<div><p class="dm-kpi-eyebrow">DASHBOARD BREAKDOWN</p><h2 id="dmKpiTitle"></h2>'+
  '<p id="dmKpiScope" class="dm-kpi-scope"></p></div></div>'+
  '<div id="dmKpiContent" class="dm-kpi-content" aria-live="polite"></div>';
 summary.after(detail);
 const content=$('dmKpiContent'),title=$('dmKpiTitle'),scope=$('dmKpiScope'),back=$('dmKpiBack');
 let payload=null,context=null,current=null,activeRequest=0,previousFocus=null;
 const valid=()=>{
  if(!payload||!context||app.classList.contains('hidden')||app.inert||!root.classList.contains('active'))return false;
  return !window.donmacSessionGeneration||window.donmacSessionGeneration()===context.session;
 };
 const box=(name,value,hint)=>'<div class="dm-kpi-tile"><span>'+esc(name)+'</span><strong>'+esc(value)+'</strong>'+
  (hint?'<small>'+esc(hint)+'</small>':'')+'</div>';
 const panel=(heading,inner,note)=>'<section class="dm-kpi-panel"><header><h3>'+esc(heading)+'</h3>'+
  (note?'<p>'+esc(note)+'</p>':'')+'</header>'+inner+'</section>';
 const empty=message=>'<p class="dm-kpi-empty">'+esc(message)+'</p>';
 function close(focus){
  ++activeRequest;
  root.classList.remove('dm-kpi-detail-open');
  detail.classList.add('hidden');
  content.replaceChildren();current=null;
  if(focus&&previousFocus?.isConnected)previousFocus.focus();
  previousFocus=null;
 }
 function clear(){close(false);payload=null;context=null;title.textContent='';scope.textContent='';}
 back.addEventListener('click',()=>close(true));
 summary.addEventListener('click',event=>{
  const btn=event.target.closest('button[data-dm-kpi]');
  if(btn&&summary.contains(btn)&&valid())open(btn.dataset.dmKpi,btn);
 });
 function query(period,branch){
  const p=new URLSearchParams();
  if(period.view==='custom'){p.set('view','custom');p.set('from',period.from);p.set('to',period.to);}
  else p.set('view',period.view);
  if(branch)p.set('branchId',String(branch));
  return '/api/dashboard?'+p.toString();
 }
 function selectedPeriod(key){
  const today=payload.today||payload.to;
  if(key==='today')return{view:'hourly',from:today,to:today,description:'Today · Philippine time'};
  if(key==='month'&&context.role==='Admin')return{view:'custom',from:today.slice(0,7)+'-01',to:today,
   description:'Current month to date · Philippine time'};
  if(key==='month'&&context.live){
   const days=context.permissions.includes('report.window.month')?30:
    context.permissions.includes('report.window.week')?7:1;
   const from=new Date(Date.parse(today+'T00:00:00Z')-(days-1)*86400000).toISOString().slice(0,10);
   return{view:'custom',from,to:today,
    description:'Owner-approved last '+days+' day'+(days===1?'':'s')+' · Philippine time'};
  }
  const from=payload.from,to=payload.to;
  const sameToday=from===today&&to===today&&$('trendView')?.value==='hourly';
  return{view:sameToday?'hourly':'custom',from,to,
   description:(key==='alerts'?'Current ingredient stock snapshot · sales filter: ':
    key==='month'?'Selected reporting period · ':'Selected dashboard period · ')+from+
    (to!==from?' to '+to:'')};
 }
 const value=(d,key)=>{
  const m=d?.metrics||{};
  return number(({revenue:d?.rangeActual,orders:d?.rangeTransactions,today:m.todayActual,
   month:m.monthActual,expenses:d?.rangeExpenses,discount:d?.rangeDiscount,
   alerts:m.lowStockCount})[key]);
 };
 function overview(d,key){
  const m=d.metrics||{},metrics=[
   ['Completed orders',count(d.rangeTransactions)],
   ['Average order value',money(d.rangeTransactions?d.rangeActual/d.rangeTransactions:0)],
   ['Net revenue',money(d.rangeActual)],
   ['Gross revenue',money(d.rangeGross)],
   ['Discounts',money(d.rangeDiscount)],
   ['Recorded expenses',d.rangeExpenses==null?'Not available':money(d.rangeExpenses)],
   ['Low-stock ingredients',count(m.lowStockCount)],
   ['Ingredients monitored',count(m.inventoryCount)]
  ];
  const special={
   revenue:[2,3,4,0,1,5],
   orders:[0,1,2,3,4],
   today:[[ 'Today net sales',money(m.todayActual)],['Today gross sales',money(m.todayGross)],
    ['Today completed orders',count(m.todayTransactions)],['Average today order',money(m.todayTransactions?m.todayActual/m.todayTransactions:0)]],
   month:[['Period net revenue',money(m.monthActual)],['Period gross revenue',money(m.monthGross)],
    ['Period orders',count(m.monthTransactions)],['Average period order',money(m.monthTransactions?m.monthActual/m.monthTransactions:0)]],
   expenses:[5,2,0,['Expenses / net revenue',pct(d.rangeExpenses,d.rangeActual)]],
   discount:[4,3,2,['Discount rate / gross',pct(d.rangeDiscount,d.rangeGross)],0],
   alerts:[6,7,['Alert rate',pct(m.lowStockCount,m.inventoryCount)]]
  };
  const items=(special[key]||[]).map(x=>typeof x==='number'?metrics[x]:x);
  return '<div class="dm-kpi-tiles">'+items.map(([n,v])=>box(n,v)).join('')+'</div>';
 }
 function branchTable(rows,key,total){
  if(!rows.length)return empty('No branch comparisons are available for the selected period.');
  const financial=['revenue','today','month','expenses','discount'].includes(key);
  const metricLabel=key==='orders'?'Completed orders':key==='alerts'?'Low-stock count':
    key==='expenses'?'Expenses':key==='discount'?'Discounts':'Net revenue';
  let html='<div class="dm-kpi-table-scroll"><table><thead><tr><th>Branch</th><th>'+esc(metricLabel)+
   '</th><th>'+ (key==='alerts'?'Ingredients':key==='orders'?'Net revenue':'Orders')+'</th><th>Share of branch total</th></tr></thead><tbody>';
  for(const row of rows){
   const d=row.data;
   const extras=key==='alerts'?count(d.metrics?.inventoryCount):key==='orders'?money(d.rangeActual):
    count(key==='today'?d.metrics?.todayTransactions:key==='month'?d.metrics?.monthTransactions:d.rangeTransactions);
   html+='<tr'+(row.selected?' class="dm-kpi-selected-branch"':'')+'><th scope="row">'+esc(row.name)+
    (row.selected?' <span class="dm-kpi-current">Selected</span>':'')+'</th><td class="dm-kpi-number">'+
    (financial?money(value(d,key)):count(value(d,key)))+'</td><td class="dm-kpi-number">'+extras+
    '</td><td class="dm-kpi-number">'+pct(value(d,key),total)+'</td></tr>';
  }
  html+='</tbody></table></div>';
  return html;
 }
 function categoryPanel(d,key){
  if(['expenses','alerts'].includes(key))return'';
  let amounts=(d.categoryTrends||[]).map(x=>({
   name:x.name,amount:(x.values||[]).reduce((s,v)=>s+number(v),0)
  })).filter(x=>x.amount>0);
  let note='Net sales per menu category in the detailed period, allocated from completed sales.';
  if(!amounts.length&&d.categorySales?.length){
   amounts=d.categorySales.map(x=>({name:x.name,amount:number(x.amount)}));
   note='Current month gross sales mix; not necessarily the selected reporting period.';
  }
  amounts.sort((a,b)=>b.amount-a.amount);
  const total=amounts.reduce((s,x)=>s+x.amount,0);
  if(!amounts.length)return panel('Menu category breakdown',empty('No completed category sales in this period.'),note);
  const bars=amounts.map(x=>'<div class="dm-kpi-bar-row"><div><strong>'+esc(x.name)+'</strong><span>'+money(x.amount)+
   ' · '+pct(x.amount,total)+'</span></div><div class="dm-kpi-bar-track"><span style="width:'+
   Math.max(1,Math.min(100,100*x.amount/Math.max(1,total))).toFixed(2)+'%"></span></div></div>').join('');
  return panel('Menu category breakdown',bars,note);
 }
 function timelinePanel(d,key){
  if(['expenses','alerts'].includes(key))return'';
  const points=(d.trend||[]).map(x=>({label:x.label,n:key==='orders'?number(x.transactions):number(x.actual),
   orders:number(x.transactions)}));
  if(!points.length)return'';
  const max=Math.max(1,...points.map(x=>x.n));
  const rows=points.map(x=>'<div class="dm-kpi-mini-bar"><span>'+esc(x.label)+'</span>'+
   '<div class="dm-kpi-bar-track"><span style="width:'+Math.max(0.8,100*x.n/max).toFixed(2)+'%"></span></div>'+
   '<strong>'+(key==='orders'?count(x.n):money(x.n))+'</strong></div>').join('');
  return panel((d.grain==='hourly'?'Hourly':'Daily')+' sales activity',rows,
   'Completed '+(key==='orders'?'order counts':'net sales')+' for the displayed period; scroll for all intervals.');
 }
 function recentPanel(d){
  const data=d.recentTransactions||[];
  const body=data.length?'<div class="dm-kpi-table-scroll"><table><thead><tr><th>Reference</th><th>Cashier</th>'+
   '<th>Payment</th><th>Net amount</th></tr></thead><tbody>'+
   data.slice(0,8).map(x=>'<tr><th scope="row">'+esc(x.reference||'—')+'</th><td>'+esc(x.cashier||'—')+
    '</td><td>'+esc(x.paymentMode||'—')+'</td><td class="dm-kpi-number">'+money(x.amount)+'</td></tr>').join('')+
   '</tbody></table></div>':empty('No recent completed transactions.');
  return panel('Recent completed transactions',body,
   'Up to eight most recent completed sales; this activity list can extend beyond the selected date window.');
 }
 function stockPanel(rows,main){
  const low=rows.length?rows.flatMap(x=>(x.data.lowStock||[]).map(z=>({...z,branch:x.name}))):
   (main.lowStock||[]).map(x=>({...x,branch:'Selected scope'}));
  const body=low.length?'<div class="dm-kpi-table-scroll"><table><thead><tr><th>Branch</th><th>Ingredient</th>'+
   '<th>On hand</th><th>Low-stock threshold</th></tr></thead><tbody>'+low.map(x=>
    '<tr><td>'+esc(x.branch)+'</td><th scope="row">'+esc(x.name)+'</th><td class="dm-kpi-number">'+
    esc(String(x.stock)+' '+String(x.uom||''))+'</td><td class="dm-kpi-number">'+
    esc(String(x.lowStockThreshold)+' '+String(x.uom||''))+'</td></tr>').join('')+
   '</tbody></table></div>':empty('No low-stock ingredients reported.');
  return panel('Ingredients needing attention',body,
   'Alert totals include all monitored ingredients; the dashboard returns up to ten example ingredients per branch.');
 }
 async function expenseCategoryPanel(main,period,run){
  if(context.role!=='Admin'&&!context.permissions.includes('expenses.view'))
   return panel('Expense categories',empty('Open Expenses Ledger to view detailed spending when your account has permission.'),
    'The dashboard amount remains visible only within the access granted to this account.');
  let page=1,total=0,rows=[];
  try{
   while(page<=12){
    const params=new URLSearchParams({start:period.from,end:period.to,page:String(page)});
    const selection=context.selectedBranch;
    if(selection&&selection!=='all')params.set('branchId',selection);
    const result=await context.request('/api/finance/expenses?'+params);
    if(run!==activeRequest||!valid())return'';
    total=Number(result.total||0);
    rows.push(...(result.rows||[]));
    if(rows.length>=total||!(result.rows||[]).length)break;
    page++;
   }
  }catch(error){
   return panel('Expense categories',empty('Unable to load expense-category records: '+error.message),
    'Use Expenses Ledger for the detailed history.');
  }
  const aggregated=expenses.map(cat=>({name:cat.charAt(0).toUpperCase()+cat.slice(1),
   amount:rows.reduce((v,r)=>v+number(r[cat]),0)})).sort((a,b)=>b.amount-a.amount);
  const sum=aggregated.reduce((n,x)=>n+x.amount,0);
  const unfinished=rows.length<total;
  const body=aggregated.map(x=>'<div class="dm-kpi-bar-row"><div><strong>'+esc(x.name)+
   '</strong><span>'+money(x.amount)+' · '+pct(x.amount,sum)+'</span></div>'+
   '<div class="dm-kpi-bar-track"><span style="width:'+(sum?100*x.amount/sum:0).toFixed(2)+'%"></span></div></div>').join('');
  const discrepancy=!unfinished&&Math.abs(sum-number(main.rangeExpenses))>0.01;
  const note=unfinished?'Partial: first '+rows.length+' of '+total+' daily branch entries. Open Expenses Ledger for the full breakdown.':
   discrepancy?'Expense Ledger daily category grouping differs from the dashboard date cutoff; verify totals in Expenses Ledger.':
   'Recorded expense categories for the detailed period and selected dashboard branch scope.';
  return panel('Expenses by category',sum?body:empty('No recorded expenses in this period.'),note);
 }
 async function open(key,source){
  if(!titles[key]||!valid())return;
  if(source)previousFocus=source;
  const run=++activeRequest;
  current=key;
  const period=selectedPeriod(key);
  const selectedName=context.selectedBranch&&context.selectedBranch!=='all'
   ?(context.branches.find(b=>String(b.id)===String(context.selectedBranch))?.name||'Selected branch'):'All permitted branches';
  root.classList.add('dm-kpi-detail-open');
  detail.classList.remove('hidden');
  title.textContent=key==='month'&&context.role!=='Admin'?'Allowed Period Revenue':titles[key];
  scope.textContent=period.description+' · '+selectedName;
  content.innerHTML='<p class="dm-kpi-loading">Loading verified dashboard records and branch comparison…</p>';
  if(source){back.focus();detail.scrollIntoView({block:'start',behavior:'instant'});}
  try{
   const d=payload;
   let main=d;
   if(key==='today'||key==='month'&&(context.role==='Admin'||context.live))
    main=await context.request(query(period,context.selectedBranch==='all'?null:context.selectedBranch));
   if(run!==activeRequest||!valid())return;
   const isAdmin=context.role==='Admin';
   const branches=(context.branches||[]).filter(b=>b&&b.active!==false&&Number(b.id)>0);
   const compare=isAdmin&&branches.length>1;
   const rows=[],failed=[];
   // Request the same protected dashboard endpoint per branch. Access checks on
   // the server remain authoritative even when the UI contains an old branch.
   if(compare){
    for(let i=0;i<branches.length;i+=5){
     const batch=await Promise.allSettled(branches.slice(i,i+5).map(async b=>({
      id:Number(b.id),name:b.name,data:await context.request(query(period,b.id)),
      selected:String(context.selectedBranch)===String(b.id)
     })));
     if(run!==activeRequest||!valid())return;
     batch.forEach((result,j)=>{
      if(result.status==='fulfilled')rows.push(result.value);
      else failed.push(branches[i+j].name);
     });
    }
   }else if(branches.length){
    rows.push({id:Number(branches[0].id),name:branches[0].name,data:main,selected:true});
   }
   rows.sort((a,b)=>value(b.data,key)-value(a.data,key));
   const total=rows.reduce((sum,r)=>sum+value(r.data,key),0);
   const heading=compare?'Branch comparison · '+rows.length+' of '+branches.length+' active branches':
    'Branch breakdown';
   let body=overview(main,key);
   body+=panel(heading,branchTable(rows,key,total),
    compare?'Compares all accessible active branches. The overview above still follows your selected Dashboard branch.':
     'Values are based on the signed-in account’s permitted branch.');
   if(failed.length)body+=panel('Unavailable branches',empty(failed.join(', ')),
    'Branch data could not be retrieved; missing rows are excluded from the comparison total.');
   if(key==='alerts')body+=stockPanel(rows,main);
   else{
    if(key==='expenses')body+=await expenseCategoryPanel(main,period,run);
    if(run!==activeRequest||!valid())return;
    body+=categoryPanel(main,key)+timelinePanel(main,key);
    if(['revenue','orders','today','month','discount'].includes(key))body+=recentPanel(main);
   }
   if(run!==activeRequest||!valid())return;
   content.innerHTML=body;
  }catch(error){
   if(run!==activeRequest||!valid())return;
   content.innerHTML=panel('Unable to load the breakdown',empty(error.message||'Please retry.'),
    'The dashboard totals remain unchanged. Return to the overview and try again.');
  }
 }
 function sync(data,nextContext){
  payload=data;
  context={...nextContext,branches:Array.isArray(nextContext?.branches)?nextContext.branches.slice():[],
   permissions:Array.isArray(nextContext?.permissions)?nextContext.permissions.slice():[]};
  if(current&&valid())open(current,null);
 }
 const watch=new MutationObserver(()=>{
  if(current&&(app.classList.contains('hidden')||app.inert||!root.classList.contains('active')))clear();
 });
 watch.observe(app,{attributes:true,attributeFilter:['class','inert','aria-hidden']});
 watch.observe(root,{attributes:true,attributeFilter:['class']});
 window.donmacDashboardDrilldown={sync,clear,back:()=>close(true)};
})();