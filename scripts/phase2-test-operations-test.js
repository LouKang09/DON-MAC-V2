'use strict';
const assert=require('node:assert/strict');
const operations=require('../lib/franchise-test-operations');
(async()=>{
 const ingredients=[
  {id:401,workspace:101,branch:11,name:'Beans A',stock:0},
  {id:402,workspace:202,branch:22,name:'Beans B',stock:0}
 ];
 const products=[
  {id:501,workspace:101,branch:11,name:'Latte A',price:75,ingredient:401},
  {id:502,workspace:202,branch:22,name:'Latte B',price:85,ingredient:402}
 ];
 const movements=[],sales=[],queries=[];
 const db={engine:'postgres',transaction:async(fn)=>fn(db),query:async(q,p=[])=>{
  queries.push({q,p});
  if(q.includes('FROM franchise_test_accounts t'))return{rows:[{
   request_id:'11111111-1111-4111-8111-111111111111',
   user_id:p[0],workspace_id:p[0]===1?101:202,branch_id:p[0]===1?11:22,
   membership_workspace:p[0]===1?101:202,owner_user_id:p[0],branch_active:true
  }]};
  if(q.startsWith('UPDATE branch_ingredients SET stock_qty=stock_qty+$1')){
   const i=ingredients.find(x=>x.id===p[1]&&x.workspace===p[2]&&x.branch===p[3]);
   if(!i)return{rows:[]};i.stock+=p[0];return{rows:[{stock_qty:i.stock,display_name:i.name}]};
  }
  if(q.startsWith('INSERT INTO branch_inventory_movements')){movements.push(p);return{rows:[]};}
  if(q.startsWith('SELECT id,name,price FROM branch_products')){
   const x=products.find(x=>x.id===p[0]&&x.workspace===p[1]&&x.branch===p[2]);
   return{rows:x?[{id:x.id,name:x.name,price:x.price}]:[]};
  }
  if(q.startsWith('SELECT i.id AS ingredient_id')){
   const x=products.find(x=>x.id===p[2]&&x.workspace===p[0]&&x.branch===p[1]);
   if(!x)return{rows:[]};
   const i=ingredients.find(i=>i.id===x.ingredient);
   return{rows:[{ingredient_id:i.id,display_name:i.name,stock_qty:i.stock,quantity_required:2}]};
  }
  if(q.startsWith('UPDATE branch_ingredients SET stock_qty=stock_qty-$1')){
   const i=ingredients.find(x=>x.id===p[1]&&x.workspace===p[2]&&x.branch===p[3]);
   if(!i||i.stock<p[0])return{rows:[]};i.stock-=p[0];return{rows:[{stock_qty:i.stock}]};
  }
  if(q.startsWith('INSERT INTO franchise_test_sales')){sales.push({id:p[0],ws:p[1],branch:p[2],product:p[4],qty:p[5],total:p[7],at:p[9]});return{rows:[]};}
  if(q.startsWith('UPDATE branch_products SET price=$1')){
   const x=products.find(x=>x.id===p[1]&&x.workspace===p[2]&&x.branch===p[3]);
   if(!x)return{rows:[]};x.price=p[0];return{rows:[{id:x.id,name:x.name,price:x.price}]};
  }
  if(q.startsWith('SELECT COUNT(*) AS count,COALESCE(SUM(total)')){
   const own=sales.filter(x=>x.ws===p[0]&&x.branch===p[1]);
   return{rows:[{count:own.length,revenue:own.reduce((sum,x)=>sum+x.total,0),items:own.reduce((sum,x)=>sum+x.qty,0)}]};
  }
  if(q.startsWith('SELECT id,product_name_snapshot')){
   return{rows:sales.filter(x=>x.ws===p[0]&&x.branch===p[1]).map(x=>({
    id:x.id,product_name_snapshot:x.product,quantity:x.qty,total:x.total,created_at:x.at
   }))};
  }
  throw Error('Unexpected test SQL: '+q);
 }};
 const restocked=await operations.replenish(db,1,{ingredientId:401,quantity:10});
 assert.equal(restocked.onHand,10);
 await assert.rejects(operations.replenish(db,2,{ingredientId:401,quantity:1}),{status:403});
 await assert.rejects(operations.simulatedSale(db,2,{productId:501,quantity:1}),{status:403});
 await assert.rejects(operations.simulatedSale(db,2,{productId:502,quantity:1}),{status:409});
 const sold=await operations.simulatedSale(db,1,{productId:501,quantity:1});
 assert.equal(sold.total,75);
 assert.equal(ingredients[0].stock,8);
 assert.equal(ingredients[1].stock,0);
 const changed=await operations.updatePrice(db,1,501,{price:'99.50'});
 assert.equal(Number(changed.product.price),99.5);
 assert.equal(products[1].price,85);
 await assert.rejects(operations.updatePrice(db,2,501,{price:'1'}),{status:403});
 const [reportA,reportB]=await Promise.all([operations.report(db,1),operations.report(db,2)]);
 assert.equal(reportA.count,1);assert.equal(reportA.revenue,75);
 assert.equal(reportB.count,0);assert.equal(reportB.revenue,0);
 assert(movements.some(x=>x[3]==='PHASE2_TEST_REPLENISH'));
 assert(movements.some(x=>x[3]==='PHASE2_TEST_SALE'));
 assert(queries.some(x=>x.q.includes('FOR UPDATE OF i')));
 assert(queries.some(x=>x.q.includes('stock_qty>=$1 RETURNING stock_qty')));
 assert(!queries.some(x=>/INSERT INTO (sales|sale_items)\b|UPDATE ingredients\b/i.test(x.q)));
 console.log('PASS: Phase 2 test stock/checkout/pricing/report are scoped by workspace and branch; live sales untouched.');
})().catch(e=>{console.error(e);process.exitCode=1});
