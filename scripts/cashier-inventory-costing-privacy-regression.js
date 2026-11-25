'use strict';
/* Run: node scripts/cashier-inventory-costing-privacy-regression.js
 * Cashiers must not receive confidential usage/cost details even if they have
 * inventory.view. The owner UI must remain available, and the deposit KPI
 * must include the real expense-ledger amount. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const html=source('public/index.html');
const core=source('public/app-core.js');
const usage=source('public/inventory-usage-summary-v20261120.js');
const live=source('lib/franchise-live-router.js');
const server=source('server.js');
const drill=source('public/dashboard-kpi-drilldown-v20261118.js');

assert.match(html,/<section id="inventoryUsageSummary" class="[^"]*\badmin-only hidden\b/);
assert.match(html,/<h3>Ingredients Usage Summary<\/h3>/);
assert.match(html,/<h4>Ingredients Consumed in Sales<\/h4>/);
assert.match(html,/<div id="inventoryAuditSection" class="card spaced inv-audit-card admin-only hidden" hidden inert aria-hidden="true">/);
assert.match(core,/querySelectorAll\('\.admin-only,\.staff-hidden'\)/);
assert.match(core,/x\.classList\.toggle\('hidden',state\.user\.role!=='Admin'\)/);
assert.match(usage,/window\.donmacAuthenticatedRole==='Admin'/);
assert.match(usage,/if\(!ownerOnly\(\)\)\{clearSensitiveUsage\(\);return;\}/);
assert.match(usage,/data=null;lastKey='';currentBranch='';loading=false/);
assert.match(usage,/results\.hidden=true/);
assert.match(usage,/attributeFilter:\['class','inert','aria-hidden'\]/);
const liveRoute=live.slice(live.indexOf("p==='/api/live/inventory/usage-summary'"),live.indexOf("p==='/api/live/inventory/movements'"));
assert.match(liveRoute,/if\(!ctx\.admin\)throw scope\.fail\([^;]+403\)/);
assert(liveRoute.indexOf('if(!ctx.admin)')<liveRoute.indexOf('inventoryUsage.live('));
const legacyRoute=server.slice(server.indexOf("p==='/api/inventory/usage-summary'"),server.indexOf("p==='/api/inventory/movements'"));
assert.match(legacyRoute,/if\(user\.role!=='Admin'\)throw Object\.assign/);
assert(legacyRoute.indexOf("if(user.role!=='Admin')")<legacyRoute.indexOf('inventoryIngredientUsage.legacy('));

// Evaluate actual usage component with a minimal, isolated browser environment.
// The inventory screen is otherwise fully available to granted cashiers.
const handlers={};
const makeNode=id=>{
 const classes=new Set(id==='inventoryUsageSummary'?['admin-only','hidden']:id==='app'?[]:id==='view-inventory'?['active']:[]);
 return {id,hidden:false,value:'',inert:false,innerHTML:'',textContent:'',
  selectedOptions:[{textContent:'Main Branch'}],
  classList:{contains:x=>classes.has(x),add:x=>classes.add(x),remove:x=>classes.delete(x),
   toggle:(x,v)=>v?classes.add(x):classes.delete(x)},
  addEventListener(name,fn){handlers[id+':'+name]=fn;},
  replaceChildren(){this.innerHTML='';this.textContent='';}
 };
};
const nodes=new Map();
const el=id=>{if(!nodes.has(id))nodes.set(id,makeNode(id));return nodes.get(id)};
el('inventoryBranch').value='7';el('inventoryUsagePeriod').value='day';el('inventoryUsageChartType').value='line';
const watchers=[];
const browser={donmacAuthenticatedRole:'User',donmacSessionGeneration:()=>1,
 addEventListener(name,handler){handlers['window:'+name]=handler;}};
let fetches=0;
const payload={ingredients:[],days:[],totals:{grossCost:0,netCost:0,ingredientTypes:0},
 branch:{name:'Main Branch'},period:{start:'2026-11-25',end:'2026-11-25'},
 sourceNote:'Receipt snapshots.'};
const context={window:browser,document:{getElementById:el},Date,Intl,Number,Math,String,
 URLSearchParams,AbortController,Map,queueMicrotask:fn=>Promise.resolve().then(fn),
 MutationObserver:class{constructor(cb){this.cb=cb}observe(target,options){watchers.push({target,options,callback:this.cb})}},
 fetch:async()=>{fetches++;return{ok:true,json:async()=>payload};},
 console:{warn(){},error(){}}
};
vm.runInNewContext(usage,context);
async function run(){
 assert(browser.donmacInventoryUsage,'Inventory widget did not initialize');
 await browser.donmacInventoryUsage.refresh();
 assert.equal(fetches,0,'Cashier must not request recipe costing');
 assert.equal(el('inventoryUsageResults').hidden,true);
 browser.donmacAuthenticatedRole='Admin';
 el('inventoryUsageSummary').classList.remove('hidden');
 await browser.donmacInventoryUsage.refresh();
 assert.equal(fetches,1,'Owner must retain ingredient usage request');
 assert.equal(el('inventoryUsageResults').hidden,false);
 browser.donmacAuthenticatedRole='User';
 el('inventoryUsageSummary').classList.add('hidden');
 for(const watcher of watchers.filter(x=>x.target===el('inventoryUsageSummary')))watcher.callback();
 assert.equal(el('inventoryUsageResults').hidden,true);
 assert.equal(el('inventoryUsageBody').innerHTML,'');
 assert.equal(el('inventoryUsageChart').innerHTML,'');
 await browser.donmacInventoryUsage.refresh();
 assert.equal(fetches,1,'Role switch must not fetch confidential usage');
 const p=drill.indexOf('function overview('),q=drill.indexOf('function branchTable(',p);
 assert(p>0&&q>p);
 const overview=new Function('number','money','count','pct','box',
  drill.slice(p,q)+';return overview;')(
  x=>Number(x||0),x=>'₱'+Number(x).toFixed(2),x=>String(Number(x||0)),
  (n,d)=>d>0?(100*Number(n||0)/d).toFixed(1)+'%':'0.0%',
  (name,value)=>'<div><span>'+name+'</span><strong>'+value+'</strong></div>');
 const deposit=overview({rangeGross:1200,rangeActual:1000,rangeDepositExpenses:145,
  rangeTransactions:3,shiftDeposits:{total:855},metrics:{}},'deposited');
 assert.match(deposit,/Staff-entered Expenses<\/span><strong>₱145\.00<\/strong>/);
 assert.match(deposit,/Deposited Sales - calculated<\/span><strong>₱855\.00<\/strong>/);
 assert.match(deposit,/Sales Deposit Actual<\/span><strong>₱855\.00<\/strong>/);
 assert.match(deposit,/Staff Expenses \/ Net Sales %<\/span><strong>14\.5%<\/strong>/);
 console.log('PASS cashier inventory cost hidden and API denied, Owner widget retained, role switch purged, Deposited Sales expense restored');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
