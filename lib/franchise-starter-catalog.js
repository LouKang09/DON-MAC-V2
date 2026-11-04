'use strict';
// Read-only franchise starter-catalog blueprint. No owner credentials,
// historical sales or stock levels are copied into a future franchise.
// Never use this directly as an authorization boundary: new workspaces must
// receive independently scoped catalog/inventory/sales rows before signup.
const ALLOWED_CATEGORIES=Object.freeze(['Coffee','Non Coffee']);
function cleanText(s,max=180){return String(s==null?'':s).trim().slice(0,max);}
function cash(n){const v=Number(n);if(!Number.isFinite(v)||v<0)throw new Error('Invalid existing catalog price.');return Math.round(v*100)/100;}
function positive(n){const v=Number(n);return Number.isFinite(v)&&v>0?v:0;}
async function previewLegacyCatalog(conn){
 // Only the original operator should select the snapshot source. Do not
 // treat a global products table as a multi-tenant catalog.
 const products=(await conn.query(
   'SELECT id,name,category,price,image_data,active FROM products WHERE active=$1 AND category IN ($2,$3) ORDER BY category,name',
   [true,'Coffee','Non Coffee'])).rows;
 const addOns=(await conn.query(
   'SELECT id,name,price,exclude_from_costing,image_data,active FROM add_ons WHERE active=$1 ORDER BY name',
   [true])).rows;
 const approved=new Set(products.map(x=>Number(x.id)));
 const recipeRows=approved.size?(await conn.query(
   'SELECT pi.product_id,i.id AS ingredient_id,i.code,i.display_name,i.uom,i.low_stock_threshold,'+
   'pi.quantity_required,pi.cost_contribution '+
   'FROM product_ingredients pi JOIN ingredients i ON i.id=pi.ingredient_id '+
   'WHERE i.active=$1 ORDER BY pi.product_id,i.display_name',[true])).rows:[];
 const ingredients=new Map(),recipes=[];
 for(const r of recipeRows){
   if(!approved.has(Number(r.product_id)))continue;
   const key=Number(r.ingredient_id);
   if(!ingredients.has(key))ingredients.set(key,{
     sourceId:key,code:cleanText(r.code,160),name:cleanText(r.display_name,150),
     uom:cleanText(r.uom,30),threshold:positive(r.low_stock_threshold),
     openingStock:0
   });
   recipes.push({sourceProductId:Number(r.product_id),sourceIngredientId:key,
     quantityRequired:positive(r.quantity_required),
     costContribution:cash(r.cost_contribution||0)});
 }
 const transform=p=>({sourceId:Number(p.id),name:cleanText(p.name,150),
   category:p.category,price:cash(p.price),imageData:p.image_data||null,
   active:true});
 return{
   templateVersion:1,
   source:'legacy-current-catalog',
   categories:ALLOWED_CATEGORIES,
   products:products.map(transform),
   addOns:addOns.map(a=>({sourceId:Number(a.id),name:cleanText(a.name,150),price:cash(a.price),
     excludeFromCosting:!!a.exclude_from_costing,imageData:a.image_data||null,active:true})),
   ingredients:[...ingredients.values()],
   recipes,
   // Deliberately blank for each new Owner. Categories may exist as tabs.
   food:[],promos:[],packages:[],
   copySales:false,copyUsers:false,copyInventoryStock:false,copyReports:false,copyPayments:false
 };
}
function summarize(c){
 return{coffee:c.products.filter(x=>x.category==='Coffee').length,
   nonCoffee:c.products.filter(x=>x.category==='Non Coffee').length,
   addOns:c.addOns.length,ingredients:c.ingredients.length,recipes:c.recipes.length,
   food:c.food.length,promos:c.promos.length,packages:c.packages.length,
   stockInitialization:'zero',operationalDataCloned:false};
}
module.exports={previewLegacyCatalog,summarize,ALLOWED_CATEGORIES};
