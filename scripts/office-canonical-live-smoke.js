'use strict';
const assert=require('node:assert/strict');
const https=require('node:https');
const origin='https://donmacpos.com';
function get(path){
 return new Promise((resolve,reject)=>{
  const request=https.get(new URL(path,origin),{headers:{'user-agent':'DonMac-office-route-check/1.0'},timeout:16000},response=>{
   const buffers=[];
   response.on('data',chunk=>{
    buffers.push(chunk);
    if(buffers.reduce((n,b)=>n+b.length,0)>1024*1024){request.destroy(Error('Response exceeds smoke-test limit'));}
   });
   response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,body:Buffer.concat(buffers).toString('utf8')}));
  });
  request.on('timeout',()=>request.destroy(Error('Public site check timed out: '+path)));
  request.on('error',reject);
 });
}
(async()=>{
 const pos=await get('/');
 assert.equal(pos.status,200,'Main POS must remain online');
 const admin=await get('/admin-control');
 assert.equal(admin.status,200,'Admin Control uses a short URL');
 assert.match(admin.body,/Welcome back, Admin!/);
 const supply=await get('/supply-chain');
 assert.equal(supply.status,200,'Supply Chain uses a short URL');
 assert.match(supply.body,/Welcome to Supply Chain Login/);
 const oldAdmin=await get('/platform-admin.html');
 assert.equal(oldAdmin.status,302);
 assert.equal(oldAdmin.headers.location,'/admin-control');
 const oldSupply=await get('/supply-office.html');
 assert.equal(oldSupply.status,302);
 assert.equal(oldSupply.headers.location,'/supply-chain');
 const officeApi=await get('/api/supply/office/me');
 assert.equal(officeApi.status,401,'Supply API must be reachable but require office authentication');
 assert.match(officeApi.body,/Main Office sign-in required/i);
 const platformApi=await get('/api/supply/office/platform/me');
 assert.equal(platformApi.status,401,'Admin Control API must require independent admin authentication');
 assert.match(platformApi.body,/Admin Control sign-in required/i);
 const health=await get('/api/health');
 assert.equal(health.status,200);
 assert.equal(JSON.parse(health.body).ok,true);
 console.log('PASS: both public short URLs resolve, legacy paths redirect, office gateways require their own credentials, and POS stays healthy.');
})().catch(e=>{console.error(e);process.exitCode=1;});
