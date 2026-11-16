'use strict';
// Same-origin gateway for the separate, credential-isolated Office Railway service.
// The POS never receives or stores Main Office login keys and never handles its
// privileged API locally. Only the fixed /api/supply/office/* namespace is proxied.
const https=require('node:https');
const {URL}=require('node:url');

const PREFIX='/api/supply/office/';
const ALLOWED_COOKIES=new Set(['platform_admin_session','supply_office_session']);
const MAX_BODY=1024*1024;
const ALLOWED_METHODS=new Set(['GET','POST','PUT','PATCH','DELETE']);
const REQUEST_HEADERS=['accept','content-type','user-agent','if-none-match'];

function cookieHeader(value){
 if(typeof value!=='string')return '';
 return value.split(';').map(part=>part.trim()).filter(part=>{
  const separator=part.indexOf('=');
  return separator>0&&ALLOWED_COOKIES.has(part.slice(0,separator));
 }).join('; ');
}
function allowedSetCookies(values){
 const list=Array.isArray(values)?values:(values?[values]:[]);
 return list.filter(value=>{
  if(typeof value!=='string')return false;
  const name=value.split('=',1)[0].trim();
  return ALLOWED_COOKIES.has(name)&&!/(?:^|;)\s*domain\s*=/i.test(value);
 });
}
function upstreamOrigin(input){
 if(typeof input!=='string'||!input.trim())throw Error('Office API origin is not configured.');
 const url=new URL(input);
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||
  url.pathname!=='/'||url.port||!/^[-a-z0-9]+\.up\.railway\.app$/i.test(url.hostname))
  throw Error('Office API origin must be a dedicated HTTPS Railway service domain.');
 return url;
}
function sendError(res,code,message){
 if(res.headersSent||res.writableEnded){if(!res.writableEnded)res.destroy();return;}
 const payload=JSON.stringify({error:message});
 res.writeHead(code,{'Content-Type':'application/json; charset=utf-8',
  'Content-Length':Buffer.byteLength(payload),'Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff'});
 res.end(payload);
}
function forward(req,res,{origin=process.env.DONMAC_OFFICE_API_ORIGIN,requestImpl=https.request}={}){
 let incoming;
 try{incoming=new URL(req.url,'http://localhost');}
 catch(_){return sendError(res,400,'Invalid API request.');}
 if(!incoming.pathname.startsWith(PREFIX))return sendError(res,404,'Office API route not found.');
 if(!ALLOWED_METHODS.has(req.method))return sendError(res,405,'Method not allowed.');
 let target;
 try{
  const upstream=upstreamOrigin(origin);
  target=new URL(incoming.pathname+incoming.search,upstream);
 }catch(error){
  console.error('[Office Gateway]',error.message);
  return sendError(res,503,'Office API is not configured. Contact system administration.');
 }
 const length=req.headers['content-length'];
 if(length!==undefined&&(!/^\d+$/.test(String(length))||Number(length)>MAX_BODY))
  return sendError(res,413,'Office API request exceeds size limit.');
 const headers={};
 for(const name of REQUEST_HEADERS)if(req.headers[name])headers[name]=req.headers[name];
 const cookie=cookieHeader(req.headers.cookie);
 if(cookie)headers.cookie=cookie;
 if(length!==undefined)headers['content-length']=String(length);
 // Do not forward POS session cookies, Authorization, Host, forwarding headers,
 // browser-provided destination headers, or cookies belonging to other apps.
 headers['accept-encoding']='identity';
 let upstreamRequest;
 try{
  upstreamRequest=requestImpl(target,{method:req.method,headers,timeout:25000},upstreamResponse=>{
   const allowed=['content-type','content-length','cache-control','etag','location',
    'content-disposition','retry-after','www-authenticate'];
   const responseHeaders={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
   for(const name of allowed){
    if(upstreamResponse.headers[name]!==undefined)
     responseHeaders[name]=upstreamResponse.headers[name];
   }
   const cookies=allowedSetCookies(upstreamResponse.headers['set-cookie']);
   if(cookies.length)responseHeaders['set-cookie']=cookies;
   res.writeHead(upstreamResponse.statusCode||502,responseHeaders);
   upstreamResponse.pipe(res);
   upstreamResponse.on('error',()=>{if(!res.writableEnded)res.destroy();});
  });
 }catch(_){return sendError(res,502,'Office API is temporarily unavailable.');}
 let size=0,blocked=false;
 upstreamRequest.on('timeout',()=>upstreamRequest.destroy(Error('Office API timeout')));
 upstreamRequest.on('error',()=>{
  if(blocked)return;
  sendError(res,502,'Office API is temporarily unavailable. Please retry.');
 });
 req.on('aborted',()=>upstreamRequest.destroy());
 req.on('data',chunk=>{
  size+=chunk.length;
  if(size>MAX_BODY&&!blocked){
   blocked=true;req.unpipe(upstreamRequest);upstreamRequest.destroy();
   sendError(res,413,'Office API request exceeds size limit.');
  }
 });
 req.pipe(upstreamRequest);
}
module.exports={PREFIX,cookieHeader,allowedSetCookies,upstreamOrigin,forward};
