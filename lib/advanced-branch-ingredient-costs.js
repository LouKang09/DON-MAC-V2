'use strict';
/*
 * Ingredient cost of goods sold by authenticated branch and Manila calendar
 * day. These are NOT operating expenses or ingredient stock purchases.
 *
 * Live checkout: immutable sale component/unit-cost snapshots, excluding
 * voided transactions. The legacy read uses current recipe-cost estimates
 * because old receipts did not store their original ingredient costs.
 */
const currency=x=>Math.round((Number(x)||0)*100)/100;
function dayExpression(db){
 return db.engine==='postgres'?
  "to_char((CAST(s.sold_at AS TIMESTAMPTZ) AT TIME ZONE 'Asia/Manila'),'YYYY-MM-DD')":
  "substr(datetime(s.sold_at,'+8 hours'),1,10)";
}
function argumentsFor(workspaceId,branchIds,startUtc,endUtc){
 const ids=[...new Set(branchIds.map(Number))].filter(x=>Number.isSafeInteger(x)&&x>0);
 return {
  ids,params:[workspaceId,'Sold',startUtc,endUtc,...ids],
  branchClause:ids.map((_,i)=>'$'+(i+5)).join(',')
 };
}
function merge(rows,out,keys){
 for(const row of rows){
  const id=Number(row.branch_id),day=String(row.day||'');
  if(!keys.has(id)||! /^\d{4}-\d{2}-\d{2}$/.test(day))continue;
  const k=id+'|'+day;
  out.set(k,currency((out.get(k)||0)+Number(row.total||0)));
 }
}
async function live(db,workspaceId,branchIds,startUtc,endUtc){
 const {ids,params,branchClause}=argumentsFor(workspaceId,branchIds,startUtc,endUtc);
 if(!ids.length)return new Map();
 const day=dayExpression(db);
 const where='s.workspace_id=$1 AND s.status=$2 AND s.sold_at>=$3 AND s.sold_at<$4 '+
  'AND s.branch_id IN ('+branchClause+')';
 const [componentRows,snapshotRows]=await Promise.all([
  db.query('SELECT s.branch_id,'+day+' AS day,COALESCE(SUM(c.total_cost),0) AS total '+
   'FROM branch_sale_cost_components c JOIN branch_live_sales s ON s.id=c.sale_id '+
   'AND s.workspace_id=c.workspace_id AND s.branch_id=c.branch_id WHERE '+
   where+' AND c.workspace_id=$1 GROUP BY s.branch_id,'+day,params),
  db.query('SELECT s.branch_id,'+day+' AS day,'+
   'COALESCE(SUM(i.quantity*i.unit_cost_snapshot),0) AS total '+
   'FROM branch_live_sale_items i JOIN branch_live_sales s ON s.id=i.sale_id '+
   'AND s.workspace_id=i.workspace_id AND s.branch_id=i.branch_id WHERE '+
   where+' AND i.workspace_id=$1 AND NOT EXISTS ('+
    'SELECT 1 FROM branch_sale_cost_components c WHERE c.sale_id=s.id '+
    'AND c.workspace_id=s.workspace_id AND c.branch_id=s.branch_id) '+
   'GROUP BY s.branch_id,'+day,params)
 ]);
 const costs=new Map(),allowed=new Set(ids);
 merge(componentRows.rows,costs,allowed);
 merge(snapshotRows.rows,costs,allowed);
 return costs;
}
async function legacy(db,workspaceId,branchIds,startUtc,endUtc){
 const {ids,params,branchClause}=argumentsFor(workspaceId,branchIds,startUtc,endUtc);
 if(!ids.length)return new Map();
 const day=dayExpression(db);
 const rows=await db.query(
  'SELECT s.branch_id,'+day+' AS day,'+
   'COALESCE(SUM(CASE WHEN si.is_package THEN COALESCE(pkg.item_cost,0) '+
   'ELSE COALESCE(base.unit_cost,0)*si.quantity END),0) AS total '+
   'FROM sales s JOIN sale_items si ON si.sale_id=s.id '+
   'JOIN chat_workspace_branches wb ON wb.branch_id=s.branch_id AND wb.workspace_id=$1 '+
   'LEFT JOIN (SELECT pi.product_id,COALESCE(SUM(pi.cost_contribution),0) AS unit_cost '+
   'FROM product_ingredients pi GROUP BY pi.product_id) base ON base.product_id=si.product_id '+
   'LEFT JOIN (SELECT sic.sale_item_id,'+
   'COALESCE(SUM(sic.quantity*COALESCE(recipe.unit_cost,0)),0) AS item_cost '+
   'FROM sale_item_components sic LEFT JOIN ('+
    'SELECT pi.product_id,COALESCE(SUM(pi.cost_contribution),0) AS unit_cost '+
    'FROM product_ingredients pi GROUP BY pi.product_id'+
   ') recipe ON recipe.product_id=sic.product_id GROUP BY sic.sale_item_id) pkg '+
   'ON pkg.sale_item_id=si.id '+
   'WHERE s.status=$2 AND s.sold_at>=$3 AND s.sold_at<$4 '+
   'AND s.branch_id IN ('+branchClause+') '+
   'GROUP BY s.branch_id,'+day,params);
 const costs=new Map();merge(rows.rows,costs,new Set(ids));
 return costs;
}
module.exports={live,legacy};
