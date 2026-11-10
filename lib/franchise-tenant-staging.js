'use strict';
// Isolated staging only. Data here is never read by live POS checkout/catalog APIs.
const crypto=require('node:crypto');
const {summarize}=require('./franchise-starter-catalog');
const {approvedBlueprint}=require('./branch-catalog-seeding');
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const uuid=()=>crypto.randomUUID();
async function migrate(db){
 await db.exec(`CREATE TABLE IF NOT EXISTS franchise_provisioning_stages(
 request_id VARCHAR(40) PRIMARY KEY REFERENCES public_franchise_requests(id) ON DELETE RESTRICT,
 workspace_key VARCHAR(40) NOT NULL UNIQUE,template_version INTEGER NOT NULL,
 stage_status VARCHAR(40) NOT NULL,created_at TEXT NOT NULL,created_by VARCHAR(100) NOT NULL)`);
 await db.exec(`CREATE TABLE IF NOT EXISTS franchise_staged_products(
 id VARCHAR(40) PRIMARY KEY,request_id VARCHAR(40) NOT NULL REFERENCES franchise_provisioning_stages(request_id),
 source_product_id BIGINT,sku VARCHAR(120) NOT NULL,name VARCHAR(150) NOT NULL,
 category VARCHAR(35) NOT NULL,price NUMERIC(12,2) NOT NULL DEFAULT 0,
 image_data TEXT,active BOOLEAN NOT NULL DEFAULT TRUE,
 UNIQUE(request_id,sku),UNIQUE(request_id,name))`);
 await db.exec(`CREATE TABLE IF NOT EXISTS franchise_staged_ingredients(
 id VARCHAR(40) PRIMARY KEY,request_id VARCHAR(40) NOT NULL REFERENCES franchise_provisioning_stages(request_id),
 source_ingredient_id BIGINT,code VARCHAR(160) NOT NULL,display_name VARCHAR(150) NOT NULL,
 uom VARCHAR(40) NOT NULL,stock_qty NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK(stock_qty=0),
 low_stock_threshold NUMERIC(18,6) NOT NULL DEFAULT 0,active BOOLEAN NOT NULL DEFAULT TRUE,
 UNIQUE(request_id,code))`);
 await db.exec(`CREATE TABLE IF NOT EXISTS franchise_staged_recipes(
 request_id VARCHAR(40) NOT NULL REFERENCES franchise_provisioning_stages(request_id),
 product_id VARCHAR(40) NOT NULL REFERENCES franchise_staged_products(id),
 ingredient_id VARCHAR(40) NOT NULL REFERENCES franchise_staged_ingredients(id),
 quantity_required NUMERIC(18,9) NOT NULL, cost_contribution NUMERIC(18,9),
 PRIMARY KEY(request_id,product_id,ingredient_id))`);
 await db.exec(`CREATE TABLE IF NOT EXISTS franchise_staged_addons(
 id VARCHAR(40) PRIMARY KEY,request_id VARCHAR(40) NOT NULL REFERENCES franchise_provisioning_stages(request_id),
 source_addon_id BIGINT,name VARCHAR(150) NOT NULL,price NUMERIC(12,2) NOT NULL DEFAULT 0,
 exclude_from_costing BOOLEAN NOT NULL DEFAULT TRUE,
 UNIQUE(request_id,name))`);
}
async function status(db,requestId){
 const r=await db.query('SELECT request_id,workspace_key,template_version,stage_status,created_at,created_by '+
  'FROM franchise_provisioning_stages WHERE request_id=$1',[requestId]);
 if(!r.rows.length)return{prepared:false};
 const stage=r.rows[0],counts={};
 for(const [key,table] of [['products','franchise_staged_products'],['ingredients','franchise_staged_ingredients'],
 ['recipes','franchise_staged_recipes'],['addOns','franchise_staged_addons']]){
  counts[key]=Number((await db.query('SELECT COUNT(*) AS n FROM '+table+' WHERE request_id=$1',[requestId])).rows[0]?.n||0);
 }
 const stock=await db.query('SELECT COALESCE(SUM(stock_qty),0) AS qty FROM franchise_staged_ingredients WHERE request_id=$1',[requestId]);
 return{prepared:true,status:stage.stage_status,templateVersion:stage.template_version,
  createdAt:stage.created_at,counts,openingStock:Number(stock.rows[0]?.qty||0),
  loginEnabled:false,livePosAccess:false};
}
async function preview(db){
 const blueprint=await approvedBlueprint(db);
 const counts=summarize(blueprint);
 return{templateVersion:blueprint.templateVersion,source:blueprint.source,counts,
  notice:'Definitions (names, prices, recipe quantities, product pictures) can be copied only when Admin Control approves. Existing owners, sales, stock, customers, payments and history are never copied.'};
}
async function prepare(db,requestId,body,actor){
 if(!/^[0-9a-f-]{36}$/i.test(String(requestId||'')))throw fail('Invalid application ID.');
 if(body?.confirmation!=='APPROVE STARTER CATALOG')throw fail('Explicit starter-catalog approval is required.');
 const application=(await db.query('SELECT id,status,email_verified_at FROM public_franchise_requests WHERE id=$1',[requestId])).rows[0];
 if(!application)throw fail('Application was not found.',404);
 if(!application.email_verified_at)throw fail('Applicant email must be verified before a starter catalog is prepared.',409);
 if(application.status==='REJECTED')throw fail('Cannot prepare a rejected application.',409);
 const existing=await status(db,requestId);
 if(existing.prepared)return existing;
 // Uses a master snapshot only after an explicit Admin Control action.
 const blueprint=await approvedBlueprint(db);
 const productIds=new Map(),ingredientIds=new Map();
 const staged=await db.transaction(async tx=>{
  const key=uuid(),now=new Date().toISOString();
  const created=await tx.query('INSERT INTO franchise_provisioning_stages('+
   'request_id,workspace_key,template_version,stage_status,created_at,created_by) '+
   'VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(request_id) DO NOTHING RETURNING request_id',
   [requestId,key,blueprint.templateVersion,'PREPARED_NO_ACCESS',now,String(actor||'Admin Control').slice(0,100)]);
  if(!created.rows.length)return false;
  for(const p of blueprint.products){
   const id=uuid();productIds.set(Number(p.sourceId),id);
   await tx.query('INSERT INTO franchise_staged_products('+
    'id,request_id,source_product_id,sku,name,category,price,image_data,active) '+
    'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [id,requestId,p.sourceId,p.sku||'STARTER-'+p.sourceId,p.name,p.category,p.price,p.imageData||null,true]);
  }
  for(const i of blueprint.ingredients){
   const id=uuid();ingredientIds.set(Number(i.sourceId),id);
   await tx.query('INSERT INTO franchise_staged_ingredients('+
    'id,request_id,source_ingredient_id,code,display_name,uom,stock_qty,low_stock_threshold,active) '+
    'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [id,requestId,i.sourceId,i.code,i.name,i.uom,0,i.threshold,true]);
  }
  for(const r of blueprint.recipes){
   const productId=productIds.get(r.sourceProductId),ingredientId=ingredientIds.get(r.sourceIngredientId);
   if(!productId||!ingredientId)throw fail('Starter recipe references a missing catalog item. No changes were applied.',409);
   await tx.query('INSERT INTO franchise_staged_recipes('+
    'request_id,product_id,ingredient_id,quantity_required,cost_contribution) VALUES($1,$2,$3,$4,$5)',
    [requestId,productId,ingredientId,r.quantityRequired,r.costContribution]);
  }
  for(const a of blueprint.addOns){
   await tx.query('INSERT INTO franchise_staged_addons('+
    'id,request_id,source_addon_id,name,price,exclude_from_costing) VALUES($1,$2,$3,$4,$5,$6)',
    [uuid(),requestId,a.sourceId,a.name,a.price,a.excludeFromCosting]);
  }
  return true;
 });
 return{...(await status(db,requestId)),newlyPrepared:staged===true};
}
module.exports={migrate,preview,prepare,status};
