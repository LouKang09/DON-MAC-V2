/* Business-plan Store Performance, relocated from Advanced Analytics.
 * Read-only. Never falls back to shared/legacy APIs for live franchises. */
(() => {
 'use strict';
 const $=id=>document.getElementById(id);
 const root=$('view-dashboard'),summary=$('dashboardSummary'),app=$('app');
 if(!root||!summary||!app||window.donmacBusinessStore)return;
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const peso=n=>'₱'+Number(n||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
 const fmt=n=>Number(n||0).toLocaleString('en-PH',{maximumFractionDigits:0});
 const num=n=>Number(n||0);
 const dayPH=()=>{
  const parts=new Intl.DateTimeFormat('en-US',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'Asia/Manila'})
   .formatToParts(new Date()).filter(x=>x.type!=='literal');
  const m=Object.fromEntries(parts.map(x=>[x.type,x.value]));
  return m.year+'-'+m.month+'-'+m.day;
 };
 const dayOffset=(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
 const monthsOf=day=>Array.from({length:12},(_,i)=>new Date(Date.UTC(Number(day.slice(0,4)),Number(day.slice(5,7))-12+i,1))
  .toISOString().slice(0,7));
 const session=()=>window.donmacSessionGeneration?.()??0;
 let plan=null,admin=false,sessionKey=session(),selectedBranch='all',days=30,interval='monthly',chartType='line';
 const trendCache=new Map();let trendRequest=0,trendLoading=false,trendError='';
 let view='closed',data=null,signature='',run=0,origin=null;
 let breakdown=null,breakdownState='idle',breakdownError='',breakdownRequest=0;
 const expandedRows=new Set();
 const detail=document.createElement('section');
 detail.id='dmBusinessStoreDetail';detail.className='dm-business-store-detail hidden';
 detail.setAttribute('aria-label','Business Store Performance breakdown');
 summary.after(detail);
 function eligible(){
  return admin&&plan?.plan==='BUSINESS'&&plan?.status==='PAID'&&
   sessionKey===session()&&!app.classList.contains('hidden')&&!app.inert&&
   window.donmacAuthenticatedRole==='Admin';
 }
 function card(){
  return '<button type="button" class="summary-card dm-kpi-button dm-business-store-card" '+
   'data-business-store aria-label="Open Business Store Performance breakdown">'+
   '<div class="dash-card-main"><div class="dash-summary-label"><span class="dash-summary-icon">'+
   '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+
   '<path d="M3 11h18v10H3zM4 11l2-7h12l2 7M8 21v-6h8v6M2 11l2-2m16 0 2 2"/></svg></span>'+
   '<span>Store Performance</span></div><strong>Business</strong>'+
   '<small>Branch comparisons &amp; 12-month sales history</small></div>'+
   '<span class="dm-kpi-arrow" aria-hidden="true">'+
   '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 5 7 7-7 7"/></svg></span></button>';
 }
 function sync(){
  const old=summary.querySelector('[data-business-store]');
  if(!eligible()){old?.remove();if(view!=='closed')close(false);return;}
  if(!old)summary.insertAdjacentHTML('beforeend',card());
 }
 function setSubscription(next,isAdmin){
  const stamp=session(),prior=plan?.plan+'|'+plan?.status+'|'+admin+'|'+sessionKey;
  plan=next;admin=isAdmin===true;sessionKey=stamp;
  const changed=prior!==plan?.plan+'|'+plan?.status+'|'+admin+'|'+sessionKey;
  if(changed){data=null;signature='';trendRequest++;trendCache.clear();run++;if(view!=='closed')close(false);}
  sync();
 }
 function close(focus){
  run++;breakdownRequest++;trendRequest++;trendCache.clear();trendLoading=false;trendError='';
  view='closed';data=null;signature='';
  breakdown=null;breakdownState='idle';breakdownError='';expandedRows.clear();
  root.classList.remove('dm-business-store-open');
  detail.classList.add('hidden');detail.replaceChildren();
  if(focus&&origin?.isConnected)origin.focus();
  origin=null;
 }
 function clear(){close(false);plan=null;admin=false;sessionKey=session();sync();}
 function onViewChange(next){if(next!=='dashboard'&&view!=='closed')close(false);}
 function fetchJson(url){
  return fetch(url,{method:'GET',credentials:'same-origin',cache:'no-store'})
   .then(async res=>{
    const body=await res.json().catch(()=>({}));
    if(!res.ok)throw Error(body.error||'Unable to load Store Performance ('+res.status+').');
    return body;
   });
 }
 async function readStore(){
  const isLive=window.donmacFranchiseUnified===true;
  if(!isLive){
   const q=new URLSearchParams({days:String(days)});
   if(selectedBranch!=='all')q.set('branchId',selectedBranch);
   const r=await fetchJson('/api/advanced/analytics?'+q.toString());
   return {period:r.period,months:r.months||[],branches:r.branches||[],
    selectedBranch,branchesPerformance:r.branchesPerformance||[],branchMonthly:r.branchMonthly||[],summary:r.summary||{},
    complete:r.complete!==false,source:'Recorded franchise transactions and expense entries'};
  }
  // Live franchise data can ONLY be read via authenticated workspace-scoped routes.
  const status=await fetchJson('/api/live/status');
  if(status.role!=='Admin'||status.plan!=='BUSINESS'||status.subscriptionStatus!=='PAID')
   throw Error('An active Business subscription is required for Store Performance.');
  const branches=(status.branches||[]).filter(x=>x.active!==false);
  const selected=selectedBranch==='all'?null:branches.find(x=>String(x.id)===selectedBranch);
  if(selectedBranch!=='all'&&!selected)throw Error('The selected branch is not available.');
  const today=dayPH(),months=monthsOf(today);
  const historyStart=months[0]+'-01',start=dayOffset(today,1-days);
  const query=(from,to,branchId)=>{
   const q=new URLSearchParams({view:'custom',from,to});
   if(branchId)q.set('branchId',String(branchId));
   return '/api/live/dashboard?'+q;
  };
  // The aggregate monthly series and comparisons share authenticated queries.
  // Each visible branch additionally gets its own 12-month report; a combined
  // monthly total cannot be apportioned to branches without inventing data.
  const inScope=branches.filter(b=>!selected||Number(b.id)===Number(selected.id));
  const [year,period,...separate]=await Promise.all([
   fetchJson(query(historyStart,today,selected?.id)),
   fetchJson(query(start,today,selected?.id)),
   ...inScope.map(b=>fetchJson(query(start,today,b.id)))
  ]);
  const monthRows=monthlyRollup(year,months);
  const branchMonthly=[];
  // Bounded requests avoid loading every branch at once for larger franchises.
  for(let i=0;i<inScope.length;i+=4){
   const batch=inScope.slice(i,i+4);
   const series=await Promise.all(batch.map(async b=>{
    const annual=selected&&Number(selected.id)===Number(b.id)?year:
     await fetchJson(query(historyStart,today,b.id));
    return{id:Number(b.id),name:String(b.name),months:monthlyRollup(annual,months)};
   }));
   branchMonthly.push(...series);
  }
  const ranked=inScope.map((b,i)=>({
   id:Number(b.id),name:String(b.name),net:num(separate[i].rangeActual),
   gross:num(separate[i].rangeGross),expenses:num(separate[i].rangeExpenses),
   orders:num(separate[i].rangeTransactions)
  })).sort((a,b)=>b.net-a.net);
  return {period:{days,start,end:today},months:monthRows,branchMonthly,branches,selectedBranch,
   branchesPerformance:ranked,complete:true,
   summary:{net:num(period.rangeActual),gross:num(period.rangeGross),
    expenses:num(period.rangeExpenses),orders:num(period.rangeTransactions),
    voided:0},source:'Workspace-isolated live POS sales and branch expense totals'};
 }
 // Aggregate saved, date-scoped hourly/daily sales without mixing franchise data.
 function monthlyRollup(report,months){
  const map=new Map(months.map(month=>[month,{month,net:0,gross:0,discount:0,orders:0}]));
  const points=Array.isArray(report?.trend)?report.trend:[];
  for(let i=0;i<points.length;i++){
   const day=dayOffset(report.from,i),rec=map.get(day.slice(0,7));
   if(!rec)continue;
   const p=points[i];
   rec.net+=num(p.actual);rec.gross+=num(p.gross);
   rec.discount+=num(p.discount);rec.orders+=num(p.transactions);
  }
  return [...map.values()].map(m=>({
   month:m.month,net:Math.round(m.net*100)/100,gross:Math.round(m.gross*100)/100,
   discount:Math.round(m.discount*100)/100,orders:m.orders
  }));
 }
 const tile=(label,value,hint='')=>'<div class="dm-bs-metric"><span>'+esc(label)+'</span><strong>'+esc(value)+
  '</strong>'+(hint?'<small>'+esc(hint)+'</small>':'')+'</div>';
 const dateMonth=x=>{
  const d=new Date(x+'-01T00:00:00Z');
  return new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',month:'short',year:'numeric'}).format(d);
 };
 const niceStep=max=>{
  const desired=Math.max(1,Math.ceil(max/4)),order=Math.pow(10,Math.floor(Math.log10(desired)));
  return [1,2,5,10].map(x=>x*order).find(x=>x>=desired)||desired;
 };
 const branchColors=['#7ac64a','#e7b53a','#ec6a77','#4285c3','#9a71cb','#28a0a1','#d78d49','#758d57','#cf64a1','#559fa0'];
 const periodLabel=(bucket,grain='monthly')=>{
  if(grain==='yearly')return String(bucket).slice(0,4);
  const date=grain==='daily'?bucket:bucket+'-01';
  const d=new Date(date+'T00:00:00Z');
  if(!Number.isFinite(d.getTime()))return String(bucket);
  return new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',
   day:grain==='daily'?'2-digit':undefined,month:'short',
   year:grain==='monthly'?'2-digit':undefined}).format(d);
 };
 const fullPeriodLabel=(bucket,grain='monthly')=>{
  if(grain==='yearly')return String(bucket).slice(0,4);
  if(grain==='daily'){
   const dt=new Date(bucket+'T00:00:00Z');
   return Number.isFinite(dt.getTime())?new Intl.DateTimeFormat('en-GB',{
    timeZone:'UTC',day:'numeric',month:'long',year:'numeric'}).format(dt):String(bucket);
  }
  return dateMonth(bucket);
 };
 function chart(rows,kind='net',type='line',large=false,branchSeries=[],grain='monthly'){
  if(!rows?.length)return'<p class="dm-bs-chart-empty">No monthly sales records were returned.</p>';
  const compare=branchSeries.length>1;
  // Labels and hover values follow the selected date grain.
  const plots=compare?branchSeries.map((s,i)=>{
   const lookup=new Map((s.months||[]).map(m=>[m.month,m]));
   return{name:String(s.name||'Branch'),color:branchColors[i%branchColors.length],
    values:rows.map(m=>Math.max(0,num(lookup.get(m.month)?.[kind]))),id:s.id};
  }):[{name:branchSeries[0]?.name||'Net sales',color:'#7ac64a',
    values:rows.map(m=>Math.max(0,num(m[kind])))}];
  const maxValue=Math.max(0,...plots.flatMap(s=>s.values));
  const step=niceStep(maxValue),max=step*4,w=large?1120:1000,h=large?368:318;
  // Match KPI drill-down: five horizontal gridlines and a fully visible
  // diagonal X axis, including labels on narrow screen sizes.
  const l=108,r=30,t=43,b=105,plotW=w-l-r,plotH=h-t-b,bottom=h-b;
  const x=i=>l+(rows.length===1?plotW/2:i*plotW/(rows.length-1));
  const y=v=>bottom-(num(v)/max)*plotH;
  const isMoney=kind!=='orders';
  const amount=v=>isMoney?peso(v):fmt(v);
  const grid=[];
  for(let tick=0;tick<=4;tick++){
   const yy=bottom-tick*plotH/4;
   grid.push('<line class="dm-bs-grid-line" x1="'+l+'" y1="'+yy.toFixed(2)+
    '" x2="'+(w-r)+'" y2="'+yy.toFixed(2)+'"/>');
   grid.push('<text class="dm-bs-y-label" x="'+(l-14)+'" y="'+(yy+4).toFixed(2)+
    '" text-anchor="end">'+esc(amount(tick*step))+'</text>');
  }
  grid.push('<line class="dm-bs-axis" x1="'+l+'" y1="'+bottom+'" x2="'+(w-r)+'" y2="'+bottom+'"/>');
  const marks=[];
  const bw=Math.max(2,Math.min(25,plotW/Math.max(1,rows.length)*.6/plots.length));
  const groupedWidth=bw*plots.length;
  for(let j=0;j<plots.length;j++){
   const series=plots[j],color=series.color;
   if(type==='line'){
    const poly=series.values.map((v,i)=>x(i).toFixed(2)+','+y(v).toFixed(2)).join(' ');
    marks.push('<polyline class="dm-bs-line" points="'+poly+'" stroke="'+color+'"/>');
   }
   for(let i=0;i<rows.length;i++){
    const xx=x(i),value=series.values[i],yy=y(value);
    const hover=esc(series.name+' · '+fullPeriodLabel(rows[i].month,grain)+' · '+amount(value));
    if(type==='bar'){
     const xbar=xx-groupedWidth/2+bw*j;
     marks.push('<rect class="dm-bs-bar" x="'+xbar.toFixed(2)+'" y="'+yy.toFixed(2)+
      '" width="'+bw.toFixed(2)+'" height="'+Math.max(2,bottom-yy).toFixed(2)+
      '" rx="2.5" fill="'+color+'"><title>'+hover+'</title></rect>');
    }else{
     marks.push('<circle class="dm-bs-marker" cx="'+xx.toFixed(2)+'" cy="'+yy.toFixed(2)+
      '" r="3.4" stroke="'+color+'"><title>'+hover+'</title></circle>');
    }
   }
  }
  for(let i=0;i<rows.length;i++){
   marks.push('<text class="dm-bs-x-label" text-anchor="end" transform="translate('+
    (x(i)+3).toFixed(2)+' '+(bottom+24).toFixed(2)+') rotate(-48)">'+esc(periodLabel(rows[i].month,grain))+'</text>');
  }
  const accessibility=compare?plots.map(p=>p.name).join(', '):'Selected branch';
  const svg='<div class="dm-bs-chart-scroll"'+(large?' tabindex="0"':'')+
   ' aria-label="Monthly sales chart; swipe or scroll horizontally on small screens">'+
   '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+w+' '+h+
   '" width="'+w+'" height="'+h+'" class="dm-bs-activity-svg" role="img" aria-label="'+
   esc('Historical '+kind+' by '+(grain==='daily'?'day':grain==='yearly'?'year':'month')+' for '+accessibility)+'">'+
   grid.join('')+marks.join('')+'</svg></div>';
  const legend=compare?'<div class="dm-bs-legend" aria-label="Sales by branch">'+
   plots.map(p=>'<span class="dm-bs-legend-entry"><i aria-hidden="true" style="background-color:'+
    p.color+'"></i>'+esc(p.name)+'</span>').join('')+'</div>':
   '<div class="dm-bs-legend" aria-label="Chart legend"><span class="dm-bs-legend-entry">'+
   '<i aria-hidden="true" style="background-color:#7ac64a"></i>'+
   esc(kind==='orders'?'Completed orders':kind==='gross'?'Gross sales':
    kind==='discount'?'Discounts':'Net sales')+'</span></div>';
  return '<div class="dm-bs-chart-frame">'+svg+legend+'</div>';
 }
 const expenseNames=[
  ['stocks','Stocks / ingredient purchases'],['rent','Rent'],['salary','Salary'],
  ['transportation','Transportation'],['electricity','Electricity'],
  ['ice','Ice'],['water','Water'],['misc','Miscellaneous']
 ];
 const statistic=(value,amount=false)=>value==null?'Not available':amount?peso(value):fmt(value);
 function detailCard(label,value,help){
  return '<div class="dm-bs-stat-card"><span>'+esc(label)+'</span><strong>'+
   esc(String(value))+'</strong>'+(help?'<small>'+esc(help)+'</small>':'')+'</div>';
 }
 function branchDetails(month,branch){
  const rec=breakdown?.rows?.find(r=>r.month===month&&String(r.branchId)===String(branch.id));
  if(breakdownState==='loading'&&!rec)return'<p class="dm-bs-muted">Loading branch figures…</p>';
  if(!rec)return'<p class="dm-bs-muted">'+esc(breakdownError||'Detailed branch metrics are unavailable.')+'</p>';
  const cat=rec.expenseCategories||{};
  return '<div class="dm-bs-expanded-content">'+
   '<div class="dm-bs-expanded-title"><h4>'+esc(branch.name)+' — '+esc(dateMonth(month))+'</h4>'+
   '<p>Saved expense inputs and recorded activity for this branch. Staffing and stock alerts are current snapshots.</p></div>'+
   '<div class="dm-bs-expense-breakdown"><h5>Expenses by category</h5>'+
   '<div class="dm-bs-expense-grid">'+expenseNames.map(([key,label])=>
    '<div><span>'+esc(label)+'</span><strong>'+peso(cat[key]||0)+'</strong></div>').join('')+
   '</div><p class="dm-bs-expense-total">Total Store Expenses <strong>'+
    peso(rec.storeExpenses)+'</strong></p></div>'+
   '<div class="dm-bs-stat-grid">'+
   detailCard('Ingredient cost of sales',statistic(rec.ingredientCost,true),
    'Historical recipe / sale-item cost snapshots; separate from purchased stock')+
   detailCard('Active employees',statistic(rec.employees),'Current active cashiers assigned to this branch')+
   detailCard('Stock alerts',statistic(rec.lowStock),'Current below-threshold ingredients')+
   detailCard('Voided transactions',statistic(rec.voided),'Original sale date falls in this month')+
   detailCard('Deleted transactions',statistic(rec.deleted),'Original sale date falls in this month')+
   detailCard('Successful logins · month',statistic(rec.loginCount),'Recorded from 19 Nov 2026 onward')+
   detailCard('Mobile-device logins',statistic(rec.mobileLogins),'Mobile device detected, including mobile web')+
   detailCard('Other device logins',statistic(rec.webLogins),'Web/other detected devices')+
   detailCard('All recorded branch logins',statistic(rec.totalRecordedLogins),
    'Since login event tracking began; excludes earlier logins')+
   '</div><p class="dm-bs-record-note">Store Expenses totals the expense-ledger fields above, including Stocks. It does not automatically include ingredient usage cost again. Login totals only cover recorded, branch-assigned successful sign-ins; mobile web cannot be distinguished reliably from a native POS app.</p></div>';
 }
 function monthTable(){
  if(!data)return'<p class="dm-bs-muted">No reporting data.</p>';
  const details=new Map((breakdown?.rows||[]).map(r=>[String(r.month)+'|'+String(r.branchId),r]));
  const groups=data.branchMonthly||[];
  const cols=7;
  const header='<div class="dm-bs-table-scroll dm-bs-monthly-scroll"><table class="dm-bs-grouped-table">'+
   '<thead><tr><th>Month / Branch</th><th>Gross Sales</th><th>Net Sales</th>'+
   '<th>Store Expenses</th><th>Discounts</th><th>Orders</th><th>Details</th></tr></thead><tbody>';
  let body='';
  for(const month of [...(data.months||[])].reverse()){
   const active=groups.filter(b=>(b.months||[]).some(x=>x.month===month.month));
   const expenseTotals=active.map(b=>details.get(month.month+'|'+b.id)?.storeExpenses);
   const expenseKnown=expenseTotals.length>0&&expenseTotals.every(x=>x!=null);
   const expenseSum=expenseKnown?expenseTotals.reduce((sum,x)=>sum+num(x),0):null;
   body+='<tr class="dm-bs-month-header"><th scope="row">'+esc(dateMonth(month.month))+
    '<span class="dm-bs-month-hint">All selected branches</span></th><td>'+peso(month.gross)+
    '</td><td>'+peso(month.net)+'</td><td>'+statistic(expenseSum,true)+'</td><td>'+
    peso(month.discount)+'</td><td>'+fmt(month.orders)+'</td><td>—</td></tr>';
   for(const branch of active){
    const value=branch.months.find(m=>m.month===month.month)||{};
    const rowKey=month.month+'|'+branch.id;
    const rec=details.get(rowKey);
    const opened=expandedRows.has(rowKey);
    const id='dm-bs-detail-'+rowKey.replace(/[^a-zA-Z0-9-]/g,'-');
    body+='<tr class="dm-bs-month-branch"><th scope="row">'+
     '<button type="button" class="dm-bs-expand" data-bs-expand="'+esc(rowKey)+
     '" aria-expanded="'+opened+'" aria-controls="'+id+'" aria-label="Expand '+esc(branch.name)+
     ' expenses and activity for '+esc(dateMonth(month.month))+'">'+
     '<span class="dm-bs-expand-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m6 9 6 6 6-6"/></svg></span>'+
     '<span>'+esc(branch.name)+'</span></button></th>'+
     '<td>'+peso(value.gross)+'</td><td>'+peso(value.net)+'</td><td>'+
     statistic(rec?.storeExpenses,true)+'</td><td>'+peso(value.discount)+'</td><td>'+
     fmt(value.orders)+'</td><td><button type="button" class="dm-bs-expand dm-bs-expand-action" data-bs-expand="'+
     esc(rowKey)+'" aria-expanded="'+opened+'" aria-controls="'+id+'">'+(opened?'Hide':'View')+'</button></td></tr>'+
     '<tr id="'+id+'" class="dm-bs-expanded-row" data-bs-expanded-row="'+esc(rowKey)+'"'+
     (opened?'':' hidden')+'><td colspan="'+cols+'">'+branchDetails(month.month,branch)+'</td></tr>';
   }
  }
  return header+body+'</tbody></table></div>';
 }
 async function loadMonthDetails(){
  if(!eligible()||view!=='history'||breakdownState==='loading')return;
  if(breakdownState==='ready'&&breakdown)return;
  const token=++breakdownRequest,stamp=session(),expected=signature;
  breakdownState='loading';breakdownError='';
  const content=$('dmBsMonthlyTable');
  if(content)content.innerHTML=monthTable();
  try{
   const api=window.donmacFranchiseUnified?
    '/api/live/dashboard/store-detail':'/api/dashboard/store-detail';
   const result=await fetchJson(api);
   if(token!==breakdownRequest||stamp!==session()||expected!==signature||!eligible()||view!=='history')return;
   breakdown=result;breakdownState='ready';
  }catch(error){
   if(token!==breakdownRequest||stamp!==session()||expected!==signature||view!=='history')return;
   breakdownState='error';breakdownError=error.message||'Unable to fetch branch details.';
  }
  const holder=$('dmBsMonthlyTable');if(holder)holder.innerHTML=monthTable();
 }

 const periodTitle=grain=>grain==='daily'?'Daily sales activity':
  grain==='yearly'?'Yearly sales activity':'Monthly sales activity';
 const periodCaption=grain=>grain==='daily'?'Last 30 days · net sales by branch':
  grain==='yearly'?'Current and previous calendar year · net sales by branch':
  'Last 12 calendar months · net sales by branch';
 const trendKey=(grain=interval)=>signature+'|'+selectedBranch+'|'+grain;
 function historicalSeries(){
  if(interval==='monthly')return{rows:data?.months||[],branchSeries:data?.branchMonthly||[]};
  return trendCache.get(trendKey())||null;
 }
 function historicalChartMarkup(){
  const series=historicalSeries();
  if(!series){
   if(trendError)return '<p class="dm-bs-chart-message" role="alert">'+esc(trendError)+
    ' <button type="button" class="dm-bs-refresh" data-bs-trend-retry>Retry</button></p>';
   return '<p class="dm-bs-chart-message">Loading '+esc(interval)+' net sales…</p>';
  }
  return chart(series.rows||[],'net',chartType,true,series.branchSeries||[],interval);
 }
 function redrawHistoricalChart(){
  const heading=$('dmBsChartHeading'),caption=$('dmBsChartCaption');
  if(heading)heading.textContent=periodTitle(interval);
  if(caption)caption.textContent=periodCaption(interval);
  const holder=$('dmBsFullChart');
  if(holder)holder.innerHTML=historicalChartMarkup();
 }
 async function loadHistoricalSeries(){
  if(!eligible()||view!=='history')return;
  if(interval==='monthly'||trendCache.has(trendKey())){
   trendLoading=false;trendError='';redrawHistoricalChart();return;
  }
  if(trendLoading)return;
  const selectedInterval=interval,selectedBranchId=selectedBranch,
   expectedSignature=signature,stamp=session(),token=++trendRequest;
  trendLoading=true;trendError='';redrawHistoricalChart();
  const params=new URLSearchParams({interval:selectedInterval});
  if(selectedBranchId!=='all')params.set('branchId',selectedBranchId);
  const path=window.donmacFranchiseUnified?
   '/api/live/dashboard/store-trends?':'/api/dashboard/store-trends?';
  try{
   const series=await fetchJson(path+params);
   if(token!==trendRequest||session()!==stamp||expectedSignature!==signature||
    !eligible()||view!=='history'||selectedInterval!==interval||
    selectedBranchId!==selectedBranch)return;
   if(series.interval!==selectedInterval||!Array.isArray(series.rows)||
     !Array.isArray(series.branchSeries))throw Error('Invalid historical sales response.');
   trendCache.set(trendKey(selectedInterval),series);
  }catch(error){
   if(token!==trendRequest||session()!==stamp||expectedSignature!==signature||
    !eligible()||view!=='history'||selectedInterval!==interval)return;
   trendError=error.message||'Unable to load sales for this interval.';
  }finally{
   if(token===trendRequest&&view==='history'&&selectedInterval===interval){
    trendLoading=false;redrawHistoricalChart();
   }
  }
 }
 function renderHistory(){
  if(!data)return;
  const history=$('dmBsHistory'),main=$('dmBsMain');
  if(!history||!main)return;
  const months=data.months||[],sum=col=>months.reduce((s,x)=>s+num(x[col]),0);
  history.innerHTML='<div class="dm-bs-heading">'+
   '<button type="button" class="dm-bs-back" data-bs-history-back>← Back to Store Performance</button>'+
   '<div><p class="dm-bs-overline">BUSINESS · HISTORICAL DETAIL</p><h2>Historical Sales by Month</h2>'+
   '<p>Completed POS sales · last 12 calendar months · '+esc(selectedBranch==='all'?'All branches':
     data.branches.find(x=>String(x.id)===selectedBranch)?.name||'Selected branch')+'</p></div></div>'+
   '<div class="dm-bs-metrics">'+tile('12-month net sales',peso(sum('net')))+
   tile('12-month gross sales',peso(sum('gross')))+tile('Completed orders',fmt(sum('orders')))+
   tile('Total discounts',peso(sum('discount')))+'</div>'+
   '<section class="dm-bs-panel dm-bs-history-panel"><div class="dm-bs-chart-head"><div>'+
   '<h3 id="dmBsChartHeading">'+periodTitle(interval)+'</h3>'+
   '<p id="dmBsChartCaption">'+periodCaption(interval)+'</p></div>'+
   '<div class="dm-bs-controls"><label>Chart Type<select data-bs-chart-type>'+
   '<option value="line"'+(chartType==='line'?' selected':'')+'>Line</option>'+
   '<option value="bar"'+(chartType==='bar'?' selected':'')+'>Bar</option></select></label>'+
   '<label>Period<select data-bs-interval aria-label="Sales time interval">'+
   [['daily','Daily'],['monthly','Monthly'],['yearly','Yearly']].map(([k,v])=>
    '<option value="'+k+'"'+(interval===k?' selected':'')+'>'+v+'</option>').join('')+
   '</select></label></div></div><div id="dmBsFullChart" aria-live="polite">'+historicalChartMarkup()+'</div></section>'+
   '<section class="dm-bs-panel"><h3>Month-by-month breakdown</h3>'+
   '<p>Expand any branch to see its expense inputs, staffing, login, stock and transaction details.</p>'+
   '<div id="dmBsMonthlyTable">'+monthTable()+'</div></section>';
  main.hidden=true;history.hidden=false;view='history';
  void loadMonthDetails();
  void loadHistoricalSeries();
 }
 function renderStore(){
  if(!data)return;
  const main=$('dmBsMain'),history=$('dmBsHistory');
  if(!main||!history)return;
  const branches=data.branchesPerformance||[],summaryData=data.summary||{};
  const branchCount=branches.length;
  const branchIndex=new Map((data.branchMonthly||[]).map((b,i)=>[String(b.id),i]));
  const rows=branches.map((b,i)=>'<tr><td><span class="dm-bs-branch-name">'+
   '<i class="dm-bs-branch-dot" aria-hidden="true" style="background-color:'+
   branchColors[(branchIndex.get(String(b.id))??0)%branchColors.length]+'"></i>'+
   '<strong>'+esc(b.name)+'</strong></span></td><td>'+fmt(b.orders)+
   '</td><td>'+peso(b.gross)+'</td><td>'+peso(b.net)+'</td><td>'+peso(b.expenses)+
   '</td><td>'+(!summaryData.net?'0.0%':(100*num(b.net)/num(summaryData.net)).toFixed(1)+'%')+'</td></tr>').join('');
  main.innerHTML='<div class="dm-bs-heading">'+
   '<button type="button" class="dm-bs-back" data-bs-back>← Back to Dashboard</button>'+
   '<div><p class="dm-bs-overline">BUSINESS PLAN · PERFORMANCE</p><h2>Store Performance</h2>'+
   '<p>'+esc(data.source)+' · '+esc(data.period.start)+' to '+esc(data.period.end)+'</p></div></div>'+
   '<div class="dm-bs-toolbar"><label>Branch<select data-bs-branch>'+
   '<option value="all">All branches</option>'+data.branches.map(b=>
   '<option value="'+esc(b.id)+'"'+(String(b.id)===selectedBranch?' selected':'')+'>'+esc(b.name)+'</option>').join('')+
   '</select></label><label>Reporting period<select data-bs-days>'+
   [7,30,90].map(n=>'<option value="'+n+'"'+(days===n?' selected':'')+'>'+n+' days</option>').join('')+
   '</select></label><button type="button" class="dm-bs-refresh" data-bs-refresh>Refresh</button></div>'+
   (data.complete?'':'<p class="dm-bs-warning">Reporting limit reached; figures reflect retrieved records only.</p>')+
   '<div class="dm-bs-metrics">'+tile('Branches compared',fmt(branchCount))+
   tile('Combined net sales',peso(summaryData.net))+tile('Completed orders',fmt(summaryData.orders))+
   tile('Recorded expenses',peso(summaryData.expenses))+'</div>'+
   '<section class="dm-bs-panel"><h3>Branch performance comparison</h3>'+
   '<p>Completed orders, sales and recorded expenses for the selected reporting period.</p>'+
   '<div class="dm-bs-table-scroll"><table><thead><tr><th>Branch</th><th>Orders</th>'+
   '<th>Gross sales</th><th>Net sales</th><th>Expenses</th><th>Revenue share</th></tr></thead>'+
   '<tbody>'+(rows||'<tr><td colspan="6">No branch sales recorded.</td></tr>')+
   '</tbody></table></div></section>'+
   '<section class="dm-bs-panel"><div class="dm-bs-chart-head"><div><h3>Historical Sales by Month</h3>'+
   '<p>Net sales by branch across the last 12 calendar months</p></div><button type="button" class="dm-bs-open-history" data-bs-history>'+
   'View full breakdown <span aria-hidden="true">→</span></button></div>'+
   '<button type="button" class="dm-bs-history-preview" data-bs-history aria-label="Open full Historical Sales by Month breakdown">'+
   chart(data.months||[],'net','line',false,data.branchMonthly||[])+'</button></section>';
  history.hidden=true;main.hidden=false;view='store';
 }
 function drawFrame(){
  detail.classList.remove('hidden');root.classList.add('dm-business-store-open');
  detail.innerHTML='<div id="dmBsMain"></div><div id="dmBsHistory" hidden></div>';
 }
 async function load(force=false){
  if(!eligible()||view==='closed')return;
  const key=[selectedBranch,days,window.donmacFranchiseUnified?'live':'legacy'].join('|');
  if(!force&&data&&signature===key){renderStore();return;}
  const token=++run,stamp=session();
  detail.innerHTML='<div class="dm-bs-heading"><button class="dm-bs-back" data-bs-back type="button">← Back to Dashboard</button>'+
   '<div><h2>Store Performance</h2><p>Loading verified Business-plan records…</p></div></div>';
  try{
   const loaded=await readStore();
   if(token!==run||session()!==stamp||!eligible()||view==='closed')return;
   data=loaded;signature=key;trendRequest++;trendCache.clear();trendLoading=false;trendError='';
   breakdown=null;breakdownState='idle';breakdownError='';
   expandedRows.clear();drawFrame();renderStore();
  }catch(error){
   if(token!==run||session()!==stamp||!eligible()||view==='closed')return;
   detail.innerHTML='<div class="dm-bs-heading"><button class="dm-bs-back" type="button" data-bs-back>← Back to Dashboard</button>'+
    '<div><h2>Store Performance</h2><p role="alert">'+esc(error.message||'Unable to load records.')+'</p></div></div>';
  }
 }
 function open(target){
  if(!eligible())return;
  origin=target||null;view='store';root.classList.add('dm-business-store-open');
  detail.classList.remove('hidden');detail.scrollIntoView({block:'start',behavior:'instant'});
  load(false);
 }
 summary.addEventListener('click',event=>{
  const target=event.target.closest('[data-business-store]');
  if(target&&summary.contains(target)){event.preventDefault();open(target);}
 });
 detail.addEventListener('click',event=>{
  const target=event.target.closest('[data-bs-back],[data-bs-refresh],[data-bs-history],[data-bs-history-back],[data-bs-expand],[data-bs-trend-retry]');
  if(!target||!eligible())return;
  if(target.hasAttribute('data-bs-trend-retry')){
   trendError='';trendLoading=false;void loadHistoricalSeries();
  }else if(target.hasAttribute('data-bs-expand')){
   const key=target.dataset.bsExpand;
   if(!/^\d{4}-\d{2}\|\d+$/.test(key))return;
   if(expandedRows.has(key))expandedRows.delete(key);else expandedRows.add(key);
   const holder=$('dmBsMonthlyTable');if(holder)holder.innerHTML=monthTable();
  }else if(target.hasAttribute('data-bs-back'))close(true);
  else if(target.hasAttribute('data-bs-refresh')){data=null;load(true);}
  else if(target.hasAttribute('data-bs-history')){renderHistory();}
  else if(target.hasAttribute('data-bs-history-back')){renderStore();}
 });
 detail.addEventListener('change',event=>{
  const el=event.target;
  if(!eligible())return;
  if(el.matches('[data-bs-branch]')){
   selectedBranch=el.value;data=null;load(true);
  }else if(el.matches('[data-bs-days]')){
   const n=Number(el.value);if(![7,30,90].includes(n))return;
   days=n;data=null;load(true);
  }else if(el.matches('[data-bs-chart-type]')){
   chartType=el.value==='bar'?'bar':'line';
   redrawHistoricalChart();
  }else if(el.matches('[data-bs-interval]')){
   if(!['daily','monthly','yearly'].includes(el.value))return;
   interval=el.value;
   // Old requests must never overwrite a newer interval or changed branch.
   trendRequest++;trendLoading=false;trendError='';
   void loadHistoricalSeries();
  }
 });
 window.donmacBusinessStore={setSubscription,sync,clear,onViewChange};
})();
