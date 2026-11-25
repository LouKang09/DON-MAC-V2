'use strict';
/* Main Office warehouse management. Existing supply_products.stock_qty holds
 * AVAILABLE, not physical, stock: approved orders have already deducted it.
 * Reserved/in-transit balances are reconstructed from legacy order records.
 */
const crypto=require('node:crypto');
const uid=()=>crypto.randomUUID();
const now=()=>new Date().toISOString();
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const text=(v,max=180)=>String(v??'').trim().slice(0,max);
const n=v=>Number(v||0);
const money=v=>Math.round((n(v)+Number.EPSILON)*100)/100;
const positive=(v,label,max=1000000)=>{const x=Number(v);if(!Number.isFinite(x)||x<=0||x>max)throw fail('Enter a valid '+label+'.');return x};
const whole=(v,label,max=1000000)=>{const x=positive(v,label,max);if(!Number.isSafeInteger(x))throw fail(label+' must be whole units.');return x};
const day=v=>/^\d{4}-\d{2}-\d{2}$/.test(String(v||''))&&!Number.isNaN(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
async function migrate(db){
 await db.exec(`
 CREATE TABLE IF NOT EXISTS supply_warehouse_staff(
 id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE,full_name TEXT NOT NULL,
 role TEXT NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,
 credential_version TEXT NOT NULL,active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS supply_warehouse_suppliers(
 id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,contact TEXT,phone TEXT,email TEXT,
 lead_days INTEGER NOT NULL DEFAULT 7,active BOOLEAN NOT NULL DEFAULT TRUE,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS supply_warehouse_purchases(
 id TEXT PRIMARY KEY,supplier_id TEXT NOT NULL REFERENCES supply_warehouse_suppliers(id),
 reference TEXT NOT NULL UNIQUE,status TEXT NOT NULL,expected_on TEXT,
 note TEXT,created_by TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS supply_warehouse_purchase_lines(
 id TEXT PRIMARY KEY,purchase_id TEXT NOT NULL REFERENCES supply_warehouse_purchases(id),
 product_id INTEGER NOT NULL REFERENCES supply_products(id),
 ordered_qty INTEGER NOT NULL,received_qty INTEGER NOT NULL DEFAULT 0,
 unit_cost NUMERIC(12,2) NOT NULL);
 CREATE TABLE IF NOT EXISTS supply_warehouse_movements(
 id TEXT PRIMARY KEY,product_id INTEGER NOT NULL REFERENCES supply_products(id),
 movement_type TEXT NOT NULL,quantity_change INTEGER NOT NULL,
 before_qty INTEGER NOT NULL,after_qty INTEGER NOT NULL,
 reference TEXT,reason TEXT,actor TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS supply_warehouse_batches(
 id TEXT PRIMARY KEY,product_id INTEGER NOT NULL REFERENCES supply_products(id),
 supplier_id TEXT REFERENCES supply_warehouse_suppliers(id),
 purchase_line_id TEXT REFERENCES supply_warehouse_purchase_lines(id),
 lot_number TEXT NOT NULL,expiry_date TEXT,received_qty INTEGER NOT NULL,
 remaining_qty INTEGER NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS supply_warehouse_batch_allocations(
 id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES supply_orders(id),
 batch_id TEXT NOT NULL REFERENCES supply_warehouse_batches(id),
 product_id INTEGER NOT NULL REFERENCES supply_products(id),
 quantity INTEGER NOT NULL,state TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS supply_wh_batch_allocations_order ON supply_warehouse_batch_allocations(order_id,state);
 CREATE TABLE IF NOT EXISTS supply_warehouse_expenses(
 id TEXT PRIMARY KEY,spent_on TEXT NOT NULL,category TEXT NOT NULL,
 amount NUMERIC(12,2) NOT NULL,notes TEXT,created_by TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS supply_warehouse_returns(
 id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES supply_orders(id),
 product_id INTEGER NOT NULL REFERENCES supply_products(id),
 quantity INTEGER NOT NULL,reason TEXT NOT NULL,
 disposition TEXT NOT NULL,notes TEXT,actor TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS supply_warehouse_fulfillment(
 id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES supply_orders(id),
 step TEXT NOT NULL,tracking_ref TEXT,note TEXT,actor TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS supply_wh_purchase_supplier ON supply_warehouse_purchases(supplier_id,status);
 CREATE INDEX IF NOT EXISTS supply_wh_purchase_line ON supply_warehouse_purchase_lines(purchase_id);
 CREATE INDEX IF NOT EXISTS supply_wh_movement_product ON supply_warehouse_movements(product_id,created_at);
 CREATE INDEX IF NOT EXISTS supply_wh_batch_product_expiry ON supply_warehouse_batches(product_id,expiry_date);
 CREATE INDEX IF NOT EXISTS supply_wh_expense_date ON supply_warehouse_expenses(spent_on);
 CREATE INDEX IF NOT EXISTS supply_wh_return_order ON supply_warehouse_returns(order_id);
 CREATE INDEX IF NOT EXISTS supply_wh_fulfillment_order ON supply_warehouse_fulfillment(order_id,created_at);
 `);
 // Additive, non-destructive changes; catalog stock is not reset or backfilled.
 const columns=[
  ['reorder_point','INTEGER NOT NULL DEFAULT 0'],
  ['safety_stock','INTEGER NOT NULL DEFAULT 0'],
  ['supplier_lead_days','INTEGER NOT NULL DEFAULT 7']
 ];
 for(const [field,def] of columns){
  if(db.engine==='postgres')await db.exec('ALTER TABLE supply_products ADD COLUMN IF NOT EXISTS '+field+' '+def);
  else{
   const columns=await db.query('PRAGMA table_info(supply_products)');
   if(!columns.rows.some(x=>x.name===field))
    await db.exec('ALTER TABLE supply_products ADD COLUMN '+field+' '+def);
  }
 }
}

const ROLES=Object.freeze(['WAREHOUSE_MANAGER','PURCHASING','INVENTORY','FULFILLMENT','FINANCE']);
const safeStaff=r=>({id:r.id,username:r.username,fullName:r.full_name,role:r.role,
 active:r.active===true||r.active===1,createdAt:r.created_at,credentialVersion:r.credential_version});
function passwordHash(password){
 if(typeof password!=='string'||password.length<10||password.length>128)
  throw fail('Use a staff password with 10–128 characters.');
 const salt=crypto.randomBytes(16).toString('hex');
 return {salt,hash:crypto.scryptSync(password,salt,64).toString('hex'),version:uid()};
}
async function staff(db){
 const r=await db.query('SELECT id,username,full_name,role,active,credential_version,created_at FROM supply_warehouse_staff ORDER BY full_name');
 return r.rows.map(safeStaff);
}
async function findStaff(db,id){
 const r=await db.query('SELECT * FROM supply_warehouse_staff WHERE id=$1',[id]);
 return r.rows[0]?safeStaff(r.rows[0]):null;
}
async function authenticateStaff(db,username,password){
 const name=text(username,80).toLowerCase();
 const r=await db.query('SELECT * FROM supply_warehouse_staff WHERE username=$1 AND active=TRUE',[name]);
 const found=r.rows[0];if(!found)return null;
 try{
  const supplied=crypto.scryptSync(String(password),found.salt,64);
  const known=Buffer.from(found.password_hash,'hex');
  return known.length===supplied.length&&crypto.timingSafeEqual(known,supplied)?safeStaff(found):null;
 }catch{return null}
}
async function createStaff(db,data,reservedUsername=''){
 const username=text(data.username,80).toLowerCase(),fullName=text(data.fullName,120),role=text(data.role,30);
 if(!/^[a-z0-9][a-z0-9_.-]{2,79}$/.test(username)||username===String(reservedUsername).toLowerCase())
  throw fail('Choose a unique staff username of at least 3 characters.');
 if(fullName.length<2||!ROLES.includes(role))throw fail('Enter a name and a valid staff role.');
 const c=passwordHash(data.password),id=uid();
 const exists=await db.query('SELECT id FROM supply_warehouse_staff WHERE username=$1',[username]);
 if(exists.rows.length)throw fail('This staff username is already in use.',409);
 await db.query('INSERT INTO supply_warehouse_staff(id,username,full_name,role,salt,password_hash,credential_version,active,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
  [id,username,fullName,role,c.salt,c.hash,c.version,true,now()]);
 return{ok:true,id};
}
async function updateStaff(db,id,data){
 const active=data.active===true,role=text(data.role,30);
 if(!ROLES.includes(role))throw fail('Choose a valid warehouse role.');
 const r=await db.query('UPDATE supply_warehouse_staff SET active=$1,role=$2,credential_version=$3 WHERE id=$4 RETURNING id',
  [active,role,uid(),text(id,80)]);
 if(!r.rows.length)throw fail('Staff account not found.',404);
 return{ok:true,id};
}
async function resetStaffPassword(db,id,password){
 const c=passwordHash(password);
 const r=await db.query('UPDATE supply_warehouse_staff SET salt=$1,password_hash=$2,credential_version=$3 WHERE id=$4 RETURNING id',
  [c.salt,c.hash,c.version,text(id,80)]);
 if(!r.rows.length)throw fail('Staff account not found.',404);
 return{ok:true,id};
}
async function changeStaffPassword(db,id,oldPassword,newPassword){
 const r=await db.query('SELECT * FROM supply_warehouse_staff WHERE id=$1 AND active=TRUE',[id]);
 const row=r.rows[0];if(!row)throw fail('Warehouse staff account unavailable.',403);
 const supplied=crypto.scryptSync(String(oldPassword),row.salt,64),expected=Buffer.from(row.password_hash,'hex');
 if(supplied.length!==expected.length||!crypto.timingSafeEqual(supplied,expected))
  throw fail('Current password is incorrect.',403);
 if(oldPassword===newPassword)throw fail('Use a different password.');
 return resetStaffPassword(db,id,newPassword);
}
async function suppliers(db){const r=await db.query('SELECT * FROM supply_warehouse_suppliers ORDER BY active DESC,name');return r.rows}
async function createSupplier(db,data){
 const name=text(data.name,120);if(name.length<2)throw fail('Supplier name must have at least two characters.');
 const lead=Number(data.leadDays??7);if(!Number.isSafeInteger(lead)||lead<0||lead>365)throw fail('Lead days must be 0–365.');
 const r=await db.query('INSERT INTO supply_warehouse_suppliers(id,name,contact,phone,email,lead_days,created_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
 [uid(),name,text(data.contact,100),text(data.phone,50),text(data.email,120),lead,now()]);
 return{ok:true,id:r.rows[0].id};
}
async function purchaseOrders(db){
 const r=await db.query('SELECT p.*,s.name AS supplier FROM supply_warehouse_purchases p JOIN supply_warehouse_suppliers s ON s.id=p.supplier_id ORDER BY p.created_at DESC LIMIT 200');
 const list=[];
 for(const x of r.rows){
  const lines=await db.query('SELECT l.*,p.name AS product_name,p.uom FROM supply_warehouse_purchase_lines l JOIN supply_products p ON p.id=l.product_id WHERE l.purchase_id=$1 ORDER BY p.name',[x.id]);
  list.push({...x,lines:lines.rows});
 }
 return list;
}
async function createPurchase(db,data,actor){
 const supplierId=text(data.supplierId,80),reference=text(data.reference,75)||('PO-'+Date.now().toString(36).toUpperCase());
 const expected=text(data.expectedOn,15)||null;
 if(expected&&!day(expected))throw fail('Expected delivery date is invalid.');
 if(!Array.isArray(data.lines)||!data.lines.length||data.lines.length>100)throw fail('Select 1–100 purchase items.');
 const ids=new Set(),lines=data.lines.map(item=>{
  const id=whole(item.productId,'product ID',1e9),quantity=whole(item.quantity,'purchase quantity');
  const cost=positive(item.unitCost,'purchase unit cost',1e6);
  if(ids.has(id))throw fail('Duplicate supply product in purchase.');ids.add(id);
  return{id,quantity,cost:money(cost)};
 });
 return db.transaction(async tx=>{
  const s=await tx.query('SELECT id FROM supply_warehouse_suppliers WHERE id=$1 AND active=TRUE',[supplierId]);
  if(!s.rows.length)throw fail('Select an active registered supplier.');
  const product=await tx.query('SELECT id FROM supply_products WHERE active=TRUE');
  const valid=new Set(product.rows.map(x=>n(x.id)));
  if(lines.some(x=>!valid.has(x.id)))throw fail('One of the purchased products is unavailable.');
  const id=uid(),at=now();
  await tx.query('INSERT INTO supply_warehouse_purchases(id,supplier_id,reference,status,expected_on,note,created_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [id,supplierId,reference,'ORDERED',expected,text(data.note,1000),text(actor,100),at,at]);
  for(const l of lines)await tx.query('INSERT INTO supply_warehouse_purchase_lines(id,purchase_id,product_id,ordered_qty,received_qty,unit_cost) VALUES($1,$2,$3,$4,$5,$6)',
    [uid(),id,l.id,l.quantity,0,l.cost]);
  return{ok:true,id,reference};
 });
}
async function recordMovement(tx,productId,delta,type,reference,reason,actor){
 const row=await tx.query((tx.engine==='postgres'?'SELECT stock_qty FROM supply_products WHERE id=$1 FOR UPDATE':'SELECT stock_qty FROM supply_products WHERE id=$1'),[productId]);
 if(!row.rows.length)throw fail('Supply product not found.',404);
 const before=n(row.rows[0].stock_qty),after=before+delta;
 if(!Number.isSafeInteger(after)||after<0||after>10000000)throw fail('Insufficient available warehouse stock or excessive adjustment.',409);
 await tx.query('UPDATE supply_products SET stock_qty=$1,updated_at=$2 WHERE id=$3',[after,now(),productId]);
 await tx.query('INSERT INTO supply_warehouse_movements(id,product_id,movement_type,quantity_change,before_qty,after_qty,reference,reason,actor,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
  [uid(),productId,type,delta,before,after,text(reference,100),text(reason,1000),text(actor,100),now()]);
 return{before,after};
}
async function receive(db,purchaseId,data,actor){
 if(!Array.isArray(data.lines)||!data.lines.length||data.lines.length>100)throw fail('Select purchase lines and received quantities.');
 const seen=new Set();
 return db.transaction(async tx=>{
  const purchase=await tx.query((tx.engine==='postgres'?'SELECT * FROM supply_warehouse_purchases WHERE id=$1 FOR UPDATE':'SELECT * FROM supply_warehouse_purchases WHERE id=$1'),[purchaseId]);
  if(!purchase.rows.length)throw fail('Purchase not found.',404);
  if(!['ORDERED','PARTIAL'].includes(purchase.rows[0].status))throw fail('This purchase cannot receive stock.',409);
  const got=[];
  for(const line of data.lines){
   const lineId=text(line.lineId,80);
   if(seen.has(lineId))throw fail('Duplicate receipt line.');seen.add(lineId);
   const q=whole(line.quantity,'received quantity');
   const lot=text(line.lotNumber,100)||('UNBATCHED-'+uid().slice(0,8));
   const expiry=text(line.expiryDate,15)||null;
   if(expiry&&!day(expiry))throw fail('Invalid ingredient expiry date.');
   // Reject expired stock at receiving; warehouse return/recall handles exceptions.
   if(expiry&&expiry<new Date(now()).toISOString().slice(0,10))throw fail('Expired stock cannot be received.');
   const found=await tx.query((tx.engine==='postgres'?
    'SELECT * FROM supply_warehouse_purchase_lines WHERE id=$1 AND purchase_id=$2 FOR UPDATE':
    'SELECT * FROM supply_warehouse_purchase_lines WHERE id=$1 AND purchase_id=$2'),[lineId,purchaseId]);
   if(!found.rows.length)throw fail('Purchase line not found.',404);
   const x=found.rows[0];
   if(q>n(x.ordered_qty)-n(x.received_qty))throw fail('Receipt exceeds remaining purchase quantity.',409);
   await recordMovement(tx,n(x.product_id),q,'RECEIPT',purchaseId,lot+' · Supplier receipt',actor);
   await tx.query('UPDATE supply_warehouse_purchase_lines SET received_qty=received_qty+$1 WHERE id=$2',[q,lineId]);
   await tx.query('INSERT INTO supply_warehouse_batches(id,product_id,supplier_id,purchase_line_id,lot_number,expiry_date,received_qty,remaining_qty,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [uid(),n(x.product_id),purchase.rows[0].supplier_id,lineId,lot,expiry,q,q,now()]);
   await tx.query('UPDATE supply_products SET cost_price=$1 WHERE id=$2',[money(x.unit_cost),n(x.product_id)]);
   got.push({productId:n(x.product_id),quantity:q,lot,expiry});
  }
  const remaining=await tx.query('SELECT COUNT(*) AS outstanding FROM supply_warehouse_purchase_lines WHERE purchase_id=$1 AND received_qty<ordered_qty',[purchaseId]);
  const status=n(remaining.rows[0].outstanding)===0?'RECEIVED':'PARTIAL';
  await tx.query('UPDATE supply_warehouse_purchases SET status=$1,updated_at=$2 WHERE id=$3',[status,now(),purchaseId]);
  return{ok:true,status,items:got};
 });
}
async function adjust(db,data,actor){
 const productId=whole(data.productId,'product ID',1e9);
 const delta=Number(data.delta);
 if(!Number.isSafeInteger(delta)||delta===0||Math.abs(delta)>1000000)throw fail('Adjustment must be a signed whole-unit amount.');
 const type=String(data.reason||'').toUpperCase();
 if(!['CORRECTION','DAMAGE','EXPIRED','STOCKTAKE'].includes(type))throw fail('Select a stock adjustment reason.');
 if(!text(data.notes,1000))throw fail('Explain and document the stock adjustment.');
 return db.transaction(async tx=>({...await recordMovement(tx,productId,delta,type,
  text(data.reference,100)||'MANUAL',data.notes,actor),ok:true}));
}
async function setReorder(db,productId,data){
 const id=whole(productId,'product ID',1e9);
 const vals=[data.reorderPoint,data.safetyStock,data.leadDays];
 const x=vals.map((v,i)=>{const t=Number(v);if(!Number.isSafeInteger(t)||t<0||t>(i===2?365:1e7))throw fail('Invalid reorder settings.');return t});
 const r=await db.query('UPDATE supply_products SET reorder_point=$1,safety_stock=$2,supplier_lead_days=$3 WHERE id=$4 RETURNING id',
 [...x,id]);
 if(!r.rows.length)throw fail('Product not found.',404);
 return{ok:true,id};
}
async function inventory(db){
 const [p,orders]=await Promise.all([
  db.query('SELECT id,name,uom,stock_qty,cost_price,reorder_point,safety_stock,supplier_lead_days FROM supply_products WHERE active=TRUE ORDER BY name'),
  db.query("SELECT l.product_id,o.status,SUM(l.quantity) AS qty FROM supply_orders o JOIN supply_order_lines l ON l.order_id=o.id WHERE o.stock_reserved=TRUE AND o.status IN ('APPROVED','PREPARING','DISPATCHED') GROUP BY l.product_id,o.status")
 ]);
 const held=new Map();
 for(const x of orders.rows){
  const id=n(x.product_id),row=held.get(id)||{reserved:0,inTransit:0};
  if(x.status==='DISPATCHED')row.inTransit+=n(x.qty);else row.reserved+=n(x.qty);
  held.set(id,row);
 }
 const po=await db.query("SELECT product_id,SUM(ordered_qty-received_qty) AS incoming FROM supply_warehouse_purchase_lines l JOIN supply_warehouse_purchases p ON p.id=l.purchase_id WHERE p.status IN ('ORDERED','PARTIAL') GROUP BY product_id");
 const incoming=new Map(po.rows.map(x=>[n(x.product_id),n(x.incoming)]));
 const since=new Date(Date.now()-30*86400000).toISOString();
 const demand=await db.query("SELECT l.product_id,COALESCE(SUM(l.quantity),0) AS qty FROM supply_order_lines l JOIN supply_orders o ON o.id=l.order_id WHERE o.status IN ('DELIVERED','COMPLETED') AND o.updated_at>=$1 GROUP BY l.product_id",[since]);
 const daily=new Map(demand.rows.map(x=>[n(x.product_id),n(x.qty)/30]));
 return p.rows.map(x=>{
  const qty=n(x.stock_qty),id=n(x.id),reserve=held.get(id)||{reserved:0,inTransit:0};
  const reorder=n(x.reorder_point),safety=n(x.safety_stock),lead=n(x.supplier_lead_days);
  const rate=daily.get(id)||0,expected=incoming.get(id)||0;
  const threshold=Math.max(reorder,Math.ceil(rate*lead+safety));
  return{id,name:x.name,uom:x.uom,available:qty,reserved:reserve.reserved,
   inTransit:reserve.inTransit,physical:qty+reserve.reserved,
   purchaseIncoming:expected,costKnown:x.cost_price!=null,
   reorderPoint:reorder,safetyStock:safety,leadDays:lead,
   averageDailyDemand:Number(rate.toFixed(2)),targetStock:threshold,
   suggestedPurchase:Math.max(0,threshold-(qty+expected)),
   // Legacy catalog rows default to 0; not a configured reorder point.
   configured:reorder>0||safety>0,
   status:qty<=0?'OUT':reorder>0&&qty<=reorder?'REORDER':'OK'};
 });
}
async function movements(db,limit=100){
 const max=Math.max(1,Math.min(250,Number(limit)||100));
 const r=await db.query('SELECT m.*,p.name AS product_name,p.uom FROM supply_warehouse_movements m JOIN supply_products p ON p.id=m.product_id ORDER BY m.created_at DESC,m.id DESC LIMIT $1',[max]);
 return r.rows;
}
async function batches(db){
 const r=await db.query('SELECT b.*,p.name AS product_name,p.uom,s.name AS supplier_name FROM supply_warehouse_batches b JOIN supply_products p ON p.id=b.product_id LEFT JOIN supply_warehouse_suppliers s ON s.id=b.supplier_id ORDER BY CASE WHEN b.expiry_date IS NULL THEN 1 ELSE 0 END,b.expiry_date,b.created_at DESC LIMIT 250');
 return r.rows;
}

const dayPH=()=>{
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'})
  .formatToParts(new Date()).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
 return p.year+'-'+p.month+'-'+p.day;
};
/* Called inside the SAME transaction as franchise stock reservation. Product
 * row lock is held by recordMovement. Newly received lots use FEFO; remaining
 * legacy unbatched stock can fulfill an order without inventing lot numbers.
 */
async function allocateBatches(tx,orderId,productId,qty,availableBefore){
 const rows=await tx.query('SELECT id,remaining_qty,expiry_date FROM supply_warehouse_batches WHERE product_id=$1 AND remaining_qty>0 ORDER BY CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END,expiry_date,created_at,id',[productId]);
 const date=dayPH();
 const expired=rows.rows.filter(b=>b.expiry_date&&b.expiry_date<date).reduce((a,b)=>a+n(b.remaining_qty),0);
 if(qty>availableBefore-expired)throw fail('Product #'+productId+' has expired batches. Remove expired quantities before reserving this order.',409);
 let left=qty;
 for(const b of rows.rows){
  if(b.expiry_date&&b.expiry_date<date||left<=0)continue;
  const used=Math.min(left,n(b.remaining_qty));if(used<=0)continue;
  const done=await tx.query('UPDATE supply_warehouse_batches SET remaining_qty=remaining_qty-$1 WHERE id=$2 AND remaining_qty>=$1 RETURNING id',[used,b.id]);
  if(!done.rows.length)throw fail('Batch stock changed while reserving. Retry.',409);
  await tx.query('INSERT INTO supply_warehouse_batch_allocations(id,order_id,batch_id,product_id,quantity,state,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [uid(),orderId,b.id,productId,used,'RESERVED',now()]);
  left-=used;
 }
 return{tracked:qty-left,unbatched:left};
}
async function releaseBatches(tx,orderId){
 const allocations=await tx.query("SELECT id,batch_id,quantity FROM supply_warehouse_batch_allocations WHERE order_id=$1 AND state='RESERVED'",[orderId]);
 for(const a of allocations.rows){
  await tx.query('UPDATE supply_warehouse_batches SET remaining_qty=remaining_qty+$1 WHERE id=$2',[n(a.quantity),a.batch_id]);
  await tx.query("UPDATE supply_warehouse_batch_allocations SET state='RELEASED' WHERE id=$1",[a.id]);
 }
}
async function advanceBatches(tx,orderId,next){
 const state=next==='DISPATCHED'?'DISPATCHED':next==='DELIVERED'?'DELIVERED':null;
 if(!state)return;
 await tx.query("UPDATE supply_warehouse_batch_allocations SET state=$1 WHERE order_id=$2 AND state IN ('RESERVED','DISPATCHED')",[state,orderId]);
}
async function expenses(db){const r=await db.query('SELECT * FROM supply_warehouse_expenses ORDER BY spent_on DESC,created_at DESC LIMIT 200');return r.rows}
async function addExpense(db,data,actor){
 const spentOn=text(data.spentOn,10),category=text(data.category,60),amount=money(positive(data.amount,'expense amount',1e8));
 if(!day(spentOn))throw fail('Choose a valid warehouse expense date.');
 if(!['RENT','UTILITIES','FREIGHT','PAYROLL','SUPPLIES','MAINTENANCE','OTHER'].includes(category))throw fail('Invalid warehouse expense category.');
 const id=uid();await db.query('INSERT INTO supply_warehouse_expenses(id,spent_on,category,amount,notes,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
 [id,spentOn,category,amount,text(data.notes,1000),text(actor,100),now()]);
 return{ok:true,id};
}
async function returns(db){const r=await db.query('SELECT r.*,p.name AS product_name FROM supply_warehouse_returns r JOIN supply_products p ON p.id=r.product_id ORDER BY r.created_at DESC LIMIT 200');return r.rows}
async function createReturn(db,data,actor){
 const orderId=text(data.orderId,70),productId=whole(data.productId,'product ID',1e9),
  quantity=whole(data.quantity,'return quantity');
 const reason=text(data.reason,30),disposition=text(data.disposition,30),notes=text(data.notes,1000);
 if(!['RETURN','SHORTAGE','DAMAGED','RECALL'].includes(reason))throw fail('Invalid issue type.');
 if(!['QUARANTINE','RESTOCK','RECORD_ONLY'].includes(disposition))throw fail('Invalid returned-item disposition.');
 if(!notes)throw fail('Explain the return, shortage or recall.');
 if(disposition==='RESTOCK'&&reason!=='RETURN')throw fail('Only physically returned, inspected goods may be restocked. Damaged, recalled or missing items must be quarantined or recorded only.');
 return db.transaction(async tx=>{
  const found=await tx.query(tx.engine==='postgres'?"SELECT status FROM supply_orders WHERE id=$1 AND status IN ('DELIVERED','COMPLETED') FOR UPDATE":"SELECT status FROM supply_orders WHERE id=$1 AND status IN ('DELIVERED','COMPLETED')",[orderId]);
  if(!found.rows.length)throw fail('Only delivered orders can have a delivery claim.',409);
  const line=await tx.query('SELECT COALESCE(SUM(quantity),0) AS quantity FROM supply_order_lines WHERE order_id=$1 AND product_id=$2',[orderId,productId]);
  const count=n(line.rows[0]?.quantity);
  if(!count||quantity>count)throw fail('Quantity exceeds the delivered item quantity.');
  const previous=await tx.query('SELECT COALESCE(SUM(quantity),0) AS quantity FROM supply_warehouse_returns WHERE order_id=$1 AND product_id=$2 AND disposition=$3',[orderId,productId,'RESTOCK']);
  if(disposition==='RESTOCK'&&n(previous.rows[0]?.quantity)+quantity>count)throw fail('Return quantity exceeds delivered items.');
  const id=uid();
  if(disposition==='RESTOCK')await recordMovement(tx,productId,quantity,'RETURN',orderId,reason+' · '+notes,actor);
  await tx.query('INSERT INTO supply_warehouse_returns(id,order_id,product_id,quantity,reason,disposition,notes,actor,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
   [id,orderId,productId,quantity,reason,disposition,notes,text(actor,100),now()]);
  return{ok:true,id,stockRestored:disposition==='RESTOCK'};
 });
}
async function fulfillment(db,orderId){
 const r=await db.query('SELECT * FROM supply_warehouse_fulfillment WHERE order_id=$1 ORDER BY created_at,id',[orderId]);
 return r.rows;
}
async function addFulfillment(db,data,actor){
 const orderId=text(data.orderId,70),step=text(data.step,30),note=text(data.note,1000),tracking=text(data.trackingRef,120);
 if(!['PICKED','PACKED','HANDOFF','PROOF_OF_DELIVERY'].includes(step))throw fail('Choose a valid fulfillment checkpoint.');
 if(!note)throw fail('Enter a fulfillment note for the audit trail.');
 const r=await db.query("SELECT id,status FROM supply_orders WHERE id=$1 AND status IN ('APPROVED','PREPARING','DISPATCHED','DELIVERED','COMPLETED')",[orderId]);
 if(!r.rows.length)throw fail('Order must be approved before fulfillment events can be recorded.',409);
 if(step==='PROOF_OF_DELIVERY'&&!['DELIVERED','COMPLETED'].includes(r.rows[0].status))
   throw fail('Record proof of delivery only after the order is marked delivered.',409);
 const id=uid();await db.query('INSERT INTO supply_warehouse_fulfillment(id,order_id,step,tracking_ref,note,actor,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
 [id,orderId,step,tracking,note,text(actor,100),now()]);
 return{ok:true,id};
}
async function finance(db,from,to){
 const dFrom=text(from,10),dTo=text(to,10);if(!day(dFrom)||!day(dTo)||dFrom>dTo)throw fail('Choose valid financial dates.');
 const args=[new Date(dFrom+'T00:00:00+08:00').toISOString(),new Date(new Date(dTo+'T00:00:00Z').getTime()+86400000).toISOString().replace('Z','+00:00')];
 // Order time values are ISO UTC. The end is PH midnight on the next day.
 args[1]=new Date(new Date(dTo+'T00:00:00+08:00').getTime()+86400000).toISOString();
 const [revenue,cost,ex]=await Promise.all([
  db.query("SELECT COUNT(*) AS orders,COALESCE(SUM(subtotal+urgent_fee),0) AS revenue FROM supply_orders WHERE status IN ('DELIVERED','COMPLETED') AND updated_at>=$1 AND updated_at<$2",args),
  db.query("SELECT COALESCE(SUM(CASE WHEN l.unit_cost IS NOT NULL THEN l.unit_cost*l.quantity ELSE 0 END),0) AS known_cost,COALESCE(SUM(CASE WHEN l.unit_cost IS NULL THEN 1 ELSE 0 END),0) AS unknown_lines FROM supply_order_lines l JOIN supply_orders o ON o.id=l.order_id WHERE o.status IN ('DELIVERED','COMPLETED') AND o.updated_at>=$1 AND o.updated_at<$2",args),
  db.query('SELECT category,COALESCE(SUM(amount),0) AS amount FROM supply_warehouse_expenses WHERE spent_on>=$1 AND spent_on<=$2 GROUP BY category ORDER BY category',[dFrom,dTo])
 ]);
 const v=money(revenue.rows[0]?.revenue),c=money(cost.rows[0]?.known_cost),missing=n(cost.rows[0]?.unknown_lines),total=money(ex.rows.reduce((a,x)=>a+n(x.amount),0));
 return{from:dFrom,to:dTo,revenue:v,deliveredOrders:n(revenue.rows[0]?.orders),
   knownCost:c,unknownCostLines:missing,grossProfit:missing?null:money(v-c),
   operatingExpenses:total,operatingProfit:missing?null:money(v-c-total),
   byExpenseCategory:ex.rows.map(x=>({category:x.category,amount:money(x.amount)})),
   note:'Operating profit excludes unrecorded warehouse overhead and royalties. Missing purchase costs prevent a complete profit figure.'};
}
module.exports={migrate,ROLES,staff,findStaff,authenticateStaff,createStaff,updateStaff,resetStaffPassword,changeStaffPassword,suppliers,createSupplier,purchaseOrders,createPurchase,receive,
 recordMovement,allocateBatches,releaseBatches,advanceBatches,adjust,setReorder,inventory,movements,batches,expenses,addExpense,
 returns,createReturn,fulfillment,addFulfillment,finance};
