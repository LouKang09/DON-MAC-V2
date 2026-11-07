'use strict';
const crypto=require('node:crypto');
const fail=(msg,status=400)=>Object.assign(new Error(msg),{status});
const isOn=x=>x===true||x===1||x==='1'||x==='true';
const id=x=>{const n=Number(x);if(!Number.isSafeInteger(n)||n<1)throw fail('Invalid ID');return n};
async function migrate(db){
 const fk=db.engine==='postgres'?'BIGINT':'INTEGER';
 await db.exec('CREATE TABLE IF NOT EXISTS platform_account_plans('+
  'workspace_id '+fk+' PRIMARY KEY REFERENCES chat_workspaces(id) ON DELETE CASCADE,'+
  'plan VARCHAR(20) NOT NULL,amount NUMERIC(12,2) NOT NULL,status VARCHAR(20) NOT NULL,'+
  'next_payment_date TEXT,updated_at TEXT NOT NULL,updated_by VARCHAR(100) NOT NULL)');
 // Keep existing accounts' due dates unset until explicitly recorded.
 if(db.engine==='postgres')await db.exec('ALTER TABLE platform_account_plans ADD COLUMN IF NOT EXISTS next_payment_date TEXT');
 else{
  const cols=await db.query('PRAGMA table_info(platform_account_plans)');
  if(!cols.rows.some(x=>x.name==='next_payment_date'))await db.exec('ALTER TABLE platform_account_plans ADD COLUMN next_payment_date TEXT');
 }
 await db.exec('CREATE TABLE IF NOT EXISTS platform_account_plan_requests ('+
  'workspace_id '+fk+' PRIMARY KEY REFERENCES chat_workspaces(id) ON DELETE CASCADE,'+
  'requested_plan VARCHAR(20) NOT NULL,requested_at TEXT NOT NULL,requested_by INTEGER NOT NULL)');
 await db.exec('CREATE TABLE IF NOT EXISTS platform_account_plan_history ('+
  'id VARCHAR(40) PRIMARY KEY,workspace_id '+fk+' NOT NULL REFERENCES chat_workspaces(id) ON DELETE CASCADE,'+
  'plan VARCHAR(20) NOT NULL,status VARCHAR(20) NOT NULL,started_at TEXT NOT NULL,'+
  'renew_at TEXT,changed_at TEXT NOT NULL,actor VARCHAR(100) NOT NULL)');
 await db.exec('CREATE INDEX IF NOT EXISTS idx_platform_account_plan_history ON platform_account_plan_history(workspace_id,changed_at)');
}
async function list(db){
 const [owners,branches,users,plans,requests]=await Promise.all([
  db.query('SELECT w.id AS workspace_id,w.owner_user_id,w.created_at AS workspace_created,'+
   'u.id AS owner_id,COALESCE(u.login_username,u.username) AS owner_username,'+
   'u.full_name AS owner_full_name,u.email AS owner_email,u.phone AS owner_phone,'+
   'u.active AS owner_active,u.created_at AS joined_at FROM chat_workspaces w '+
   'LEFT JOIN users u ON u.id=w.owner_user_id ORDER BY w.created_at DESC,w.id DESC'),
  db.query('SELECT x.workspace_id,b.id AS branch_id,b.name,b.active,b.city,b.province '+
   'FROM chat_workspace_branches x JOIN branches b ON b.id=x.branch_id ORDER BY b.name'),
  db.query('SELECT m.workspace_id,u.id AS user_id,COALESCE(u.login_username,u.username) AS username,'+
   'u.full_name,u.email,u.phone,u.role,u.active,u.created_at,u.branch_id '+
   'FROM chat_memberships m JOIN users u ON u.id=m.user_id ORDER BY u.id'),
  db.query('SELECT workspace_id,plan,amount,status,next_payment_date,updated_at FROM platform_account_plans'),
  db.query('SELECT workspace_id,requested_plan,requested_at FROM platform_account_plan_requests')
 ]);
 const accounts=new Map();
 for(const x of owners.rows)accounts.set(Number(x.workspace_id),{
  workspaceId:Number(x.workspace_id),ownerId:x.owner_id==null?null:Number(x.owner_id),
  ownerUsername:x.owner_username||'Unassigned Owner',ownerFullName:x.owner_full_name||'',
  ownerEmail:x.owner_email||'',ownerPhone:x.owner_phone||'',
  joinedAt:x.joined_at||x.workspace_created||null,active:isOn(x.owner_active),
  branches:[],allBranchAdmins:[],unassigned:[],subscription:null,userCount:0,branchCount:0
 });
 const indexed=new Map();
 for(const x of branches.rows){
  const account=accounts.get(Number(x.workspace_id));if(!account)continue;
  const b={id:Number(x.branch_id),name:x.name,city:x.city||'',province:x.province||'',
   active:isOn(x.active),users:[]};
  account.branches.push(b);indexed.set(account.workspaceId+':'+b.id,b);
 }
 for(const x of users.rows){
  const account=accounts.get(Number(x.workspace_id));if(!account)continue;
  const u={id:Number(x.user_id),username:x.username,fullName:x.full_name||'',email:x.email||'',
   phone:x.phone||'',role:x.role,active:isOn(x.active),
   isOwner:Number(x.user_id)===account.ownerId,
   branchId:x.branch_id==null?null:Number(x.branch_id),createdAt:x.created_at||null};
  const b=indexed.get(account.workspaceId+':'+u.branchId);
  if(u.isOwner||u.role==='Admin')account.allBranchAdmins.push(u);
  else if(b)b.users.push(u);
  else account.unassigned.push(u);
  account.userCount++;
 }
 for(const x of plans.rows){
  const account=accounts.get(Number(x.workspace_id));
  if(account)account.subscription={plan:x.plan,amount:Number(x.amount),status:x.status,nextPaymentDate:x.next_payment_date||null,updatedAt:x.updated_at};
 }
 for(const r of requests.rows){
  const a=accounts.get(Number(r.workspace_id));
  if(a)a.pendingPlan={plan:r.requested_plan,requestedAt:r.requested_at};
 }
 const result=[...accounts.values()];
 for(const a of result)a.branchCount=a.branches.length;
 return{accounts:result,summary:{owners:result.length,activeOwners:result.filter(x=>x.active).length,
  branches:result.reduce((s,x)=>s+x.branchCount,0),
  users:result.reduce((s,x)=>s+x.userCount,0)},
  notice:'Subscription amounts and statuses are managed by Admin Control.'};
}
async function savePlan(db,workspace,body,actor){
 const ws=id(workspace),plan=String(body?.plan||''),status=String(body?.status||'');
 if(!['PRO','BUSINESS'].includes(plan)||!['PAID','ON_HOLD','UNPAID'].includes(status))
  throw fail('Select a valid plan and payment status.');
 const raw=String(body?.amount??'').trim();
 if(!/^\d{1,9}(?:\.\d{1,2})?$/.test(raw))throw fail('Enter an amount in pesos with at most 2 decimal places.');
 const exists=await db.query('SELECT id FROM chat_workspaces WHERE id=$1',[ws]);
 if(!exists.rows.length)throw fail('Franchise account not found.',404);
 const nextPaymentDate=String(body?.nextPaymentDate||'').trim();
 if(nextPaymentDate){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(nextPaymentDate)||Number.isNaN(Date.parse(nextPaymentDate+'T00:00:00Z'))||
     new Date(nextPaymentDate+'T00:00:00Z').toISOString().slice(0,10)!==nextPaymentDate)
   throw fail('Enter a valid next payment date (YYYY-MM-DD).');
 }
 const amount=Number(raw),when=new Date().toISOString();
 return db.transaction(async tx=>{
  const prior=(await tx.query('SELECT plan,status,next_payment_date,updated_at FROM platform_account_plans WHERE workspace_id=$1',[ws])).rows[0]||null;
  await tx.query('INSERT INTO platform_account_plans(workspace_id,plan,amount,status,next_payment_date,updated_at,updated_by) '+
   'VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(workspace_id) DO UPDATE SET '+
   'plan=excluded.plan,amount=excluded.amount,status=excluded.status,next_payment_date=excluded.next_payment_date,'+
   'updated_at=excluded.updated_at,updated_by=excluded.updated_by',
   [ws,plan,amount,status,nextPaymentDate||null,when,String(actor||'Admin Control').slice(0,100)]);
  const changed=!prior||prior.plan!==plan||prior.status!==status||String(prior.next_payment_date||'')!==nextPaymentDate;
  if(changed)await tx.query(
   'INSERT INTO platform_account_plan_history(id,workspace_id,plan,status,started_at,renew_at,changed_at,actor) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
   [crypto.randomUUID(),ws,plan,status,prior?.plan===plan?prior.updated_at||when:when,
    nextPaymentDate||null,when,String(actor||'Admin Control').slice(0,100)]);
  await tx.query('DELETE FROM platform_account_plan_requests WHERE workspace_id=$1',[ws]);
  return{ok:true,subscription:{plan,amount,status,nextPaymentDate:nextPaymentDate||null,updatedAt:when}};
 });
}
async function saveUser(db,workspace,userId,body){
 const ws=id(workspace),uid=id(userId);
 if(!body||typeof body!=='object'||Array.isArray(body)||typeof body.active!=='boolean')
  throw fail('Invalid user information.');
 const fullName=String(body.fullName||'').trim(),email=String(body.email||'').trim(),
  phone=String(body.phone||'').trim();
 if(fullName.length>120||email.length>180||phone.length>32)throw fail('Profile field too long.');
 if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw fail('Enter a valid email address.');
 return db.transaction(async tx=>{
  const x=await tx.query('SELECT u.id,u.role,u.branch_id,u.active,w.owner_user_id '+
   'FROM users u JOIN chat_memberships m ON m.user_id=u.id '+
   'JOIN chat_workspaces w ON w.id=m.workspace_id '+
   'WHERE m.workspace_id=$1 AND u.id=$2',[ws,uid]);
  const old=x.rows[0];if(!old)throw fail('User does not belong to this franchise.',404);
  const owner=uid===Number(old.owner_user_id);
  const role=owner?'Admin':String(body.role||'');
  if(!['Admin','User'].includes(role))throw fail('Invalid role.');
  if(owner&&isOn(old.active)&&!body.active&&!body.confirmOwner)
   throw fail('Confirm Owner deactivation. Branch staff accounts remain active.',409);
  let branch=null;
  if(!owner&&role==='User'){
   branch=id(body.branchId);
   const allowed=await tx.query('SELECT b.id FROM chat_workspace_branches x '+
    'JOIN branches b ON b.id=x.branch_id '+
    'WHERE x.workspace_id=$1 AND b.id=$2 AND b.active=$3',[ws,branch,true]);
   if(!allowed.rows.length)throw fail('Select an active branch belonging to this account.',403);
  }
  await tx.query('UPDATE users SET full_name=$1,email=$2,phone=$3,'+
   'role=$4,branch_id=$5,active=$6 WHERE id=$7',
   [fullName,email,phone,role,branch,body.active,uid]);
  if(role!==old.role||!body.active||branch!==Number(old.branch_id||0)&&(old.branch_id!=null||branch!=null))
   await tx.query('DELETE FROM sessions WHERE user_id=$1',[uid]);
  return{ok:true};
 });
}
async function requestPlan(db,workspace,user,plan){
 const ws=id(workspace);
 if(user?.role!=='Admin'||!['PRO','BUSINESS'].includes(plan))throw fail('Select a valid Pro or Business plan.');
 const current=(await db.query('SELECT plan FROM platform_account_plans WHERE workspace_id=$1',[ws])).rows[0];
 if(current?.plan===plan){
  await db.query('DELETE FROM platform_account_plan_requests WHERE workspace_id=$1',[ws]);
  return{ok:true,pendingPlan:null,message:'This plan is already assigned to your account.'};
 }
 const timestamp=new Date().toISOString();
 await db.query('INSERT INTO platform_account_plan_requests(workspace_id,requested_plan,requested_at,requested_by) VALUES($1,$2,$3,$4) '+
  'ON CONFLICT(workspace_id) DO UPDATE SET requested_plan=excluded.requested_plan,requested_at=excluded.requested_at,requested_by=excluded.requested_by',
  [ws,plan,timestamp,Number(user.id)]);
 return{ok:true,pendingPlan:{plan,requestedAt:timestamp},message:'Plan update submitted to Admin Control for approval.'};
}
async function accountSubscription(db,workspace){
 const ws=id(workspace);
 const [p,r,h]=await Promise.all([
  db.query('SELECT plan,amount,status,next_payment_date,updated_at FROM platform_account_plans WHERE workspace_id=$1',[ws]),
  db.query('SELECT requested_plan,requested_at FROM platform_account_plan_requests WHERE workspace_id=$1',[ws]),
  db.query('SELECT plan,status,started_at,renew_at,changed_at,actor FROM platform_account_plan_history WHERE workspace_id=$1 ORDER BY changed_at DESC LIMIT 100',[ws])
 ]);
 const x=p.rows[0];
 return{configured:!!x,plan:x?.plan||'PRO',status:x?.status||'NOT_CONFIGURED',
  startedAt:x?.updated_at||null,renewAt:x?.next_payment_date||null,amount:x?Number(x.amount):null,
  pendingPlan:r.rows[0]?{plan:r.rows[0].requested_plan,requestedAt:r.rows[0].requested_at}:null,
  history:h.rows.map(x=>({date:x.changed_at,plan:x.plan,startDate:x.started_at,renewDate:x.renew_at,
   status:x.status,actor:x.actor}))
 };
}
async function workspaceAccess(db,userId){
 const r=await db.query('SELECT p.status,p.plan FROM chat_memberships m '+
  'JOIN platform_account_plans p ON p.workspace_id=m.workspace_id '+
  'WHERE m.user_id=$1 ORDER BY m.workspace_id LIMIT 1',[Number(userId)]);
 const x=r.rows[0];
 return{allowed:!x||x.status==='PAID',status:x?.status||null,plan:x?.plan||null};
}
module.exports={migrate,list,savePlan,saveUser,requestPlan,accountSubscription,workspaceAccess};
