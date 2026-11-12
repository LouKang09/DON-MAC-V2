'use strict';
const assert=require('node:assert/strict');
const resend=require('../lib/resend-otp');
const password=require('../lib/account-recovery');
const previousKey=process.env.RESEND_API_KEY;
process.env.RESEND_API_KEY='UNIT-TEST-ONLY';
const oldSend=resend.sendPasswordOtp;
const delivered=[];
resend.sendPasswordOtp=async details=>{
 delivered.push(details);
 return{ok:true,provider:'resend',messageId:'test-message-'+delivered.length};
};
const users=[
 {id:1,username:'marlou09',email:'marlou@gmail.com',active:true,role:'Admin',branch_id:null,workspace_id:100,mapped_branch_id:null,branch_active:null},
 {id:2,username:'cashier-a',email:'shared@gmail.com',active:true,role:'User',branch_id:11,workspace_id:100,mapped_branch_id:11,branch_active:true},
 {id:3,username:'cashier-b',email:'shared@gmail.com',active:true,role:'User',branch_id:22,workspace_id:200,mapped_branch_id:22,branch_active:true},
 {id:4,username:'unmapped',email:'unmapped@gmail.com',active:true,role:'User',branch_id:99,workspace_id:100,mapped_branch_id:null,branch_active:true},
 {id:5,username:'cashier-move',email:'move@gmail.com',active:true,role:'User',branch_id:12,workspace_id:100,mapped_branch_id:12,branch_active:true}
];
const otps=new Map(),ddl=[],updates=[];
const db={
 engine:'postgres',
 async exec(sql){ddl.push(sql);},
 async transaction(fn){return fn(this);},
 async query(sql,p=[]){
  if(sql.startsWith('SELECT u.id,u.email,u.active,u.role,u.branch_id')){
   const matches=users.filter(u=>u.username===String(p[0]).toLowerCase()&&u.email===p[1]);
   return{rows:matches.map(x=>({...x}))};
  }
  if(sql.startsWith('INSERT INTO account_password_otps(')){
   const [userId,workspaceId,branchId,emailHash,secret,expires,requested,cutoff]=p;
   const previous=otps.get(userId);
   if(previous&&previous.requested_at>cutoff)return{rows:[]};
   otps.set(userId,{user_id:userId,workspace_id:workspaceId,branch_id:branchId,
    email_sha256:emailHash,secret_hash:secret,expires_at:expires,
    requested_at:requested,attempts:0});
   return{rows:[{user_id:userId}]};
  }
  if(sql.startsWith('SELECT o.secret_hash,o.expires_at,o.attempts,o.branch_id')){
   const [userId,workspaceId,isActive,email]=p;
   const user=users.find(x=>x.id===userId),row=otps.get(userId);
   if(!user||!row||row.workspace_id!==workspaceId||user.workspace_id!==workspaceId||
      user.email!==email||user.active!==isActive||
      (user.branch_id!=null&&user.branch_id!==user.mapped_branch_id))return{rows:[]};
   return{rows:[{...row,otp_branch_id:row.branch_id,current_branch_id:user.branch_id}]};
  }
  if(sql.startsWith('UPDATE account_password_otps SET attempts=attempts+1')){
   const row=otps.get(p[0]);if(row&&row.workspace_id===p[1])row.attempts++;
   return{rows:[]};
  }
  if(sql.startsWith('UPDATE users SET password_hash=')){
   const [newHash,userId,isActive,email,branchId,workspaceId]=p;
   const user=users.find(x=>x.id===userId);
   if(!user||!user.active||user.active!==isActive||user.email!==email||
      user.workspace_id!==workspaceId||user.branch_id!==branchId)return{rows:[]};
   user.password_hash=newHash;updates.push(userId);return{rows:[{id:userId}]};
  }
  if(sql.startsWith('DELETE FROM account_password_otps')){
   const row=otps.get(p[0]);
   if(row&&row.workspace_id===p[1]&&(p.length<3||row.secret_hash===p[2]))otps.delete(p[0]);
   return{rows:[]};
  }
  if(sql.startsWith('DELETE FROM sessions'))return{rows:[]};
  throw Error('Unexpected SQL: '+sql.slice(0,180));
 }
};
async function run(){
 await password.migrate(db);
 assert(ddl.some(s=>s.includes('branch_id BIGINT')));
 assert(ddl.some(s=>s.includes('email_sha256')));
 assert.equal(password.isConfigured(),true);
 const resetPassword='NewPassword123!';
 const hash=s=>'hash:'+s;
 // Never send for a mismatch or an unmapped branch.
 await assert.rejects(password.request(db,'cashier-a','wrong@gmail.com','ip-a'),{status:404});
 await assert.rejects(password.request(db,'unknown','shared@gmail.com','ip-b'),{status:404});
 await assert.rejects(password.request(db,'unmapped','unmapped@gmail.com','ip-c'),{status:404});
 assert.equal(delivered.length,0);
 // Owner with no branch is allowed; stock and workspace ownership are unrelated.
 const owner=await password.request(db,'marlou09','marlou@gmail.com','ip-owner');
 assert.equal(owner.sent,true);
 assert.equal(delivered.at(-1).to,'marlou@gmail.com');
 assert.equal(otps.get(1).workspace_id,100);
 assert.equal(otps.get(1).branch_id,null);
 const ownerRepeat=await password.request(db,'marlou09','marlou@gmail.com','ip-owner-retry');
 assert.equal(ownerRepeat.cooldown,true);
 assert.equal(ownerRepeat.sent,false);
 assert.equal(delivered.length,1);
 // Identical email in another franchise cannot claim the other account.
 const a=await password.request(db,'cashier-a','shared@gmail.com','ip-a-request');
 const codeA=delivered.at(-1).code;
 const b=await password.request(db,'cashier-b','shared@gmail.com','ip-b-request');
 const codeB=delivered.at(-1).code;
 assert.equal(a.sent,true);assert.equal(b.sent,true);
 assert.equal(otps.get(2).workspace_id,100);
 assert.equal(otps.get(3).workspace_id,200);
 assert.equal(otps.get(2).branch_id,11);
 assert.equal(otps.get(3).branch_id,22);
 const mismatch=await password.confirm(db,'cashier-a','shared@gmail.com',codeB,resetPassword,resetPassword,hash);
 assert.equal(mismatch.ok,false);
 assert.equal(otps.get(2).attempts,1);
 assert.equal((await password.confirm(db,'cashier-a','shared@gmail.com',codeA,resetPassword,resetPassword,hash)).ok,true);
 assert.equal(users[1].password_hash,'hash:'+resetPassword);
 assert(otps.has(3),'Other franchise OTP is preserved');
 await assert.rejects(password.confirm(db,'cashier-a','shared@gmail.com',codeA,resetPassword,resetPassword,hash));
 assert.equal((await password.confirm(db,'cashier-b','shared@gmail.com',codeB,resetPassword,resetPassword,hash)).ok,true);
 // Moving a cashier from Branch 12 to Branch 13 invalidates their previous OTP.
 await password.request(db,'cashier-move','move@gmail.com','ip-move');
 const moveCode=delivered.at(-1).code;
 users[4].branch_id=13;users[4].mapped_branch_id=13;
 await assert.rejects(password.confirm(db,'cashier-move','move@gmail.com',moveCode,resetPassword,resetPassword,hash),{status:400});
 users[4].branch_id=12;users[4].mapped_branch_id=12;
 users[4].email='newmove@gmail.com';
 await assert.rejects(password.confirm(db,'cashier-move','move@gmail.com',moveCode,resetPassword,resetPassword,hash),{status:404});
 // A Resend rejection must not claim success and must discard the new OTP.
 resend.sendPasswordOtp=async()=>{const e=new Error('Provider refused');e.code='RESEND_SENDER_NOT_VERIFIED';e.userMessage='Sender not verified';e.providerStatus=403;throw e;};
 users.push({id:6,username:'reject-mail',email:'reject@gmail.com',active:true,role:'User',
  branch_id:30,workspace_id:100,mapped_branch_id:30,branch_active:true});
 await assert.rejects(password.request(db,'reject-mail','reject@gmail.com','ip-reject'),{status:503});
 assert(!otps.has(6));
 assert(!updates.includes(6));
 console.log('PASS: exact registered Gmail, owner/workspace, branch isolation, ambiguous email, no false send, cooldown, single use, provider rejection');
}
run().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{
 resend.sendPasswordOtp=oldSend;
 if(previousKey==null)delete process.env.RESEND_API_KEY;
 else process.env.RESEND_API_KEY=previousKey;
});
