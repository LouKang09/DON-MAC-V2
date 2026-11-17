'use strict';
// Pro/Business insights for NEW workspaces only. All data comes exclusively from
// branch_live_* records scoped to the authenticated franchise workspace.
const scope=require('./franchise-live-scope');
const PRO=['pro-bought-together','pro-addon-conversion','pro-sales-growth',
 'pro-opportunity-hours','pro-product-pairings','pro-daily-insights','standout-insights'];
const BUSINESS=[...PRO,'biz-branch-health','biz-same-store','biz-product-comparison',
 'biz-cash-variance','biz-transaction-monitor','biz-stock-transfers'];
const own=(ctx)=>{if(!ctx.admin)throw scope.fail('Owner or Co-Owner access is required.',403);};
const n=x=>Number.isFinite(Number(x))?Number(x):0;
const money=x=>Math.round((Number(x)+Number.EPSILON)*100)/100;
const isoDays=days=>new Date(Date.now()-days*86400000).toISOString();
const dayPHT=stamp=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',
 year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(stamp));
const hourPHT=stamp=>Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Manila',
 hour:'2-digit',hourCycle:'h23'}).format(new Date(stamp)));
const pct=(current,prior)=>prior>0?Math.round((current-prior)/prior*1000)/10:null;
const KEY='dashboard_widgets_v1573_';
async function settings(db,ctx,requestedPlan,body){
 own(ctx);
 const plan=String(ctx.subscriptionPlan||'PRO').toUpperCase();
 if(requestedPlan&&requestedPlan!==plan)throw scope.fail('Plan has changed. Refresh your dashboard.',409);
 const allowed=new Set(plan==='BUSINESS'?BUSINESS:PRO);
 const key=KEY+ctx.workspaceId+'_'+plan;
 if(body!==undefined){
  const {order,hidden}=body||{};
  if(!Array.isArray(order)||!Array.isArray(hidden)||
   order.length>allowed.size||hidden.length>allowed.size||
   order.some(x=>!allowed.has(x))||hidden.some(x=>!allowed.has(x))||
   new Set(order).size!==order.length||new Set(hidden).size!==hidden.length)
   throw scope.fail('Invalid widget selection.',400);
  await db.query('INSERT INTO app_settings(setting_key,setting_value,updated_at) '+
   'VALUES($1,$2,$3) ON CONFLICT(setting_key) DO UPDATE SET '+
   'setting_value=excluded.setting_value,updated_at=excluded.updated_at',
   [key,JSON.stringify({order,hidden}),new Date().toISOString()]);
  return{order,hidden};
 }
 const stored=(await db.query('SELECT setting_value FROM app_settings WHERE setting_key=$1',[key])).rows[0];
 if(!stored)return{order:[],hidden:[]};
 try{const parsed=JSON.parse(stored.setting_value);
  return{order:Array.isArray(parsed.order)?parsed.order.filter(x=>allowed.has(x)):[],
   hidden:Array.isArray(parsed.hidden)?parsed.hidden.filter(x=>allowed.has(x)):[]};
 }catch(_){return{order:[],hidden:[]};}
}
async function insights(db,ctx,selectedBranchId){
 own(ctx);
 scope.requirePaid(ctx);
 const branches=(await scope.branches(db,ctx)).filter(x=>x.active);
 const branchIds=selectedBranchId?[ (await scope.branch(db,ctx,selectedBranchId)).id]:
  branches.map(x=>x.id);
 if(!branchIds.length)throw scope.fail('No active branches in this workspace.',403);
 const params=[ctx.workspaceId,...branchIds],marks=branchIds.map((_,i)=>'$'+(i+2)).join(',');
 const since=isoDays(60),where='s.workspace_id=$1 AND s.branch_id IN ('+marks+')';
 const [sR,iR]=await Promise.all([
  db.query('SELECT s.id,s.branch_id,s.status,s.sold_at,s.actual,s.discount_amount '+
   'FROM branch_live_sales s WHERE '+where+' AND s.sold_at >= $'+(params.length+1)+
   ' ORDER BY s.sold_at DESC,s.id DESC LIMIT 5001',[...params,since]),
  db.query('SELECT s.id AS sale_id,s.branch_id,s.sold_at,i.name_snapshot,i.kind,'+
   'i.quantity,i.line_total FROM branch_live_sale_items i JOIN branch_live_sales s '+
   'ON s.id=i.sale_id AND s.workspace_id=i.workspace_id AND s.branch_id=i.branch_id '+
   'WHERE '+where+' AND s.status=$'+(params.length+1)+
   ' AND s.sold_at >= $'+(params.length+2)+
   ' ORDER BY s.sold_at DESC,s.id DESC LIMIT 7501',[...params,'Sold',isoDays(30)])
 ]);
 const partial=sR.rows.length>5000||iR.rows.length>7500;
 const sales=sR.rows.slice(0,5000),items=iR.rows.slice(0,7500);
 const today=dayPHT(new Date()),yesterday=dayPHT(new Date(Date.now()-86400000));
 const last7=Date.now()-7*86400000,prior7=Date.now()-14*86400000,last30=Date.now()-30*86400000;
 const before30=Date.now()-60*86400000;
 const sold=sales.filter(s=>s.status==='Sold'),salesById=new Map(sold.map(x=>[x.id,x]));
 const current7=sold.filter(x=>Date.parse(x.sold_at)>=last7).reduce((v,x)=>v+n(x.actual),0);
 const previous7=sold.filter(x=>Date.parse(x.sold_at)<last7&&Date.parse(x.sold_at)>=prior7).reduce((v,x)=>v+n(x.actual),0);
 const daily={actual:0,previousActual:0,orders:0,previousOrders:0};
 for(const x of sold){
  const d=dayPHT(x.sold_at);
  if(d===today){daily.actual+=n(x.actual);daily.orders++;}
  if(d===yesterday){daily.previousActual+=n(x.actual);daily.previousOrders++;}
 }
 const recent=sold.filter(x=>Date.parse(x.sold_at)>=last30);
 const buckets=new Map();
 for(let h=9;h<=18;h++)buckets.set(h,{hour:h,orders:0});
 for(const x of recent){
  const h=hourPHT(x.sold_at);
  if(buckets.has(h))buckets.get(h).orders++;
 }
 const baskets=new Map();
 for(const x of items){
  if(!salesById.has(x.sale_id)||Date.parse(x.sold_at)<last30)continue;
  const arr=baskets.get(x.sale_id)||[];
  arr.push(x);baskets.set(x.sale_id,arr);
 }
 const paired=new Map(),branchesById=new Map(branches.map(b=>[b.id,b]));
 const products=[];
 let addOnOrders=0,addOnSales=0;
 for(const contents of baskets.values()){
  if(contents.some(x=>x.kind==='addon')){
   addOnOrders++;addOnSales+=contents.filter(x=>x.kind==='addon').reduce((v,x)=>v+n(x.line_total),0);
  }
  const distinct=[...new Set(contents.filter(x=>x.kind==='product'||x.kind==='package').map(x=>x.name_snapshot))].sort();
  for(let i=0;i<distinct.length;i++)
   for(let j=i+1;j<distinct.length;j++){
    const key=distinct[i]+'\u0000'+distinct[j];
    paired.set(key,(paired.get(key)||0)+1);
   }
  for(const x of contents){
   if(x.kind!=='product'&&x.kind!=='package')continue;
   products.push({name:x.name_snapshot,branch:branchesById.get(Number(x.branch_id))?.name||'Assigned branch',
    qty:n(x.quantity)});
  }
 }
 const pairs=[...paired].map(([key,orders])=>({items:key.split('\u0000'),orders}))
  .sort((a,b)=>b.orders-a.orders).slice(0,8);
 const counts={};
 for(const b of branches)counts[b.id]={id:b.id,name:b.name,current:0,previous:0,orders:0};
 for(const x of sold){
  const b=counts[Number(x.branch_id)];
  if(!b)continue;
  const ts=Date.parse(x.sold_at);
  if(ts>=last30){b.current+=n(x.actual);b.orders++;}
  else if(ts>=before30)b.previous+=n(x.actual);
 }
 const branchMetrics=Object.values(counts).map(x=>({...x,current:money(x.current),
  previous:money(x.previous),comparable:x.previous>0,growthPercent:pct(x.current,x.previous)}));
 const productTotals=new Map();
 for(const x of products){
  const key=x.branch+'\u0000'+x.name,old=productTotals.get(key)||{name:x.name,branch:x.branch,qty:0};
  old.qty+=x.qty;productTotals.set(key,old);
 }
 const pro={
  pairs,addOnOrders,addOnSales:money(addOnSales),ordersAnalyzed:baskets.size,
  addonRate:baskets.size?Math.round(addOnOrders/baskets.size*1000)/10:null,
  salesWindow:{current:money(current7),previous:money(previous7),growthPercent:pct(current7,previous7)},
  hours:[...buckets.values()],today:{...daily,actual:money(daily.actual),previousActual:money(daily.previousActual)}
 };
 const business={branches:branchMetrics,products:[...productTotals.values()].sort((a,b)=>b.qty-a.qty).slice(0,12),
  cashVariance:{reason:'Cash drawer variance requires a recorded physical cash count.'},
  reviewSignals:{voided:sales.filter(x=>x.status!=='Sold'&&Date.parse(x.sold_at)>=last30).length,
   discounted:recent.filter(x=>n(x.discount_amount)>0).length},transfers:[]};
 return{plan:String(ctx.subscriptionPlan||'PRO').toUpperCase(),partial,pro,business,
  source:'Authenticated branch_live_sales and branch_live_sale_items only',
  branchIds,branches:branches.map(x=>({id:x.id,name:x.name}))};
}
module.exports={insights,settings};
