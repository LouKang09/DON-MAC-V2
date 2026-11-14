'use strict';
const assert=require('node:assert/strict'),audit=require('../lib/branch-isolation-audit');
const db={async query(sql,args=[]){
 if(sql.startsWith('SELECT workspace_id FROM chat_memberships'))return{rows:args[0]===1?[{workspace_id:10}]:args[0]===2?[{workspace_id:20}]:[]};
 if(sql.includes('FROM chat_workspace_branches wb JOIN branches b ON b.id=wb.branch_id')){
  if(sql.includes('wb.branch_id=$2'))return{rows:args[0]===10&&args[1]===101?[{id:101,name:'Main',opening_stock:5,template_id:1}]:[]};
  return{rows:args[0]===10?[{branch_id:101,name:'Main',opening_stock:5,template_id:1}]:[]};
 }
 if(sql.includes('COUNT(*) AS n FROM branch_'))return{rows:[{n:10}]};
 if(sql.includes('MIN(stock_qty)'))return{rows:[{n:10,min_stock:5,max_stock:5}]};
 if(sql.includes('SELECT COUNT(*) AS n FROM branch_recipes r'))return{rows:[{n:0}]};
 if(sql.includes('FROM branch_products')||sql.includes('FROM branch_ingredients')||sql.includes('FROM branch_recipes'))return{rows:[]};
 throw Error('Unexpected query '+sql);
}};
(async()=>{
 const a=await audit.audit(db,{id:1,role:'Admin'});
 assert.equal(a.workspaceId,10);
 assert.equal(a.branches.length,1);
 assert.equal(a.branches[0].openingStock,5);
 assert(a.allPrepared);
 await assert.rejects(audit.preview(db,{id:2,role:'Admin'},101),{status:403});
 await assert.rejects(audit.preview(db,{id:1,role:'Admin'},202),{status:403});
 await assert.rejects(audit.audit(db,{id:1,role:'User'}),{status:403});
 const p=await audit.preview(db,{id:1,role:'Admin'},101);
 assert.equal(p.readOnly,true);
 assert.equal(p.branch.id,101);
 console.log('PASS: isolated catalog admin audit scoped by workspace and branch');
})().catch(e=>{console.error(e);process.exitCode=1;});
