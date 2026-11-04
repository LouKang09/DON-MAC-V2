(() => {
  const $=id=>document.getElementById(id);
  const peso=n=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(n||0));
  const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const normalize=s=>String(s||'').trim().replace(/\s+/g,' ').toUpperCase();
  const manilaToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const num=(n,d=6)=>Number(n||0).toLocaleString('en-PH',{maximumFractionDigits:d});
  const state={status:null,user:null,catalog:null,category:'Coffee',query:'',cart:[],promoId:null,quote:null,inventory:[],report:null,costing:null,dashboard:null,adminProducts:[],adminIngredients:[],adminPromos:[],adminPackages:[],recipeRows:[],compositionRows:[],pendingSaleRequestId:null,checkoutBusy:false,branches:[],userList:[],posBranchId:null};
  const categories=['Coffee','Non Coffee','Food','Add-ons','Promos','Packages'];
  let quoteTimer=null,quoteSeq=0,recipeLoadSeq=0;
  let closeTransferEditorIfOpen=()=>{};

  function safeCloseDialog(id){const d=$(id);if(d?.open){try{d.close();}catch(_){}}}
  async function withFormLock(form,work){
    if(!form||form.dataset.busy==='1')return;
    form.dataset.busy='1';
    form.setAttribute('aria-busy','true');
    const controls=[...form.querySelectorAll('button,input,select,textarea')];
    const prior=controls.map(c=>({c,disabled:c.disabled,text:c.matches('button[type="submit"]')?c.textContent:null}));
    controls.forEach(c=>{c.disabled=true;if(c.matches('button[type="submit"]')&&c.textContent)c.textContent='Please wait…';});
    try{return await work();}
    finally{delete form.dataset.busy;form.removeAttribute('aria-busy');prior.forEach(({c,disabled,text})=>{c.disabled=disabled;if(text!==null)c.textContent=text;});}
  }
  const busyActions=new Set();
  async function withActionLock(key,work){
    if(busyActions.has(key))return;
    busyActions.add(key);
    try{return await work();}
    finally{busyActions.delete(key);}
  }
  function resetOrderState({render=true,resetSearch=true}={}){
    quoteSeq++;
    state.cart=[];state.promoId=null;state.quote=null;state.pendingSaleRequestId=null;state.checkoutBusy=false;
    state.category='Coffee';
    if(resetSearch){state.query='';if($('searchBox'))$('searchBox').value='';}
    if($('seniorEnabled'))$('seniorEnabled').checked=false;
    if($('seniorFields'))$('seniorFields').classList.add('hidden');
    if($('seniorName'))$('seniorName').value='';
    if($('seniorId'))$('seniorId').value='';
    if($('paymentMode'))$('paymentMode').value='Cash';
    if($('cashTender'))$('cashTender').value='';
    if($('gcashReference'))$('gcashReference').value='';
    if($('posCustomerName'))$('posCustomerName').value='';
    if($('posTableLabel'))$('posTableLabel').value='';
    if($('posOrderType'))$('posOrderType').value='Dine In';
    document.querySelectorAll('[data-order-type]').forEach(b=>b.classList.toggle('active',b.dataset.orderType==='Dine In'));
    if($('posTableWrap'))$('posTableWrap').classList.remove('hidden');
    if($('changePreview'))$('changePreview').textContent='Change: '+peso(0);
    if($('modalDue'))$('modalDue').textContent=peso(0);
    if($('quoteMessage'))$('quoteMessage').textContent='';
    if(render&&state.catalog)renderAll();
  }
  function enforceAddonLimits(){
    if(!state.catalog||!state.promoId)return;
    const c=cartCounts();
    state.cart=state.cart.filter(line=>{
      if(line.kind!=='addon')return true;
      const a=state.catalog.addOns.find(x=>x.id===line.id);if(!a)return false;
      const n=normalize(a.name),max=n==='FLAVORED FRIES'?c.food:n==='PREMIUM COFFEE'?c.coffee:line.qty;
      line.qty=Math.min(line.qty,Math.max(0,max));return line.qty>0;
    });
  }

  async function api(url,options={}){
    const controller=new AbortController();
    const timeoutMs=Number(options.timeoutMs||20000);
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    const opts={...options,signal:controller.signal,headers:{...(options.headers||{})}};
    delete opts.timeoutMs;
    if(options.body&&typeof options.body!=='string'){opts.headers['Content-Type']='application/json';opts.body=JSON.stringify(options.body);}
    try{
      const r=await fetch(url,opts);let data={};
      try{data=await r.json();}catch(_){if(!r.ok)data={error:`Server returned ${r.status} without a readable response.`};}
      if(r.status===401&&state.user){state.user=null;resetOrderState({render:false});showAuth(false);throw Object.assign(new Error('Your session expired. Please sign in again.'),{status:401});}
      if(!r.ok){const e=new Error(data.error||`Request failed (${r.status})`);e.status=r.status;e.details=data.details;throw e;}
      return data;
    }catch(err){
      if(err?.name==='AbortError')throw Object.assign(new Error('The POS server did not respond in time. Please retry.'),{status:0});
      if(err instanceof TypeError)throw Object.assign(new Error('Cannot reach the POS server. Keep the START COFFEE POS window open and retry.'),{status:0});
      throw err;
    }finally{clearTimeout(timer);}
  }
  function toast(msg){const t=$('toast');t.textContent=msg;t.classList.add('show');clearTimeout(toast._t);toast._t=setTimeout(()=>t.classList.remove('show'),3500);}
  function showAuth(setupRequired){window.donmacChatUserId=null;window.donmacChat?.loggedIn(null);safeCloseDialog('paymentDialog');safeCloseDialog('receiptDialog');safeCloseDialog('transactionDialog');$('app').classList.add('hidden');$('authScreen').classList.remove('hidden');$('authTitle').textContent=setupRequired?'Create Owner Account':'Sign in';$('authHint').textContent=setupRequired?'Your first account is the Owner. Additional Admin accounts will be Co-Owners.':'Use your web POS account.';$('authSubmit').textContent=setupRequired?'Create Owner':'Sign in';$('authPassword').autocomplete=setupRequired?'new-password':'current-password';}
  function applyTopbarPhoto(){
    const target=$('topbarAvatar');
    if(!target)return;
    const source=state.user?.photoData;
    if(typeof source==='string'&&/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(source)){
      target.innerHTML='<img src="'+esc(source)+'" alt="" loading="eager" decoding="async"/>';
      target.querySelector('img')?.addEventListener('error',()=>{
        target.innerHTML='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="8.1" r="3.5"/><path d="M5 20c0-4 3-6 7-6s7 2 7 6"/></svg>';
      },{once:true});
    }else{
      target.innerHTML='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="8.1" r="3.5"/><path d="M5 20c0-4 3-6 7-6s7 2 7 6"/></svg>';
    }
  }
  function showApp(){
    window.donmacChatUserId=state.user.id;
    window.donmacChat?.loggedIn(state.user.id);
    $('authScreen').classList.add('hidden');
    $('app').classList.remove('hidden');
    document.querySelectorAll('.admin-only,.staff-hidden').forEach(x=>
      x.classList.toggle('hidden',state.user.role!=='Admin'));
    $('dbEngine').textContent=(state.status?.engine||'database').toUpperCase();
    $('appVersion').textContent=state.status?.version||'FINAL';
    $('topbarUsername').textContent=state.user.username;
    applyTopbarPhoto();
    $('topbarRole').textContent=state.user.role==='Admin'
      ?(state.user.isOwner?'Owner/Admin':'Co-Owner/Admin'):'Cashier';
  }

  function planDisplayDate(iso){
    if(!iso || Number.isNaN(new Date(iso).getTime()))return '—';
    return new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',
      year:'numeric',month:'short',day:'numeric'}).format(new Date(iso));
  }
  function subscriptionBadge(status){
    const options={
      PAID:['paid','Paid','<path d="M4 20v-4m5 4V12m5 8V8m5 12V4"/>'],
      ON_HOLD:['hold','On-hold','<path d="M12 4 22 21H2L12 4Z"/><path d="M12 10v5m0 3h.01"/>'],
      UNPAID:['unpaid','Unpaid','<circle cx="12" cy="12" r="10"/><path d="M12 7v6m0 4h.01"/>']
    };
    const [key,label,path]=options[status]||options.UNPAID;
    return '<span class="sub-status sub-status-'+key+'"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2">'+path+'</svg>'+label+'</span>';
  }
  let subscriptionHistoryPage=1;
  const SUBSCRIPTION_ROWS_PER_PAGE=10;
  function renderDevSubscription(){
    const sub=state.subscription;
    if(!sub)return;
    const business=sub.plan==='BUSINESS',admin=state.user?.role==='Admin';
    $('planSwitcher').value=sub.plan;
    $('planSwitcher').disabled=!admin;
    $('accountPlanSelect').value=sub.plan;
    $('accountStatusSelect').value=sub.status;
    $('saveAccountPlan').disabled=!admin;
    $('accountPlanName').textContent=business?'Business':'Pro';
    $('accountStartedAt').textContent=planDisplayDate(sub.startedAt);
    $('accountRenewAt').textContent=planDisplayDate(sub.renewAt);
    $('accountRemaining').textContent=String(sub.daysRemaining||0);
    $('transferPlanGate').classList.toggle('hidden',business);
    $('inventoryTransferTab').disabled=!business;
    $('inventoryTransferTab').title=business?'Transfer Inventory':
      'For Business accounts only — use Upgrade to change your demo plan';
    const card=$('inventoryTransferTab').closest('.inv-operation-card');
    card?.classList.toggle('plan-locked',!business);
    if(!business){
      closeTransferEditorIfOpen();
      $('transferForm').classList.add('hidden');
      $('inventoryTransferTab').classList.remove('active');
      $('inventoryTransferTab').setAttribute('aria-expanded','false');
      $('inventoryTransferTab').setAttribute('aria-pressed','false');
      card?.classList.remove('active');
    }
    $('advancedPlanSubtitle').textContent=business
      ?'Business access is active for transfer and inventory history.'
      :'Gain deeper insight into your inventory with Business.';
    $('advancedPlanNotice').textContent=business
      ?'This is a development preview. Planned modules are clearly labeled below.'
      :'Pro includes Replenish; Transfer and advanced access require Business.';
    $('advancedUpgradeButton').classList.toggle('hidden',business);
    $('advancedBusinessActions').classList.toggle('hidden',!business);
    const history=Array.isArray(sub.history)?sub.history.slice().reverse():[];
    const totalPages=Math.max(1,Math.ceil(history.length/SUBSCRIPTION_ROWS_PER_PAGE));
    subscriptionHistoryPage=Math.max(1,Math.min(totalPages,subscriptionHistoryPage));
    const start=(subscriptionHistoryPage-1)*SUBSCRIPTION_ROWS_PER_PAGE;
    $('subscriptionHistoryBody').innerHTML=history.slice(start,start+SUBSCRIPTION_ROWS_PER_PAGE).map(row=>{
      const remaining=Math.max(0,Math.ceil((new Date(row.renewDate)-Date.now())/86400000));
      return '<tr><td>'+esc(planDisplayDate(row.date))+'</td><td><strong>'+
        esc(row.plan==='BUSINESS'?'Business':'Pro')+'</strong></td><td>'+
        esc(planDisplayDate(row.startDate))+'</td><td>'+esc(planDisplayDate(row.renewDate))+
        '</td><td class="num">'+num(remaining,0)+'</td><td>'+
        subscriptionBadge(row.status)+'</td></tr>';
    }).join('')||'<tr><td colspan="6">No subscription changes recorded.</td></tr>';
    const pagination=$('subscriptionHistoryPagination');
    pagination.innerHTML='<span>Showing '+(history.length?start+1:0)+'–'+
      Math.min(start+SUBSCRIPTION_ROWS_PER_PAGE,history.length)+' of '+history.length+
      ' records · Page '+subscriptionHistoryPage+' of '+totalPages+'</span>'+
      '<button type="button" data-plan-page="previous" '+(subscriptionHistoryPage===1?'disabled':'')+'>Previous</button>'+
      '<button type="button" data-plan-page="next" '+(subscriptionHistoryPage===totalPages?'disabled':'')+'>Next</button>';
  }
  async function loadDevSubscription(){
    if(!state.user)return;
    try{
      state.subscription=await api('/api/account/subscription');
      renderDevSubscription();
    }catch(error){
      $('inventoryTransferTab').disabled=true;
      $('transferPlanGate').classList.remove('hidden');
      $('planSwitcher').disabled=true;
      toast('Subscription: '+error.message);
    }
  }
  async function changeDevSubscription(plan,status){
    if(state.user?.role!=='Admin')return;
    return withActionLock('dev-subscription',async()=>{
      const top=$('planSwitcher'),save=$('saveAccountPlan');
      top.disabled=true;save.disabled=true;
      try{
        state.subscription=await api('/api/account/subscription/demo',{
          method:'POST',body:{plan,status}
        });
        subscriptionHistoryPage=1;
        renderDevSubscription();
        toast('Preview plan: '+(plan==='BUSINESS'?'Business':'Pro')+' (no charge).');
      }catch(error){
        renderDevSubscription();
        toast('Plan change failed: '+error.message);
      }finally{
        top.disabled=state.user?.role!=='Admin';
        save.disabled=state.user?.role!=='Admin';
      }
    });
  }
  function openPlanUpgrade(){
    switchView('account');
    $('accountPlanSelect').value='BUSINESS';
    $('accountPlanSelect').focus();
  }
  $('subscriptionHistoryPagination').addEventListener('click',event=>{
    const button=event.target.closest('button[data-plan-page]');
    if(!button||button.disabled)return;
    subscriptionHistoryPage+=button.dataset.planPage==='next'?1:-1;
    renderDevSubscription();
  });
  $('planSwitcher').addEventListener('change',e=>
    changeDevSubscription(e.target.value,state.subscription?.status||'PAID'));
  $('saveAccountPlan').addEventListener('click',()=>
    changeDevSubscription($('accountPlanSelect').value,$('accountStatusSelect').value));
  $('topbarProfileButton').addEventListener('click',()=>{
    if(state.user?.role!=='Admin'){
      toast('Account Settings are available to the Owner and Co-Owners.');
      return;
    }
    switchView('account');
  });
  $('transferUpgradeButton').addEventListener('click',openPlanUpgrade);
  $('advancedUpgradeButton').addEventListener('click',openPlanUpgrade);
  $('advancedOpenInventory').addEventListener('click',()=>switchView('inventory'));
  $('advancedOpenSales').addEventListener('click',()=>switchView('reports'));
  async function boot(){
    state.status=await api('/api/status');
    if(state.status.setupRequired){resetOrderState({render:false});showAuth(true);return;}
    try{state.user=(await api('/api/auth/me')).user;}
    catch(err){if(err.status===401){state.user=null;resetOrderState({render:false});showAuth(false);return;}throw err;}
    resetOrderState({render:false});showApp();await loadBranches();await loadDevSubscription();await loadCatalog();switchView('pos');
  }
  $('authForm').addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget;await withFormLock(form,async()=>{const username=$('authUsername').value.trim(),password=$('authPassword').value;try{if(state.status?.setupRequired){await api('/api/setup',{method:'POST',body:{username,password,active:true}});state.status=await api('/api/status');}state.user=(await api('/api/auth/login',{method:'POST',body:{username,password,ownerUsername:$('authOwnerUsername').value.trim(),branchName:$('authBranchName').value.trim()}})).user;resetOrderState({render:false});showApp();await loadBranches();await loadDevSubscription();await loadCatalog();switchView('pos');$('authPassword').value='';toast(`Welcome, ${state.user.username}.`);}catch(err){toast(err.message);}});});
  $('logoutButton').onclick=async()=>{try{await api('/api/auth/logout',{method:'POST'});}catch(_){}state.user=null;resetOrderState({render:true});showAuth(false);};

  async function refreshPosDailyCount(){
    if(!state.user)return;
    const branchId=state.user.role==='Admin'?state.posBranchId:state.user.branchId;
    const branch=state.branches.find(b=>Number(b.id)===Number(branchId));
    // POS no longer displays branch selection; admins manage the branch from Dashboard.
    if(!branchId){$('posDailyCount').textContent='Today · no branch';return;}
    try{const data=await api('/api/dashboard?branchId='+encodeURIComponent(branchId));if(!state.user)return;$('posDailyCount').textContent='Today · '+num(data.metrics.todayTransactions,0)+' orders';}
    catch(_){$('posDailyCount').textContent='Today · — orders';}
  }
  function updatePosDateTime(){
    const target=$('posDate');
    if(!target)return;
    target.textContent=new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',weekday:'long',month:'long',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',hour12:true}).format(new Date());
  }
  function switchView(view){
    document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x.id===`view-${view}`));document.querySelectorAll('.nav').forEach(x=>x.classList.toggle('active',x.dataset.view===view));
    const titles={dashboard:['OPERATIONS','Dashboard'],pos:['','Welcome to Don Macchiatos POS'],inventory:['INVENTORY','Stock Management'],reports:['REPORTING','Sales Report'],catalog:['ADMINISTRATION','POS Catalog'],users:['ADMINISTRATION','Cashier Accounts'],supply:['FRANCHISE PROCUREMENT','Supply Chain'],advanced:['BUSINESS FEATURES','Advanced Report / Inventory Management'],account:['SUBSCRIPTION','Account Settings'],logs:['AUDIT','System Logs'],chat:['TEAM','Messages']};$('viewEyebrow').textContent=titles[view]?.[0]||'';$('viewTitle').textContent=titles[view]?.[1]||'';
    $('posDailyCount').classList.toggle('hidden',view!=='pos');
    $('dashboardPrintReport').classList.toggle('hidden',view!=='dashboard'||state.user?.role==='Admin');
    updatePosDateTime();
    // Desktop: Messages is a normal sidebar view. Mobile keeps its independent floating chat.
    window.donmacChat?.onViewChange(view);
    if(view==='pos'){refreshPosDailyCount();requestAnimationFrame(syncCategoryRowNeighbors);}
    if(view==='users')window.donmacBranchNetwork?.show();
    if(view==='dashboard')loadDashboard();if(view==='inventory'){loadInventory();loadDevSubscription();}if(view==='advanced'||view==='account')renderDevSubscription();if(view==='reports'){loadReportCashiers();loadReport();}if(view==='catalog')loadAdminAll();if(view==='users')loadUsers();if(view==='logs')loadLogs();if(view==='supply')window.donmacSupply?.open();
  }
  document.querySelectorAll('.nav').forEach(n=>n.onclick=()=>switchView(n.dataset.view));
  $('dashboardPrintReport').addEventListener('click',()=>{
    // The server resolves the user's own branch and today's date in Manila.
    // Open the existing PDF report in print-ready inline mode.
    window.open('/api/reports/sales/print?period=daily','_blank','noopener,noreferrer');
  });

  function reconcileCartWithCatalog(){
    if(!state.catalog)return false;
    let changed=false;
    const productIds=new Set(state.catalog.products.map(x=>x.id)),addonIds=new Set(state.catalog.addOns.map(x=>x.id)),packageIds=new Set(state.catalog.packages.filter(x=>x.sellable&&!x.contents?.some(c=>c.active===false)).map(x=>x.id)),promoIds=new Set(state.catalog.promos.map(x=>x.id));
    const before=state.cart.length;
    state.cart=state.cart.filter(x=>x.kind==='product'?productIds.has(x.id):x.kind==='addon'?addonIds.has(x.id):x.kind==='package'?packageIds.has(x.id):false);
    if(state.cart.length!==before)changed=true;
    if(state.promoId&&!promoIds.has(state.promoId)){state.promoId=null;const n=state.cart.length;state.cart=state.cart.filter(x=>x.kind!=='addon');if(state.cart.length!==n)changed=true;changed=true;}
    const snapshot=JSON.stringify(state.cart);enforceAddonLimits();if(JSON.stringify(state.cart)!==snapshot)changed=true;
    if(changed)state.pendingSaleRequestId=null;
    return changed;
  }
  async function loadCatalog(){state.catalog=await api('/api/catalog');const changed=reconcileCartWithCatalog();renderTabs();renderPromo();renderCatalog();renderOrder();await refreshQuote();if(changed)toast('Order updated because a catalog item is no longer available.');}
  window.refreshPosCatalogCategories=loadCatalog;

  // Lightweight SVG artwork; animation lives in CSS and never modifies cart state.
  // Each POS category has a visible illustration and a distinct hover-only motion.
  // Cart totals, inventory/availability checks and click handlers are unchanged.

  // Every category button is static artwork; category behavior stays unchanged.
  const categorySlugs={'Coffee':'coffee','Non Coffee':'noncoffee','Food':'food',
                       'Add-ons':'addons','Promos':'promos','Packages':'packages'};
  const builtinCategories=['Coffee','Non Coffee','Food','Add-ons','Promos','Packages'];
  function activePosCategories(){
    return (state.catalog?.categories||builtinCategories.map(name=>({name,builtin:true,active:true,productIds:[]}))).filter(c=>c.active);
  }
  function categoryArt(c){
    const slug=categorySlugs[c.name];
    if(typeof c.iconData==='string'&&/^data:image\/(png|webp);base64,[a-zA-Z0-9+/=]+$/.test(c.iconData))
      return '<span class="category-icon category-icon-custom"><img src="'+esc(c.iconData)+'" alt="" loading="lazy" /></span>';
    return '<span class="category-icon category-icon-'+(slug||'packages')+'"></span>';
  }
  // Only highlight the actual visual-row neighbors. Adjacent array indices
  // can cross a grid-row boundary (e.g. column 3 followed by column 1).
  // Checking rendered offsetTop also adapts to 2-column tablet layouts and zoom.
  let categoryRowObserver=null;
  let categoryRowResizeBound=false;
  function syncCategoryRowNeighbors(){
    const root=$('categoryTabs');
    if(!root)return;
    const tiles=Array.from(root.querySelectorAll('.category-tile'));
    const selectedIndex=tiles.findIndex(el=>el.classList.contains('active'));
    const selected=tiles[selectedIndex];
    tiles.forEach((tile,index)=>{
      const sameRow=!!selected && Math.abs(tile.offsetTop-selected.offsetTop)<=2;
      tile.classList.toggle('adjacent',sameRow&&Math.abs(index-selectedIndex)===1);
    });
  }
  function renderTabs(){
    const all=activePosCategories();
    if(!all.some(c=>c.name===state.category))state.category=all[0]?.name||'Coffee';
    const counts={Coffee:0,'Non Coffee':0,Food:0,'Add-ons':state.catalog?.addOns?.length||0,
      Promos:state.catalog?.promos?.length||0,Packages:state.catalog?.packages?.length||0};
    for(const p of state.catalog?.products||[])if(Object.hasOwn(counts,p.category))counts[p.category]++;
    for(const c of all)if(!c.builtin)counts[c.name]=(state.catalog?.products||[]).filter(p=>(c.productIds||[]).includes(p.id)).length;
    $('categoryTabs').innerHTML=all.map(c=>{
      const slug=categorySlugs[c.name]||'custom';
      return '<button type="button" class="tab category-tile category-'+slug+(state.category===c.name?' active':'')+'"'+
        ' data-cat="'+esc(c.name)+'" aria-pressed="'+String(state.category===c.name)+'" title="Browse '+esc(c.name)+'">'+
        '<span class="category-status">'+(state.category===c.name?'Selected':'Browse')+'</span>'+
        '<span class="category-symbol" aria-hidden="true">'+categoryArt(c)+'</span>'+
        '<strong>'+esc(c.name)+'</strong><small>'+Number(counts[c.name]||0)+' items</small></button>';
    }).join('');
    $('categoryTabs').querySelectorAll('[data-cat]').forEach(b=>b.onclick=()=>{state.category=b.dataset.cat;renderTabs();renderCatalog();});
    syncCategoryRowNeighbors();
    if(!categoryRowResizeBound){
      categoryRowResizeBound=true;
      window.addEventListener('resize',syncCategoryRowNeighbors,{passive:true});
      if(typeof ResizeObserver==='function'){
        categoryRowObserver=new ResizeObserver(syncCategoryRowNeighbors);
        categoryRowObserver.observe($('categoryTabs'));
      }
    }
  }
  function promoById(){return state.catalog?.promos.find(p=>p.id===state.promoId)||null;}
  function cartItem(kind,id){return state.cart.find(x=>x.kind===kind&&x.id===id);}
  function cartCounts(){let food=0,coffee=0;for(const x of state.cart){if(x.kind!=='product')continue;const p=state.catalog.products.find(p=>p.id===x.id);if(!p)continue;if(p.category==='Food')food+=x.qty;if(['Coffee','Non Coffee'].includes(p.category))coffee+=x.qty;}return{food,coffee};}
  function canAddProduct(p){const promo=promoById();if(!promo)return true;const c=cartCounts();if(p.category==='Food'&&c.food>=promo.foodLimit)return false;if(['Coffee','Non Coffee'].includes(p.category)&&c.coffee>=promo.coffeeLimit)return false;return true;}
  function canAddAddon(a){if(!state.promoId)return false;const c=cartCounts(),line=cartItem('addon',a.id),next=(line?.qty||0)+1,n=normalize(a.name);if(n==='FLAVORED FRIES'&&next>c.food)return false;if(n==='PREMIUM COFFEE'&&next>c.coffee)return false;return true;}
  function availabilityTip(item){
    if(!item)return'';const lines=[];
    if(item.availabilityStatus==='recipe_required')lines.push('RECIPE REQUIRED','Add at least one ingredient in POS Catalog → Recipes before this item can be sold.');
    else if(item.availabilityStatus==='composition_required')lines.push('PACKAGE COMPOSITION REQUIRED','Add the package contents in POS Catalog → Packages.');
    else if(item.availabilityStatus==='component_unavailable')lines.push('PACKAGE COMPONENT UNAVAILABLE');
    else if(item.available&&item.stockWarnings?.length)lines.push('LOW STOCK WARNING');
    else if(!item.available)lines.push('WHY THIS ITEM IS NOT AVAILABLE');
    for(const d of item.availabilityDetails||[]){
      if(d.message){lines.push(`• ${d.name}: ${d.message}`);continue;}
      const unit=d.uom?` ${d.uom}`:'';
      if(d.status==='ingredient_unavailable')lines.push(`• ${d.name}: ingredient is archived/unavailable`);
      else if(d.status==='out_of_stock')lines.push(`• ${d.name}: OUT OF STOCK — need ${num(d.required)}${unit}, current ${num(d.current)}${unit}`);
      else if(d.status==='low_stock')lines.push(`• ${d.name}: LOW/INSUFFICIENT — need ${num(d.required)}${unit}, current ${num(d.current)}${unit}, short ${num(d.shortage)}${unit}`);
    }
    for(const d of item.stockWarnings||[]){const unit=d.uom?` ${d.uom}`:'';lines.push(`• ${d.name}: low stock — current ${num(d.current)}${unit}, threshold ${num(d.threshold)}${unit}`);}
    return lines.join('\n');
  }
  function availabilityLabel(item){if(item.availabilityStatus==='recipe_required')return'RECIPE REQUIRED';if(item.availabilityStatus==='composition_required')return'COMPOSITION REQUIRED';if(item.availabilityStatus==='component_unavailable')return'COMPONENT UNAVAILABLE';if(!item.available)return'INSUFFICIENT INGREDIENT STOCK';if(item.stockWarnings?.length)return'LOW STOCK';return'';}
  function availabilityWrap(card,item){const tip=availabilityTip(item);if(!tip)return card;const attr=esc(tip).replace(/\n/g,'&#10;');return`<div class="availability-hover" tabindex="0" data-availability-tip="${attr}">${card}<span class="availability-hint" aria-hidden="true">ⓘ</span></div>`;}
  let availabilityTooltip=null;
  function ensureAvailabilityTooltip(){if(availabilityTooltip)return availabilityTooltip;availabilityTooltip=document.createElement('div');availabilityTooltip.className='availability-tooltip';availabilityTooltip.setAttribute('role','tooltip');document.body.appendChild(availabilityTooltip);return availabilityTooltip;}
  function showAvailabilityTooltip(el){const text=el?.dataset?.availabilityTip;if(!text)return;const tip=ensureAvailabilityTooltip();tip.textContent=text;tip.classList.add('show');const r=el.getBoundingClientRect(),w=tip.offsetWidth,h=tip.offsetHeight;let left=r.left+(r.width-w)/2;left=Math.max(8,Math.min(left,window.innerWidth-w-8));let top=r.top-h-10;if(top<8)top=Math.min(window.innerHeight-h-8,r.bottom+10);tip.style.left=`${Math.round(left)}px`;tip.style.top=`${Math.round(Math.max(8,top))}px`;}
  function hideAvailabilityTooltip(){availabilityTooltip?.classList.remove('show');}
  function bindAvailabilityTooltips(){document.querySelectorAll('#catalogGrid .availability-hover').forEach(el=>{el.addEventListener('mouseenter',()=>showAvailabilityTooltip(el));el.addEventListener('mouseleave',hideAvailabilityTooltip);el.addEventListener('focusin',()=>showAvailabilityTooltip(el));el.addEventListener('focusout',hideAvailabilityTooltip);});}
  function productArt(p) {
    const src=p?.imageData;
    if(typeof src==='string' && /^data:image\/(?:jpeg|png|webp);base64,/.test(src))
      return `<div class="product-art"><img src="${esc(src)}" alt="" loading="lazy" /></div>`;
    const glyph=p?.category==='Food'?'🍰':p?.category==='Non Coffee'?'🥛':'☕';
    return `<div class="product-art placeholder-art" aria-hidden="true">${glyph}</div>`;
  }
  function renderCatalog(){
    if(!state.catalog)return;hideAvailabilityTooltip();const q=normalize(state.query);let html='';
    if(state.category==='Promos'){const items=state.catalog.promos.filter(p=>!q||normalize(p.name).includes(q));html=items.map(p=>`<button class="product-card promo ${state.promoId===p.id?'selected':''}" data-promo="${p.id}"><div class="cat">PROMO · ${esc(p.inclusion)}</div><h4>${esc(p.name)}</h4><div class="price">${peso(p.price)}</div></button>`).join('');}
    else if(state.category==='Packages'){const items=state.catalog.packages.filter(p=>!q||normalize(p.name).includes(q));html=items.map(p=>{const enabled=p.sellable&&p.available&&!state.promoId;const label=state.promoId?'NOT ALLOWED WITH PROMO':availabilityLabel(p);const card=`<button class="product-card package" data-package="${p.id}" ${enabled?'':'disabled'}><div class="cat">PACKAGE · ${p.itemCount} ITEM TYPE(S)</div><h4>${esc(p.name)}</h4><div class="price">${p.sellable?peso(p.price):'Not Available'}</div>${label?`<div class="unavailable">${esc(label)}</div>`:''}</button>`;return state.promoId?card:availabilityWrap(card,p);}).join('');}
    else if(state.category==='Add-ons'){const items=state.catalog.addOns.filter(a=>!q||normalize(a.name).includes(q));html=items.map(a=>`<button class="product-card" data-addon="${a.id}" ${state.promoId?'':'disabled'}><div class="cat">PROMO UPGRADE · NO COSTING</div><h4>${esc(a.name)}</h4><div class="price">${peso(a.price)}</div>${state.promoId?'':'<div class="unavailable">PROMO ONLY</div>'}</button>`).join('');}
    else{const currentCategory=activePosCategories().find(c=>c.name===state.category);
      const items=state.catalog.products.filter(p=>
        (currentCategory&&!currentCategory.builtin?(currentCategory.productIds||[]).includes(p.id):p.category===state.category)
        &&(!q||normalize(p.name).includes(q)));html=items.map(p=>{const enabled=p.available&&canAddProduct(p),label=availabilityLabel(p);const card=`<button class="product-card ${p.stockWarnings?.length?'low-warning':''}" data-product="${p.id}" ${enabled?'':'disabled'}><div class="cat">${esc(p.category)}</div>${productArt(p)}<h4>${esc(p.name)}</h4><div class="price">${p.available?peso(p.price):'Not Available'}</div><span class="product-add-circle" aria-hidden="true">+</span>${label?`<div class="unavailable ${p.available?'warning':''}">${esc(label)}</div>`:''}</button>`;return availabilityWrap(card,p);}).join('');}
    $('catalogGrid').innerHTML=html||'<div class="empty-state"><div><b>No items found</b>Try another search.</div></div>';$('catalogGrid').querySelectorAll('[data-product]').forEach(b=>b.onclick=()=>addItem('product',Number(b.dataset.product)));$('catalogGrid').querySelectorAll('[data-addon]').forEach(b=>b.onclick=()=>addItem('addon',Number(b.dataset.addon)));$('catalogGrid').querySelectorAll('[data-package]').forEach(b=>b.onclick=()=>addItem('package',Number(b.dataset.package)));$('catalogGrid').querySelectorAll('[data-promo]').forEach(b=>b.onclick=()=>selectPromo(Number(b.dataset.promo)));bindAvailabilityTooltips();
  }
  function selectPromo(id){if(state.promoId===id){cancelPromo();return;}if(state.cart.length&&!confirm('Selecting a promo will clear the current order. Continue?'))return;state.cart=[];state.promoId=id;$('seniorEnabled').checked=false;$('seniorFields').classList.add('hidden');$('seniorName').value='';$('seniorId').value='';state.pendingSaleRequestId=null;state.category='Coffee';renderAll();}
  function cancelPromo(){state.promoId=null;state.cart=[];state.pendingSaleRequestId=null;renderAll();}
  function addItem(kind,id){if(kind==='product'){const p=state.catalog.products.find(p=>p.id===id);if(!p)return;if(!p.available){toast(`${p.name} is not available. ${p.availabilityMessage||'Check its recipe and ingredient stock.'}`);return;}if(!canAddProduct(p)){toast('Promo item limit reached for this category.');return;}}if(kind==='package'){const p=state.catalog.packages.find(p=>p.id===id);if(!p?.sellable||!p.available){toast(`This package is not available. ${p?.availabilityMessage||'Check its composition and ingredient stock.'}`);return;}if(state.promoId){toast('Packages cannot be combined with a promo.');return;}}if(kind==='addon'){const a=state.catalog.addOns.find(a=>a.id===id);if(!a||!state.promoId){toast('This upgrade can only be used during a promo.');return;}if(!canAddAddon(a)){toast(`${a.name} cannot exceed the matching promo item quantity.`);return;}}const line=cartItem(kind,id);if(line)line.qty++;else state.cart.push({kind,id,qty:1});state.pendingSaleRequestId=null;renderAll();}
  function changeQty(kind,id,delta){const line=cartItem(kind,id);if(!line)return;if(delta>0&&kind==='product'){const p=state.catalog.products.find(p=>p.id===id);if(!p||!canAddProduct(p)){toast('Promo item limit reached.');return;}}if(delta>0&&kind==='addon'){const a=state.catalog.addOns.find(a=>a.id===id);if(!a||!canAddAddon(a)){toast('Upgrade quantity cannot exceed the matching promo item quantity.');return;}}line.qty+=delta;if(line.qty<=0)state.cart=state.cart.filter(x=>x!==line);if(delta<0&&kind==='product')enforceAddonLimits();state.pendingSaleRequestId=null;renderAll();}
  function clearCart(){resetOrderState();}
  function cartDisplayLine(x){if(x.kind==='product')return state.catalog.products.find(p=>p.id===x.id);if(x.kind==='addon')return state.catalog.addOns.find(a=>a.id===x.id);return state.catalog.packages.find(p=>p.id===x.id);}
  function localGross(){return state.cart.reduce((a,x)=>{const p=cartDisplayLine(x);return a+(p?Number(p.price)*x.qty:0);},0);}
  function renderOrder(){if(!state.cart.length){$('orderList').innerHTML='<div class="empty-state"><div><b>Your order is empty</b>Select an item to begin.</div></div>';return;}$('orderList').innerHTML=state.cart.map(x=>{const p=cartDisplayLine(x);if(!p)return'';return`<div class="order-row"><div><h4>${esc(p.name)}</h4><div class="row-sub">${x.kind==='addon'?'PROMO UPGRADE':x.kind==='package'?'PACKAGE':esc(p.category||'')} · ${peso(p.price)} each</div></div><div><strong>${peso(Number(p.price)*x.qty)}</strong><div class="qty-control"><button data-minus="${x.kind}:${x.id}">−</button><span>${x.qty}</span><button data-plus="${x.kind}:${x.id}">+</button></div></div></div>`;}).join('');$('orderList').querySelectorAll('[data-minus]').forEach(b=>b.onclick=()=>{const[k,id]=b.dataset.minus.split(':');changeQty(k,Number(id),-1);});$('orderList').querySelectorAll('[data-plus]').forEach(b=>b.onclick=()=>{const[k,id]=b.dataset.plus.split(':');changeQty(k,Number(id),1);});}
  function renderPromo(){const p=promoById();$('promoBanner').classList.toggle('hidden',!p);if(!p)return;const c=cartCounts();$('promoBanner').innerHTML=`<div><b>${esc(p.name)}</b> · Food ${c.food}/${p.foodLimit} · Coffee ${c.coffee}/${p.coffeeLimit} · Promo ${peso(p.price)} <span class="muted">(+ upgrades)</span></div><button id="cancelPromo">CANCEL PROMO</button>`;$('cancelPromo').onclick=cancelPromo;}
  function quotePayload(){return{items:state.cart.map(x=>({kind:x.kind,id:x.id,qty:x.qty})),promoId:state.promoId,senior:{enabled:$('seniorEnabled').checked,name:$('seniorName').value.trim(),id:$('seniorId').value.trim()}};}
  async function refreshQuote(){const seq=++quoteSeq,gross=localGross();$('grossAmount').textContent=peso(gross);$('payButton').disabled=true;state.quote=null;if(!state.cart.length){$('adjustmentAmount').textContent=peso(0);$('actualAmount').textContent=peso(0);$('payButton').textContent='Pay ₱0.00';$('quoteMessage').textContent='';return;}try{const quote=await api('/api/quote',{method:'POST',body:quotePayload()});if(seq!==quoteSeq)return;state.quote=quote;$('grossAmount').textContent=peso(quote.gross);$('adjustmentAmount').textContent=peso(quote.adjustment);$('actualAmount').textContent=peso(quote.actual);$('payButton').textContent=`Pay ${peso(quote.actual)}`;$('payButton').disabled=false;$('quoteMessage').textContent='';}catch(err){if(seq!==quoteSeq)return;$('adjustmentAmount').textContent='—';$('actualAmount').textContent='—';$('payButton').textContent='Complete Order';$('quoteMessage').textContent=err.message;if(err.status===409)await updateCatalogAvailability();}}
  function renderAll(){renderTabs();renderPromo();renderCatalog();renderOrder();clearTimeout(quoteTimer);quoteTimer=setTimeout(refreshQuote,80);}async function updateCatalogAvailability(){try{state.catalog=await api('/api/catalog');renderCatalog();}catch(_){}}
  $('searchBox').addEventListener('input',e=>{state.query=e.target.value;renderCatalog();});$('clearCart').onclick=clearCart;
  $('seniorEnabled').onchange=()=>{if($('seniorEnabled').checked&&state.promoId){$('seniorEnabled').checked=false;toast('Senior Citizen discount cannot be combined with a promo.');return;}$('seniorFields').classList.toggle('hidden',!$('seniorEnabled').checked);refreshQuote();};$('seniorName').oninput=()=>{clearTimeout(quoteTimer);quoteTimer=setTimeout(refreshQuote,300);};$('seniorId').oninput=()=>{clearTimeout(quoteTimer);quoteTimer=setTimeout(refreshQuote,300);};
  $('payButton').onclick=()=>{if(!state.quote||state.checkoutBusy)return;state.pendingSaleRequestId=state.pendingSaleRequestId||(globalThis.crypto?.randomUUID?.()||`sale-${Date.now()}-${Math.random().toString(36).slice(2)}`);$('paymentMode').value='Cash';$('cashTender').value=Number(state.quote.actual||0).toFixed(2);$('gcashReference').value='';renderPaymentFields();$('paymentDialog').showModal();};$('paymentClose').onclick=()=>{if(!state.checkoutBusy)$('paymentDialog').close();};$('paymentDialog').addEventListener('cancel',e=>{if(state.checkoutBusy)e.preventDefault();});$('paymentMode').onchange=renderPaymentFields;$('cashTender').oninput=renderPaymentFields;
  function renderPaymentFields(){const due=Number(state.quote?.actual||0),cash=$('paymentMode').value==='Cash';$('tenderWrap').classList.toggle('hidden',!cash);$('referenceWrap').classList.toggle('hidden',cash);if(cash&&!Number.isFinite(Number($('cashTender').value)))$('cashTender').value=due.toFixed(2);$('changePreview').textContent=cash?`Change: ${peso(Math.max(0,Number($('cashTender').value||0)-due))}`:'GCash payment: exact amount due';$('modalDue').textContent=peso(due);}
  $('paymentForm').addEventListener('submit',async e=>{e.preventDefault();if(!state.quote||state.checkoutBusy)return;state.checkoutBusy=true;const submit=$('paymentSubmit'),close=$('paymentClose');if(submit){submit.disabled=true;submit.textContent='Processing…';}if(close)close.disabled=true;const payload={...quotePayload(),branchId:state.user.role==='Admin'?state.posBranchId:state.user.branchId,clientRequestId:state.pendingSaleRequestId||(globalThis.crypto?.randomUUID?.()||`sale-${Date.now()}-${Math.random().toString(36).slice(2)}`),paymentMode:$('paymentMode').value,tender:Number($('cashTender').value||0),paymentReference:$('gcashReference').value.trim(),orderType:$('posOrderType').value,customerName:$('posCustomerName').value.trim(),tableLabel:$('posOrderType').value==='Dine In'?$('posTableLabel').value.trim():''};state.pendingSaleRequestId=payload.clientRequestId;try{const sale=await api('/api/sales',{method:'POST',body:payload,timeoutMs:30000});$('paymentDialog').close();$('receiptText').textContent=`${sale.reference} · ${sale.paymentMode} · ${peso(sale.actual)}${sale.change?` · Change ${peso(sale.change)}`:''}${sale.idempotent?' · Safe retry recovered':''}`;resetOrderState({render:true});$('receiptDialog').showModal();refreshPosDailyCount();try{await loadCatalog();}catch(refreshErr){console.error(refreshErr);toast('Sale recorded successfully. Catalog refresh will retry on the next action.');}}catch(err){toast(err.message);if(err.status===409)try{await loadCatalog();}catch(_){}}finally{state.checkoutBusy=false;if(submit){submit.disabled=false;submit.textContent='Confirm Payment';}if(close)close.disabled=false;}});$('receiptClose').onclick=()=>{$('receiptDialog').close();resetOrderState({render:true});$('searchBox')?.focus();};

  async function loadInventory(){
    // Audit must load independently. A table/editor rendering error must never
    // prevent the movement history from being fetched and shown.
    try{
      const response=await api('/api/inventory');
      state.inventory=Array.isArray(response.items)?response.items:[];
      try{renderInventory();}catch(renderError){console.error('Inventory view rendering:',renderError);toast('Ingredient list could not render: '+renderError.message);}
    }catch(err){toast('Could not load ingredients: '+err.message);}
    finally{await loadMovements();}
  }
  const inventoryUI={page:1,pageSize:10,group:"none",sort:"nameAsc",status:"all"};
  function inventoryDisplayName(item){
    const raw=String(item?.name||item?.code||'Unnamed Ingredient').trim();
    // Legacy imported names sometimes duplicate a stock code. Keep those codes
    // searchable but never display the ING_001_COFFEE identifier in a row.
    if(/^ING[_-]\d+[_-]/i.test(raw)){
      return raw.replace(/^ING[_-]\d+[_-]/i,'').replace(/[_-]+/g,' ').toLowerCase().replace(/\b[a-z]/g,c=>c.toUpperCase());
    }
    return raw;
  }
  function inventoryStatus(item){
    const stock=Number(item.stock)||0,threshold=Number(item.lowStockThreshold)||0;
    if(stock<=0)return {key:'out-of-stock',label:'Out of stock',rank:0};
    if(stock<=threshold&&threshold>0&&stock<=threshold*.5)return {key:'critical',label:'Critical',rank:1};
    if(stock<=threshold)return {key:'low-stock',label:'Low stock',rank:2};
    return {key:'in-stock',label:'In stock',rank:3};
  }
  function inventoryStatusIcon(key){
    // Fixed trusted SVG markup (never user-supplied HTML).
    if(key==='in-stock')return '<svg viewBox="0 0 24 24" width="21" height="21" fill="currentColor" aria-hidden="true"><rect x="2" y="15" width="4" height="7" rx="1.1"/><rect x="8" y="11" width="4" height="11" rx="1.1"/><rect x="14" y="6" width="4" height="16" rx="1.1"/><rect x="20" y="2" width="3" height="20" rx="1.1"/></svg>';
    if(key==='low-stock')return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M10.3 3.7a2 2 0 0 1 3.4 0l8.3 14.1a2 2 0 0 1-1.7 3H3.7a2 2 0 0 1-1.7-3L10.3 3.7Z"/><path d="M12 9v5"/><circle cx="12" cy="17.2" r=".9" fill="currentColor" stroke="none"/></svg>';
    return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M12 6.5v7.4" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/><circle cx="12" cy="17.4" r="1.35" fill="#fff"/></svg>';
  }
  function renderInventory(){
    const all=Array.isArray(state.inventory)?state.inventory:[];
    const q=normalize($('inventorySearch').value.trim());
    let rows=all.filter(i=>{
      const status=inventoryStatus(i).key;
      const matches=!q||[inventoryDisplayName(i),i.name,i.code,i.uom,status.replace(/-/g,' ')].some(x=>normalize(String(x||'')).includes(q));
      return matches&&(inventoryUI.status==='all'||status===inventoryUI.status);
    });
    const byName=(a,b)=>inventoryDisplayName(a).localeCompare(inventoryDisplayName(b),undefined,{sensitivity:'base',numeric:true});
    rows.sort((a,b)=>{
      if(inventoryUI.sort==='nameDesc')return -byName(a,b);
      if(inventoryUI.sort==='stockAsc')return Number(a.stock)-Number(b.stock)||byName(a,b);
      if(inventoryUI.sort==='stockDesc')return Number(b.stock)-Number(a.stock)||byName(a,b);
      if(inventoryUI.sort==='recent')return new Date(b.updatedAt||0)-new Date(a.updatedAt||0)||byName(a,b);
      if(inventoryUI.sort==='status')return inventoryStatus(a).rank-inventoryStatus(b).rank||byName(a,b);
      return byName(a,b);
    });
    const groupLabel=i=>inventoryUI.group==='status'?inventoryStatus(i).label:
      inventoryUI.group==='uom'?String(i.uom||'—').toUpperCase():'';
    if(inventoryUI.group!=='none'){
      const groups=new Map();
      rows.forEach(i=>{const label=groupLabel(i);if(!groups.has(label))groups.set(label,[]);groups.get(label).push(i);});
      rows=[...groups.entries()].sort(([a],[b])=>a.localeCompare(b,undefined,{numeric:true})).flatMap(([,items])=>items);
    }
    const pages=Math.max(1,Math.ceil(rows.length/inventoryUI.pageSize));
    inventoryUI.page=Math.min(pages,Math.max(1,inventoryUI.page));
    const from=(inventoryUI.page-1)*inventoryUI.pageSize;
    const current=rows.slice(from,from+inventoryUI.pageSize);
    let lastGroup=null;
    const markup=current.map(i=>{
      const label=groupLabel(i),status=inventoryStatus(i);
      const group=inventoryUI.group!=='none'&&label!==lastGroup?
        '<tr class="inv-group-heading"><td colspan="6">'+esc(label)+'</td></tr>':'';
      lastGroup=label;
      return group+'<tr>'+
        '<td class="inv-ingredient-name" title="'+esc(inventoryDisplayName(i))+'"><strong>'+esc(inventoryDisplayName(i))+'</strong></td>'+
        '<td><span class="inv-unit">'+esc(String(i.uom||'—').toUpperCase())+'</span></td>'+
        '<td class="num inv-stock-number">'+num(i.stock)+'</td>'+
        '<td class="num">'+num(i.lowStockThreshold)+'</td>'+
        '<td class="inv-date">'+esc(i.updatedAt?formatDateTime(i.updatedAt):'—')+'</td>'+
        '<td><span class="inv-status-badge inv-status-'+status.key+'"><span class="inv-status-glyph" aria-hidden="true">'+inventoryStatusIcon(status.key)+'</span>'+esc(status.label)+'</span></td>'+
        '</tr>';
    }).join('');
    $('inventoryBody').innerHTML=markup||'<tr><td colspan="6" class="inv-empty">No ingredients match your search or filters.</td></tr>';
    $('inventoryPageInfo').textContent=rows.length?
      'Showing '+(from+1)+'–'+Math.min(rows.length,from+inventoryUI.pageSize)+' of '+rows.length+' ingredients':
      'Showing 0 of 0 ingredients';
    const pageNumbers=new Set([1,pages,inventoryUI.page-1,inventoryUI.page,inventoryUI.page+1]);
    const visible=[...pageNumbers].filter(x=>x>=1&&x<=pages).sort((a,b)=>a-b);
    const buttons=['<button type="button" data-inv-page="'+(inventoryUI.page-1)+'" aria-label="Previous page" '+(inventoryUI.page===1?'disabled':'')+'>‹</button>'];
    let previous=0;
    visible.forEach(p=>{
      if(p-previous>1)buttons.push('<span class="inv-page-dots" aria-hidden="true">…</span>');
      buttons.push('<button type="button" data-inv-page="'+p+'" aria-label="Page '+p+'" '+(p===inventoryUI.page?'class="active" aria-current="page"':'')+'>'+p+'</button>');
      previous=p;
    });
    buttons.push('<button type="button" data-inv-page="'+(inventoryUI.page+1)+'" aria-label="Next page" '+(inventoryUI.page===pages?'disabled':'')+'>›</button>');
    $('inventoryPageControls').innerHTML=buttons.join('');
    $('inventoryFilterSummary').textContent=inventoryUI.group!=='none'?'Grouped by '+(inventoryUI.group==='status'?'stock status':'unit'):'';
    renderBatchEditors();
  }
  // Both editors are independent. The existing replenish/transfer backend already
  // accepts and atomically records multiple {ingredientId,qty} items.
  const batchEditors={
    replenish:{items:new Map(),checked:new Set(),clipboard:null,query:'',anchorId:null},
    transfer:{items:new Map(),checked:new Set(),clipboard:null,query:'',anchorId:null}
  };
  function batchSource(id){
    return (state.inventory||[]).find(i=>Number(i.id)===Number(id))||null;
  }
  function batchUom(ingredient){return String(ingredient?.uom||'unit').toUpperCase();}
  function batchFail(kind,message){
    const el=$(kind+'BatchError');
    el.textContent=message||'';
    el.hidden=!message;
    if(message)toast(message);
  }
  function batchAddMany(kind,ids){
    const editor=batchEditors[kind];
    if(!editor)return;
    let count=0;
    for(const raw of ids){
      const id=Number(raw),ingredient=batchSource(id);
      if(!Number.isSafeInteger(id)||id<=0||!ingredient||editor.items.has(id))continue;
      if(editor.items.size>=150){batchFail(kind,'A maximum of 150 ingredients can be added in one submission.');break;}
      editor.items.set(id,'');
      count++;
    }
    editor.checked.clear();editor.anchorId=null;
    if(count)batchFail(kind,'');
    renderBatchEditors();
  }
  function batchClear(kind){
    const editor=batchEditors[kind];
    if(!editor)return;
    editor.items.clear();editor.checked.clear();editor.clipboard=null;editor.anchorId=null;
    batchFail(kind,'');
    renderBatchEditors();
  }
  function batchPickerItems(kind){
    const editor=batchEditors[kind],q=normalize(editor.query.trim());
    return (state.inventory||[]).filter(i=>!q||normalize(
      [inventoryDisplayName(i),i.name,i.code,i.uom].join(' ')
    ).includes(q)).sort((a,b)=>inventoryDisplayName(a).localeCompare(inventoryDisplayName(b),undefined,{sensitivity:'base',numeric:true}));
  }
  function renderBatchEditors(){
    for(const kind of ['replenish','transfer']){
      const editor=batchEditors[kind],ingredients=state.inventory||[],allIds=new Set(ingredients.map(i=>Number(i.id)));
      for(const id of [...editor.checked])if(!allIds.has(id))editor.checked.delete(id);
      // A row is retained if a catalog item is archived while the form is open.
      // Submission will reject it until removed; do not silently change the order.
      const picker=batchPickerItems(kind);
      $(kind+'IngredientPicker').innerHTML=picker.map(i=>{
        const id=Number(i.id),isAdded=editor.items.has(id);
        return '<div class="inv-picker-item'+(isAdded?' is-added':'')+(editor.checked.has(id)?' is-selected':'')+'" draggable="true" data-batch-ingredient="'+id+'" title="Drag to quantity editor or long-press to select">'+
          '<input type="checkbox" data-batch-check="'+id+'" aria-label="Select '+esc(inventoryDisplayName(i))+'" '+(editor.checked.has(id)?'checked':'')+'>'+
          '<span class="inv-picker-grip" aria-hidden="true">⠿</span>'+
          '<span class="inv-picker-item-name"><strong>'+esc(inventoryDisplayName(i))+'</strong><small>'+esc(batchUom(i))+' · '+num(i.stock)+' available</small></span>'+
          '<button type="button" data-batch-add="'+id+'" class="inv-picker-quickadd" '+(isAdded?'disabled':'')+' aria-label="Add '+esc(inventoryDisplayName(i))+'">'+(isAdded?'Added':'＋ Add')+'</button></div>';
      }).join('')||'<p class="inv-picker-empty">No matching ingredients.</p>';
      $(kind+'CheckedCount').textContent=editor.checked.size+' selected';
      $(kind+'SelectionCount').textContent=editor.items.size+' ingredient'+(editor.items.size===1?'':'s');
      $(kind+'AddSelected').disabled=!editor.checked.size;
      const selectedIds=[...editor.items.keys()];
      $(kind+'BatchRows').innerHTML=selectedIds.map((id,index)=>{
        const ing=batchSource(id),name=ing?inventoryDisplayName(ing):'Unavailable ingredient #'+id;
        const uom=batchUom(ing),amount=editor.items.get(id);
        return '<div class="inv-batch-row'+(!ing?' is-missing':'')+'" data-batch-row="'+id+'">'+
          '<span class="inv-batch-row-number">'+(index+1)+'</span>'+
          '<div class="inv-batch-row-label"><strong>'+esc(name)+'</strong><small>'+esc(uom)+(ing&&kind==='transfer'?' · on hand: '+num(ing.stock):'')+'</small></div>'+
          '<label class="inv-batch-quantity"><span class="inv-sr-only">Quantity for '+esc(name)+'</span>'+
          '<input type="number" inputmode="decimal" min="0.000001" step="any" placeholder="0" data-batch-qty="'+id+'" value="'+esc(amount)+'" aria-label="Quantity for '+esc(name)+' in '+esc(uom)+'" required>'+
          '<span>'+esc(uom)+'</span></label>'+
          '<button type="button" class="inv-batch-copy" data-batch-copy="'+id+'" title="Copy this quantity" aria-label="Copy quantity for '+esc(name)+'">Copy</button>'+
          '<button type="button" class="inv-batch-remove" data-batch-remove="'+id+'" title="Remove ingredient" aria-label="Remove '+esc(name)+'">×</button></div>';
      }).join('')||'<div class="inv-drop-placeholder"><span class="inv-drop-symbol" aria-hidden="true">⇣</span><strong>Drop ingredients here</strong><small>Drag from the list or tap Add to build a batch.</small></div>';
      const cb=editor.clipboard;
      $(kind+'CopiedHint').textContent=cb==null?'Copy a quantity from any row.':
        'Copied '+String(cb.qty)+' '+cb.uom+' · paste numeric amount into each row’s own unit.';
      $(kind+'PasteAll').disabled=cb==null||!selectedIds.length;
      const allVisible=picker.length>0&&picker.every(i=>editor.checked.has(Number(i.id)));
      $(kind+'SelectAll').textContent=allVisible?'Deselect all':'Select all';
    }
  }
  function batchPayload(kind){
    const editor=batchEditors[kind];
    if(!editor.items.size)throw new Error('Add at least one ingredient to the quantity editor.');
    if(editor.items.size>150)throw new Error('Use at most 150 ingredients per batch.');
    const items=[];
    for(const [id,value] of editor.items.entries()){
      const ingredient=batchSource(id);
      if(!ingredient)throw new Error('An ingredient is no longer available. Remove it and try again.');
      if(String(value).trim()==='')throw new Error('Enter a quantity for '+inventoryDisplayName(ingredient)+'.');
      const qty=Number(value);
      if(!Number.isFinite(qty)||qty<=0)throw new Error('Enter a positive quantity for '+inventoryDisplayName(ingredient)+'.');
      if(kind==='transfer'&&qty>Number(ingredient.stock)+1e-9)
        throw new Error('Not enough '+inventoryDisplayName(ingredient)+' stock (available: '+num(ingredient.stock)+' '+batchUom(ingredient)+').');
      items.push({ingredientId:id,qty});
    }
    return items;
  }
  function initBatchEditors(){
    for(const kind of ['replenish','transfer']){
      const editor=batchEditors[kind],picker=$(kind+'IngredientPicker'),rows=$(kind+'BatchRows'),drop=$(kind+'BatchDropZone');
      $(kind+'BatchSearch').addEventListener('input',e=>{
        editor.query=e.target.value;
        // The search box is outside the rendered picker, so typing is uninterrupted.
        renderBatchEditors();
      });
      // Shift selects or deselects a contiguous range in the filtered picker.
      function selectPickerRange(id,select,shift){
        if(!batchSource(id))return;
        const visible=batchPickerItems(kind).map(i=>Number(i.id));
        const anchor=visible.indexOf(editor.anchorId),target=visible.indexOf(id);
        const ids=shift&&anchor>=0&&target>=0?
          visible.slice(Math.min(anchor,target),Math.max(anchor,target)+1):[id];
        ids.forEach(itemId=>{if(select)editor.checked.add(itemId);else editor.checked.delete(itemId);});
        if(!shift||anchor<0)editor.anchorId=id;
        // Update DOM in place. Rebuilding while a finger is held can cancel
        // mobile pointer movement and break long-press range highlighting.
        picker.querySelectorAll('[data-batch-ingredient]').forEach(row=>{
          const rowId=Number(row.dataset.batchIngredient),isChecked=editor.checked.has(rowId);
          row.classList.toggle('is-selected',isChecked);
          const checkbox=row.querySelector('[data-batch-check]');
          if(checkbox)checkbox.checked=isChecked;
        });
        $(kind+'CheckedCount').textContent=editor.checked.size+' selected';
        $(kind+'AddSelected').disabled=!editor.checked.size;
        $(kind+'SelectAll').textContent=visible.length&&visible.every(rowId=>editor.checked.has(rowId))?'Deselect all':'Select all';
      }
      let hold=null,suppressRowClick=false;
      function stopHold(){
        if(!hold)return;
        clearTimeout(hold.timer);
        if(hold.active){
          suppressRowClick=true;
          setTimeout(()=>{suppressRowClick=false;},180);
        }
        hold=null;
      }
      function moveHold(e){
        if(!hold)return;
        if(!hold.active&&Math.hypot(e.clientX-hold.x,e.clientY-hold.y)>12){stopHold();return;}
        if(!hold.active)return;
        if(e.cancelable)e.preventDefault();
        const target=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-batch-ingredient]');
        if(!target||!picker.contains(target))return;
        const nextId=Number(target.dataset.batchIngredient);
        if(nextId!==hold.lastId){
          hold.lastId=nextId;
          selectPickerRange(nextId,true,true);
        }
      }
      picker.addEventListener('pointerdown',e=>{
        if(e.pointerType==='mouse'&&e.button!==0)return;
        const row=e.target.closest('[data-batch-ingredient]');
        if(!row||e.target.closest('button,input,.inv-picker-grip'))return;
        stopHold();
        const id=Number(row.dataset.batchIngredient);
        hold={id,lastId:id,x:e.clientX,y:e.clientY,active:false,timer:null,pointerId:e.pointerId};
        hold.timer=setTimeout(()=>{
          if(!hold||hold.pointerId!==e.pointerId)return;
          hold.active=true;
          // A long-press selects the row; sliding adds the range.
          selectPickerRange(id,true,false);
        },500);
      });
      document.addEventListener('pointermove',e=>{if(hold&&e.pointerId===hold.pointerId)moveHold(e);});
      document.addEventListener('pointerup',e=>{if(hold&&e.pointerId===hold.pointerId)stopHold();});
      document.addEventListener('pointercancel',e=>{if(hold&&e.pointerId===hold.pointerId)stopHold();});
      picker.addEventListener('touchmove',e=>{if(hold?.active&&e.cancelable)e.preventDefault();},{passive:false});
      picker.addEventListener('click',e=>{
        const input=e.target.closest('[data-batch-check]');
        if(input){
          const id=Number(input.dataset.batchCheck);
          selectPickerRange(id,input.checked,e.shiftKey);
          return;
        }
        if(suppressRowClick&&e.target.closest('[data-batch-ingredient]')){
          e.preventDefault();return;
        }
        const add=e.target.closest('[data-batch-add]');
        if(add)batchAddMany(kind,[Number(add.dataset.batchAdd)]);
      });
      $(kind+'SelectAll').addEventListener('click',()=>{
        const visible=batchPickerItems(kind).map(i=>Number(i.id));
        const all=visible.length&&visible.every(id=>editor.checked.has(id));
        for(const id of visible){if(all)editor.checked.delete(id);else editor.checked.add(id);}
        editor.anchorId=null;
        renderBatchEditors();
      });
      $(kind+'AddSelected').addEventListener('click',()=>batchAddMany(kind,[...editor.checked]));
      picker.addEventListener('dragstart',e=>{
        const row=e.target.closest('[data-batch-ingredient]');
        if(!row||!e.dataTransfer)return;
        const dragged=Number(row.dataset.batchIngredient);
        const ids=editor.checked.has(dragged)?[...editor.checked]:[dragged];
        e.dataTransfer.effectAllowed='copy';
        e.dataTransfer.setData('application/x-donmac-stock-batch',JSON.stringify({kind,ids}));
        e.dataTransfer.setData('text/plain','Ingredient selection');
        row.classList.add('is-dragging');
      });
      picker.addEventListener('dragend',e=>e.target.closest('[data-batch-ingredient]')?.classList.remove('is-dragging'));
      drop.addEventListener('dragover',e=>{e.preventDefault();if(e.dataTransfer)e.dataTransfer.dropEffect='copy';drop.classList.add('is-dragover');});
      drop.addEventListener('dragleave',e=>{if(!drop.contains(e.relatedTarget))drop.classList.remove('is-dragover');});
      drop.addEventListener('drop',e=>{
        e.preventDefault();drop.classList.remove('is-dragover');
        try{
          const raw=e.dataTransfer?.getData('application/x-donmac-stock-batch');
          if(!raw)return;
          const payload=JSON.parse(raw);
          if(payload.kind!==kind||!Array.isArray(payload.ids))return;
          batchAddMany(kind,payload.ids.slice(0,150));
        }catch(_){batchFail(kind,'Unable to add dragged ingredients. Use the Add button instead.');}
      });
      rows.addEventListener('input',e=>{
        const input=e.target.closest('[data-batch-qty]');if(!input)return;
        const id=Number(input.dataset.batchQty);
        if(editor.items.has(id)){editor.items.set(id,input.value);batchFail(kind,'');}
      });
      rows.addEventListener('click',e=>{
        const remove=e.target.closest('[data-batch-remove]');
        if(remove){editor.items.delete(Number(remove.dataset.batchRemove));renderBatchEditors();return;}
        const copy=e.target.closest('[data-batch-copy]');
        if(!copy)return;
        const id=Number(copy.dataset.batchCopy),raw=editor.items.get(id),ingredient=batchSource(id);
        if(raw===undefined||String(raw).trim()===''||!Number.isFinite(Number(raw))||Number(raw)<=0){
          batchFail(kind,'Enter a positive quantity before copying.');return;
        }
        editor.clipboard={qty:Number(raw),uom:batchUom(ingredient)};
        batchFail(kind,'');renderBatchEditors();
      });
      $(kind+'PasteAll').addEventListener('click',()=>{
        if(!editor.clipboard)return;
        const qty=String(editor.clipboard.qty);
        for(const id of editor.items.keys())editor.items.set(id,qty);
        batchFail(kind,'');
        renderBatchEditors();
        // Units intentionally remain unchanged: e.g. 2 kg and 2 L, not conversion.
        toast('Applied '+qty+' to all selected ingredient quantities. Each ingredient keeps its own unit.');
      });
      $(kind+'ClearTray').addEventListener('click',()=>batchClear(kind));
    }
    renderBatchEditors();
  }
  function setupInventoryRedesign(){
    $('inventorySearch').addEventListener('input',()=>{inventoryUI.page=1;renderInventory();});
    for(const [id,field] of [['inventoryGroupBy','group'],['inventorySortBy','sort'],['inventoryStatusFilter','status']]){
      $(id).addEventListener('change',e=>{inventoryUI[field]=e.target.value;inventoryUI.page=1;renderInventory();});
    }
    $('inventoryPageControls').addEventListener('click',e=>{
      const b=e.target.closest('button[data-inv-page]');if(!b||b.disabled)return;
      inventoryUI.page=Math.max(1,Number(b.dataset.invPage)||1);
      renderInventory();
      $('inventoryPageInfo').scrollIntoView?.({block:'nearest',behavior:'auto'});
    });
    $('inventoryNewIngredient').addEventListener('click',()=>{
      if(state.user?.role!=='Admin')return;
      switchView('catalog');
      activateAdminTab('ingredients');
      clearIngredientForm();
      $('ingredientName').focus({preventScroll:true});
      $('admin-ingredients').scrollIntoView?.({block:'start',behavior:'smooth'});
    });
    let openOperation=null;
    function operation(which){
      openOperation=which;
      const replenish=which==='replenish',transfer=which==='transfer';
      $('replenishForm').classList.toggle('hidden',!replenish);
      $('transferForm').classList.toggle('hidden',!transfer);
      $('replenishForm').parentElement?.classList.toggle('is-open',!!which);
      for(const [id,on] of [['inventoryReplenishTab',replenish],['inventoryTransferTab',transfer]]){
        const button=$(id);
        button.classList.toggle('active',on);
        button.setAttribute('aria-pressed',String(on));
        button.setAttribute('aria-expanded',String(on));
        button.closest('.inv-operation-card')?.classList.toggle('active',on);
      }
    }
    closeTransferEditorIfOpen=()=>{
      if(openOperation==='transfer')operation(null);
    };
    $('inventoryReplenishTab').addEventListener('click',()=>{
      operation(openOperation==='replenish'?null:'replenish');
    });
    $('inventoryTransferTab').addEventListener('click',()=>{
      if(state.subscription?.plan!=='BUSINESS'){
        toast('Transfer Inventory requires Business. Use Upgrade to switch the demo plan.');
        return;
      }
      operation(openOperation==='transfer'?null:'transfer');
    });
    operation(null);
    initBatchEditors();
  }
  setupInventoryRedesign();
  const auditUI={groups:[],expanded:new Set(),page:1,pageSize:10,query:'',type:'all'};
  function groupInventoryMovements(rows){
    const groups=[],byReference=new Map();
    let previousLegacy=null;
    for(const x of rows){
      const type=String(x.type||'UNKNOWN'),ref=String(x.reference||'').trim();
      let group;
      if(ref){
        const key=type+'|'+ref;
        group=byReference.get(key);
        if(!group){
          group={key,type,reference:ref,createdAt:x.createdAt,id:Number(x.id),items:[],branch:x.branch,receivedBy:x.receivedBy,deliveredBy:x.deliveredBy,remarks:x.remarks,createdBy:x.createdBy};
          byReference.set(key,group);groups.push(group);
        }
        previousLegacy=null;
      }else{
        // Historical batches lack references. Merge only adjacent records with
        // matching metadata within two seconds; never hide individual movements.
        const previous=previousLegacy?.row;
        const close=previous&&Math.abs(new Date(previous.createdAt)-new Date(x.createdAt))<=2000;
        const adjacent=previous&&Number(previous.id)-Number(x.id)===1;
        const same=previous&&['type','createdBy','branch','receivedBy','deliveredBy','remarks'].every(k=>String(previous[k]||'')===String(x[k]||''));
        const distinct=previousLegacy&&!previousLegacy.group.items.some(item=>String(item.ingredient)===String(x.ingredient));
        if(close&&adjacent&&same&&distinct)group=previousLegacy.group;
        else{
          group={key:'legacy-'+x.id,type,reference:'',createdAt:x.createdAt,id:Number(x.id),items:[],branch:x.branch,receivedBy:x.receivedBy,deliveredBy:x.deliveredBy,remarks:x.remarks,createdBy:x.createdBy};
          groups.push(group);
        }
        previousLegacy={row:x,group};
      }
      group.items.push(x);
      if(new Date(x.createdAt)>new Date(group.createdAt))group.createdAt=x.createdAt;
    }
    return groups.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)||b.id-a.id);
  }
  function renderMovements(){
    const query=normalize(auditUI.query),all=auditUI.groups;
    const groupType=g=>{
      const value=String(g.type||'').toUpperCase();
      if(value==='SALE')return 'sale';
      if(value==='SALE_REVERSAL')return 'reversal';
      if(value==='REPLENISH')return 'replenish';
      if(value==='TRANSFER')return 'transfer';
      return 'other';
    };
    const filtered=all.filter(g=>(auditUI.type==='all'||groupType(g)===auditUI.type)&&
      (!query||normalize([
        g.type,g.reference,g.branch,g.deliveredBy,g.receivedBy,g.remarks,g.createdBy,
        formatDateTime(g.createdAt),...g.items.map(i=>i.ingredient)
      ].join(' ')).includes(query)));
    const pages=Math.max(1,Math.ceil(filtered.length/auditUI.pageSize));
    auditUI.page=Math.max(1,Math.min(pages,auditUI.page));
    const first=(auditUI.page-1)*auditUI.pageSize;
    const visible=filtered.slice(first,first+auditUI.pageSize);
    $('movementBody').innerHTML=visible.map(g=>{
      const expanded=auditUI.expanded.has(g.key),safeType=g.type.toLowerCase().replace(/[^a-z_]/g,'-');
      const label=g.reference||(
        g.type==='REPLENISH'?'Replenishment':
        g.type==='TRANSFER'?'Stock transfer':g.type==='SALE'?'Sale':'Inventory adjustment');
      const destination=g.branch||g.deliveredBy||g.receivedBy||'—';
      const summary='<tr class="inv-audit-row'+(expanded?' is-expanded':'')+'">'+
        '<td>'+esc(formatDateTime(g.createdAt))+'</td>'+
        '<td><span class="inv-audit-type type-'+esc(safeType)+'">'+esc(g.type.replaceAll('_',' '))+'</span></td>'+
        '<td class="inv-audit-reference" title="'+esc(label)+'">'+esc(label)+'</td>'+
        '<td class="num">'+g.items.length+' item'+(g.items.length===1?'':'s')+'</td>'+
        '<td>'+esc(destination)+'</td>'+
        '<td>'+esc(g.createdBy||'—')+'</td>'+
        '<td><button type="button" class="inv-audit-view" data-audit-toggle="'+esc(g.key)+'" aria-expanded="'+expanded+'" aria-label="'+(expanded?'Collapse':'View')+' '+esc(label)+' ingredient breakdown">'+(expanded?'▾ Hide':'▸ View')+'</button></td></tr>';
      if(!expanded)return summary;
      const details=g.items.map(i=>
        '<tr><td><strong>'+esc(i.ingredient)+'</strong> <small>'+esc(String(i.uom||'').toUpperCase())+'</small></td>'+
        '<td class="num '+(Number(i.quantityChange)<0?'stock-low':'stock-ok')+'">'+
        (Number(i.quantityChange)>0?'+':'')+num(i.quantityChange)+'</td>'+
        '<td class="num">'+num(i.balanceAfter)+'</td></tr>'
      ).join('');
      const metadata=[
        g.reference?'<span><b>Reference:</b> '+esc(g.reference)+'</span>':'',
        g.branch?'<span><b>Destination:</b> '+esc(g.branch)+'</span>':'',
        g.deliveredBy?'<span><b>Delivered by:</b> '+esc(g.deliveredBy)+'</span>':'',
        g.receivedBy?'<span><b>Received by:</b> '+esc(g.receivedBy)+'</span>':'',
        g.remarks?'<span><b>Remarks:</b> '+esc(g.remarks)+'</span>':''
      ].filter(Boolean).join('');
      return summary+'<tr class="inv-audit-details-row"><td colspan="7"><div class="inv-audit-detail-panel">'+
        '<div class="inv-audit-detail-title">Ingredient breakdown ('+g.items.length+')</div>'+
        '<div class="inv-audit-details-table-wrap"><table class="inv-audit-inner-table"><thead><tr><th>Ingredient</th><th class="num">Change</th><th class="num">Balance after</th></tr></thead><tbody>'+
        details+'</tbody></table></div>'+(metadata?'<div class="inv-audit-meta">'+metadata+'</div>':'')+
        '</div></td></tr>';
    }).join('')||'<tr><td colspan="7" class="inv-audit-empty">'+(all.length?'No transactions match your search.':'No inventory movements recorded yet.')+'</td></tr>';
    $('auditPageInfo').textContent=filtered.length?
      'Showing '+(first+1)+'–'+Math.min(filtered.length,first+auditUI.pageSize)+' of '+filtered.length+' transactions':
      'Showing 0 transactions';
    $('movementResultCount').textContent=filtered.length+' of '+all.length+' movement'+(all.length===1?'':'s');
    $('auditPageControls').innerHTML='<button type="button" data-audit-page="'+(auditUI.page-1)+'" '+(auditUI.page===1?'disabled':'')+' aria-label="Previous audit page">‹</button>'+
      '<span>Page '+auditUI.page+' of '+pages+'</span>'+
      '<button type="button" data-audit-page="'+(auditUI.page+1)+'" '+(auditUI.page===pages?'disabled':'')+' aria-label="Next audit page">›</button>';
  }
  async function loadMovements(){
    try{
      const d=await api('/api/inventory/movements?limit=1000');
      auditUI.groups=groupInventoryMovements(Array.isArray(d.items)?d.items:[]);
      renderMovements();
    }catch(err){
      console.error('Inventory audit failed:',err);
      $('movementBody').innerHTML='<tr><td colspan="7" class="inv-audit-empty">Could not load inventory movements. Use Refresh to retry.</td></tr>';
      $('auditPageInfo').textContent='Audit unavailable';
      $('auditPageControls').innerHTML='';
      toast('Inventory audit: '+err.message);
    }
  }
  $('movementSearch').addEventListener('input',e=>{auditUI.query=e.target.value;auditUI.page=1;renderMovements();});
  $('movementTypeFilter').addEventListener('change',e=>{auditUI.type=e.target.value;auditUI.page=1;renderMovements();});
  $('movementBody').addEventListener('click',e=>{
    const button=e.target.closest('[data-audit-toggle]');
    if(!button)return;
    const key=button.dataset.auditToggle;
    if(auditUI.expanded.has(key))auditUI.expanded.delete(key);else auditUI.expanded.add(key);
    renderMovements();
  });
  $('auditPageControls').addEventListener('click',e=>{
    const button=e.target.closest('[data-audit-page]');
    if(!button||button.disabled)return;
    auditUI.page=Number(button.dataset.auditPage)||1;
    renderMovements();
  });
  $('refreshMovements').onclick=loadMovements;
  $('replenishForm').addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget;let items;try{items=batchPayload('replenish');batchFail('replenish','');}catch(err){batchFail('replenish',err.message);return;}await withFormLock(form,async()=>{try{await api('/api/inventory/replenish',{method:'POST',body:{items,deliveredBy:$('deliveredBy').value.trim(),remarks:$('replenishRemarks').value.trim()}});toast(items.length+' ingredient'+(items.length===1?'':'s')+' replenished successfully.');batchClear('replenish');await loadInventory();await loadCatalog();}catch(err){batchFail('replenish',err.message);}});});
  $('transferForm').addEventListener('submit',async e=>{
    e.preventDefault();
    if(state.subscription?.plan!=='BUSINESS'){
      batchFail('transfer','Business plan required to transfer stock.');
      return;
    }
    const form=e.currentTarget;let items;try{items=batchPayload('transfer');batchFail('transfer','');}catch(err){batchFail('transfer',err.message);return;}await withFormLock(form,async()=>{try{await api('/api/inventory/transfer',{method:'POST',body:{items,branch:$('transferBranch').value.trim(),receivedBy:$('receivedBy').value.trim(),remarks:$('transferRemarks').value.trim()}});toast(items.length+' ingredient'+(items.length===1?'':'s')+' transferred successfully.');batchClear('transfer');await loadInventory();await loadCatalog();}catch(err){batchFail('transfer',err.message);}});});

  const reportUI={request:0,debounce:null,pages:{products:1,promos:1,ingredients:1,transactions:1},ids:{
    products:'reportProductsPagination',promos:'reportPromosPagination',
    ingredients:'reportIngredientsPagination',transactions:'reportTransactionsPagination'
  }};
  // Cashier choices come from recorded sale snapshots, not only active users.
  // This includes previous cashiers in old sales and in deleted transactions.
  const reportCashierUI={selected:new Set(),choices:[],request:0};
  function renderReportCashierChoices(){
    const selected=reportCashierUI.selected;
    $('reportCashierAll').checked=selected.size===0;
    const count=selected.size;
    $('reportCashierSummary').textContent=count===0?'All cashiers'
      :count===1?[...selected][0]:count+' cashiers selected';
    $('reportCashierList').innerHTML=reportCashierUI.choices.map((name,index)=>
      '<label class="report-cashier-option"><input type="checkbox" data-cashier-index="'+
      index+'" '+(selected.has(name)?'checked ':'')+
      '/><span>'+esc(name)+'</span></label>'
    ).join('')||'<p class="report-cashier-empty">No recorded cashiers for this branch yet.</p>';
  }
  async function loadReportCashiers(reset=false){
    if(reset)reportCashierUI.selected.clear();
    const request=++reportCashierUI.request;
    const q=new URLSearchParams();
    if(state.user?.role==='Admin'&&$('reportBranch').value!=='all')
      q.set('branchId',$('reportBranch').value);
    try{
      const response=await api('/api/reports/cashiers?'+q);
      if(request!==reportCashierUI.request)return;
      reportCashierUI.choices=(response.cashiers||[]).filter(x=>typeof x==='string');
      const choices=new Set(reportCashierUI.choices);
      for(const chosen of reportCashierUI.selected)
        if(!choices.has(chosen))reportCashierUI.selected.delete(chosen);
      renderReportCashierChoices();
    }catch(err){
      if(request!==reportCashierUI.request)return;
      $('reportCashierList').innerHTML='<p class="report-cashier-empty">Could not load cashier list.</p>';
      toast('Cashier options: '+err.message);
    }
  }
  $('reportCashierAll').addEventListener('change',()=>{
    reportCashierUI.selected.clear();
    renderReportCashierChoices();
    loadReport();
  });
  $('reportCashierList').addEventListener('change',event=>{
    const field=event.target.closest('input[data-cashier-index]');
    if(!field)return;
    const index=Number(field.dataset.cashierIndex);
    const name=reportCashierUI.choices[index];
    if(!name)return;
    if(field.checked)reportCashierUI.selected.add(name);
    else reportCashierUI.selected.delete(name);
    renderReportCashierChoices();
    loadReport();
  });
  $('reportCashierDone').addEventListener('click',()=>{
    $('reportCashierSelect').open=false;
  });
  function reportPageSlice(kind,items){
    const page=window.DonMacReportPages.paginate(items,reportUI.pages[kind]);
    reportUI.pages[kind]=page.page;
    const make=(number,label,disabled=false,active=false)=>
      '<button type="button" data-report-page="'+number+'" aria-label="'+esc(String(label))+'" '+
      (disabled?'disabled ':'')+(active?'aria-current="page" ':'')+'>'+esc(String(label))+'</button>';
    $(reportUI.ids[kind]).innerHTML=
      '<span class="report-page-info">Showing '+page.from+'–'+page.to+' of '+page.total+' '+
      (page.total===1?'row':'rows')+'</span><div class="report-page-buttons">'+
      make(page.page-1,'Previous',page.page===1)+
      window.DonMacReportPages.visiblePageNumbers(page.page,page.pages).map(n=>
        n==='…'?'<span class="report-page-ellipsis" aria-hidden="true">…</span>':
        make(n,n,false,n===page.page)).join('')+
      make(page.page+1,'Next',page.page===page.pages)+'</div>';
    return page.rows;
  }
  function resetReportPages(){for(const kind of Object.keys(reportUI.pages))reportUI.pages[kind]=1;}
  function reportQuery(){
    const qs=new URLSearchParams({
      period:$('reportPeriod').value,
      date:$('reportDate').value||manilaToday()
    });
    // JSON, rather than comma-separated names, preserves spaces and punctuation
    // and applies the same selection to the on-screen report and both PDFs.
    if(reportCashierUI.selected.size)
      qs.set('cashiers',JSON.stringify([...reportCashierUI.selected]));
    if(state.user?.role==='Admin'&&$('reportBranch').value!=='all')
      qs.set('branchId',$('reportBranch').value);
    return qs;
  }
  $('reportDate').value=manilaToday();
  async function loadReport(){
    if(!$('reportDate').value)$('reportDate').value=manilaToday();
    const request=++reportUI.request,qs=reportQuery();
    $('reportLoadingStatus').textContent='Loading Sales Report…';
    try{
      const [report,costing]=await Promise.all([
        api('/api/reports/sales?'+qs),api('/api/reports/costing?'+qs)
      ]);
      if(request!==reportUI.request)return;
      state.report=report;state.costing=costing;resetReportPages();
      renderReport();renderCosting();
      $('reportLoadingStatus').textContent='Updated · '+$('reportPeriod').selectedOptions[0].text+
        ' · '+$('reportDate').value;
    }catch(err){
      if(request!==reportUI.request)return;
      $('reportLoadingStatus').textContent='Could not load reports: '+err.message;
      toast(err.message);
    }
  }
  function autoLoadReport(){
    if(reportUI.debounce)clearTimeout(reportUI.debounce);
    loadReport();
  }
  ['reportPeriod','reportDate'].forEach(id=>
    $(id).addEventListener('change',autoLoadReport));
  $('reportBranch').addEventListener('change',()=>{
    reportCashierUI.selected.clear();
    renderReportCashierChoices();
    loadReportCashiers(true);
    loadReport();
  });
  $('view-reports').addEventListener('click',event=>{
    const button=event.target.closest('button[data-report-page]');
    if(!button||button.disabled)return;
    const kind=button.closest('[data-report-section]')?.dataset.reportSection;
    if(!Object.prototype.hasOwnProperty.call(reportUI.pages,kind))return;
    const page=Number(button.dataset.reportPage);
    if(!Number.isInteger(page)||page<1)return;
    reportUI.pages[kind]=page;
    if(kind==='ingredients')renderCosting();
    else renderReport();
  });
  function renderReport(){const r=state.report;if(!r)return;$('reportSummary').innerHTML=[
    ['All Transactions',r.allTransactionCount??r.transactionCount,'All recorded sales including voided transactions.'],
    ['Gross Sales',peso(r.gross),'Gross sales from non-voided transactions.'],
    ['Discounts',peso(r.discounts??0),'Discounts on non-voided sales.'],
    ['Net Sales',peso(r.actual),'Net sales after adjustments, excluding voided transactions.'],
    ['Gross Profit',peso(r.grossProfit??0),'Net sales minus product costing.'],
    ['Refund',peso(r.refund??0),'Value of voided sales; not confirmation that cash was repaid.'],
    ['Deleted',r.deletedCount,'Number of deleted or voided transactions.']
  ].map(([a,b,help])=>`<div class="summary-card" title="${esc(help)}"><span>${a}</span><strong>${b}</strong></div>`).join('');$('reportProducts').innerHTML=reportPageSlice('products',r.products).map(x=>`<tr><td>${esc(x.name)}${x.isAddOn?' <span class="badge">ADD-ON</span>':''}${x.isPackage?' <span class="badge">PACKAGE</span>':''}</td><td class="num">${num(x.qty,2)}</td><td class="num">${peso(x.gross)}</td><td class="num">${peso(x.adjusted)}</td><td class="num">${peso(x.actual)}</td><td class="num">${peso(x.costing)}</td><td class="num">${peso(x.net)}</td></tr>`).join('')||'<tr><td colspan="7" class="muted">No sales for this period.</td></tr>';$('reportPromos').innerHTML=reportPageSlice('promos',r.promos).map(x=>`<tr><td>${esc(x.name)}</td><td class="num">${x.qty}</td><td class="num">${peso(x.gross)}</td><td class="num">${peso(x.adjustment)}</td><td class="num">${peso(x.actual)}</td></tr>`).join('')||'<tr><td colspan="5" class="muted">No promo purchases for this period.</td></tr>';$('reportTransactions').innerHTML=reportPageSlice('transactions',r.transactions).map(x=>`<tr><td>${esc(x.reference)}</td><td>${esc(x.cashier||'')}</td><td class="${x.status==='Deleted'?'stock-low':'stock-ok'}">${esc(x.status)}</td><td>${esc(x.paymentMode||'')}</td><td>${esc(x.remark||'')}</td><td>${esc(formatDateTime(x.soldAt))}</td><td class="num">${peso(x.gross)}</td><td class="num">${peso(x.adjustment)}</td><td class="num">${peso(x.actual)}</td><td><button class="table-btn" data-view-sale="${encodeURIComponent(x.reference)}">View</button></td></tr>`).join('')||'<tr><td colspan="10" class="muted">No transaction logs.</td></tr>';$('reportTransactions').querySelectorAll('[data-view-sale]').forEach(b=>b.onclick=()=>viewTransaction(decodeURIComponent(b.dataset.viewSale)));}
  function renderCosting(){const r=state.costing;if(!r)return;$('costingTotal').textContent=`Total Cost: ${peso(r.totalCost)}`;$('costingList').innerHTML=reportPageSlice('ingredients',r.ingredients).map(g=>`<details class="costing-group"><summary><div><b>${esc(g.name)}</b><span>${num(g.totalQty)} ${esc(String(g.uom).toUpperCase())}</span></div><strong>${peso(g.totalCost)}</strong></summary><div class="table-wrap"><table><thead><tr><th>Product</th><th class="num">Sold Qty</th><th class="num">Recipe Qty</th><th class="num">Total Usage</th><th class="num">Cost / Item</th><th class="num">Total Cost</th></tr></thead><tbody>${g.details.map(d=>`<tr><td>${esc(d.product)}</td><td class="num">${num(d.productQty,3)}</td><td class="num">${num(d.quantityRequired)}</td><td class="num">${num(d.usageQty)}</td><td class="num">${peso(d.costPerItem)}</td><td class="num">${peso(d.totalCost)}</td></tr>`).join('')}</tbody></table></div></details>`).join('')||'<div class="empty-state">No costed product sales for this period.</div>';}
  function transactionInfo(label,value,{money=false,wide=false}={}){const shown=value===null||value===undefined||value===''?'—':money?peso(value):esc(value);return`<div class="transaction-info ${wide?'wide':''}"><span>${esc(label)}</span><strong>${shown}</strong></div>`;}
  function renderTransactionDetail(d){
    $('transactionReference').textContent=d.reference||'Transaction Details';
    $('transactionStatus').textContent=d.status||'';$('transactionStatus').className=`transaction-status ${d.status==='Deleted'?'deleted':'sold'}`;
    const itemRows=(d.items||[]).map(i=>{const components=i.components?.length?`<div class="component-list"><b>Package contents:</b>${i.components.map(c=>`<span>${num(c.qty,2)} × ${esc(c.name)}</span>`).join('')}</div>`:'';return`<tr><td><b>${esc(i.name)}</b><div class="tiny muted">${esc(i.type)}${i.excludeFromCosting?' · Excluded from costing':''}</div>${components}</td><td class="num">${num(i.qty,2)}</td><td class="num">${peso(i.unitPrice)}</td><td class="num">${peso(i.lineTotal)}</td></tr>`;}).join('')||'<tr><td colspan="4" class="muted">No item lines were recorded.</td></tr>';
    const movementRows=(d.inventoryMovements||[]).map(m=>`<tr><td>${esc(formatDateTimeDetailed(m.createdAt))}</td><td>${esc(m.type)}</td><td>${esc(m.ingredient)}</td><td>${esc(String(m.uom||'').toUpperCase())}</td><td class="num ${m.quantityChange<0?'stock-low':'stock-ok'}">${m.quantityChange>0?'+':''}${num(m.quantityChange)}</td><td class="num">${m.balanceAfter==null?'—':num(m.balanceAfter)}</td><td>${esc(m.createdBy||'')}</td><td>${esc(m.remarks||'')}</td></tr>`).join('')||'<tr><td colspan="8" class="muted">No web inventory movements were recorded for this transaction. Imported Excel transactions may not have per-sale stock movements.</td></tr>';
    const auditRows=(d.auditEvents||[]).map(e=>`<div class="audit-event"><div><b>${esc(e.status||'Event')}</b><span>${esc(formatDateTimeDetailed(e.createdAt))}</span></div><p>${esc(e.activity||'')}</p>${e.actor?`<small>Actor: ${esc(e.actor)}</small>`:''}${e.remark?`<small> · ${esc(e.remark)}</small>`:''}</div>`).join('')||'<div class="muted tiny">No matching system-log event was recorded.</div>';
    $('transactionDetailBody').innerHTML=`
      <div class="transaction-section"><h3>Transaction Information</h3><div class="transaction-info-grid">
        ${transactionInfo('Reference',d.reference)}${transactionInfo('Status',d.status)}${transactionInfo('Cashier',d.cashier)}${transactionInfo('Date / Time',formatDateTimeDetailed(d.soldAt))}
        ${transactionInfo('Payment Mode',d.paymentMode)}${transactionInfo('Payment Reference',d.paymentReference)}${transactionInfo('Cash Tender',d.tender,{money:true})}${transactionInfo('Change',d.change,{money:true})}
        ${transactionInfo('Promo',d.promo?.name)}${transactionInfo('Senior Citizen',d.seniorDetails)}${transactionInfo('Discount',d.discountAmount,{money:true})}${transactionInfo('Remark',d.remark,{wide:true})}
        ${d.deletedAt?transactionInfo('Deleted Date / Time',formatDateTimeDetailed(d.deletedAt)):''}${d.deletedAt?transactionInfo('Deleted By',d.deletedBy||'Unknown'):''}
      </div></div>
      <div class="transaction-section"><div class="transaction-section-head"><h3>Products Ordered</h3><span>${(d.items||[]).length} line(s)</span></div><div class="table-wrap"><table><thead><tr><th>Product / Item</th><th class="num">Qty</th><th class="num">Unit Price</th><th class="num">Line Total</th></tr></thead><tbody>${itemRows}</tbody></table></div></div>
      <div class="transaction-total-grid">${transactionInfo('Gross',d.gross,{money:true})}${transactionInfo('Adjustment',d.adjustment,{money:true})}${transactionInfo('Actual',d.actual,{money:true})}</div>
      <details class="transaction-section transaction-details"><summary>Inventory Impact <span>${(d.inventoryMovements||[]).length} movement(s)</span></summary><div class="table-wrap"><table><thead><tr><th>Date / Time</th><th>Type</th><th>Ingredient</th><th>UOM</th><th class="num">Change</th><th class="num">Balance</th><th>Actor</th><th>Remarks</th></tr></thead><tbody>${movementRows}</tbody></table></div></details>
      <details class="transaction-section transaction-details"><summary>Audit Events <span>${(d.auditEvents||[]).length} event(s)</span></summary><div class="audit-events">${auditRows}</div></details>`;
  }
  async function viewTransaction(reference){return withActionLock(`view-sale:${reference}`,async()=>{const dialog=$('transactionDialog');$('transactionReference').textContent=reference;$('transactionStatus').textContent='';$('transactionDetailBody').innerHTML='<div class="empty-state">Loading transaction details…</div>';if(!dialog.open)dialog.showModal();try{renderTransactionDetail(await api(`/api/sales/${encodeURIComponent(reference)}`));}catch(err){$('transactionDetailBody').innerHTML=`<div class="empty-state"><div><b>Unable to load transaction</b>${esc(err.message)}</div></div>`;toast(err.message);}});}
  window.donmacOpenTransactionDetail=viewTransaction;
  $('transactionClose').onclick=()=>safeCloseDialog('transactionDialog');$('transactionDialog').addEventListener('click',e=>{if(e.target===$('transactionDialog'))safeCloseDialog('transactionDialog');});
  $('salesPdf').onclick=()=>window.open('/api/reports/sales.pdf?'+reportQuery(),'_blank');
  $('costingPdf').onclick=()=>window.open('/api/reports/costing.pdf?'+reportQuery(),'_blank');

  async function loadDashboard(){
   try{
     const q=new URLSearchParams({view:$('trendView').value});
     if($('trendView').value==='custom'){q.set('from',$('trendFrom').value);q.set('to',$('trendTo').value);}
     if(state.user.role==='Admin'&&$('dashboardBranch').value!=='all')q.set('branchId',$('dashboardBranch').value);
     state.dashboard=await api('/api/dashboard?'+q);
     renderDashboard();
   }catch(err){toast(err.message);}
  }
  function renderDashboard(){
   const d=state.dashboard;if(!d)return;
   $('trendPeriodLabel').textContent=(d.grain==='hourly'?'HOURLY · ':'DAILY · ')+d.from+(d.to!==d.from?' TO '+d.to:'');
   const statCards=[
     {title:'Total Revenue',value:peso(d.rangeActual),caption:d.grain==='hourly'?'Selected day':'Selected range',glyph:'revenue'},
     {title:'Orders',value:num(d.rangeTransactions,0),caption:'Completed · selected range',glyph:'orders'},
     {title:'Today Sales',value:peso(d.metrics.todayActual),caption:'Gross '+peso(d.metrics.todayGross),glyph:'today'},
     {title:'Month Revenue',value:peso(d.metrics.monthActual),caption:num(d.metrics.monthTransactions,0)+' completed orders',glyph:'month'},
     {title:'Low Stock Alerts',value:num(d.metrics.lowStockCount,0),caption:'Ingredients needing attention',glyph:'alert'}
   ];
   const statIcons={
     revenue:'<path d="M3 8h18v12H3zM3 11h18M7 16h3"/><path d="M7 4h10v4"/>',
     orders:'<path d="M5 4h14v16l-2.5-1.5L14 20l-2.5-1.5L9 20l-2-1.5L5 20V4z"/><path d="M9 9h6M9 13h6"/>',
     today:'<path d="M3 20h18M6 17v-5M12 17V7M18 17V4"/>',
     month:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18M8 14h3M8 17h6"/>',
     alert:'<path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 9v5M12 17.4h.01"/>'
   };
   $('dashboardSummary').innerHTML=statCards.map(c=>`<article class="summary-card"><div class="dash-summary-label"><span class="dash-summary-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">${statIcons[c.glyph]}</svg></span><span>${esc(c.title)}</span></div><strong>${c.value}</strong><small>${esc(c.caption)}</small></article>`).join('');
   $('dashboardLowStock').innerHTML=d.lowStock.map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(String(x.uom).toUpperCase())}</td><td class="num stock-low">${num(x.stock)}</td><td class="num">${num(x.lowStockThreshold)}</td></tr>`).join('')||'<tr><td colspan="4" class="stock-ok">No low-stock ingredients.</td></tr>';
   const max=Math.max(1,...d.categorySales.map(x=>x.amount));
   $('categorySales').innerHTML=d.categorySales.map(x=>`<div class="bar-row"><div><b>${esc(x.name)}</b><span>${peso(x.amount)}</span></div><div class="bar-track"><i style="width:${Math.max(2,x.amount/max*100)}%"></i></div></div>`).join('')||'<div class="empty-state">No sales this month.</div>';
   window.__donmacDashboardData=d;
   if(typeof window.renderDonMacDashboardExtras==='function')window.renderDonMacDashboardExtras(d);
  }
  function setupCanvas(canvas){const rect=canvas.getBoundingClientRect(),ratio=window.devicePixelRatio||1;canvas.width=Math.max(300,rect.width)*ratio;canvas.height=250*ratio;const c=canvas.getContext('2d');c.setTransform(ratio,0,0,ratio,0,0);return{c,w:Math.max(300,rect.width),h:250};}
  function drawLineChart(canvas,values,labels){
   const {c,w,h}=setupCanvas(canvas),left=44,right=16,top=20,bottom=42,max=Math.max(1,...values),pw=w-left-right,ph=h-top-bottom,step=pw/Math.max(1,values.length-1);
   c.clearRect(0,0,w,h);c.strokeStyle='#e5ebe6';c.fillStyle='#6d8072';c.lineWidth=1;c.font='10px system-ui';
   for(let i=0;i<=4;i++){const y=top+i*ph/4;c.beginPath();c.moveTo(left,y);c.lineTo(w-right,y);c.stroke();c.fillText(num(max*(4-i)/4,0),3,y+3);}
   const points=values.map((v,i)=>({x:left+i*step,y:top+ph-(Number(v||0)/max)*ph,label:labels[i],amount:Number(v||0)}));
   c.beginPath();points.forEach((p,i)=>i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));c.strokeStyle='#1f7050';c.lineWidth=2.6;c.stroke();
   c.fillStyle='#1f7050';points.forEach(p=>{c.beginPath();c.arc(p.x,p.y,2.8,0,Math.PI*2);c.fill();});
   c.font='10px system-ui';c.fillStyle='#607267';
   const tickEvery=Math.max(1,Math.ceil(labels.length/7));
   labels.forEach((label,i)=>{if(i%tickEvery===0||i===labels.length-1)c.fillText(String(label),Math.max(0,Math.min(w-48,left+i*step-13)),h-10);});
   canvas._salesPoints=points;canvas._salesWidth=w;canvas._salesHeight=h;canvas._salesHit=Math.max(13,step/2);
   if(!canvas._salesHoverBound){
     canvas._salesHoverBound=true;
     const onHover=e=>{
       const rect=canvas.getBoundingClientRect(),x=(e.clientX-rect.left)*(canvas._salesWidth/rect.width),y=(e.clientY-rect.top)*(canvas._salesHeight/rect.height);
       let found=null,dist=Infinity;
       (canvas._salesPoints||[]).forEach((p,i)=>{const diff=Math.abs(x-p.x);if(diff<dist){dist=diff;found={...p,index:i};}});
       const t=$('trendTooltip');
       if(!found||dist>canvas._salesHit||y<0||y>canvas._salesHeight){t.classList.add('hidden');return;}
       const count=state.dashboard?.trend?.[found.index]?.transactions||0;
       t.innerHTML=`<span>${esc(found.label)}</span><div><strong>${peso(found.amount)}</strong> · ${num(count,0)} sale(s)</div>`;
       t.style.left=Math.max(68,Math.min(canvas._salesWidth-68,found.x))+'px';t.style.top=Math.max(22,found.y)+'px';
       t.classList.remove('hidden');
     };
     canvas.addEventListener('pointermove',onHover);canvas.addEventListener('pointerdown',onHover);
     canvas.addEventListener('pointerleave',()=>$('trendTooltip').classList.add('hidden'));
   }
  }
  function drawBarChart(canvas,values,labels){const{c,w,h}=setupCanvas(canvas);c.clearRect(0,0,w,h);const max=Math.max(1,...values),pad=16,row=(h-pad*2)/Math.max(1,values.length);c.font='10px system-ui';values.forEach((v,i)=>{const y=pad+i*row,label=String(labels[i]||'').slice(0,22);c.fillStyle='#50615a';c.fillText(label,pad,y+11);c.fillStyle='#e3ece7';c.fillRect(pad,y+16,w-pad*2,row-22);c.fillStyle='#1f5a43';c.fillRect(pad,y+16,(w-pad*2)*v/max,row-22);c.fillStyle='#17231e';c.fillText(num(v,1),w-pad-28,y+11);});}
  $('dashboardRefresh').onclick=loadDashboard;

  function activateAdminTab(tab){document.querySelectorAll('#adminTabs button').forEach(b=>b.classList.toggle('active',b.dataset.adminTab===tab));document.querySelectorAll('.admin-panel').forEach(p=>p.classList.toggle('active',p.id===`admin-${tab}`));if(tab==='recipes')loadRecipe();if(tab==='backups')loadBackups();}
  document.querySelectorAll('#adminTabs button').forEach(b=>b.onclick=()=>activateAdminTab(b.dataset.adminTab));
  async function loadAdminAll(){if(state.user?.role!=='Admin')return;try{const selectedRecipe=$('recipeProduct').value,selectedPackage=$('compositionPackage').value;const [p,i,pr,pa]=await Promise.all([api('/api/admin/products'),api('/api/admin/ingredients'),api('/api/admin/promos'),api('/api/admin/packages')]);state.adminProducts=p.products;state.adminIngredients=i.ingredients;state.adminPromos=pr.promos;state.adminPackages=pa.packages;renderAdminProducts();renderAdminIngredients();renderAdminPromos();renderAdminPackages();fillAdminSelects(selectedRecipe,selectedPackage);}catch(err){toast(err.message);}}
  function fillAdminSelects(selectedRecipe='',selectedPackage=''){const activeProducts=state.adminProducts.filter(x=>x.active),productOpts=activeProducts.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');$('recipeProduct').innerHTML=productOpts;$('compositionPackage').innerHTML=state.adminPackages.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');if(selectedRecipe&&activeProducts.some(p=>String(p.id)===String(selectedRecipe)))$('recipeProduct').value=String(selectedRecipe);if(selectedPackage&&state.adminPackages.some(p=>String(p.id)===String(selectedPackage)))$('compositionPackage').value=String(selectedPackage);if(activeProducts.length)loadRecipe();else{state.recipeRows=[];renderRecipe();}if(state.adminPackages.length)loadComposition();else{state.compositionRows=[];renderComposition();}}

  const catalogPages={products:1,ingredients:1,promos:1,packages:1};
  const catalogPageIds={products:'adminProductsBodyPagination',ingredients:'adminIngredientsBodyPagination',promos:'adminPromosBodyPagination',packages:'adminPackagesBodyPagination'};
  const catalogRenders={};
  function catalogPage(kind,rows){
    const d=window.DonMacReportPages.paginate(rows,catalogPages[kind]);catalogPages[kind]=d.page;
    const btn=(p,label,disabled,active)=>'<button type="button" data-catalog-page="'+p+'" aria-label="'+esc(String(label))+'" '+(disabled?'disabled ':'')+(active?'aria-current="page" ':'')+'>'+esc(String(label))+'</button>';
    $(catalogPageIds[kind]).innerHTML='<span class="report-page-info">Showing '+d.from+'–'+d.to+' of '+d.total+'</span><div class="report-page-buttons">'+btn(d.page-1,'Previous',d.page===1,false)+
    window.DonMacReportPages.visiblePageNumbers(d.page,d.pages).map(p=>p==='…'?'<span class="report-page-ellipsis">…</span>':btn(p,p,false,p===d.page)).join('')+
    btn(d.page+1,'Next',d.page===d.pages,false)+'</div>';
    return d.rows;
  }
  $('view-catalog').addEventListener('click',event=>{
    const b=event.target.closest('button[data-catalog-page]');
    if(!b||b.disabled)return;
    const id=b.closest('nav')?.id,kind=Object.keys(catalogPageIds).find(k=>catalogPageIds[k]===id),page=Number(b.dataset.catalogPage);
    if(!kind||!Number.isInteger(page)||page<1)return;
    catalogPages[kind]=page;catalogRenders[kind]?.();
  });
  function renderAdminProducts(){const q=normalize($('adminProductSearch').value),rows=state.adminProducts.filter(p=>!q||normalize(p.name).includes(q)||normalize(p.category).includes(q));$('adminProductsBody').innerHTML=catalogPage('products',rows).map(p=>`<tr><td><b>${esc(p.name)}</b><div class="tiny muted">${esc(p.sku)}</div></td><td>${esc(p.category)}</td><td class="num">${peso(p.price)}</td><td class="num">${peso(p.unitCost)}</td><td class="${p.active&&!p.recipeCount?'stock-low':''}">${p.recipeCount} ingredient(s)${p.active&&!p.recipeCount?'<div class="tiny">RECIPE REQUIRED · NOT SELLABLE</div>':''}</td><td class="${p.active?'stock-ok':'stock-low'}">${p.active?'ACTIVE':'ARCHIVED'}</td><td><button class="table-btn" data-edit-product="${p.id}">Edit</button>${p.active?`<button class="danger-link" data-archive-product="${p.id}">Archive</button>`:''}</td></tr>`).join('');$('adminProductsBody').querySelectorAll('[data-edit-product]').forEach(b=>b.onclick=()=>editProduct(Number(b.dataset.editProduct)));$('adminProductsBody').querySelectorAll('[data-archive-product]').forEach(b=>b.onclick=()=>archiveProduct(Number(b.dataset.archiveProduct)));}
  $('adminProductSearch').oninput=()=>{catalogPages.products=1;renderAdminProducts();};
  catalogRenders.products=renderAdminProducts;
  let imageProcessingToken=0,imageBusy=false,imageInvalid=false;
  function productImageStatus(message,error=false){
    const el=$('productImageMessage');
    if(el){el.textContent=message;el.classList.toggle('error',error);el.classList.toggle('success',!error&&/ready|optimized|saved/i.test(message));}
  }
  function photoFormState(){
    const save=$('productSaveButton');
    if(save)save.disabled=imageBusy||imageInvalid;
  }
  function showProductPhoto(data){
    $('productImageData').value=data||'';
    $('productImagePreview').classList.toggle('hidden',!data);
    $('productImageEmpty').classList.toggle('hidden',!!data);
    if(data)$('productImagePreview').src=data;else $('productImagePreview').removeAttribute('src');
  }
  function clearProductForm(){
    imageProcessingToken++;imageBusy=false;imageInvalid=false;
    $('productEditId').value='';$('productName').value='';$('productName').readOnly=false;
    $('productCategory').value='Coffee';$('productPrice').value='';$('productActive').checked=true;
    $('productFormTitle').textContent='New Product';$('productImageFile').value='';
    showProductPhoto(null);productImageStatus('Select a photo, then save the product.');photoFormState();
  }
  function editProduct(id){
    const p=state.adminProducts.find(x=>x.id===id);if(!p)return;
    imageProcessingToken++;imageBusy=false;imageInvalid=false;
    $('productEditId').value=id;$('productName').value=p.name;$('productName').readOnly=true;
    $('productCategory').value=p.category;$('productPrice').value=p.price;
    $('productActive').checked=p.active;$('productFormTitle').textContent=`Update ${p.name}`;
    $('productImageFile').value='';showProductPhoto(p.imageData);
    productImageStatus(p.imageData?'Current photo loaded. Choose a replacement or remove it.':'No photo saved for this product yet.');
    photoFormState();
  }
  async function archiveProduct(id){return withActionLock(`archive-product:${id}`,async()=>{const p=state.adminProducts.find(x=>x.id===id);if(!p||!confirm(`Archive ${p.name}? It will disappear from the POS but historical sales remain.`))return;try{await api(`/api/admin/products/${id}`,{method:'DELETE'});toast('Product archived.');await loadAdminAll();await loadCatalog();}catch(err){toast(err.message);}});}
  $('productImageRemove').onclick=()=>{
    imageProcessingToken++;imageBusy=false;imageInvalid=false;
    $('productImageFile').value='';showProductPhoto(null);
    productImageStatus('Photo removed from preview. Save Product to remove it from the catalog.');
    photoFormState();
  };
  $('productImageFile').addEventListener('change',async event=>{
    const file=event.target.files?.[0];if(!file)return;
    const token=++imageProcessingToken;
    imageBusy=true;imageInvalid=false;photoFormState();
    const fail=message=>{
      if(token!==imageProcessingToken)return;
      imageBusy=false;imageInvalid=true;event.target.value='';
      productImageStatus(message,true);photoFormState();toast(message);
    };
    if(file.size>1024*1024){fail('Image too large: maximum file size is 1 MB. Please select a smaller image.');return;}
    if(file.size<32||!['image/jpeg','image/png','image/webp'].includes(file.type)){
      fail('Invalid image. Use a valid JPG, PNG, or WebP photo (maximum 1 MB).');return;
    }
    productImageStatus('Checking and compressing photo…');
    try{
      const magic=new Uint8Array(await file.slice(0,16).arrayBuffer());
      const jpg=magic[0]===0xff&&magic[1]===0xd8&&magic[2]===0xff;
      const png=magic.slice(0,8).every((x,i)=>x===[137,80,78,71,13,10,26,10][i]);
      const webp=String.fromCharCode(...magic.slice(0,4))==='RIFF'&&String.fromCharCode(...magic.slice(8,12))==='WEBP';
      if(!(file.type==='image/jpeg'&&jpg||file.type==='image/png'&&png||file.type==='image/webp'&&webp))
        throw new Error('Invalid image format: this file is not a genuine JPG, PNG, or WebP.');
      // CSP allows image data URLs, but blocks blob: URLs. Read through
      // FileReader so valid local photos load without loosening security policy.
      const imageSrc=await new Promise((resolve,reject)=>{
        const reader=new FileReader();
        reader.onload=()=>resolve(reader.result);
        reader.onerror=()=>reject(new Error('Could not read this photo. Please choose another image.'));
        reader.readAsDataURL(file);
      });
      if(token!==imageProcessingToken)return;
      const img=new Image();
      await new Promise((resolve,reject)=>{
        img.onload=resolve;
        img.onerror=()=>reject(new Error('The photo could not be decoded in your browser. Please try another valid image.'));
        img.src=imageSrc;
      });
      if(!img.naturalWidth||!img.naturalHeight||img.naturalWidth>14000||img.naturalHeight>14000)
        throw new Error('Invalid image dimensions.');
      const canvas=document.createElement('canvas');
      const ctx=canvas.getContext('2d',{alpha:false});
      if(!ctx)throw new Error('Image compression is not available in this browser.');
      let scale=Math.min(1,540/img.naturalWidth,540/img.naturalHeight);
      let data='',bytes=0;
      for(let attempt=0;attempt<6;attempt++){
        canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));
        canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
        ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
        ctx.drawImage(img,0,0,canvas.width,canvas.height);
        data=canvas.toDataURL('image/jpeg',Math.max(.43,.78-attempt*.065));
        bytes=Math.ceil((data.length-data.indexOf(',')-1)*3/4);
        if(bytes<=115*1024)break;
        scale*=.76;
      }
      if(bytes>115*1024||!data.startsWith('data:image/jpeg;base64,'))
        throw new Error('Unable to compress the photo sufficiently. Please choose another image.');
      if(token!==imageProcessingToken)return;
      showProductPhoto(data);
      productImageStatus(`Photo optimized to ${Math.ceil(bytes/1024)} KB. Click Save Product to apply.`);
      imageBusy=false;imageInvalid=false;photoFormState();
    }catch(error){fail(error.message||'Invalid photo. Please select another image.');}
  });
  $('productFormClear').onclick=clearProductForm;
  $('productForm').addEventListener('submit',async e=>{
    e.preventDefault();
    if(imageBusy){productImageStatus('Please finish processing your photo before saving.',true);return;}
    if(imageInvalid){productImageStatus('Please choose a valid photo or remove the invalid selection first.',true);return;}
    const form=e.currentTarget;
    await withFormLock(form,async()=>{
      const id=Number($('productEditId').value||0);
      const desiredPhoto=$('productImageData').value||null;
      const body={
        name:$('productName').value.trim(),category:$('productCategory').value,
        price:Number($('productPrice').value),active:$('productActive').checked,
        imageData:desiredPhoto
      };
      try{
        const saved=await api(id?`/api/admin/products/${id}`:'/api/admin/products',{
          method:id?'PUT':'POST',body
        });
        const savedId=id||Number(saved.id);
        // Read back the stored picture. Do not report success until it is persisted.
        const refreshed=await api('/api/admin/products');
        const serverProduct=refreshed.products.find(x=>Number(x.id)===savedId);
        if(!serverProduct||((serverProduct.imageData||null)!==desiredPhoto)){
          throw new Error('The product was updated, but its photo could not be verified. Please retry.');
        }
        productImageStatus(desiredPhoto?'Photo saved and verified in the product catalog.':'Product saved without a photo.');
        toast(id?'Product and photo saved successfully.':'Product added successfully.');
        clearProductForm();
        await loadAdminAll();
        await loadCatalog();
      }catch(err){
        productImageStatus(err.message||'Could not save the product photo.',true);
        toast(err.message||'Could not save the product photo.');
      }
    });
  });

  function renderAdminIngredients(){const q=normalize($('adminIngredientSearch').value),rows=state.adminIngredients.filter(i=>!q||normalize(i.name).includes(q)||normalize(i.code).includes(q)||normalize(i.uom).includes(q));$('adminIngredientsBody').innerHTML=catalogPage('ingredients',rows).map(i=>`<tr><td><b>${esc(i.name)}</b></td><td class="tiny">${esc(i.code)}</td><td>${esc(String(i.uom).toUpperCase())}</td><td class="num">${num(i.stock)}</td><td class="num">${num(i.lowStockThreshold)}</td><td class="${i.active?'stock-ok':'stock-low'}">${i.active?'ACTIVE':'ARCHIVED'}</td><td><button class="table-btn" data-edit-ing="${i.id}">Edit</button>${i.active?`<button class="danger-link" data-archive-ing="${i.id}">Archive</button>`:''}</td></tr>`).join('');$('adminIngredientsBody').querySelectorAll('[data-edit-ing]').forEach(b=>b.onclick=()=>editIngredient(Number(b.dataset.editIng)));$('adminIngredientsBody').querySelectorAll('[data-archive-ing]').forEach(b=>b.onclick=()=>archiveIngredient(Number(b.dataset.archiveIng)));}
  $('adminIngredientSearch').oninput=()=>{catalogPages.ingredients=1;renderAdminIngredients();};
  catalogRenders.ingredients=renderAdminIngredients;
  function clearIngredientForm(){$('ingredientEditId').value='';$('ingredientName').value='';$('ingredientUom').value='';$('ingredientThreshold').value='0';$('ingredientActive').checked=true;$('ingredientFormTitle').textContent='New Ingredient';}
  function editIngredient(id){const i=state.adminIngredients.find(x=>x.id===id);if(!i)return;$('ingredientEditId').value=id;$('ingredientName').value=i.name;$('ingredientUom').value=i.uom;$('ingredientThreshold').value=i.lowStockThreshold;$('ingredientActive').checked=i.active;$('ingredientFormTitle').textContent=`Update ${i.name}`;}
  async function archiveIngredient(id){return withActionLock(`archive-ingredient:${id}`,async()=>{const i=state.adminIngredients.find(x=>x.id===id);if(!i||!confirm(`Archive ${i.name}? This is allowed only when no recipe uses it.`))return;try{await api(`/api/admin/ingredients/${id}`,{method:'DELETE'});toast('Ingredient archived.');await loadAdminAll();await loadInventory();await loadCatalog();}catch(err){toast(err.message);}});}
  $('ingredientFormClear').onclick=clearIngredientForm;$('ingredientForm').addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget;await withFormLock(form,async()=>{const id=Number($('ingredientEditId').value||0),body={name:$('ingredientName').value.trim(),uom:$('ingredientUom').value.trim(),lowStockThreshold:Number($('ingredientThreshold').value||0),active:$('ingredientActive').checked};try{if(id)await api(`/api/admin/ingredients/${id}`,{method:'PUT',body});else await api('/api/admin/ingredients',{method:'POST',body});toast(id?'Ingredient updated.':'Ingredient added.');clearIngredientForm();await loadAdminAll();await loadInventory();await loadCatalog();}catch(err){toast(err.message);}});});

  async function loadRecipe(){const id=Number($('recipeProduct').value||state.adminProducts.find(x=>x.active)?.id||0);if(!id){state.recipeRows=[];renderRecipe();return;}const seq=++recipeLoadSeq;try{const d=await api(`/api/admin/products/${id}/recipe`);if(seq!==recipeLoadSeq||Number($('recipeProduct').value)!==id)return;state.recipeRows=d.items.map(x=>({...x}));renderRecipe();}catch(err){if(seq===recipeLoadSeq)toast(err.message);}}
  function renderRecipe(){$('recipeBody').innerHTML=state.recipeRows.map((r,i)=>`<tr><td>${esc(r.name)}</td><td>${esc(String(r.uom).toUpperCase())}</td><td class="num"><input class="catalog-inline-quantity" aria-label="Quantity required for ${esc(r.name)}" type="number" min="0.000000001" step="any" data-recipe-qty="${i}" value="${Number(r.quantity)}" /></td><td class="num"><input class="catalog-inline-quantity" aria-label="Cost contribution for ${esc(r.name)}" type="number" min="0" step="any" data-recipe-cost="${i}" value="${r.cost===null?'':Number(r.cost)}" placeholder="Auto cost" /></td><td><button class="danger-link" data-remove-recipe="${i}">Remove</button></td></tr>`).join('')||'<tr><td colspan="5" class="muted">No recipe rows. This product stays Not Available until at least one ingredient is added and saved.</td></tr>';$('recipeBody').querySelectorAll('[data-remove-recipe]').forEach(b=>b.onclick=()=>{state.recipeRows.splice(Number(b.dataset.removeRecipe),1);renderRecipe();});$('recipeUnitCost').textContent=`Unit Cost: ${peso(state.recipeRows.reduce((a,x)=>a+Number(x.cost||0),0))}`;window.DonMacCatalogBatch?.refresh('recipe');}
  $('recipeBody').addEventListener('input',event=>{
    const q=event.target.closest('[data-recipe-qty]'),c=event.target.closest('[data-recipe-cost]');
    if(q){const row=state.recipeRows[Number(q.dataset.recipeQty)];if(row)row.quantity=q.value===''?0:Number(q.value);}
    if(c){const row=state.recipeRows[Number(c.dataset.recipeCost)];if(row)row.cost=c.value===''?null:Number(c.value);}
    $('recipeUnitCost').textContent='Unit Cost: '+peso(state.recipeRows.reduce((a,x)=>a+Number(x.cost||0),0));
  });
  $('recipeProduct').onchange=loadRecipe;$('saveRecipe').onclick=()=>withActionLock('save-recipe',async()=>{const pid=Number($('recipeProduct').value);if(!pid){toast('Choose a product first.');return;}try{await api(`/api/admin/products/${pid}/recipe`,{method:'PUT',body:{items:state.recipeRows.map(x=>({ingredientId:x.ingredientId,quantity:x.quantity,cost:x.cost}))}});toast('Recipe and costing saved.');await loadAdminAll();await loadCatalog();}catch(err){toast(err.message);}});

  function renderAdminPromos(){$('adminPromosBody').innerHTML=catalogPage('promos',state.adminPromos).map(p=>`<tr><td><b>${esc(p.name)}</b></td><td>${esc(p.inclusion)}</td><td class="num">${peso(p.price)}</td><td>${p.foodLimit} Food / ${p.coffeeLimit} Coffee</td><td class="${p.active?'stock-ok':'stock-low'}">${p.active?'ACTIVE':'DISABLED'}</td><td><button class="table-btn" data-edit-promo="${p.id}">Edit</button>${p.active?`<button class="danger-link" data-archive-promo="${p.id}">Disable</button>`:''}</td></tr>`).join('');$('adminPromosBody').querySelectorAll('[data-edit-promo]').forEach(b=>b.onclick=()=>editPromo(Number(b.dataset.editPromo)));$('adminPromosBody').querySelectorAll('[data-archive-promo]').forEach(b=>b.onclick=()=>archivePromo(Number(b.dataset.archivePromo)));}
  catalogRenders.promos=renderAdminPromos;
  function clearPromoForm(){$('promoEditId').value='';$('promoName').value='';$('promoInclusion').value='';$('promoPrice').value='';$('promoFood').value='';$('promoCoffee').value='';$('promoActive').checked=true;}
  function editPromo(id){const p=state.adminPromos.find(x=>x.id===id);if(!p)return;$('promoEditId').value=id;$('promoName').value=p.name;$('promoInclusion').value=p.inclusion;$('promoPrice').value=p.price;$('promoFood').value=p.foodLimit;$('promoCoffee').value=p.coffeeLimit;$('promoActive').checked=p.active;}
  async function archivePromo(id){return withActionLock(`archive-promo:${id}`,async()=>{const p=state.adminPromos.find(x=>x.id===id);if(!p||!confirm(`Disable ${p.name}?`))return;try{await api(`/api/admin/promos/${id}`,{method:'DELETE'});toast('Promo disabled.');await loadAdminAll();await loadCatalog();}catch(err){toast(err.message);}});}
  $('promoFormClear').onclick=clearPromoForm;$('promoForm').addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget;await withFormLock(form,async()=>{const id=Number($('promoEditId').value||0),body={name:$('promoName').value.trim(),inclusion:$('promoInclusion').value.trim(),price:Number($('promoPrice').value),foodLimit:Number($('promoFood').value),coffeeLimit:Number($('promoCoffee').value),active:$('promoActive').checked};try{if(id)await api(`/api/admin/promos/${id}`,{method:'PUT',body});else await api('/api/admin/promos',{method:'POST',body});toast(id?'Promo updated.':'Promo added.');clearPromoForm();await loadAdminAll();await loadCatalog();}catch(err){toast(err.message);}});});

  function renderAdminPackages(){$('adminPackagesBody').innerHTML=catalogPage('packages',state.adminPackages).map(p=>`<tr><td><b>${esc(p.name)}</b></td><td class="num">${peso(p.price)}</td><td>${p.items.length?`${p.items.length} product type(s)`:'<span class="stock-low">REQUIRED</span>'}</td><td class="${p.active?'stock-ok':'stock-low'}">${p.active?'ACTIVE':'DISABLED'}</td><td><button class="table-btn" data-edit-package="${p.id}">Edit</button>${p.active?`<button class="danger-link" data-archive-package="${p.id}">Disable</button>`:''}</td></tr>`).join('');$('adminPackagesBody').querySelectorAll('[data-edit-package]').forEach(b=>b.onclick=()=>editPackage(Number(b.dataset.editPackage)));$('adminPackagesBody').querySelectorAll('[data-archive-package]').forEach(b=>b.onclick=()=>archivePackage(Number(b.dataset.archivePackage)));}
  catalogRenders.packages=renderAdminPackages;
  function clearPackageForm(){$('packageEditId').value='';$('packageName').value='';$('packagePrice').value='';$('packageActive').checked=true;}
  function editPackage(id){const p=state.adminPackages.find(x=>x.id===id);if(!p)return;$('packageEditId').value=id;$('packageName').value=p.name;$('packagePrice').value=p.price;$('packageActive').checked=p.active;$('compositionPackage').value=String(id);loadComposition();}
  async function archivePackage(id){return withActionLock(`archive-package:${id}`,async()=>{const p=state.adminPackages.find(x=>x.id===id);if(!p||!confirm(`Disable ${p.name}?`))return;try{await api(`/api/admin/packages/${id}`,{method:'DELETE'});toast('Package disabled.');await loadAdminAll();await loadCatalog();}catch(err){toast(err.message);}});}
  $('packageFormClear').onclick=clearPackageForm;$('packageForm').addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget;await withFormLock(form,async()=>{const id=Number($('packageEditId').value||0),body={name:$('packageName').value.trim(),price:Number($('packagePrice').value),active:$('packageActive').checked};try{if(id)await api(`/api/admin/packages/${id}`,{method:'PUT',body});else await api('/api/admin/packages',{method:'POST',body});toast(id?'Package updated.':'Package added.');clearPackageForm();await loadAdminAll();await loadCatalog();}catch(err){toast(err.message);}});});
  function loadComposition(){const id=Number($('compositionPackage').value),p=state.adminPackages.find(x=>x.id===id);state.compositionRows=(p?.items||[]).map(x=>({...x}));renderComposition();}
  function renderComposition(){$('compositionList').innerHTML=state.compositionRows.map((r,i)=>`<div class="mini-row catalog-comp-row"><span><b>${esc(r.name)}</b></span><label>Qty <input class="catalog-inline-quantity" aria-label="Quantity for ${esc(r.name)}" type="number" min="1" step="1" value="${Number(r.qty)}" data-comp-qty="${i}" /></label><button class="danger-link" data-remove-comp="${i}">Remove</button></div>`).join('')||'<div class="muted tiny">No products assigned yet.</div>';$('compositionList').querySelectorAll('[data-remove-comp]').forEach(b=>b.onclick=()=>{state.compositionRows.splice(Number(b.dataset.removeComp),1);renderComposition();});window.DonMacCatalogBatch?.refresh('composition');}
  $('compositionList').addEventListener('input',event=>{
    const field=event.target.closest('[data-comp-qty]');if(!field)return;
    const row=state.compositionRows[Number(field.dataset.compQty)];
    if(row)row.qty=field.value===''?0:Number(field.value);
  });
  $('compositionPackage').onchange=loadComposition;$('saveComposition').onclick=()=>withActionLock('save-composition',async()=>{const id=Number($('compositionPackage').value);if(!id){toast('Choose a package first.');return;}try{await api(`/api/admin/packages/${id}/items`,{method:'PUT',body:{items:state.compositionRows.map(x=>({productId:x.productId,qty:x.qty}))}});toast('Package composition saved.');await loadAdminAll();await loadCatalog();}catch(err){toast(err.message);}});

  async function loadSettings(){try{const s=await api('/api/admin/settings');$('shopName').value=s.shopName||'';$('defaultReportEmail').value=s.defaultReportEmail||'';$('smtpStatus').innerHTML=`<b class="${s.smtp.configured?'stock-ok':'stock-low'}">${s.smtp.configured?'CONFIGURED':'NOT CONFIGURED'}</b><br>Host: ${esc(s.smtp.host)}:${s.smtp.port}<br>User: ${esc(s.smtp.user||'—')}<br><span class="tiny muted">Set SMTP_USER and SMTP_PASS on the server. Gmail App Passwords are supported over TLS port 465.</span>`;}catch(err){toast(err.message);}}
  $('settingsForm').addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget;await withFormLock(form,async()=>{try{await api('/api/admin/settings',{method:'PUT',body:{shopName:$('shopName').value.trim(),defaultReportEmail:$('defaultReportEmail').value.trim()}});toast('Settings saved.');await loadSettings();}catch(err){toast(err.message);}});});


  function archiveComparisonStatus(meta){
    const status=$('archiveCompareStatus'),view=$('archiveCompareView'),expiration=$('archiveCompareExpiry');
    if(!meta?.uploaded){
      status.textContent='No archive has been uploaded for comparison.';
      view.disabled=true;
      expiration.textContent='Upload a new JSON data archive to enable 24-hour read-only comparison.';
      $('archiveCompareResult').classList.add('hidden');
      return;
    }
    const uploaded=formatDateTime(meta.uploadedAt),until=formatDateTime(meta.expiresAt);
    status.textContent=(meta.active?'Available':'Expired')+' · '+meta.filename+
      ' · Uploaded '+uploaded+(meta.uploadedBy?' by '+meta.uploadedBy:'');
    expiration.textContent=meta.active?
      'View-only comparison available until '+until+'. It will expire automatically after 24 hours.':
      'Comparison expired after 24 hours. Upload a new archive to compare again; this upload record remains visible.';
    view.disabled=!meta.active;
    if(!meta.active)$('archiveCompareResult').classList.add('hidden');
  }
  async function refreshArchiveComparison(){
    try{
      const meta=await api('/api/backups/comparison');
      archiveComparisonStatus(meta);
    }catch(err){archiveComparisonStatus(null);$('archiveCompareError').textContent='Could not check comparison status: '+err.message;$('archiveCompareError').classList.remove('hidden');}
  }
  function archiveComparisonError(message){
    $('archiveCompareError').textContent=message||'';
    $('archiveCompareError').classList.toggle('hidden',!message);
  }
  $('archiveCompareUpload').addEventListener('click',async()=>{
    const file=$('archiveCompareFile').files?.[0];
    archiveComparisonError('');
    if(!file){archiveComparisonError('Select the JSON file downloaded from Data Archive.');return;}
    if(!/\.json$/i.test(file.name)){archiveComparisonError('Only Don Mac JSON data archives can be compared.');return;}
    if(file.size>60*1024*1024){archiveComparisonError('Archive is larger than the 60 MB upload limit.');return;}
    if(!file.size){archiveComparisonError('The selected archive is empty.');return;}
    const button=$('archiveCompareUpload');
    button.disabled=true;button.setAttribute('aria-busy','true');
    const controller=new AbortController(),abortAfter=setTimeout(()=>controller.abort(),120000);
    try{
      const response=await fetch('/api/backups/comparison',{
        method:'POST',credentials:'same-origin',
        headers:{'Content-Type':'application/json','X-Archive-Filename':file.name},
        body:file,signal:controller.signal
      });
      const result=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(result.error||'Archive upload failed ('+response.status+').');
      toast('Read-only comparison ready for 24 hours. No live database records were changed.');
      $('archiveCompareFile').value='';
      $('archiveCompareResult').classList.add('hidden');
      archiveComparisonStatus(result);
    }catch(err){archiveComparisonError(err.name==='AbortError'?
      'Upload timed out. Try a smaller archive.':(err.message||'Unable to process archive.'));}
    finally{clearTimeout(abortAfter);button.disabled=false;button.removeAttribute('aria-busy');}
  });
  $('archiveCompareView').addEventListener('click',async()=>{
    archiveComparisonError('');
    const button=$('archiveCompareView');button.disabled=true;
    try{
      const result=await api('/api/backups/comparison?details=1');
      archiveComparisonStatus(result);
      $('archiveCompareRows').innerHTML=(result.tables||[]).map(row=>
        '<tr><td><strong>'+esc(row.table)+'</strong></td>'+
        '<td class="num">'+Number(row.archiveRows||0)+'</td>'+
        '<td class="num">'+Number(row.liveRows||0)+'</td>'+
        '<td class="num">'+Number(row.onlyArchive||0)+'</td>'+
        '<td class="num">'+Number(row.onlyLive||0)+'</td>'+
        '<td class="num">'+Number(row.changed||0)+'</td>'+
        '<td class="num">'+Number(row.identical||0)+'</td></tr>'
      ).join('')||'<tr><td colspan="7">No comparable tables in this archive.</td></tr>';
      $('archiveCompareResult').classList.remove('hidden');
    }catch(err){archiveComparisonError(err.message||'Comparison is unavailable.');await refreshArchiveComparison();}
    finally{button.disabled=false;await refreshArchiveComparison();}
  });
  $('archiveCompareClose').addEventListener('click',()=>$('archiveCompareResult').classList.add('hidden'));
  // A user who leaves this tab open must not retain access after expiration.
  setInterval(()=>{
    if($('admin-backups')?.classList.contains('active')&&$('view-catalog')?.classList.contains('active'))
      refreshArchiveComparison();
  },60000);

  async function loadBackups(){
    try{
      const [d,preview]=await Promise.all([
        api('/api/backups'),api('/api/backups/retention-preview')
      ]);
      $('backupNote').textContent=d.supported
        ?'SQLite native backup and restore are available. Download copies to a separate safe location.'
        :'This installation runs PostgreSQL. Use Download Data Archive to save a read-only copy of business data. Native full-database backups and one-click restore require separate PostgreSQL backup infrastructure.';
      $('createBackup').disabled=!d.supported;
      $('createBackup').title=d.supported?'Create a native SQLite backup':
        'Native backups require PostgreSQL managed backup infrastructure.';
      $('backupBody').innerHTML=d.items.map(x=>`<tr><td><b>${esc(x.name)}</b></td><td>${esc(formatDateTime(x.createdAt))}</td><td class="num">${(x.size/1024).toFixed(1)} KB</td><td><a class="table-btn" href="/api/backups/${encodeURIComponent(x.name)}">Download</a> <button class="danger-link" data-restore="${esc(x.name)}">Restore</button></td></tr>`).join('')||
        '<tr><td colspan="4" class="muted">No native server backups to list. Business data can be exported using Download Data Archive.</td></tr>';
      $('backupBody').querySelectorAll('[data-restore]').forEach(b=>
        b.onclick=()=>restoreBackup(b.dataset.restore));
      $('retentionDemoEnabled').checked=preview.demoEnabled;
      $('retentionFrequency').value=preview.frequency;
      $('retentionFrequency').disabled=!preview.demoEnabled;
      $('retentionBackupStatus').textContent=preview.note;
      await refreshArchiveComparison();
    }catch(err){toast(err.message);}
  }
  $('downloadDataArchive').addEventListener('click',()=>{
    const link=document.createElement('a');
    link.href='/api/backups/data-export';
    link.download='DonMac_Data_Archive.json';
    document.body.appendChild(link);link.click();link.remove();
    toast('Requesting business data archive. Keep the downloaded file in a secure location.');
  });
  $('retentionDemoEnabled').addEventListener('change',e=>{
    $('retentionFrequency').disabled=!e.target.checked;
  });
  $('saveRetentionPreference').onclick=()=>withActionLock('save-retention',async()=>{
    const button=$('saveRetentionPreference');
    button.disabled=true;
    try{
      const p=await api('/api/backups/retention-preview',{
        method:'PUT',
        body:{demoEnabled:$('retentionDemoEnabled').checked,
          frequency:$('retentionFrequency').value}
      });
      $('retentionBackupStatus').textContent=p.note;
      toast('Development retention preference saved. No subscription or automated backup was activated.');
    }catch(err){toast(err.message);}
    finally{button.disabled=false;}
  });

  $('createBackup').onclick=()=>withActionLock('create-backup',async()=>{try{const d=await api('/api/backups',{method:'POST',timeoutMs:60000});toast(`Backup created: ${d.name}`);await loadBackups();}catch(err){toast(err.message);}});
  async function restoreBackup(name){return withActionLock(`restore-backup:${name}`,async()=>{if(!confirm(`Restore ${name}? This will replace the current SQLite database.`))return;if(!confirm('Final warning: a pre-restore backup will be created automatically. Continue with restore?'))return;try{await api(`/api/backups/${encodeURIComponent(name)}/restore`,{method:'POST',timeoutMs:60000});alert('Database restored. Please sign in again.');location.reload();}catch(err){toast(err.message);}});}

  function branchOptions(list,selected,includeAll=false){
   return (includeAll?'<option value="all">All branches</option>':'')+list.map(b=>`<option value="${b.id}" ${String(b.id)===String(selected)?'selected':''}>${esc(b.name)}${b.active?'':' (inactive)'}</option>`).join('');
  }

  async function loadBranches(){
   const d=await api('/api/branches');
   state.branches=d.branches||[];
   const active=state.branches.filter(x=>x.active);
   if(state.user.role==='Admin'){
     const selectedBranch=Number($('dashboardBranch').value||0);
     if(active.some(x=>x.id===selectedBranch))state.posBranchId=selectedBranch;
     if(!active.some(x=>x.id===state.posBranchId))state.posBranchId=active[0]?.id||null;
     $('posBranch').innerHTML=branchOptions(active,state.posBranchId);
     $('posBranch').classList.remove('hidden');$('posBranchReadOnly').classList.add('hidden');
     const dashboardSelected=$('dashboardBranch').value||'all',reportSelected=$('reportBranch').value||'all';
     $('dashboardBranch').innerHTML=branchOptions(state.branches,dashboardSelected,true);
     $('dashboardBranch').value=state.branches.some(x=>String(x.id)===dashboardSelected)?dashboardSelected:'all';
     $('reportBranch').innerHTML=branchOptions(state.branches,reportSelected,true);
     $('reportBranch').value=state.branches.some(x=>String(x.id)===reportSelected)?reportSelected:'all';
     $('dashboardBranchWrap').classList.remove('hidden');$('reportBranch').classList.remove('hidden');
   } else {
     state.posBranchId=state.user.branchId;
     $('posBranch').classList.add('hidden');$('posBranchReadOnly').classList.remove('hidden');
     $('posBranchReadOnly').textContent=state.branches.find(x=>x.id===state.user.branchId)?.name||'No branch assigned';
     $('dashboardBranchWrap').classList.add('hidden');$('reportBranch').classList.add('hidden');
   }
   const previous=$('newUserBranch').value;
   $('newUserBranch').innerHTML=branchOptions(active,previous);
   if(state.user.role==='Admin'){renderBranches();window.donmacBranchNetwork?.update(state.branches);}
  }


  function showUsersPage(page){
    const cashier=page==='cashiers';
    $('usersBranchesPage').hidden=cashier;
    $('usersCashiersPage').hidden=!cashier;
    for(const [id,chosen] of [['usersTabBranches',!cashier],['usersTabCashiers',cashier]]){
      const button=$(id);button.classList.toggle('active',chosen);
      button.setAttribute('aria-selected',String(chosen));
      button.tabIndex=chosen?0:-1;
    }
  }
  for(const button of document.querySelectorAll('[data-users-page]')){
    button.addEventListener('click',()=>showUsersPage(button.dataset.usersPage));
    button.addEventListener('keydown',e=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
      e.preventDefault();const next=e.key==='Home'?'branches':e.key==='End'?'cashiers':
        button.dataset.usersPage==='cashiers'?'branches':'cashiers';
      showUsersPage(next);$(next==='branches'?'usersTabBranches':'usersTabCashiers').focus();
    });
  }
  showUsersPage('branches');
  let branchPage=1, cashiersPage=1;
  const managementPageSize=10;
  function renderManagementPager(navId,page,total,onPage){
    const nav=$(navId);if(!nav)return;
    const pages=Math.max(1,Math.ceil(total/managementPageSize));
    const current=Math.min(Math.max(1,page),pages);
    nav.innerHTML='<span>Page '+current+' of '+pages+' · '+total+' total</span>'+
      '<button type="button" data-page-nav="prev" '+(current===1?'disabled':'')+'>Previous</button>'+
      '<button type="button" data-page-nav="next" '+(current===pages?'disabled':'')+'>Next</button>';
    nav.querySelectorAll('[data-page-nav]').forEach(btn=>btn.onclick=()=>{
      onPage(Math.max(1,Math.min(pages,current+(btn.dataset.pageNav==='next'?1:-1))));
    });
  }
  function renderBranches(){
    const branches=state.branches||[];
    const totalPages=Math.max(1,Math.ceil(branches.length/managementPageSize));
    branchPage=Math.min(Math.max(1,branchPage),totalPages);
    const page=branches.slice((branchPage-1)*managementPageSize,branchPage*managementPageSize);
    $('branchesBody').innerHTML=page.map(b=>`<tr><td><b>${esc(b.name)}</b><div class="tiny muted">${esc([b.address,b.city,b.province].filter(Boolean).join(', '))}</div></td><td>${num(b.usersCount,0)} accounts<div class="tiny muted">${num(b.salesCount,0)} sales</div></td><td class="${b.active?'stock-ok':'stock-low'}">${b.active?'ACTIVE':'INACTIVE'}</td><td><button class="table-btn" data-edit-branch="${b.id}">Edit</button><button class="danger-link" data-delete-branch="${b.id}">Delete</button></td></tr>`).join('')||'<tr><td colspan="4">No branches.</td></tr>';
    $('branchesBody').querySelectorAll('[data-edit-branch]').forEach(b=>b.onclick=()=>editBranch(Number(b.dataset.editBranch)));
    $('branchesBody').querySelectorAll('[data-delete-branch]').forEach(b=>b.onclick=()=>deleteBranch(Number(b.dataset.deleteBranch)));
    renderManagementPager('branchesPagination',branchPage,branches.length,next=>{branchPage=next;renderBranches();});
  }

  function clearBranchForm(){
   $('branchEditId').value='';$('branchName').value='';$('branchAddress').value='';for(const id of ['branchCity','branchProvince','branchPostalCode','branchPhone','branchDescription'])$(id).value='';$('branchCountry').value='Philippines';$('branchActive').checked=true;$('branchFormTitle').textContent='New Branch';window.donmacBranchGeo?.reset();
  }

  function editBranch(id){
   const b=state.branches.find(x=>x.id===id);if(!b)return;
   $('branchEditId').value=id;$('branchName').value=b.name;$('branchAddress').value=b.address;for(const [id,key] of [['branchCity','city'],['branchProvince','province'],['branchPostalCode','postalCode'],['branchPhone','phone'],['branchDescription','description']])$(id).value=b[key]||'';$('branchCountry').value=b.country||'Philippines';$('branchActive').checked=!!b.active;$('branchFormTitle').textContent='Edit Branch';window.donmacBranchGeo?.setCoordinates(b.latitude,b.longitude);$('branchName').focus();
  }

  async function deleteBranch(id){
   return withActionLock('delete-branch:'+id,async()=>{
     const b=state.branches.find(x=>x.id===id);if(!b||!confirm('Delete '+b.name+'? If this branch has users or sales, disable it instead.'))return;
     try{await api('/api/branches/'+id,{method:'DELETE'});toast('Branch deleted.');clearBranchForm();await loadBranches();await loadUsers();}catch(err){toast(err.message);}
   });
  }

  function toggleUserBranch(){
   const show=$('newRole').value==='User';$('newUserBranchWrap').classList.toggle('hidden',!show);$('newUserBranch').required=show;
  }

  async function deleteUser(id){
   return withActionLock('delete-user:'+id,async()=>{
     const u=state.userList.find(x=>x.id===id);if(!u||!confirm('Delete '+u.username+'? Cashiers with transaction history must be deactivated instead.'))return;
     try{await api('/api/users/'+id,{method:'DELETE'});toast('Cashier deleted.');clearUserForm();await loadUsers();}catch(err){toast(err.message);}
   });
  }

  function initBranchControls(){
   $('posBranch').onchange=()=>{state.posBranchId=Number($('posBranch').value||0);};
   $('newRole').onchange=toggleUserBranch;$('branchFormClear').onclick=clearBranchForm;
   $('branchForm').addEventListener('submit',async e=>{
     e.preventDefault();await withFormLock(e.currentTarget,async()=>{
       const id=Number($('branchEditId').value||0),body={name:$('branchName').value.trim(),address:$('branchAddress').value.trim(),city:$('branchCity').value.trim(),province:$('branchProvince').value.trim(),postalCode:$('branchPostalCode').value.trim(),country:$('branchCountry').value,phone:$('branchPhone').value.trim(),description:$('branchDescription').value.trim(),active:$('branchActive').checked,...(window.donmacBranchGeo?.getCoordinates()||{latitude:null,longitude:null})};
       if(window.donmacBranchGeo?.getCoordinates().invalid){toast('Enter valid latitude and longitude, or leave both blank.');return;}
       try{await api('/api/branches'+(id?'/'+id:''),{method:id?'PUT':'POST',body});toast(id?'Branch updated.':'Branch created.');clearBranchForm();await loadBranches();await loadUsers();}catch(err){toast(err.message);}
     });
   });
   const today=manilaToday();$('trendTo').value=today;$('trendFrom').value=new Date(Date.parse(today+'T00:00:00Z')-9*86400000).toISOString().slice(0,10);
   const toggleRange=()=>{const custom=$('trendView').value==='custom';$('trendFromWrap').classList.toggle('hidden',!custom);$('trendToWrap').classList.toggle('hidden',!custom);};
   $('trendView').onchange=()=>{toggleRange();if($('trendView').value!=='custom')loadDashboard();};
   $('applyTrend').onclick=loadDashboard;$('dashboardBranch').onchange=()=>{
      const selected=Number($('dashboardBranch').value||0);
      if(state.user?.role==='Admin'&&state.branches.some(x=>x.id===selected&&x.active)){
        state.posBranchId=selected;
        $('posBranch').value=String(selected);
        refreshPosDailyCount();
      }
      loadDashboard();
    };
   toggleRange();
  }


  function renderUsers(){
    const rows=state.userList||[];
    const pages=Math.max(1,Math.ceil(rows.length/managementPageSize));
    cashiersPage=Math.min(Math.max(1,cashiersPage),pages);
    const page=rows.slice((cashiersPage-1)*managementPageSize,cashiersPage*managementPageSize);
    $('usersBody').innerHTML=page.map(u=>`<tr><td><b>${esc(u.fullName||u.username)}</b><div class="tiny muted">${esc(u.username)}</div></td><td>${esc(u.roleLabel||u.role)}</td><td>${esc(u.branchName||'All branches')}</td><td class="${u.active?'stock-ok':'stock-low'}">${u.active?'ACTIVE':'INACTIVE'}</td><td>${u.hasWebPassword?'SET':'RESET REQUIRED'}</td><td><button class="table-btn" data-edit-user="${u.id}">Edit</button>${u.isOwner?'':`<button class="danger-link" data-delete-user="${u.id}">Delete</button>`}</td></tr>`).join('')||'<tr><td colspan="6">No staff accounts found.</td></tr>';
    $('usersBody').querySelectorAll('[data-edit-user]').forEach(b=>b.onclick=()=>editUser(Number(b.dataset.editUser),rows));
    $('usersBody').querySelectorAll('[data-delete-user]').forEach(b=>b.onclick=()=>deleteUser(Number(b.dataset.deleteUser)));
    renderManagementPager('usersPagination',cashiersPage,rows.length,next=>{cashiersPage=next;renderUsers();});
  }
  async function loadUsers(){
    if(state.user?.role!=='Admin')return;
    try{await loadBranches();const d=await api('/api/users');state.userList=d.users||[];renderUsers();}catch(err){toast(err.message);}
  }
  let cashierPhotoProcessing=false;
  function cashierPhotoNotice(message){
    const el=$('cashierPhotoError');el.textContent=message||'';
    el.classList.toggle('hidden',!message);
  }
  function showCashierPhoto(data){
    const avatar=$('cashierPhotoAvatar');
    const image=typeof data==='string'&&/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(data);
    if(image){
      avatar.innerHTML='<img src="'+esc(data)+'" alt="Cashier profile preview" decoding="async"/>';
      $('cashierPhotoRemove').disabled=false;
    }else{
      avatar.innerHTML='<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>';
      $('cashierPhotoRemove').disabled=true;
    }
  }
  async function decodeCashierPhoto(file){
    if(file.size>1024*1024)throw new Error('Photo is larger than 1 MB. Select an image under 1 MB.');
    if(file.size<32||!['image/jpeg','image/png','image/webp'].includes(file.type))
      throw new Error('Invalid photo. Use JPG, PNG, or WebP under 1 MB.');
    const header=new Uint8Array(await file.slice(0,16).arrayBuffer());
    const valid=file.type==='image/jpeg'&&header[0]===255&&header[1]===216&&header[2]===255||
      file.type==='image/png'&&[137,80,78,71,13,10,26,10].every((x,i)=>header[i]===x)||
      file.type==='image/webp'&&String.fromCharCode(...header.slice(0,4))==='RIFF'&&String.fromCharCode(...header.slice(8,12))==='WEBP';
    if(!valid)throw new Error('Photo could not be decoded. File type and contents do not match.');
    const url=URL.createObjectURL(file);
    try{
      const img=new Image();img.src=url;
      try{await img.decode();}catch(_){throw new Error('Photo could not be decoded. Select a different JPG, PNG, or WebP image.');}
      if(!img.naturalWidth||!img.naturalHeight||img.naturalWidth>12000||img.naturalHeight>12000)
        throw new Error('Photo dimensions are invalid or too large.');
      const max=200,ratio=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));
      const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*ratio));
      canvas.height=Math.max(1,Math.round(img.naturalHeight*ratio));
      const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Unable to process this photo.');
      ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.drawImage(img,0,0,canvas.width,canvas.height);
      const data=canvas.toDataURL('image/jpeg',.82);
      if(!/^data:image\/jpeg;base64,/.test(data)||data.length>165000)
        throw new Error('Photo processing failed. Try a smaller or simpler picture.');
      return data;
    }finally{URL.revokeObjectURL(url);}
  }
  $('cashierPhotoFile').addEventListener('change',async e=>{
    const file=e.target.files?.[0];if(!file)return;
    cashierPhotoNotice('');
    cashierPhotoProcessing=true;
    try{
      const encoded=await decodeCashierPhoto(file);
      $('cashierPhotoData').value=encoded;showCashierPhoto(encoded);
    }catch(err){cashierPhotoNotice(err.message||'Photo could not be decoded.');}
    finally{cashierPhotoProcessing=false;$('cashierPhotoFile').value='';}
  });
  $('cashierPhotoRemove').addEventListener('click',()=>{
    $('cashierPhotoData').value='';showCashierPhoto(null);cashierPhotoNotice('');
  });
  function clearUserForm(){
    $('userEditId').value='';$('cashierPhotoData').value='';showCashierPhoto(null);cashierPhotoNotice('');
    for(const id of ['newUsername','newFullName','newUserEmail','newUserPhone','newPassword'])$(id).value='';
    $('newUsername').readOnly=false;$('newPassword').required=true;$('newPassword').type='password';
    $('toggleCashierPassword').setAttribute('aria-label','Show cashier password');
    $('newRole').disabled=false;$('newRole').options[1].text='Co-Owner';$('newRole').value='User';
    $('newUserActive').disabled=false;$('newUserActive').checked=true;toggleUserBranch();
  }
  function editUser(id,users){
    const u=users.find(x=>x.id===id);if(!u)return;
    $('userEditId').value=id;$('newUsername').value=u.username;$('newUsername').readOnly=true;
    $('cashierPhotoData').value=u.photoData||'';showCashierPhoto(u.photoData);cashierPhotoNotice('');
    $('newFullName').value=u.fullName||'';$('newUserEmail').value=u.email||'';$('newUserPhone').value=u.phone||'';
    $('newPassword').value='';$('newPassword').required=false;$('newPassword').type='password';
    $('newRole').value=u.role;$('newRole').disabled=!!u.isOwner;
    $('newRole').options[1].text=u.isOwner?'Owner/Admin (fixed)':'Co-Owner/Admin';
    $('newUserBranch').value=String(u.branchId||'');
    $('newUserActive').checked=!!u.active;$('newUserActive').disabled=!!u.isOwner;
    toggleUserBranch();
  }
  $('toggleCashierPassword').onclick=()=>{
    const input=$('newPassword');
    input.type=input.type==='password'?'text':'password';
    $('toggleCashierPassword').setAttribute('aria-label',input.type==='text'?'Hide cashier password':'Show cashier password');
    $('toggleCashierPassword').setAttribute('title',input.type==='text'?'Hide password':'Show password');
  };
  $('userFormClear').onclick=clearUserForm;
  $('userForm').addEventListener('submit',async e=>{
    e.preventDefault();const form=e.currentTarget;
    if(cashierPhotoProcessing){cashierPhotoNotice('Photo is still processing. Retry Save when ready.');return;}
    await withFormLock(form,async()=>{
      const id=Number($('userEditId').value||0);
      const body={username:$('newUsername').value.trim(),password:$('newPassword').value,
        fullName:$('newFullName').value.trim(),email:$('newUserEmail').value.trim(),
        photoData:$('cashierPhotoData').value||null,
        phone:$('newUserPhone').value.trim(),role:$('newRole').value,
        branchId:$('newRole').value==='User'?Number($('newUserBranch').value):null,
        active:$('newUserActive').checked};
      try{
        if(id)await api(`/api/users/${id}`,{method:'PUT',body});
        else await api('/api/users',{method:'POST',body});
        toast(id?'Cashier updated.':'Cashier created.');
        if(id===Number(state.user?.id)){state.user=(await api('/api/auth/me')).user;applyTopbarPhoto();}
        window.donmacChat?.refreshContacts?.();clearUserForm();await loadUsers();
      }catch(err){toast(err.message);}
    });
  });

  function formatDateTime(v){if(!v)return'';const s=String(v);if(!/[zZ]|[+-]\d\d:\d\d$/.test(s))return s.replace('T',' ');const d=new Date(s);return new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}).format(d);}
  function formatDateTimeDetailed(v){if(!v)return'';const s=String(v);if(!/[zZ]|[+-]\d\d:\d\d$/.test(s))return s.replace('T',' ');const d=new Date(s);return new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'medium'}).format(d);}
  async function loadLogs(){try{const d=await api('/api/system-logs?limit=500');$('logsList').innerHTML=d.logs.map(l=>`<div class="log-row"><div class="log-meta"><b>${esc(l.status||'LOG')}</b><span>${esc(l.actor||'')}</span><span>${esc(formatDateTime(l.createdAt))}</span>${l.remark?`<span>· ${esc(l.remark)}</span>`:''}</div><pre>${esc(l.activity)}</pre></div>`).join('')||'<div class="empty-state">No system logs.</div>';}catch(err){toast(err.message);}}
  $('refreshLogs').onclick=loadLogs;

  window.addEventListener('resize',()=>{if(state.dashboard)renderDashboard();});
  setInterval(()=>{$('clock').textContent=new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date());updatePosDateTime();},1000);
  initBranchControls();
  boot().catch(err=>{console.error(err);toast(err.message||'Unable to start the POS.');showAuth(false);$('authHint').textContent='Cannot reach the POS server. Keep START COFFEE POS open, then refresh this page.';});
  window.DonMacCatalogBatchBridge={
    source(kind){return kind==='recipe'?state.adminIngredients.filter(x=>x.active).map(x=>({id:x.id,name:x.name,unit:x.uom})):
      state.adminProducts.filter(x=>x.active).map(x=>({id:x.id,name:x.name,unit:x.category}));},
    selected(kind){return kind==='recipe'?state.recipeRows.map(x=>x.ingredientId):state.compositionRows.map(x=>x.productId);},
    add(kind,ids){
      if(kind==='recipe'){
        for(const id of ids){const x=state.adminIngredients.find(x=>x.active&&x.id===Number(id));
          if(x&&!state.recipeRows.some(r=>r.ingredientId===x.id))state.recipeRows.push({ingredientId:x.id,code:x.code,name:x.name,uom:x.uom,quantity:1,cost:null});}
        renderRecipe();
      }else{
        for(const id of ids){const x=state.adminProducts.find(x=>x.active&&x.id===Number(id));
          if(x&&!state.compositionRows.some(r=>r.productId===x.id))state.compositionRows.push({productId:x.id,name:x.name,qty:1});}
        renderComposition();
      }
    }
  };

})();
