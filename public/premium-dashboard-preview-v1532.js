/* Don Macchiatos POS — non-destructive Pro/Business dashboard preview.
 * Uses authenticated existing GET reporting routes only. No writes and no subscriptions.
 */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const openBtn=$('dashboardPremiumPreviewOpen');
  const dialog=$('premiumDashboardPreview');
  if(!openBtn||!dialog)return;
  const content=$('premiumPreviewContent'),pro=$('premiumPreviewProTab'),business=$('premiumPreviewBusinessTab');
  const money=n=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP',maximumFractionDigits:2}).format(Number(n)||0);
  const count=n=>new Intl.NumberFormat('en-PH',{maximumFractionDigits:0}).format(Number(n)||0);
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const dataSource='<span class="premium-preview-source">LIVE POS DATA</span>';
  const pendingSource='<span class="premium-preview-planned">PLANNED FEATURE</span>';
  const feature=(title,desc,icon)=>'<article class="premium-preview-feature"><span class="premium-preview-feature-icon" aria-hidden="true">'+icon+
    '</span><div><strong>'+esc(title)+'</strong><p>'+esc(desc)+'</p></div>'+pendingSource+'</article>';
  const state={tier:'pro',data:null,branches:null,requestId:0,loadingBranches:false,open:false};
  const icons={
    target:'◎', margin:'◈', stock:'▣', promo:'◇', payment:'▤', alert:'⚑', people:'♙', expenses:'₱', forecast:'⌁',report:'▥',efficiency:'✦'
  };
  function kpi(label,value,detail,source='live'){
    return '<article class="premium-preview-kpi"><div class="premium-preview-kpi-label">'+esc(label)+'</div>'+
      '<strong>'+esc(value)+'</strong><p>'+esc(detail)+'</p>'+
      (source==='live'?dataSource:pendingSource)+'</article>';
  }
  function salesChart(trend){
    const rows=Array.isArray(trend)?trend:[];
    if(!rows.length)return '<div class="premium-preview-blank">No sales timeline data available for this period.</div>';
    const vals=rows.map(r=>Math.max(0,Number(r.actual)||0)),max=Math.max(1,...vals);
    const W=760,H=228,L=50,R=12,T=18,B=38,pw=W-L-R,ph=H-T-B;
    const x=i=>L+(rows.length===1?pw/2:i/(rows.length-1)*pw);
    const y=v=>T+ph-(v/max)*ph;
    const points=vals.map((v,i)=>[x(i),y(v)]);
    const path=points.map(([a,b],i)=>(i?'L':'M')+a.toFixed(1)+' '+b.toFixed(1)).join(' ');
    const area=path+' L'+x(rows.length-1).toFixed(1)+' '+(T+ph)+' L'+x(0).toFixed(1)+' '+(T+ph)+' Z';
    const grid=[0,.25,.5,.75,1].map(z=>'<line x1="'+L+'" x2="'+(W-R)+'" y1="'+y(max*z).toFixed(1)+'" y2="'+y(max*z).toFixed(1)+'" stroke="#e2ebe1"/>'+
      '<text x="'+(L-9)+'" y="'+(y(max*z)+4).toFixed(1)+'" font-size="11" fill="#7c9083" text-anchor="end">'+
      esc(max*z>=1000?(max*z/1000).toFixed(1)+'k':Math.round(max*z))+'</text>').join('');
    const every=Math.max(1,Math.ceil(rows.length/6));
    const xLabels=rows.map((r,i)=>i%every===0||i===rows.length-1?
      '<text x="'+x(i).toFixed(1)+'" y="'+(H-9)+'" fill="#7c9183" text-anchor="middle" font-size="11">'+esc(r.label)+'</text>':'').join('');
    return '<svg class="premium-preview-svg" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Actual sales over the selected period, maximum '+money(max)+'">'+
      '<defs><linearGradient id="premiumSalesFade" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#5ca377" stop-opacity=".3"/><stop offset="1" stop-color="#5ca377" stop-opacity="0"/></linearGradient></defs>'+
      grid+'<path d="'+area+'" fill="url(#premiumSalesFade)"/><path d="'+path+'" fill="none" stroke="#186741" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>'+
      points.filter((_,i)=>i===0||i===rows.length-1||vals[i]===max).map(([a,b])=>'<circle cx="'+a.toFixed(1)+'" cy="'+b.toFixed(1)+'" r="4" fill="#186741" stroke="white" stroke-width="2"/>').join('')+
      xLabels+'</svg>';
  }
  function productRows(items){
    const products=(Array.isArray(items)?items:[]).filter(x=>x.name).slice(0,6);
    if(!products.length)return '<p class="premium-preview-empty">No sales recorded for products this month.</p>';
    const max=Math.max(1,...products.map(p=>Number(p.qty)||0));
    return products.map((p,i)=>{
      const qty=Math.max(0,Number(p.qty)||0);
      return '<div class="premium-preview-product"><span class="premium-preview-product-index">'+(i+1)+'</span>'+
        '<span class="premium-preview-product-name" title="'+esc(p.name)+'">'+esc(p.name)+'</span>'+
        '<div class="premium-preview-product-track"><div style="width:'+Math.max(0,qty/max*100).toFixed(1)+'%"></div></div>'+
        '<strong>'+count(qty)+'</strong></div>';
    }).join('');
  }
  function categoryMix(series){
    const categories=(Array.isArray(series)?series:[]).map(s=>({
      name:s.name,amount:(Array.isArray(s.values)?s.values:[]).reduce((sum,v)=>sum+(Number(v)||0),0)
    })).filter(c=>c.amount>0).sort((a,b)=>b.amount-a.amount);
    const max=Math.max(1,...categories.map(c=>c.amount));
    if(!categories.length)return '<p class="premium-preview-empty">No category sales recorded in this range.</p>';
    return categories.map(c=>'<div class="premium-preview-mix-row"><span>'+esc(c.name)+'</span>'+
      '<div class="premium-preview-mini-track"><i style="width:'+Math.max(0,c.amount/max*100).toFixed(1)+'%"></i></div>'+
      '<strong>'+money(c.amount)+'</strong></div>').join('');
  }
  function hero(data){
    const selected=$('dashboardBranch')?.value;
    const branch=selected&&selected!=='all'?$('dashboardBranch')?.selectedOptions?.[0]?.textContent:'All branches';
    return '<div class="premium-preview-hero"><div><span class="premium-preview-hero-eyebrow">'+
      esc(state.tier==='pro'?'PRO ANALYTICS':'BUSINESS INTELLIGENCE')+' · DESIGN PREVIEW</span>'+
      '<h3>Grow with better information.</h3><p>'+esc(state.tier==='pro'?
      'Understand sales patterns and identify your next opportunities.':
      'See branch performance, operational risks, and expansion-ready reporting.')+'</p></div>'+
      '<div class="premium-preview-hero-scope"><strong>'+esc(branch||'Selected branch')+'</strong>'+
      '<span>'+esc(data.from&&data.to?data.from+(data.from!==data.to?' → '+data.to:''):'Selected period')+'</span></div></div>';
  }
  function commonKPIs(d){
    const m=d.metrics||{};
    return '<div class="premium-preview-kpis">'+
      kpi('Selected-range Sales',money(d.rangeActual),'Completed POS transactions')+
      kpi('Completed Orders',count(d.rangeTransactions),'Selected dashboard period')+
      kpi('Average Order Value',money(Number(d.rangeTransactions)>0?Number(d.rangeActual)/Number(d.rangeTransactions):0),'Sales divided by completed orders')+
      kpi('Today’s Sales',money(m.todayActual),'Recorded today, Philippine time')+
      '</div>';
  }
  function proInsights(d){
    const peaks=(d.trend||[]).filter(t=>Number(t.actual)>0).sort((a,b)=>Number(b.actual)-Number(a.actual));
    const peak=peaks[0];
    return '<div class="premium-preview-two-col">'+
      '<section class="premium-preview-panel"><div class="premium-preview-panel-heading"><div><span class="premium-preview-overline">SALES ANALYTICS</span>'+
      '<h4>Actual Sales Timeline</h4></div>'+dataSource+'</div>'+
      '<p class="premium-preview-panel-note">Based on completed sales; '+(d.grain==='hourly'?'hourly':'daily')+' data.</p>'+
      salesChart(d.trend)+'</section>'+
      '<section class="premium-preview-panel"><div class="premium-preview-panel-heading"><div><span class="premium-preview-overline">PRODUCT INTELLIGENCE</span>'+
      '<h4>Top Products This Month</h4></div>'+dataSource+'</div>'+
      '<p class="premium-preview-panel-note">Units sold, not estimated profitability.</p>'+
      '<div class="premium-preview-products">'+productRows(d.topProducts)+'</div>'+
      (peak?'<div class="premium-preview-peak">Highest recorded period <strong>'+esc(peak.label)+' · '+money(peak.actual)+'</strong></div>':'')+
      '</section></div>'+
      '<section class="premium-preview-panel"><div class="premium-preview-panel-heading"><div><span class="premium-preview-overline">MENU MIX</span><h4>Category Sales Mix</h4></div>'+
      dataSource+'</div><div class="premium-preview-category-mix">'+categoryMix(d.categoryTrends)+'</div></section>';
  }
  function proPlanned(){
    return '<section class="premium-preview-panel"><div class="premium-preview-panel-heading"><div>'+
      '<span class="premium-preview-overline">PRO ROADMAP</span><h4>Advanced Insights Coming With Pro</h4></div>'+pendingSource+'</div>'+
      '<div class="premium-preview-feature-grid">'+
      feature('Product Profit Margin','Revenue less ingredient recipe cost per product; requires validated costing.','◈')+
      feature('Sales Target vs Actual','Daily and monthly goals with progress and comparison to previous periods.','◎')+
      feature('Ingredient Stock Runway','Estimated selling days remaining from usage and stock on hand.','▣')+
      feature('Payment & Order Mix','Complete breakdown of Cash, GCash and other methods by service type.','▤')+
      feature('Promo Effectiveness','Compare redemptions, incremental sales and estimated margin effect.','◇')+
      feature('Peak-Hour Heatmap','Compare demand by weekday and hour to plan staffing and promotions.','▦')+
      '</div></section>';
  }
  function comparison(){
    if(state.loadingBranches)return '<div class="premium-preview-blank">Loading branch sales from existing POS records…</div>';
    const branches=state.branches;
    if(branches?.error)return '<div class="premium-preview-blank">Branch comparison unavailable: '+esc(branches.error)+'. Current dashboard remains unaffected.</div>';
    if(!Array.isArray(branches)||!branches.length)return '<div class="premium-preview-blank">No active branches available for comparison yet.</div>';
    const max=Math.max(1,...branches.filter(x=>!x.unavailable).map(x=>Number(x.amount)||0));
    return '<div class="premium-preview-branch-list">'+branches.map((b,i)=>
      '<div class="premium-preview-branch-row"><span class="premium-preview-branch-number">'+(i+1)+'</span>'+
      '<span class="premium-preview-branch-name">'+esc(b.name)+'</span>'+
      '<span class="premium-preview-branch-bar"><span style="width:'+Math.max(0,(Number(b.amount)||0)/max*100).toFixed(1)+'%"></span></span>'+
      '<strong>'+(b.unavailable?'Unavailable':money(b.amount))+'</strong></div>'
    ).join('')+'</div>'+
    '<p class="premium-preview-hint">Actual current-month sales from existing branch reports. Up to 8 active branches shown.'+
      (branches.length===8?' Larger accounts will support full comparison in the finished Business dashboard.':'')+'</p>';
  }
  function businessPlanned(d){
    return '<div class="premium-preview-business-grid">'+
      '<section class="premium-preview-panel"><div class="premium-preview-panel-heading"><div>'+
      '<span class="premium-preview-overline">BRANCH OPERATIONS</span><h4>Branch Sales Leaderboard</h4></div>'+dataSource+'</div>'+
      comparison()+'</section>'+
      '<section class="premium-preview-panel"><div class="premium-preview-panel-heading"><div>'+
      '<span class="premium-preview-overline">OPERATIONAL WATCH</span><h4>Stock Warning Overview</h4></div>'+dataSource+'</div>'+
      '<div class="premium-preview-stock-number">'+count(d.metrics?.lowStockCount)+'</div>'+
      '<p class="premium-preview-panel-note">Low-stock ingredients in shared inventory. Branch-specific balances require separate stock ledgers.</p>'+
      '<div class="premium-preview-stock-items">'+(d.lowStock?.length?
         d.lowStock.slice(0,5).map(item=>'<span>'+esc(item.name)+'</span>').join(''):
         '<span>No low-stock ingredients currently reported.</span>')+'</div>'+
      '</section></div>'+
      '<section class="premium-preview-panel"><div class="premium-preview-panel-heading"><div>'+
      '<span class="premium-preview-overline">BUSINESS ROADMAP</span><h4>Advanced Business Intelligence</h4></div>'+pendingSource+'</div>'+
      '<div class="premium-preview-feature-grid">'+
      feature('Branch Profit & Loss','Branch revenue compared with ingredients, rent, utilities, labor and other expenses.','₱')+
      feature('Inventory Variance & Waste','Detect unusual consumption, spoilage, and physical-vs-system discrepancies.','⚑')+
      feature('Employee Productivity','Compare sales per labor hour after attendance and payroll data are available.','♙')+
      feature('Sales & Stock Forecasts','Demand projections and replenishment guidance using sufficient sales history.','⌁')+
      feature('Owner Alert Center','Aggregate unusual adjustments, stock risks, and operational exceptions.','!')+
      feature('Automated Executive Reports','Scheduled business summaries and consolidated performance reporting.','▥')+
      '</div></section>';
  }
  function setTab(tier){
    state.tier=tier;
    for(const [node,selected] of [[pro,tier==='pro'],[business,tier==='business']]){
      node.setAttribute('aria-selected',selected?'true':'false');
      node.tabIndex=selected?0:-1;
    }
    render();
    if(tier==='business')loadBranches();
  }
  const featureGallery=()=>window.DonmacPremiumFeatureReview?.render(state.tier)||'';
  function render(){
    if(!state.open)return;
    const d=state.data;
    if(!d){content.innerHTML='<p class="premium-preview-loading">Loading current dashboard data. You can explore the sample feature gallery below.</p>'+featureGallery();return;}
    content.innerHTML=hero(d)+commonKPIs(d)+
      (state.tier==='pro'?proInsights(d)+proPlanned():
        '<div class="premium-preview-business-intro">Business includes all Pro analytics plus multi-branch management insights.</div>'+
        businessPlanned(d)+
        '<section class="premium-preview-panel"><div class="premium-preview-panel-heading"><div><span class="premium-preview-overline">INCLUDED FROM PRO</span><h4>Sales & Product Analytics</h4></div>'+dataSource+'</div>'+
        '<div class="premium-preview-two-col premium-preview-nested"><div>'+salesChart(d.trend)+'</div><div class="premium-preview-products">'+productRows(d.topProducts)+'</div></div></section>')+
      featureGallery()+'<div class="premium-preview-disclaimer">This is a design preview, not a subscription or production dashboard change. No plan is activated. LIVE POS DATA uses current reporting; SAMPLE DATA in the feature gallery is fictional and for illustration only. Marking a feature for removal does not change the production dashboard.</div>';
  }
  async function get(url){
    const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),18000);
    try{
      const res=await fetch(url,{method:'GET',credentials:'same-origin',cache:'no-store',signal:ctrl.signal,headers:{Accept:'application/json'}});
      if(!res.ok)throw new Error('HTTP '+res.status);
      return await res.json();
    }finally{clearTimeout(timer);}
  }
  function dashboardQuery(){
    const q=new URLSearchParams(),type=$('trendView')?.value||'hourly';
    q.set('view',type);
    if(type==='custom'){
      if($('trendFrom')?.value)q.set('from',$('trendFrom').value);
      if($('trendTo')?.value)q.set('to',$('trendTo').value);
    }
    if($('dashboardBranch')?.value&&$('dashboardBranch').value!=='all')q.set('branchId',$('dashboardBranch').value);
    return q;
  }
  async function loadCurrent(requestId){
    try{
      const actual=await get('/api/dashboard?'+dashboardQuery().toString());
      if(!state.open||requestId!==state.requestId)return;
      state.data=actual;render();
    }catch(e){
      if(!state.open||requestId!==state.requestId)return;
      if(window.__donmacDashboardData){
        state.data=window.__donmacDashboardData;render();
      }else{
        content.innerHTML='<div class="premium-preview-blank">Live dashboard figures are unavailable ('+esc(e.message)+'). You can still review the sample concept gallery below.</div>'+featureGallery();
      }
    }
  }
  async function loadBranches(){
    if(!state.open||state.tier!=='business'||state.branches||state.loadingBranches)return;
    state.loadingBranches=true;render();
    const requestId=state.requestId;
    try{
      const listing=await get('/api/branches');
      const branches=(listing.branches||[]).filter(b=>b.active).slice(0,8);
      const results=[];
      // Limit concurrent dashboard queries so preview does not overload a busy POS.
      for(let i=0;i<branches.length;i+=2){
        if(!state.open||state.requestId!==requestId)return;
        const pair=await Promise.allSettled(branches.slice(i,i+2).map(async b=>{
          const d=await get('/api/dashboard?view=10days&branchId='+encodeURIComponent(b.id));
          return {name:b.name,amount:Number(d.metrics?.monthActual)||0};
        }));
        pair.forEach((r,j)=>{
          if(r.status==='fulfilled')results.push(r.value);
          else results.push({name:branches[i+j].name,amount:0,unavailable:true});
        });
      }
      if(state.requestId===requestId){
        state.branches=results.sort((a,b)=>b.amount-a.amount);
      }
    }catch(e){
      if(state.requestId===requestId)state.branches={error:e.message};
    }finally{
      if(state.requestId===requestId){state.loadingBranches=false;render();}
    }
  }
  function show(){
    if(openBtn.classList.contains('hidden'))return;
    state.open=true;state.data=null;state.branches=null;state.loadingBranches=false;
    const token=++state.requestId;
    dialog.showModal();
    setTab('pro');
    loadCurrent(token);
  }
  function hide(){
    state.open=false;state.requestId++;
    if(dialog.open)dialog.close();
    openBtn.focus({preventScroll:true});
  }
  openBtn.addEventListener('click',show);
  $('premiumPreviewClose').addEventListener('click',hide);
  $('premiumPreviewReturn').addEventListener('click',hide);
  dialog.addEventListener('close',()=>{state.open=false;state.requestId++;});
  dialog.addEventListener('click',e=>{if(e.target===dialog)hide();});
  pro.addEventListener('click',()=>setTab('pro'));
  business.addEventListener('click',()=>setTab('business'));
  [pro,business].forEach(tab=>tab.addEventListener('keydown',e=>{
    if(!['ArrowLeft','ArrowRight'].includes(e.key))return;
    e.preventDefault();(state.tier==='pro'?business:pro).click();(state.tier==='pro'?pro:business).focus();
  }));
})();
