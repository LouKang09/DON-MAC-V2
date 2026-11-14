'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const bridge=require('../lib/marlou-checkout-stock-bridge');
const source=fs.readFileSync('server.js','utf8');
const start=source.indexOf('async function getCatalog('),end=source.indexOf('\nfunction validateCartInput(',start);
assert(start>0&&end>start,'Production catalog implementation should be extractable for isolated API contract test');
const code=source.slice(start,end)+'\ngetCatalog;';
let branchBalance=0,branchThreshold=1;
const normalize=s=>String(s||'').trim().replace(/\s+/g,' ').toUpperCase();
const bool=x=>x===true||x===1||x==='1'||x==='true';
const getCatalog=vm.runInNewContext(code,{
 bool,normalize,marlouCheckoutStockBridge:{originalWorkspace:async(_,workspace)=>Number(workspace)===1},
 officePromotions:{forWorkspace:async()=>[]},
 listPosCategories:async()=>[],
});
const legacy=[
 {id:51,sku:'CUSTOM-TEST1',name:'test1',category:'Coffee',price:99,image_data:null,active:true}
];
function mock(){
 return{query:async(sql,args=[])=>{
  if(sql.includes('FROM products WHERE active='))return{rows:legacy};
  if(sql.includes('FROM add_ons WHERE active='))return{rows:[]};
  if(sql.includes('FROM promos WHERE active='))return{rows:[]};
  if(sql.includes('FROM packages WHERE active='))return{rows:[]};
  if(sql.includes('FROM product_ingredients pi JOIN ingredients i'))return{rows:[{
   product_id:51,ingredient_id:81,quantity_required:.5,code:'BEANS-01',
   display_name:'Fresh Coffee Beans',uom:'KG',stock_qty:5,low_stock_threshold:1,active:true
  }]};
  if(sql.includes('FROM package_items pi JOIN products p'))return{rows:[]};
  if(sql.includes('SELECT 1 FROM chat_workspace_branches'))return{rows:Number(args[0])===1&&Number(args[1])===101?[{x:1}]:[]};
  if(sql.includes('FROM branch_ingredients'))return{rows:[{
   code:'BEANS-01',uom:'KG',stock_qty:branchBalance,
   low_stock_threshold:branchThreshold,active:true
  }]};
  throw Error('Unmocked catalog SQL: '+sql);
 }};
}
async function run(){
 branchBalance=0;
 let c=await getCatalog(mock(),1,101);
 let p=c.products[0];
 assert.equal(p.name,'test1');
 assert.equal(p.available,false,'Newly created product must disable when actual branch stock is zero');
 assert.equal(p.availabilityStatus,'insufficient_stock');
 assert.equal(p.recipeStock[0].current,0);
 assert.equal(p.recipeStock[0].required,.5);
 assert.equal(p.availabilityDetails[0].status,'out_of_stock');

 branchBalance=.75;
 c=await getCatalog(mock(),1,101);p=c.products[0];
 assert.equal(p.available,true);
 assert.equal(p.recipeStock[0].current,.75);
 assert.equal(p.stockWarnings.length,1,'Low branch stock warning must appear before complete depletion');
 assert.equal(p.stockWarnings[0].current,.75);

 branchBalance=10;branchThreshold=0;
 c=await getCatalog(mock(),1,101);p=c.products[0];
 assert.equal(p.recipeStock[0].current,5,'When branch has 10 but legacy checkout has 5, only 5 is sellable');

 // Non-original workspaces remain on their existing checkout stock source;
 // no other tenant's branch stock is read by this narrow compatibility bridge.
 c=await getCatalog(mock(),2,201);
 assert.equal(c.products[0].recipeStock[0].current,5);
 assert.equal(c.products[0].available,true);

 const reqs=[{ingredientId:81,needed:1,name:'Fresh Coffee Beans'}];
 const previewDb={query:async(sql,args=[])=>{
  if(sql.includes('FROM chat_workspaces w JOIN users o'))return{rows:[{x:1}]};
  if(sql.startsWith('SELECT 1 FROM chat_workspace_branches'))return{rows:[{x:1}]};
  if(sql.startsWith('SELECT 1 FROM branch_catalog_provisioning'))return{rows:[{x:1}]};
  if(sql.includes('FROM ingredients i LEFT JOIN branch_ingredients b'))return{rows:[{
    legacy_id:81,code:'BEANS-01',legacy_uom:'KG',branch_ingredient_id:128,
    display_name:'Fresh Coffee Beans',branch_uom:'KG',stock_qty:branchBalance,active:true
  }]};
  throw Error('Unmocked preview SQL: '+sql);
 }};
 branchBalance=0;
 await assert.rejects(bridge.previewSale(previewDb,{workspaceId:1,branchId:101,requirements:reqs}),
  e=>e.status===409&&/Fresh Coffee Beans/.test(e.message)&&e.details?.shortages?.length===1);
 branchBalance=2;
 const ok=await bridge.previewSale(previewDb,{workspaceId:1,branchId:101,requirements:reqs});
 assert.equal(ok.checked,true);
 assert.equal(ok.shortages.length,0);
 console.log('PASS: new product catalog availability, low-stock warnings, branch checkout source, and quote preflight.');
}
run().catch(e=>{console.error(e);process.exitCode=1});
