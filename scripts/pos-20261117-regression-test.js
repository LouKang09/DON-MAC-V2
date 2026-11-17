'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const app=fs.readFileSync(path.join(root,'public/app-core.js'),'utf8');
const nav=fs.readFileSync(path.join(root,'public/nav-hierarchy-v20261117.js'),'utf8');
const payroll=fs.readFileSync(path.join(root,'public/franchise-payroll-v20261117.js'),'utf8');
const plan=fs.readFileSync(path.join(root,'public/plan-dashboard-v1570.js'),'utf8');
const notifications=fs.readFileSync(path.join(root,'public/notifications-campaigns-v20261108.js'),'utf8');
const audit=require('../lib/franchise-audit-cost-attribution');
const insights=require('../lib/franchise-live-plan-dashboard');
assert(html.includes('<section id="view-payroll" class="view admin-only"'));
assert(html.indexOf('id="dmPayrollManager"')>html.indexOf('id="view-payroll"'));
assert(html.indexOf('id="view-payroll"')>html.indexOf('id="view-expenses"'));
assert.match(app,/function selectPosOrderType\(/);
assert.match(app,/button\.addEventListener\('click',\(\)=>selectPosOrderType/);
assert.match(app,/orderType:\$\('posOrderType'\)\.value/);
assert.match(plan,/\/api\/live\/dashboard/);
assert.match(notifications,/\/api\/live\/office-promotions/);
assert.match(nav,/leaf\.dataset\.view=key==='payroll'\?'payroll':'expenses'/);
assert.match(fs.readFileSync(path.join(root,'public/guided-tour-v20261116.js'),'utf8'),/dm-topbar-notification-bell/);
function simulateAudit({workspaceId,branchId,snapshot=true}){
 const ref='BR-C58D16BDE4083C526C';
 const costs=[25.6,13.8,17.2,18.4,16.8,35.4,20.0];
 const movement=costs.map((cost,i)=>({
  ingredientId:i+1,ingredient:'Ingredient '+(i+1),uom:'KG',
  reference:ref,type:'LIVE_SALE',quantityChange:-.1,balanceAfter:4.9
 }));
 const checks=[];
 const db={query:async(sql,args)=>{
  checks.push(args);
  assert.equal(args[0],workspaceId,'queries must never leave the authenticated workspace');
  assert.equal(args[1],branchId,'queries must never leave the chosen branch');
  if(sql.includes('FROM branch_live_sales s JOIN branch_live_sale_items i'))
   return{rows:[{reference:ref,kind:'product',item_id:8,name_snapshot:'MATCHA',
    quantity:10,unit_cost_snapshot:14.72,components_json:'[]'}]};
  if(sql.includes('FROM branch_sale_cost_components c'))
   return{rows:snapshot?costs.map((cost,i)=>({
    reference:ref,ingredient_id:i+1,sold_qty:10,
    cost:branchId===101?cost:cost*2
   })):[]};
  if(sql.includes('FROM branch_recipes r'))return{rows:costs.map((cost,i)=>({
   product_id:8,ingredient_id:i+1,quantity_required:.01,cost_contribution:cost/10
  }))};
  throw Error('Unexpected attribution query '+sql.slice(0,100));
 }};
 return audit.enrich(db,workspaceId,branchId,movement).then(rows=>({rows,checks}));
}
async function main(){
 const actual=await simulateAudit({workspaceId:10,branchId:101});
 const other=await simulateAudit({workspaceId:20,branchId:201});
 const historic=await simulateAudit({workspaceId:10,branchId:101,snapshot:false});
 assert.equal(actual.rows.length,7);
 assert(actual.rows.every(x=>x.quantity===10));
 assert.equal(actual.rows.reduce((s,x)=>s+x.cost,0),147.2);
 assert.equal(other.rows.reduce((s,x)=>s+x.cost,0),294.4);
 assert(actual.rows.every(x=>!x.costEstimated));
 assert(historic.rows.every(x=>x.costEstimated&&x.quantity===10));
 assert.equal(Math.round(historic.rows.reduce((s,x)=>s+x.cost,0)*100),14720);
 const scope={
  workspaceId:10,admin:true,subscriptionPlan:'PRO',subscriptionActive:true
 };
 let stored='';
 const db={query:async(sql,args)=>{
  if(sql.includes('FROM chat_workspace_branches w'))
   return{rows:[{id:101,name:'Mabolo',active:true,address:'',staff_count:1}]};
  if(sql.includes('FROM branch_live_sales s WHERE'))
   return{rows:[{id:'a',branch_id:101,status:'Sold',actual:490,discount_amount:0,
    sold_at:new Date().toISOString()}]};
  if(sql.includes('FROM branch_live_sale_items i JOIN branch_live_sales s'))
   return{rows:[{sale_id:'a',branch_id:101,name_snapshot:'MATCHA',kind:'product',
    quantity:10,line_total:490,sold_at:new Date().toISOString()}]};
  if(sql.includes('SELECT setting_value FROM app_settings'))
   return{rows:stored?[{setting_value:stored}]:[]};
  if(sql.includes('INSERT INTO app_settings')){stored=args[1];return{rows:[]};}
  throw Error('Unexpected Pro dashboard query: '+sql.slice(0,90));
 }};
 const data=await insights.insights(db,scope,null);
 assert.equal(data.plan,'PRO');
 assert.equal(data.pro.today.orders,1);
 assert.equal(data.pro.salesWindow.current,490);
 assert.equal(data.branchIds[0],101);
 await insights.settings(db,scope,'PRO',{order:['pro-sales-growth'],hidden:[]});
 assert.deepEqual((await insights.settings(db,scope,'PRO')).order,['pro-sales-growth']);
 await assert.rejects(insights.settings(db,scope,'BUSINESS'),{status:409});
 const dom=new JSDOM(html,{url:'https://donmacpos.com/',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;
 w.fetch=async()=>({ok:true,json:async()=>({enabled:false,plan:'PRO',message:'Add-on required',
  addon:{fee:0,status:'UNPAID'}})});
 w.donmacAuthenticatedRole='Admin';
 w.eval(nav);
 w.eval(payroll);
 w.donmacPayroll.onLogin({id:9,role:'Admin',username:'Owner'});
 w.donmacNavigateView=view=>{
  w.document.querySelectorAll('.view').forEach(node=>node.classList.toggle('active',node.id==='view-'+view));
  w.document.querySelectorAll('.nav').forEach(node=>node.classList.toggle('active',node.dataset.view===view));
  w.donmacPayroll.onViewChange(view);
 };
 w.document.querySelectorAll('.nav').forEach(node=>node.onclick=()=>w.donmacNavigateView(node.dataset.view));
 const payrollLink=w.document.querySelector('[data-expense-subitem="payroll"]');
 assert(payrollLink,'nested payroll shortcut must exist');
 payrollLink.click();
 assert(w.document.getElementById('view-payroll').classList.contains('active'));
 assert(!w.document.getElementById('view-expenses').classList.contains('active'));
 assert.equal(w.document.getElementById('dmPayrollManager').hidden,false);
 assert(w.document.getElementById('dmPayrollLocked').textContent.includes('Payroll'));
 assert.equal(w.document.querySelector('#view-expenses>.pos-finance-shell').closest('.view').id,'view-expenses');
 w.donmacPayroll.open('ledger');
 assert(w.document.getElementById('view-expenses').classList.contains('active'));
 assert(!w.document.getElementById('view-payroll').classList.contains('active'));
 w.donmacPayroll.onLogout();
 w.close();
 console.log('PASS: POS order-type bindings, scoped plan widgets, per-branch audited cost attribution, and independent payroll navigation');
}
main().catch(e=>{console.error(e);process.exitCode=1});
