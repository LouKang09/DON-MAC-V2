'use strict';
const crypto=require('node:crypto');
const scope=require('./franchise-live-scope');
const fail=scope.fail,id=scope.goodId,on=scope.on;
const cash=x=>Math.round((Number(x)+Number.EPSILON)*100)/100;
const safeNum=x=>Number.isFinite(Number(x))?Number(x):0;
const count=x=>{const v=Number(x);if(!Number.isSafeInteger(v)||v<1||v>999)throw fail('Quantity must be a positive whole number up to 999.',400);return v};
const date=()=>new Date().toISOString();
const PAYMENTS=new Set(['Cash','GCash','Maya','Maribank','GoTyme','BPI','Others']);
const moneyCheck=x=>Number.isFinite(x)&&x>=0&&x<=999999999;
const isValidUuid=x=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(x||''));
const forbidden=msg=>fail(msg,409);
async function migrate(db){
 return db.transaction(async tx=>{
  if(tx.engine==='postgres')await tx.query('SELECT pg_advisory_xact_lock(2026111502::bigint)');
 const fk=tx.engine==='postgres'?'BIGINT':'INTEGER';
 await tx.exec('CREATE TABLE IF NOT EXISTS branch_live_sales('+
  'id VARCHAR(40) PRIMARY KEY,reference VARCHAR(100) NOT NULL UNIQUE,'+
  'workspace_id '+fk+' NOT NULL REFERENCES chat_workspaces(id),'+
  'branch_id '+fk+' NOT NULL REFERENCES branches(id),'+
  'cashier_user_id '+fk+' NOT NULL REFERENCES users(id),cashier_name_snapshot VARCHAR(150) NOT NULL,'+
  'client_request_id VARCHAR(40) NOT NULL,request_hash VARCHAR(64) NOT NULL,'+
  'payment_mode VARCHAR(25) NOT NULL,payment_reference VARCHAR(180),'+
  'order_type VARCHAR(25) NOT NULL,customer_name VARCHAR(120),table_label VARCHAR(80),'+
  'status VARCHAR(20) NOT NULL,remark TEXT,discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,'+
  'gross NUMERIC(12,2) NOT NULL,adjustment NUMERIC(12,2) NOT NULL,actual NUMERIC(12,2) NOT NULL,'+
  'tender NUMERIC(12,2) NOT NULL,change_amount NUMERIC(12,2) NOT NULL,'+
  'sold_at TEXT NOT NULL,deleted_at TEXT,deleted_by '+fk+' REFERENCES users(id))');
 await tx.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_branch_live_checkout_key ON '+
  'branch_live_sales(workspace_id,branch_id,client_request_id)');
 await tx.exec('CREATE INDEX IF NOT EXISTS idx_branch_live_sales_scope ON '+
  'branch_live_sales(workspace_id,branch_id,sold_at)');
 await tx.exec('CREATE TABLE IF NOT EXISTS branch_live_sale_items('+
  'id VARCHAR(40) PRIMARY KEY,sale_id VARCHAR(40) NOT NULL REFERENCES branch_live_sales(id),'+
  'workspace_id '+fk+' NOT NULL,branch_id '+fk+' NOT NULL,'+
  'kind VARCHAR(18) NOT NULL,item_id '+fk+' NOT NULL,name_snapshot VARCHAR(150) NOT NULL,'+
  'quantity INTEGER NOT NULL,unit_price NUMERIC(12,2) NOT NULL,line_total NUMERIC(12,2) NOT NULL,'+
  'unit_cost_snapshot NUMERIC(12,4) NOT NULL DEFAULT 0,components_json TEXT)');
 await tx.exec('CREATE INDEX IF NOT EXISTS idx_branch_live_sale_items_scope ON '+
  'branch_live_sale_items(workspace_id,branch_id,sale_id)');
 });
}
function validateItems(items){
 if(!Array.isArray(items)||!items.length||items.length>100)throw fail('Add between 1 and 100 order lines.',400);
 return items.map(x=>{
  const kind=String(x.kind||''),itemId=id(x.id),quantity=count(x.qty);
  if(!['product','package','addon'].includes(kind)||!itemId)throw fail('Invalid order item.',400);
  return{kind,id:itemId,qty:quantity};
 });
}
async function snapshot(tx,ctx,branchId,body){
 const b=await scope.branch(tx,ctx,branchId);
 const ws=ctx.workspaceId,items=validateItems(body.items);
 const productQty=new Map(),lines=[];let gross=0,food=0,coffee=0,addonTotal=0;
 const productCache=new Map();
 async function product(pid){
  if(productCache.has(pid))return productCache.get(pid);
  const r=await tx.query('SELECT id,name,category,price,active FROM branch_products '+
   'WHERE workspace_id=$1 AND branch_id=$2 AND id=$3',[ws,b.id,pid]);
  const x=r.rows[0];
  if(!x||!on(x.active))throw forbidden('This product is unavailable in your branch.');
  productCache.set(pid,x);return x;
 }
 for(const line of items){
  let x,price=0,components=[];
  if(line.kind==='product'){
   x=await product(line.id);
   productQty.set(line.id,(productQty.get(line.id)||0)+line.qty);
   if(x.category==='Food')food+=line.qty;
   if(['Coffee','Non Coffee'].includes(x.category))coffee+=line.qty;
   price=Number(x.price);
  }else if(line.kind==='package'){
   x=(await tx.query('SELECT id,name,price,active FROM branch_packages '+
    'WHERE workspace_id=$1 AND branch_id=$2 AND id=$3',[ws,b.id,line.id])).rows[0];
   if(!x||!on(x.active))throw forbidden('This package is unavailable.');
   const rows=(await tx.query('SELECT pi.product_id,pi.quantity,p.name,p.active '+
    'FROM branch_package_items pi JOIN branch_products p '+
    'ON p.id=pi.product_id AND p.workspace_id=pi.workspace_id AND p.branch_id=pi.branch_id '+
    'WHERE pi.workspace_id=$1 AND pi.branch_id=$2 AND pi.package_id=$3',
    [ws,b.id,line.id])).rows;
   if(!rows.length)throw forbidden('Package composition is missing.');
   for(const comp of rows){
    if(!on(comp.active))throw forbidden('A package component is inactive.');
    const qty=Number(comp.quantity)*line.qty;
    if(!(qty>0))throw forbidden('Invalid package composition quantity.');
    productQty.set(Number(comp.product_id),(productQty.get(Number(comp.product_id))||0)+qty);
    components.push({productId:Number(comp.product_id),name:comp.name,quantity:qty});
   }
   price=Number(x.price);
  }else{
   x=(await tx.query('SELECT id,name,price,active FROM branch_addons '+
    'WHERE workspace_id=$1 AND branch_id=$2 AND id=$3',[ws,b.id,line.id])).rows[0];
   if(!x||!on(x.active))throw forbidden('This add-on is unavailable.');
   price=Number(x.price);addonTotal=cash(addonTotal+price*line.qty);
  }
  const total=cash(price*line.qty);
  if(!moneyCheck(total))throw fail('Order amount is invalid.',400);
  gross=cash(gross+total);
  lines.push({...line,name:x.name,category:line.kind==='product'?x.category:line.kind,
   unitPrice:price,lineTotal:total,components,unitCost:0});
 }
 if(!moneyCheck(gross))throw fail('Order total exceeds supported amount.',400);
 const requirements=new Map(),perProductCost=new Map();
 for(const [pid,qty] of productQty){
  const activeProduct=await product(pid);
  const recipe=(await tx.query('SELECT r.ingredient_id,r.quantity_required,r.cost_contribution,'+
   'i.stock_qty,i.active,i.display_name,i.uom,i.unit_cost FROM branch_recipes r '+
   'JOIN branch_ingredients i ON i.id=r.ingredient_id AND i.workspace_id=r.workspace_id AND i.branch_id=r.branch_id '+
   'WHERE r.workspace_id=$1 AND r.branch_id=$2 AND r.product_id=$3 ORDER BY i.id',
   [ws,b.id,pid])).rows;
  if(!recipe.length)throw forbidden(activeProduct.name+' has no recipe. Configure ingredients first.');
  let cost=0;
  for(const r of recipe){
   const quantity=Number(r.quantity_required),needed=quantity*qty,key=Number(r.ingredient_id);
   if(!(quantity>0)||!(needed>=0.000001)||Math.abs(needed-Math.round(needed*1e6)/1e6)>1e-9)
    throw forbidden('Recipe quantity has unsupported precision. Use increments of at least 0.000001.');
   if(!on(r.active))throw forbidden('Ingredient '+r.display_name+' is inactive.');
   if(!requirements.has(key))requirements.set(key,{id:key,name:r.display_name,uom:r.uom,
    stock:Number(r.stock_qty),needed:0});
   requirements.get(key).needed=Math.round((requirements.get(key).needed+needed)*1e6)/1e6;
   cost+=r.cost_contribution==null?quantity*Number(r.unit_cost):Number(r.cost_contribution);
  }
  perProductCost.set(pid,cost);
 }
 for(const line of lines){
  if(line.kind==='product')line.unitCost=perProductCost.get(line.id)||0;
  if(line.kind==='package')line.unitCost=(line.components||[]).reduce((v,x)=>
   v+Number(perProductCost.get(x.productId)||0)*(Number(x.quantity)/line.qty),0);
 }
 const shortages=[...requirements.values()].filter(x=>x.needed>x.stock+0.0000001)
  .map(x=>({...x,shortage:cash(x.needed-x.stock)}));
 if(shortages.length){
  const first=shortages[0],e=forbidden('Insufficient ingredients: '+first.name+
   ' requires '+first.needed+' '+first.uom+'; available '+first.stock+' '+first.uom+'.');
  e.details={shortages};throw e;
 }
 let promo=null,adjustment=0,discountAmount=0,actual=gross,remark='';
 if(body.promoId){
  if(lines.some(x=>x.kind==='package'))throw fail('Packages cannot be combined with a POS promotion.',400);
  const x=(await tx.query('SELECT id,name,promo_price,food_limit,coffee_limit,active '+
   'FROM branch_promos WHERE workspace_id=$1 AND branch_id=$2 AND id=$3',
   [ws,b.id,id(body.promoId)])).rows[0];
  if(!x||!on(x.active))throw forbidden('Selected POS promotion is not active in your branch.');
  if(food!==Number(x.food_limit||0)||coffee!==Number(x.coffee_limit||0))
   throw fail('Promotion requires '+Number(x.food_limit||0)+' food and '+
    Number(x.coffee_limit||0)+' coffee items.',400);
  actual=cash(Number(x.promo_price)+addonTotal);
  adjustment=cash(actual-gross);discountAmount=Math.max(0,-adjustment);
  promo={id:Number(x.id),name:x.name,price:Number(x.promo_price)};
  remark=x.name;
 }else if(lines.some(x=>x.kind==='addon'))throw fail('Add-ons require an active POS promotion.',400);
 if(body.senior?.enabled){
  if(promo)throw fail('Senior Citizen discount cannot be combined with POS promotion.',400);
  const customer=String(body.senior.name||'').trim(),seniorNo=String(body.senior.id||'').trim();
  if(!customer||customer.length>150||!/^\d{6,12}$/.test(seniorNo))
   throw fail('Enter a valid Senior Citizen name and 6–12 digit ID.',400);
  discountAmount=cash(gross*.2);adjustment=-discountAmount;actual=cash(gross-discountAmount);
  remark='Senior Citizen Discount';
 }
 if(!moneyCheck(actual))throw fail('Computed amount is invalid.',400);
 return{branchId:b.id,branchName:b.name,lines,requirements:[...requirements.values()],
  promo,gross,actual,adjustment,discountAmount,remark,counts:{food,coffee}};
}
async function quote(db,ctx,body){return snapshot(db,ctx,body.branchId||ctx.branchId,body)}
async function sale(db,ctx,body){
 scope.requireCashier(ctx);
 const mode=String(body.paymentMode||'').trim(),requestId=String(body.clientRequestId||'');
 if(!PAYMENTS.has(mode))throw fail('Choose a supported payment method.',400);
 if(!isValidUuid(requestId))throw fail('A unique checkout request ID is required.',400);
 const orderType=String(body.orderType||'Take Away'),customer=String(body.customerName||'').trim(),
  table=String(body.tableLabel||'').trim(),ref=String(body.paymentReference||'').trim();
 if(!['Dine In','Take Away','Order Online'].includes(orderType)||customer.length>120||table.length>80)
  throw fail('Invalid order type or customer information.',400);
 if(mode!=='Cash'&&(!ref||ref.length>180))
  throw fail('Enter the payment reference for this non-cash transaction.',400);
 const hash=crypto.createHash('sha256').update(JSON.stringify({
  items:body.items,promoId:body.promoId||null,senior:body.senior||null,
  paymentMode:mode,orderType,customer,table,paymentReference:ref,tender:body.tender||null
 })).digest('hex');
 return db.transaction(async tx=>{
  if(tx.engine==='postgres')await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',
   ['live:'+ctx.workspaceId+':'+ctx.branchId+':'+requestId]);
  const previous=(await tx.query('SELECT reference,status,request_hash,gross,actual,tender,change_amount '+
    'FROM branch_live_sales WHERE workspace_id=$1 AND branch_id=$2 AND client_request_id=$3',
    [ctx.workspaceId,ctx.branchId,requestId])).rows[0];
  if(previous){
   if(previous.request_hash!==hash||previous.status!=='Sold')
    throw fail('This request ID has already been used. Start a fresh checkout.',409);
   return{ok:true,idempotent:true,reference:previous.reference,actual:Number(previous.actual),
    gross:Number(previous.gross),tender:Number(previous.tender),change:Number(previous.change_amount)};
  }
  const q=await snapshot(tx,ctx,ctx.branchId,body);
  let tender=q.actual,change=0;
  if(mode==='Cash'){
   tender=Number(body.tender);
   if(!Number.isFinite(tender)||tender<q.actual||!moneyCheck(tender)||cash(tender)!==tender)
    throw fail('Cash tender must cover the order total.',400);
   change=cash(tender-q.actual);
  }
  const saleId=crypto.randomUUID(),reference='BR-'+crypto.randomBytes(9).toString('hex').toUpperCase();
  // Every stock movement and receipt is committed or rolled back as one unit.
  for(const item of q.requirements.sort((a,b)=>a.id-b.id)){
   const update=(await tx.query('UPDATE branch_ingredients SET stock_qty=stock_qty-$1,'+
    'updated_at=CURRENT_TIMESTAMP WHERE workspace_id=$2 AND branch_id=$3 AND id=$4 '+
    'AND active=$5 AND stock_qty>=$1 RETURNING stock_qty',
    [item.needed,ctx.workspaceId,ctx.branchId,item.id,true])).rows;
   if(update.length!==1)throw forbidden('Ingredient stock changed before payment: '+item.name+
    '. Refresh and try again.');
   await tx.query('INSERT INTO branch_inventory_movements('+
    'workspace_id,branch_id,ingredient_id,movement_type,quantity_change,balance_after,'+
    'reference,remarks,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [ctx.workspaceId,ctx.branchId,item.id,'LIVE_SALE',-item.needed,Number(update[0].stock_qty),
     reference,'Branch live checkout',ctx.userId]);
  }
  await tx.query('INSERT INTO branch_live_sales(id,reference,workspace_id,branch_id,cashier_user_id,'+
   'cashier_name_snapshot,client_request_id,request_hash,payment_mode,payment_reference,'+
   'order_type,customer_name,table_label,status,remark,discount_amount,gross,adjustment,actual,'+
   'tender,change_amount,sold_at) '+
   'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)',
   [saleId,reference,ctx.workspaceId,ctx.branchId,ctx.userId,ctx.username||String(ctx.userId),
    requestId,hash,mode,mode==='Cash'?null:ref,orderType,customer||null,table||null,
    'Sold',q.remark,q.discountAmount,q.gross,q.adjustment,q.actual,tender,change,date()]);
  for(const line of q.lines){
   await tx.query('INSERT INTO branch_live_sale_items('+
    'id,sale_id,workspace_id,branch_id,kind,item_id,name_snapshot,quantity,unit_price,'+
    'line_total,unit_cost_snapshot,components_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
    [crypto.randomUUID(),saleId,ctx.workspaceId,ctx.branchId,line.kind,line.id,
     line.name,line.qty,line.unitPrice,line.lineTotal,line.unitCost,
     JSON.stringify(line.components||[])]);
  }
  return{ok:true,reference,gross:q.gross,actual:q.actual,adjustment:q.adjustment,
   paymentMode:mode,tender,change,branchId:ctx.branchId,items:q.lines.length};
 });
}
async function transactions(db,ctx,options={}){
 const b=await scope.branch(db,ctx,options.branchId||ctx.branchId);
 const page=Math.max(1,Math.min(10000,Number(options.page)||1)),size=20;
 const [total,rows]=await Promise.all([
  db.query('SELECT COUNT(*) AS count,COALESCE(SUM(CASE WHEN status=$3 THEN actual ELSE 0 END),0) AS revenue '+
   'FROM branch_live_sales WHERE workspace_id=$1 AND branch_id=$2',[ctx.workspaceId,b.id,'Sold']),
  db.query('SELECT reference,sold_at,payment_mode,payment_reference,cashier_name_snapshot,'+
   'status,gross,adjustment,actual,order_type,customer_name,table_label '+
   'FROM branch_live_sales WHERE workspace_id=$1 AND branch_id=$2 '+
   'ORDER BY sold_at DESC,id DESC LIMIT $3 OFFSET $4',[ctx.workspaceId,b.id,size,(page-1)*size])
 ]);
 return{branchId:b.id,page,pageSize:size,total:Number(total.rows[0]?.count||0),
  revenue:Number(total.rows[0]?.revenue||0),rows:rows.rows.map(x=>({
   reference:x.reference,date:x.sold_at,paymentMode:x.payment_mode,
   paymentReference:x.payment_reference,cashier:x.cashier_name_snapshot,status:x.status,
   gross:Number(x.gross),adjustment:Number(x.adjustment),actual:Number(x.actual),
   orderType:x.order_type,customerName:x.customer_name,tableLabel:x.table_label}))};
}
async function detail(db,ctx,reference){
 const ref=String(reference||'');
 if(!/^BR-[A-F0-9]{18}$/.test(ref))throw fail('Invalid receipt reference.',400);
 const sale=(await db.query('SELECT * FROM branch_live_sales '+
  'WHERE workspace_id=$1 AND branch_id=$2 AND reference=$3',
  [ctx.workspaceId,ctx.branchId,ref])).rows[0];
 if(!sale)throw fail('Receipt not found in this branch.',404);
 const lines=(await db.query('SELECT kind,name_snapshot,quantity,unit_price,line_total,components_json '+
  'FROM branch_live_sale_items WHERE workspace_id=$1 AND branch_id=$2 AND sale_id=$3',
  [ctx.workspaceId,ctx.branchId,sale.id])).rows;
 return{reference:ref,status:sale.status,paymentMode:sale.payment_mode,
  paymentReference:sale.payment_reference,soldAt:sale.sold_at,actual:Number(sale.actual),
  gross:Number(sale.gross),adjustment:Number(sale.adjustment),
  cashier:sale.cashier_name_snapshot,items:lines.map(x=>({
   kind:x.kind,name:x.name_snapshot,qty:Number(x.quantity),
   price:Number(x.unit_price),total:Number(x.line_total),components:JSON.parse(x.components_json||'[]')}))};
}
async function voidSale(db,ctx,reference,body){
 scope.requireAdmin(ctx);
 const ref=String(reference||''),restoreStock=body?.restoreStock===true;
 if(!/^BR-[A-F0-9]{18}$/.test(ref)||typeof body?.restoreStock!=='boolean')
  throw fail('Select a valid receipt and specify whether to restore inventory.',400);
 return db.transaction(async tx=>{
  const row=(await tx.query('SELECT * FROM branch_live_sales '+
   'WHERE workspace_id=$1 AND branch_id=$2 AND reference=$3'+
   (tx.engine==='postgres'?' FOR UPDATE':''),
   [ctx.workspaceId,ctx.branchId,ref])).rows[0];
  if(!row)throw fail('Receipt does not belong to this branch.',404);
  if(row.status!=='Sold')throw fail('Sale has already been reversed.',409);
  let restored=0;
  if(restoreStock){
   const movements=(await tx.query('SELECT ingredient_id,SUM(quantity_change) AS net '+
    'FROM branch_inventory_movements WHERE workspace_id=$1 AND branch_id=$2 '+
    'AND reference=$3 AND movement_type=$4 GROUP BY ingredient_id ORDER BY ingredient_id',
    [ctx.workspaceId,ctx.branchId,ref,'LIVE_SALE'])).rows;
   for(const m of movements){
    const qty=-Number(m.net),iid=id(m.ingredient_id);
    if(!(qty>0)||!iid)throw forbidden('Invalid original stock movement; unable to restore receipt.');
    const r=(await tx.query('UPDATE branch_ingredients SET stock_qty=stock_qty+$1,'+
      'updated_at=CURRENT_TIMESTAMP WHERE workspace_id=$2 AND branch_id=$3 AND id=$4 RETURNING stock_qty',
      [qty,ctx.workspaceId,ctx.branchId,iid])).rows;
    if(r.length!==1)throw forbidden('Unable to restore branch ingredient.');
    await tx.query('INSERT INTO branch_inventory_movements('+
     'workspace_id,branch_id,ingredient_id,movement_type,quantity_change,balance_after,'+
     'reference,remarks,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
     [ctx.workspaceId,ctx.branchId,iid,'LIVE_SALE_REVERSAL',qty,Number(r[0].stock_qty),
      ref,'Reversed live sale',ctx.userId]);
    restored++;
   }
  }
  await tx.query('UPDATE branch_live_sales SET status=$1,deleted_at=$2,deleted_by=$3 '+
   'WHERE id=$4 AND workspace_id=$5 AND branch_id=$6',
   ['Deleted',date(),ctx.userId,row.id,ctx.workspaceId,ctx.branchId]);
  return{ok:true,reference:ref,status:'Deleted',stockRestored:restoreStock,restoredIngredients:restored};
 });
}
async function report(db,ctx,options={}){
 const b=await scope.branch(db,ctx,options.branchId||ctx.branchId);
 const range=String(options.range||'month');
 // Reporting boundaries use Philippine time (UTC+08:00), as does the POS.
 const since=new Date(Date.now()+8*3600000);
 if(range==='day')since.setUTCHours(0,0,0,0);
 else if(range==='week')since.setUTCDate(since.getUTCDate()-7);
 else if(range==='year'){since.setUTCMonth(0,1);since.setUTCHours(0,0,0,0);}
 else {since.setUTCDate(1);since.setUTCHours(0,0,0,0);}
 const start=new Date(since.getTime()-8*3600000).toISOString();
 const [sum,byPayment,byProduct]=await Promise.all([
  db.query('SELECT COUNT(*) AS count,COALESCE(SUM(actual),0) AS revenue,'+
   'COALESCE(SUM(discount_amount),0) AS discounts FROM branch_live_sales '+
   'WHERE workspace_id=$1 AND branch_id=$2 AND status=$3 AND sold_at>=$4',
   [ctx.workspaceId,b.id,'Sold',start]),
  db.query('SELECT payment_mode,COUNT(*) AS count,COALESCE(SUM(actual),0) AS amount '+
   'FROM branch_live_sales WHERE workspace_id=$1 AND branch_id=$2 AND status=$3 AND sold_at>=$4 '+
   'GROUP BY payment_mode ORDER BY payment_mode',
   [ctx.workspaceId,b.id,'Sold',start]),
  db.query('SELECT i.name_snapshot,SUM(i.quantity) AS qty,SUM(i.line_total) AS gross,'+
   'SUM(i.unit_cost_snapshot*i.quantity) AS costing '+
   'FROM branch_live_sale_items i JOIN branch_live_sales s ON s.id=i.sale_id '+
   'AND s.workspace_id=i.workspace_id AND s.branch_id=i.branch_id '+
   'WHERE s.workspace_id=$1 AND s.branch_id=$2 AND s.status=$3 AND s.sold_at>=$4 '+
   'GROUP BY i.name_snapshot ORDER BY qty DESC LIMIT 50',
   [ctx.workspaceId,b.id,'Sold',start])
 ]);
 return{period:range,branchId:b.id,since:start,
  transactionCount:Number(sum.rows[0]?.count||0),actual:Number(sum.rows[0]?.revenue||0),
  discounts:Number(sum.rows[0]?.discounts||0),
  payments:byPayment.rows.map(x=>({mode:x.payment_mode,count:Number(x.count),amount:Number(x.amount)})),
  products:byProduct.rows.map(x=>({name:x.name_snapshot,qty:Number(x.qty),
   gross:Number(x.gross),costing:Number(x.costing),net:Number(x.gross)-Number(x.costing)}))};
}
module.exports={migrate,quote,sale,transactions,detail,voidSale,report,validateItems,snapshot};
