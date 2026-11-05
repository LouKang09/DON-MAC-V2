'use strict';
// Resend HTTPS delivery mirrors the proven Water POS OTP transport.
// Credentials are read only from Railway environment variables.
// The default onboarding sender is intended for testing only; in production,
// RESEND_FROM_EMAIL must be a verified sending domain/address.
function configured(){return !!String(process.env.RESEND_API_KEY||'').trim();}
const escapeHtml=s=>String(s||'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
async function sendPasswordOtp({to,name,code}){
 const apiKey=String(process.env.RESEND_API_KEY||'').trim();
 if(!apiKey){
  const err=new Error('Resend API key not configured');err.code='MAIL_NOT_CONFIGURED';throw err;
 }
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(to||'')))throw new Error('Invalid recipient email.');
 if(!/^[0-9]{6}$/.test(String(code||'')))throw new Error('Invalid OTP format.');
 const from=String(process.env.RESEND_FROM_EMAIL||'Don Macchiatos POS <onboarding@resend.dev>').trim();
 const displayName=String(name||'POS user').trim().slice(0,120);
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),10000);
 const body={
  from,to:[String(to).trim()],
  subject:'Don Macchiatos POS password reset code',
  text:'Hello '+displayName+',\n\nYour Don Macchiatos POS password reset code is '+code+
    '.\n\nThis code expires in 10 minutes. If you did not request it, you can safely ignore this message.\n\nDon Macchiatos POS',
  html:'<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#24372c">'+
   '<h2 style="color:#075D38">Don Macchiatos POS</h2>'+
   '<p>Hello '+escapeHtml(displayName)+',</p><p>Use this verification code to reset your password:</p>'+
   '<div style="padding:18px;border-radius:12px;background:#edf7ef;text-align:center;'+
   'font-size:31px;font-weight:800;letter-spacing:7px;color:#075D38">'+code+'</div>'+
   '<p>This code expires in <strong>10 minutes</strong>.</p>'+
   '<p>If you did not request a password reset, ignore this message.</p>'+
   '<p style="font-size:12px;color:#718176">Don Macchiatos POS</p></div>'
 };
 try{
  const response=await fetch('https://api.resend.com/emails',{
   method:'POST',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},
   body:JSON.stringify(body),signal:controller.signal
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.id){
   const err=new Error('Resend rejected email ('+response.status+'): '+String(result.message||result.name||'Unknown error').slice(0,200));
   err.code='RESEND_DELIVERY_FAILED';
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
module.exports={configured,sendPasswordOtp};
