'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {Pool}=require('pg');
const retire=require('../lib/retire-test-franchise-accounts');
const requests=require('../lib/public-franchise-requests');
const fs=require('node:fs');
const pool=new Pool({connectionString:process.env.PG_TEST_URL,max:6});
const schema='retire_test_'+crypto.randomBytes(5).toString('hex');
async function client(){
 const c=await pool.connect();
 try{await c.query('SET search_path TO '+schema);return c}
 catch(error){c.release();throw error}
}
const db={engine:'postgres',
 async query(sql,args=[]){const c=await client();try{return await c.query(sql,args)}finally{c.release()}},
 async exec(sql){const c=await client();try{return await c.query(sql)}finally{c.release()}},
 async transaction(fn){const c=await client();try{
  await c.query('BEGIN');
  await c.query('SET LOCAL search_path TO '+schema);
  const tx={engine:'postgres',query:(q,p=[])=>c.query(q,p),exec:q=>c.query(q)};
  const result=await fn(tx);await c.query('COMMIT');return result;
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e}finally{c.release()}}
};
const IDs=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
 '33333333-3333-4333-8333-333333333333'];
async function setup(){
 await pool.query('CREATE SCHEMA '+schema);
 await db.exec('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT)');
 await db.exec('CREATE TABLE users(id BIGINT PRIMARY KEY,username VARCHAR(80) UNIQUE NOT NULL,'+
  'login_username VARCHAR(80),role TEXT NOT NULL,active BOOLEAN NOT NULL,full_name TEXT)');
 await db.exec('CREATE TABLE chat_workspaces(id BIGINT PRIMARY KEY,owner_user_id BIGINT NOT NULL REFERENCES users(id))');
 await db.exec('CREATE TABLE chat_memberships(user_id BIGINT REFERENCES users(id),'+
  'workspace_id BIGINT REFERENCES chat_workspaces(id),PRIMARY KEY(user_id,workspace_id))');
 await db.exec('CREATE TABLE branches(id BIGINT PRIMARY KEY,active BOOLEAN NOT NULL)');
 await db.exec('CREATE TABLE chat_workspace_branches(workspace_id BIGINT REFERENCES chat_workspaces(id),'+
  'branch_id BIGINT REFERENCES branches(id),PRIMARY KEY(workspace_id,branch_id))');
 await db.exec('CREATE TABLE public_franchise_requests(id VARCHAR(40) PRIMARY KEY,'+
  'username VARCHAR(80) NOT NULL,full_name VARCHAR(120),email VARCHAR(180),phone VARCHAR(32),'+
  'status VARCHAR(20),created_at TEXT,updated_at TEXT,reviewed_by TEXT,review_note TEXT,'+
  'requested_plan VARCHAR(20),email_verified_at TEXT)');
 await db.exec('CREATE TABLE franchise_test_accounts(request_id VARCHAR(40) PRIMARY KEY REFERENCES public_franchise_requests(id),'+
  'user_id BIGINT REFERENCES users(id),workspace_id BIGINT REFERENCES chat_workspaces(id),'+
  'branch_id BIGINT REFERENCES branches(id))');
 await db.exec('CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id BIGINT REFERENCES users(id))');
 await db.exec('CREATE TABLE platform_account_plans(workspace_id BIGINT PRIMARY KEY REFERENCES chat_workspaces(id),'+
  'status TEXT,updated_at TEXT,updated_by TEXT)');
 await db.exec('CREATE TABLE branch_live_sales(reference TEXT PRIMARY KEY,workspace_id BIGINT,branch_id BIGINT,actual NUMERIC)');
 await db.exec('CREATE TABLE branch_inventory_movements(id BIGINT PRIMARY KEY,workspace_id BIGINT,branch_id BIGINT,quantity_change NUMERIC)');
 await db.query("INSERT INTO users VALUES"+
  "(1,'test1','test1','Admin',TRUE,'Old Test One'),"+
  "(2,'test123','test123','Admin',TRUE,'Old Test 123'),"+
  "(3,'real_owner','real_owner','Admin',TRUE,'Unrelated real owner'),"+
  "(4,'demo_cashier','demo_cashier','User',TRUE,'Test cashier')");
 await db.query('INSERT INTO chat_workspaces VALUES(10,1),(20,2),(30,3)');
 await db.query('INSERT INTO chat_memberships VALUES(1,10),(2,20),(3,30),(4,10)');
 await db.query('INSERT INTO branches VALUES(101,TRUE),(201,TRUE),(301,TRUE)');
 await db.query('INSERT INTO chat_workspace_branches VALUES(10,101),(20,201),(30,301)');
 await db.query('INSERT INTO public_franchise_requests(id,username,full_name,email,phone,status,created_at,updated_at,requested_plan) '+
  'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9),($10,$11,$12,$13,$14,$15,$16,$17,$18),'+
  '($19,$20,$21,$22,$23,$24,$25,$26,$27)',
  [IDs[0],'test1','Old One','old1@example.com','09171111111','PENDING',new Date().toISOString(),new Date().toISOString(),'PRO',
   IDs[1],'test123','Old 123','old123@example.com','09172222222','CONTACTED',new Date().toISOString(),new Date().toISOString(),'BUSINESS',
   IDs[2],'real_owner','Real','real@example.com','09173333333','PENDING',new Date().toISOString(),new Date().toISOString(),'PRO']);
 await db.query('INSERT INTO franchise_test_accounts VALUES($1,1,10,101),($2,2,20,201),($3,3,30,301)',IDs);
 await db.query("INSERT INTO sessions VALUES('t1',1),('t2',2),('t3',3),('cashier',4)");
 await db.query("INSERT INTO platform_account_plans VALUES"+
  "(10,'PAID',now(),'Admin Control'),(20,'PAID',now(),'Admin Control'),(30,'PAID',now(),'Admin Control')");
 await db.query("INSERT INTO branch_live_sales VALUES('saleA',10,101,90),('saleB',20,201,20),('saleReal',30,301,100)");
 await db.query("INSERT INTO branch_inventory_movements VALUES(1,10,101,-.1),(2,20,201,-.2),(3,30,301,-.3)");
}
async function test(){
 await setup();
 const first=await retire.retire(db);
 assert.equal(first.status,'completed');
 assert.deepEqual(first.results.map(x=>x.username),['test1','test123']);
 assert(first.results.every(x=>x.status==='retired_and_username_released'));
 const users=await db.query('SELECT id,username,login_username,active FROM users ORDER BY id');
 assert.match(users.rows[0].username,/^retired_demo_test1_1$/);
 assert.match(users.rows[1].username,/^retired_demo_test123_2$/);
 assert.equal(users.rows[0].active,false);
 assert.equal(users.rows[1].active,false);
 assert.equal(users.rows[2].active,true,'Real franchise remains active');
 assert.equal(users.rows[3].active,false,'Retired workspace cashier access revoked');
 const blocked=await db.query('SELECT 1 FROM users WHERE LOWER(username) IN ($1,$2) OR '+
  'LOWER(login_username) IN ($1,$2)',['test1','test123']);
 assert.equal(blocked.rows.length,0,'Both requested login names are free');
 const history=await db.query('SELECT reference FROM branch_live_sales ORDER BY reference');
 assert.deepEqual(history.rows.map(x=>x.reference),['saleA','saleB','saleReal'],
  'Receipts must never be destroyed when freeing test logins');
 assert.equal((await db.query('SELECT COUNT(*) AS count FROM branch_inventory_movements')).rows[0].count,'3');
 assert.deepEqual((await db.query('SELECT status FROM public_franchise_requests ORDER BY id')).rows.map(x=>x.status),
  ['RETIRED','RETIRED','PENDING']);
 const branches=await db.query('SELECT id,active FROM branches ORDER BY id');
 assert.deepEqual(branches.rows.map(x=>x.active),[false,false,true]);
 const planStatuses=(await db.query('SELECT status FROM platform_account_plans ORDER BY workspace_id')).rows.map(x=>x.status);
 assert.deepEqual(planStatuses,['ON_HOLD','ON_HOLD','PAID']);
 assert.deepEqual((await db.query('SELECT token_hash FROM sessions ORDER BY token_hash')).rows.map(x=>x.token_hash),['t3']);
 const replay=await retire.retire(db);
 assert.equal(replay.status,'already_processed');
 // A brand new application can safely reuse each released username after retirement.
 for(const name of ['test1','test123']){
  const r=await requests.request(db,{username:name,fullName:'New Live Owner',
   email:'new'+name+'@example.com',phone:'09174444444',requestedPlan:'BUSINESS'});
  assert.equal(r.ok,true);
  assert.equal(typeof r.applicationId,'string');
 }
 const count=(await db.query("SELECT COUNT(*) AS count FROM public_franchise_requests WHERE status='PENDING' AND username IN ('test1','test123')")).rows[0];
 assert.equal(Number(count.count),2);
 assert.match(fs.readFileSync('lib/platform-accounts.js','utf8'),/fr\.status=\$1/);
 assert.match(fs.readFileSync('lib/public-franchise-requests.js','utf8'),/WHERE r\.status<>\$1/);
 console.log('PASS: old demo franchise owners safely retired once, usernames reusable, audited sales preserved, unrelated owner untouched.');
}
test().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{
 await pool.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE').catch(()=>{});
 await pool.end();
});
