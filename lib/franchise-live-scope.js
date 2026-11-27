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
  "p.next_payment_date AS trial_end,p.status AS subscription_status,COALESCE(p.plan,CASE WHEN r.requested_plan IN ('FREE','TRIAL') THEN 'TRIAL' END) AS subscription_plan,m.workspace_id AS membership_workspace,"+
  'am.data_mode AS data_mode,'+
  'u.role,u.branch_id AS user_branch_id,u.active AS user_active,w.owner_user_id,'+
  'b.active AS starter_active '+
  'FROM chat_memberships m JOIN franchise_test_accounts t ON t.workspace_id=m.workspace_id '+
  'JOIN users u ON u.id=m.user_id JOIN chat_workspaces w ON w.id=t.workspace_id '+
  'JOIN public_franchise_requests r ON r.id=t.request_id '+
  'JOIN branches b ON b.id=t.branch_id '+
  'LEFT JOIN platform_account_plans p ON p.workspace_id=t.workspace_id '+
  'LEFT JOIN franchise_account_modes am ON am.workspace_id=t.workspace_id WHERE m.user_id=$1',[uid]);
 if(r.rows.length===0)return null;
 if(r.rows.length!==1)throw fail('Ambiguous franchise workspace assignment.');
 const x=r.rows[0],ws=goodId(x.workspace_id),ownerId=goodId(x.owner_id);
 if(x.data_mode===null||x.data_mode===undefined||x.data_mode==='TEMPORARY')return null; // Explicit NEW registration required; no implicit sandbox promotion.
 if(x.data_mode!=='NEW')throw fail('Franchise account mode does not permit live checkout.');
 if(!ws||!ownerId||goodId(x.membership_workspace)!==ws||
    goodId(x.owner_user_id)!==ownerId||!on(x.user_active)||!on(x.starter_active))
  throw fail('Franchise account ownership or login is inconsistent.');
 return{requestId:x.request_id,workspaceId:ws,ownerId,dataMode:'NEW',
  starterBranchId:goodId(x.starter_branch_id),
  userId:uid,role:x.role,userBranchId:goodId(x.user_branch_id),
  subscriptionStatus:x.subscription_status||(x.subscription_plan==='FREE'?'FREE':'NOT_CONFIGURED'),
  subscriptionPlan:x.subscription_plan||null,
  trialSelectionRequired:x.subscription_plan==='TRIAL',
  liveEnabled:x.subscription_status==='PAID'||(x.subscription_status==='TRIAL'&&Date.parse(x.trial_end)>Date.now())};
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
 const rows=(await db.query('SELECT b.id,b.name,b.address,b.city,b.province,b.postal_code,'+
  'b.country,b.phone,b.description,b.active,'+
  '(SELECT COUNT(*) FROM branch_live_sales sl WHERE sl.workspace_id=w.workspace_id ' +
  'AND sl.branch_id=b.id AND sl.status=$3) AS sales_count,'+
  '(SELECT COUNT(*) FROM users u JOIN chat_memberships m ON m.user_id=u.id '+
  "WHERE m.workspace_id=w.workspace_id AND u.branch_id=b.id AND u.role='User' AND u.active=$2) AS staff_count "+
  'FROM chat_workspace_branches w '+
  'JOIN branches b ON b.id=w.branch_id '+
  'JOIN branch_catalog_provisioning c ON c.workspace_id=w.workspace_id AND c.branch_id=w.branch_id '+
  'WHERE w.workspace_id=$1 ORDER BY b.name',[context.workspaceId,true,'Sold'])).rows;
 return rows.filter(x=>context.admin||(Number(x.id)===context.branchId&&on(x.active)))
  .map(x=>({id:Number(x.id),name:x.name,address:x.address||'',city:x.city||'',
   province:x.province||'',postalCode:x.postal_code||'',country:x.country||'Philippines',
   phone:x.phone||'',description:x.description||'',active:on(x.active),usersCount:Number(x.staff_count||0),salesCount:Number(x.sales_count||0)}));
}
function requireAdmin(context){if(!context.admin)throw fail('Owner or Co-Owner access is required.');}
function requireCashier(context){if(!context.cashier)throw fail('Only a cashier can process live transactions. Create a cashier account in User Management.');}
function passwordHash(password){
 const salt=crypto.randomBytes(16).toString('hex');
 return'scrypt$'+salt+'$'+crypto.scryptSync(password,salt,64).toString('hex');
}
async function replaceCashierGrants(tx,context,userId,permissions){
 // Employee and permission changes are committed together or rolled back together.
 const keys=cashierAccess.normalize(permissions);
 await tx.query('DELETE FROM cashier_feature_grants WHERE workspace_id=$1 AND user_id=$2',
  [context.workspaceId,userId]);
 for(const permission of keys){
  await tx.query('INSERT INTO cashier_feature_grants(workspace_id,user_id,permission_key,granted_by) '+
   'VALUES($1,$2,$3,$4)',[context.workspaceId,userId,permission,context.userId]);
 }
 return keys;
}
async function createCashier(db,context,data){
 requireAdmin(context);
 const username=String(data.username||'').trim(),password=String(data.password||''),
  fullName=String(data.fullName||'').trim(),email=String(data.email||'').trim().toLowerCase(),
  phone=String(data.phone||'').trim(),photo=data.photoData??null;
 const permissions=cashierAccess.normalize(data.accessPermissions??[]);
 if(email&&(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>320))throw fail('Enter a valid employee email address.',400);
 if(phone.length>40||photo!==null&&(typeof photo!=='string'||photo.length>200000||
    !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(photo)))
  throw fail('Invalid employee phone number or profile photo.',400);
 if(!/^[A-Za-z0-9._-]{3,80}$/.test(username)||password.length<10||password.length>128||
   !/[A-Za-z]/.test(password)||!/[0-9]/.test(password)||!fullName||fullName.length>120)
   throw fail('Enter a unique username, employee name, and a password of at least 10 characters with letters and numbers.',400);
 const b=await branch(db,context,data.branchId||context.starterBranchId);
 const hash=passwordHash(password);
 return db.transaction(async tx=>{
  const exists=(await tx.query('SELECT id FROM users WHERE LOWER(username)=LOWER($1) OR '+
    'LOWER(COALESCE(login_username,username))=LOWER($1)',[username])).rows;
  if(exists.length)throw fail('Username is already taken.',409);
  if(email&&(await tx.query('SELECT id FROM users WHERE LOWER(TRIM(email))=$1 LIMIT 1',[email])).rows.length)
   throw fail('Email is already registered to another user.',409);
  const created=(await tx.query('INSERT INTO users(username,login_username,password_hash,role,active,'+
    'created_at,full_name,branch_id,owner_scope_id,email,phone,profile_photo) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id',
    [username,username,hash,'User',true,new Date().toISOString(),fullName,b.id,context.workspaceId,email||null,phone||null,photo])).rows[0];
  await tx.query('INSERT INTO chat_memberships(user_id,workspace_id) VALUES($1,$2)',
    [Number(created.id),context.workspaceId]);
  await replaceCashierGrants(tx,context,Number(created.id),permissions);
  return{ok:true,id:Number(created.id),username,branchId:b.id,role:'User',permissions};
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
 const permissions=Object.prototype.hasOwnProperty.call(data||{},'accessPermissions')
  ?cashierAccess.normalize(data.accessPermissions):null;
 if(email.length>320||phone.length>40||photo!==null&&
  (typeof photo!=='string'||photo.length>200000||!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(photo)))
  throw fail('Invalid employee contact information or photo.',400);
 return db.transaction(async tx=>{
  if(email&&(await tx.query('SELECT id FROM users WHERE LOWER(TRIM(email))=LOWER($1) AND id<>$2 LIMIT 1',[email,targetId])).rows.length)
   throw fail('Email is already registered to another user.',409);
  const found=(await tx.query('SELECT u.id,u.role FROM users u JOIN chat_memberships m ON m.user_id=u.id '+
   'WHERE m.workspace_id=$1 AND u.id=$2'+(tx.engine==='postgres'?' FOR UPDATE OF u':''),
   [context.workspaceId,targetId])).rows[0];
  if(!found||found.role!=='User')throw fail('Cashier not found in your franchise.',404);
  // Scoped modification; no account is deleted, preserving sale receipts and audit provenance.
  await tx.query('UPDATE users SET full_name=$1,branch_id=$2,active=$3,'+
   'email=CAST($4 AS TEXT),phone=$5,profile_photo=$6,'+
   'email_verified_at=CASE WHEN LOWER(COALESCE(email,\'\'))=LOWER(COALESCE(CAST($4 AS TEXT),\'\')) THEN email_verified_at ELSE NULL END '+
   'WHERE id=$7 AND role=$8',
   [fullName,assigned.id,active,email||null,phone||null,photo,targetId,'User']);
  if(optionalPass)await tx.query('UPDATE users SET password_hash=$1 WHERE id=$2 AND role=$3',
   [passwordHash(optionalPass),targetId,'User']);
  if(permissions!==null)await replaceCashierGrants(tx,context,targetId,permissions);
  if(!active)await tx.query('DELETE FROM sessions WHERE user_id=$1',[targetId]);
  return{ok:true,id:targetId,branchId:assigned.id,active,permissions};
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

async function updateBranch(db,context,requestedBranchId,data){
 requireAdmin(context);
 const branchId=goodId(requestedBranchId),title=String(data?.name||'').trim(),
  address=String(data?.address||'').trim();
 if(!branchId||title.length<3||title.length>120||address.length>250)
  throw fail('Enter a branch name of 3–120 characters and an address of up to 250.',400);
 const info={city:String(data.city||'').trim(),province:String(data.province||'').trim(),
  postalCode:String(data.postalCode||'').trim(),country:String(data.country||'Philippines').trim(),
  phone:String(data.phone||'').trim(),description:String(data.description||'').trim()};
 for(const [key,length] of Object.entries({city:100,province:100,postalCode:12,country:80,phone:32,description:500})){
  if(info[key].length>length)throw fail(key+' exceeds '+length+' characters.',400);
 }
 return db.transaction(async tx=>{
  await branchPlans.lock(tx,context.workspaceId);
  const existing=(await tx.query('SELECT b.id,b.active FROM branches b '+
   'JOIN chat_workspace_branches w ON w.branch_id=b.id '+
   'WHERE w.workspace_id=$1 AND b.id=$2'+(tx.engine==='postgres'?' FOR UPDATE OF b':''),
   [context.workspaceId,branchId])).rows[0];
  if(!existing)throw fail('Branch not found in your franchise.',404);
  const active=data.active!==false;
  if(!active&&branchId===context.starterBranchId)
   throw fail('The starter branch must remain active for franchise login. Transfer primary ownership before disabling it.',409);
  if(active&&!on(existing.active)){
   const entitlement=await branchPlans.entitlements(tx,context.workspaceId);
   if(entitlement.plan==='PRO'&&entitlement.activeBranches>=3)
    throw fail('Pro plan allows three active branches. Upgrade to Business or deactivate another branch.',409);
  }
  const conflict=(await tx.query('SELECT 1 FROM chat_workspace_branches w JOIN branches b ON b.id=w.branch_id '+
   'WHERE w.workspace_id=$1 AND w.branch_id<>$2 AND LOWER(b.name)=LOWER($3) LIMIT 1',
   [context.workspaceId,branchId,title])).rows;
  if(conflict.length)throw fail('Another branch in your franchise already has this name.',409);
  await tx.query('UPDATE branches SET name=$1,address=$2,city=$3,province=$4,postal_code=$5,'+
   'country=$6,phone=$7,description=$8,active=$9 WHERE id=$10',
   [title,address,info.city,info.province,info.postalCode,info.country,info.phone,info.description,active,branchId]);
  await branchPlans.updateRenewalTotal(tx,context.workspaceId);
  return{ok:true,id:branchId,active};
 });
}
async function deactivateBranch(db,context,requestedBranchId){
 requireAdmin(context);
 const branchId=goodId(requestedBranchId);
 if(!branchId)throw fail('Select a branch.',400);
 if(branchId===context.starterBranchId)
  throw fail('The starter branch cannot be disabled because it anchors franchise login.',409);
 const current=(await db.query('SELECT b.name FROM chat_workspace_branches w '+
  'JOIN branches b ON b.id=w.branch_id WHERE w.workspace_id=$1 AND w.branch_id=$2',
  [context.workspaceId,branchId])).rows[0];
 if(!current)throw fail('Branch not found in your franchise.',404);
 return updateBranch(db,context,branchId,{name:current.name,active:false});
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
  'u.full_name,u.branch_id,u.active,u.email,u.email_verified_at,u.phone,u.profile_photo,b.name AS branch_name '+
  'FROM users u JOIN chat_memberships m ON m.user_id=u.id '+
  'LEFT JOIN branches b ON b.id=u.branch_id '+
  'WHERE m.workspace_id=$1 AND u.role=$2 ORDER BY u.id DESC',[context.workspaceId,'User']);
 return r.rows.map(x=>({id:Number(x.id),username:x.username,fullName:x.full_name||'',
  branchId:Number(x.branch_id||0),branchName:x.branch_name||'',active:on(x.active),
  email:x.email||'',emailVerified:!!x.email_verified_at,phone:x.phone||'',photoData:x.profile_photo||null,
  permissions:grants.get(Number(x.id))||[]}));
}
module.exports={candidate,setup,active,branch,branches,createBranch,createCashier,cashiers,
 updateCashier,deactivateCashier,updateBranch,deactivateBranch,setCashierPermissions,
 requirePaid,requireAdmin,requireCashier,fail,goodId,on};
