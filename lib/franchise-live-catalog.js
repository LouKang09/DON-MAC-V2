'use strict';
const crypto=require('node:crypto');
const scope=require('./franchise-live-scope');
const read=require('./branch-catalog-read');
const fail=scope.fail,id=scope.goodId;
const n=x=>Number(x||0),on=scope.on;
const name=(x,max=150)=>String(x||'').trim().slice(0,max+1);
const money=x=>Math.round(Number(x)*100)/100;
function validMoney(x){
 const val=Number(x);
 if(!Number.isFinite(val)||val<0||val>9999999.99||money(val)!==val)
  throw fail('Enter a non-negative price with up to two decimal places.',400);
 return val;
}
function validQty(x,max=999999){
 const val=Number(x);
 if(!Number.isFinite(val)||val<0||val>max||Math.round(val*1e6)/1e6!==val)
  throw fail('Enter a valid quantity with up to six decimal places.',400);
 return val;
}
async function catalog(db,ctx,requestedBranchId){
 const b=await scope.branch(db,ctx,requestedBranchId);
 const c=await read.catalog(db,ctx.workspaceId,b.id);
 // Package ingredient requirements use only this branch's recipe snapshots.
 const map=new Map(c.products.map(p=>[p.id,p]));
 c.packages=c.packages.map(pack=>{
  const requirements=new Map();
  for(const comp of pack.contents||[]){
   const product=map.get(comp.productId);
   if(!product){continue;}
   for(const r of product.recipeStock||[]){
    const key=r.ingredientId;
    if(!requirements.has(key))requirements.set(key,{...r,required:0});
    requirements.get(key).required+=Number(r.required)*Number(comp.qty);
   }
  }
  return{...pack,recipeStock:[...requirements.values()]};
 });
 return{...c,branchId:b.id,branchName:b.name,readOnly:!ctx.admin,
  liveCheckoutUsesLegacyTables:false,productionIsolated:true};
}
async function manage(db,ctx,request){
 scope.requireAdmin(ctx);
 const b=await scope.branch(db,ctx,request.branchId);
 const ws=ctx.workspaceId;
 const [pr,ing,cat,add,pro,pk,recipeStats,parts]=await Promise.all([
  db.query('SELECT id,sku,name,category,price,image_data,active FROM branch_products WHERE workspace_id=$1 AND branch_id=$2 ORDER BY category,name',[ws,b.id]),
  db.query('SELECT id,code,display_name,uom,stock_qty,low_stock_threshold,unit_cost,active '+
   'FROM branch_ingredients WHERE workspace_id=$1 AND branch_id=$2 ORDER BY display_name',[ws,b.id]),
  db.query('SELECT id,name,active FROM branch_categories WHERE workspace_id=$1 AND branch_id=$2 ORDER BY sort_order,name',[ws,b.id]),
  db.query('SELECT id,name,price,active FROM branch_addons WHERE workspace_id=$1 AND branch_id=$2 ORDER BY name',[ws,b.id]),
  db.query('SELECT id,name,inclusion_label,promo_price,food_limit,coffee_limit,active FROM branch_promos WHERE workspace_id=$1 AND branch_id=$2 ORDER BY name',[ws,b.id]),
  db.query('SELECT id,name,price,active FROM branch_packages WHERE workspace_id=$1 AND branch_id=$2 ORDER BY name',[ws,b.id]),
  db.query('SELECT r.product_id,COUNT(*) AS recipe_count,'+
   'COALESCE(SUM(COALESCE(r.cost_contribution,r.quantity_required*i.unit_cost)),0) AS unit_cost '+
   'FROM branch_recipes r JOIN branch_ingredients i ON i.id=r.ingredient_id '+
   'AND i.workspace_id=r.workspace_id AND i.branch_id=r.branch_id '+
   'WHERE r.workspace_id=$1 AND r.branch_id=$2 GROUP BY r.product_id',[ws,b.id]),
  db.query('SELECT pi.package_id,pi.product_id,pi.quantity,p.name '+
   'FROM branch_package_items pi JOIN branch_products p ON p.id=pi.product_id '+
   'AND p.workspace_id=pi.workspace_id AND p.branch_id=pi.branch_id '+
   'WHERE pi.workspace_id=$1 AND pi.branch_id=$2 ORDER BY p.name',[ws,b.id])
 ]);
 const recipeMap=new Map(recipeStats.rows.map(x=>[id(x.product_id),{
  recipeCount:n(x.recipe_count),unitCost:n(x.unit_cost)}]));
 const packagesMap=new Map();
 for(const item of parts.rows){
  const pack=id(item.package_id);if(!packagesMap.has(pack))packagesMap.set(pack,[]);
  packagesMap.get(pack).push({productId:id(item.product_id),name:item.name,qty:n(item.quantity)});
 }
 return{branchId:b.id,
  products:pr.rows.map(x=>({id:id(x.id),sku:x.sku,name:x.name,category:x.category,
   price:n(x.price),active:on(x.active),imageData:x.image_data||null,
   recipeCount:recipeMap.get(id(x.id))?.recipeCount||0,
   unitCost:recipeMap.get(id(x.id))?.unitCost||0})),
  ingredients:ing.rows.map(x=>({id:id(x.id),code:x.code,name:x.display_name,uom:x.uom,
   stock:n(x.stock_qty),lowStockThreshold:n(x.low_stock_threshold),unitCost:n(x.unit_cost),active:on(x.active)})),
  categories:cat.rows.map(x=>({id:id(x.id),name:x.name,active:on(x.active)})),
  addons:add.rows.map(x=>({id:id(x.id),name:x.name,price:n(x.price),active:on(x.active)})),
  promos:pro.rows.map(x=>({id:id(x.id),name:x.name,inclusion:x.inclusion_label||'',price:n(x.promo_price),foodLimit:n(x.food_limit),
   coffeeLimit:n(x.coffee_limit),active:on(x.active)})),
  packages:pk.rows.map(x=>({id:id(x.id),name:x.name,price:n(x.price),active:on(x.active),
   items:packagesMap.get(id(x.id))||[]}))};
}
async function saveProduct(db,ctx,branchId,productId,data){
 scope.requireAdmin(ctx);const b=await scope.branch(db,ctx,branchId);
 const productName=name(data.name),category=name(data.category,60),
  price=validMoney(data.price);
 if(!productName||productName.length>150||!category||category.length>60)
  throw fail('Product name and category are required.',400);
 const image=data.imageData;
 if(image!==undefined&&image!==null&&(typeof image!=='string'||
   !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image)||image.length>1500000))
  throw fail('Product image must be a valid compressed photo under 1 MB.',400);
 const ws=ctx.workspaceId,pid=id(productId);
 return db.transaction(async tx=>{
  const current=pid?(await tx.query('SELECT id FROM branch_products WHERE id=$1 AND workspace_id=$2 AND branch_id=$3',
   [pid,ws,b.id])).rows[0]:null;
  if(pid&&!current)throw fail('Product not found in this franchise branch.',404);
  const active=data.active!==false;
  let output;
  if(current){
   const r=await tx.query('UPDATE branch_products SET name=$1,category=$2,price=$3,active=$4,'+
    'image_data=CASE WHEN $5 THEN $6 ELSE image_data END,updated_at=CURRENT_TIMESTAMP '+
    'WHERE id=$7 AND workspace_id=$8 AND branch_id=$9 RETURNING id',
    [productName,category,price,active,image!==undefined,image??null,pid,ws,b.id]);
   output={id:id(r.rows[0].id)};
  }else{
   const sku='BR-'+crypto.randomBytes(7).toString('hex').toUpperCase();
   const r=await tx.query('INSERT INTO branch_products('+
    'workspace_id,branch_id,sku,name,category,price,active,image_data) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
    [ws,b.id,sku,productName,category,price,active,image??null]);
   output={id:id(r.rows[0].id)};
  }
  return{ok:true,branchId:b.id,...output};
 });
}
async function saveIngredient(db,ctx,branchId,ingredientId,data){
 scope.requireAdmin(ctx);const b=await scope.branch(db,ctx,branchId),iid=id(ingredientId);
 const title=name(data.name),uom=name(data.uom,40),threshold=validQty(data.lowStockThreshold||0),
  suppliedCost=data.unitCost===undefined?null:Number(data.unitCost);
 if(!title||title.length>150||!uom||uom.length>40||
   suppliedCost!==null&&(!Number.isFinite(suppliedCost)||suppliedCost<0||suppliedCost>1e8))
  throw fail('Enter an ingredient name, unit and non-negative cost.',400);
 const ws=ctx.workspaceId;
 return db.transaction(async tx=>{
  const found=iid?(await tx.query('SELECT id,unit_cost FROM branch_ingredients WHERE id=$1 AND workspace_id=$2 AND branch_id=$3',
    [iid,ws,b.id])).rows[0]:null;
  if(iid&&!found)throw fail('Ingredient not found in this franchise branch.',404);
  const active=data.active!==false,unitCost=suppliedCost===null?n(found?.unit_cost):suppliedCost;
  if(found){
   if(!active){
    const used=await tx.query('SELECT 1 FROM branch_recipes WHERE workspace_id=$1 AND branch_id=$2 AND ingredient_id=$3 LIMIT 1',
     [ws,b.id,iid]);
    if(used.rows.length)throw fail('Remove this ingredient from the branch recipes before archiving it.',409);
   }
   await tx.query('UPDATE branch_ingredients SET display_name=$1,uom=$2,low_stock_threshold=$3,'+
    'unit_cost=$4,active=$5,updated_at=CURRENT_TIMESTAMP WHERE id=$6 AND workspace_id=$7 AND branch_id=$8',
    [title,uom,threshold,unitCost,active,iid,ws,b.id]);
   return{ok:true,id:iid,branchId:b.id};
  }
  const code='B-'+crypto.randomBytes(8).toString('hex').toUpperCase();
  const r=await tx.query('INSERT INTO branch_ingredients('+
    'workspace_id,branch_id,code,display_name,uom,stock_qty,low_stock_threshold,unit_cost,active) '+
    'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
    [ws,b.id,code,title,uom,0,threshold,unitCost,active]);
  return{ok:true,id:id(r.rows[0].id),branchId:b.id};
 });
}
async function recipe(db,ctx,branchId,productId){
 scope.requireAdmin(ctx);const b=await scope.branch(db,ctx,branchId),pid=id(productId);
 if(!pid)throw fail('Select a product.',400);
 const product=(await db.query('SELECT id,name FROM branch_products WHERE id=$1 AND workspace_id=$2 AND branch_id=$3',
  [pid,ctx.workspaceId,b.id])).rows[0];
 if(!product)throw fail('Product not found in this franchise.',404);
 const items=(await db.query('SELECT r.ingredient_id,r.quantity_required,r.cost_contribution,'+
  'i.code,i.display_name,i.uom FROM branch_recipes r '+
  'JOIN branch_ingredients i ON i.id=r.ingredient_id AND i.workspace_id=r.workspace_id AND i.branch_id=r.branch_id '+
  'WHERE r.workspace_id=$1 AND r.branch_id=$2 AND r.product_id=$3 ORDER BY i.display_name',
  [ctx.workspaceId,b.id,pid])).rows;
 return{product:{id:pid,name:product.name},items:items.map(x=>({
   ingredientId:id(x.ingredient_id),code:x.code,name:x.display_name,uom:x.uom,
   quantity:n(x.quantity_required),cost:x.cost_contribution==null?null:n(x.cost_contribution)}))};
}
async function saveRecipe(db,ctx,branchId,productId,data){
 scope.requireAdmin(ctx);const b=await scope.branch(db,ctx,branchId),pid=id(productId);
 const items=Array.isArray(data.items)?data.items:[];
 if(!pid||items.length>100)throw fail('Choose a product and up to 100 recipe ingredients.',400);
 const lines=[],seen=new Set();
 for(const it of items){
  const ingredientId=id(it.ingredientId),quantity=validQty(it.quantity);
  if(!ingredientId||quantity<=0||seen.has(ingredientId))throw fail('Each recipe ingredient must be unique and require a positive quantity.',400);
  seen.add(ingredientId);
  const cost=it.cost===''||it.cost==null?null:Number(it.cost);
  if(cost!=null&&(!Number.isFinite(cost)||cost<0||cost>1e8))
   throw fail('Recipe cost must be non-negative.',400);
  lines.push({ingredientId,quantity,cost});
 }
 return db.transaction(async tx=>{
  const found=(await tx.query('SELECT id FROM branch_products WHERE id=$1 AND workspace_id=$2 AND branch_id=$3',
   [pid,ctx.workspaceId,b.id])).rows;
  if(found.length!==1)throw fail('Recipe product not found in your branch.',404);
  if(lines.length){
   const check=(await tx.query('SELECT id,active FROM branch_ingredients '+
    'WHERE workspace_id=$1 AND branch_id=$2 AND id IN ('+
    lines.map((_,i)=>'$'+(i+3)).join(',')+')',
    [ctx.workspaceId,b.id,...lines.map(x=>x.ingredientId)])).rows;
   if(check.length!==lines.length||check.some(x=>!on(x.active)))throw fail('Recipe contains an invalid or archived ingredient.',403);
  }
  await tx.query('DELETE FROM branch_recipes WHERE workspace_id=$1 AND branch_id=$2 AND product_id=$3',
   [ctx.workspaceId,b.id,pid]);
  for(const line of lines){
   await tx.query('INSERT INTO branch_recipes('+
    'workspace_id,branch_id,product_id,ingredient_id,quantity_required,cost_contribution) '+
    'VALUES($1,$2,$3,$4,$5,$6)',
    [ctx.workspaceId,b.id,pid,line.ingredientId,line.quantity,line.cost]);
  }
  return{ok:true,productId:pid,ingredientCount:lines.length};
 });
}

// Admin Catalog uses the same source UI for established and newly created owners.
function optionalLabel(value,max){const str=String(value??'').trim();if(str.length>max)throw fail('Text exceeds '+max+' characters.',400);return str;}
function positiveCount(value,max=1000){const n=Number(value);if(!Number.isSafeInteger(n)||n<1||n>max)throw fail('Package quantity must be a positive whole number.',400);return n;}
async function archiveProduct(db,ctx,requestedBranchId,productId){
 scope.requireAdmin(ctx);
 const b=await scope.branch(db,ctx,requestedBranchId),pid=id(productId);
 if(!pid)throw fail('Select a valid product.',400);
 const r=await db.query('UPDATE branch_products SET active=$1,updated_at=CURRENT_TIMESTAMP '+
  'WHERE workspace_id=$2 AND branch_id=$3 AND id=$4 RETURNING id',
  [false,ctx.workspaceId,b.id,pid]);
 if(r.rows.length!==1)throw fail('Product not found in this franchise.',404);
 return{ok:true,id:pid,branchId:b.id};
}
async function archiveIngredient(db,ctx,requestedBranchId,ingredientId){
 scope.requireAdmin(ctx);
 const b=await scope.branch(db,ctx,requestedBranchId),iid=id(ingredientId);
 if(!iid)throw fail('Select a valid ingredient.',400);
 return db.transaction(async tx=>{
  const current=(await tx.query('SELECT id FROM branch_ingredients WHERE id=$1 AND workspace_id=$2 AND branch_id=$3'+
   (tx.engine==='postgres'?' FOR UPDATE':''),
   [iid,ctx.workspaceId,b.id])).rows;
  if(current.length!==1)throw fail('Ingredient not found in this franchise.',404);
  const used=(await tx.query('SELECT 1 FROM branch_recipes WHERE workspace_id=$1 AND branch_id=$2 AND ingredient_id=$3 LIMIT 1',
   [ctx.workspaceId,b.id,iid])).rows;
  if(used.length)throw fail('Remove the ingredient from its recipes before archiving it.',409);
  await tx.query('UPDATE branch_ingredients SET active=$1,updated_at=CURRENT_TIMESTAMP '+
   'WHERE workspace_id=$2 AND branch_id=$3 AND id=$4',[false,ctx.workspaceId,b.id,iid]);
  return{ok:true,id:iid,branchId:b.id};
 });
}
async function savePromo(db,ctx,requestedBranchId,promoId,data){
 scope.requireAdmin(ctx);
 const b=await scope.branch(db,ctx,requestedBranchId),pid=id(promoId);
 const title=optionalLabel(data?.name,150),inclusion=optionalLabel(data?.inclusion,100),
  price=validMoney(data?.price),food=Number(data?.foodLimit),coffee=Number(data?.coffeeLimit);
 if(!title||![food,coffee].every(x=>Number.isSafeInteger(x)&&x>=0&&x<=100))
  throw fail('Enter a promotion name and valid Food/Coffee limits.',400);
 const active=data.active!==false,ws=ctx.workspaceId;
 if(pid){
  const result=await db.query('UPDATE branch_promos SET name=$1,inclusion_label=$2,promo_price=$3,'+
   'food_limit=$4,coffee_limit=$5,active=$6,updated_at=CURRENT_TIMESTAMP '+
   'WHERE id=$7 AND workspace_id=$8 AND branch_id=$9 RETURNING id',
   [title,inclusion,price,food,coffee,active,pid,ws,b.id]);
  if(result.rows.length!==1)throw fail('Promotion not found in this franchise branch.',404);
  return{ok:true,id:pid,branchId:b.id};
 }
 const result=await db.query('INSERT INTO branch_promos '+
  '(workspace_id,branch_id,name,inclusion_label,promo_price,food_limit,coffee_limit,active) '+
  'VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
  [ws,b.id,title,inclusion,price,food,coffee,active]);
 return{ok:true,id:id(result.rows[0].id),branchId:b.id};
}
async function archivePromo(db,ctx,requestedBranchId,promoId){
 scope.requireAdmin(ctx);
 const b=await scope.branch(db,ctx,requestedBranchId),pid=id(promoId);
 if(!pid)throw fail('Select a promotion.',400);
 const r=await db.query('UPDATE branch_promos SET active=$1,updated_at=CURRENT_TIMESTAMP '+
  'WHERE id=$2 AND workspace_id=$3 AND branch_id=$4 RETURNING id',
  [false,pid,ctx.workspaceId,b.id]);
 if(r.rows.length!==1)throw fail('Promotion not found in this franchise.',404);
 return{ok:true,id:pid,branchId:b.id};
}
async function savePackage(db,ctx,requestedBranchId,packageId,data){
 scope.requireAdmin(ctx);
 const b=await scope.branch(db,ctx,requestedBranchId),pid=id(packageId);
 const title=optionalLabel(data?.name,150),price=validMoney(data?.price),active=data.active!==false;
 if(!title)throw fail('Enter the package name.',400);
 if(pid){
  const r=await db.query('UPDATE branch_packages SET name=$1,price=$2,active=$3,'+
   'updated_at=CURRENT_TIMESTAMP WHERE id=$4 AND workspace_id=$5 AND branch_id=$6 RETURNING id',
   [title,price,active,pid,ctx.workspaceId,b.id]);
  if(r.rows.length!==1)throw fail('Package not found in this franchise branch.',404);
  return{ok:true,id:pid,branchId:b.id};
 }
 const r=await db.query('INSERT INTO branch_packages '+
  '(workspace_id,branch_id,name,price,active) VALUES($1,$2,$3,$4,$5) RETURNING id',
  [ctx.workspaceId,b.id,title,price,active]);
 return{ok:true,id:id(r.rows[0].id),branchId:b.id};
}
async function archivePackage(db,ctx,requestedBranchId,packageId){
 scope.requireAdmin(ctx);
 const b=await scope.branch(db,ctx,requestedBranchId),pid=id(packageId);
 if(!pid)throw fail('Select a package.',400);
 const r=await db.query('UPDATE branch_packages SET active=$1,updated_at=CURRENT_TIMESTAMP '+
  'WHERE id=$2 AND workspace_id=$3 AND branch_id=$4 RETURNING id',
  [false,pid,ctx.workspaceId,b.id]);
 if(r.rows.length!==1)throw fail('Package not found in this franchise.',404);
 return{ok:true,id:pid,branchId:b.id};
}
async function saveComposition(db,ctx,requestedBranchId,packageId,data){
 scope.requireAdmin(ctx);
 const b=await scope.branch(db,ctx,requestedBranchId),pid=id(packageId);
 const items=data?.items;
 if(!pid||!Array.isArray(items)||items.length>100)
  throw fail('Select a package and up to 100 products.',400);
 const seen=new Set(),parts=[];
 for(const item of items){
  const productId=id(item?.productId),qty=positiveCount(item?.qty);
  if(!productId||seen.has(productId))throw fail('Select unique product IDs for the package.',400);
  seen.add(productId);parts.push({productId,qty});
 }
 return db.transaction(async tx=>{
  const target=(await tx.query('SELECT id FROM branch_packages WHERE id=$1 AND workspace_id=$2 AND branch_id=$3'+
   (tx.engine==='postgres'?' FOR UPDATE':''),
   [pid,ctx.workspaceId,b.id])).rows;
  if(target.length!==1)throw fail('Package does not belong to your franchise branch.',404);
  if(parts.length){
   const allowed=(await tx.query('SELECT id FROM branch_products WHERE workspace_id=$1 AND branch_id=$2 '+
    'AND active=$3 AND id IN ('+parts.map((_,i)=>String.fromCharCode(36)+(i+4)).join(',')+')',
    [ctx.workspaceId,b.id,true,...parts.map(x=>x.productId)])).rows;
   if(allowed.length!==parts.length)throw fail('Package contains an unavailable or foreign product.',403);
  }
  await tx.query('DELETE FROM branch_package_items WHERE workspace_id=$1 AND branch_id=$2 AND package_id=$3',
   [ctx.workspaceId,b.id,pid]);
  for(const part of parts)await tx.query('INSERT INTO branch_package_items '+
   '(workspace_id,branch_id,package_id,product_id,quantity) VALUES($1,$2,$3,$4,$5)',
   [ctx.workspaceId,b.id,pid,part.productId,part.qty]);
  return{ok:true,packageId:pid,branchId:b.id,itemCount:parts.length};
 });
}

module.exports={catalog,manage,saveProduct,saveIngredient,recipe,saveRecipe,
 archiveProduct,archiveIngredient,savePromo,archivePromo,savePackage,archivePackage,saveComposition};
