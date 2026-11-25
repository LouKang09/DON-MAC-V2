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
  expenses:'Store Expenses',deposited:'Deposited Sales',discount:'Discount',alerts:'Low Stock Alerts'};
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
 const chartKeys=Object.keys(titles);
 const chartTypes=['line','bar','pie'];
 let chartPreferences={defaultType:'line',overrides:{}},chartSettingsSession=null;
 let chartSettingsLoading=0;
 const chartTypeFor=key=>chartPreferences.overrides[key]||chartPreferences.defaultType;
 const settingField=id=>document.getElementById(id);
 function renderChartPreferences(){
  const target=settingField('dmChartPreferenceTarget'),type=settingField('dmChartPreferenceType'),
   override=settingField('dmChartPreferenceOverride');
  if(!target||!type||!override)return;
  const key=target.value;
  override.disabled=key==='all';
  if(key==='all'){
   override.value='inherit';type.value=chartPreferences.defaultType;type.disabled=false;
  }else{
   override.value=chartPreferences.overrides[key]?'custom':'inherit';
   type.value=chartTypeFor(key);type.disabled=override.value!=='custom';
  }
 }
 function chartSettingsStatus(message){
  const status=settingField('dmChartPreferenceStatus');
  if(status)status.textContent=message;
 }
 const settingsTarget=settingField('dmChartPreferenceTarget'),
  settingsType=settingField('dmChartPreferenceType'),
  settingsOverride=settingField('dmChartPreferenceOverride'),
  settingsSave=settingField('dmChartPreferenceSave');
 settingsTarget?.addEventListener('change',renderChartPreferences);
 settingsOverride?.addEventListener('change',()=>{
  const key=settingsTarget?.value;
  if(!chartKeys.includes(key))return;
  if(settingsOverride.value==='inherit')delete chartPreferences.overrides[key];
  else chartPreferences.overrides[key]=settingsType?.value||chartPreferences.defaultType;
  renderChartPreferences();
  chartSettingsStatus('Unsaved changes. Select Save chart preferences.');
 });
 settingsType?.addEventListener('change',()=>{
  if(!chartTypes.includes(settingsType.value))return;
  if(settingsTarget?.value==='all')chartPreferences.defaultType=settingsType.value;
  else if(chartKeys.includes(settingsTarget?.value)&&settingsOverride?.value==='custom')
   chartPreferences.overrides[settingsTarget.value]=settingsType.value;
  chartSettingsStatus('Unsaved changes. Select Save chart preferences.');
 });
 settingsSave?.addEventListener('click',async()=>{
  if(!settingsValid())return;
  settingsSave.disabled=true;
  chartSettingsStatus('Saving your chart preferences…');
  try{
   const result=await context.request('/api/dashboard/chart-preferences',{
    method:'PUT',body:chartPreferences
   });
   if(!settingsValid())return;
   chartPreferences={
    defaultType:chartTypes.includes(result.defaultType)?result.defaultType:'line',
    overrides:result.overrides||{}
   };
   renderChartPreferences();
   chartSettingsStatus('Saved for this Owner account. Your dashboard drill-downs will use these defaults.');
  }catch(error){if(settingsValid())chartSettingsStatus('Unable to save: '+(error.message||'Please retry.'))}
  finally{settingsSave.disabled=false;}
 });
 async function loadChartPreferences(){
  if(!settingsValid())return;
  const session=context.session,run=++chartSettingsLoading;
  chartSettingsStatus('Loading your saved chart defaults…');
  try{
   const pref=await context.request('/api/dashboard/chart-preferences');
   if(run!==chartSettingsLoading||!settingsValid()||context.session!==session)return;
   chartPreferences={
    defaultType:chartTypes.includes(pref?.defaultType)?pref.defaultType:'line',
    overrides:Object.fromEntries(Object.entries(pref?.overrides||{}).filter(
     ([key,type])=>chartKeys.includes(key)&&chartTypes.includes(type)))
   };
   renderChartPreferences();
   chartSettingsStatus('Saved defaults loaded. Select a category to customize its chart.');
  }catch(error){
   if(run===chartSettingsLoading&&settingsValid())
    chartSettingsStatus('Could not load chart defaults: '+(error.message||'Please retry.'));
  }
 }
 const settingsValid=()=>!!context&&context.role==='Admin'&&
  !app.classList.contains('hidden')&&!app.inert&&
  (!window.donmacSessionGeneration||window.donmacSessionGeneration()===context.session);
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
 content.addEventListener('submit',async event=>{
  if(event.target?.id!=='dmShiftDepositForm')return;
  event.preventDefault();
  if(current!=='today'||context?.role!=='User'||!valid())return;
  const amountInput=$('dmShiftDepositAmount'),status=$('dmShiftDepositStatus');
  const amount=Number(amountInput?.value);
  if(!amountInput?.value||!Number.isFinite(amount)||amount<0||
    amount>99999999.99||Math.abs(amount*100-Math.round(amount*100))>0.00001){
   if(status)status.textContent='Enter a valid peso amount with up to two decimal places.';
   return;
  }
  const button=event.target.querySelector('button[type="submit"]');
  if(button?.disabled)return;
  if(button)button.disabled=true;
  if(status)status.textContent='Saving your end-of-shift deposit…';
  const run=activeRequest;
  try{
   await context.request('/api/dashboard/shift-deposits',{method:'POST',body:{amount}});
   if(run===activeRequest&&valid()&&current==='today')await open('today',null);
  }catch(error){
   if(run===activeRequest&&valid()&&status)status.textContent=error.message||'Unable to record deposit.';
  }finally{
   if(button&&button.isConnected)button.disabled=false;
  }
 });
 summary.addEventListener('click',event=>{
  const btn=event.target.closest('button[data-dm-kpi]');
  if(btn&&summary.contains(btn)&&valid())open(btn.dataset.dmKpi,btn);
 });
 function query(period,branch){
  const p=new URLSearchParams();
  if(period.view==='custom'){p.set('view','custom');p.set('from',period.from);p.set('to',period.to);}
  else p.set('view',period.view);
  if(period.aggregate==='hourly')p.set('aggregate','hourly');
  if(branch)p.set('branchId',String(branch));
  return '/api/dashboard?'+p.toString();
 }
 function selectedPeriod(key){
  const today=payload.today||payload.to;
  if(key==='today'||key==='deposited'&&context.role==='User')
   return{view:'hourly',from:today,to:today,description:'Today · Philippine time'};
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
  return number(({revenue:d?.rangeRevenueNet,orders:d?.rangeTransactions,
   today:m.todayNetAfterExpenses,month:m.monthActual,expenses:d?.rangeTotalStoreExpenses,
   deposited:d?.shiftDeposits?.total,discount:d?.rangeDiscount,
   alerts:m.lowStockCount})[key]);
 };
 function overview(d,key){
  const m=d.metrics||{},fmt=x=>x==null?'Not available':money(x),metrics=[
   ['Completed orders',count(d.rangeTransactions)],
   ['Average order value',money(d.rangeTransactions?d.rangeActual/d.rangeTransactions:0)],
   ['Revenue after ingredient costs',fmt(d.rangeRevenueNet)],
   ['Gross revenue (before discounts)',money(d.rangeGross)],
   ['Discounts',money(d.rangeDiscount)],
   ['Staff-entered expenses',fmt(d.rangeDepositExpenses)],
   ['Cost Amount · sold ingredients',fmt(d.rangeStoreExpenses)],
   ['Sales Deposit Actual',fmt(d.shiftDeposits?.total)],
   ['Low-stock ingredients',count(m.lowStockCount)],
   ['Ingredients monitored',count(m.inventoryCount)],
   ['Store Expenses',fmt(d.rangeTotalStoreExpenses)],
   ['Completed net POS sales · before costs',money(d.rangeActual)]
  ];
  const special={
   revenue:[['Net revenue · after Cost of Goods',fmt(d.rangeRevenueNet)],
    ['Cost of Goods',fmt(d.rangeStoreExpenses)],
    ['Discount',money(d.rangeDiscount)],
    ['Completed POS sales after discounts',money(d.rangeActual)],
    ['Gross revenue before discounts',money(d.rangeGross)],
    ['Completed orders',count(d.rangeTransactions)]],
   orders:[0,1,11,3,4],
   today:[['Today net sales · after expenses',fmt(m.todayNetAfterExpenses)],
    ['Today completed POS sales',money(m.todayActual)],
    ['Store Expenses',fmt(m.todayExpenses)],
    ['Sale Deposit Amount',d.shiftDepositError?'Unavailable':d.shiftDeposits?.total==null?'Not recorded':money(d.shiftDeposits.total)],
    ['Today gross sales',money(m.todayGross)],
    ['Today completed orders',count(m.todayTransactions)]],
   month:[['Period net sales',money(m.monthActual)],['Period gross revenue',money(m.monthGross)],
    ['Period orders',count(m.monthTransactions)],['Average period order',money(m.monthTransactions?m.monthActual/m.monthTransactions:0)]],
   expenses:[
    ['Store Expenses Sold Ingredients / Cost of Goods',fmt(d.rangeStoreExpenses)],
    ['Net Revenue',fmt(d.rangeRevenueNet)],
    ['Completed orders',count(d.rangeTransactions)],
    ['Ingredient Cost / Net Sales %',
      d.rangeRevenueNet==null||d.rangeStoreExpenses==null?'Not available':
      pct(d.rangeStoreExpenses,d.rangeRevenueNet)],
    ['Store Expenses',fmt(d.rangeDepositExpenses)]],
   deposited:[
    ['Gross Revenue',money(d.rangeGross)],
    ['Sales Deposit Actual',d.shiftDepositError?'Unavailable':
      d.shiftDeposits?.total==null?'Not recorded':money(d.shiftDeposits.total)],
    ['Deposited Sales - calculated',
      d.rangeDepositExpenses==null?'Not available':money(number(d.rangeActual)-number(d.rangeDepositExpenses))],
    ['Staff-entered Expenses',
      d.rangeDepositExpenses==null?'Not available':money(d.rangeDepositExpenses)],
    ['Staff Expenses / Net Sales %',
      d.rangeDepositExpenses==null?'Not available':pct(d.rangeDepositExpenses,d.rangeActual)]],
   discount:[4,3,11,['Discount rate / gross',pct(d.rangeDiscount,d.rangeGross)],0],
   alerts:[8,9,['Alert rate',pct(m.lowStockCount,m.inventoryCount)]]
  };
  const items=(special[key]||[]).map(x=>typeof x==='number'?metrics[x]:x);
  return '<div class="dm-kpi-tiles">'+items.map(([n,v])=>box(n,v)).join('')+'</div>'+
   (key==='revenue'&&d.rangeStoreExpensesBasis==='current_recipe_estimate'?
    '<p class="dm-kpi-empty">Cost of Goods is an estimate based on current recipes for older sales; those historical receipts do not contain immutable recipe-cost snapshots.</p>':'');
 }
 function branchTable(rows,key,total){
  if(!rows.length)return empty('No branch comparisons are available for the selected period.');
  const financial=['revenue','today','month','expenses','deposited','discount'].includes(key);
  const metricLabel=key==='orders'?'Completed orders':key==='alerts'?'Low-stock count':
    key==='expenses'?'Store Expenses':key==='deposited'?'Sales Deposit Actual':
    key==='today'?'Sales after staff expenses':key==='revenue'?'Revenue after ingredient costs':
    key==='discount'?'Discounts':'Net sales';
  let html='<div class="dm-kpi-table-scroll"><table><thead><tr><th>Branch</th><th>'+esc(metricLabel)+
   '</th><th>'+ (key==='alerts'?'Ingredients':key==='orders'?'Net POS sales':
    key==='deposited'?'Gross Revenue':'Orders')+'</th><th>Share of branch total</th></tr></thead><tbody>';
  for(const row of rows){
   const d=row.data;
   const extras=key==='alerts'?count(d.metrics?.inventoryCount):key==='orders'?money(d.rangeActual):
    key==='deposited'?money(d.rangeGross):
    count(key==='today'?d.metrics?.todayTransactions:key==='month'?d.metrics?.monthTransactions:d.rangeTransactions);
   html+='<tr'+(row.selected?' class="dm-kpi-selected-branch"':'')+'><th scope="row">'+esc(row.name)+
    (row.selected?' <span class="dm-kpi-current">Selected</span>':'')+'</th><td class="dm-kpi-number">'+
    ((key==='deposited'&&d.shiftDeposits?.total==null)||
      (key==='expenses'&&d.rangeTotalStoreExpenses==null)||
      (key==='revenue'&&d.rangeRevenueNet==null)||
      (key==='today'&&d.metrics?.todayNetAfterExpenses==null)?'Not available':
     financial?money(value(d,key)):count(value(d,key)))+'</td><td class="dm-kpi-number">'+extras+
    '</td><td class="dm-kpi-number">'+
    ((key==='deposited'&&d.shiftDeposits?.total==null)||
     (key==='expenses'&&d.rangeTotalStoreExpenses==null)||
     (key==='revenue'&&d.rangeRevenueNet==null)||
     (key==='today'&&d.metrics?.todayNetAfterExpenses==null)?'—':pct(value(d,key),total))+'</td></tr>';
  }
  html+='</tbody></table></div>';
  return html;
 }
 function categoryPanel(d,key){
  if(['expenses','deposited','alerts'].includes(key))return'';
  const groups=new Map();
  for(const item of d.categoryItems||[]){
   const name=String(item.category||'Other');
   if(!groups.has(name))groups.set(name,[]);
   groups.get(name).push({name:String(item.name||'Unnamed item'),
    quantity:number(item.quantity),net:number(item.net)});
  }
  let amounts=(d.categoryTrends||[]).map(x=>({
   name:x.name,amount:(x.values||[]).reduce((sum,v)=>sum+number(v),0)
  }));
  for(const [name,items] of groups){
   if(!amounts.some(x=>x.name===name))
    amounts.push({name,amount:items.reduce((sum,item)=>sum+item.net,0)});
  }
  const note='Net sales in the selected period; expand a category to see sold menu items and quantities.';
  amounts=amounts.filter(x=>x.amount>0||groups.has(x.name)).sort((a,b)=>b.amount-a.amount);
  if(!amounts.length)return panel('Menu category breakdown',empty('No completed category sales in this period.'),note);
  const total=amounts.reduce((sum,x)=>sum+x.amount,0);
  const bars=amounts.map(group=>{
   const items=(groups.get(group.name)||[]).sort((a,b)=>b.net-a.net||a.name.localeCompare(b.name));
   const productLines=items.length?items.map(item=>
    '<li><span>'+esc(item.name)+'</span><span>'+esc(count(item.quantity))+' sold</span>'+
    '<strong>'+esc(money(item.net))+'</strong></li>').join(''):
    '<li class="dm-category-noitems">Item details are not available for this period.</li>';
   return '<details class="dm-kpi-category"><summary>'+
    '<span class="dm-category-title">'+esc(group.name)+
    '<span class="dm-category-caret" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="m6 9 6 6 6-6"/></svg></span></span>'+
    '<span class="dm-category-amount">'+esc(money(group.amount))+' · '+esc(pct(group.amount,total))+'</span>'+
    '<span class="dm-kpi-bar-track" aria-hidden="true"><span style="width:'+
    Math.max(0,Math.min(100,total>0?100*group.amount/total:0)).toFixed(2)+'%"></span></span>'+
    '</summary><ul class="dm-category-items">'+productLines+'</ul></details>';
  }).join('');
  return panel('Menu category breakdown',bars,note);
 }
 // The headline activity visual applies to all seven dashboard drill-downs.
 // Only the permitted, signed-in branch scope is fetched. Expenses and stock
 // have no historical hourly series, so those pages show contextual net sales.
 let chosenChartType='line',activityLoadSequence=0;
 const addDays=(day,delta)=>new Date(Date.parse(day+'T00:00:00Z')+delta*86400000).toISOString().slice(0,10);
 function activityDates(period,interval){
  const latest=period.to;
  if(interval==='hourly')return{view:'custom',from:period.from,to:period.to,aggregate:'hourly'};
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
  const isContext=key==='deposited'||key==='alerts';
  const displayLabel=key==='orders'?'Completed orders':key==='discount'?'Discounts':
   key==='deposited'?'Gross Revenue (context)':isContext?'Net sales (context)':'Gross sales';
  return '<section class="dm-kpi-panel dm-activity-panel" aria-label="Sales activity chart">'+
   '<div class="dm-activity-head"><div><h3 id="dmActivitySeriesName">'+esc(displayLabel)+'</h3>'+
   '<p class="dm-activity-subtitle" id="dmActivityDescription">'+
   (isContext?'Completed POS net sales for context; not a historical cost or deposit series.':
    'Completed POS sales from the selected dashboard branch scope.')+'</p></div>'+
   '<div class="dm-activity-controls">'+
   '<label for="dmActivityType">Chart Type<select id="dmActivityType" aria-label="Chart type">'+
   '<option value="line"'+(chosenChartType==='line'?' selected':'')+'>Line</option>'+
   '<option value="bar"'+(chosenChartType==='bar'?' selected':'')+'>Bar</option>'+   '<option value="pie"'+(chosenChartType==='pie'?' selected':'')+'>Pie</option></select></label>'+
   '<label for="dmActivityInterval">Interval<select id="dmActivityInterval" aria-label="Sales activity interval">'+
   '<option value="hourly"'+(defaultInterval==='hourly'?' selected':'')+'>Hourly</option>'+
   '<option value="daily"'+(defaultInterval==='daily'?' selected':'')+'>Daily</option></select></label>'+
   '</div></div><p class="dm-activity-range" id="dmActivityRange" aria-live="polite"></p>'+
   '<div id="dmActivityPlot" class="dm-activity-plot" aria-live="polite">'+
   '<p class="dm-kpi-loading">Loading sales activity…</p></div>'+
   '</section>';
 }
 async function mountActivityChart(main,period,key,run){
  const plot=$('dmActivityPlot'),type=$('dmActivityType'),interval=$('dmActivityInterval');
  if(!plot||!type||!interval||!valid())return;
  let sequence=0;
  async function load(){
   const fetchId=++sequence,requestId=++activityLoadSequence;
   const mode=interval.value,range=activityDates(period,mode);
   plot.innerHTML='<p class="dm-kpi-loading">Loading '+esc(type.value)+' chart…</p>';
   try{
    const canReuse=main.from===range.from&&main.to===range.to&&
     ((mode==='hourly'&&main.grain==='hourly')||(mode==='daily'&&main.grain==='daily'));
    const all=context.selectedBranch==='all'||!context.selectedBranch;
    const allowed=(context.branches||[]).filter(b=>b&&b.active!==false&&Number(b.id)>0);
    // The selected graph can show all branches at once, rather than drawing
    // one misleading aggregate line. Every request is tenant-scoped server-side.
    let datasets=[];
    const branchRequests=all&&allowed.length>1?allowed:
     [{id:context.selectedBranch||allowed[0]?.id,name:allowed.find(b=>
       String(b.id)===String(context.selectedBranch))?.name||allowed[0]?.name||'Selected branch'}];
    for(let i=0;i<branchRequests.length;i+=5){
     const responses=await Promise.allSettled(branchRequests.slice(i,i+5).map(async branch=>{
      const single=branchRequests.length===1;
      const data=single&&canReuse?main:await context.request(query(range,branch.id));
      if(key==='deposited'){
       // Deposits are staff-entered per shift/day. Pie charts use recorded
       // amounts by branch, never approximated sales or a fabricated hourly deposit.
       const q=new URLSearchParams({from:period.from,to:period.to});
       if(branch.id)q.set('branchId',branch.id);
       try{
        const deposits=await context.request('/api/dashboard/shift-deposits?'+q);
        data.shiftDeposits=deposits;
       }catch(e){data.shiftDepositError=e.message||'Deposit totals unavailable';}
      }
      return{name:branch.name||'Branch '+branch.id,data};
     }));
     if(fetchId!==sequence||requestId!==activityLoadSequence||run!==activeRequest||!valid())return;
     datasets.push(...responses.filter(x=>x.status==='fulfilled').map(x=>x.value));
    }
    if(fetchId!==sequence||requestId!==activityLoadSequence||run!==activeRequest||!valid())return;
    if(!datasets.length)throw Error('No authorized branch activity could be loaded.');
    const renderer=window.donmacKpiChartRenderer;
    if(!renderer)throw Error('Chart engine is unavailable. Refresh the page.');
    const description=$('dmActivityRange'),heading=$('dmActivitySeriesName');
    if(description){
     description.textContent=(mode==='hourly'?
      'Same-hour transactions combined across '+range.from+(range.from!==range.to?' to '+range.to:''):
      'Daily · '+range.from+(range.from!==range.to?' to '+range.to:''))+
      ' · '+(datasets.length>1?datasets.length+' separately plotted branches':datasets[0].name);
    }
    if(heading)heading.textContent=type.value==='pie'?
     'Distribution by '+(key==='expenses'?'expense category':datasets.length>1?'branch':'time period'):
     key==='orders'?'Completed orders':key==='discount'?'Applied discounts':
     (key==='deposited'||key==='expenses'||key==='alerts'?'Gross sales · context':'Gross sales');
    renderer.draw(plot,{datasets,key,interval:mode,type:type.value,main});
   }catch(error){
    if(fetchId!==sequence||requestId!==activityLoadSequence||run!==activeRequest||!valid())return;
    plot.innerHTML=empty('Sales activity chart unavailable: '+(error.message||'Please retry.'));
   }
  }
  type.addEventListener('change',()=>{
   if(!chartTypes.includes(type.value))return;
   chosenChartType=type.value;
   void load();
  });
  interval.addEventListener('change',()=>{
   if(!['hourly','daily'].includes(interval.value))return;
   void load();
  });
  await load();
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
   return panel('Expenses by category',empty('Your account does not have permission to view expense ledger categories.'),
    'Only permitted expense records can be displayed.');
  let categoryTotals=main.rangeExpenseCategories;
  // The dashboard carries its OWN ledger category totals from precisely the
  // same database scope and dates as the expense KPI. An unrelated paginated
  // finance call previously left this chart empty despite actual expenses.
  if(!categoryTotals||typeof categoryTotals!=='object'){
   try{
    const params=new URLSearchParams({start:period.from,end:period.to,page:'1'});
    if(context.selectedBranch&&context.selectedBranch!=='all')params.set('branchId',context.selectedBranch);
    const data=await context.request('/api/finance/expenses?'+params);
    if(run!==activeRequest||!valid())return'';
    categoryTotals=data?.summary;
   }catch(error){
    return panel('Expenses by category',empty('Unable to load expense categories: '+(error.message||'Please retry.')),
     'Only expenses from the selected branch and reporting dates are included.');
   }
  }
  if(!categoryTotals||typeof categoryTotals!=='object')
   return panel('Expenses by category',empty('Expense category totals are unavailable for this period.'),
    'Refresh the dashboard and retry.');
  const total=expenses.reduce((sum,key)=>sum+number(categoryTotals[key]),0);
  if(!total&&number(main.rangeDepositExpenses)>0)
   return panel('Expenses by category',
    empty('Recorded expenses exist, but their category breakdown could not be reconciled. Please refresh.'),
    'The displayed expense amount is preserved; no categories have been estimated.');
  const discrepancy=main.rangeDepositExpenses!=null&&
   Math.abs(total-number(main.rangeDepositExpenses))>0.02;
  const note=discrepancy?
   'The grouped expense amount does not match the ledger total; check the same date and branch filters.':
   'Actual staff-entered expenses for this reporting period. Hover or focus each segment for its peso amount.';
  const markup=window.donmacExpensePie?.markup(categoryTotals);
  return panel('Expenses by category','<div class="dm-expense-pie-host">'+
   (markup||empty('The expense chart is unavailable. Please refresh.'))+'</div>',note);
 }
 async function open(key,source){
  if(!titles[key]||!valid())return;
  if(source){previousFocus=source;chosenChartType=chartTypeFor(key);}
  const run=++activeRequest;
  current=key;
  const period=selectedPeriod(key);
  const selectedName=context.selectedBranch&&context.selectedBranch!=='all'
   ?(context.branches.find(b=>String(b.id)===String(context.selectedBranch))?.name||'Selected branch'):'All permitted branches';
  root.classList.add('dm-kpi-detail-open');
  detail.classList.remove('hidden');
  title.textContent=titles[key];
  scope.textContent=period.description+' · '+selectedName;
  content.innerHTML='<p class="dm-kpi-loading">Loading verified dashboard records and branch comparison…</p>';
  if(source){back.focus();detail.scrollIntoView({block:'start',behavior:'instant'});}
  try{
   const d=payload;
   let main=d;
   if(key==='today'||key==='month'&&(context.role==='Admin'||context.live))
    main=await context.request(query(period,context.selectedBranch==='all'?null:context.selectedBranch));
   if(run!==activeRequest||!valid())return;
   if(key==='today'||key==='deposited'){
    const params=key==='today'?
     new URLSearchParams({date:period.to}):
     new URLSearchParams({from:period.from,to:period.to});
    if(context.selectedBranch&&context.selectedBranch!=='all')params.set('branchId',context.selectedBranch);
    try{
     const shiftDeposits=await context.request('/api/dashboard/shift-deposits?'+params);
     if(run!==activeRequest||!valid())return;
     main={...main,shiftDeposits};
    }catch(error){
     if(run!==activeRequest||!valid())return;
     main={...main,shiftDepositError:error.message||'Cannot load shift deposits'};
    }
   }
   const isAdmin=context.role==='Admin';
   const branches=(context.branches||[]).filter(b=>b&&b.active!==false&&Number(b.id)>0);
   const compare=isAdmin&&branches.length>1;
   const rows=[],failed=[];
   // Request the same protected dashboard endpoint per branch. Access checks on
   // the server remain authoritative even when the UI contains an old branch.
   if(compare){
    for(let i=0;i<branches.length;i+=5){
     const batch=await Promise.allSettled(branches.slice(i,i+5).map(async b=>{
      const data=await context.request(query(period,b.id));
      if(key==='deposited'){
       try{
        const params=new URLSearchParams({from:period.from,to:period.to,branchId:String(b.id)});
        data.shiftDeposits=await context.request('/api/dashboard/shift-deposits?'+params);
       }catch(error){data.shiftDepositError=error.message||'Unable to retrieve shift deposits';}
      }
      return{id:Number(b.id),name:b.name,data,
       selected:String(context.selectedBranch)===String(b.id)};
     }));
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
    if(key==='today'){
     const deposit=main.shiftDeposits;
     if(context.role==='User'&&!main.shiftDepositError){
      const amount=deposit?.mineAmount==null?'':String(deposit.mineAmount);
      body+=panel('End-of-shift Sale Deposit Amount',
       '<form id="dmShiftDepositForm" class="dm-shift-deposit-form">'+
       '<label for="dmShiftDepositAmount">Amount deposited (₱)</label>'+
       '<div class="dm-shift-deposit-controls"><input id="dmShiftDepositAmount" type="number" min="0" max="99999999.99" step="0.01" inputmode="decimal" required value="'+esc(amount)+'"/>'+
       '<button type="submit">'+(deposit?.mineAmount==null?'Record deposit':'Update my deposit')+'</button></div>'+
       '<p id="dmShiftDepositStatus" role="status">'+
       (deposit?.mineRecordedAt?'Last saved: '+esc(new Date(deposit.mineRecordedAt).toLocaleString('en-PH',{timeZone:'Asia/Manila'})):'No deposit entered yet for today.')+
       '</p></form>',
       'Enter your actual end-of-shift sale deposit. Your entry is recorded against your account and assigned branch; edits are audited. This is not automatic bank verification.');
     }else if(main.shiftDepositError){
      body+=panel('Sale Deposit Amount unavailable',empty(main.shiftDepositError),
       'Other sales figures remain available; no deposit amount is estimated.');
     }else{
      body+=panel('Recorded Sale Deposit Amount',
       '<div class="dm-kpi-tiles">'+
       box('Total cashier entries',count(deposit?.count||0))+
       box('Staff-reported sale deposit',deposit?.total==null?'Not recorded':money(deposit.total))+
       '</div>',
       'Total of cashier-entered end-of-shift amounts for the selected branch scope; not bank-confirmed.');
     }
    }
    if(key==='deposited'||key==='expenses'&&!isAdmin)
     body+=await expenseCategoryPanel(main,period,run);
    if(run!==activeRequest||!valid())return;
    body+=categoryPanel(main,key);
   }
   if(run!==activeRequest||!valid())return;
   // Owners keep the chart and Interval controls. Cashiers see the KPI breakdown
   // without the redundant gross-sales activity chart.
   // The Store Expenses drill-down shows actual expense categories in a pie,
   // not a contextual net-sales chart. Owners retain other activity charts.
   if(isAdmin)body+=timelinePanel(main,key);
   content.innerHTML=body;
   content.querySelectorAll('.dm-expense-pie-host').forEach(host=>window.donmacExpensePie?.mount(host));
   if(isAdmin)await mountActivityChart(main,period,key,run);
  }catch(error){
   if(run!==activeRequest||!valid())return;
   content.innerHTML=panel('Unable to load the breakdown',empty(error.message||'Please retry.'),
    'The dashboard totals remain unchanged. Return to the overview and try again.');
  }
 }
 function sync(data,nextContext){
  payload=data;
  const incoming=nextContext?.session;
  if(incoming!==chartSettingsSession){
   chartSettingsSession=incoming;
   chartPreferences={defaultType:'line',overrides:{}};
   renderChartPreferences();
   if(nextContext?.role==='Admin')Promise.resolve().then(loadChartPreferences);
  }
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