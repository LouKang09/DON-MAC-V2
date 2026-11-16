'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const seed=require('../lib/branch-catalog-seeding');
const inspect=require('../lib/franchise-account-inspector');
const sample={
 version:2,
 categories:['Coffee','Non Coffee','Food','Add-ons','Promos','Packages'].map((name,i)=>
  ({name,iconData:'icon-'+i,sortOrder:i,builtin:true,active:true})),
 products:[
  {sourceId:1,name:'Coffee Latte',sku:'COFFEE-1',category:'Coffee',price:100},
  {sourceId:2,name:'Iced Tea',sku:'NON-1',category:'Non Coffee',price:85},
  {sourceId:3,name:'Food Burger',sku:'FOOD-1',category:'Food',price:99}],
 ingredients:[{sourceId:1,code:'MILK',name:'Milk',uom:'ml',threshold:2}],
 recipes:[
  {sourceProductId:1,sourceIngredientId:1,quantityRequired:10,costContribution:5},
  {sourceProductId:3,sourceIngredientId:1,quantityRequired:10,costContribution:5}],
 categoryProducts:[{categoryName:'Coffee',sourceProductId:1},
  {categoryName:'Non Coffee',sourceProductId:2},{categoryName:'Food',sourceProductId:3}],
 addOns:[{sourceId:1,name:'Pearls',price:10}],promos:[{name:'Promotion',price:100}],
 packages:[{sourceId:4,name:'Food Deal',price:99}],
 packageItems:[{sourcePackageId:4,sourceProductId:3,quantity:1}]
};
const starter=seed.starterSubset(sample);
assert.deepEqual(starter.categories.map(x=>x.name),[
 'Coffee','Non Coffee','Add-ons','Food','Promos','Packages']);
assert.deepEqual(starter.products.map(x=>x.name),['Coffee Latte','Iced Tea']);
assert.deepEqual(starter.recipes.map(x=>x.sourceProductId),[1]);
assert.deepEqual(starter.categoryProducts.map(x=>x.sourceProductId),[1,2]);
assert.equal(starter.addOns.length,1);
assert.equal(starter.ingredients.length,sample.ingredients.length,
 'Core recipes must retain the referenced ingredient definitions.');
assert.equal(starter.promos.length,0);
assert.equal(starter.packages.length,0);
assert.equal(starter.packageItems.length,0);
const blueprint=seed.blueprint(sample);
assert.equal(blueprint.food.length,0);
assert.equal(blueprint.promos.length,0);
assert.equal(blueprint.packages.length,0);
assert(blueprint.products.every(x=>x.category!=='Food'));
assert(blueprint.ingredients.every(x=>x.openingStock===0));
const sqls=[];
const mock={async query(sql,args){
 sqls.push({sql,args});
 if(sql.includes('FROM franchise_test_accounts t JOIN public_franchise_requests r'))
  return{rows:[{workspace_id:41,user_id:9,username:'test1',full_name:'Tester',
   email:'test@example.invalid',phone:'000',active:true,data_mode:'NEW',
   plan:'PRO',payment_status:'PAID',next_payment_date:'2026-12-16'}]};
 if(sql.includes('SELECT b.id,b.name,b.active,b.city'))return{rows:[{id:11,name:'Branch One',active:true}]};
 if(sql.includes('FROM chat_memberships cm'))return{rows:[{username:'Cashier',role:'User',active:true,branch_name:'Branch One'}]};
 if(sql.includes('SELECT COUNT(*) AS transactions'))return{rows:[{transactions:2,net:300,gross:320}]};
 if(sql.includes('FROM branch_live_sales s JOIN chat_workspace_branches wb'))return{rows:[{
  reference:'BR-123',sold_at:'2026-11-16T10:00:00Z',actual:300,status:'Sold',payment_mode:'Cash',
  cashier_name_snapshot:'Cashier',branch_name:'Branch One'}]};
 if(sql.includes('FROM branch_ingredients i JOIN chat_workspace_branches wb'))
  return{rows:[{total:14,low:1}]};
 throw Error('Unexpected SQL: '+sql);
}};
(async()=>{
 const result=await inspect.inspect(mock,'11111111-1111-4111-8111-111111111111');
 assert.equal(result.readOnly,true);
 assert.equal(result.workspaceId,41);
 assert.equal(result.sales.net,300);
 assert.equal(result.branches[0].name,'Branch One');
 assert.equal(result.inventory.lowStock,1);
 assert(sqls.every(x=>/^SELECT\b/.test(x.sql)),'Read-only inspection must not mutate franchise data.');
 assert(sqls.every(x=>x.args.includes(41)||x.args.length===1),
  'Every inspection query must be tied to its verified workspace.');
 const old={query:async(sql)=>{
  if(sql.includes('FROM franchise_test_accounts t JOIN public_franchise_requests r'))
   return{rows:[{...{workspace_id:41,user_id:9},data_mode:'SHARED'}]};
  throw Error('Must reject before consulting shared data');
 }};
 await assert.rejects(inspect.inspect(old,'11111111-1111-4111-8111-111111111111'),{status:409});
 const html=fs.readFileSync('public/platform-admin.html','utf8');
 const ui=fs.readFileSync('public/platform-admin.js','utf8');
 const auth=fs.readFileSync('lib/platform-admin-auth.js','utf8');
 const css=fs.readFileSync('public/main-pos-shell-layout-v20261116.css','utf8');
 const categories=fs.readFileSync('lib/franchise-live-catalog.js','utf8');
 assert(!html.includes('<th>Starter Catalog</th>'));
 assert(html.includes('<th>Requested / Assigned Plan</th>'));
 assert(html.includes('id="franchiseInspectorDialog"'));
 assert(ui.includes('data-review-action'));
 assert(ui.includes('Open account (view only)'));
 assert(ui.includes('nextMonthlyDate()'));
 assert(ui.includes('defaultBase(plan){return plan===\'BUSINESS\'?2599:1499;}'));
 assert(ui.includes("data-request-test"));
 assert(auth.includes('/create-account'));
 assert(auth.includes('franchiseAccountInspector.inspect'));
 assert(auth.includes('franchiseStaging.prepare'));
 assert(css.includes('.dash-summary-icon svg'));
 assert(css.includes('#app #appVersion'));
 assert(categories.includes('async function saveCategory'));
 console.log('PASS: simplified applications, editable subscription defaults, read-only scoped inspection, core starter catalog and compact Main POS KPI icons.');
})().catch(e=>{console.error(e);process.exitCode=1;});
