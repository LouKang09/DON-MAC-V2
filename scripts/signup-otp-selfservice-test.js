'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const seed=require('../lib/branch-catalog-seeding');
const previousRead=seed.readTemplate,previousSeed=seed.seedBranch;
let seeded=null;
seed.readTemplate=async()=>({template:{products:[],ingredients:[],recipes:[]},sourceWorkspaceId:1});
seed.seedBranch=async(_db,ws,branch,master,openingStock,user)=>{
 seeded={ws,branch,master,openingStock,user};
 return{status:'prepared',openingStock};
};
const signup=require('../lib/franchise-test-access');
const otp=require('../lib/franchise-email-verification');
const appId='77777777-7777-4777-8777-777777777777';
const code='846213',salt='b'.repeat(32),digest=crypto.scryptSync(code,salt,32).toString('hex');
let applicant={id:appId,username:'verified-owner',email:'registered@example.com',
 full_name:'Verified Owner',phone:'09171234567',status:'PENDING',email_verified_at:null,
 verification_hash:salt+':'+digest,verification_expires_at:new Date(Date.now()+5*60000).toISOString(),
 verification_sent_at:new Date(Date.now()-60000).toISOString(),verification_attempts:0};
const users=[],workspaces=[],memberships=[],branches=[],links=[],testAccounts=[],queries=[];
let nextUser=1,nextWorkspace=31,nextBranch=200;
const db={
 engine:'postgres',
 async transaction(callback){
  const old=JSON.parse(JSON.stringify(applicant));
  const lens=[users.length,workspaces.length,memberships.length,branches.length,links.length,testAccounts.length];
  try{return await callback(db)}
  catch(err){
   applicant=old;
   [users,workspaces,memberships,branches,links,testAccounts].forEach((arr,i)=>arr.length=lens[i]);
   throw err;
  }
 },
 async query(sql,p=[]){
  queries.push({sql,p});
  if(sql.startsWith('SELECT id,email,full_name,status,email_verified_at,verification_hash,')){
   return{rows:[{...applicant}].filter(x=>x.id===p[0]&&x.email.toLowerCase()===String(p[1]).toLowerCase()&&!x.email_verified_at)};
  }
  if(sql.startsWith('UPDATE public_franchise_requests SET verification_attempts=verification_attempts+1')){
   if(applicant.verification_hash!==p[1]||applicant.verification_attempts>=5)return{rows:[]};
   applicant.verification_attempts++;
   return{rows:[{verification_attempts:applicant.verification_attempts}]};
  }
  if(sql.startsWith('UPDATE public_franchise_requests SET email_verified_at=')){
   if(applicant.id!==p[1]||applicant.email_verified_at||applicant.verification_hash!==p[2])
    return{rows:[]};
   applicant.email_verified_at=p[0];applicant.verification_hash=null;
   applicant.verification_expires_at=null;applicant.verification_sent_at=null;
   return{rows:[{id:appId}]};
  }
  if(sql.startsWith('SELECT id,username,full_name,email,phone,status,email_verified_at FROM public_franchise_requests'))
   return{rows:applicant.id===p[0]?[{...applicant}]:[]};
  if(sql.startsWith('SELECT user_id FROM franchise_test_accounts WHERE request_id='))
   return{rows:testAccounts.filter(x=>x.request_id===p[0]).map(x=>({user_id:x.user_id}))};
  if(sql.startsWith('SELECT id FROM users WHERE LOWER(username)'))return{rows:users.filter(u=>u.username===p[0])};
  if(sql.startsWith('INSERT INTO users ')){
   const u={id:nextUser++,username:p[0],login_username:p[1],password_hash:p[2],
    role:p[3],active:p[4],email:p[7]};
   users.push(u);return{rows:[{id:u.id}]};
  }
  if(sql.startsWith('INSERT INTO chat_workspaces(')){const w={id:nextWorkspace++,owner_user_id:p[0]};workspaces.push(w);return{rows:[w]}};
  if(sql.startsWith('INSERT INTO chat_memberships(')){memberships.push({userId:p[0],ws:p[1]});return{rows:[]}};
  if(sql.startsWith('UPDATE users SET owner_scope_id='))return{rows:[]};
  if(sql.startsWith('INSERT INTO branches(')){
   const b={id:nextBranch++,name:p[0],active:p[2]};branches.push(b);return{rows:[b]};
  }
  if(sql.startsWith('INSERT INTO chat_workspace_branches(')){links.push({branch:p[0],ws:p[1]});return{rows:[]}};
  if(sql.startsWith('INSERT INTO franchise_test_accounts(')){
   testAccounts.push({request_id:p[0],user_id:p[1],ws:p[2],branch:p[3]});return{rows:[]};
  }
  throw Error('Unexpected signup SQL '+sql);
 }
};
(async()=>{
 assert.throws(()=>signup.validateSignupPassword('short','short'),{status:400});
 await assert.rejects(signup.activateVerifiedSignup(db,appId,'Password12345'),{status:403},
  'Without OTP a franchise may not be created');
 assert.equal(users.length,0);
 await assert.rejects(otp.verify(db,applicant.email,'000000',appId,{
  onVerified:(tx,requestId)=>signup.activateVerifiedSignup(tx,requestId,'Password12345')
 }),{status:400},'Wrong email OTP cannot activate a login');
 assert.equal(users.length,0);
 assert.equal(applicant.verification_attempts,1,'Invalid OTP consumes an attempt');
 const result=await otp.verify(db,applicant.email,code,appId,{
  onVerified:(tx,requestId)=>signup.activateVerifiedSignup(tx,requestId,'Password12345')
 });
 assert.equal(result.ok,true);
 assert.equal(result.created,true);
 assert.equal(result.testMode,true);
 assert.equal(result.username,'verified-owner');
 assert.equal(users.length,1);
 assert.equal(users[0].role,'Admin');
 assert.equal(users[0].active,true);
 assert(users[0].password_hash.startsWith('scrypt$'),'Only a salted hash is persisted');
 assert(!users[0].password_hash.includes('Password12345'));
 const [,salt2,hash]=users[0].password_hash.split('$');
 assert.equal(crypto.scryptSync('Password12345',salt2,64).toString('hex'),hash);
 assert.equal(workspaces[0].owner_user_id,users[0].id);
 assert.deepEqual(memberships[0],{userId:users[0].id,ws:workspaces[0].id});
 assert.deepEqual(links[0],{branch:branches[0].id,ws:workspaces[0].id});
 assert.equal(testAccounts[0].request_id,appId);
 assert.equal(seeded.openingStock,0);
 assert.equal(seeded.ws,workspaces[0].id);
 assert.equal(seeded.branch,branches[0].id);
 await assert.rejects(otp.verify(db,applicant.email,code,appId,{
  onVerified:(tx,requestId)=>signup.activateVerifiedSignup(tx,requestId,'Password12345')
 }),{status:400},'OTP cannot be replayed after creating a login');
 assert.equal(users.length,1);
 assert(!queries.some(x=>/INSERT INTO (sales|sale_items|ingredients)\b/i.test(x.sql)));
 console.log('PASS: wrong OTP denies account, valid OTP atomically creates a hashed-password test tenant, zero stock, and replay fails');
})().catch(err=>{console.error(err);process.exitCode=1}).finally(()=>{
 seed.readTemplate=previousRead;seed.seedBranch=previousSeed;
});
