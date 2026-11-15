'use strict';
// A new live franchise must render the SAME public/index.html as existing users;
// every data call must be scoped, and the old live HTML may not be a login target.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const original=fs.readFileSync('public/index.html','utf8');
const scripts=['public/ui-utils.js','public/report-pagination-v1541.js',
 'public/pos-stock-limit-v20261114.js','public/franchise-unified-adapter.js','public/app-core.js'];
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
const dashboard={today,grain:'hourly',from:today,to:today,rangeActual:0,rangeGross:0,
 rangeTransactions:0,rangeDiscount:0,rangeExpenses:0,categorySales:[],categoryTrends:[],
 performanceProducts:[],topProducts:[],recentTransactions:[],lowStock:[],
 trend:Array.from({length:24},(_,i)=>({label:String(i),actual:0,transactions:0})),
 metrics:{todayActual:0,todayGross:0,todayTransactions:0,monthActual:0,monthGross:0,
  monthTransactions:0,lowStockCount:0,inventoryCount:0}};
async function testRole(role){
 const dom=new JSDOM(original,{url:'https://donmacpos.com/',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window,doc=w.document;
 const errors=[],calls=[];
 const status={ok:true,liveMode:true,productionIsolated:true,workspaceId:500,branchId:600,
  branchName:'Franchise Test Branch',role,username:role==='Admin'?'owner':'cashier',
  plan:'PRO',subscriptionStatus:'NOT_CONFIGURED',subscriptionActive:false,
  permissions:[],branches:[{id:600,name:'Franchise Test Branch',active:true}],cashiers:[],
  entitlements:{plan:'PRO',maxBranches:3,mayAdd:true,totalBranches:1,
   activeBranches:1,extraBranches:0,extraBranchRate:799,nextRenewalAmount:0}};
 const mock={
  '/api/status':{setupRequired:false,ready:true},
  '/api/auth/me':{user:{id:role==='Admin'?10:11,role,username:status.username,
   liveMode:true,branchId:role==='Admin'?null:600,accessPermissions:[],active:true,
   subscriptionStatus:'NOT_CONFIGURED',subscriptionActive:false}},
  '/api/live/status':status,
  '/api/live/catalog':{branchId:600,workspaceId:500,products:[],packages:[],promos:[],addOns:[],
   categories:[{name:'Coffee',builtin:true,active:true,productIds:[]}]},
  '/api/live/manage':{products:[],ingredients:[],promos:[],packages:[],categories:[]},
  '/api/live/dashboard':dashboard,
  '/api/live/cashiers':{cashiers:[]},
  '/api/live/inventory':{branchId:600,items:[]}
 };
 w.fetch=async(url,opts={})=>{
  const path=new URL(url,'https://donmacpos.com').pathname;
  calls.push({path,method:opts.method||'GET'});
  if(!['/api/status','/api/auth/me'].includes(path)&&!path.startsWith('/api/live/'))
   throw Error('Unscoped request in shared POS: '+path);
  const result=mock[path];
  if(!result)throw Error('No mock for '+path);
  return{ok:true,status:200,json:async()=>result};
 };
 w.HTMLCanvasElement.prototype.getContext=()=>({
  setTransform(){},clearRect(){},fillRect(){},stroke(){},moveTo(){},lineTo(){},beginPath(){},
  fillText(){},measureText(){return{width:20}},arc(){},fill(){},save(){},restore(){},
  createLinearGradient(){return{addColorStop(){}}},setLineDash(){}
 });
 w.console.error=(...args)=>errors.push(args.map(String).join(' '));
 w.confirm=()=>true;
 w.scrollTo=()=>{};
 if(typeof w.ResizeObserver!=='function')w.ResizeObserver=class{observe(){}disconnect(){}};
 try{
  for(const path of scripts)w.eval(fs.readFileSync(path,'utf8'));
  for(let i=0;i<100&&doc.getElementById('app').classList.contains('hidden');i++)await pause(20);
  assert(!doc.getElementById('app').classList.contains('hidden'),
   'Original Main POS shell must become visible to the live franchise.');
  assert.equal(w.donmacFranchiseUnified,true);
  assert(!calls.some(x=>!['/api/status','/api/auth/me'].includes(x.path)&&!x.path.startsWith('/api/live/')));
  if(role==='Admin'){
   assert(doc.getElementById('view-dashboard').classList.contains('active'),
    'New franchise owner opens original Dashboard.');
   assert(!doc.querySelector('[data-view="users"]').classList.contains('hidden'),
    'Owner sees the original Branches and Cashiers screen.');
   assert(doc.querySelector('[data-view="pos"]').classList.contains('hidden'),
    'Owner cannot access cashier checkout.');
   assert(calls.some(x=>x.path==='/api/live/dashboard'),
    'Original Dashboard is backed by scoped live data.');
  }else{
   assert(doc.getElementById('view-pos').classList.contains('active'),
    'New cashier opens the original POS.');
   assert(doc.querySelector('[data-view="dashboard"]').classList.contains('hidden'));
   assert(doc.querySelector('[data-view="catalog"]').classList.contains('hidden'));
   assert(doc.getElementById('payButton').disabled,'Checkout remains locked without an order/payment.');
  }
  assert(!errors.length,'No uncaught shared POS bootstrap errors: '+errors.join(' | '));
  console.log('PASS shared Main POS role '+role+': original interface, isolated API calls, correct role navigation.');
 }finally{w.close()}
}
(async()=>{await testRole('Admin');await testRole('User')})().catch(err=>{console.error(err);process.exitCode=1});
