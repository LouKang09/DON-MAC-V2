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
 if(p.endsWith('.js')){res.writeHead(200,{'Content-Type':'application/javascript'});return res.end('');}
 const file=path.resolve(root,p==='/'?'index.html':p.slice(1));
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}
 res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
});
const sizes=[[320,640],[360,800],[390,844],[430,932],[699,900],[700,900],[768,1024],[1024,768],[1280,800],[1440,900],[1920,1080]];
async function run(){
 const port=await new Promise(r=>server.listen(0,'127.0.0.1',()=>r(server.address().port)));
 const browser=await puppeteer.launch({executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  for(const [width,height] of sizes){
   const page=await browser.newPage();await page.setViewport({width,height,deviceScaleFactor:width===360?3:1,isMobile:width<700,hasTouch:width<700});
   await page.goto('http://127.0.0.1:'+port+'/',{waitUntil:'domcontentloaded'});
   await page.evaluate(async urls=>{for(const url of [...new Set(urls)]){
    if([...document.styleSheets].some(s=>s.href&&new URL(s.href).pathname===new URL(url,location.origin).pathname))continue;
    await new Promise(resolve=>{const link=document.createElement('link');link.rel='stylesheet';link.href=url;link.onload=link.onerror=resolve;document.head.append(link);});
   }},dynamicCss);
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
    const g=await page.evaluate(({app,main})=>{const el=document.querySelector(app);el.classList.remove('hidden');el.inert=false;const r=el.querySelector(main).getBoundingClientRect();return {viewport:innerWidth,width:r.width,right:r.right,canvas:getComputedStyle(el.querySelector(main)).backgroundImage};},{app,main});
    console.log('OFFICE',file,width,JSON.stringify(g));assert(g.width>0&&g.right<=g.viewport+2,'office main fits '+width);assert.equal(g.canvas,'none');
   }
   await page.close();
  }
 }finally{await browser.close();await new Promise(r=>server.close(r));}
}
run().catch(e=>{console.error(e);server.close();process.exitCode=1});
