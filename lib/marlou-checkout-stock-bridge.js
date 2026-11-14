'use strict';
// Compatibility bridge for the original Marlou09 workspace only.
// Existing POS checkout still uses legacy ingredients. This module mirrors
// its committed sales into the independently displayed branch stock, in the
// SAME transaction as the legacy sale. Never infer ownership from a client ID.
const OWNER='marlou09';
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
const positive=x=>Number.isSafeInteger(Number(x))&&Number(x)>0?Number(x):0;
async function originalWorkspace(tx,workspaceId){
 const ws=positive(workspaceId);
 if(!ws)return false;
 const r=await tx.query('SELECT 1 FROM chat_workspaces w JOIN users o ON o.id=w.owner_user_id '+
   'WHERE w.id=$1 AND (LOWER(o.username)=$2 OR LOWER(COALESCE(o.login_username,o.username))=$2)',
   [ws,OWNER]);
 return r.rows.length===1;
}
async function ownership(tx,workspaceId,branchId){
 const ws=positive(workspaceId),branch=positive(branchId);
 if(!ws||!branch)throw fail('Invalid branch ownership for checkout stock.');
 const r=await tx.query('SELECT 1 FROM chat_workspace_branches WHERE workspace_id=$1 AND branch_id=$2',
   [ws,branch]);
 if(r.rows.length!==1)throw fail('Checkout branch does not belong to this franchise.',403);
 const p=await tx.query('SELECT 1 FROM branch_catalog_provisioning WHERE workspace_id=$1 AND branch_id=$2',
   [ws,branch]);
 if(p.rows.length!==1)throw fail('This branch isolated inventory has not been prepared.');
 return{ws,branch};
}
function quantity(needed){
 const n=Number(needed);
 if(!Number.isFinite(n)||n<=0||n>999999999999)throw fail('Invalid checkout ingredient quantity.');
 const scaled=Math.round(n*1000000);
 if(!(scaled>0))throw fail('Recipe quantity is smaller than the supported inventory precision.');
 return(scaled/1000000).toFixed(6);
}
function isActive(x){return x===true||x===1||x==='1';}
// Read-only preflight for quotes. Real checkout still performs locked,
// atomic stock deduction; this snapshot is for early cashier feedback only.
async function previewSale(tx,{workspaceId,branchId,requirements}){
 if(!await originalWorkspace(tx,workspaceId))return{checked:false,shortages:[]};
 const {ws,branch}=await ownership(tx,workspaceId,branchId);
 if(!Array.isArray(requirements)||!requirements.length)return{checked:true,shortages:[]};
 const sorted=[...requirements].sort((a,b)=>Number(a.ingredientId)-Number(b.ingredientId));
 const ids=sorted.map(r=>positive(r.ingredientId));
 if(ids.some(x=>!x))throw fail('Invalid recipe ingredient identifier.');
 const idsSql=ids.map((_,i)=>'
 if(!await originalWorkspace(tx,workspaceId))return{mirrored:false,items:0};
 if(!Array.isArray(requirements))throw fail('Invalid checkout ingredient requirements.');
 const {ws,branch}=await ownership(tx,workspaceId,branchId);
 const prepared=[];
 for(const req of [...requirements].sort((a,b)=>Number(a.ingredientId)-Number(b.ingredientId))){
  const legacyId=positive(req.ingredientId),qty=quantity(req.needed);
  if(!legacyId)throw fail('Invalid legacy recipe ingredient identifier.');
  const found=await tx.query('SELECT i.code AS legacy_code,i.uom AS legacy_uom,'+
    'b.id AS branch_ingredient_id,b.display_name,b.uom AS branch_uom,b.active '+
    'FROM ingredients i LEFT JOIN branch_ingredients b ON LOWER(b.code)=LOWER(i.code) '+
    'AND b.workspace_id=$1 AND b.branch_id=$2 WHERE i.id=$3',[ws,branch,legacyId]);
  if(found.rows.length!==1||!positive(found.rows[0].branch_ingredient_id))
   throw fail('Branch ingredient mapping is missing or ambiguous for '+String(req.name||legacyId)+'. Sale cancelled to protect inventory.');
  const row=found.rows[0];
  if(!isActive(row.active)||String(row.branch_uom||'').trim().toUpperCase()!==
    String(row.legacy_uom||'').trim().toUpperCase())
   throw fail('Branch ingredient is inactive or its unit differs from the recipe for '+String(req.name||legacyId)+'. Sale cancelled.');
  prepared.push({id:positive(row.branch_ingredient_id),qty,name:String(row.display_name||req.name||legacyId)});
 }
 for(const item of prepared){
  // Numeric arithmetic is performed by PostgreSQL, guarded against concurrent
  // insufficient stock and scoped to the exact workspace and destination branch.
  const updated=await tx.query('UPDATE branch_ingredients SET stock_qty=stock_qty-$1,updated_at=CURRENT_TIMESTAMP '+
    'WHERE id=$2 AND workspace_id=$3 AND branch_id=$4 AND active=$5 AND stock_qty>=$1 RETURNING stock_qty',
    [item.qty,item.id,ws,branch,true]);
  if(updated.rows.length!==1)
   throw fail('Insufficient isolated branch stock for '+item.name+'. Replenish this branch before checkout.');
  await tx.query('INSERT INTO branch_inventory_movements('+
    'workspace_id,branch_id,ingredient_id,movement_type,quantity_change,balance_after,reference,remarks,created_by) '+
    'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[
     ws,branch,item.id,'POS_SALE',-Number(item.qty),Number(updated.rows[0].stock_qty),
     String(reference),'Checkout '+String(reference)+' mirrored from legacy sale',positive(actorId)
    ]);
 }
 return{mirrored:true,items:prepared.length};
}
async function restoreSale(tx,{workspaceId,branchId,reference,actorId}){
 if(!await originalWorkspace(tx,workspaceId))return{mirrored:false,items:0};
 const {ws,branch}=await ownership(tx,workspaceId,branchId);
 const movements=await tx.query('SELECT ingredient_id,SUM(quantity_change) AS net_change '+
   'FROM branch_inventory_movements WHERE workspace_id=$1 AND branch_id=$2 '+
   'AND reference=$3 AND movement_type=$4 GROUP BY ingredient_id ORDER BY ingredient_id',
   [ws,branch,String(reference),'POS_SALE']);
 let restored=0;
 for(const row of movements.rows){
  const id=positive(row.ingredient_id),n=-Number(row.net_change);
  if(!id||!Number.isFinite(n)||n<=0)throw fail('Original branch sale movement is invalid. Stock restoration cancelled.');
  const qty=quantity(n);
  const updated=await tx.query('UPDATE branch_ingredients SET stock_qty=stock_qty+$1,updated_at=CURRENT_TIMESTAMP '+
    'WHERE id=$2 AND workspace_id=$3 AND branch_id=$4 RETURNING stock_qty',
    [qty,id,ws,branch]);
  if(updated.rows.length!==1)throw fail('Original branch stock record could not be restored. Sale reversal cancelled.');
  await tx.query('INSERT INTO branch_inventory_movements('+
    'workspace_id,branch_id,ingredient_id,movement_type,quantity_change,balance_after,reference,remarks,created_by) '+
    'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[
     ws,branch,id,'POS_SALE_REVERSAL',Number(qty),Number(updated.rows[0].stock_qty),
     String(reference),'Stock restored from mirrored POS sale',positive(actorId)
    ]);
  restored++;
 }
 // Sales from before this bridge have no branch POS_SALE movements. Do not
 // fabricate or retroactively credit their branch stock.
 return{mirrored:restored>0,items:restored};
}
module.exports={originalWorkspace,previewSale,applySale,restoreSale};
+(i+3)).join(',');
 const r=await tx.query('SELECT i.id AS legacy_id,i.code,i.uom AS legacy_uom,'+
   'b.id AS branch_ingredient_id,b.display_name,b.uom AS branch_uom,b.stock_qty,b.active '+
   'FROM ingredients i LEFT JOIN branch_ingredients b ON LOWER(b.code)=LOWER(i.code) '+
   'AND b.workspace_id=$1 AND b.branch_id=$2 WHERE i.id IN ('+idsSql+') ORDER BY i.id',
   [ws,branch,...ids]);
 const map=new Map(r.rows.map(x=>[positive(x.legacy_id),x]));
 const shortages=[];
 for(const req of sorted){
  const x=map.get(positive(req.ingredientId)),needed=Number(quantity(req.needed));
  const matches=x&&positive(x.branch_ingredient_id)&&isActive(x.active)&&
    String(x.branch_uom||'').trim().toUpperCase()===String(x.legacy_uom||'').trim().toUpperCase();
  if(!matches||!Number.isFinite(Number(x.stock_qty))||Number(x.stock_qty)+1e-9<needed)
   shortages.push({ingredientId:positive(req.ingredientId),
     name:String(x?.display_name||req.name||'Ingredient'),needed,
     stock:matches?Number(x.stock_qty):0,
     uom:String(x?.branch_uom||x?.legacy_uom||req.uom||'')});
 }
 if(shortages.length){
  const item=shortages[0];const e=fail('Insufficient branch ingredient stock for '+item.name+
    ': needs '+item.needed+' '+item.uom+', on hand '+item.stock+' '+item.uom+'.');
  e.details={shortages};throw e;
 }
 return{checked:true,shortages:[]};
}
async function applySale(tx,{workspaceId,branchId,requirements,reference,actorId}){
 if(!await originalWorkspace(tx,workspaceId))return{mirrored:false,items:0};
 if(!Array.isArray(requirements))throw fail('Invalid checkout ingredient requirements.');
 const {ws,branch}=await ownership(tx,workspaceId,branchId);
 const prepared=[];
 for(const req of [...requirements].sort((a,b)=>Number(a.ingredientId)-Number(b.ingredientId))){
  const legacyId=positive(req.ingredientId),qty=quantity(req.needed);
  if(!legacyId)throw fail('Invalid legacy recipe ingredient identifier.');
  const found=await tx.query('SELECT i.code AS legacy_code,i.uom AS legacy_uom,'+
    'b.id AS branch_ingredient_id,b.display_name,b.uom AS branch_uom,b.active '+
    'FROM ingredients i LEFT JOIN branch_ingredients b ON LOWER(b.code)=LOWER(i.code) '+
    'AND b.workspace_id=$1 AND b.branch_id=$2 WHERE i.id=$3',[ws,branch,legacyId]);
  if(found.rows.length!==1||!positive(found.rows[0].branch_ingredient_id))
   throw fail('Branch ingredient mapping is missing or ambiguous for '+String(req.name||legacyId)+'. Sale cancelled to protect inventory.');
  const row=found.rows[0];
  if(!isActive(row.active)||String(row.branch_uom||'').trim().toUpperCase()!==
    String(row.legacy_uom||'').trim().toUpperCase())
   throw fail('Branch ingredient is inactive or its unit differs from the recipe for '+String(req.name||legacyId)+'. Sale cancelled.');
  prepared.push({id:positive(row.branch_ingredient_id),qty,name:String(row.display_name||req.name||legacyId)});
 }
 for(const item of prepared){
  // Numeric arithmetic is performed by PostgreSQL, guarded against concurrent
  // insufficient stock and scoped to the exact workspace and destination branch.
  const updated=await tx.query('UPDATE branch_ingredients SET stock_qty=stock_qty-$1,updated_at=CURRENT_TIMESTAMP '+
    'WHERE id=$2 AND workspace_id=$3 AND branch_id=$4 AND active=$5 AND stock_qty>=$1 RETURNING stock_qty',
    [item.qty,item.id,ws,branch,true]);
  if(updated.rows.length!==1)
   throw fail('Insufficient isolated branch stock for '+item.name+'. Replenish this branch before checkout.');
  await tx.query('INSERT INTO branch_inventory_movements('+
    'workspace_id,branch_id,ingredient_id,movement_type,quantity_change,balance_after,reference,remarks,created_by) '+
    'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[
     ws,branch,item.id,'POS_SALE',-Number(item.qty),Number(updated.rows[0].stock_qty),
     String(reference),'Checkout '+String(reference)+' mirrored from legacy sale',positive(actorId)
    ]);
 }
 return{mirrored:true,items:prepared.length};
}
async function restoreSale(tx,{workspaceId,branchId,reference,actorId}){
 if(!await originalWorkspace(tx,workspaceId))return{mirrored:false,items:0};
 const {ws,branch}=await ownership(tx,workspaceId,branchId);
 const movements=await tx.query('SELECT ingredient_id,SUM(quantity_change) AS net_change '+
   'FROM branch_inventory_movements WHERE workspace_id=$1 AND branch_id=$2 '+
   'AND reference=$3 AND movement_type=$4 GROUP BY ingredient_id ORDER BY ingredient_id',
   [ws,branch,String(reference),'POS_SALE']);
 let restored=0;
 for(const row of movements.rows){
  const id=positive(row.ingredient_id),n=-Number(row.net_change);
  if(!id||!Number.isFinite(n)||n<=0)throw fail('Original branch sale movement is invalid. Stock restoration cancelled.');
  const qty=quantity(n);
  const updated=await tx.query('UPDATE branch_ingredients SET stock_qty=stock_qty+$1,updated_at=CURRENT_TIMESTAMP '+
    'WHERE id=$2 AND workspace_id=$3 AND branch_id=$4 RETURNING stock_qty',
    [qty,id,ws,branch]);
  if(updated.rows.length!==1)throw fail('Original branch stock record could not be restored. Sale reversal cancelled.');
  await tx.query('INSERT INTO branch_inventory_movements('+
    'workspace_id,branch_id,ingredient_id,movement_type,quantity_change,balance_after,reference,remarks,created_by) '+
    'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[
     ws,branch,id,'POS_SALE_REVERSAL',Number(qty),Number(updated.rows[0].stock_qty),
     String(reference),'Stock restored from mirrored POS sale',positive(actorId)
    ]);
  restored++;
 }
 // Sales from before this bridge have no branch POS_SALE movements. Do not
 // fabricate or retroactively credit their branch stock.
 return{mirrored:restored>0,items:restored};
}
module.exports={originalWorkspace,applySale,restoreSale};
