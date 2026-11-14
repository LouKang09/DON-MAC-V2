'use strict';
// One-time, narrowly scoped test inventory reset for the existing Marlou09
// workspace. It does NOT modify legacy ingredients, sales, costing or other tenants.
const catalog=require('./branch-catalog-seeding');
const RESET_KEY='MARLOU09_TEST_STOCK_FIVE_20261114_V1';
const target=5;
const fail=message=>Object.assign(new Error(message),{status:409});
async function migrate(db){
 const id=db.engine==='postgres'?'BIGINT':'INTEGER';
 const ts=db.engine==='postgres'?'TIMESTAMPTZ':'TEXT';
 await db.exec('CREATE TABLE IF NOT EXISTS branch_test_stock_resets ('+
  'workspace_id '+id+' NOT NULL REFERENCES chat_workspaces(id) ON DELETE RESTRICT,'+
  'reset_key VARCHAR(100) NOT NULL,branch_count INTEGER NOT NULL,'+
  'ingredient_count INTEGER NOT NULL,changed_count INTEGER NOT NULL,'+
  'created_by '+id+' REFERENCES users(id) ON DELETE SET NULL,'+
  'created_at '+ts+' NOT NULL DEFAULT CURRENT_TIMESTAMP,'+
  'PRIMARY KEY (workspace_id,reset_key))');
}
async function apply(db){
 return db.transaction(async tx=>{
  if(tx.engine==='postgres')await tx.query('SELECT pg_advisory_xact_lock(2026111402::bigint)');
  const owner=await catalog.originalOwner(tx);
  if(!owner)return{status:'skipped_owner_not_found',resetKey:RESET_KEY};
  const workspaceId=owner.workspaceId;
  const existing=(await tx.query('SELECT branch_count,ingredient_count,changed_count '+
    'FROM branch_test_stock_resets WHERE workspace_id=$1 AND reset_key=$2',
    [workspaceId,RESET_KEY])).rows;
  if(existing.length)return{status:'already_applied',workspaceId,resetKey:RESET_KEY,
    branches:Number(existing[0].branch_count),ingredients:Number(existing[0].ingredient_count),
    changed:Number(existing[0].changed_count)};
  const branches=(await tx.query('SELECT wb.branch_id,p.template_id '+
   'FROM chat_workspace_branches wb '+
   'LEFT JOIN branch_catalog_provisioning p ON p.workspace_id=wb.workspace_id AND p.branch_id=wb.branch_id '+
   'WHERE wb.workspace_id=$1 ORDER BY wb.branch_id',[workspaceId])).rows;
  if(!branches.length||branches.some(x=>x.template_id==null))
   throw fail('Marlou branch catalog initialization is incomplete; test reset cancelled.');
  const validBranches=new Set(branches.map(x=>Number(x.branch_id)));
  const ingredients=(await tx.query('SELECT id,branch_id,stock_qty '+
    'FROM branch_ingredients WHERE workspace_id=$1 ORDER BY branch_id,id'+
    (tx.engine==='postgres'?' FOR UPDATE':''),
    [workspaceId])).rows;
  const counts=new Map();
  for(const row of ingredients){
   const bid=Number(row.branch_id);
   if(!validBranches.has(bid))throw fail('Unexpected branch ownership in isolated stock.');
   counts.set(bid,(counts.get(bid)||0)+1);
  }
  if(!ingredients.length||branches.some(x=>!counts.get(Number(x.branch_id))))
   throw fail('At least one Marlou branch has no initialized ingredients.');
  let changed=0;
  for(const row of ingredients){
   const before=Number(row.stock_qty);
   if(!Number.isFinite(before)||before<0)throw fail('Invalid source stock; test reset cancelled.');
   if(Math.abs(before-target)<0.0000001)continue;
   const branchId=Number(row.branch_id),ingredientId=Number(row.id),difference=target-before;
   await tx.query('UPDATE branch_ingredients SET stock_qty=$1,updated_at=CURRENT_TIMESTAMP '+
     'WHERE id=$2 AND workspace_id=$3 AND branch_id=$4',
     [target,ingredientId,workspaceId,branchId]);
   await tx.query('INSERT INTO branch_inventory_movements '+
     '(workspace_id,branch_id,ingredient_id,movement_type,quantity_change,balance_after,reference,remarks,created_by) '+
     'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
     [workspaceId,branchId,ingredientId,'TEST_STOCK_RESET',difference,target,
       RESET_KEY,'One-time Marlou09 test stock set to five; no legacy data changed.',owner.ownerId]);
   changed++;
  }
  const check=(await tx.query('SELECT branch_id,COUNT(*) AS n,MIN(stock_qty) AS min_stock,MAX(stock_qty) AS max_stock '+
     'FROM branch_ingredients WHERE workspace_id=$1 GROUP BY branch_id',[workspaceId])).rows;
  if(check.length!==branches.length||check.some(x=>Number(x.min_stock)!==5||Number(x.max_stock)!==5))
    throw fail('Post-reset integrity check failed; entire transaction rolled back.');
  await tx.query('INSERT INTO branch_test_stock_resets '+
   '(workspace_id,reset_key,branch_count,ingredient_count,changed_count,created_by) '+
   'VALUES($1,$2,$3,$4,$5,$6)',
   [workspaceId,RESET_KEY,branches.length,ingredients.length,changed,owner.ownerId]);
  return{status:'applied',workspaceId,resetKey:RESET_KEY,
   branches:branches.length,ingredients:ingredients.length,changed,stockPerIngredient:5,
   legacyCatalogModified:false,otherWorkspacesModified:false};
 });
}
module.exports={RESET_KEY,migrate,apply};
