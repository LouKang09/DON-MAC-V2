'use strict';
const LEGACY_PREFIXES=Object.freeze([
 '/api/catalog','/api/quote','/api/sales','/api/inventory',
 '/api/dashboard','/api/reports','/api/backups',
 '/api/admin/products','/api/admin/ingredients','/api/admin/promos',
 '/api/admin/packages','/api/admin/pos-categories',
 '/api/admin/imports'
]);
function usesSharedCatalog(path){
 return LEGACY_PREFIXES.some(p=>path===p||path.startsWith(p+'/'));
}
async function preventSharedCatalogLeak(db,user,path){
 if(!usesSharedCatalog(path))return;
 if(!Number.isSafeInteger(Number(user?.id))||Number(user.id)<1)
  throw Object.assign(new Error('Authentication required.'),{status:401});
 const rows=(await db.query(
  'SELECT 1 FROM chat_memberships m JOIN starter_catalog_templates t '+
  'ON t.source_workspace_id=m.workspace_id '+
  'WHERE m.user_id=$1 AND t.template_key=$2 AND t.version=$3 AND t.active=$4 LIMIT 1',
  [Number(user.id),'donmac-original-catalog',1,true])).rows;
 if(rows.length!==1)
  throw Object.assign(new Error(
   'This franchise catalog is not yet activated. Contact Admin Control. No shared data has been exposed.'),
   {status:409,code:'FRANCHISE_ISOLATION_PENDING'});
}
module.exports={LEGACY_PREFIXES,usesSharedCatalog,preventSharedCatalogLeak};
