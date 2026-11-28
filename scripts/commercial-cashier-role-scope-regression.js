'use strict';
// Mocked database regression: no connection to production is used.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const sales=require('../lib/franchise-live-sales');
const scope=require('../lib/franchise-live-scope');
const financial=require('../lib/dashboard-financial-metrics');
const privacy=require('../lib/report-financial-privacy');
const exporter=require('../lib/franchise-live-report-exports');
const grants=require('../lib/cashier-access');
const historical=require('../lib/historical-sales-access');
async function run(){
 const origBranch=scope.branch,origPaid=scope.requirePaid,origGrants=grants.forUser;
 const ctx={workspaceId:11,branchId:4,userId:42,admin:false,cashier:true,permissions:['reports.view','report.window.day']};
 const calls=[];
 const db={query:async(sql,args)=>{calls.push({sql,args});return{rows:[]}}};
 scope.branch=async(_,context,id)=>({id});scope.requirePaid=()=>{};
 grants.forUser=async()=>ctx.permissions;
 try{
  await sales.report(db,ctx,{range:'day'});
  assert.equal(calls.length,5);
  assert(calls.every(x=>x.sql.includes('cashier_user_id=$6')&&x.args[5]===42));
  calls.length=0;
  await sales.report(db,{...ctx,admin:true},{range:'day'});
  assert.equal(calls.length,5);
  assert(calls.every(x=>!x.sql.includes('cashier_user_id=$6')&&x.args.length===5));
  await assert.rejects(()=>sales.report(db,ctx,{range:'week'}),{status:403});
  await assert.rejects(()=>sales.report(db,ctx,{range:'day',date:'2020-01-01'}),{status:403});
  calls.length=0;
  await financial.liveIngredientCost(db,11,[4],'2026-11-28T00:00:00Z','2026-11-29T00:00:00Z',42);
  await privacy.depositedAmount(db,{workspaceId:11,branchId:4,from:'2026-11-28',to:'2026-11-29',cashierUserId:42});
  assert.equal(calls.length,3);
  assert(calls.every(x=>x.args.at(-1)===42));
  assert.match(calls[0].sql,/s\.cashier_user_id=\$6/);
  assert.match(calls[2].sql,/d\.user_id=\$5/);
  const user={id:42,role:'User',username:'staff'};
  const selection=await exporter.reportScope(db,ctx,user,new URLSearchParams({period:'daily',date:historical.today(),branchId:'99',cashiers:'["other"]'}));
  assert.equal(selection.branch.id,4);assert.equal(selection.cashierUserId,42);assert.deepEqual(selection.cashiers,[]);
  await assert.rejects(()=>exporter.reportScope(db,ctx,user,new URLSearchParams({period:'monthly'})),{status:403});
  await assert.rejects(()=>exporter.reportScope(db,ctx,user,new URLSearchParams({period:'daily',date:'2020-01-01'})),{status:403});
  const staff=privacy.staffReport({transactions:[{private:1}],products:[{name:'A',costing:2,net:3}],expenses:3,netAfterExpenses:6});
  assert.equal(staff.transactions.length,0);assert.equal(staff.products[0].costing,undefined);assert.equal(staff.netAfterExpenses,undefined);
  const html=read('public/index.html'),core=read('public/app-core.js'),css=read('public/donmac-commercial-phase2-v1.css');
  assert.match(html,/id="reportCashierField" class="[^"]*admin-only hidden/);
  assert.match(core,/\$\('reportCashierField'\)\.inert=!isAdmin/);
  assert.match(css,/html\.dm-cashier-role #app #view-reports/);
  console.log('PASS cashier-specific report SQL, dates, deposit scope, PDF scope, owner access and shared role controls');
 }finally{scope.branch=origBranch;scope.requirePaid=origPaid;grants.forUser=origGrants;}
}
run().catch(e=>{console.error(e);process.exitCode=1});
