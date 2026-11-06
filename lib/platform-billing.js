'use strict';
// Platform-owner subscription payments only. NOT franchise sales or supply orders.
const crypto=require('crypto');
const uuid=()=>crypto.randomUUID();
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const now=()=>new Date().toISOString();
const configured=()=>/^sk_(test|live)_/.test(process.env.PAYMONGO_SECRET_KEY||'')&&Boolean(process.env.PAYMONGO_WEBHOOK_SECRET);
const mode=()=>String(process.env.PAYMONGO_SECRET_KEY||'').startsWith('sk_live_')?'live':'test';
const cents=x=>Math.round(Number(x)*100);
const money=x=>Math.round(Number(x)*100)/100;
const tenantId=(kind,id)=>kind==='SUPPLY_OFFICE'?'supply-office':String(Number(id));
function tenant(kind,id){
 if(kind!=='FRANCHISE'&&kind!=='SUPPLY_OFFICE')throw fail('Invalid subscription account.');
 if(kind==='FRANCHISE'&&(!Number.isSafeInteger(Number(id))||Number(id)<1))throw fail('Invalid franchise account.');
 return tenantId(kind,id);
}
function manilaToday(){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
 const f=type=>parts.find(p=>p.type===type)?.value;
 return f('year')+'-'+f('month')+'-'+f('day');
}
function addMonth(iso){
 const [y,m,d]=String(iso).split('-').map(Number);
 const next=new Date(Date.UTC(y,m,1));
 const last=new Date(Date.UTC(next.getUTCFullYear(),next.getUTCMonth()+1,0)).getUTCDate();
 return new Date(Date.UTC(next.getUTCFullYear(),next.getUTCMonth(),Math.min(d,last))).toISOString().slice(0,10);
}
function dateOrNull(value){
 const v=String(value||'');
 return /^\d{4}-\d{2}-\d{2}$/.test(v)&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v?v:null;
}
async function migrate(db){
 await db.exec("CREATE TABLE IF NOT EXISTS platform_service_plans("+
  "service_key VARCHAR(50) PRIMARY KEY,plan VARCHAR(20) NOT NULL,amount NUMERIC(12,2) NOT NULL,"+
  "status VARCHAR(20) NOT NULL,next_payment_date TEXT,updated_at TEXT NOT NULL,updated_by VARCHAR(100) NOT NULL)");
 await db.exec("CREATE TABLE IF NOT EXISTS platform_billing_invoices("+
  "id VARCHAR(40) PRIMARY KEY,tenant_kind VARCHAR(20) NOT NULL,tenant_id VARCHAR(60) NOT NULL,"+
  "plan VARCHAR(20) NOT NULL,amount_centavos INTEGER NOT NULL,currency VARCHAR(3) NOT NULL DEFAULT 'PHP',"+
  "status VARCHAR(20) NOT NULL,checkout_session_id VARCHAR(100) UNIQUE,checkout_url TEXT,"+
  "payment_id VARCHAR(100) UNIQUE,paid_at TEXT,payment_method VARCHAR(40),created_at TEXT NOT NULL,updated_at TEXT NOT NULL)");
 await db.exec('CREATE INDEX IF NOT EXISTS idx_platform_billing_tenant ON platform_billing_invoices(tenant_kind,tenant_id,created_at)');
 await db.exec('CREATE TABLE IF NOT EXISTS platform_billing_events(event_id VARCHAR(100) PRIMARY KEY,invoice_id VARCHAR(40),processed_at TEXT NOT NULL)');
}
async function plan(db,kind,id){
 const key=tenant(kind,id);
 const q=kind==='SUPPLY_OFFICE'?
  await db.query('SELECT plan,amount,status,next_payment_date FROM platform_service_plans WHERE service_key=$1',[key]):
  await db.query('SELECT plan,amount,status,next_payment_date FROM platform_account_plans WHERE workspace_id=$1',[Number(key)]);
 const row=q.rows[0];
 return row?{plan:row.plan,amount:money(row.amount),status:row.status,nextPaymentDate:row.next_payment_date||null}:null;
}
async function tenantSummary(db,kind,id){
 const key=tenant(kind,id),sub=await plan(db,kind,key);
 const records=await db.query('SELECT id,plan,amount_centavos,currency,status,checkout_session_id,payment_id,paid_at,payment_method,created_at FROM platform_billing_invoices WHERE tenant_kind=$1 AND tenant_id=$2 ORDER BY created_at DESC LIMIT 30',[kind,key]);
 return{tenantKind:kind,tenantId:key,subscription:sub,provider:'PayMongo',
  checkoutConfigured:configured(),paymentMode:configured()?mode():'unconfigured',
  canPay:configured()&&!!sub&&sub.amount>0&&!!sub.nextPaymentDate,
  invoices:records.rows.map(row=>({id:row.id,plan:row.plan,amount:Number(row.amount_centavos)/100,currency:row.currency,status:row.status,checkoutSessionId:row.checkout_session_id||null,paymentId:row.payment_id||null,paidAt:row.paid_at||null,paymentMethod:row.payment_method||null,createdAt:row.created_at}))};
}
async function saveServicePlan(db,body,actor){
 const selected=String(body?.plan||''),status=String(body?.status||''),raw=String(body?.amount??'').trim(),due=String(body?.nextPaymentDate||'');
 if(!['PRO','BUSINESS'].includes(selected)||!['PAID','ON_HOLD','UNPAID'].includes(status))throw fail('Invalid subscription plan or status.');
 if(!/^\d{1,9}(?:\.\d{1,2})?$/.test(raw)||Number(raw)<0)throw fail('Enter a valid subscription amount in PHP.');
 if(due&&!dateOrNull(due))throw fail('Enter a valid next payment date.');
 await db.query('INSERT INTO platform_service_plans(service_key,plan,amount,status,next_payment_date,updated_at,updated_by) '+
  'VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(service_key) DO UPDATE SET plan=excluded.plan,amount=excluded.amount,'+
  'status=excluded.status,next_payment_date=excluded.next_payment_date,updated_at=excluded.updated_at,updated_by=excluded.updated_by',
  ['supply-office',selected,Number(raw),status,due||null,now(),String(actor||'Admin Control').slice(0,100)]);
 return{ok:true,subscription:await plan(db,'SUPPLY_OFFICE','supply-office')};
}
async function adminOverview(db,page=1){
 const supply=await tenantSummary(db,'SUPPLY_OFFICE','supply-office');
 const currentPage=Math.max(1,Math.min(100000,Number(page)||1)),pageSize=10;
 const [q,summary]=await Promise.all([
  db.query("SELECT id,tenant_kind,tenant_id,plan,amount_centavos,currency,status,checkout_session_id,payment_id,paid_at,payment_method,created_at FROM platform_billing_invoices ORDER BY created_at DESC LIMIT $1 OFFSET $2",[pageSize,(currentPage-1)*pageSize]),
  db.query("SELECT COUNT(*) AS total,COUNT(*) FILTER (WHERE status='PAID') AS paid_count,COUNT(*) FILTER (WHERE status='PENDING') AS pending_count FROM platform_billing_invoices")
 ]);
 const invoices=q.rows.map(row=>({id:row.id,tenantKind:row.tenant_kind,tenantId:row.tenant_id,plan:row.plan,amount:Number(row.amount_centavos)/100,currency:row.currency,status:row.status,checkoutSessionId:row.checkout_session_id||null,paymentId:row.payment_id||null,paidAt:row.paid_at||null,paymentMethod:row.payment_method||null,createdAt:row.created_at}));
 return{provider:'PayMongo',checkoutConfigured:configured(),paymentMode:configured()?mode():'unconfigured',webhookPath:'/api/supply/office/billing/webhook',supplyOffice:supply.subscription,invoices,totalCount:Number(summary.rows[0]?.total||0),paidCount:Number(summary.rows[0]?.paid_count||0),pendingCount:Number(summary.rows[0]?.pending_count||0),page:currentPage,pageSize};
}
async function requestCheckout(db,kind,id,returnUrl){
 const key=tenant(kind,id),secret=process.env.PAYMONGO_SECRET_KEY||'';
 if(!configured())throw fail('Subscription checkout is not available yet. The platform owner must connect PayMongo.',503);
 if(!/^https:\/\//.test(returnUrl))throw fail('Checkout return address must be HTTPS.',500);
 let invoice,sub;
 // A tenant can have only one active session for the current configured plan
 // and amount. Reuse that checkout to prevent duplicate customer charges.
 await db.transaction(async tx=>{
  sub=await plan(tx,kind,key);
  if(!sub||sub.amount<=0||!sub.nextPaymentDate)throw fail('Subscription plan, amount and next payment date must be configured by Admin Control.',409);
  const previous=await tx.query("SELECT * FROM platform_billing_invoices WHERE tenant_kind=$1 AND tenant_id=$2 AND status IN ('CREATING','PENDING') ORDER BY created_at DESC LIMIT 1"+(tx.engine==='postgres'?' FOR UPDATE':''),[kind,key]);
  const old=previous.rows[0];
  if(old&&old.plan===sub.plan&&Number(old.amount_centavos)===cents(sub.amount)){
   if(old.status==='CREATING')throw fail('Your checkout is being prepared. Retry shortly.',409);
   invoice=old;return;
  }
  if(old)throw fail('An earlier checkout is still pending. Contact Admin Control before starting a changed subscription charge.',409);
  const at=now(),iid=uuid();
  await tx.query('INSERT INTO platform_billing_invoices(id,tenant_kind,tenant_id,plan,amount_centavos,currency,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
   [iid,kind,key,sub.plan,cents(sub.amount),'PHP','CREATING',at,at]);
  invoice={id:iid,status:'CREATING',plan:sub.plan,amount_centavos:cents(sub.amount)};
 });
 if(invoice.status==='PENDING'&&invoice.checkout_url)return{ok:true,checkoutUrl:invoice.checkout_url,invoiceId:invoice.id,reused:true};
 if(invoice.status!=='CREATING')throw fail('Checkout is not ready.',409);
 const paymentMethodTypes=String(process.env.PAYMONGO_PAYMENT_METHODS||'qrph').split(',').map(v=>v.trim()).filter(v=>['qrph','gcash','paymaya','card'].includes(v));
 const types=[...new Set(paymentMethodTypes.length?paymentMethodTypes:['qrph'])];
 try{
  const payload={data:{attributes:{
   line_items:[{name:'Don Macchiatos '+sub.plan+' subscription',amount:invoice.amount_centavos,currency:'PHP',quantity:1}],
   payment_method_types:types,success_url:returnUrl,cancel_url:returnUrl,
   reference_number:invoice.id,send_email_receipt:true,
   metadata:{billing_invoice_id:invoice.id,tenant_kind:kind,tenant_id:key}
  }}};
  const result=await fetch('https://api.paymongo.com/v2/checkout_sessions',{method:'POST',
   headers:{Authorization:'Basic '+Buffer.from(secret+':').toString('base64'),'Content-Type':'application/json'},
   body:JSON.stringify(payload),signal:AbortSignal.timeout(14000)});
  const body=await result.json().catch(()=>({}));
  if(!result.ok)throw fail('Payment provider declined checkout creation. Please try again.',502);
  const sid=String(body?.data?.id||''),url=String(body?.data?.attributes?.checkout_url||'');
  if(!/^cs_[\w-]+$/.test(sid)||!/^https:\/\/checkout\.paymongo\.com\//.test(url))throw fail('Invalid checkout response from provider.',502);
  await db.query("UPDATE platform_billing_invoices SET status='PENDING',checkout_session_id=$1,checkout_url=$2,updated_at=$3 WHERE id=$4 AND status='CREATING'",
   [sid,url,now(),invoice.id]);
  return{ok:true,checkoutUrl:url,invoiceId:invoice.id,reused:false};
 }catch(e){
  await db.query("UPDATE platform_billing_invoices SET status='FAILED',updated_at=$1 WHERE id=$2 AND status='CREATING'",[now(),invoice.id]).catch(()=>{});
  throw e.status?e:fail('Unable to reach PayMongo. Retry later.',502);
 }
}
function verifySignature(raw,header){
 const secret=process.env.PAYMONGO_WEBHOOK_SECRET||'';
 if(!secret||!configured()||!Buffer.isBuffer(raw)||raw.length>262144)throw fail('Payment webhook is unavailable.',503);
 const fields=Object.fromEntries(String(header||'').split(',').map(x=>x.trim().split('=').slice(0,2)));
 const t=String(fields.t||''),s=String(fields[mode()==='live'?'li':'te']||'');
 if(!/^\d{9,14}$/.test(t)||! /^[a-f0-9]{64}$/i.test(s))throw fail('Invalid payment webhook signature.',401);
 if(Math.abs(Date.now()-Number(t)*1000)>10*60*1000)throw fail('Expired webhook signature.',401);
 const expected=crypto.createHmac('sha256',secret).update(t+'.').update(raw).digest('hex');
 if(!crypto.timingSafeEqual(Buffer.from(s.toLowerCase(),'hex'),Buffer.from(expected,'hex')))throw fail('Invalid payment webhook signature.',401);
}
function unpack(event){
 // PayMongo supports both v1 event and hosted Checkout event envelopes.
 const outer=event?.data||{},attrs=outer.attributes||outer;
 const type=String(attrs.type||'');
 const resource=attrs.data||{},a=resource.attributes||{};
 return{eventId:String(outer.id||attrs.id||''),type,livemode:attrs.livemode===true,sessionId:String(resource.id||''),
  reference:String(a.reference_number||''),payments:Array.isArray(a.payments)?a.payments:[]};
}
async function processWebhook(db,raw,header){
 verifySignature(raw,header);
 let event;try{event=JSON.parse(raw.toString('utf8'))}catch(_){throw fail('Invalid webhook JSON.',400)}
 const e=unpack(event);
 if(e.type!=='checkout_session.payment.paid')return{ok:true,ignored:true};
 if(e.livemode!==(mode()==='live'))throw fail('Checkout mode mismatch.',409);
 if(!/^evt_[\w-]+$/.test(e.eventId)||!/^cs_[\w-]+$/.test(e.sessionId)||!e.reference)throw fail('Payment webhook is missing its reference.',400);
 const paid=e.payments.find(p=>p?.attributes?.status==='paid');
 if(!paid||!String(paid.id||'').startsWith('pay_'))throw fail('No settled payment in checkout event.',409);
 const pa=paid.attributes;
 if(pa.currency!=='PHP'||!Number.isSafeInteger(Number(pa.amount)))throw fail('Invalid payment currency or amount.',409);
 return db.transaction(async tx=>{
  const record=await tx.query('SELECT * FROM platform_billing_invoices WHERE id=$1'+(tx.engine==='postgres'?' FOR UPDATE':''),[e.reference]);
  const inv=record.rows[0];
  if(!inv||inv.checkout_session_id!==e.sessionId)throw fail('Unknown checkout session.',409);
  if(inv.status==='PAID'||inv.status==='PAID_REVIEW')return{ok:true,duplicate:true};
  if(inv.status!=='PENDING')throw fail('Invoice is not awaiting payment.',409);
  if(Number(inv.amount_centavos)!==Number(pa.amount))throw fail('Payment amount mismatch; manual review required.',409);
  const current=await plan(tx,inv.tenant_kind,inv.tenant_id);
  const samePlan=current&&current.plan===inv.plan&&cents(current.amount)===Number(inv.amount_centavos);
  const nextStatus=samePlan?'PAID':'PAID_REVIEW',at=now();
  await tx.query('UPDATE platform_billing_invoices SET status=$1,payment_id=$2,payment_method=$3,paid_at=$4,updated_at=$4 WHERE id=$5 AND status=$6',
   [nextStatus,String(paid.id).slice(0,100),String(pa.source?.type||'unknown').slice(0,40),at,inv.id,'PENDING']);
  await tx.query('INSERT INTO platform_billing_events(event_id,invoice_id,processed_at) VALUES($1,$2,$3) ON CONFLICT(event_id) DO NOTHING',
   [e.eventId,inv.id,at]);
  if(samePlan){
   // Renewal is never based on a frontend redirect. Advance only after a verified
   // provider webhook for a correctly matched session, amount and tenant.
   const baseline=current.nextPaymentDate&&current.nextPaymentDate>manilaToday()?current.nextPaymentDate:manilaToday();
   const due=addMonth(baseline);
   if(inv.tenant_kind==='FRANCHISE')await tx.query("UPDATE platform_account_plans SET status='PAID',next_payment_date=$1,updated_at=$2,updated_by=$3 WHERE workspace_id=$4",
    [due,at,'PayMongo verified payment',Number(inv.tenant_id)]);
   else await tx.query("UPDATE platform_service_plans SET status='PAID',next_payment_date=$1,updated_at=$2,updated_by=$3 WHERE service_key=$4",
    [due,at,'PayMongo verified payment','supply-office']);
  }
  return{ok:true,status:nextStatus,invoiceId:inv.id};
 });
}
module.exports={migrate,configured,mode,plan,tenantSummary,saveServicePlan,adminOverview,requestCheckout,verifySignature,processWebhook};
