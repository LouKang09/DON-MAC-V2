/* Don Mac operational disclaimers → accessible information buttons.
 * Applies only to static explanatory notes, not errors, approvals,
 * essential form consent, balances or changing transaction statuses.
 * The original wording is preserved verbatim in an accessible dialog.
 */
(()=>{
 'use strict';
 if(window.donmacDisclaimers)return;
 const app=document.getElementById('app')||document.getElementById('officeApp');
 if(!app)return;
 const noteTerms=/\b(?:does not|do not|cannot|never|not automatically|not included|excluded|excluding|limited by|limited to|retain|preserv|manual verification|manually|historical|billed per|billed separately|not tracked|not counted|before selling|before approval|must be|cannot be|doesn't|not yet|only after)\b/i;
 const noteSelectors=[
  '#officeApp .office-campaign-inventory-note',
  '#officeApp #page-catalog > .panel > p.muted',
  '#officeApp #page-dashboard .warehouse-cost-review > p.muted',
  '#officeApp #page-franchisees .franchise-detail p.muted',
  '#app main.main .view p.muted',
  '#app main.main .view p.inv-direct-stock-tip',
  '#app main.main .view p.advanced-data-notice',
  '#officeApp .office-page p.muted',
  '#officeApp .office-page p.distribution-note'
 ].join(',');
 const dialog=document.createElement('dialog');
 dialog.className='dm-info-note-dialog';dialog.id='dmInfoNoteDialog';
 dialog.setAttribute('aria-labelledby','dmInfoNoteHeading');
 dialog.innerHTML='<div class="dm-info-note-header"><h3 id="dmInfoNoteHeading">Information</h3>'+
  '<button type="button" class="dm-info-note-close" aria-label="Close information">×</button></div>'+
  '<p id="dmInfoNoteContent"></p><div class="dm-info-note-actions">'+
  '<button type="button" class="dm-info-note-done">Got it</button></div>';
 document.body.appendChild(dialog);
 const dismiss=()=>{if(dialog.open&&typeof dialog.close==='function')dialog.close();else dialog.removeAttribute('open')};
 dialog.querySelectorAll('.dm-info-note-close,.dm-info-note-done').forEach(b=>b.addEventListener('click',dismiss));
 dialog.addEventListener('click',e=>{if(e.target===dialog)dismiss()});
 const open=message=>{
  document.getElementById('dmInfoNoteContent').textContent=message;
  if(typeof dialog.showModal==='function'){
   if(!dialog.open)dialog.showModal();
  }else dialog.setAttribute('open','');
 };
 function shouldWrap(el){
  if(!el||el.dataset.dmInfoWrapped||el.closest('.dm-info-note-dialog,.dm-info-disclosure'))return false;
  if(el.closest('[role="alert"],[role="status"],.toast,.notification,.warning,.error,.popover,.chat-history,.auth-login,.auth-secondary,.modal,.overlay'))return false;
  if(el.id&&/notice|status|warning|feedback|error/i.test(el.id))return false;
  if(el.querySelector('a,button,input,select,textarea,strong[role="alert"]'))return false;
  const message=(el.textContent||'').replace(/\s+/g,' ').trim();
  if(message.length<74||!noteTerms.test(message))return false;
  // Keep required legal disclosures and user confirmations visible.
  if(el.closest('.auth-page,.auth-panel,.auth-screen,[data-terms],[data-policy]'))return false;
  if(el.closest('label,summary'))return false;
  return true;
 }
 let wrapCount=0;
 function scan(){
  for(const el of app.querySelectorAll(noteSelectors)){
   if(!shouldWrap(el))continue;
   const message=(el.textContent||'').replace(/\s+/g,' ').trim();
   const button=document.createElement('button');button.type='button';
   button.className='dm-info-disclosure';button.dataset.dmInfoWrapped='true';
   button.setAttribute('aria-label','More information: '+message.slice(0,105));
   button.setAttribute('title','View important information');
   button.innerHTML='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+
    '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></svg><span class="dm-info-sr-only">Information</span>';
   button.addEventListener('click',()=>open(message));
   el.replaceWith(button);wrapCount++;
  }
 }
 let pending=false;
 const schedule=()=>{if(pending)return;pending=true;setTimeout(()=>{pending=false;scan()},70)};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',scan,{once:true});
 else scan();
 const observer=new MutationObserver(records=>{
  if(records.some(record=>[...record.addedNodes].some(n=>n.nodeType===1&&
   (n.matches?.('p,.office-page,.view,.panel')||n.querySelector?.('p')))))schedule();
 });
 observer.observe(app,{childList:true,subtree:true});
 window.donmacDisclaimers={refresh:schedule,stats:()=>({converted:wrapCount})};
})();
