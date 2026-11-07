'use strict';
// Franchise email verification never creates credentials or activates a POS account.
const crypto=require('node:crypto');
const resend=require('./resend-otp');
const {sendMail}=require('./smtp');
const bad=(message,status=400)=>Object.assign(new Error(message),{status});
const emailOk=email=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)&&email.length<=180;
const configured=()=>resend.configured()||!!(process.env.SMTP_USER&&process.env.SMTP_PASS);
const hash=code=>{const salt=crypto.randomBytes(16).toString('hex');return salt+':'+crypto.scryptSync(code,salt,32).toString('hex');};
const compare=(code,stored)=>{
 if(!/^[0-9]{6}$/.test(code))return false;
 const [salt,digest]=String(stored||'').split(':');
 if(!/^[a-f0-9]{32}$/.test(salt||'')||!/^[a-f0-9]{64}$/.test(digest||''))return false;
 return crypto.timingSafeEqual(crypto.scryptSync(code,salt,32),Buffer.from(digest,'hex'));
};
async function migrate(db){
 const columns={
  email_verified_at:'TEXT',
  verification_hash:'TEXT',
  verification_expires_at:'TEXT',
  verification_sent_at:'TEXT',
  verification_attempts:'INTEGER NOT NULL DEFAULT 0'
 };
 if(db.engine==='postgres'){
  for(const [name,type] of Object.entries(columns)){
   await db.exec('ALTER TABLE public_franchise_requests ADD COLUMN IF NOT EXISTS '+name+' '+type);
  }
 }else{
  const list=(await db.query('PRAGMA table_info(public_franchise_requests)')).rows;
  const existing=new Set(list.map(x=>x.name));
  for(const [name,type] of Object.entries(columns))
   if(!existing.has(name))await db.exec('ALTER TABLE public_franchise_requests ADD COLUMN '+name+' '+type);
 }
}
async function find(db,email){
 const r=await db.query(
  'SELECT id,email,full_name,status,email_verified_at,verification_hash,verification_expires_at,verification_sent_at,verification_attempts '+
  'FROM public_franchise_requests WHERE LOWER(email)=LOWER($1) AND status IN ($2,$3) ORDER BY created_at DESC LIMIT 1',
  [email,'PENDING','CONTACTED']);
 return r.rows[0]||null;
}
async function deliver(to,name,code){
 if(resend.configured())return resend.sendFranchiseOtp({to,name,code});
 await sendMail({
  host:process.env.SMTP_HOST||'smtp.gmail.com',
  port:Number(process.env.SMTP_PORT||465),
  user:process.env.SMTP_USER,pass:process.env.SMTP_PASS,
  from:process.env.SMTP_FROM||process.env.SMTP_USER,to,
  subject:'Don Macchiatos POS franchise email verification',
  text:'Hello '+name+',\n\nYour 6-digit franchise signup verification code is '+code+
   '. It expires in 10 minutes. If you did not submit this franchise request, ignore this email.\n\nDon Macchiatos POS'
 });
 return{ok:true,provider:'smtp'};
}
const GENERIC={ok:true,message:'If a pending request for that email requires verification, a code will be sent when available.'};
async function requestCode(db,rawEmail){
 const email=String(rawEmail||'').trim().toLowerCase();
 if(!emailOk(email))throw bad('Enter a valid email address.');
 if(!configured())throw bad('Email verification is not configured. Contact Admin Control to configure Resend or SMTP.',503);
 const item=await find(db,email);
 if(!item||item.email_verified_at)return GENERIC;
 const now=Date.now(),sent=Date.parse(item.verification_sent_at||'');
 if(Number.isFinite(sent)&&now-sent<60000)return GENERIC;
 const code=String(crypto.randomInt(0,1000000)).padStart(6,'0'),secret=hash(code);
 const time=new Date(now).toISOString(),expires=new Date(now+600000).toISOString();
 const cutoff=new Date(now-60000).toISOString();
 const updated=await db.query('UPDATE public_franchise_requests SET verification_hash=$1,verification_expires_at=$2,'+
  'verification_sent_at=$3,verification_attempts=0 WHERE id=$4 AND email_verified_at IS NULL '+
  'AND (verification_sent_at IS NULL OR verification_sent_at<=$5) RETURNING id',
  [secret,expires,time,item.id,cutoff]);
 if(!updated.rows.length)return GENERIC;
 try{await deliver(item.email,item.full_name,code);}
 catch(e){
  await db.query('UPDATE public_franchise_requests SET verification_hash=NULL,verification_expires_at=NULL,'+
   'verification_sent_at=NULL WHERE id=$1 AND verification_hash=$2',[item.id,secret]);
  throw bad(e.userMessage||'Could not send the verification email. Please retry or contact Admin Control.',503);
 }
 return{ok:true,sent:true,message:'A 6-digit verification code was sent to your email. It expires in 10 minutes.'};
}
async function verify(db,rawEmail,rawCode){
 const email=String(rawEmail||'').trim().toLowerCase(),code=String(rawCode||'').trim();
 if(!emailOk(email)||!/^[0-9]{6}$/.test(code))throw bad('Enter the 6-digit verification code.');
 const item=await find(db,email);
 if(!item||item.email_verified_at||!item.verification_hash||
    Date.parse(item.verification_expires_at||'')<=Date.now()||
    Number(item.verification_attempts||0)>=5)throw bad('Invalid or expired code. Request a new verification email.',400);
 // Atomic attempt budget: concurrent guesses cannot bypass the five-attempt limit.
 const attempts=await db.query('UPDATE public_franchise_requests SET verification_attempts=verification_attempts+1 '+
  'WHERE id=$1 AND email_verified_at IS NULL AND verification_hash=$2 AND verification_attempts<5 RETURNING verification_attempts',
  [item.id,item.verification_hash]);
 if(!attempts.rows.length)throw bad('Invalid or expired code.',400);
 if(!compare(code,item.verification_hash))throw bad('Invalid or expired code. Check the email or request a new one.',400);
 const success=await db.query('UPDATE public_franchise_requests SET email_verified_at=$1,verification_hash=NULL,'+
  'verification_expires_at=NULL,verification_sent_at=NULL,updated_at=$1 WHERE id=$2 '+
  'AND email_verified_at IS NULL AND verification_hash=$3 RETURNING id',
  [new Date().toISOString(),item.id,item.verification_hash]);
 if(!success.rows.length)throw bad('Verification expired. Request a new code.',400);
 return{ok:true,verified:true,message:'Email verified. Your franchise application is still pending Admin Control approval; no POS login is active yet.'};
}
module.exports={migrate,requestCode,verify,configured,compare};
