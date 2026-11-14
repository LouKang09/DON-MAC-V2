'use strict';
const assert=require('node:assert/strict');
const branch=require('../lib/branch-support');
const db={
 async query(sql,args){
  if(sql.startsWith('SELECT workspace_id FROM chat_memberships')){
   const ids={10:[{workspace_id:1}],20:[{workspace_id:1}],30:[{workspace_id:2}],40:[]};
   return{rows:ids[args[0]]||[]};
  }
  if(sql.startsWith('SELECT b.id,b.active FROM chat_workspace_branches')){
   const key=args.join(':');
   return{rows:({'1:101':[{id:101,active:true}],
                 '1:102':[{id:102,active:false}],
                 '2:201':[{id:201,active:true}]})[key]||[]};
  }
  throw new Error('Unexpected query: '+sql);
 }
};
(async()=>{
 const admin={id:10,role:'Admin'};
 const staff={id:20,role:'User',branchId:101};
 const other={id:30,role:'Admin'};
 assert.equal(await branch.salesScope(db,admin,null),null,'Admin All permitted');
 assert.equal(await branch.salesScope(db,admin,'101'),101);
 assert.equal(await branch.salesScope(db,staff,null,true),101);
 await assert.rejects(branch.salesScope(db,admin,'201'),{status:403});
 await assert.rejects(branch.salesScope(db,other,'101'),{status:403});
 assert.equal(await branch.salesScope(db,staff,'201',true),101,'Staff ignores unauthorized branch override');
 await assert.rejects(branch.salesScope(db,admin,null,true),{status:400});
 await assert.rejects(branch.salesScope(db,admin,'102',true),{status:403});
 await assert.rejects(branch.salesScope(db,{id:40,role:'Admin'},null),{status:403});
 await assert.rejects(branch.salesScope(db,{id:null,role:'Admin'},null),{status:403});
 console.log('PASS: cross-workspace branches rejected, cashier tied to own branch, owner All preserved');
})().catch(e=>{console.error(e);process.exitCode=1;});
