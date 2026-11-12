'use strict';
const assert=require('node:assert/strict');
const resend=require('../lib/resend-otp');
const previousKey=process.env.RESEND_API_KEY;
process.env.RESEND_API_KEY='TEST-ONLY-NEVER-SEND';
const passwordMails=[],franchiseMails=[];
resend.sendPasswordOtp=async details=>{passwordMails.push(details);return{ok:true,provider:'mock'};};
resend.sendFranchiseOtp=async details=>{franchiseMails.push(details);return{ok:true,provider:'mock'};};
const password=require('../lib/account-recovery');
const franchise=require('../lib/franchise-email-verification');
const users=[
 {id:1,username:'ownerone',email:'shared@example.test',active:true,workspace_id:100},
 {id:2,username:'ownertwo',email:'shared@example.test',active:true,workspace_id:200},
 {id:3,username:'cashier',email:'cashier@example.test',active:true,workspace_id:100},
 {id:4,username:'noemail',email:null,active:true,workspace_id:100}
];
const pwRows=new Map(),recordedDDL=[];
const passwordDb={
 engine:'postgres',
 async exec(sql){recordedDDL.push(sql);},
 async transaction(fn){return fn(this);},
 async query(sql,p=[]){
  if(sql.startsWith('SELECT u.id,u.email,u.active,m.workspace_id FROM users u')){
   const identifier=String(p[0]).toLowerCase();
   return{rows:users.filter(u=>u.username===identifier||u.email===identifier)
    .map(u=>({id:u.id,email:u.email,active:u.active,workspace_id:u.workspace_id}))};
  }
  if(sql.startsWith('INSERT INTO account_password_otps(')){
   const [userId,workspaceId,emailHash,secret,expires,requested,cutoff]=p;
   const old=pwRows.get(userId);
   if(old&&old.requested_at>cutoff)return{rows:[]};
   pwRows.set(userId,{user_id:userId,workspace_id:workspaceId,
    email_sha256:emailHash,secret_hash:secret,expires_at:expires,requested_at:requested,attempts:0});
   return{rows:[{user_id:userId}]};
  }
  if(sql.startsWith('SELECT o.secret_hash,o.expires_at,o.attempts,o.workspace_id')){
   const [userId,workspaceId,active,email]=p,u=users.find(x=>x.id===userId),
    row=pwRows.get(userId);
   if(!u||!u.active||u.workspace_id!==workspaceId||!row||row.workspace_id!==workspaceId||
      u.email!==email)return{rows:[]};
   return{rows:[row]};
  }
  if(sql.startsWith('UPDATE account_password_otps SET attempts=attempts+1')){
   const row=pwRows.get(p[0]);if(row&&row.workspace_id===p[1])row.attempts++;
   return{rows:[]};
  }
  if(sql.startsWith('UPDATE users SET password_hash=')){
   const [hashed,userId,active,email,workspaceId]=p,u=users.find(x=>x.id===userId);
   if(!u||!u.active||u.email!==email||u.workspace_id!==workspaceId)return{rows:[]};
   u.password_hash=hashed;return{rows:[{id:userId}]};
  }
  if(sql.startsWith('DELETE FROM sessions'))return{rows:[]};
  if(sql.startsWith('DELETE FROM account_password_otps')){
   const row=pwRows.get(p[0]);
   if(row&&row.workspace_id===p[1]&&(p.length<3||row.secret_hash===p[2]))pwRows.delete(p[0]);
   return{rows:[]};
  }
  throw new Error('Unexpected password OTP SQL: '+sql.slice(0,150));
 }
};
const applicationA='a9d42a23-1111-4111-a111-111111111111';
const applicationB='b9d42a23-2222-4222-a222-222222222222';
const applicationC='c9d42a23-3333-4333-a333-333333333333';
const requests=[
 {id:applicationA,email:'shared@example.test',full_name:'A Owner',status:'PENDING',
  verification_hash:null,verification_expires_at:null,verification_sent_at:null,verification_attempts:0,email_verified_at:null},
 {id:applicationB,email:'shared@example.test',full_name:'B Owner',status:'CONTACTED',
  verification_hash:null,verification_expires_at:null,verification_sent_at:null,verification_attempts:0,email_verified_at:null},
 {id:applicationC,email:'single@example.test',full_name:'C Owner',status:'PENDING',
  verification_hash:null,verification_expires_at:null,verification_sent_at:null,verification_attempts:0,email_verified_at:null}
];
const signupDDL=[];
const signupDb={
 engine:'postgres',
 async exec(sql){signupDDL.push(sql);},
 async query(sql,p=[]){
  if(sql.startsWith('SELECT id,email,full_name,status,email_verified_at')){
   if(sql.includes('WHERE id=$1')){
    const row=requests.find(x=>x.id===p[0]&&x.email===p[1]&&['PENDING','CONTACTED'].includes(x.status));
    return{rows:row?[row]:[]};
   }
   return{rows:requests.filter(x=>x.email===p[0]&&['PENDING','CONTACTED'].includes(x.status)).slice(-2)};
  }
  if(sql.startsWith('UPDATE public_franchise_requests SET verification_hash=$1')){
   const row=requests.find(x=>x.id===p[3]);
   if(!row||row.email_verified_at||!['PENDING','CONTACTED'].includes(row.status)||
     (row.verification_sent_at&&row.verification_sent_at>p[4]))return{rows:[]};
   row.verification_hash=p[0];row.verification_expires_at=p[1];row.verification_sent_at=p[2];
   row.verification_attempts=0;return{rows:[{id:row.id}]};
  }
  if(sql.startsWith('UPDATE public_franchise_requests SET verification_attempts=verification_attempts+1')){
   const row=requests.find(x=>x.id===p[0]);
   if(!row||row.email_verified_at||row.verification_hash!==p[1]||
     row.verification_attempts>=5||!['PENDING','CONTACTED'].includes(row.status)||
     row.verification_expires_at<=p[2])return{rows:[]};
   row.verification_attempts++;return{rows:[{verification_attempts:row.verification_attempts}]};
  }
  if(sql.startsWith('UPDATE public_franchise_requests SET email_verified_at=')){
   const row=requests.find(x=>x.id===p[1]);
   if(!row||row.email_verified_at||row.verification_hash!==p[2]||
     row.verification_expires_at<=p[3])return{rows:[]};
   row.email_verified_at=p[0];row.verification_hash=null;row.verification_expires_at=null;
   row.verification_sent_at=null;return{rows:[{id:row.id}]};
  }
  if(sql.startsWith('UPDATE public_franchise_requests SET verification_hash=NULL,')){
   const row=requests.find(x=>x.id===p[0]);
   if(row&&row.verification_hash===p[1]){row.verification_hash=null;row.verification_sent_at=null;}
   return{rows:[]};
  }
  throw new Error('Unexpected franchise OTP SQL: '+sql.slice(0,160));
 }
};
async function test(){
 await password.migrate(passwordDb);
 assert(recordedDDL.some(x=>x.includes('email_sha256')));
 assert(recordedDDL.some(x=>x.includes('idx_password_otp_workspace')));
 await franchise.migrate(signupDb);
 assert(signupDDL.some(x=>x.includes('verification_hash')));
 // Email shared by two franchise accounts cannot silently reset either one.
 await password.request(passwordDb,'shared@example.test','ip-1');
 assert.equal(passwordMails.length,0);
 await password.request(passwordDb,'ownerone','ip-2');
 await password.request(passwordDb,'ownertwo','ip-3');
 assert.equal(passwordMails.length,2);
 assert.equal(pwRows.get(1).workspace_id,100);
 assert.equal(pwRows.get(2).workspace_id,200);
 assert.notEqual(pwRows.get(1).email_sha256,'shared@example.test');
 assert.equal((await password.confirm(passwordDb,'ownerone',passwordMails[1].code,
  'NewPassword123!','NewPassword123!',x=>'hash:'+x)).ok,false);
 assert.equal((await password.confirm(passwordDb,'ownerone',passwordMails[0].code,
  'NewPassword123!','NewPassword123!',x=>'hash:'+x)).ok,true);
 assert.equal(users[0].password_hash,'hash:NewPassword123!');
 assert(pwRows.has(2),'Other workspace OTP remains untouched');
 await assert.rejects(password.confirm(passwordDb,'ownerone',passwordMails[0].code,
  'NewPassword123!','NewPassword123!',x=>'hash:'+x));
 await password.request(passwordDb,'cashier','ip-4');
 const cashierCode=passwordMails.at(-1).code;
 await password.request(passwordDb,'cashier','ip-5');
 assert.equal(passwordMails.length,3,'Atomic cooldown blocks duplicate email');
 users[2].workspace_id=200;
 await assert.rejects(password.confirm(passwordDb,'cashier',cashierCode,
  'NewPassword123!','NewPassword123!',x=>'hash:'+x));
 users[2].workspace_id=100;users[2].email='changed@example.test';
 await assert.rejects(password.confirm(passwordDb,'cashier',cashierCode,
  'NewPassword123!','NewPassword123!',x=>'hash:'+x));
 await assert.rejects(password.request(passwordDb,'noemail','ip-6'),{status:422});
 // Application IDs isolate signup OTPs even when applicant emails are identical.
 await franchise.requestCode(signupDb,'shared@example.test');
 assert.equal(franchiseMails.length,0,'Ambiguous email-only application cannot be selected');
 await franchise.requestCode(signupDb,'shared@example.test',applicationA);
 await franchise.requestCode(signupDb,'shared@example.test',applicationB);
 assert.equal(franchiseMails.length,2);
 assert.equal(franchiseMails[0].to,'shared@example.test');
 await assert.rejects(franchise.verify(signupDb,'shared@example.test',franchiseMails[0].code,applicationB));
 assert.equal((await franchise.verify(signupDb,'shared@example.test',franchiseMails[0].code,applicationA)).verified,true);
 await assert.rejects(franchise.verify(signupDb,'shared@example.test',franchiseMails[0].code,applicationA));
 assert.equal(requests[1].email_verified_at,null,'Another application was not verified');
 await franchise.requestCode(signupDb,'single@example.test',applicationC);
 assert.equal(franchiseMails.length,3);
 await franchise.requestCode(signupDb,'single@example.test',applicationC);
 assert.equal(franchiseMails.length,3,'Signup cooldown blocks duplicate sends');
 await assert.rejects(franchise.verify(signupDb,'different@example.test',franchiseMails[2].code,applicationC));
 console.log('PASS: Resend mock OTP delivery, user/workspace and applicant scope, replay, cooldown, email change and workspace change');
}
test().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{
 if(previousKey===undefined)delete process.env.RESEND_API_KEY;
 else process.env.RESEND_API_KEY=previousKey;
});
