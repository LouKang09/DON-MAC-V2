'use strict';
// The ORIGINAL Main POS finance screens, backed exclusively by workspace/branch live tables.
const crypto=require('node:crypto');
const scope=require('./franchise-live-scope');
const ACCESS={transactions:'transactions.view',expenses:'expenses.view'};
const CATEGORIES=['rent','stocks','salary','transportation','electricity','ice','water','misc'];
const positive=x=>Number.isSafeInteger(Number(x))&&Number(x)>0?Number(x):0;
const number=x=>Number(x||0);
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'})
 .format(new Date()).replace(/\//g,'-');
function validDate(value,otherwise){
 const str=String(value||otherwise||'');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(str)||new Date(str+'T00:00:00.000Z').toISOString().slice(0,10)!==str)
  throw fail('Enter a valid calendar date.',400);
 return str;
}
function range(query){
 const current=today(),start=validDate(query.get('start'),current.slice(0,7)+'-01');
 const end=validDate(query.get('end'),current);
 if(start>end)throw fail('Start date must not be later than end date.',400);
 const since=new Date(start+'T00:00:00+08:00').toISOString();
 const until=new Date(Date.parse(end+'T00:00:00+08:00')+86400000).toISOString();
 return{start,end,since,until};
}
function requireAccess(ctx,permission){
 if(!ctx.admin&&!ctx.permissions?.includes(permission))
  throw scope.fail('This feature has not been granted by your Owner.');
}
function requestPage(query){
 const page=Number(query.get('page')||1);
 if(!Number.isSafeInteger(page)||page<1||page>100000)throw fail('Invalid report page.',400);
 return page;
}
async function eligibleBranches(db,ctx,requestedBranchId){
 const all=await scope.branches(db,ctx);
 const requested=positive(requestedBranchId);
 if(requested){
  const selected=await scope.branch(db,ctx,requested);
  return [{id:selected.id,name:selected.name}];
 }
 if(!ctx.admin)return all.filter(x=>x.id===ctx.branchId);
 return all;
}
function branchWhere(ctx,branches){
 const args=[ctx.workspaceId,...branches.map(x=>x.id)];
 const clause='workspace_id=$1 AND branch_id IN ('+branches.map((_,i)=>'$'+(i+2)).join(',')+')';
 return{args,clause};
}
async function transactions(db,ctx,query){
 scope.requirePaid(ctx);requireAccess(ctx,ACCESS.transactions);
 const branches=await eligibleBranches(db,ctx,query.get('branchId'));
 const dates=range(query),page=requestPage(query),pageSize=10;
 if(!branches.length)return{rows:[],branches:[],total:0,salesTotal:0,page,pageSize};
 const scoped=branchWhere(ctx,branches),args=[...scoped.args,dates.since,dates.until];
 const from='$'+(args.length-1),to='$'+args.length;
 const clauses=[scoped.clause,'sold_at>='+from,'sold_at<'+to];
 const filters={status:['Sold','Voided'],payment:['Cash','GCash','Others'],
  orderType:['Dine In','Take Away','Order Online']};
 for(const [key,column] of [['status','status'],['payment','payment_mode'],['orderType','order_type']]){
  const value=String(query.get(key)||'').trim();
  if(!value)continue;
  if(!filters[key].includes(value))throw fail('Invalid transaction filter.',400);
  args.push(value);
  clauses.push(column+'=$'+args.length);
 }
 const search=String(query.get('search')||'').trim();
 if(search.length>120)throw fail('Search term is too long.',400);
 if(search){
  args.push('%'+search.replace(/[\\%_]/g,'\\$&')+'%');
  clauses.push('(LOWER(reference) LIKE LOWER($'+args.length+') OR LOWER(cashier_name_snapshot) LIKE LOWER($'+args.length+'))');
 }
 const where=clauses.join(' AND ');
 const aggregate=await db.query('SELECT COUNT(*) AS count,'+
  "COALESCE(SUM(CASE WHEN status='Sold' THEN actual ELSE 0 END),0) AS sales_total "+
  'FROM branch_live_sales WHERE '+where,args);
 const total=number(aggregate.rows[0]?.count),salesTotal=number(aggregate.rows[0]?.sales_total);
 const results=await db.query('SELECT branch_id,reference,sold_at,cashier_name_snapshot,'+
  'payment_mode,order_type,status,actual FROM branch_live_sales WHERE '+where+
  ' ORDER BY sold_at DESC,id DESC LIMIT $'+(args.length+1)+' OFFSET $'+(args.length+2),
  [...args,pageSize,(page-1)*pageSize]);
 const byId=new Map(branches.map(b=>[Number(b.id),b.name]));
 return{branches,total,salesTotal,page,pageSize,rows:results.rows.map(x=>({
  reference:x.reference,date:x.sold_at,branchId:positive(x.branch_id),
  branch:byId.get(Number(x.branch_id))||'Branch',cashier:x.cashier_name_snapshot,
  payment:x.payment_mode,orderType:x.order_type,status:x.status,amount:number(x.actual)
 }))};
}
async function expenses(db,ctx,query){
 scope.requirePaid(ctx);requireAccess(ctx,ACCESS.expenses);
 const branches=await eligibleBranches(db,ctx,query.get('branchId'));
 const dates=range(query),page=requestPage(query),pageSize=10;
 if(!branches.length)return{rows:[],branches:[],total:0,grandTotal:0,page,pageSize};
 const scoped=branchWhere(ctx,branches),args=[...scoped.args,dates.start,dates.end];
 const datesClause='substr(incurred_at,1,10)>=$'+(args.length-1)+
  ' AND substr(incurred_at,1,10)<=$'+args.length;
 const sums=CATEGORIES.map(cat=>{
  const condition=cat==='misc'
   ?"LOWER(category) NOT IN ('rent','stocks','salary','transportation','electricity','ice','water')"
   :"LOWER(category)='"+cat+"'";
  return 'COALESCE(SUM(CASE WHEN '+condition+' THEN amount ELSE 0 END),0) AS '+cat;
 }).join(',');
 const results=await db.query('SELECT branch_id,substr(incurred_at,1,10) AS date,'+
  sums+',MAX(COALESCE(notes,\'\')) AS note FROM branch_live_expenses WHERE '+
  scoped.clause+' AND '+datesClause+
  ' GROUP BY branch_id,substr(incurred_at,1,10) ORDER BY date DESC,branch_id DESC',args);
 const byId=new Map(branches.map(b=>[Number(b.id),b.name]));
 const rows=results.rows.map(x=>{
  const row={id:String(x.branch_id)+'|'+String(x.date),date:x.date,branchId:positive(x.branch_id),
   branch:byId.get(Number(x.branch_id))||'Branch',note:x.note||''};
  for(const cat of CATEGORIES)row[cat]=number(x[cat]);
  return row;
 });
 const grandTotal=rows.reduce((total,row)=>total+CATEGORIES.reduce((sum,cat)=>sum+row[cat],0),0);
 return{branches,total:rows.length,grandTotal,page,pageSize,rows:rows.slice((page-1)*pageSize,page*pageSize)};
}
async function saveExpenses(db,ctx,body){
 scope.requirePaid(ctx);requireAccess(ctx,'expenses.manage');
 if(!body||typeof body!=='object')throw fail('Expense form is required.',400);
 const b=await scope.branch(db,ctx,body.branchId);
 const date=validDate(body.date),note=String(body.note||'').trim();
 if(note.length>500)throw fail('Expense notes cannot exceed 500 characters.',400);
 const values={};
 for(const cat of CATEGORIES){
  const amount=Number(body[cat]||0);
  if(!Number.isFinite(amount)||amount<0||amount>99999999||Math.round(amount*100)/100!==amount)
   throw fail('Enter non-negative expense amounts with two decimal places.',400);
  values[cat]=amount;
 }
 // Deterministic IDs make daily updates idempotent and retain legacy one-off
 // expense rows. We never DELETE the existing expense ledger.
 const at=date+'T04:00:00.000Z';
 return db.transaction(async tx=>{
  for(const cat of CATEGORIES){
   const digest=crypto.createHash('sha256').update('live-daily|'+ctx.workspaceId+'|'+b.id+'|'+date+'|'+cat).digest('hex');
   const uuid=digest.slice(0,8)+'-'+digest.slice(8,12)+'-4'+digest.slice(13,16)+'-a'+digest.slice(17,20)+'-'+digest.slice(20,32);
   await tx.query('INSERT INTO branch_live_expenses '+
    '(id,workspace_id,branch_id,category,amount,notes,created_by,incurred_at) '+
    'VALUES($1,$2,$3,$4,$5,$6,$7,$8) '+
    'ON CONFLICT(id) DO UPDATE SET amount=excluded.amount,notes=excluded.notes,'+
    'created_by=excluded.created_by WHERE branch_live_expenses.workspace_id=excluded.workspace_id '+
    'AND branch_live_expenses.branch_id=excluded.branch_id',
    [uuid,ctx.workspaceId,b.id,cat,values[cat],note||null,ctx.userId,at]);
  }
  return{ok:true,branchId:b.id,date};
 });
}
module.exports={transactions,expenses,saveExpenses,range};
