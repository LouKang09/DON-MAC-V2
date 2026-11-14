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
 const [pr,ing,cat,add,pro,pk]=await Promise.all([
  db.query('SELECT id,sku,name,category,price,image_data,active FROM branch_products WHERE workspace_id=$1 AND branch_id=$2 ORDER BY category,name',[ws,b.id]),
  db.query('SELECT id,code,display_name,uom,stock_qty,low_stock_threshold,unit_cost,active '+
   'FROM branch_ingredients WHERE workspace_id=$1 AND branch_id=$2 ORDER BY display_name',[ws,b.id]),
  db.query('SELECT id,name,active FROM branch_categories WHERE workspace_id=$1 AND branch_id=$2 ORDER BY sort_order,name',[ws,b.id]),
  db.query('SELECT id,name,price,active FROM branch_addons WHERE workspace_id=$1 AND branch_id=$2 ORDER BY name',[ws,b.id]),
  db.query('SELECT id,name,promo_price,food_limit,coffee_limit,active FROM branch_promos WHERE workspace_id=$1 AND branch_id=$2 ORDER BY name',[ws,b.id]),
  db.query('SELECT id,name,price,active FROM branch_packages WHERE workspace_id=$1 AND branch_id=$2 ORDER BY name',[ws,b.id])
 ]);
 return{branchId:b.id,
  products:pr.rows.map(x=>({id:id(x.id),sku:x.sku,name:x.name,category:x.category,
   price:n(x.price),active:on(x.active),imageData:x.image_data||null})),
  ingredients:ing.rows.map(x=>({id:id(x.id),code:x.code,name:x.display_name,uom:x.uom,
   stock:n(x.stock_qty),lowStockThreshold:n(x.low_stock_threshold),unitCost:n(x.unit_cost),active:on(x.active)})),
  categories:cat.rows.map(x=>({id:id(x.id),name:x.name,active:on(x.active)})),
  addons:add.rows.map(x=>({id:id(x.id),name:x.name,price:n(x.price),active:on(x.active)})),
  promos:pro.rows.map(x=>({id:id(x.id),name:x.name,price:n(x.promo_price),foodLimit:n(x.food_limit),
   coffeeLimit:n(x.coffee_limit),active:on(x.active)})),
  packages:pk.rows.map(x=>({id:id(x.id),name:x.name,price:n(x.price),active:on(x.active)}))};
}
async function saveProduct(db,ctx,branchId,productId,data){
 scope.requireAdmin(ctx);const b=await scope.branch(db,ctx,branchId);
 const productName=name(data.name),category=name(data.category,60),
  price=validMoney(data.price);
 if(!productName||productName.length>150||!category||category.length>60)
  throw fail('Product name and category are required.',400);
 const ws=ctx.workspaceId,pid=id(productId);
 return db.transaction(async tx=>{
  const current=pid?(await tx.query('SELECT id FROM branch_products WHERE id=$1 AND workspace_id=$2 AND branch_id=$3',
   [pid,ws,b.id])).rows[0]:null;
  if(pid&&!current)throw fail('Product not found in this franchise branch.',404);
  const active=data.active!==false;
  let output;
  if(current){
   const r=await tx.query('UPDATE branch_products SET name=$1,category=$2,price=$3,active=$4,'+
    'updated_at=CURRENT_TIMESTAMP WHERE id=$5 AND workspace_id=$6 AND branch_id=$7 RETURNING id',
    [productName,category,price,active,pid,ws,b.id]);
   output={id:id(r.rows[0].id)};
  }else{
   const sku='BR-'+crypto.randomBytes(7).toString('hex').toUpperCase();
   const r=await tx.query('INSERT INTO branch_products('+
    'workspace_id,branch_id,sku,name,category,price,active) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
    [ws,b.id,sku,productName,category,price,active]);
   output={id:id(r.rows[0].id)};
  }
  return{ok:true,branchId:b.id,...output};
 });
}
async function saveIngredient(db,ctx,branchId,ingredientId,data){
 scope.requireAdmin(ctx);const b=await scope.branch(db,ctx,branchId),iid=id(ingredientId);
 const title=name(data.name),uom=name(data.uom,40),threshold=validQty(data.lowStockThreshold||0),
  unitCost=Number(data.unitCost||0);
 if(!title||title.length>150||!uom||uom.length>40||!Number.isFinite(unitCost)||unitCost<0||unitCost>1e8)
  throw fail('Enter an ingredient name, unit and non-negative cost.',400);
 const ws=ctx.workspaceId;
 return db.transaction(async tx=>{
  const found=iid?(await tx.query('SELECT id FROM branch_ingredients WHERE id=$1 AND workspace_id=$2 AND branch_id=$3',
    [iid,ws,b.id])).rows[0]:null;
  if(iid&&!found)throw fail('Ingredient not found in this franchise branch.',404);
  const active=data.active!==false;
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
module.exports={catalog,manage,saveProduct,saveIngredient,recipe,saveRecipe};
