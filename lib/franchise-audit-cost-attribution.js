'use strict';
// Attach branch-scoped sold quantities and checkout-time ingredient costs to
// existing inventory movement rows. No cross-franchise or legacy global reads.
const validRef=x=>/^BR-[A-F0-9]{18}$/.test(String(x||''));
const num=x=>Number.isFinite(Number(x))?Number(x):0;
const round=x=>Math.round((Number(x)+Number.EPSILON)*100)/100;
async function enrich(db,workspaceId,branchId,movements){
 const rows=movements.map(x=>({...x,quantity:Math.abs(num(x.quantityChange)),
  cost:null,costEstimated:false,quantityEstimated:false}));
 const refs=[...new Set(rows.filter(x=>validRef(x.reference)&&
  ['LIVE_SALE','LIVE_SALE_REVERSAL'].includes(x.type)).map(x=>x.reference))];
 if(!refs.length)return rows;
 const marks=refs.map((_,i)=>'$'+(i+3)).join(',');
 const args=[workspaceId,branchId,...refs];
 const [saleItems,costs]=await Promise.all([
  db.query('SELECT s.reference,i.kind,i.item_id,i.name_snapshot,i.quantity,'+
   'i.unit_cost_snapshot,i.components_json '+
   'FROM branch_live_sales s JOIN branch_live_sale_items i '+
   'ON i.sale_id=s.id AND i.workspace_id=s.workspace_id AND i.branch_id=s.branch_id '+
   'WHERE s.workspace_id=$1 AND s.branch_id=$2 AND s.reference IN ('+marks+')',args),
  db.query('SELECT s.reference,c.ingredient_id,SUM(c.product_qty) AS sold_qty,'+
   'SUM(c.total_cost) AS cost '+
   'FROM branch_sale_cost_components c JOIN branch_live_sales s ON s.id=c.sale_id '+
   'AND s.workspace_id=c.workspace_id AND s.branch_id=c.branch_id '+
   'WHERE s.workspace_id=$1 AND s.branch_id=$2 AND s.reference IN ('+marks+') '+
   'GROUP BY s.reference,c.ingredient_id',args)
 ]);
 const perRef=new Map(refs.map(ref=>[ref,[]]));
 for(const line of saleItems.rows)perRef.get(line.reference)?.push(line);
 const snapshot=new Map(),knownRefs=new Set();
 for(const x of costs.rows){
  knownRefs.add(x.reference);
  snapshot.set(x.reference+'|'+Number(x.ingredient_id),{
   quantity:num(x.sold_qty),cost:round(x.cost),costEstimated:false,quantityEstimated:false});
 }
 const byRef=new Map(refs.map(ref=>[ref,[]]));
 for(const row of rows)if(validRef(row.reference)&&byRef.has(row.reference))
  byRef.get(row.reference).push(row);
 const oldRefs=refs.filter(ref=>!knownRefs.has(ref));
 const productSets=new Map(),neededProducts=new Set();
 for(const ref of oldRefs){
  const products=new Map();
  for(const line of perRef.get(ref)||[]){
   if(line.kind==='product'){
    const pid=num(line.item_id),current=products.get(pid)||{qty:0,name:line.name_snapshot};
    current.qty+=num(line.quantity);products.set(pid,current);
   }else if(line.kind==='package'){
    let components=[];try{components=JSON.parse(line.components_json||'[]')}catch(_){}
    for(const c of Array.isArray(components)?components:[]){
     const pid=num(c.productId),current=products.get(pid)||{qty:0,name:c.name||line.name_snapshot};
     current.qty+=num(c.quantity);products.set(pid,current);
    }
   }
  }
  productSets.set(ref,products);
  for(const pid of products.keys())if(pid>0)neededProducts.add(pid);
 }
 const recipes=new Map();
 if(neededProducts.size){
  const ids=[...neededProducts],ps=ids.map((_,i)=>'$'+(i+3)).join(',');
  const q=await db.query('SELECT r.product_id,r.ingredient_id,r.quantity_required,'+
   'r.cost_contribution,i.unit_cost FROM branch_recipes r '+
   'JOIN branch_ingredients i ON i.id=r.ingredient_id AND i.workspace_id=r.workspace_id '+
   'AND i.branch_id=r.branch_id WHERE r.workspace_id=$1 AND r.branch_id=$2 '+
   'AND r.product_id IN ('+ps+')',[workspaceId,branchId,...ids]);
  for(const x of q.rows){
   const pid=Number(x.product_id),list=recipes.get(pid)||[];
   list.push({ingredientId:Number(x.ingredient_id),
    unitCost:x.cost_contribution==null?
     num(x.quantity_required)*num(x.unit_cost):num(x.cost_contribution)});
   recipes.set(pid,list);
  }
 }
 for(const ref of oldRefs){
  const list=(byRef.get(ref)||[]).filter(x=>x.type==='LIVE_SALE');
  if(!list.length)continue;
  const byIngredient=new Map(list.map(x=>[Number(x.ingredientId),x]));
  const candidates=new Map();
  for(const [pid,product] of productSets.get(ref)||[]){
   for(const recipe of recipes.get(pid)||[]){
    if(!byIngredient.has(recipe.ingredientId))continue;
    const c=candidates.get(recipe.ingredientId)||{qty:0,weight:0};
    c.qty+=product.qty;
    c.weight+=Math.max(0,product.qty*recipe.unitCost);
    candidates.set(recipe.ingredientId,c);
   }
  }
  const source=perRef.get(ref)||[];
  const paidUnits=[...(productSets.get(ref)||new Map()).values()].reduce((n,p)=>n+p.qty,0);
  const totalCost=round(source.reduce((n,l)=>n+num(l.quantity)*num(l.unit_cost_snapshot),0));
  // If recipes have changed, allocate the recorded receipt cost across
  // actual stock movements. Mark this estimate, never claim it is historical.
  const fallbackWeight=list.reduce((n,x)=>n+Math.abs(num(x.quantityChange)),0)||1;
  const weights=list.map(x=>candidates.get(Number(x.ingredientId))?.weight||0);
  const weightSum=weights.reduce((n,x)=>n+x,0);
  let allocated=0;
  for(let i=0;i<list.length;i++){
   const row=list[i],id=Number(row.ingredientId),guess=candidates.get(id);
   const ratio=weightSum>0?weights[i]/weightSum:
    Math.abs(num(row.quantityChange))/fallbackWeight;
   const cost=i===list.length-1?round(totalCost-allocated):round(totalCost*ratio);
   allocated=round(allocated+cost);
   snapshot.set(ref+'|'+id,{
    quantity:guess?.qty||paidUnits||null,
    cost,costEstimated:true,quantityEstimated:!guess
   });
  }
 }
 for(const row of rows){
  const detail=snapshot.get(row.reference+'|'+Number(row.ingredientId));
  if(!detail)continue;
  row.quantity=detail.quantity??row.quantity;
  row.soldQuantity=detail.quantity??null;
  row.cost=detail.cost;
  row.costEstimated=detail.costEstimated;
  row.quantityEstimated=detail.quantityEstimated;
 }
 return rows;
}
module.exports={enrich};
