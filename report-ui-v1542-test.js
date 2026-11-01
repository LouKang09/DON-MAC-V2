const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html=fs.readFileSync('public/index.html','utf8');
const core=fs.readFileSync('public/app-core.js','utf8');
const server=fs.readFileSync('server.js','utf8');
const css=fs.readFileSync('public/owner-sales-v1542.css','utf8');
const nav=fs.readFileSync('public/pos-refresh.js','utf8');
const loader=fs.readFileSync('public/app.js','utf8');

for (const [id,count] of [
  ['topbarUsername',1],['topbarRole',1],['sidebarToggle',1],
  ['reportCashierSelect',1],['reportCashierAll',1],['reportCashierList',1],
  ['reportCashierDone',1],['reportSummary',1],['salesPdf',1],['costingPdf',1],
]) {
  assert.equal([...html.matchAll(new RegExp('id="'+id+'"','g'))].length,count,
    id+' is missing or duplicated');
}
assert(!html.includes('id="currentUser"') && !html.includes('id="currentRole"'),
  'Redundant sidebar account details must be removed');
assert(html.includes('class="topbar-logo"') && html.includes('donmac-logo-hires.svg'),
  'Don Mac logo must be in the top bar');
assert(html.indexOf('topbar-logo') > html.indexOf('<main class="main">'),
  'Logo still appears in the sidebar');
assert(html.includes('>Sales Report</span></button>'));
assert(html.includes('>Costing Report</span></button>'));
assert(!html.includes('>Download Sales Report') && !html.includes('>Download Costing Report'));
assert(/M4 6h16M4 12h16M4 18h16/.test(nav),
  'Sidebar collapse should display three horizontal lines');
assert(core.includes("'Owner/Admin'"));
assert(core.includes("'Co-Owner/Admin'"));
assert(core.includes("['All Transactions'"));
assert(core.includes("['Gross Sales'"));
assert(core.includes("['Discounts'"));
assert(core.includes("['Net Sales'"));
assert(core.includes("['Gross Profit'"));
assert(core.includes("['Refund'"));
assert(core.includes("['Deleted'"));
assert(core.includes('JSON.stringify([...reportCashierUI.selected])'),
  'Cashier multiselect must be transmitted as a complete array');
assert(core.includes("loadReportCashiers()") && core.includes("reportCashierList"));
assert(core.includes("if(view==='reports'){loadReportCashiers();loadReport();}"));
assert(core.includes("loadReportCashiers(true)"),
  'Branch changes must refresh eligible cashiers');
assert(loader.includes('ownerSalesV1542Css'));
assert(css.includes('.report-cashier-popover') && css.includes('.report-metric-grid'));

const money=n=>Math.round((Number(n)+Number.EPSILON)*100)/100;
const normalize=s=>String(s||'').trim().replace(/\s+/g,' ').toUpperCase();
function extract(start,next){
  const first=server.indexOf(start);
  const last=server.indexOf(next,first);
  assert(first>=0 && last>first,'Server helper missing: '+start);
  return server.slice(first,last);
}
const testSales=[
  {id:1,cashier_name_snapshot:'Ana, Jr.',sold_at:'2026-11-02T01:00:00Z',
   status:'Sold',branch_id:1,gross:200,adjustment:-20,actual:180,
   discount_amount:20,promo_id:null,remark:null},
  {id:2,cashier_name_snapshot:'Ana, Jr.',sold_at:'2026-11-02T02:00:00Z',
   status:'Deleted',branch_id:1,gross:130,adjustment:-10,actual:120,
   discount_amount:10,promo_id:null,remark:'Voided'},
  {id:3,cashier_name_snapshot:'Second Cashier',sold_at:'2026-11-02T03:00:00Z',
   status:'Sold',branch_id:1,gross:70,adjustment:0,actual:70,
   discount_amount:0,promo_id:null,remark:null},
  {id:4,cashier_name_snapshot:'Other Branch',sold_at:'2026-11-02T04:00:00Z',
   status:'Sold',branch_id:2,gross:100,adjustment:0,actual:100,
   discount_amount:0,promo_id:null,remark:null},
];
const items=[
  {id:101,sale_id:1,product_id:7,add_on_id:null,package_id:null,
   product_name_snapshot:'Coffee A',quantity:2,line_total:200,is_add_on:false,is_package:false},
  {id:102,sale_id:3,product_id:8,add_on_id:null,package_id:null,
   product_name_snapshot:'Coffee B',quantity:1,line_total:70,is_add_on:false,is_package:false},
  {id:103,sale_id:4,product_id:8,add_on_id:null,package_id:null,
   product_name_snapshot:'Coffee B',quantity:1,line_total:100,is_add_on:false,is_package:false},
];
const db={
  async query(sql,params=[]){
    if(sql.includes('SELECT username AS cashier FROM users')) {
      const accounts=[
        {username:'Ana, Jr.',role:'User',branchId:1},
        {username:'Second Cashier',role:'User',branchId:1},
        {username:'Other Branch',role:'User',branchId:2},
        {username:'The Owner',role:'Admin',branchId:1},
        {username:'The Co-Owner',role:'Admin',branchId:1}
      ];
      const scoped=sql.includes('branch_id=$2');
      const rows=accounts.filter(x=>x.role===params[0]&&(!scoped||x.branchId===params[1]))
        .map(x=>({cashier:x.username}));
      return {rows};
    }
    if(sql.includes('FROM sales s LEFT JOIN promos'))return {rows:testSales};
    if(sql.includes('FROM sale_items WHERE sale_id IN'))return {rows:items.filter(x=>params.includes(x.sale_id))};
    throw Error('Unexpected SQL: '+sql);
  }
};
const sandbox={db,Date,Intl,Set,Map,Number,String,JSON,Math,
 money,normalize,MANILA_TZ:'Asia/Manila',
 productUnitCosts:async()=>new Map([[7,30],[8,20]]),
 placeholders:(offset,n)=>Array.from({length:n},(_,i)=>'$'+(i+offset)).join(','),
 bool:x=>Boolean(x),
};
const source=[
 extract('function manilaDateString','async function productUnitCosts'),
 extract('async function periodSales','async function productUnitCosts'),
 extract('async function salesReport','async function getSaleDetail')
].join('\n');
vm.runInNewContext(source,sandbox);

(async()=>{
 const params=sandbox.reportParams({
   period:'daily',date:'2026-11-02',
   cashiers:JSON.stringify(['Ana, Jr.','Second Cashier'])
 });
 assert.equal(params.cashiers.length,2);
 assert.equal(params.cashiers[0],'ANA, JR.');
 assert.equal(params.cashiers[1],'SECOND CASHIER');
 const withSelection=await sandbox.salesReport({
   period:'daily',date:'2026-11-02',
   branchId:1,cashiers:JSON.stringify(['Ana, Jr.','Second Cashier'])
 });
 assert.equal(withSelection.allTransactionCount,3,
   'All Transactions must count voided sales too');
 assert.equal(withSelection.transactionCount,2);
 assert.equal(withSelection.deletedCount,1);
 assert.equal(withSelection.gross,270);
 assert.equal(withSelection.discounts,20);
 assert.equal(withSelection.actual,250);
 assert.equal(withSelection.grossProfit,170,
   'Gross Profit = Net Sales minus reported product costs (80)');
 assert.equal(withSelection.refund,120,'Refund represents voided paid sale value');
 assert.equal(withSelection.transactions.length,3);
 assert.equal(withSelection.products.length,2);
 const one=await sandbox.salesReport({period:'daily',date:'2026-11-02',branchId:1,
   cashiers:JSON.stringify(['Ana, Jr.'])});
 assert.equal(one.allTransactionCount,2);
 assert.equal(one.refund,120);
 const legacy=await sandbox.salesReport({period:'daily',date:'2026-11-02',branchId:1,cashier:'Second Cashier'});
 assert.equal(legacy.allTransactionCount,1);
 assert.equal(legacy.grossProfit,50);
 const list=await sandbox.reportCashierChoices(1);
 assert.deepEqual([...list.cashiers],['Ana, Jr.','Second Cashier']);
 const noCross=await sandbox.reportCashierChoices(2);
 assert.deepEqual([...noCross.cashiers],['Other Branch']);
 assert.throws(()=>sandbox.reportParams({date:'2026-11-02',cashiers:'invalid'}),/Invalid cashier selection/);
 assert.throws(()=>sandbox.reportParams({date:'2026-11-02',cashiers:'{"a":1}'}),/Choose up to 200/);
 console.log('Don Mac v1.5.42 Sales Report + cashier multiselect checks passed.');
})().catch(err=>{console.error(err);process.exitCode=1;});
