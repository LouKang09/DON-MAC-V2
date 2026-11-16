'use strict';
// Browser-level layout regression for both NEW and existing Main POS accounts.
// This tests the shared HTML/CSS directly, without requiring a real franchise
// login or touching production sales.
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const puppeteer=require('puppeteer-core');
const root=path.resolve(__dirname,'../public');
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8',
 '.js':'application/javascript; charset=utf-8','.svg':'image/svg+xml',
 '.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.woff2':'font/woff2'};
const server=http.createServer((req,res)=>{
 const p=new URL(req.url,'http://localhost').pathname;
 // Only CSS/HTML are needed for measuring the actual grid. Keep this test
 // independent of API data and account-mode-specific JavaScript behavior.
 if(/\.js$/.test(p)){res.writeHead(200,{'Content-Type':types['.js']});res.end('');return;}
 const file=path.resolve(root,p==='/'?'index.html':p.slice(1));
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){
  res.writeHead(404);res.end('Not found');return;
 }
 res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});
 fs.createReadStream(file).pipe(res);
});
async function start(){
 return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port)));
}
function box(v){return v&&{x:v.x,y:v.y,width:v.width,height:v.height,right:v.right,bottom:v.bottom};}
async function evaluate(page){
 return page.evaluate(()=>{
  document.body.classList.remove('auth-locked');
  document.body.classList.add('legacy-authenticated');
  const app=document.getElementById('app');
  app.classList.remove('hidden');app.inert=false;app.removeAttribute('aria-hidden');
  const get=id=>{const element=document.querySelector(id);const r=element.getBoundingClientRect();
   return{display:getComputedStyle(element).display,position:getComputedStyle(element).position,
    x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
  return{width:innerWidth,app:get('#app'),sidebar:get('#app > .sidebar'),
   main:get('#app > main.main'),mobile:get('#mobileBottomNav'),
   more:get('#mobileMorePanel'),summary:get('#dashboardSummary')};
 });
}
(async()=>{
 const port=await start();
 const chrome=process.env.CHROME_BIN||process.env.CHROME_PATH||'/usr/bin/google-chrome';
 const browser=await puppeteer.launch({executablePath:chrome,headless:true,
  args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
 try{
  for(const width of [1440,1260,1024,768,390]){
   const page=await browser.newPage();
   await page.setViewport({width,height:900,deviceScaleFactor:1});
   await page.goto('http://127.0.0.1:'+port+'/',{waitUntil:'networkidle0'});
   const d=await evaluate(page);
   console.log('GEOMETRY '+width+'px '+JSON.stringify(d));
   assert(d.app.width>=width-1,'Application must occupy full viewport at '+width);
   assert(d.main.width>0&&d.main.right<=width+1,'Main view fits browser at '+width);
   if(width>=700){
    assert.equal(d.mobile.display,'none','Phone bottom bar must not take a desktop grid column at '+width);
    assert.equal(d.more.display,'none','More panel must not take a desktop grid column at '+width);
    assert(d.sidebar.width>=60,'Desktop sidebar remains visible at '+width);
    assert(d.main.x>=d.sidebar.width-2,'Main must appear AFTER the sidebar at '+width+'; '+JSON.stringify(d));
    assert(d.main.width>=width-d.sidebar.width-2,'Main must use the remaining page width at '+width+'; '+JSON.stringify(d));
    assert(d.summary.width>=d.main.width-90,'Dashboard cards must fill available content width at '+width);
   }else{
    assert.equal(d.mobile.display,'flex','Mobile bottom nav must be fixed and visible on phones');
    assert.equal(d.mobile.position,'fixed');
    assert(d.main.x>=-1&&d.main.x<=1,'Phone content starts at viewport left');
    assert(d.main.width>=width-1,'Phone content occupies available width');
    assert(d.mobile.bottom>=899&&d.mobile.bottom<=901,'Bottom nav stays at screen bottom');
   }
   console.log('PASS '+width+'px: sidebar '+Math.round(d.sidebar.width)+
    ', main x='+Math.round(d.main.x)+' width='+Math.round(d.main.width)+
    ', mobile nav '+d.mobile.display);
   await page.close();
  }
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
