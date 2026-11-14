'use strict';
// Temporary, explicitly labeled Phase 2 test tenants. Not production franchise activation.
const crypto=require('node:crypto');
const catalogSeed=require('./branch-catalog-seeding');
const catalogRead=require('./branch-catalog-read');
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
  throw fail('Phase 2 test account ownership is inconsistent. Contact Admin Control.',403);
 return{requestId:x.request_id,userId:uid,workspaceId:validId(x.workspace_id),
  branchId:validId(x.branch_id),testMode:true};
}
async function activate(db,requestId,actor){
 if(!/^[0-9a-f-]{36}$/i.test(String(requestId||'')))throw fail('Invalid franchise application ID.');
 return db.transaction(async tx=>{
  if(tx.engine==='postgres')await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',['phase2-test-'+requestId]);
  const existing=(await tx.query('SELECT user_id FROM franchise_test_accounts WHERE request_id=$1',[requestId])).rows;
  if(existing.length)throw fail('This Phase 2 test account already exists. Credentials are shown only once.',409);
  const x=(await tx.query('SELECT r.id,r.username,r.full_name,r.email,r.phone,r.status,r.email_verified_at, '+
    's.stage_status,s.template_version FROM public_franchise_requests r '+
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
  if(!userId)throw fail('Test owner was not created.',500);
  const w=await tx.query('INSERT INTO chat_workspaces(owner_user_id) VALUES($1) RETURNING id',[userId]);
  const workspaceId=validId(w.rows[0]?.id);
  await tx.query('INSERT INTO chat_memberships(user_id,workspace_id) VALUES($1,$2)',[userId,workspaceId]);
  await tx.query('UPDATE users SET owner_scope_id=$1 WHERE id=$2',[workspaceId,userId]);
  const branchName='Phase 2 Test '+username+' '+crypto.randomBytes(4).toString('hex');
  const b=await tx.query('INSERT INTO branches(name,address,active) VALUES($1,$2,$3) RETURNING id',
   [branchName,'Isolated Phase 2 testing only',true]);
  const branchId=validId(b.rows[0]?.id);
  await tx.query('INSERT INTO chat_workspace_branches(branch_id,workspace_id) VALUES($1,$2)',[branchId,workspaceId]);
  const master=await catalogSeed.readTemplate(tx);
  if(Number(x.template_version)!==catalogSeed.TEMPLATE_VERSION)throw fail('Starter template version changed; review before activation.',409);
  const created=await catalogSeed.seedBranch(tx,workspaceId,branchId,master,0,userId);
  if(created.status!=='prepared'||created.openingStock!==0)throw fail('Could not initialize zero-stock branch test catalog.',409);
  await tx.query('INSERT INTO franchise_test_accounts(request_id,user_id,workspace_id,branch_id,created_at,created_by) '+
   'VALUES($1,$2,$3,$4,$5,$6)',
   [requestId,userId,workspaceId,branchId,instant,String(actor||'Admin Control').slice(0,100)]);
  // No billing status, sales, payments, legacy stock or customer data is copied.
  return{ok:true,testMode:true,username,password,workspaceId,branchId,openingStock:0,
    portal:'/phase2-test.html',message:'Temporary credentials are shown once. This isolated tenant can inspect its catalog, stock and access boundaries; checkout and global Admin CRUD remain blocked.'};
 });
}
async function setEnabled(db,requestId,enabled,actor){
 if(!/^[0-9a-f-]{36}$/i.test(String(requestId||''))||typeof enabled!=='boolean')
   throw fail('Specify a valid Phase 2 test account and access state.');
 return db.transaction(async tx=>{
  const t=(await tx.query('SELECT user_id FROM franchise_test_accounts WHERE request_id=$1',[requestId])).rows[0];
  if(!t)throw fail('Phase 2 test account was not found.',404);
  const change=await tx.query('UPDATE users SET active=$1 WHERE id=$2 RETURNING id',[enabled,Number(t.user_id)]);
  if(!change.rows.length)throw fail('Test account user was not found.',404);
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
module.exports={migrate,account,activate,setEnabled,overview};
