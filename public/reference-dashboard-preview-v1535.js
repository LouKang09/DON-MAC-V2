/* Don Macchiatos — screenshot-inspired reference design dashboard.
 * Visual inspiration only. All numbers, people, branches & charts below are SAMPLE.
 * The renderer has no network, storage or write access, and cannot change POS.
 */
(() => {
 'use strict';
 const root=document.getElementById('premiumPreviewContent');
 if(!root)return;
 const branches=['SM Branch','Ayala','IT Park','Main','Banilad','Mandaue','Lapu-Lapu','Talisay'];
 const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
 const color=['#12664b','#009f78','#67d9ac','#ee6961','#bd3a43','#8e6246','#f5a64f','#a98ae9'];
 const sections=[
  ['dashboard','Dashboard','▦'],['financials','Financials','▤'],
  ['store','Store Performance','▣'],['sales','Sales & Menu','▥'],
  ['customers','Customers','♧'],['operations','Operations','⚒'],
  ['staff','Staff & Labour','♙'],['alerts','Alerts','⚑']
 ];
 const state={section:'dashboard',branch:0,ranking:'top',disabled:new Set()};
 const money=n=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP',maximumFractionDigits:0}).format(Number(n)||0);
 const fmt=n=>new Intl.NumberFormat('en-PH',{maximumFractionDigits:0}).format(Number(n)||0);
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const rnd=n=>Math.round(n);
 function dataset(branch){
   return months.map((_,i)=>rnd(460+branch*43+58*Math.sin(i*.8+branch*1.7)+i*(branch%3===0?25:9)+24*Math.cos(i*1.4+branch)));
 }
 const allSeries=branches.map((name,i)=>({name,c:color[i],values:dataset(i),id:i}));
 const badge='<span class="rd-sample">SAMPLE DATA</span>';
 const chips=a=>'<div class="rd-chips">'+a.map(x=>'<span>'+esc(x)+'</span>').join('')+'</div>';
 function sparkline(values,stroke='#0caa75',h=58){
   const w=186,p=5,lo=Math.min(...values),hi=Math.max(...values),span=hi-lo||1;
   const pts=values.map((n,i)=>[p+(w-2*p)*i/(values.length-1),h-p-((n-lo)/span)*(h-2*p)]);
   return '<svg viewBox="0 0 '+w+' '+h+'" class="rd-spark" role="img" aria-label="Sample change over time">'+
     '<polyline points="'+pts.map(x=>x.join(',')).join(' ')+'" stroke="'+stroke+'" stroke-width="2.5" fill="none" stroke-linejoin="round" stroke-linecap="round"/></svg>';
 }
 function metric(name,num,delta,dir,arr){
   const success=dir==='up',accent=success?'#00a773':'#e65a53';
   return '<article class="rd-kpi"><div class="rd-kpi-upper"><span>'+esc(name)+'</span><span aria-hidden="true">⋮</span></div>'+
     '<strong>'+esc(num)+'</strong><div class="rd-kpi-change '+(success?'rd-up':'rd-down')+'">'+
     '<b>'+(success?'↗':'↘')+' '+esc(delta)+'</b><span>vs last month</span></div>'+
     sparkline(arr,accent)+'</article>';
 }
 function lineChart(series,opts={}){
   const w=900,h=258,l=48,r=opts.legend?12:24,t=13,b=38,plotW=w-l-r,plotH=h-t-b;
   const combined=series.flatMap(s=>s.values);
   const min=opts.floorZero?0:Math.max(0,Math.floor((Math.min(...combined)-70)/100)*100);
   const max=Math.max(min+100,Math.ceil((Math.max(...combined)+60)/100)*100);
   const x=i=>l+i*(plotW/11),y=v=>t+plotH-(v-min)/(max-min)*plotH;
   const grid=Array.from({length:5},(_,i)=>{
      const v=min+(max-min)*i/4,yy=y(v);
      return '<line x1="'+l+'" y1="'+yy.toFixed(1)+'" x2="'+(w-r)+'" y2="'+yy.toFixed(1)+'" stroke="#e9edea"/>'+
       '<text x="'+(l-12)+'" y="'+(yy+4).toFixed(1)+'" font-size="11" fill="#87918d" text-anchor="end">'+fmt(v)+'</text>';
   }).join('');
   const labels=months.map((m,i)=>'<text x="'+x(i).toFixed(1)+'" y="'+(h-11)+'" fill="#898d93" text-anchor="middle" font-size="11">'+m+'</text>').join('');
   const lines=series.filter(s=>!state.disabled.has(s.id)).map(s=>{
     const d=s.values.map((v,i)=>(i?'L':'M')+x(i).toFixed(1)+','+y(v).toFixed(1)).join(' ');
     return '<path d="'+d+'" fill="none" stroke="'+s.c+'" stroke-width="'+(opts.bold?3:1.65)+'" stroke-linecap="round" stroke-linejoin="round" opacity=".95"/>';
   }).join('');
   return '<svg viewBox="0 0 '+w+' '+h+'" class="rd-line-chart" role="img" aria-label="'+esc(opts.label||'Sample monthly comparison line chart')+'">'+grid+lines+labels+'</svg>';
 }
 function sectionHeader(title,sub,tag){
   return '<div class="rd-section-title"><div><h3>'+esc(title)+'</h3><p>'+esc(sub)+'</p></div>'+(tag||badge)+'</div>';
 }
 const products=[
  ['Iced Mocha',8200],['Cappuccino',6900],['Flat White',6100],['Iced Latte',4300],['Almond Croissant',3400],
  ['Caramel Frappe',2900],['Chocolate Cookie',2300],['Cold Brew',1800],['Vanilla Tea',880],['Seasonal Muffin',420]
 ];
 function ranking(){
   const ranks=state.ranking==='top'?products.slice(0,5):products.slice(-5).reverse();
   return '<div class="rd-product-controls"><button type="button" data-rd-ranking="top" class="'+(state.ranking==='top'?'selected':'')+'">Top 5 Menu</button>'+
     '<button type="button" data-rd-ranking="bottom" class="'+(state.ranking==='bottom'?'selected':'')+'">Bottom 5 Menu</button></div>'+
     '<div class="rd-products">'+ranks.map((p,i)=>'<div class="rd-product"><i style="background:'+color[i%color.length]+'"></i>'+
       '<span>'+esc(p[0])+'</span><strong>'+fmt(p[1])+'</strong><small>sold</small></div>').join('')+'</div>';
 }
 function donut(share=67){
   return '<div class="rd-donut-body"><div class="rd-donut" style="--share:'+share+'%"><div class="rd-donut-hole"></div>'+
     '<span class="rd-donut-tooltip">'+share+'%</span></div><div class="rd-donut-legend">'+
     '<div><i style="background:#996a30"></i>Drinks</div><div><i style="background:#ffb04f"></i>Food</div></div></div>';
 }
 function branchTabs(){
   return '<div class="rd-branch-tabs" role="tablist" aria-label="Example branch selection">'+branches.map((name,i)=>
     '<button type="button" role="tab" data-rd-branch="'+i+'" aria-selected="'+String(state.branch===i)+'" class="'+(state.branch===i?'active':'')+'">'+esc(name)+'</button>').join('')+'</div>';
 }
 function branchGraph(){
   return '<article class="rd-panel rd-branch-panel"><div class="rd-panel-title">Branch Performance <span class="rd-note">Example monthly visitors</span></div>'+
     '<div class="rd-branch-plot"><div class="rd-plot-container">'+lineChart(allSeries,{label:'Monthly visitors across example branches'})+'</div>'+
     '<div class="rd-chart-legend">'+allSeries.map(s=>'<button type="button" data-rd-toggle="'+s.id+'" class="'+(state.disabled.has(s.id)?'muted':'')+'">'+
        '<i style="background:'+s.c+'"></i>'+esc(s.name)+'</button>').join('')+'</div></div></article>';
 }
 function dashboard(){
   const b=state.branch;
   const visitors=dataset(b).map((v,i)=>rnd(v*.71+i*4));
   return '<div class="rd-kpi-grid">'+
     metric('Revenue / month','₱780,000','10%','up',[40,32,48,42,38,55,46,45,61,50,60,80])+
     metric('Visitors','15,600','10%','down',[70,56,62,40,61,51,64,62,54,30,29,16])+
     metric('Cost','₱655,000','10%','up',[66,59,49,44,53,33,26,45,48,65,69,74])+
     metric('Net Cash','₱60,000','2%','up',[22,24,29,48,57,49,42,55,65,62,59,58])+'</div>'+
     branchGraph()+branchTabs()+
     '<div class="rd-bottom-grid"><article class="rd-panel rd-visitors"><div class="rd-panel-title">Visitor Trend <span class="rd-note">'+esc(branches[b])+'</span></div>'+
     lineChart([{name:'Visitors',values:visitors,c:'#0dba83',id:100}],{bold:true,label:'Monthly example visitor trend'})+
     '</article><article class="rd-panel"><div class="rd-panel-title">Product Sale</div>'+ranking()+'</article>'+
     '<article class="rd-panel"><div class="rd-panel-title">Average Spending</div>'+donut(67-b*2)+'</article></div>';
 }
 function financials(){
   return sectionHeader('Financial Overview','Sample revenue, costs and illustrative profitability trends.')+
     '<div class="rd-kpi-grid">'+metric('Gross Revenue','₱780,000','12%','up',[35,42,36,51,46,48,60,59,64,63,71,83])+
     metric('Ingredient Costs','₱310,000','6%','up',[32,30,36,38,34,43,50,52,46,48,51,56])+
     metric('Operating Expenses','₱345,000','3%','up',[25,26,28,34,38,32,39,35,44,42,47,48])+
     metric('Net Cash','₱60,000','2%','up',[27,29,25,35,38,42,40,50,47,55,58,61])+'</div>'+
     '<div class="rd-section-grid"><article class="rd-panel"><div class="rd-panel-title">Revenue & Cost Movement</div>'+
      lineChart([{name:'Revenue',values:[400,440,460,520,570,600,590,650,670,710,750,780],c:'#12a879',id:101},
         {name:'Costs',values:[350,378,391,455,480,510,550,565,590,630,645,655],c:'#e89f49',id:102}],{bold:true,label:'Example revenue and costs'})+
     '</article><article class="rd-panel"><div class="rd-panel-title">Expense Breakdown</div>'+donut(53)+
       '<div class="rd-mini-callout">Profitability needs verified expenses and ingredient costs before going live.</div></article></div>';
 }
 function storePerformance(){
   const ranked=branches.map((name,i)=>({name,value:dataset(i).reduce((a,b)=>a+b,0)*45})).sort((a,b)=>b.value-a.value);
   return sectionHeader('Store Performance','Compare locations and identify opportunities from illustrative branch metrics.')+
     '<div class="rd-kpi-grid">'+
       metric('Active Branches','8','2 new','up',[2,2,3,3,4,4,5,5,6,6,7,8])+
       metric('Top Branch',branches[state.branch],'6%','up',[39,42,46,50,58,55,68,71,69,78,85,90])+
       metric('Avg. Branch Sales','₱97,500','4%','up',[35,38,42,45,48,44,54,58,59,61,64,67])+
       metric('Branch Growth','8.6%','3%','up',[19,23,26,30,35,40,38,48,55,54,58,62])+'</div>'+
     branchGraph()+branchTabs()+
     '<article class="rd-panel"><div class="rd-panel-title">Branch Sales Leaderboard</div><div class="rd-sample-table">'+
     ranked.map((b,i)=>'<div><span>'+(i+1)+'. '+esc(b.name)+'</span><div class="rd-bar"><span style="width:'+(b.value/ranked[0].value*100).toFixed(1)+'%"></span></div><strong>'+money(b.value)+'</strong></div>').join('')+'</div></article>';
 }
 function sales(){
   return sectionHeader('Sales & Menu','Product rankings, menu mix, and basket performance for review.')+
     '<div class="rd-kpi-grid">'+metric('Products Sold','31,400','9%','up',[40,42,39,48,58,56,54,67,61,68,71,80])+
     metric('Average Basket','₱125','3%','up',[30,35,33,40,45,41,46,49,55,56,60,65])+
     metric('Add-on Rate','32%','4%','up',[26,25,30,32,33,29,37,41,39,43,49,53])+
     metric('Promo Redemptions','1,240','8%','up',[20,28,25,31,40,38,51,47,56,55,62,70])+'</div>'+
     '<div class="rd-section-grid"><article class="rd-panel"><div class="rd-panel-title">Product Rankings</div>'+ranking()+'</article>'+
     '<article class="rd-panel"><div class="rd-panel-title">Sales Mix</div>'+donut(71)+'</article></div>'+
     '<article class="rd-panel"><div class="rd-panel-title">Menu Engineering Concept</div>'+
      '<div class="rd-menu-quadrants">'+[['STARS','High sales · High margin','Iced Mocha'],['PUZZLES','Low sales · High margin','Hazelnut Latte'],['PLOWHORSES','High sales · Low margin','Classic Iced'],['DOGS','Low sales · Low margin','Seasonal Tea']].map(t=>
       '<div><strong>'+t[0]+'</strong><span>'+t[1]+'</span><b>'+t[2]+'</b></div>').join('')+'</div></article>';
 }
 function customers(){
   return sectionHeader('Customer Insights','Understand visits, order behavior and spending patterns.')+
    '<div class="rd-kpi-grid">'+metric('Total Visits','15,600','10%','up',[31,35,38,37,42,50,49,56,59,65,66,75])+
    metric('Returning Visits','6,240','8%','up',[28,31,35,33,40,46,50,53,58,62,67,70])+
    metric('Avg. Spending','₱125','3%','up',[27,30,34,31,39,42,40,49,51,57,58,62])+
    metric('Peak Visit Day','Saturday','12%','up',[20,34,24,36,42,41,48,52,60,65,71,81])+'</div>'+
    branchTabs()+'<div class="rd-section-grid"><article class="rd-panel"><div class="rd-panel-title">Visitor Trend · '+esc(branches[state.branch])+'</div>'+
    lineChart([{name:'Visits',values:dataset(state.branch),c:'#0bae7c',id:100}],{bold:true,label:'Example customer visits'})+'</article>'+
    '<article class="rd-panel"><div class="rd-panel-title">Spending Composition</div>'+donut(68)+'</article></div>';
 }
 function operations(){
   return sectionHeader('Operations','Illustrative stock, transfers, and daily closeout overview.')+
     '<div class="rd-kpi-grid">'+metric('Open Stock Alerts','4','2 fewer','up',[40,45,43,51,39,41,34,29,25,19,16,12])+
     metric('Pending Transfers','3','1 fewer','up',[48,42,40,40,36,30,25,24,21,18,12,10])+
     metric('Completed Closeouts','7 of 8','1 pending','up',[24,29,33,39,42,50,53,60,65,69,74,78])+
     metric('Stock Accuracy','97%','2%','up',[26,29,38,40,44,48,51,54,55,64,69,72])+'</div>'+
     '<div class="rd-section-grid"><article class="rd-panel"><div class="rd-panel-title">Stock Warnings</div>'+
     '<div class="rd-op-list">'+[['Milk','SM Branch','Low'],['Coffee Beans','Main','Critical'],['Cups 16oz','Ayala','Low'],['Caramel Syrup','IT Park','Low']].map(t=>
     '<div><b>'+t[0]+'</b><span>'+t[1]+'</span><em>'+t[2]+'</em></div>').join('')+'</div></article>'+
     '<article class="rd-panel"><div class="rd-panel-title">Transfers & Closing</div>'+
     '<div class="rd-op-list">'+[['Stock transfer #024','Main → SM','Received'],['Stock transfer #025','Ayala → Main','Pending'],['Branch closeout','IT Park','Awaiting']].map(t=>
     '<div><b>'+t[0]+'</b><span>'+t[1]+'</span><em>'+t[2]+'</em></div>').join('')+'</div></article></div>';
 }
 function staff(){
   return sectionHeader('Staff & Labour','Examples only; real labor efficiency requires timekeeping and payroll data.')+
     '<div class="rd-kpi-grid">'+metric('Staff Scheduled','38','6%','up',[28,31,30,33,38,43,41,45,47,51,55,58])+
     metric('Labour Hours','1,840','4%','up',[29,34,39,37,44,47,50,48,54,59,61,67])+
     metric('Sales / Labour Hour','₱424','8%','up',[34,38,33,41,48,46,51,55,58,61,65,71])+
     metric('Late Clock-ins','6','3 fewer','up',[57,52,50,48,39,41,36,30,29,23,20,16])+'</div>'+
     '<div class="rd-section-grid"><article class="rd-panel"><div class="rd-panel-title">Sales per Paid Hour</div>'+
      '<div class="rd-sample-table">'+[['SM Branch',1480],['Ayala',1260],['IT Park',1170],['Main',1080]].map(b=>
       '<div><span>'+b[0]+'</span><div class="rd-bar"><span style="width:'+(b[1]/1500*100).toFixed(0)+'%"></span></div><strong>'+money(b[1])+'/hr</strong></div>').join('')+'</div></article>'+
      '<article class="rd-panel"><div class="rd-panel-title">Shift Coverage</div>'+lineChart([{name:'Shifts',values:[35,38,39,37,41,44,45,47,46,49,52,54],c:'#14ac80',id:103}],{bold:true,label:'Example shift coverage'})+'</article></div>';
 }
 function alerts(){
    const list=[['Critical','Main Branch','Coffee bean inventory below reorder point'],['Action needed','Ayala','Cash closeout has an unconfirmed difference'],['Attention','IT Park','Delivery from supplier has not been received'],['Opportunity','SM Branch','Weekend iced coffee sales increased'],['Reminder','All branches','Monthly stock count due this week']];
    return sectionHeader('Alerts & Action Center','One place for owner decisions and exceptions across branches.')+
     '<div class="rd-kpi-grid">'+metric('Open Alerts','5','2 fewer','up',[60,51,55,47,42,43,39,37,29,25,21,17])+
     metric('Critical Alerts','1','1 fewer','up',[34,33,30,29,28,24,20,19,15,14,9,7])+
     metric('Pending Approval','2','1 fewer','up',[35,34,31,29,26,24,22,19,16,13,10,7])+
     metric('Resolved This Week','12','4 more','up',[20,23,26,30,35,38,39,44,50,55,61,68])+'</div>'+
     '<article class="rd-panel"><div class="rd-panel-title">Owner Attention Queue</div><div class="rd-alert-list">'+
     list.map((e,i)=>'<div><span class="rd-alert-dot '+(i<2?'urgent':'')+'"></span><strong>'+e[0]+'</strong><span>'+e[1]+'</span><p>'+e[2]+'</p></div>').join('')+
     '</div><p class="rd-note">All alerts shown here are fictional sample entries. This preview does not trigger notifications.</p></article>';
 }
 const renderers={dashboard,financials,store:storePerformance,sales,customers,operations,staff,alerts};
 function render(){
   const title=sections.find(s=>s[0]===state.section)?.[1]||'Dashboard';
   return '<section class="rd-shell" data-rd-root aria-label="Reference-inspired dashboard concept">'+
    '<aside class="rd-sidebar"><div class="rd-brand"><div class="rd-brand-mark">✦</div><div><strong>Don Macchiatos</strong><span>Dashboard concept</span></div></div>'+
    '<nav aria-label="Reference layout sections">'+sections.map(s=>
      '<button type="button" data-rd-section="'+s[0]+'" class="'+(state.section===s[0]?'active':'')+'" aria-current="'+(state.section===s[0]?'page':'false')+'">'+
        '<span class="rd-nav-glyph">'+s[2]+'</span>'+esc(s[1])+'</button>').join('')+'</nav>'+
     '<div class="rd-side-profile"><div class="rd-profile-avatar">DM</div><div><strong>Owner Preview</strong><small>Sample account</small></div></div></aside>'+
    '<div class="rd-main"><header class="rd-main-heading"><div><h2>'+esc(title)+'</h2>'+
      '<span class="rd-main-subtitle">Reference-inspired design · interactive sample preview</span></div>'+
      '<div class="rd-main-badges">'+badge+'<span class="rd-readonly">READ-ONLY</span></div></header>'+
      '<div class="rd-body">'+renderers[state.section]()+'</div>'+
      '<div class="rd-bottom-note">Design-only reference adapted for Don Macchiatos. Branches, visitors, revenue, expense figures and product rankings are fictional examples and not current POS records.</div>'+
     '</div></section>';
 }
 root.addEventListener('click',ev=>{
   const target=ev.target.closest('[data-rd-section],[data-rd-branch],[data-rd-ranking],[data-rd-toggle]');
   if(!target||!target.closest('[data-rd-root]'))return;
   if(target.hasAttribute('data-rd-section')){
      const sec=target.dataset.rdSection;if(!renderers[sec])return;state.section=sec;
   }
   if(target.hasAttribute('data-rd-branch')){
      const branch=Number(target.dataset.rdBranch);if(!Number.isSafeInteger(branch)||branch<0||branch>=branches.length)return;
      state.branch=branch;
   }
   if(target.hasAttribute('data-rd-ranking')){
      if(!['top','bottom'].includes(target.dataset.rdRanking))return;state.ranking=target.dataset.rdRanking;
   }
   if(target.hasAttribute('data-rd-toggle')){
      const v=Number(target.dataset.rdToggle);
      if(!Number.isSafeInteger(v)||v<0||v>=branches.length)return;
      if(state.disabled.has(v))state.disabled.delete(v);else state.disabled.add(v);
      if(state.disabled.size===branches.length)state.disabled.clear();
   }
   const scroll=root.scrollTop;
   root.innerHTML=render();root.scrollTop=scroll;
 });
 window.DonmacReferenceDashboard={render};
})();