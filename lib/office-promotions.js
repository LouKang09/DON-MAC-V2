'use strict';
const crypto=require('node:crypto');
const fail=(m,status=400)=>Object.assign(new Error(m),{status});
const enabled=x=>x===true||x===1||x==='1';
const uuid=/^[a-f0-9-]{36}$/i;
function utc(input){
 const x=String(input||'').trim();
 if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(x)||!Number.isFinite(Date.parse(x)))
  throw fail('Enter a valid promotion date and time with timezone.');
 return new Date(x).toISOString();
}
function state(p,now=Date.now()){
 if(p.deleted_at)return'DELETED';
 if(enabled(p.held))return'ON_HOLD';
 if(!enabled(p.active))return'INACTIVE';
 if(now<Date.parse(p.starts_at))return'UPCOMING';
 if(now>=Date.parse(p.ends_at))return'ENDED';
 return'LIVE';
}
async function migrate(db){
 await db.exec(`CREATE TABLE IF NOT EXISTS office_campaigns(
 id VARCHAR(40) PRIMARY KEY,title VARCHAR(120) NOT NULL,description TEXT,
 button_name VARCHAR(80) NOT NULL,sale_price NUMERIC(12,2) NOT NULL,icon_data TEXT,
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
 if(db.engine==='postgres')await db.exec('ALTER TABLE office_campaigns ADD COLUMN IF NOT EXISTS icon_data TEXT');
 else{
  const columns=await db.query('PRAGMA table_info(office_campaigns)');
  if(!columns.rows.some(r=>r.name==='icon_data'))await db.exec('ALTER TABLE office_campaigns ADD COLUMN icon_data TEXT');
 }
 // Preserve existing POS sales and catalog references: deletion is a soft archive.
 const lifecycleColumns=[['held','BOOLEAN NOT NULL DEFAULT FALSE'],['deleted_at','TEXT'],
  ['reactivations','INTEGER NOT NULL DEFAULT 0']];
 if(db.engine==='postgres'){
  for(const [name,type] of lifecycleColumns)await db.exec('ALTER TABLE office_campaigns ADD COLUMN IF NOT EXISTS '+name+' '+type);
 }else{
  const cols=await db.query('PRAGMA table_info(office_campaigns)');
  for(const [name,type] of lifecycleColumns)if(!cols.rows.some(r=>r.name===name))
   await db.exec('ALTER TABLE office_campaigns ADD COLUMN '+name+' '+type);
 }
 await db.exec(`CREATE TABLE IF NOT EXISTS office_campaign_events(
  id VARCHAR(40) PRIMARY KEY,
  campaign_id VARCHAR(40) NOT NULL REFERENCES office_campaigns(id) ON DELETE RESTRICT,
  action VARCHAR(40) NOT NULL,actor VARCHAR(100) NOT NULL,
  occurred_at TEXT NOT NULL,starts_at TEXT,ends_at TEXT,note TEXT
 )`);
 await db.exec('CREATE INDEX IF NOT EXISTS idx_office_campaign_events_time ON office_campaign_events(campaign_id,occurred_at)');
}
async function requirements(db,id){
 const r=await db.query('SELECT r.product_id,r.units_per_sale,p.name,p.uom FROM office_campaign_requirements r '+
 'JOIN supply_products p ON p.id=r.product_id WHERE r.campaign_id=$1 ORDER BY p.name',[id]);
 return r.rows.map(x=>({productId:Number(x.product_id),unitsPerSale:Number(x.units_per_sale),name:x.name,uom:x.uom||''}));
}
function map(x){
 return{id:x.id,title:x.title,description:x.description||'',buttonName:x.button_name,
  price:Number(x.sale_price),iconData:x.icon_data||'',startsAt:x.starts_at,endsAt:x.ends_at,
  active:enabled(x.active),held:enabled(x.held),deleted:!!x.deleted_at,
  reactivations:Number(x.reactivations||0),status:state(x)};
}
async function all(db){
 const rows=await db.query('SELECT * FROM office_campaigns WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 100');
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
 const iconData=String(body?.iconData||'');
 if(iconData&&(iconData.length>85000||!/^data:image\/(?:webp|png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(iconData)))
  throw fail('Upload a valid small PNG, JPEG or WebP promotion icon.');
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
  await tx.query('INSERT INTO office_campaigns(id,title,description,button_name,sale_price,icon_data,starts_at,ends_at,active,created_at,updated_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
   [id,title,description,button,price,iconData,startsAt,endsAt,true,now,now,String(actor||'Main Office').slice(0,100)]);
  for(const item of items)await tx.query('INSERT INTO office_campaign_requirements(campaign_id,product_id,units_per_sale) VALUES($1,$2,$3)',
   [id,item.productId,item.units]);
  await event(tx,id,'CREATED',actor,startsAt,endsAt,'Initial promotion schedule');
 });
 return{ok:true,id};
}
async function event(tx,id,action,actor,start=null,end=null,note=''){
 await tx.query('INSERT INTO office_campaign_events(id,campaign_id,action,actor,occurred_at,starts_at,ends_at,note) '+
  'VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
  [crypto.randomUUID(),id,action,String(actor||'Main Office').slice(0,100),
   new Date().toISOString(),start,end,String(note||'').slice(0,400)]);
}
async function changeState(db,id,action,actor,body={}){
 if(!uuid.test(id))throw fail('Invalid campaign ID.');
 if(!['DEACTIVATED','HELD','REACTIVATED','DELETED'].includes(action))throw fail('Invalid promotion action.');
 let startsAt=null,endsAt=null;
 if(action==='REACTIVATED'){
  startsAt=utc(body.startsAt);
  endsAt=utc(body.endsAt);
  if(Date.parse(startsAt)<Date.now()-60000)throw fail('Choose a future Philippine date and time for reactivation.');
  if(Date.parse(endsAt)<=Date.parse(startsAt))throw fail('Reactivation end must follow its start time.');
  if(Date.parse(endsAt)-Date.parse(startsAt)>366*86400000)throw fail('Schedule one year or less.');
 }
 return db.transaction(async tx=>{
  const r=await tx.query((tx.engine==='postgres'?
   'SELECT * FROM office_campaigns WHERE id=$1 FOR UPDATE':
   'SELECT * FROM office_campaigns WHERE id=$1'),[id]);
  const c=r.rows[0];
  if(!c||c.deleted_at)throw fail('Promotion not found or already deleted.',404);
  const was=state(c);
  if(action==='DEACTIVATED'&&!enabled(c.active)&&!enabled(c.held))
   throw fail('Promotion is already deactivated.',409);
  if(action==='HELD'&&(!enabled(c.active)||enabled(c.held)||was==='ENDED'))
   throw fail('Only active or upcoming promotions can be placed on hold.',409);
  if(action==='REACTIVATED'&&was==='LIVE')
   throw fail('Hold or deactivate a live promotion before scheduling reactivation.',409);
  if(action==='DELETED'){
   await tx.query('UPDATE office_campaigns SET active=$1,held=$2,deleted_at=$3,updated_at=$3 WHERE id=$4',
    [false,false,new Date().toISOString(),id]);
  }else if(action==='HELD'){
   await tx.query('UPDATE office_campaigns SET held=$1,updated_at=$2 WHERE id=$3',
    [true,new Date().toISOString(),id]);
  }else if(action==='DEACTIVATED'){
   await tx.query('UPDATE office_campaigns SET active=$1,held=$2,updated_at=$3 WHERE id=$4',
    [false,false,new Date().toISOString(),id]);
  }else{
   await tx.query('UPDATE office_campaigns SET active=$1,held=$2,starts_at=$3,ends_at=$4,'+
    'reactivations=reactivations+1,updated_at=$5 WHERE id=$6',
    [true,false,startsAt,endsAt,new Date().toISOString(),id]);
  }
  await event(tx,id,action,actor,startsAt||c.starts_at,endsAt||c.ends_at,
   action==='DELETED'?'Archived; promotional sales and history retained':
   action==='REACTIVATED'?'Next automatic activation scheduled in Philippine time':'Prior status: '+was);
  return{ok:true,id,action};
 });
}
async function deactivate(db,id,actor='Main Office'){
 return changeState(db,id,'DEACTIVATED',actor);
}
async function hold(db,id,actor='Main Office'){
 return changeState(db,id,'HELD',actor);
}
async function reactivate(db,id,body,actor='Main Office'){
 return changeState(db,id,'REACTIVATED',actor,body);
}
async function archive(db,id,actor='Main Office'){
 return changeState(db,id,'DELETED',actor);
}
async function history(db,id){
 if(!uuid.test(id))throw fail('Invalid campaign ID.');
 const record=(await db.query('SELECT * FROM office_campaigns WHERE id=$1',[id])).rows[0];
 if(!record)throw fail('Promotion not found.',404);
 const ev=(await db.query('SELECT action,actor,occurred_at,starts_at,ends_at,note FROM office_campaign_events WHERE campaign_id=$1 ORDER BY occurred_at ASC,id ASC',[id])).rows;
 const legacy=!ev.some(x=>x.action==='CREATED');
 if(legacy)ev.unshift({action:'CREATED',actor:record.created_by,occurred_at:record.created_at,
  starts_at:record.starts_at,ends_at:record.ends_at,note:'Original campaign (before event history was enabled)'});
 const started=ev.filter((x,i)=>{
  if(x.action!=='REACTIVATED'||!x.starts_at||Date.parse(x.starts_at)>Date.now())return false;
  const start=Date.parse(x.starts_at);
  // Scheduling a new start does not count as an actual reactivation if
  // Main Office cancelled/held/replaced the schedule before its start.
  return !ev.slice(i+1).some(next=>
   ['HELD','DEACTIVATED','DELETED','REACTIVATED'].includes(next.action)&&
   Date.parse(next.occurred_at)<=start);
 }).length;
 return{campaign:map(record),events:ev.map(x=>({
  action:x.action,actor:x.actor,occurredAt:x.occurred_at,startsAt:x.starts_at,
  endsAt:x.ends_at,note:x.note||''})),reactivationCount:Number(record.reactivations||0),
  startedReactivations:started,
  upcomingReactivations:ev.filter(x=>x.action==='REACTIVATED'&&x.starts_at&&
   Date.parse(x.starts_at)>Date.now()).length};
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
   status==='ON_HOLD'?'Promotion is currently on hold by Main Office.':
   status!=='LIVE'?'Promotion has ended or was deactivated.':
   remaining<qty?'Purchase and receive the required Main Office promotional ingredients before selling.':null};
}
// New commercial franchises participate using current stock at their own
// branch. Purchases are not an eligibility prerequisite. Names and units must
// both match the office catalog to avoid counting unrelated ingredients.
const norm=x=>String(x||'').trim().replace(/\s+/g,' ').toLowerCase();
async function branchAvailability(db,ws,branchId,p,qty=1){
 const branch=Number(branchId),workspace=Number(ws);
 if(!Number.isSafeInteger(branch)||branch<1||!Number.isSafeInteger(workspace)||workspace<1)
  throw fail('Select a valid franchise branch.',400);
 const owned=(await db.query('SELECT 1 FROM chat_workspace_branches w JOIN branches b ON b.id=w.branch_id '+
  'WHERE w.workspace_id=$1 AND w.branch_id=$2 AND b.active=$3',
  [workspace,branch,true])).rows;
 if(owned.length!==1)throw fail('Promotion branch does not belong to this franchise.',403);
 const required=await requirements(db,p.id),status=state(p);
 const rows=(await db.query('SELECT id,display_name,uom,stock_qty,unit_cost,active FROM branch_ingredients '+
  'WHERE workspace_id=$1 AND branch_id=$2',[workspace,branch])).rows;
 const inventory=new Map();
 for(const ingredient of rows){
  const key=norm(ingredient.display_name)+'|'+norm(ingredient.uom);
  if(!inventory.has(key))inventory.set(key,[]);
  inventory.get(key).push(ingredient);
 }
 const credits=[],stockRequirements=[];
 for(const requirement of required){
  const key=norm(requirement.name)+'|'+norm(requirement.uom);
  const matches=inventory.get(key)||[];
  const match=matches.length===1&&enabled(matches[0].active)?matches[0]:null;
  const current=match?Number(match.stock_qty):0,each=Number(requirement.unitsPerSale);
  credits.push({name:requirement.name,uom:requirement.uom,requiredPerSale:each,
   available:current,matched:!!match,
   remaining:match?Math.max(0,Math.floor((current+1e-9)/each)):0});
  if(match)stockRequirements.push({ingredientId:Number(match.id),
   name:requirement.name,uom:requirement.uom,qty:each,unitCost:Number(match.unit_cost||0)});
 }
 const remaining=credits.length?Math.min(...credits.map(x=>x.remaining)):0;
 return{status,remaining,eligible:status==='LIVE'&&remaining>=qty,credits,stockRequirements,
  reason:status==='UPCOMING'?'Promotion has not started.':
   status!=='LIVE'?'Promotion has ended or was deactivated.':
   credits.some(x=>!x.matched)?'Required ingredients must match the Main Office item name and unit in this branch.':
   remaining<qty?'Insufficient ingredients in this branch to sell the promotion.':null};
}
async function verifyBranchSale(db,ws,branchId,id,qty=1){
 if(!uuid.test(id)||!Number.isSafeInteger(Number(qty))||Number(qty)<1)
  throw fail('Invalid promotional sale.',400);
 const row=(await db.query('SELECT * FROM office_campaigns WHERE id=$1',[id])).rows[0];
 if(!row||row.deleted_at)throw fail('Main Office promotion is unavailable.',409);
 const a=await branchAvailability(db,ws,branchId,row,Number(qty));
 if(!a.eligible)throw fail(a.reason||'Insufficient branch stock for promotion.',409);
 return{...map(row),availability:a};
}
async function verifySale(db,ws,id,qty=1){
 if(!uuid.test(id)||!Number.isInteger(Number(qty))||Number(qty)<1)throw fail('Invalid promotion selection.');
 const r=await db.query('SELECT * FROM office_campaigns WHERE id=$1',[id]);
 const p=r.rows[0];if(!p||p.deleted_at)throw fail('Promotion unavailable.',409);
 const a=await availability(db,ws,p,Number(qty));
 if(!a.eligible)throw fail(a.reason||'You have not purchased the required promotional supplies.',409);
 return {...map(p),availability:a};
}
async function forWorkspace(db,ws,branchId){
 const plan=await db.query('SELECT status FROM platform_account_plans WHERE workspace_id=$1',[ws]);
 if(plan.rows[0]?.status!=='PAID')return[];
 const raw=(await db.query('SELECT * FROM office_campaigns WHERE active=$1 AND deleted_at IS NULL ORDER BY starts_at DESC LIMIT 100',[true])).rows;
 const result=[];
 for(const p of raw){
  if(state(p)==='ENDED')continue;
  const a=branchId?await branchAvailability(db,ws,branchId,p):await availability(db,ws,p);
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
 if(!uuid.test(id))throw fail('Invalid promotion.',400);
 const campaign=(await db.query('SELECT * FROM office_campaigns WHERE id=$1',[id])).rows[0];
 if(!campaign||campaign.deleted_at)throw fail('Main Office promotion not found.',404);
 const franchiseBranches=(await db.query(
  'SELECT w.id AS workspace_id,b.id AS branch_id,b.name AS branch_name,u.username AS owner '+
  'FROM chat_workspaces w JOIN users u ON u.id=w.owner_user_id '+
  'JOIN chat_workspace_branches wb ON wb.workspace_id=w.id '+
  'JOIN branches b ON b.id=wb.branch_id WHERE b.active=$1 ORDER BY u.username,b.name',
  [true])).rows;
 const output=[];
 for(const row of franchiseBranches){
  const workspace=Number(row.workspace_id),branch=Number(row.branch_id);
  const a=await branchAvailability(db,workspace,branch,campaign);
  const live=(await db.query('SELECT COALESCE(SUM(l.quantity),0) AS sold,'+
    'COUNT(DISTINCT l.sale_id) AS orders FROM office_campaign_live_sales l '+
    'JOIN branch_live_sales s ON s.id=l.sale_id AND s.workspace_id=l.workspace_id '+
    'AND s.branch_id=l.branch_id WHERE l.campaign_id=$1 AND l.workspace_id=$2 '+
    "AND l.branch_id=$3 AND s.status='Sold'",[id,workspace,branch])).rows[0];
  const legacy=(await db.query('SELECT COALESCE(SUM(c.quantity),0) AS sold,'+
    'COUNT(DISTINCT c.sale_id) AS orders FROM office_campaign_sales c '+
    'JOIN sales s ON s.id=c.sale_id WHERE c.campaign_id=$1 AND c.workspace_id=$2 '+
    "AND c.branch_id=$3 AND LOWER(s.status)='sold'",[id,workspace,branch])).rows[0];
  output.push({workspaceId:workspace,branchId:branch,branch:row.branch_name,
   owner:row.owner,eligible:a.eligible,remaining:a.remaining,reason:a.reason,
   supplies:a.credits.map(x=>({name:x.name,uom:x.uom,available:x.available,
    requiredPerSale:x.requiredPerSale,matched:x.matched})),
   sold:Number(live?.sold||0)+Number(legacy?.sold||0),
   orders:Number(live?.orders||0)+Number(legacy?.orders||0)});
 }
 return output;
}
module.exports={migrate,state,all,create,deactivate,hold,reactivate,archive,history,requirements,availability,verifySale,
 forWorkspace,branchAvailability,verifyBranchSale,lockForSale,recordSale,participants};
