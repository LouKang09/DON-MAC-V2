'use strict';
const crypto=require('crypto');
const branches=require('./inventory-transfer-branches');
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
const id=x=>Number.isSafeInteger(Number(x))&&Number(x)>0?Number(x):0;
const yes=x=>x===true||x===1||x==='1';
const clean=(v,max)=>String(v||'').trim().slice(0,max);
const quantity=x=>Number(x);
async function migrate(db){
 const pg=db.engine==='postgres',pk=pg?'BIGSERIAL PRIMARY KEY':'INTEGER PRIMARY KEY AUTOINCREMENT',
  fk=pg?'BIGINT':'INTEGER',ts=pg?'TIMESTAMPTZ':'TEXT';
 await db.exec('CREATE TABLE IF NOT EXISTS branch_supply_requests('+
  'id '+pk+',workspace_id '+fk+' NOT NULL REFERENCES chat_workspaces(id),'+
  'kind VARCHAR(12) NOT NULL CHECK(kind IN (\'TRANSFER\',\'SUPPLIER\')),'+
  'source_branch_id '+fk+' REFERENCES branches(id),destination_branch_id '+fk+' NOT NULL REFERENCES branches(id),'+
  'source_label VARCHAR(150) NOT NULL,expected_deliverer VARCHAR(150),'+
  'requested_by '+fk+' NOT NULL REFERENCES users(id),'+
  'status VARCHAR(16) NOT NULL DEFAULT \'PENDING\' CHECK(status IN (\'PENDING\',\'ACCEPTED\',\'REJECTED\',\'COMPLETED\')),'+
  'accepted_by '+fk+' REFERENCES users(id),rejected_by '+fk+' REFERENCES users(id),completed_by '+fk+' REFERENCES users(id),'+
  'delivered_by VARCHAR(150),remarks TEXT,'+
  'requested_at '+ts+' NOT NULL DEFAULT CURRENT_TIMESTAMP,accepted_at '+ts+',rejected_at '+ts+',completed_at '+ts+','+
  'FOREIGN KEY(source_branch_id,workspace_id) REFERENCES chat_workspace_branches(branch_id,workspace_id),'+
  'FOREIGN KEY(destination_branch_id,workspace_id) REFERENCES chat_workspace_branches(branch_id,workspace_id))');
 await db.exec('CREATE TABLE IF NOT EXISTS branch_supply_request_items('+
  'request_id '+fk+' NOT NULL REFERENCES branch_supply_requests(id) ON DELETE RESTRICT,'+
  'source_ingredient_id '+fk+' REFERENCES branch_ingredients(id),'+
  'destination_ingredient_id '+fk+' NOT NULL REFERENCES branch_ingredients(id),'+
  'ingredient_name VARCHAR(150) NOT NULL,ingredient_code VARCHAR(160) NOT NULL,'+
  'uom VARCHAR(40) NOT NULL,quantity NUMERIC(18,6) NOT NULL CHECK(quantity>0),'+
  'PRIMARY KEY(request_id,destination_ingredient_id))');
 await db.exec('CREATE INDEX IF NOT EXISTS idx_branch_supply_receiver ON branch_supply_requests(workspace_id,destination_branch_id,status,requested_at)');
 await db.exec('CREATE INDEX IF NOT EXISTS idx_branch_supply_sender ON branch_supply_requests(workspace_id,source_branch_id,requested_at)');
}
async function userScope(db,user){
 if(!id(user?.id))throw fail('Login required.',401);
 const memberships=(await db.query('SELECT workspace_id FROM chat_memberships WHERE user_id=$1 ORDER BY workspace_id LIMIT 2',[id(user.id)])).rows;
 if(memberships.length!==1||!id(memberships[0].workspace_id))throw fail('Franchise membership is not unique.',403);
 return id(memberships[0].workspace_id);
}
async function activeBranch(db,workspaceId,branchId){
 if(!id(branchId))throw fail('Select an active destination branch.',400);
 const rows=(await db.query('SELECT b.id,b.name,b.active FROM chat_workspace_branches wb JOIN branches b ON b.id=wb.branch_id WHERE wb.workspace_id=$1 AND wb.branch_id=$2',[workspaceId,id(branchId)])).rows;
 if(rows.length!==1||!yes(rows[0].active))throw fail('Branch is inactive or outside your franchise.',403);
 return rows[0];
}
async function requireReceiver(db,user,request){
 const workspaceId=await userScope(db,user);
 if(workspaceId!==Number(request.workspace_id))throw fail('Request belongs to a different franchise.',403);
 await activeBranch(db,workspaceId,request.destination_branch_id);
 if(user.role!=='Admin'&&id(user.branchId)!==id(request.destination_branch_id))
  throw fail('Only the receiving branch can process this incoming supply.',403);
 return workspaceId;
}
function validateItems(raw){
 if(!Array.isArray(raw)||!raw.length||raw.length>150)throw fail('Select 1 to 150 ingredients.',400);
 const used=new Set();
 return raw.map(v=>{
  const ingredientId=id(v.ingredientId),qty=quantity(v.qty);
  if(!ingredientId||!Number.isFinite(qty)||qty<=0||qty>1e9||Math.round(qty*1e6)!==qty*1e6)
   throw fail('Ingredient and quantity must be valid (up to six decimals).',400);
  if(used.has(ingredientId))throw fail('Each ingredient can appear only once.',400);
  used.add(ingredientId);return{ingredientId,qty};
 });
}
async function create(db,user,body,kind){
 const items=validateItems(body.items);
 const remarks=clean(body.remarks,500),sourceLabel=clean(body.sourceLabel,150),
  expected=clean(body.expectedDeliverer,150);
 return db.transaction(async tx=>{
  const own=await branches.list(tx,user,body.sourceBranchId);
  const workspaceId=own.workspaceId;
  const destId=kind==='TRANSFER'?id(body.destinationBranchId):id(body.receivingBranchId);
  await activeBranch(tx,workspaceId,destId);
  if(kind==='TRANSFER'&&destId===own.sourceBranchId)throw fail('Destination must be a different branch.',400);
  if(kind==='SUPPLIER'&&user.role!=='Admin'&&destId!==own.sourceBranchId)
   throw fail('Cashier can request replenishment for the assigned branch only.',403);
  if(kind==='SUPPLIER'&&!sourceLabel)throw fail('Enter the supplier or source of the incoming stock.',400);
  const sourceId=kind==='TRANSFER'?own.sourceBranchId:null;
  const label=kind==='TRANSFER'?own.sourceBranchName:sourceLabel;
  const prepared=[];
  for(const item of items){
   const sourceOrDest=kind==='TRANSFER'?sourceId:destId;
   const ing=(await tx.query('SELECT id,code,display_name,uom,active FROM branch_ingredients WHERE workspace_id=$1 AND branch_id=$2 AND id=$3',
     [workspaceId,sourceOrDest,item.ingredientId])).rows[0];
   if(!ing||!yes(ing.active))throw fail('An ingredient is not available in the selected branch.',409);
   let destinationId=id(ing.id);
   if(kind==='TRANSFER'){
    const matched=(await tx.query('SELECT id,active FROM branch_ingredients WHERE workspace_id=$1 AND branch_id=$2 AND LOWER(code)=LOWER($3)',
     [workspaceId,destId,ing.code])).rows[0];
    if(!matched||!yes(matched.active))throw fail('Ingredient '+ing.display_name+' is not configured in destination branch.',409);
    destinationId=id(matched.id);
   }
   prepared.push({sourceIngredientId:kind==='TRANSFER'?id(ing.id):null,
    destinationIngredientId:destinationId,name:ing.display_name,code:ing.code,uom:ing.uom,qty:item.qty});
  }
  const inserted=(await tx.query('INSERT INTO branch_supply_requests(workspace_id,kind,source_branch_id,destination_branch_id,source_label,expected_deliverer,requested_by,status,remarks) '+
    'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
    [workspaceId,kind,sourceId,destId,label,expected||null,id(user.id),'PENDING',remarks||null])).rows[0];
  const requestId=id(inserted?.id);
  if(!requestId)throw fail('Could not create supply request.');
  for(const x of prepared){
   await tx.query('INSERT INTO branch_supply_request_items(request_id,source_ingredient_id,destination_ingredient_id,ingredient_name,ingredient_code,uom,quantity) VALUES($1,$2,$3,$4,$5,$6,$7)',
     [requestId,x.sourceIngredientId,x.destinationIngredientId,x.name,x.code,x.uom,x.qty]);
  }
  return{ok:true,id:requestId,kind,status:'PENDING',source:label,destinationBranchId:destId,items:prepared.length,message:'Incoming request created. Stock will change only through acceptance and confirmed receipt.'};
 });
}
async function list(db,user,branchInput){
 const own=await branches.list(db,user,branchInput);
 const branchId=own.sourceBranchId;
 const q=await db.query(
  'SELECT r.*,sb.name AS from_branch_name,db.name AS destination_name,'+
  'COALESCE(u.login_username,u.username) AS requester_name '+
  'FROM branch_supply_requests r LEFT JOIN branches sb ON sb.id=r.source_branch_id '+
  'JOIN branches db ON db.id=r.destination_branch_id JOIN users u ON u.id=r.requested_by '+
  'WHERE r.workspace_id=$1 AND (r.destination_branch_id=$2 OR r.source_branch_id=$2) '+
  'ORDER BY r.requested_at DESC,r.id DESC LIMIT 100',[own.workspaceId,branchId]);
 const rows=q.rows;
 const items=new Map();
 for(const r of rows){
  const list=(await db.query('SELECT ingredient_name,ingredient_code,uom,quantity '+
   'FROM branch_supply_request_items WHERE request_id=$1 ORDER BY ingredient_name',[id(r.id)])).rows;
  items.set(id(r.id),list.map(x=>({name:x.ingredient_name,code:x.ingredient_code,
   uom:x.uom,qty:Number(x.quantity)})));
 }
 return{branchId,branches:own.branches,requests:rows.map(r=>({
  id:id(r.id),kind:r.kind,status:r.status,source:r.source_label,
  sourceBranchId:id(r.source_branch_id)||null,sourceBranchName:r.from_branch_name||null,
  destinationBranchId:id(r.destination_branch_id),destinationBranchName:r.destination_name,
  requestedBy:r.requester_name,requestedAt:r.requested_at,expectedDeliverer:r.expected_deliverer,
  deliveredBy:r.delivered_by,remarks:r.remarks,items:items.get(id(r.id))||[],
  inbound:id(r.destination_branch_id)===branchId,
  canRespond:r.status==='PENDING'&&id(r.destination_branch_id)===branchId,
  canReceive:r.status==='ACCEPTED'&&id(r.destination_branch_id)===branchId
 }))};
}
async function process(db,user,requestId,action,body={}){
 const rId=id(requestId);
 if(!rId)throw fail('Invalid supply request.',400);
 return db.transaction(async tx=>{
  const r=(await tx.query('SELECT * FROM branch_supply_requests WHERE id=$1'+(tx.engine==='postgres'?' FOR UPDATE':''),
    [rId])).rows[0];
  if(!r)throw fail('Supply request not found.',404);
  const ws=await requireReceiver(tx,user,r);
  const items=(await tx.query('SELECT * FROM branch_supply_request_items WHERE request_id=$1 ORDER BY source_ingredient_id,destination_ingredient_id',
    [rId])).rows;
  if(!items.length)throw fail('Request has no ingredients.');
  if(action==='reject'){
   if(r.status!=='PENDING')throw fail('Only pending requests may be rejected.');
   await tx.query('UPDATE branch_supply_requests SET status=$1,rejected_by=$2,rejected_at=CURRENT_TIMESTAMP WHERE id=$3 AND status=$4',
    ['REJECTED',id(user.id),rId,'PENDING']);
   return{ok:true,id:rId,status:'REJECTED'};
  }
  if(action==='accept'){
   if(r.status!=='PENDING')throw fail('This supply request was already processed.');
   if(r.kind==='TRANSFER'){
    await activeBranch(tx,ws,r.source_branch_id);
    for(const x of items){
     const qty=Number(x.quantity);
     const result=(await tx.query(
      'UPDATE branch_ingredients SET stock_qty=stock_qty-$1,updated_at=CURRENT_TIMESTAMP '+
      'WHERE id=$2 AND workspace_id=$3 AND branch_id=$4 AND active=$5 AND stock_qty>=$1 RETURNING stock_qty',
      [qty,id(x.source_ingredient_id),ws,id(r.source_branch_id),true])).rows;
     if(result.length!==1)throw fail('Outgoing branch has insufficient stock for '+x.ingredient_name+'.');
     await tx.query('INSERT INTO branch_inventory_movements(workspace_id,branch_id,ingredient_id,movement_type,quantity_change,balance_after,reference,remarks,created_by) '+
      'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [ws,id(r.source_branch_id),id(x.source_ingredient_id),'TRANSFER_OUT',-qty,Number(result[0].stock_qty),
       'BRTRF-'+rId,'Approved transfer to '+id(r.destination_branch_id),id(user.id)]);
    }
   }
   await tx.query('UPDATE branch_supply_requests SET status=$1,accepted_by=$2,accepted_at=CURRENT_TIMESTAMP WHERE id=$3 AND status=$4',
     ['ACCEPTED',id(user.id),rId,'PENDING']);
   return{ok:true,id:rId,status:'ACCEPTED',message:'Accepted. Confirm delivery to credit incoming stock.'};
  }
  if(action==='receive'){
   if(r.status!=='ACCEPTED')throw fail('Accept the request before confirming receipt.');
   const delivered=clean(body.deliveredBy,150);
   if(!delivered)throw fail('Enter who delivered these ingredients.',400);
   for(const x of items){
    const qty=Number(x.quantity);
    const result=(await tx.query(
     'UPDATE branch_ingredients SET stock_qty=stock_qty+$1,updated_at=CURRENT_TIMESTAMP '+
     'WHERE id=$2 AND workspace_id=$3 AND branch_id=$4 AND active=$5 RETURNING stock_qty',
      [qty,id(x.destination_ingredient_id),ws,id(r.destination_branch_id),true])).rows;
    if(result.length!==1)throw fail('Receiving ingredient '+x.ingredient_name+' is no longer active.');
    await tx.query('INSERT INTO branch_inventory_movements(workspace_id,branch_id,ingredient_id,movement_type,quantity_change,balance_after,reference,received_by,delivered_by,remarks,created_by) '+
      'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [ws,id(r.destination_branch_id),id(x.destination_ingredient_id),
       r.kind==='TRANSFER'?'TRANSFER_IN':'REPLENISH',qty,Number(result[0].stock_qty),
       (r.kind==='TRANSFER'?'BRTRF-':'BRRPL-')+rId,clean(user.username,150),delivered,
       clean(r.remarks,500)||null,id(user.id)]);
   }
   await tx.query('UPDATE branch_supply_requests SET status=$1,completed_by=$2,delivered_by=$3,completed_at=CURRENT_TIMESTAMP WHERE id=$4 AND status=$5',
     ['COMPLETED',id(user.id),delivered,rId,'ACCEPTED']);
   return{ok:true,id:rId,status:'COMPLETED',message:'Incoming ingredients credited to the receiving branch.'};
  }
  throw fail('Invalid supply action.',400);
 });
}
async function movements(db,user,rawBranch,rawLimit){
 const own=await branches.list(db,user,rawBranch);
 const limit=Math.max(1,Math.min(1000,Number(rawLimit)||300));
 const r=await db.query('SELECT m.id,m.movement_type,m.quantity_change,m.balance_after,m.reference,m.received_by,m.delivered_by,m.remarks,m.created_at,i.display_name,i.uom,b.name AS branch_name,COALESCE(u.login_username,u.username) AS username '+
 'FROM branch_inventory_movements m JOIN branch_ingredients i ON i.id=m.ingredient_id AND i.workspace_id=m.workspace_id AND i.branch_id=m.branch_id '+
 'JOIN branches b ON b.id=m.branch_id LEFT JOIN users u ON u.id=m.created_by '+
 'WHERE m.workspace_id=$1 AND m.branch_id=$2 ORDER BY m.created_at DESC,m.id DESC LIMIT '+limit,
 [own.workspaceId,own.sourceBranchId]);
 return r.rows.map(x=>({id:id(x.id),type:x.movement_type,ingredient:x.display_name,uom:x.uom,
  quantityChange:Number(x.quantity_change),balanceAfter:Number(x.balance_after),reference:x.reference,
  branch:x.branch_name,receivedBy:x.received_by,deliveredBy:x.delivered_by,
  remarks:x.remarks,createdBy:x.username,createdAt:x.created_at}));
}
module.exports={migrate,userScope,create,list,process,movements,validateItems};
