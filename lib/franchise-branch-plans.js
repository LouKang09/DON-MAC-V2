'use strict';
// Branch entitlements are franchise-scoped. Do not delete historical sales on downgrades.
const bad=(message,status=409)=>Object.assign(new Error(message),{status});
const PRO_MAX=3;
const EXTRA_RATE=Object.freeze({PRO:799,BUSINESS:899});
const quote=(plan,branchCount,baseAmount=0)=>{
 const selected=plan==='BUSINESS'?'BUSINESS':'PRO';
 const count=Math.max(0,Number(branchCount)||0),base=Math.max(0,Number(baseAmount)||0);
 const extra=Math.max(0,count-1),rate=EXTRA_RATE[selected];
 return{plan:selected,includedBranches:1,maxBranches:selected==='PRO'?PRO_MAX:null,
  activeBranches:count,extraBranches:extra,extraBranchRate:rate,branchAddOn:extra*rate,
  baseAmount:base,nextRenewalAmount:Math.round((base+extra*rate)*100)/100};
};
async function branches(db,workspace){
 const ws=Number(workspace);
 if(!Number.isSafeInteger(ws)||ws<1)throw bad('Franchise workspace not found.',403);
 const rows=await db.query(
  'SELECT b.id,b.name,b.active FROM chat_workspace_branches w '+
  'JOIN branches b ON b.id=w.branch_id WHERE w.workspace_id=$1 ORDER BY b.id',[ws]);
 return rows.rows.map(x=>({id:Number(x.id),name:x.name,active:x.active===true||x.active===1||x.active==='1'}));
}
async function planRecord(db,ws){
 const p=await db.query('SELECT plan,amount,base_amount,status,next_payment_date FROM platform_account_plans WHERE workspace_id=$1',[ws]);
 const row=p.rows[0];
 return{plan:row?.plan==='BUSINESS'?'BUSINESS':'PRO',
  amount:Number(row?.amount||0),baseAmount:Number(row?.base_amount??row?.amount??0),
  status:row?.status||'NOT_CONFIGURED',renewAt:row?.next_payment_date||null};
}
async function entitlements(db,ws){
 const [record,rows]=await Promise.all([planRecord(db,ws),branches(db,ws)]);
 const active=rows.filter(x=>x.active),q=quote(record.plan,active.length,record.baseAmount);
 return{...q,totalBranches:rows.length,branches:rows,mayAdd:record.plan==='BUSINESS'||rows.length<PRO_MAX,
  status:record.status,renewAt:record.renewAt,
  message:record.plan==='PRO'&&rows.length>=PRO_MAX?'Upgrade to Business to add more branches.':null};
}
async function lock(db,ws){
 if(db.engine==='postgres')await db.query('SELECT pg_advisory_xact_lock($1)',[430000000+Number(ws)]);
}
async function allowNewBranch(db,ws){
 await lock(db,ws);
 const e=await entitlements(db,ws);
 if(!e.mayAdd)throw bad('Upgrade to Business to add more branches.',409);
 return e;
}
async function updateRenewalTotal(db,ws){
 const rec=await planRecord(db,ws);
 const all=await branches(db,ws);
 const result=quote(rec.plan,all.filter(x=>x.active).length,rec.baseAmount);
 const r=await db.query('UPDATE platform_account_plans SET amount=$1 WHERE workspace_id=$2',
  [result.nextRenewalAmount,ws]);
 return {...result,renewAt:rec.renewAt};
}
async function requireDowngradeSelection(db,ws,keepIds){
 const list=await branches(db,ws),active=list.filter(x=>x.active);
 if(active.length<=PRO_MAX)return {activeBranchIds:active.map(x=>x.id),deactivate:[]};
 if(!Array.isArray(keepIds)||keepIds.length!==PRO_MAX)
  throw bad('Choose exactly 3 branches to remain active before downgrading to Pro.',409);
 const keys=keepIds.map(Number),unique=new Set(keys);
 if(unique.size!==PRO_MAX||keys.some(id=>!active.some(b=>b.id===id)))
  throw bad('Select 3 distinct currently active branches belonging to this franchise.',409);
 return{activeBranchIds:keys,deactivate:active.filter(x=>!unique.has(x.id)).map(x=>x.id)};
}
async function applyDowngrade(db,ws,keepIds){
 await lock(db,ws);
 const choice=await requireDowngradeSelection(db,ws,keepIds);
 for(const id of choice.deactivate)
  await db.query('UPDATE branches SET active=$1 WHERE id=$2 AND id IN '+
    '(SELECT branch_id FROM chat_workspace_branches WHERE workspace_id=$3)',[false,id,ws]);
 return{...choice,blockedCashiers:choice.deactivate.length?
  (await db.query("SELECT id,username,branch_id FROM users WHERE role=$1 AND active=$2 AND branch_id IN ("+
    choice.deactivate.map((_,i)=>'$'+(i+3)).join(',')+')',
    ['User',true,...choice.deactivate])).rows.map(x=>({id:Number(x.id),username:x.username,branchId:Number(x.branch_id)})):[]
 };
}
module.exports={PRO_MAX,EXTRA_RATE,quote,branches,planRecord,entitlements,lock,allowNewBranch,updateRenewalTotal,requireDowngradeSelection,applyDowngrade};
