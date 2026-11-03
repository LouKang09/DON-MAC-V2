'use strict';
const crypto=require('crypto');
const UUID=()=>crypto.randomUUID();
const money=x=>Math.round((Number(x)+Number.EPSILON)*100)/100;
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const now=()=>new Date().toISOString();
function currentMonth(){
 const fields=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit'}).formatToParts(new Date());
 const y=fields.find(x=>x.type==='year').value,m=fields.find(x=>x.type==='month').value;
 return y+'-'+m;
}
function monthIndex(m){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(m||''))throw fail('Invalid royalty period.');return Number(m.slice(0,4))*12+Number(m.slice(5))-1;}
function fromIndex(i){return String(Math.floor(i/12)).padStart(4,'0')+'-'+String(i%12+1).padStart(2,'0');}
const numeric=v=>Number(v||0);
const isPaid=r=>r.status==='PAID';
async function migrate(db){
 const fk=db.engine==='postgres'?'BIGINT':'INTEGER';
 await db.exec(`
 CREATE TABLE IF NOT EXISTS supply_royalty_settings(
 workspace_id ${fk} PRIMARY KEY REFERENCES chat_workspaces(id) ON DELETE CASCADE,
 fee_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
 effective_month VARCHAR(7) NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS supply_royalty_months(
 id VARCHAR(40) PRIMARY KEY,workspace_id ${fk} NOT NULL REFERENCES chat_workspaces(id),
 period VARCHAR(7) NOT NULL,amount NUMERIC(12,2) NOT NULL,
 status VARCHAR(12) NOT NULL DEFAULT 'PENDING',
 reserved_order_id VARCHAR(40),paid_at TEXT,paid_via TEXT,
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 UNIQUE(workspace_id,period));
 CREATE TABLE IF NOT EXISTS supply_royalty_events(
 id VARCHAR(40) PRIMARY KEY,royalty_id VARCHAR(40) NOT NULL REFERENCES supply_royalty_months(id),
 action VARCHAR(40) NOT NULL,note TEXT,actor TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS idx_supply_royalty_pending ON supply_royalty_months(workspace_id,status,reserved_order_id);
 CREATE INDEX IF NOT EXISTS idx_supply_royalty_orders ON supply_royalty_months(reserved_order_id);
 `);
 if(db.engine==='postgres')await db.exec('ALTER TABLE supply_orders ADD COLUMN IF NOT EXISTS royalty_total NUMERIC(12,2) NOT NULL DEFAULT 0');
 else{
  const cols=(await db.query('PRAGMA table_info(supply_orders)')).rows;
  if(!cols.some(c=>c.name==='royalty_total'))await db.exec('ALTER TABLE supply_orders ADD COLUMN royalty_total NUMERIC(12,2) NOT NULL DEFAULT 0');
 }
}
async function lockWorkspace(tx,workspaceId){
 const sql=tx.engine==='postgres'?'SELECT id FROM chat_workspaces WHERE id=$1 FOR UPDATE':'SELECT id FROM chat_workspaces WHERE id=$1';
 const r=await tx.query(sql,[workspaceId]);if(!r.rows.length)throw fail('Franchise account not found.',404);
}
async function ensureMonths(tx,workspaceId){
 const setting=(await tx.query('SELECT fee_amount,effective_month FROM supply_royalty_settings WHERE workspace_id=$1',[workspaceId])).rows[0];
 if(!setting||numeric(setting.fee_amount)<=0)return;
 const start=monthIndex(setting.effective_month),end=monthIndex(currentMonth());
 if(end<start)return;
 if(end-start>120)throw fail('Royalty schedule requires office review.',409);
 const at=now();
 for(let i=start;i<=end;i++){
  const period=fromIndex(i);
  await tx.query('INSERT INTO supply_royalty_months(id,workspace_id,period,amount,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(workspace_id,period) DO NOTHING',
   [UUID(),workspaceId,period,money(setting.fee_amount),'PENDING',at,at]);
 }
}
async function quote(db,workspaceId){
 await ensureMonths(db,workspaceId);
 const [due,held,current]=await Promise.all([
  db.query("SELECT id,period,amount FROM supply_royalty_months WHERE workspace_id=$1 AND status='PENDING' AND reserved_order_id IS NULL ORDER BY period",[workspaceId]),
  db.query("SELECT period,amount,reserved_order_id FROM supply_royalty_months WHERE workspace_id=$1 AND status='PENDING' AND reserved_order_id IS NOT NULL ORDER BY period",[workspaceId]),
  db.query('SELECT fee_amount FROM supply_royalty_settings WHERE workspace_id=$1',[workspaceId])
 ]);
 return{dueTotal:money(due.rows.reduce((n,x)=>n+numeric(x.amount),0)),dueMonths:due.rows.map(x=>({period:x.period,amount:numeric(x.amount)})),
 reservedTotal:money(held.rows.reduce((n,x)=>n+numeric(x.amount),0)),
 reservedMonths:held.rows.map(x=>({period:x.period,amount:numeric(x.amount),orderId:x.reserved_order_id})),
 monthlyFee:numeric(current.rows[0]?.fee_amount)};
}
async function reserveForOrder(tx,workspaceId,orderId){
 await lockWorkspace(tx,workspaceId);
 await ensureMonths(tx,workspaceId);
 const r=await tx.query("SELECT id,period,amount FROM supply_royalty_months WHERE workspace_id=$1 AND status='PENDING' AND reserved_order_id IS NULL ORDER BY period",[workspaceId]);
 const total=money(r.rows.reduce((n,x)=>n+numeric(x.amount),0));
 if(total>0){
  for(const row of r.rows)await tx.query("UPDATE supply_royalty_months SET reserved_order_id=$1,updated_at=$2 WHERE id=$3 AND status='PENDING' AND reserved_order_id IS NULL",[orderId,now(),row.id]);
 }
 return{total,months:r.rows.map(x=>({id:x.id,period:x.period,amount:numeric(x.amount)}))};
}
async function settleOrder(tx,orderId,actor){
 const r=await tx.query("SELECT id,amount,period FROM supply_royalty_months WHERE reserved_order_id=$1 AND status='PENDING'",[orderId]);
 for(const row of r.rows){
  const at=now();
  await tx.query("UPDATE supply_royalty_months SET status='PAID',paid_at=$1,paid_via='SUPPLY_ORDER',updated_at=$1 WHERE id=$2 AND status='PENDING'",[at,row.id]);
  await tx.query('INSERT INTO supply_royalty_events(id,royalty_id,action,note,actor,created_at) VALUES($1,$2,$3,$4,$5,$6)',[UUID(),row.id,'PAID','Settled with approved supply order '+orderId,actor,at]);
 }
 return r.rows.length;
}
async function releaseOrder(tx,orderId,actor){
 const r=await tx.query('SELECT id,status FROM supply_royalty_months WHERE reserved_order_id=$1',[orderId]);
 for(const row of r.rows){
  const at=now();
  await tx.query("UPDATE supply_royalty_months SET status='PENDING',paid_at=NULL,paid_via=NULL,reserved_order_id=NULL,updated_at=$1 WHERE id=$2",[at,row.id]);
  await tx.query('INSERT INTO supply_royalty_events(id,royalty_id,action,note,actor,created_at) VALUES($1,$2,$3,$4,$5,$6)',[UUID(),row.id,'RELEASED','Supply order denied: '+orderId,actor,at]);
 }
 return r.rows.length;
}
async function franchisees(db){
 const ws=await db.query(`
 SELECT w.id AS workspace_id,w.owner_user_id,w.created_at AS workspace_joined,
 u.username AS owner_name,u.created_at AS joined_at,
 COUNT(DISTINCT wb.branch_id) AS branch_count
 FROM chat_workspaces w JOIN users u ON u.id=w.owner_user_id
 LEFT JOIN chat_workspace_branches wb ON wb.workspace_id=w.id
 WHERE u.role='Admin'
 GROUP BY w.id,w.owner_user_id,w.created_at,u.username,u.created_at
 ORDER BY u.created_at ASC,w.id ASC`);
 for(const o of ws.rows)await ensureMonths(db,Number(o.workspace_id));
 const [settings,periods]=await Promise.all([
  db.query('SELECT workspace_id,fee_amount,effective_month FROM supply_royalty_settings'),
  db.query('SELECT workspace_id,period,amount,status,reserved_order_id FROM supply_royalty_months ORDER BY period DESC')
 ]);
 const fees=new Map(settings.rows.map(x=>[Number(x.workspace_id),x]));
 const grouped=new Map();
 for(const row of periods.rows){
  const wsid=Number(row.workspace_id);if(!grouped.has(wsid))grouped.set(wsid,[]);
  grouped.get(wsid).push(row);
 }
 return ws.rows.map(o=>{
  const id=Number(o.workspace_id),fee=fees.get(id),months=grouped.get(id)||[];
  const pending=months.filter(x=>!isPaid(x));
  return{workspaceId:id,ownerUserId:Number(o.owner_user_id),ownerName:o.owner_name,
   joinedAt:o.joined_at||o.workspace_joined,branchCount:Number(o.branch_count||0),
   monthlyFee:numeric(fee?.fee_amount),effectiveMonth:fee?.effective_month||null,
   royaltyStatus:!fee?'NOT_SET':pending.length?'PENDING':'PAID',
   pendingTotal:money(pending.reduce((n,x)=>n+numeric(x.amount),0)),
   pendingMonths:pending.length,royaltyMonth:months[0]?.period||null};
 });
}
async function profile(db,workspaceId){
 const profiles=await franchisees(db);
 const owner=profiles.find(x=>x.workspaceId===Number(workspaceId));
 if(!owner)throw fail('Franchise owner not found.',404);
 const [orders,months,branches]=await Promise.all([
  db.query('SELECT id,created_at,status,subtotal,urgent_fee,royalty_total,total,priority FROM supply_orders WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 200',[workspaceId]),
  db.query('SELECT id,period,amount,status,reserved_order_id,paid_at,paid_via,created_at FROM supply_royalty_months WHERE workspace_id=$1 ORDER BY period DESC',[workspaceId]),
  db.query('SELECT b.id,b.name FROM branches b JOIN chat_workspace_branches wb ON wb.branch_id=b.id WHERE wb.workspace_id=$1 ORDER BY b.name',[workspaceId])
 ]);
 return{owner,branches:branches.rows,orders:orders.rows.map(x=>({...x,subtotal:numeric(x.subtotal),urgentFee:numeric(x.urgent_fee),royaltyTotal:numeric(x.royalty_total),total:numeric(x.total)})),
  months:months.rows.map(x=>({...x,amount:numeric(x.amount)}))};
}
async function setFee(db,workspaceId,feeAmount,actor){
 const fee=Number(feeAmount);
 if(!Number.isFinite(fee)||fee<0||fee>1000000)throw fail('Monthly royalty must be from ₱0 to ₱1,000,000.');
 const exists=(await db.query('SELECT w.id FROM chat_workspaces w JOIN users u ON u.id=w.owner_user_id WHERE w.id=$1 AND u.role=$2',[workspaceId,'Admin'])).rows[0];
 if(!exists)throw fail('Franchise owner not found.',404);
 return db.transaction(async tx=>{
  await lockWorkspace(tx,workspaceId);
  const at=now(),period=currentMonth();
  await tx.query('INSERT INTO supply_royalty_settings(workspace_id,fee_amount,effective_month,updated_at) VALUES($1,$2,$3,$4) ON CONFLICT(workspace_id) DO UPDATE SET fee_amount=excluded.fee_amount,updated_at=excluded.updated_at',
   [workspaceId,money(fee),period,at]);
  await ensureMonths(tx,workspaceId);
  return{ok:true,monthlyFee:money(fee),note:'Existing issued or paid periods retain their original amounts; future periods use the new monthly fee.'};
 });
}
async function setMonthStatus(db,workspaceId,royaltyId,status,actor){
 if(!['PAID','PENDING'].includes(status))throw fail('Invalid royalty status.');
 return db.transaction(async tx=>{
  await lockWorkspace(tx,workspaceId);
  const r=await tx.query('SELECT id,status,reserved_order_id,paid_via FROM supply_royalty_months WHERE id=$1 AND workspace_id=$2',[royaltyId,workspaceId]);
  const rec=r.rows[0];if(!rec)throw fail('Royalty month not found.',404);
  if(rec.reserved_order_id)throw fail('This royalty is attached to a supply order. Complete or deny that order to change its status.',409);
  if(status==='PENDING'&&rec.status==='PAID'&&rec.paid_via!=='MANUAL')throw fail('Supply-order payments cannot be reversed here.',409);
  if(rec.status===status)return{ok:true,status};
  const at=now();
  await tx.query('UPDATE supply_royalty_months SET status=$1,paid_at=$2,paid_via=$3,updated_at=$4 WHERE id=$5',
   [status,status==='PAID'?at:null,status==='PAID'?'MANUAL':null,at,royaltyId]);
  await tx.query('INSERT INTO supply_royalty_events(id,royalty_id,action,note,actor,created_at) VALUES($1,$2,$3,$4,$5,$6)',
   [UUID(),royaltyId,status,'Manual Main Office royalty status update',actor,at]);
  return{ok:true,status};
 });
}
module.exports={migrate,currentMonth,quote,reserveForOrder,settleOrder,releaseOrder,franchisees,profile,setFee,setMonthStatus};
