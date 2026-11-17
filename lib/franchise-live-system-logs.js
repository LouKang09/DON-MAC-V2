'use strict';
// Read-only franchise System Logs assembled solely from tenant-owned,
 // immutable checkout, inventory and expense records.
const scope=require('./franchise-live-scope');
const limitOf=value=>{
 const n=Number(value||200);
 return Number.isSafeInteger(n)?Math.max(1,Math.min(n,500)):200;
};
const at=value=>{
 if(value instanceof Date)return value.toISOString();
 const parsed=Date.parse(String(value||''));
 return Number.isFinite(parsed)?new Date(parsed).toISOString():String(value||'');
};
const num=x=>Number.isFinite(Number(x))?Number(x):0;
function mapEvents(audit,movements,expenses){
 const logs=[];
 for(const e of audit){
  logs.push({
   id:'sale-'+e.id,category:'Sales',
   status:e.event_name==='SALE_COMPLETED'?'SALE COMPLETED':
    e.event_name==='SALE_VOIDED'?'SALE VOIDED':e.event_name,
   actor:e.actor||'Unknown cashier',
   remark:[e.branch_name,e.reference].filter(Boolean).join(' · '),
   activity:e.note||'Checkout audit event recorded.',
   createdAt:at(e.created_at),reference:e.reference||''
  });
 }
 const groups=new Map();
 for(const m of movements){
  // Movement records for the same stock operation share a reference and
  // are condensed into one expandable-style readable audit entry.
  const key=[m.branch_id,m.movement_type,m.reference||String(m.id)].join('|');
  if(!groups.has(key))groups.set(key,{
   branch:m.branch_name,type:m.movement_type,reference:m.reference||'',
   actor:m.actor||'Unknown operator',createdAt:at(m.created_at),
   details:[],remarks:new Set()
  });
  const g=groups.get(key);
  const when=at(m.created_at);
  if(Date.parse(when)>Date.parse(g.createdAt))g.createdAt=when;
  g.details.push(String(m.display_name||'Ingredient')+' '+
   (num(m.quantity_change)>0?'+':'')+num(m.quantity_change).toLocaleString('en-PH',{maximumFractionDigits:6})+
   ' '+String(m.uom||''));
  if(m.remarks)g.remarks.add(String(m.remarks));
 }
 for(const [key,g] of groups){
  logs.push({
   id:'movement-'+key,category:'Inventory',
   status:g.type.replace(/_/g,' '),
   actor:g.actor,createdAt:g.createdAt,reference:g.reference,
   remark:[g.branch,g.reference].filter(Boolean).join(' · '),
   activity:g.details.length+' ingredient movement(s): '+g.details.join(' · ')+
    (g.remarks.size?' | Remarks: '+[...g.remarks].join(' | '):'')
  });
 }
 for(const e of expenses){
  logs.push({
   id:'expense-'+e.id,category:'Expenses',status:'EXPENSE RECORDED',
   actor:e.actor||'Unknown operator',
   remark:[e.branch_name,e.category].filter(Boolean).join(' · '),
   activity:'Recorded ₱'+num(e.amount).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})+
    ' for '+String(e.category||'Expense')+(e.notes?' · '+e.notes:''),
   createdAt:at(e.incurred_at)
  });
 }
 return logs.sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)||
  a.id.localeCompare(b.id));
}
async function list(db,ctx,rawLimit){
 scope.requireAdmin(ctx);
 const limit=limitOf(rawLimit),ws=ctx.workspaceId;
 if(!scope.goodId(ws))throw scope.fail('No valid franchise workspace is associated with this session.',403);
 // All three datasets are owner-isolated. Membership JOINs prevent accidental
 // exposure of stray or incorrectly attributed branch rows.
 const [audit,movements,expenses]=await Promise.all([
  db.query('SELECT e.id,e.event_name,e.note,e.created_at,s.reference,'+
   'b.name AS branch_name,COALESCE(u.login_username,u.username) AS actor '+
   'FROM branch_sale_audit_events e JOIN branch_live_sales s ON s.id=e.sale_id '+
   'AND s.workspace_id=e.workspace_id AND s.branch_id=e.branch_id '+
   'JOIN chat_workspace_branches wb ON wb.workspace_id=e.workspace_id '+
   'AND wb.branch_id=e.branch_id JOIN branches b ON b.id=wb.branch_id '+
   'LEFT JOIN users u ON u.id=e.actor_user_id '+
   'WHERE e.workspace_id=$1 ORDER BY e.created_at DESC,e.id DESC LIMIT $2',[ws,limit]),
  db.query('SELECT m.id,m.branch_id,m.movement_type,m.quantity_change,m.reference,'+
   'm.remarks,m.created_at,i.display_name,i.uom,b.name AS branch_name,'+
   'COALESCE(u.login_username,u.username) AS actor '+
   'FROM branch_inventory_movements m '+
   'JOIN chat_workspace_branches wb ON wb.workspace_id=m.workspace_id '+
   'AND wb.branch_id=m.branch_id JOIN branches b ON b.id=wb.branch_id '+
   'JOIN branch_ingredients i ON i.id=m.ingredient_id '+
   'AND i.workspace_id=m.workspace_id AND i.branch_id=m.branch_id '+
   'LEFT JOIN users u ON u.id=m.created_by '+
   'WHERE m.workspace_id=$1 ORDER BY m.created_at DESC,m.id DESC LIMIT $2',[ws,limit]),
  db.query('SELECT e.id,e.category,e.amount,e.notes,e.incurred_at,'+
   'b.name AS branch_name,COALESCE(u.login_username,u.username) AS actor '+
   'FROM branch_live_expenses e JOIN chat_workspace_branches wb '+
   'ON wb.workspace_id=e.workspace_id AND wb.branch_id=e.branch_id '+
   'JOIN branches b ON b.id=wb.branch_id LEFT JOIN users u ON u.id=e.created_by '+
   'WHERE e.workspace_id=$1 ORDER BY e.incurred_at DESC,e.id DESC LIMIT $2',[ws,limit])
 ]);
 const all=mapEvents(audit.rows,movements.rows,expenses.rows);
 return{
  logs:all.slice(0,limit),count:all.length,limit,
  categories:['All','Sales','Inventory','Expenses'],
  source:'Franchise checkout, branch stock and expense records',
  coverage:'Other legacy System Log categories are not backfilled or inferred.',
  // The three bounded queries may have older rows beyond the requested horizon.
  truncated:all.length>=limit||[audit,movements,expenses].some(x=>x.rows.length>=limit)
 };
}
module.exports={list,mapEvents,limitOf};
