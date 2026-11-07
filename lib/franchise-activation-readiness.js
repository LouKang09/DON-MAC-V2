'use strict';
// Read-only activation preflight; deliberately fail-closed until every live route is tenant-scoped.
const required=[
 {table:'products',area:'Product catalog'},
 {table:'add_ons',area:'Add-ons'},
 {table:'ingredients',area:'Ingredient stock'},
 {table:'product_ingredients',area:'Recipes & costing'},
 {table:'packages',area:'Packages'},
 {table:'package_items',area:'Package composition'},
 {table:'promos',area:'Promotions'},
 {table:'sales',area:'Sales'},
 {table:'sale_items',area:'Sale item records'},
 {table:'inventory_movements',area:'Inventory movement audit'},
 {table:'system_logs',area:'System audit records'},
 {table:'app_settings',area:'Franchise-specific configuration'}
];
async function columnNames(db,table){
 if(db.engine==='postgres'){
  const r=await db.query('SELECT column_name FROM information_schema.columns '+
   'WHERE table_schema=current_schema() AND table_name=$1',[table]);
  return new Set(r.rows.map(x=>x.column_name));
 }
 // Names come only from the compiled safe allowlist above, not from HTTP inputs.
 const r=await db.query('PRAGMA table_info('+table+')');
 return new Set(r.rows.map(x=>x.name));
}
async function inspect(db){
 const missing=[];
 for(const entry of required){
  const columns=await columnNames(db,entry.table);
  if(!columns.size)missing.push({table:entry.table,area:entry.area,reason:'Table not found'});
  else if(!columns.has('workspace_id'))
   missing.push({table:entry.table,area:entry.area,reason:'Tenant key not configured'});
 }
 // Column presence alone never proves that writes, constraints, reports and exports are scoped.
 const remaining=[
  'Backfill and reconcile legacy catalog ownership without clearing records',
  'Convert POS catalog, checkout, recipe, replenishment, transfers and reporting to workspace-scoped operations',
  'Enforce workspace-aware constraints and audit backups, attachments and caches',
  'Run cross-tenant read/write isolation, OTP replay, payment lockout and restore tests'
 ];
 return{activationEnabled:false,stage:'ISOLATION_IN_PROGRESS',
  checkedTables:required.length,missing,missingCount:missing.length,
  routeAuditComplete:false,legacyBackfillVerified:false,crossTenantTestsPassed:false,
  remaining,
  message:'Direct account activation remains locked until live POS data isolation and security tests pass. Verified applications can prepare independent starter catalogs without granting login.'};
}
module.exports={inspect,required};
