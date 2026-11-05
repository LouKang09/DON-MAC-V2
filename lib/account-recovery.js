'use strict';
const crypto=require('crypto');
const {sendMail}=require('./smtp');
const resend=require('./resend-otp');
const error=(message,status=400)=>Object.assign(new Error(message),{status});
const emailOk=e=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e||''))&&String(e).length<=180;
const isConfigured=()=>resend.configured()||!!(process.env.SMTP_USER&&process.env.SMTP_PASS);
const MAX_REQUESTS=4,WINDOW_MS=60*60*1000;
const ipAttempts=new Map();
function passwordOk(s){return typeof s==='string'&&s.length>=10&&s.length<=256&&/[a-zA-Z]/.test(s)&&/[0-9]/.test(s);}
function rateKey(ip){return crypto.createHash('sha256').update(String(ip||'unknown').slice(0,130)).digest('hex');}
function rate(ip){
 const now=Date.now(),key=rateKey(ip);
 for(const [k,v] of ipAttempts){if(v.reset<now)ipAttempts.delete(k);}
 if(ipAttempts.size>8000)ipAttempts.clear();
 const v=ipAttempts.get(key)||{count:0,reset:now+WINDOW_MS};
 if(v.count>=MAX_REQUESTS)throw error('Too many OTP requests. Try again later.',429);
 v.count++;ipAttempts.set(key,v);
}
async function migrate(db){
 await db.exec('CREATE TABLE IF NOT EXISTS account_password_otps ('+
  'user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,'+
  'secret_hash TEXT NOT NULL,expires_at TEXT NOT NULL,requested_at TEXT NOT NULL,'+
  'attempts INTEGER NOT NULL DEFAULT 0);');
}
function digest(code,salt){
 return crypto.scryptSync(code,salt,32).toString('hex');
}
function match(code,stored){
 if(!/^[0-9]{6}$/.test(code))return false;
 const parts=String(stored||'').split(':');
 if(parts.length!==2||!/^[a-f0-9]{32}$/.test(parts[0])||!/^[a-f0-9]{64}$/.test(parts[1]))return false;
 const actual=Buffer.from(digest(code,parts[0]),'hex'),expected=Buffer.from(parts[1],'hex');
 return crypto.timingSafeEqual(actual,expected);
}
function mailOptions(to,code){
 return{host:process.env.SMTP_HOST||'smtp.gmail.com',port:Number(process.env.SMTP_PORT||465),
  user:process.env.SMTP_USER,pass:process.env.SMTP_PASS,
  from:process.env.SMTP_FROM||process.env.SMTP_USER,to,
  subject:'Don Macchiatos POS password reset code',
  text:'Your Don Macchiatos POS password reset code is: '+code+
  '\n\nThis code expires in 10 minutes. If you did not request a reset, you may ignore this email.'};
}
async function request(db,identifier,ip){
 if(!isConfigured())throw error('Email OTP is not configured. Set RESEND_API_KEY in Railway (or configure SMTP).',503);
 rate(ip);
 const name=String(identifier||'').trim();
 if(name.length<2||name.length>180)throw error('Enter your username or email.',400);
 const rows=(await db.query(
  'SELECT id,email,active FROM users WHERE LOWER(COALESCE(login_username,username))=LOWER($1) OR LOWER(email)=LOWER($1) LIMIT 5',
  [name])).rows;
 // Generic response prevents username/email enumeration.
 const generic={ok:true,message:'If the account has a registered email, a reset code will be sent.'};
 const active=rows.filter(x=>x.active===true||x.active===1||x.active==='1');
 // Explicit feedback is limited to a uniquely resolved, active username.
 // Email lookups, unknown users and duplicate aliases retain the generic
 // response so the endpoint does not disclose whether an email exists.
 if(!name.includes('@')&&rows.length===1&&active.length===1&&!emailOk(active[0].email)){
  throw error('No email is affiliated with this username. Please contact your franchise Owner to add an email address to your account.',422);
 }
 const eligible=active.filter(x=>emailOk(x.email));
 if(eligible.length!==1)return generic;
 const user=eligible[0],now=Date.now();
 const existing=(await db.query('SELECT requested_at FROM account_password_otps WHERE user_id=$1',[user.id])).rows[0];
 if(existing&&now-new Date(existing.requested_at).getTime()<60000)return generic;
 const code=String(crypto.randomInt(0,1000000)).padStart(6,'0');
 const salt=crypto.randomBytes(16).toString('hex'),secret=salt+':'+digest(code,salt);
 await db.query('INSERT INTO account_password_otps(user_id,secret_hash,expires_at,requested_at,attempts) VALUES($1,$2,$3,$4,0) '+
  'ON CONFLICT(user_id) DO UPDATE SET secret_hash=excluded.secret_hash,expires_at=excluded.expires_at,requested_at=excluded.requested_at,attempts=0',
  [user.id,secret,new Date(now+10*60000).toISOString(),new Date(now).toISOString()]);
 try{
  if(resend.configured())await resend.sendPasswordOtp({to:user.email,name:'POS user',code});
  else await sendMail(mailOptions(user.email,code));
 }
 catch(e){
  console.error('Don Mac password OTP delivery rejected',JSON.stringify({
   reason:e?.code||'EMAIL_DELIVERY_ERROR',
   providerHttp:e?.providerStatus||null,
   providerError:e?.providerErrorName||null
  }));
  await db.query('DELETE FROM account_password_otps WHERE user_id=$1 AND secret_hash=$2',[user.id,secret]);
  throw error(e?.userMessage||'The email service could not send your OTP. Please contact your administrator to review the email provider logs.',503);
 }
 return generic;
}
async function confirm(db,identifier,code,password,confirmPassword,hashPassword){
 const name=String(identifier||'').trim();
 if(name.length<2||name.length>180||!/^[0-9]{6}$/.test(String(code||'')))
  throw error('Invalid code or account details.');
 if(!passwordOk(password))throw error('Use 10–256 characters, including a letter and a number.');
 if(password!==confirmPassword)throw error('The new passwords do not match.');
 const rows=(await db.query('SELECT id FROM users WHERE LOWER(COALESCE(login_username,username))=LOWER($1) OR LOWER(email)=LOWER($1) LIMIT 5',[name])).rows;
 if(rows.length!==1)throw error('Invalid or expired verification code.');
 const id=rows[0].id;
 return db.transaction(async tx=>{
  const found=(await tx.query('SELECT secret_hash,expires_at,attempts FROM account_password_otps WHERE user_id=$1',[id])).rows[0];
  if(!found||Date.now()>new Date(found.expires_at).getTime()||Number(found.attempts)>=5)
    throw error('Invalid or expired verification code.');
  // All incorrect attempts are consumed even when the request fails.
  if(!match(String(code),found.secret_hash)){
   await tx.query('UPDATE account_password_otps SET attempts=attempts+1 WHERE user_id=$1',[id]);
   return{ok:false};
  }
  await tx.query('UPDATE users SET password_hash=$1 WHERE id=$2',[hashPassword(password),id]);
  await tx.query('DELETE FROM sessions WHERE user_id=$1',[id]);
  await tx.query('DELETE FROM account_password_otps WHERE user_id=$1',[id]);
  return{ok:true};
 });
}
module.exports={migrate,request,confirm,isConfigured,passwordOk};
