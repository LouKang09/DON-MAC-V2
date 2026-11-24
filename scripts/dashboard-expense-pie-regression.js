'use strict';
// Run: node scripts/dashboard-expense-pie-regression.js
// Complete expense-category aggregation must not depend on the visible page.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const categories=['rent','stocks','salary','transportation','electricity','ice','water','misc'];
const sum=rows=>Object.fromEntries(categories.map(cat=>[cat,rows.reduce((n,r)=>n+Number(r[cat]||0),0)]));
const userRole={workspaceId:99,admin:true,branchId:7,subscriptionActive:true,permissions:['expenses.view']};
const allBranches=[{id:7,name:'Main'},{id:8,name:'North'}];
const scope={
 requirePaid:()=>{},fail:(message,status)=>Object.assign(new Error(message),{status}),
 branches:async()=>allBranches,
 branch:async(_db,_ctx,id)=>{const x=allBranches.find(r=>r.id===Number(id));if(!x)throw Error('Unauthorized branch');return x;}
};
const liveModule={exports:{}};
function mockedRequire(name){
 if(name==='node:crypto')return require('node:crypto');
 if(name==='./franchise-live-scope')return scope;
 if(name==='./cashier-access')return{windowDays:()=>30};
 throw Error('Unsupported dependency '+name);
}
new Function('require','module','exports',read('lib/franchise-live-finance.js'))(
 mockedRequire,liveModule,liveModule.exports
);
const records=Array.from({length:17},(_,i)=>({
 branch_id:i<12?7:8,date:'2026-11-'+String((i%17)+1).padStart(2,'0'),
 ...Object.fromEntries(categories.map(cat=>[cat,0])),
 rent:100,stocks:i%2?25:0,salary:10
}));
const db={query:async(sql,args)=>{
 if(sql.includes('SELECT branch_id,substr(incurred_at,1,10)'))return{rows:records.filter(x=>
  !args.includes(7)&&!args.includes(8)||args.includes(x.branch_id))};
 throw Error('Unexpected query '+sql.slice(0,200));
}};
const params=page=>({get:key=>({start:'2026-11-01',end:'2026-11-20',page:String(page)}[key]||null)});
(async()=>{
 const first=await liveModule.exports.expenses(db,userRole,params(1));
 const second=await liveModule.exports.expenses(db,userRole,params(2));
 assert.equal(first.total,17);
 assert.equal(first.rows.length,10);
 assert.equal(second.rows.length,7);
 const expected=sum(records);
 for(const cat of categories){
  assert.equal(first.summary[cat],expected[cat]);
  assert.equal(second.summary[cat],expected[cat]);
 }
 assert.equal(first.grandTotal,records.reduce((n,r)=>n+r.rent+r.stocks+r.salary,0));
 const sandbox={window:{},Intl,Number,Math,String,Object};
 vm.runInNewContext(read('public/expense-pie-chart-v20261125.js'),sandbox);
 const pie=sandbox.window.donmacExpensePie;
 assert(pie,'Pie component missing');
 assert.equal(pie.tidy(first.summary).total,first.grandTotal);
 const html=pie.markup(first.summary);
 assert.match(html,/dm-expense-pie-slice/);
 assert.match(html,/dm-expense-pie-legend-row/);
 assert.match(html,/data-dm-exp-pie-share=/);
 assert.match(html,/Rent/);
 assert.match(html,/Stocks/);
 assert.match(html,/Salary/);
 assert.doesNotMatch(html,/undefined|NaN/);
 assert.match(pie.markup({}),/No recorded expenses/);
 const shell=read('public/index.html'),ui=read('public/dashboard-kpi-drilldown-v20261118.js'),
  finance=read('public/pos-finance.js'),style=read('public/expense-pie-chart-v20261125.css');
 assert.match(shell,/financeExpenseCategoryChart/);
 assert.match(shell,/expense-pie-chart-v20261125\.js/);
 assert.match(finance,/window\.donmacExpensePie\.markup\(data\.summary\)/);
 assert.match(finance,/window\.donmacExpensePie\.mount\(chart\)/);
 assert.match(ui,/window\.donmacExpensePie\?\.markup\(summary\)/);
 assert.match(ui,/window\.donmacExpensePie\?\.mount\(host\)/);
 assert.match(ui,/Store Expenses Sold Ingredients \/ Cost of Goods/);
 assert.match(ui,/\['Store Expenses',fmt\(d.rangeDepositExpenses\)\]/);
 assert.match(ui,/\['Sales Deposit Actual'/);
 assert.match(ui,/\['Gross Revenue',money\(d.rangeGross\)\]/);
 assert.doesNotMatch(ui,/ingredientCostPanel\(main\)/);
 assert.match(ui,/key!=='expenses'\)body\+=timelinePanel/);
 assert.match(ui,/viewBox="0 0 24 24" focusable="false"/);
 assert.match(style,/#dmKpiDetail \.dm-category-caret svg/);
 console.log('PASS page-independent expense category totals, pie interactions, dashboard and ledger integration');
})().catch(e=>{console.error(e);process.exitCode=1});
