'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('public/franchise-unified-adapter.js','utf8');
const core=fs.readFileSync('public/app-core.js','utf8');
const loader=fs.readFileSync('public/app.js','utf8');
const server=fs.readFileSync('server.js','utf8');
const router=fs.readFileSync('lib/franchise-live-router.js','utf8');
const dashboard=fs.readFileSync('lib/franchise-unified-dashboard.js','utf8');
const calls=[];
const window={};
const origin='https://donmacpos.com';
const status={ok:true,liveMode:true,productionIsolated:true,workspaceId:700,
 branchId:901,branchName:'Scoped Branch',role:'Admin',username:'newOwner',
 plan:'PRO',subscriptionStatus:'NOT_CONFIGURED',subscriptionActive:false,
 permissions:[],branches:[{id:901,name:'Scoped Branch'}],cashiers:[],
 entitlements:{plan:'PRO',totalBranches:1,activeBranches:1,mayAdd:true,maxBranches:3,
  extraBranches:0,extraBranchRate:799,nextRenewalAmount:0}};
const stubs={
 '/api/live/status':status,
 '/api/live/catalog':{branchId:901,products:[],addOns:[],promos:[],packages:[],categories:[]},
 '/api/live/manage':{products:[],ingredients:[],promos:[],packages:[]},
 '/api/live/categories':{categories:[{name:'Coffee',builtin:true,productIds:[]},{name:'Food',builtin:true,productIds:[]}]},
 '/api/live/quote':{gross:100,actual:100,adjustment:0},
 '/api/live/checkout':{ok:true,reference:'BR-123456789012345678',actual:100},
 '/api/live/dashboard':{rangeTransactions:0,rangeActual:0,metrics:{}},
 '/api/live/cashiers':{cashiers:[]},
 '/api/live/branches':{ok:true,id:905},
 '/api/live/inventory':{branchId:901,items:[]},
 '/api/live/finance/transactions':{rows:[],total:0},
 '/api/live/finance/expenses':{rows:[],total:0},
 '/api/live/transactions/BR-123456789012345678':{reference:'BR-123456789012345678',items:[{kind:'product',name:'Coffee',qty:1,price:100,total:100}]}
};
const fetch=async(path,options={})=>{
 const u=new URL(path,origin);
 calls.push({path:u.pathname,search:u.search,method:options.method||'GET',
  body:options.body?JSON.parse(options.body):undefined});
 assert(u.pathname.startsWith('/api/live/'),'No new-franchise request may reach legacy APIs.');
 const payload=stubs[u.pathname];
 if(payload===undefined)return{ok:false,status:404,json:async()=>({error:'Unavailable isolated endpoint'})};
 return{ok:true,status:200,json:async()=>payload};
};
vm.runInNewContext(source,{window,fetch,URL,URLSearchParams,location:{origin},console},
 {filename:'franchise-unified-adapter.js'});
const scoped=window.donmacFranchiseCompat;
assert(scoped&&typeof scoped.request==='function');
(async()=>{
 const state={user:{role:'Admin',liveMode:true,branchId:null},posBranchId:901};
 const catalog=await scoped.request('/api/catalog',{},state);
 assert.deepEqual([...catalog.products],[]);
 const categoryData=await scoped.request('/api/admin/pos-categories',{},state);
 assert.equal(categoryData.categories[1].name,'Food');
 const categoryPost=await scoped.request('/api/admin/pos-categories',{
  method:'POST',body:{name:'Desserts',productIds:[],active:true}},state);
 assert.equal(categoryPost.categories.length,2);
 const categoryCall=calls.find(x=>x.path==='/api/live/categories'&&x.method==='POST');
 assert.equal(categoryCall.body.branchId,901,'Custom category writes must include the selected branch');
 await scoped.request('/api/admin/pos-categories/Food',{
  method:'PUT',body:{name:'Food',iconData:null,productIds:[],active:true}},state);
 const iconUpdate=calls.find(x=>x.path==='/api/live/categories/Food'&&x.method==='PUT');
 assert.equal(iconUpdate.body.branchId,901);
 await scoped.request('/api/admin/pos-categories/Desserts',{method:'DELETE'},state);
 assert(calls.some(x=>x.path==='/api/live/categories/Desserts'&&x.method==='DELETE'&&x.search.includes('branchId=901')));

 const branches=await scoped.request('/api/branches',{},state);
 assert.equal(branches.branches[0].active,true);
 assert.equal(branches.branchPricing.mayAdd,true);
 const quote=await scoped.request('/api/quote',{method:'POST',body:{items:[{id:3,kind:'product',qty:1}]}},state);
 assert.equal(quote.actual,100);
 const order=await scoped.request('/api/sales',{method:'POST',body:{
  clientRequestId:'87d99667-1dcf-4788-9cda-1aa70f246249',items:[{kind:'product',id:3,qty:1}]}},state);
 assert.equal(order.ok,true);
 assert.equal(calls.find(c=>c.path==='/api/live/checkout').body.branchId,901);
 const dashboardResult=await scoped.request('/api/dashboard?view=hourly&branchId=901',{},state);
 assert.equal(dashboardResult.rangeActual,0);
 await assert.rejects(scoped.request('/api/backups',{},state),/not yet been migrated/i);
 const finance=await scoped.request('/api/finance/transactions?branchId=901',{},state);
 assert.equal(finance.total,0);
 const expense=await scoped.request('/api/finance/expenses?branchId=901',{},state);
 assert.equal(expense.total,0);
 const receipt=await scoped.request('/api/sales/BR-123456789012345678',{},state);
 assert.equal(receipt.items[0].unitPrice,100);
 assert.equal(receipt.items[0].lineTotal,100);
 await assert.rejects(scoped.request('/api/sales/BR-123456789012345677',{},state),/Unavailable isolated endpoint/);
 assert(!calls.some(x=>x.path==='/api/catalog'||x.path==='/api/sales'||x.path==='/api/dashboard'));
 assert(!/location\.(?:assign|replace)\('\/franchise-live\.html'\)/.test(core));
 assert.match(core,/window\.donmacFranchiseCompat\.request/);
 assert.match(loader,/loadScript\('\/franchise-unified-adapter\.js'\)/);
 assert.match(server,/LIVE_FRANCHISE_SCOPED_ONLY/);
 assert.match(router,/scope\.requireAdmin\(ctx\)/);
 assert.match(router,/unifiedDashboard\.dashboard\(db,ctx,query\)/);
 assert(!/\b(?:FROM|JOIN|UPDATE|INTO)\s+(?:sales|products|ingredients)\b/i.test(dashboard),
  'Unified dashboard cannot query globally shared POS tables.');
 assert.match(dashboard,/branch_live_sales/);
 assert.match(dashboard,/branch_live_expenses/);
 console.log('PASS: original POS interface uses isolated live routes; legacy endpoints never requested; unsupported functions fail closed.');
})().catch(err=>{console.error(err);process.exitCode=1});
