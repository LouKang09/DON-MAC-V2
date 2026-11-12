'use strict';
const crypto=require('crypto');
const {sendMail}=require('./smtp');
const resend=require('./resend-otp');
const error=(message,status=400)=>Object.assign(new Error(message),{status});
const emailOk=e=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e||''))&&String(e).length<=180;
const normalizedEmail=e=>String(e||'').trim().toLowerCase();
const emailFingerprint=e=>crypto.createHash('sha256').update(normalizedEmail(e)).digest('hex');
const isConfigured=()=>resend.configured()||!!(process.env.SMTP_USER&&process.env.SMTP_PASS);
const MAX_REQUESTS=4,WINDOW_MS=60*60*1000;
const ipAttempts=new Map();
const validId=n=>Number.isSafeInteger(Number(n))&&Number(n)>0;
const active=v=>v===true||v===1||v==='1';
function passwordOk(s){return typeof s==='string'&&s.length>=10&&s.length<=256&&/[a-zA-Z]/.test(s)&&/[0-9]/.test(s);}
function rateKey(ip){return crypto.createHash('sha256').update(String(ip||'unknown').slice(0,130)).digest('hex');}
function rate(ip){
 const now=Date.now(),key=rateKey(ip);
 for(const [k,v] of ipAttempts)if(v.reset<now)ipAttempts.delete(k);
 if(ipAttempts.size>8000)ipAttempts.clear();
 const v=ipAttempts.get(key)||{count:0,reset:now+WINDOW_MS};
 if(v.count>=MAX_REQUESTS)throw error('Too many OTP requests. Try again later.',429);
 v.count++;ipAttempts.set(key,v);
}
async function migrate(db){
 await db.exec('CREATE TABLE IF NOT EXISTS account_password_otps ('+
  'user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,'+
  'secret_hash TEXT NOT NULL,expires_at TEXT NOT NULL,requested_at TEXT NOT NULL,'+
  'attempts INTEGER NOT NULL DEFAULT 0,workspace_id BIGINT REFERENCES chat_workspaces(id) ON DELETE RESTRICT,'+
  'email_sha256 VARCHAR(64),branch_id BIGINT REFERENCES branches(id) ON DELETE RESTRICT);');
 // Legacy OTPs are deliberately NOT backfilled. They expire and cannot be
 // redeemed until a user requests a new workspace-bound code.
 if(db.engine==='postgres'){
  await db.exec('ALTER TABLE account_password_otps ADD COLUMN IF NOT EXISTS workspace_id BIGINT REFERENCES chat_workspaces(id) ON DELETE RESTRICT');
  await db.exec('ALTER TABLE account_password_otps ADD COLUMN IF NOT EXISTS email_sha256 VARCHAR(64)');
  await db.exec('ALTER TABLE account_password_otps ADD COLUMN IF NOT EXISTS branch_id BIGINT REFERENCES branches(id) ON DELETE RESTRICT');
 }else{
  const columns=new Set((await db.query('PRAGMA table_info(account_password_otps)')).rows.map(r=>r.name));
  if(!columns.has('workspace_id'))await db.exec('ALTER TABLE account_password_otps ADD COLUMN workspace_id BIGINT REFERENCES chat_workspaces(id) ON DELETE RESTRICT');
  if(!columns.has('email_sha256'))await db.exec('ALTER TABLE account_password_otps ADD COLUMN email_sha256 VARCHAR(64)');
  if(!columns.has('branch_id'))await db.exec('ALTER TABLE account_password_otps ADD COLUMN branch_id BIGINT REFERENCES branches(id) ON DELETE RESTRICT');
 }
 await db.exec('CREATE INDEX IF NOT EXISTS idx_password_otp_workspace ON account_password_otps(workspace_id,user_id)');
}
function digest(code,salt){return crypto.scryptSync(code,salt,32).toString('hex');}
function match(code,stored){
 if(!/^[0-9]{6}$/.test(code))return false;
 const parts=String(stored||'').split(':');
 if(parts.length!==2||!/^[a-f0-9]{32}$/.test(parts[0])||!/^[a-f0-9]{64}$/.test(parts[1]))return false;
 return crypto.timingSafeEqual(Buffer.from(digest(code,parts[0]),'hex'),Buffer.from(parts[1],'hex'));
}
function mailOptions(to,code){
 return{host:process.env.SMTP_HOST||'smtp.gmail.com',port:Number(process.env.SMTP_PORT||465),
  user:process.env.SMTP_USER,pass:process.env.SMTP_PASS,
  from:process.env.SMTP_FROM||process.env.SMTP_USER,to,
  subject:'Don Macchiatos POS password reset code',
  text:'Your Don Macchiatos POS password reset code is: '+code+
  '\n\nThis code expires in 10 minutes. If you did not request a reset, you may ignore this email.'};
}
// Error intentionally gives the same response for unknown username, missing email,
// mismatched owner/workspace, ambiguous identity or a deactivated user.
const accountMissing=()=>error(
 'User not found. Check the POS username and registered Gmail/email address associated with your franchise or branch.',404);
const sameBranch=(a,b)=>a==null&&b==null||a!=null&&b!=null&&Number(a)===Number(b);
const accountLabel=({role,branchId})=>role==='Admin'?'owner/workspace':'branch';
async function resolveAccount(db,username,registeredEmail){
 const name=String(username||'').trim();
 const email=normalizedEmail(registeredEmail);
 if(name.length<2||name.length>180)throw error('Enter the POS account username.',400);
 if(!emailOk(email))throw error('Enter a valid registered Gmail/email address.',400);
 // Never guess a workspace from the supplied email. Require exact username AND
 // address, and independently validate the user's stored workspace/branch map.
 const rows=(await db.query(
  'SELECT u.id,u.email,u.active,u.role,u.branch_id,m.workspace_id,'+
  'wb.branch_id AS mapped_branch_id,b.active AS branch_active '+
  'FROM users u LEFT JOIN chat_memberships m ON m.user_id=u.id '+
  'LEFT JOIN chat_workspace_branches wb ON wb.branch_id=u.branch_id AND wb.workspace_id=m.workspace_id '+
  'LEFT JOIN branches b ON b.id=u.branch_id '+
  'WHERE LOWER(COALESCE(u.login_username,u.username))=LOWER($1) '+
  'AND LOWER(u.email)=LOWER($2) LIMIT 10',
  [name,email])).rows;
 if(rows.length!==1)throw accountMissing();
 const u=rows[0];
 const isAdmin=u.role==='Admin';
 const branchId=u.branch_id==null?null:Number(u.branch_id);
 const branchMapped=branchId!=null&&validId(u.mapped_branch_id)&&
   Number(u.mapped_branch_id)===branchId;
 const validBranch=isAdmin?(branchId===null||branchMapped):
   u.role==='User'&&branchId!==null&&branchMapped&&active(u.branch_active);
 if(!validId(u.id)||!validId(u.workspace_id)||!active(u.active)||
    !validBranch||!emailOk(u.email))throw accountMissing();
 return{id:Number(u.id),workspaceId:Number(u.workspace_id),branchId,
  email:normalizedEmail(u.email),role:u.role,username:name};
}
async function request(db,username,registeredEmail,ip){
 if(!isConfigured())throw error('Email OTP is not configured. Contact the administrator to configure Resend.',503);
 rate(ip);
 const user=await resolveAccount(db,username,registeredEmail);
 const now=Date.now(),code=String(crypto.randomInt(0,1000000)).padStart(6,'0');
 const salt=crypto.randomBytes(16).toString('hex'),secret=salt+':'+digest(code,salt);
 const timestamp=new Date(now).toISOString();
 // One row per POS user with DB-side atomic 60-second resend cooldown.
 const saved=await db.query('INSERT INTO account_password_otps('+
  'user_id,workspace_id,branch_id,email_sha256,secret_hash,expires_at,requested_at,attempts) '+
  'VALUES($1,$2,$3,$4,$5,$6,$7,0) '+
  'ON CONFLICT(user_id) DO UPDATE SET workspace_id=excluded.workspace_id,'+
  'branch_id=excluded.branch_id,email_sha256=excluded.email_sha256,'+
  'secret_hash=excluded.secret_hash,expires_at=excluded.expires_at,'+
  'requested_at=excluded.requested_at,attempts=0 '+
  'WHERE account_password_otps.requested_at<=$8 RETURNING user_id',
  [user.id,user.workspaceId,user.branchId,emailFingerprint(user.email),secret,
   new Date(now+600000).toISOString(),timestamp,new Date(now-60000).toISOString()]);
 if(!saved.rows.length)
  return{ok:true,sent:false,cooldown:true,
   message:'An OTP was requested within the last minute. Check your registered email, including Spam, or try again after the cooldown.'};
 try{
  const delivery=resend.configured()?
    await resend.sendPasswordOtp({to:user.email,name:'POS user',code}):
    await sendMail(mailOptions(user.email,code));
  // Store the provider acceptance token for troubleshooting, never the OTP or
  // recipient email. Resend accepted is not the same as inbox delivered.
  console.log('Don Mac password OTP accepted',JSON.stringify({
   provider:delivery?.provider||'smtp',workspaceId:user.workspaceId,
   scope:accountLabel(user),messageId:delivery?.messageId||null
  }));
 }catch(e){
  console.error('Don Mac password OTP delivery rejected',JSON.stringify({
   reason:e?.code||'EMAIL_DELIVERY_ERROR',
   providerHttp:e?.providerStatus||null,
   providerError:e?.providerErrorName||null,
   workspaceId:user.workspaceId,scope:accountLabel(user)
  }));
  await db.query('DELETE FROM account_password_otps WHERE user_id=$1 AND workspace_id=$2 AND secret_hash=$3',
   [user.id,user.workspaceId,secret]);
  throw error(e?.userMessage||'The email provider did not accept the OTP. Contact the administrator to review the Resend logs.',503);
 }
 return{ok:true,sent:true,accepted:true,
  message:'Resend accepted your OTP request. Check the registered email address, including Spam. The code expires in 10 minutes.'};
}
async function confirm(db,username,registeredEmail,code,password,confirmPassword,hashPassword){
 if(!/^[0-9]{6}$/.test(String(code||'')))throw error('Enter the 6-digit OTP.',400);
 if(!passwordOk(password))throw error('Use 10–256 characters, including a letter and a number.');
 if(password!==confirmPassword)throw error('The new passwords do not match.');
 const user=await resolveAccount(db,username,registeredEmail);
 return db.transaction(async tx=>{
  // Lock the OTP AND user row on Postgres to prevent simultaneous replay or
  // a branch/email change during password reset.
  const suffix=tx.engine==='postgres'?' FOR UPDATE OF o,u':'';
  const found=(await tx.query(
   'SELECT o.secret_hash,o.expires_at,o.attempts,o.branch_id AS otp_branch_id,'+
   'o.workspace_id,o.email_sha256,u.branch_id AS current_branch_id '+
   'FROM account_password_otps o '+
   'JOIN users u ON u.id=o.user_id '+
   'JOIN chat_memberships m ON m.user_id=o.user_id AND m.workspace_id=o.workspace_id '+
   'LEFT JOIN chat_workspace_branches wb ON wb.branch_id=u.branch_id AND wb.workspace_id=m.workspace_id '+
   'WHERE o.user_id=$1 AND o.workspace_id=$2 AND u.active=$3 '+
   'AND LOWER(u.email)=$4 '+
   "AND (u.role='Admin' AND (u.branch_id IS NULL OR wb.branch_id IS NOT NULL) "+
   "OR u.role='User' AND u.branch_id IS NOT NULL AND wb.branch_id IS NOT NULL)"+suffix,
   [user.id,user.workspaceId,true,user.email])).rows[0];
  if(!found||!sameBranch(found.otp_branch_id,user.branchId)||
    !sameBranch(found.current_branch_id,user.branchId)||
    Date.now()>Date.parse(found.expires_at)||Number(found.attempts)>=5||
    !found.email_sha256||found.email_sha256!==emailFingerprint(user.email))
   throw error('Invalid or expired verification code.',400);
  if(!match(String(code),found.secret_hash)){
   await tx.query('UPDATE account_password_otps SET attempts=attempts+1 '+
    'WHERE user_id=$1 AND workspace_id=$2',[user.id,user.workspaceId]);
   return{ok:false};
  }
  const changed=await tx.query('UPDATE users SET password_hash=$1 WHERE id=$2 AND active=$3 '+
   'AND LOWER(email)=$4 '+
   'AND (branch_id=$5 OR (branch_id IS NULL AND $5 IS NULL)) '+
   'AND EXISTS (SELECT 1 FROM chat_memberships m WHERE m.user_id=$2 AND m.workspace_id=$6) RETURNING id',
   [hashPassword(password),user.id,true,user.email,user.branchId,user.workspaceId]);
  if(!changed.rows.length)throw error('Account ownership changed. Request another verification code.');
  await tx.query('DELETE FROM sessions WHERE user_id=$1',[user.id]);
  await tx.query('DELETE FROM account_password_otps WHERE user_id=$1 AND workspace_id=$2',
   [user.id,user.workspaceId]);
  return{ok:true};
 });
}
module.exports={migrate,request,confirm,isConfigured,passwordOk,resolveAccount,emailFingerprint,match};
