'use strict';
// Non-destructive visibility before any branch-isolated catalog migration.
const fail=message=>Object.assign(new Error(message),{status:403});
const number=x=>Number(x||0);
async function count(db,sql,params=[]){return number((await db.query(sql,params)).rows[0]?.n);}
async function inspect(db,user){
 if(!user?.id||user.role!=='Admin')throw fail('Only a signed-in administrator can audit their franchise isolation.');
 const memberships=(await db.query('SELECT workspace_id FROM chat_memberships WHERE user_id=$1 ORDER BY workspace_id LIMIT 2',[user.id])).rows;
 if(memberships.length!==1)throw fail('A user must belong to exactly one franchise workspace.');
 const workspaceId=number(memberships[0].workspace_id);
 if(!Number.isSafeInteger(workspaceId)||workspaceId<1)throw fail('Invalid workspace.');
 const branchRows=(await db.query('SELECT b.id,b.name,b.active FROM chat_workspace_branches w JOIN branches b ON b.id=w.branch_id WHERE w.workspace_id=$1 ORDER BY b.id',[workspaceId])).rows;
 const owner=(await db.query('SELECT w.owner_user_id,COALESCE(u.login_username,u.username) AS username FROM chat_workspaces w LEFT JOIN users u ON u.id=w.owner_user_id WHERE w.id=$1',[workspaceId])).rows[0]||{};
 const multiplyAssignedBranches=await count(db,'SELECT COUNT(*) AS n FROM (SELECT branch_id FROM chat_workspace_branches GROUP BY branch_id HAVING COUNT(DISTINCT workspace_id)>1) conflicts');
 const unmappedSales=await count(db,'SELECT COUNT(*) AS n FROM sales s WHERE s.branch_id IS NULL OR NOT EXISTS(SELECT 1 FROM chat_workspace_branches w WHERE w.branch_id=s.branch_id)');
 const franchiseSales=await count(db,'SELECT COUNT(*) AS n FROM sales s WHERE EXISTS(SELECT 1 FROM chat_workspace_branches w WHERE w.workspace_id=$1 AND w.branch_id=s.branch_id)',[workspaceId]);
 const catalogCounts={};
 for(const [field,table] of [['products','products'],['ingredients','ingredients'],['recipes','product_ingredients'],['addOns','add_ons'],['promos','promos'],['packages','packages'],['stockMovements','inventory_movements']]){
  catalogCounts[field]=await count(db,'SELECT COUNT(*) AS n FROM '+table);
 }
 return{workspaceId,ownerId:owner.owner_user_id==null?null:number(owner.owner_user_id),ownerUsername:owner.username||null,
  branches:branchRows.map(x=>({id:number(x.id),name:x.name,active:x.active===true||x.active===1})),
  franchiseSales,multiplyAssignedBranches,unmappedSales,sharedCatalogCounts:catalogCounts,
  stage:'PREFLIGHT_ONLY',backupVerified:false,branchCatalogIsolated:false,safeToDeleteSharedData:false,
  blockers:[
   ...(multiplyAssignedBranches?['Branch assigned to multiple franchises.']:[]),
   ...(unmappedSales?['Some historical sales have no franchise branch mapping.']:[]),
   'Legacy catalog, ingredient, recipe and stock tables have no branch ownership.',
   'A complete PostgreSQL backup and tested restore are required before deleting any shared rows.'
  ]};
}
module.exports={inspect};
