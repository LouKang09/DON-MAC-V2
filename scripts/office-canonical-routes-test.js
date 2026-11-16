'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PassThrough}=require('node:stream');
const {once}=require('node:events');
const gateway=require('../lib/office-origin-proxy');
const ORIGIN='https://don-mac-supply-office-production.up.railway.app';
assert.equal(gateway.upstreamOrigin(ORIGIN).hostname,'don-mac-supply-office-production.up.railway.app');
for(const wrong of ['http://example.org','https://localhost','https://127.0.0.1',
 'https://example.org','https://user:pass@evil.up.railway.app','https://ok.up.railway.app/admin']){
 assert.throws(()=>gateway.upstreamOrigin(wrong));
}
assert.equal(gateway.cookieHeader('pos_session=secret; platform_admin_session=admin-token; other=bad; supply_office_session=office-token'),
 'platform_admin_session=admin-token; supply_office_session=office-token');
assert.deepEqual(gateway.allowedSetCookies([
 'platform_admin_session=a; HttpOnly; Secure; Path=/api/supply/office/platform',
 'supply_office_session=b; HttpOnly; Secure; Path=/api/supply/office',
 'pos_session=do-not-copy; Path=/',
 'platform_admin_session=bad; Domain=evil.example'
]),[
 'platform_admin_session=a; HttpOnly; Secure; Path=/api/supply/office/platform',
 'supply_office_session=b; HttpOnly; Secure; Path=/api/supply/office'
]);
async function request({path='/api/supply/office/platform/me',method='GET',body='',origin=ORIGIN,
 cookies='pos_session=hidden; platform_admin_session=admin-token; supply_office_session=office-token',
 upstreamCode=200}={}){
 const req=new PassThrough(),res=new PassThrough();
 req.url=path;req.method=method;req.headers={accept:'application/json',cookie:cookies,
  authorization:'Bearer do-not-forward',host:'donmacpos.com','x-forwarded-host':'evil.example',
  'content-type':'application/json'};
 if(body)req.headers['content-length']=String(Buffer.byteLength(body));
 let upstreamRequest=null,forwardedHeaders=null,targetUrl=null,receivedBody='';
 const chunks=[];res.on('data',data=>chunks.push(data));
 res.writeHead=function(code,headers){this.statusCode=code;this.savedHeaders=headers;this.headersSent=true;};
 const done=once(res,'finish');
 const impl=(url,opts,reply)=>{
  targetUrl=url;forwardedHeaders=opts.headers;
  const stream=new PassThrough();upstreamRequest=stream;
  stream.on('data',data=>receivedBody+=data);
  stream.on('finish',()=>{
   const fromOffice=new PassThrough();
   fromOffice.statusCode=upstreamCode;
   fromOffice.headers={'content-type':'application/json','set-cookie':[
    'platform_admin_session=ok; HttpOnly; Path=/api/supply/office/platform',
    'supply_office_session=ok; HttpOnly; Path=/api/supply/office',
    'pos_session=should-not-leak; Path=/'
   ]};
   reply(fromOffice);
   fromOffice.end(JSON.stringify({ok:true,upstreamCode}));
  });
  return stream;
 };
 gateway.forward(req,res,{origin,requestImpl:impl});
 req.end(body);
 await done;
 return{status:res.statusCode,headers:res.savedHeaders,body:Buffer.concat(chunks).toString(),
  targetUrl,forwardedHeaders,upstreamRequest,receivedBody};
}
(async()=>{
 const admin=await request();
 assert.equal(admin.status,200);
 assert.equal(admin.targetUrl.href,ORIGIN+'/api/supply/office/platform/me');
 assert.equal(admin.forwardedHeaders.cookie,'platform_admin_session=admin-token; supply_office_session=office-token');
 assert.equal(admin.forwardedHeaders.authorization,undefined);
 assert.equal(admin.forwardedHeaders.host,undefined);
 assert.equal(admin.forwardedHeaders['x-forwarded-host'],undefined);
 assert.equal(admin.headers['set-cookie'].length,2);
 const supply=await request({path:'/api/supply/office/login',method:'POST',
  body:'{"username":"office","password":"secret"}',upstreamCode:401});
 assert.equal(supply.status,401);
 assert.equal(supply.receivedBody,'{"username":"office","password":"secret"}');
 assert.equal(supply.targetUrl.pathname,'/api/supply/office/login');
 const query=await request({path:'/api/supply/office/orders?page=2&status=APPROVED'});
 assert.equal(query.targetUrl.search,'?page=2&status=APPROVED');
 assert.equal((await request({path:'/api/users'})).status,404);
 assert.equal((await request({method:'TRACE'})).status,405);
 assert.equal((await request({origin:'https://localhost'})).status,503);
 const long=await request({body:'A'.repeat(1024*1024+1),method:'POST'});
 assert.equal(long.status,413);
 assert.equal(long.targetUrl,null);
 const server=fs.readFileSync('server.js','utf8');
 const adminHtml=fs.readFileSync('public/platform-admin.html','utf8');
 const officeHtml=fs.readFileSync('public/supply-office.html','utf8');
 assert.match(server,/\/admin-control/);
 assert.match(server,/\/supply-chain/);
 assert.match(server,/officeOriginProxy\.forward\(req,res\)/);
 assert.match(server,/SUPPLY_OFFICE_PORTAL\?handleOfficeApi/);
 assert.match(server,/https:\/\/donmacpos\.com\/supply-chain\?billing=return/);
 assert.match(adminHtml,/href="\/admin-control"/);
 assert.match(adminHtml,/href="\/supply-chain"/);
 assert.match(officeHtml,/href="\/admin-control"/);
 assert(!adminHtml.includes('href="/platform-admin.html"'));
 console.log('PASS: canonical POS/office paths, backend-only office proxy, cookie confinement, and API isolation.');
})().catch(error=>{console.error(error);process.exitCode=1;});
