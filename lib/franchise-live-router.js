'use strict';
const scope=require('./franchise-live-scope');
const catalog=require('./franchise-live-catalog');
const sales=require('./franchise-live-sales');
const costing=require('./franchise-live-costing');
const expenses=require('./franchise-live-expenses');
const direct=require('./branch-direct-stock');
const read=require('./branch-catalog-read');
const id=scope.goodId;
const cashierAccess=require('./cashier-access');
const branchPlans=require('./franchise-branch-plans');
const platformAccounts=require('./platform-accounts');
const unifiedDashboard=require('./franchise-unified-dashboard');
const shiftDeposits=require('./franchise-shift-deposits');
const livePlanInsights=require('./franchise-live-plan-dashboard');
const liveAdvancedAnalytics=require('./franchise-live-advanced-analytics');
const inventoryUsage=require('./inventory-ingredient-usage');
const businessStoreDetail=require('./business-store-detail');
const finance=require('./franchise-live-finance');
const systemLogs=require('./franchise-live-system-logs');
const incoming=require('./branch-incoming-supply');
const officePromotions=require('./office-promotions');
const transferBranches=require('./inventory-transfer-branches');
const allowed=(ctx,permission)=>ctx.admin||ctx.permissions.includes(permission);
const requirePermission=(ctx,permission)=>{if(!allowed(ctx,permission))throw scope.fail('This sidebar feature was not granted by your Owner.');};
function result(data,status=200){return{status,data};}
async function run(db,context,user,method,url,body){
 const p=url.pathname,query=url.searchParams;
 const req=async()=>body();
 const branchId=id(query.get('branchId'))||context.branchId;
 // Permissions and billing status are always recomputed from this session's server identity.
 // Client-controlled menu state cannot grant API access.
 const permissions=context.cashier?await cashierAccess.forUser(db,{id:context.userId,role:'User'}):[...cashierAccess.KEYS];
 const ctx={...context,permissions};
 if(method==='GET'&&p==='/api/live/status'){
  const [branches,staff,entitlements]=await Promise.all([scope.branches(db,ctx),
    ctx.admin?scope.cashiers(db,ctx):Promise.resolve([]),
    ctx.admin?branchPlans.entitlements(db,ctx.workspaceId):Promise.resolve(null)]);
  return result({ok:true,liveMode:true,productionIsolated:true,workspaceId:ctx.workspaceId,
   branchId:ctx.branchId,branchName:ctx.branchName,role:ctx.role,username:user.username,
   plan:ctx.subscriptionPlan||entitlements?.plan||'PRO',
   subscriptionStatus:ctx.subscriptionStatus,subscriptionActive:ctx.subscriptionActive,
   setupMode:!ctx.subscriptionActive,permissions,branches,cashiers:staff,entitlements,
   notice:ctx.subscriptionActive?'Live franchise checkout enabled.':
     'Account setup is available. Checkout is locked until Admin Control marks the subscription Paid.'});
 }
 // Account Settings must read the SAME Admin Control subscription record as
 // the actual access gate. Live status alone has no plan history, pending
 // request, subscription start/renewal dates, or configured flag.
 const accountSubscription=async()=>{
  const sub=await platformAccounts.accountSubscription(db,ctx.workspaceId);
  if(!ctx.admin)return {plan:sub.plan,status:sub.status,configured:sub.configured};
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',
   year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const due=sub.renewAt?String(sub.renewAt).slice(0,10):null;
  const remaining=due?Math.round((Date.parse(due+'T00:00:00Z')-
   Date.parse(today+'T00:00:00Z'))/86400000):null;
  return {...sub,daysRemaining:Number.isFinite(remaining)?Math.max(0,remaining):null};
 };
 if(method==='GET'&&p==='/api/live/account/subscription')
  return result(await accountSubscription());
 if(method==='POST'&&p==='/api/live/account/subscription/request-plan'){
  scope.requireAdmin(ctx);
  const input=await req();
  const plan=String(input?.plan||'').trim().toUpperCase();
  const response=await platformAccounts.requestPlan(db,ctx.workspaceId,
   {role:'Admin',id:ctx.userId},plan,input?.keepBranchIds);
  return result({...response,subscription:await accountSubscription()});
 }
 if(method==='GET'&&p==='/api/live/system-logs'){
  scope.requireAdmin(ctx);
  return result(await systemLogs.list(db,ctx,query.get('limit')));
 }
 if(method==='GET'&&p==='/api/live/office-promotions'){
  // Main Office's promotions are global, but eligibility and acquired credits
  // are calculated for the authenticated franchise workspace only.
  const branch=await scope.branch(db,ctx,branchId);
  return result({campaigns:await officePromotions.forWorkspace(db,ctx.workspaceId,branch.id)});
 }
 if(method==='GET'&&p==='/api/live/dashboard/plan-insights'){
  scope.requirePaid(ctx);scope.requireAdmin(ctx);
  return result(await livePlanInsights.insights(db,ctx,id(query.get('branchId'))||null));
 }
 if(method==='GET'&&p==='/api/live/advanced/analytics'){
  scope.requirePaid(ctx);scope.requireAdmin(ctx);
  return result(await liveAdvancedAnalytics.read(db,ctx,Object.fromEntries(query)));
 }
 if((method==='GET'||method==='PUT')&&p==='/api/live/dashboard/widgets'){
  scope.requireAdmin(ctx);
  const plan=String(query.get('plan')||'').toUpperCase();
  return result(await livePlanInsights.settings(db,ctx,plan,method==='PUT'?await req():undefined));
 }
 if(method==='GET'&&p==='/api/live/dashboard/store-detail'){
  scope.requirePaid(ctx);scope.requireAdmin(ctx);
  return result(await businessStoreDetail.live(db,ctx));
 }
 if(method==='GET'&&p==='/api/live/dashboard/store-trends'){
  scope.requirePaid(ctx);scope.requireAdmin(ctx);
  return result(await businessStoreDetail.liveTrends(db,ctx,Object.fromEntries(query)));
 }
 if(method==='GET'&&p==='/api/live/dashboard'){
  if(!ctx.admin)requirePermission(ctx,'dashboard.view');
  return result(await unifiedDashboard.dashboard(db,ctx,query));
 }
 if((method==='GET'||method==='POST')&&p==='/api/live/dashboard/shift-deposits'){
  scope.requirePaid(ctx);
  if(!ctx.admin)requirePermission(ctx,'dashboard.view');
  return result(method==='GET'?
   await shiftDeposits.summary(db,user,{branchId:query.get('branchId')||undefined,
    date:query.get('date')||undefined,from:query.get('from')||undefined,
    to:query.get('to')||undefined}):
   await shiftDeposits.save(db,user,await req()),method==='POST'?200:200);
 }
 if(method==='GET'&&p==='/api/live/finance/transactions')
  return result(await finance.transactions(db,ctx,query));
 if(method==='GET'&&p==='/api/live/finance/expenses')
  return result(await finance.expenses(db,ctx,query));
 if(method==='POST'&&p==='/api/live/finance/expenses')
  return result(await finance.saveExpenses(db,ctx,await req()),201);
 if(method==='GET'&&p==='/api/live/inventory/usage-summary'){
  if(!ctx.admin)requirePermission(ctx,'inventory.view');
  const selected=await scope.branch(db,ctx,query.get('branchId')||ctx.branchId);
  return result(await inventoryUsage.live(db,ctx.workspaceId,selected,
   Object.fromEntries(query)));
 }
 if(method==='GET'&&p==='/api/live/inventory/movements'){
  if(!ctx.admin)requirePermission(ctx,'inventory.view');
  return result({items:await incoming.movements(db,user,branchId,query.get('limit'))});
 }
 if(method==='GET'&&p==='/api/live/inventory/incoming'){
  if(!ctx.admin)requirePermission(ctx,'inventory.view');
  return result(await incoming.list(db,user,branchId));
 }
 const inbound=p.match(/^\/api\/live\/inventory\/incoming\/(\d+)\/(accept|reject|receive)$/);
 if(method==='POST'&&inbound){
  if(!ctx.admin)requirePermission(ctx,'inventory.view');
  return result(await incoming.process(db,user,Number(inbound[1]),inbound[2],await req()));
 }
 if(method==='GET'&&p==='/api/live/inventory/transfer-branches'){
  if(!ctx.admin)requirePermission(ctx,'inventory.view');
  if((await branchPlans.planRecord(db,ctx.workspaceId)).plan!=='BUSINESS')
   throw scope.fail('Business plan is required for inter-branch stock transfers.');
  return result(await transferBranches.list(db,user,query.get('sourceBranchId')));
 }
 if(method==='POST'&&p==='/api/live/inventory/transfer'){
  if(!ctx.admin)requirePermission(ctx,'inventory.view');
  if((await branchPlans.planRecord(db,ctx.workspaceId)).plan!=='BUSINESS')
   throw scope.fail('Upgrade to Business to transfer stock between branches.');
  return result(await incoming.create(db,user,await req(),'TRANSFER'),201);
 }
 if(method==='GET'&&p==='/api/live/catalog')
  return result(await catalog.catalog(db,context,branchId));
 if(method==='GET'&&p==='/api/live/manage')
  return result(await catalog.manage(db,context,{branchId}));
 if(method==='GET'&&p==='/api/live/categories'){
  scope.requireAdmin(ctx);
  const c=await catalog.catalog(db,ctx,branchId);
  return result({categories:c.categories});
 }
 if(method==='POST'&&p==='/api/live/categories'){
  const data=await req();
  return result(await catalog.saveCategory(db,ctx,data.branchId,undefined,data),201);
 }
 const categoryPath=p.match(/^\/api\/live\/categories\/([^/]+)$/);
 if(categoryPath&&(method==='PUT'||method==='DELETE')){
  let categoryName;try{categoryName=decodeURIComponent(categoryPath[1]);}catch(_){throw scope.fail('Invalid category name.');}
  if(method==='DELETE')return result(await catalog.archiveCategory(db,ctx,branchId,categoryName));
  const data=await req();
  return result(await catalog.saveCategory(db,ctx,data.branchId,categoryName,data));
 }

 if(method==='GET'&&p==='/api/live/inventory'){
  if(!ctx.admin)requirePermission(ctx,'inventory.view');
  return result({branchId,items:await read.inventory(db,context.workspaceId,
   (await scope.branch(db,context,branchId)).id,true)});
 }
 if(method==='GET'&&p==='/api/live/transactions'){
  scope.requirePaid(ctx);requirePermission(ctx,'transactions.view');
  return result(await sales.transactions(db,ctx,{branchId,page:query.get('page')}));
 }
 if(method==='GET'&&p==='/api/live/report/costing'){
  scope.requirePaid(ctx);
  if(!ctx.admin)requirePermission(ctx,'reports.view');
  const range=String(query.get('range')||'day');
  const maxDays=cashierAccess.windowDays(permissions);
  if(!ctx.admin&&({day:1,week:7,month:30}[range]||Infinity)>maxDays)
   throw scope.fail('This report exceeds your Owner-approved history limit.',403);
  const base=await sales.report(db,ctx,{branchId,range});
  return result(await costing.report(db,ctx,base.branchId,base.since));
 }
 if(method==='GET'&&p==='/api/live/report'){
  scope.requirePaid(ctx);
  if(!ctx.admin)requirePermission(ctx,'reports.view');
  const range=String(query.get('range')||'day');
  const maxDays=cashierAccess.windowDays(permissions);
  if(!ctx.admin&&({day:1,week:7,month:30}[range]||Infinity)>maxDays)
   throw scope.fail('This report exceeds your Owner-approved history limit.',403);
  const report=await sales.report(db,ctx,{branchId,range});
  const expense=await expenses.summary(db,context,branchId,report.since);
  const summary=(await db.query(
   "SELECT COUNT(*) AS all_count,"+
   "COALESCE(SUM(CASE WHEN status='Sold' THEN gross ELSE 0 END),0) AS gross,"+
   "COALESCE(SUM(CASE WHEN status<>'Sold' THEN actual ELSE 0 END),0) AS refund,"+
   "COALESCE(SUM(CASE WHEN status<>'Sold' THEN 1 ELSE 0 END),0) AS deleted_count "+
   "FROM branch_live_sales WHERE workspace_id=$1 AND branch_id=$2 AND sold_at>=$3",
   [ctx.workspaceId,report.branchId,report.since])).rows[0]||{};
  // Read-only transaction details for the branch report; never consult
  // legacy sales or another tenant's data. Cap row count for UI responsiveness.
  const reportSales=(await db.query(
   'SELECT reference,cashier_name_snapshot,status,payment_mode,sold_at,gross,adjustment,actual,remark '+
   'FROM branch_live_sales WHERE workspace_id=$1 AND branch_id=$2 AND sold_at>=$3 '+
   'ORDER BY sold_at DESC LIMIT 250',
   [ctx.workspaceId,report.branchId,report.since])).rows.map(x=>({
    reference:x.reference,cashier:x.cashier_name_snapshot,status:x.status,
    paymentMode:x.payment_mode,soldAt:x.sold_at,gross:Number(x.gross),
    adjustment:Number(x.adjustment),actual:Number(x.actual),remark:x.remark||''
   }));
  return result({...report,transactions:reportSales,
   allTransactionCount:Number(summary.all_count||0),gross:Number(summary.gross||0),
   refund:Number(summary.refund||0),deletedCount:Number(summary.deleted_count||0),
   expenses:expense.total,expensesCount:expense.count,
   netAfterExpenses:report.actual-expense.total});
 }
 if(method==='GET'&&p==='/api/live/expenses'){
  scope.requirePaid(ctx);requirePermission(ctx,'expenses.view');
  return result(await expenses.list(db,ctx,branchId));
 }
 if(method==='POST'&&p==='/api/live/expenses'){
  scope.requirePaid(ctx);requirePermission(ctx,'expenses.manage');
  return result(await expenses.add(db,ctx,await req()),201);
 }
 if(method==='GET'&&p==='/api/live/cashiers')
  return result({cashiers:await scope.cashiers(db,context)});
 if(method==='POST'&&p==='/api/live/cashiers')
  return result(await scope.createCashier(db,ctx,await req()),201);
 if(method==='POST'&&p==='/api/live/branches')
  return result(await scope.createBranch(db,ctx,await req()),201);
 const staff=p.match(/^\/api\/live\/cashiers\/(\d+)$/);
 if(staff&&method==='PUT')
  return result(await scope.updateCashier(db,ctx,Number(staff[1]),await req()));
 if(staff&&method==='DELETE')
  return result(await scope.deactivateCashier(db,ctx,Number(staff[1])));
 const branchPath=p.match(/^\/api\/live\/branches\/(\d+)$/);
 if(branchPath&&method==='PUT')
  return result(await scope.updateBranch(db,ctx,Number(branchPath[1]),await req()));
 if(branchPath&&method==='DELETE')
  return result(await scope.deactivateBranch(db,ctx,Number(branchPath[1])));
 const grantsPath=p.match(/^\/api\/live\/cashiers\/(\d+)\/permissions$/);
 if(method==='PUT'&&grantsPath){
  const data=await req();
  return result(await scope.setCashierPermissions(db,ctx,Number(grantsPath[1]),data.permissions));
 }
 if(method==='POST'&&p==='/api/live/quote'){
  scope.requirePaid(ctx);scope.requireCashier(ctx);
  return result(await sales.quote(db,ctx,await req()));
 }
 if(method==='POST'&&p==='/api/live/checkout'){
  scope.requirePaid(ctx);scope.requireCashier(ctx);
  return result(await sales.sale(db,{...ctx,username:user.username},await req()),201);
 }
 if(method==='POST'&&p==='/api/live/stock'){
  if(!ctx.admin)requirePermission(ctx,'inventory.view');
  const data=await req(),b=await scope.branch(db,ctx,data.receivingBranchId||ctx.branchId);
  if(!ctx.admin&&String(data.entryType||'DIRECT_REPLENISH').toUpperCase()==='INITIAL_STOCK')
   throw scope.fail('Only an Owner or Co-Owner can establish initial stock for a new branch.',403);
  return result(await direct.record(db,user,{...data,receivingBranchId:b.id}),201);
 }
 const product=p.match(/^\/api\/live\/products\/(\d+)$/);
 if(method==='POST'&&p==='/api/live/products')
  {const data=await req();return result(await catalog.saveProduct(db,context,data.branchId,0,data),201);}
 if(product&&method==='PUT'){
  const data=await req();
  return result(await catalog.saveProduct(db,context,data.branchId,Number(product[1]),data));
 }
 if(method==='POST'&&p==='/api/live/ingredients'){
  const data=await req();
  return result(await catalog.saveIngredient(db,context,data.branchId,0,data),201);
 }
 const ingredient=p.match(/^\/api\/live\/ingredients\/(\d+)$/);
 if(ingredient&&method==='PUT'){
  const data=await req();
  return result(await catalog.saveIngredient(db,context,data.branchId,Number(ingredient[1]),data));
 }
 const archiveProductPath=p.match(/^\/api\/live\/products\/(\d+)$/);
 if(archiveProductPath&&method==='DELETE')
  return result(await catalog.archiveProduct(db,ctx,branchId,Number(archiveProductPath[1])));
 const archiveIngredientPath=p.match(/^\/api\/live\/ingredients\/(\d+)$/);
 if(archiveIngredientPath&&method==='DELETE')
  return result(await catalog.archiveIngredient(db,ctx,branchId,Number(archiveIngredientPath[1])));
 if(method==='POST'&&p==='/api/live/promos/all-branches'){
  const data=await req();
  return result(await catalog.savePromoAllBranches(db,ctx,data),201);
 }
 const promoCopy=p.match(/^\/api\/live\/promos\/(\d+)\/copy$/);
 if(promoCopy&&method==='POST'){
  const data=await req();
  return result(await catalog.copyPromo(db,ctx,data.sourceBranchId,Number(promoCopy[1]),data.targetBranchId),201);
 }
 const promo=p.match(/^\/api\/live\/promos\/(\d+)$/);
 if(method==='POST'&&p==='/api/live/promos'){
  const data=await req();return result(await catalog.savePromo(db,ctx,data.branchId,0,data),201);
 }
 if(promo&&method==='PUT'){
  const data=await req();return result(await catalog.savePromo(db,ctx,data.branchId,Number(promo[1]),data));
 }
 if(promo&&method==='DELETE')
  return result(await catalog.archivePromo(db,ctx,branchId,Number(promo[1])));
 const pack=p.match(/^\/api\/live\/packages\/(\d+)$/);
 if(method==='POST'&&p==='/api/live/packages'){
  const data=await req();return result(await catalog.savePackage(db,ctx,data.branchId,0,data),201);
 }
 if(pack&&method==='PUT'){
  const data=await req();return result(await catalog.savePackage(db,ctx,data.branchId,Number(pack[1]),data));
 }
 if(pack&&method==='DELETE')
  return result(await catalog.archivePackage(db,ctx,branchId,Number(pack[1])));
 const packItems=p.match(/^\/api\/live\/packages\/(\d+)\/items$/);
 if(packItems&&method==='PUT'){
  const data=await req();
  return result(await catalog.saveComposition(db,ctx,data.branchId,Number(packItems[1]),data));
 }
 const recipe=p.match(/^\/api\/live\/recipes\/(\d+)$/);
 if(recipe&&method==='GET')return result(await catalog.recipe(db,context,branchId,Number(recipe[1])));
 if(recipe&&method==='PUT'){
  const data=await req();
  return result(await catalog.saveRecipe(db,context,data.branchId,Number(recipe[1]),data));
 }
 const receipt=p.match(/^\/api\/live\/transactions\/(BR-[A-F0-9]{18})(?:\/(void))?$/);
 if(receipt&&method==='GET'&&!receipt[2]){
  scope.requirePaid(ctx);requirePermission(ctx,'transactions.view');
  return result(await sales.detail(db,ctx,receipt[1],branchId));
 }
 if(receipt&&method==='POST'&&receipt[2]){
  scope.requirePaid(ctx);requirePermission(ctx,'transactions.view');
  return result(await sales.voidSale(db,ctx,receipt[1],await req()));
 }
 return result({error:'This live operation is not available in the isolated POS.',code:'SCOPED_OPERATION_UNAVAILABLE'},404);
}
module.exports={run};
