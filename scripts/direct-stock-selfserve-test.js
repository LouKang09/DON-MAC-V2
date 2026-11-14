'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const direct=require('../lib/branch-direct-stock');
const signup=require('../lib/franchise-test-access');

const selected=[{id:10,workspace:1,branch:101,name:'Coffee',stock:0,active:true},
 {id:11,workspace:1,branch:101,name:'Sugar',stock:0,active:true},
 {id:20,workspace:2,branch:201,name:'Other Account Ingredient',stock:0,active:true}];
const receipts=new Map(),movements=[],queries=[],migrations=[];
const db={engine:'postgres',exec:async sql=>{migrations.push(sql)},transaction:async fn=>{
 const stocks=selected.map(x=>x.stock),before=movements.length,oldReceipts=new Map(receipts);
 try{return await fn(db)}catch(e){
  selected.forEach((x,i)=>x.stock=stocks[i]);movements.length=before;
  receipts.clear();for(const [k,v] of oldReceipts)receipts.set(k,v);
  throw e;
 }
},query:async(q,p=[])=>{
 queries.push({q,p});
 if(q.includes('pg_advisory_xact_lock'))return{rows:[{ok:1}]};
 if(q.includes('SELECT workspace_id FROM chat_memberships')){
  return{rows:[{workspace_id:Number(p[0])===2?2:1}]};
 }
 if(q.includes('SELECT b.active FROM chat_workspace_branches')){
  return{rows:Number(p[0])===1&&Number(p[1])===101||Number(p[0])===2&&Number(p[1])===201?
   [{active:true}]:[]};
 }
 if(q.startsWith('SELECT workspace_id,branch_id,payload_sha256,entry_type FROM branch_direct_stock_receipts'))
  return{rows:receipts.has(p[0])?[receipts.get(p[0])]:[]};
 if(q.startsWith('SELECT id,display_name,uom,active,stock_qty FROM branch_ingredients')){
  return{rows:selected.filter(x=>x.workspace===Number(p[0])&&x.branch===Number(p[1])&&x.id===Number(p[2]))
   .map(x=>({id:x.id,display_name:x.name,uom:'KG',active:x.active,stock_qty:x.stock}))};
 }
 if(q.startsWith('INSERT INTO branch_direct_stock_receipts')){
  receipts.set(p[0],{workspace_id:p[1],branch_id:p[2],entry_type:p[3],payload_sha256:p[6]});
  return{rows:[]};
 }
 if(q.startsWith('UPDATE branch_ingredients SET stock_qty=stock_qty+$1')){
  const ingredient=selected.find(x=>x.id===Number(p[1])&&x.workspace===Number(p[2])&&
   x.branch===Number(p[3])&&x.active===p[4]&&(!q.includes('stock_qty=0')||x.stock===0));
  if(!ingredient)return{rows:[]};ingredient.stock+=Number(p[0]);return{rows:[{stock_qty:ingredient.stock}]};
 }
 if(q.startsWith('INSERT INTO branch_inventory_movements')){movements.push(p);return{rows:[]}};
 throw Error('Unexpected SQL '+q);
}};
const cashier={id:100,role:'User',branchId:101},other={id:2,role:'Admin'};
const uuid='11111111-1111-4111-8111-111111111111';
const body=(requestId,type,items,receivingBranchId=101)=>({
 clientRequestId:requestId,entryType:type,sourceLabel:'Opening Inventory',
 remarks:'Starting stock',receivingBranchId,items
});
const item=(ingredientId,qty)=>({ingredientId,qty});
async function run(){
 await direct.migrate(db);
 assert(migrations.some(x=>x.includes('branch_direct_stock_receipts')));
 const first=await direct.record(db,cashier,body(uuid,'INITIAL_STOCK',[item(10,5),item(11,1.125)]));
 assert.equal(first.ok,true);assert.equal(first.entryType,'INITIAL_STOCK');
 assert.equal(selected[0].stock,5);assert.equal(selected[1].stock,1.125);
 assert.equal(movements.length,2);
 assert(movements.every(x=>x[0]===1&&x[1]===101&&x[3]==='INITIAL_STOCK'));
 const replay=await direct.record(db,cashier,body(uuid,'INITIAL_STOCK',[item(10,5),item(11,1.125)]));
 assert.equal(replay.idempotent,true);assert.equal(selected[0].stock,5);
 await assert.rejects(direct.record(db,cashier,body(uuid,'INITIAL_STOCK',[item(10,4)])),{status:409});
 await assert.rejects(direct.record(db,cashier,body('22222222-2222-4222-8222-222222222222','INITIAL_STOCK',[item(10,1)])),{status:409});
 const supplied=await direct.record(db,cashier,body('33333333-3333-4333-8333-333333333333','DIRECT_REPLENISH',[item(10,2)]));
 assert.equal(supplied.ok,true);assert.equal(selected[0].stock,7);
 assert.equal(movements.at(-1)[3],'DIRECT_REPLENISH');
 await assert.rejects(direct.record(db,cashier,body('44444444-4444-4444-8444-444444444444','DIRECT_REPLENISH',[item(20,5)],201)),{status:403});
 assert.equal(selected[2].stock,0);
 const oldMovements=movements.length, oldReceipts=receipts.size;
 await assert.rejects(direct.record(db,cashier,body('55555555-5555-4555-8555-555555555555','DIRECT_REPLENISH',[item(10,4),item(20,1)])),{status:403});
 assert.equal(selected[0].stock,7,'Rollback must preserve previous stock on mixed unauthorized request');
 assert.equal(movements.length,oldMovements);assert.equal(receipts.size,oldReceipts);
 assert.equal(signup.validateSignupPassword('Welcome12345','Welcome12345'),'Welcome12345');
 assert.throws(()=>signup.validateSignupPassword('short1','short1'),{status:400});
 assert.throws(()=>signup.validateSignupPassword('Welcome12345','Mismatch123'),{status:400});
 const server=fs.readFileSync('server.js','utf8');
 const core=fs.readFileSync('public/app-core.js','utf8');
 const page=fs.readFileSync('public/index.html','utf8');
 const otp=fs.readFileSync('lib/franchise-email-verification.js','utf8');
 const account=fs.readFileSync('lib/franchise-test-access.js','utf8');
 const admin=fs.readFileSync('public/platform-admin.js','utf8');
 assert(server.includes("branchDirectStock.record(db,user,await readJson(req))"));
 assert(server.includes("franchiseTestAccess.activateVerifiedSignup(tx,requestId,password)"));
 assert(otp.includes("return options.onVerified?db.transaction(commit):commit(db)"));
 assert(account.includes("const seeded=await catalogSeed.seedBranch(tx,workspaceId,branchId,template,0,userId)"));
 assert(account.includes("INSERT INTO franchise_test_accounts"));
 assert(core.includes('function renderIncomingSupplies(){'));
 assert(core.includes('inv-incoming-table-wrap'));
 assert(core.includes('data-incoming-action="accept"'));
 assert(core.includes('data-incoming-action="reject"'));
 assert(core.includes("'/api/inventory/replenish/direct'"));
 assert(page.includes('id="replenishEntryType"'));
 assert(page.includes('id="regVerifyPassword"'));
 assert(page.includes('id="regVerifyConfirmPassword"'));
 assert(admin.includes("Self-registered · pending review"));
 assert(!account.includes("INSERT INTO sales"));
 console.log('PASS direct stock: initial zero-only, supplier, branch isolation, atomic rollback, idempotency and secure signup source constraints');
}
run().catch(e=>{console.error(e);process.exitCode=1});
