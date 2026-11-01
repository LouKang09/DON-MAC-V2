'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const plans=require('./lib/development-subscriptions');
const read=p=>fs.readFileSync(p,'utf8');
const server=read('server.js'),html=read('public/index.html'),
  core=read('public/app-core.js'),css=read('public/dev-plans-v1543.css'),
  appJs=read('public/app.js');

function count(id){return [...html.matchAll(new RegExp('id="'+id+'"','g'))].length;}
for(const id of ['planSwitcher','view-advanced','view-account','transferPlanGate',
  'transferUpgradeButton','advancedUpgradeButton','subscriptionHistoryBody',
  'accountPlanSelect','accountStatusSelect','saveAccountPlan','accountStartedAt',
  'accountRenewAt','accountRemaining','accountSettingsTop']){
  assert.equal(count(id),1,'Missing/duplicate subscription element: '+id);
}
assert(/<option value="User">Cashier<\/option>/.test(html));
assert(html.includes('data-view="advanced"')&&html.includes('data-view="account"'));
assert(html.includes('>Upgrade to Business</button>'));
assert(html.includes('>Apply Demo Plan</button>'));
assert(html.includes('Business plan users only'));
assert(html.includes('PAID')&&html.includes('ON_HOLD')&&html.includes('UNPAID'));
assert(html.includes('No payment is collected'));
assert(html.includes('Date</th><th>Plan</th><th>Start Date</th><th>Renew Date</th><th>Days Remaining</th><th>Status'));
assert(html.includes('Advanced Report / Inventory Management'));
assert(html.includes('Purchase orders')&&html.includes('Transfer orders')&&
  html.includes('Stock adjustments')&&html.includes('Inventory counts')&&
  html.includes('Production')&&html.includes('Inventory history')&&
  html.includes('Inventory valuation report')&&html.includes('Label printing'));
assert(html.includes('Planned'), 'Unbuilt advanced features must be marked planned');
assert(html.includes('id="dbEngine" hidden'), 'Original database badge must be hidden');
assert(css.includes('#liveSyncStatus'), 'Auto Sync text badge must be visually removed');
assert(css.includes('110px') && css.includes('106px'), 'Header logo should be about old sidebar size');
assert(appJs.includes('devPlansV1543Css'), 'CSS must be loaded');
assert(core.includes("await loadDevSubscription();await loadCatalog()"));
assert(core.includes("changeDevSubscription(e.target.value"));
assert(core.includes("if(state.subscription?.plan!=='BUSINESS')"));
assert(core.includes("if(!business){"));
assert(core.includes('subscriptionBadge(row.status)'));
assert(server.includes("const APP_VERSION = '1.5.43-dev-plans-advanced-inventory';"));
assert(server.includes("if(method==='GET'&&p==='/api/account/subscription')"));
assert(server.includes("if(method==='POST'&&p==='/api/account/subscription/demo')"));
assert(server.includes("await requireBusinessPlan();"));
assert(server.includes("await db.query(\n    'INSERT INTO app_settings"));
assert(server.includes("SELECT username AS cashier FROM users WHERE role=$1"),
  'Cashier dropdown should query account roles rather than admin transaction snapshots');

const start='2026-10-31T12:00:00.000Z';
const original=plans.initial(start);
assert.equal(original.plan,'PRO');
assert.equal(original.status,'PAID');
assert.equal(original.history.length,1);
assert.equal(original.renewAt,plans.nextRenewAt(start));
assert.equal(plans.nextRenewAt('2026-01-31T00:00:00.000Z'),'2026-02-28T00:00:00.000Z');
assert.equal(plans.entitlements('PRO').transfer,false);
assert.equal(plans.entitlements('PRO').replenish,true);
assert.equal(plans.entitlements('BUSINESS').transfer,true);
assert.equal(plans.parse('not JSON'),null);
assert.equal(plans.parse(JSON.stringify(original)).plan,'PRO');

let store=JSON.stringify(original),audit=[],transactions=0;
const db={
  engine:'postgres',
  async query(sql,args=[]){
    if(sql.includes('SELECT setting_value FROM app_settings'))return {rows:[{setting_value:store}]};
    if(sql.includes('INSERT INTO app_settings')&&sql.includes('DO UPDATE SET')){
      store=args[1];return {rows:[]};
    }
    throw Error('unexpected test SQL: '+sql);
  },
  async transaction(work){
    transactions++;
    return work(this);
  }
};
const scope={
  db,devSubscription:plans,Date,Number,String,Math,JSON,
  nowIso:()=>new Date().toISOString(),
  requireAdminRole:user=>{
    if(user?.role!=='Admin')throw Object.assign(new Error('Administrator access required.'),{status:403});
  },
  logAction:async(user,activity,status,remark)=>audit.push({user,activity,status,remark})
};
const from=server.indexOf('async function subscriptionState('),
  to=server.indexOf('async function getCatalog(',from),
  fromTransfer=server.indexOf('async function transfer(user,body){'),
  toTransfer=server.indexOf('async function listInventoryMovements',fromTransfer);
assert(from>=0&&to>from&&fromTransfer>=0&&toTransfer>fromTransfer);
vm.runInNewContext(server.slice(from,to),scope);
vm.runInNewContext(server.slice(fromTransfer,toTransfer),scope);
const admin={id:1,role:'Admin',username:'Owner'};
const cashier={id:2,role:'User',username:'Cashier'};
scope.validateMovementItems=()=>{throw Error('VALIDATION_CALLED');};
(async()=>{
  let state=await scope.getSubscriptionForUi();
  assert.equal(state.plan,'PRO');
  assert.equal(state.entitlements.transfer,false);
  assert.equal(state.history.length,1);
  await assert.rejects(()=>scope.requireBusinessPlan(),e=>e.status===403&&e.code==='BUSINESS_PLAN_REQUIRED');
  await assert.rejects(()=>scope.transfer(cashier,{items:[{ingredientId:1,qty:2}]}),e=>e.status===403,
    'Even direct HTTP requests must not transfer stock on Pro');
  await assert.rejects(()=>scope.saveDemoSubscription(cashier,{plan:'BUSINESS',status:'PAID'}),
    e=>e.status===403,'Only Admin can switch plans');

  state=await scope.saveDemoSubscription(admin,{plan:'BUSINESS',status:'PAID'});
  assert.equal(state.plan,'BUSINESS');
  assert.equal(state.entitlements.transfer,true);
  assert.equal(state.history.length,2);
  await scope.requireBusinessPlan();
  await assert.rejects(()=>scope.transfer(admin,{items:[{ingredientId:1,qty:2}]}),
    /VALIDATION_CALLED/,'Business gate should allow the existing transfer validation to run');
  state=await scope.saveDemoSubscription(admin,{plan:'BUSINESS',status:'PAID'});
  assert.equal(state.history.length,2,'Duplicate switch must not invent a billing period');
  state=await scope.saveDemoSubscription(admin,{plan:'BUSINESS',status:'ON_HOLD'});
  assert.equal(state.history.length,3);
  assert.equal(state.status,'ON_HOLD');
  assert.equal(state.startedAt,JSON.parse(store).startedAt);
  state=await scope.saveDemoSubscription(admin,{plan:'PRO',status:'UNPAID'});
  assert.equal(state.plan,'PRO');
  assert.equal(state.status,'UNPAID');
  assert.equal(state.history.length,4);
  assert.equal(state.entitlements.transfer,false);
  await assert.rejects(()=>scope.requireBusinessPlan(),e=>e.status===403);
  assert(audit.length===3);
  assert(transactions>=4);
  await assert.rejects(()=>scope.saveDemoSubscription(admin,{plan:'FREE',status:'PAID'}),e=>e.status===400);
  await assert.rejects(()=>scope.saveDemoSubscription(admin,{plan:'PRO',status:'UNKNOWN'}),e=>e.status===400);
  console.log('v1.5.43 Pro/Business demo plans, access, history and UI checks passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
