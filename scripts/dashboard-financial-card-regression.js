'use strict';
// Financial KPI semantics are different from the raw POS/expense ledgers.
// Run: node scripts/dashboard-financial-card-regression.js
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const source=file=>fs.readFileSync(path.join(root,file),'utf8');
const financial=require('../lib/dashboard-financial-metrics');

assert.equal(financial.revenueAfterCost(1500,450),1050);
assert.equal(financial.salesAfterExpenses(600,60),540);
assert.equal(financial.totalStoreExpenses(450,125),575);
assert.equal(financial.revenueAfterCost(50,80),-30); // Never clip a real loss.
assert.equal(financial.revenueAfterCost(100,null),null);
assert.equal(financial.salesAfterExpenses(100,null),null);
assert.equal(financial.totalStoreExpenses(100,null),null);
assert.equal(financial.totalStoreExpenses(0,0),0);

const unified=source('lib/franchise-unified-dashboard.js');
const server=source('server.js');
const drill=source('public/dashboard-kpi-drilldown-v20261118.js');
assert.match(unified,/todayExpenseRows/);
assert.match(unified,/isoStart\(today\),isoStart\(dateAdd\(today,1\)\)/);
assert.match(unified,/rangeRevenueNet:financial.revenueAfterCost\(rangeTotal.actual,ingredientCost\)/);
assert.match(unified,/rangeTotalStoreExpenses:financial.totalStoreExpenses\(ingredientCost,depositExpenses\)/);
assert.match(unified,/rangeDepositedSales:depositExpenses/);
assert.match(unified,/todayNetAfterExpenses:financial.salesAfterExpenses\(todayTotal.actual,todayExpenses\)/);
assert.match(server,/todayNetAfterExpenses:dashboardFinancials.salesAfterExpenses\(todayR.actual,todayExpenses\)/);
assert.match(server,/rangeTotalStoreExpenses:dashboardFinancials.totalStoreExpenses\(ingredientCost,totalExpenses\)/);
assert.match(server,/rangeDepositedSales:totalExpenses/);
assert.match(drill,/expenses:'Total Store Expenses'/);
assert.match(drill,/today:m.todayNetAfterExpenses/);
assert.match(drill,/revenue:d\?\.rangeRevenueNet/);
assert.match(drill,/expenses:d\?\.rangeTotalStoreExpenses/);

const script=source('public/app-core.js');
const from=script.indexOf('  function renderDashboard(){');
const to=script.indexOf('  function setupCanvas(',from);
assert(from>=0&&to>from,'Dashboard renderer must exist');
const renderCode=script.slice(from,to);
const elements=new Map();
const node=id=>{
 if(!elements.has(id))elements.set(id,{
  textContent:'',innerHTML:'',
  querySelectorAll:()=>[],
  setAttribute(){},
  querySelector(){return null}
 });
 return elements.get(id);
};
const windowObj={
 donmacBusinessStore:{sync(){}},
 donmacDashboardDrilldown:{sync(){}},
 donmacPlanWidgets:{render(){}},
 donmacDashboardFilters:{refresh(){}}
};
const peso=n=>'₱'+Number(n).toFixed(2);
const num=n=>String(Number(n)||0);
const esc=v=>String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const dashboard={
 from:'2026-11-23',to:'2026-11-23',grain:'hourly',
 rangeActual:1500,rangeGross:1660,rangeRevenueNet:1050,
 rangeStoreExpenses:450,rangeDepositExpenses:125,rangeTotalStoreExpenses:575,
 rangeTransactions:9,rangeDiscount:160,rangeDepositedSales:125,
 metrics:{todayActual:600,todayGross:670,todayExpenses:60,todayNetAfterExpenses:540,
  todayTransactions:4,monthActual:6000,monthGross:6300,monthTransactions:47,
  lowStockCount:1,inventoryCount:18},
 lowStock:[],categorySales:[],trend:[],recentTransactions:[]
};
const renderFor=role=>{
 elements.clear();
 const state={dashboard,user:{role,accessPermissions:[],liveMode:true},
  branches:[]};
 const render=new Function('state','$','peso','num','esc','window','sessionGeneration',
  renderCode+';return renderDashboard;')(state,node,peso,num,esc,windowObj,1);
 render();
 return node('dashboardSummary').innerHTML;
};
const owner=renderFor('Admin');
assert.equal((owner.match(/data-dm-kpi="/g)||[]).length,8);
assert.match(owner,/>Total Revenue</);
assert.match(owner,/>₱1050\.00</);
assert.match(owner,/Cost Amount:<b>₱450\.00<\/b>/);
assert.match(owner,/Store Expenses:<b>₱125\.00<\/b>/);
assert.match(owner,/>Total Store Expenses</);
assert.match(owner,/>₱575\.00</);
assert.match(owner,/>Today Sales</);
assert.match(owner,/>₱540\.00</);
assert.match(owner,/>Net sales - staff-entered sales</);
assert.match(owner,/data-dm-kpi="deposited"[\s\S]*?<strong>₱125\.00<\/strong>/);
const cashier=renderFor('User');
assert.equal((cashier.match(/data-dm-kpi="/g)||[]).length,7);
assert.doesNotMatch(cashier,/Allowed Period Revenue|Month Revenue/);
assert.match(cashier,/data-dm-kpi="revenue"/);
assert.match(cashier,/data-dm-kpi="expenses"/);
console.log('PASS dashboard financial cards, formulas, 8 owner/7 cashier cards');
