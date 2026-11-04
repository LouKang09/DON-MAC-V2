/* v1.5.74 — purely login UI controls; authentication remains in app-core.js. */
(()=>{
 'use strict';
 const $=id=>document.getElementById(id);
 const form=$('authForm'),password=$('authPassword'),username=$('authUsername');
 if(!form||!password||!username)return;
 const toggle=$('authPasswordToggle'),remember=$('authRememberUsername');
 const help=$('authHelpMessage');
 const KEY='donmac_login_remembered_username';
 const showHelp=message=>{
   help.textContent=message;
   help.classList.remove('hidden');
 };
 function restore(){
   try{
     const stored=localStorage.getItem(KEY);
     if(stored&&stored.length<=80){
       remember.checked=true;
       if(!username.value)username.value=stored;
     }else remember.checked=false;
   }catch(_){remember.checked=false;}
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
 remember.addEventListener('change',()=>{
   if(!remember.checked){try{localStorage.removeItem(KEY)}catch(_){}}
 });
 $('authForgotPassword').addEventListener('click',()=>{
   showHelp('Password resets are handled by your franchise Owner or Co-Owner. Ask them to update your cashier account password.');
 });
 $('authSignupButton').addEventListener('click',()=>{
   showHelp('To create a new account, contact your franchise Owner. Owners can register cashiers and Co-Owners inside Branches & Cashiers.');
 });
 window.donmacLoginExperience={restore,showHelp};
 restore();
})();
