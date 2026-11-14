'use strict';
const assert=require('node:assert/strict');
const access=require('../lib/cashier-access');
const finance=require('../lib/pos-finance');
const users={1:{id:1,role:'Admin',workspace:10,branchId:null,branchActive:true},
 2:{id:2,role:'User',workspace:10,branchId:101,branchActive:true},
 3:{id:3,role:'User',workspace:20,branchId:201,branchActive:true}};
const grants=new Map(),calls=[],ddl=[];
const key=(ws,id)=>ws+':'+id;
const db={engine:'postgres',
 async exec(sql){ddl.push(sql);},
 async transaction(fn){return fn(this);},
 async query(sql,args=[]){
  calls.push({sql,args});
  if(sql.startsWith('SELECT workspace_id FROM chat_memberships')){
   const u=users[args[0]];return{rows:u?[{workspace_id:u.workspace}]:[]};
  }
  if(sql.startsWith('SELECT u.id,u.role FROM users u JOIN chat_memberships')){
   const u=users[args[1]];
   return{rows:u&&u.workspace===args[0]?[{id:u.id,role:u.role}]:[]};
  }
  if(sql.startsWith('DELETE FROM cashier_feature_grants')){
   grants.set(key(args[0],args[1]),[]);return{rows:[]};
  }
  if(sql.startsWith('INSERT INTO cashier_feature_grants')){
   const current=grants.get(key(args[0],args[1]))||[];
   current.push(args[2]);grants.set(key(args[0],args[1]),current);return{rows:[]};
  }
  if(sql.startsWith('SELECT permission_key FROM cashier_feature_grants')){
   return{rows:(grants.get(key(args[0],args[1]))||[]).map(permission_key=>({permission_key}))};
  }
  if(sql.startsWith('SELECT user_id,permission_key FROM cashier_feature_grants')){
   return{rows:[...grants.entries()].filter(([k])=>k.startsWith(args[0]+':')).flatMap(([k,v])=>v.map(permission_key=>({user_id:Number(k.split(':')[1]),permission_key})))};
  }
  if(sql.startsWith('SELECT b.id,b.name FROM chat_workspace_branches')){
   const all=args[0]===10?[{id:101,name:'Branch A'},{id:102,name:'Branch B'}]:[{id:201,name:'Other Owner'}];
   return{rows:args.length===2?all.filter(x=>x.id===args[1]):all};
  }
  if(sql.startsWith('SELECT COUNT(*) AS count,COALESCE(SUM(CASE')){
   return{rows:[{count:0,total_sales:0}]};
  }
  if(sql.startsWith('SELECT s.id,s.reference,s.sold_at'))return{rows:[]};
  if(sql.startsWith('SELECT COUNT(*) AS count,COALESCE(SUM(e.'))return{rows:[{count:0}]};
  if(sql.startsWith('SELECT e.*,b.name AS branch_name'))return{rows:[]};
  if(sql.startsWith('INSERT INTO pos_expenses('))return{rows:[{id:'test-record'}]};
  throw Error('Unexpected query: '+sql.slice(0,180));
 }};
async function main(){
 await access.migrate(db);
 assert(ddl.some(sql=>sql.includes('cashier_feature_grants')));
 assert.deepEqual(await access.forUser(db,users[2]),[]);
 assert.deepEqual(await access.forUser(db,users[1]),access.KEYS);
 await assert.rejects(access.requireAccess(db,users[2],'transactions.view'),{status:403});
 await assert.rejects(access.set(db,users[2],2,['transactions.view']),{status:403});
 await assert.rejects(access.set(db,users[1],3,['transactions.view']),{status:403});
 await assert.rejects(access.set(db,users[1],2,['users.manage']),{status:400});
 const granted=await access.set(db,users[1],2,['transactions.view','expenses.manage']);
 assert.deepEqual(granted,['transactions.view','expenses.view','expenses.manage']);
 assert.deepEqual(await access.forUser(db,users[2]),granted);
 const all=await access.forWorkspace(db,10);assert.deepEqual(all.get(2),granted);
 const ledger=await finance.transactions(db,users[2],{branchId:'101'});
 assert.equal(ledger.branches.length,1);
 assert.equal(ledger.branches[0].id,101);
 const financeQueries=calls.filter(x=>x.sql.includes('FROM sales s JOIN chat_workspace_branches'));
 assert(financeQueries.length===2);
 assert(financeQueries.every(x=>x.args.includes(101)),'Sales cannot escape the cashier branch');
 await assert.rejects(finance.transactions(db,users[2],{branchId:'102'}),{status:403});
 const expenses=await finance.expenses(db,users[2],{});
 assert.equal(expenses.branches.length,1);
 assert.equal(expenses.branches[0].id,101);
 await assert.rejects(finance.expenses(db,users[2],{branchId:'102'}),{status:403});
 await assert.rejects(finance.saveExpense(db,users[2],{
  branchId:'102',date:'2026-11-14',rent:100}),{status:403});
 const saved=await finance.saveExpense(db,users[2],{date:'2026-11-14',rent:100});
 assert.equal(saved.branchId,101);
 // Revoking access must block a user who already has a valid session.
 await access.set(db,users[1],2,[]);
 await assert.rejects(finance.transactions(db,users[2],{}),{status:403});
 await assert.rejects(finance.expenses(db,users[2],{}),{status:403});
 await assert.rejects(finance.saveExpense(db,users[2],{date:'2026-11-14'}),{status:403});
 const adminView=await finance.transactions(db,users[1],{});
 assert.equal(adminView.branches.length,2);
 console.log('PASS: per-cashier grants, branch-scoped transactions/expenses, revocation, cross-franchise denial, owner access');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
