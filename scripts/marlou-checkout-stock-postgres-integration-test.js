'use strict';
const assert=require('node:assert/strict');
const {Pool}=require('pg');
const crypto=require('node:crypto');
const bridge=require('../lib/marlou-checkout-stock-bridge');
const pool=new Pool({connectionString:process.env.PG_TEST_URL,max:4});
const schema='checkout_bridge_'+crypto.randomBytes(5).toString('hex');
async function withTransaction(work){
 const conn=await pool.connect();
 try{
  await conn.query('BEGIN');
  await conn.query('SET LOCAL search_path TO '+schema);
  const result=await work(conn);
  await conn.query('COMMIT');
  return result;
 }catch(e){await conn.query('ROLLBACK').catch(()=>{});throw e}
 finally{conn.release()}
}
async function query(sql,params=[]){
 const conn=await pool.connect();
 try{await conn.query('SET search_path TO '+schema);return await conn.query(sql,params)}
 finally{conn.release()}
}
async function run(){
 await pool.query('CREATE SCHEMA '+schema);
 await query('CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT NOT NULL,login_username TEXT)');
 await query('CREATE TABLE chat_workspaces(id INTEGER PRIMARY KEY,owner_user_id INTEGER REFERENCES users(id))');
 await query('CREATE TABLE chat_workspace_branches(workspace_id INTEGER NOT NULL,branch_id INTEGER NOT NULL,PRIMARY KEY(workspace_id,branch_id))');
 await query('CREATE TABLE branch_catalog_provisioning(workspace_id INTEGER NOT NULL,branch_id INTEGER NOT NULL,PRIMARY KEY(workspace_id,branch_id))');
 await query('CREATE TABLE ingredients(id INTEGER PRIMARY KEY,code TEXT,uom TEXT)');
 await query('CREATE TABLE branch_ingredients('+
  'id INTEGER PRIMARY KEY,workspace_id INTEGER NOT NULL,branch_id INTEGER NOT NULL,'+
  'code TEXT,display_name TEXT,uom TEXT,active BOOLEAN,stock_qty NUMERIC(18,6) NOT NULL CHECK(stock_qty>=0),updated_at TIMESTAMPTZ DEFAULT NOW())');
 await query('CREATE TABLE branch_inventory_movements('+
  'id BIGSERIAL PRIMARY KEY,workspace_id INTEGER,branch_id INTEGER,ingredient_id INTEGER,'+
  'movement_type VARCHAR(40),quantity_change NUMERIC(18,9),balance_after NUMERIC(18,6),'+
  'reference TEXT,remarks TEXT,created_by INTEGER,created_at TIMESTAMPTZ DEFAULT NOW())');
 await query("INSERT INTO users VALUES(1,'marlou09','marlou09'),(2,'otherowner','otherowner')");
 await query('INSERT INTO chat_workspaces VALUES (1,1),(2,2)');
 await query('INSERT INTO chat_workspace_branches VALUES(1,101),(1,102),(2,201)');
 await query('INSERT INTO branch_catalog_provisioning VALUES(1,101),(1,102),(2,201)');
 await query("INSERT INTO ingredients VALUES(11,'BEANS','KG'),(12,'SUGAR','KG')");
 await query("INSERT INTO branch_ingredients(id,workspace_id,branch_id,code,display_name,uom,active,stock_qty) VALUES"+
  "(111,1,101,'BEANS','Beans','KG',TRUE,5),(112,1,101,'SUGAR','Sugar','KG',TRUE,5),"+
  "(121,1,102,'BEANS','Beans','KG',TRUE,5),(122,1,102,'SUGAR','Sugar','KG',TRUE,5),"+
  "(211,2,201,'BEANS','Beans','KG',TRUE,5)");
 const first=await withTransaction(tx=>bridge.applySale(tx,{workspaceId:1,branchId:101,
  requirements:[{ingredientId:11,needed:.125,name:'Beans'},{ingredientId:12,needed:.01,name:'Sugar'}],
  reference:'POS-01',actorId:1}));
 assert.deepEqual(first,{mirrored:true,items:2});
 let stocks=await query('SELECT id,stock_qty FROM branch_ingredients ORDER BY id');
 assert.deepEqual(stocks.rows.map(x=>Number(x.stock_qty)),[4.875,4.99,5,5,5]);
 let count=await query("SELECT COUNT(*)::integer AS n FROM branch_inventory_movements WHERE movement_type='POS_SALE'");
 assert.equal(count.rows[0].n,2);
 const unrelated=await withTransaction(tx=>bridge.applySale(tx,{workspaceId:2,branchId:201,
  requirements:[{ingredientId:11,needed:1,name:'Beans'}],reference:'OTHER',actorId:2}));
 assert.equal(unrelated.mirrored,false);
 const pre=await query('SELECT id,stock_qty FROM branch_ingredients ORDER BY id');
 await assert.rejects(withTransaction(tx=>bridge.applySale(tx,{workspaceId:1,branchId:101,
  requirements:[{ingredientId:11,needed:.4,name:'Beans'},{ingredientId:12,needed:100,name:'Sugar'}],
  reference:'ROLLBACK',actorId:1})),{status:409});
 stocks=await query('SELECT id,stock_qty FROM branch_ingredients ORDER BY id');
 assert.deepEqual(stocks.rows,pre.rows,'A failed second ingredient must roll back first deduction');
 count=await query("SELECT COUNT(*)::integer AS n FROM branch_inventory_movements WHERE reference='ROLLBACK'");
 assert.equal(count.rows[0].n,0);

 const restored=await withTransaction(tx=>bridge.restoreSale(tx,{workspaceId:1,branchId:101,reference:'POS-01',actorId:1}));
 assert.deepEqual(restored,{mirrored:true,items:2});
 stocks=await query('SELECT id,stock_qty FROM branch_ingredients ORDER BY id');
 assert.deepEqual(stocks.rows.map(x=>Number(x.stock_qty)),[5,5,5,5,5]);
 const previous=await withTransaction(tx=>bridge.restoreSale(tx,{workspaceId:1,branchId:101,reference:'OLD-NOT-MIRRORED',actorId:1}));
 assert.equal(previous.items,0);

 // Two concurrent checkouts for a single 0.15-unit stock balance: exactly one may succeed.
 await query('UPDATE branch_ingredients SET stock_qty=0.15 WHERE id=121');
 const attempts=await Promise.allSettled([1,2].map(n=>withTransaction(tx=>bridge.applySale(tx,{
  workspaceId:1,branchId:102,requirements:[{ingredientId:11,needed:.1,name:'Beans'}],
  reference:'RACE-'+n,actorId:1
 }))));
 assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(attempts.filter(x=>x.status==='rejected'&&x.reason.status===409).length,1);
 const result=await query('SELECT stock_qty FROM branch_ingredients WHERE id=121');
 assert.equal(Number(result.rows[0].stock_qty),.05);
 count=await query("SELECT COUNT(*)::integer AS n FROM branch_inventory_movements WHERE branch_id=102 AND movement_type='POS_SALE'");
 assert.equal(count.rows[0].n,1);
 console.log('PASS Postgres: real transactional mirror, branch ownership, rollback, reversal, prior-sale no-op, and concurrent oversell protection.');
}
run().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{await pool.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE').catch(()=>{});await pool.end()});
