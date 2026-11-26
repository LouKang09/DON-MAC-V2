'use strict';
const crypto=require('node:crypto');
const uid=()=>crypto.randomUUID(),now=()=>new Date().toISOString();
const fail=(s,status=400)=>Object.assign(new Error(s),{status});
const short=(s,n=500)=>String(s??'').trim().slice(0,n);
const dayOK=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))&&
 !Number.isNaN(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const manilaDay=()=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));return p.year+'-'+p.month+'-'+p.day};
const daysTo=(s,today=manilaDay())=>Math.round((Date.parse(s+'T00:00:00Z')-Date.parse(today+'T00:00:00Z'))/86400000);
async function migrate(db){
 await db.exec('CREATE TABLE IF NOT EXISTS supply_office_audit_logs(id TEXT PRIMARY KEY,actor TEXT NOT NULL,action TEXT NOT NULL,entity TEXT NOT NULL,entity_id TEXT,detail TEXT,created_at TEXT NOT NULL)');
 await db.exec('CREATE INDEX IF NOT EXISTS supply_office_audit_created ON supply_office_audit_logs(created_at)');
 await db.exec('CREATE TABLE IF NOT EXISTS supply_office_alert_reads(reader TEXT NOT NULL,alert_key TEXT NOT NULL,read_at TEXT NOT NULL,PRIMARY KEY(reader,alert_key))');
 for(const [name,definition] of [['catalog_expiry_date','TEXT'],['expiry_alert_days','INTEGER NOT NULL DEFAULT 30']]){
  if(db.engine==='postgres')await db.exec('ALTER TABLE supply_products ADD COLUMN IF NOT EXISTS '+name+' '+definition);
  else{const r=await db.query('PRAGMA table_info(supply_products)');if(!r.rows.some(x=>x.name===name))await db.exec('ALTER TABLE supply_products ADD COLUMN '+name+' '+definition)}
 }
 await db.exec('CREATE INDEX IF NOT EXISTS supply_product_expiry_alert ON supply_products(active,catalog_expiry_date)');
}
async function audit(db,actor,action,entity,entityId,detail){
 const message=detail==null?'':short(typeof detail==='string'?detail:JSON.stringify(detail),1700);
 await db.query('INSERT INTO supply_office_audit_logs(id,actor,action,entity,entity_id,detail,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
 [uid(),short(actor,100),short(action,80),short(entity,80),short(entityId,100),message,now()]);
}
async function logs(db,limit=50,offset=0,term='',category=''){
 const size=Math.max(1,Math.min(100,Number(limit)||50)),skip=Math.max(0,Math.min(100000,Number(offset)||0));
 const needle='%'+short(term,100).toLowerCase()+'%';
 const type=short(category,20).toUpperCase();
 if(!['','CATALOG','PURCHASE','WAREHOUSE','PROMO','SETTINGS'].includes(type))
  throw fail('Unknown log category.');
 const groups={
  CATALOG:"action LIKE 'CATALOG%'",
  PURCHASE:"action LIKE 'PURCHASE%'",
  WAREHOUSE:"action LIKE 'WAREHOUSE%' OR action LIKE 'SUPPLIER%'",
  PROMO:"action LIKE 'PROMO%'",
  SETTINGS:"action LIKE 'SETTINGS%'"
 };
 const where=" WHERE (LOWER(actor) LIKE $1 OR LOWER(action) LIKE $1 OR LOWER(entity) LIKE $1 OR LOWER(COALESCE(detail,'')) LIKE $1)"+
  (type?' AND ('+groups[type]+')':'');
 const [rows,total]=await Promise.all([
  db.query('SELECT * FROM supply_office_audit_logs'+where+' ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3',[needle,size,skip]),
  db.query('SELECT COUNT(*) AS count FROM supply_office_audit_logs'+where,[needle])
 ]);
 return{logs:rows.rows,total:Number(total.rows[0]?.count||0),limit:size,offset:skip};
}
function validateExpiry(date,days){
 const expiry=date==null||date===''?null:short(date,10);
 if(expiry&&!dayOK(expiry))throw fail('Enter a valid supply expiry date.');
 const threshold=Number(days??30);
 if(![7,30].includes(threshold))throw fail('Expiry alerts must be 7 or 30 days.');
 return{expiry,threshold};
}
async function updateExpiry(tx,productId,date,days){
 const {expiry,threshold}=validateExpiry(date,days);
 await tx.query('UPDATE supply_products SET catalog_expiry_date=$1,expiry_alert_days=$2 WHERE id=$3',[expiry,threshold,productId]);
}
async function alerts(db,reader='mainoffice'){
 const today=manilaDay();
 const [orders,products,batches,reads]=await Promise.all([
  db.query("SELECT o.id,o.status,o.created_at,o.priority,b.name AS branch_name,u.username AS franchise "+
   "FROM supply_orders o JOIN chat_workspaces w ON w.id=o.workspace_id "+
   "JOIN users u ON u.id=w.owner_user_id LEFT JOIN branches b ON b.id=o.branch_id "+
   "WHERE o.status IN ('PENDING_REVIEW','APPEAL_REVIEW') AND LOWER(u.username)<>'marlou09' "+
   "ORDER BY o.created_at DESC LIMIT 100"),
  db.query('SELECT id,name,stock_qty,catalog_expiry_date,expiry_alert_days FROM supply_products WHERE active=TRUE AND stock_qty>0 AND catalog_expiry_date IS NOT NULL'),
  db.query('SELECT b.id,b.product_id,b.lot_number,b.expiry_date,b.remaining_qty,p.name,p.expiry_alert_days FROM supply_warehouse_batches b JOIN supply_products p ON p.id=b.product_id WHERE p.active=TRUE AND b.remaining_qty>0 AND b.expiry_date IS NOT NULL ORDER BY b.expiry_date ASC LIMIT 250'),
  db.query('SELECT alert_key FROM supply_office_alert_reads WHERE reader=$1',[reader])
 ]);
 const seen=new Set(reads.rows.map(x=>x.alert_key)),result=[];
 for(const o of orders.rows){
  const key='request:'+o.id,appeal=o.status==='APPEAL_REVIEW';
  result.push({key,type:'request',priority:o.priority==='URGENT'?'urgent':'normal',
   title:appeal?'Purchase appeal awaiting review':'New purchase request',
   message:(o.franchise||'Franchise')+' · '+(o.branch_name||'Branch')+(o.priority==='URGENT'?' · URGENT':''),
   date:o.created_at,route:'requests',read:seen.has(key)});
 }
 const addExpiry=(row,key,name,date,qty,lot)=>{
  if(!dayOK(date))return;
  const left=daysTo(date,today),threshold=Number(row.expiry_alert_days)===7?7:30;
  if(left>threshold)return;
  const priority=left<0?'expired':left<=7?'urgent':'soon';
  result.push({key,type:'expiry',priority,title:left<0?'Expired supply stock':left===0?'Supply expires today':left<=7?'Supply expires within 7 days':'Supply expires within 30 days',
   message:name+(lot?' · Lot '+lot:'')+' · '+qty+' unit(s) · '+date+(left<0?' · '+Math.abs(left)+' day(s) past expiry':' · '+left+' day(s) left'),
   date,route:'catalog',read:seen.has(key)});
 };
 for(const p of products.rows)addExpiry(p,'product-expiry:'+p.id+':'+p.catalog_expiry_date,p.name,p.catalog_expiry_date,p.stock_qty,null);
 for(const b of batches.rows)addExpiry(b,'batch-expiry:'+b.id+':'+b.expiry_date,b.name,b.expiry_date,b.remaining_qty,b.lot_number);
 const rank={expired:0,urgent:1,normal:2,soon:3};
 result.sort((a,b)=>rank[a.priority]-rank[b.priority]||String(b.date||'').localeCompare(String(a.date||'')));
 const visible=result.slice(0,150);
 return{alerts:visible,unread:visible.filter(x=>!x.read).length,checkedAt:now()};
}
async function markRead(db,keys,reader='mainoffice'){
 if(!Array.isArray(keys)||keys.length>150)throw fail('Choose up to 150 alerts.');
 const valid=[...new Set(keys.filter(k=>typeof k==='string'&&/^(request|product-expiry|batch-expiry):[a-zA-Z0-9:-]{1,100}$/.test(k)))];
 if(valid.length!==keys.length)throw fail('Invalid notification reference.');
 const available=new Set((await alerts(db,reader)).alerts.map(x=>x.key));
 for(const key of valid)if(!available.has(key))throw fail('Alert is no longer active.',409);
 for(const key of valid)await db.query('INSERT INTO supply_office_alert_reads(reader,alert_key,read_at) VALUES($1,$2,$3) ON CONFLICT(reader,alert_key) DO UPDATE SET read_at=excluded.read_at',[reader,key,now()]);
 return{ok:true,count:valid.length};
}
async function missingCosts(db,limit=100){
 const safe=Math.max(1,Math.min(200,Number(limit)||100));
 const [list,totals]=await Promise.all([
  db.query("SELECT l.id AS line_id,l.order_id,l.product_id,l.product_name,l.quantity,l.unit_price,"+
   "o.updated_at AS completed_at,o.status,u.username AS franchise,b.name AS branch_name,"+
   "p.cost_price AS current_catalog_cost "+
   "FROM supply_order_lines l JOIN supply_orders o ON o.id=l.order_id "+
   "LEFT JOIN supply_products p ON p.id=l.product_id "+
   "LEFT JOIN chat_workspaces w ON w.id=o.workspace_id "+
   "LEFT JOIN users u ON u.id=w.owner_user_id "+
   "LEFT JOIN branches b ON b.id=o.branch_id "+
   "WHERE o.status IN ('DELIVERED','COMPLETED') AND l.unit_cost IS NULL "+
   "ORDER BY o.updated_at DESC,l.product_name LIMIT $1",[safe]),
  db.query("SELECT COUNT(*) AS total FROM supply_order_lines l "+
   "JOIN supply_orders o ON o.id=l.order_id "+
   "WHERE o.status IN ('DELIVERED','COMPLETED') AND l.unit_cost IS NULL")
 ]);
 return {rows:list.rows.map(x=>({
  lineId:x.line_id,orderId:x.order_id,productId:Number(x.product_id),productName:x.product_name,
  quantity:Number(x.quantity),unitPrice:Number(x.unit_price),completedAt:x.completed_at,
  franchise:x.franchise||'Unknown',branch:x.branch_name||'Branch',
  currentCatalogCost:x.current_catalog_cost==null?null:Number(x.current_catalog_cost)
 })),total:Number(totals.rows[0]?.total||0)};
}
async function reconcileCost(db,lineId,verifiedUnitCost,actor){
 const id=short(lineId,80);
 if(!/^[a-f0-9-]{36}$/i.test(id))throw fail('Invalid delivered order line.');
 const raw=String(verifiedUnitCost??'').trim(),cost=Number(raw);
 if(raw===''||!Number.isFinite(cost)||cost<0||cost>1000000)
  throw fail('Enter the verified original purchase cost (₱0 to ₱1,000,000).');
 return db.transaction(async tx=>{
  const q=await tx.query((tx.engine==='postgres'?
   "SELECT l.id,l.order_id,l.product_name,l.quantity,l.unit_cost,o.status "+
   "FROM supply_order_lines l JOIN supply_orders o ON o.id=l.order_id "+
   "WHERE l.id=$1 FOR UPDATE OF l":
   "SELECT l.id,l.order_id,l.product_name,l.quantity,l.unit_cost,o.status "+
   "FROM supply_order_lines l JOIN supply_orders o ON o.id=l.order_id WHERE l.id=$1"),[id]);
  const row=q.rows[0];
  if(!row||!['DELIVERED','COMPLETED'].includes(row.status))
   throw fail('Delivered order line not found.',404);
  if(row.unit_cost!==null)throw fail('Purchase cost already recorded; historical cost cannot be overwritten here.',409);
  await tx.query('UPDATE supply_order_lines SET unit_cost=$1 WHERE id=$2 AND unit_cost IS NULL',
   [Math.round(cost*100)/100,id]);
  await audit(tx,actor,'PURCHASE_HISTORICAL_COST_RECONCILED','SUPPLY_ORDER',row.order_id,{
   lineId:id,productName:row.product_name,quantity:Number(row.quantity),unitCost:Math.round(cost*100)/100,
   note:'Verified historical unit cost supplied manually; no current catalog cost automatically substituted'
  });
  return{ok:true,lineId:id,orderId:row.order_id,unitCost:Math.round(cost*100)/100};
 });
}
module.exports={migrate,audit,logs,alerts,markRead,updateExpiry,validateExpiry,missingCosts,reconcileCost};
