'use strict';
const crypto=require('node:crypto');
const scope=require('./franchise-live-scope');
const fail=scope.fail;
async function migrate(db){
 return db.transaction(async tx=>{
  if(tx.engine==='postgres')await tx.query('SELECT pg_advisory_xact_lock(2026111502::bigint)');
 const fk=tx.engine==='postgres'?'BIGINT':'INTEGER';
 await tx.exec('CREATE TABLE IF NOT EXISTS branch_live_expenses('+
  'id VARCHAR(40) PRIMARY KEY,workspace_id '+fk+' NOT NULL REFERENCES chat_workspaces(id),'+
  'branch_id '+fk+' NOT NULL REFERENCES branches(id),category VARCHAR(80) NOT NULL,'+
  'amount NUMERIC(12,2) NOT NULL CHECK(amount>=0),notes TEXT,'+
  'created_by '+fk+' NOT NULL REFERENCES users(id),incurred_at TEXT NOT NULL,'+
  'FOREIGN KEY(branch_id,workspace_id) REFERENCES chat_workspace_branches(branch_id,workspace_id) ON DELETE RESTRICT)');
 await tx.exec('CREATE INDEX IF NOT EXISTS idx_branch_live_expenses_scope ON '+
  'branch_live_expenses(workspace_id,branch_id,incurred_at)');
 });
}
async function list(db,ctx,branchId){
 scope.requirePaid(ctx);
 if(!ctx.admin&&!ctx.permissions?.includes('expenses.view'))throw scope.fail('Expense access has not been granted by your Owner.');
 const b=await scope.branch(db,ctx,branchId);
 const rows=(await db.query('SELECT id,category,amount,notes,incurred_at,created_by '+
  'FROM branch_live_expenses WHERE workspace_id=$1 AND branch_id=$2 '+
  'ORDER BY incurred_at DESC LIMIT 200',[ctx.workspaceId,b.id])).rows;
 return{branchId:b.id,rows:rows.map(x=>({id:x.id,category:x.category,amount:Number(x.amount),
  notes:x.notes,incurredAt:x.incurred_at,createdBy:Number(x.created_by)}))};
}
async function add(db,ctx,body){
 scope.requirePaid(ctx);
 if(!ctx.admin&&!ctx.permissions?.includes('expenses.manage'))throw scope.fail('Expense management has not been granted by your Owner.');
 const b=await scope.branch(db,ctx,body.branchId);
 const category=String(body.category||'').trim(),notes=String(body.notes||'').trim(),amount=Number(body.amount);
 if(!category||category.length>80||notes.length>500||!Number.isFinite(amount)||
    amount<=0||amount>99999999||Math.round(amount*100)/100!==amount)
  throw fail('Enter expense category, positive amount and optional notes.',400);
 const key=crypto.randomUUID();
 await db.query('INSERT INTO branch_live_expenses('+
  'id,workspace_id,branch_id,category,amount,notes,created_by,incurred_at) '+
  'VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
  [key,ctx.workspaceId,b.id,category,amount,notes||null,ctx.userId,new Date().toISOString()]);
 return{ok:true,id:key,branchId:b.id};
}
async function summary(db,ctx,branchId,since){
 const b=await scope.branch(db,ctx,branchId);
 const r=await db.query('SELECT COUNT(*) AS count,COALESCE(SUM(amount),0) AS total '+
  'FROM branch_live_expenses WHERE workspace_id=$1 AND branch_id=$2 AND incurred_at>=$3',
  [ctx.workspaceId,b.id,since]);
 return{count:Number(r.rows[0]?.count||0),total:Number(r.rows[0]?.total||0)};
}
module.exports={migrate,list,add,summary};
