'use strict';
// Real Chrome regression: original Main POS visuals are identical for existing
// and NEW franchise logins, and an account switch never reuses another tenant's
// dashboard/finance DOM. No production cookies or customer records are used.
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const puppeteer=require('puppeteer-core');
const root=path.resolve(__dirname,'../public');
const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8',
 '.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png',
 '.jpg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2'};
const branch={id:601,name:'Independent Branch',active:true};
const oldBranch={id:1,name:'Marlou Main Branch',active:true};
const metrics=(amount,orders)=>({todayActual:0,todayGross:0,todayTransactions:0,
 monthActual:amount,monthGross:amount,monthTransactions:orders,lowStockCount:0,inventoryCount:5});
const dash=(amount,orders)=>({today,from:today,to:today,grain:'hourly',view:'hourly',branchId:null,
 rangeActual:0,rangeGross:0,rangeTransactions:0,rangeDiscount:0,rangeExpenses:0,
 metrics:metrics(amount,orders),categorySales:[],categoryTrends:[
 {name:'Coffee',values:Array(24).fill(0)},{name:'Non Coffee',values:Array(24).fill(0)},
 {name:'Food',values:Array(24).fill(0)}],
 trend:Array.from({length:24},(_,i)=>({label:String(i),actual:0,transactions:0})),
 lowStock:[],topProducts:[],performanceProducts:[],recentTransactions:[]});
const oldData=dash(12295,20),newData=dash(0,0);
function send(res,status,data,headers={}){
 const raw=JSON.stringify(data);
 res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store',...headers});
 res.end(raw);
}
let requests=[];
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost'),pathname=url.pathname;
 const cookie=req.headers.cookie||'';
 let user=cookie.includes('demo_session=test1')?'test1':
  cookie.includes('demo_session=marlou09')?'marlou09':null;
 const method=req.method||'GET';
 if(pathname.startsWith('/api/')){
  requests.push({user,path:pathname,method});
  if(pathname==='/api/auth/login'&&method==='POST'){
   let body='';for await(const chunk of req)body+=chunk;
   const requested=JSON.parse(body||'{}').username;
   if(!['marlou09','test1'].includes(requested))return send(res,401,{error:'Invalid account'});
   const isNew=requested==='test1';
   return send(res,200,{user:{id:isNew?71:1,username:requested,role:'Admin',
    branchId:null,liveMode:isNew,isOwner:true,accessPermissions:[]}},{
      'Set-Cookie':'demo_session='+requested+'; Path=/; SameSite=Lax; HttpOnly'});
  }
  if(pathname==='/api/auth/logout'&&method==='POST')
   return send(res,200,{ok:true},{'Set-Cookie':'demo_session=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly'});
  if(pathname==='/api/status')return send(res,200,{ready:true,setupRequired:false,engine:'postgres',version:'test'});
  if(pathname==='/api/auth/me'){
   if(!user)return send(res,401,{error:'Not signed in.'});
   const isNew=user==='test1';
   return send(res,200,{user:{id:isNew?71:1,username:user,role:'Admin',
    branchId:null,liveMode:isNew,isOwner:true,accessPermissions:[],photoData:null}});
  }
  if(!user)return send(res,401,{error:'Not signed in.'});
  const isNew=user==='test1',b=isNew?branch:oldBranch;
  if(isNew&&!pathname.startsWith('/api/live/'))
   return send(res,409,{error:'NEW franchise attempted an unsafe legacy API: '+pathname});
  if(pathname==='/api/live/status')return send(res,200,{liveMode:true,workspaceId:707,branchId:601,
   role:'Admin',username:user,plan:'PRO',subscriptionStatus:'PAID',subscriptionActive:true,
   branches:[branch],cashiers:[],permissions:[],entitlements:{plan:'PRO',totalBranches:1,
    activeBranches:1,mayAdd:true,maxBranches:3,extraBranches:0,extraBranchRate:799,nextRenewalAmount:1499}});
  if(['/api/live/catalog','/api/catalog'].includes(pathname))return send(res,200,{
   products:[],packages:[],addOns:[],promos:[],categories:[
    {name:'Coffee',active:true,builtin:true,productIds:[]},
    {name:'Non Coffee',active:true,builtin:true,productIds:[]},
    {name:'Food',active:true,builtin:true,productIds:[]}]
  });
  if(['/api/live/dashboard','/api/dashboard'].includes(pathname))
   return send(res,200,isNew?newData:oldData);
  if(pathname==='/api/branches')return send(res,200,{branches:[oldBranch],
   branchPricing:{plan:'BUSINESS',extraBranches:0,nextRenewalAmount:2599,mayAdd:true,
   totalBranches:1,activeBranches:1,maxBranches:100}});
  if(pathname==='/api/account/subscription')return send(res,200,{plan:'BUSINESS',status:'PAID',
   branchPricing:{plan:'BUSINESS',extraBranches:0,nextRenewalAmount:2599,mayAdd:true,
    totalBranches:1,activeBranches:1,maxBranches:100,branches:[oldBranch]}});
  if(pathname==='/api/live/inventory')return send(res,200,{branchId:601,items:[]});
  if(pathname==='/api/live/cashiers')return send(res,200,{cashiers:[]});
  if(pathname==='/api/live/finance/transactions')
   return send(res,200,{total:0,salesTotal:0,page:1,rows:[],branches:[branch]});
  if(pathname==='/api/live/finance/expenses')
   return send(res,200,{total:0,grandTotal:0,page:1,rows:[],branches:[branch]});
  if(pathname==='/api/finance/transactions')
   return send(res,200,{total:20,salesTotal:12295,page:1,rows:[{
    date:new Date().toISOString(),reference:'MARLOU-ONLY-RECEIPT',branch:oldBranch.name,
    cashier:'Marlou Cashier',payment:'Cash',orderType:'Dine In',status:'Sold',amount:12295}],branches:[oldBranch]});
  if(pathname==='/api/finance/expenses')
   return send(res,200,{total:0,grandTotal:0,page:1,rows:[],branches:[oldBranch]});
  if(pathname==='/api/pos/today-count')return send(res,200,{count:0});
  return send(res,200,{branches:[b],products:[],users:[],rows:[],items:[],logs:[]});
 }
 if(method!=='GET'){res.writeHead(405);res.end();return;}
 const file=path.resolve(root,pathname==='/'?'index.html':pathname.slice(1));
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){
  res.writeHead(404);res.end('Missing static asset');return;
 }
 res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream',
  'Cache-Control':'no-store'});
 fs.createReadStream(file).pipe(res);
});
const listen=()=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port)));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function display(page,mode){
 await page.waitForFunction((expected)=>{
  const app=document.getElementById('app');
  return app&&!app.classList.contains('hidden')&&
   document.getElementById('topbarUsername')?.textContent?.toLowerCase()===expected;
 },{timeout:25000},mode);
 await page.waitForFunction(()=>document.querySelectorAll('#dashboardSummary .summary-card').length===7,
  {timeout:25000});
}
async function snapshot(page){
 return page.evaluate(()=>{
  const css=sel=>{const el=document.querySelector(sel),r=el.getBoundingClientRect(),c=getComputedStyle(el);
   return{background:c.backgroundImage,color:c.backgroundColor,display:c.display,
    height:r.height,width:r.width}};
  };
  return{user:document.getElementById('topbarUsername').textContent,
   main:css('#app .main'),summary:css('#dashboardSummary .summary-card'),
   summaryCount:document.querySelectorAll('#dashboardSummary .summary-card').length,
   scope:document.getElementById('dashboardScope')?.classList.contains('hidden')===false,
   chart:!!document.querySelector('#salesTrendChart svg'),
   refresh:document.getElementById('dashboardChartRefresh')?.getAttribute('aria-label'),
   amount:document.getElementById('dashboardSummary').textContent,
   live:window.donmacFranchiseUnified};
 });
}
async function signOut(page){
 await page.click('#logoutButton');
 await page.waitForFunction(()=>!document.body.classList.contains('legacy-authenticated')&&
  document.getElementById('authScreen')?.classList.contains('hidden')===false,{timeout:25000});
 await page.waitForFunction(()=>!document.getElementById('dashboardSummary').textContent.includes('12,295'),
  {timeout:25000});
}
async function signIn(page,name){
 await page.type('#authUsername',name);
 await page.type('#authPassword','password-for-browser-smoke');
 await page.click('#authSubmit');
 await display(page,name);
}
(async()=>{
 const port=await listen(),url='http://127.0.0.1:'+port+'/';
 const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_BIN||
  process.env.CHROME_PATH||'/usr/bin/google-chrome',
  args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
 try{
  const page=await browser.newPage();
  await page.setViewport({width:1440,height:960,deviceScaleFactor:1});
  await page.setCookie({url,name:'demo_session',value:'marlou09'});
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await display(page,'marlou09');
  await page.waitForFunction(()=>document.getElementById('dashboardSummary').textContent.includes('12,295'),
   {timeout:15000});
  const legacy=await snapshot(page);
  assert(legacy.amount.includes('12,295'),'Existing account should display its own sales');
  assert.equal(legacy.live,false);
  await signOut(page);
  await signIn(page,'test1');
  await page.waitForFunction(()=>document.getElementById('dashboardScope')&&
   document.querySelector('#salesTrendChart svg'),{timeout:20000});
  const fresh=await snapshot(page);
  assert.equal(fresh.live,true);
  assert(fresh.scope,'NEW account must receive identical dashboard branch scope');
  assert(fresh.chart,'NEW account must receive identical Sales Statistic visual');
  assert(!fresh.amount.includes('12,295'),'Previous owner sales must never appear for test1');
  assert(legacy.main.background.includes('login-coffee-pattern-approved-hd.png'));
  assert(fresh.main.background.includes('login-coffee-pattern-approved-hd.png'),
   'NEW and SHARED accounts must receive the same coffee background');
  assert.equal(legacy.summaryCount,fresh.summaryCount);
  assert.equal(legacy.summary.height,fresh.summary.height,'KPI styling must match account modes');
  await page.click('#mainNav [data-view="transactions"]');
  await page.waitForFunction(()=>window.donmacFinance&&
   document.getElementById('financeTransactionCount').textContent.trim()==='0',
   {timeout:20000});
  const finance=await page.evaluate(()=>({
   oldSale:document.getElementById('financeTransactionsBody').textContent,
   refreshBackground:getComputedStyle(document.getElementById('financeTransactionReset')).backgroundColor
  }));
  assert(!finance.oldSale.includes('MARLOU-ONLY-RECEIPT'),
   'Marlou sales must never be displayed inside test1 finance DOM');
  assert.equal(finance.refreshBackground,'rgb(7, 93, 56)',
   'NEW finance toolbar must use original green Clear Filters style');
  assert(requests.filter(x=>x.user==='test1').every(x=>
   ['/api/auth/me','/api/auth/logout','/api/auth/login','/api/status'].includes(x.path)||
   x.path.startsWith('/api/live/')),'NEW tenant must use isolated APIs only');
  console.log('PASS: original Main POS theme, chart and finance UI match after account switch; previous owner revenue never persists.');
  await page.close();
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(err=>{console.error(err);server.close();process.exitCode=1});
