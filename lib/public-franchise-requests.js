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
 // Existing applications are preserved. Historical requests without a choice
 // remain unspecified, while newly submitted forms must select a plan.
 if(db.engine==='postgres')await db.exec('ALTER TABLE public_franchise_requests ADD COLUMN IF NOT EXISTS requested_plan VARCHAR(20)');
 else {
  const cols=(await db.query('PRAGMA table_info(public_franchise_requests)')).rows;
  if(!cols.some(x=>x.name==='requested_plan'))
   await db.exec('ALTER TABLE public_franchise_requests ADD COLUMN requested_plan VARCHAR(20)');
 }
 await db.exec('CREATE INDEX IF NOT EXISTS idx_public_franchise_requests_created ON public_franchise_requests(created_at)');
}
function sanitize(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw bad('Enter your franchise request details.');
 const username=String(raw.username||'').trim(),fullName=String(raw.fullName||'').trim();
 const email=String(raw.email||'').trim().toLowerCase(),phone=String(raw.phone||'').trim();
 const requestedPlan='TRIAL';
 if(!/^[A-Za-z0-9._-]{3,80}$/.test(username))throw bad('Username must contain 3–80 letters, numbers, dots, dashes or underscores.');
 if(fullName.length<2||fullName.length>120)throw bad('Full name must contain 2–120 characters.');
 if(email.length>180||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw bad('Enter a valid email.');
 if(!/^[+\d\s().-]{7,32}$/.test(phone))throw bad('Enter a valid phone number.');
 if(raw.password||raw.confirmPassword)throw bad('Do not send a password with a franchise request.');
 
 return{username,fullName,email,phone,requestedPlan};
}
// Exclude only the explicitly designated legacy/demo owners and their memberships.
const demoNames=['marlou09','retired_demo_test123_7','retired_demo_test1_8'];
const demoOwner="LOWER(COALESCE(o.login_username,o.username)) IN ('"+demoNames.join("','")+"')";
const liveUsers=" FROM users u WHERE NOT (LOWER(COALESCE(u.login_username,u.username)) IN ('"+demoNames.join("','")+"') OR EXISTS (SELECT 1 FROM chat_memberships m JOIN chat_workspaces w ON w.id=m.workspace_id JOIN users o ON o.id=w.owner_user_id WHERE m.user_id=u.id AND "+demoOwner+"))";
function normalizePhone(raw){
 const input=String(raw||'').trim();
 if(!/^[+\d\s().-]{7,32}$/.test(input))return '';
 let digits=input.replace(/\D/g,'');
 if(/^09\d{9}$/.test(digits))digits='63'+digits.slice(1);
 else if(/^9\d{9}$/.test(digits))digits='63'+digits;
 else if(/^0063\d{10}$/.test(digits))digits=digits.slice(2);
 return digits.length>=7&&digits.length<=15?digits:'';
}
async function usernameAvailable(db,raw){
 const value=String(raw||'').trim();
 if(!/^[A-Za-z0-9._-]{3,80}$/.test(value))return {available:false,reason:'Use 3–80 letters, numbers, dots, dashes or underscores.'};
 const used=(await db.query('SELECT 1'+liveUsers+' AND (LOWER(u.username)=LOWER($1) OR LOWER(COALESCE(u.login_username,u.username))=LOWER($1)) LIMIT 1',[value])).rows.length>0;
 return {available:!used,reason:used?'This username is already registered.':undefined};
}
async function emailAvailable(db,raw){
 const email=String(raw||'').trim().toLowerCase();
 if(email.length>180||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return {available:false,reason:'Enter a valid email address.'};
 const used=(await db.query('SELECT 1'+liveUsers+' AND LOWER(TRIM(u.email))=$1 LIMIT 1',[email])).rows.length>0;
 return {available:!used,reason:used?'This email is already registered to another account.':undefined};
}
async function phoneAvailable(db,raw){
 const phone=normalizePhone(raw);
 if(!phone)return {available:false,reason:'Enter a valid phone number.'};
 const rows=(await db.query('SELECT u.phone'+liveUsers+" AND u.phone IS NOT NULL AND u.phone<>''")).rows;
 const used=rows.some(row=>normalizePhone(row.phone)===phone);
 return {available:!used,reason:used?'This phone number is already registered to another account.':undefined};
}
async function request(db,raw){
 const value=sanitize(raw);
 for(const [check,input] of [[usernameAvailable,value.username],[emailAvailable,value.email],[phoneAvailable,value.phone]]){
  const result=await check(db,input);if(!result.available)throw bad(result.reason,409);
 }
 const pending=await db.query('SELECT id FROM public_franchise_requests WHERE (LOWER(username)=LOWER($1) OR LOWER(email)=LOWER($2)) AND status IN ($3,$4) LIMIT 1',
  [value.username,value.email,'PENDING','CONTACTED']);
 if(pending.rows.length)return{ok:true,message:'A franchise request with these details is already under review. Please contact Admin Control.'};
 const time=new Date().toISOString(),id=crypto.randomUUID();
 await db.query('INSERT INTO public_franchise_requests(id,username,full_name,email,phone,status,created_at,updated_at,requested_plan) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
  [id,value.username,value.fullName,value.email,value.phone,'PENDING',time,time,value.requestedPlan]);
 return{ok:true,applicationId:id,message:'Request submitted to Admin Control. Complete email OTP verification and choose your password. Admin Control will assign your desired plan and activate live POS access when the subscription is Paid.'};
}
async function list(db){
 const r=await db.query('SELECT r.id,r.username,r.full_name,r.email,r.phone,r.status,r.created_at,r.updated_at,r.reviewed_by,r.review_note,r.email_verified_at,r.requested_plan,'+
  's.stage_status,t.user_id AS test_user_id,t.workspace_id AS test_workspace_id,tu.active AS test_active,am.data_mode,'+
  'p.plan AS assigned_plan,p.status AS assigned_status,p.amount AS assigned_amount,p.next_payment_date AS assigned_next_payment_date '
  +'FROM public_franchise_requests r '+
  'LEFT JOIN franchise_provisioning_stages s ON s.request_id=r.id '+
  'LEFT JOIN franchise_test_accounts t ON t.request_id=r.id LEFT JOIN users tu ON tu.id=t.user_id '+
  'LEFT JOIN franchise_account_modes am ON am.workspace_id=t.workspace_id '+
  'LEFT JOIN platform_account_plans p ON p.workspace_id=t.workspace_id WHERE r.status<>$1 ORDER BY r.created_at DESC LIMIT 300',['RETIRED']);
 return{requests:r.rows.map(x=>({id:x.id,username:x.username,fullName:x.full_name,email:x.email,
  phone:x.phone,status:x.status,createdAt:x.created_at,updatedAt:x.updated_at,reviewedBy:x.reviewed_by,reviewNote:x.review_note,emailVerifiedAt:x.email_verified_at||null,
  requestedPlan:x.requested_plan||null,assignedPlan:x.assigned_plan||null,assignedStatus:x.assigned_status||null,
  assignedAmount:x.assigned_amount==null?null:Number(x.assigned_amount),
  assignedNextPaymentDate:x.assigned_next_payment_date||null,
  stageStatus:x.stage_status||null,testUserId:x.test_user_id==null?null:Number(x.test_user_id),testWorkspaceId:x.test_workspace_id==null?null:Number(x.test_workspace_id),testActive:x.test_active===true||x.test_active===1||x.test_active==='1',
  dataMode:x.data_mode||(x.test_user_id?'TEMPORARY':null)}))};
}
async function review(db,id,body,actor){
 if(!/^[0-9a-f-]{36}$/i.test(String(id||'')))throw bad('Invalid request ID.');
 const status=String(body?.status||'').toUpperCase();
 if(!acceptedStatuses.has(status))throw bad('Choose Pending, Contacted or Rejected.');
 const test=(await db.query('SELECT 1 FROM franchise_test_accounts WHERE request_id=$1',[id])).rows;
 if(test.length)throw bad('Use the Enable/Disable login action for an existing franchise account.',409);
 const note=String(body?.note||'').trim();
 if(note.length>500)throw bad('Review note must be at most 500 characters.');
 const r=await db.query('UPDATE public_franchise_requests SET status=$1,updated_at=$2,reviewed_by=$3,review_note=$4 WHERE id=$5 RETURNING id',
  [status,new Date().toISOString(),String(actor||'Admin Control').slice(0,100),note||null,id]);
 if(!r.rows.length)throw bad('Account request not found.',404);
 return{ok:true,status};
}
module.exports={migrate,request,list,review,sanitize,emailAvailable,usernameAvailable,phoneAvailable,normalizePhone};
