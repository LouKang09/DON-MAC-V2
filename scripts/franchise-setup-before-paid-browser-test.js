'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const html=fs.readFileSync('public/franchise-live.html','utf8');
const planner=fs.readFileSync('public/pos-stock-limit-v20261114.js','utf8');
const main=fs.readFileSync('public/franchise-live.js','utf8');
const css=fs.readFileSync('public/auth-shell-guard-v20261115.css','utf8');
const legacy=fs.readFileSync('public/app-core.js','utf8');
const page=fs.readFileSync('public/index.html','utf8');
const wait=ms=>new Promise(done=>setTimeout(done,ms));
const stockCatalog={branchId:101,products:[{id:51,name:'Sample Coffee',
 category:'Coffee',price:99,available:true,recipeConfigured:true,
 recipeStock:[{ingredientId:81,code:'BEANS',name:'Beans',uom:'KG',
  required:0.1,current:3,threshold:1,active:true}],stockWarnings:[]}],
 packages:[],promos:[],addOns:[],categories:[]};
async function browser(role){
 const dom=new JSDOM(html,{url:'https://donmacpos.com/franchise-live.html',runScripts:'outside-only'});
 const w=dom.window,doc=w.document;
 let paid=false,permissions=[],cashiers=[],branches=[{id:101,name:'Starter Branch'}];
 const requests=[];
 const status=()=>({ok:true,liveMode:true,productionIsolated:true,workspaceId:10,
  branchId:101,branchName:'Starter Branch',username:role==='Admin'?'owner':'cashier',
  role,plan:'PRO',subscriptionStatus:paid?'PAID':'NOT_CONFIGURED',
  subscriptionActive:paid,setupMode:!paid,permissions,branches,cashiers,
  entitlements:{plan:'PRO',maxBranches:3,mayAdd:branches.length<3,extraBranchRate:799}});
 w.fetch=async(url,opts={})=>{
  const p=new URL(url,'https://donmacpos.com').pathname;requests.push(p);
  let data;
  if(p==='/api/auth/me')data={user:{id:role==='Admin'?1:2,role,liveMode:true,setupMode:!paid}};
  else if(p==='/api/live/status')data=status();
  else if(p==='/api/live/catalog')data=stockCatalog;
  else if(p==='/api/live/inventory')data={branchId:101,items:[]};
  else if(p==='/api/live/transactions')data={branchId:101,total:0,revenue:0,rows:[]};
  else if(p==='/api/live/cashiers')data={cashiers};
  else if(p==='/api/live/branches'){
   if(role!=='Admin')throw Error('Cashier may not create branch');
   const body=JSON.parse(opts.body),id=101+branches.length;
   branches.push({id,name:body.name});data={ok:true,id,name:body.name,branchId:id};
  }else if(p==='/api/live/cashiers'){
   const body=JSON.parse(opts.body);
   cashiers.push({id:3,username:body.username,fullName:body.fullName,
    branchId:body.branchId,active:true,permissions:[]});
   data={ok:true,id:3,username:body.username};
  }else if(p==='/api/live/quote'){
   if(!paid)throw Error('Unpaid account attempted quote');
   data={gross:99,actual:99,adjustment:0,requirements:[]};
  }else throw Error('Unexpected request '+p);
  return{ok:true,status:200,json:async()=>data};
 };
 w.eval(planner);w.eval(main);
 for(let i=0;i<90&&!doc.querySelector('.product-tile');i++)await wait(20);
 assert(doc.querySelector('.product-tile'),'An isolated product is visible on new account login');
 assert.equal(doc.querySelector('.product-tile').disabled,true,'No unpaid cashier may begin an order');
 assert.equal(doc.querySelector('#checkoutButton').disabled,true,'Checkout is disabled before approval');
 assert.equal(requests.includes('/api/live/quote'),false);
 assert.equal(requests.includes('/api/live/checkout'),false);
 if(role==='User'){
  const visible=()=>[...doc.querySelectorAll('#liveNav button[data-view]')]
   .filter(x=>!x.classList.contains('hidden')).map(x=>x.dataset.view);
  assert.deepEqual(visible(),['pos'],'Cashiers default to POS only, with all other side buttons hidden');
  paid=true;permissions=['transactions.view'];
  w.dispatchEvent(new w.Event('focus'));
  for(let i=0;i<80&&(doc.querySelector('.product-tile').disabled||!visible().includes('transactions'));i++)await wait(20);
  assert.equal(doc.querySelector('.product-tile').disabled,false,
   'Subscription approval immediately enables item ordering without re-login');
  assert.deepEqual(visible(),['pos','transactions']);
  paid=false;permissions=[];
  w.dispatchEvent(new w.Event('focus'));
  for(let i=0;i<80&&!doc.querySelector('.product-tile').disabled;i++)await wait(20);
  assert.equal(doc.querySelector('.product-tile').disabled,true);
  assert.deepEqual(visible(),['pos'],'Revoked grant hides cashier tab on every screen size');
 }else{
  assert.equal(doc.querySelector('[data-view="branches"]').classList.contains('hidden'),false);
  const branchButton=doc.querySelector('[data-view="branches"]');
  branchButton.click();
  doc.querySelector('#branchName').value='New Coffee Branch';
  doc.querySelector('#branchForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  for(let i=0;i<80&&branches.length<2;i++)await wait(20);
  assert.equal(branches.length,2,'Owner can register a branch with unpaid plan');
  doc.querySelector('[data-view="team"]').click();
  for(let i=0;i<80&&!doc.querySelector('#cashierUsername');i++)await wait(20);
  doc.querySelector('#cashierUsername').value='newcashier';
  doc.querySelector('#cashierName').value='New Cashier';
  doc.querySelector('#cashierPassword').value='Password12345';
  doc.querySelector('#cashierForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  for(let i=0;i<80&&!cashiers.length;i++)await wait(20);
  assert.equal(cashiers.length,1,'Owner can create staff without payment');
  assert(requests.includes('/api/live/branches'));
  assert(requests.includes('/api/live/cashiers'));
  assert.equal(requests.includes('/api/live/checkout'),false);
  assert.equal(doc.querySelector('[data-view="pos"]').classList.contains('hidden'),true,
   'Owner is never permitted to process sales');
 }
 dom.window.close();
 return requests;
}
(async()=>{
 assert.match(css,/body:not\(\.legacy-authenticated\) #app/);
 assert.match(css,/#app\.hidden/);
 assert.match(page,/id="app" class="app hidden" inert aria-hidden="true"/);
 assert.match(legacy,/legacyApp\.inert=true/);
 assert.match(legacy,/document\.body\.classList\.remove\('legacy-authenticated'\)/);
 assert.match(legacy,/cashierViews/);
 await browser('User');
 await browser('Admin');
 console.log('PASS browser: pending owners manage branches/cashiers, pending cashiers cannot sell, Paid unlocks checkout, only granted nav visible, legacy app cannot peek behind login.');
})().catch(err=>{console.error(err);process.exitCode=1});
