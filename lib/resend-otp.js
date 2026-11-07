'use strict';
// Resend HTTPS delivery mirrors the proven Water POS OTP transport.
// Credentials are read only from Railway environment variables.
// The default onboarding sender is intended for testing only; in production,
// RESEND_FROM_EMAIL must be a verified sending domain/address.
function configured(){return !!String(process.env.RESEND_API_KEY||'').trim();}
const escapeHtml=s=>String(s||'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
/* Classify provider failures without disclosing recipient addresses, API keys,
   or Resend's raw response message to unauthenticated users or application logs. */
function classifyResendFailure(status,result){
 const name=String(result?.name||result?.code||'').slice(0,90).toLowerCase();
 const message=String(result?.message||'').slice(0,700).toLowerCase();
 const detail=name+' '+message;
 if(status===401||/invalid.api.key|unauthorized|invalid_api_key|invalid.*token/.test(detail))
  return{code:'RESEND_API_KEY_REJECTED',
   userMessage:'The email service rejected the API key. Please ask the administrator to verify the Resend API key in Railway.'};
 if(/only.send.test|testing.email|test.email|testing.domain|testing.mode|verify a domain|only.send.emails.to/.test(detail))
  return{code:'RESEND_TESTING_RESTRICTION',
   userMessage:'Email sending is limited by Resend testing mode. The administrator must verify a sending domain to deliver OTPs to franchise accounts.'};
 if(/not.verified|unverified|domain.*verify|domain.*not|domain.*invalid|from.*not.allowed|sending.domain|not.authorized.to.send/.test(detail))
  return{code:'RESEND_SENDER_NOT_VERIFIED',
   userMessage:'The email sender is not verified in Resend. The administrator must verify the sending domain and update RESEND_FROM_EMAIL.'};
 if(/invalid.*from|from.*invalid|sender.*invalid|sender.*required|from.*required/.test(detail))
  return{code:'RESEND_INVALID_SENDER',
   userMessage:'The configured sender email address is invalid. The administrator must correct RESEND_FROM_EMAIL in Railway.'};
 if(status===429||/rate.limit|quota.exceeded|daily.limit/.test(detail))
  return{code:'RESEND_RATE_LIMITED',
   userMessage:'The email service has reached its sending limit. Please try again later.'};
 if(status===403)
  return{code:'RESEND_PERMISSION_OR_DOMAIN',
   userMessage:'Resend rejected this email. The administrator should verify the sending domain and API-key permissions.'};
 if(status===422)
  return{code:'RESEND_VALIDATION_ERROR',
   userMessage:'The email service rejected the message configuration. The administrator should check the Resend request logs and verified sender.'};
 if(status>=500)
  return{code:'RESEND_PROVIDER_UNAVAILABLE',
   userMessage:'The email service is temporarily unavailable. Please try again later.'};
 return{code:'RESEND_DELIVERY_REJECTED',
  userMessage:'The email service rejected this OTP request. Please contact your administrator to review the Resend Logs page.'};
}
async function sendPasswordOtp({to,name,code,purpose='password'}){
 if(!['password','franchise'].includes(purpose))throw new Error('Invalid OTP purpose.');
 const franchise=purpose==='franchise';
 const apiKey=String(process.env.RESEND_API_KEY||'').trim();
 if(!apiKey){
  const err=new Error('Resend API key not configured');err.code='MAIL_NOT_CONFIGURED';throw err;
 }
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(to||'')))throw new Error('Invalid recipient email.');
 if(!/^[0-9]{6}$/.test(String(code||'')))throw new Error('Invalid OTP format.');
 const from=String(process.env.RESEND_FROM_EMAIL||'Don Macchiatos POS <onboarding@resend.dev>').trim()
  .replace(/^(['"])(.*)\1$/, '$2').trim();
 // Resend accepts either an address or a display name followed by <address>.
 const senderAddress=(from.match(/<([^<>]+)>\s*$/)||[])[1]||from;
 if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(senderAddress)){
  const bad=new Error('Invalid Resend sender configuration');
  bad.code='RESEND_INVALID_SENDER';
  bad.userMessage='The configured sender email address is invalid. The administrator must correct RESEND_FROM_EMAIL in Railway.';
  throw bad;
 }
 const displayName=String(name||'POS user').trim().slice(0,120);
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),10000);
 const body={
  from,to:[String(to).trim()],
  subject:franchise?'Don Macchiatos POS franchise email verification':'Don Macchiatos POS password reset code',
  text:'Hello '+displayName+',\n\nYour Don Macchiatos POS '+(franchise?'franchise signup email verification':'password reset')+' code is '+code+
    '.\n\nThis code expires in 10 minutes. If you did not request it, you can safely ignore this message.\n\nDon Macchiatos POS',
  html:'<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#24372c">'+
   '<h2 style="color:#075D38">Don Macchiatos POS</h2>'+
   '<p>Hello '+escapeHtml(displayName)+',</p><p>Use this verification code to '+(franchise?'verify your franchise request email':'reset your password')+':</p>'+
   '<div style="padding:18px;border-radius:12px;background:#edf7ef;text-align:center;'+
   'font-size:31px;font-weight:800;letter-spacing:7px;color:#075D38">'+code+'</div>'+
   '<p>This code expires in <strong>10 minutes</strong>.</p>'+
   '<p>If you did not request '+(franchise?'a franchise account':'a password reset')+', ignore this message.</p>'+
   '<p style="font-size:12px;color:#718176">Don Macchiatos POS</p></div>'
 };
 try{
  const response=await fetch('https://api.resend.com/emails',{
   method:'POST',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},
   body:JSON.stringify(body),signal:controller.signal
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.id){
   const reason=classifyResendFailure(response.status,result);
   const err=new Error('Resend rejected OTP email');
   err.code=reason.code;
   err.providerStatus=response.status;
   err.providerErrorName=String(result?.name||'unknown').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,60);
   err.userMessage=reason.userMessage;
   throw err;
  }
  return {ok:true,provider:'resend',messageId:result.id};
 }catch(e){
  if(e?.name==='AbortError'){
   const timeout=new Error('Resend email request timed out');timeout.code='RESEND_TIMEOUT';throw timeout;
  }
  throw e;
 }finally{clearTimeout(timer);}
}
const sendFranchiseOtp=({to,name,code})=>sendPasswordOtp({to,name,code,purpose:'franchise'});
module.exports={configured,sendPasswordOtp,sendFranchiseOtp,classifyResendFailure};
