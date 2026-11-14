'use strict';
// Read-only isolation reconciliation; does not change active POS operations.
const fail=(message,status=403)=>Object.assign(new Error(message),{status});
const id=x=>Number.isSafeInteger(Number(x))&&Number(x)>0?Number(x):0;
async function workspace(db,user){
 if(!user?.id||user.role!=='Admin')throw fail('Owner or Co-Owner access required.');
 const rows=(await db.query('SELECT workspace_id FROM chat_memberships WHERE user_id=$1 ORDER BY workspace_id LIMIT 2',[user.id])).rows;
 if(rows.length!==1||!id(rows[0].workspace_id))
   throw fail('Account must belong to exactly one franchise.');
 return id(rows[0].workspace_id);
}
async function branchAccess(db,workspaceId,branchId){
 const rows=(await db.query('SELECT b.id,b.name,b.active,p.opening_stock,p.template_id '+
 'FROM chat_workspace_branches wb JOIN branches b ON b.id=wb.branch_id '+
 'LEFT JOIN branch_catalog_provisioning p ON p.branch_id=wb.branch_id AND p.workspace_id=wb.workspace_id '+
 'WHERE wb.workspace_id=$1 AND wb.branch_id=$2',[workspaceId,branchId])).rows;
 if(rows.length!==1)throw fail('Branch is not owned by your franchise.');
 return rows[0];
}
const TABLES={products:'branch_products',ingredients:'branch_ingredients',
 recipes:'branch_recipes',categories:'branch_categories',
 addOns:'branch_addons',promos:'branch_promos',packages:'branch_packages',
 packageItems:'branch_package_items',movements:'branch_inventory_movements'};
async function audit(db,user){
 const workspaceId=await workspace(db,user);
 const list=(await db.query('SELECT wb.branch_id,b.name,p.opening_stock,p.template_id '+
 'FROM chat_workspace_branches wb JOIN branches b ON b.id=wb.branch_id '+
 'LEFT JOIN branch_catalog_provisioning p ON p.branch_id=wb.branch_id AND p.workspace_id=wb.workspace_id '+
 'WHERE wb.workspace_id=$1 ORDER BY wb.branch_id',[workspaceId])).rows;
 const branches=[];
 for(const row of list){
  const branchId=id(row.branch_id),counts={};
  for(const [key,table] of Object.entries(TABLES)){
   const r=await db.query('SELECT COUNT(*) AS n FROM '+table+' WHERE workspace_id=$1 AND branch_id=$2',
    [workspaceId,branchId]);
   counts[key]=Number(r.rows[0]?.n||0);
  }
  const stock=(await db.query('SELECT COUNT(*) AS n,MIN(stock_qty) AS min_stock,'+
   'MAX(stock_qty) AS max_stock FROM branch_ingredients WHERE workspace_id=$1 AND branch_id=$2',
   [workspaceId,branchId])).rows[0]||{};
  const missingRefs=(await db.query(
   'SELECT COUNT(*) AS n FROM branch_recipes r '+
   'LEFT JOIN branch_products p ON p.id=r.product_id AND p.workspace_id=r.workspace_id AND p.branch_id=r.branch_id '+
   'LEFT JOIN branch_ingredients i ON i.id=r.ingredient_id AND i.workspace_id=r.workspace_id AND i.branch_id=r.branch_id '+
   'WHERE r.workspace_id=$1 AND r.branch_id=$2 AND (p.id IS NULL OR i.id IS NULL)',
   [workspaceId,branchId])).rows[0]?.n||0;
  branches.push({branchId,name:row.name,prepared:row.template_id!=null,
   openingStock:row.opening_stock==null?null:Number(row.opening_stock),
   templateId:row.template_id==null?null:id(row.template_id),
   counts,stockRange:counts.ingredients?{
    min:Number(stock.min_stock),max:Number(stock.max_stock)}:null,
   integrity:!Number(missingRefs)});
 }
 const allPrepared=branches.length>0&&branches.every(b=>b.prepared&&b.integrity);
 return{workspaceId,branches,allPrepared,
  backupRestoredVerified:false,liveCheckoutUsesIsolatedCatalog:false,
  warning:'This is a read-only reconciliation view, not proof that backup restoration or live POS cutover is complete.'};
}
async function preview(db,user,rawBranch){
 const workspaceId=await workspace(db,user),branchId=id(rawBranch);
 if(!branchId)throw fail('Choose a valid branch.',400);
 const branch=await branchAccess(db,workspaceId,branchId);
 if(branch.template_id==null)throw fail('Isolated catalog has not been prepared for this branch.',409);
 const args=[workspaceId,branchId];
 const [products,ingredients,recipes]=await Promise.all([
  db.query('SELECT id,sku,name,category,price,active FROM branch_products '+
    'WHERE workspace_id=$1 AND branch_id=$2 ORDER BY category,name LIMIT 500',args),
  db.query('SELECT id,code,display_name,uom,stock_qty,low_stock_threshold,unit_cost,active '+
    'FROM branch_ingredients WHERE workspace_id=$1 AND branch_id=$2 ORDER BY display_name LIMIT 500',args),
  db.query('SELECT r.product_id,p.name AS product_name,r.ingredient_id,'+
    'i.display_name AS ingredient_name,r.quantity_required,r.cost_contribution '+
    'FROM branch_recipes r JOIN branch_products p ON p.id=r.product_id AND '+
    'p.workspace_id=r.workspace_id AND p.branch_id=r.branch_id '+
    'JOIN branch_ingredients i ON i.id=r.ingredient_id AND '+
    'i.workspace_id=r.workspace_id AND i.branch_id=r.branch_id '+
    'WHERE r.workspace_id=$1 AND r.branch_id=$2 ORDER BY p.name,i.display_name LIMIT 2000',args)
 ]);
 return{workspaceId,branch:{id:branchId,name:branch.name},
  openingStock:Number(branch.opening_stock),
  products:products.rows,ingredients:ingredients.rows,recipes:recipes.rows,
  readOnly:true,liveCutover:false};
}
module.exports={audit,preview,workspace,branchAccess};
