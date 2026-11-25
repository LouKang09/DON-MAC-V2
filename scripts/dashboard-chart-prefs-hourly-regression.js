'use strict';
// npm-free regression: node scripts/dashboard-chart-prefs-hourly-regression.js
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const prefs=require('../lib/dashboard-chart-preferences');
const branchSupport=require('../lib/branch-support');

async function run(){
 const stored=new Map();
 const db={query:async(sql,args)=>{
  if(sql.startsWith('SELECT setting_value FROM app_settings')){
   const found=stored.get(args[0]);
   return {rows:found?[{setting_value:found}]:[]};
  }
  if(sql.startsWith('INSERT INTO app_settings')){
   stored.set(args[0],args[1]);return{rows:[]};
  }
  throw Error('Unexpected SQL '+sql.slice(0,90));
 }};
 const owner={workspaceId:12,userId:42,admin:true};
 assert.deepEqual(await prefs.settings(db,owner),{defaultType:'line',overrides:{}});
 assert.deepEqual(await prefs.settings(db,owner,{defaultType:'pie',overrides:{
  deposited:'pie',revenue:'line',expenses:'bar'}}),{
   defaultType:'pie',overrides:{deposited:'pie',revenue:'line',expenses:'bar'}
  });
 assert.deepEqual(await prefs.settings(db,owner),{
  defaultType:'pie',overrides:{deposited:'pie',revenue:'line',expenses:'bar'}
 });
 assert.deepEqual(await prefs.settings(db,{workspaceId:13,userId:42,admin:true}),{
  defaultType:'line',overrides:{}});
 assert.deepEqual(await prefs.settings(db,{workspaceId:12,userId:43,admin:true}),{
  defaultType:'line',overrides:{}});
 await assert.rejects(()=>prefs.settings(db,{...owner,admin:false}));
 await assert.rejects(()=>prefs.settings(db,owner,{defaultType:'unknown'}));
 await assert.rejects(()=>prefs.settings(db,owner,{defaultType:'line',overrides:{not_a_metric:'pie'}}));
 await assert.rejects(()=>prefs.settings(db,owner,{defaultType:'line',overrides:{revenue:'javascript:'}}));

 const sales=[
  {sold_at:'2026-11-23T01:15:00.000Z',actual:100,gross:120,discount_amount:20,branch:4,workspace:12},
  {sold_at:'2026-11-24T01:40:00.000Z',actual:200,gross:230,discount_amount:30,branch:4,workspace:12},
  {sold_at:'2026-11-24T02:30:00.000Z',actual:50,gross:50,discount_amount:0,branch:4,workspace:12},
  {sold_at:'2026-11-24T01:30:00.000Z',actual:700,gross:700,discount_amount:0,branch:5,workspace:12},
  {sold_at:'2026-11-24T01:30:00.000Z',actual:7000,gross:7000,discount_amount:0,branch:6,workspace:13}
 ];
 const sqlChecks=[];
 const data={query:async(sql,args)=>{
  sqlChecks.push({sql,args});
  const [status,from,to,scope]=args;
  const r=sales.filter(x=>status==='Sold'&&x.sold_at>=from&&x.sold_at<to&&
   (sql.includes('s.branch_id=$4')?x.branch===scope:x.workspace===scope));
  return{rows:r};
 }};
 const period={view:'custom',from:'2026-11-23',to:'2026-11-24',aggregate:'hourly'};
 const hourly=await branchSupport.buildTrend(data,period,4,12);
 assert.equal(hourly.grain,'hourly');
 assert.equal(hourly.trend.length,24);
 assert.equal(hourly.trend[9].actual,300);
 assert.equal(hourly.trend[9].gross,350);
 assert.equal(hourly.trend[9].transactions,2);
 assert.equal(hourly.trend[10].actual,50);
 assert.equal(hourly.rangeActual,350);
 const all=await branchSupport.buildTrend(data,period,null,12);
 assert.equal(all.trend[9].actual,1000);
 assert.equal(all.trend[9].transactions,3);
 const daily=await branchSupport.buildTrend(data,{view:'custom',from:period.from,to:period.to},4,12);
 assert.equal(daily.grain,'daily');
 assert.equal(daily.trend.length,2);
 assert.equal(daily.trend[0].actual,100);
 assert.equal(daily.trend[1].actual,250);
 assert(sqlChecks.some(x=>x.sql.includes('chat_workspace_branches')&&x.args[3]===12));

 const ctx={window:{}};
 (new Function('window',read('public/dashboard-kpi-chart-renderer-v20261125.js')))(ctx.window);
 const renderer=ctx.window.donmacKpiChartRenderer;
 assert(renderer,'Missing renderer');
 const partial=renderer.linePath([0,15,30,5],i=>i*40,n=>140-n);
 assert.match(partial,/\bC\b/);
 assert.doesNotMatch(partial,/NaN|undefined/);
 const datasets=[
  {name:'Main Branch',data:{...hourly,rangeRevenueNet:350}},
  {name:'North Branch',data:{
   ...hourly,rangeRevenueNet:640,
   trend:hourly.trend.map((x,i)=>({...x,gross:i===9?640:0}))
  }}
 ];
 const chart=renderer.series(datasets,'revenue','hourly');
 assert.equal(chart.length,2);
 assert.equal(chart[0].points[9].value,350);
 assert.equal(chart[1].points[9].value,640);
 const pie=renderer.pie(datasets,'revenue',hourly,'hourly');
 assert.match(pie,/Main Branch/);
 assert.match(pie,/North Branch/);
 assert.match(pie,/dm-kpi-pie-slice/);
 assert.match(pie,/%/);
 assert.match(pie,/data-kpi-slice/);
 const expenses=renderer.pie([{name:'Main Branch',data:hourly}],
  'expenses',{rangeExpenseCategories:{rent:2000,stocks:150,salary:500,transportation:50}},'daily');
 assert.match(expenses,/Rent/);
 assert.match(expenses,/Salary/);
 assert.match(expenses,/74\.1%/);
 assert.match(expenses,/1\.9%/);
 const html=read('public/index.html'),
  drill=read('public/dashboard-kpi-drilldown-v20261118.js'),
  legacy=read('server.js'),live=read('lib/franchise-live-router.js'),
  adapter=read('public/franchise-unified-adapter.js'),
  unified=read('lib/franchise-unified-dashboard.js');
 assert.match(html,/id="dmChartPreferenceTarget"/);
 assert.match(html,/id="dmChartPreferenceOverride"/);
 assert.match(html,/id="dmChartPreferenceSave"/);
 assert.match(drill,/value="pie"/);
 assert.match(drill,/aggregate:'hourly'/);
 assert.match(drill,/chartTypeFor\(key\)/);
 assert.match(drill,/renderer\.draw\(plot,\{datasets,key,interval:mode,type:type\.value,main\}\)/);
 assert.match(legacy,/api\/dashboard\/chart-preferences/);
 assert.match(live,/api\/live\/dashboard\/chart-preferences/);
 assert.match(adapter,/api\/live\/dashboard\/chart-preferences/);
 assert.match(unified,/query\.get\('aggregate'\)==='hourly'/);
 console.log('PASS saved per-owner chart defaults, tenant scoping, multi-day 24-hour aggregation, branch series, smooth line and pie percentages');
}
run().catch(err=>{console.error(err);process.exitCode=1;});
