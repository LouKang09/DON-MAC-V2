'use strict';
// Franchise-workspace scoped expenses and POS transaction ledger.
const crypto=require('node:crypto');
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const CATEGORIES=['rent','stocks','salary','transportation','electricity','ice','water','misc'];
const amount=x=>{
 const n=Number(x==null||x===''?0:x);
 if(!Number.isFinite(n)||n<0||n>10000000||Math.round(n*100)/100!==n)
  throw fail('Expense amounts must be valid non-negative peso values with up to two decimal places.');
 return n;
};
const validDay=v=>{
 const text=String(v||'').trim();
 if(!/^\d{4}-\d{2}-\d{2}$/.test(text)||Number.isNaN(Date.parse(text+'T00:00:00Z'))||
    new Date(text+'T00:00:00Z').toISOString().slice(0,10)!==text)throw fail('Choose a valid transaction date.');
 return text;
};
async function migrate(db){
 await db.exec('CREATE TABLE IF NOT EXISTS pos_expenses ('+
  'id VARCHAR(40) PRIMARY KEY,workspace_id INTEGER NOT NULL,branch_id INTEGER NOT NULL,'+
  'expense_date VARCHAR(10) NOT NULL,rent NUMERIC(12,2) NOT NULL DEFAULT 0,'+
  'stocks NUMERIC(12,2) NOT NULL DEFAULT 0,salary NUMERIC(12,2) NOT NULL DEFAULT 0,'+
  'transportation NUMERIC(12,2) NOT NULL DEFAULT 0,electricity NUMERIC(12,2) NOT NULL DEFAULT 0,'+
  'ice NUMERIC(12,2) NOT NULL DEFAULT 0,water NUMERIC(12,2) NOT NULL DEFAULT 0,'+
  'misc NUMERIC(12,2) NOT NULL DEFAULT 0,note TEXT,created_by INTEGER NOT NULL,'+
  'created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(workspace_id,branch_id,expense_date))');
 await db.exec('CREATE INDEX IF NOT EXISTS idx_pos_expenses_ws_day ON pos_expenses(workspace_id,expense_date)');
}
async function scope(db,user){
 if(user?.role!=='Admin')throw fail('Expenses and franchise transaction management require an Owner or Co-Owner account.',403);
 const r=await db.query('SELECT workspace_id FROM chat_memberships WHERE user_id=$1 ORDER BY workspace_id LIMIT 1',[Number(user.id)]);
 if(!r.rows.length)throw fail('No tenant workspace assigned.',403);
 const workspaceId=Number(r.rows[0].workspace_id);
 const branchR=await db.query('SELECT b.id,b.name FROM chat_workspace_branches w JOIN branches b ON b.id=w.branch_id WHERE w.workspace_id=$1 ORDER BY b.name',[workspaceId]);
 return{workspaceId,branches:branchR.rows.map(x=>({id:Number(x.id),name:x.name}))};
}
function selectedBranch(data,id,required){
 const branchId=Number(id||0);
 if(required&&(!Number.isSafeInteger(branchId)||branchId<1))throw fail('Select a valid franchise branch.');
 if(!required&&(!id||Number(id)===0))return null;
 if(!data.branches.some(b=>b.id===branchId))throw fail('The selected branch does not belong to your franchise.',403);
 return branchId;
}
function range(params){
 const start=params?.start?validDay(params.start):null,end=params?.end?validDay(params.end):null;
 if(start&&end&&start>end)throw fail('End date must be on or after start date.');
 return{start,end};
}
const pageNo=v=>Math.max(1,Math.min(100000,Math.trunc(Number(v)||1)));
const branchScope=(where,args,branchId,alias)=>{
 if(branchId!=null){args.push(branchId);where.push(alias+'.branch_id=$'+args.length);}
};
async function expenses(db,user,params={}){
 const data=await scope(db,user),branchId=selectedBranch(data,params.branchId,false),days=range(params);
 const args=[data.workspaceId],where=['e.workspace_id=$1'];
 branchScope(where,args,branchId,'e');
 if(days.start){args.push(days.start);where.push('e.expense_date >= $'+args.length);}
 if(days.end){args.push(days.end);where.push('e.expense_date <= $'+args.length);}
 const cond=where.join(' AND '),p=pageNo(params.page),limit=10;
 const summaries=CATEGORIES.map(c=>'COALESCE(SUM(e.'+c+'),0) AS '+c).join(',');
 const [summary,records]=await Promise.all([
  db.query('SELECT COUNT(*) AS count,'+summaries+' FROM pos_expenses e WHERE '+cond,args),
  db.query('SELECT e.*,b.name AS branch_name FROM pos_expenses e LEFT JOIN branches b ON b.id=e.branch_id WHERE '+cond+
   ' ORDER BY e.expense_date DESC,e.updated_at DESC LIMIT $'+(args.length+1)+' OFFSET $'+(args.length+2),
   [...args,limit,(p-1)*limit])
 ]);
 const totals=Object.fromEntries(CATEGORIES.map(c=>[c,Number(summary.rows[0]?.[c]||0)]));
 return{page:p,pageSize:limit,total:Number(summary.rows[0]?.count||0),summary:totals,grandTotal:Math.round(Object.values(totals).reduce((a,b)=>a+b,0)*100)/100,
  branches:data.branches,rows:records.rows.map(x=>({id:x.id,branchId:Number(x.branch_id),branch:x.branch_name||'—',date:x.expense_date,
   ...Object.fromEntries(CATEGORIES.map(c=>[c,Number(x[c]||0)])),note:x.note||'',updatedAt:x.updated_at}))};
}
async function saveExpense(db,user,body){
 const data=await scope(db,user),branchId=selectedBranch(data,body?.branchId,true),day=validDay(body?.date);
 const values=CATEGORIES.map(c=>amount(body?.[c])),note=String(body?.note||'').trim().slice(0,500);
 const at=new Date().toISOString();
 const args=[crypto.randomUUID(),data.workspaceId,branchId,day,...values,note,Number(user.id),at,at];
 const columns=['id','workspace_id','branch_id','expense_date',...CATEGORIES,'note','created_by','created_at','updated_at'];
 const inserts=columns.map((_,i)=>'$'+(i+1)).join(',');
 const updates=[...CATEGORIES,'note','updated_at'].map(c=>c+'=excluded.'+c).join(',');
 const r=await db.query('INSERT INTO pos_expenses('+columns.join(',')+') VALUES('+inserts+') ON CONFLICT(workspace_id,branch_id,expense_date) DO UPDATE SET '+updates+' RETURNING id',args);
 return{ok:true,id:r.rows[0]?.id,date:day,branchId};
}
const nextDay=d=>{const t=new Date(d+'T00:00:00Z');t.setUTCDate(t.getUTCDate()+1);return t.toISOString().slice(0,10);};
async function transactions(db,user,params={}){
 const data=await scope(db,user),branchId=selectedBranch(data,params.branchId,false),days=range(params);
 const args=[data.workspaceId],where=['w.workspace_id=$1'];
 branchScope(where,args,branchId,'s');
 if(days.start){args.push(new Date(days.start+'T00:00:00+08:00').toISOString());where.push('s.sold_at >= $'+args.length);}
 if(days.end){args.push(new Date(nextDay(days.end)+'T00:00:00+08:00').toISOString());where.push('s.sold_at < $'+args.length);}
 const whereSql=where.join(' AND '),p=pageNo(params.page),limit=10;
 const from=' FROM sales s JOIN chat_workspace_branches w ON w.branch_id=s.branch_id LEFT JOIN branches b ON b.id=s.branch_id WHERE '+whereSql;
 const [stats,rows]=await Promise.all([
  db.query('SELECT COUNT(*) AS count,COALESCE(SUM(CASE WHEN s.status=$'+(args.length+1)+' THEN s.actual ELSE 0 END),0) AS total_sales'+from,[...args,'Sold']),
  db.query('SELECT s.id,s.reference,s.sold_at,s.status,s.actual,s.payment_mode,s.cashier_name_snapshot,b.name AS branch_name,s.order_type'+from+
   ' ORDER BY s.sold_at DESC,s.id DESC LIMIT $'+(args.length+1)+' OFFSET $'+(args.length+2),
   [...args,limit,(p-1)*limit])
 ]);
 return{page:p,pageSize:limit,total:Number(stats.rows[0]?.count||0),salesTotal:Number(stats.rows[0]?.total_sales||0),
  branches:data.branches,rows:rows.rows.map(r=>({id:Number(r.id),reference:r.reference,date:r.sold_at,status:r.status,
   amount:Number(r.actual||0),payment:r.payment_mode,branch:r.branch_name||'—',cashier:r.cashier_name_snapshot,orderType:r.order_type}))};
}
module.exports={CATEGORIES,migrate,scope,expenses,saveExpense,transactions,validDay};
