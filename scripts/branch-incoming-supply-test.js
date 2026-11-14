'use strict';
const assert=require('node:assert/strict');
const supply=require('../lib/branch-incoming-supply');

const branches=[{id:101,name:'Main Branch',active:true,workspace:10},
 {id:102,name:'North Branch',active:true,workspace:10},
 {id:201,name:'Other Franchise',active:true,workspace:20}];
const people={
  1:{id:1,role:'User',branchId:101,workspace:10,username:'source-cashier'},
  2:{id:2,role:'User',branchId:102,workspace:10,username:'receiver-cashier'},
  3:{id:3,role:'User',branchId:201,workspace:20,username:'other-cashier'},
  4:{id:4,role:'Admin',branchId:null,workspace:10,username:'owner'}
};
const ingredients=[
 {id:1,workspace_id:10,branch_id:101,code:'BEANS',display_name:'Coffee Beans',uom:'KG',stock_qty:5,active:true},
 {id:2,workspace_id:10,branch_id:102,code:'BEANS',display_name:'Coffee Beans',uom:'KG',stock_qty:5,active:true},
 {id:3,workspace_id:20,branch_id:201,code:'BEANS',display_name:'Coffee Beans',uom:'KG',stock_qty:5,active:true}
];
const requests=[],lines=[],movements=[],ddl=[];
function user(id){return people[id];}
const db={
 engine:'postgres',
 async transaction(fn){return fn(this);},
 async exec(sql){ddl.push(sql);},
 async query(sql,p=[]){
  if(sql.startsWith('SELECT workspace_id FROM chat_memberships'))
   return{rows:[{workspace_id:user(p[0]).workspace}]};
  if(sql.startsWith('SELECT b.id,b.name,b.active FROM chat_workspace_branches')){
   const rows=branches.filter(b=>b.workspace===Number(p[0])&&(p.length===1||b.id===Number(p[1])));
   return{rows};
  }
  if(sql.startsWith('SELECT id,code,display_name,uom,active FROM branch_ingredients'))
   return{rows:ingredients.filter(x=>x.workspace_id===Number(p[0])&&
      x.branch_id===Number(p[1])&&x.id===Number(p[2]))};
  if(sql.startsWith('SELECT id,active FROM branch_ingredients'))
   return{rows:ingredients.filter(x=>x.workspace_id===Number(p[0])&&
      x.branch_id===Number(p[1])&&x.code.toLowerCase()===String(p[2]).toLowerCase())};
  if(sql.startsWith('INSERT INTO branch_supply_requests(')){
   const next={id:requests.length+1,workspace_id:p[0],kind:p[1],
    source_branch_id:p[2],destination_branch_id:p[3],source_label:p[4],
    expected_deliverer:p[5],requested_by:p[6],status:p[7],remarks:p[8],
    requested_at:new Date().toISOString()};
   requests.push(next);return{rows:[{id:next.id}]};
  }
  if(sql.startsWith('INSERT INTO branch_supply_request_items(')){
   lines.push({request_id:p[0],source_ingredient_id:p[1],destination_ingredient_id:p[2],
    ingredient_name:p[3],ingredient_code:p[4],uom:p[5],quantity:p[6]});
   return{rows:[]};
  }
  if(sql.startsWith('SELECT * FROM branch_supply_requests WHERE id=$1')){
   const req=requests.find(x=>x.id===Number(p[0]));
   return{rows:req?[{...req}]:[]};
  }
  if(sql.startsWith('SELECT * FROM branch_supply_request_items WHERE request_id=$1'))
   return{rows:lines.filter(x=>x.request_id===Number(p[0]))};
  if(sql.startsWith('SELECT r.*,sb.name AS from_branch_name')){
   return{rows:requests.filter(x=>x.workspace_id===Number(p[0])&&
    (x.source_branch_id===Number(p[1])||x.destination_branch_id===Number(p[1])))
    .map(x=>({...x,from_branch_name:branches.find(b=>b.id===x.source_branch_id)?.name||null,
      destination_name:branches.find(b=>b.id===x.destination_branch_id)?.name,
      requester_name:user(x.requested_by).username}))};
  }
  if(sql.startsWith('SELECT ingredient_name,ingredient_code,uom,quantity'))
   return{rows:lines.filter(x=>x.request_id===Number(p[0]))};
  if(sql.startsWith('UPDATE branch_ingredients SET stock_qty=stock_qty-$1')){
   const x=ingredients.find(x=>x.id===p[1]&&x.workspace_id===p[2]&&
      x.branch_id===p[3]&&x.active===p[4]&&x.stock_qty>=p[0]);
   if(!x)return{rows:[]};
   x.stock_qty-=Number(p[0]);return{rows:[{stock_qty:x.stock_qty}]};
  }
  if(sql.startsWith('UPDATE branch_ingredients SET stock_qty=stock_qty+$1')){
   const x=ingredients.find(x=>x.id===p[1]&&x.workspace_id===p[2]&&
      x.branch_id===p[3]&&x.active===p[4]);
   if(!x)return{rows:[]};
   x.stock_qty+=Number(p[0]);return{rows:[{stock_qty:x.stock_qty}]};
  }
  if(sql.startsWith('INSERT INTO branch_inventory_movements(')){
   movements.push([...p]);return{rows:[]};
  }
  if(sql.startsWith('UPDATE branch_supply_requests SET status=')){
   const kind=p[0];
   const id=kind==='REJECTED'?p[2]:kind==='ACCEPTED'?p[2]:p[3];
   const r=requests.find(x=>x.id===id);
   if(!r)throw new Error('update request missing');
   r.status=kind;
   if(kind==='COMPLETED')r.delivered_by=p[2];
   return{rows:[]};
  }
  if(sql.startsWith('SELECT m.id,m.movement_type'))return{rows:[]};
  throw new Error('Unexpected SQL: '+sql.slice(0,150));
 }
};
async function run(){
 await supply.migrate(db);
 assert(ddl.some(s=>s.includes('CREATE TABLE IF NOT EXISTS branch_supply_requests')));
 assert(ddl.some(s=>s.includes('CREATE TABLE IF NOT EXISTS branch_supply_request_items')));
 assert.throws(()=>supply.validateItems([{ingredientId:1,qty:0}]));
 assert.throws(()=>supply.validateItems([{ingredientId:1,qty:1},{ingredientId:1,qty:2}]));
 const transfer=await supply.create(db,user(1),{items:[{ingredientId:1,qty:2}],
   sourceBranchId:101,destinationBranchId:102,expectedDeliverer:'Driver A',remarks:'Tomorrow'},'TRANSFER');
 assert.equal(transfer.status,'PENDING');
 assert.equal(ingredients[0].stock_qty,5);
 assert.equal(ingredients[1].stock_qty,5);
 const incoming=await supply.list(db,user(2));
 assert.equal(incoming.requests.length,1);
 assert.equal(incoming.requests[0].requestedBy,'source-cashier');
 assert.equal(incoming.requests[0].items[0].qty,2);
 assert.equal(incoming.requests[0].canRespond,true);
 await assert.rejects(supply.process(db,user(3),transfer.id,'accept'),{status:403});
 assert.equal(ingredients[0].stock_qty,5);
 const accepted=await supply.process(db,user(2),transfer.id,'accept');
 assert.equal(accepted.status,'ACCEPTED');
 assert.equal(ingredients[0].stock_qty,3);
 assert.equal(ingredients[1].stock_qty,5);
 await assert.rejects(supply.process(db,user(2),transfer.id,'accept'),{status:409});
 await assert.rejects(supply.process(db,user(2),transfer.id,'reject'),{status:409});
 await assert.rejects(supply.process(db,user(2),transfer.id,'receive',{}),{status:400});
 const received=await supply.process(db,user(2),transfer.id,'receive',{deliveredBy:'Driver A'});
 assert.equal(received.status,'COMPLETED');
 assert.equal(ingredients[1].stock_qty,7);
 await assert.rejects(supply.process(db,user(2),transfer.id,'receive',{deliveredBy:'Driver A'}),{status:409});
 assert.equal(movements.length,2);
 assert.equal(movements[0][3],'TRANSFER_OUT');
 assert.equal(movements[1][3],'TRANSFER_IN');
 await assert.rejects(supply.create(db,user(1),{items:[{ingredientId:1,qty:1}],
   sourceBranchId:101,destinationBranchId:201},'TRANSFER'),{status:403});
 const rejected=await supply.create(db,user(2),{items:[{ingredientId:2,qty:1}],
   sourceBranchId:102,receivingBranchId:102,sourceLabel:'Coffee Supplier',
   expectedDeliverer:'Courier'},'SUPPLIER');
 const rejectedResult=await supply.process(db,user(2),rejected.id,'reject');
 assert.equal(rejectedResult.status,'REJECTED');
 assert.equal(ingredients[1].stock_qty,7);
 const supplier=await supply.create(db,user(2),{items:[{ingredientId:2,qty:1}],
   sourceBranchId:102,receivingBranchId:102,sourceLabel:'Coffee Supplier'},'SUPPLIER');
 await supply.process(db,user(2),supplier.id,'accept');
 assert.equal(ingredients[1].stock_qty,7);
 await supply.process(db,user(2),supplier.id,'receive',{deliveredBy:'Courier'});
 assert.equal(ingredients[1].stock_qty,8);
 assert.equal(ingredients[2].stock_qty,5,'Other franchise stock must remain unchanged');
 assert.equal(movements.length,3);
 console.log('PASS: 5-unit branch stock, transfer Accept/Reject, single receipt, supplier request, separate workspace');
}
run().catch(err=>{console.error(err);process.exitCode=1;});
