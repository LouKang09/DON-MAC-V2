/* v1.5.75 — Don Mac login, global username check, and OTP recovery pages.
 * Never store passwords, OTPs, or session tokens locally. */
(()=>{
 'use strict';
 const $=id=>document.getElementById(id);
 const form=$('authForm'),password=$('authPassword'),username=$('authUsername');
 if(!form||!password||!username)return;
 const remember=$('authRememberUsername'),toggle=$('authPasswordToggle');
 const KEY='donmac_login_remembered_username';
 const cashierApp=/\bDonMacCashierApp\/1\b/.test(navigator.userAgent);
 document.documentElement.classList.toggle('dm-cashier-apk',cashierApp);
 const phoneLayout=window.matchMedia('(max-width:699px)');
 const syncMobileLogin=()=>document.documentElement.classList.toggle('dm-phone-layout',cashierApp||phoneLayout.matches);
 syncMobileLogin();phoneLayout.addEventListener?.('change',syncMobileLogin);
 if(cashierApp)$('authSignupPrompt')?.classList.add('hidden');
 const pageIds={login:null,register:'authRegisterPanel',reset:'authResetPanel'};
 let page='login',checkSeq=0,available=false;
 let pendingApplicationId=null;
 let otpCooldownUntil=0,otpTicker=null,sendingOtp=false;
 const OTP_RESEND_MS=60000;
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
  if(!Object.hasOwn(pageIds,next)||(cashierApp&&next==='register'))next='login';
  page=next;
  Object.entries(pageIds).forEach(([type,id])=>{
   if(id)$(id).classList.toggle('hidden',type!==page);
  });
  form.classList.toggle('hidden',page!=='login');
  // Avoid hiding a stale password or code on return to sign in.
  if(page==='login'){
   $('regVerifyPassword').value='';$('regVerifyConfirmPassword').value='';
   $('authRegisterVerifyForm').classList.add('hidden');$('authRegisterForm').classList.remove('hidden');
   pendingApplicationId=null;
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
 let features={emailOtpAvailable:false,publicOwnerSignupAvailable:false,publicFranchiseRequestAvailable:true,franchiseEmailOtpAvailable:false};
 fetch('/api/status',{credentials:'same-origin',cache:'no-store'}).then(r=>r.json()).then(d=>{
  if(d.authFeatures)features=d.authFeatures;
 }).catch(()=>{});
 $('authForgotPassword').addEventListener('click',()=>{
  show('reset');
  if(!features.emailOtpAvailable)message('resetMessage','Email OTP is not configured for this website. The administrator must set up an email sender before reset codes can be delivered.',true);
 });
 $('authSignupButton').addEventListener('click',()=>{
  show('register');
  if(!features.publicFranchiseRequestAvailable)message('regMessage','Franchise requests are temporarily unavailable. Contact Admin Control.',true);
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
 const regEmail=$('regEmail');
 let emailSeq=0,emailTimer;
 async function checkSignupEmail(){
  clearTimeout(emailTimer);
  const value=regEmail.value.trim(),seq=++emailSeq;
  if(!value||!regEmail.checkValidity()){message('regEmailStatus','Enter a valid email address.',true);return false;}
  message('regEmailStatus','Checking email availability…');
  try{
   const result=await post('/api/auth/email-available',{email:value});
   if(seq!==emailSeq||regEmail.value.trim()!==value)return false;
   message('regEmailStatus',result.available?'Email is available.':result.reason||'This email is already registered.',!result.available);
   return result.available===true;
  }catch(err){if(seq===emailSeq)message('regEmailStatus',err.message||'Unable to check email. Try again.',true);return false;}
 }
 regEmail.addEventListener('input',()=>{++emailSeq;clearTimeout(emailTimer);message('regEmailStatus','');if(regEmail.value&&regEmail.checkValidity())emailTimer=setTimeout(checkSignupEmail,650);});
 regEmail.addEventListener('blur',()=>{if(regEmail.value)void checkSignupEmail();});
 const regPhone=$('regPhone');
 let phoneSeq=0,phoneTimer;
 async function checkSignupPhone(){
  clearTimeout(phoneTimer);
  const value=regPhone.value.trim(),seq=++phoneSeq;
  if(!/^[+\d\s().-]{7,32}$/.test(value)){message('regPhoneStatus','Enter a valid phone number.',true);return false;}
  message('regPhoneStatus','Checking phone number…');
  try{
   const result=await post('/api/auth/phone-available',{phone:value});
   if(seq!==phoneSeq||regPhone.value.trim()!==value)return false;
   message('regPhoneStatus',result.available?'Phone number is available.':result.reason||'This phone number is already registered.',!result.available);
   return result.available===true;
  }catch(err){if(seq===phoneSeq)message('regPhoneStatus',err.message||'Unable to check phone number. Try again.',true);return false;}
 }
 regPhone.addEventListener('input',()=>{++phoneSeq;clearTimeout(phoneTimer);message('regPhoneStatus','');if(/^[+\d\s().-]{7,32}$/.test(regPhone.value.trim()))phoneTimer=setTimeout(checkSignupPhone,700);});
 regPhone.addEventListener('blur',()=>{if(regPhone.value)void checkSignupPhone();});
 const signupDigits=[...document.querySelectorAll('[data-signup-digit]')];
 function collectSignupCode(){
   $('regVerifyCode').value=signupDigits.map(input=>input.value).join('');
   if(signupDigits.every(input=>/^\d$/.test(input.value)))$('authRegisterVerifyForm').requestSubmit();
 }
 function fillSignupCode(value,start=0){
   const digits=String(value).replace(/\D/g,'').slice(0,6);
   if(digits.length===6)start=0;
   for(let i=0;i<digits.length&&start+i<6;i++)signupDigits[start+i].value=digits[i];
   if(digits.length)signupDigits[Math.min(5,start+digits.length)]?.focus();collectSignupCode();
 }
 signupDigits.forEach((input,i)=>{
   input.addEventListener('input',()=>{const value=input.value;input.value='';fillSignupCode(value,i);});
   input.addEventListener('paste',event=>{event.preventDefault();fillSignupCode(event.clipboardData.getData('text'),i);});
   input.addEventListener('keydown',event=>{if(event.key==='Backspace'&&!input.value&&i>0)signupDigits[i-1].focus();});
 });
 $('authRegisterForm').addEventListener('submit',async event=>{
  event.preventDefault();
  const btn=$('regSubmit');if(btn.disabled)return;
  btn.disabled=true;
  try{
   if(!available&&!(await usernameAvailable()))throw new Error('Choose an available username.');
   if(!(await checkSignupEmail()))throw new Error('Use an available email address or try again.');
   if(!(await checkSignupPhone()))throw new Error('Use an available phone number or try again.');
   const pw=$('regVerifyPassword').value;
   if(pw.length<10||pw.length>128||!/[A-Za-z]/.test(pw)||!/[0-9]/.test(pw))throw new Error('Use 10–128 characters with at least one letter and one number.');
   if(pw!==$('regVerifyConfirmPassword').value)throw new Error('Passwords do not match.');
   message('regMessage','Submitting your franchise request…');
   const result=await post('/api/auth/register',{
    username:regUsername.value.trim(),fullName:$('regFullName').value.trim(),
    email:$('regEmail').value.trim(),phone:$('regPhone').value.trim()
   });
   pendingApplicationId=result.applicationId||null;
   message('regMessage',result.message||'Account request received.');
   if(result.verificationRequired){
     $('authRegisterForm').classList.add('hidden');$('regMessage').classList.add('hidden');
     $('authRegisterVerifyForm').classList.remove('hidden');
     $('regVerifyCode').value='';
     signupDigits.forEach(input=>input.value='');signupDigits[0]?.focus();
   }
  }catch(e){message('regMessage',e.message,true);}
  finally{btn.disabled=false;}
 });
 $('authRegisterVerifyForm').addEventListener('submit',async event=>{
  event.preventDefault();
  const btn=$('regVerifySubmit');if(btn.disabled)return;
  const password=$('regVerifyPassword').value,confirmPassword=$('regVerifyConfirmPassword').value;
  if(password.length<10||password.length>128||!/[A-Za-z]/.test(password)||!/[0-9]/.test(password)){
   message('regVerifyMessage','Use 10–128 characters with at least one letter and one number.',true);return;
  }
  if(password!==confirmPassword){
   message('regVerifyMessage','Passwords do not match.',true);return;
  }
  btn.disabled=true;
  try{
   const verifiedUsername=regUsername.value.trim();
    const result=await post('/api/auth/register/verify',{
     email:$('regEmail').value.trim(),code:$('regVerifyCode').value.trim(),
     applicationId:pendingApplicationId,password,confirmPassword
   });
   $('regVerifyCode').value='';$('regVerifyPassword').value='';$('regVerifyConfirmPassword').value='';
   $('authRegisterVerifyForm').classList.add('hidden');
   $('authRegisterForm').classList.remove('hidden');$('authRegisterForm').reset();available=false;pendingApplicationId=null;signupDigits.forEach(input=>input.value='');
    if(result.signedIn){location.replace('/');return;}
    show('login');
   $('authUsername').value=result.username||verifiedUsername;
   $('authPassword').value='';
   message('authHelpMessage',result.message||'Account created. Sign in using your chosen password.');
  }catch(err){message('regVerifyMessage',err.message,true);}
  finally{btn.disabled=false;}
 });
 let lastSignupResend=0;
 $('regVerifyResend').addEventListener('click',async()=>{
  const btn=$('regVerifyResend');
  if(btn.disabled)return;
  if(Date.now()-lastSignupResend<60000){
   message('regVerifyMessage','Please allow one minute between verification emails.',true);return;
  }
  btn.disabled=true;
  try{
   const result=await post('/api/auth/register/verify/resend',{email:$('regEmail').value.trim(),applicationId:pendingApplicationId});
   lastSignupResend=Date.now();
   message('regVerifyMessage',result.message||'If the request is pending, a code will be delivered.');
  }catch(err){message('regVerifyMessage',err.message,true);}
  finally{btn.disabled=false;}
 });
 const requestForm=$('authResetRequestForm'),verifyForm=$('authResetConfirmForm');
 const resend=$('resetResend'),otpCountdown=$('resetOtpCountdown');
 const otpProgress=$('resetOtpProgress'),otpHint=$('resetOtpHint');
 function stopOtpTicker(){
   if(otpTicker!==null){clearInterval(otpTicker);otpTicker=null;}
 }
 function secondsRemaining(){
   return Math.max(0,Math.ceil((otpCooldownUntil-Date.now())/1000));
 }
 function renderOtpCountdown(){
   const secs=secondsRemaining(),active=secs>0;
   const fraction=Math.min(1,Math.max(0,(otpCooldownUntil-Date.now())/OTP_RESEND_MS));
   otpProgress.style.strokeDashoffset=String((1-fraction)*100);
   otpCountdown.textContent=String(Math.floor(secs/60)).padStart(2,'0')+':'+String(secs%60).padStart(2,'0');
   otpCountdown.classList.toggle('hidden',!active);
   resend.classList.toggle('hidden',active);
   resend.disabled=active||sendingOtp;
   resend.setAttribute('aria-disabled',String(resend.disabled));
   otpHint.textContent=active?'You can request a new code when the timer ends.':'Your code did not arrive? You can resend it now.';
   if(!active)stopOtpTicker();
 }
 function startOtpCooldown(){
   stopOtpTicker();
   otpCooldownUntil=Date.now()+OTP_RESEND_MS;
   renderOtpCountdown();
   otpTicker=setInterval(renderOtpCountdown,250);
 }
 function clearOtpCooldown(){
   stopOtpTicker();
   otpCooldownUntil=0;
   renderOtpCountdown();
 }
 async function sendCode(){
   const btn=$('resetSend'),username=$('resetIdentifier').value.trim(),email=$('resetEmail').value.trim().toLowerCase();
   if(!username){message('resetMessage','Enter your POS account username.',true);return;}
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){message('resetMessage','Enter the registered Gmail/email address for this account.',true);return;}
   if(sendingOtp||secondsRemaining()>0)return;
   sendingOtp=true;
   btn.disabled=true;
   resend.disabled=true;
   try{
     message('resetMessage','Requesting your email code…');
     const result=await post('/api/auth/forgot/request',{username,email});
     message('resetMessage',result.message||'Check the registered email address for your OTP.');
     if(!result.sent&&!result.cooldown)throw new Error(result.message||'The email request was not accepted.');
     requestForm.classList.add('hidden');
     verifyForm.classList.remove('hidden');
     startOtpCooldown();
   }catch(e){
     message('resetMessage',e.message,true);
   }finally{
     sendingOtp=false;btn.disabled=false;renderOtpCountdown();
   }
 }
 requestForm.addEventListener('submit',e=>{e.preventDefault();sendCode();});
 resend.addEventListener('click',()=>sendCode());
 verifyForm.addEventListener('submit',async e=>{
  e.preventDefault();
  const btn=$('resetConfirm');
  if(btn.disabled)return;
  const value=$('resetPassword').value,confirm=$('resetConfirmPassword').value;
  if(value!==confirm){message('resetMessage','The new passwords do not match.',true);return;}
  btn.disabled=true;
  try{
   const result=await post('/api/auth/forgot/confirm',{
    username:$('resetIdentifier').value.trim(),email:$('resetEmail').value.trim().toLowerCase(),code:$('resetCode').value.trim(),
    password:value,confirmPassword:confirm
   });
   verifyForm.reset();requestForm.reset();
   clearOtpCooldown();
   requestForm.classList.remove('hidden');verifyForm.classList.add('hidden');
   show('login');
   message('authHelpMessage',result.message||'Password updated. Sign in again.');
  }catch(err){message('resetMessage',err.message,true);}
  finally{btn.disabled=false;}
 });
 window.donmacLoginExperience={restore,show};
 restore();
})();
