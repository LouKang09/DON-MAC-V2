'use strict';
const fail=(msg,status=400)=>Object.assign(new Error(msg),{status});
const isOn=x=>x===true||x===1||x==='1'||x==='true';
const id=x=>{const n=Number(x);if(!Number.isSafeInteger(n)||n<1)throw fail('Invalid ID');return n};
async function migrate(db){
 const fk=db.engine==='postgres'?'BIGINT':'INTEGER';
 await db.exec('CREATE TABLE IF NOT EXISTS platform_account_plans('+
  'workspace_id '+fk+' PRIMARY KEY REFERENCES chat_workspaces(id) ON DELETE CASCADE,'+
  'plan VARCHAR(20) NOT NULL,amount NUMERIC(12,2) NOT NULL,status VARCHAR(20) NOT NULL,'+
  'updated_at TEXT NOT NULL,updated_by VARCHAR(100) NOT NULL)');
}
async function list(db){
 const [owners,branches,users,plans]=await Promise.all([
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
  db.query('SELECT workspace_id,plan,amount,status,updated_at FROM platform_account_plans')
 ]);
 const accounts=new Map();
 for(const x of owners.rows)accounts.set(Number(x.workspace_id),{
  workspaceId:Number(x.workspace_id),ownerId:x.owner_id==null?null:Number(x.owner_id),
  ownerUsername:x.owner_username||'Unassigned Owner',ownerFullName:x.owner_full_name||'',
  ownerEmail:x.owner_email||'',ownerPhone:x.owner_phone||'',
  joinedAt:x.joined_at||x.workspace_created||null,active:isOn(x.owner_active),
  branches:[],unassigned:[],subscription:null,userCount:0,branchCount:0
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
  if(b)b.users.push(u);else account.unassigned.push(u);
  account.userCount++;
 }
 for(const x of plans.rows){
  const account=accounts.get(Number(x.workspace_id));
  if(account)account.subscription={plan:x.plan,amount:Number(x.amount),status:x.status,updatedAt:x.updated_at};
 }
 const result=[...accounts.values()];
 for(const a of result)a.branchCount=a.branches.length;
 return{accounts:result,summary:{owners:result.length,activeOwners:result.filter(x=>x.active).length,
  branches:result.reduce((s,x)=>s+x.branchCount,0),
  users:result.reduce((s,x)=>s+x.userCount,0)},
  notice:'Subscription amounts are manually tracked; the POS has no live billing integration.'};
}
async function savePlan(db,workspace,body,actor){
 const ws=id(workspace),plan=String(body?.plan||''),status=String(body?.status||'');
 if(!['PRO','BUSINESS'].includes(plan)||!['PAID','ON_HOLD','UNPAID'].includes(status))
  throw fail('Select a valid plan and payment status.');
 const raw=String(body?.amount??'').trim();
 if(!/^\d{1,9}(?:\.\d{1,2})?$/.test(raw))throw fail('Enter an amount in pesos with at most 2 decimal places.');
 const exists=await db.query('SELECT id FROM chat_workspaces WHERE id=$1',[ws]);
 if(!exists.rows.length)throw fail('Franchise account not found.',404);
 const amount=Number(raw),when=new Date().toISOString();
 await db.query('INSERT INTO platform_account_plans(workspace_id,plan,amount,status,updated_at,updated_by) '+
  'VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(workspace_id) DO UPDATE SET '+
  'plan=excluded.plan,amount=excluded.amount,status=excluded.status,'+
  'updated_at=excluded.updated_at,updated_by=excluded.updated_by',
  [ws,plan,amount,status,when,String(actor||'Main Office').slice(0,100)]);
 return{ok:true,subscription:{plan,amount,status,updatedAt:when}};
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
  if(owner&&!body.active&&!body.confirmOwner)
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
module.exports={migrate,list,savePlan,saveUser};
