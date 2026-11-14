'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const {JSDOM}=require('jsdom');
const html=fs.readFileSync('public/franchise-live.html','utf8');
const planner=fs.readFileSync('public/pos-stock-limit-v20261114.js','utf8');
const app=fs.readFileSync('public/franchise-live.js','utf8');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const catalog=(stock)=>({
 branchId:101,branchName:'Independent test branch',workspaceId:10,
 products:[{id:51,name:'test1',category:'Coffee',price:99,available:stock>=.1,
  recipeConfigured:true,availabilityMessage:stock>=.1?'Available':'Insufficient branch ingredients',
  recipeStock:[{ingredientId:81,code:'BEANS',name:'Coffee Beans',uom:'KG',
   required:.1,current:stock,threshold:0,active:true}],stockWarnings:[]}],
 packages:[],promos:[],addOns:[],categories:[],liveCheckoutUsesLegacyTables:false
});
const inventory=stock=>({branchId:101,items:[{id:81,code:'BEANS',name:'Coffee Beans',
 stock,lowStockThreshold:0,uom:'KG',active:true}]});
async function smoke(){
 const dom=new JSDOM(html,{url:'https://donmacpos.com/franchise-live.html',runScripts:'outside-only'});
 const w=dom.window,doc=w.document;
 const alerts=[],calls=[];
 let balance=.1,receipt=null,orders=[];
 Object.defineProperty(w,'crypto',{value:{randomUUID:()=>crypto.randomUUID()},configurable:true});
 w.confirm=()=>true;
 w.fetch=async(url,options={})=>{
  const u=new URL(url,'https://donmacpos.com');
  const request=u.pathname;calls.push(request);
  let response,status=200;
  if(request==='/api/auth/me')response={user:{role:'User',liveMode:true,username:'testCashier'}};
  else if(request==='/api/live/status')response={ok:true,liveMode:true,workspaceId:10,
   branchId:101,branchName:'Independent test branch',username:'testCashier',role:'User',
   plan:'PRO',branches:[{id:101,name:'Independent test branch'}]};
  else if(request==='/api/live/catalog')response=catalog(balance);
  else if(request==='/api/live/inventory')response=inventory(balance);
  else if(request==='/api/live/transactions'){
   response={branchId:101,total:orders.length,revenue:orders.reduce((sum,x)=>sum+x.actual,0),
    rows:orders.map(x=>({reference:x.reference,date:new Date().toISOString(),
     cashier:'testCashier',paymentMode:'Cash',status:'Sold',actual:x.actual,gross:x.gross,adjustment:0}))};
  }else if(request==='/api/live/quote'){
   const body=JSON.parse(options.body);assert.deepEqual(body.items,[{kind:'product',id:51,qty:1}]);
   response={gross:99,actual:99,adjustment:0,requirements:[]};
  }else if(request==='/api/live/checkout'){
   const b=JSON.parse(options.body);
   assert.equal(b.items[0].qty,1);
   assert.equal(b.paymentMode,'Cash');
   assert.equal(b.tender,100);
   assert(crypto.randomUUID&&b.clientRequestId.length===36);
   assert.equal(balance,.1,'Checkout request issued only while stock is sufficient');
   balance=0;
   receipt={reference:'BR-123456789012345678',actual:99,gross:99,items:[{
     kind:'product',name:'test1',qty:1,total:99,price:99}],
     status:'Sold',paymentMode:'Cash',cashier:'testCashier',
     soldAt:new Date().toISOString()};
   orders=[receipt];
   status=201;response={ok:true,reference:receipt.reference,actual:99,gross:99};
  }else if(request==='/api/live/transactions/BR-123456789012345678'){
   response=receipt;
  }else throw Error('Unexpected browser request '+request);
  return{ok:status>=200&&status<300,status,json:async()=>response};
 };
 w.console.error=(...args)=>alerts.push(args.join(' '));
 w.eval(planner);
 w.eval(app);
 for(let i=0;i<100&&!doc.querySelector('.product-tile');i++)await wait(20);
 const tile=doc.querySelector('[data-add-kind="product"][data-add-id="51"]');
 assert(tile,'Product tile must render using only scoped catalog.');
 assert.equal(tile.disabled,false,'Ingredient in stock should enable new product.');
 assert.equal(doc.querySelector('#view-pos').classList.contains('active'),true,
  'Cashier should land directly in real POS.');
 assert.equal(doc.querySelector('#view-catalog').classList.contains('active'),false);
 assert.equal(doc.querySelector('[data-view="catalog"]').classList.contains('hidden'),true,
  'Cashier must not access admin catalog.');
 tile.click();
 await wait(450);
 assert.equal(doc.querySelector('#amountDue').textContent.includes('99'),true,
  'Checkout quote must use the backend computed PHP total');
 const pay=doc.querySelector('#checkoutButton');
 assert.equal(pay.disabled,true,'Cash requires enough tender before payment.');
 doc.querySelector('#cashTender').value='100';
 doc.querySelector('#cashTender').dispatchEvent(new w.Event('input',{bubbles:true}));
 assert.equal(pay.disabled,false);
 pay.click();
 for(let i=0;i<100&&!receipt;i++)await wait(20);
 for(let i=0;i<100&&!(doc.querySelector('.product-tile')?.disabled);i++)await wait(20);
 assert.equal(doc.querySelector('.product-tile').disabled,true,
  'After live sale exhausts ingredients, product button must disable on refresh');
 assert.equal(orders.length,1,'Sale reaches live checkout, not simulated endpoint');
 assert(calls.includes('/api/live/checkout'));
 assert(!calls.some(x=>x==='/api/sales'||x==='/api/quote'||x==='/api/catalog'),
  'Browser must not use any legacy shared POS API');
 dom.window.close();
 console.log('PASS browser: paid cashier can complete actual checkout; stock exhausts and tile disables; admin/legacy routes remain hidden.');
}
smoke().catch(e=>{console.error(e);process.exitCode=1});
