'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('../lib/franchise-test-access');
const read=p=>fs.readFileSync(p,'utf8');
(async()=>{
 const sql=[];
 const stub={query:async(q,args=[])=>{
  sql.push([q,args]);
  if(q.includes('FROM franchise_test_accounts t'))return{rows:[{
   request_id:'11111111-1111-4111-8111-111111111111',
   user_id:31,workspace_id:83,branch_id:121,membership_workspace:83,owner_user_id:31,branch_active:true
  }]};
  if(q.includes('FROM chat_workspace_branches WHERE workspace_id='))return{rows:[{'?column?':1}]};
  if(q.includes('FROM branch_catalog_provisioning WHERE'))return{rows:[{'?column?':1}]};
  if(q.includes('SELECT b.name FROM branches'))return{rows:[{name:'Phase 2 Test'}]};
  return{rows:[]};
 }};
 assert.equal((await test.account(stub,31)).workspaceId,83);
 await assert.rejects(test.overview(stub,31,999),{status:403});
 assert.equal(sql.filter(x=>x[0].includes('FROM branch_products')).length,0,
  'Invalid requested branch must fail before catalog is fetched.');
 const data=await test.overview(stub,31,121);
 assert.equal(data.testMode,true);
 assert.equal(data.readOnly,true);
 assert.equal(data.liveCheckoutEnabled,false);
 assert.equal(data.workspaceId,83);
 assert.equal(data.branchId,121);
 assert.equal(data.branchName,'Phase 2 Test');
 assert.ok(sql.some(x=>x[0].includes('FROM branch_products')&&x[1][0]===83&&x[1][1]===121));
 assert.ok(sql.some(x=>x[0].includes('FROM branch_ingredients')&&x[1][0]===83&&x[1][1]===121));
 const failDb={query:async()=>({rows:[{request_id:'x',user_id:31,workspace_id:83,branch_id:121,
   membership_workspace:22,owner_user_id:31,branch_active:true}]})};
 await assert.rejects(test.account(failDb,31),{status:403});
 const source=read('lib/franchise-test-access.js');
 const server=read('server.js');
 const platform=read('lib/platform-admin-auth.js');
 const admin=read('public/platform-admin.js');
 const html=read('public/platform-admin.html');
 const app=read('public/app-core.js');
 const portal=read('public/phase2-test.html');
 assert.match(source,/CREATE TABLE IF NOT EXISTS franchise_test_accounts/);
 assert.match(source,/status!=='CONTACTED'/);
 assert.match(source,/email_verified_at/);
 assert.match(source,/PREPARED_NO_ACCESS/);
 assert.match(source,/catalogSeed\.seedBranch\(tx,workspaceId,branchId,master,0,userId\)/);
 assert.match(source,/INSERT INTO chat_workspaces/);
 assert.match(source,/INSERT INTO chat_workspace_branches/);
 assert.match(source,/SELECT id FROM users WHERE LOWER\(username\)/);
 assert.match(source,/crypto\.randomBytes\(18\)/);
 assert.match(platform,/franchise-requests.*test-activate/);
 assert.match(admin,/Create Phase 2 Test Account/);
 assert.match(html,/phase2TestLoginDialog/);
 assert.match(html,/Copy Credentials/);
 assert.match(app,/location\.assign\('\/phase2-test\.html'\)/);
 assert.match(app,/location\.replace\('\/phase2-test\.html'\)/);
 assert.match(portal,/phase2-test\.js/);
 const testGate=server.indexOf('const phase2Test=await franchiseTestAccess.account(db,user.id)');
 const guard=server.indexOf('await legacyCatalogGuard.preventSharedCatalogLeak(db,user,p)');
 const nextRoute=server.indexOf("if(p==='/api/finance/expenses'",guard);
 assert(testGate>=0&&guard>testGate&&nextRoute>guard,
  'Test account allowlist must deny live endpoints before legacy routing starts.');
 assert.match(server.slice(testGate,guard),/PHASE2_TEST_RESTRICTED/);
 assert.match(server,/await franchiseTestAccess\.migrate\(db\)/);
 assert.match(server,/testMode:!!testAccount/);
 console.log('PASS: scoped test tenant credentials, zero-stock provisioning, restricted routes and read-only catalog.');
})().catch(e=>{console.error(e);process.exitCode=1});
