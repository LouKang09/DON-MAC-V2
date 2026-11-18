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

 // The headline activity visual applies to all seven dashboard drill-downs.
 // Only the permitted, signed-in branch scope is fetched. Expenses and stock
 // have no historical hourly series, so those pages show contextual net sales.
 let chosenChartType='line',activityLoadSequence=0;
 const addDays=(day,delta)=>new Date(Date.parse(day+'T00:00:00Z')+delta*86400000).toISOString().slice(0,10);
 function activityDates(period,interval){
  const latest=period.to;
  if(interval==='hourly')return{view:'custom',from:latest,to:latest};
  if(period.from!==period.to)return{view:'custom',from:period.from,to:period.to};
  const maxDays=context.role==='Admin'||!context.live?30:
   context.permissions.includes('report.window.month')?30:
   context.permissions.includes('report.window.week')?7:1;
  const today=payload.today||period.to;
  const earliest=addDays(today,1-maxDays);
  const proposed=addDays(latest,-29);
  return{view:'custom',from:context.role==='Admin'||!context.live?proposed:
   (proposed<earliest?earliest:proposed),to:latest};
 }
 function timelinePanel(d,key){
  const defaultInterval=d.grain==='daily'?'daily':'hourly';
  const isContext=key==='expenses'||key==='alerts';
  const displayLabel=key==='orders'?'Completed orders':key==='discount'?'Discounts':
   isContext?'Net sales (context)':'Gross sales';
  return '<section class="dm-kpi-panel dm-activity-panel" aria-label="Sales activity chart">'+
   '<div class="dm-activity-head"><div><h3 id="dmActivitySeriesName">'+esc(displayLabel)+'</h3>'+
   '<p class="dm-activity-subtitle" id="dmActivityDescription">'+
   (isContext?'Completed POS sales context; not historical expenses or stock alerts.':
    'Completed POS sales from the selected dashboard branch scope.')+'</p></div>'+
   '<div class="dm-activity-controls">'+
   '<label for="dmActivityType">Chart Type<select id="dmActivityType" aria-label="Chart type">'+
   '<option value="line"'+(chosenChartType==='line'?' selected':'')+'>Line</option>'+
   '<option value="bar"'+(chosenChartType==='bar'?' selected':'')+'>Bar</option></select></label>'+
   '<label for="dmActivityInterval">Interval<select id="dmActivityInterval" aria-label="Sales activity interval">'+
   '<option value="hourly"'+(defaultInterval==='hourly'?' selected':'')+'>Hourly</option>'+
   '<option value="daily"'+(defaultInterval==='daily'?' selected':'')+'>Daily</option></select></label>'+
   '</div></div><p class="dm-activity-range" id="dmActivityRange" aria-live="polite"></p>'+
   '<div id="dmActivityPlot" class="dm-activity-plot" aria-live="polite">'+
   '<p class="dm-kpi-loading">Loading sales activity…</p></div>'+
   '</section>';
 }
 const axisLabel=(n,monetary)=>monetary?money(n):count(n);
 function svgChart(d,key,interval,chartType){
  const isOrders=key==='orders',isDiscount=key==='discount';
  const availableGross=(d.trend||[]).every(x=>Number.isFinite(Number(x.gross)));
  const availableDiscount=(d.trend||[]).every(x=>Number.isFinite(Number(x.discount)));
  const useGross=!isOrders&&!isDiscount&&key!=='expenses'&&key!=='alerts'&&availableGross;
  const useDiscount=isDiscount&&availableDiscount;
  const field=isOrders?'transactions':useDiscount?'discount':useGross?'gross':'actual';
  const seriesLabel=isOrders?'Completed orders':useDiscount?'Discounts':
   useGross?'Gross sales':'Net sales';
  let trend=Array.isArray(d.trend)?d.trend:[];
  let points=trend.map(x=>({name:String(x.label||''),value:Math.max(0,number(x[field]))}));
  if(interval==='daily'&&d.grain==='hourly'){
   const sum=points.reduce((acc,x)=>acc+x.value,0);
   points=[{name:d.to||'',value:sum}];
  }
  if(interval==='daily'&&d.grain==='daily'){
   points=points.map((point,i)=>{
    const iso=addDays(d.from,i);
    const date=new Date(iso+'T00:00:00Z');
    return {...point,name:new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',timeZone:'UTC'}).format(date)};
   });
  }
  return{points,field,seriesLabel,unitIsMoney:!isOrders};
 }
 function drawActivityChart(dataset,key,interval,type){
  const plot=$('dmActivityPlot'),seriesName=$('dmActivitySeriesName'),label=$('dmActivityRange');
  if(!plot||!seriesName||!label)return;
  const {points,field,seriesLabel,unitIsMoney}=svgChart(dataset,key,interval,type);
  seriesName.textContent=seriesLabel;
  const dateFrom=dataset.from||'',dateTo=dataset.to||'';
  label.textContent=(interval==='hourly'?'Hourly · '+dateTo:
   'Daily · '+dateFrom+(dateTo!==dateFrom?' to '+dateTo:''))+
   ' · '+(context.selectedBranch==='all'?'All permitted branches':
    context.branches.find(b=>String(b.id)===String(context.selectedBranch))?.name||'Selected branch')+
   ((key==='expenses'||key==='alerts')?' · contextual completed sales':'');
  if(!points.length){plot.innerHTML=empty('No recorded sales activity for this period.');return;}
  const w=Math.max(960,points.length*40+140),h=360,L=104,R=30,T=44,B=89;
  const left=L,right=w-R,top=T,bottom=h-B,available=bottom-top;
  const vals=points.map(x=>x.value),maximum=Math.max(0,...vals);
  const zeroOnly=maximum===0;
  const max=zeroOnly?1:maximum*1.12;
  const xAt=i=>points.length===1?(left+right)/2:left+(right-left)*i/(points.length-1);
  const yAt=v=>zeroOnly?top+available/2:bottom-v/max*available;
  const grid=[];
  if(zeroOnly){
   const y=yAt(0);
   grid.push('<line class="dm-activity-grid-line" x1="'+left+'" y1="'+y+'" x2="'+right+'" y2="'+y+'"/>');
   grid.push('<text class="dm-activity-y-label" x="'+(left-14)+'" y="'+(y+4)+'" text-anchor="end">'+
    esc(axisLabel(0,unitIsMoney))+'</text>');
  }else{
   for(let j=0;j<=4;j++){
    const value=max*j/4,y=bottom-available*j/4;
    grid.push('<line class="dm-activity-grid-line" x1="'+left+'" y1="'+y.toFixed(2)+
     '" x2="'+right+'" y2="'+y.toFixed(2)+'"/>');
    grid.push('<text class="dm-activity-y-label" x="'+(left-14)+'" y="'+(y+4).toFixed(2)+
     '" text-anchor="end">'+esc(axisLabel(value,unitIsMoney))+'</text>');
   }
  }
  grid.push('<line class="dm-activity-axis" x1="'+left+'" y1="'+bottom+'" x2="'+right+'" y2="'+bottom+'"/>');
  const marks=[];
  const labelStep=Math.max(1,Math.ceil(points.length/32));
  for(let i=0;i<points.length;i++){
   const p=points[i],x=xAt(i),y=yAt(p.value);
   const tooltip=esc(p.name+' · '+axisLabel(p.value,unitIsMoney));
   if(type==='bar'){
    const bw=Math.max(10,Math.min(29,(right-left)/Math.max(1,points.length)*.58));
    const chartBottom=zeroOnly?top+available/2:bottom;
    const barY=Math.min(y,chartBottom),barH=Math.max(2,Math.abs(chartBottom-y));
    marks.push('<rect class="dm-activity-bar" x="'+(x-bw/2).toFixed(2)+'" y="'+barY.toFixed(2)+
     '" width="'+bw.toFixed(2)+'" height="'+barH.toFixed(2)+'" rx="3">'+
     '<title>'+tooltip+'</title></rect>');
   }else{
    marks.push('<circle class="dm-activity-marker" cx="'+x.toFixed(2)+'" cy="'+y.toFixed(2)+
     '" r="3.4"><title>'+tooltip+'</title></circle>');
   }
   if(i%labelStep===0||i===points.length-1){
    marks.push('<text class="dm-activity-x-label" text-anchor="end" transform="translate('+
     (x+4).toFixed(2)+' '+(bottom+21)+') rotate(-48)">'+esc(p.name)+'</text>');
   }
  }
  const line=type==='line'?'<polyline class="dm-activity-line" points="'+points.map((p,i)=>
   xAt(i).toFixed(2)+','+yAt(p.value).toFixed(2)).join(' ')+'"/>':'';
  // When every value is zero, the same green horizontal line shown in the reference
  // remains visible rather than fabricating a nonzero scale.
  const alt=(interval==='hourly'?'Hourly':'Daily')+' '+seriesLabel+
   ': '+points.map(p=>p.name+' '+axisLabel(p.value,unitIsMoney)).join('; ');
  plot.innerHTML='<div class="dm-activity-scroll" tabindex="0" aria-label="Scrollable sales chart">'+
   '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+w+' '+h+
   '" width="'+w+'" height="'+h+'" class="dm-activity-svg" role="img" aria-label="'+esc(alt)+'">'+
   grid.join('')+line+marks.join('')+'</svg></div>';
 }
 async function mountActivityChart(main,period,key,run){
  const plot=$('dmActivityPlot'),type=$('dmActivityType'),interval=$('dmActivityInterval');
  if(!plot||!type||!interval||!valid())return;
  // The chart never changes the KPI card's own reporting dates or branch filters.
  // A single selected day displays hourly sales; Daily automatically expands to
  // the preceding 30 calendar days, or the cashier's shorter allowed window.
  let currentData=null,sequence=0;
  async function load(){
   const fetchId=++sequence,requestId=++activityLoadSequence;
   const mode=interval.value,range=activityDates(period,mode);
   plot.innerHTML='<p class="dm-kpi-loading">Loading '+esc(mode)+' sales activity…</p>';
   try{
    const canReuse=main.from===range.from&&main.to===range.to&&
      ((mode==='hourly'&&main.grain==='hourly')||(mode==='daily'&&main.grain==='daily'));
    const data=canReuse?main:await context.request(query(range,context.selectedBranch==='all'?null:context.selectedBranch));
    if(fetchId!==sequence||requestId!==activityLoadSequence||run!==activeRequest||!valid())return;
    currentData=data;drawActivityChart(data,key,mode,type.value);
   }catch(error){
    if(fetchId!==sequence||requestId!==activityLoadSequence||run!==activeRequest||!valid())return;
    plot.innerHTML=empty('Sales activity unavailable: '+(error.message||'Please retry.'));
   }
  }
  type.addEventListener('change',()=>{
   if(type.value!=='bar'&&type.value!=='line')return;
   chosenChartType=type.value;
   if(currentData)drawActivityChart(currentData,key,interval.value,type.value);
  });
  interval.addEventListener('change',()=>{
   if(!['hourly','daily'].includes(interval.value))return;
   load();
  });
  await load();
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
    body+=categoryPanel(main,key);
    if(['revenue','orders','today','month','discount'].includes(key))body+=recentPanel(main);
   }
   if(run!==activeRequest||!valid())return;
   body+=timelinePanel(main,key);
   content.innerHTML=body;
   await mountActivityChart(main,period,key,run);
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