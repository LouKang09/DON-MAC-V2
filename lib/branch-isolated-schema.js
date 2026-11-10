'use strict';
// Phase 1 only: additive tables, NO legacy data migration or POS cutover.
// Must execute after chat workspace/branch ownership mappings are initialized.
const TABLES=Object.freeze([
 'branch_categories','branch_products','branch_ingredients','branch_recipes',
 'branch_category_products','branch_addons','branch_promos','branch_packages',
 'branch_package_items','branch_inventory_movements','starter_catalog_templates'
]);
function statements(engine){
 const postgres=engine==='postgres';
 const pk=postgres?'BIGSERIAL PRIMARY KEY':'INTEGER PRIMARY KEY AUTOINCREMENT';
 const fk=postgres?'BIGINT':'INTEGER';
 const timestamp=postgres?'TIMESTAMPTZ':'TEXT';
 const scope='workspace_id '+fk+' NOT NULL,branch_id '+fk+' NOT NULL';
 const ownerScope='FOREIGN KEY(branch_id,workspace_id) REFERENCES chat_workspace_branches(branch_id,workspace_id) ON DELETE RESTRICT';
 const scopedReference=(column,table)=>'FOREIGN KEY('+column+',workspace_id,branch_id) REFERENCES '+table+'(id,workspace_id,branch_id) ON DELETE RESTRICT';
 const dates='created_at '+timestamp+' NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at '+timestamp+' NOT NULL DEFAULT CURRENT_TIMESTAMP';
 return [
  // branch_id is already PK; this index supplies the composite FK candidate key.
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_branch_isolation_ownership ON chat_workspace_branches(branch_id,workspace_id)',
  `CREATE TABLE IF NOT EXISTS branch_categories(
    id ${pk},${scope},name VARCHAR(60) NOT NULL,icon_data TEXT,sort_order INTEGER NOT NULL DEFAULT 100,
    builtin BOOLEAN NOT NULL DEFAULT FALSE,active BOOLEAN NOT NULL DEFAULT TRUE,
    ${dates},UNIQUE(id,workspace_id,branch_id),${ownerScope})`,
  `CREATE TABLE IF NOT EXISTS branch_products(
    id ${pk},${scope},sku VARCHAR(120) NOT NULL,name VARCHAR(150) NOT NULL,
    category VARCHAR(60) NOT NULL,price NUMERIC(12,2) NOT NULL CHECK(price>=0),
    image_data TEXT,active BOOLEAN NOT NULL DEFAULT TRUE,${dates},
    UNIQUE(id,workspace_id,branch_id),${ownerScope})`,
  `CREATE TABLE IF NOT EXISTS branch_ingredients(
    id ${pk},${scope},code VARCHAR(160) NOT NULL,display_name VARCHAR(150) NOT NULL,
    uom VARCHAR(40) NOT NULL,stock_qty NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK(stock_qty>=0),
    low_stock_threshold NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK(low_stock_threshold>=0),
    unit_cost NUMERIC(18,9) NOT NULL DEFAULT 0 CHECK(unit_cost>=0),
    active BOOLEAN NOT NULL DEFAULT TRUE,${dates},
    UNIQUE(id,workspace_id,branch_id),${ownerScope})`,
  `CREATE TABLE IF NOT EXISTS branch_recipes(
    ${scope},product_id ${fk} NOT NULL,ingredient_id ${fk} NOT NULL,
    quantity_required NUMERIC(18,9) NOT NULL CHECK(quantity_required>0),
    cost_contribution NUMERIC(18,9) CHECK(cost_contribution IS NULL OR cost_contribution>=0),
    ${dates},PRIMARY KEY(workspace_id,branch_id,product_id,ingredient_id),
    ${ownerScope},${scopedReference('product_id','branch_products')},${scopedReference('ingredient_id','branch_ingredients')})`,
  `CREATE TABLE IF NOT EXISTS branch_category_products(
    ${scope},category_id ${fk} NOT NULL,product_id ${fk} NOT NULL,
    PRIMARY KEY(workspace_id,branch_id,category_id,product_id),
    ${ownerScope},${scopedReference('category_id','branch_categories')},${scopedReference('product_id','branch_products')})`,
  `CREATE TABLE IF NOT EXISTS branch_addons(
    id ${pk},${scope},name VARCHAR(150) NOT NULL,price NUMERIC(12,2) NOT NULL CHECK(price>=0),
    exclude_from_costing BOOLEAN NOT NULL DEFAULT TRUE,active BOOLEAN NOT NULL DEFAULT TRUE,
    ${dates},UNIQUE(id,workspace_id,branch_id),${ownerScope})`,
  `CREATE TABLE IF NOT EXISTS branch_promos(
    id ${pk},${scope},name VARCHAR(150) NOT NULL,inclusion_label VARCHAR(100),
    promo_price NUMERIC(12,2) NOT NULL CHECK(promo_price>=0),
    food_limit INTEGER CHECK(food_limit IS NULL OR food_limit>=0),
    coffee_limit INTEGER CHECK(coffee_limit IS NULL OR coffee_limit>=0),
    active BOOLEAN NOT NULL DEFAULT TRUE,${dates},
    UNIQUE(id,workspace_id,branch_id),${ownerScope})`,
  `CREATE TABLE IF NOT EXISTS branch_packages(
    id ${pk},${scope},name VARCHAR(150) NOT NULL,price NUMERIC(12,2) NOT NULL CHECK(price>=0),
    active BOOLEAN NOT NULL DEFAULT TRUE,${dates},
    UNIQUE(id,workspace_id,branch_id),${ownerScope})`,
  `CREATE TABLE IF NOT EXISTS branch_package_items(
    ${scope},package_id ${fk} NOT NULL,product_id ${fk} NOT NULL,
    quantity NUMERIC(12,3) NOT NULL CHECK(quantity>0),
    PRIMARY KEY(workspace_id,branch_id,package_id,product_id),
    ${ownerScope},${scopedReference('package_id','branch_packages')},${scopedReference('product_id','branch_products')})`,
  `CREATE TABLE IF NOT EXISTS branch_inventory_movements(
    id ${pk},${scope},ingredient_id ${fk} NOT NULL,
    movement_type VARCHAR(40) NOT NULL,quantity_change NUMERIC(18,9) NOT NULL,
    balance_after NUMERIC(18,6) CHECK(balance_after IS NULL OR balance_after>=0),
    reference VARCHAR(100),received_by VARCHAR(150),delivered_by VARCHAR(150),
    remarks TEXT,created_by ${fk} REFERENCES users(id) ON DELETE SET NULL,
    created_at ${timestamp} NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(id,workspace_id,branch_id),${ownerScope},${scopedReference('ingredient_id','branch_ingredients')})`,
  `CREATE TABLE IF NOT EXISTS starter_catalog_templates(
    id ${pk},source_workspace_id ${fk} NOT NULL REFERENCES chat_workspaces(id) ON DELETE RESTRICT,
    source_branch_id ${fk},template_key VARCHAR(100) NOT NULL,
    version INTEGER NOT NULL CHECK(version>0),
    title VARCHAR(160) NOT NULL,template_json TEXT NOT NULL,
    checksum_sha256 VARCHAR(64),active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by ${fk} REFERENCES users(id) ON DELETE SET NULL,
    created_at ${timestamp} NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(source_workspace_id,template_key,version),
    FOREIGN KEY(source_branch_id,source_workspace_id)
      REFERENCES chat_workspace_branches(branch_id,workspace_id) ON DELETE RESTRICT)`,
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_isolated_categories_name ON branch_categories(workspace_id,branch_id,LOWER(name))',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_isolated_products_sku ON branch_products(workspace_id,branch_id,LOWER(sku))',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_isolated_products_name ON branch_products(workspace_id,branch_id,LOWER(name))',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_isolated_ingredients_code ON branch_ingredients(workspace_id,branch_id,LOWER(code))',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_isolated_addons_name ON branch_addons(workspace_id,branch_id,LOWER(name))',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_isolated_promos_name ON branch_promos(workspace_id,branch_id,LOWER(name))',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_isolated_packages_name ON branch_packages(workspace_id,branch_id,LOWER(name))',
  'CREATE INDEX IF NOT EXISTS idx_isolated_products_listing ON branch_products(workspace_id,branch_id,category,active)',
  'CREATE INDEX IF NOT EXISTS idx_isolated_ingredients_listing ON branch_ingredients(workspace_id,branch_id,active)',
  'CREATE INDEX IF NOT EXISTS idx_isolated_movements_recent ON branch_inventory_movements(workspace_id,branch_id,created_at)',
  'CREATE INDEX IF NOT EXISTS idx_isolated_templates_owner ON starter_catalog_templates(source_workspace_id,active,created_at)'
 ];
}
async function status(db){
 const quoted=TABLES.map(name=>"'"+name+"'").join(',');
 const sql=db.engine==='postgres'
   ?"SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ("+quoted+")"
   :"SELECT name AS table_name FROM sqlite_master WHERE type='table' AND name IN ("+quoted+")";
 const found=new Set((await db.query(sql)).rows.map(r=>r.table_name));
 const missing=TABLES.filter(t=>!found.has(t));
 return{phase:1,ready:missing.length===0,tablesCreated:TABLES.length-missing.length,
  expectedTables:TABLES.length,missingTables:missing,
  livePosCutover:false,dataCopied:false,legacyDataPreserved:true};
}
async function migrate(db){
 if(!['postgres','sqlite'].includes(db.engine))throw new Error('Unsupported schema engine.');
 return db.transaction(async tx=>{
  // Serialize startup of Main POS and Supply Office against a shared Postgres.
  if(tx.engine==='postgres')await tx.query('SELECT pg_advisory_xact_lock(2026111001::bigint)');
  for(const sql of statements(tx.engine))await tx.exec(sql);
  const check=await status(tx);
  if(!check.ready)throw new Error('Branch isolation schema missing: '+check.missingTables.join(', '));
  return check;
 });
}
module.exports={TABLES,statements,status,migrate};
