'use strict';
// npm-free regression: run with node scripts/dashboard-shift-deposits-regression.js
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const deposits=require('../lib/franchise-shift-deposits');
const users={
 1:{workspace:101,branch:null,role:'Admin'},
 2:{workspace:101,branch:7,role:'User'},
 3:{workspace:101,branch:8,role:'User'},
 4:{workspace:101,branch:7,role:'User',noGrant:true},
 5:{workspace:202,branch:9,role:'User'}
};
const asUser=id=>({id,role:users[id].role,branchActive:true});
const rows=new Map(),audits=[],schema=[],requests=[];
const key=(ws,user,date)=>ws+'/'+user+'/'+date;
const db={
 engine:'postgres',
 exec:async sql=>schema.push(sql),
 transaction:async callback=>callback(db),
 query:async(sql,args)=>{
  requests.push({sql,args});
  if(sql.startsWith('SELECT m.workspace_id,u.branch_id')){
   const u=users[args[0]];
   return{rows:u?[{workspace_id:u.workspace,branch_id:u.branch,role:u.role,active:true}]:[]};
  }
  // Actual cashier-access module verifies workspace and dashboard.view.
  if(sql.startsWith('SELECT workspace_id FROM chat_memberships WHERE user_id=')){
   const u=users[args[0]];return{rows:u?[{workspace_id:u.workspace}]:[]};
  }
  if(sql.startsWith('SELECT permission_key FROM cashier_feature_grants')){
   return{rows:users[args[1]]?.noGrant?[]:[{permission_key:'dashboard.view'}]};
  }
  if(sql.startsWith('SELECT COUNT(*) AS count')){
   const [workspace,from,to,branch]=args;
   const matched=[...rows.values()].filter(r=>r.workspace===workspace&&r.date>=from&&r.date<=to&&
    (branch==null||r.branch===branch));
   return{rows:[{count:matched.length,total:matched.reduce((s,x)=>s+x.amount,0)}]};
  }
  if(sql.startsWith('SELECT amount_centavos,updated_at')){
   const [ws,u,b,date]=args,r=rows.get(key(ws,u,date));
   return{rows:r&&r.branch===b?[{amount_centavos:r.amount,updated_at:r.updated}]:[]};
  }
  if(sql.startsWith('SELECT id,branch_id,amount_centavos FROM')){
   const [ws,u,date]=args,r=rows.get(key(ws,u,date));
   return{rows:r?[{id:r.id,branch_id:r.branch,amount_centavos:r.amount}]:[]};
  }
  if(sql.startsWith('SELECT 1 FROM chat_workspace_branches')){
   const [workspace,branch]=args;
   return{rows:workspace===101&&[7,8].includes(branch)||workspace===202&&branch===9?[{ok:1}]:[]};
  }
  if(sql.startsWith('INSERT INTO franchise_shift_deposits')){
   const [id,workspace,branch,user,date,amount,,updated]=args;
   rows.set(key(workspace,user,date),{id,workspace,branch,user,date,amount,updated});
   return{rows:[]};
  }
  if(sql.startsWith('INSERT INTO franchise_shift_deposit_audit')){
   audits.push(args);return{rows:[]};
  }
  throw Error('Unhandled regression query: '+sql.slice(0,140));
 }
};
const blocked=async fn=>{
 let denied=false;try{await fn()}catch(e){denied=true}
 assert(denied,'Expected authorization/validation failure');
};
async function run(){
 await deposits.migrate(db);
 assert.equal(schema.length,3);
 assert.match(schema[0],/UNIQUE\(workspace_id,user_id,work_day\)/);
 assert.match(schema[2],/franchise_shift_deposit_audit/);
 let s=await deposits.summary(db,asUser(1),{branchId:'all'});
 assert.equal(s.total,null);assert.equal(s.recorded,false);
 s=await deposits.save(db,asUser(2),{amount:123.45});
 assert.equal(s.total,123.45);assert.equal(s.mineAmount,123.45);
 await deposits.save(db,asUser(3),{amount:200});
 assert.equal((await deposits.summary(db,asUser(1),{branchId:'7'})).total,123.45);
 assert.equal((await deposits.summary(db,asUser(1),{branchId:'all'})).total,323.45);
 const date=deposits.day();
 assert.equal((await deposits.summary(db,asUser(1),{branchId:'all',from:date,to:date})).total,323.45);
 await blocked(()=>deposits.summary(db,asUser(2),{from:'2026-01-01',to:date}));
 await blocked(()=>deposits.summary(db,asUser(1),{from:date,to:'2099-01-01'}));
 assert.equal((await deposits.summary(db,asUser(5),{})).total,null);
 await blocked(()=>deposits.summary(db,asUser(2),{branchId:'8'}));
 await blocked(()=>deposits.summary(db,asUser(2),{branchId:'all'}));
 await blocked(()=>deposits.save(db,asUser(4),{amount:10}));
 await blocked(()=>deposits.save(db,asUser(1),{amount:10}));
 await blocked(()=>deposits.save(db,asUser(2),{amount:-1}));
 await blocked(()=>deposits.save(db,asUser(2),{amount:5.555}));
 await blocked(()=>deposits.save(db,asUser(2),{amount:1,date:'2025-11-01'}));
 await deposits.save(db,asUser(2),{amount:150});
 assert.equal(audits.length,3);
 assert.equal(audits[2][4],12345);assert.equal(audits[2][5],15000);
 const noChange=await deposits.save(db,asUser(2),{amount:'150.00'});
 assert.equal(noChange.unchanged,true);assert.equal(audits.length,3);
 users[2].branch=8;
 await blocked(()=>deposits.save(db,asUser(2),{amount:180}));
 users[2].branch=7;

 // Keep the public drilldown and both API adapters in sync with the ledger.
 const root=path.join(__dirname,'..');
 const read=file=>fs.readFileSync(path.join(root,file),'utf8');
 const ui=read('public/dashboard-kpi-drilldown-v20261118.js');
 const live=read('lib/franchise-unified-dashboard.js');
 const legacy=read('server.js');
 const adapter=read('public/franchise-unified-adapter.js');
 assert.match(ui,/Cost of Goods/);
 assert.match(ui,/Sale Deposit Amount/);
 assert.match(ui,/dmShiftDepositForm/);
 assert.match(ui,/categoryItems/);
 assert.match(ui,/dm-kpi-category/);
 assert.doesNotMatch(ui,/recentPanel\(main\)/);
 assert.match(ui,/if\(isAdmin&&key!=='expenses'\)body\+=timelinePanel/);
 assert.match(ui,/if\(isAdmin&&key!=='expenses'\)await mountActivityChart/);
 assert.match(live,/categoryItems=categoryItemRows.rows.map/);
 assert.match(legacy,/categoryItems:categoryItemRows.rows.map/);
 assert.match(adapter,/\/api\/live\/dashboard\/shift-deposits/);
 console.log('PASS shift deposit authorization/audit/tenant separation and dashboard drilldown regression');
}
run().catch(error=>{console.error(error);process.exitCode=1});
