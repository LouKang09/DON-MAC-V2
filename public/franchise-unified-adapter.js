'use strict';
// Unified Main POS compatibility layer for new OTP-verified franchises.
// The public/index.html shell is shared with established franchise accounts.
// Every request made through this adapter is redirected ONLY to authenticated,
// workspace + branch checked /api/live routes. Unmapped operations FAIL CLOSED.
// Never forward a new franchise request to /api/catalog, /api/sales, or any
// legacy globally shared API.
(()=>{
 const fail=(message,status=403)=>Object.assign(new Error(message),{status,code:'ISOLATED_FEATURE_NOT_READY'});
 const branchId=state=>Number(state.posBranchId||state.user?.branchId||state.liveBranchId||0);
 const bodyOf=options=>{
  if(!options?.body)return{};
  if(typeof options.body==='string'){try{return JSON.parse(options.body)}catch(_){throw fail('Invalid request body.',400)}}
  return options.body;
 };
 async function live(path,method='GET',body){
  if(!/^\/api\/live\/[a-z0-9/?=&._%-]+$/i.test(path))throw fail('Invalid isolated POS request path.',400);
  const options={method,credentials:'same-origin',cache:'no-store',headers:{}};
  if(body!==undefined){options.headers['Content-Type']='application/json';options.body=JSON.stringify(body)}
  let response;
  try{response=await fetch(path,options)}
  catch(_){throw fail('Cannot reach the isolated POS server. Try again.',503)}
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(new Error(data.error||'Isolated POS operation failed.'),{status:response.status,code:data.code,details:data.details});
  return data;
 }
 function scopedBranch(state,input){
  const id=Number(input||branchId(state));
  if(!Number.isSafeInteger(id)||id<1)throw fail('Choose an active branch first.',400);
  return id;
 }
 function qs(branch){return '?branchId='+encodeURIComponent(branch)}
 async function status(){return live('/api/live/status')}
 function activeBranch(state,remote){
  const available=remote.branches||[];
  const preferred=scopedBranch(state,remote.branchId);
  return available.some(b=>Number(b.id)===preferred)?preferred:Number(remote.branchId);
 }
 function subscription(x){
  const pricing=x.entitlements||{};
  const extra=pricing.extraBranches??0,rate=pricing.extraBranchRate??(x.plan==='BUSINESS'?899:799);
  return{plan:x.plan||'PRO',status:x.subscriptionStatus||'NOT_CONFIGURED',
   startedAt:null,renewAt:null,daysRemaining:null,history:[],pendingPlan:null,
   branchPricing:{plan:x.plan||'PRO',extraBranches:Number(extra),
    totalBranches:Number(pricing.totalBranches??(x.branches||[]).length),
    activeBranches:Number(pricing.activeBranches??(x.branches||[]).length),
    mayAdd:pricing.mayAdd===true,maxBranches:Number(pricing.maxBranches||3),
    extraBranchRate:Number(rate),nextRenewalAmount:Number(pricing.nextRenewalAmount||0),
    branches:(x.branches||[]).map(b=>({...b,active:true}))}};
 }
 const mapCashier=x=>({id:Number(x.id),username:x.username,fullName:x.fullName||x.username,
  role:'User',roleLabel:'Cashier',branchId:Number(x.branchId),active:x.active!==false,
  hasWebPassword:true,accessPermissions:x.permissions||[],email:x.email||'',emailVerified:x.emailVerified===true,phone:x.phone||'',
  photoData:x.photoData||null,branchName:x.branchName||'',isOwner:false});
 async function adminCatalog(state,kind){
  const x=await live('/api/live/manage'+qs(scopedBranch(state,kind==='promos'?state.promoBranchId:null)));
  const key=({products:'products',ingredients:'ingredients',promos:'promos',packages:'packages'})[kind];
  return{[key]:x[key]||[]};
 }
 async function request(input,options={},state={}){
  const url=new URL(String(input),location.origin),p=url.pathname,method=String(options.method||'GET').toUpperCase();
  const data=bodyOf(options),selected=()=>scopedBranch(state,url.searchParams.get('branchId'));
  // Reading auth/session status still uses the established identity endpoint; the
  // caller excludes these routes before invoking this module.
  if(p==='/api/catalog'&&method==='GET')return live('/api/live/catalog'+qs(selected()));
  if(p==='/api/quote'&&method==='POST')
   return live('/api/live/quote','POST',{...data,branchId:scopedBranch(state)});
  if(p==='/api/sales'&&method==='POST')
   return live('/api/live/checkout','POST',{...data,branchId:scopedBranch(state)});
  if(p==='/api/pos/today-count'&&method==='GET'){
   const d=await live('/api/live/dashboard?view=hourly&branchId='+encodeURIComponent(selected()));
   return{count:Number(d.rangeTransactions||0)};
  }
  if(p==='/api/dashboard/shift-deposits'&&(method==='GET'||method==='POST')){
   const target='/api/live/dashboard/shift-deposits';
   const params=new URLSearchParams(url.searchParams);
   if(method==='GET'){
    if(params.get('branchId')&&params.get('branchId')!=='all')
     params.set('branchId',String(scopedBranch(state,params.get('branchId'))));
    return live(target+(params.size?'?'+params.toString():''),'GET');
   }
   return live(target,'POST',{amount:data.amount});
  }
  if(p==='/api/dashboard/chart-preferences'&&(method==='GET'||method==='PUT'))
   return live('/api/live/dashboard/chart-preferences',method,method==='PUT'?data:undefined);
  if(p==='/api/dashboard'&&method==='GET'){
   const query=new URLSearchParams(url.searchParams);
   if(query.get('branchId'))query.set('branchId',String(scopedBranch(state,query.get('branchId'))));
   return live('/api/live/dashboard?'+query);
  }
  if(p==='/api/branches'&&method==='GET'){
   const s=await status();
   return{branches:(s.branches||[]).map(b=>({...b,active:b.active!==false,usersCount:Number(b.usersCount||0),salesCount:Number(b.salesCount||0)})),
    branchPricing:subscription(s).branchPricing};
  }
  if(p==='/api/branches'&&method==='POST')
   return live('/api/live/branches','POST',{name:data.name,address:data.address||''});
  let branchEdit=p.match(/^\/api\/branches\/(\d+)$/);
  if(branchEdit&&method==='PUT')
   return live('/api/live/branches/'+Number(branchEdit[1]),'PUT',data);
  if(branchEdit&&method==='DELETE')
   return live('/api/live/branches/'+Number(branchEdit[1]),'DELETE');
  if(p==='/api/account/subscription'&&method==='GET')
   return live('/api/live/account/subscription');
  // Owners submit plan changes; only Admin Control can approve them. Do not
  // force live franchises through the legacy/global catalog routes.
  if(p==='/api/account/subscription/update-plan'&&method==='POST')
   return live('/api/live/account/subscription/request-plan','POST',data);
  if(p==='/api/inventory'&&method==='GET')
   return live('/api/live/inventory'+qs(selected()));
  if(p==='/api/inventory/movements'&&method==='GET')
   return live('/api/live/inventory/movements'+qs(selected())+'&limit='+encodeURIComponent(url.searchParams.get('limit')||300));
  if(p==='/api/inventory/incoming'&&method==='GET')
   return live('/api/live/inventory/incoming'+qs(selected()));
  const incomingMatch=p.match(/^\/api\/inventory\/incoming\/(\d+)\/(accept|reject|receive)$/);
  if(incomingMatch&&method==='POST')
   return live('/api/live/inventory/incoming/'+Number(incomingMatch[1])+'/'+incomingMatch[2],'POST',data);
  if(p==='/api/inventory/transfer-branches'&&method==='GET'){
   const source=scopedBranch(state,url.searchParams.get('sourceBranchId'));
   return live('/api/live/inventory/transfer-branches?sourceBranchId='+encodeURIComponent(source));
  }
  if(p==='/api/inventory/transfer'&&method==='POST')
   return live('/api/live/inventory/transfer','POST',data);
  if(p==='/api/inventory/replenish/direct'&&method==='POST')
   return live('/api/live/stock','POST',data);
  if(p==='/api/users'&&method==='GET'){
   const r=await live('/api/live/cashiers');
   return{users:(r.cashiers||[]).map(mapCashier)};
  }
  if(p==='/api/users'&&method==='POST'){
   if(data.role!=='User')throw fail('Co-Owner provisioning must be enabled in the isolated staff service before it can be used.',403);
   // Contact fields and compressed profile photos are stored by the
   // workspace-scoped employee endpoint, not by the legacy global user API.
   // The scoped staff endpoint now stores the employee and grants atomically.
   // Do not make a second request that could leave a partially saved account.
   return live('/api/live/cashiers','POST',data);
  }
  let cashierEdit=p.match(/^\/api\/users\/(\d+)$/);
  if(cashierEdit&&method==='PUT'){
   if(data.role!=='User')throw fail('The isolated account currently supports cashier editing only.',403);
   // Update fields and permissions in one server-side transaction.
   return live('/api/live/cashiers/'+Number(cashierEdit[1]),'PUT',data);
  }
  if(cashierEdit&&method==='DELETE')
   return live('/api/live/cashiers/'+Number(cashierEdit[1]),'DELETE');
  // Built-in and custom POS category editor, strictly isolated by branch.
  if(p==='/api/admin/pos-categories'&&method==='GET')
   return live('/api/live/categories'+qs(selected()));
  if(p==='/api/admin/pos-categories'&&method==='POST')
   return live('/api/live/categories','POST',{...data,branchId:scopedBranch(state)});
  if(p.startsWith('/api/admin/pos-categories/')){
   const key=p.slice('/api/admin/pos-categories/'.length);
   if(key&&!key.includes('/')){
    const target='/api/live/categories/'+key;
    if(method==='PUT')return live(target,'PUT',{...data,branchId:scopedBranch(state)});
    if(method==='DELETE')return live(target+qs(scopedBranch(state)),'DELETE');
   }
  }
  if(p==='/api/admin/products'&&method==='GET')return adminCatalog(state,'products');
  if(p==='/api/admin/ingredients'&&method==='GET')return adminCatalog(state,'ingredients');
  if(p==='/api/admin/promos'&&method==='GET')return adminCatalog(state,'promos');
  if(p==='/api/admin/packages'&&method==='GET')return adminCatalog(state,'packages');
  if(p==='/api/admin/products'&&method==='POST')
   return live('/api/live/products','POST',{...data,branchId:scopedBranch(state)});
  if(p==='/api/admin/ingredients'&&method==='POST')
   return live('/api/live/ingredients','POST',{...data,branchId:scopedBranch(state)});
  let match=p.match(/^\/api\/admin\/products\/(\d+)$/);
  if(match&&method==='PUT')
   return live('/api/live/products/'+Number(match[1]),'PUT',{...data,branchId:scopedBranch(state)});
  match=p.match(/^\/api\/admin\/ingredients\/(\d+)$/);
  if(match&&method==='PUT')
   return live('/api/live/ingredients/'+Number(match[1]),'PUT',{...data,branchId:scopedBranch(state)});
  match=p.match(/^\/api\/admin\/products\/(\d+)\/recipe$/);
  if(match&&method==='GET')return live('/api/live/recipes/'+Number(match[1])+qs(selected()));
  if(match&&method==='PUT')
   return live('/api/live/recipes/'+Number(match[1]),'PUT',{...data,branchId:scopedBranch(state)});
  // Original Catalog editor: archives, price promotions and package composition.
  let edit=p.match(/^\/api\/admin\/(products|ingredients|promos|packages)\/(\d+)$/);
  if(edit&&method==='DELETE'){
   const kind=edit[1],id=Number(edit[2]);
   return live('/api/live/'+kind+'/'+id+qs(scopedBranch(state)),'DELETE');
  }
  if(p==='/api/admin/promos'&&method==='POST'&&data.targetBranches==='all')
   return live('/api/live/promos/all-branches','POST',data);
  if(p==='/api/admin/promos'&&method==='POST')
   return live('/api/live/promos','POST',{...data,branchId:scopedBranch(state,data.branchId||state.promoBranchId)});
  const promoCopy=p.match(/^\/api\/admin\/promos\/(\d+)\/copy$/);
  if(promoCopy&&method==='POST')
   return live('/api/live/promos/'+Number(promoCopy[1])+'/copy','POST',{
    sourceBranchId:scopedBranch(state,data.sourceBranchId||state.promoBranchId),
    targetBranchId:Number(data.targetBranchId)
   });
  if(p==='/api/admin/packages'&&method==='POST')
   return live('/api/live/packages','POST',{...data,branchId:scopedBranch(state)});
  edit=p.match(/^\/api\/admin\/(promos|packages)\/(\d+)$/);
  if(edit&&method==='PUT')
   return live('/api/live/'+edit[1]+'/'+Number(edit[2]),'PUT',
    {...data,branchId:scopedBranch(state,edit[1]==='promos'?(data.branchId||state.promoBranchId):null)});
  edit=p.match(/^\/api\/admin\/packages\/(\d+)\/items$/);
  if(edit&&method==='PUT')
   return live('/api/live/packages/'+Number(edit[1])+'/items','PUT',
    {...data,branchId:scopedBranch(state)});
  // Original Main POS finance widgets keep their existing response contract.
  // The server independently restricts branch IDs and cashier permissions.
  if(p==='/api/finance/transactions'&&method==='GET')
   return live('/api/live/finance/transactions?'+url.searchParams.toString());
  if(p==='/api/finance/expenses'&&method==='GET')
   return live('/api/live/finance/expenses?'+url.searchParams.toString());
  if(p==='/api/finance/expenses'&&method==='POST')
   return live('/api/live/finance/expenses','POST',data);
  // Legacy receipt drawer expects these field names. Never use legacy sales APIs.
  const receiptKey=p.startsWith('/api/sales/')?p.slice('/api/sales/'.length):'';
  const saleDetail=receiptKey.length===21 && /^BR-[A-F0-9]{18}/.test(receiptKey)?[null,receiptKey]:null;
  if(saleDetail&&method==='GET'){
   const d=await live('/api/live/transactions/'+saleDetail[1]+qs(selected()));
   // Show the scoped receipt's actual stock movements and stored/derived audit
   // history. Never erase server-authoritative live checkout data.
   return{...d,items:(d.items||[]).map(x=>({...x,type:x.kind,unitPrice:x.price,
     lineTotal:x.total})),tender:d.tender??null,change:d.change??null};
  }
  if((p==='/api/reports/sales'||p==='/api/reports/costing')&&method==='GET'){
   const requested=String(url.searchParams.get('period')||'daily');
   const period={daily:'day',weekly:'week',monthly:'month',yearly:'year'}[requested];
   if(!period)throw fail('Choose Daily, Weekly, Monthly, or Yearly.',400);
   const all=state.user?.role==='Admin'&&
     (!url.searchParams.has('branchId')||url.searchParams.get('branchId')==='all');
   // All-branches is an aggregate of separately authorized branch reports,
   // NEVER an implicit fallback to the current POS branch.
   const branches=all?(await status()).branches.map(b=>Number(b.id)):
    [scopedBranch(state,url.searchParams.get('branchId'))];
   const ids=[...new Set(branches.filter(n=>Number.isSafeInteger(n)&&n>0))];
   if(!ids.length)throw fail('No authorized branches available for this report.',400);
   const parameters=id=>{
    const q=new URLSearchParams({range:period,branchId:String(id)});
    if(url.searchParams.get('date'))q.set('date',url.searchParams.get('date'));
    return q.toString();
   };
   if(p==='/api/reports/costing'){
    const values=await Promise.all(ids.map(id=>live('/api/live/report/costing?'+parameters(id))));
    if(values.length===1)return values[0];
    const grouped=new Map();
    for(const r of values)for(const ingredient of r.ingredients||[]){
     const key=ingredient.name+'|'+ingredient.uom;
     const existing=grouped.get(key)||{...ingredient,totalQty:0,totalCost:0,details:[],reconstructed:false};
     existing.totalQty+=Number(ingredient.totalQty||0);
     existing.totalCost+=Number(ingredient.totalCost||0);
     existing.reconstructed ||= ingredient.reconstructed===true;
     existing.details.push(...(ingredient.details||[]));
     grouped.set(key,existing);
    }
    return{branchId:'all',totalCost:values.reduce((n,r)=>n+Number(r.totalCost||0),0),
     ingredients:[...grouped.values()].sort((a,b)=>b.totalCost-a.totalCost),
     reconstructed:values.some(r=>r.reconstructed),unattributed:values.reduce((n,r)=>n+Number(r.unattributed||0),0),
     note:'Combined ingredient usage across all authorized branches; historical estimates remain labelled.'};
   }
   const values=await Promise.all(ids.map(id=>live('/api/live/report?'+parameters(id))));
   const sum=field=>values.reduce((n,r)=>n+Number(r[field]||0),0);
   const grouped=(field,key)=>{
    const map=new Map();
    for(const r of values)for(const row of r[field]||[]){
     const label=String(row[key]||'');
     const current=map.get(label)||{...row};
     if(map.has(label))for(const [k,v] of Object.entries(row))
      if(k!==key&&typeof v==='number')current[k]=Number(current[k]||0)+v;
     map.set(label,current);
    }
    return[...map.values()];
   };
   const firstPeriod=values[0]||{};
   const manilaDay=iso=>new Date(Date.parse(iso)+8*3600000).toISOString().slice(0,10);
   const from=firstPeriod.since?manilaDay(firstPeriod.since):null;
   const to=firstPeriod.until?manilaDay(new Date(Date.parse(firstPeriod.until)-86400000).toISOString()):null;
   const raw={period,rangeStart:from,rangeEnd:to,branchId:all?'all':ids[0],transactionCount:sum('transactionCount'),
    allTransactionCount:sum('allTransactionCount'),gross:sum('gross'),discounts:sum('discounts'),
    actual:sum('actual'),inStoreExpenses:sum('inStoreExpenses'),refund:sum('refund'),
    deletedCount:sum('deletedCount'),depositEntryCount:sum('depositEntryCount'),
    depositedAmount:values.some(r=>r.depositedAmount!=null)?sum('depositedAmount'):null,
    products:grouped('products','name'),promos:grouped('promos','name'),
    transactions:values.flatMap(r=>r.transactions||[]).sort((a,b)=>String(b.soldAt).localeCompare(String(a.soldAt)))};
   const totalProductGross=raw.products.reduce((n,x)=>n+Number(x.gross||0),0);
   const ratio=totalProductGross>0?raw.actual/totalProductGross:0;
   const isStaff=state.user?.role==='User';
   const products=raw.products.map(x=>{
    const adjusted=Number(x.gross||0)*(1-ratio);
    const actual=Number(x.gross||0)*ratio;
    const base={name:x.name,qty:x.qty,gross:Number(x.gross||0),adjusted,actual};
    return isStaff?base:{...base,costing:Number(x.costing||0),net:actual-Number(x.costing||0)};
   });
   const result={period,rangeStart:raw.rangeStart,rangeEnd:raw.rangeEnd,transactionCount:raw.transactionCount,
    allTransactionCount:raw.allTransactionCount,gross:raw.gross,discounts:raw.discounts,
    actual:raw.actual,inStoreExpenses:raw.inStoreExpenses,
    depositedAmount:raw.depositedAmount,depositEntryCount:raw.depositEntryCount,
    refund:raw.refund,products,promos:raw.promos.map(p=>({name:p.name,qty:Number(p.qty||0),
     gross:Number(p.gross||0),adjustment:Number(p.adjustment||0),actual:Number(p.actual||0)})),
    transactions:isStaff?[]:raw.transactions.map(t=>({...t,status:t.status==='Voided'?'Deleted':t.status}))};
   if(!isStaff){
    result.grossProfit=raw.actual-products.reduce((n,x)=>n+Number(x.costing||0),0);
    result.deletedCount=raw.deletedCount;
   }
   return result;
  }
  if(p==='/api/reports/cashiers'&&method==='GET'){
   // Staff cannot enumerate other branches or private employee accounts.
   if(state.user?.role==='User')return{cashiers:[state.user.username]};
   const r=await live('/api/live/cashiers');
   return{cashiers:(r.cashiers||[]).map(x=>x.username)};
  }
  if(p==='/api/system-logs'&&method==='GET'){
   const limit=Number(url.searchParams.get('limit')||200);
   return live('/api/live/system-logs?limit='+
     encodeURIComponent(Number.isFinite(limit)?Math.min(Math.max(Math.trunc(limit),1),500):200));
  }
  // DO NOT add a catch-all proxy or return fake empty data. An incomplete
  // feature must be unavailable rather than show someone else's records.
  // The live franchise checkout/data migration is active. Only THIS request
  // lacks an isolated endpoint. Never bypass workspace protection or retry
  // against a globally shared legacy API.
  console.warn('[DonMac isolated POS] Unmapped feature blocked:',method,p);
  throw fail('This specific action is unavailable in the isolated POS for this account. Your franchise data migration is active; no transaction or inventory data was changed. Please report the action to support.',403);
 }
 window.donmacFranchiseCompat={request,fail};
})();
