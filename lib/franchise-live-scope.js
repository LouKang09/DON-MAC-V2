'use strict';
// New franchises never enter the legacy global products / ingredients / sales routes.
// An Admin Control-approved PAID plan unlocks this scoped production implementation.
const crypto=require('node:crypto');
const branchPlans=require('./franchise-branch-plans');
const seed=require('./branch-catalog-seeding');
const cashierAccess=require('./cashier-access');
const fail=(msg,status=403)=>Object.assign(new Error(msg),{status});
const num=x=>Number(x||0);
const goodId=x=>Number.isSafeInteger(Number(x))&&Number(x)>0?Number(x):0;
const on=x=>x===true||x===1||x==='1';
async function candidate(db,userId){
 const uid=goodId(userId);if(!uid)return null;
 const r=await db.query('SELECT t.request_id,t.user_id AS owner_id,t.workspace_id,t.branch_id AS starter_branch_id,'+
  'p.status AS subscription_status,p.plan AS subscription_plan,m.workspace_id AS membership_workspace,'+
  'am.data_mode AS data_mode,'+
  'u.role,u.branch_id AS user_branch_id,u.active AS user_active,w.owner_user_id,'+
  'b.active AS starter_active '+
  'FROM chat_memberships m JOIN franchise_test_accounts t ON t.workspace_id=m.workspace_id '+
  'JOIN users u ON u.id=m.user_id JOIN chat_workspaces w ON w.id=t.workspace_id '+
  'JOIN branches b ON b.id=t.branch_id '+
  'LEFT JOIN platform_account_plans p ON p.workspace_id=t.workspace_id '+
  'LEFT JOIN franchise_account_modes am ON am.workspace_id=t.workspace_id WHERE m.user_id=$1',[uid]);
 if(r.rows.length===0)return null;
 if(r.rows.length!==1)throw fail('Ambiguous franchise workspace assignment.');
 const x=r.rows[0],ws=goodId(x.workspace_id),ownerId=goodId(x.owner_id);
 if(x.data_mode==='TEMPORARY')return null; // Sandbox is never commercial checkout.
 if(x.data_mode&&x.data_mode!=='NEW')throw fail('Franchise account mode does not permit live checkout.');
 if(!ws||!ownerId||goodId(x.membership_workspace)!==ws||
    goodId(x.owner_user_id)!==ownerId||!on(x.user_active)||!on(x.starter_active))
  throw fail('Franchise account ownership or login is inconsistent.');
 return{requestId:x.request_id,workspaceId:ws,ownerId,dataMode:'NEW',
  starterBranchId:goodId(x.starter_branch_id),
  userId:uid,role:x.role,userBranchId:goodId(x.user_branch_id),
  subscriptionStatus:x.subscription_status||'NOT_CONFIGURED',
  subscriptionPlan:x.subscription_plan||null,
  liveEnabled:x.subscription_status==='PAID'};
}
async function setup(db,user){
 const x=await candidate(db,user?.id);if(!x)return null;
 if(!['Admin','User'].includes(x.role))throw fail('This franchise role cannot access live POS.');
 const assigned=x.role==='User'?x.userBranchId:x.starterBranchId;
 if(!assigned)throw fail('No active branch is assigned to this cashier.');
 const b=await db.query('SELECT b.id,b.name FROM chat_workspace_branches wb '+
  'JOIN branches b ON b.id=wb.branch_id '+
  'WHERE wb.workspace_id=$1 AND wb.branch_id=$2 AND b.active=$3',
  [x.workspaceId,assigned,true]);
 if(b.rows.length!==1)throw fail('Selected franchise branch is unavailable or inactive.');
 return{...x,branchId:assigned,branchName:b.rows[0].name,
  cashier:x.role==='User',admin:x.role==='Admin',subscriptionActive:x.liveEnabled};
}
async function active(db,user){const x=await setup(db,user);return x?.subscriptionActive?x:null;}
function requirePaid(context){
 if(!context.subscriptionActive)throw fail('Live checkout is unavailable until Admin Control validates a Paid subscription.',403);
}
async function branch(db,context,requestedBranchId){
 const id=goodId(requestedBranchId)||context.branchId;
 if(!id)throw fail('Select an active branch.');
 if(context.cashier&&id!==context.branchId)throw fail('Cashier cannot access another branch.');
 const rows=(await db.query('SELECT b.id,b.name FROM chat_workspace_branches w '+
  'JOIN branches b ON b.id=w.branch_id WHERE w.workspace_id=$1 AND w.branch_id=$2 AND b.active=$3',
  [context.workspaceId,id,true])).rows;
 if(rows.length!==1)throw fail('Branch not assigned to this franchise.');
 const prepared=(await db.query('SELECT 1 FROM branch_catalog_provisioning WHERE workspace_id=$1 AND branch_id=$2',
  [context.workspaceId,id])).rows;
 if(prepared.length!==1)throw fail('This branch needs its isolated catalog prepared.',409);
 return{id,name:rows[0].name};
}
async function branches(db,context){
 const rows=(await db.query('SELECT b.id,b.name FROM chat_workspace_branches w '+
  'JOIN branches b ON b.id=w.branch_id '+
  'JOIN branch_catalog_provisioning c ON c.workspace_id=w.workspace_id AND c.branch_id=w.branch_id '+
  'WHERE w.workspace_id=$1 AND b.active=$2 ORDER BY b.name',[context.workspaceId,true])).rows;
 return rows.filter(x=>context.admin||Number(x.id)===context.branchId)
  .map(x=>({id:Number(x.id),name:x.name}));
}
function requireAdmin(context){if(!context.admin)throw fail('Owner or Co-Owner access is required.');}
function requireCashier(context){if(!context.cashier)throw fail('Only a cashier can process live transactions. Create a cashier account in User Management.');}
function passwordHash(password){
 const salt=crypto.randomBytes(16).toString('hex');
 return'scrypt$'+salt+'$'+crypto.scryptSync(password,salt,64).toString('hex');
}
async function createCashier(db,context,data){
 requireAdmin(context);
 const username=String(data.username||'').trim(),password=String(data.password||''),
  fullName=String(data.fullName||'').trim();
 if(!/^[A-Za-z0-9._-]{3,80}$/.test(username)||password.length<10||password.length>128||
   !/[A-Za-z]/.test(password)||!/[0-9]/.test(password)||!fullName||fullName.length>120)
   throw fail('Enter a unique username, employee name, and a password of at least 10 characters with letters and numbers.',400);
 const b=await branch(db,context,data.branchId||context.starterBranchId);
 const hash=passwordHash(password);
 return db.transaction(async tx=>{
  const exists=(await tx.query('SELECT id FROM users WHERE LOWER(username)=LOWER($1) OR '+
    'LOWER(COALESCE(login_username,username))=LOWER($1)',[username])).rows;
  if(exists.length)throw fail('Username is already taken.',409);
  const created=(await tx.query('INSERT INTO users(username,login_username,password_hash,role,active,'+
    'created_at,full_name,branch_id,owner_scope_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
    [username,username,hash,'User',true,new Date().toISOString(),fullName,b.id,context.workspaceId])).rows[0];
  await tx.query('INSERT INTO chat_memberships(user_id,workspace_id) VALUES($1,$2)',
    [Number(created.id),context.workspaceId]);
  return{ok:true,id:Number(created.id),username,branchId:b.id,role:'User'};
 });
}
async function createBranch(db,context,data){
 requireAdmin(context);
 const title=String(data?.name||'').trim(),address=String(data?.address||'').trim();
 if(title.length<3||title.length>120||address.length>250)
  throw fail('Enter a branch name (3–120 characters) and optional address up to 250 characters.',400);
 return db.transaction(async tx=>{
  await branchPlans.allowNewBranch(tx,context.workspaceId);
  const exists=(await tx.query('SELECT 1 FROM chat_workspace_branches w JOIN branches b ON b.id=w.branch_id '+
    'WHERE w.workspace_id=$1 AND LOWER(b.name)=LOWER($2) LIMIT 1',
    [context.workspaceId,title])).rows;
  if(exists.length)throw fail('You already have a branch with this name.',409);
  const created=(await tx.query('INSERT INTO branches(name,address,active) VALUES($1,$2,$3) RETURNING id',
   [title,address||null,true])).rows[0];
  const branchId=goodId(created?.id);
  if(!branchId)throw fail('Unable to create a new branch.',500);
  await tx.query('INSERT INTO chat_workspace_branches(branch_id,workspace_id) VALUES($1,$2)',
    [branchId,context.workspaceId]);
  const blueprint=await seed.readTemplate(tx);
  const initialized=await seed.seedBranch(tx,context.workspaceId,branchId,blueprint,0,context.userId);
  if(initialized.status!=='prepared'||initialized.openingStock!==0)
   throw fail('Branch catalog initialization failed; no branch was saved.',409);
  return{ok:true,id:branchId,name:title,address,openingStock:0,
   workspaceId:context.workspaceId,catalogReady:true};
 });
}

async function updateCashier(db,context,staffId,data){
 requireAdmin(context);
 const targetId=goodId(staffId),fullName=String(data?.fullName||'').trim(),
  optionalPass=String(data?.password||'');
 if(!targetId||fullName.length<1||fullName.length>120)
  throw fail('Select a cashier and enter a valid employee name.',400);
 if(data?.role!=='User')throw fail('Only cashier account updates are currently supported in the isolated staff service.',403);
 if(optionalPass&&(optionalPass.length<10||optionalPass.length>128||!/[A-Za-z]/.test(optionalPass)||!/[0-9]/.test(optionalPass)))
  throw fail('Cashier password must be 10–128 characters and contain letters and numbers.',400);
 const assigned=await branch(db,context,data.branchId);
 const active=data.active!==false;
 const email=String(data.email||'').trim(),phone=String(data.phone||'').trim(),
  photo=data.photoData??null;
 if(email.length>320||phone.length>40||photo!==null&&
  (typeof photo!=='string'||photo.length>200000||!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(photo)))
  throw fail('Invalid employee contact information or photo.',400);
 return db.transaction(async tx=>{
  const found=(await tx.query('SELECT u.id,u.role FROM users u JOIN chat_memberships m ON m.user_id=u.id '+
   'WHERE m.workspace_id=$1 AND u.id=$2'+(tx.engine==='postgres'?' FOR UPDATE OF u':''),
   [context.workspaceId,targetId])).rows[0];
  if(!found||found.role!=='User')throw fail('Cashier not found in your franchise.',404);
  // Scoped modification; no account is deleted, preserving sale receipts and audit provenance.
  await tx.query('UPDATE users SET full_name=$1,branch_id=$2,active=$3,'+
   'email=$4,phone=$5,profile_photo=$6 WHERE id=$7 AND role=$8',
   [fullName,assigned.id,active,email||null,phone||null,photo,targetId,'User']);
  if(optionalPass)await tx.query('UPDATE users SET password_hash=$1 WHERE id=$2 AND role=$3',
   [passwordHash(optionalPass),targetId,'User']);
  if(!active)await tx.query('DELETE FROM sessions WHERE user_id=$1',[targetId]);
  return{ok:true,id:targetId,branchId:assigned.id,active};
 });
}
async function deactivateCashier(db,context,staffId){
 requireAdmin(context);
 const target=goodId(staffId);
 if(!target)throw fail('Select a cashier.',400);
 return db.transaction(async tx=>{
  const changed=(await tx.query('UPDATE users SET active=$1 WHERE id=$2 AND role=$3 '+
   'AND EXISTS(SELECT 1 FROM chat_memberships m WHERE m.user_id=users.id AND m.workspace_id=$4) RETURNING id',
   [false,target,'User',context.workspaceId])).rows;
  if(changed.length!==1)throw fail('Cashier not found in your franchise.',404);
  await tx.query('DELETE FROM sessions WHERE user_id=$1',[target]);
  return{ok:true,id:target,active:false,deleted:false};
 });
}
async function setCashierPermissions(db,context,staffId,permissions){
 requireAdmin(context);
 const grants=await cashierAccess.set(db,{id:context.userId,role:'Admin'},staffId,permissions);
 return{ok:true,userId:Number(staffId),permissions:grants};
}
async function cashiers(db,context){
 requireAdmin(context);
 const grants=await cashierAccess.forWorkspace(db,context.workspaceId);
 const r=await db.query('SELECT u.id,COALESCE(u.login_username,u.username) AS username,'+
  'u.full_name,u.branch_id,u.active FROM users u JOIN chat_memberships m ON m.user_id=u.id '+
  'WHERE m.workspace_id=$1 AND u.role=$2 ORDER BY u.id DESC',[context.workspaceId,'User']);
 return r.rows.map(x=>({id:Number(x.id),username:x.username,fullName:x.full_name||'',
  branchId:Number(x.branch_id||0),active:on(x.active),permissions:grants.get(Number(x.id))||[]}));
}
module.exports={candidate,setup,active,branch,branches,createBranch,createCashier,cashiers,
 updateCashier,deactivateCashier,setCashierPermissions,requirePaid,requireAdmin,requireCashier,fail,goodId,on};
