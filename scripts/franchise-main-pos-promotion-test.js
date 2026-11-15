'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const accounts=require('../lib/franchise-test-access');
const modes=require('../lib/franchise-account-modes');
const REQUEST='11111111-1111-4111-8111-111111111111';
function fake(dbMode='TEMPORARY',opts={}){
 const statements=[];
 let mode=dbMode;
 const user={user_id:71,workspace_id:91,branch_id:111,username:'test1',
  email_verified_at:'2026-11-15T10:00:00.000Z',owner_user_id:71,active:true,
  branch_active:true,...opts};
 const db={engine:'postgres',statements,
  async transaction(fn){return fn(db);},
  async query(sql,args=[]){
   statements.push({sql,args});
   if(sql.includes('pg_advisory_xact_lock'))return{rows:[{}]};
   if(sql.includes('SELECT t.request_id FROM franchise_test_accounts t'))return{rows:[{request_id:REQUEST}]};
   if(sql.includes('SELECT t.user_id,t.workspace_id'))return{rows:[{...user,data_mode:mode}]};
   if(sql.includes('SELECT 1 FROM chat_memberships'))return{rows:[{ok:1}]};
   if(sql.includes('SELECT 1 FROM branch_catalog_provisioning'))return{rows:[{ok:1}]};
   if(sql.startsWith('UPDATE franchise_account_modes')){if(mode!=='TEMPORARY')return{rows:[]};
    mode='NEW';return{rows:[{workspace_id:91}]};}
   if(sql.startsWith('INSERT INTO franchise_account_modes')){mode='NEW';return{rows:[]};}
   if(sql.startsWith('SELECT data_mode FROM franchise_account_modes'))return{rows:[{data_mode:mode}]};
   if(sql.startsWith('DELETE FROM sessions'))return{rows:[]};
   throw Error('Unexpected query: '+sql);
  }};
 return db;
}
(async()=>{
 const db=fake();
 const promoted=await accounts.promote(db,REQUEST,'Admin Control');
 assert.equal(promoted.username,'test1');
 assert.equal(promoted.dataMode,'NEW');
 assert.equal(promoted.portal,'/');
 assert.equal(promoted.workspaceId,91);
 assert(db.statements.some(x=>x.sql.startsWith('UPDATE franchise_account_modes')));
 assert(db.statements.some(x=>x.sql.startsWith('DELETE FROM sessions')),
  'Existing sessions must be invalidated after promotion.');
 assert(!db.statements.some(x=>/\b(?:FROM|UPDATE|INTO)\s+(?:sales|products|ingredients)\b/i.test(x.sql)));
 const auto=fake();
 assert.equal((await accounts.promoteTest1OnLaunch(auto)).status,'promoted');
 const old=fake(null);
 assert.equal((await accounts.promote(old,REQUEST,'Admin Control')).dataMode,'NEW',
  'Old test accounts without a recorded mode can be explicitly promoted.');
 const live=fake('NEW');
 assert.equal((await accounts.promote(live,REQUEST,'Admin Control')).alreadyLive,true);
 await assert.rejects(accounts.promote(fake('SHARED'),REQUEST,'Admin Control'),{status:409});
 await assert.rejects(accounts.promote(fake('TEMPORARY',{email_verified_at:null}),REQUEST,'Admin Control'),{status:409});
 await assert.rejects(accounts.promote(fake('TEMPORARY',{owner_user_id:72}),REQUEST,'Admin Control'),{status:409});
 await assert.rejects(accounts.promote(fake('TEMPORARY',{active:false}),REQUEST,'Admin Control'),{status:409});
 assert(modes.MODES.NEW==='NEW'&&modes.MODES.TEMPORARY==='TEMPORARY');
 const boot=fs.readFileSync('server.js','utf8');
 assert.match(boot,/DONMAC_PROMOTE_TEST1_MAIN_POS/);
 const ui=fs.readFileSync('public/platform-admin.js','utf8');
 const api=fs.readFileSync('lib/platform-admin-auth.js','utf8');
 const signup=fs.readFileSync('lib/franchise-test-access.js','utf8');
 const scope=fs.readFileSync('lib/franchise-live-scope.js','utf8');
 assert.match(ui,/data-enable-main-pos/);
 assert.match(ui,/Enable Main POS/);
 assert.match(api,/franchiseTestAccess\.promote/);
 assert.match(signup,/temporary\?accountModes\.MODES\.TEMPORARY:accountModes\.MODES\.NEW/);
 assert.match(scope,/if\(x\.data_mode===null/);
 console.log('PASS: test1 promotion preserves isolated workspace, requires verified owner, revokes sessions, and never accesses legacy tables.');
})().catch(error=>{console.error(error);process.exitCode=1});
