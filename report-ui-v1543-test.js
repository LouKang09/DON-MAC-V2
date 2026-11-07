'use strict';
/* Regression tests for Admin Control subscriptions and POS access restrictions. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const platform=require('./lib/platform-accounts');
const read=path=>fs.readFileSync(path,'utf8');
const html=read('public/index.html'),core=read('public/app-core.js'),
  server=read('server.js'),css=read('public/account-subscription-v20261107.css');
const count=id=>(html.match(new RegExp('id="'+id+'"','g'))||[]).length;
for(const id of ['view-account','accountPlanPill','accountPlanSelect',
  'accountPlanName','accountStartedAt','accountRenewAt','accountRemaining',
  'accountPaymentStatus','accountPlanMessage','saveAccountPlan',
  'subscriptionHistoryBody','subscriptionHistoryPagination']){
  assert.equal(count(id),1,'Missing/duplicate current subscription control: '+id);
}
assert(!html.includes('id="planSwitcher"'));
assert(!html.includes('id="accountStatusSelect"'));
assert(!html.includes('DEVELOPMENT MODE'));
assert(!html.includes('development-only subscription preview'));
assert(html.includes('>Update Plan</button>'));
assert(html.includes('Account Type: <strong id="accountPlanPill">'));
assert(css.includes('.plan-history-table td.plan-days-cell'));
assert(css.includes('#accountPlanPill'));
assert(core.includes("api('/api/account/subscription/update-plan'"));
assert(core.includes("Promise.all([loadBranches(),loadDevSubscription(),loadCatalog()])"));
assert(core.includes("api('/api/pos/today-count?branchId="));
assert(server.includes("code:'SUBSCRIPTION_INACTIVE'"));
assert(server.includes("platformAccounts.workspaceAccess(db,u.id)"));
assert(server.includes("platformAccounts.workspaceAccess(db,user.id)"));
assert(server.includes("await requireBusinessPlan(user)"));
assert(server.includes("platformAccounts.accountSubscription(db,ws)"));
assert(server.includes("if(method==='POST'&&p==='/api/account/subscription/update-plan')"));
assert(server.includes("if(method==='POST'&&p==='/api/account/subscription/demo')"));
assert(read('public/platform-admin.js').includes('requested-plan-marker'));

(async()=>{
 const state={plan:null,pending:null,history:[]};
 const migrations=[];
 const db={
  engine:'postgres',
  async exec(sql){migrations.push(sql);},
  async transaction(action){return action(this);},
  async query(sql,args=[]){
   if(sql.startsWith('SELECT id FROM chat_workspaces'))return{rows:[{id:42}]};
   if(sql.startsWith('SELECT plan FROM platform_account_plans'))
     return{rows:state.plan?[state.plan]:[]};
   if(sql.startsWith('SELECT plan,started_at FROM platform_account_plan_history'))
     return{rows:state.history.length?[state.history[state.history.length-1]]:[]};
   if(sql.startsWith('SELECT plan,amount,status,next_payment_date,updated_at FROM platform_account_plans')||
      sql.startsWith('SELECT plan,status,next_payment_date,updated_at FROM platform_account_plans'))
     return{rows:state.plan?[state.plan]:[]};
   if(sql.startsWith('SELECT requested_plan,requested_at FROM platform_account_plan_requests'))
     return{rows:state.pending?[state.pending]:[]};
   if(sql.startsWith('SELECT plan,status,started_at,renew_at,changed_at,actor FROM platform_account_plan_history'))
     return{rows:[...state.history].reverse()};
   if(sql.startsWith('SELECT p.status,p.plan FROM chat_memberships'))
     return{rows:state.plan?[state.plan]:[]};
   if(sql.startsWith('INSERT INTO platform_account_plan_requests')){
     state.pending={requested_plan:args[1],requested_at:args[2]};return{rows:[]};
   }
   if(sql.startsWith('DELETE FROM platform_account_plan_requests')){
     state.pending=null;return{rows:[]};
   }
   if(sql.startsWith('INSERT INTO platform_account_plans')){
     state.plan={plan:args[1],amount:args[2],status:args[3],next_payment_date:args[4],
       updated_at:args[5]};return{rows:[]};
   }
   if(sql.startsWith('INSERT INTO platform_account_plan_history')){
     state.history.push({plan:args[2],status:args[3],started_at:args[4],
       renew_at:args[5],changed_at:args[6],actor:args[7]});return{rows:[]};
   }
   throw Error('Unexpected subscription SQL: '+sql);
  }
 };
 await platform.migrate(db);
 assert(migrations.some(sql=>sql.includes('platform_account_plan_history')));
 assert(migrations.some(sql=>sql.includes('platform_account_plan_requests')));
 const owner={id:7,role:'Admin'},staff={id:8,role:'User'};
 assert.equal((await platform.workspaceAccess(db,owner.id)).allowed,true,
  'Existing unconfigured accounts must not be automatically locked');
 assert.equal((await platform.accountSubscription(db,42)).status,'NOT_CONFIGURED');
 await assert.rejects(platform.requestPlan(db,42,staff,'BUSINESS'));
 const request=await platform.requestPlan(db,42,owner,'BUSINESS');
 assert.equal(request.pendingPlan.plan,'BUSINESS');
 assert.equal((await platform.accountSubscription(db,42)).pendingPlan.plan,'BUSINESS');
 await platform.savePlan(db,42,{plan:'BUSINESS',status:'ON_HOLD',amount:'1199',
   nextPaymentDate:'2026-12-07'},'Admin Control');
 assert.equal((await platform.workspaceAccess(db,owner.id)).allowed,false);
 assert.equal((await platform.accountSubscription(db,42)).pendingPlan,null);
 assert.equal(state.history.length,1);
 await platform.savePlan(db,42,{plan:'BUSINESS',status:'PAID',amount:'1199',
   nextPaymentDate:'2026-12-07'},'Admin Control');
 assert.equal((await platform.workspaceAccess(db,owner.id)).allowed,true);
 assert.equal(state.history.length,2);
 await platform.savePlan(db,42,{plan:'BUSINESS',status:'PAID',amount:'1199',
   nextPaymentDate:'2026-12-07'},'Admin Control');
 assert.equal(state.history.length,2,'No duplicate history for an unchanged plan/status/date');
 const sub=await platform.accountSubscription(db,42);
 assert.equal(sub.plan,'BUSINESS');
 assert.equal(sub.status,'PAID');
 assert.equal(sub.history.length,2);
 assert.equal(sub.renewAt,'2026-12-07');
 console.log('Admin Control subscription history, plan requests and access checks passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
