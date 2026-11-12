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
  'email_sha256 VARCHAR(64));');
 // Legacy OTPs are deliberately NOT backfilled. They expire and cannot be
 // redeemed until a user requests a new workspace-bound code.
 if(db.engine==='postgres'){
  await db.exec('ALTER TABLE account_password_otps ADD COLUMN IF NOT EXISTS workspace_id BIGINT REFERENCES chat_workspaces(id) ON DELETE RESTRICT');
  await db.exec('ALTER TABLE account_password_otps ADD COLUMN IF NOT EXISTS email_sha256 VARCHAR(64)');
 }else{
  const columns=new Set((await db.query('PRAGMA table_info(account_password_otps)')).rows.map(r=>r.name));
  if(!columns.has('workspace_id'))await db.exec('ALTER TABLE account_password_otps ADD COLUMN workspace_id BIGINT REFERENCES chat_workspaces(id) ON DELETE RESTRICT');
  if(!columns.has('email_sha256'))await db.exec('ALTER TABLE account_password_otps ADD COLUMN email_sha256 VARCHAR(64)');
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
const generic=()=>({ok:true,message:'If the account has a registered email, a reset code will be sent.'});
async function resolveAccount(db,identifier){
 const name=String(identifier||'').trim();
 if(name.length<2||name.length>180)return null;
 const rows=(await db.query(
  'SELECT u.id,u.email,u.active,m.workspace_id FROM users u '+
  'LEFT JOIN chat_memberships m ON m.user_id=u.id '+
  'WHERE LOWER(COALESCE(u.login_username,u.username))=LOWER($1) '+
  'OR LOWER(u.email)=LOWER($1) LIMIT 5',[name])).rows;
 // Email addresses can be reused by different franchise users. Never guess
 // which workspace owns a reset, even if only one match is active.
 if(rows.length!==1)return{rows,account:null};
 const row=rows[0];
 return{rows,account:active(row.active)&&emailOk(row.email)&&validId(row.workspace_id)&&validId(row.id)?
  {id:Number(row.id),workspaceId:Number(row.workspace_id),email:normalizedEmail(row.email)}:null};
}
async function request(db,identifier,ip){
 if(!isConfigured())throw error('Email OTP is not configured. Set RESEND_API_KEY in Railway (or configure SMTP).',503);
 rate(ip);
 const name=String(identifier||'').trim();
 if(name.length<2||name.length>180)throw error('Enter your username or email.',400);
 const result=await resolveAccount(db,name);
 if(!result)return generic();
 if(!name.includes('@')&&result.rows.length===1&&active(result.rows[0].active)&&!emailOk(result.rows[0].email))
  throw error('No email is affiliated with this username. Please contact your franchise Owner to add an email address to your account.',422);
 const user=result.account;
 if(!user)return generic();
 const now=Date.now(),code=String(crypto.randomInt(0,1000000)).padStart(6,'0');
 const salt=crypto.randomBytes(16).toString('hex'),secret=salt+':'+digest(code,salt);
 const timestamp=new Date(now).toISOString();
 // Conditional upsert gives the 60-second cooldown one atomic DB boundary.
 const saved=await db.query('INSERT INTO account_password_otps('+
  'user_id,workspace_id,email_sha256,secret_hash,expires_at,requested_at,attempts) '+
  'VALUES($1,$2,$3,$4,$5,$6,0) '+
  'ON CONFLICT(user_id) DO UPDATE SET workspace_id=excluded.workspace_id,'+
  'email_sha256=excluded.email_sha256,secret_hash=excluded.secret_hash,'+
  'expires_at=excluded.expires_at,requested_at=excluded.requested_at,attempts=0 '+
  'WHERE account_password_otps.requested_at<=$7 RETURNING user_id',
  [user.id,user.workspaceId,emailFingerprint(user.email),secret,
   new Date(now+600000).toISOString(),timestamp,new Date(now-60000).toISOString()]);
 if(!saved.rows.length)return generic();
 try{
  if(resend.configured())await resend.sendPasswordOtp({to:user.email,name:'POS user',code});
  else await sendMail(mailOptions(user.email,code));
 }catch(e){
  console.error('Don Mac password OTP delivery rejected',JSON.stringify({
   reason:e?.code||'EMAIL_DELIVERY_ERROR',providerHttp:e?.providerStatus||null,
   providerError:e?.providerErrorName||null
  }));
  await db.query('DELETE FROM account_password_otps WHERE user_id=$1 AND workspace_id=$2 AND secret_hash=$3',
   [user.id,user.workspaceId,secret]);
  throw error(e?.userMessage||'The email service could not send your OTP. Contact the administrator to review email delivery logs.',503);
 }
 return generic();
}
async function confirm(db,identifier,code,password,confirmPassword,hashPassword){
 const name=String(identifier||'').trim();
 if(name.length<2||name.length>180||!/^[0-9]{6}$/.test(String(code||'')))
  throw error('Invalid code or account details.');
 if(!passwordOk(password))throw error('Use 10–256 characters, including a letter and a number.');
 if(password!==confirmPassword)throw error('The new passwords do not match.');
 const resolved=await resolveAccount(db,name);
 if(!resolved?.account)throw error('Invalid or expired verification code.');
 const user=resolved.account;
 return db.transaction(async tx=>{
  const suffix=tx.engine==='postgres'?' FOR UPDATE OF o':'';
  const found=(await tx.query(
   'SELECT o.secret_hash,o.expires_at,o.attempts,o.workspace_id,o.email_sha256 '+
   'FROM account_password_otps o '+
   'JOIN chat_memberships m ON m.user_id=o.user_id AND m.workspace_id=o.workspace_id '+
   'JOIN users u ON u.id=o.user_id '+
   'WHERE o.user_id=$1 AND o.workspace_id=$2 AND u.active=$3 AND LOWER(u.email)=$4'+suffix,
   [user.id,user.workspaceId,true,user.email])).rows[0];
  if(!found||Date.now()>Date.parse(found.expires_at)||Number(found.attempts)>=5||
     !found.email_sha256||found.email_sha256!==emailFingerprint(user.email))
   throw error('Invalid or expired verification code.');
  if(!match(String(code),found.secret_hash)){
   await tx.query('UPDATE account_password_otps SET attempts=attempts+1 WHERE user_id=$1 AND workspace_id=$2',
    [user.id,user.workspaceId]);
   return{ok:false};
  }
  const changed=await tx.query('UPDATE users SET password_hash=$1 WHERE id=$2 AND active=$3 '+
   'AND LOWER(email)=$4 AND EXISTS (SELECT 1 FROM chat_memberships m WHERE m.user_id=$2 AND m.workspace_id=$5) RETURNING id',
   [hashPassword(password),user.id,true,user.email,user.workspaceId]);
  if(!changed.rows.length)throw error('Account ownership has changed. Request another verification code.');
  await tx.query('DELETE FROM sessions WHERE user_id=$1',[user.id]);
  await tx.query('DELETE FROM account_password_otps WHERE user_id=$1 AND workspace_id=$2',
   [user.id,user.workspaceId]);
  return{ok:true};
 });
}
module.exports={migrate,request,confirm,isConfigured,passwordOk,resolveAccount,emailFingerprint,match};
