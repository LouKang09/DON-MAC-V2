'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const bridge=require('../lib/marlou-checkout-stock-bridge');

function fixture(){
 const owner=new Map([[1,'marlou09'],[2,'otherowner']]);
 const branches=new Map([[101,1],[102,1],[201,2]]);
 const catalog=new Map([
  [11,{code:'COFFEE-01',uom:'KG'}],
  [12,{code:'SUGAR-01',uom:'KG'}]
 ]);
 const isolated=[
  {id:111,ws:1,branch:101,code:'COFFEE-01',uom:'KG',active:true,stock:5},
  {id:112,ws:1,branch:101,code:'SUGAR-01',uom:'KG',active:true,stock:5},
  {id:121,ws:1,branch:102,code:'COFFEE-01',uom:'KG',active:true,stock:5},
  {id:122,ws:1,branch:102,code:'SUGAR-01',uom:'KG',active:true,stock:5},
  {id:211,ws:2,branch:201,code:'COFFEE-01',uom:'KG',active:true,stock:5}
 ];
 const movements=[],sql=[];
 let queryCount=0;
 const client={
  engine:'postgres',
  async query(q,p=[]){
   queryCount++;sql.push({q,p});
   if(q.includes('FROM chat_workspaces w JOIN users o')){
    return{rows:owner.get(Number(p[0]))===p[1]?[{ok:1}]:[]};
   }
   if(q.startsWith('SELECT 1 FROM chat_workspace_branches WHERE')){
    return{rows:branches.get(Number(p[1]))===Number(p[0])?[{ok:1}]:[]};
   }
   if(q.startsWith('SELECT 1 FROM branch_catalog_provisioning WHERE')){
    return{rows:branches.get(Number(p[1]))===Number(p[0])?[{ok:1}]:[]};
   }
   if(q.includes('FROM ingredients i LEFT JOIN branch_ingredients b')){
    const old=catalog.get(Number(p[2]));
    if(!old)return{rows:[]};
    const found=isolated.filter(x=>x.ws===Number(p[0])&&x.branch===Number(p[1])&&
       x.code.toLowerCase()===old.code.toLowerCase());
    return{rows:found.map(x=>({legacy_code:old.code,legacy_uom:old.uom,
      branch_ingredient_id:x.id,display_name:x.code,branch_uom:x.uom,active:x.active}))};
   }
   if(q.startsWith('UPDATE branch_ingredients SET stock_qty=stock_qty-$1')){
    const item=isolated.find(x=>x.id===Number(p[1])&&x.ws===Number(p[2])&&
     x.branch===Number(p[3])&&x.active===p[4]);
    if(!item||item.stock<Number(p[0]))return{rows:[]};
    item.stock-=Number(p[0]);return{rows:[{stock_qty:item.stock}]};
   }
   if(q.startsWith('UPDATE branch_ingredients SET stock_qty=stock_qty+$1')){
    const item=isolated.find(x=>x.id===Number(p[1])&&x.ws===Number(p[2])&&x.branch===Number(p[3]));
    if(!item)return{rows:[]};item.stock+=Number(p[0]);return{rows:[{stock_qty:item.stock}]};
   }
   if(q.startsWith('INSERT INTO branch_inventory_movements')){
    movements.push({ws:p[0],branch:p[1],ingredientId:p[2],type:p[3],qty:p[4],
      balance:p[5],ref:p[6]});return{rows:[]};
   }
   if(q.startsWith('SELECT ingredient_id,SUM(quantity_change) AS net_change')){
    const grouped=new Map();
    for(const m of movements){
      if(m.ws!==p[0]||m.branch!==p[1]||m.ref!==p[2]||m.type!==p[3])continue;
      grouped.set(m.ingredientId,(grouped.get(m.ingredientId)||0)+m.qty);
    }
    return{rows:[...grouped.entries()].sort((a,b)=>a[0]-b[0]).map(([ingredient_id,net_change])=>({ingredient_id,net_change}))};
   }
   throw Error('Unexpected mock SQL '+q+' params '+JSON.stringify(p));
  }
 };
 return{
  data:isolated,catalog,movements,sql,
  db:{engine:'postgres',query:client.query.bind(client),
   transaction:async work=>{
    const stocks=isolated.map(x=>x.stock),length=movements.length;
    try{return await work(client)}
    catch(e){isolated.forEach((x,i)=>x.stock=stocks[i]);movements.length=length;throw e}
   }},
  getStock:id=>isolated.find(x=>x.id===id).stock
 };
}
const req=(ingredientId,needed,name='Ingredient')=>({ingredientId,needed,name});

(async()=>{
 const f=fixture();
 const first=await f.db.transaction(tx=>bridge.applySale(tx,{
  workspaceId:1,branchId:101,requirements:[req(11,.125),req(12,.01)],
  reference:'REF-A',actorId:17
 }));
 assert.deepEqual(first,{mirrored:true,items:2});
 assert.equal(f.getStock(111),4.875);
 assert.equal(f.getStock(112),4.99);
 assert.equal(f.getStock(121),5,'Other Marlou branch must not change');
 assert.equal(f.getStock(211),5,'Other franchise must not change');
 assert.equal(f.movements.filter(x=>x.type==='POS_SALE'&&x.ref==='REF-A').length,2);
 assert(f.movements.every(x=>x.ws===1&&x.branch===101));
 assert(f.sql.some(x=>x.q.includes('stock_qty>=$1 RETURNING stock_qty')),
  'Database stock update must be scoped and reject insufficient balance.');

 const notOwner=await f.db.transaction(tx=>bridge.applySale(tx,{
   workspaceId:2,branchId:201,requirements:[req(11,.2)],reference:'OTHER',actorId:20
 }));
 assert.equal(notOwner.mirrored,false,'Bridge never writes other franchises');
 assert.equal(f.getStock(211),5);

 const otherBranch=await f.db.transaction(tx=>bridge.applySale(tx,{
   workspaceId:1,branchId:102,requirements:[req(11,.1)],reference:'REF-B',actorId:17
 }));
 assert.equal(otherBranch.mirrored,true);
 assert.equal(f.getStock(121),4.9);
 assert.equal(f.getStock(111),4.875);

 await assert.rejects(
   f.db.transaction(tx=>bridge.applySale(tx,{workspaceId:1,branchId:201,
     requirements:[req(11,.1)],reference:'FOREIGN',actorId:17})),
   {status:403});
 assert.equal(f.getStock(211),5);

 const before=f.movements.length;
 await assert.rejects(
   f.db.transaction(tx=>bridge.applySale(tx,{workspaceId:1,branchId:101,
     requirements:[req(11,.25),req(12,9)],reference:'REF-ROLLBACK',actorId:17})),
   {status:409});
 assert.equal(f.getStock(111),4.875,'Whole sale rolls back if second ingredient fails');
 assert.equal(f.movements.length,before,'Failed sale has no movements');

 f.catalog.get(11).uom='L';
 await assert.rejects(
   f.db.transaction(tx=>bridge.applySale(tx,{workspaceId:1,branchId:101,
     requirements:[req(11,.1)],reference:'REF-UOM',actorId:17})),
   {status:409});
 f.catalog.get(11).uom='KG';

 await assert.rejects(
   f.db.transaction(tx=>bridge.applySale(tx,{workspaceId:1,branchId:101,
     requirements:[req(999,.1)],reference:'REF-UNKNOWN',actorId:17})),
   {status:409});

 await assert.rejects(
   f.db.transaction(tx=>bridge.applySale(tx,{workspaceId:1,branchId:101,
     requirements:[req(11,.00000001)],reference:'REF-PRECISION',actorId:17})),
   {status:409});

 const restored=await f.db.transaction(tx=>bridge.restoreSale(tx,{
  workspaceId:1,branchId:101,reference:'REF-A',actorId:17
 }));
 assert.deepEqual(restored,{mirrored:true,items:2});
 assert.equal(f.getStock(111),5);
 assert.equal(f.getStock(112),5);
 assert.equal(f.getStock(121),4.9);
 assert.equal(f.movements.filter(x=>x.type==='POS_SALE_REVERSAL').length,2);
 const past=await f.db.transaction(tx=>bridge.restoreSale(tx,{
  workspaceId:1,branchId:101,reference:'OLD-UNMIRRORED',actorId:17
 }));
 assert.deepEqual(past,{mirrored:false,items:0},
  'Old sales without branch movements must not gain fabricated branch credits.');

 const server=fs.readFileSync('server.js','utf8');
 const call=server.indexOf('await marlouCheckoutStockBridge.applySale(tx,');
 const legacy=server.indexOf('UPDATE ingredients SET stock_qty=$1,updated_at=$2 WHERE id=$3');
 const receipt=server.indexOf('const previous=await tx.query(');
 assert(call>legacy&&call>receipt&&call<server.indexOf('async function getInventory('),
   'Bridge must run within checkout transaction after legacy deduction and idempotency return');
 const restoreCall=server.indexOf('await marlouCheckoutStockBridge.restoreSale(tx,');
 const deletion=server.indexOf("await tx.query('UPDATE sales SET status=$1",restoreCall);
 assert(restoreCall>0&&deletion>restoreCall,'Branch reversal occurs before delete commit');
 assert(server.includes("(tx.engine==='postgres'?' FOR UPDATE':'')"),
   'Receipt must be locked for concurrent stock restoration');
 console.log('PASS: Marlou09 branch sales update displayed stock, not other branches/franchises; rollback, precision, reversal and ownership are covered.');
})().catch(e=>{console.error(e);process.exitCode=1});
