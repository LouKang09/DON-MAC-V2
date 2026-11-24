'use strict';
// Staff-entered end-of-shift SALE DEPOSITS, separate from expense ledger.
// One editable (audited) entry per cashier and Philippine workday. No bank
// transfer is inferred or claimed from this form.
const crypto=require('node:crypto');
const cashierAccess=require('./cashier-access');
const fail=(message,status=403)=>Object.assign(new Error(message),{status});
const day=()=>{const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{
 timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'
}).formatToParts(new Date()).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
 return parts.year+'-'+parts.month+'-'+parts.day;};
const identity=async(db,user)=>{
 if(!user||!Number.isSafeInteger(Number(user.id))||Number(user.id)<1)
  throw fail('Sign in to record a shift deposit.',401);
 if(!['Admin','User'].includes(user.role))throw fail('This role cannot access shift deposits.');
 if(user.role==='User'&&!(await cashierAccess.allowed(db,user,'dashboard.view')))
  throw fail('Dashboard access must be granted by your Owner.',403);
 const rows=(await db.query('SELECT m.workspace_id,u.branch_id,u.role,u.active '+
  'FROM chat_memberships m JOIN users u ON u.id=m.user_id WHERE m.user_id=$1',
  [Number(user.id)])).rows;
 if(rows.length!==1||!Number.isSafeInteger(Number(rows[0].workspace_id))||
    Number(rows[0].workspace_id)<1)throw fail('A single active franchise workspace is required.');
 if(user.role==='User'&&(rows[0].active===false||rows[0].active===0))
  throw fail('Your cashier account is inactive.',403);
 return{workspaceId:Number(rows[0].workspace_id),userId:Number(user.id),
  branchId:Number(rows[0].branch_id)||null,admin:user.role==='Admin'};
};
const checkBranch=async(db,identity,requested)=>{
 const branchId=identity.admin?(requested&&requested!=='all'?Number(requested):null):identity.branchId;
 if(requested&&!identity.admin&&String(requested)!=='all'&&Number(requested)!==branchId)
  throw fail('Another branch cannot be accessed by this cashier.',403);
 if(requested==='all'&&!identity.admin)throw fail('Cashier cannot request all branches.',403);
 if(branchId!==null&&(!Number.isSafeInteger(branchId)||branchId<1))
  throw fail('Choose an active branch.',400);
 if(branchId!==null){
  const rows=(await db.query('SELECT 1 FROM chat_workspace_branches w JOIN branches b ON b.id=w.branch_id '+
   'WHERE w.workspace_id=$1 AND w.branch_id=$2 AND b.active=$3',
   [identity.workspaceId,branchId,true])).rows;
  if(rows.length!==1)throw fail('Branch is not active in this franchise.',403);
 }
 return branchId;
};
async function migrate(db){
 const fk=db.engine==='postgres'?'BIGINT':'INTEGER',time='TEXT';
 await db.exec('CREATE TABLE IF NOT EXISTS franchise_shift_deposits ('+
  'id VARCHAR(40) PRIMARY KEY,workspace_id '+fk+' NOT NULL REFERENCES chat_workspaces(id) ON DELETE CASCADE,'+
  'branch_id '+fk+' NOT NULL REFERENCES branches(id),user_id '+fk+' NOT NULL REFERENCES users(id),'+
  'work_day VARCHAR(10) NOT NULL,amount_centavos BIGINT NOT NULL,'+
  'created_at '+time+' NOT NULL,updated_at '+time+' NOT NULL,'+
  'UNIQUE(workspace_id,user_id,work_day))');
 await db.exec('CREATE INDEX IF NOT EXISTS idx_franchise_shift_deposits_workday '+
  'ON franchise_shift_deposits(workspace_id,branch_id,work_day)');
 await db.exec('CREATE TABLE IF NOT EXISTS franchise_shift_deposit_audit ('+
  'id VARCHAR(40) PRIMARY KEY,deposit_id VARCHAR(40) NOT NULL REFERENCES franchise_shift_deposits(id),'+
  'workspace_id '+fk+' NOT NULL REFERENCES chat_workspaces(id),user_id '+fk+' NOT NULL REFERENCES users(id),'+
  'old_centavos BIGINT,new_centavos BIGINT NOT NULL,changed_at '+time+' NOT NULL)');
}
async function summary(db,user,params={}){
 const auth=await identity(db,user),branchId=await checkBranch(db,auth,params.branchId);
 const date=day(),from=String(params.from||params.date||date),
  to=String(params.to||params.date||date);
 const validDay=v=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&
  !Number.isNaN(Date.parse(v+'T00:00:00Z'))&&
  new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
 if(!validDay(from)||!validDay(to)||from>to||to>date||
   Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z')>370*86400000)
  throw fail('Select a valid past or current deposit reporting period of up to 371 days.',400);
 if(!auth.admin&&(from!==date||to!==date))
  throw fail('Cashier deposit reports are limited to today.',403);
 const args=[auth.workspaceId,from,to];
 const where='d.workspace_id=$1 AND d.work_day >= $2 AND d.work_day <= $3 AND '+
  'EXISTS(SELECT 1 FROM chat_workspace_branches w JOIN branches b ON b.id=w.branch_id '+
  'WHERE w.workspace_id=$1 AND w.branch_id=d.branch_id AND b.active=TRUE)';
 let branchWhere='';
 if(branchId!==null){args.push(branchId);branchWhere=' AND d.branch_id=$'+args.length;}
 const result=await db.query('SELECT COUNT(*) AS count,COALESCE(SUM(d.amount_centavos),0) AS total '+
  'FROM franchise_shift_deposits d WHERE '+where+branchWhere,args);
 const count=Number(result.rows[0]?.count||0);
 let mineAmount=null,mineRecordedAt=null;
 if(!auth.admin){
  const mine=(await db.query('SELECT amount_centavos,updated_at FROM franchise_shift_deposits '+
   'WHERE workspace_id=$1 AND user_id=$2 AND branch_id=$3 AND work_day=$4',
   [auth.workspaceId,auth.userId,branchId,date])).rows[0];
  if(mine){mineAmount=Number(mine.amount_centavos)/100;mineRecordedAt=mine.updated_at;}
 }
 return{date,from,to,branchId,count,total:count?Number(result.rows[0]?.total||0)/100:null,
  mineAmount,mineRecordedAt,currency:'PHP',recorded:count>0};
}
async function save(db,user,input={}){
 const auth=await identity(db,user);
 if(auth.admin)throw fail('Shift deposit amounts must be entered by the assigned cashier.',403);
 const branchId=await checkBranch(db,auth,auth.branchId);
 const value=input?.amount;
 if(typeof value!=='number'&&typeof value!=='string')throw fail('Enter an amount in Philippine pesos.',400);
 if(typeof value==='string'&&!/^\d{1,8}(?:\.\d{1,2})?$/.test(value.trim()))
  throw fail('Use a non-negative amount with at most two decimal places.',400);
 const amount=Number(value);
 if(!Number.isFinite(amount)||amount<0||amount>99999999.99||
   Math.abs(Math.round(amount*100)-amount*100)>0.00001)
  throw fail('Deposit amount must have at most two decimal places.',400);
 if(input?.date&&input.date!==day())throw fail('Only today’s end-of-shift deposit can be recorded.',400);
 const cents=Math.round(amount*100),currentDate=day(),now=new Date().toISOString();
 return db.transaction(async tx=>{
  const existing=(await tx.query('SELECT id,branch_id,amount_centavos FROM franchise_shift_deposits '+
   'WHERE workspace_id=$1 AND user_id=$2 AND work_day=$3'+
   (tx.engine==='postgres'?' FOR UPDATE':''),
   [auth.workspaceId,auth.userId,currentDate])).rows[0];
  if(existing&&Number(existing.branch_id)!==branchId)
   throw fail('This workday deposit belongs to your previous assigned branch. Ask the Owner to review it.',409);
  const id=existing?.id||crypto.randomUUID();
  if(existing&&Number(existing.amount_centavos)===cents)return{ok:true,unchanged:true,
   ...(await summary(tx,user,{branchId}))};
  await tx.query('INSERT INTO franchise_shift_deposits(id,workspace_id,branch_id,user_id,work_day,'+
   'amount_centavos,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) '+
   'ON CONFLICT(workspace_id,user_id,work_day) DO UPDATE SET amount_centavos=excluded.amount_centavos,'+
   'updated_at=excluded.updated_at',
   [id,auth.workspaceId,branchId,auth.userId,currentDate,cents,now,now]);
  await tx.query('INSERT INTO franchise_shift_deposit_audit(id,deposit_id,workspace_id,user_id,'+
   'old_centavos,new_centavos,changed_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
   [crypto.randomUUID(),id,auth.workspaceId,auth.userId,
    existing?Number(existing.amount_centavos):null,cents,now]);
  return{ok:true,unchanged:false,...(await summary(tx,user,{branchId}))};
 });
}
module.exports={migrate,summary,save,day};
