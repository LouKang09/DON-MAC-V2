'use strict';
// Report totals draw from actual recorded staff deposits, never projected sales.
// Inputs must be server-derived franchise workspace/branch and authorized dates.
const validDay=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&
 !Number.isNaN(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
async function depositedAmount(db,{workspaceId,branchId=null,from,to}){
 if(!Number.isSafeInteger(Number(workspaceId))||Number(workspaceId)<1||!validDay(from)||!validDay(to)||from>=to)
  throw Object.assign(new Error('Invalid authorized report scope.'),{status:400});
 if(branchId!=null&&(!Number.isSafeInteger(Number(branchId))||Number(branchId)<1))
  throw Object.assign(new Error('Invalid authorized report branch.'),{status:400});
 const args=[Number(workspaceId),from,to];
 let branchWhere='';
 if(branchId!=null){args.push(Number(branchId));branchWhere=' AND d.branch_id=$4';}
 const rows=(await db.query(
  'SELECT COUNT(*) AS count,COALESCE(SUM(d.amount_centavos),0) AS total '+
  'FROM franchise_shift_deposits d WHERE d.workspace_id=$1 '+
  'AND d.work_day >= $2 AND d.work_day < $3 '+
  'AND EXISTS(SELECT 1 FROM chat_workspace_branches w '+
  'WHERE w.workspace_id=d.workspace_id AND w.branch_id=d.branch_id)'+branchWhere,args)).rows;
 const count=Number(rows[0]?.count||0);
 return{amount:count?Math.round(Number(rows[0]?.total||0))/100:null,count};
}
const publicProduct=product=>{
 const {costing,net,costPerItem,unitCost,recipeCost,...visible}=product;
 return visible;
};
const staffReport=report=>({
 ...report,products:(report.products||[]).map(publicProduct),
 transactions:[],grossProfit:undefined,deletedCount:undefined
});
module.exports={depositedAmount,publicProduct,staffReport};
