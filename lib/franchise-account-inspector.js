'use strict';
// Admin Control-only, intentionally READ-ONLY, franchise-scoped inspection.
// Never issues a franchise session token or exposes live edit/checkout APIs.
const bad=(message,status=403)=>Object.assign(new Error(message),{status});
const valid=x=>/^[0-9a-f-]{36}$/i.test(String(x||''));
const money=x=>Number(x||0);
async function inspect(db,applicationId){
 if(!valid(applicationId))throw bad('Invalid franchise application.',400);
 const account=(await db.query(
  'SELECT t.workspace_id,t.user_id,r.username,r.full_name,r.email,r.phone,'+
  'u.active,m.data_mode,p.plan,p.status AS payment_status,p.next_payment_date '+
  'FROM franchise_test_accounts t JOIN public_franchise_requests r ON r.id=t.request_id '+
  'JOIN users u ON u.id=t.user_id JOIN chat_workspaces w ON w.id=t.workspace_id '+
  'AND w.owner_user_id=t.user_id JOIN franchise_account_modes m ON m.workspace_id=t.workspace_id '+
  'LEFT JOIN platform_account_plans p ON p.workspace_id=t.workspace_id '+
  'WHERE t.request_id=$1',[applicationId])).rows[0];
 if(!account)throw bad('This account is not ready for inspection.',404);
 // Never expose shared legacy data from cross-workspace tables.
 if(account.data_mode!=='NEW')throw bad('Read-only inspection is available for isolated franchise accounts only.',409);
 const ws=Number(account.workspace_id);
 const [branches,staff,summary,recent,stock]=await Promise.all([
  db.query('SELECT b.id,b.name,b.active,b.city,b.province FROM chat_workspace_branches wb '+
   'JOIN branches b ON b.id=wb.branch_id WHERE wb.workspace_id=$1 ORDER BY b.name',[ws]),
  db.query('SELECT u.username,u.full_name,u.role,u.active,b.name AS branch_name '+
   'FROM chat_memberships cm JOIN users u ON u.id=cm.user_id '+
   'LEFT JOIN branches b ON b.id=u.branch_id AND EXISTS(SELECT 1 FROM chat_workspace_branches wb '+
   'WHERE wb.branch_id=b.id AND wb.workspace_id=cm.workspace_id) '+
   'WHERE cm.workspace_id=$1 ORDER BY u.id LIMIT 200',[ws]),
  db.query('SELECT COUNT(*) AS transactions,'+
   "COALESCE(SUM(CASE WHEN status='Sold' THEN actual ELSE 0 END),0) AS net,"+
   "COALESCE(SUM(CASE WHEN status='Sold' THEN gross ELSE 0 END),0) AS gross "+
   'FROM branch_live_sales WHERE workspace_id=$1',[ws]),
  db.query('SELECT s.reference,s.sold_at,s.actual,s.status,s.payment_mode,'+
   's.cashier_name_snapshot,b.name AS branch_name '+
   'FROM branch_live_sales s JOIN chat_workspace_branches wb '+
   'ON wb.workspace_id=s.workspace_id AND wb.branch_id=s.branch_id '+
   'JOIN branches b ON b.id=s.branch_id '+
   'WHERE s.workspace_id=$1 ORDER BY s.sold_at DESC,s.id DESC LIMIT 30',[ws]),
  db.query('SELECT COUNT(*) AS total,'+
   'COALESCE(SUM(CASE WHEN i.stock_qty<=i.low_stock_threshold THEN 1 ELSE 0 END),0) AS low '+
   'FROM branch_ingredients i JOIN chat_workspace_branches wb '+
   'ON wb.workspace_id=i.workspace_id AND wb.branch_id=i.branch_id '+
   'WHERE i.workspace_id=$1 AND i.active=$2',[ws,true])
 ]);
 return{readOnly:true,workspaceId:ws,
  account:{username:account.username,fullName:account.full_name,email:account.email,
   phone:account.phone,loginEnabled:!!account.active,plan:account.plan||null,
   paymentStatus:account.payment_status||'UNPAID',nextPaymentDate:account.next_payment_date||null},
  branches:branches.rows.map(x=>({id:Number(x.id),name:x.name,active:!!x.active,
   city:x.city||'',province:x.province||''})),
  users:staff.rows.map(x=>({username:x.username,fullName:x.full_name||'',role:x.role,
   active:!!x.active,branch:x.branch_name||''})),
  sales:{transactions:Number(summary.rows[0]?.transactions||0),gross:money(summary.rows[0]?.gross),
   net:money(summary.rows[0]?.net),
   recent:recent.rows.map(x=>({reference:x.reference,at:x.sold_at,
    net:money(x.actual),status:x.status,payment:x.payment_mode,
    cashier:x.cashier_name_snapshot,branch:x.branch_name}))},
  inventory:{ingredients:Number(stock.rows[0]?.total||0),lowStock:Number(stock.rows[0]?.low||0)},
  notice:'Audit-only access. Editing inventory, products, accounts and sales requires the actual franchise owner or authorized cashier. No franchise login was issued.'};
}
module.exports={inspect};
