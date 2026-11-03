'use strict';
const crypto=require('node:crypto');
const royalties=require('./supply-royalties');
const now=()=>new Date().toISOString();
const error=(message,status=400)=>Object.assign(new Error(message),{status});
const CATALOG=[
["TRUNG NGUYEN S' COFFEE","500G/PACK",300],
["SAIGON STAR","1284G/CARTON",220],
["CA PHE PHIN (COFFEE FILTER)","1/SET",785],
["BARISTA MAT","1/PC",185],
["FROTHER","1/UNIT",200],
["MED PITCHER w/ lid","500ML/PC",90],
["SMALL PITCHER","100ML/PC",60],
["COFFEE SCALE WITH MAT","1SET/UNIT",660],
["DM PAPER CUPS 12oz","50pcs/pack",180],
["LIDS 90MM/95mm","100pcs/pack",160],
["DM PLASTIC CUPS 12OZ","100pcs/pack",200],
["ROASTED COCONUT BITS","100GMS/PACK",88],
["BLACK THIN STRAW","200pcs/pack",92],
["THIN PAPER STRAW","200pcs/pack",320],
["DM PLASTIC CUPS 16oz","100PCS/PACK",265],
["DM PAPER CUPS 16oz","100pcs/pack",385],
["SALTED CHEESE FOAM","1KG/PACK",530],
["COCONUT CREAM","400ML/CAN",75],
["STRAWLESS LIDS 95MM","100pcs/pack",160],
["REFINED SUGAR","100pcs/pack",100],
["STEVIA","100pcs/pack",200]
];
const STATUS=['PENDING_REVIEW','APPROVED','ON_HOLD','DENIED','PREPARING','DISPATCHED','DELIVERED','COMPLETED'];
const TRACK=['PENDING_REVIEW','APPROVED','PREPARING','DISPATCHED','DELIVERED','COMPLETED'];
const input=(value,max=200)=>String(value??'').trim().slice(0,max);
const amount=v=>Number((Math.round(Number(v)*100)/100).toFixed(2));
const id=()=>crypto.randomUUID();
async function migrate(db){
 const pk=db.engine==='postgres'?'INTEGER PRIMARY KEY':'INTEGER PRIMARY KEY';
 await db.exec(`
 CREATE TABLE IF NOT EXISTS supply_products(
 id ${pk},name TEXT NOT NULL,uom TEXT NOT NULL,price NUMERIC(12,2) NOT NULL,active BOOLEAN NOT NULL DEFAULT TRUE);
 CREATE TABLE IF NOT EXISTS supply_orders(
 id VARCHAR(40) PRIMARY KEY,workspace_id INTEGER NOT NULL,requested_by INTEGER NOT NULL,
 branch_id INTEGER NOT NULL,priority VARCHAR(16) NOT NULL,urgent_fee NUMERIC(12,2) NOT NULL,
 subtotal NUMERIC(12,2) NOT NULL,total NUMERIC(12,2) NOT NULL,payment_image TEXT NOT NULL,
 payment_reference VARCHAR(100),status VARCHAR(24) NOT NULL,office_note TEXT,
 created_at VARCHAR(40) NOT NULL,updated_at VARCHAR(40) NOT NULL);
 CREATE TABLE IF NOT EXISTS supply_order_lines(
 id VARCHAR(40) PRIMARY KEY,order_id VARCHAR(40) NOT NULL REFERENCES supply_orders(id),
 product_id INTEGER NOT NULL,product_name TEXT NOT NULL,uom TEXT NOT NULL,
 quantity INTEGER NOT NULL,unit_price NUMERIC(12,2) NOT NULL,amount NUMERIC(12,2) NOT NULL);
 CREATE TABLE IF NOT EXISTS supply_events(
 id VARCHAR(40) PRIMARY KEY,order_id VARCHAR(40) NOT NULL REFERENCES supply_orders(id),
 status VARCHAR(24) NOT NULL,note TEXT,actor TEXT NOT NULL,created_at VARCHAR(40) NOT NULL);
 CREATE TABLE IF NOT EXISTS supply_messages(
 id VARCHAR(40) PRIMARY KEY,order_id VARCHAR(40) NOT NULL REFERENCES supply_orders(id),
 sender_role VARCHAR(12) NOT NULL,sender_name TEXT NOT NULL,body TEXT NOT NULL,
 created_at VARCHAR(40) NOT NULL);
 CREATE TABLE IF NOT EXISTS supply_notifications(
 id VARCHAR(40) PRIMARY KEY,workspace_id INTEGER NOT NULL,order_id VARCHAR(40) NOT NULL,
 message TEXT NOT NULL,created_at VARCHAR(40) NOT NULL);
 CREATE TABLE IF NOT EXISTS supply_notice_reads(
 user_id INTEGER NOT NULL,notice_id VARCHAR(40) NOT NULL REFERENCES supply_notifications(id),
 PRIMARY KEY(user_id,notice_id));
 CREATE INDEX IF NOT EXISTS supply_orders_by_workspace ON supply_orders(workspace_id,created_at);
 CREATE INDEX IF NOT EXISTS supply_events_by_order ON supply_events(order_id,created_at);
 CREATE INDEX IF NOT EXISTS supply_messages_by_order ON supply_messages(order_id,created_at);
 CREATE INDEX IF NOT EXISTS supply_notices_by_ws ON supply_notifications(workspace_id,created_at);
 `);
 // Additive migrations preserve existing records in both Railway PostgreSQL
 // and the supported offline SQLite development database.
 const fields=[
  ['supply_products','stock_qty','INTEGER NOT NULL DEFAULT 0'],
  ['supply_products','promo_price','NUMERIC(12,2)'],
  ['supply_products','promo_active','BOOLEAN NOT NULL DEFAULT FALSE'],
  ['supply_products','updated_at','TEXT'],
  ['supply_orders','stock_reserved','BOOLEAN NOT NULL DEFAULT FALSE'],
  ['supply_messages','image_data','TEXT']
 ];
 for(const [table,column,definition] of fields){
  if(db.engine==='postgres')await db.exec('ALTER TABLE '+table+' ADD COLUMN IF NOT EXISTS '+column+' '+definition);
  else{
   const available=await db.query('PRAGMA table_info('+table+')');
   if(!available.rows.some(r=>r.name===column))await db.exec('ALTER TABLE '+table+' ADD COLUMN '+column+' '+definition);
  }
 }
 for(let i=0;i<CATALOG.length;i++){
  const [name,uom,price]=CATALOG[i];
  await db.query('INSERT INTO supply_products(id,name,uom,price,active) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING',[i+1,name,uom,price,true]);
 }
 await db.query('INSERT INTO app_settings(setting_key,setting_value,updated_at) VALUES($1,$2,$3) ON CONFLICT(setting_key) DO NOTHING',['supply_urgent_fee',JSON.stringify({fee:0}),now()]);
 await royalties.migrate(db);
}
async function priceSettings(db){
 const r=await db.query('SELECT setting_value FROM app_settings WHERE setting_key=$1',['supply_urgent_fee']);
 let fee=0;try{fee=Number(JSON.parse(r.rows[0]?.setting_value||'{}').fee||0);}catch(_){}
 return {urgentFee:Number.isFinite(fee)&&fee>=0?amount(fee):0,currency:'PHP'};
}
async function setUrgentFee(db,fee){
 if(!Number.isFinite(Number(fee))||Number(fee)<0||Number(fee)>100000)throw error('Urgent fee must be between ₱0 and ₱100,000.');
 const next=amount(fee);
 await db.query('INSERT INTO app_settings(setting_key,setting_value,updated_at) VALUES($1,$2,$3) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_at=excluded.updated_at',
 ['supply_urgent_fee',JSON.stringify({fee:next}),now()]);
 return {urgentFee:next};
}
async function catalog(db){
 const r=await db.query('SELECT id,name,uom,price,active,stock_qty,promo_price,promo_active FROM supply_products ORDER BY id');
 return {products:r.rows.map(x=>({id:Number(x.id),name:x.name,uom:x.uom,price:Number(x.price),stockQty:Number(x.stock_qty||0),promoPrice:x.promo_price==null?null:Number(x.promo_price),promoActive:x.promo_active===true||x.promo_active===1,active:x.active===true||x.active===1})),...(await priceSettings(db))};
}
async function saveProduct(db,productId,details){
 const idNum=Number(productId),price=Number(details.price),stockQty=Number(details.stockQty);
 const promoPrice=details.promoPrice==null||details.promoPrice===''?null:Number(details.promoPrice);
 const promoActive=details.promoActive===true;
 if(!Number.isInteger(idNum)||idNum<1||!Number.isFinite(price)||price<=0||price>1000000||
    !Number.isInteger(stockQty)||stockQty<0||stockQty>10000000||
    (promoPrice!==null&&(!Number.isFinite(promoPrice)||promoPrice<=0||promoPrice>=price)))
   throw error('Enter a valid franchisee price, stock quantity and lower optional promo price.');
 if(promoActive&&promoPrice===null)throw error('Enter a discounted promo price before enabling the promotion.');
 const uom=input(details.uom,80);
 if(!uom)throw error('Enter the unit of measure.');
 const updated=await db.query(
  'UPDATE supply_products SET price=$1,stock_qty=$2,promo_price=$3,promo_active=$4,uom=$5,updated_at=$6 WHERE id=$7 RETURNING id',
  [amount(price),stockQty,promoPrice===null?null:amount(promoPrice),promoActive,uom,now(),idNum]);
 if(!updated.rows.length)throw error('Supply product not found.',404);
 return {ok:true,productId:idNum};
}
const sellingPrice=p=>p.promoActive&&p.promoPrice!==null&&p.promoPrice<p.price?p.promoPrice:p.price;
async function scope(db,user){
 if(user.role!=='Admin')throw error('Only franchise owners and Co-Owners may request supplies.',403);
 const ws=await db.query('SELECT workspace_id FROM chat_memberships WHERE user_id=$1',[user.id]);
 if(!ws.rows.length)throw error('Franchise workspace is not configured.',403);
 return Number(ws.rows[0].workspace_id);
}
async function ownerBranches(db,workspaceId){
 const r=await db.query('SELECT b.id,b.name,b.address,b.active FROM branches b JOIN chat_workspace_branches w ON w.branch_id=b.id WHERE w.workspace_id=$1 ORDER BY b.name',[workspaceId]);
 return r.rows.map(x=>({...x,id:Number(x.id),active:x.active===1||x.active===true}));
}
function validPhoto(raw){
 if(typeof raw!=='string'||raw.length<120||raw.length>1500000)throw error('Payment photo must be a decoded image no larger than 1 MB.',413);
 const match=/^data:image\/(jpeg|png|webp);base64,([a-zA-Z0-9+/]+={0,2})$/.exec(raw);
 if(!match)throw error('Payment photo could not be decoded. Upload a JPG, PNG or WebP image.');
 const bytes=Buffer.from(match[2],'base64');
 if(bytes.length>1024*1024||bytes.length<50)throw error('Payment photo exceeds 1 MB or is invalid.',413);
 const [_,type]=match;
 const jpeg=type==='jpeg'&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes.at(-2)===255&&bytes.at(-1)===217;
 const png=type==='png'&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 const webp=type==='webp'&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
 if(!(jpeg||png||webp))throw error('Photo decoding failed: the file content does not match its format.');
 return raw;
}
async function submit(db,user,data){
 const workspaceId=await scope(db,user);
 const branchId=Number(data.branchId),priority=data.priority==='URGENT'?'URGENT':'STANDARD';
 const branches=await ownerBranches(db,workspaceId);
 if(!branches.some(b=>b.id===branchId&&b.active))throw error('Select an active branch assigned to your franchise.',403);
 if(!Array.isArray(data.items)||!data.items.length||data.items.length>50)throw error('Choose at least one supply (maximum 50 types).');
 const quantities=new Map();
 for(const x of data.items){
  const productId=Number(x.productId),qty=Number(x.quantity);
  if(!Number.isInteger(productId)||!Number.isInteger(qty)||qty<1||qty>10000)throw error('Supply quantities must be whole packs/units (1–10,000).');
  quantities.set(productId,(quantities.get(productId)||0)+qty);
  if(quantities.get(productId)>10000)throw error('Maximum quantity exceeded for one item.');
 }
 const proof=validPhoto(data.paymentImage);
 const products=(await catalog(db)).products;
 const items=[...quantities].map(([productId,quantity])=>{
  const p=products.find(x=>x.id===productId&&x.active);
  if(!p)throw error('The selected supply item is unavailable.');
  return{productId,quantity,name:p.name,uom:p.uom,unitPrice:sellingPrice(p),amount:amount(sellingPrice(p)*quantity)};
 });
 const subtotal=amount(items.reduce((a,x)=>a+x.amount,0));
 const config=await priceSettings(db);
 const urgentFee=priority==='URGENT'?config.urgentFee:0;
 if(priority==='URGENT'&&!(urgentFee>0))throw error('Urgent requests are unavailable until Main Office configures the additional fee.',409);
 const reference=input(data.paymentReference,100);
 const orderId=id(),at=now();
 const order=await db.transaction(async tx=>{
  // Reserve any existing monthly royalty liabilities under the franchise
  // workspace lock before creating this order. The same month cannot be
  // carried into multiple pending orders.
  const reserved=await royalties.reserveForOrder(tx,workspaceId,orderId);
  const total=amount(subtotal+urgentFee+reserved.total);
  await tx.query('INSERT INTO supply_orders(id,workspace_id,requested_by,branch_id,priority,urgent_fee,subtotal,royalty_total,total,payment_image,payment_reference,status,office_note,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',
  [orderId,workspaceId,user.id,branchId,priority,urgentFee,subtotal,reserved.total,total,proof,reference,'PENDING_REVIEW','',at,at]);
  for(const x of items)await tx.query('INSERT INTO supply_order_lines(id,order_id,product_id,product_name,uom,quantity,unit_price,amount) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
   [id(),orderId,x.productId,x.name,x.uom,x.quantity,x.unitPrice,x.amount]);
  await tx.query('INSERT INTO supply_events(id,order_id,status,note,actor,created_at) VALUES($1,$2,$3,$4,$5,$6)',
   [id(),orderId,'PENDING_REVIEW',reserved.total>0?'Payment submitted; includes '+reserved.months.length+' outstanding monthly royalty fee(s)':'Payment submitted for verification',user.username,at]);
  return{id:orderId,status:'PENDING_REVIEW',subtotal,urgentFee,royaltyTotal:reserved.total,total,priority,royaltyMonths:reserved.months};
 });
 return order;
}
function mapOrder(x){return {...x,urgent_fee:Number(x.urgent_fee),subtotal:Number(x.subtotal),royalty_total:Number(x.royalty_total||0),total:Number(x.total),branch_id:Number(x.branch_id),workspace_id:Number(x.workspace_id),payment_image:undefined};}
async function list(db,workspaceId=null){
 const q=workspaceId
  ?await db.query('SELECT o.*,b.name AS branch_name,u.username AS requester,ow.username AS franchise_owner FROM supply_orders o LEFT JOIN branches b ON b.id=o.branch_id LEFT JOIN users u ON u.id=o.requested_by LEFT JOIN chat_workspaces w ON w.id=o.workspace_id LEFT JOIN users ow ON ow.id=w.owner_user_id WHERE o.workspace_id=$1 ORDER BY o.created_at DESC LIMIT 300',[workspaceId])
  :await db.query('SELECT o.*,b.name AS branch_name,u.username AS requester FROM supply_orders o LEFT JOIN branches b ON b.id=o.branch_id LEFT JOIN users u ON u.id=o.requested_by ORDER BY o.created_at DESC LIMIT 500');
 return q.rows.map(mapOrder);
}
async function detail(db,orderId,workspaceId=null,includePayment=false){
 const r=await db.query('SELECT o.*,b.name AS branch_name,u.username AS requester,ow.username AS franchise_owner FROM supply_orders o LEFT JOIN branches b ON b.id=o.branch_id LEFT JOIN users u ON u.id=o.requested_by LEFT JOIN chat_workspaces w ON w.id=o.workspace_id LEFT JOIN users ow ON ow.id=w.owner_user_id WHERE o.id=$1',[orderId]);
 const o=r.rows[0];if(!o||workspaceId!==null&&Number(o.workspace_id)!==workspaceId)throw error('Supply request not found.',404);
 const [lines,events,messages]=await Promise.all([
  db.query('SELECT product_id,product_name,uom,quantity,unit_price,amount FROM supply_order_lines WHERE order_id=$1 ORDER BY product_name',[orderId]),
  db.query('SELECT status,note,actor,created_at FROM supply_events WHERE order_id=$1 ORDER BY created_at',[orderId]),
  db.query('SELECT sender_role,sender_name,body,image_data,created_at FROM supply_messages WHERE order_id=$1 ORDER BY created_at DESC LIMIT 100',[orderId])
 ]);
 return {...mapOrder(o),...(includePayment?{paymentImage:o.payment_image}:{}),
 items:lines.rows.map(x=>({...x,quantity:Number(x.quantity),unit_price:Number(x.unit_price),amount:Number(x.amount)})),
 history:events.rows,messages:messages.rows.reverse().map(x=>({sender_role:x.sender_role,sender_name:x.sender_name,body:x.body,image:x.image_data||null,created_at:x.created_at}))};
}
async function notify(db,workspaceId,orderId,message){
 await db.query('INSERT INTO supply_notifications(id,workspace_id,order_id,message,created_at) VALUES($1,$2,$3,$4,$5)',
 [id(),workspaceId,orderId,message,now()]);
}
async function status(db,orderId,next,note,actor){
 if(!STATUS.includes(next))throw error('Invalid supply request status.');
 const allowed={
  PENDING_REVIEW:['APPROVED','ON_HOLD','DENIED'],
  APPROVED:['PREPARING','ON_HOLD','DENIED'],
  ON_HOLD:['PENDING_REVIEW','APPROVED','DENIED'],
  DENIED:[],
  PREPARING:['DISPATCHED','ON_HOLD'],
  DISPATCHED:['DELIVERED','ON_HOLD'],
  DELIVERED:['COMPLETED'],
  COMPLETED:[]
 };
 const detailNote=input(note,1000),time=now();
 if(['DENIED','ON_HOLD'].includes(next)&&!detailNote)throw error('Enter a reason for holding or denying the request.');
 return db.transaction(async tx=>{
  // Lock order in the same transaction as stock movement. Two simultaneous
  // office approvals cannot deduct the same inventory twice.
  const found=await tx.query((tx.engine==='postgres'?'SELECT id,status,workspace_id,stock_reserved FROM supply_orders WHERE id=$1 FOR UPDATE':'SELECT id,status,workspace_id,stock_reserved FROM supply_orders WHERE id=$1'),[orderId]);
  const old=found.rows[0];if(!old)throw error('Supply request not found.',404);
  if(!(allowed[old.status]||[]).includes(next))throw error('Invalid next stage from '+old.status+'.',409);
  if(next==='APPROVED'&&!old.stock_reserved){
   const lines=await tx.query('SELECT product_id,quantity FROM supply_order_lines WHERE order_id=$1',[orderId]);
   for(const line of lines.rows){
    const result=await tx.query('UPDATE supply_products SET stock_qty=stock_qty-$1 WHERE id=$2 AND active=TRUE AND stock_qty >= $1 RETURNING id',
      [Number(line.quantity),Number(line.product_id)]);
    if(!result.rows.length)throw error('Insufficient Main Office stock for product #'+line.product_id+'. Replenish inventory before approval.',409);
   }
   await tx.query('UPDATE supply_orders SET stock_reserved=TRUE WHERE id=$1',[orderId]);
  }
  if(next==='APPROVED')await royalties.settleOrder(tx,orderId,actor);
  if(next==='DENIED')await royalties.releaseOrder(tx,orderId,actor);
  if(next==='DENIED'&&old.stock_reserved){
   const lines=await tx.query('SELECT product_id,quantity FROM supply_order_lines WHERE order_id=$1',[orderId]);
   for(const line of lines.rows)await tx.query('UPDATE supply_products SET stock_qty=stock_qty+$1 WHERE id=$2',[Number(line.quantity),Number(line.product_id)]);
   await tx.query('UPDATE supply_orders SET stock_reserved=FALSE WHERE id=$1',[orderId]);
  }
  await tx.query('UPDATE supply_orders SET status=$1,office_note=$2,updated_at=$3 WHERE id=$4',[next,detailNote,time,orderId]);
  await tx.query('INSERT INTO supply_events(id,order_id,status,note,actor,created_at) VALUES($1,$2,$3,$4,$5,$6)',
    [id(),orderId,next,detailNote,actor,time]);
  await notify(tx,Number(old.workspace_id),orderId,'Supply request '+orderId.slice(0,8)+' is '+next.replaceAll('_',' ').toLowerCase()+(detailNote?': '+detailNote:''));
  return {ok:true,status:next};
 });
}
async function send(db,orderId,workspaceId,role,username,body,image){
 const original=(await db.query('SELECT workspace_id FROM supply_orders WHERE id=$1',[orderId])).rows[0];
 if(!original||workspaceId!==null&&Number(original.workspace_id)!==workspaceId)throw error('Supply request not found.',404);
 const content=input(body,1500);
 let photo=null;
 if(image){
  photo=validPhoto(image);
  if(Buffer.byteLength(photo,'utf8')>250000)throw error('Chat photo is too large after compression. Maximum 180 KB.',413);
 }
 if(!content&&!photo)throw error('Enter a message or attach a photo.');
 const at=now();
 await db.query('INSERT INTO supply_messages(id,order_id,sender_role,sender_name,body,image_data,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
 [id(),orderId,role,username,content,photo,at]);
 if(role==='office')await notify(db,Number(original.workspace_id),orderId,'Main Office sent a message for supply request '+orderId.slice(0,8));
 return {ok:true,createdAt:at};
}
async function notices(db,user){
 const ws=await scope(db,user);
 const r=await db.query('SELECT n.id,n.order_id,n.message,n.created_at,r.user_id AS seen_by FROM supply_notifications n LEFT JOIN supply_notice_reads r ON r.notice_id=n.id AND r.user_id=$2 WHERE n.workspace_id=$1 ORDER BY n.created_at DESC LIMIT 100',[ws,user.id]);
 return {notices:r.rows.map(n=>({id:n.id,orderId:n.order_id,message:n.message,createdAt:n.created_at,read:!!n.seen_by})),unread:r.rows.filter(n=>!n.seen_by).length};
}
async function markRead(db,user,noticeIds){
 const ws=await scope(db,user);
 if(!Array.isArray(noticeIds)||noticeIds.length>100)throw error('Invalid notifications.');
 for(const note of noticeIds){
  const match=await db.query('SELECT id FROM supply_notifications WHERE id=$1 AND workspace_id=$2',[String(note),ws]);
  if(match.rows.length)await db.query('INSERT INTO supply_notice_reads(user_id,notice_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[user.id,String(note)]);
 }
 return{ok:true};
}
module.exports={CATALOG,STATUS,TRACK,migrate,catalog,saveProduct,priceSettings,setUrgentFee,scope,ownerBranches,submit,list,detail,status,send,notices,markRead};
