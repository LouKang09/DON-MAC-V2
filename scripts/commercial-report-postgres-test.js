'use strict';
// Disposable PostgreSQL service only: verify executed SQL against seeded records,
// not just SQL-string assertions. Never use the production DATABASE_URL.
const assert=require('node:assert/strict');
const {Client}=require('pg');
const scope=require('../lib/franchise-live-scope');
const sales=require('../lib/franchise-live-sales');
const costing=require('../lib/franchise-live-costing');
const finance=require('../lib/dashboard-financial-metrics');
const privacy=require('../lib/report-financial-privacy');
const selection=require('../lib/report-cashier-scope');
const history=require('../lib/historical-sales-access');
const exportsModule=require('../lib/franchise-live-report-exports');
const access=require('../lib/cashier-access');
async function run(){
 if(!process.env.COMMERCIAL_TEST_DATABASE_URL||process.env.GITHUB_ACTIONS!=='true')throw Error('This test requires the disposable CI PostgreSQL database.');
 const db=new Client({connectionString:process.env.COMMERCIAL_TEST_DATABASE_URL});
 await db.connect();
 const oldBranch=scope.branch,oldPaid=scope.requirePaid,oldGrants=access.forUser;
 const today=history.today(),when=new Date(today+'T10:00:00+08:00').toISOString(),start=history.start(today),end=new Date(Date.parse(start)+86400000).toISOString();
 try{
  await db.query('CREATE TEMP TABLE users(id bigint,username text,role text); CREATE TEMP TABLE chat_memberships(user_id bigint,workspace_id bigint); CREATE TEMP TABLE chat_workspace_branches(workspace_id bigint,branch_id bigint); CREATE TEMP TABLE platform_account_plans(workspace_id bigint,plan text);');
  await db.query('CREATE TEMP TABLE branch_live_sales(id text,reference text,workspace_id bigint,branch_id bigint,cashier_user_id bigint,cashier_name_snapshot text,status text,sold_at text,actual numeric,gross numeric,adjustment numeric,discount_amount numeric,payment_mode text,remark text);');
  await db.query('CREATE TEMP TABLE branch_live_sale_items(id text,sale_id text,workspace_id bigint,branch_id bigint,name_snapshot text,quantity numeric,line_total numeric,unit_cost_snapshot numeric,kind text,item_id bigint,components_json text); CREATE TEMP TABLE branch_live_sale_promos(sale_id text,workspace_id bigint,branch_id bigint,promo_name_snapshot text,gross numeric,adjustment numeric,actual numeric);');
  await db.query('CREATE TEMP TABLE office_campaign_live_sales(sale_id text,workspace_id bigint,branch_id bigint,campaign_id bigint,quantity numeric); CREATE TEMP TABLE office_campaigns(id bigint,title text);');
  await db.query('CREATE TEMP TABLE branch_sale_cost_components(sale_id text,workspace_id bigint,branch_id bigint,ingredient_id bigint,ingredient_name text,uom text,product_name text,product_qty numeric,recipe_qty numeric,usage_qty numeric,cost_per_item numeric,total_cost numeric); CREATE TEMP TABLE branch_inventory_movements(reference text,workspace_id bigint,branch_id bigint,ingredient_id bigint,quantity_change numeric,movement_type text); CREATE TEMP TABLE branch_ingredients(id bigint,workspace_id bigint,branch_id bigint,display_name text,uom text);');
  await db.query('CREATE TEMP TABLE franchise_shift_deposits(workspace_id bigint,branch_id bigint,user_id bigint,work_day text,amount_centavos bigint);');
  await db.query("INSERT INTO users VALUES (1,'owner','Admin'),(42,'alice','User'),(43,'bob','User'),(99,'other','User'); INSERT INTO chat_memberships VALUES(1,11),(42,11),(43,11),(99,22); INSERT INTO chat_workspace_branches VALUES(11,4),(11,5),(22,9); INSERT INTO platform_account_plans VALUES(11,'PRO'),(22,'PRO');");
  const rows=[['a',11,4,42,'alice',100,20],['b',11,4,43,'bob',200,40],['c',11,5,42,'alice',300,60],['d',22,9,99,'other',900,180]];
  for(const [id,ws,branch,user,name,amount,cost] of rows){
   await db.query("INSERT INTO branch_live_sales VALUES($1,$1,$2,$3,$4,$5,'Sold',$6,$7,$7,0,0,'Cash','')",[id,ws,branch,user,name,when,amount]);
   await db.query("INSERT INTO branch_live_sale_items VALUES($1,$1,$2,$3,'Latte',1,$4,$5,'product',1,'[]')",[id,ws,branch,amount,cost]);
   await db.query("INSERT INTO branch_sale_cost_components VALUES($1,$2,$3,1,'Coffee','g','Latte',1,10,10,$4,$4)",[id,ws,branch,cost]);
   await db.query('INSERT INTO franchise_shift_deposits VALUES($1,$2,$3,$4,$5)',[ws,branch,user,today,amount*100]);
  }
  scope.branch=async(_,ctx,id)=>{if(!ctx.admin&&id!==ctx.branchId)throw Object.assign(Error('Branch denied'),{status:403});return{id,name:'Test branch'}};
  scope.requirePaid=()=>{};
  access.forUser=async()=>['reports.view','report.window.day'];
  const owner={admin:true,workspaceId:11,branchId:4,userId:1};
  const staff={admin:false,cashier:true,workspaceId:11,branchId:4,userId:42,permissions:['reports.view','report.window.day']};
  const alice=await selection.resolve(db,owner,['alice']);assert.deepEqual(alice,[42]);
  const both=await selection.resolve(db,owner,['alice','bob']);assert.deepEqual(both.sort(),[42,43]);
  await assert.rejects(()=>selection.resolve(db,owner,['other']),{status:403});
  assert.equal((await sales.report(db,owner,{range:'day',cashierIds:alice})).actual,100);
  assert.equal((await sales.report(db,owner,{range:'day',cashierIds:both})).actual,300);
  assert.equal((await sales.report(db,staff,{range:'day',cashierIds:[43]})).actual,100);
  assert.equal((await sales.report(db,owner,{range:'day',cashierIds:[]})).actual,0);
  assert.equal((await costing.report(db,owner,4,start,end,alice)).totalCost,20);
  assert.equal(await finance.liveIngredientCost(db,11,[4],start,end,both),60);
  const tomorrow=new Date(Date.parse(today+'T00:00:00Z')+86400000).toISOString().slice(0,10);
  assert.equal((await privacy.depositedAmount(db,{workspaceId:11,branchId:4,from:today,to:tomorrow,cashierUserId:alice})).amount,100);
  const pdf=await exportsModule.pdfReport(db,owner,{id:1,role:'Admin',username:'owner'},new URLSearchParams({period:'daily',date:today,branchId:'4',cashiers:'["alice"]'}),'sales');
  assert.equal(pdf.buffer.subarray(0,4).toString(),'%PDF');
  console.log('PASS actual PostgreSQL selected-owner and cashier sales isolation, ingredients, deposits, cross-franchise denial and PDF generation');
 }finally{scope.branch=oldBranch;scope.requirePaid=oldPaid;access.forUser=oldGrants;await db.end();}
}
run().catch(e=>{console.error(e);process.exitCode=1});
