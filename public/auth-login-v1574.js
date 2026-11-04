/* v1.5.75 — Don Mac login, global username check, and OTP recovery pages.
 * Never store passwords, OTPs, or session tokens locally. */
(()=>{
 'use strict';
 const $=id=>document.getElementById(id);
 const form=$('authForm'),password=$('authPassword'),username=$('authUsername');
 if(!form||!password||!username)return;
 const remember=$('authRememberUsername'),toggle=$('authPasswordToggle');
 const KEY='donmac_login_remembered_username';
 const pageIds={login:null,register:'authRegisterPanel',reset:'authResetPanel'};
 let page='login',checkSeq=0,available=false;
 function message(id,text,isError=false){
  const el=$(id);if(!el)return;
  el.textContent=text;el.classList.toggle('error',!!isError);
  el.classList.remove('hidden');
 }
 function restore(){
  try{
   const stored=localStorage.getItem(KEY);
   if(stored&&stored.length<=80){remember.checked=true;if(!username.value)username.value=stored;}
   else remember.checked=false;
  }catch(_){remember.checked=false;}
 }
 function show(next){
  if(!Object.hasOwn(pageIds,next))next='login';
  page=next;
  Object.entries(pageIds).forEach(([type,id])=>{
   if(id)$(id).classList.toggle('hidden',type!==page);
  });
  form.classList.toggle('hidden',page!=='login');
  // Avoid hiding a stale password or code on return to sign in.
  if(page==='login'){
   password.type='password';
   toggle.setAttribute('aria-pressed','false');
   toggle.setAttribute('aria-label','Show password');
   password.value='';
   $('authHelpMessage')?.classList.add('hidden');
  }
  const focus=page==='login'?username:page==='register'?$('regUsername'):$('resetIdentifier');
  if(focus)requestAnimationFrame(()=>focus.focus());
 }
 async function post(url,body){
  const res=await fetch(url,{method:'POST',credentials:'same-origin',cache:'no-store',
   headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(data.error||'Request failed ('+res.status+').');
  return data;
 }
 toggle.addEventListener('click',()=>{
  const visible=password.type==='password';
  password.type=visible?'text':'password';
  toggle.setAttribute('aria-pressed',String(visible));
  toggle.setAttribute('aria-label',visible?'Hide password':'Show password');
  toggle.setAttribute('title',visible?'Hide password':'Show password');
 });
 form.addEventListener('submit',()=>{
  try{
   if(remember.checked)localStorage.setItem(KEY,username.value.trim());
   else localStorage.removeItem(KEY);
  }catch(_){}
 });
 remember.addEventListener('change',()=>{if(!remember.checked){try{localStorage.removeItem(KEY)}catch(_){}}});
 let features={emailOtpAvailable:false,publicOwnerSignupAvailable:false};
 fetch('/api/status',{credentials:'same-origin',cache:'no-store'}).then(r=>r.json()).then(d=>{
  if(d.authFeatures)features=d.authFeatures;
 }).catch(()=>{});
 $('authForgotPassword').addEventListener('click',()=>{
  show('reset');
  if(!features.emailOtpAvailable)message('resetMessage','Email OTP is not configured for this website. The administrator must set up an email sender before reset codes can be delivered.',true);
 });
 $('authSignupButton').addEventListener('click',()=>{
  show('register');
  if(!features.publicOwnerSignupAvailable)message('regMessage','Self-service Owner registration is not active yet. Account isolation must be completed before new franchises can safely access the POS.',true);
 });
 document.querySelectorAll('[data-auth-back]').forEach(button=>button.addEventListener('click',()=>show('login')));
 document.querySelectorAll('[data-toggle-password]').forEach(button=>button.addEventListener('click',()=>{
  const target=$(button.dataset.togglePassword);
  if(!target)return;
  const visible=target.type==='password';target.type=visible?'text':'password';
  button.textContent=visible?'Hide':'Show';
  button.setAttribute('aria-label',visible?'Hide password':'Show password');
 }));
 const regUsername=$('regUsername'),userStatus=$('regUsernameStatus');
 async function usernameAvailable(){
  const value=regUsername.value.trim(),seq=++checkSeq;
  available=false;
  if(!/^[a-zA-Z0-9._-]{3,80}$/.test(value)){
   message('regUsernameStatus','Use 3–80 letters, numbers, dots, dashes or underscores.',true);return false;
  }
  message('regUsernameStatus','Checking username…');
  try{
   const res=await fetch('/api/auth/username-available?username='+encodeURIComponent(value),
     {credentials:'same-origin',cache:'no-store'});
   if(!res.ok)throw new Error();
   const data=await res.json();
   if(seq!==checkSeq)return false;
   available=!!data.available;
   message('regUsernameStatus',available?'Username is available.':'Username already in use across a franchise account.',!available);
   return available;
  }catch(_){
   if(seq===checkSeq)message('regUsernameStatus','Unable to check username. Try again.',true);
   return false;
  }
 }
 regUsername.addEventListener('blur',usernameAvailable);
 regUsername.addEventListener('input',()=>{++checkSeq;available=false;message('regUsernameStatus','Check username availability before submitting.');});
 $('authRegisterForm').addEventListener('submit',async event=>{
  event.preventDefault();
  const btn=$('regSubmit');if(btn.disabled)return;
  btn.disabled=true;
  try{
   if(!available&&!(await usernameAvailable()))throw new Error('Choose an available username.');
   const value=$('regPassword').value,confirmation=$('regConfirmPassword').value;
   if(value!==confirmation)throw new Error('The passwords do not match.');
   if(value.length<10||!/[a-zA-Z]/.test(value)||!/[0-9]/.test(value))
    throw new Error('Use at least 10 characters with letters and numbers.');
   message('regMessage','Checking registration availability…');
   const result=await post('/api/auth/register',{
    username:regUsername.value.trim(),fullName:$('regFullName').value.trim(),
    email:$('regEmail').value.trim(),phone:$('regPhone').value.trim(),
    password:value,confirmPassword:confirmation
   });
   message('regMessage',result.message||'Account request received.');
  }catch(e){message('regMessage',e.message,true);}
  finally{btn.disabled=false;}
 });
 const requestForm=$('authResetRequestForm'),verifyForm=$('authResetConfirmForm');
 async function sendCode(){
  const btn=$('resetSend'),identifier=$('resetIdentifier').value.trim();
  if(!identifier){message('resetMessage','Enter a username or email.',true);return;}
  if(btn.disabled)return;
  btn.disabled=true;
  try{
   message('resetMessage','Requesting your email code…');
   const result=await post('/api/auth/forgot/request',{identifier});
   message('resetMessage',result.message||'If the account has a registered email, you will receive an OTP.');
   requestForm.classList.add('hidden');verifyForm.classList.remove('hidden');
  }catch(e){message('resetMessage',e.message,true);}
  finally{btn.disabled=false;}
 }
 requestForm.addEventListener('submit',e=>{e.preventDefault();sendCode();});
 $('resetResend').addEventListener('click',()=>sendCode());
 verifyForm.addEventListener('submit',async e=>{
  e.preventDefault();
  const btn=$('resetConfirm');
  if(btn.disabled)return;
  const value=$('resetPassword').value,confirm=$('resetConfirmPassword').value;
  if(value!==confirm){message('resetMessage','The new passwords do not match.',true);return;}
  btn.disabled=true;
  try{
   const result=await post('/api/auth/forgot/confirm',{
    identifier:$('resetIdentifier').value.trim(),code:$('resetCode').value.trim(),
    password:value,confirmPassword:confirm
   });
   verifyForm.reset();requestForm.reset();
   requestForm.classList.remove('hidden');verifyForm.classList.add('hidden');
   show('login');
   message('authHelpMessage',result.message||'Password updated. Sign in again.');
  }catch(err){message('resetMessage',err.message,true);}
  finally{btn.disabled=false;}
 });
 window.donmacLoginExperience={restore,show};
 restore();
})();
