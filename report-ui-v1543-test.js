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
assert(html.includes('id="productDefaultImagesToggle"'));
assert(html.includes('id="productDefaultImagesGallery"'));
assert(html.includes('class="nav cashier-only active"'));
assert(html.includes('class="nav mobile-nav-item cashier-only"'));
assert(!html.includes('id="regPassword"'), 'Signup requests must never solicit a password');
assert(html.includes('>Submit Request</button>'), 'Registration is pending review only');
assert(core.includes("document.querySelectorAll('.cashier-only')"));
assert(core.includes("switchView(state.user.role==='User'?'pos':'dashboard')"));
assert(core.includes('renderProductDefaultGallery()'));
assert(core.includes("defaultCoffeeImages=[...all.values()]"));
assert(server.includes('CASHIER_ONLY_CHECKOUT'), 'Only cashiers may commit sales');
const chatRules=read('lib/internal-chat.js');
const chatUi=read('public/internal-chat.js');
const widgets=read('public/plan-dashboard-v1570.js');
assert(chatRules.includes("member.role!=='Admin'"), 'Cashiers cannot DM other cashiers');
assert(chatRules.includes("AND u.role=$4"), 'Cashier direct roster must list only admins');
assert(chatRules.includes('await contact(db,scope,user,other)'), 'Reactions honor direct-message permissions');
assert(chatUi.includes("window.donmacAuthenticatedRole!=='User'||c.role==='Admin'"), 'Chat UI limits cashier direct contacts');
assert(widgets.includes("roleAllowed=window.donmacAuthenticatedRole==='Admin'"), 'Cashiers must not fetch admin analytics');
assert(read('public/advanced-analytics-v20261108.js').includes("window.donmacAuthenticatedRole==='Admin'"), 'Cashiers must not fetch advanced analytics');
assert(widgets.includes('hideRestrictedWidgets()'), 'Hide forbidden analytics without showing a 403');
assert(widgets.includes('setRole,render,onViewChange'), 'Dashboard widget role must refresh on user change');
assert(core.includes('window.donmacPlanWidgets?.setRole?.(state.user.role)'), 'Role must synchronize after login');
assert(server.includes('franchiseRequests.migrate(db)'));
assert(server.includes('publicOwnerSignupAvailable:false'));
assert(server.includes('franchiseRequests.request(db,body)'));
assert(server.includes('franchiseEmailVerification.migrate(db)'));
assert(server.includes('franchiseStaging.migrate(db)'));
assert(server.includes("'/api/auth/register/verify'"));
assert(server.includes("'/api/auth/register/verify/resend'"));
assert(html.includes('id="authRegisterVerifyForm"'));
assert(html.includes('id="regVerifyCode"'));
assert(html.includes('dashboard-items-card admin-only'), 'Cashier items performance stays hidden');
assert(html.includes('id="transferUpgradeInformation"'));
assert(core.includes('Contact your Owner or Co-Owner to request an upgrade'));
assert(read('lib/franchise-tenant-staging.js').includes('PREPARED_NO_ACCESS'));
assert(read('lib/franchise-email-verification.js').includes('verification_attempts<5'));
const widgetSource=read('public/plan-dashboard-v1570.js');
assert(widgetSource.includes("addEventListener('dragstart'"));
assert(widgetSource.includes("addEventListener('pointerdown'"));
assert(!widgetSource.includes('data-pw-move='), 'Remove obsolete arrow buttons');
const onboardingSource=read('lib/public-franchise-requests.js');
assert(onboardingSource.includes('Do not send a password'));
assert(onboardingSource.includes('public_franchise_requests'));
assert(!onboardingSource.includes('INSERT INTO users'), 'Do not activate unsafe accounts');

assert(html.includes('Account Type: <strong id="accountPlanPill">'));
assert(css.includes('.plan-history-table td.plan-days-cell'));
assert(html.includes('<th>Remark</th>'));
assert(html.includes('<option value="all">All</option>'));
assert(core.includes('plan-remark-pill'));
assert(read('lib/branch-support.js').includes('wb.workspace_id=$4'));
const branchController=read('public/dashboard-experience-v1573.js');
const advancedSource=read('lib/advanced-analytics.js');
const advancedClient=read('public/advanced-analytics-v20261108.js');
assert(!branchController.includes('if(all)all.remove()'),'Dashboard must not remove All');
assert(branchController.includes("all.value='all'"),'Dashboard must restore All');
assert(branchController.includes("if(all.textContent!=='All')"),'All label update must not loop');
assert(advancedSource.includes("'si.is_package,s.branch_id"),'Sales items must use sales branch ID');
assert(!advancedSource.includes("'si.is_package,si.branch_id"),'Invalid sale_items branch column');
assert(advancedSource.includes("summary.itemUnits+=qty"),'Item quantities from saved items');
assert(advancedSource.includes("summary.namedOrders="),'Named orders from recorded customers');
assert(advancedSource.includes("summary.cashierCount="),'Cashier count from recorded users');
assert(advancedClient.includes("root.addEventListener('pointermove'"),'Interactive Advanced hover details');
assert(advancedClient.includes("root.addEventListener('focusin'"),'Keyboard focus details');
assert(!advancedClient.includes("Read-only analytical workspace."),'Remove generic Advanced footer');
assert(server.includes('AND wb.branch_id=s.branch_id'));
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
   if(sql.startsWith('SELECT plan,status,started_at,renew_at,changed_at,actor,remark FROM platform_account_plan_history'))
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
       renew_at:args[5],changed_at:args[6],actor:args[7],remark:args[8]});return{rows:[]};
   }
   throw Error('Unexpected subscription SQL: '+sql);
  }
 };
 await platform.migrate(db);
 assert(migrations.some(sql=>sql.includes('platform_account_plan_history')));
 assert(migrations.some(sql=>sql.includes('platform_account_plan_requests')));
 assert(migrations.some(sql=>sql.includes('ADD COLUMN IF NOT EXISTS remark')));
 assert.equal(platform.historyRemark(null,{plan:'PRO',status:'PAID'}),'Initial subscription');
 assert.equal(platform.historyRemark({plan:'PRO',status:'PAID'},{
  plan:'BUSINESS',status:'PAID'}),'Upgrade');
 assert.equal(platform.historyRemark({plan:'BUSINESS',status:'PAID'},{
  plan:'PRO',status:'PAID'}),'Downgrade');
 assert.equal(platform.historyRemark({plan:'PRO',status:'PAID',next_payment_date:'2026-11-01'},{
  plan:'PRO',status:'PAID',nextPaymentDate:'2026-12-01'}),'Renewal');
 assert.equal(platform.historyRemark({plan:'PRO',status:'PAID'},{
  plan:'PRO',status:'ON_HOLD'}),'On hold');
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
 assert.equal(state.history[0].remark,'Initial subscription');
 await platform.savePlan(db,42,{plan:'BUSINESS',status:'PAID',amount:'1199',
   nextPaymentDate:'2026-12-07'},'Admin Control');
 assert.equal((await platform.workspaceAccess(db,owner.id)).allowed,true);
 assert.equal(state.history.length,2);
 assert.equal(state.history[1].remark,'Reactivated');
 await platform.savePlan(db,42,{plan:'BUSINESS',status:'PAID',amount:'1199',
   nextPaymentDate:'2026-12-07'},'Admin Control');
 assert.equal(state.history.length,2,'No duplicate history for an unchanged plan/status/date');
 const sub=await platform.accountSubscription(db,42);
 assert.equal(sub.plan,'BUSINESS');
 assert.equal(sub.status,'PAID');
 assert.equal(sub.history.length,2);
 assert.equal(sub.history[0].remark,'Reactivated');
 assert.equal(sub.renewAt,'2026-12-07');
 console.log('Admin Control subscription history, plan requests and access checks passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
