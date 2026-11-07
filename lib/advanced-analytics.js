'use strict';
// Business-only read model. Every transaction, expense, and movement is scoped
// to the authenticated franchise workspace. No fictional metrics or estimates.
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const round=n=>Math.round((Number(n)||0)*100)/100;
const dateFormatter=new Intl.DateTimeFormat('en-CA',{
 timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'
});
function localDay(value){
 const parts=dateFormatter.formatToParts(new Date(value));
 const p=k=>parts.find(x=>x.type===k)?.value;
 return p('year')+'-'+p('month')+'-'+p('day');
}
function addDays(value,days){
 const d=new Date(value+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+days);
 return d.toISOString().slice(0,10);
}
function monthList(today){
 const y=Number(today.slice(0,4)),m=Number(today.slice(5,7));
 return Array.from({length:12},(_,i)=>{
  const d=new Date(Date.UTC(y,m-12+i,1));
  return d.toISOString().slice(0,7);
 });
}
const CATEGORIES=['rent','stocks','salary','transportation','electricity','ice','water','misc'];
async function read(db,user,params={}){
 if(user?.role!=='Admin')throw fail('Business analytics is available to the Owner and Co-Owners.',403);
 const wsResult=await db.query('SELECT workspace_id FROM chat_memberships WHERE user_id=$1 ORDER BY workspace_id LIMIT 1',[user.id]);
 const workspaceId=Number(wsResult.rows[0]?.workspace_id||0);
 if(!workspaceId)throw fail('Franchise workspace not found.',403);
 const planR=await db.query('SELECT plan,status FROM platform_account_plans WHERE workspace_id=$1',[workspaceId]);
 if(planR.rows[0]?.plan!=='BUSINESS'||planR.rows[0]?.status!=='PAID')
  throw fail('Advanced Analytics requires an active Business subscription approved by Admin Control.',403);
 const branchesR=await db.query('SELECT b.id,b.name FROM branches b JOIN chat_workspace_branches w ON w.branch_id=b.id WHERE w.workspace_id=$1 ORDER BY b.name',[workspaceId]);
 const branches=branchesR.rows.map(x=>({id:Number(x.id),name:String(x.name)}));
 const branchId=params.branchId==null||params.branchId===''||params.branchId==='all'?null:Number(params.branchId);
 if(branchId!=null&&(!Number.isSafeInteger(branchId)||!branches.some(b=>b.id===branchId)))
  throw fail('Select a branch belonging to your franchise.',403);
 const days=[7,30,90].includes(Number(params.days))?Number(params.days):30;
 const today=localDay(new Date()),start=addDays(today,-days+1),previousStart=addDays(start,-days);
 const end=addDays(today,1),months=monthList(today),historyStart=months[0]+'-01';
 const dayUTC=x=>new Date(x+'T00:00:00+08:00').toISOString();
 const sqlBranch=branchId==null?'':' AND s.branch_id=$4';
 const salesArgs=[workspaceId,dayUTC(historyStart),dayUTC(end),...(branchId==null?[]:[branchId])];
 const itemArgs=[workspaceId,'Sold',dayUTC(start),dayUTC(end),...(branchId==null?[]:[branchId])];
 const expenseArgs=[workspaceId,historyStart,end,...(branchId==null?[]:[branchId])];
 const whereExpense=branchId==null?'':' AND e.branch_id=$4';
 const movementArgs=[workspaceId,dayUTC(start),dayUTC(end)];
 const [salesR,itemsR,expenseR,movementR,stockR]=await Promise.all([
  db.query('SELECT s.id,s.branch_id,s.sold_at,s.status,s.actual,s.gross,s.discount_amount,'+
   's.payment_mode,s.order_type,s.customer_name,s.cashier_name_snapshot '+
   'FROM sales s JOIN chat_workspace_branches w ON w.branch_id=s.branch_id '+
   'WHERE w.workspace_id=$1 AND s.sold_at >= $2 AND s.sold_at < $3'+sqlBranch+
   ' ORDER BY s.sold_at DESC,s.id DESC LIMIT 50001',salesArgs),
  db.query('SELECT si.product_name_snapshot,si.quantity,si.line_total,si.is_add_on,'+
   'si.is_package,s.branch_id FROM sale_items si JOIN sales s ON s.id=si.sale_id '+
   'JOIN chat_workspace_branches w ON w.branch_id=s.branch_id '+
   'WHERE w.workspace_id=$1 AND s.status=$2 AND s.sold_at >= $3 AND s.sold_at < $4'+
   (branchId==null?'':' AND s.branch_id=$5')+
   ' ORDER BY s.sold_at DESC,si.id DESC LIMIT 40001',itemArgs),
  db.query('SELECT e.branch_id,e.expense_date,'+CATEGORIES.map(c=>'e.'+c).join(',')+
   ' FROM pos_expenses e WHERE e.workspace_id=$1 AND e.expense_date >= $2 AND e.expense_date < $3'+
   whereExpense+' ORDER BY e.expense_date DESC LIMIT 12001',expenseArgs),
  db.query('SELECT m.reference,m.movement_type,m.quantity_change,m.created_at,m.branch,'+
   'i.display_name AS ingredient,i.uom FROM inventory_movements m '+
   'JOIN chat_memberships cm ON cm.user_id=m.created_by '+
   'LEFT JOIN ingredients i ON i.id=m.ingredient_id '+
   'WHERE cm.workspace_id=$1 AND m.created_at >= $2 AND m.created_at < $3 '+
   'ORDER BY m.created_at DESC,m.id DESC LIMIT 10001',movementArgs),
  db.query('SELECT display_name,stock_qty,low_stock_threshold,uom FROM ingredients WHERE active=$1 ORDER BY stock_qty,display_name LIMIT 501',[true])
 ]);
 const partial=salesR.rows.length>50000||itemsR.rows.length>40000||
   expenseR.rows.length>12000||movementR.rows.length>10000||stockR.rows.length>500;
 const sales=salesR.rows.slice(0,50000),items=itemsR.rows.slice(0,40000),
  expenses=expenseR.rows.slice(0,12000),movements=movementR.rows.slice(0,10000);
 const names=new Map(branches.map(b=>[b.id,b.name]));
 const monthMap=new Map(months.map(month=>[month,{month,net:0,gross:0,discount:0,expenses:0,orders:0}]));
 const dailyMap=new Map(Array.from({length:days},(_,i)=>{const day=addDays(start,i);return[day,{day,net:0,gross:0,discount:0,expenses:0,orders:0,voided:0}]}));
 const branchMap=new Map(branches.filter(b=>branchId==null||b.id===branchId).map(b=>[b.id,{
  id:b.id,name:b.name,net:0,gross:0,orders:0,discount:0,expenses:0,voided:0
 }]));
 const paymentMap=new Map(),typeMap=new Map(),staffMap=new Map(),customerMap=new Map();
 const summary={net:0,gross:0,discount:0,orders:0,voided:0,expenses:0,
  previousNet:0,previousOrders:0,avgTicket:0,operatingBalance:0,recordedCustomers:0,repeatCustomers:0};
 for(const x of sales){
  const day=localDay(x.sold_at),month=day.slice(0,7),status=String(x.status||'');
  const inCurrent=day>=start&&day<=today,prior=day>=previousStart&&day<start;
  const row=branchMap.get(Number(x.branch_id));
  if(status==='Sold'){
   const net=Number(x.actual||0),gross=Number(x.gross||0),discount=Number(x.discount_amount||0);
   const m=monthMap.get(month);
   if(m){m.net+=net;m.gross+=gross;m.discount+=discount;m.orders++;}
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
   const cashier=String(x.cashier_name_snapshot||'Unknown cashier');
   const staff=staffMap.get(cashier)||{name:cashier,net:0,orders:0};
   staff.net+=net;staff.orders++;staffMap.set(cashier,staff);
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
  const key=name.toLocaleLowerCase('en-PH'),qty=Number(x.quantity||0),amount=Number(x.line_total||0);
  const current=products.get(key)||{name,qty:0,amount:0,kind:x.is_add_on?'Add-on':x.is_package?'Package':'Menu item'};
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
 const stockAlerts=stockR.rows.filter(x=>Number(x.stock_qty||0)<=Number(x.low_stock_threshold||0))
   .slice(0,12).map(x=>({name:String(x.display_name||'Ingredient'),
    stock:round(x.stock_qty),threshold:round(x.low_stock_threshold),uom:x.uom||''}));
 const allCustomers=[...customerMap.values()].sort((a,b)=>b.net-a.net);
 summary.recordedCustomers=allCustomers.length;
 summary.repeatCustomers=allCustomers.filter(x=>x.orders>1).length;
 summary.avgTicket=summary.orders?summary.net/summary.orders:0;
 summary.operatingBalance=summary.net-summary.expenses;
 const alerts=[];
 for(const x of stockAlerts.slice(0,5))alerts.push({title:x.stock<=0?'Out of stock':'Stock attention',location:'Shared inventory',
  detail:x.name+': '+x.stock+' '+x.uom+' (threshold '+x.threshold+')'});
 for(const x of branchMap.values())if(!x.orders)alerts.push({title:'No completed sales',location:x.name,
  detail:'No completed orders in the selected '+days+'-day period.'});
 if(summary.voided)alerts.push({title:'Voided transactions',location:'Selected branches',
  detail:summary.voided+' voided or cancelled records in the selected period.'});
 return {
  period:{days,start,end:today,historyStart},branches,selectedBranch:branchId,
  complete:!partial,
  sourceNotes:{stock:'Inventory quantities are shared across the POS and cannot be attributed to individual branches.',
   costs:'Operating balance is net sales minus recorded expense entries; it excludes unrecorded cost of goods and liabilities.',
   customers:'Customer insights use optional names entered at checkout; anonymous transactions cannot be identified.',
   staff:'Cashier performance reflects processed sales; staff shifts, attendance, and wages are not recorded here.'},
  summary:Object.fromEntries(Object.entries(summary).map(([k,v])=>[k,round(v)])),
  months:[...monthMap.values()].map(m=>({...m,net:round(m.net),gross:round(m.gross),discount:round(m.discount),expenses:round(m.expenses)})),
  daily:[...dailyMap.values()].map(d=>({...d,net:round(d.net),gross:round(d.gross),discount:round(d.discount),expenses:round(d.expenses),operatingBalance:round(d.net-d.expenses),avgTicket:round(d.orders?d.net/d.orders:0)})),
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
module.exports={read,localDay,addDays,monthList};
