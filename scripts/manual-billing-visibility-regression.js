'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'public/tenant-billing.css'),'utf8');
const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const billing=require('../lib/platform-billing');
const {JSDOM}=require('jsdom');
async function run(){
 const dom=new JSDOM(html,{url:'https://donmacpos.com'});
 const doc=dom.window.document,section=doc.getElementById('tenantBilling');
 assert(section,'Preserve dormant future gateway markup without activating it.');
 assert(section.hasAttribute('hidden')&&section.hasAttribute('inert'),'Online billing section must be hidden and inert in every account.');
 assert.equal(section.getAttribute('aria-hidden'),'true');
 assert.match(css,/#view-account #tenantBilling\[hidden\]\{display:none!important/);
 assert(!app.includes("loadScript('/tenant-billing-ui.js"),'Do not load dormant gateway UI for legacy accounts');
 for(const id of ['accountPlanSelect','accountPlanMessage','subscriptionHistoryBody','accountPlanPill']){
  assert(doc.getElementById(id),'Keep manual plan/account status UI: '+id);
 }
 const original={
  key:process.env.PAYMONGO_SECRET_KEY,webhook:process.env.PAYMONGO_WEBHOOK_SECRET,
  optIn:process.env.PAYMONGO_CHECKOUT_ENABLED
 };
 try{
  process.env.PAYMONGO_SECRET_KEY='sk_test_'+'A'.repeat(32);
  process.env.PAYMONGO_WEBHOOK_SECRET='test-webhook-secret';
  delete process.env.PAYMONGO_CHECKOUT_ENABLED;
  assert.equal(billing.configured(),false,'Gateway must stay off by default even with configured keys');
  await assert.rejects(billing.requestCheckout({},'FRANCHISE',17,'https://donmacpos.com'),
   error=>error.status===503 && /manually/.test(error.message));
  process.env.PAYMONGO_CHECKOUT_ENABLED='false';
  assert.equal(billing.configured(),false);
  process.env.PAYMONGO_CHECKOUT_ENABLED='true';
  assert.equal(billing.configured(),true,'PayMongo requires a future explicit owner opt-in');
 }finally{
  for(const [key,name] of [['key','PAYMONGO_SECRET_KEY'],['webhook','PAYMONGO_WEBHOOK_SECRET'],['optIn','PAYMONGO_CHECKOUT_ENABLED']]){
   if(original[key]===undefined)delete process.env[name];else process.env[name]=original[key];
  }
 }
 dom.window.close();
 console.log('PASS: dormant PayMongo application hidden; manually managed plan status preserved; online checkout opt-in required.');
}
run().catch(error=>{console.error(error);process.exitCode=1});
