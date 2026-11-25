/* Main Office Supply Chain analytics; POS-inspired charts, warehouse-only financial semantics. */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
if(!$('warehouseKpis')||window.donmacWarehouseAnalytics)return;
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const peso=x=>'₱'+Number(x||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
const num=x=>Number(x||0).toLocaleString('en-PH',{maximumFractionDigits:0});
const colors=['#0b8064','#ed8023','#3c69df','#8854d3','#d84e82','#10a4b5','#58718a'];
const dayPH=()=>{
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Manila',
  year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date())
  .filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
 return p.year+'-'+p.month+'-'+p.day;
};
const shift=(date,n)=>{const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
const keys={revenue:'Supply Revenue',orders:'Delivered Orders',units:'Units Distributed',
 urgentOrders:'Urgent Distributions',grossProfit:'Gross Profit'};
const fmt=(metric,x)=>['revenue','grossProfit'].includes(metric)?peso(x):num(x);
let result=null,metric='revenue',controller=null,seq=0,periodBranch='all';
const visible=()=>!$('officeApp')?.classList.contains('hidden')&&!$('page-dashboard')?.classList.contains('hidden');
const status=(message,isError=false)=>{const el=$('warehouseStatus');el.textContent=message;el.classList.toggle('is-error',isError)};
function controlParams(){
 const p=new URLSearchParams({period:$('warehousePeriod').value,branchId:$('warehouseBranch').value||'all'});
 if(p.get('period')==='custom'){p.set('from',$('warehouseFrom').value);p.set('to',$('warehouseTo').value)}
 return p;
}
function syncBranches(branches){
 const select=$('warehouseBranch');
 const saved=select.value||periodBranch||'all';
 const sorted=(branches||[]).slice().sort((a,b)=>
  (a.franchise+' '+a.name).localeCompare(b.franchise+' '+b.name));
 const signature=sorted.map(x=>x.id+'|'+x.name+'|'+x.franchise).join(';');
 if(select.dataset.signature!==signature){
  select.replaceChildren(new Option('All franchise branches','all'),
   ...sorted.map(x=>new Option(x.franchise+' · '+x.name,String(x.id))));
  select.dataset.signature=signature;
 }
 select.value=sorted.some(x=>String(x.id)===saved)?saved:'all';
 periodBranch=select.value;
}
function cards(d){
 const t=d.totals;
 const definitions=[
  {label:'Supply Revenue',value:peso(t.revenue),detail:'Delivered supplies + urgent fees, excluding royalties',m:'revenue'},
  {label:'Gross Profit',value:t.grossProfit==null?'Cost incomplete':peso(t.grossProfit),
   detail:t.grossProfit==null?num(t.unknownCostLines)+' delivered line(s) missing cost':
    'Gross margin '+(t.marginPercent==null?'—':t.marginPercent.toFixed(1)+'%'),m:'grossProfit'},
  {label:'Delivered Orders',value:num(t.deliveredOrders),detail:'Completed warehouse distributions',m:'orders'},
  {label:'Requests Received',value:num(t.ordersRequested),detail:'New franchise requests in selected date range',to:'warehouseBacklogHeading'},
  {label:'Units Distributed',value:num(t.units),detail:'Total fulfilled supply packs / units',m:'units'},
  {label:'Requesting Franchisees',value:num(t.requestingFranchisees),detail:'Unique owners supplied in period',to:'warehouseBranchSection'},
  {label:'Urgent Orders',value:num(t.urgentOrders),detail:'Delivered urgent requests',m:'urgentOrders'},
  {label:'Open Requests',value:num(t.openRequests),detail:'Current approval + fulfillment backlog',to:'warehouseBacklogHeading'},
  {label:'Out-of-stock SKUs',value:num(t.outOfStockSkus),detail:'Current active warehouse catalog stockouts',to:'warehouseStockSection'},
  {label:'Uncosted SKUs',value:num(t.missingUnitCostSkus),detail:'Current catalog items with unknown purchase cost',to:'warehouseStockSection'}
 ];
 $('warehouseKpis').innerHTML=definitions.map(x=>
  '<button class="warehouse-kpi'+(x.m===metric?' is-active':'')+
  '" type="button" '+(x.m?'data-warehouse-metric="'+x.m+'" aria-pressed="'+(metric===x.m)+'"':
   'data-warehouse-target="'+x.to+'"')+'>'+
  '<span>'+esc(x.label)+'</span><strong>'+esc(x.value)+'</strong><small>'+esc(x.detail)+'</small>'+
  '<span class="warehouse-kpi-arrow" aria-hidden="true">›</span></button>').join('');
}
function backlog(d){
 const names={PENDING_REVIEW:'Awaiting review',APPEAL_REVIEW:'Appeal review',ON_HOLD:'On hold',
  APPROVED:'Approved / pick pending',PREPARING:'Preparing',DISPATCHED:'Dispatched'};
 const total=d.totals.openRequests||0;
 $('warehouseBacklog').innerHTML=(d.backlog||[]).map(x=>
  '<div class="warehouse-backlog-row"><span>'+esc(names[x.status]||x.status)+'</span>'+
  '<div class="warehouse-bar"><i style="width:'+Math.min(100,Math.max(0,100*x.count/Math.max(1,total)))+'%"></i></div>'+
  '<strong>'+num(x.count)+'</strong></div>').join('')||
  '<p class="warehouse-empty">No open supply requests.</p>';
}
function rows(d){
 $('warehouseBranchRows').innerHTML=d.byBranch.map(x=>
  '<tr><th scope="row">'+esc(x.franchise)+'<small>'+esc(x.name)+'</small></th>'+
  '<td>'+num(x.orders)+'</td><td>'+num(x.units)+'</td><td>'+peso(x.revenue)+'</td>'+
  '<td>'+(x.grossProfit==null?'<span title="Delivered items missing purchase costs">Cost incomplete</span>':
   peso(x.grossProfit))+'</td></tr>').join('')||
   '<tr><td colspan="5">No completed deliveries in this period.</td></tr>';
 $('warehouseProductRows').innerHTML=d.topProducts.map(x=>
  '<tr><th scope="row">'+esc(x.name)+'<small>'+esc(x.uom)+'</small></th>'+
  '<td>'+num(x.quantity)+'</td><td>'+num(x.orders)+'</td><td>'+peso(x.revenue)+'</td></tr>').join('')||
  '<tr><td colspan="4">No delivered supplies in this period.</td></tr>';
 const chips=(items,empty)=>items.length?items.map(x=>
  '<div class="warehouse-exception"><span>'+esc(x.name)+' <small>'+esc(x.uom)+'</small></span>'+
  '<strong>'+(x.stockQty<=0?'0 in stock':'Cost not recorded')+'</strong></div>').join(''):
  '<p class="warehouse-empty">'+esc(empty)+'</p>';
 $('warehouseStockAlerts').innerHTML=chips(d.stockouts,'No active products with zero stock.');
 $('warehouseMissingCosts').innerHTML=chips(d.missingCostProducts,'All active products have purchase costs.');
}
const bucket=(d,mode)=>{
 if(mode==='month')return d.slice(0,7);
 if(mode==='week'){
  const wd=new Date(d+'T00:00:00Z').getUTCDay();
  return shift(d,-((wd+6)%7));
 }
 return d;
};
const sum=(metric,r)=>Number(r[metric]||0);
function branchGroups(d){
 const sorted=(d.byBranch||[]).slice().sort((a,b)=>b.revenue-a.revenue);
 return {major:new Set(sorted.slice(0,6).map(x=>x.id)),top:sorted.slice(0,6),rest:sorted.slice(6)};
}
function pie(d){
 const {top,rest}=branchGroups(d);
 let values=top.map(x=>({name:x.franchise+' · '+x.name,amount:x[metric],id:x.id}));
 if(rest.length)values.push({name:'Other branches ('+rest.length+')',
  amount:rest.some(x=>x[metric]==null)?null:rest.reduce((a,b)=>a+sum(metric,b),0),id:'other'});
 if(values.some(x=>x.amount==null))
  return '<p class="warehouse-empty">Profit shares are unavailable because one or more delivered items have missing purchase costs.</p>';
 if(values.some(x=>x.amount<0))
  return '<p class="warehouse-empty">Negative branch profit cannot be represented as a pie share. Select Line or Bar.</p>';
 values=values.filter(x=>x.amount>0);
 const total=values.reduce((a,x)=>a+x.amount,0);
 if(!total)return '<p class="warehouse-empty">No '+esc(keys[metric].toLowerCase())+' to distribute for this period.</p>';
 let cursor=0;
 const sectors=values.map((x,i)=>{
  const portion=x.amount/total*100,from=cursor;cursor+=portion;
  const angle=(from+portion/2)/100*2*Math.PI-Math.PI/2;
  const x1=150+Math.cos(angle)*(portion>=8?72:111),y1=150+Math.sin(angle)*(portion>=8?72:111);
  return'<g class="warehouse-pie-slice" tabindex="0" aria-label="'+esc(x.name+' '+fmt(metric,x.amount)+' '+portion.toFixed(1)+'%')+'">'+
    '<circle cx="150" cy="150" r="90" fill="none" stroke="'+colors[i%colors.length]+'" stroke-width="96" '+
    'pathLength="100" stroke-dasharray="'+portion.toFixed(4)+' '+(100-portion).toFixed(4)+'" '+
    'stroke-dashoffset="'+(-from).toFixed(4)+'" transform="rotate(-90 150 150)"/>'+
    '<text x="'+x1.toFixed(1)+'" y="'+y1.toFixed(1)+'" dominant-baseline="middle" text-anchor="middle" class="'+(portion>=8?'inside':'outside')+'">'+portion.toFixed(1)+'%</text>'+
    '<title>'+esc(x.name+' · '+fmt(metric,x.amount)+' · '+portion.toFixed(1)+'%')+'</title></g>';
 }).join('');
 const legend=values.map((x,i)=>
  '<div class="warehouse-pie-legend-row"><i style="background:'+colors[i%colors.length]+'"></i>'+
  '<span>'+esc(x.name)+'</span><strong>'+fmt(metric,x.amount)+'</strong>'+
  '<b>'+(x.amount/total*100).toFixed(1)+'%</b></div>').join('');
 return '<div class="warehouse-pie-layout"><svg viewBox="0 0 300 300" role="img" aria-label="Distribution by branch with always-visible percent labels">'+sectors+'</svg>'+
  '<div class="warehouse-pie-legend">'+legend+'</div></div>';
}
function timeline(d,type,interval){
 if(metric==='grossProfit'&&d.totals.unknownCostLines>0)
  return'<p class="warehouse-empty">Gross profit activity requires a recorded unit cost on every delivered line. Other metrics remain available.</p>';
 const {major,top,rest}=branchGroups(d);
 const groups=top.map(x=>({key:String(x.id),label:x.franchise+' · '+x.name}));
 if(rest.length)groups.push({key:'other',label:'Other branches ('+rest.length+')'});
 if(!groups.length)return'<p class="warehouse-empty">No delivered supply orders in the selected period.</p>';
 const raw=(d.trend||[]),map=new Map(),dateSet=new Set();
 for(const item of raw){
  const group=major.has(item.branchId)?String(item.branchId):'other',date=bucket(item.day,interval);
  dateSet.add(date);
  const key=group+'|'+date;
  map.set(key,(map.get(key)||0)+sum(metric,item));
 }
 const dates=[...dateSet].sort();
 if(!dates.length)return'<p class="warehouse-empty">No completed distributions in this period.</p>';
 const width=Math.max(720,Math.min(16000,dates.length*40+140)),height=315;
 const left=90,right=width-28,topY=25,bottom=height-55,span=bottom-topY;
 const max=Math.max(1,...map.values()),rounded=Math.ceil(max/4)||1,y=n=>bottom-Math.max(0,n)/max*span;
 const at=i=>dates.length===1?(left+right)/2:left+(right-left)*i/Math.max(1,dates.length-1);
 const grid=Array.from({length:5},(_,i)=>'<line x1="'+left+'" x2="'+right+'" y1="'+(bottom-i*span/4)+'" y2="'+(bottom-i*span/4)+
  '" stroke="#dbe9df"/><text text-anchor="end" x="'+(left-12)+'" y="'+(bottom-i*span/4+4)+'" font-size="11" fill="#638071">'+
  esc(fmt(metric,max*i/4))+'</text>').join('');
 const step=Math.max(1,Math.ceil(dates.length/12));
 const axes=dates.map((v,i)=>i%step===0||i===dates.length-1?'<text x="'+at(i)+'" y="'+(bottom+23)+'" text-anchor="middle" font-size="10" fill="#617665">'+
  esc(v.slice(5))+'</text>':'').join('');
 const plot=groups.map((g,n)=>{
  const c=colors[n%colors.length],vals=dates.map(date=>map.get(g.key+'|'+date)||0);
  if(type==='bar'){
   const unit=(right-left)/Math.max(1,dates.length),barW=Math.max(2,Math.min(14,unit*.7/groups.length));
   return vals.map((v,i)=>'<rect class="warehouse-bar-shape" x="'+(at(i)+(n-(groups.length-1)/2)*barW-barW/2)+'" y="'+y(v)+'" width="'+(barW-.5)+'" height="'+Math.max(1,bottom-y(v))+
    '" rx="2" fill="'+c+'"><title>'+esc(g.label+' · '+dates[i]+' · '+fmt(metric,v))+'</title></rect>').join('');
  }
  let path='M '+at(0)+' '+y(vals[0]);
  for(let i=1;i<vals.length;i++){
   const x0=at(i-1),x1=at(i),h=(x1-x0)*.38;
   path+=' C '+(x0+h)+' '+y(vals[i-1])+' '+(x1-h)+' '+y(vals[i])+' '+x1+' '+y(vals[i]);
  }
  return'<path d="'+path+'" fill="none" stroke="'+c+'" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>'+
   vals.map((v,i)=>'<circle cx="'+at(i)+'" cy="'+y(v)+'" r="3.4" fill="#fff" stroke="'+c+'" stroke-width="2" tabindex="0">'+
   '<title>'+esc(g.label+' · '+dates[i]+' · '+fmt(metric,v))+'</title></circle>').join('');
 }).join('');
 const legend='<div class="warehouse-trend-legend">'+groups.map((g,i)=>
  '<span><i style="background:'+colors[i%colors.length]+'"></i>'+esc(g.label)+'</span>').join('')+'</div>';
 return legend+'<div class="warehouse-svg-scroll" tabindex="0" aria-label="Scroll distribution trend chart horizontally">'+
  '<svg viewBox="0 0 '+width+' '+height+'" width="'+width+'" height="'+height+'" role="img" aria-label="'+esc(keys[metric]+' by '+interval)+'">'+
  grid+axes+plot+'</svg></div>';
}
function chart(){
 if(!result)return;
 const c=$('warehouseChartType').value,interval=$('warehouseInterval').value;
 $('warehouseChartHeading').textContent=(c==='pie'?'Distribution by Branch · ':'')+keys[metric];
 $('warehouseChartNote').textContent=
  (c==='pie'?'Share of completed warehouse distributions by franchise branch.':
   'Completed warehouse distributions by '+interval+'.')+
  ' '+result.period.from+' to '+result.period.to+' · supply chain figures only.';
 $('warehousePlot').innerHTML=c==='pie'?pie(result):timeline(result,c,interval);
}
function render(){
 if(!result)return;
 cards(result);backlog(result);rows(result);chart();
}
async function load(){
 if(!visible())return;
 const run=++seq;
 controller?.abort();controller=new AbortController();
 const params=controlParams();
 status('Loading warehouse distributions and inventory…');
 $('warehouseApply').disabled=true;
 try{
  const response=await fetch('/api/supply/office/analytics?'+params,{credentials:'same-origin',
   cache:'no-store',signal:controller.signal});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(data.error||'Unable to load warehouse analytics.');
  if(run!==seq||!visible())return;
  if(!Array.isArray(data.trend)||!Array.isArray(data.byBranch)||!data.totals)
   throw Error('Unexpected warehouse analytics response.');
  result=data;syncBranches(data.branches);
  status('Warehouse distribution period: '+data.period.from+' to '+data.period.to+
   ' · '+(data.period.branchId==='all'?'All franchise branches':
   $('warehouseBranch').selectedOptions[0]?.textContent));
  render();
 }catch(err){
  if(run!==seq||err.name==='AbortError')return;
  result=null;status(err.message||'Could not load warehouse insights.',true);
  $('warehousePlot').innerHTML='<p class="warehouse-empty">Unable to load warehouse report. Check the filters and retry.</p>';
 }finally{if(run===seq)$('warehouseApply').disabled=false}
}
const from=$('warehouseFrom'),to=$('warehouseTo'),today=dayPH();
from.max=today;to.max=today;from.value=shift(today,-29);to.value=today;
$('warehousePeriod').addEventListener('change',()=>{
 const custom=$('warehousePeriod').value==='custom';
 $('warehouseCustomDates').hidden=!custom;
 if(!custom)void load();
 else status('Choose the custom From and To dates, then Apply.');
});
$('warehouseBranch').addEventListener('change',()=>{periodBranch=$('warehouseBranch').value;void load()});
$('warehouseApply').addEventListener('click',()=>void load());
$('warehouseRefresh').addEventListener('click',()=>void load());
$('warehouseChartType').addEventListener('change',chart);
$('warehouseInterval').addEventListener('change',chart);
$('page-dashboard').addEventListener('click',event=>{
 const button=event.target.closest('[data-warehouse-nav]');
 if(!button)return;
 const page=button.dataset.warehouseNav;
 if(['requests','catalog'].includes(page))document.querySelector('[data-office-page="'+page+'"]')?.click();
});
$('warehouseKpis').addEventListener('click',event=>{
 const button=event.target.closest('button');
 if(!button||!result)return;
 if(button.dataset.warehouseMetric){
  metric=button.dataset.warehouseMetric;cards(result);chart();
  $('warehouseChartHeading').scrollIntoView({block:'nearest',behavior:'smooth'});
 }else if(button.dataset.warehouseTarget){
  $(button.dataset.warehouseTarget)?.scrollIntoView({block:'start',behavior:'smooth'});
 }
});
document.querySelector('[data-office-page="dashboard"]')?.addEventListener('click',()=>{void load()});
$('officeRefresh')?.addEventListener('click',()=>{if(visible())void load()});
window.donmacWarehouseAnalytics={refresh:load};
})();
