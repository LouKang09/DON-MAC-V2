'use strict';
const assert=require('node:assert/strict'),reader=require('../lib/branch-catalog-read');
const queries=[];
const db={async query(sql,args=[]){
 queries.push({sql,args});
 if(sql.startsWith('SELECT 1 FROM chat_workspace_branches'))
   return{rows:args[0]===1&&args[1]===101?[{ok:1}]:[]};
 if(sql.startsWith('SELECT 1 FROM branch_catalog_provisioning'))return{rows:[{ok:1}]};
 if(sql.includes('FROM branch_products ')&&!sql.includes('JOIN'))return{rows:[
  {id:5,sku:'COF-1',name:'Espresso',category:'Coffee',price:'55',image_data:null,active:true}]};
 if(sql.includes('FROM branch_recipes r JOIN branch_ingredients'))return{rows:[
  {product_id:5,ingredient_id:8,quantity_required:'0.1',cost_contribution:'4.5',
   code:'BEANS',display_name:'Beans',uom:'kg',stock_qty:'5',low_stock_threshold:'1',active:true}]};
 if(sql.includes('FROM branch_ingredients WHERE workspace_id'))return{rows:[
  {id:8,code:'BEANS',display_name:'Beans',uom:'kg',stock_qty:'5',
   low_stock_threshold:'1',active:true,updated_at:'2026-11-14'}]};
 return{rows:[]};
}};
(async()=>{
 const catalog=await reader.catalog(db,1,101),inventory=await reader.inventory(db,1,101);
 assert.equal(catalog.products.length,1);
 assert.equal(catalog.products[0].available,true);
 assert.equal(catalog.products[0].unitCost,4.5);
 assert.equal(inventory[0].stock,5);
 assert.equal(catalog.readOnly,true);
 assert(queries.every(({sql})=>!/\bFROM (products|ingredients|product_ingredients|packages|promos)\b/.test(sql)),
  'Isolated catalog reader must not query legacy catalog.');
 assert(queries.filter(x=>x.sql.includes('FROM branch_')).every(x=>x.args.length>=2&&x.args[0]===1&&x.args[1]===101));
 await assert.rejects(reader.catalog(db,2,101),{status:403});
 console.log('PASS: isolated catalog/inventory DTO, costing and cross-workspace access control');
})().catch(e=>{console.error(e);process.exitCode=1;});
