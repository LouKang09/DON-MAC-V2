'use strict';
/* Business Store monthly details. All reads are bounded to the authenticated
 * franchise workspace and branch membership; no joins to another tenant. */
const fail=(message,status=403)=>Object.assign(new Error(message),{status});
const N=x=>Number(x||0);
const amount=x=>Math.round(N(x)*100)/100;
const categories=['rent','stocks','salary','transportation','electricity','ice','water','misc'];
const monthPH=()=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',
 {timeZone:'Asia/Manila',year:'numeric',month:'2-digit'}).formatToParts(new Date())
 .filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
 return p.year+'-'+p.month;};
const months=()=>{
 const now=monthPH(),[y,m]=now.split('-').map(Number);
 return Array.from({length:12},(_,i)=>new Date(Date.UTC(y,m-12+i,1)).toISOString().slice(0,7));
};
const sums=x=>Object.fromEntries(categories.map(k=>[k,N(x?.[k])]));
const mapKey=(branchId,month)=>String(branchId)+'|'+month;
const moneyFields=x=>Object.fromEntries(categories.map(k=>[k,amount(x[k])]));
async function migrate(db){
 const fk=db.engine==='postgres'?'BIGINT':'INTEGER';
 const pk=db.engine==='postgres'?'BIGSERIAL PRIMARY KEY':'INTEGER PRIMARY KEY AUTOINCREMENT';
 await db.exec('CREATE TABLE IF NOT EXISTS franchise_login_events ('+
  'id '+pk+',workspace_id '+fk+' NOT NULL REFERENCES chat_workspaces(id),'+
  'branch_id '+fk+' REFERENCES branches(id),user_id '+fk+' NOT NULL REFERENCES users(id),'+
  'source VARCHAR(10) NOT NULL,created_at TEXT NOT NULL)');
 await db.exec('CREATE INDEX IF NOT EXISTS idx_franchise_login_events_scope '+
  'ON franchise_login_events(workspace_id,branch_id,created_at)');
}
async function recordLogin(db,user,agent){
 const result=await db.query('SELECT m.workspace_id,u.branch_id FROM users u '+
  'JOIN chat_memberships m ON m.user_id=u.id WHERE u.id=$1 ORDER BY m.workspace_id LIMIT 1',
  [Number(user.id)]);
 const row=result.rows[0];if(!row)return;
 const ua=String(agent||'').slice(0,300);
 const source=/android|iphone|ipad|ipod|mobile|okhttp|capacitor|cordova|dart/i.test(ua)?'MOBILE':'WEB';
 await db.query('INSERT INTO franchise_login_events(workspace_id,branch_id,user_id,source,created_at) '+
  'VALUES($1,$2,$3,$4,$5)',
  [Number(row.workspace_id),row.branch_id==null?null:Number(row.branch_id),
   Number(user.id),source,new Date().toISOString()]);
}
async function fetch(db,workspaceId,mode,permitted){
 const list=months(),start=list[0]+'-01',today=monthPH();
 const end=new Date(Date.UTC(Number(today.slice(0,4)),Number(today.slice(5,7)),1))
  .toISOString().slice(0,10);
 const args=[workspaceId,start,end];
 // Event times are saved as UTC while month buckets follow Asia/Manila.
 const eventArgs=[workspaceId,new Date(start+'T00:00:00+08:00').toISOString(),
  new Date(end+'T00:00:00+08:00').toISOString()];
 const phMonth=column=>db.engine==='postgres'?
  "to_char((CAST("+column+" AS TIMESTAMPTZ) AT TIME ZONE 'Asia/Manila'),'YYYY-MM')":
  "substr(datetime("+column+",'+8 hours'),1,7)";
 const saleMonth=phMonth('s.sold_at'),expenseMonth=phMonth('incurred_at'),
  loginMonth=phMonth('created_at');
 const branches=(await db.query(
  'SELECT b.id,b.name FROM chat_workspace_branches wb JOIN branches b ON b.id=wb.branch_id '+
  'WHERE wb.workspace_id=$1 AND b.active=$2 ORDER BY b.name',[workspaceId,true])).rows
  .filter(b=>!permitted||permitted.includes(Number(b.id)));
 const result=new Map();
 for(const branch of branches)for(const month of list){
  result.set(mapKey(branch.id,month),{branchId:Number(branch.id),name:branch.name,month,
   storeExpenses:0,expenseCategories:Object.fromEntries(categories.map(c=>[c,0])),
   employees:0,lowStock:null,voided:0,deleted:0,
   loginCount:0,mobileLogins:0,webLogins:0,totalRecordedLogins:0,
   ingredientCost:null});
 }
 const get=(id,month)=>result.get(mapKey(id,month));
 // Each expense value comes from the actual daily expenses form.
 if(mode==='live'){
  const expenses=await db.query('SELECT branch_id,'+expenseMonth+' AS month,'+
   'LOWER(category) AS category,COALESCE(SUM(amount),0) AS total '+
   'FROM branch_live_expenses WHERE workspace_id=$1 AND incurred_at>=$2 '+
   'AND incurred_at<$3 GROUP BY branch_id,'+expenseMonth+',LOWER(category)',eventArgs);
  for(const x of expenses.rows){
   const r=get(x.branch_id,x.month);if(!r)continue;
   const k=categories.includes(x.category)?x.category:'misc';
   r.expenseCategories[k]+=N(x.total);
  }
 }else{
  const totals=categories.map(k=>'COALESCE(SUM('+k+'),0) AS '+k).join(',');
  const expenses=await db.query('SELECT branch_id,substr(expense_date,1,7) AS month,'+totals+
   ' FROM pos_expenses WHERE workspace_id=$1 AND expense_date>=$2 AND expense_date<$3 '+
   'GROUP BY branch_id,substr(expense_date,1,7)',args);
  for(const x of expenses.rows){
   const r=get(x.branch_id,x.month);if(!r)continue;
   for(const k of categories)r.expenseCategories[k]+=N(x[k]);
  }
 }
 for(const r of result.values()){
  r.expenseCategories=moneyFields(r.expenseCategories);
  r.storeExpenses=amount(categories.reduce((sum,k)=>sum+r.expenseCategories[k],0));
 }
 // Staff and low stock are current snapshots, never misrepresented as the
 // historical count for a prior month.
 const staff=(await db.query('SELECT u.branch_id,COUNT(*) AS total FROM users u '+
  'JOIN chat_memberships m ON m.user_id=u.id WHERE m.workspace_id=$1 '+
  "AND u.role='User' AND u.active=$2 GROUP BY u.branch_id",[workspaceId,true])).rows;
 const staffCounts=new Map(staff.map(x=>[String(x.branch_id),N(x.total)]));
 let stockCounts=new Map();
 if(mode==='live'){
  const stock=(await db.query('SELECT branch_id,COUNT(*) AS total FROM branch_ingredients '+
   'WHERE workspace_id=$1 AND active=$2 AND stock_qty<=low_stock_threshold '+
   'GROUP BY branch_id',[workspaceId,true])).rows;
  stockCounts=new Map(stock.map(x=>[String(x.branch_id),N(x.total)]));
 }
 for(const r of result.values()){
  r.employees=staffCounts.get(String(r.branchId))||0;
  if(mode==='live')r.lowStock=stockCounts.get(String(r.branchId))||0;
 }
 // Voids and deletions are attributed to the original transaction month.
 // The source status is preserved, so these are not counted as two events.
 const soldTable=mode==='live'?'branch_live_sales':'sales';
 const filter=mode==='live'?'s.workspace_id=$1':"wb.workspace_id=$1";
 const join=mode==='live'?'':' JOIN chat_workspace_branches wb ON wb.branch_id=s.branch_id';
 const sales=await db.query('SELECT s.branch_id,'+saleMonth+' AS month,'+
  'LOWER(s.status) AS status,COUNT(*) AS total FROM '+soldTable+' s'+join+
  ' WHERE '+filter+' AND s.sold_at>=$2 AND s.sold_at<$3'+
  " AND LOWER(s.status) NOT IN ('sold') GROUP BY s.branch_id,"+saleMonth+",LOWER(s.status)",eventArgs);
 for(const x of sales.rows){
  const r=get(x.branch_id,x.month);if(!r)continue;
  if(x.status==='deleted')r.deleted+=N(x.total);
  else if(['void','voided','cancelled','canceled'].includes(x.status))r.voided+=N(x.total);
 }
 // Successful sign-ins are kept starting with this deployment. Prior logins
 // were never archived, and native-app vs mobile-browser cannot be proven.
 const logins=await db.query('SELECT branch_id,'+loginMonth+' AS month,source,'+
  'COUNT(*) AS total FROM franchise_login_events WHERE workspace_id=$1 '+
  'AND created_at>=$2 AND created_at<$3 AND branch_id IS NOT NULL '+
  'GROUP BY branch_id,'+loginMonth+',source',eventArgs);
 for(const x of logins.rows){
  const r=get(x.branch_id,x.month);if(!r)continue;
  r.loginCount+=N(x.total);
  if(x.source==='MOBILE')r.mobileLogins+=N(x.total);
  else r.webLogins+=N(x.total);
 }
 const lifetime=(await db.query('SELECT branch_id,COUNT(*) AS total FROM franchise_login_events '+
  'WHERE workspace_id=$1 AND branch_id IS NOT NULL GROUP BY branch_id',[workspaceId])).rows;
 const lifetimes=new Map(lifetime.map(x=>[String(x.branch_id),N(x.total)]));
 for(const r of result.values())r.totalRecordedLogins=lifetimes.get(String(r.branchId))||0;
 if(mode==='live'){
  // Historical ingredient cost of completed receipts, not today's inventory
  // valuation. Use recipe component snapshots when captured; fall back to
  // immutable sale-item unit-cost snapshots only for receipts without components.
  const cost=await db.query(
   'SELECT s.branch_id,'+saleMonth+' AS month,'+
   'COALESCE(SUM(c.total_cost),0) AS total FROM branch_sale_cost_components c '+
   'JOIN branch_live_sales s ON s.id=c.sale_id AND s.workspace_id=c.workspace_id '+
   'AND s.branch_id=c.branch_id WHERE s.workspace_id=$1 AND s.status=$4 '+
   'AND s.sold_at>=$2 AND s.sold_at<$3 '+
   'GROUP BY s.branch_id,'+saleMonth,[...eventArgs,'Sold']);
  for(const r of result.values())r.ingredientCost=0;
  for(const x of cost.rows){
   const r=get(x.branch_id,x.month);if(r)r.ingredientCost=amount(r.ingredientCost+N(x.total));
  }
  const fallback=await db.query(
   'SELECT s.branch_id,'+saleMonth+' AS month,'+
   'COALESCE(SUM(i.quantity*i.unit_cost_snapshot),0) AS total '+
   'FROM branch_live_sale_items i JOIN branch_live_sales s ON s.id=i.sale_id '+
   'AND s.workspace_id=i.workspace_id AND s.branch_id=i.branch_id '+
   'WHERE s.workspace_id=$1 AND s.status=$4 AND s.sold_at>=$2 AND s.sold_at<$3 '+
   'AND NOT EXISTS(SELECT 1 FROM branch_sale_cost_components c WHERE c.sale_id=s.id '+
   'AND c.workspace_id=s.workspace_id AND c.branch_id=s.branch_id) '+
   'GROUP BY s.branch_id,'+saleMonth,[...eventArgs,'Sold']);
  for(const x of fallback.rows){
   const r=get(x.branch_id,x.month);if(r)r.ingredientCost=amount(r.ingredientCost+N(x.total));
  }
 }
 return{months:list,branches:branches.map(b=>({id:Number(b.id),name:b.name})),
  rows:[...result.values()],loginTrackingStart:'2026-11-19',
  notes:{
   storeExpenses:'Total of saved expense inputs including Stocks / ingredients, Rent, Salary, Transportation, Electricity, Ice, Water and Misc. Ingredient cost of goods sold is shown separately when historical snapshots exist.',
   employees:'Current active cashier count, not a historical staffing count.',
   lowStock:mode==='live'?'Current branch stock-alert count, not a historical month-end snapshot.':
    'Legacy inventory is not reliably branch-scoped; branch alert counts are unavailable.',
   logins:'Successful branch-assigned sign-ins recorded since tracking started. Mobile means detected mobile device (including mobile browsers); earlier logins and native-app identity cannot be reconstructed.',
   voided:'Counts belong to the month of the original transaction, not necessarily the date it was voided.'
  }};
}
async function live(db,ctx){
 const scope=require('./franchise-live-scope');
 scope.requireAdmin(ctx);scope.requirePaid(ctx);
 const plan=await require('./franchise-branch-plans').planRecord(db,ctx.workspaceId);
 if(plan.plan!=='BUSINESS')throw fail('Active Business plan required.');
 return fetch(db,ctx.workspaceId,'live',null);
}
async function legacy(db,user){
 if(user?.role!=='Admin')throw fail('Only Owner/Admin accounts may view Store Performance.');
 const rows=(await db.query('SELECT workspace_id FROM chat_memberships WHERE user_id=$1 '+
  'ORDER BY workspace_id LIMIT 1',[user.id])).rows;
 if(!rows[0])throw fail('Franchise workspace not found.');
 const ws=N(rows[0].workspace_id);
 const plan=(await db.query('SELECT plan,status FROM platform_account_plans WHERE workspace_id=$1',[ws])).rows[0];
 if(plan?.plan!=='BUSINESS'||plan?.status!=='PAID')throw fail('Active Business plan required.');
 return fetch(db,ws,'legacy',null);
}
module.exports={migrate,recordLogin,live,legacy};
