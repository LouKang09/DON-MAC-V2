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
 let plan=null,admin=false,sessionKey=session(),selectedBranch='all',days=30,metric='net',chartType='line';
 let view='closed',data=null,signature='',run=0,origin=null;
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
  if(changed){data=null;signature='';run++;if(view!=='closed')close(false);}
  sync();
 }
 function close(focus){
  run++;view='closed';data=null;signature='';
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
    selectedBranch,branchesPerformance:r.branchesPerformance||[],summary:r.summary||{},
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
  // Only one annual series query plus selected-period / branch comparison.
  const [year,period,...separate]=await Promise.all([
   fetchJson(query(historyStart,today,selected?.id)),
   fetchJson(query(start,today,selected?.id)),
   ...branches.filter(b=>!selected||Number(b.id)===Number(selected.id))
    .map(b=>fetchJson(query(start,today,b.id)))
  ]);
  const map=new Map(months.map(m=>[m,{month:m,net:0,gross:0,discount:0,orders:0}]));
  const daily=Array.isArray(year.trend)?year.trend:[];
  for(let i=0;i<daily.length;i++){
   const point=daily[i],day=dayOffset(year.from,i),record=map.get(day.slice(0,7));
   if(!record)continue;
   record.net+=num(point.actual);record.gross+=num(point.gross);record.discount+=num(point.discount);
   record.orders+=num(point.transactions);
  }
  const monthRows=[...map.values()].map(m=>Object.fromEntries(Object.entries(m).map(([key,value])=>
   [key,typeof value==='number'?Math.round(value*100)/100:value])));
  const ranked=branches.filter(b=>!selected||Number(b.id)===Number(selected.id)).map((b,i)=>({
   id:Number(b.id),name:String(b.name),net:num(separate[i].rangeActual),
   gross:num(separate[i].rangeGross),expenses:num(separate[i].rangeExpenses),
   orders:num(separate[i].rangeTransactions)
  })).sort((a,b)=>b.net-a.net);
  return {period:{days,start,end:today},months:monthRows,branches,selectedBranch,
   branchesPerformance:ranked,complete:true,
   summary:{net:num(period.rangeActual),gross:num(period.rangeGross),
    expenses:num(period.rangeExpenses),orders:num(period.rangeTransactions),
    voided:0},source:'Workspace-isolated live POS sales and branch expense totals'};
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
 function chart(rows,kind='net',type='line',large=false){
  const values=rows.map(r=>Math.max(0,num(r[kind]))),high=Math.max(0,...values),step=niceStep(high);
  const max=step*4,w=large?1120:900,h=large?390:250;
  const l=large?105:92,r=23,t=22,b=large?91:69,plotW=w-l-r,plotH=h-t-b;
  const x=i=>l+(rows.length===1?plotW/2:i*plotW/(rows.length-1));
  const y=v=>t+plotH*(1-v/max);
  const monetary=kind!=='orders',amount=v=>monetary?peso(v):fmt(v);
  const grid=[];
  for(let tick=0;tick<=4;tick++){
   const yy=y(tick*step);
   grid.push('<line x1="'+l+'" y1="'+yy.toFixed(2)+'" x2="'+(w-r)+'" y2="'+yy.toFixed(2)+
    '" stroke="#dcebe0" stroke-width="1"/>');
   grid.push('<text x="'+(l-12)+'" y="'+(yy+4).toFixed(2)+'" text-anchor="end" '+
    'fill="#355643" font-size="12">'+esc(amount(tick*step))+'</text>');
  }
  const marks=[];
  const barWidth=Math.min(46,plotW/Math.max(1,rows.length)*.5);
  if(type==='line'){
   marks.push('<polyline points="'+values.map((v,i)=>x(i).toFixed(2)+','+y(v).toFixed(2)).join(' ')+
    '" stroke="#19804d" stroke-width="2.7" fill="none" stroke-linejoin="round" stroke-linecap="round"/>');
  }
  for(let i=0;i<rows.length;i++){
   const xx=x(i),yy=y(values[i]),desc=esc(dateMonth(rows[i].month)+' · '+amount(values[i]));
   marks.push(type==='line'
    ?'<circle cx="'+xx.toFixed(2)+'" cy="'+yy.toFixed(2)+'" r="4.7" fill="#fff" stroke="#178a51" stroke-width="2.5"><title>'+desc+'</title></circle>'
    :'<rect x="'+(xx-barWidth/2).toFixed(2)+'" y="'+yy.toFixed(2)+'" width="'+barWidth.toFixed(2)+
      '" height="'+Math.max(2,t+plotH-yy).toFixed(2)+'" rx="3" fill="#168251"><title>'+desc+'</title></rect>');
   marks.push('<text x="'+xx.toFixed(2)+'" y="'+(h-20)+'" text-anchor="end" transform="rotate(-45 '+xx.toFixed(2)+' '+(h-20)+
    ')" fill="#3e5c49" font-size="12">'+esc(dateMonth(rows[i].month))+'</text>');
  }
  const alt=esc('Historical '+kind+' by month; '+rows.map(r=>dateMonth(r.month)+' '+amount(r[kind])).join('; '));
  return '<div class="dm-bs-chart-scroll"'+(large?' tabindex="0"':'')+' aria-label="Historical monthly chart, scroll to view">'+
   '<svg viewBox="0 0 '+w+' '+h+'" width="'+w+'" height="'+h+'" role="img" aria-label="'+alt+'">'+
   grid.join('')+marks.join('')+'</svg></div>';
 }
 function chartTable(months){
  return '<div class="dm-bs-table-scroll"><table><thead><tr><th>Month</th><th>Gross sales</th><th>Net sales</th>'+
   '<th>Discounts</th><th>Orders</th></tr></thead><tbody>'+
   months.map(x=>'<tr><th>'+esc(dateMonth(x.month))+'</th><td>'+peso(x.gross)+'</td><td>'+peso(x.net)+
    '</td><td>'+peso(x.discount)+'</td><td>'+fmt(x.orders)+'</td></tr>').join('')+
   '</tbody></table></div>';
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
   '<h3>Monthly sales activity</h3><p>Interactive values from completed POS transactions</p></div>'+
   '<div class="dm-bs-controls"><label>Chart Type<select data-bs-chart-type>'+
   '<option value="line"'+(chartType==='line'?' selected':'')+'>Line</option>'+
   '<option value="bar"'+(chartType==='bar'?' selected':'')+'>Bar</option></select></label>'+
   '<label>Metric<select data-bs-metric>'+
   [['net','Net sales'],['gross','Gross sales'],['discount','Discounts'],['orders','Orders']].map(([k,v])=>
    '<option value="'+k+'"'+(metric===k?' selected':'')+'>'+v+'</option>').join('')+
   '</select></label></div></div><div id="dmBsFullChart">'+chart(months,metric,chartType,true)+'</div></section>'+
   '<section class="dm-bs-panel"><h3>Month-by-month breakdown</h3>'+chartTable(months)+'</section>';
  main.hidden=true;history.hidden=false;view='history';
 }
 function renderStore(){
  if(!data)return;
  const main=$('dmBsMain'),history=$('dmBsHistory');
  if(!main||!history)return;
  const branches=data.branchesPerformance||[],summaryData=data.summary||{};
  const branchCount=branches.length;
  const rows=branches.map((b,i)=>'<tr><td><strong>'+esc(b.name)+'</strong></td><td>'+fmt(b.orders)+
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
   '<p>Net sales across the last 12 calendar months</p></div><button type="button" class="dm-bs-open-history" data-bs-history>'+
   'View full breakdown <span aria-hidden="true">→</span></button></div>'+
   '<button type="button" class="dm-bs-history-preview" data-bs-history aria-label="Open full Historical Sales by Month breakdown">'+
   chart(data.months||[],'net','line',false)+'</button></section>';
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
   data=loaded;signature=key;drawFrame();renderStore();
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
  const target=event.target.closest('[data-bs-back],[data-bs-refresh],[data-bs-history],[data-bs-history-back]');
  if(!target||!eligible())return;
  if(target.hasAttribute('data-bs-back'))close(true);
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
  }else if(el.matches('[data-bs-chart-type],[data-bs-metric]')){
   if(el.matches('[data-bs-chart-type]'))chartType=el.value==='bar'?'bar':'line';
   else if(['net','gross','discount','orders'].includes(el.value))metric=el.value;
   const holder=$('dmBsFullChart');
   if(holder&&data)holder.innerHTML=chart(data.months||[],metric,chartType,true);
  }
 });
 window.donmacBusinessStore={setSubscription,sync,clear,onViewChange};
})();
