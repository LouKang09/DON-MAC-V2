'use strict';
const cashierScope=require('./report-cashier-scope');
// Live-franchise ingredient usage: stored cost snapshots for new sales and
// explicitly labelled reconstructions for receipts from before snapshots existed.
// All reads are constrained by the authenticated workspace, branch and sold period.
const scope=require('./franchise-live-scope');
const sum=(a,k)=>a.reduce((n,x)=>n+Number(x[k]||0),0);
const cent=n=>Math.round((Number(n)+Number.EPSILON)*100)/100;
const number=x=>Number.isFinite(Number(x))?Number(x):0;
const id=x=>scope.goodId(x);
function aggregate(rows){
 const ingredients=new Map();
 let reconstructed=false,unattributed=0;
 for(const x of rows){
  reconstructed ||= !!x.reconstructed;
  if(x.unattributed)unattributed+=number(x.totalCost);
  const key=String(x.ingredientId)+'|'+String(x.uom||'')+'|'+String(x.name||'');
  if(!ingredients.has(key))ingredients.set(key,{
   name:x.name||'Unattributed historical costing',uom:x.uom||'—',
   totalQty:0,totalCost:0,details:[],reconstructed:!!x.reconstructed
  });
  const g=ingredients.get(key);
  g.totalQty+=number(x.usageQty);
  g.totalCost+=number(x.totalCost);
  g.reconstructed ||= !!x.reconstructed;
  const match=g.details.find(d=>d.product===x.product&&d.reconstructed===!!x.reconstructed&&
   Math.abs(d.quantityRequired-number(x.recipeQty))<0.00000001);
  if(match){
   match.productQty+=number(x.productQty);
   match.usageQty+=number(x.usageQty);
   match.totalCost+=number(x.totalCost);
  }else g.details.push({
   product:x.product,productQty:number(x.productQty),quantityRequired:number(x.recipeQty),
   usageQty:number(x.usageQty),costPerItem:number(x.costPerItem),
   totalCost:number(x.totalCost),reconstructed:!!x.reconstructed
  });
 }
 return{
  ingredients:[...ingredients.values()].map(g=>({
   ...g,totalQty:Number(g.totalQty.toFixed(6)),totalCost:cent(g.totalCost),
   details:g.details.map(d=>({...d,productQty:Number(d.productQty.toFixed(6)),
    usageQty:Number(d.usageQty.toFixed(6)),totalCost:cent(d.totalCost)}))
  })).sort((a,b)=>b.totalCost-a.totalCost||a.name.localeCompare(b.name)),
  reconstructed,unattributed:cent(unattributed)
 };
}
async function report(db,ctx,rawBranchId,since,until=new Date().toISOString(),cashierIds=null){
 const branch=await scope.branch(db,ctx,rawBranchId||ctx.branchId);
 const args=[ctx.workspaceId,branch.id,since];
 const itemArgs=[...args,'Sold',until],movementArgs=[...args,'Sold','LIVE_SALE',until];
 const itemScope=cashierScope.clause('s.cashier_user_id',itemArgs,cashierIds);
 const movementScope=cashierScope.clause('s.cashier_user_id',movementArgs,cashierIds);
 const [snap,older,movements]=await Promise.all([
  db.query('SELECT c.ingredient_id,c.ingredient_name,c.uom,c.product_name,'+
   'c.product_qty,c.recipe_qty,c.usage_qty,c.cost_per_item,c.total_cost '+
   'FROM branch_sale_cost_components c JOIN branch_live_sales s '+
   'ON s.id=c.sale_id AND s.workspace_id=c.workspace_id AND s.branch_id=c.branch_id '+
   'WHERE c.workspace_id=$1 AND c.branch_id=$2 AND s.sold_at>=$3 AND s.sold_at<$5 AND s.status=$4'+itemScope,
   itemArgs),
  db.query('SELECT i.sale_id,i.kind,i.item_id,i.name_snapshot,i.quantity,'+
   'i.unit_cost_snapshot,i.components_json,s.reference '+
   'FROM branch_live_sale_items i JOIN branch_live_sales s ON s.id=i.sale_id '+
   'AND s.workspace_id=i.workspace_id AND s.branch_id=i.branch_id '+
   'WHERE i.workspace_id=$1 AND i.branch_id=$2 AND s.sold_at>=$3 AND s.sold_at<$5 AND s.status=$4'+itemScope+' '+
   'AND NOT EXISTS(SELECT 1 FROM branch_sale_cost_components c WHERE c.sale_id=i.sale_id '+
   'AND c.workspace_id=i.workspace_id AND c.branch_id=i.branch_id) '+
   'ORDER BY i.sale_id,i.name_snapshot',
   itemArgs),
  db.query('SELECT m.reference,m.ingredient_id,i.display_name,i.uom,'+
   'SUM(-m.quantity_change) AS usage_qty FROM branch_inventory_movements m '+
   'JOIN branch_live_sales s ON s.reference=m.reference AND s.workspace_id=m.workspace_id '+
   'AND s.branch_id=m.branch_id JOIN branch_ingredients i ON i.id=m.ingredient_id '+
   'AND i.workspace_id=m.workspace_id AND i.branch_id=m.branch_id '+
   'WHERE m.workspace_id=$1 AND m.branch_id=$2 AND s.sold_at>=$3 AND s.sold_at<$6 '+
   'AND s.status=$4 AND m.movement_type=$5'+movementScope+' GROUP BY m.reference,m.ingredient_id,i.display_name,i.uom',
   movementArgs)
 ]);
 const rows=snap.rows.map(x=>({
  ingredientId:number(x.ingredient_id),name:x.ingredient_name,uom:x.uom,
  product:x.product_name,productQty:number(x.product_qty),recipeQty:number(x.recipe_qty),
  usageQty:number(x.usage_qty),costPerItem:number(x.cost_per_item),totalCost:number(x.total_cost),
  reconstructed:false
 }));
 const actualUsage=new Map();
 for(const movement of movements.rows){
  const ref=String(movement.reference||'');
  if(!actualUsage.has(ref))actualUsage.set(ref,new Map());
  actualUsage.get(ref).set(number(movement.ingredient_id),{
   name:movement.display_name,uom:movement.uom,qty:number(movement.usage_qty)});
 }
 const oldSales=new Map();
 for(const x of older.rows){
  if(!oldSales.has(x.sale_id))oldSales.set(x.sale_id,[]);
  oldSales.get(x.sale_id).push(x);
 }
 const recipeCache=new Map();
 async function recipeFor(productId){
  if(recipeCache.has(productId))return recipeCache.get(productId);
  const r=await db.query('SELECT r.ingredient_id,r.quantity_required,r.cost_contribution,'+
   'i.display_name,i.uom,i.unit_cost FROM branch_recipes r '+
   'JOIN branch_ingredients i ON i.id=r.ingredient_id AND i.workspace_id=r.workspace_id '+
   'AND i.branch_id=r.branch_id WHERE r.workspace_id=$1 AND r.branch_id=$2 AND r.product_id=$3',
   [ctx.workspaceId,branch.id,productId]);
  const lines=r.rows.map(x=>({
   id:number(x.ingredient_id),name:x.display_name,uom:x.uom,
   qty:number(x.quantity_required),
   weight:x.cost_contribution===null||x.cost_contribution===undefined?
    number(x.quantity_required)*number(x.unit_cost):number(x.cost_contribution)
  })).filter(x=>x.qty>0);
  recipeCache.set(productId,lines);
  return lines;
 }
 for(const [saleId,lines] of oldSales){
  const products=new Map();
  let recordedCost=0;
  for(const line of lines){
   const saleQty=number(line.quantity);
   recordedCost+=saleQty*number(line.unit_cost_snapshot);
   if(line.kind==='product'){
    const pid=id(line.item_id);
    if(!pid)continue;
    const existing=products.get(pid)||{name:line.name_snapshot,qty:0};
    existing.qty+=saleQty;products.set(pid,existing);
   }else if(line.kind==='package'){
    let components=[];
    try{components=JSON.parse(line.components_json||'[]');}catch(_){}
    for(const component of Array.isArray(components)?components:[]){
     const pid=id(component.productId);
     if(!pid)continue;
     const existing=products.get(pid)||{name:component.name||line.name_snapshot,qty:0};
     // Package line snapshots already store total component quantities.
     existing.qty+=number(component.quantity);
     products.set(pid,existing);
    }
   }
  }
  const candidates=[];
  for(const [pid,p] of products){
   for(const ingredient of await recipeFor(pid)){
    candidates.push({ingredientId:ingredient.id,name:ingredient.name,uom:ingredient.uom,
     product:p.name,productQty:p.qty,recipeQty:ingredient.qty,
     usageQty:ingredient.qty*p.qty,weight:Math.max(0,ingredient.weight*p.qty)});
   }
  }
  // Preserve actual recorded stock usage for older receipts even when
  // recipes were subsequently changed. Product attribution is reconstructed
  // only when the recipe still supplies a matching ingredient link.
  const soldReference=lines[0]?.reference||'';
  const actual=actualUsage.get(soldReference);
  if(actual){
   for(const [ingredientId,usage] of actual){
    const matches=candidates.filter(x=>x.ingredientId===ingredientId);
    if(matches.length){
     const totalExpected=matches.reduce((n,x)=>n+x.usageQty,0);
     for(const c of matches)c.usageQty=totalExpected>0?
      usage.qty*(c.usageQty/totalExpected):usage.qty/matches.length;
    }else{
     const soldQty=sum(lines,'quantity');
     candidates.push({ingredientId,name:usage.name,uom:usage.uom,
      product:'Historical sale · recipe changed',productQty:soldQty,
      recipeQty:soldQty>0?usage.qty/soldQty:0,usageQty:usage.qty,
      weight:0,unattributed:true});
    }
   }
   // Recipe rows that no longer correspond to historical stock movements
   // are excluded from usage; do not invent historical stock deductions.
   for(let i=candidates.length-1;i>=0;i--){
    const c=candidates[i];
    if(!actual.has(c.ingredientId) && !c.unattributed)candidates.splice(i,1);
   }
  }
  if(!candidates.length){
   if(recordedCost!==0)rows.push({ingredientId:'unattributed-'+saleId,name:'Unattributed historical costing',
    uom:'—',product:lines.map(x=>x.name_snapshot).join(', ')||'Recorded sale',
    productQty:sum(lines,'quantity'),recipeQty:0,usageQty:0,
    costPerItem:0,totalCost:recordedCost,reconstructed:true,unattributed:true});
   continue;
  }
  // Historical receipts contain the exact total cost but predate component
  // snapshots. Use the *current* recipe only to allocate that stored amount.
  // Do not advertise reconstructed per-ingredient costs as historical facts.
  const weights=candidates.map(x=>x.weight>0?x.weight:x.usageQty);
  const totalWeight=weights.reduce((a,b)=>a+b,0);
  let allocated=0;
  for(let i=0;i<candidates.length;i++){
   const c=candidates[i],amount=i===candidates.length-1?
    recordedCost-allocated:(totalWeight>0?recordedCost*weights[i]/totalWeight:recordedCost/candidates.length);
   allocated+=amount;
   rows.push({...c,totalCost:amount,costPerItem:c.productQty>0?amount/c.productQty:0,
    reconstructed:true});
  }
 }
 const result=aggregate(rows);
 const snapshotTotal=sum(snap.rows,'total_cost'),historicalTotal=[...oldSales.values()].reduce(
  (acc,saleLines)=>acc+saleLines.reduce((n,x)=>n+number(x.quantity)*number(x.unit_cost_snapshot),0),0);
 return{branchId:branch.id,totalCost:cent(snapshotTotal+historicalTotal),...result,
  note:result.reconstructed?'Older sales use recorded sale costs allocated across current recipe ingredients. Exact historical ingredient costs were not stored.':'Ingredient costs reflect stored checkout-time recipe snapshots.'};
}
module.exports={report,aggregate};
