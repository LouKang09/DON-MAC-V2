'use strict';
const assert=require('node:assert/strict');
const seeder=require('../lib/branch-catalog-seeding');
const base={
 version:2,
 products:[{sourceId:10,sku:'COF-01',name:'Coffee',category:'Coffee',price:35,active:true,imageData:null}],
 ingredients:[{sourceId:11,code:'BEANS',name:'Beans',uom:'kg',threshold:2,active:true}],
 recipes:[{sourceProductId:10,sourceIngredientId:11,quantityRequired:0.25,costContribution:8.75}],
 categories:[{name:'Coffee',iconData:null,sortOrder:1,builtin:true,active:true}],
 categoryProducts:[{categoryName:'Coffee',sourceProductId:10}],
 addOns:[],promos:[],packages:[],packageItems:[]
};
assert.equal(seeder.validate(base),base);
const blueprint=seeder.blueprint(base);
assert.equal(blueprint.ingredients[0].openingStock,0);
assert.equal(blueprint.recipes[0].costContribution,8.75);
assert.equal(blueprint.recipes[0].quantityRequired,0.25);
assert.throws(()=>seeder.validate({...base,recipes:[{...base.recipes[0],sourceIngredientId:999}]}));
async function run(opening){
 let serial=30,queryLog=[],already=false,stock=null;
 const tx={
  async query(sql,args=[]){
   queryLog.push({sql,args});
   if(sql.startsWith('SELECT 1 FROM chat_workspace_branches'))return{rows:[{one:1}]};
   if(sql.startsWith('SELECT opening_stock FROM branch_catalog_provisioning'))
    return{rows:already?[{opening_stock:stock}]:[]};
   if(sql.startsWith('SELECT 1 FROM branch_'))return{rows:[]};
   if(sql.includes(' RETURNING id'))return{rows:[{id:serial++}]};
   if(sql.startsWith('INSERT INTO branch_catalog_provisioning')){already=true;stock=opening;}
   return{rows:[]};
  }
 };
 const master={id:3,template:base};
 const first=await seeder.seedBranch(tx,100,200,master,opening,1);
 assert.equal(first.status,'prepared');
 const ingredientInsert=queryLog.find(x=>x.sql.startsWith('INSERT INTO branch_ingredients'));
 assert.equal(ingredientInsert.args[5],opening);
 const recipeInsert=queryLog.find(x=>x.sql.startsWith('INSERT INTO branch_recipes'));
 assert.equal(recipeInsert.args[4],0.25);
 assert.equal(recipeInsert.args[5],8.75);
 assert.equal(queryLog.filter(x=>x.sql.startsWith('INSERT INTO branch_inventory_movements')).length,opening===5?1:0);
 const before=queryLog.length;
 const again=await seeder.seedBranch(tx,100,200,master,opening,1);
 assert.equal(again.status,'already_prepared');
 assert(!queryLog.slice(before).some(x=>x.sql.startsWith('INSERT')));
 return first;
}
(async()=>{await run(5);await run(0);console.log('PASS: Marlou has 5 starting units; future workspace has 0; costing retained; restarts do not overwrite stock');})()
 .catch(err=>{console.error(err);process.exitCode=1;});
