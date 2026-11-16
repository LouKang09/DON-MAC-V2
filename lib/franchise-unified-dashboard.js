'use strict';
// Original dashboard layout backed exclusively by the authenticated franchise
// workspace's branch_live_* tables. No legacy products/sales/ingredients joins.
const scope=require('./franchise-live-scope');
const read=require('./branch-catalog-read');
const money=x=>Math.round(Number(x||0)*100)/100;
const number=x=>Number(x||0);
const manilaDate=()=>new Date(Date.now()+8*3600000).toISOString().slice(0,10);
const dateAdd=(day,n)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const isoStart=day=>new Date(day+'T00:00:00+08:00').toISOString();
const validDate=day=>/^\d{4}-\d{2}-\d{2}$/.test(day)&&
 !Number.isNaN(Date.parse(day+'T00:00:00Z'))&&
 new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day;
const currentHour=iso=>new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Manila',hour:'2-digit',hourCycle:'h23'}).format(new Date(iso));
const dateAtManila=iso=>new Date(new Date(iso).getTime()+8*3600000).toISOString().slice(0,10);

async function dashboard(db,ctx,query){
 scope.requireAdmin(ctx);
 const branches=await scope.branches(db,ctx);
 let selected=null;
 if(query.get('branchId')){
  selected=(await scope.branch(db,ctx,query.get('branchId'))).id;
 }
 const ids=selected?[selected]:branches.map(x=>Number(x.id));
 if(!ids.length)throw scope.fail('No active branches are assigned to this franchise.',403);
 const today=manilaDate(),monthStart=today.slice(0,7)+'-01';
 const nextMonth=dateAdd(new Date(Date.UTC(Number(today.slice(0,4)),Number(today.slice(5,7)),1)).toISOString().slice(0,10),0);
 const rawView=query.get('view'),view=['hourly','10days','custom'].includes(rawView)?rawView:'hourly';
 const from=view==='hourly'?today:view==='10days'?dateAdd(today,-9):String(query.get('from')||'');
 const to=view==='custom'?String(query.get('to')||''):today;
 if(!validDate(from)||!validDate(to)||from>to)throw scope.fail('Choose a valid custom date range.',400);
 const days=Math.round((Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/86400000)+1;
 if(days>366)throw scope.fail('Select 366 days or fewer.',400);
 const grain=days===1?'hourly':'daily';
 const args=[ctx.workspaceId,...ids];
 const branchIn=ids.map((_,i)=>'$'+(i+2)).join(',');
 const saleWhere='s.workspace_id=$1 AND s.branch_id IN ('+branchIn+')';
 const stockWhere='i.workspace_id=$1 AND i.branch_id IN ('+branchIn+')';
 const dateArgs=(start,end)=>[...args,'Sold',isoStart(start),isoStart(end)];
 const statusSlot=args.length+1,startSlot=args.length+2,endSlot=args.length+3;
 const saleFilter=' WHERE '+saleWhere+' AND s.status=$'+statusSlot+
   ' AND s.sold_at >= $'+startSlot+' AND s.sold_at < $'+endSlot;
 const totals=async(start,end)=>{
  const result=await db.query('SELECT COUNT(*) AS count,COALESCE(SUM(s.gross),0) AS gross,'+
   'COALESCE(SUM(s.actual),0) AS actual,COALESCE(SUM(s.discount_amount),0) AS discount '+
   'FROM branch_live_sales s'+saleFilter,dateArgs(start,end));
  const x=result.rows[0]||{};
  return{count:number(x.count),gross:money(x.gross),actual:money(x.actual),discount:money(x.discount)};
 };
 const [todayTotal,monthTotal,rangeTotal,inventory,trendRows,expenseRows,byCategory,byProduct,recent,categoryTrendRows]=await Promise.all([
  totals(today,dateAdd(today,1)),
  totals(monthStart,nextMonth),
  totals(from,dateAdd(to,1)),
  db.query('SELECT i.id,i.display_name AS name,i.stock_qty AS stock,i.low_stock_threshold,'+
    'i.uom,i.branch_id FROM branch_ingredients i WHERE '+stockWhere+' AND i.active=$'+(args.length+1),
    [...args,true]),
  db.query('SELECT s.sold_at,s.actual,s.gross FROM branch_live_sales s'+saleFilter,dateArgs(from,dateAdd(to,1))),
  db.query('SELECT COALESCE(SUM(e.amount),0) AS total FROM branch_live_expenses e '+
    'WHERE e.workspace_id=$1 AND e.branch_id IN ('+branchIn+') '+
    'AND e.incurred_at >= $'+(args.length+1)+' AND e.incurred_at < $'+(args.length+2),
    [...args,isoStart(from),isoStart(dateAdd(to,1))]),
  db.query('SELECT i.kind,COALESCE(p.category,$'+(args.length+4)+') AS category,'+
    'COALESCE(SUM(i.line_total),0) AS gross FROM branch_live_sale_items i '+
    'JOIN branch_live_sales s ON s.id=i.sale_id AND s.workspace_id=i.workspace_id AND s.branch_id=i.branch_id '+
    'LEFT JOIN branch_products p ON p.id=i.item_id AND p.workspace_id=i.workspace_id '+
    'AND p.branch_id=i.branch_id AND i.kind=$'+(args.length+5)+
    saleFilter+' GROUP BY i.kind,p.category',
    [...dateArgs(monthStart,nextMonth),'Other','product']),
  db.query('SELECT i.name_snapshot AS name,COALESCE(SUM(i.quantity),0) AS qty '+
    'FROM branch_live_sale_items i JOIN branch_live_sales s '+
    'ON s.id=i.sale_id AND s.workspace_id=i.workspace_id AND s.branch_id=i.branch_id'+
    saleFilter+' GROUP BY i.name_snapshot ORDER BY qty DESC LIMIT 8',
    dateArgs(monthStart,nextMonth)),
  db.query('SELECT s.reference,s.sold_at,s.cashier_name_snapshot,s.payment_mode,'+
    's.actual,s.order_type,s.customer_name,s.table_label FROM branch_live_sales s '+
    'WHERE '+saleWhere+' AND s.status=$'+(args.length+1)+
    ' ORDER BY s.sold_at DESC,s.id DESC LIMIT 8',[...args,'Sold']),
  // Real category net sales, strictly filtered by workspace, branch and period.
  // No legacy/shared tables or guessed sales are used for the chart.
  db.query('SELECT i.kind,COALESCE(p.category,'+String.fromCharCode(36)+(args.length+4)+') AS category,'+
    's.sold_at,COALESCE(SUM(CASE WHEN s.gross>0 THEN ' +
    'i.line_total*s.actual/s.gross ELSE 0 END),0) AS net '+
    'FROM branch_live_sale_items i JOIN branch_live_sales s ON s.id=i.sale_id '+
    'AND s.workspace_id=i.workspace_id AND s.branch_id=i.branch_id '+
    'LEFT JOIN branch_products p ON p.id=i.item_id AND p.workspace_id=i.workspace_id '+
    'AND p.branch_id=i.branch_id AND i.kind='+String.fromCharCode(36)+(args.length+5)+
    saleFilter+' GROUP BY i.kind,p.category,s.sold_at',
    [...dateArgs(from,dateAdd(to,1)),'Other','product'])
 ]);
 const trend=[];
 if(grain==='hourly'){
  for(let h=0;h<24;h++)trend.push({label:((h+11)%12+1)+(h<12?' AM':' PM'),actual:0,transactions:0});
 }else{
  for(let n=0;n<days;n++)trend.push({label:dateAdd(from,n).slice(5),actual:0,transactions:0});
 }
 for(const sale of trendRows.rows){
  const index=grain==='hourly'?Number(currentHour(sale.sold_at)):
   Math.round((Date.parse(dateAtManila(sale.sold_at))-Date.parse(from))/86400000);
  if(Number.isInteger(index)&&index>=0&&index<trend.length){
   trend[index].actual=money(trend[index].actual+number(sale.actual));
   trend[index].transactions++;
  }
 }
 const seriesMap=new Map(['Coffee','Non Coffee','Food'].map(category=>[category,Array(trend.length).fill(0)]));
 for(const line of categoryTrendRows.rows){
  const category=line.kind==='addon'?'Add-ons':line.kind==='package'?'Packages':line.category||'Other';
  const index=grain==='hourly'?Number(currentHour(line.sold_at)):
   Math.round((Date.parse(dateAtManila(line.sold_at))-Date.parse(from))/86400000);
  if(!Number.isInteger(index)||index<0||index>=trend.length)continue;
  if(!seriesMap.has(category))seriesMap.set(category,Array(trend.length).fill(0));
  const values=seriesMap.get(category);
  values[index]=money(values[index]+number(line.net));
 }
 const categoryTrends=[...seriesMap].map(([name,values])=>({name,values}));
 const low=inventory.rows.map(x=>({name:x.name,uom:x.uom,stock:number(x.stock),
   lowStockThreshold:number(x.low_stock_threshold),branchId:Number(x.branch_id)}))
   .filter(x=>x.stock<=x.lowStockThreshold).sort((a,b)=>a.stock-b.stock);
 const categories=new Map();
 for(const c of byCategory.rows){
  const category=c.kind==='addon'?'Add-ons':c.kind==='package'?'Packages':c.category||'Other';
  categories.set(category,money((categories.get(category)||0)+number(c.gross)));
 }
 const topProducts=byProduct.rows.map(x=>({name:x.name,qty:number(x.qty),actual:null}));
 return{today,branchId:selected,view,grain,from,to,days,trend,
  rangeActual:rangeTotal.actual,rangeGross:rangeTotal.gross,
  rangeTransactions:rangeTotal.count,rangeDiscount:rangeTotal.discount,
  rangeExpenses:money(expenseRows.rows[0]?.total),
  metrics:{todayActual:todayTotal.actual,todayGross:todayTotal.gross,
    todayTransactions:todayTotal.count,monthActual:monthTotal.actual,
    monthGross:monthTotal.gross,monthTransactions:monthTotal.count,
    lowStockCount:low.length,inventoryCount:inventory.rows.length},
  lowStock:low.slice(0,10),
  categorySales:[...categories].map(([name,amount])=>({name,amount})),
  // Net category series is calculated only from this workspace's real sale items.
  categoryTrends,topProducts,performanceProducts:topProducts,
  recentTransactions:recent.rows.map(x=>({reference:x.reference,soldAt:x.sold_at,
   cashier:x.cashier_name_snapshot,paymentMode:x.payment_mode,amount:number(x.actual),
   orderType:x.order_type,customerName:x.customer_name,tableLabel:x.table_label,items:[]}))};
}
module.exports={dashboard};
