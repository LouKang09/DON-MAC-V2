'use strict';
const cashierScope=require('./report-cashier-scope');
// PDF and annual CSV downloads for the isolated commercial POS.
// Every query reads only branch_live_* tables with server-derived workspace + branch scope.
// This module intentionally DOES NOT fall back to legacy globally shared sales tables.
const scope=require('./franchise-live-scope');
const cashierAccess=require('./cashier-access');
const historical=require('./historical-sales-access');
const {makePdf,salesReportLines,costingReportLines}=require('./pdf');
const financialMetrics=require('./dashboard-financial-metrics');
const reportFinancialPrivacy=require('./report-financial-privacy');

const error=(message,status=400)=>Object.assign(new Error(message),{status});
const today=()=>historical.today();
const validDate=value=>{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const [year,month,day]=value.split('-').map(Number);
 const parsed=new Date(Date.UTC(year,month-1,day));
 return parsed.getUTCFullYear()===year&&parsed.getUTCMonth()===month-1&&parsed.getUTCDate()===day;
};
const addDays=(str,days)=>{
 const [year,month,day]=str.split('-').map(Number);
 return new Date(Date.UTC(year,month-1,day+days)).toISOString().slice(0,10);
};
const currency=n=>Math.round((Number(n)||0)*100)/100;
const numeric=n=>Number.isFinite(Number(n))?Number(n):0;
const str=value=>String(value??'');
const keyName=value=>str(value).trim().toLocaleLowerCase('en');
function periodBounds(query){
 const period=str(query.get('period')||'daily').toLowerCase();
 if(!['daily','weekly','monthly','yearly'].includes(period))
  throw error('Choose a valid daily, weekly, monthly or yearly report.');
 const target=str(query.get('date')||today());
 if(!validDate(target))throw error('Choose a valid report date.');
 let from=target,to;
 if(period==='weekly'){
  const day=new Date(target+'T00:00:00Z').getUTCDay();
  from=addDays(target,-day); // Retain the existing POS Sunday-to-Saturday weekly convention.
  to=addDays(from,7);
 }else if(period==='monthly'){
  from=target.slice(0,7)+'-01';
  const [y,m]=target.split('-').map(Number);
  to=new Date(Date.UTC(y,m,1)).toISOString().slice(0,10);
 }else if(period==='yearly'){
  from=target.slice(0,4)+'-01-01';
  to=(Number(target.slice(0,4))+1)+'-01-01';
 }else to=addDays(from,1);
 return{period,target,from,to};
}
function parseCashiers(query){
 const raw=query.get('cashiers');
 let names=[];
 if(raw){
  try{names=JSON.parse(raw);}catch{throw error('Invalid cashier selection.');}
  if(!Array.isArray(names)||names.length>200||names.some(x=>typeof x!=='string'||!x.trim()||x.length>80))
   throw error('Choose up to 200 valid cashiers.');
 }else if(query.get('cashier'))names=[query.get('cashier')];
 return[...new Set(names.map(keyName))];
}
async function reportScope(db,ctx,user,query,{dashboardPrint=false}={}){
 scope.requirePaid(ctx);
 const grants=ctx.admin?[...cashierAccess.KEYS]:await cashierAccess.forUser(db,{id:user.id,role:'User'});
 if(!ctx.admin&&!grants.includes('reports.view')&&!(dashboardPrint&&grants.includes('dashboard.view')))
  throw error('Sales Report access has not been granted by your Owner.',403);
 let {period,target,from,to}=periodBounds(query);
 let branch=null;
 const requestedBranch=query.get('branchId');
 if(!ctx.admin||requestedBranch&&requestedBranch!=='all'){
  const selected=ctx.admin?scope.goodId(requestedBranch):ctx.branchId;
  if(!selected)throw error('Choose a valid branch.');
  branch=await scope.branch(db,ctx,selected);
 }
 // A cashier with reports.view can see the assigned branch report, as in the live UI.
 // Never accept a client-selected cross-branch ID for a cashier.
 const selectedCashiers=ctx.admin?cashierScope.parse(query):[];
 const cashierIds=await cashierScope.resolve(db,{...ctx,userId:user.id},selectedCashiers);
 // Respect both the subscription's online history window and cashier access limits.
 const cutoff=ctx.admin?(await historical.policy(db,user)).cutoffDate:
   addDays(today(),1-cashierAccess.windowDays(grants));
 if(to<=cutoff)throw error('This period is outside your online report history. Use the Historical Sales CSV export.',403);
 if(from<cutoff)from=cutoff;
 const tomorrow=addDays(today(),1);if(to>tomorrow)to=tomorrow;
 if(!ctx.admin){
  if(({daily:1,weekly:7,monthly:30}[period]||Infinity)>cashierAccess.windowDays(grants))throw error('This report exceeds your Owner-approved history limit.',403);
  if(target!==today())throw error('Cashier report dates are restricted to today.',403);
 }
 if(target>today())throw error('Future report dates cannot be exported.');
 if(from>=to)throw error('This period is outside your online report history.',403);
 return{ctx,period,target,from,to,start:historical.start(from),end:historical.start(to),
  branch,cashiers:selectedCashiers,cashierUserId:ctx.admin?null:user.id,cashierIds};
}
function criteria(record,{ctx,start,end,branch,cashierIds}){
 const args=[ctx.workspaceId,start,end];
 let sql=record+'.workspace_id=$1 AND '+record+'.sold_at >= $2 AND '+record+'.sold_at < $3'+
  ' AND EXISTS (SELECT 1 FROM chat_workspace_branches wm WHERE wm.workspace_id=$1 AND wm.branch_id='+record+'.branch_id)';
 if(branch){args.push(branch.id);sql+=' AND '+record+'.branch_id=$'+args.length;}
 sql+=cashierScope.clause(record+'.cashier_user_id',args,cashierIds);
 return{sql,args};
}
const pdfName=(type,selection)=>{
 const branch=selection.branch?'_Branch_'+selection.branch.id:'_All_Branches';
 return'DonMac_'+type+'_'+selection.period+'_'+selection.target+branch+'.pdf';
};
async function pdfReport(db,ctx,user,query,type,options={}){
 if(!['sales','costing'].includes(type))throw error('Unknown report format.');
 if(type==='costing'&&!ctx.admin)throw error('Ingredient costing downloads are Owner/Admin-only.',403);
 const selection=await reportScope(db,ctx,user,query,options);
 const {sql,args}=criteria('s',selection);
 const filter=' WHERE '+sql;
 const summaryRow=(await db.query(
  'SELECT COUNT(*) AS all_count,'+
  "SUM(CASE WHEN s.status='Sold' THEN 1 ELSE 0 END) AS sold_count,"+
  "COALESCE(SUM(CASE WHEN s.status='Sold' THEN s.gross ELSE 0 END),0) AS gross,"+
  "COALESCE(SUM(CASE WHEN s.status='Sold' THEN s.adjustment ELSE 0 END),0) AS adjustment,"+
  "COALESCE(SUM(CASE WHEN s.status='Sold' THEN s.actual ELSE 0 END),0) AS actual "+
  'FROM branch_live_sales s'+filter,args)).rows[0]||{};
 const soldFilter=filter+" AND s.status='Sold'";
 const [productsResult,promosResult]=await Promise.all([
  db.query('SELECT i.name_snapshot AS name, i.kind, SUM(i.quantity) AS qty,'+
   'COALESCE(SUM(i.line_total),0) AS gross,'+
   'COALESCE(SUM(i.unit_cost_snapshot*i.quantity),0) AS costing '+
   'FROM branch_live_sale_items i JOIN branch_live_sales s '+
   'ON s.id=i.sale_id AND s.workspace_id=i.workspace_id AND s.branch_id=i.branch_id '+
   soldFilter+' GROUP BY i.name_snapshot,i.kind ORDER BY gross DESC LIMIT 1000',args),
  db.query('SELECT p.promo_name_snapshot AS name,COUNT(*) AS qty,'+
   'COALESCE(SUM(p.gross),0) AS gross,COALESCE(SUM(p.adjustment),0) AS adjustment,'+
   'COALESCE(SUM(p.actual),0) AS actual FROM branch_live_sale_promos p '+
   'JOIN branch_live_sales s ON s.id=p.sale_id AND s.workspace_id=p.workspace_id '+
   'AND s.branch_id=p.branch_id '+soldFilter+
   ' GROUP BY p.promo_name_snapshot ORDER BY qty DESC LIMIT 500',args)
 ]);
 const salesTotal=numeric(summaryRow.actual),itemGross=productsResult.rows.reduce((n,x)=>n+numeric(x.gross),0);
 const ratio=itemGross>0?salesTotal/itemGross:1;
 const products=productsResult.rows.map(x=>{
  const gross=numeric(x.gross),actual=currency(gross*ratio),costing=currency(x.costing);
  return{name:x.name,qty:numeric(x.qty),gross,adjusted:currency(actual-gross),
   actual,costing,net:currency(actual-costing)};
 });
 const branchName=selection.branch?.name||'All branches';
 let lines;
 if(type==='sales'){
  const transactions=(await db.query(
   'SELECT s.reference,s.cashier_name_snapshot AS cashier,s.status,s.sold_at AS "soldAt",'+
   's.actual,s.remark FROM branch_live_sales s'+filter+
   ' ORDER BY s.sold_at DESC,s.id DESC LIMIT 5001',args)).rows;
  if(transactions.length>5000)throw error('This report contains over 5,000 transactions. Narrow the date or branch and try again.',413);
  const reportBranchIds=selection.branch?[selection.branch.id]:
   (await db.query('SELECT branch_id FROM chat_workspace_branches WHERE workspace_id=$1',
    [ctx.workspaceId])).rows.map(x=>Number(x.branch_id));
  const [inStoreExpenses,deposited]=await Promise.all([
   financialMetrics.liveIngredientCost(db,ctx.workspaceId,reportBranchIds,
    selection.start,selection.end,selection.cashierIds),
   reportFinancialPrivacy.depositedAmount(db,{
    workspaceId:ctx.workspaceId,branchId:selection.branch?.id??null,
    from:selection.from,to:selection.to,cashierUserId:selection.cashierIds
   })
  ]);
  const report={period:selection.period,target:selection.target,
   inStoreExpenses,depositedAmount:deposited?.amount??null,
   cashier:ctx.admin?(selection.cashiers.length?selection.cashiers.join(', '):'ALL'):user.username,
   transactionCount:numeric(summaryRow.sold_count),
   deletedCount:numeric(summaryRow.all_count)-numeric(summaryRow.sold_count),
   gross:currency(summaryRow.gross),adjustment:currency(summaryRow.adjustment),actual:currency(summaryRow.actual),
   products,promos:promosResult.rows.map(x=>({name:x.name,qty:numeric(x.qty),gross:numeric(x.gross),
    adjustment:numeric(x.adjustment),actual:numeric(x.actual)})),
   transactions:transactions.map(x=>({...x,actual:numeric(x.actual)}))};
  lines=salesReportLines(report,'Don Macchiatos - '+branchName+' - Sales Report',{
   includeCosting:ctx.admin,includeTransactions:ctx.admin
  });
  if(ctx.admin)lines.push({text:''},{text:'Product-level net sales are proportionally allocated from recorded order totals.'});
  lines.push({text:'Recorded sale gross/adjustment/actual above are authoritative. Report source: isolated live sales.'});
 }else{
  const [componentResult,olderResult]=await Promise.all([
   db.query('SELECT c.ingredient_id,c.ingredient_name,c.uom,c.product_name,'+
    'SUM(c.product_qty) AS product_qty,SUM(c.usage_qty) AS usage_qty,'+
    'SUM(c.total_cost) AS total_cost FROM branch_sale_cost_components c '+
    'JOIN branch_live_sales s ON s.id=c.sale_id AND s.workspace_id=c.workspace_id '+
    'AND s.branch_id=c.branch_id '+soldFilter+
    ' GROUP BY c.ingredient_id,c.ingredient_name,c.uom,c.product_name '+
    'ORDER BY c.ingredient_name,c.product_name LIMIT 2500',args),
   db.query('SELECT i.name_snapshot,SUM(i.quantity) AS qty,'+
    'SUM(i.unit_cost_snapshot*i.quantity) AS total_cost FROM branch_live_sale_items i '+
    'JOIN branch_live_sales s ON s.id=i.sale_id AND s.workspace_id=i.workspace_id '+
    'AND s.branch_id=i.branch_id '+soldFilter+
    ' AND NOT EXISTS (SELECT 1 FROM branch_sale_cost_components c WHERE c.sale_id=i.sale_id '+
    'AND c.workspace_id=i.workspace_id AND c.branch_id=i.branch_id) '+
    'GROUP BY i.name_snapshot ORDER BY i.name_snapshot LIMIT 2500',args)
  ]);
  const groups=new Map();
  for(const x of componentResult.rows){
   const key=x.ingredient_id+'|'+x.ingredient_name+'|'+x.uom;
   if(!groups.has(key))groups.set(key,{name:x.ingredient_name,uom:x.uom,totalQty:0,totalCost:0,details:[]});
   const g=groups.get(key),productQty=numeric(x.product_qty),totalCost=numeric(x.total_cost);
   g.totalQty+=numeric(x.usage_qty);
   g.totalCost+=totalCost;
   g.details.push({product:x.product_name,productQty,usageQty:numeric(x.usage_qty),
    costPerItem:productQty?totalCost/productQty:0,totalCost});
  }
  const older=olderResult.rows.filter(x=>Math.abs(numeric(x.total_cost))>0.001);
  if(older.length){
   const subtotal=older.reduce((n,x)=>n+numeric(x.total_cost),0);
   groups.set('legacy-unallocated',{name:'Older sale cost - ingredient details unavailable',
    uom:'N/A',totalQty:0,totalCost:subtotal,
    details:older.map(x=>({product:x.name_snapshot,productQty:numeric(x.qty),
     usageQty:0,costPerItem:numeric(x.qty)?numeric(x.total_cost)/numeric(x.qty):0,
     totalCost:numeric(x.total_cost)}))});
  }
  const ingredients=[...groups.values()].map(g=>({...g,totalQty:numeric(g.totalQty.toFixed(6)),
   totalCost:currency(g.totalCost)}));
  const report={period:selection.period,target:selection.target,
   cashier:selection.cashiers.length?selection.cashiers.join(', '):'ALL',
   totalCost:currency(ingredients.reduce((n,g)=>n+g.totalCost,0)),ingredients};
  lines=costingReportLines(report,'Don Macchiatos - '+branchName+' - Costing Report');
  lines.push({text:''},{text:'Costing basis: stored sale-time recipe costs, never live/current ingredient prices.'});
  if(older.length)lines.push({text:'Older sales without component snapshots show recorded total costs only.'});
 }
 const title='Don Macchiatos '+(type==='sales'?'Sales':'Costing')+' Report';
 return{buffer:makePdf(lines,{title}),filename:pdfName(type,selection)};
}
async function historyPolicy(db,ctx,user){
 scope.requireAdmin(ctx);
 const policy=await historical.policy(db,user);
 if(policy.workspaceId!==ctx.workspaceId)throw error('Incorrect franchise workspace.',403);
 return policy;
}
function csv(value,numericCell=false){
 let v=str(value).replace(/\u0000/g,'');
 if(!numericCell&&/^\s*[=+@-]/.test(v))v="'"+v;
 return'"'+v.replace(/"/g,'""')+'"';
}
async function historyCsv(db,ctx,user,query){
 await historyPolicy(db,ctx,user);
 const yr=str(query.get('year')||'');
 if(!/^\d{4}$/.test(yr)||Number(yr)<2000||Number(yr)>Number(today().slice(0,4)))
  throw error('Choose a valid year to export.');
 const requested=str(query.get('branchId')||'all');
 let branch=null;
 if(requested!=='all'){
  const id=scope.goodId(requested);
  if(!id)throw error('Choose a valid branch.');
  const membership=(await db.query('SELECT b.name FROM chat_workspace_branches w '+
   'JOIN branches b ON b.id=w.branch_id WHERE w.workspace_id=$1 AND w.branch_id=$2',
   [ctx.workspaceId,id])).rows;
  if(membership.length!==1)throw error('Branch is outside your franchise workspace.',403);
  branch={id,name:membership[0].name};
 }
 const start=historical.start(yr+'-01-01');
 const end=historical.start((Number(yr)+1)+'-01-01');
 const args=[ctx.workspaceId,start,end];
 let filter='WHERE s.workspace_id=$1 AND s.sold_at >= $2 AND s.sold_at < $3 '+
  'AND EXISTS (SELECT 1 FROM chat_workspace_branches w '+
  'WHERE w.workspace_id=s.workspace_id AND w.branch_id=s.branch_id)';
 if(branch){args.push(branch.id);filter+=' AND s.branch_id=$4';}
 const records=(await db.query('SELECT s.reference,s.sold_at,s.status,s.payment_mode,'+
  's.payment_reference,s.cashier_name_snapshot,s.customer_name,s.order_type,'+
  's.gross,s.adjustment,s.actual,s.discount_amount,b.name AS branch_name,'+
  'i.name_snapshot AS item_name,i.quantity,i.unit_price,i.line_total '+
  'FROM branch_live_sales s JOIN branches b ON b.id=s.branch_id '+
  'LEFT JOIN branch_live_sale_items i ON i.sale_id=s.id AND i.workspace_id=s.workspace_id '+
  'AND i.branch_id=s.branch_id '+filter+
  ' ORDER BY s.sold_at,s.id,i.id LIMIT 75001',args)).rows;
 if(records.length>75000)throw error('Export exceeds 75,000 lines. Use a shorter scope or request a bulk export.',413);
 const fmt=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',
  month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 const headings=['reference','sold_at_ph','branch','status','payment_mode','payment_reference',
  'cashier','customer','order_type','gross','adjustment','net','discount','item','quantity','unit_price','line_total'];
 const lines=[headings.join(',')];
 for(const row of records){
  const values=[row.reference,row.sold_at?fmt.format(new Date(row.sold_at)):'',
   row.branch_name,row.status,row.payment_mode,row.payment_reference,row.cashier_name_snapshot,
   row.customer_name,row.order_type,row.gross,row.adjustment,row.actual,row.discount_amount,
   row.item_name,row.quantity,row.unit_price,row.line_total];
  lines.push(values.map((v,i)=>csv(v,[9,10,11,12,14,15,16].includes(i))).join(','));
 }
 const buffer=Buffer.from('\uFEFF'+lines.join('\r\n')+'\r\n');
 if(buffer.length>50*1024*1024)throw error('Export exceeds 50 MB. Narrow the year or branch.',413);
 return{buffer,filename:'DonMac_Live_Sales_'+yr+(branch?'_Branch_'+branch.id:'_All_Branches')+'.csv'};
}
module.exports={periodBounds,reportScope,pdfReport,historyPolicy,historyCsv};
