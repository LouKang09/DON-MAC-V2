'use strict';
/* Main Office-only read-only distribution analytics.
 * Deliberately separate from tenant POS dashboards and warehouse stock mutations.
 */
const invalid=(message,status=400)=>Object.assign(new Error(message),{status});
const dayPH=()=>{
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Manila',
  year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date())
  .filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
 return p.year+'-'+p.month+'-'+p.day;
};
const datePlus=(d,n)=>{const a=new Date(d+'T00:00:00Z');a.setUTCDate(a.getUTCDate()+n);return a.toISOString().slice(0,10)};
const isDate=d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d+'T00:00:00Z'))&&
 new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
const amount=n=>Math.round((Number(n)||0)*100)/100;
const numeric=n=>Number(n||0);
function windowFor(input={}){
 const today=dayPH();
 const period=String(input.period||'last30');
 let start=today,end=today;
 if(period==='week')start=datePlus(today,-6);
 else if(period==='last30')start=datePlus(today,-29);
 else if(period==='month')start=today.slice(0,7)+'-01';
 else if(period==='year')start=today.slice(0,4)+'-01-01';
 else if(period==='custom'){
  start=String(input.from||'');end=String(input.to||'');
  if(!isDate(start)||!isDate(end))throw invalid('Choose valid custom reporting dates.');
 }else if(period!=='today')throw invalid('Choose an available dashboard period.');
 if(start>end||end>today||Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z')>365*86400000)
  throw invalid('Choose a date range of up to 366 days ending today or earlier.');
 const branchId=String(input.branchId||'all');
 if(branchId!=='all'&&(!/^[1-9]\d*$/.test(branchId)||!Number.isSafeInteger(Number(branchId))))
  throw invalid('Invalid warehouse distribution branch.');
 return {period,start,end,branchId,
  startUtc:new Date(start+'T00:00:00+08:00').toISOString(),
  endUtc:new Date(datePlus(end,1)+'T00:00:00+08:00').toISOString()};
}
async function analytics(db,input={}){
 const f=windowFor(input);
 const args=[f.startUtc,f.endUtc];
 // The live selector must come from registered, active franchise branches,
 // including branches with no completed warehouse purchase at all.
 // Marlou09 is an explicitly excluded legacy test owner; his orders stay intact.
 const registered=await db.query(
  "SELECT b.id AS id,b.name AS name,w.id AS workspace_id,own.username AS franchise "+
  "FROM chat_workspace_branches wb "+
  "JOIN branches b ON b.id=wb.branch_id AND b.active=TRUE "+
  "JOIN chat_workspaces w ON w.id=wb.workspace_id "+
  "JOIN users own ON own.id=w.owner_user_id "+
  "WHERE own.role='Admin' AND own.active=TRUE "+
  "AND LOWER(own.username)<>'marlou09' "+
  "ORDER BY own.username,b.name,b.id");
 const validBranchIds=new Set(registered.rows.map(x=>Number(x.id)));
 if(f.branchId!=='all'){
  if(!validBranchIds.has(Number(f.branchId)))throw invalid('Select an active live franchise branch.',404);
  args.push(Number(f.branchId));
 }
 const branchSql=f.branchId==='all'?'':' AND o.branch_id=$3';
 const liveOrder="EXISTS (SELECT 1 FROM chat_workspaces w "+
  "JOIN users own ON own.id=w.owner_user_id "+
  "JOIN chat_workspace_branches wb ON wb.workspace_id=w.id AND wb.branch_id=o.branch_id "+
  "JOIN branches b ON b.id=o.branch_id "+
  "WHERE w.id=o.workspace_id AND own.role='Admin' AND own.active=TRUE "+
  "AND b.active=TRUE AND LOWER(own.username)<>'marlou09')";
 const delivered="o.status IN ('DELIVERED','COMPLETED')";
 const where=delivered+' AND '+liveOrder+' AND o.updated_at >= $1 AND o.updated_at < $2'+branchSql;
 const localDay=db.engine==='postgres'?
  "TO_CHAR(o.updated_at::timestamptz AT TIME ZONE 'Asia/Manila','YYYY-MM-DD')":
  "strftime('%Y-%m-%d',o.updated_at,'+8 hours')";
 const [summary,cost,days,dayCosts,branches,branchCosts,topProducts,statuses,stock,requested]=await Promise.all([
  db.query('SELECT COUNT(*) AS orders,COUNT(DISTINCT o.workspace_id) AS franchisees,'+
   'COALESCE(SUM(o.subtotal+o.urgent_fee),0) AS revenue,'+
   'COALESCE(SUM(o.urgent_fee),0) AS urgent_fees,'+
   "COALESCE(SUM(CASE WHEN o.priority='URGENT' THEN 1 ELSE 0 END),0) AS urgent_orders "+
   'FROM supply_orders o WHERE '+where,args),
  db.query('SELECT COALESCE(SUM(l.quantity),0) AS units,'+
   'COALESCE(SUM(CASE WHEN l.unit_cost IS NOT NULL THEN l.quantity*l.unit_cost ELSE 0 END),0) AS known_cost,'+
   'COALESCE(SUM(CASE WHEN l.unit_cost IS NULL THEN 1 ELSE 0 END),0) AS unknown_cost_lines '+
   'FROM supply_orders o JOIN supply_order_lines l ON l.order_id=o.id WHERE '+where,args),
  db.query('SELECT '+localDay+' AS day,o.branch_id AS branch_id,'+
   'COALESCE(b.name,\'Branch\') AS branch_name,'+
   'COUNT(*) AS orders,COALESCE(SUM(o.subtotal+o.urgent_fee),0) AS revenue,'+
   "COALESCE(SUM(CASE WHEN o.priority='URGENT' THEN 1 ELSE 0 END),0) AS urgent_orders "+
   'FROM supply_orders o LEFT JOIN branches b ON b.id=o.branch_id WHERE '+where+
   ' GROUP BY '+localDay+',o.branch_id,b.name ORDER BY day,o.branch_id',args),
  db.query('SELECT '+localDay+' AS day,o.branch_id AS branch_id,'+
   'COALESCE(SUM(l.quantity),0) AS units,'+
   'COALESCE(SUM(CASE WHEN l.unit_cost IS NOT NULL THEN l.quantity*l.unit_cost ELSE 0 END),0) AS known_cost,'+
   'COALESCE(SUM(CASE WHEN l.unit_cost IS NULL THEN 1 ELSE 0 END),0) AS unknown_cost_lines '+
   'FROM supply_orders o JOIN supply_order_lines l ON l.order_id=o.id WHERE '+where+
   ' GROUP BY '+localDay+',o.branch_id ORDER BY day,o.branch_id',args),
  db.query('SELECT o.branch_id AS branch_id,o.workspace_id AS workspace_id,'+
   'COALESCE(b.name,\'Branch\') AS branch_name,'+
   'COALESCE(own.username,\'Franchise\') AS franchise,'+
   'COUNT(*) AS orders,COALESCE(SUM(o.subtotal+o.urgent_fee),0) AS revenue,'+
   "COALESCE(SUM(CASE WHEN o.priority='URGENT' THEN 1 ELSE 0 END),0) AS urgent_orders "+
   'FROM supply_orders o LEFT JOIN branches b ON b.id=o.branch_id '+
   'LEFT JOIN chat_workspaces w ON w.id=o.workspace_id '+
   'LEFT JOIN users own ON own.id=w.owner_user_id WHERE '+where+
   ' GROUP BY o.branch_id,o.workspace_id,b.name,own.username ORDER BY revenue DESC',args),
  db.query('SELECT o.branch_id AS branch_id,COALESCE(SUM(l.quantity),0) AS units,'+
   'COALESCE(SUM(CASE WHEN l.unit_cost IS NOT NULL THEN l.quantity*l.unit_cost ELSE 0 END),0) AS known_cost,'+
   'COALESCE(SUM(CASE WHEN l.unit_cost IS NULL THEN 1 ELSE 0 END),0) AS unknown_cost_lines ' +
   'FROM supply_orders o JOIN supply_order_lines l ON l.order_id=o.id WHERE '+where+
   ' GROUP BY o.branch_id',args),
  db.query('SELECT l.product_name AS name,l.uom AS uom,'+
   'SUM(l.quantity) AS quantity,SUM(l.amount) AS revenue,'+
   'COUNT(DISTINCT o.id) AS orders FROM supply_orders o '+
   'JOIN supply_order_lines l ON l.order_id=o.id WHERE '+where+
   ' GROUP BY l.product_name,l.uom ORDER BY quantity DESC,name LIMIT 12',args),
  db.query('SELECT o.status,COUNT(*) AS count FROM supply_orders o WHERE '+
   "o.status IN ('PENDING_REVIEW','APPEAL_REVIEW','ON_HOLD','APPROVED','PREPARING','DISPATCHED')"+
   ' AND '+liveOrder+
   (branchSql?' AND o.branch_id=$1':'')+
   ' GROUP BY o.status ORDER BY o.status',branchSql?[Number(f.branchId)]:[]),
  db.query('SELECT id,name,uom,stock_qty,cost_price FROM supply_products WHERE active=TRUE ORDER BY name'),
  db.query('SELECT COUNT(*) AS count FROM supply_orders o WHERE o.created_at >= $1 '+
   'AND o.created_at < $2 AND '+liveOrder+branchSql,args)
 ]);
 const totals=summary.rows[0]||{},costs=cost.rows[0]||{};
 const knownCost=amount(costs.known_cost),revenue=amount(totals.revenue);
 const missingCostLines=numeric(costs.unknown_cost_lines);
 const costRows=new Map(dayCosts.rows.map(r=>[r.day+'|'+r.branch_id,r]));
 const branchCostMap=new Map(branchCosts.rows.map(r=>[Number(r.branch_id),r]));
 const branchSales=new Map(branches.rows.map(r=>[Number(r.branch_id),r]));
 const branchRows=registered.rows.filter(r=>f.branchId==='all'||Number(r.id)===Number(f.branchId)).map(reg=>{
  const r=branchSales.get(Number(reg.id))||{};
  const c=branchCostMap.get(Number(reg.id))||{},missing=numeric(c.unknown_cost_lines);
  return{id:Number(reg.id),workspaceId:Number(reg.workspace_id),name:reg.name,
   franchise:reg.franchise,orders:numeric(r.orders),urgentOrders:numeric(r.urgent_orders),
   units:numeric(c.units),revenue:amount(r.revenue),knownCost:amount(c.known_cost),
   unknownCostLines:missing,grossProfit:missing?null:amount(numeric(r.revenue)-numeric(c.known_cost))};
 });
 const trend=days.rows.map(r=>{
  const c=costRows.get(r.day+'|'+r.branch_id)||{};
  const missing=numeric(c.unknown_cost_lines);
  return{day:r.day,branchId:Number(r.branch_id),branch:r.branch_name,
   orders:numeric(r.orders),urgentOrders:numeric(r.urgent_orders),
   revenue:amount(r.revenue),units:numeric(c.units),knownCost:amount(c.known_cost),
   grossProfit:missing?null:amount(numeric(r.revenue)-numeric(c.known_cost)),
   unknownCostLines:missing};
 });
 const perDay=new Map();
 for(const r of trend)perDay.set(r.day,(perDay.get(r.day)||0)+r.orders);
 const busiest=[...perDay].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0]||null;
 const inventory=stock.rows.map(r=>({
  id:Number(r.id),name:r.name,uom:r.uom,stockQty:numeric(r.stock_qty),
  costKnown:r.cost_price!=null
 }));
 const outOfStock=inventory.filter(p=>p.stockQty<=0);
 const missingUnitCost=inventory.filter(p=>!p.costKnown);
 return{
  period:{key:f.period,from:f.start,to:f.end,branchId:f.branchId},
  totals:{
   revenue,knownCost,unknownCostLines:missingCostLines,
   grossProfit:missingCostLines?null:amount(revenue-knownCost),
   marginPercent:missingCostLines||!revenue?null:amount((revenue-knownCost)/revenue*100),
   deliveredOrders:numeric(totals.orders),units:numeric(costs.units),
   requestingFranchisees:numeric(totals.franchisees),
   urgentOrders:numeric(totals.urgent_orders),
   urgentFees:amount(totals.urgent_fees),ordersRequested:numeric(requested.rows[0]?.count),
   openRequests:statuses.rows.reduce((n,r)=>n+numeric(r.count),0),
   peakDistributionDay:busiest?.[0]||null,peakDistributionOrders:busiest?.[1]||0,
   outOfStockSkus:outOfStock.length,missingUnitCostSkus:missingUnitCost.length
  },
  branches:registered.rows.map(r=>({id:Number(r.id),name:r.name||'Branch '+r.id,franchise:r.franchise,workspaceId:Number(r.workspace_id)})),
  byBranch:branchRows,
  topProducts:topProducts.rows.map(r=>({name:r.name,uom:r.uom,
    quantity:numeric(r.quantity),revenue:amount(r.revenue),orders:numeric(r.orders)})),
  trend,
  backlog:statuses.rows.map(r=>({status:r.status,count:numeric(r.count)})),
  stockouts:outOfStock.slice(0,20),
  missingCostProducts:missingUnitCost.slice(0,20),
  definitions:{
   revenue:'Delivered supply products and urgent handling fees; franchise royalties excluded.',
   grossProfit:'Delivered supply revenue minus recorded order-item purchase costs; unavailable if a delivered line lacks a cost.',
   openRequests:'Open orders as of now, not limited to the selected delivery date range.',
   stockouts:'Currently active catalog products with zero available warehouse stock.'
  }
 };
}
module.exports={analytics,windowFor};
