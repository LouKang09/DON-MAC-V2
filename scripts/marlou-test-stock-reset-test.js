'use strict';
const assert=require('node:assert/strict');
const catalog=require('../lib/branch-catalog-seeding'),moduleFile=require('../lib/marlou-test-stock-reset');
const original=catalog.originalOwner;
catalog.originalOwner=async()=>({workspaceId:10,ownerId:1,username:'marlou09'});
const stored=[{id:1,branch_id:101,stock_qty:3},{id:2,branch_id:101,stock_qty:5},{id:3,branch_id:102,stock_qty:9}];
let marker=null;const recorded=[];
const tx={engine:'postgres',async query(sql,args=[]){
 recorded.push({sql,args});
 if(sql.startsWith('SELECT pg_advisory_xact_lock'))return{rows:[]};
 if(sql.startsWith('SELECT branch_count,ingredient_count,changed_count'))
  return{rows:marker?[marker]:[]};
 if(sql.startsWith('SELECT wb.branch_id,p.template_id'))return{rows:[
  {branch_id:101,template_id:8},{branch_id:102,template_id:8}]};
 if(sql.startsWith('SELECT id,branch_id,stock_qty'))return{rows:stored.map(x=>({...x}))};
 if(sql.startsWith('UPDATE branch_ingredients SET stock_qty=')){
  const row=stored.find(x=>x.id===args[1]&&x.branch_id===args[3]);assert(row);row.stock_qty=args[0];return{rows:[]};
 }
 if(sql.startsWith('INSERT INTO branch_inventory_movements'))return{rows:[]};
 if(sql.startsWith('SELECT branch_id,COUNT(*) AS n')){
  return{rows:[101,102].map(branch_id=>{const rows=stored.filter(x=>x.branch_id===branch_id);
   return{branch_id,n:rows.length,min_stock:Math.min(...rows.map(x=>x.stock_qty)),max_stock:Math.max(...rows.map(x=>x.stock_qty))}})};
 }
 if(sql.startsWith('INSERT INTO branch_test_stock_resets')){
  marker={branch_count:args[2],ingredient_count:args[3],changed_count:args[4]};return{rows:[]};
 }
 throw Error('Unexpected SQL '+sql);
 }};
const db={engine:'postgres',exec:async()=>{},transaction:async fn=>fn(tx)};
(async()=>{
 await moduleFile.migrate(db);
 const first=await moduleFile.apply(db);
 assert.equal(first.status,'applied');
 assert.equal(first.branches,2);assert.equal(first.ingredients,3);assert.equal(first.changed,2);
 assert(stored.every(x=>x.stock_qty===5));
 const audit=recorded.filter(x=>x.sql.startsWith('INSERT INTO branch_inventory_movements'));
 assert.equal(audit.length,2);assert.deepEqual(audit.map(x=>x.args[4]),[2,-4]);
 const second=await moduleFile.apply(db);
 assert.equal(second.status,'already_applied');
 assert.equal(recorded.filter(x=>x.sql.startsWith('UPDATE branch_ingredients')).length,2);
 assert(recorded.every(x=>!/UPDATE ingredients SET|DELETE FROM sales|DELETE FROM products/.test(x.sql)));
 console.log('PASS: Marlou-only one-time 5 stock reset with adjustments and no repeated deployments');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{catalog.originalOwner=original;});
