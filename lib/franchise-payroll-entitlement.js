'use strict';
const bad=(m,s=400)=>Object.assign(new Error(m),{status:s});
const id=x=>Number.isSafeInteger(Number(x))&&Number(x)>0?Number(x):0;
const now=()=>new Date().toISOString();
async function migrate(db){
 const fk=db.engine==='postgres'?'BIGINT':'INTEGER';
 await db.exec('CREATE TABLE IF NOT EXISTS franchise_payroll_addons ('+
  'workspace_id '+fk+' PRIMARY KEY REFERENCES chat_workspaces(id) ON DELETE CASCADE,'+
  "status VARCHAR(12) NOT NULL DEFAULT 'UNPAID',fee NUMERIC(12,2) NOT NULL DEFAULT 0,"+
  'updated_by VARCHAR(100),updated_at TEXT)');
}
async function addon(db,workspace){
 const q=await db.query('SELECT status,fee,updated_at FROM franchise_payroll_addons WHERE workspace_id=$1',[workspace]);
 const x=q.rows[0];return x?{status:x.status,fee:Number(x.fee),updatedAt:x.updated_at}:{status:'UNPAID',fee:0,updatedAt:null};
}
async function entitlement(db,workspace){
 const result=await db.query('SELECT plan,status FROM platform_account_plans WHERE workspace_id=$1',[workspace]);
 const plan=result.rows[0]?.plan||'PRO',subscriptionStatus=result.rows[0]?.status||'UNPAID',extra=await addon(db,workspace);
 const enabled=subscriptionStatus==='PAID'&&(plan==='BUSINESS'||(extra.status==='PAID'&&extra.fee>0));
 const message=subscriptionStatus!=='PAID'?'Payroll requires an active Paid subscription.':
  plan==='BUSINESS'?'Payroll is included with Business.':
  enabled?'Your paid Pro payroll add-on is active.':
  'Payroll is a separately paid Pro add-on. Contact Admin Control to configure its fee and approve payment.';
 return{plan,subscriptionStatus,addon:extra,enabled,message};
}
async function context(db,user){
 const uid=id(user?.id);if(!uid)throw bad('Sign in first.',401);
 const q=await db.query('SELECT m.workspace_id,u.id,u.role,u.branch_id,u.active,b.active AS branch_active '+
  'FROM chat_memberships m JOIN users u ON u.id=m.user_id LEFT JOIN branches b ON b.id=u.branch_id '+
  'WHERE u.id=$1 ORDER BY m.workspace_id LIMIT 2',[uid]);
 if(q.rows.length!==1||![true,1,'1'].includes(q.rows[0].active))
  throw bad('Your account is not an active franchise member.',403);
 const r=q.rows[0],ws=id(r.workspace_id);
 if(r.role==='User'){
  if(![true,1,'1'].includes(r.branch_active))throw bad('Your assigned branch is inactive.',403);
  const membership=await db.query('SELECT 1 FROM chat_workspace_branches WHERE workspace_id=$1 AND branch_id=$2',
   [ws,id(r.branch_id)]);
  if(!membership.rows.length)throw bad('Your assigned branch does not belong to your franchise.',403);
 }
 return{workspaceId:ws,userId:uid,role:r.role,branchId:id(r.branch_id),entitlement:await entitlement(db,ws)};
}
function requireEnabled(ctx){if(!ctx.entitlement.enabled)throw bad(ctx.entitlement.message,403);}
function requireAdmin(ctx){if(ctx.role!=='Admin')throw bad('Only Owner/Co-Owner can manage payroll.',403);requireEnabled(ctx);}
function requireCashier(ctx){if(ctx.role!=='User')throw bad('Only cashiers can time in or out.',403);requireEnabled(ctx);}
async function setAddon(db,workspace,body,actor){
 const ws=id(workspace);if(!ws)throw bad('Choose a franchise workspace.');
 const exists=await db.query('SELECT id FROM chat_workspaces WHERE id=$1',[ws]);
 if(!exists.rows.length)throw bad('Franchise workspace does not exist.',404);
 const status=String(body?.status||'UNPAID').toUpperCase(),fee=Number(body?.fee);
 if(!['UNPAID','PAID','ON_HOLD'].includes(status)||!Number.isFinite(fee)||fee<0||fee>1000000)
  throw bad('Choose a valid fee and status.');
 if(status==='PAID'&&fee<=0)throw bad('A separate positive add-on fee is required before approving Pro payroll.');
 await db.query('INSERT INTO franchise_payroll_addons(workspace_id,status,fee,updated_by,updated_at) '+
  'VALUES($1,$2,$3,$4,$5) ON CONFLICT(workspace_id) DO UPDATE SET status=excluded.status,'+
  'fee=excluded.fee,updated_by=excluded.updated_by,updated_at=excluded.updated_at',
  [ws,status,Math.round(fee*100)/100,String(actor||'Admin Control').slice(0,100),now()]);
 return{ok:true,entitlement:await entitlement(db,ws)};
}
module.exports={migrate,context,entitlement,addon,setAddon,requireEnabled,requireAdmin,requireCashier,bad,id,now};
