'use strict';
// Run: node scripts/cashier-sales-report-privacy-regression.js
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const privacy=require('../lib/report-financial-privacy');
const pdf=require('../lib/pdf');
const html=source('public/index.html');
const core=source('public/app-core.js');
const legacy=source('server.js');
const live=source('lib/franchise-live-router.js');
const exporter=source('lib/franchise-live-report-exports.js');
const adapter=source('public/franchise-unified-adapter.js');

async function run(){
 const deposits=[
  {workspace:11,branch:4,day:'2026-11-25',cents:12000},
  {workspace:11,branch:4,day:'2026-11-24',cents:20000},
  {workspace:11,branch:5,day:'2026-11-25',cents:45000},
  {workspace:22,branch:4,day:'2026-11-25',cents:999900}
 ];
 const calls=[];
 const db={query:async(sql,args)=>{
  calls.push({sql,args});
  assert.match(sql,/franchise_shift_deposits/);
  assert.match(sql,/chat_workspace_branches/);
  const [workspace,from,to,branch]=args;
  const selected=deposits.filter(r=>r.workspace===workspace&&r.day>=from&&r.day<to&&
   (branch==null||r.branch===branch));
  return{rows:[{count:selected.length,total:selected.reduce((n,r)=>n+r.cents,0)}]};
 }};
 assert.deepEqual(await privacy.depositedAmount(db,{workspaceId:11,branchId:4,
  from:'2026-11-25',to:'2026-11-26'}),{amount:120,count:1});
 assert.deepEqual(await privacy.depositedAmount(db,{workspaceId:11,branchId:4,
  from:'2026-11-24',to:'2026-11-26'}),{amount:320,count:2});
 assert.deepEqual(await privacy.depositedAmount(db,{workspaceId:11,
  from:'2026-11-25',to:'2026-11-26'}),{amount:570,count:2});
 assert.deepEqual(await privacy.depositedAmount(db,{workspaceId:12,branchId:4,
  from:'2026-11-25',to:'2026-11-26'}),{amount:null,count:0});
 await assert.rejects(()=>privacy.depositedAmount(db,{workspaceId:0,from:'2026-11-25',to:'2026-11-26'}));
 await assert.rejects(()=>privacy.depositedAmount(db,{workspaceId:11,from:'2026-11-27',to:'2026-11-26'}));
 assert(calls.every(x=>x.args[0]===11||x.args[0]===12));

 const full={period:'daily',target:'2026-11-25',cashier:'CASHIER',
  transactionCount:3,allTransactionCount:4,deletedCount:1,
  gross:1800,discounts:200,actual:1600,grossProfit:1100,
  inStoreExpenses:500,depositedAmount:120,refund:25,
  products:[{name:'Latte',qty:3,gross:700,adjusted:-20,actual:680,costing:135,net:545}],
  promos:[],transactions:[{reference:'PRIVATE-001',cashier:'staff'}]};
 const staff=privacy.staffReport(full);
 assert.deepEqual(staff.products,[{name:'Latte',qty:3,gross:700,adjusted:-20,actual:680}]);
 assert.equal(staff.inStoreExpenses,500);
 assert.equal(staff.depositedAmount,120);
 assert.deepEqual(staff.transactions,[]);
 assert(!JSON.stringify(staff).includes('PRIVATE-001'));
 assert(!JSON.stringify(staff).includes('"costing"'));
 assert(!JSON.stringify(staff).includes('"net"'));
 const staffLines=pdf.salesReportLines(staff,'Staff Sales Report',{
  includeCosting:false,includeTransactions:false
 }).map(x=>x.text).join('\n');
 assert.match(staffLines,/Deposited Amount: PHP 120/);
 assert.match(staffLines,/In-store Expenses \(sold ingredient costs\): PHP 500/);
 assert.doesNotMatch(staffLines,/TRANSACTIONS LOGS|Costing|\bNet\b|PRIVATE-001/);
 const ownerLines=pdf.salesReportLines(full,'Owner Sales Report').map(x=>x.text).join('\n');
 assert.match(ownerLines,/Costing/);
 assert.match(ownerLines,/TRANSACTIONS LOGS/);
 assert.match(ownerLines,/PRIVATE-001/);

 // Component is one direct static page with role-controlled elements.
 assert.match(html,/id="inventoryAuditSection" class="[^"]*\badmin-only hidden\b/);
 assert.match(html,/id="reportCostingSection" class="[^"]*\badmin-only hidden\b/);
 assert.match(html,/id="reportTransactionLogsSection" class="[^"]*\badmin-only hidden\b/);
 assert.match(html,/<th class="num admin-only hidden">Costing<\/th><th class="num admin-only hidden">Net Sales<\/th>/);
 assert.match(html,/id="costingPdf" class="[^"]*\badmin-only hidden\b/);
 assert.match(core,/const auditTask=state\.user\?\.role==='Admin'\?loadMovements\(\):Promise\.resolve\(\)/);
 assert.match(core,/const costingTask=owner\?api\('\/api\/reports\/costing\?'\+qs\):Promise\.resolve\(null\)/);
 assert.match(core,/\['In-store Expenses',r\.inStoreExpenses==null\?'Unavailable':peso\(r\.inStoreExpenses\)/);
 assert.match(core,/\['Deposited Amount',r\.depositedAmount==null\?'Not recorded':peso\(r\.depositedAmount\)/);
 assert.match(core,/if\(!owner\)\{\$\('reportTransactions'\)\.replaceChildren\(\);return;\}/);
 assert.match(legacy,/reportFinancialPrivacy\.staffReport\(report\)/);
 assert.match(legacy,/Ingredient costing reports are Owner\/Admin-only/);
 assert.match(legacy,/Inventory audit is Owner\/Admin-only/);
 assert.match(live,/reportFinancialPrivacy\.staffReport\(full\)/);
 assert.match(live,/Inventory audit is Owner\/Admin-only/);
 assert.match(live,/Ingredient usage and costing are Owner\/Admin-only/);
 assert.match(adapter,/const isStaff=state\.user\?\.role==='User'/);
 assert.match(exporter,/if\(type==='costing'&&!ctx\.admin\)/);
 assert.match(exporter,/includeCosting:ctx\.admin,includeTransactions:ctx\.admin/);
 assert.match(legacy,/includeCosting:franchiseLive\.admin/);

 const start=core.indexOf('  function renderReport(){');
 const end=core.indexOf('  function renderCosting(){',start);
 assert(start>0&&end>start);
 const views=new Map();
 const node=id=>{
  if(!views.has(id))views.set(id,{
   innerHTML:'',textContent:'',replaceChildren(){this.innerHTML='';this.textContent='';},
   querySelectorAll(){return []}
  });
  return views.get(id);
 };
 const esc=x=>String(x??'');
 const peso=x=>'₱'+Number(x??0).toFixed(2);
 const number=(x,places)=>Number(x??0).toFixed(places??0);
 for(const role of ['User','Admin']){
  views.clear();
  const state={user:{role},report:role==='User'?staff:full};
  const render=new Function('state','$','peso','num','esc','reportPageSlice','formatDateTime',
   'viewTransaction','encodeURIComponent',core.slice(start,end)+'return renderReport;')(
    state,node,peso,number,esc,(type,rows)=>rows,()=>'',()=>{},encodeURIComponent);
  render();
  const summary=node('reportSummary').innerHTML,products=node('reportProducts').innerHTML;
  assert.match(summary,/Deposited Amount/);
  assert.match(summary,/In-store Expenses/);
  assert.doesNotMatch(summary,/>Deleted</);
  assert(role==='User'?!products.includes('₱135.00')&&!products.includes('₱545.00'):
   products.includes('₱135.00')&&products.includes('₱545.00'));
  assert(role==='User'?node('reportTransactions').innerHTML==='':
   node('reportTransactions').innerHTML.includes('PRIVATE-001'));
 }
 console.log('PASS cashier report redaction, scoped deposit ledger totals, PDF privacy, Owner retention and UI card labels');
}
run().catch(e=>{console.error(e);process.exitCode=1});
