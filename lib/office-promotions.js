'use strict';
const crypto=require('node:crypto');
const fail=(m,status=400)=>Object.assign(new Error(m),{status});
const enabled=x=>x===true||x===1||x==='1';
const uuid=/^[a-f0-9-]{36}$/i;
function utc(input){
 const x=String(input||'').trim();
 if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?(?:Z|[+-]\d\d:\d\d)$/.test(x)||!Number.isFinite(Date.parse(x)))
  throw fail('Enter a valid promotion date and time with timezone.');
 return new Date(x).toISOString();
}
function state(p,now=Date.now()){
 if(!enabled(p.active))return'INACTIVE';
 if(now<Date.parse(p.starts_at))return'UPCOMING';
 if(now>=Date.parse(p.ends_at))return'ENDED';
 return'LIVE';
}
async function migrate(db){
 await db.exec(`CREATE TABLE IF NOT EXISTS office_campaigns(
 id VARCHAR(40) PRIMARY KEY,title VARCHAR(120) NOT NULL,description TEXT,
 button_name VARCHAR(80) NOT NULL,sale_price NUMERIC(12,2) NOT NULL,
 starts_at TEXT NOT NULL,ends_at TEXT NOT NULL,active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,created_by VARCHAR(100) NOT NULL)`);
 await db.exec(`CREATE TABLE IF NOT EXISTS office_campaign_requirements(
 campaign_id VARCHAR(40) NOT NULL REFERENCES office_campaigns(id) ON DELETE CASCADE,
 product_id INTEGER NOT NULL REFERENCES supply_products(id),units_per_sale INTEGER NOT NULL CHECK(units_per_sale>0),
 PRIMARY KEY(campaign_id,product_id))`);
 await db.exec(`CREATE TABLE IF NOT EXISTS office_campaign_sales(
 sale_id BIGINT NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
 campaign_id VARCHAR(40) NOT NULL REFERENCES office_campaigns(id),
 workspace_id BIGINT NOT NULL REFERENCES chat_workspaces(id),
 branch_id BIGINT NOT NULL REFERENCES branches(id),quantity INTEGER NOT NULL CHECK(quantity>0),
 created_at TEXT NOT NULL,PRIMARY KEY(sale_id,campaign_id))`);
 await db.exec('CREATE INDEX IF NOT EXISTS idx_campaign_sales_ws ON office_campaign_sales(workspace_id,campaign_id)');
}
async function requirements(db,id){
 const r=await db.query('SELECT r.product_id,r.units_per_sale,p.name FROM office_campaign_requirements r '+
 'JOIN supply_products p ON p.id=r.product_id WHERE r.campaign_id=$1 ORDER BY p.name',[id]);
 return r.rows.map(x=>({productId:Number(x.product_id),unitsPerSale:Number(x.units_per_sale),name:x.name}));
}
function map(x){
 return{id:x.id,title:x.title,description:x.description||'',buttonName:x.button_name,
  price:Number(x.sale_price),startsAt:x.starts_at,endsAt:x.ends_at,active:enabled(x.active),status:state(x)};
}
async function all(db){
 const rows=await db.query('SELECT * FROM office_campaigns ORDER BY created_at DESC LIMIT 100');
 const data=[];
 for(const x of rows.rows)data.push({...map(x),requirements:await requirements(db,x.id)});
 return data;
}
async function create(db,body,actor){
 const title=String(body?.title||'').trim(),button=String(body?.buttonName||'').trim(),
  description=String(body?.description||'').trim(),price=Number(body?.price);
 if(title.length<3||title.length>120||button.length<2||button.length>80||description.length>900)
  throw fail('Enter a campaign title, POS button label and optional description.');
 if(!Number.isFinite(price)||price<=0||price>1e6)throw fail('Enter a valid promotional POS selling price.');
 const startsAt=utc(body.startsAt),endsAt=utc(body.endsAt);
 if(Date.parse(endsAt)<=Date.parse(startsAt))throw fail('Promotion end time must be later than its start.');
 const entries=body.requirements;
 if(!Array.isArray(entries)||!entries.length||entries.length>12)throw fail('Select at least one required Main Office ingredient/supply.');
 const used=new Set(),items=[];
 for(const x of entries){
  const productId=Number(x.productId),units=Number(x.unitsPerSale);
  if(!Number.isSafeInteger(productId)||productId<1||!Number.isSafeInteger(units)||units<1||units>10000||used.has(productId))
   throw fail('Each ingredient must be unique with a positive quantity per promotional sale.');
  used.add(productId);items.push({productId,units});
 }
 const found=await db.query('SELECT id,active FROM supply_products WHERE id IN ('+
  items.map((_,i)=>'$'+(i+1)).join(',')+')',items.map(x=>x.productId));
 if(found.rows.length!==items.length||found.rows.some(x=>!enabled(x.active)))throw fail('Required supplies must exist and be active.');
 const id=crypto.randomUUID(),now=new Date().toISOString();
 await db.transaction(async tx=>{
  await tx.query('INSERT INTO office_campaigns(id,title,description,button_name,sale_price,starts_at,ends_at,active,created_at,updated_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
   [id,title,description,button,price,startsAt,endsAt,true,now,now,String(actor||'Main Office').slice(0,100)]);
  for(const item of items)await tx.query('INSERT INTO office_campaign_requirements(campaign_id,product_id,units_per_sale) VALUES($1,$2,$3)',
   [id,item.productId,item.units]);
 });
 return{ok:true,id};
}
async function deactivate(db,id){
 if(!uuid.test(id))throw fail('Invalid campaign ID.');
 const r=await db.query('UPDATE office_campaigns SET active=$1,updated_at=$2 WHERE id=$3 RETURNING id',
  [false,new Date().toISOString(),id]);
 if(!r.rows.length)throw fail('Promotion not found.',404);
 return{ok:true};
}
async function purchased(db,ws,productId){
 const r=await db.query('SELECT COALESCE(SUM(l.quantity),0) AS n FROM supply_order_lines l '+
  'JOIN supply_orders o ON o.id=l.order_id WHERE o.workspace_id=$1 AND l.product_id=$2 '+
  "AND o.status IN ('DELIVERED','COMPLETED')",[ws,productId]);
 return Number(r.rows[0]?.n||0);
}
async function usedSales(db,ws,id){
 const r=await db.query('SELECT COALESCE(SUM(quantity),0) AS n FROM office_campaign_sales WHERE workspace_id=$1 AND campaign_id=$2',[ws,id]);
 return Number(r.rows[0]?.n||0);
}
async function availability(db,ws,p,qty=1){
 const status=state(p),required=await requirements(db,p.id),used=await usedSales(db,ws,p.id);
 const credits=[];
 for(const row of required){
  const bought=await purchased(db,ws,row.productId);
  credits.push({name:row.name,requiredPerSale:row.unitsPerSale,purchased:bought,
   remaining:Math.max(0,Math.floor((bought-used*row.unitsPerSale)/row.unitsPerSale))});
 }
 const remaining=credits.length?Math.min(...credits.map(c=>c.remaining)):0;
 return{status,remaining,eligible:status==='LIVE'&&remaining>=qty,credits,
  reason:status==='UPCOMING'?'Promotion has not started.':
   status!=='LIVE'?'Promotion has ended or was deactivated.':
   remaining<qty?'Purchase and receive the required Main Office promotional ingredients before selling.':null};
}
async function verifySale(db,ws,id,qty=1){
 if(!uuid.test(id)||!Number.isInteger(Number(qty))||Number(qty)<1)throw fail('Invalid promotion selection.');
 const r=await db.query('SELECT * FROM office_campaigns WHERE id=$1',[id]);
 const p=r.rows[0];if(!p)throw fail('Promotion unavailable.',409);
 const a=await availability(db,ws,p,Number(qty));
 if(!a.eligible)throw fail(a.reason||'You have not purchased the required promotional supplies.',409);
 return {...map(p),availability:a};
}
async function forWorkspace(db,ws){
 const plan=await db.query('SELECT status FROM platform_account_plans WHERE workspace_id=$1',[ws]);
 if(plan.rows[0]?.status!=='PAID')return[];
 const raw=(await db.query('SELECT * FROM office_campaigns WHERE active=$1 ORDER BY starts_at DESC LIMIT 100',[true])).rows;
 const result=[];
 for(const p of raw){
  if(state(p)==='ENDED')continue;
  const a=await availability(db,ws,p);
  result.push({...map(p),...a});
 }
 return result;
}
async function lockForSale(db,ws,items){
 const ids=[...new Set((items||[]).filter(x=>x.kind==='officePromo').map(x=>String(x.id)))].sort();
 if(db.engine==='postgres')for(const id of ids)
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',['campaign:'+ws+':'+id]);
}
async function recordSale(db,saleId,ws,branchId,id,qty){
 await db.query('INSERT INTO office_campaign_sales(sale_id,campaign_id,workspace_id,branch_id,quantity,created_at) VALUES($1,$2,$3,$4,$5,$6)',
  [saleId,id,ws,branchId,qty,new Date().toISOString()]);
}
async function participants(db,id){
 if(!uuid.test(id))throw fail('Invalid promotion.');
 const r=await db.query('SELECT w.id AS workspace_id,u.username AS owner,'+
 'COALESCE(SUM(s.quantity),0) AS sold,COUNT(DISTINCT s.sale_id) AS orders '+
 'FROM chat_workspaces w JOIN users u ON u.id=w.owner_user_id '+
 'LEFT JOIN office_campaign_sales s ON s.workspace_id=w.id AND s.campaign_id=$1 '+
 'GROUP BY w.id,u.username ORDER BY sold DESC,w.id',[id]);
 const needed=await requirements(db,id),out=[];
 for(const row of r.rows){
  const bought=[];for(const req of needed)bought.push({
   name:req.name,quantity:await purchased(db,Number(row.workspace_id),req.productId),requiredPerSale:req.unitsPerSale
  });
  out.push({workspaceId:Number(row.workspace_id),owner:row.owner,
   purchased:bought.length>0&&bought.every(x=>x.quantity>=x.requiredPerSale),
   supplies:bought,sold:Number(row.sold),orders:Number(row.orders)});
 }
 return out;
}
module.exports={migrate,state,all,create,deactivate,requirements,availability,verifySale,
 forWorkspace,lockForSale,recordSale,participants};
