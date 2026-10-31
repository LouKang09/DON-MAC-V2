/* Dashboard concept gallery: all preview data is invented and marked SAMPLE.
   Feature removal marks are session-only review notes, never production config.
   No external services, mutating requests, subscription or storage writes. */
(() => {
  'use strict';
  const root=document.getElementById('premiumPreviewContent');
  if(!root)return;
  const removed=new Set();
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const peso=v=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP',maximumFractionDigits:0}).format(Number(v)||0);
  const sampleTag='<span class="pg-sample-tag">SAMPLE DATA</span>';
  const bullet=(text)=>'<span class="pg-chip">'+esc(text)+'</span>';
  const bar=(name,n,max,detail='')=>'<div class="pg-bar-row"><span>'+esc(name)+'</span><div class="pg-bar-track"><i style="width:'+Math.min(100,Math.max(0,100*n/Math.max(1,max))).toFixed(1)+'%"></i></div><strong>'+esc(detail||String(n))+'</strong></div>';
  const tile=(label,value,comment='')=>'<div class="pg-metric"><small>'+esc(label)+'</small><strong>'+esc(value)+'</strong>'+(comment?'<span>'+esc(comment)+'</span>':'')+'</div>';
  const table=(heads,rows)=>'<div class="pg-table-scroll"><table class="pg-table"><thead><tr>'+heads.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
  const smallNote=s=>'<p class="pg-sample-note">'+esc(s)+'</p>';
  const fig={
    engineering:()=>'<div class="pg-quadrants">'+[
      ['Stars','Best sellers / strong margin','Iced Mocha · 42%','good'],
      ['Puzzles','High margin / low volume','Hazelnut Latte · 45%','warn'],
      ['Plowhorses','Popular / lower margin','Classic Iced · 24%','mid'],
      ['Dogs','Low margin / low volume','Seasonal Tea · 18%','low']
    ].map(x=>'<div class="pg-quadrant pg-q-'+x[3]+'"><strong>'+x[0]+'</strong><span>'+x[1]+'</span><small>'+x[2]+'</small></div>').join('')+'</div>'+smallNote('Example margin is illustrative. Real results need validated recipe costs.'),
    boughtTogether:()=>bar('Iced Mocha + Fries',86,100,'86 baskets')+bar('Latte + Cookie',64,100,'64 baskets')+bar('Cold Brew + Muffin',37,100,'37 baskets'),
    addon:()=>'<div class="pg-metrics">'+tile('Orders with add-ons','32%','64 of 200 orders')+tile('Add-on sales','₱2,880','Sample period')+'</div>'+
      '<div class="pg-progress"><span style="width:32%"></span></div>'+smallNote('32 out of every 100 orders included an add-on in this example.'),
    slow:()=>table(['Item','Units / 30 days','Action'],[['Vanilla Tea','3','Review'],['Seasonal Cookie','5','Test placement'],['Almond Latte','7','Promote']]),
    growth:()=>'<div class="pg-metrics">'+tile('This week','₱58,200','+12.3% vs last week')+tile('Previous week','₱51,820')+'</div>'+
      bar('Monday',7200,14000,'₱7,200')+bar('Saturday',13200,14000,'₱13,200'),
    ingredient:()=>table(['Ingredient','Old / unit','Now / unit','Change'],[['Coffee beans','₱820','₱880','+7.3%'],['Milk','₱92','₱99','+7.6%'],['Sugar','₱55','₱55','0%']])+smallNote('Cost history requires recording supplier prices by purchase date.'),
    discount:()=>'<div class="pg-metrics">'+tile('Promo sales','₱9,600','Sample period')+tile('Discount cost','₱1,250','Discount value')+'</div>'+
      bar('Bundle promo',58,70,'58 orders')+bar('Student promo',29,70,'29 orders'),
    opportunity:()=>bar('Mon 2–4 PM',18,100,'Low traffic')+bar('Wed 3–5 PM',26,100,'Low traffic')+
      bar('Sat 11–1 PM',94,100,'Peak')+smallNote('Consider testing a mid-afternoon promotion during slower times.'),
    pairings:()=>'<div class="pg-pairings">'+
      '<div><strong>Iced Mocha + Fries</strong><span>Suggested combo</span><b>₱145</b></div>'+
      '<div><strong>Cappuccino + Cookie</strong><span>Suggested combo</span><b>₱130</b></div></div>'+
      smallNote('Suggested pairings are illustrative and not automatically applied to the catalog.'),
    daily:()=>'<div class="pg-insight"><span class="pg-insight-icon">✦</span><div><strong>Today’s business brief</strong>'+
      '<p>Orders rose 14%, but average order value fell 5%. Iced coffee drove most sales while add-on conversion was lower after lunch.</p></div></div>'+
      '<div class="pg-chips">'+bullet('Review add-on prompts')+bullet('Check afternoon promotions')+'</div>',
    health:()=>'<div class="pg-health-list">'+[['SM Branch',94],['Ayala Branch',85],['Main Branch',68]].map(x=>
      '<div><span>'+x[0]+'</span><div class="pg-bar-track"><i style="width:'+x[1]+'%"></i></div><strong>'+x[1]+'/100</strong></div>').join('')+'</div>'+
      smallNote('Health score formula must be agreed before production.'),
    samestore:()=>'<div class="pg-metrics">'+tile('Established branch growth','+8.6%','Comparable stores only')+tile('New branches excluded','1','From growth baseline')+'</div>'+
      table(['Branch','Prior month','Current','Change'],[['SM','₱128k','₱142k','+10.9%'],['Main','₱101k','₱106k','+5.0%']]),
    productbranch:()=>table(['Menu item','SM','Ayala','Main'],[['Iced Mocha','162','98','74'],['Cappuccino','88','121','60'],['Cookies','68','42','31']])+smallNote('Quantity sold by branch, sample month.'),
    cash:()=>'<div class="pg-metrics">'+tile('Expected cash','₱12,840')+tile('Actual count','₱12,720','−₱120 variance')+'</div>'+
      '<div class="pg-alert pg-alert-warn">Review cash difference before confirming the branch closeout.</div>',
    suspicious:()=>'<div class="pg-event-list">'+[
      ['14:05','GCash → Cash edited','Review transaction audit'],
      ['15:18','Unusual 3 voids','Review void reasons'],
      ['17:42','Repeated discount','Check authorization']
    ].map(x=>'<div><span>'+x[0]+'</span><strong>'+x[1]+'</strong><small>'+x[2]+'</small></div>').join('')+'</div>'+
    smallNote('Flags are review prompts, not proof of wrongdoing.'),
    transfers:()=>table(['Transfer','From → To','Amount','Status'],[['TR-024','Main → SM','5 L milk','Received'],['TR-025','Ayala → Main','2 kg beans','In transit'],['TR-026','Main → Ayala','3 kg sugar','Pending']]),
    suppliers:()=>table(['Supplier','On-time','Avg. price change','Score'],[['Supplier A','98%','+2.1%','93/100'],['Supplier B','85%','+5.3%','79/100'],['Supplier C','92%','+1.8%','89/100']]),
    labor:()=>bar('SM Branch',1480,2000,'₱1,480/hr')+bar('Ayala',1260,2000,'₱1,260/hr')+
      bar('Main',1080,2000,'₱1,080/hr')+smallNote('Requires accurate clock-in/out or recorded paid hours.'),
    closing:()=>'<div class="pg-closure">'+[
      ['SM Branch','Closed · reconciled','ok'],
      ['Ayala Branch','Cash count pending','warn'],
      ['Main Branch','Stock count pending','warn']
    ].map(x=>'<div><strong>'+x[0]+'</strong><span class="pg-closure-'+x[2]+'">'+x[1]+'</span></div>').join('')+'</div>',
    actions:()=>'<div class="pg-task-list">'+[
      ['Confirm Ayala cash close','High priority','Owner'],
      ['Approve milk transfer','Pending','Co-Owner'],
      ['Review falling sales at Main','Review','Manager']
    ].map(x=>'<div><span class="pg-task-dot"></span><strong>'+x[0]+'</strong><span>'+x[1]+'</span><small>'+x[2]+'</small></div>').join('')+'</div>',
    assistant:()=>'<div class="pg-insight"><span class="pg-insight-icon">✦</span><div><strong>Why did sales increase?</strong>'+
      '<p>Sample insight: sales increased 9% this week, led by weekend coffee orders. Transactions grew 13% while average spend decreased 4%.</p></div></div>'+
      '<div class="pg-chips">'+bullet('13% more orders')+bullet('4% smaller baskets')+'</div>',
    simulator:()=>'<div class="pg-simulator"><div class="pg-sim-head"><span>Price adjustment per cup</span>'+
      '<strong id="pgSimAmount">+₱5</strong></div><input id="pgSimSlider" data-pg-simulator type="range" min="-10" max="20" value="5" step="1" aria-label="Simulated price change per cup"/>'+
      '<div class="pg-sim-outcomes">'+tile('Sample units / month','1,200')+
      '<div class="pg-metric"><small>Revenue difference*</small><strong id="pgSimRevenue">+₱6,000</strong><span>Same sales volume assumed</span></div></div>'+
      smallNote('*Illustrative scenario. Changes in demand, taxes, costs, and discounts are excluded.')+'</div>',
    customize:()=>'<div class="pg-widget-custom"><div class="pg-widget-custom-head">Example dashboard layout</div>'+
      '<div class="pg-widget-tiles"><span>Sales Trend <b>↕</b></span><span>Orders <b>↕</b></span><span>Stock Alerts <b>↕</b></span><span>Products <b>↕</b></span></div>'+
      '<p>Owners could pin, hide, resize, and reorder widgets. No live layout is changed in this preview.</p></div>'
  };
  const items=[
    {id:'pro-menu-engineering',tier:'pro',title:'Menu Engineering Matrix',why:'Classify products by popularity and gross margin to make better menu decisions.',view:'engineering'},
    {id:'pro-bought-together',tier:'pro',title:'Frequently Bought Together',why:'Identify products that appear together in completed orders.',view:'boughtTogether'},
    {id:'pro-addon-conversion',tier:'pro',title:'Add-on Conversion Rate',why:'See which percentage of orders include extra products and upgrades.',view:'addon'},
    {id:'pro-slow-products',tier:'pro',title:'Slow-Moving Products',why:'Find low-demand menu items that may need changes or removal.',view:'slow'},
    {id:'pro-sales-growth',tier:'pro',title:'Sales Growth Comparison',why:'Compare periods fairly and distinguish business growth from routine variations.',view:'growth'},
    {id:'pro-ingredient-cost',tier:'pro',title:'Ingredient Cost Changes',why:'Track purchasing cost increases before they erode product margins.',view:'ingredient'},
    {id:'pro-discount-impact',tier:'pro',title:'Discount Impact Analyzer',why:'Assess whether promotions generate enough sales to justify their discount cost.',view:'discount'},
    {id:'pro-opportunity-hours',tier:'pro',title:'Sales Opportunity Hours',why:'Find quieter periods suitable for targeted promotions and staffing adjustments.',view:'opportunity'},
    {id:'pro-product-pairings',tier:'pro',title:'Product Pairing Recommendations',why:'Propose attractive bundles using item-level transaction patterns.',view:'pairings'},
    {id:'pro-daily-insights',tier:'pro',title:'Daily Business Insights',why:'Summarize the most important changes and suggest next actions.',view:'daily'},
    {id:'biz-branch-health',tier:'business',title:'Branch Health Score',why:'Compare overall branch performance with an agreed score formula.',view:'health'},
    {id:'biz-same-store',tier:'business',title:'Same-Store Sales Growth',why:'Compare established branches without new-location distortions.',view:'samestore'},
    {id:'biz-product-comparison',tier:'business',title:'Branch Product Comparison',why:'Discover why some menu items perform better at different locations.',view:'productbranch'},
    {id:'biz-cash-variance',tier:'business',title:'Cash Drawer Variance',why:'Spot discrepancies between expected cash and counted money.',view:'cash'},
    {id:'biz-transaction-monitor',tier:'business',title:'Suspicious Transaction Monitor',why:'Flag unusual adjustments, refunds or void patterns for authorized review.',view:'suspicious'},
    {id:'biz-stock-transfers',tier:'business',title:'Inter-Branch Stock Transfers',why:'Track goods sent, received, pending and overdue across branches.',view:'transfers'},
    {id:'biz-suppliers',tier:'business',title:'Supplier Performance Scorecard',why:'Compare supplier reliability, prices and order accuracy.',view:'suppliers'},
    {id:'biz-labor-productivity',tier:'business',title:'Sales per Labor Hour',why:'Understand sales generated for each recorded hour worked.',view:'labor'},
    {id:'biz-closing-compliance',tier:'business',title:'Branch Closing Compliance',why:'Check which branches have reconciled cash and completed closing tasks.',view:'closing'},
    {id:'biz-action-center',tier:'business',title:'Owner Action Center',why:'Collect approvals and critical decisions into one prioritized inbox.',view:'actions'},
    {id:'standout-insights',tier:'both',title:'Business Insights Assistant',why:'Explain sales and operational changes in plain language.',view:'assistant'},
    {id:'standout-whatif',tier:'business',title:'What-If Profit Simulator',why:'Explore potential revenue changes with transparent assumptions and no POS writes.',view:'simulator'},
    {id:'standout-custom',tier:'both',title:'Customizable Dashboard',why:'Allow owners to choose and arrange the dashboard panels most useful to them.',view:'customize'}
  ];
  function card(item,index){
    const rejected=removed.has(item.id);
    return '<article class="pg-card'+(rejected?' pg-marked-remove':'')+'" data-pg-card="'+esc(item.id)+'">'+
      '<div class="pg-card-top"><span class="pg-feature-number">'+String(index+1).padStart(2,'0')+'</span>'+
      '<span class="pg-feature-tier">'+(item.tier==='pro'?'PRO':item.tier==='business'?'BUSINESS':'BOTH TIERS')+'</span>'+
      sampleTag+'</div>'+
      '<h5>'+esc(item.title)+'</h5><p class="pg-why">'+esc(item.why)+'</p>'+
      '<div class="pg-visual">'+fig[item.view]()+'</div>'+
      '<div class="pg-card-review"><span class="pg-review-state">'+(rejected?'Marked for removal':'Keep for review')+'</span>'+
      '<button type="button" data-pg-remove="'+esc(item.id)+'" aria-pressed="'+String(rejected)+'">'+
      (rejected?'Undo removal':'Mark for removal')+'</button></div></article>';
  }
  function render(tier){
    const current=items.filter(x=>x.tier===tier||x.tier==='both');
    const core=current.filter(x=>x.tier===tier);
    const highlights=current.filter(x=>x.tier==='both');
    const removedCount=items.filter(x=>removed.has(x.id)).length;
    return '<section class="pg-gallery" aria-label="Sample feature review gallery">'+
      '<header class="pg-gallery-heading"><div><span class="premium-preview-overline">FEATURE REVIEW GALLERY · SAMPLE DATA</span>'+
      '<h4>Explore '+(tier==='pro'?'Pro':'Business')+' features</h4>'+
      '<p>Review each feature with illustrative sample data. Mark anything you want to remove; no production settings are affected.</p></div>'+
      '<div class="pg-gallery-count"><strong>'+current.length+'</strong><span>concepts in this tab</span></div></header>'+
      '<div class="pg-review-toolbar"><div class="pg-review-status"><strong id="pgRemovedCount">'+removedCount+'</strong> of '+items.length+' features marked for removal across both tiers</div>'+
      '<div class="pg-review-actions"><button type="button" data-pg-copy>Copy removal shortlist</button>'+
      '<button type="button" data-pg-reset>Clear marks</button></div></div>'+
      '<div class="pg-gallery-label">NEW '+(tier==='pro'?'PRO':'BUSINESS')+' DASHBOARD CONCEPTS</div>'+
      '<div class="pg-gallery-grid">'+core.map((x,i)=>card(x,i)).join('')+'</div>'+
      '<div class="pg-gallery-label">STANDOUT CONCEPTS'+(tier==='business'?' · ALSO INCLUDES PRO INSIGHTS':'')+'</div>'+
      '<div class="pg-gallery-grid">'+highlights.map((x,i)=>card(x,i+core.length)).join('')+'</div>'+
      (tier==='business'?'<div class="pg-gallery-label">BUSINESS EXCLUSIVE SIMULATOR</div>'+
        '<div class="pg-gallery-grid pg-one-wide">'+items.filter(x=>x.id==='standout-whatif').map(x=>card(x,core.length+highlights.length)).join('')+'</div>':'')+
      '<p class="pg-session-note">All charts, example transactions, percentages, and scores in this gallery are fictional. Removal marks are temporary until you share the shortlist; they do not change your dashboard.</p>'+
      '</section>';
  }
  function refreshStates(){
    for(const article of root.querySelectorAll('[data-pg-card]')){
      const marked=removed.has(article.dataset.pgCard);
      article.classList.toggle('pg-marked-remove',marked);
      const btn=article.querySelector('[data-pg-remove]'),label=article.querySelector('.pg-review-state');
      if(btn){btn.setAttribute('aria-pressed',String(marked));btn.textContent=marked?'Undo removal':'Mark for removal';}
      if(label)label.textContent=marked?'Marked for removal':'Keep for review';
    }
    const n=root.querySelector('#pgRemovedCount');
    if(n)n.textContent=removed.size;
  }
  async function copyReview(button){
    const shortlist=items.filter(x=>removed.has(x.id));
    const summary='Don Macchiatos dashboard preview — removal shortlist\n'+
      (shortlist.length?shortlist.map((x,i)=>(i+1)+'. ['+(x.tier==='both'?'Both':x.tier.toUpperCase())+'] '+x.title).join('\n'):
        'No features marked for removal yet.')+
      '\n\nThese are review notes only. No dashboard was changed.';
    let copied=false;
    try{
      if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(summary);copied=true;}
    }catch(_){}
    if(!copied){
      const el=document.createElement('textarea');el.value=summary;el.setAttribute('readonly','');el.style.position='fixed';el.style.left='-9999px';
      document.body.appendChild(el);el.select();
      try{copied=!!document.execCommand('copy');}catch(_){}
      el.remove();
    }
    const before=button.textContent;
    button.textContent=copied?'Copied removal shortlist':'Could not copy — try desktop browser';
    setTimeout(()=>{if(button.isConnected)button.textContent=before;},1800);
  }
  root.addEventListener('click',e=>{
    const choice=e.target.closest('[data-pg-remove]');
    if(choice&&root.contains(choice)){
      const id=choice.dataset.pgRemove;if(!items.some(x=>x.id===id))return;
      if(removed.has(id))removed.delete(id);else removed.add(id);
      refreshStates();return;
    }
    const copy=e.target.closest('[data-pg-copy]');if(copy&&root.contains(copy)){copyReview(copy);return;}
    const clear=e.target.closest('[data-pg-reset]');if(clear&&root.contains(clear)){removed.clear();refreshStates();}
  });
  root.addEventListener('input',e=>{
    const input=e.target.closest('[data-pg-simulator]');
    if(!input)return;
    const delta=Math.max(-10,Math.min(20,Number(input.value)||0));
    const amount=root.querySelector('#pgSimAmount'),output=root.querySelector('#pgSimRevenue');
    if(amount)amount.textContent=(delta>=0?'+':'−')+'₱'+Math.abs(delta);
    if(output)output.textContent=(delta>=0?'+':'−')+peso(Math.abs(delta*1200));
  });
  window.DonmacPremiumFeatureReview={render};
})();