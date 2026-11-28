'use strict';
// Static layout test using actual repo HTML and styles, including loader styles.
// No real authentication, production API calls, or database changes.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const puppeteer=require('puppeteer-core');
const root=path.resolve(__dirname,'../public');
const mime={'.html':'text/html','.css':'text/css','.js':'application/javascript','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2'};
const loader=fs.readFileSync(path.join(root,'app.js'),'utf8');
const dynamicCss=[...loader.matchAll(/loadCss\('[^']+',\s*'([^']+)'\)/g)].map(x=>x[1]);
const server=http.createServer((req,res)=>{
 const p=new URL(req.url,'http://localhost').pathname;
 if(p.endsWith('.js')){const script=path.resolve(root,p.slice(1));if(!script.startsWith(root+path.sep)||!fs.existsSync(script)){res.writeHead(404);return res.end();}res.writeHead(200,{'Content-Type':'application/javascript'});return res.end('');}
 const file=path.resolve(root,p==='/'?'index.html':p.slice(1));
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}
 res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
});
const sizes=[[320,480],[320,640],[360,800],[390,844],[430,932],[699,900],[700,900],[768,1024],[1024,480],[1024,768],[1280,800],[1440,900],[1920,1080]];
// Compare identical CSS viewport geometry with and without native Android exit.
async function phase3Phone(page,width,height){
 const result=await page.evaluate(({width,height})=>{
  const $=id=>document.getElementById(id);
  const rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom};};
  const root=document.documentElement,app=$('app'),auth=$('authScreen');
  root.classList.add('dm-phone-layout','dm-cashier-role');
  document.body.classList.remove('legacy-authenticated');document.body.classList.add('auth-locked');
  app.classList.add('hidden');app.inert=true;app.setAttribute('aria-hidden','true');auth.classList.remove('hidden');
  const modes=[];
  for(const apk of [false,true]){
   root.classList.toggle('dm-cashier-apk',apk);root.classList.toggle('dm-native-exit-supported',apk);
   $('authSignupPrompt')?.classList.toggle('hidden',apk);
   const login={shell:rect(auth.querySelector('.auth-shell')),signIn:rect($('authSubmit')),exit:getComputedStyle(auth.querySelector('.dm-auth-exit')).display,hiddenApp:getComputedStyle(app).display};
   document.body.classList.add('legacy-authenticated');document.body.classList.remove('auth-locked');
   app.classList.remove('hidden');app.inert=false;app.removeAttribute('aria-hidden');auth.classList.add('hidden');
   document.querySelectorAll('.view').forEach(el=>el.classList.toggle('active',el.id==='view-pos'));
   document.querySelectorAll('.admin-only').forEach(el=>el.classList.add('hidden'));
   $('viewTitle').textContent='Welcome to Don Macchiatos POS';
   $('catalogGrid').innerHTML=Array.from({length:10},(_,i)=>'<button class="product-card"><h4>Product '+i+'</h4><strong>₱99.00</strong></button>').join('');
   const grid=$('catalogGrid'),cards=[...grid.children].map(rect),main=app.querySelector('main.main'),nav=$('mobileBottomNav');
   grid.scrollLeft=0;const before=grid.scrollLeft;grid.scrollLeft=grid.scrollWidth-grid.clientWidth;const after=grid.scrollLeft;grid.scrollLeft=0;
   main.scrollTop=main.scrollHeight;const pay=rect($('payButton')),navBox=rect(nav);main.scrollTop=0;
   const pos={main:rect(main),grid:rect(grid),cards,scrollWidth:grid.scrollWidth,clientWidth:grid.clientWidth,scrolled:after>before,pay,nav:navBox,title:rect($('viewTitle')),titleScroll:$('viewTitle').scrollHeight,titleClient:$('viewTitle').clientHeight};
   const dialog=$('transactionDialog');
   $('transactionDetailBody').innerHTML='<details open class="transaction-section transaction-details"><summary>Inventory Impact</summary><div class="table-wrap"><table><tbody><tr>'+Array.from({length:9},(_,i)=>'<td>Movement column '+i+'</td>').join('')+'</tr></tbody></table></div></details>';
   dialog.showModal();const wrapper=dialog.querySelector('.table-wrap');
   wrapper.scrollLeft=100;
   const detail={box:rect(dialog),wrapper:rect(wrapper),scrollWidth:wrapper.scrollWidth,clientWidth:wrapper.clientWidth,scrolled:wrapper.scrollLeft>0};
   dialog.close();
   modes.push({apk,login,pos,detail});
   document.body.classList.remove('legacy-authenticated');document.body.classList.add('auth-locked');app.classList.add('hidden');app.inert=true;app.setAttribute('aria-hidden','true');auth.classList.remove('hidden');
  }
  root.classList.remove('dm-cashier-apk','dm-native-exit-supported');
  return {width:innerWidth,height:innerHeight,modes};
 },{width,height});
 console.log('PHASE3 PHONE',width,height,JSON.stringify(result));
 for(const m of result.modes){
  assert.equal(m.login.hiddenApp,'none','Login must never reveal POS');
  assert(m.login.shell.w>0&&m.login.shell.right<=width+2,'Login fits phone');
  assert(m.login.signIn.w>0&&m.login.signIn.right<=width+2,'Sign in fits phone');
  assert.equal(m.login.exit==='none',!m.apk,'Only native supported APK gets exit');
  assert(m.pos.grid.right<=width+2,'Catalog fits phone');
  assert(m.pos.scrolled&&m.pos.scrollWidth>m.pos.clientWidth,'Product catalog can scroll horizontally');
  const rows=[...new Set(m.pos.cards.map(c=>Math.round(c.y)))];
  assert.equal(rows.length,2,'Catalog uses two rows');
  assert(m.pos.cards[4].right<=m.pos.grid.right+2,'At least three columns fit');
  assert(m.pos.cards[6].right>m.pos.grid.right,'Additional columns scroll beyond first six');
  assert(m.pos.titleScroll<=m.pos.titleClient+2,'Full heading visible without vertical clipping');
  assert(m.pos.pay.bottom<=m.pos.nav.y+2,'Pay button reachable above fixed nav');
  assert(m.detail.box.right<=width+2,'Detail dialog fits viewport');
  assert(m.detail.scrolled&&m.detail.scrollWidth>m.detail.clientWidth,'Inventory impact scrolls horizontally');
 }
 assert(Math.abs(result.modes[0].pos.grid.w-result.modes[1].pos.grid.w)<1,'Browser/APK catalog geometry identical at same CSS width');
 assert(Math.abs(result.modes[0].login.shell.w-result.modes[1].login.shell.w)<1,'Browser/APK login width identical');
}
// Run the real mobile navigation and hierarchy modules, rather than simulating
// their active classes. This checks attendance (no desktop button), More, and
// drawer reset using actual user clicks with local fixtures only.
async function phase4Navigation(page){
 await page.evaluate(()=>{
  const app=document.getElementById('app');app.classList.remove('hidden');app.inert=false;app.removeAttribute('aria-hidden');
  document.body.classList.add('legacy-authenticated');document.body.classList.remove('auth-locked');
  document.documentElement.classList.add('dm-phone-layout','dm-cashier-role','dm-cashier-apk');
  document.getElementById('authScreen').classList.add('hidden');
  window.donmacAuthenticatedRole='User';window.donmacCashierPermissions=['transactions.view','expenses.view','messages.view'];
  const setView=name=>{
   document.querySelectorAll('#app .view').forEach(el=>el.classList.toggle('active',el.id==='view-'+name));
   document.querySelectorAll('#mainNav .nav').forEach(el=>el.classList.toggle('active',el.dataset.view===name));
  };
  for(const el of document.querySelectorAll('#mobileBottomNav [data-view],#mobileMorePanel [data-view]')){
   const visible=['pos','attendance','transactions','expenses'].includes(el.dataset.view);
   el.classList.toggle('hidden',!visible);
   el.disabled=!visible;el.setAttribute('aria-hidden',String(!visible));
   el.addEventListener('click',()=>setView(el.dataset.view));
  }
  document.getElementById('mobileMoreButton').classList.remove('hidden');
  setView('pos');
 });
 for(const path of ['nav-hierarchy-v20261117.js','mobile-nav-v1529.js']){
  await page.evaluate(source=>{(0,eval)(source)},fs.readFileSync(require('node:path').join(root,path),'utf8'));
 }
 assert.equal(await page.$('#mobileMorePanel [data-mobile-chat-entry]'),null,'APK must not duplicate floating chat');
 const active=()=>page.evaluate(()=>[...document.querySelectorAll('#mobileBottomNav [aria-current="page"]')].map(x=>x.dataset.view));
 await page.click('#mobileBottomNav [data-view="attendance"]');
 await page.waitForFunction(()=>document.querySelector('#mobileBottomNav [data-view="attendance"][aria-current="page"]'));
 assert.deepEqual(await active(),['attendance'],'Attendance is the sole active primary tab');
 await page.click('#mobileMoreButton');
 const group='#mobileMorePanel [aria-controls="dmMobileTransactions"]';
 await page.click(group);
 await page.waitForSelector('#dmMobileTransactions [data-view="transactions"]',{visible:true});
 await page.click('#dmMobileTransactions [data-view="transactions"]');
 await page.waitForFunction(()=>document.getElementById('mobileMoreButton').classList.contains('active')&&document.getElementById('mobileMorePanel').classList.contains('hidden'));
 assert.deepEqual(await active(),[],'Drawer destinations must not falsely select POS');
 await page.click('#mobileMoreButton');
 assert.equal(await page.$eval('#dmMobileTransactions',el=>el.hidden),true,'Transactions group starts collapsed when reopened');
 await page.keyboard.press('Escape');
 assert.equal(await page.$eval('#mobileMoreButton',el=>el.getAttribute('aria-expanded')),'false');
 console.log('PASS Phase 4 mobile navigation: attendance, More, collapsed Transactions and Escape');
}
// Render the actual stylesheet on real markup. Values below are synthetic,
// not franchise data; capture screenshots for visual review in Actions.
async function visualV2(page,width,height){
 const data=await page.evaluate(()=>{
  const $=id=>document.getElementById(id),app=$('app'),auth=$('authScreen');
  const bg=e=>getComputedStyle(e).backgroundColor;
  const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};
  document.documentElement.classList.toggle('dm-phone-layout',innerWidth<700);
  document.documentElement.classList.toggle('dm-native-exit-supported',innerWidth<700);
  document.documentElement.classList.toggle('dm-cashier-apk',innerWidth<700);
  if(innerWidth<700){$('authTitle').textContent='Welcome back';$('authSignupPrompt').classList.add('hidden');}
  document.body.classList.remove('legacy-authenticated');document.body.classList.add('auth-locked');app.classList.add('hidden');app.setAttribute('aria-hidden','true');app.inert=true;auth.classList.remove('hidden');
  const login={form:bg($('authForm')),title:getComputedStyle($('authTitle')).color,submit:bg($('authSubmit')),exit:bg(auth.querySelector('.dm-auth-exit')),signIn:rect($('authSubmit'))};
  return login;
 });
 assert.equal(data.form,'rgb(9, 91, 61)','Brand green sign-in surface');
 assert.equal(data.title,'rgb(255, 255, 255)','Green sign-in title contrast');
 assert.equal(data.submit,'rgb(255, 255, 255)','White primary action on green');
 if(width<700)assert.equal(data.exit,'rgba(0, 0, 0, 0)','Native exit uses outlined pill');
 if(width===360||width===1440)await page.screenshot({path:'commercial-visual-review/login-'+width+'.png'});
 const dashboard=await page.evaluate(()=>{
  const $=id=>document.getElementById(id),app=$('app');
  document.body.classList.remove('auth-locked');document.body.classList.add('legacy-authenticated');app.classList.remove('hidden');app.removeAttribute('aria-hidden');app.inert=false;$('authScreen').classList.add('hidden');document.documentElement.classList.remove('dm-native-exit-supported','dm-cashier-apk','dm-cashier-role');
  document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x.id==='view-dashboard'));
  $('viewTitle').textContent='Dashboard';
  $('dashboardSummary').innerHTML=['revenue','orders','today','month','expenses','deposited','discount','alerts'].map((key,i)=>'<button type="button" class="summary-card dm-kpi-button'+(i===0?' dash-financial-card':'')+'" data-dm-kpi="'+key+'"><div class="dash-card-main"><div class="dash-summary-label"><span class="dash-summary-icon">◉</span><span>'+['Total Revenue','Orders','Today Sales','Month Revenue','Store Expenses','Deposited Sales','Discount','Low Stock Alerts'][i]+'</span></div><strong>'+([1,7].includes(i)?'24':'₱12,450.00')+'</strong><small>Sample reporting period</small></div>'+(i===0?'<div class="dash-gross-net"><span>Gross <b>₱16,450.00</b></span><span>Net <b>₱12,450.00</b></span></div>':'')+'<span class="dm-kpi-arrow">›</span></button>').join('');
  const cards=[...$('dashboardSummary').children],rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,right:r.right}};
  return {header:getComputedStyle(document.querySelector('#app .topbar')).backgroundColor,revenue:getComputedStyle(cards[0]).backgroundColor,card:getComputedStyle(cards[1]).backgroundColor,layout:getComputedStyle(cards[0]).flexDirection,grid:rect($('dashboardSummary')),cards:cards.map(rect),nav:getComputedStyle($('mobileBottomNav')).backgroundColor};
 });
 assert.equal(dashboard.header,'rgb(9, 91, 61)','Brand green header');
 assert.equal(dashboard.revenue,'rgb(9, 91, 61)','V2 featured revenue card');
 assert.equal(dashboard.card,'rgb(255, 255, 255)','V2 secondary card');
 assert.equal(dashboard.layout,'column','V2 KPI has vertical hierarchy');
 assert(dashboard.cards.every(c=>c.right<=width+2),'Dashboard KPI cards fit viewport');
 if(width<700){
  assert.equal(dashboard.nav,'rgb(255, 255, 255)','V2 light mobile navigation');
  assert(dashboard.cards[0].w>dashboard.cards[1].w,'Featured mobile revenue occupies full width');
 }
 if(width===360||width===1440)await page.screenshot({path:'commercial-visual-review/dashboard-'+width+'.png'});
 console.log('PASS V2 visual hierarchy',width,height,JSON.stringify({login:data,dashboard}));
}
async function run(){
 const port=await new Promise(r=>server.listen(0,'127.0.0.1',()=>r(server.address().port)));
 fs.mkdirSync('commercial-visual-review',{recursive:true});
 const browser=await puppeteer.launch({executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  for(const [width,height] of sizes){
   const page=await browser.newPage();await page.setViewport({width,height,deviceScaleFactor:width===360?3:1,isMobile:width<700,hasTouch:width<700});
   await page.goto('http://127.0.0.1:'+port+'/',{waitUntil:'domcontentloaded'});
   await page.evaluate(async urls=>{for(const url of [...new Set(urls)]){
    if([...document.styleSheets].some(s=>s.href&&new URL(s.href).pathname===new URL(url,location.origin).pathname))continue;
    await new Promise(resolve=>{const link=document.createElement('link');link.rel='stylesheet';link.href=url;link.onload=link.onerror=resolve;document.head.append(link);});
   }},dynamicCss);
   if(width===360||width===1440)await visualV2(page,width,height);
   if(width<700)await phase3Phone(page,width,height);
   if(width===360&&height===800)await phase4Navigation(page);
   if(width===360){await page.evaluate(()=>{const app=document.getElementById('app');app.classList.remove('hidden');app.inert=false;app.removeAttribute('aria-hidden');document.body.classList.add('legacy-authenticated');document.body.classList.remove('auth-locked');document.getElementById('authScreen').classList.add('hidden');document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x.id==='view-pos'));document.documentElement.classList.add('dm-native-exit-supported','dm-cashier-role');document.getElementById('categoryTabs').innerHTML=['Coffee','Non Coffee','Food','Add-ons','Promos','Packages'].map((name,i)=>'<button type="button" class="tab category-tile'+(!i?' active':'')+'"><span class="category-symbol">'+['☕','🥛','🍰','＋','★','▦'][i]+'</span><strong>'+name+'</strong><small>Menu</small></button>').join('');document.getElementById('catalogGrid').innerHTML=['Iced Latte','Caramel Macchiato','Spanish Latte','Mocha','Cappuccino','Americano','Vanilla Latte'].map((name,i)=>'<button class="product-card"><div class="cat">Coffee</div><div class="product-art placeholder-art">☕</div><h4>'+name+'</h4><div class="price">₱'+(i%2?99:89)+'.00</div></button>').join('');document.querySelectorAll('#mobileBottomNav [data-view]').forEach(el=>{el.classList.toggle('hidden',false);el.setAttribute('aria-hidden','false');el.classList.toggle('active',el.dataset.view==='pos');});document.querySelector('#mobileMoreButton').classList.remove('active','hidden');document.getElementById('app').querySelector('main.main').scrollTop=0;});await page.screenshot({path:'commercial-visual-review/pos-360.png'});await page.evaluate(()=>document.documentElement.classList.remove('dm-native-exit-supported'));}
   for(const role of ['Admin','User']){
    const data=await page.evaluate(({role,width})=>{
     const $=id=>document.getElementById(id),app=$('app');document.body.classList.remove('auth-locked');document.body.classList.add('legacy-authenticated');
     app.classList.remove('hidden');app.inert=false;app.removeAttribute('aria-hidden');$('authScreen').classList.add('hidden');
     document.documentElement.classList.toggle('dm-cashier-role',role==='User');document.documentElement.classList.toggle('dm-phone-layout',width<700);
     document.querySelectorAll('.admin-only').forEach(el=>el.classList.toggle('hidden',role==='User'));
     document.querySelectorAll('.cashier-only').forEach(el=>el.classList.toggle('hidden',role==='Admin'));
     $('reportDateField').classList.toggle('hidden',role==='User');$('reportCashierSelect').classList.toggle('hidden',role==='User');
     document.querySelectorAll('.view').forEach(el=>el.classList.toggle('active',el.id==='view-reports'));
     $('reportProducts').innerHTML='<tr><td>CHOCOLATE BANANA MUFFIN EXTRA LONG PRODUCT NAME</td><td class="num">100</td><td class="num">₱123,456.78</td><td class="num">-₱100</td><td class="num">₱123,356.78</td>'+(role==='Admin'?'<td>₱5,000</td><td>₱100,000</td>':'')+'</tr>';
     const rect=sel=>{const el=document.querySelector(sel),r=el.getBoundingClientRect();return {x:r.x,right:r.right,width:r.width,display:getComputedStyle(el).display,scroll:el.scrollWidth,client:el.clientWidth,overflow:getComputedStyle(el).overflowX}};
     return {viewport:innerWidth,main:rect('#app > main.main'),filters:rect('.report-filter-fields'),cashier:rect('#reportCashierField'),date:rect('#reportDateField'),table:rect('#dmProductSummaryCard .table-wrap'),nav:rect('#mobileBottomNav'),audit:rect('#inventoryAuditSection'),canvas:getComputedStyle(document.querySelector('#app > main.main')).backgroundImage};
    },{role,width});
    console.log('LAYOUT',width,role,JSON.stringify(data));
    assert(data.main.width>0&&data.main.right<=data.viewport+2,'main fits '+width);
    assert(data.filters.right<=data.viewport+2,'report filters fit '+width);
    assert(data.table.right<=data.viewport+2,'report table container fits '+width);
    assert(['auto','scroll'].includes(data.table.overflow),'report table horizontal scroll');
    assert.equal(data.canvas,'none','neutral workspace');
    if(role==='User'){assert.equal(data.cashier.display,'none');assert.equal(data.date.display,'none');assert.equal(data.audit.display,'none');}
    if(width<700)assert.equal(data.nav.display,'flex');else assert.equal(data.nav.display,'none');
   }
   for(const [file,app,main] of [['supply-office.html','#officeApp','.office-main'],['platform-admin.html','#platformApp','.content']]){
    await page.goto('http://127.0.0.1:'+port+'/'+file,{waitUntil:'domcontentloaded'});
    const g=await page.evaluate(({app,main})=>{const el=document.querySelector(app);document.querySelector(app==='#officeApp'?'#officeLogin':'#platformLogin')?.classList.add('hidden');el.classList.remove('hidden');el.inert=false;const r=el.querySelector(main).getBoundingClientRect();return {viewport:innerWidth,width:r.width,right:r.right,canvas:getComputedStyle(el.querySelector(main)).backgroundImage};},{app,main});
    console.log('OFFICE',file,width,JSON.stringify(g));assert(g.width>0&&g.right<=g.viewport+2,'office main fits '+width);assert.equal(g.canvas,'none');
    if(width===1440||width===360){const palette=await page.evaluate(({app})=>{const el=document.querySelector(app);const header=el.querySelector('.office-top,.topbar');const login=document.querySelector(app==='#officeApp'?'#officeLogin':'#platformLogin');if(getComputedStyle(login).display!=='none')throw Error('Login obscures workspace fixture');return getComputedStyle(header).backgroundColor;},{app});assert.equal(palette,'rgb(9, 91, 61)','Brand green office/admin header');await page.screenshot({path:'commercial-visual-review/'+file.replace('.html','')+'-'+width+'.png'});}
   }
   await page.close();
  }
 }finally{await browser.close();await new Promise(r=>server.close(r));}
}
run().catch(e=>{console.error(e);server.close();process.exitCode=1});
