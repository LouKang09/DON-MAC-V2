'use strict';
// Direct opening stock and external replenishment are not inter-branch transfers.
// They post a scoped, audited receipt immediately; no Accept/Reject request.
const crypto=require('node:crypto');
const incoming=require('./branch-incoming-supply');
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const id=x=>Number.isSafeInteger(Number(x))&&Number(x)>0?Number(x):0;
const bool=x=>x===true||x===1||x==='1';
const trim=(x,max)=>String(x||'').trim().slice(0,max);
async function migrate(db){
 const fk=db.engine==='postgres'?'BIGINT':'INTEGER';
 await db.exec('CREATE TABLE IF NOT EXISTS branch_direct_stock_receipts('+
  'id VARCHAR(40) PRIMARY KEY,workspace_id '+fk+' NOT NULL REFERENCES chat_workspaces(id),'+
  'branch_id '+fk+' NOT NULL REFERENCES branches(id),entry_type VARCHAR(24) NOT NULL '+
  "CHECK(entry_type IN ('INITIAL_STOCK','DIRECT_REPLENISH')),"+
  'source_label VARCHAR(150) NOT NULL,remarks TEXT,payload_sha256 VARCHAR(64) NOT NULL,'+
  'created_by '+fk+' NOT NULL REFERENCES users(id),created_at TEXT NOT NULL)');
 await db.exec('CREATE INDEX IF NOT EXISTS idx_branch_direct_stock_receipts_scope ON '+
  'branch_direct_stock_receipts(workspace_id,branch_id,created_at)');
}
async function record(db,user,body){
 const branchId=id(body?.receivingBranchId),requestId=String(body?.clientRequestId||'');
 const type=String(body?.entryType||'DIRECT_REPLENISH').toUpperCase();
 const source=trim(body?.sourceLabel,150),remarks=trim(body?.remarks,500);
 const items=incoming.validateItems(body?.items).sort((a,b)=>a.ingredientId-b.ingredientId);
 if(!['INITIAL_STOCK','DIRECT_REPLENISH'].includes(type))throw fail('Choose Initial Stock or Supplier Replenishment.');
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId))
  throw fail('Invalid stock receipt request ID.');
 if(!source)throw fail('Enter an initial-stock source or supplier name.');
 const signature=crypto.createHash('sha256').update(JSON.stringify({branchId,type,source,remarks,items})).digest('hex');
 return db.transaction(async tx=>{
  if(tx.engine==='postgres')await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',['direct-stock:'+requestId]);
  const ws=await incoming.userScope(tx,user);
  const branch=(await tx.query('SELECT b.active FROM chat_workspace_branches wb JOIN branches b ON b.id=wb.branch_id '+
   'WHERE wb.workspace_id=$1 AND wb.branch_id=$2',[ws,branchId])).rows[0];
  if(!branch||!bool(branch.active))throw fail('Receiving branch is inactive or outside your franchise.',403);
  if(user.role!=='Admin'&&id(user.branchId)!==branchId)
   throw fail('You may replenish only your assigned branch.',403);
  const previous=(await tx.query('SELECT workspace_id,branch_id,payload_sha256,entry_type '+
   'FROM branch_direct_stock_receipts WHERE id=$1',[requestId])).rows[0];
  if(previous){
   if(Number(previous.workspace_id)!==ws||Number(previous.branch_id)!==branchId||
      previous.entry_type!==type||previous.payload_sha256!==signature)
    throw fail('This stock receipt ID has already been used for a different adjustment.',409);
   return{ok:true,id:requestId,entryType:type,items:items.length,idempotent:true,
    message:'This stock entry was already recorded; no stock was added twice.'};
  }
  const planned=[];
  for(const item of items){
   const rows=(await tx.query('SELECT id,display_name,uom,active,stock_qty FROM branch_ingredients '+
    'WHERE workspace_id=$1 AND branch_id=$2 AND id=$3',[ws,branchId,item.ingredientId])).rows;
   if(rows.length!==1||!bool(rows[0].active))throw fail('Selected ingredient is inactive or belongs to another branch.',403);
   if(type==='INITIAL_STOCK'&&Number(rows[0].stock_qty)!==0)
    throw fail('Initial Stock is only for zero-balance ingredients: '+rows[0].display_name+
     '. Use Supplier Replenishment to add to existing stock.',409);
   planned.push({...item,name:rows[0].display_name,uom:rows[0].uom});
  }
  await tx.query('INSERT INTO branch_direct_stock_receipts('+
   'id,workspace_id,branch_id,entry_type,source_label,remarks,payload_sha256,created_by,created_at) '+
   'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[requestId,ws,branchId,type,source,remarks||null,
    signature,id(user.id),new Date().toISOString()]);
  for(const item of planned){
   const updated=(await tx.query('UPDATE branch_ingredients SET stock_qty=stock_qty+$1,'+
     'updated_at=CURRENT_TIMESTAMP WHERE id=$2 AND workspace_id=$3 AND branch_id=$4 '+
     'AND active=$5'+(type==='INITIAL_STOCK'?' AND stock_qty=0':'')+' RETURNING stock_qty',
    [item.qty,item.ingredientId,ws,branchId,true])).rows;
   if(updated.length!==1)throw fail('Stock changed while saving '+item.name+'. Retry after refreshing.',409);
   await tx.query('INSERT INTO branch_inventory_movements('+
    'workspace_id,branch_id,ingredient_id,movement_type,quantity_change,balance_after,reference,remarks,created_by) '+
    'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[ws,branchId,item.ingredientId,
     type,item.qty,Number(updated[0].stock_qty),'STK-'+requestId,
     (source+' · '+remarks).slice(0,500),id(user.id)]);
  }
  return{ok:true,id:requestId,entryType:type,items:planned.length,branchId,
    message:type==='INITIAL_STOCK'?'Opening stock saved directly to this branch.':
     'Supplier stock added directly to this branch. No receiving approval required.'};
 });
}
module.exports={migrate,record};
