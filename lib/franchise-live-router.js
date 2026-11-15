'use strict';
const scope=require('./franchise-live-scope');
const catalog=require('./franchise-live-catalog');
const sales=require('./franchise-live-sales');
const expenses=require('./franchise-live-expenses');
const direct=require('./branch-direct-stock');
const read=require('./branch-catalog-read');
const id=scope.goodId;
const cashierAccess=require('./cashier-access');
const branchPlans=require('./franchise-branch-plans');
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
 if(method==='GET'&&p==='/api/live/catalog')
  return result(await catalog.catalog(db,context,branchId));
 if(method==='GET'&&p==='/api/live/manage')
  return result(await catalog.manage(db,context,{branchId}));
 if(method==='GET'&&p==='/api/live/inventory')
  return result({branchId,items:await read.inventory(db,context.workspaceId,
   (await scope.branch(db,context,branchId)).id,true)});
 if(method==='GET'&&p==='/api/live/transactions'){
  scope.requirePaid(ctx);requirePermission(ctx,'transactions.view');
  return result(await sales.transactions(db,ctx,{branchId,page:query.get('page')}));
 }
 if(method==='GET'&&p==='/api/live/report'){
  scope.requirePaid(ctx);scope.requireAdmin(ctx);
  const report=await sales.report(db,ctx,{branchId,range:query.get('range')});
  const expense=await expenses.summary(db,context,branchId,report.since);
  return result({...report,expenses:expense.total,expensesCount:expense.count,
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
  scope.requireAdmin(context);
  const data=await req(),b=await scope.branch(db,context,data.receivingBranchId||context.branchId);
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
  scope.requirePaid(ctx);scope.requireAdmin(ctx);
  return result(await sales.voidSale(db,ctx,receipt[1],await req()));
 }
 return result({error:'This live operation is not available in the isolated POS.',code:'SCOPED_OPERATION_UNAVAILABLE'},404);
}
module.exports={run};
