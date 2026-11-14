'use strict';
// Explicit sandbox operations: never query or mutate legacy sales, sale_items, or ingredients.
const crypto=require('node:crypto');
const testAccess=require('./franchise-test-access');
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const positiveId=x=>Number.isSafeInteger(Number(x))&&Number(x)>0?Number(x):0;
function positiveQty(x,max){
 const n=Number(x);
 if(!Number.isFinite(n)||n<=0||n>max||Math.round(n*1000)/1000!==n)
  throw fail('Enter a positive quantity up to '+max+' with at most three decimal places.');
 return n;
}
async function migrate(db){
 const fk=db.engine==='postgres'?'BIGINT':'INTEGER';
 await db.exec('CREATE TABLE IF NOT EXISTS franchise_test_sales('+
  'id VARCHAR(40) PRIMARY KEY,'+
  'workspace_id '+fk+' NOT NULL REFERENCES chat_workspaces(id) ON DELETE RESTRICT,'+
  'branch_id '+fk+' NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,'+
  'product_id '+fk+' NOT NULL,'+
  'product_name_snapshot VARCHAR(150) NOT NULL,'+
  'quantity NUMERIC(12,3) NOT NULL CHECK(quantity>0),'+
  'unit_price NUMERIC(12,2) NOT NULL,total NUMERIC(12,2) NOT NULL,'+
  'created_by '+fk+' NOT NULL REFERENCES users(id) ON DELETE RESTRICT,'+
  'created_at TEXT NOT NULL)');
 await db.exec('CREATE INDEX IF NOT EXISTS idx_franchise_test_sales_workspace ON '+
  'franchise_test_sales(workspace_id,branch_id,created_at)');
}
async function replenish(db,userId,body){
 const ingredientId=positiveId(body?.ingredientId),qty=positiveQty(body?.quantity,10000);
 if(!ingredientId)throw fail('Select an ingredient to stock.');
 return db.transaction(async tx=>{
  const t=await testAccess.account(tx,userId);
  if(!t)throw fail('Test account required.',403);
  const row=await tx.query('UPDATE branch_ingredients SET stock_qty=stock_qty+$1,updated_at=CURRENT_TIMESTAMP '+
   'WHERE id=$2 AND workspace_id=$3 AND branch_id=$4 AND active=$5 RETURNING stock_qty,display_name',
   [qty,ingredientId,t.workspaceId,t.branchId,true]);
  if(row.rows.length!==1)throw fail('Ingredient is not in this test branch.',403);
  const after=Number(row.rows[0].stock_qty);
  await tx.query('INSERT INTO branch_inventory_movements('+
   'workspace_id,branch_id,ingredient_id,movement_type,quantity_change,balance_after,reference,created_by) '+
   'VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
   [t.workspaceId,t.branchId,ingredientId,'PHASE2_TEST_REPLENISH',qty,after,
    'TEST-'+crypto.randomUUID(),Number(userId)]);
  return{ok:true,name:row.rows[0].display_name,quantityAdded:qty,onHand:after};
 });
}
async function simulatedSale(db,userId,body){
 const productId=positiveId(body?.productId),qty=positiveQty(body?.quantity,25);
 if(!productId||!Number.isInteger(qty))throw fail('Select a product and an integer quantity (1–25).');
 return db.transaction(async tx=>{
  const t=await testAccess.account(tx,userId);
  if(!t)throw fail('Test account required.',403);
  const p=(await tx.query('SELECT id,name,price FROM branch_products WHERE id=$1 '+
   'AND workspace_id=$2 AND branch_id=$3 AND active=$4',
   [productId,t.workspaceId,t.branchId,true])).rows[0];
  if(!p)throw fail('Product is not in this test branch.',403);
  const lock=tx.engine==='postgres'?' FOR UPDATE OF i':'';
  const recipe=(await tx.query('SELECT i.id AS ingredient_id,i.display_name,i.stock_qty,'+
    'r.quantity_required FROM branch_recipes r JOIN branch_ingredients i '+
    'ON i.id=r.ingredient_id AND i.workspace_id=r.workspace_id AND i.branch_id=r.branch_id '+
    'WHERE r.workspace_id=$1 AND r.branch_id=$2 AND r.product_id=$3 AND i.active=$4 '+
    'ORDER BY i.id'+lock,[t.workspaceId,t.branchId,productId,true])).rows;
  if(!recipe.length)throw fail('This test product needs a recipe before checkout can be simulated.',409);
  const saleId=crypto.randomUUID();
  for(const item of recipe){
   const required=Math.round(Number(item.quantity_required)*qty*1e9)/1e9;
   if(!(required>0)||!Number.isFinite(required))throw fail('Invalid recipe requirement.',409);
   if(Number(item.stock_qty)+1e-9<required)
    throw fail('Insufficient isolated stock: '+item.display_name,409);
   const r=await tx.query('UPDATE branch_ingredients SET stock_qty=stock_qty-$1,updated_at=CURRENT_TIMESTAMP '+
    'WHERE id=$2 AND workspace_id=$3 AND branch_id=$4 AND stock_qty>=$1 RETURNING stock_qty',
    [required,Number(item.ingredient_id),t.workspaceId,t.branchId]);
   if(r.rows.length!==1)throw fail('Concurrent stock change; sale simulation rolled back.',409);
   await tx.query('INSERT INTO branch_inventory_movements('+
    'workspace_id,branch_id,ingredient_id,movement_type,quantity_change,balance_after,reference,created_by) '+
    'VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [t.workspaceId,t.branchId,Number(item.ingredient_id),'PHASE2_TEST_SALE',-required,
     Number(r.rows[0].stock_qty),saleId,Number(userId)]);
  }
  const unitPrice=Number(p.price),total=Math.round(unitPrice*qty*100)/100;
  await tx.query('INSERT INTO franchise_test_sales('+
   'id,workspace_id,branch_id,product_id,product_name_snapshot,quantity,unit_price,total,created_by,created_at) '+
   'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
   [saleId,t.workspaceId,t.branchId,productId,p.name,qty,unitPrice,total,Number(userId),new Date().toISOString()]);
  return{ok:true,testOnly:true,id:saleId,product:p.name,quantity:qty,total};
 });
}
async function updatePrice(db,userId,productId,input){
 const id=positiveId(productId),raw=String(input?.price??'').trim();
 if(!id||!/^\d{1,7}(?:\.\d{1,2})?$/.test(raw))throw fail('Enter a valid price in pesos (two decimals maximum).');
 const price=Number(raw);
 if(price>9999999)throw fail('Price too high.');
 const t=await testAccess.account(db,userId);
 if(!t)throw fail('Test account required.',403);
 const r=await db.query('UPDATE branch_products SET price=$1,updated_at=CURRENT_TIMESTAMP '+
  'WHERE id=$2 AND workspace_id=$3 AND branch_id=$4 RETURNING id,name,price',
  [price,id,t.workspaceId,t.branchId]);
 if(!r.rows.length)throw fail('Product not found in the test branch.',403);
 return{ok:true,testOnly:true,product:r.rows[0]};
}
async function report(db,userId){
 const t=await testAccess.account(db,userId);
 if(!t)throw fail('Test account required.',403);
 const [summary,recent]=await Promise.all([
  db.query('SELECT COUNT(*) AS count,COALESCE(SUM(total),0) AS revenue,COALESCE(SUM(quantity),0) AS items '+
   'FROM franchise_test_sales WHERE workspace_id=$1 AND branch_id=$2',[t.workspaceId,t.branchId]),
  db.query('SELECT id,product_name_snapshot,quantity,total,created_at FROM franchise_test_sales '+
   'WHERE workspace_id=$1 AND branch_id=$2 ORDER BY created_at DESC LIMIT 20',[t.workspaceId,t.branchId])
 ]);
 return{count:Number(summary.rows[0]?.count||0),revenue:Number(summary.rows[0]?.revenue||0),
  items:Number(summary.rows[0]?.items||0),recent:recent.rows.map(x=>({
   id:x.id,product:x.product_name_snapshot,quantity:Number(x.quantity),total:Number(x.total),at:x.created_at
  }))};
}
module.exports={migrate,replenish,simulatedSale,updatePrice,report};
