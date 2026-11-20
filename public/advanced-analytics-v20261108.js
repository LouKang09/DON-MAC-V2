/* Business Advanced Analytics — genuine workspace data only. */
(() => {
 'use strict';
 const $=id=>document.getElementById(id);
 const root=$('advancedReferenceContent'),frame=$('advancedReferenceFrame');
 if(!root||!frame||window.donmacAdvancedAnalytics)return;
 const sections=[
  ['dashboard','Dashboard','▦'],['financials','Financials','▤'],
  ['sales','Sales & Menu','▥'],['operations','Operations','⚒'],
  ['staff','Staff & Labour','♙'],['alerts','Alerts','⚑']
 ];
 const navSvg={"dashboard":"<svg viewBox=\"0 0 24 24\" width=\"21\" height=\"21\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.75\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><rect x=\"3\" y=\"3\" width=\"7.5\" height=\"7.5\" rx=\"1.7\"/><rect x=\"13.5\" y=\"3\" width=\"7.5\" height=\"7.5\" rx=\"1.7\"/><rect x=\"3\" y=\"13.5\" width=\"7.5\" height=\"7.5\" rx=\"1.7\"/><rect x=\"13.5\" y=\"13.5\" width=\"7.5\" height=\"7.5\" rx=\"1.7\"/></svg>","financials":"<svg viewBox=\"0 0 24 24\" width=\"21\" height=\"21\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.75\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M15 9c-1-1.3-5-1.3-5 .7 0 2.2 4.9 1 4.9 3.7 0 2.2-4.1 2.3-5.3.8M12 6v12\"/></svg>","store":"<svg viewBox=\"0 0 24 24\" width=\"21\" height=\"21\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.75\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M3 9 12 4l9 5-9 5-9-5Z\"/><path d=\"M4 13v7h16v-7M9 20v-5h6v5\"/></svg>","sales":"<svg viewBox=\"0 0 24 24\" width=\"21\" height=\"21\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.75\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M3.8 20.5h16.4M6.2 16.5v-5M11.8 16.5v-9M17.4 16.5V4\"/><path d=\"M5.2 16.5h2M10.8 16.5h2M16.4 16.5h2\"/></svg>","customers":"<svg viewBox=\"0 0 24 24\" width=\"21\" height=\"21\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.75\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M17.2 19.5v-1.8a3.6 3.6 0 0 0-3.6-3.6H8a3.6 3.6 0 0 0-3.6 3.6v1.8\"/><circle cx=\"10.8\" cy=\"7.5\" r=\"3.2\"/><path d=\"M20.5 19.5v-1.8a3.6 3.6 0 0 0-2.7-3.5M16.1 4.3a3.1 3.1 0 0 1 0 6\"/></svg>","operations":"<svg viewBox=\"0 0 24 24\" width=\"21\" height=\"21\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.75\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"m12 2.75 9 5.15-9 5.15-9-5.15 9-5.15Z\"/><path d=\"M3 7.9v8.3l9 5.1 9-5.1V7.9M12 13.05v8.25\"/></svg>","staff":"<svg viewBox=\"0 0 24 24\" width=\"21\" height=\"21\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.75\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M17.2 19.5v-1.8a3.6 3.6 0 0 0-3.6-3.6H8a3.6 3.6 0 0 0-3.6 3.6v1.8\"/><circle cx=\"10.8\" cy=\"7.5\" r=\"3.2\"/><path d=\"M20.5 19.5v-1.8a3.6 3.6 0 0 0-2.7-3.5M16.1 4.3a3.1 3.1 0 0 1 0 6\"/></svg>","alerts":"<svg viewBox=\"0 0 24 24\" width=\"21\" height=\"21\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.75\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M12 3 2.5 20.5h19L12 3Z\"/><path d=\"M12 9v5M12 17.2h.01\"/></svg>"};
 const navIcon=key=>navSvg[key]||navSvg.dashboard;
 const tones=['#138a62','#df9955','#3678b5','#8d67b2','#d36c64','#489eab','#a58c40','#637987'];
 const fmt=n=>Number(n||0).toLocaleString('en-PH',{maximumFractionDigits:1});
 const peso=n=>'₱'+Number(n||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const date=x=>{const d=new Date(x);return Number.isNaN(d.getTime())?String(x||'—'):new Intl.DateTimeFormat('en-PH',{dateStyle:'medium',timeZone:'Asia/Manila'}).format(d);};
 let subscription=null,model=null,section='dashboard',branch='all',days='30',chartType='line',busy=false,requestId=0,lastLoad=0,error='';
 // Payment status and plan are authoritative. "configured" is an optional
 // setup/legacy UI flag and must not keep an already-paid Business owner locked.
 const business=()=>window.donmacAuthenticatedRole==='Admin'&&
  subscription?.plan==='BUSINESS'&&subscription?.status==='PAID';
 const subscriptionPath=()=>window.donmacFranchiseUnified===true?
  '/api/live/account/subscription':'/api/account/subscription';
 const empty=message=>'<div class="aa-empty">'+esc(message)+'</div>';
 const note=message=>'<p class="aa-data-note">'+esc(message)+'</p>';
 const title=(heading,description)=>'<div class="rd-section-title"><div><h3>'+esc(heading)+'</h3><p>'+esc(description)+'</p></div><span class="aa-recorded-label">POS RECORDS</span></div>';
 function sparkline(values,color=tones[0],label='Recorded daily trend'){
  if(!Array.isArray(values)||values.length<2)return '';
  const nums=values.map(Number),max=Math.max(1,...nums),w=184,h=52;
  const p=nums.map((n,i)=>(4+i*(w-8)/Math.max(1,nums.length-1)).toFixed(1)+','+
    (h-4-n/max*(h-8)).toFixed(1)).join(' ');
  return '<svg class="rd-spark" viewBox="0 0 '+w+' '+h+'" role="img" aria-label="'+
    esc(label)+'"><polyline points="'+p+
    '" fill="none" stroke="'+color+'" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
 }
 function metric(label,value,caption,values,idx=0){
  const source=Array.isArray(values)&&values.length>1?' Daily values calculated from recorded entries.':'';
  const tooltip=label+': '+value+'. '+caption+'.'+source;
  return '<article class="rd-kpi aa-hoverable" tabindex="0" data-aa-tip="'+esc(tooltip)+'">'+
    '<div class="rd-kpi-upper"><span>'+esc(label)+'</span></div>'+
    '<strong>'+esc(value)+'</strong><div class="aa-kpi-caption">'+esc(caption)+'</div>'+
    sparkline(values,tones[idx%tones.length],label+' — daily POS records')+'</article>';
 }
 const kpis=list=>'<div class="rd-kpi-grid">'+
   list.map((x,i)=>metric(x[0],x[1],x[2],x[3],i)).join('')+'</div>';
 const panel=(name,content,extra='')=>'<article class="rd-panel aa-panel '+extra+'"><div class="rd-panel-title">'+esc(name)+'</div>'+content+'</article>';
 function comparisonChart(rows,series){
  if(!rows.length||!rows.some(row=>series.some(item=>Number(row[item.key]||0)!==0)))
    return empty('No recorded values for this comparison.');
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
    const dots=points.map((p,i)=>'<circle class="aa-chart-dot" cx="'+p[0]+'" cy="'+p[1]+'" r="5.2" fill="'+color+
      '" tabindex="0" data-aa-tip="'+esc((rows[i].month||rows[i].day)+' · '+s.name+': '+peso(p[2]))+'">'+
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
   const tip=labelFn(x)+': '+peso(amount);
   return '<div class="aa-rank-row aa-hoverable" tabindex="0" data-aa-tip="'+esc(tip)+'"><div><strong>'+
     esc(labelFn(x))+'</strong><span>'+peso(amount)+'</span></div>'+
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
   '<div class="aa-donut-legend">'+rows.map((x,i)=>'<div class="aa-hoverable" tabindex="0" data-aa-tip="'+
     esc(x.name+': '+peso(x[field])+' ('+percent(x[field],sum)+')')+'"><i style="background:'+tones[i%tones.length]+'"></i>'+
     '<span>'+esc(x.name)+'</span><strong>'+esc(percent(x[field],sum))+'</strong></div>').join('')+'</div></div>';
 }
 const cardColors={gross:'#128351',cost:'#de9343',net:'#2685a3'};
 function branchTrend(card){
  const rows=Array.isArray(card.days)?card.days:[];
  if(!rows.length)return empty('No daily sales records for this period.');
  const values=rows.flatMap(row=>[Number(row.gross||0),Number(row.ingredientCost||0),Number(row.net||0)]);
  if(!values.some(v=>v!==0))return'<div class="aa-branch-no-activity">No completed sales during this period</div>';
  const width=300,height=94,left=5,right=5,top=8,bottom=12;
  const chartH=height-top-bottom,chartW=width-left-right;
  const max=Math.max(1,...values),y=v=>top+chartH-(Math.max(0,Number(v)||0)/max)*chartH;
  const x=i=>left+(rows.length===1?chartW/2:i*chartW/(rows.length-1));
  const keys=[['gross','Gross sales'],['ingredientCost','Ingredient cost'],['net','Net sales']];
  const guides=[0,.5,1].map(p=>'<line x1="'+left+'" y1="'+y(p*max).toFixed(1)+
   '" x2="'+(width-right)+'" y2="'+y(p*max).toFixed(1)+
   '" stroke="#e2eee6" stroke-width="1"/>').join('');
  const paths=keys.map(([key,label])=>{
   const points=rows.map((r,i)=>x(i).toFixed(1)+','+y(r[key]).toFixed(1)).join(' ');
   const c=cardColors[key];
   return '<polyline points="'+points+'" fill="none" stroke="'+c+
    '" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">'+
    '<title>'+esc(label+' trend for '+card.name)+'</title></polyline>';
  }).join('');
  return '<div class="aa-branch-spark" role="img" aria-label="'+esc(card.name+
   ' daily trend of gross sales, ingredient cost, and net sales')+
   '"><svg viewBox="0 0 '+width+' '+height+'" preserveAspectRatio="none">'+guides+paths+'</svg></div>'+
   '<div class="aa-branch-legend"><span><i class="gross"></i>Gross</span>'+
   '<span><i class="cost"></i>Ingredients</span><span><i class="net"></i>Net</span></div>';
 }
 function branchTiles(card){
  const entries=[['gross','Gross sales'],['ingredientCost','Ingredients'],['net','Net sales']];
  const highest=Math.max(1,...entries.map(([key])=>Number(card[key]||0)));
  return '<div class="aa-branch-tiles" role="img" aria-label="'+esc(card.name+' gross sales '+
   peso(card.gross)+', ingredient costs '+peso(card.ingredientCost)+', net sales '+peso(card.net))+'">'+
   entries.map(([key,label])=>'<div class="aa-branch-tile-row"><span>'+label+'</span>'+
    '<div class="aa-branch-tile-track"><i class="'+key+
    '" style="width:'+(Math.min(100,Math.max(0,Number(card[key]||0)/highest*100))).toFixed(2)+
    '%"></i></div><b>'+peso(card[key])+'</b></div>').join('')+'</div>';
 }
 function branchPie(card){
  const net=Math.max(0,Number(card.net||0)),cost=Math.max(0,Number(card.ingredientCost||0));
  if(net===0&&cost===0)return'<div class="aa-branch-no-activity">No sales or ingredient cost recorded</div>';
  // A pie is only meaningful for additive slices: ingredient cost and
  // the remainder of NET revenue, never gross + cost + net (overlapping).
  const part=net>0?Math.min(100,cost/net*100):100;
  const left=Math.max(0,net-cost);
  return '<div class="aa-branch-pie-layout">'+
   '<div class="aa-branch-pie" role="img" aria-label="'+esc('Ingredient cost '+
    (net>0?(cost/net*100).toFixed(1)+'% of net sales':'against no net sales'))+
    '" style="--aa-pie-angle:'+part.toFixed(2)+'%">'+
   '<div><strong>'+esc(net>0?(cost/net*100).toFixed(1)+'%':'N/A')+
   '</strong><small>Ingredient / net</small></div></div>'+
   '<div class="aa-branch-pie-legend"><span><i class="cost"></i>Ingredients <b>'+
    peso(cost)+'</b></span><span><i class="net"></i>Remaining net <b>'+peso(left)+'</b></span>'+
    (cost>net?'<small class="aa-branch-cost-warning">Ingredient cost exceeds net sales</small>':'')+
   '</div></div>';
 }
 function branchCard(card,i){
  const selectedType=chartType==='pie'?'Cost share':chartType==='tile'?'Value comparison':'Daily trend';
  const chart=chartType==='pie'?branchPie(card):chartType==='tile'?branchTiles(card):branchTrend(card);
  return '<article class="aa-branch-card" aria-label="'+esc(card.name)+' sales performance">'+
   '<div class="aa-branch-card-heading"><div class="aa-branch-card-name">'+
   '<span class="aa-branch-card-icon" aria-hidden="true">'+navIcon('store')+'</span>'+
   '<div><span class="aa-branch-card-eyebrow">BRANCH PERFORMANCE</span>'+
   '<h4>'+esc(card.name)+'</h4></div></div>'+
   '<span class="aa-branch-orders">'+fmt(card.orders||0)+' orders</span></div>'+
   '<div class="aa-branch-financial-grid">'+
    '<div><span>Gross Sales</span><strong>'+peso(card.gross)+'</strong></div>'+
    '<div><span>Ingredients Sold Cost</span><strong>'+peso(card.ingredientCost)+'</strong></div>'+
    '<div><span>Net Sales</span><strong>'+peso(card.net)+'</strong></div>'+
   '</div>'+
   '<div class="aa-branch-mini-head"><span>'+selectedType+'</span>'+
    '<span>'+esc(days)+' days</span></div>'+chart+'</article>';
 }
 function dashboard(d){
  const branches=Array.isArray(d.branchCards)?d.branchCards:[];
  return title('Branch performance overview','Actual completed POS sales and cost of ingredients consumed, separated by branch.')+
   (branches.length?
     '<div class="aa-branches-grid">'+branches.map(branchCard).join('')+'</div>':
     empty('No permitted branches are available for this reporting period.'))+
   note(d.ingredientCostNote||'Sold ingredient costs come from transaction costing; they are separate from staff-entered operating expenses.')+
   '<div class="rd-section-grid">'+panel('Monthly net sales and operating expenses',
    comparisonChart(d.months,[{key:'net',name:'Net sales'},{key:'expenses',name:'Operating expenses'}]))+
    panel('Branch net sales ranking',ranking(d.branchesPerformance,x=>x.name,x=>x.net))+'</div>'+
    panel('Recent attention items',alertRows(d.alerts.slice(0,8)));
 }
 function financials(d){
  const s=d.summary,a=d.daily;
  return title('Financials','Recorded gross sales, discounts, payment mix and expenses.')+
   kpis([['Gross sales',peso(s.gross),'Before POS adjustments',a.map(x=>x.gross)],
    ['Discount amount',peso(s.discount),'Recorded sale discounts',a.map(x=>x.discount)],
    ['Net sales',peso(s.net),'Completed sales after adjustments',a.map(x=>x.net)],
    ['Operating balance',peso(s.operatingBalance),'Net sales less recorded expenses',a.map(x=>x.operatingBalance)]])+
   '<div class="rd-section-grid">'+panel('Expenses by category',
     ranking(d.expenseCategories,x=>x.name[0].toUpperCase()+x.name.slice(1),x=>x.amount))+
     panel('Payment method share',donut(d.paymentMix))+'</div>'+
   panel('Monthly financial trend',comparisonChart(d.months,[{key:'net',name:'Net sales'},{key:'expenses',name:'Expenses'}]));
 }
 function sales(d){
  const s=d.summary,a=d.daily;
  return title('Sales & Menu','Purchased item quantities and sales channels from completed orders.')+
   kpis([['Completed orders',fmt(s.orders),'Selected period',a.map(x=>x.orders)],
    ['Net sales',peso(s.net),'Recorded POS receipts',a.map(x=>x.net)],
    ['Discount amount',peso(s.discount),'Applied discounts',a.map(x=>x.discount)],
    ['Items sold',fmt(s.itemUnits),'All recorded sale-item quantities']])+
   '<div class="rd-section-grid">'+panel('Top menu items · line subtotals',
    ranking(d.topProducts,x=>x.name,x=>x.amount,12))+
   panel('Order types',donut(d.orderTypes))+'</div>'+
   panel('Branch product comparison',lines(d.branchProducts.slice(0,20),
    ['Branch','Menu item','Units','Line subtotal'],x=>'<tr><td>'+esc(x.branch)+'</td><td>'+esc(x.name)+
    '</td><td>'+fmt(x.qty)+'</td><td>'+peso(x.amount)+'</td></tr>'));
 }
 function operations(d){
  const m=d.movementSummary,s=d.summary;
  return title('Operations','Recorded inventory movements and stock balances for the permitted franchise branches.')+
   kpis([['Stock transfers',fmt(m.transfer),'Saved inventory transfer entries'],
    ['Replenishments',fmt(m.replenish),'Saved replenishment entries'],
    ['Sale stock movements',fmt(m.sale),'Tracked sale deduction entries'],
    ['Low stock ingredients',fmt(s.stockAlertCount),'Active ingredients in the permitted inventory scope']])+
   '<div class="rd-section-grid">'+panel('Ingredient stock attention',lines(d.stockAlerts,
    ['Ingredient','On hand','Threshold'],x=>'<tr><td>'+esc(x.name)+'</td><td>'+fmt(x.stock)+' '+esc(x.uom)+
    '</td><td>'+fmt(x.threshold)+'</td></tr>'))+
    panel('Recent inventory movements',lines(d.movements.slice(0,12),
     ['Date','Movement','Ingredient','Qty'],x=>'<tr><td>'+esc(date(x.date))+'</td><td>'+esc(x.type)+
     '</td><td>'+esc(x.ingredient)+'</td><td>'+fmt(x.qty)+' '+esc(x.uom)+'</td></tr>'))+'</div>'+
   note(d.sourceNotes?.stock||'Stock balances and movements reflect saved inventory records for the selected scope.');
 }
 function staff(d){
  const s=d.summary,a=d.daily;
  return title('Staff & Labour','Cashier performance calculated from completed sales.')+
   kpis([['Cashiers with sales',fmt(s.cashierCount),'Recorded cashier names'],
    ['Sales processed',peso(s.net),'Completed order value',a.map(x=>x.net)],
    ['Completed transactions',fmt(s.orders),'Cashier-processed orders',a.map(x=>x.orders)],
    ['Average order value',peso(s.avgTicket),'Net sales per order',a.map(x=>x.avgTicket)]])+
   panel('Cashier performance',lines(d.cashiers,['Cashier','Branch','Completed orders','Net sales','Average sale'],x=>
    '<tr><td><strong>'+esc(x.name)+'</strong></td><td>'+esc(x.branch||'—')+'</td><td>'+fmt(x.orders)+
    '</td><td>'+peso(x.net)+'</td><td>'+peso(x.orders?x.net/x.orders:0)+'</td></tr>'));
 }
 function alertRows(alerts){
  return alerts.length?'<div class="rd-alert-list">'+alerts.map(a=>
   '<div class="aa-hoverable" tabindex="0" data-aa-tip="'+esc(a.title+' · '+a.location+': '+a.detail)+
   '"><span class="rd-alert-dot"></span><strong>'+esc(a.title)+
   '</strong><span>'+esc(a.location)+'</span><p>'+esc(a.detail)+'</p></div>').join('')+'</div>':
   empty('No recorded exceptions match the current filters.');
 }
 function alerts(d){
  return title('Alerts & Action Center','Current low-stock thresholds and recorded sales exceptions.')+
   kpis([['Low stock ingredients',fmt(d.summary.stockAlertCount),'Recorded low-stock thresholds'],
    ['Voided transactions',fmt(d.summary.voided),'Selected period',d.daily.map(x=>x.voided)],
    ['Branches reviewed',fmt(d.branchesPerformance.length),'Selected franchise locations'],
    ['Attention entries',fmt(d.alerts.length),'Items in this action center']])+
   panel('Recorded exceptions',alertRows(d.alerts));
 }
 const views={dashboard,financials,sales,operations,staff,alerts};
 function showModel(){
  if(!model){root.innerHTML=empty(error||'Loading advanced analytics…');return;}
  const d=model;
  const header='<div class="aa-report-controls"><label>Branch <select data-aa-branch><option value="all">ALL</option>'+
   d.branches.map(b=>'<option value="'+b.id+'" '+(String(b.id)===branch?'selected':'')+'>'+esc(b.name)+'</option>').join('')+
   '</select></label><label>Period <select data-aa-days>'+
   [7,30,90].map(n=>'<option value="'+n+'" '+(String(n)===days?'selected':'')+'>'+n+' days</option>').join('')+
   '</select></label>'+(section==='dashboard'?
    '<label>Chart Type <select data-aa-chart-type aria-label="Branch chart type">'+
    [['line','Line'],['tile','Tile'],['pie','Pie']].map(([value,label])=>
     '<option value="'+value+'"'+(chartType===value?' selected':'')+'>'+label+'</option>').join('')+
    '</select></label>':'')+
   '<button type="button" data-aa-refresh aria-label="Refresh Advanced Analytics">↻ Refresh</button></div>';
  const notice=!d.complete?'<p class="aa-warning" role="status">High-volume record limit reached. The figures below reflect only the retrieved data; use the full reports for an exact uncapped total.</p>':'';
  const markup='<section class="rd-shell dm-advanced-shell" data-aa-root>'+
   '<aside class="rd-sidebar"><nav aria-label="Advanced sections">'+sections.map(s=>
    '<button type="button" data-aa-section="'+s[0]+'" class="'+(section===s[0]?'active':'')+'" aria-current="'+
    (section===s[0]?'page':'false')+'"><span class="rd-nav-glyph">'+navIcon(s[0])+'</span>'+esc(s[1])+'</button>').join('')+
   '</nav></aside>'+
   '<main class="rd-main">'+header+
   '<p class="aa-period-caption">Completed POS transactions · '+esc(d.period.start)+' to '+esc(d.period.end)+'</p>'+
   notice+'<div class="rd-body">'+(views[section]||views.dashboard)(d)+'</div>'+
   '</main></section>';
  root.innerHTML=markup;
  hideHoverTip();
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
   const path=window.donmacFranchiseUnified===true?
    '/api/live/advanced/analytics?':'/api/advanced/analytics?';
   const response=await fetch(path+params,{credentials:'same-origin',cache:'no-store'});
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
   const generation=window.donmacSessionGeneration?.();
   fetch(subscriptionPath(),{credentials:'same-origin',cache:'no-store'})
    .then(r=>r.ok?r.json():null)
    .then(next=>{
     if(generation===window.donmacSessionGeneration?.()&&next)setSubscription(next);
    }).catch(()=>{});
  }
 }
 let hoverTip=null;
 function hideHoverTip(){
   if(hoverTip)hoverTip.hidden=true;
 }
 function showHoverTip(message,x,y){
   if(!hoverTip){
     hoverTip=document.createElement('div');
     hoverTip.className='aa-floating-tooltip';
     hoverTip.setAttribute('role','tooltip');
     hoverTip.hidden=true;
     document.body.appendChild(hoverTip);
   }
   hoverTip.textContent=message;
   hoverTip.hidden=false;
   const bound=hoverTip.getBoundingClientRect();
   const viewportW=document.documentElement.clientWidth;
   const viewportH=document.documentElement.clientHeight;
   hoverTip.style.left=Math.max(8,Math.min(x+16,viewportW-bound.width-8))+'px';
   hoverTip.style.top=Math.max(8,Math.min(y+16,viewportH-bound.height-8))+'px';
 }
 root.addEventListener('pointermove',event=>{
   const target=event.target.closest?.('[data-aa-tip]');
   if(!target){hideHoverTip();return;}
   showHoverTip(target.getAttribute('data-aa-tip')||'',event.clientX,event.clientY);
 });
 root.addEventListener('pointerleave',hideHoverTip);
 root.addEventListener('focusin',event=>{
   const target=event.target.closest?.('[data-aa-tip]');
   if(!target)return;
   const rect=target.getBoundingClientRect();
   showHoverTip(target.getAttribute('data-aa-tip')||'',rect.left+rect.width/2,rect.top+rect.height/2);
 });
 root.addEventListener('focusout',hideHoverTip);
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
  if(target.matches('[data-aa-chart-type]')){
   if(!['line','tile','pie'].includes(target.value))return;
   chartType=target.value;showModel();return;
  }
  if(target.matches('[data-aa-branch]'))branch=target.value;
  else if(target.matches('[data-aa-days]'))days=target.value;
  else return;
  model=null;lastLoad=0;load(true);
 });
 window.donmacAdvancedAnalytics={setSubscription,open,refresh:()=>{lastLoad=0;return load(true);}};
 const initialGeneration=window.donmacSessionGeneration?.();
 fetch(subscriptionPath(),{credentials:'same-origin',cache:'no-store'})
  .then(r=>r.ok?r.json():null)
  .then(sub=>{if(sub&&initialGeneration===window.donmacSessionGeneration?.())setSubscription(sub);})
  .catch(()=>{});
 if($('view-advanced')?.classList.contains('active'))open();
})();
