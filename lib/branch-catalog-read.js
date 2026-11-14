'use strict';
// Phase 2: branch-isolated read API. Never queries global products/ingredients.
// Live checkout remains on original tables until the full write/report cutover.
const number=x=>Number(x||0);
const bool=x=>x===true||x===1||x==='1';
const fail=(m,status=403)=>Object.assign(new Error(m),{status});
function ids(workspace,branch){
 const w=number(workspace),b=number(branch);
 if(!Number.isSafeInteger(w)||w<1||!Number.isSafeInteger(b)||b<1)
  throw fail('Choose a valid branch within your franchise.',400);
 return [w,b];
}
async function ownership(db,workspace,branch){
 const args=ids(workspace,branch);
 const row=(await db.query(
  'SELECT 1 FROM chat_workspace_branches WHERE workspace_id=$1 AND branch_id=$2',args)).rows;
 if(row.length!==1)throw fail('This branch does not belong to your franchise.');
 const p=(await db.query('SELECT 1 FROM branch_catalog_provisioning WHERE workspace_id=$1 AND branch_id=$2',args)).rows;
 if(p.length!==1)throw fail('The isolated catalog is not prepared for this branch.',409);
 return args;
}
async function inventory(db,workspace,branch,includeInactive=false){
 const args=await ownership(db,workspace,branch);
 const r=await db.query('SELECT id,code,display_name,uom,stock_qty,low_stock_threshold,active,updated_at '+
  'FROM branch_ingredients WHERE workspace_id=$1 AND branch_id=$2'+
  (includeInactive?'':' AND active=$3')+' ORDER BY display_name',
  includeInactive?args:[...args,true]);
 return r.rows.map(x=>({id:number(x.id),code:x.code,name:x.display_name,
  uom:x.uom,stock:number(x.stock_qty),lowStockThreshold:number(x.low_stock_threshold),
  low:number(x.stock_qty)<=number(x.low_stock_threshold),
  active:bool(x.active),updatedAt:x.updated_at}));
}
async function catalog(db,workspace,branch){
 const args=await ownership(db,workspace,branch);
 const [pr,ar,pm,pa,re,pc,pi,cat]=await Promise.all([
  db.query('SELECT id,sku,name,category,price,image_data,active FROM branch_products '+
    'WHERE workspace_id=$1 AND branch_id=$2 AND active=$3 ORDER BY category,name',[...args,true]),
  db.query('SELECT id,name,price,exclude_from_costing,active FROM branch_addons '+
    'WHERE workspace_id=$1 AND branch_id=$2 AND active=$3 ORDER BY name',[...args,true]),
  db.query('SELECT id,name,inclusion_label,promo_price,food_limit,coffee_limit,active FROM branch_promos '+
    'WHERE workspace_id=$1 AND branch_id=$2 AND active=$3 ORDER BY id',[...args,true]),
  db.query('SELECT id,name,price,active FROM branch_packages '+
    'WHERE workspace_id=$1 AND branch_id=$2 AND active=$3 ORDER BY id',[...args,true]),
  db.query('SELECT r.product_id,r.ingredient_id,r.quantity_required,r.cost_contribution,'+
    'i.code,i.display_name,i.uom,i.stock_qty,i.low_stock_threshold,i.active '+
    'FROM branch_recipes r JOIN branch_ingredients i ON i.id=r.ingredient_id '+
    'AND i.workspace_id=r.workspace_id AND i.branch_id=r.branch_id '+
    'WHERE r.workspace_id=$1 AND r.branch_id=$2',args),
  db.query('SELECT category_id,product_id FROM branch_category_products '+
    'WHERE workspace_id=$1 AND branch_id=$2',args),
  db.query('SELECT pi.package_id,pi.product_id,pi.quantity,p.name AS product_name,p.active AS product_active '+
    'FROM branch_package_items pi JOIN branch_products p ON p.id=pi.product_id '+
    'AND p.workspace_id=pi.workspace_id AND p.branch_id=pi.branch_id '+
    'WHERE pi.workspace_id=$1 AND pi.branch_id=$2 ORDER BY pi.package_id,p.name',args),
  db.query('SELECT id,name,icon_data,sort_order,builtin,active FROM branch_categories '+
    'WHERE workspace_id=$1 AND branch_id=$2 AND active=$3 ORDER BY sort_order,name',[...args,true])
 ]);
 const recByProduct=new Map();
 for(const r of re.rows){
  const pid=number(r.product_id);
  if(!recByProduct.has(pid))recByProduct.set(pid,[]);
  recByProduct.get(pid).push(r);
 }
 const products=pr.rows.map(p=>{
  const recipes=recByProduct.get(number(p.id))||[];
  const issues=[],warnings=[];
  for(const r of recipes){
   const required=number(r.quantity_required),stock=number(r.stock_qty),threshold=number(r.low_stock_threshold);
   const detail={ingredientId:number(r.ingredient_id),code:r.code,name:r.display_name,
    uom:String(r.uom||'').toUpperCase(),required,current:stock};
   if(!bool(r.active)||stock+1e-9<required)
    issues.push({...detail,shortage:Math.max(0,required-stock),
      status:!bool(r.active)?'ingredient_unavailable':stock<=0?'out_of_stock':'low_stock'});
   else if(threshold>0&&stock<=threshold)
    warnings.push({...detail,threshold,status:'low_stock_warning'});
  }
  const recipeConfigured=recipes.length>0;
  return{id:number(p.id),sku:p.sku,name:p.name,category:p.category,
   price:number(p.price),imageData:p.image_data||null,available:recipeConfigured&&!issues.length,
   recipeConfigured,availabilityStatus:!recipeConfigured?'recipe_required':issues.length?'insufficient_stock':'available',
   availabilityMessage:!recipeConfigured?'Recipe required.':issues.length?'Insufficient branch ingredient stock.':
    warnings.length?'Available, but low ingredient stock.':'Available',
   availabilityDetails:issues,stockWarnings:warnings,
   unitCost:recipes.reduce((sum,r)=>sum+number(r.cost_contribution),0)};
 });
 const itemMap=new Map();
 for(const x of pi.rows){
  const key=number(x.package_id);
  if(!itemMap.has(key))itemMap.set(key,[]);
  itemMap.get(key).push({productId:number(x.product_id),name:x.product_name,
    qty:number(x.quantity),active:bool(x.product_active)});
 }
 const packages=pa.rows.map(p=>{
  const contents=itemMap.get(number(p.id))||[];
  const required=new Map(),problems=[];
  for(const c of contents){
   if(!c.active)problems.push({name:c.name,status:'product_unavailable'});
   const recipes=recByProduct.get(c.productId)||[];
   if(!recipes.length)problems.push({name:c.name,status:'recipe_required'});
   for(const r of recipes){
    const key=number(r.ingredient_id);
    if(!required.has(key))required.set(key,{available:number(r.stock_qty),
      active:bool(r.active),needed:0,ingredient:r.display_name});
    required.get(key).needed+=c.qty*number(r.quantity_required);
   }
  }
  for(const r of required.values())
   if(!r.active||r.available+1e-9<r.needed)
    problems.push({name:r.ingredient,status:'insufficient_stock'});
  return{id:number(p.id),name:p.name,price:number(p.price),itemCount:contents.length,
   contents,sellable:contents.length>0&&!problems.some(x=>x.status==='recipe_required'),
   available:contents.length>0&&!problems.length,
   availabilityStatus:!contents.length?'composition_required':problems.length?'insufficient_stock':'available',
   availabilityMessage:!contents.length?'Package composition required.':problems.length?'Unavailable package components.':'Available',
   availabilityDetails:problems,stockWarnings:[]};
 });
 const memberships=new Map();
 for(const x of cat.rows)memberships.set(number(x.id),[]);
 for(const x of pc.rows)if(memberships.has(number(x.category_id)))memberships.get(number(x.category_id)).push(number(x.product_id));
 return{workspaceId:args[0],branchId:args[1],products,
  addOns:ar.rows.map(x=>({id:number(x.id),name:x.name,price:number(x.price),excludeFromCosting:bool(x.exclude_from_costing)})),
  promos:pm.rows.map(x=>({id:number(x.id),name:x.name,inclusion:x.inclusion_label,
    price:number(x.promo_price),foodLimit:number(x.food_limit),coffeeLimit:number(x.coffee_limit)})),
  packages,
  categories:cat.rows.map(x=>({id:number(x.id),name:x.name,iconData:x.icon_data||null,
    sortOrder:number(x.sort_order),builtin:bool(x.builtin),active:bool(x.active),
    productIds:memberships.get(number(x.id))||[]})),
  readOnly:true,liveCheckoutUsesLegacyTables:true};
}
module.exports={ownership,inventory,catalog};
