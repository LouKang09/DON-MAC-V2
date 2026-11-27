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
 const result=await db.query('SELECT plan,status,next_payment_date FROM platform_account_plans WHERE workspace_id=$1',[workspace]);
 const plan=result.rows[0]?.plan||'PRO',subscriptionStatus=result.rows[0]?.status||'UNPAID',extra=await addon(db,workspace);
 const trial=subscriptionStatus==='TRIAL'&&Date.parse(result.rows[0]?.next_payment_date)>Date.now();
 const active=subscriptionStatus==='PAID'||trial;
 // Existing paid Business subscriptions retain their included benefit; newly
 // trialed accounts require the optional payroll add-on for either plan.
 const trialHistory=(await db.query("SELECT 1 FROM platform_account_plan_history WHERE workspace_id=$1 AND status='TRIAL' LIMIT 1",[workspace])).rows.length>0;
 const legacyBusiness=plan==='BUSINESS'&&!trialHistory&&subscriptionStatus==='PAID';
 const enabled=active&&(legacyBusiness||(extra.fee>0&&(extra.status==='PAID'||(trial&&extra.status==='UNPAID'))));
 const message=!active?'Payroll requires an active subscription or trial.':
  enabled?(trial?'Payroll is active during your trial. The add-on is included in your next payment.':legacyBusiness?'Payroll is included with your existing Business subscription.':'Your payroll add-on is active.'):
  extra.fee>0?'Payroll payment is outstanding. Access unlocks when Admin Control verifies the add-on payment.':'Add Payroll & Attendance for ₱1,000 on your next payment.';
 return{plan,subscriptionStatus,addon:extra,enabled,message,canPurchase:active&&!legacyBusiness&&extra.fee===0};
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
async function purchase(db,ctx){
 const plans=require('./franchise-branch-plans');
 return db.transaction(async tx=>{
  await plans.lock(tx,ctx.workspaceId);
  const owner=(await tx.query('SELECT owner_user_id FROM chat_workspaces WHERE id=$1',[ctx.workspaceId])).rows[0];
  if(ctx.role!=='Admin'||Number(owner?.owner_user_id)!==ctx.userId)throw bad('Only the franchise owner can purchase payroll.',403);
  const current=await entitlement(tx,ctx.workspaceId);
  if(!current.canPurchase)throw bad('Payroll add-on already requested or unavailable.',409);
  await tx.query('INSERT INTO franchise_payroll_addons(workspace_id,status,fee,updated_by,updated_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(workspace_id) DO UPDATE SET status=excluded.status,fee=excluded.fee,updated_by=excluded.updated_by,updated_at=excluded.updated_at',[ctx.workspaceId,'UNPAID',1000,'Owner purchase',now()]);
  await plans.updateRenewalTotal(tx,ctx.workspaceId);
  return {ok:true,entitlement:await entitlement(tx,ctx.workspaceId)};
 });
}
module.exports={purchase,migrate,context,entitlement,addon,setAddon,requireEnabled,requireAdmin,requireCashier,bad,id,now};
