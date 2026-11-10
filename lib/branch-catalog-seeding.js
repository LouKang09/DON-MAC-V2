'use strict';
// Phase 2 preparation: non-destructive, idempotent copies of the verified
// legacy Marlou catalog into separately owned branch tables. Live POS is NOT
// switched here. Future owners always receive zero opening stock.
const crypto=require('node:crypto');
const OWNER='marlou09',TEMPLATE_KEY='donmac-original-catalog',TEMPLATE_VERSION=1;
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
const id=x=>Number.isSafeInteger(Number(x))&&Number(x)>0?Number(x):0;
const money=x=>Number(x);
const q=async(db,sql,params=[])=>((await db.query(sql,params)).rows);
const cast=(x,max)=>String(x==null?'':x).trim().slice(0,max);
const asBool=x=>x===true||x===1||x==='1'||x==='true';
function validate(template){
 if(!template||template.version!==2)throw fail('Unsupported starter catalog version.');
 for(const field of ['products','ingredients','recipes','categories','categoryProducts','addOns','promos','packages','packageItems'])
  if(!Array.isArray(template[field]))throw fail('Missing starter catalog definitions: '+field);
 const p=new Set(template.products.map(x=>id(x.sourceId)));
 const i=new Set(template.ingredients.map(x=>id(x.sourceId)));
 const pk=new Set(template.packages.map(x=>id(x.sourceId)));
 const cn=new Set(template.categories.map(x=>String(x.name).toUpperCase()));
 if([...p,...i,...pk].some(x=>!x))throw fail('Starter catalog contains invalid identifiers.');
 for(const x of template.products)
  if(!x.name||!x.sku||!Number.isFinite(money(x.price))||money(x.price)<0)
   throw fail('Invalid starter product: '+x.name);
 for(const x of template.ingredients)
  if(!x.code||!x.name||!x.uom||!Number.isFinite(money(x.threshold))||money(x.threshold)<0)
   throw fail('Invalid starter ingredient: '+x.name);
 for(const x of template.recipes)
  if(!p.has(id(x.sourceProductId))||!i.has(id(x.sourceIngredientId))||
     !Number.isFinite(money(x.quantityRequired))||money(x.quantityRequired)<=0||
     (x.costContribution!==null&&(!Number.isFinite(money(x.costContribution))||money(x.costContribution)<0)))
   throw fail('Invalid starter recipe or cost contribution.');
 for(const x of template.categoryProducts)
  if(!cn.has(String(x.categoryName).toUpperCase())||!p.has(id(x.sourceProductId)))
   throw fail('Starter category assignment references a missing product.');
 for(const x of template.packageItems)
  if(!pk.has(id(x.sourcePackageId))||!p.has(id(x.sourceProductId))||
    !Number.isFinite(money(x.quantity))||money(x.quantity)<=0)
   throw fail('Starter package references a missing product.');
 for(const group of ['addOns','promos','packages']){
  const value=group==='promos'?'price':'price';
  for(const x of template[group])if(!Number.isFinite(money(x[value]))||money(x[value])<0)
   throw fail('Invalid '+group+' price.');
 }
 return template;
}
async function originalOwner(tx){
 const rows=await q(tx,
  'SELECT w.id AS workspace_id,w.owner_user_id,'+
  'COALESCE(u.login_username,u.username) AS login_name,u.username '+
  'FROM chat_workspaces w JOIN users u ON u.id=w.owner_user_id '+
  'WHERE LOWER(u.username)=$1 OR LOWER(COALESCE(u.login_username,u.username))=$1 ORDER BY w.id',
  [OWNER]);
 if(rows.length===0)return null;
 if(rows.length!==1)throw fail('More than one Marlou workspace is configured. Manual ownership review required.');
 const r=rows[0];
 if(!id(r.workspace_id)||!id(r.owner_user_id))throw fail('Marlou owner workspace is incomplete.');
 return{workspaceId:id(r.workspace_id),ownerId:id(r.owner_user_id),username:String(r.login_name)};
}
async function legacySnapshot(tx){
 const [products,ingredients,recipes,categories,categoryProducts,addOns,promos,packages,packageItems]=await Promise.all([
  q(tx,'SELECT id,sku,name,category,price,image_data,active FROM products ORDER BY id'),
  q(tx,'SELECT id,code,display_name,uom,low_stock_threshold,active FROM ingredients ORDER BY id'),
  q(tx,'SELECT product_id,ingredient_id,quantity_required,cost_contribution FROM product_ingredients ORDER BY product_id,ingredient_id'),
  q(tx,'SELECT name,icon_data,sort_order,builtin,active FROM pos_categories ORDER BY sort_order,name'),
  q(tx,'SELECT category_name,product_id FROM pos_category_products ORDER BY category_name,product_id'),
  q(tx,'SELECT id,name,price,exclude_from_costing,active FROM add_ons ORDER BY id'),
  q(tx,'SELECT id,name,inclusion_label,promo_price,food_limit,coffee_limit,active FROM promos ORDER BY id'),
  q(tx,'SELECT id,name,price,active FROM packages ORDER BY id'),
  q(tx,'SELECT package_id,product_id,quantity FROM package_items ORDER BY package_id,product_id')
 ]);
 const template={
  version:2,
  products:products.map(x=>({sourceId:id(x.id),sku:cast(x.sku,120),name:cast(x.name,150),
   category:cast(x.category,60),price:x.price,imageData:x.image_data||null,active:asBool(x.active)})),
  ingredients:ingredients.map(x=>({sourceId:id(x.id),code:cast(x.code,160),
   name:cast(x.display_name,150),uom:cast(x.uom,40),threshold:x.low_stock_threshold,
   active:asBool(x.active)})),
  recipes:recipes.map(x=>({sourceProductId:id(x.product_id),sourceIngredientId:id(x.ingredient_id),
   quantityRequired:x.quantity_required,costContribution:x.cost_contribution==null?null:x.cost_contribution})),
  categories:categories.map(x=>({name:cast(x.name,60),iconData:x.icon_data||null,
   sortOrder:Number(x.sort_order||0),builtin:asBool(x.builtin),active:asBool(x.active)})),
  categoryProducts:categoryProducts.map(x=>({categoryName:cast(x.category_name,60),sourceProductId:id(x.product_id)})),
  addOns:addOns.map(x=>({sourceId:id(x.id),name:cast(x.name,150),price:x.price,
   excludeFromCosting:asBool(x.exclude_from_costing),active:asBool(x.active)})),
  promos:promos.map(x=>({sourceId:id(x.id),name:cast(x.name,150),
   inclusionLabel:cast(x.inclusion_label,100),price:x.promo_price,foodLimit:x.food_limit,
   coffeeLimit:x.coffee_limit,active:asBool(x.active)})),
  packages:packages.map(x=>({sourceId:id(x.id),name:cast(x.name,150),price:x.price,active:asBool(x.active)})),
  packageItems:packageItems.map(x=>({sourcePackageId:id(x.package_id),
   sourceProductId:id(x.product_id),quantity:x.quantity}))
 };
 return validate(template);
}
function blueprint(template){
 validate(template);
 // The existing franchise application staging stores coffee/non-coffee,
 // ingredients, add-ons and recipe costs; it never copies live stock.
 const subset=template.products.filter(x=>['Coffee','Non Coffee'].includes(x.category));
 const keys=new Set(subset.map(x=>x.sourceId));
 const recipes=template.recipes.filter(x=>keys.has(x.sourceProductId));
 const ingredientIds=new Set(recipes.map(x=>x.sourceIngredientId));
 return{templateVersion:TEMPLATE_VERSION,source:'verified-marlou-starter-template',
  categories:['Coffee','Non Coffee'],
  products:subset.map(x=>({...x,price:Number(x.price)})),
  ingredients:template.ingredients.filter(x=>ingredientIds.has(x.sourceId)).map(x=>({
   sourceId:x.sourceId,code:x.code,name:x.name,uom:x.uom,threshold:Number(x.threshold),
   openingStock:0})),
  recipes:recipes.map(x=>({...x,quantityRequired:Number(x.quantityRequired),
   costContribution:x.costContribution==null?null:Number(x.costContribution)})),
  addOns:template.addOns.map(x=>({...x,price:Number(x.price)})),
  food:[],promos:[],packages:[],
  copySales:false,copyUsers:false,copyInventoryStock:false,copyReports:false,copyPayments:false};
}
async function readTemplate(tx){
 const rows=await q(tx,
  'SELECT id,source_workspace_id,source_branch_id,template_json,checksum_sha256 '+
  'FROM starter_catalog_templates WHERE template_key=$1 AND version=$2 AND active=$3 ORDER BY id',
  [TEMPLATE_KEY,TEMPLATE_VERSION,true]);
 if(rows.length!==1)throw fail(rows.length?'Multiple active master starter templates.':'Master starter catalog not yet prepared.');
 const item=rows[0],data=String(item.template_json);
 if(item.checksum_sha256&&crypto.createHash('sha256').update(data).digest('hex')!==item.checksum_sha256)
  throw fail('Starter catalog checksum mismatch.');
 return{id:id(item.id),sourceWorkspaceId:id(item.source_workspace_id),
  template:validate(JSON.parse(data))};
}
async function ensureTemplate(tx,owner){
 const found=await q(tx,'SELECT id FROM starter_catalog_templates WHERE source_workspace_id=$1 AND template_key=$2 AND version=$3',
  [owner.workspaceId,TEMPLATE_KEY,TEMPLATE_VERSION]);
 if(found.length)return readTemplate(tx);
 // The shared legacy tables have no tenant key. Don't attribute another
 // franchise's sales or unowned transactions to Marlou.
 const outside=await q(tx,'SELECT COUNT(*) AS n FROM sales s WHERE NOT EXISTS ('+
  'SELECT 1 FROM chat_workspace_branches wb WHERE wb.branch_id=s.branch_id AND wb.workspace_id=$1)',[owner.workspaceId]);
 if(Number(outside[0]?.n||0)>0)
  throw fail('Legacy sales exist outside Marlou workspace; global catalog ownership must be reviewed before copying.');
 const template=await legacySnapshot(tx);
 if(!template.products.length||!template.ingredients.length)
  throw fail('Cannot create Marlou starter template from an empty catalog.');
 const data=JSON.stringify(template),sha=crypto.createHash('sha256').update(data).digest('hex');
 const result=await q(tx,'INSERT INTO starter_catalog_templates('+
  'source_workspace_id,source_branch_id,template_key,version,title,template_json,checksum_sha256,active,created_by) '+
  'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
  [owner.workspaceId,null,TEMPLATE_KEY,TEMPLATE_VERSION,
   'Don Mac original catalog — editable branch template',data,sha,true,owner.ownerId]);
 if(result.length!==1)throw fail('Starter catalog was not saved.');
 return{id:id(result[0].id),sourceWorkspaceId:owner.workspaceId,template};
}
const expected=['branch_categories','branch_products','branch_ingredients','branch_recipes',
 'branch_category_products','branch_addons','branch_promos','branch_packages',
 'branch_package_items','branch_inventory_movements'];
async function seedBranch(tx,workspaceId,branchId,master,openingStock,createdBy=null){
 if(!id(workspaceId)||!id(branchId))throw fail('Invalid branch ownership for catalog initialization.');
 if(![0,5].includes(Number(openingStock)))throw fail('Unsupported initial stock quantity.');
 const owned=await q(tx,'SELECT 1 FROM chat_workspace_branches WHERE workspace_id=$1 AND branch_id=$2',
  [workspaceId,branchId]);
 if(owned.length!==1)throw fail('Branch is not owned by this franchise.');
 const prepared=await q(tx,'SELECT opening_stock FROM branch_catalog_provisioning WHERE workspace_id=$1 AND branch_id=$2',
  [workspaceId,branchId]);
 if(prepared.length)return{branchId,status:'already_prepared',openingStock:Number(prepared[0].opening_stock)};
 for(const table of expected){
  const rows=await q(tx,'SELECT 1 FROM '+table+' WHERE workspace_id=$1 AND branch_id=$2 LIMIT 1',[workspaceId,branchId]);
  if(rows.length)throw fail('Branch '+branchId+' has partial or unmanaged isolated catalog data. Manual reconciliation required.');
 }
 const template=master.template,productIds=new Map(),ingredientIds=new Map(),categoryIds=new Map(),packageIds=new Map();
 for(const x of template.categories){
  const rows=await q(tx,'INSERT INTO branch_categories('+
   'workspace_id,branch_id,name,icon_data,sort_order,builtin,active) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
   [workspaceId,branchId,x.name,x.iconData,x.sortOrder,x.builtin,x.active]);
  categoryIds.set(x.name.toUpperCase(),id(rows[0].id));
 }
 for(const x of template.products){
  const rows=await q(tx,'INSERT INTO branch_products('+
   'workspace_id,branch_id,sku,name,category,price,image_data,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
   [workspaceId,branchId,x.sku,x.name,x.category,x.price,x.imageData,x.active]);
  productIds.set(x.sourceId,id(rows[0].id));
 }
 for(const x of template.ingredients){
  const rows=await q(tx,'INSERT INTO branch_ingredients('+
   'workspace_id,branch_id,code,display_name,uom,stock_qty,low_stock_threshold,unit_cost,active) '+
   'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
   [workspaceId,branchId,x.code,x.name,x.uom,openingStock,x.threshold,0,x.active]);
  const newId=id(rows[0].id);ingredientIds.set(x.sourceId,newId);
  if(openingStock>0)await tx.query('INSERT INTO branch_inventory_movements('+
   'workspace_id,branch_id,ingredient_id,movement_type,quantity_change,balance_after,reference,created_by) '+
   'VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
   [workspaceId,branchId,newId,'INITIAL_OPENING_STOCK',openingStock,openingStock,
    'STARTER-'+master.id+'-'+branchId,createdBy]);
 }
 for(const x of template.recipes)await tx.query('INSERT INTO branch_recipes('+
  'workspace_id,branch_id,product_id,ingredient_id,quantity_required,cost_contribution) '+
  'VALUES($1,$2,$3,$4,$5,$6)',
  [workspaceId,branchId,productIds.get(x.sourceProductId),
   ingredientIds.get(x.sourceIngredientId),x.quantityRequired,x.costContribution]);
 for(const x of template.categoryProducts)await tx.query('INSERT INTO branch_category_products('+
  'workspace_id,branch_id,category_id,product_id) VALUES($1,$2,$3,$4)',
  [workspaceId,branchId,categoryIds.get(x.categoryName.toUpperCase()),productIds.get(x.sourceProductId)]);
 for(const x of template.addOns)await tx.query('INSERT INTO branch_addons('+
  'workspace_id,branch_id,name,price,exclude_from_costing,active) VALUES($1,$2,$3,$4,$5,$6)',
  [workspaceId,branchId,x.name,x.price,x.excludeFromCosting,x.active]);
 for(const x of template.promos)await tx.query('INSERT INTO branch_promos('+
  'workspace_id,branch_id,name,inclusion_label,promo_price,food_limit,coffee_limit,active) '+
  'VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
  [workspaceId,branchId,x.name,x.inclusionLabel,x.price,x.foodLimit,x.coffeeLimit,x.active]);
 for(const x of template.packages){
  const rows=await q(tx,'INSERT INTO branch_packages('+
   'workspace_id,branch_id,name,price,active) VALUES($1,$2,$3,$4,$5) RETURNING id',
   [workspaceId,branchId,x.name,x.price,x.active]);
  packageIds.set(x.sourceId,id(rows[0].id));
 }
 for(const x of template.packageItems)await tx.query('INSERT INTO branch_package_items('+
  'workspace_id,branch_id,package_id,product_id,quantity) VALUES($1,$2,$3,$4,$5)',
  [workspaceId,branchId,packageIds.get(x.sourcePackageId),
   productIds.get(x.sourceProductId),x.quantity]);
 await tx.query('INSERT INTO branch_catalog_provisioning('+
  'workspace_id,branch_id,template_id,opening_stock,created_by) VALUES($1,$2,$3,$4,$5)',
  [workspaceId,branchId,master.id,openingStock,createdBy]);
 return{branchId,status:'prepared',openingStock,products:template.products.length,
  ingredients:template.ingredients.length,recipes:template.recipes.length};
}
async function migrate(db){
 const pk=db.engine==='postgres'?'BIGINT':'INTEGER';
 const ts=db.engine==='postgres'?'TIMESTAMPTZ':'TEXT';
 await db.exec('CREATE TABLE IF NOT EXISTS branch_catalog_provisioning('+
  'workspace_id '+pk+' NOT NULL,branch_id '+pk+' NOT NULL,'+
  'template_id '+pk+' NOT NULL REFERENCES starter_catalog_templates(id) ON DELETE RESTRICT,'+
  'opening_stock NUMERIC(18,6) NOT NULL CHECK(opening_stock>=0),'+
  'created_by '+pk+' REFERENCES users(id) ON DELETE SET NULL,'+
  'prepared_at '+ts+' NOT NULL DEFAULT CURRENT_TIMESTAMP,'+
  'PRIMARY KEY(workspace_id,branch_id),'+
  'FOREIGN KEY(branch_id,workspace_id) REFERENCES chat_workspace_branches(branch_id,workspace_id) ON DELETE RESTRICT)');
}
async function prepareMarlou(db){
 return db.transaction(async tx=>{
  if(tx.engine==='postgres'){
   await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
   await tx.query('SELECT pg_advisory_xact_lock(2026111101::bigint)');
  }
  const owner=await originalOwner(tx);
  if(!owner)return{status:'source_owner_not_found',stockRule:5,branchCopies:0};
  const branches=await q(tx,
   'SELECT b.id,b.name FROM chat_workspace_branches wb JOIN branches b ON b.id=wb.branch_id '+
   'WHERE wb.workspace_id=$1 ORDER BY b.id',[owner.workspaceId]);
  if(!branches.length)return{status:'no_owned_branches',stockRule:5,branchCopies:0};
  const master=await ensureTemplate(tx,owner);
  const results=[];
  for(const b of branches)
   results.push(await seedBranch(tx,owner.workspaceId,id(b.id),master,5,owner.ownerId));
  return{status:'prepared',source:OWNER,workspaceId:owner.workspaceId,
   templateId:master.id,stockRule:5,branchCopies:results.filter(x=>x.status==='prepared').length,
   existingCopies:results.filter(x=>x.status==='already_prepared').length,
   branches:results,livePosCutover:false,legacyDataPreserved:true};
 });
}
async function prepareFutureWorkspace(db,workspaceId){
 if(!id(workspaceId))throw fail('Invalid destination workspace.');
 return db.transaction(async tx=>{
  if(tx.engine==='postgres'){
   await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
   await tx.query('SELECT pg_advisory_xact_lock(2026111101::bigint)');
  }
  const master=await readTemplate(tx);
  if(master.sourceWorkspaceId===workspaceId)
   throw fail('Marlou workspace must be prepared using its five-unit opening rule.');
  const branches=await q(tx,'SELECT branch_id FROM chat_workspace_branches WHERE workspace_id=$1 ORDER BY branch_id',
   [workspaceId]);
  if(!branches.length)throw fail('New workspace has no registered branches.');
  const result=[];
  for(const x of branches)result.push(await seedBranch(tx,workspaceId,id(x.branch_id),master,0,null));
  return{status:'prepared',workspaceId,openingStock:0,branches:result,livePosCutover:false};
 });
}
async function approvedBlueprint(db){
 const master=await readTemplate(db);
 return blueprint(master.template);
}
module.exports={OWNER,TEMPLATE_KEY,TEMPLATE_VERSION,validate,blueprint,legacySnapshot,
 originalOwner,readTemplate,ensureTemplate,seedBranch,migrate,prepareMarlou,
 prepareFutureWorkspace,approvedBlueprint};
