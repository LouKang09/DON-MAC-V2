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
  hasWebPassword:true,accessPermissions:x.permissions||[],email:'',phone:'',isOwner:false});
 async function adminCatalog(state,kind){
  const x=await live('/api/live/manage'+qs(scopedBranch(state)));
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
  if(p==='/api/dashboard'&&method==='GET'){
   const query=new URLSearchParams(url.searchParams);
   if(query.get('branchId'))query.set('branchId',String(scopedBranch(state,query.get('branchId'))));
   return live('/api/live/dashboard?'+query);
  }
  if(p==='/api/branches'&&method==='GET'){
   const s=await status();
   return{branches:(s.branches||[]).map(b=>({...b,active:true,usersCount:0,salesCount:0})),
    branchPricing:subscription(s).branchPricing};
  }
  if(p==='/api/branches'&&method==='POST')
   return live('/api/live/branches','POST',{name:data.name,address:data.address||''});
  if(p==='/api/account/subscription'&&method==='GET')return subscription(await status());
  if(p==='/api/inventory'&&method==='GET')
   return live('/api/live/inventory'+qs(selected()));
  if(p==='/api/inventory/movements'&&method==='GET')
   return live('/api/live/inventory/movements'+qs(selected()));
  if(p==='/api/inventory/replenish/direct'&&method==='POST')
   return live('/api/live/stock','POST',data);
  if(p==='/api/users'&&method==='GET'){
   const r=await live('/api/live/cashiers');
   return{users:(r.cashiers||[]).map(mapCashier)};
  }
  if(p==='/api/users'&&method==='POST'){
   if(data.role!=='User')throw fail('Co-Owner provisioning must be enabled in the isolated staff service before it can be used.',403);
   if(data.email||data.phone||data.photoData)
    throw fail('Employee contact and photo storage is not yet enabled in the isolated staff service. Remove those fields before saving.',409);
   const created=await live('/api/live/cashiers','POST',data);
   if((data.accessPermissions||[]).length){
    await live('/api/live/cashiers/'+Number(created.id)+'/permissions','PUT',
     {permissions:data.accessPermissions});
   }
   return created;
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
  if(p==='/api/reports/cashiers'&&method==='GET'){
   const r=await live('/api/live/cashiers');
   return{cashiers:(r.cashiers||[]).map(x=>x.username)};
  }
  // DO NOT add a catch-all proxy or return fake empty data. An incomplete
  // feature must be unavailable rather than show someone else's records.
  throw fail('This Main POS function has not yet been migrated to your isolated franchise data. It remains disabled to protect other accounts.',403);
 }
 window.donmacFranchiseCompat={request,fail};
})();