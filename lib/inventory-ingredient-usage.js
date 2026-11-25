'use strict';
/*
 * Ingredient use by completed POS transactions.
 * Gross Cost: checkout ingredient cost before void/delete exclusions.
 * Net Cost: ingredient cost attributable to completed ('Sold') receipts.
 * Quantities shown are sold-only, not replenishment/transfer amounts.
 * Snapshot values are historical; older receipts use the original stock
 * deduction quantities valued at CURRENT ingredient unit prices (estimated).
 */
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const two=x=>Math.round((Number(x)||0)*100)/100;
const six=x=>Math.round((Number(x)||0)*1000000)/1000000;
const dayToday=()=>{
 const x=new Intl.DateTimeFormat('en-US',{
  timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'
 }).formatToParts(new Date());
 const o=Object.fromEntries(x.filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
 return o.year+'-'+o.month+'-'+o.day;
};
const shift=(date,delta)=>new Date(Date.parse(date+'T00:00:00Z')+delta*86400000)
 .toISOString().slice(0,10);
const dateValid=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))&&
 !Number.isNaN(Date.parse(s+'T00:00:00Z'))&&
 new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
function period(params={}){
 const range=String(params.range||'day').toLowerCase();
 if(!['day','week','last30','month','custom'].includes(range))throw fail('Choose Today, Last 7 days, Last 30 days, This month or Custom.',400);
 const today=dayToday();
 let start,end=today;
 if(range==='day')start=today;
 else if(range==='week')start=shift(today,-6);
 else if(range==='last30')start=shift(today,-29);
 else if(range==='month')start=today.slice(0,7)+'-01';
 else{
  start=String(params.start||params.from||'');
  end=String(params.end||params.to||'');
  if(!dateValid(start)||!dateValid(end))throw fail('Enter valid custom start and end dates (YYYY-MM-DD).',400);
  if(start>end)throw fail('Start date must be on or before the end date.',400);
  if(end>today)throw fail('End date cannot be in the future.',400);
 }
 if((Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000>365)
  throw fail('The custom range can include at most 366 days.',400);
 return {range,start,end,fromUtc:new Date(start+'T00:00:00+08:00').toISOString(),
  untilUtc:new Date(shift(end,1)+'T00:00:00+08:00').toISOString()};
}
const dayColumn=(db,alias='s')=>db.engine==='postgres'?
 "to_char((CAST("+alias+".sold_at AS TIMESTAMPTZ) AT TIME ZONE 'Asia/Manila'),'YYYY-MM-DD')":
 "substr(datetime("+alias+".sold_at,'+8 hours'),1,10)";
const num=v=>Number.isFinite(Number(v))?Number(v):0;
function summarize(raw,per,branch,estimateNote){
 const grouped=new Map(),times=new Map();
 let gross=0,net=0,estimated=false,productUnits=0;
 const mk=k=>String(k??'');
 for(const row of raw){
  const day=String(row.day||'');
  if(day<per.start||day>per.end)continue;
  const name=String(row.ingredient_name||'Unattributed ingredient'),uom=String(row.uom||'unit');
  const id=mk(row.ingredient_id),key=id+'|'+uom+'|'+name;
  const g=grouped.get(key)||{id,name,uom,qty:0,grossCost:0,netCost:0,
   soldProductUnits:0,estimated:false,products:new Map()};
  const used=num(row.sold_usage_qty),gCost=num(row.gross_cost),nCost=num(row.net_cost),
   soldUnits=num(row.sold_product_qty);
  g.qty+=used;g.grossCost+=gCost;g.netCost+=nCost;g.soldProductUnits+=soldUnits;
  g.estimated ||= !!row.estimated;estimated ||= !!row.estimated;
  gross+=gCost;net+=nCost;productUnits+=soldUnits;
  const prod=String(row.product_name||'Historical checkout (item details unavailable)');
  const item=g.products.get(prod)||{name:prod,qty:0,usageQty:0,netCost:0};
  item.qty+=soldUnits;item.usageQty+=used;item.netCost+=nCost;g.products.set(prod,item);
  grouped.set(key,g);
  const t=times.get(day)||{day,grossCost:0,netCost:0};
  t.grossCost+=gCost;t.netCost+=nCost;times.set(day,t);
 }
 const ingredients=[...grouped.values()].filter(x=>x.qty!==0||x.grossCost!==0||x.netCost!==0)
  .map(x=>({...x,qty:six(x.qty),grossCost:two(x.grossCost),netCost:two(x.netCost),
   soldProductUnits:six(x.soldProductUnits),
   products:[...x.products.values()].filter(p=>p.qty||p.usageQty||p.netCost)
    .map(p=>({...p,qty:six(p.qty),usageQty:six(p.usageQty),netCost:two(p.netCost)}))
    .sort((a,b)=>b.usageQty-a.usageQty||a.name.localeCompare(b.name))}))
  .sort((a,b)=>b.netCost-a.netCost||a.name.localeCompare(b.name));
 const days=[];for(let d=per.start;d<=per.end;d=shift(d,1)){
  const a=times.get(d)||{day:d,grossCost:0,netCost:0};
  days.push({day:d,grossCost:two(a.grossCost),netCost:two(a.netCost)});
 }
 return {branch:{id:Number(branch.id),name:branch.name},period:{range:per.range,
  start:per.start,end:per.end},totals:{grossCost:two(gross),netCost:two(net),
   excludedCost:two(gross-net),ingredientTypes:ingredients.length,
   linkedProductUnits:six(productUnits)},ingredients,days,estimated,
  sourceNote:estimateNote||'Cost from saved receipt ingredient snapshots.',
  costDefinitions:{gross:'Checkout ingredient costs before void/delete exclusions',
   net:'Ingredient costs attributable to completed sold transactions'},
  complete:true};
}
async function live(db,workspaceId,branch,params={}){
 const per=period(params),day=dayColumn(db);
 const args=[workspaceId,Number(branch.id),per.fromUtc,per.untilUtc];
 const scope='s.workspace_id=$1 AND s.branch_id=$2 AND s.sold_at>=$3 AND s.sold_at<$4';
 const sold="LOWER(s.status)='sold'";
 const [snap,older,recipeFallback]=await Promise.all([
  db.query('SELECT c.ingredient_id,c.ingredient_name,c.uom,c.product_name,'+
   day+' AS day,'+
   'COALESCE(SUM(c.total_cost),0) AS gross_cost,'+
   'COALESCE(SUM(CASE WHEN '+sold+' THEN c.total_cost ELSE 0 END),0) AS net_cost,'+
   'COALESCE(SUM(CASE WHEN '+sold+' THEN c.usage_qty ELSE 0 END),0) AS sold_usage_qty,'+
   'COALESCE(SUM(CASE WHEN '+sold+' THEN c.product_qty ELSE 0 END),0) AS sold_product_qty '+
   'FROM branch_sale_cost_components c JOIN branch_live_sales s ON s.id=c.sale_id '+
   'AND s.workspace_id=c.workspace_id AND s.branch_id=c.branch_id WHERE '+
   scope+' AND c.workspace_id=$1 AND c.branch_id=$2 '+
   'GROUP BY c.ingredient_id,c.ingredient_name,c.uom,c.product_name,'+day,args),
  db.query('SELECT m.ingredient_id,i.display_name AS ingredient_name,i.uom,'+
   day+' AS day,COALESCE(SUM(-m.quantity_change),0) AS checkout_qty,'+
   'COALESCE(SUM(CASE WHEN '+sold+' THEN -m.quantity_change ELSE 0 END),0) AS sold_qty,'+
   'MAX(i.unit_cost) AS unit_cost '+
   'FROM branch_inventory_movements m JOIN branch_live_sales s ON s.reference=m.reference '+
   'AND s.workspace_id=m.workspace_id AND s.branch_id=m.branch_id '+
   'JOIN branch_ingredients i ON i.id=m.ingredient_id AND i.workspace_id=m.workspace_id '+
   'AND i.branch_id=m.branch_id WHERE '+scope+
   " AND m.movement_type='LIVE_SALE' AND m.workspace_id=$1 AND m.branch_id=$2"+
   ' AND NOT EXISTS (SELECT 1 FROM branch_sale_cost_components c WHERE c.sale_id=s.id '+
   'AND c.workspace_id=s.workspace_id AND c.branch_id=s.branch_id) '+
   'GROUP BY m.ingredient_id,i.display_name,i.uom,'+day,args),
  // Receipts predating cost snapshots and stock-movement records still have
  // item snapshots. Reconstruct from today's authorized branch recipes only;
  // keep these estimates distinct and never double-count recorded deductions.
  db.query('SELECT r.ingredient_id,i.display_name AS ingredient_name,i.uom,'+
   'si.name_snapshot AS product_name,'+day+' AS day,'+
   'COALESCE(SUM(si.quantity*r.quantity_required),0) AS gross_usage_qty,'+
   'COALESCE(SUM(CASE WHEN '+sold+' THEN si.quantity*r.quantity_required ELSE 0 END),0) AS sold_usage_qty,'+
   'COALESCE(SUM(si.quantity*COALESCE(NULLIF(r.cost_contribution,0),r.quantity_required*i.unit_cost,0)),0) AS gross_cost,'+
   'COALESCE(SUM(CASE WHEN '+sold+' THEN si.quantity*COALESCE(NULLIF(r.cost_contribution,0),r.quantity_required*i.unit_cost,0) ELSE 0 END),0) AS net_cost,'+
   'COALESCE(SUM(CASE WHEN '+sold+' THEN si.quantity ELSE 0 END),0) AS sold_product_qty '+
   'FROM branch_live_sale_items si JOIN branch_live_sales s ON s.id=si.sale_id '+
   'AND s.workspace_id=si.workspace_id AND s.branch_id=si.branch_id '+
   'JOIN branch_recipes r ON r.product_id=si.item_id AND r.workspace_id=si.workspace_id '+
   'AND r.branch_id=si.branch_id JOIN branch_ingredients i ON i.id=r.ingredient_id '+
   'AND i.workspace_id=r.workspace_id AND i.branch_id=r.branch_id WHERE '+scope+
   " AND si.kind='product' AND si.workspace_id=$1 AND si.branch_id=$2 "+
   'AND NOT EXISTS (SELECT 1 FROM branch_sale_cost_components c WHERE c.sale_id=s.id '+
   'AND c.workspace_id=s.workspace_id AND c.branch_id=s.branch_id) '+
   "AND NOT EXISTS (SELECT 1 FROM branch_inventory_movements m WHERE m.reference=s.reference "+
   "AND m.workspace_id=s.workspace_id AND m.branch_id=s.branch_id AND m.movement_type='LIVE_SALE') "+
   'GROUP BY r.ingredient_id,i.display_name,i.uom,si.name_snapshot,'+day,args)
 ]);
 const raw=snap.rows.map(x=>({...x,estimated:false}));
 for(const x of older.rows)raw.push({ingredient_id:x.ingredient_id,ingredient_name:x.ingredient_name,
  uom:x.uom,product_name:'Historical checkout (product breakdown unavailable)',
  day:x.day,sold_usage_qty:x.sold_qty,sold_product_qty:0,
  gross_cost:num(x.checkout_qty)*num(x.unit_cost),
  net_cost:num(x.sold_qty)*num(x.unit_cost),estimated:true});
 for(const x of recipeFallback.rows)raw.push({...x,estimated:true});
 return summarize(raw,per,branch,
  (older.rows.length||recipeFallback.rows.length)?'Includes estimated historical usage valued at current ingredient unit prices; old receipts may use current recipe and unit prices.':'Based on recorded checkout-time ingredient usage and cost snapshots.');
}
async function legacy(db,workspaceId,branch,params={}){
 const per=period(params),day=dayColumn(db);
 const args=[workspaceId,Number(branch.id),per.fromUtc,per.untilUtc];
 const sold="LOWER(s.status)='sold'";
 // Legacy receipts carry no ingredient snapshots. Join recorded products
 // to their current recipe for an explicitly labelled historical estimate.
 const rows=await db.query(
  'SELECT pi.ingredient_id,i.display_name AS ingredient_name,i.uom,p.product_name,'+
  day+' AS day,'+
  'COALESCE(SUM(p.quantity*pi.quantity_required),0) AS gross_usage_qty,'+
  'COALESCE(SUM(CASE WHEN '+sold+' THEN p.quantity*pi.quantity_required ELSE 0 END),0) AS sold_usage_qty,'+
  'COALESCE(SUM(p.quantity*COALESCE(pi.cost_contribution,0)),0) AS gross_cost,'+
  'COALESCE(SUM(CASE WHEN '+sold+' THEN p.quantity*COALESCE(pi.cost_contribution,0) ELSE 0 END),0) AS net_cost,'+
  'COALESCE(SUM(CASE WHEN '+sold+' THEN p.quantity ELSE 0 END),0) AS sold_product_qty '+
  'FROM ('+
   'SELECT si.sale_id,si.product_id,si.product_name_snapshot AS product_name,si.quantity '+
   'FROM sale_items si WHERE si.product_id IS NOT NULL AND si.is_package=$5 '+
   'UNION ALL '+
   'SELECT parent.sale_id,part.product_id,cp.name AS product_name,part.quantity '+
   'FROM sale_item_components part JOIN sale_items parent ON parent.id=part.sale_item_id '+
   'JOIN products cp ON cp.id=part.product_id'+
  ') p JOIN sales s ON s.id=p.sale_id '+
  'JOIN chat_workspace_branches wb ON wb.branch_id=s.branch_id AND wb.workspace_id=$1 '+
  'JOIN product_ingredients pi ON pi.product_id=p.product_id '+
  'JOIN ingredients i ON i.id=pi.ingredient_id '+
  'WHERE s.branch_id=$2 AND s.sold_at>=$3 AND s.sold_at<$4 '+
  'GROUP BY pi.ingredient_id,i.display_name,i.uom,p.product_name,'+day,
  [...args,false]);
 return summarize(rows.rows.map(x=>({...x,estimated:true})),per,branch,
  'Historical estimates from current product recipes and ingredient costs; old receipts do not retain immutable ingredient-level cost snapshots.');
}
module.exports={period,live,legacy,summarize};
