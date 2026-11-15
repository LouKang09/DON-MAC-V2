'use strict';
// Account provisioning for isolated franchise workspaces. Explicit sandboxes remain temporary.
const crypto=require('node:crypto');
const catalogSeed=require('./branch-catalog-seeding');
const catalogRead=require('./branch-catalog-read');
const accountModes=require('./franchise-account-modes');
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const now=()=>new Date().toISOString();
const validId=x=>Number.isSafeInteger(Number(x))&&Number(x)>0?Number(x):0;
function hashed(pass){
 const salt=crypto.randomBytes(16).toString('hex');
 return 'scrypt$'+salt+'$'+crypto.scryptSync(pass,salt,64).toString('hex');
}
async function migrate(db){
 const fk=db.engine==='postgres'?'BIGINT':'INTEGER';
 await db.exec('CREATE TABLE IF NOT EXISTS franchise_test_accounts ('+
  'request_id VARCHAR(40) PRIMARY KEY REFERENCES public_franchise_requests(id) ON DELETE RESTRICT,'+
  'user_id '+fk+' NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,'+
  'workspace_id '+fk+' NOT NULL UNIQUE REFERENCES chat_workspaces(id) ON DELETE RESTRICT,'+
  'branch_id '+fk+' NOT NULL UNIQUE REFERENCES branches(id) ON DELETE RESTRICT,'+
  'created_at TEXT NOT NULL,created_by VARCHAR(100) NOT NULL)');
}
async function account(db,userId){
 const uid=validId(userId);if(!uid)return null;
 const r=await db.query('SELECT t.request_id,t.user_id,t.workspace_id,t.branch_id, '+
  'm.workspace_id AS membership_workspace,w.owner_user_id,b.active AS branch_active '+
  'FROM franchise_test_accounts t '+
  'JOIN chat_memberships m ON m.user_id=t.user_id '+
  'JOIN chat_workspaces w ON w.id=t.workspace_id '+
  'JOIN branches b ON b.id=t.branch_id '+
  'JOIN chat_workspace_branches wb ON wb.workspace_id=t.workspace_id AND wb.branch_id=t.branch_id '+
  'WHERE t.user_id=$1',[uid]);
 if(!r.rows.length)return null;
 const x=r.rows[0];
 if(Number(x.membership_workspace)!==Number(x.workspace_id)||Number(x.owner_user_id)!==uid||
    !(x.branch_active===true||x.branch_active===1||x.branch_active==='1'))
  throw fail('Franchise account ownership is inconsistent. Contact Admin Control.',403);
 return{requestId:x.request_id,userId:uid,workspaceId:validId(x.workspace_id),
  branchId:validId(x.branch_id),testMode:true};
}
async function activate(db,requestId,actor,{temporary=false}={}){
 if(!/^[0-9a-f-]{36}$/i.test(String(requestId||'')))throw fail('Invalid franchise application ID.');
 return db.transaction(async tx=>{
  if(tx.engine==='postgres')await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',['phase2-test-'+requestId]);
  const existing=(await tx.query('SELECT user_id FROM franchise_test_accounts WHERE request_id=$1',[requestId])).rows;
  if(existing.length)throw fail('This franchise account already exists. Credentials are shown only once.',409);
  const x=(await tx.query('SELECT r.id,r.username,r.full_name,r.email,r.phone,r.status,r.email_verified_at, '+
    's.stage_status,s.template_version,r.requested_plan FROM public_franchise_requests r '+
    'JOIN franchise_provisioning_stages s ON s.request_id=r.id WHERE r.id=$1',[requestId])).rows[0];
  if(!x)throw fail('Verify the application email and prepare its starter catalog before testing.',409);
  if(x.status!=='CONTACTED')throw fail('Mark the applicant Contacted (reviewed) before enabling a test login.',409);
  if(!x.email_verified_at)throw fail('Applicant email verification is required.',409);
  if(x.stage_status!=='PREPARED_NO_ACCESS')throw fail('Independent starter catalog must be prepared first.',409);
  const username=String(x.username);
  const duplicates=(await tx.query('SELECT id FROM users WHERE LOWER(username)=LOWER($1) OR '+
    'LOWER(COALESCE(login_username,username))=LOWER($1) LIMIT 1',[username])).rows;
  if(duplicates.length)throw fail('Username already belongs to a live account. Choose another application username.',409);
  const password=crypto.randomBytes(18).toString('base64url');
  const instant=now();
  const u=await tx.query('INSERT INTO users '+
   '(username,login_username,password_hash,role,active,created_at,full_name,email,phone) '+
   'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
   [username,username,hashed(password),'Admin',true,instant,x.full_name,x.email,x.phone]);
  const userId=validId(u.rows[0]?.id);
  if(!userId)throw fail('Franchise owner was not created.',500);
  const w=await tx.query('INSERT INTO chat_workspaces(owner_user_id) VALUES($1) RETURNING id',[userId]);
  const workspaceId=validId(w.rows[0]?.id);
  await tx.query('INSERT INTO chat_memberships(user_id,workspace_id) VALUES($1,$2)',[userId,workspaceId]);
  await tx.query('UPDATE users SET owner_scope_id=$1 WHERE id=$2',[workspaceId,userId]);
  const branchName='Starter Branch · '+username;
  const b=await tx.query('INSERT INTO branches(name,address,active) VALUES($1,$2,$3) RETURNING id',
   [branchName,'Independent franchise starter inventory',true]);
  const branchId=validId(b.rows[0]?.id);
  await tx.query('INSERT INTO chat_workspace_branches(branch_id,workspace_id) VALUES($1,$2)',[branchId,workspaceId]);
  const master=await catalogSeed.readTemplate(tx);
  if(Number(x.template_version)!==catalogSeed.TEMPLATE_VERSION)throw fail('Starter template version changed; review before activation.',409);
  const created=await catalogSeed.seedBranch(tx,workspaceId,branchId,master,0,userId);
  if(created.status!=='prepared'||created.openingStock!==0)throw fail('Could not initialize zero-stock branch test catalog.',409);
  await tx.query('INSERT INTO franchise_test_accounts(request_id,user_id,workspace_id,branch_id,created_at,created_by) '+
   'VALUES($1,$2,$3,$4,$5,$6)',
   [requestId,userId,workspaceId,branchId,instant,String(actor||'Admin Control').slice(0,100)]);
  await accountModes.register(tx,workspaceId,temporary?accountModes.MODES.TEMPORARY:accountModes.MODES.NEW,
   temporary?'Admin Control sandbox activation':'Admin Control verified franchise activation');
  // New accounts record only the requested plan, never an assumed Paid status.
  if(['PRO','BUSINESS'].includes(String(x.requested_plan||'').toUpperCase()))
   await tx.query('INSERT INTO platform_account_plan_requests('+
    'workspace_id,requested_plan,requested_at,requested_by,keep_branch_ids) '+
    'VALUES($1,$2,$3,$4,$5) ON CONFLICT(workspace_id) DO NOTHING',
    [workspaceId,String(x.requested_plan).toUpperCase(),instant,userId,'[]']);
  // No billing status, sales, payments, legacy stock or customer data is copied.
  return{ok:true,liveMode:!temporary,setupMode:!temporary,testMode:temporary,
    dataMode:temporary?'TEMPORARY':'NEW',username,password,workspaceId,branchId,openingStock:0,
    portal:temporary?'/phase2-test.html':'/',message:temporary?
    'Explicit sandbox account created with independent zero-stock test inventory. Production sales are disabled.':
    'Live franchise account created. Sign in to the normal Main POS, configure branches and cashiers, then mark the subscription Paid in Admin Control to activate cashier selling.'};
 });
}
// OTP-verified self-service signup provisions only the isolated test/onboarding
// workspace. Normal POS, billing, global Admin and legacy catalog routes remain
// denylisted by the server's Phase 2 test-account gate.
function validateSignupPassword(password,confirmation){
 const value=String(password??''),confirm=String(confirmation??'');
 if(value.length<10||value.length>128||!/[A-Za-z]/.test(value)||!/[0-9]/.test(value))
  throw fail('Choose a password of 10–128 characters containing at least one letter and one number.');
 if(value!==confirm)throw fail('Passwords do not match.');
 return value;
}
async function activateVerifiedSignup(tx,requestId,password){
 if(!/^[0-9a-f-]{36}$/i.test(String(requestId||'')))throw fail('Invalid franchise application ID.');
 const x=(await tx.query('SELECT id,username,full_name,email,phone,status,email_verified_at,requested_plan '+
   'FROM public_franchise_requests WHERE id=$1',[requestId])).rows[0];
 if(!x||!x.email_verified_at||!['PENDING','CONTACTED'].includes(x.status))
  throw fail('The email OTP must be verified before creating this account.',403);
 const existing=(await tx.query('SELECT user_id FROM franchise_test_accounts WHERE request_id=$1',[requestId])).rows;
 if(existing.length)throw fail('An account has already been created for this request. Sign in instead.',409);
 const duplicates=(await tx.query('SELECT id FROM users WHERE LOWER(username)=LOWER($1) OR '+
   'LOWER(COALESCE(login_username,username))=LOWER($1) LIMIT 1',[x.username])).rows;
 if(duplicates.length)throw fail('This username was registered while your OTP was pending. Choose another username.',409);
 const user=(await tx.query('INSERT INTO users '+
  '(username,login_username,password_hash,role,active,created_at,full_name,email,phone) '+
  'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
  [x.username,x.username,hashed(password),'Admin',true,now(),x.full_name,x.email,x.phone])).rows[0];
 const userId=validId(user?.id);
 if(!userId)throw fail('The new owner account could not be created.',500);
 const ws=(await tx.query('INSERT INTO chat_workspaces(owner_user_id) VALUES($1) RETURNING id',[userId])).rows[0];
 const workspaceId=validId(ws?.id);
 await tx.query('INSERT INTO chat_memberships(user_id,workspace_id) VALUES($1,$2)',[userId,workspaceId]);
 await tx.query('UPDATE users SET owner_scope_id=$1 WHERE id=$2',[workspaceId,userId]);
 const b=(await tx.query('INSERT INTO branches(name,address,active) VALUES($1,$2,$3) RETURNING id',
  ['Starter Branch · '+x.username,'Franchise isolated onboarding inventory',true])).rows[0];
 const branchId=validId(b?.id);
 await tx.query('INSERT INTO chat_workspace_branches(branch_id,workspace_id) VALUES($1,$2)',[branchId,workspaceId]);
 const template=await catalogSeed.readTemplate(tx);
 const seeded=await catalogSeed.seedBranch(tx,workspaceId,branchId,template,0,userId);
 if(seeded.status!=='prepared'||seeded.openingStock!==0)
  throw fail('The isolated starter catalog could not be created. Please retry.',409);
 await tx.query('INSERT INTO franchise_test_accounts(request_id,user_id,workspace_id,branch_id,created_at,created_by) '+
  'VALUES($1,$2,$3,$4,$5,$6)',
  [requestId,userId,workspaceId,branchId,now(),'Verified self-service signup']);
 await accountModes.register(tx,workspaceId,accountModes.MODES.NEW,'Verified self-service signup');
 if(['PRO','BUSINESS'].includes(String(x.requested_plan||'').toUpperCase()))
  await tx.query('INSERT INTO platform_account_plan_requests('+
   'workspace_id,requested_plan,requested_at,requested_by,keep_branch_ids) '+
   'VALUES($1,$2,$3,$4,$5) ON CONFLICT(workspace_id) DO NOTHING',
   [workspaceId,String(x.requested_plan).toUpperCase(),now(),userId,'[]']);
 return{created:true,username:x.username,portal:'/',dataMode:'NEW',
  liveMode:true,setupMode:true,testMode:false,
  message:'Email verified. Your franchise account is ready. Sign in to the main POS to configure branches and cashiers while the requested '+String(x.requested_plan||'subscription')+' plan awaits Admin Control assignment. Cashiers can sell only after the subscription is marked Paid.'};
}
// Upgrade one EXISTING, verified sandbox into the normal, isolated Main POS.
// Only Admin Control can call this; existing legacy SHARED accounts are never changed.
// Historical sandbox simulated sales remain separate from real commercial receipts.
async function promote(db,requestId,actor){
 if(!/^[0-9a-f-]{36}$/i.test(String(requestId||'')))throw fail('Invalid franchise application ID.');
 return db.transaction(async tx=>{
  if(tx.engine==='postgres')await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',['promote-main-pos-'+requestId]);
  const rows=(await tx.query('SELECT t.user_id,t.workspace_id,t.branch_id,r.username,r.email_verified_at,'+
   'u.active,w.owner_user_id,b.active AS branch_active,a.data_mode FROM franchise_test_accounts t '+
   'JOIN public_franchise_requests r ON r.id=t.request_id '+
   'JOIN users u ON u.id=t.user_id JOIN chat_workspaces w ON w.id=t.workspace_id '+
   'JOIN branches b ON b.id=t.branch_id '+
   'LEFT JOIN franchise_account_modes a ON a.workspace_id=t.workspace_id '+
   'WHERE t.request_id=$1',[requestId])).rows;
  if(rows.length!==1)throw fail('Franchise account not found in the applications list.',404);
  const x=rows[0],workspaceId=validId(x.workspace_id),ownerId=validId(x.user_id),branchId=validId(x.branch_id);
  if(!workspaceId||!branchId||!ownerId||validId(x.owner_user_id)!==ownerId||!x.email_verified_at)
   throw fail('A verified franchise owner and independent starter workspace are required.',409);
  if(!(x.active===true||x.active===1||x.active==='1')||
     !(x.branch_active===true||x.branch_active===1||x.branch_active==='1'))
   throw fail('Enable the franchise login and starter branch before activating Main POS.',409);
  const member=(await tx.query('SELECT 1 FROM chat_memberships WHERE user_id=$1 AND workspace_id=$2',
   [ownerId,workspaceId])).rows;
  const prepared=(await tx.query('SELECT 1 FROM branch_catalog_provisioning WHERE workspace_id=$1 AND branch_id=$2',
   [workspaceId,branchId])).rows;
  if(member.length!==1||prepared.length!==1)throw fail('Account membership or starter catalog is not ready.',409);
  if(x.data_mode&&x.data_mode!=='TEMPORARY'&&x.data_mode!=='NEW')
   throw fail('This account mode cannot be promoted to a live franchise.',409);
  if(x.data_mode==='TEMPORARY'){
   const done=await tx.query('UPDATE franchise_account_modes SET data_mode=$1,assigned_at=CURRENT_TIMESTAMP,'+
    'assigned_by=$2 WHERE workspace_id=$3 AND data_mode=$4 RETURNING workspace_id',
    [accountModes.MODES.NEW,String(actor||'Admin Control').slice(0,100),workspaceId,accountModes.MODES.TEMPORARY]);
   if(done.rows.length!==1)throw fail('The account mode was changed concurrently; retry.',409);
  }else if(!x.data_mode){
   await accountModes.register(tx,workspaceId,accountModes.MODES.NEW,actor||'Admin Control');
  }
  // Force a fresh sign-in so the browser receives current role, mode and permissions.
  await tx.query('DELETE FROM sessions WHERE user_id IN ' +
   '(SELECT user_id FROM chat_memberships WHERE workspace_id=$1)',[workspaceId]);
  return{ok:true,alreadyLive:x.data_mode==='NEW',username:x.username,workspaceId,branchId,
   dataMode:'NEW',portal:'/',message:'Sign in to donmacpos.com for the original Main POS. Cashier sales require a Paid plan.'};
 });
}
// One-time, opt-in operator cutover for the user's existing test1 account.
// No other username is eligible; the same verification and workspace checks as
// the Admin Control action apply. If the account does not exist, do nothing.
async function promoteTest1OnLaunch(db){
 const rows=(await db.query('SELECT t.request_id FROM franchise_test_accounts t '+
  'JOIN users u ON u.id=t.user_id WHERE LOWER(COALESCE(u.login_username,u.username))=$1 LIMIT 2',
  ['test1'])).rows;
 if(!rows.length)return{status:'not-found',username:'test1'};
 if(rows.length!==1)throw fail('Ambiguous test1 accounts. Use Admin Control.',409);
 const result=await promote(db,rows[0].request_id,'Authorized test1 Main POS cutover');
 return{status:result.alreadyLive?'already-live':'promoted',username:'test1',workspaceId:result.workspaceId};
}
async function setEnabled(db,requestId,enabled,actor){
 if(!/^[0-9a-f-]{36}$/i.test(String(requestId||''))||typeof enabled!=='boolean')
   throw fail('Specify a valid franchise account and access state.');
 return db.transaction(async tx=>{
  const t=(await tx.query('SELECT user_id FROM franchise_test_accounts WHERE request_id=$1',[requestId])).rows[0];
  if(!t)throw fail('Franchise account was not found.',404);
  const change=await tx.query('UPDATE users SET active=$1 WHERE id=$2 RETURNING id',[enabled,Number(t.user_id)]);
  if(!change.rows.length)throw fail('Franchise account user was not found.',404);
  if(!enabled)await tx.query('DELETE FROM sessions WHERE user_id=$1',[Number(t.user_id)]);
  return{ok:true,testMode:true,enabled,updatedBy:String(actor||'Admin Control').slice(0,100)};
 });
}
async function overview(db,userId,requestedBranchId=null){
 const test=await account(db,userId);
 if(!test)throw fail('Phase 2 test account required.',403);
 if(requestedBranchId!==null&&String(requestedBranchId)!==''&&
    Number(requestedBranchId)!==test.branchId)throw fail('Branch belongs to a different test workspace.',403);
 const [catalog,inventory]=await Promise.all([
  catalogRead.catalog(db,test.workspaceId,test.branchId),
  catalogRead.inventory(db,test.workspaceId,test.branchId)
 ]);
 const branch=await db.query('SELECT b.name FROM branches b JOIN chat_workspace_branches w ON w.branch_id=b.id '+
   'WHERE w.workspace_id=$1 AND b.id=$2',[test.workspaceId,test.branchId]);
 return{ok:true,testMode:true,readOnly:true,liveCheckoutEnabled:false,workspaceId:test.workspaceId,
  branchId:test.branchId,branchName:branch.rows[0]?.name||'Phase 2 Test Branch',
  catalog,inventory,notice:'Independent test workspace. Checkout, cost changes, exports and shared Admin operations remain blocked until isolated implementation passes regression tests.'};
}
module.exports={migrate,account,activate,promote,promoteTest1OnLaunch,validateSignupPassword,activateVerifiedSignup,setEnabled,overview};
