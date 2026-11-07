'use strict';
const crypto=require('crypto');
const billing=require('./platform-billing');
const franchiseRequests=require('./public-franchise-requests');
const BASE='/api/supply/office/platform';
const KEY='platform_admin_credential_v1';
// One-time bootstrap verifier; the default password is not stored in plaintext.
// Initial access is limited to changing credentials, then all old sessions expire.
const FIRST={username:'Marlou09',salt:'4eb5103605443364adf3f6ef9d08ed04',hash:'9097c6588c7e587c84344642585f2dda7d1d82e3b9ccc05931f0ec575e7c2a45ea4c448b281c2d674ea137a2fbde74630a01a56a3528c9484a9043bc06ff74dd',version:'bootstrap'};
async function get(db){
 const q=await db.query('SELECT setting_value FROM app_settings WHERE setting_key=$1',[KEY]);
 if(!q.rows.length)return null;
 try{const c=JSON.parse(q.rows[0].setting_value);if(!c.username||!c.salt||!c.hash||!c.version)throw Error();return c;}
 catch(_){throw Object.assign(Error('Admin credentials require review.'),{status:409});}
}
function matches(password,c){
 try{const a=crypto.scryptSync(password,c.salt,64),b=Buffer.from(c.hash,'hex');return a.length===b.length&&crypto.timingSafeEqual(a,b);}catch(_){return false;}
}
function cookie(version,key){
 const payload=Buffer.from(JSON.stringify({role:'platform-admin',version,exp:Date.now()+43200000,nonce:crypto.randomBytes(12).toString('hex')})).toString('base64url');
 const signature=crypto.createHmac('sha256','admin-control:'+key).update(payload).digest('hex');
 const secure=process.env.NODE_ENV==='production'||process.env.COOKIE_SECURE==='true'?'; Secure':'';
 return 'platform_admin_session='+payload+'.'+signature+'; HttpOnly; SameSite=Lax; Path='+BASE+'; Max-Age=43200'+secure;
}
function readSession(req,key,parseCookies){
 const token=parseCookies(req).platform_admin_session||'';
 if(!key||token.length>700)return null;
 const [payload,sig]=token.split('.');
 if(!payload||!sig||payload.length>400||!(/^[a-f0-9]{64}$/.test(sig)))return null;
 const expected=crypto.createHmac('sha256','admin-control:'+key).update(payload).digest('hex');
 if(!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))return null;
 try{const x=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));return x.role==='platform-admin'&&x.exp>Date.now()&&x.exp<Date.now()+46800000?x:null;}catch(_){return null;}
}
async function handle(req,res,p,method,d){
 const {db,readJson,json,safeHeaders,parseCookies,checkLoginRate,clearLoginRate,platformAccounts,logAction}=d;
 const key=process.env.SUPPLY_OFFICE_SESSION_KEY||'';
 const send=(status,data,headers={})=>json(res,status,data,safeHeaders(headers));
 if(method==='POST'&&p===BASE+'/login'){
  const b=await readJson(req),username=String(b.username||'').trim(),password=String(b.password||'');
  if(username.length>100||password.length>256)return send(400,{error:'Invalid credentials.'});
  checkLoginRate(req,'admin-control-'+username);
  const c=(await get(db))||FIRST;
  if(!key||username.toLowerCase()!==c.username.toLowerCase()||!matches(password,c))return send(401,{error:'Invalid Admin Control credentials.'});
  clearLoginRate(req,'admin-control-'+username);
  return send(200,{ok:true,username:c.username,mustChangePassword:c===FIRST},{'Set-Cookie':cookie(c.version,key)});
 }
 const c=(await get(db))||FIRST,s=readSession(req,key,parseCookies);
 if(!s||s.version!==c.version)return send(401,{error:'Admin Control sign-in required.'});
 if(method==='POST'&&p===BASE+'/logout')return send(200,{ok:true},{'Set-Cookie':'platform_admin_session=; Max-Age=0; Path='+BASE+'; HttpOnly; SameSite=Lax'});
 if(method==='GET'&&p===BASE+'/me')return send(200,{ok:true,username:c.username,mustChangePassword:c===FIRST});
 if(method==='POST'&&p===BASE+'/credentials'){
  const b=await readJson(req),old=String(b.currentPassword||''),pass=String(b.newPassword||'');
  const username=String(b.newUsername||c.username).trim();
  if(!matches(old,c))return send(403,{error:'Current password is incorrect.'});
  if(!/^[A-Za-z0-9._-]{3,80}$/.test(username))return send(400,{error:'Username must be 3–80 letters, numbers, dots, dashes or underscores.'});
  if(c===FIRST&&!pass)return send(400,{error:'Replace the initial password to use Admin Control.'});
  if(pass&&(pass.length<10||pass.length>128||pass===old))return send(400,{error:'New password must be different and 10–128 characters.'});
  if(!pass&&username===c.username)return send(400,{error:'Change the username or password.'});
  const salt=pass?crypto.randomBytes(16).toString('hex'):c.salt;
  const hash=pass?crypto.scryptSync(pass,salt,64).toString('hex'):c.hash;
  const updated={username,salt,hash,version:crypto.randomBytes(20).toString('hex')};
  await db.query('INSERT INTO app_settings(setting_key,setting_value,updated_at) VALUES($1,$2,$3) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_at=excluded.updated_at',[KEY,JSON.stringify(updated),new Date().toISOString()]);
  await logAction({username:c.username},'Admin Control login updated','Platform Admin','Credentials changed');
  return send(200,{ok:true,username,mustChangePassword:false},{'Set-Cookie':cookie(updated.version,key)});
 }
 if(c===FIRST)return send(403,{error:'Change the initial Admin Control password before managing accounts.'});
 if(method==='GET'&&p===BASE+'/accounts')return send(200,await platformAccounts.list(db));
 if(method==='GET'&&p===BASE+'/franchise-requests')return send(200,await franchiseRequests.list(db));
 const requestReview=p.match(/^\/api\/supply\/office\/platform\/franchise-requests\/([0-9a-f-]{36})$/i);
 if(method==='PUT'&&requestReview)return send(200,
  await franchiseRequests.review(db,requestReview[1],await readJson(req),c.username));
 if(method==='GET'&&p===BASE+'/billing'){const q=new URL(req.url,'http://localhost').searchParams;return send(200,await billing.adminOverview(db,q.get('page'),q.get('tenantKind'),q.get('tenantId')));}
 if(method==='PUT'&&p===BASE+'/billing/supply-office'){
  const result=await billing.saveServicePlan(db,await readJson(req),c.username);
  await logAction({username:c.username},'Supply Chain subscription configured','Platform Admin','Office tenant billing updated');
  return send(200,result);
 }
 const sub=p.match(/^\/api\/supply\/office\/platform\/accounts\/(\d+)\/subscription$/);
 if(method==='PUT'&&sub){const result=await platformAccounts.savePlan(db,sub[1],await readJson(req),c.username);
  await logAction({username:c.username},'Subscription updated','Platform Admin','Workspace '+sub[1]);return send(200,result);}
 const user=p.match(/^\/api\/supply\/office\/platform\/accounts\/(\d+)\/users\/(\d+)$/);
 if(method==='PUT'&&user){const result=await platformAccounts.saveUser(db,user[1],user[2],await readJson(req));
  await logAction({username:c.username},'Member updated','Platform Admin','Workspace '+user[1]+' / User '+user[2]);return send(200,result);}
 return send(404,{error:'Admin Control endpoint not found.'});
}
module.exports={handle};
