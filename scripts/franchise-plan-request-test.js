'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const requests=require('../lib/public-franchise-requests');
const app=fs.readFileSync('public/platform-admin.js','utf8');
const html=fs.readFileSync('public/platform-admin.html','utf8');
const auth=fs.readFileSync('public/auth-login-v1574.js','utf8');
const portal=fs.readFileSync('public/index.html','utf8');
const billing=fs.readFileSync('lib/platform-accounts.js','utf8');
const gate=fs.readFileSync('server.js','utf8');
const entries=[],queries=[],migrations=[];
const db={engine:'postgres',
 exec:async sql=>{migrations.push(sql)},
 query:async(sql,p=[])=>{
  queries.push({sql,p});
  if(sql.startsWith('SELECT 1 FROM users WHERE'))return{rows:[]};
  if(sql.startsWith('SELECT id FROM public_franchise_requests WHERE'))return{rows:[]};
  if(sql.startsWith('INSERT INTO public_franchise_requests(')){
   entries.push({id:p[0],username:p[1],fullName:p[2],email:p[3],phone:p[4],
    status:p[5],requested_plan:p[8],created_at:p[6],updated_at:p[7]});
   return{rows:[]};
  }
  if(sql.startsWith('SELECT r.id,r.username,r.full_name')){
   return{rows:entries.map(x=>({
    id:x.id,username:x.username,full_name:x.fullName,email:x.email,phone:x.phone,
    status:x.status,requested_plan:x.requested_plan,created_at:x.created_at,
    updated_at:x.updated_at,reviewed_by:null,review_note:null,email_verified_at:null,
    stage_status:null,test_user_id:null,test_workspace_id:null,test_active:false,
    assigned_plan:null,assigned_status:null,assigned_amount:null,
    assigned_next_payment_date:null
   }))};
  }
  throw Error('Unmocked plan application SQL: '+sql);
 }};
(async()=>{
 await requests.migrate(db);
 assert(migrations.some(x=>x.includes('ADD COLUMN IF NOT EXISTS requested_plan VARCHAR(20')));
 for(const plan of ['PRO','BUSINESS']){
  const payload={username:'owner'+plan,fullName:'Owner '+plan,
    email:plan.toLowerCase()+'@example.com',phone:'09171234567',
    requestedPlan:plan};
  assert.equal(requests.sanitize(payload).requestedPlan,plan);
  const saved=await requests.request(db,payload);
  assert.equal(saved.ok,true);
 }
 assert.equal(entries.length,2);
 assert.deepEqual(entries.map(x=>x.requested_plan),['PRO','BUSINESS']);
 const list=await requests.list(db);
 assert.deepEqual(list.requests.map(x=>x.requestedPlan),['PRO','BUSINESS']);
 assert.equal(list.requests[0].assignedPlan,null);
 assert.equal(list.requests[1].assignedStatus,null);
 await assert.rejects(requests.request(db,{username:'ownerx',fullName:'Owner X',
  email:'x@example.com',phone:'09171234567',requestedPlan:'ENTERPRISE'}),{status:400});
 await assert.rejects(requests.request(db,{username:'ownerx',fullName:'Owner X',
  email:'x@example.com',phone:'09171234567'}),{status:400});
 assert.match(portal,/id="regRequestedPlan"/);
 assert.match(portal,/value="PRO"/);
 assert.match(portal,/value="BUSINESS"/);
 assert.match(auth,/requestedPlan:\$\('regRequestedPlan'\)\.value/);
 assert.match(html,/Requested \/ Assigned Plan/);
 assert.match(app,/data-request-plan/);
 assert.match(app,/accounts\.find\(x=>Number\(x\.workspaceId\)===Number\(application\?\.testWorkspaceId\)\)/);
 assert.match(app,/openPlan\(owner\)/);
 assert.match(app,/owner\.pendingPlan\?\.plan\|\|owner\.subscription\?\.plan/);
 assert.match(billing,/\['PRO','BUSINESS'\]/);
 assert.match(billing,/\['PAID','ON_HOLD','UNPAID'\]/);
 assert.match(billing,/DELETE FROM platform_account_plan_requests WHERE workspace_id=\$1/);
 assert.match(gate,/await legacyCatalogGuard\.preventSharedCatalogLeak\(db,user,p\)/);
 assert.match(gate,/PHASE2_TEST_RESTRICTED/);
 console.log('PASS applicant-selected Pro/Business plans are persisted and displayed for Admin Control assignment; payment and shared-catalog protections preserved.');
})().catch(e=>{console.error(e);process.exitCode=1});
