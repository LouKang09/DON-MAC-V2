'use strict';
const assert=require('node:assert/strict');
const modes=require('../lib/franchise-account-modes');
const scope=require('../lib/franchise-live-scope');
const assignments=new Map();
const members=new Map([[1,{ws:11,provisioned:false}],[2,{ws:22,provisioned:true}],
 [3,{ws:33,provisioned:true}],[4,{ws:44,provisioned:true}],[5,{ws:55,provisioned:false}]]);
const db={
 engine:'postgres',
 async exec(sql){assert.match(sql,/CHECK\(data_mode IN/);},
 async query(sql,args=[]){
  if(sql.startsWith('INSERT INTO franchise_account_modes')){
   if(!assignments.has(args[0]))assignments.set(args[0],args[1]);
   return{rows:[]};
  }
  if(sql.startsWith('SELECT data_mode FROM franchise_account_modes')){
   return{rows:assignments.has(args[0])?[{data_mode:assignments.get(args[0])}]:[]};
  }
  if(sql.startsWith('SELECT m.workspace_id,a.data_mode,')){
   const m=members.get(args[0]);
   return{rows:m?[{workspace_id:m.ws,data_mode:assignments.get(m.ws)||null,
    provisioned:m.provisioned}]:[]};
  }
  if(sql.includes('FROM chat_memberships m JOIN franchise_test_accounts t')){
   const m=members.get(args[0]);
   if(!m||!m.provisioned)return{rows:[]};
   return{rows:[{request_id:'test',owner_id:args[0],workspace_id:m.ws,
    starter_branch_id:999,subscription_status:'PAID',subscription_plan:'PRO',
    membership_workspace:m.ws,role:'Admin',user_branch_id:null,user_active:true,
    owner_user_id:args[0],starter_active:true,data_mode:assignments.get(m.ws)||null}]};
  }
  throw Error('Unexpected SQL: '+sql);
 }
};
(async()=>{
 await modes.migrate(db);
 assert.equal((await modes.forUser(db,1)).mode,'SHARED','Old franchise stays on legacy storage');
 assert.equal((await modes.forUser(db,2)).mode,'TEMPORARY','Old unclassified test tenants cannot silently become commercial accounts');
 assert.equal(await scope.candidate(db,2),null,'Unclassified old test accounts cannot access live checkout');
 await modes.register(db,22,modes.MODES.NEW,'OTP verified');
 await modes.register(db,33,modes.MODES.TEMPORARY,'Admin Control test activation');
 await modes.register(db,44,modes.MODES.NEW,'OTP verified');
 assert.deepEqual((await modes.forUser(db,3)).mode,'TEMPORARY');
 assert.equal((await modes.forUser(db,4)).mode,'NEW');
 assert.equal((await scope.candidate(db,3)),null,'Sandbox cannot qualify for real live checkout');
 assert.equal((await scope.candidate(db,4)).dataMode,'NEW');
 await assert.rejects(modes.register(db,33,modes.MODES.NEW,'malicious switch'),{status:409},
  'Sandbox registration may not be silently converted to real sales.');
 await assert.rejects(modes.register(db,22,modes.MODES.SHARED,'malicious switch'),{status:409});
 await modes.register(db,55,modes.MODES.SHARED,'pre-existing account');
 assert.equal((await modes.forUser(db,5)).mode,'SHARED');
 assignments.set(11,'NEW');
 await assert.rejects(modes.forUser(db,1),{status:403},
  'A legacy workspace cannot be relabelled as an isolated commercial franchise.');
 assert.equal((await modes.forUser(db,77)).mode,'SHARED','No-workspace legacy login remains compatible');
 console.log('PASS: persisted account modes, backward compatibility, sandbox exclusion and fail-closed conflicts.');
})().catch(err=>{console.error(err);process.exitCode=1});
