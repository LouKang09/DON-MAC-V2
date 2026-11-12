'use strict';
const assert=require('node:assert/strict');
const api=require('../lib/resend-otp');
const before={key:process.env.RESEND_API_KEY,from:process.env.RESEND_FROM_EMAIL,fetch:global.fetch};
process.env.RESEND_API_KEY='fake-test-key-only';
const payloads=[];
global.fetch=async(_url,options)=>{payloads.push(JSON.parse(options.body));
 return{ok:true,status:200,json:async()=>({id:'testing-message'})};};
(async()=>{
 for(const sender of ['otp@donmacpos.com','<otp@donmacpos.com>','Don Macchiatos POS <otp@donmacpos.com>']){
  process.env.RESEND_FROM_EMAIL=sender;
  await api.sendPasswordOtp({to:'tester@example.com',name:'Test',code:'123456'});
 }
 assert.equal(payloads[0].from,'otp@donmacpos.com');
 assert.equal(payloads[1].from,'otp@donmacpos.com');
 assert.equal(payloads[2].from,'Don Macchiatos POS <otp@donmacpos.com>');
 assert(payloads.every(x=>!x.from.includes('onboarding@resend.dev')));
 console.log('PASS: Railway sender formats normalize correctly before Resend API');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{
 if(before.key===undefined)delete process.env.RESEND_API_KEY;else process.env.RESEND_API_KEY=before.key;
 if(before.from===undefined)delete process.env.RESEND_FROM_EMAIL;else process.env.RESEND_FROM_EMAIL=before.from;
 global.fetch=before.fetch;
});
