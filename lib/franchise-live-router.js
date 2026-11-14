'use strict';
const scope=require('./franchise-live-scope');
const catalog=require('./franchise-live-catalog');
const sales=require('./franchise-live-sales');
const expenses=require('./franchise-live-expenses');
const direct=require('./branch-direct-stock');
const read=require('./branch-catalog-read');
const id=scope.goodId;
function result(data,status=200){return{status,data};}
async function run(db,context,user,method,url,body){
 const p=url.pathname,query=url.searchParams;
 const req=async()=>body();
 const branchId=id(query.get('branchId'))||context.branchId;
 if(method==='GET'&&p==='/api/live/status'){
  const [branches,staff]=await Promise.all([scope.branches(db,context),
    context.admin?scope.cashiers(db,context):Promise.resolve([])]);
  return result({ok:true,liveMode:true,productionIsolated:true,workspaceId:context.workspaceId,
   branchId:context.branchId,branchName:context.branchName,
   role:context.role,username:user.username,plan:context.subscriptionPlan,
   branches,cashiers:staff,notice:'Production transactions and inventory are fully scoped to your franchise branch.'});
 }
 if(method==='GET'&&p==='/api/live/catalog')
  return result(await catalog.catalog(db,context,branchId));
 if(method==='GET'&&p==='/api/live/manage')
  return result(await catalog.manage(db,context,{branchId}));
 if(method==='GET'&&p==='/api/live/inventory')
  return result({branchId,items:await read.inventory(db,context.workspaceId,
   (await scope.branch(db,context,branchId)).id,true)});
 if(method==='GET'&&p==='/api/live/transactions')
  return result(await sales.transactions(db,context,{branchId,page:query.get('page')}));
 if(method==='GET'&&p==='/api/live/report'){
  const report=await sales.report(db,context,{branchId,range:query.get('range')});
  const expense=await expenses.summary(db,context,branchId,report.since);
  return result({...report,expenses:expense.total,expensesCount:expense.count,
   netAfterExpenses:report.actual-expense.total});
 }
 if(method==='GET'&&p==='/api/live/expenses')
  return result(await expenses.list(db,context,branchId));
 if(method==='POST'&&p==='/api/live/expenses')
  return result(await expenses.add(db,context,await req()),201);
 if(method==='GET'&&p==='/api/live/cashiers')
  return result({cashiers:await scope.cashiers(db,context)});
 if(method==='POST'&&p==='/api/live/cashiers')
  return result(await scope.createCashier(db,context,await req()),201);
 if(method==='POST'&&p==='/api/live/quote')
  return result(await sales.quote(db,context,await req()));
 if(method==='POST'&&p==='/api/live/checkout')
  return result(await sales.sale(db,{...context,username:user.username},await req()),201);
 if(method==='POST'&&p==='/api/live/stock'){
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
 if(receipt&&method==='GET'&&!receipt[2])return result(await sales.detail(db,context,receipt[1]));
 if(receipt&&method==='POST'&&receipt[2])
  return result(await sales.voidSale(db,context,receipt[1],await req()));
 return result({error:'This live operation is not available in the isolated POS.',code:'SCOPED_OPERATION_UNAVAILABLE'},404);
}
module.exports={run};
