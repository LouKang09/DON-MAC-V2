'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {Pool}=require('pg');
const isolatedSchema=require('../lib/branch-isolated-schema');
const liveScope=require('../lib/franchise-live-scope');
const liveCatalog=require('../lib/franchise-live-catalog');
const liveSales=require('../lib/franchise-live-sales');
const expenses=require('../lib/franchise-live-expenses');
const finance=require('../lib/franchise-live-finance');
const accountModes=require('../lib/franchise-account-modes');
const incoming=require('../lib/branch-incoming-supply');
const liveRouter=require('../lib/franchise-live-router');
const cashierAccess=require('../lib/cashier-access');
const seed=require('../lib/branch-catalog-seeding');
const pool=new Pool({connectionString:process.env.PG_TEST_URL,max:8});
const schema='franchise_live_'+crypto.randomBytes(5).toString('hex');
async function client(){
 const conn=await pool.connect();
 try{await conn.query('SET search_path TO '+schema);return conn}
 catch(e){conn.release();throw e}
}
const db={engine:'postgres',
 async query(sql,params=[]){const c=await client();try{return await c.query(sql,params)}finally{c.release()}},
 async exec(sql){const c=await client();try{return await c.query(sql)}finally{c.release()}},
 async transaction(work){
  const c=await client();
  try{
   await c.query('BEGIN');
   await c.query('SET LOCAL search_path TO '+schema);
   const tx={engine:'postgres',query:(sql,p=[])=>c.query(sql,p),exec:sql=>c.query(sql)};
   const result=await work(tx);await c.query('COMMIT');return result;
  }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e}
  finally{c.release()}
 }};
const ownerA={id:1,username:'ownerA',role:'Admin'},ownerB={id:2,username:'ownerB',role:'Admin'},
 cashierA={id:3,username:'cashierA',role:'User'},cashierB={id:4,username:'cashierB',role:'User'};
let productA,productB,ingredientA,ingredientB,ctxA,ctxB,ctxCashierA,ctxCashierB;
async function setup(){
 await pool.query('CREATE SCHEMA '+schema);
 await db.exec('CREATE TABLE users(id BIGSERIAL PRIMARY KEY,username TEXT NOT NULL,login_username TEXT,'+
  'password_hash TEXT,role TEXT NOT NULL,active BOOLEAN NOT NULL,branch_id BIGINT,'+
  'created_at TEXT,full_name TEXT,owner_scope_id BIGINT,email TEXT,phone TEXT,profile_photo TEXT)');
 await db.exec('CREATE TABLE sessions(id TEXT PRIMARY KEY,user_id BIGINT)');
 await db.exec('CREATE TABLE branches(id BIGSERIAL PRIMARY KEY,name TEXT NOT NULL,active BOOLEAN NOT NULL,address TEXT,'+
  'city TEXT,province TEXT,postal_code TEXT,country TEXT,phone TEXT,description TEXT)');
 await db.exec('CREATE TABLE chat_workspaces(id BIGINT PRIMARY KEY,owner_user_id BIGINT NOT NULL REFERENCES users(id))');
 await db.exec('CREATE TABLE chat_memberships(user_id BIGINT REFERENCES users(id),workspace_id BIGINT REFERENCES chat_workspaces(id),PRIMARY KEY(user_id,workspace_id))');
 await db.exec('CREATE TABLE chat_workspace_branches(workspace_id BIGINT REFERENCES chat_workspaces(id),branch_id BIGINT REFERENCES branches(id),PRIMARY KEY(workspace_id,branch_id))');
 await db.exec('CREATE TABLE franchise_test_accounts(request_id TEXT PRIMARY KEY,user_id BIGINT,workspace_id BIGINT,branch_id BIGINT,created_at TEXT,created_by TEXT)');
 await db.exec('CREATE TABLE platform_account_plans(workspace_id BIGINT PRIMARY KEY,status TEXT,plan TEXT,amount NUMERIC(12,2),base_amount NUMERIC(12,2),next_payment_date TEXT)');
 await db.exec('CREATE TABLE branch_catalog_provisioning(workspace_id BIGINT NOT NULL,branch_id BIGINT NOT NULL,PRIMARY KEY(workspace_id,branch_id))');
 await db.query("INSERT INTO users(id,username,login_username,role,active,branch_id,full_name) VALUES"+
  "(1,'ownerA','ownerA','Admin',TRUE,NULL,'A Owner'),"+
  "(2,'ownerB','ownerB','Admin',TRUE,NULL,'B Owner'),"+
  "(3,'cashierA','cashierA','User',TRUE,101,'A Cashier'),"+
  "(4,'cashierB','cashierB','User',TRUE,201,'B Cashier')");
 await db.query("SELECT setval(pg_get_serial_sequence('users','id'),(SELECT MAX(id) FROM users))");
 await db.query("INSERT INTO branches(id,name,active) VALUES(101,'Cebu A',TRUE),(201,'Cebu B',TRUE)");
 await db.query("SELECT setval(pg_get_serial_sequence('branches','id'),(SELECT MAX(id) FROM branches))");
 await db.query('INSERT INTO chat_workspaces VALUES(10,1),(20,2)');
 await db.query('INSERT INTO chat_memberships VALUES(1,10),(2,20),(3,10),(4,20)');
 await db.query('INSERT INTO chat_workspace_branches VALUES(10,101),(20,201)');
 await db.query('INSERT INTO branch_catalog_provisioning VALUES(10,101),(20,201)');
 await db.query("INSERT INTO franchise_test_accounts VALUES('11111111-1111-4111-8111-111111111111',1,10,101,now(),'OTP'),"+
  "('22222222-2222-4222-8222-222222222222',2,20,201,now(),'OTP')");
 await db.query("INSERT INTO platform_account_plans(workspace_id,status,plan,amount,base_amount) VALUES(10,'UNPAID','PRO',0,0),(20,'PAID','PRO',0,0)");
 await accountModes.migrate(db);
 await accountModes.register(db,10,'NEW','isolated PostgreSQL test');
 await accountModes.register(db,20,'NEW','isolated PostgreSQL test');
 for(const stmt of isolatedSchema.statements('postgres'))await db.exec(stmt);
 await liveSales.migrate(db);await expenses.migrate(db);await cashierAccess.migrate(db);
 await incoming.migrate(db);
 await db.query("INSERT INTO branch_categories(workspace_id,branch_id,name,active) VALUES(10,101,'Coffee',TRUE),(20,201,'Coffee',TRUE)");
 // Both franchises deliberately choose identical names; the rows must stay separate.
 const product=await db.query("INSERT INTO branch_products(workspace_id,branch_id,sku,name,category,price,active) VALUES"+
  "(10,101,'A-LATTE','test1','Coffee',99,TRUE),(20,201,'B-LATTE','test1','Coffee',77,TRUE) RETURNING id,workspace_id");
 productA=Number(product.rows.find(x=>Number(x.workspace_id)===10).id);
 productB=Number(product.rows.find(x=>Number(x.workspace_id)===20).id);
 const ingredients=await db.query("INSERT INTO branch_ingredients(workspace_id,branch_id,code,display_name,uom,stock_qty,low_stock_threshold,unit_cost,active) VALUES"+
  "(10,101,'A-BEANS','Beans','KG',0.25,0.1,20,TRUE),"+
  "(20,201,'B-BEANS','Beans','KG',0.25,0.1,25,TRUE) RETURNING id,workspace_id");
 ingredientA=Number(ingredients.rows.find(x=>Number(x.workspace_id)===10).id);
 ingredientB=Number(ingredients.rows.find(x=>Number(x.workspace_id)===20).id);
 await db.query('INSERT INTO branch_recipes(workspace_id,branch_id,product_id,ingredient_id,quantity_required,cost_contribution) '+
  'VALUES(10,101,$1,$2,0.1,2),(20,201,$3,$4,0.1,2.5)',
  [productA,ingredientA,productB,ingredientB]);
}
async function stock(ws,branch,iid){
 const r=await db.query('SELECT stock_qty FROM branch_ingredients WHERE workspace_id=$1 AND branch_id=$2 AND id=$3',
  [ws,branch,iid]);return Number(r.rows[0]?.stock_qty);
}
const uuid=()=>crypto.randomUUID();
async function checkout(cashier,idempotencyKey,quantity=1){
 return liveSales.sale(db,cashier,{clientRequestId:idempotencyKey,branchId:cashier.branchId,
  items:[{kind:'product',id:cashier.workspaceId===10?productA:productB,qty:quantity}],
  paymentMode:'Cash',tender:300,orderType:'Take Away',customerName:'Live test'});
}
async function run(){
 await setup();
 assert.equal((await liveScope.candidate(db,1)).liveEnabled,false,
  'Unpaid application must not enter production POS');
 assert.equal(await liveScope.active(db,ownerA),null);
 const setupOwner=await liveScope.setup(db,ownerA),setupCashier=await liveScope.setup(db,cashierA);
 assert.equal(setupOwner.workspaceId,10);assert.equal(setupOwner.subscriptionActive,false);
 assert.equal(setupCashier.cashier,true);
 assert.throws(()=>liveScope.requirePaid(setupCashier),{status:403});
 await assert.rejects(liveSales.sale(db,setupCashier,{}),{status:403},
  'A cashier cannot sell with a fabricated checkout request before payment');
 await assert.rejects(liveRouter.run(db,setupCashier,cashierA,'POST',
  new URL('https://donmacpos.com/api/live/checkout'),async()=>({
    clientRequestId:crypto.randomUUID(),items:[{kind:'product',id:productA,qty:1}],
    paymentMode:'Cash',tender:100})),{status:403});
 await assert.rejects(liveRouter.run(db,setupCashier,cashierA,'GET',
  new URL('https://donmacpos.com/api/live/transactions'),async()=>({})),{status:403});
 await assert.rejects(liveRouter.run(db,setupCashier,cashierA,'GET',
  new URL('https://donmacpos.com/api/live/finance/transactions'),async()=>({})),{status:403},
  'Unpaid cashiers cannot access the finance ledgers');
 const setupStatus=await liveRouter.run(db,setupOwner,ownerA,'GET',
  new URL('https://donmacpos.com/api/live/status'),async()=>({}));
 assert.equal(setupStatus.data.setupMode,true);
 assert.equal(setupStatus.data.subscriptionStatus,'UNPAID');
 assert.equal(setupStatus.data.branches.length,1);
 const initialCashier=await liveScope.createCashier(db,setupOwner,{
  username:'setupCashier',fullName:'Created Before Payment',password:'NewPass123456',branchId:101});
 assert(initialCashier.id>0);
 await liveScope.setCashierPermissions(db,setupOwner,initialCashier.id,
  ['transactions.view','expenses.manage']);
 const roster=await liveScope.cashiers(db,setupOwner);
 assert.equal(roster.find(x=>x.id===initialCashier.id).permissions.length,3);
 assert.equal((await cashierAccess.forUser(db,{id:initialCashier.id,role:'User'})).includes('expenses.view'),true);
 await assert.rejects(liveScope.setCashierPermissions(db,setupOwner,4,['transactions.view']),{status:403},
  'Owner of franchise A cannot grant access to the cashier in franchise B');
 // A real PostgreSQL branch record is inserted transactionally and belongs to only A.
 // The verified catalog seeding unit suite separately tests the full template copy.
 const readOriginal=seed.readTemplate,seedOriginal=seed.seedBranch;
 seed.readTemplate=async()=>({id:1,template:{}});
 seed.seedBranch=async(tx,ws,branch,master,opening)=>{
  await tx.query('INSERT INTO branch_catalog_provisioning(workspace_id,branch_id) VALUES($1,$2)',
   [ws,branch]);return{status:'prepared',openingStock:opening};
 };
 try{
  const branch1=await liveScope.createBranch(db,setupOwner,{name:'New Setup Branch'});
  const branch2=await liveScope.createBranch(db,setupOwner,{name:'Second Setup Branch'});
  assert.equal(branch1.workspaceId,10);assert.equal(branch1.openingStock,0);
  assert.equal(branch2.workspaceId,10);
  assert.equal((await liveScope.branches(db,setupOwner)).length,3);
  assert.equal((await liveScope.branches(db,await liveScope.setup(db,ownerB))).length,1);
  await assert.rejects(liveScope.createBranch(db,setupOwner,{name:'Pro Fourth Branch'}),{status:409});
 }finally{seed.readTemplate=readOriginal;seed.seedBranch=seedOriginal}
 await db.query("UPDATE platform_account_plans SET status='PAID' WHERE workspace_id=10");
 ctxA=await liveScope.active(db,ownerA);ctxB=await liveScope.active(db,ownerB);
 ctxCashierA=await liveScope.active(db,cashierA);ctxCashierB=await liveScope.active(db,cashierB);
 assert.equal(ctxA.workspaceId,10);assert.equal(ctxB.workspaceId,20);
 assert.equal(ctxCashierA.branchId,101);assert.equal(ctxCashierB.branchId,201);
 await assert.rejects(liveScope.branch(db,ctxCashierA,201),{status:403});
 await assert.rejects(liveScope.branch(db,ctxA,201),{status:403});
 assert.throws(()=>liveScope.requireCashier(ctxA),{status:403});
 let c=await liveCatalog.catalog(db,ctxCashierA,101);
 assert.equal(c.products.length,1);assert.equal(c.products[0].name,'test1');
 assert.equal(c.products[0].id,productA);
 assert.equal(c.products[0].recipeStock[0].current,.25);
 assert.equal(c.liveCheckoutUsesLegacyTables,false);
 const other=await liveCatalog.catalog(db,ctxCashierB,201);
 assert.equal(other.products.length,1);assert.equal(other.products[0].id,productB);
 assert.notEqual(other.products[0].price,c.products[0].price);
 const changed=await liveCatalog.saveProduct(db,ctxA,101,productA,{name:'test1',category:'Coffee',price:109,active:true});
 assert.equal(changed.id,productA);
 c=await liveCatalog.catalog(db,ctxCashierA,101);
 assert.equal(c.products[0].price,109);
 assert.equal((await liveCatalog.catalog(db,ctxCashierB,201)).products[0].price,77);
 await assert.rejects(liveCatalog.saveProduct(db,ctxA,201,productB,{name:'Hacked',category:'Coffee',price:1}),{status:403});
 const added=await liveCatalog.saveProduct(db,ctxA,101,0,{name:'private new product',category:'Coffee',price:10});
 assert(added.id>0);
 assert.equal((await liveCatalog.catalog(db,ctxB,201)).products.length,1,
  'New product never appears in another franchise');
 const newIng=await liveCatalog.saveIngredient(db,ctxA,101,0,{name:'Private Syrup',uom:'ML',lowStockThreshold:1,unitCost:0.5});
 assert(newIng.id>0);
 await liveCatalog.saveRecipe(db,ctxA,101,added.id,{items:[{ingredientId:newIng.id,quantity:1,cost:0.5}]});
 const recipe=await liveCatalog.recipe(db,ctxA,101,added.id);
 assert.equal(recipe.items[0].ingredientId,newIng.id);
 await assert.rejects(liveCatalog.saveRecipe(db,ctxA,101,added.id,{items:[{ingredientId:ingredientB,quantity:1}]}),{status:403});
 assert.equal((await liveCatalog.catalog(db,ctxA,101)).products.find(x=>x.id===added.id).available,false,
  'New product with zero stock is automatically disabled');
 // The same original admin Catalog editor now manages photos, promos and packages.
 const image='data:image/jpeg;base64,/9j/4AAQSkZJRg==';
 await liveCatalog.saveProduct(db,ctxA,101,productA,{name:'test1',category:'Coffee',price:109,
  active:true,imageData:image});
 const scopedAdmin=await liveCatalog.manage(db,ctxA,{branchId:101});
 assert.equal(scopedAdmin.products.find(x=>x.id===productA).imageData,image);
 assert.equal(scopedAdmin.products.find(x=>x.id===productA).recipeCount,1);
 assert.equal(scopedAdmin.products.find(x=>x.id===productA).unitCost,2);
 assert(!scopedAdmin.products.some(x=>x.id===productB));
 await liveCatalog.saveIngredient(db,ctxA,101,ingredientA,{
  name:'Beans',uom:'KG',lowStockThreshold:0.1,active:true});
 const retained=(await db.query('SELECT unit_cost FROM branch_ingredients WHERE workspace_id=10 AND branch_id=101 AND id=$1',[ingredientA])).rows[0];
 assert.equal(Number(retained.unit_cost),20,'Ingredient cost survives original form edits');
 const promotion=await liveCatalog.savePromo(db,ctxA,101,0,{
  name:'Afternoon Combo',inclusion:'Coffee + Food',price:88,foodLimit:1,coffeeLimit:1});
 assert(promotion.id>0);
 const packageRow=await liveCatalog.savePackage(db,ctxA,101,0,{
  name:'Private Bundle',price:180,active:true});
 await assert.rejects(liveCatalog.saveComposition(db,ctxA,101,packageRow.id,{
  items:[{productId:productB,qty:1}]}),{status:403},
  'Package cannot include another franchise product');
 await liveCatalog.saveComposition(db,ctxA,101,packageRow.id,{
  items:[{productId:productA,qty:1}]});
 const hydrated=await liveCatalog.manage(db,ctxA,{branchId:101});
 assert.equal(hydrated.packages.find(x=>x.id===packageRow.id).items[0].productId,productA);
 assert.equal(hydrated.promos.find(x=>x.id===promotion.id).inclusion,'Coffee + Food');
 assert.equal((await liveCatalog.catalog(db,ctxCashierA,101)).packages.find(x=>x.id===packageRow.id).contents.length,1);
 await assert.rejects(liveCatalog.savePromo(db,ctxB,101,promotion.id,{
  name:'Cross Franchise',price:1,foodLimit:0,coffeeLimit:0}),{status:403});
 await assert.rejects(liveCatalog.archivePackage(db,ctxB,101,packageRow.id),{status:403});
 await assert.rejects(liveCatalog.archiveProduct(db,ctxB,101,productA),{status:403});
 await assert.rejects(liveCatalog.archiveIngredient(db,ctxA,101,ingredientA),{status:409},
  'Cannot archive an ingredient while a recipe still uses it');
 const isolatedPromo=await liveCatalog.manage(db,ctxB,{branchId:201});
 assert.equal(isolatedPromo.promos.some(x=>x.id===promotion.id),false);
 assert.equal(isolatedPromo.packages.some(x=>x.id===packageRow.id),false);
 await liveCatalog.archivePromo(db,ctxA,101,promotion.id);
 await liveCatalog.archivePackage(db,ctxA,101,packageRow.id);
 assert.equal((await liveCatalog.manage(db,ctxA,{branchId:101})).promos.find(x=>x.id===promotion.id).active,false);
 const q=await liveSales.quote(db,ctxCashierA,{branchId:101,items:[{kind:'product',id:productA,qty:2}]});
 assert.equal(q.gross,218);assert.equal(q.actual,218);
 await assert.rejects(liveSales.quote(db,ctxCashierA,{branchId:101,
  items:[{kind:'product',id:productB,qty:1}]}),{status:409});
 const first=await checkout(ctxCashierA,uuid(),1);
 assert.equal(first.ok,true);assert.match(first.reference,/^BR-[A-F0-9]{18}$/);
 assert.equal(await stock(10,101,ingredientA),.15);
 assert.equal(await stock(20,201,ingredientB),.25);
 const rekey=uuid();const second=await checkout(ctxCashierA,rekey,1);
 assert.equal(await stock(10,101,ingredientA),.05);
 const replay=await checkout(ctxCashierA,rekey,1);
 assert.equal(replay.idempotent,true);
 assert.equal(replay.reference,second.reference);
 assert.equal(await stock(10,101,ingredientA),.05);
 await assert.rejects(checkout(ctxCashierA,rekey,2),{status:409});
 const salesA=await liveSales.transactions(db,ctxA,{branchId:101}),salesB=await liveSales.transactions(db,ctxB,{branchId:201});
 assert.equal(salesA.total,2);assert.equal(salesB.total,0);
 const detail=await liveSales.detail(db,ctxCashierA,first.reference);
 assert.equal(detail.items[0].name,'test1');
 await assert.rejects(liveSales.detail(db,ctxCashierB,first.reference),{status:404});
 const reportA=await liveSales.report(db,ctxA,{branchId:101,range:'week'});
 const reportB=await liveSales.report(db,ctxB,{branchId:201,range:'week'});
 assert.equal(reportA.transactionCount,2);
 assert.equal(reportB.transactionCount,0);
 await expenses.add(db,ctxA,{branchId:101,category:'Supplies',amount:12,notes:'Owner A'});
 assert.equal((await expenses.list(db,ctxA,101)).rows.length,1);
 assert.equal((await expenses.list(db,ctxB,201)).rows.length,0);
 // The existing transaction and expense screens now use scoped SQL.
 const financeDates=new URLSearchParams({start:'2020-01-01',end:'2030-12-31'});
 const financeA=await finance.transactions(db,ctxA,financeDates);
 const financeB=await finance.transactions(db,ctxB,financeDates);
 assert.equal(financeA.total,2);assert.equal(financeB.total,0);
 assert.equal(financeA.rows[0].branch,'Cebu A');
 await assert.rejects(finance.transactions(db,ctxA,new URLSearchParams('branchId=201')),{status:403},
  'A foreign branch cannot be queried from the shared original finance UI');
 await assert.rejects(finance.expenses(db,ctxB,new URLSearchParams('branchId=101')),{status:403});
 const day=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
 const daily={branchId:101,date:day,note:'Operating costs',rent:150,stocks:25,ice:10};
 await finance.saveExpenses(db,ctxA,daily);
 await finance.saveExpenses(db,ctxA,{...daily,rent:200});
 const dailyA=await finance.expenses(db,ctxA,financeDates),dailyB=await finance.expenses(db,ctxB,financeDates);
 assert(dailyA.grandTotal>=247,'Daily expense save and existing entries are counted together');
 assert.equal(dailyB.grandTotal,0,'Other franchise sees no expense rows');
 assert.equal(dailyA.rows.find(x=>x.date===day)?.rent,200,'Same day updated instead of duplicated');
 const current=(await finance.expenses(db,ctxA,financeDates)).rows.find(x=>x.date===day);
 assert.equal(current.stocks,25);
 await assert.rejects(finance.saveExpenses(db,ctxA,{...daily,branchId:201}),{status:403});
 await assert.rejects(finance.saveExpenses(db,{...ctxCashierA,permissions:[]},daily),{status:403});
 // Remaining .05 units: two concurrent 0.1 requests cannot both succeed.
 // Replenish to 0.15 units and test atomic update lock in two DB transactions.
 await db.query('UPDATE branch_ingredients SET stock_qty=0.15 WHERE id=$1 AND workspace_id=10 AND branch_id=101',[ingredientA]);
 const attempts=await Promise.allSettled([checkout(ctxCashierA,uuid()),checkout(ctxCashierA,uuid())]);
 assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(attempts.filter(x=>x.status==='rejected'&&x.reason.status===409).length,1);
 assert.equal(await stock(10,101,ingredientA),.05);
 const afterCount=await liveSales.transactions(db,ctxA,{branchId:101});
 assert.equal(afterCount.total,3);
 const move=(await db.query("SELECT COUNT(*)::integer AS count FROM branch_inventory_movements WHERE workspace_id=10 AND branch_id=101 AND movement_type='LIVE_SALE'")).rows[0];
 assert.equal(move.count,3);
 const voidResult=await liveSales.voidSale(db,ctxA,second.reference,{restoreStock:true});
 assert.equal(voidResult.stockRestored,true);
 assert.equal(await stock(10,101,ingredientA),.15);
 assert.equal(await stock(20,201,ingredientB),.25);
 assert.equal((await liveSales.report(db,ctxA,{branchId:101,range:'week'})).transactionCount,2);
 await assert.rejects(liveSales.voidSale(db,ctxB,first.reference,{restoreStock:true}),{status:404});
 const employee=await liveScope.createCashier(db,ctxA,{username:'newbranchcashier',
  password:'NewPassword123',fullName:'Another Cashier',branchId:101});
 assert.equal(employee.branchId,101);
 assert.equal((await liveScope.candidate(db,employee.id)).workspaceId,10);
 assert.equal((await liveScope.active(db,{id:employee.id,role:'User'})).cashier,true);
 await assert.rejects(liveScope.createCashier(db,ctxA,{username:'otherbranchcashier',
  password:'NewPassword123',fullName:'Foreign',branchId:201}),{status:403});
 const otherSale=await checkout(ctxCashierB,uuid());
 assert.equal(otherSale.ok,true);
 assert.equal(await stock(20,201,ingredientB),.15);
 assert.equal((await liveSales.transactions(db,ctxB,{branchId:201})).total,1);
 assert.equal((await liveSales.transactions(db,ctxA,{branchId:101})).total,3);
 // Original Main POS Branches and Cashiers forms: owner can edit only their own records.
 await liveScope.updateBranch(db,ctxA,101,{
  name:'Cebu A',address:'Cebu City',city:'Cebu',province:'Cebu',postalCode:'6000',
  country:'Philippines',phone:'0123',description:'Owner-managed shop',active:true});
 assert.equal((await liveScope.branches(db,ctxA)).find(x=>x.id===101).city,'Cebu');
 await assert.rejects(liveScope.deactivateBranch(db,ctxA,101),{status:409},
  'Starter branch cannot be disabled without reassigning the login anchor');
 await assert.rejects(liveScope.updateBranch(db,ctxB,101,{name:'Hijack',active:true}),{status:404},
  'Other franchise cannot change branch profile');
 await liveScope.updateCashier(db,ctxA,3,{
  role:'User',branchId:101,fullName:'Cashier A Updated',password:'NewPassword123456',
  active:true,email:'cashier@example.com',phone:'09000000000',photoData:null});
 assert.equal((await liveScope.cashiers(db,ctxA)).find(x=>x.id===3).fullName,'Cashier A Updated');
 await assert.rejects(liveScope.updateCashier(db,ctxB,3,{role:'User',branchId:201,fullName:'Hijack'}),
  {status:404},'Other franchise cannot edit employee');
 await assert.rejects(liveScope.deactivateCashier(db,ctxB,3),{status:404});
 await liveScope.deactivateCashier(db,ctxA,3);
 assert.equal((await liveScope.cashiers(db,ctxA)).find(x=>x.id===3).active,false);
 // Inventory receiving uses the SAME legacy-shaped Main POS workflow, but
 // all transfer and request records are authenticated to the franchise workspace.
 const supply=await incoming.create(db,ownerA,{sourceBranchId:101,receivingBranchId:101,
  sourceLabel:'Independent Supplier',items:[{ingredientId:ingredientA,qty:0.05}]},'SUPPLIER');
 assert.equal(supply.status,'PENDING');
 const availableSupply=await incoming.list(db,ownerA,101);
 assert(availableSupply.requests.some(x=>x.id===supply.id&&x.canReceive));
 await assert.rejects(incoming.process(db,ownerB,supply.id,'reject',{}),{status:403},
  'Foreign franchise cannot reject incoming inventory');
 const supplierStock=await stock(10,101,ingredientA);
 await incoming.process(db,ownerA,supply.id,'receive',{deliveredBy:'Supplier'});
 assert.equal(await stock(10,101,ingredientA),supplierStock+0.05);
 await assert.rejects(incoming.process(db,ownerA,supply.id,'receive',{deliveredBy:'Supplier'}),{status:409},
  'Supplier receipt cannot be credited twice');
 const destination=(await db.query('SELECT branch_id FROM chat_workspace_branches WHERE workspace_id=10 AND branch_id<>101 ORDER BY branch_id LIMIT 1')).rows[0];
 assert(destination,'Owner has a separate destination branch for transfer tests');
 const destBranch=Number(destination.branch_id);
 await db.query("UPDATE platform_account_plans SET plan='BUSINESS' WHERE workspace_id=10");
 const cloned=await db.query('INSERT INTO branch_ingredients(workspace_id,branch_id,code,display_name,'+
  'uom,stock_qty,low_stock_threshold,unit_cost,active) VALUES(10,$1,$2,$3,$4,0,0,0,TRUE) RETURNING id',
  [destBranch,'A-BEANS','Beans','KG']);
 const destIngredient=Number(cloned.rows[0].id);
 const transfer=await incoming.create(db,ownerA,{sourceBranchId:101,destinationBranchId:destBranch,
  items:[{ingredientId:ingredientA,qty:0.05}]},'TRANSFER');
 const preAccepted=await stock(10,101,ingredientA);
 await assert.rejects(incoming.process(db,ownerB,transfer.id,'accept',{}),{status:403});
 assert.equal(await stock(10,101,ingredientA),preAccepted,'Pending transfer leaves stock untouched');
 await incoming.process(db,ownerA,transfer.id,'accept',{});
 assert.equal(await stock(10,101,ingredientA),preAccepted-0.05);
 assert.equal(await stock(10,destBranch,destIngredient),0);
 await incoming.process(db,ownerA,transfer.id,'receive',{deliveredBy:'Courier'});
 assert.equal(await stock(10,destBranch,destIngredient),0.05);
 await assert.rejects(incoming.process(db,ownerA,transfer.id,'receive',{deliveredBy:'Courier'}),{status:409});
 console.log('PASS: scoped supplier receipt, transfer Accept/Receive, foreign franchise denial and no double stock credit.');
 console.log('PASS PostgreSQL: actual branch-isolated sale, price/recipe edits, cashier account, concurrent oversell protection, refunds and per-franchise reports.');
}
run().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{
 await pool.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE').catch(()=>{});
 await pool.end();
});
