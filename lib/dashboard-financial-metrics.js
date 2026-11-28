'use strict';
/*
 * The dashboard now shows three deliberately distinct figures:
 * - Revenue after sold-ingredient cost (sale-time recipe snapshots)
 * - Today's sales after that day's entered operating expenses
 * - Total Store Expenses = ingredient cost + entered expense-ledger total.
 *
 * Per product requirements, "Deposited Sales" displays the entered
 * expense-ledger amount. It is NOT an actual bank deposit or reconciled cash.
 *
 * All reads are date-bounded and tenant/branch scoped by their caller.
 * Never treat a deposit estimate as evidence of a real bank deposit.
 */
const money=x=>Math.round((Number(x)||0)*100)/100;

async function liveIngredientCost(db,workspaceId,branchIds,startUtc,endUtc,cashierUserId=null){
 if(!branchIds.length)return 0;
 const ids=branchIds.map(Number);
 const marks=ids.map((_,i)=>'$'+(i+2)).join(',');
 const status='$'+(ids.length+2),from='$'+(ids.length+3),to='$'+(ids.length+4);
 let where='s.workspace_id=$1 AND s.branch_id IN ('+marks+') '+
  'AND s.status='+status+' AND s.sold_at >= '+from+' AND s.sold_at < '+to;
 const args=[workspaceId,...ids,'Sold',startUtc,endUtc];
 if(cashierUserId!=null){args.push(Number(cashierUserId));where+=' AND s.cashier_user_id=$'+args.length;}
 const [components,legacyItems]=await Promise.all([
  db.query('SELECT COALESCE(SUM(c.total_cost),0) AS total '+
   'FROM branch_sale_cost_components c JOIN branch_live_sales s ON s.id=c.sale_id '+
   'AND s.workspace_id=c.workspace_id AND s.branch_id=c.branch_id WHERE '+where+
   ' AND c.workspace_id=$1 AND c.branch_id IN ('+marks+')',args),
  // Some older isolated receipts have unit-cost snapshots but no detailed
  // recipe components. Count their item costs once, never in addition to the
  // same sale's recipe-component snapshots.
  db.query('SELECT COALESCE(SUM(i.quantity*i.unit_cost_snapshot),0) AS total '+
   'FROM branch_live_sale_items i JOIN branch_live_sales s ON s.id=i.sale_id '+
   'AND s.workspace_id=i.workspace_id AND s.branch_id=i.branch_id WHERE '+where+
   ' AND i.workspace_id=$1 AND i.branch_id IN ('+marks+') '+
   'AND NOT EXISTS (SELECT 1 FROM branch_sale_cost_components c '+
   'WHERE c.workspace_id=s.workspace_id AND c.branch_id=s.branch_id AND c.sale_id=s.id)',args)
 ]);
 return money(Number(components.rows[0]?.total||0)+Number(legacyItems.rows[0]?.total||0));
}

async function legacyIngredientCost(db,workspaceId,branchId,startUtc,endUtc){
 const args=[workspaceId,startUtc,endUtc,'Sold'];
 const branch=branchId==null?'':(' AND s.branch_id=$'+(args.push(Number(branchId))));
 // The legacy sale schema has no immutable ingredient cost snapshots.
 // Apply the same recipe cost basis as salesReport/productUnitCosts, but
 // explicitly flag it as a CURRENT RECIPE ESTIMATE in the response.
 const result=await db.query(
  'SELECT COALESCE(SUM(CASE WHEN si.is_package THEN COALESCE(pkg.item_cost,0) '+
   'ELSE COALESCE(base.unit_cost,0)*si.quantity END),0) AS total '+
  'FROM sales s JOIN sale_items si ON si.sale_id=s.id '+
  'LEFT JOIN (SELECT pi.product_id,COALESCE(SUM(pi.cost_contribution),0) AS unit_cost '+
   'FROM product_ingredients pi GROUP BY pi.product_id) base ON base.product_id=si.product_id '+
  'LEFT JOIN (SELECT sic.sale_item_id,COALESCE(SUM(sic.quantity*COALESCE(recipe.unit_cost,0)),0) AS item_cost '+
   'FROM sale_item_components sic LEFT JOIN ('+
    'SELECT pi.product_id,COALESCE(SUM(pi.cost_contribution),0) AS unit_cost '+
    'FROM product_ingredients pi GROUP BY pi.product_id'+
   ') recipe ON recipe.product_id=sic.product_id GROUP BY sic.sale_item_id) pkg ON pkg.sale_item_id=si.id '+
  'WHERE s.status=$4 AND s.sold_at >= $2 AND s.sold_at < $3 '+
   'AND EXISTS (SELECT 1 FROM chat_workspace_branches wb '+
   'WHERE wb.workspace_id=$1 AND wb.branch_id=s.branch_id)'+branch,args);
 return money(result.rows[0]?.total);
}

const available=n=>n!=null&&Number.isFinite(Number(n));
const revenueAfterCost=(netSales,ingredientCost)=>available(netSales)&&available(ingredientCost)?
 money(Number(netSales)-Number(ingredientCost)):null;
const salesAfterExpenses=(netSales,enteredExpenses)=>available(netSales)&&available(enteredExpenses)?
 money(Number(netSales)-Number(enteredExpenses)):null;
const totalStoreExpenses=(ingredientCost,enteredExpenses)=>
 available(ingredientCost)&&available(enteredExpenses)?
 money(Number(ingredientCost)+Number(enteredExpenses)):null;
// Keep the historical formula available to other callers, but do not use
// this difference for the new dashboard Deposited Sales card.
const depositedSales=salesAfterExpenses;

module.exports={liveIngredientCost,legacyIngredientCost,revenueAfterCost,salesAfterExpenses,
 totalStoreExpenses,depositedSales};
