'use strict';
const assert=require('node:assert/strict');
const transfer=require('../lib/inventory-transfer-branches');
const db={async query(sql,p){
 if(sql.startsWith('SELECT workspace_id FROM chat_memberships')){
  return{rows:[{workspace_id:p[0]===1?10:p[0]===2?20:30}]};
 }
 if(sql.includes('FROM chat_workspace_branches wb')){
  return{rows:p[0]===10?[
    {id:101,name:'Main',active:true},{id:102,name:'North',active:true},
    {id:103,name:'Closed',active:false}]:p[0]===20?[{id:201,name:'Other',active:true}]:[]};
 }
 throw Error('Unexpected query '+sql);
}};
(async()=>{
 const admin={id:1,role:'Admin'},cashier={id:1,role:'User',branchId:101};
 const a=await transfer.list(db,admin,101);
 assert.deepEqual(a.destinations,[{id:102,name:'North'}]);
 assert.equal(a.branches.length,2);
 const c=await transfer.list(db,cashier,null);
 assert.deepEqual(c.destinations,[{id:102,name:'North'}]);
 assert.equal(c.branches.length,1);
 const validated=await transfer.validate(db,admin,{sourceBranchId:101,destinationBranchId:102,receivedByBranchId:102});
 assert.equal(validated.destinationBranchName,'North');
 await assert.rejects(transfer.validate(db,admin,{sourceBranchId:101,destinationBranchId:201,receivedByBranchId:201}),{status:403});
 await assert.rejects(transfer.validate(db,admin,{sourceBranchId:101,destinationBranchId:103,receivedByBranchId:103}),{status:403});
 await assert.rejects(transfer.validate(db,admin,{sourceBranchId:101,destinationBranchId:101,receivedByBranchId:101}),{status:403});
 await assert.rejects(transfer.validate(db,admin,{sourceBranchId:101,destinationBranchId:102,receivedByBranchId:101}),{status:400});
 await assert.rejects(transfer.list(db,cashier,102),{status:403});
 await assert.rejects(transfer.list(db,{id:2,role:'Admin'},101),{status:403});
 console.log('PASS: transfer destinations include only other active branches in owner workspace');
})().catch(e=>{console.error(e);process.exitCode=1;});
