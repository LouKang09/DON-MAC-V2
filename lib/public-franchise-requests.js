'use strict';
// Public franchise submissions are requests, not accounts or credentials.
const crypto=require('node:crypto');
const bad=(message,status=400)=>Object.assign(new Error(message),{status});
const acceptedStatuses=new Set(['PENDING','CONTACTED','REJECTED']);
async function migrate(db){
 await db.exec(`CREATE TABLE IF NOT EXISTS public_franchise_requests (
 id VARCHAR(40) PRIMARY KEY,username VARCHAR(80) NOT NULL,
 full_name VARCHAR(120) NOT NULL,email VARCHAR(180) NOT NULL,phone VARCHAR(32) NOT NULL,
 status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 reviewed_by VARCHAR(100),review_note VARCHAR(500))`);
 await db.exec('CREATE INDEX IF NOT EXISTS idx_public_franchise_requests_created ON public_franchise_requests(created_at)');
}
function sanitize(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw bad('Enter your franchise request details.');
 const username=String(raw.username||'').trim(),fullName=String(raw.fullName||'').trim();
 const email=String(raw.email||'').trim().toLowerCase(),phone=String(raw.phone||'').trim();
 if(!/^[A-Za-z0-9._-]{3,80}$/.test(username))throw bad('Username must contain 3–80 letters, numbers, dots, dashes or underscores.');
 if(fullName.length<2||fullName.length>120)throw bad('Full name must contain 2–120 characters.');
 if(email.length>180||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw bad('Enter a valid email.');
 if(!/^[+\d\s().-]{7,32}$/.test(phone))throw bad('Enter a valid phone number.');
 if(raw.password||raw.confirmPassword)throw bad('Do not send a password with a franchise request.');
 return{username,fullName,email,phone};
}
async function request(db,raw){
 const value=sanitize(raw);
 const exists=await db.query('SELECT 1 FROM users WHERE LOWER(COALESCE(login_username,username))=LOWER($1) OR LOWER(username)=LOWER($1) LIMIT 1',[value.username]);
 if(exists.rows.length)throw bad('That username is already in use.',409);
 const pending=await db.query('SELECT id FROM public_franchise_requests WHERE (LOWER(username)=LOWER($1) OR LOWER(email)=LOWER($2)) AND status IN ($3,$4) LIMIT 1',
  [value.username,value.email,'PENDING','CONTACTED']);
 if(pending.rows.length)return{ok:true,message:'A franchise request with these details is already under review. Please contact Admin Control.'};
 const time=new Date().toISOString(),id=crypto.randomUUID();
 await db.query('INSERT INTO public_franchise_requests(id,username,full_name,email,phone,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
  [id,value.username,value.fullName,value.email,value.phone,'PENDING',time,time]);
 return{ok:true,applicationId:id,message:'Request submitted to Admin Control. No POS account has been created yet. Workspace isolation and approval are required before access can be activated.'};
}
async function list(db){
 const r=await db.query('SELECT r.id,r.username,r.full_name,r.email,r.phone,r.status,r.created_at,r.updated_at,r.reviewed_by,r.review_note,r.email_verified_at,'+
  's.stage_status,t.user_id AS test_user_id,t.workspace_id AS test_workspace_id FROM public_franchise_requests r '+
  'LEFT JOIN franchise_provisioning_stages s ON s.request_id=r.id '+
  'LEFT JOIN franchise_test_accounts t ON t.request_id=r.id ORDER BY r.created_at DESC LIMIT 300');
 return{requests:r.rows.map(x=>({id:x.id,username:x.username,fullName:x.full_name,email:x.email,
  phone:x.phone,status:x.status,createdAt:x.created_at,updatedAt:x.updated_at,reviewedBy:x.reviewed_by,reviewNote:x.review_note,emailVerifiedAt:x.email_verified_at||null,
  stageStatus:x.stage_status||null,testUserId:x.test_user_id==null?null:Number(x.test_user_id),testWorkspaceId:x.test_workspace_id==null?null:Number(x.test_workspace_id)}))};
}
async function review(db,id,body,actor){
 if(!/^[0-9a-f-]{36}$/i.test(String(id||'')))throw bad('Invalid request ID.');
 const status=String(body?.status||'').toUpperCase();
 if(!acceptedStatuses.has(status))throw bad('Choose Pending, Contacted or Rejected. Activation requires workspace isolation.');
 const note=String(body?.note||'').trim();
 if(note.length>500)throw bad('Review note must be at most 500 characters.');
 const r=await db.query('UPDATE public_franchise_requests SET status=$1,updated_at=$2,reviewed_by=$3,review_note=$4 WHERE id=$5 RETURNING id',
  [status,new Date().toISOString(),String(actor||'Admin Control').slice(0,100),note||null,id]);
 if(!r.rows.length)throw bad('Account request not found.',404);
 return{ok:true,status};
}
module.exports={migrate,request,list,review,sanitize};
