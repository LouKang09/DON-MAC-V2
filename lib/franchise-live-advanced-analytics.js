'use strict';
/* Advanced Analytics read model for production-isolated franchises.
 * Aggregation is maintained in parity with the legacy analytics UI but all
 * upstream SQL reads use the authenticated workspace ID and assigned branches.
 * Admin/paid Business checks are always enforced server-side. */
const {localDay,addDays,monthList}=require('./advanced-analytics');
const scope=require('./franchise-live-scope');
const branchPlans=require('./franchise-branch-plans');
const round=n=>Math.round((Number(n)||0)*100)/100;
const CATEGORIES=['rent','stocks','salary','transportation','electricity','ice','water','misc'];
async function read(db,ctx,params={}){
 scope.requireAdmin(ctx);scope.requirePaid(ctx);
 const record=await branchPlans.planRecord(db,ctx.workspaceId);
 if(record?.plan!=='BUSINESS'||record?.status!=='PAID')
  throw scope.fail('Advanced Analytics requires a paid Business subscription.',403);
 const workspaceId=ctx.workspaceId;
 const branches=(await scope.branches(db,ctx)).filter(b=>b.active!==false)
  .map(b=>({id:Number(b.id),name:String(b.name)}));
 const branchId=params.branchId==null||params.branchId===''||params.branchId==='all'?
  null:Number(params.branchId);
 if(branchId!=null&&(!Number.isSafeInteger(branchId)||!branches.some(b=>b.id===branchId)))
  throw scope.fail('Select a branch belonging to your franchise.',403);
 const days=[7,30,90].includes(Number(params.days))?Number(params.days):30;
 const today=localDay(new Date()),start=addDays(today,1-days);
 const previousStart=addDays(start,-days),end=addDays(today,1);
 const months=monthList(today),historyStart=months[0]+'-01';
 const utc=d=>new Date(d+'T00:00:00+08:00').toISOString();
 const startUTC=utc(start),endUTC=utc(end),previousUTC=utc(previousStart),
  historyUTC=utc(historyStart);
 const branchPredicate=branchId==null?'':' AND s.branch_id=$4';
 const sArgs=[workspaceId,historyUTC,endUTC,...(branchId==null?[]:[branchId])];
 const itemArgs=[workspaceId,startUTC,endUTC,...(branchId==null?[]:[branchId])];
 const expensePredicate=branchId==null?'':' AND e.branch_id=$4';
 const movePredicate=branchId==null?'':' AND m.branch_id=$4';
 // Sales history must be sufficient for both period comparison and 12
 // month trends. Server-side membership is the only branch authorization.
 const [salesR,itemsR,expenseRaw,movementR,stockR]=await Promise.all([
  db.query('SELECT s.id,s.branch_id,s.sold_at,s.status,s.actual,s.gross,s.discount_amount,'+
   's.payment_mode,s.order_type,s.customer_name,s.cashier_name_snapshot,s.cashier_user_id '+
   'FROM branch_live_sales s WHERE s.workspace_id=$1 AND s.sold_at>=$2 AND s.sold_at<$3'+
   branchPredicate+' ORDER BY s.sold_at DESC,s.id DESC LIMIT 50001',sArgs),
  db.query('SELECT i.name_snapshot AS product_name_snapshot,i.quantity,i.line_total,i.branch_id,'+
   "CASE WHEN i.kind='addon' THEN TRUE ELSE FALSE END AS is_add_on,"+
   "CASE WHEN i.kind='package' THEN TRUE ELSE FALSE END AS is_package,"+
   "CASE WHEN i.kind='product' THEN i.item_id END AS product_id,"+
   "CASE WHEN i.kind='addon' THEN i.item_id END AS add_on_id,"+
   "CASE WHEN i.kind='package' THEN i.item_id END AS package_id "+
   'FROM branch_live_sale_items i JOIN branch_live_sales s '+
   'ON s.id=i.sale_id AND s.workspace_id=i.workspace_id AND s.branch_id=i.branch_id '+
   "WHERE s.workspace_id=$1 AND s.status='Sold' AND s.sold_at>=$2 AND s.sold_at<$3"+
   (branchId==null?'':' AND s.branch_id=$4')+
   ' ORDER BY s.sold_at DESC,i.id DESC LIMIT 40001',itemArgs),
  db.query('SELECT e.branch_id,e.category,e.amount,e.incurred_at '+
   'FROM branch_live_expenses e WHERE e.workspace_id=$1 AND e.incurred_at>=$2 '+
   'AND e.incurred_at<$3'+expensePredicate+
   ' ORDER BY e.incurred_at DESC,e.id DESC LIMIT 12001',
   [workspaceId,historyUTC,endUTC,...(branchId==null?[]:[branchId])]),
  db.query('SELECT m.reference,m.movement_type,m.quantity_change,m.created_at,'+
   'b.name AS branch,i.display_name AS ingredient,i.uom '+
   'FROM branch_inventory_movements m JOIN branches b ON b.id=m.branch_id '+
   'JOIN branch_ingredients i ON i.id=m.ingredient_id AND i.workspace_id=m.workspace_id '+
   'AND i.branch_id=m.branch_id WHERE m.workspace_id=$1 '+
   'AND m.created_at>=$2 AND m.created_at<$3'+movePredicate+
   ' ORDER BY m.created_at DESC,m.id DESC LIMIT 10001',
   [workspaceId,startUTC,endUTC,...(branchId==null?[]:[branchId])]),
  db.query('SELECT i.branch_id,i.display_name,i.stock_qty,i.low_stock_threshold,i.uom '+
   'FROM branch_ingredients i WHERE i.workspace_id=$1 AND i.active=$2 '+
   'AND i.stock_qty<=i.low_stock_threshold'+
   (branchId==null?'':' AND i.branch_id=$3')+
   ' ORDER BY i.stock_qty,i.display_name LIMIT 501',
   [workspaceId,true,...(branchId==null?[]:[branchId])])
 ]);
 // Normalize category expense rows to legacy daily input columns so all
 // downstream calculations operate on exactly the same real record types.
 const expenseR={rows:expenseRaw.rows.map(e=>{
  const values=Object.fromEntries(CATEGORIES.map(k=>[k,0]));
  const name=String(e.category||'').toLowerCase();
  values[CATEGORIES.includes(name)?name:'misc']=Number(e.amount||0);
  return{branch_id:e.branch_id,expense_date:localDay(e.incurred_at),...values};
 })};
 const partial=salesR.rows.length>50000||itemsR.rows.length>40000||
   expenseR.rows.length>12000||movementR.rows.length>10000||stockR.rows.length>500;
 const sales=salesR.rows.slice(0,50000),items=itemsR.rows.slice(0,40000),
  expenses=expenseR.rows.slice(0,12000),movements=movementR.rows.slice(0,10000);
 const names=new Map(branches.map(b=>[b.id,b.name]));
 const monthMap=new Map(months.map(month=>[month,{month,net:0,gross:0,discount:0,expenses:0,orders:0}]));
 // Monthly branch series use the same authenticated workspace-scoped sales
 // rows as the combined monthly chart; never allocate the total by ratios.
 const branchMonthMap=new Map(branches.filter(b=>branchId==null||b.id===branchId).map(b=>[
  b.id,new Map(months.map(month=>[month,{month,net:0,gross:0,discount:0,orders:0}]))
 ]));
 const dailyMap=new Map(Array.from({length:days},(_,i)=>{const day=addDays(start,i);return[day,{day,net:0,gross:0,discount:0,expenses:0,orders:0,voided:0}]}));
 const branchMap=new Map(branches.filter(b=>branchId==null||b.id===branchId).map(b=>[b.id,{
  id:b.id,name:b.name,net:0,gross:0,orders:0,discount:0,expenses:0,voided:0
 }]));
 const paymentMap=new Map(),typeMap=new Map(),staffMap=new Map(),customerMap=new Map();
 const summary={net:0,gross:0,discount:0,orders:0,voided:0,expenses:0,
  previousNet:0,previousOrders:0,avgTicket:0,operatingBalance:0,recordedCustomers:0,repeatCustomers:0,
  namedOrders:0,cashierCount:0,itemUnits:0,stockAlertCount:0};
 for(const x of sales){
  const day=localDay(x.sold_at),month=day.slice(0,7),status=String(x.status||'');
  const inCurrent=day>=start&&day<=today,prior=day>=previousStart&&day<start;
  const row=branchMap.get(Number(x.branch_id));
  if(status==='Sold'){
   const net=Number(x.actual||0),gross=Number(x.gross||0),discount=Number(x.discount_amount||0);
   const m=monthMap.get(month);
   if(m){m.net+=net;m.gross+=gross;m.discount+=discount;m.orders++;}
   const bm=branchMonthMap.get(Number(x.branch_id))?.get(month);
   if(bm){bm.net+=net;bm.gross+=gross;bm.discount+=discount;bm.orders++;}
   if(prior){summary.previousNet+=net;summary.previousOrders++;}
   if(!inCurrent)continue;
   summary.net+=net;summary.gross+=gross;summary.discount+=discount;summary.orders++;
   const d=dailyMap.get(day);if(d){d.net+=net;d.gross+=gross;d.discount+=discount;d.orders++;}
   if(row){row.net+=net;row.gross+=gross;row.discount+=discount;row.orders++;}
   const payment=String(x.payment_mode||'Other');
   const pm=paymentMap.get(payment)||{name:payment,amount:0,orders:0};
   pm.amount+=net;pm.orders++;paymentMap.set(payment,pm);
   const type=String(x.order_type||'Unspecified');
   const order=typeMap.get(type)||{name:type,amount:0,orders:0};
   order.amount+=net;order.orders++;typeMap.set(type,order);
   const cashierId=Number(x.cashier_user_id||0),cashierName=String(x.cashier_name_snapshot||'').trim();
   const cashier=cashierName||(cashierId?'Cashier #'+cashierId:'Unattributed sales');
   const cashierKey=cashierId?'id:'+cashierId:'branch:'+x.branch_id+':'+cashier.toLocaleLowerCase('en-PH');
   const staff=staffMap.get(cashierKey)||{name:cashier,branch:names.get(Number(x.branch_id))||'Branch',
    net:0,orders:0,identified:!!cashierId||!!cashierName};
   staff.net+=net;staff.orders++;staffMap.set(cashierKey,staff);
   const customer=String(x.customer_name||'').trim();
   if(customer){
    const key=customer.toLocaleLowerCase('en-PH');
    const record=customerMap.get(key)||{name:customer,net:0,orders:0};
    record.net+=net;record.orders++;customerMap.set(key,record);
   }
  }else if(inCurrent&&['Deleted','Void','Voided','Cancelled','Canceled'].includes(status)){
   summary.voided++;const d=dailyMap.get(day);if(d)d.voided++;if(row)row.voided++;
  }
 }
 const expensesByCategory=Object.fromEntries(CATEGORIES.map(c=>[c,0]));
 for(const x of expenses){
  const day=String(x.expense_date||''),value=CATEGORIES.reduce((total,k)=>total+Number(x[k]||0),0);
  const m=monthMap.get(day.slice(0,7));if(m)m.expenses+=value;
  if(day<start||day>today)continue;
  summary.expenses+=value;
  const d=dailyMap.get(day);if(d)d.expenses+=value;
  const row=branchMap.get(Number(x.branch_id));if(row)row.expenses+=value;
  for(const k of CATEGORIES)expensesByCategory[k]+=Number(x[k]||0);
 }
 const products=new Map(),branchProduct=new Map();
 for(const x of items){
  const name=String(x.product_name_snapshot||'Unnamed item');
  const kind=x.is_add_on?'Add-on':x.is_package?'Package':'Menu item';
  const identityId=x.is_add_on?x.add_on_id:x.is_package?x.package_id:x.product_id;
  const key=identityId!=null?kind+':'+identityId:kind+':'+name.toLocaleLowerCase('en-PH');
  const qty=Number(x.quantity||0),amount=Number(x.line_total||0);
  const current=products.get(key)||{name,qty:0,amount:0,kind};
  summary.itemUnits+=qty;
  current.qty+=qty;current.amount+=amount;products.set(key,current);
  const branch=Number(x.branch_id),id=branch+'|'+key;
  const b=branchProduct.get(id)||{branchId:branch,branch:names.get(branch)||'Branch',name,qty:0,amount:0};
  b.qty+=qty;b.amount+=amount;branchProduct.set(id,b);
 }
 const movementSummary={replenish:0,transfer:0,sale:0,other:0};
 for(const x of movements){
  const kind=String(x.movement_type||'').toUpperCase();
  if(kind==='REPLENISH')movementSummary.replenish++;
  else if(kind==='TRANSFER')movementSummary.transfer++;
  else if(kind==='SALE'||kind==='SALE_USAGE')movementSummary.sale++;
  else movementSummary.other++;
 }
 const stockAlerts=stockR.rows.slice(0,12).map(x=>({name:String(x.display_name||'Ingredient'),
    stock:round(x.stock_qty),threshold:round(x.low_stock_threshold),uom:x.uom||''}));
 const allCustomers=[...customerMap.values()].sort((a,b)=>b.net-a.net);
 summary.recordedCustomers=allCustomers.length;
 summary.namedOrders=allCustomers.reduce((total,x)=>total+x.orders,0);
 summary.repeatCustomers=allCustomers.filter(x=>x.orders>1).length;
 summary.cashierCount=[...staffMap.values()].filter(x=>x.identified).length;
 summary.stockAlertCount=stockR.rows.length;
 summary.avgTicket=summary.orders?summary.net/summary.orders:0;
 summary.operatingBalance=summary.net-summary.expenses;
 const alerts=[];
 for(const x of stockAlerts.slice(0,5))alerts.push({title:x.stock<=0?'Out of stock':'Stock attention',location:names.get(Number(x.branch_id))||'Selected branches',
  detail:x.name+': '+x.stock+' '+x.uom+' (threshold '+x.threshold+')'});
 for(const x of branchMap.values())if(!x.orders)alerts.push({title:'No completed sales',location:x.name,
  detail:'No completed orders in the selected '+days+'-day period.'});
 if(summary.voided)alerts.push({title:'Voided transactions',location:'Selected branches',
  detail:summary.voided+' voided or cancelled records in the selected period.'});
 return {
  period:{days,start,end:today,historyStart},branches,selectedBranch:branchId,
  complete:!partial,
  sourceNotes:{stock:'Inventory quantities are isolated by franchise and branch.',
   costs:'Operating balance is net sales minus recorded expense entries; it excludes unrecorded cost of goods and liabilities.',
   customers:'Customer insights use optional names entered at checkout; anonymous transactions cannot be identified.',
   staff:'Cashier performance reflects processed sales; staff shifts, attendance, and wages are not recorded here.'},
  summary:Object.fromEntries(Object.entries(summary).map(([k,v])=>[k,round(v)])),
  months:[...monthMap.values()].map(m=>({...m,net:round(m.net),gross:round(m.gross),discount:round(m.discount),expenses:round(m.expenses)})),
  daily:[...dailyMap.values()].map(d=>({...d,net:round(d.net),gross:round(d.gross),discount:round(d.discount),expenses:round(d.expenses),operatingBalance:round(d.net-d.expenses),avgTicket:round(d.orders?d.net/d.orders:0)})),
  branchMonthly:branches.filter(b=>branchMonthMap.has(b.id)).map(b=>({
   id:b.id,name:b.name,
   months:[...branchMonthMap.get(b.id).values()].map(m=>({
    month:m.month,net:round(m.net),gross:round(m.gross),
    discount:round(m.discount),orders:m.orders
   }))
  })),
  branchesPerformance:[...branchMap.values()].map(b=>({...b,net:round(b.net),gross:round(b.gross),
   expenses:round(b.expenses),discount:round(b.discount)})).sort((a,b)=>b.net-a.net),
  paymentMix:[...paymentMap.values()].map(p=>({...p,amount:round(p.amount)})).sort((a,b)=>b.amount-a.amount),
  orderTypes:[...typeMap.values()].map(p=>({...p,amount:round(p.amount)})).sort((a,b)=>b.amount-a.amount),
  expenseCategories:Object.entries(expensesByCategory).map(([name,amount])=>({name,amount:round(amount)})).sort((a,b)=>b.amount-a.amount),
  topProducts:[...products.values()].map(p=>({...p,qty:round(p.qty),amount:round(p.amount)}))
    .sort((a,b)=>b.amount-a.amount).slice(0,20),
  branchProducts:[...branchProduct.values()].map(p=>({...p,qty:round(p.qty),amount:round(p.amount)}))
    .sort((a,b)=>b.qty-a.qty).slice(0,35),
  namedCustomers:allCustomers.map(c=>({...c,net:round(c.net)})).slice(0,15),
  cashiers:[...staffMap.values()].map(c=>({...c,net:round(c.net)})).sort((a,b)=>b.net-a.net).slice(0,25),
  movements:movements.slice(0,18).map(m=>({reference:m.reference,type:m.movement_type,
   date:m.created_at,ingredient:m.ingredient||'Ingredient',qty:round(Math.abs(m.quantity_change)),uom:m.uom||'',
   destination:m.branch||''})),
  movementSummary,stockAlerts,alerts
 };
}
module.exports={read};
