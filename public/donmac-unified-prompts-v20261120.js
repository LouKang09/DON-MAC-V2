/* Don Macchiatos — unified accessible system prompts (2026-11-20).
   Explicit async API; never monkey-patch synchronous window.confirm/prompt.
   Keep checkout processing, branch access, and all server permissions intact. */
(()=>{
 'use strict';
 if(window.donmacPrompt)return;
 const state={dialog:null,heading:null,title:null,body:null,inputWrap:null,input:null,
  confirm:null,cancel:null,close:null,icon:null,current:null,queue:[],lastMessage:'',
  lastTime:0,restoringFocus:null};
 const icons={
  danger:'<path d="M12 2 2.5 20h19L12 2Z"/><path d="M12 8v5m0 3h.01"/>',
  warning:'<path d="M12 2 2.5 20h19L12 2Z"/><path d="M12 8v5m0 3h.01"/>',
  error:'<circle cx="12" cy="12" r="9.5"/><path d="m9 9 6 6m0-6-6 6"/>',
  success:'<circle cx="12" cy="12" r="9.5"/><path d="m7.5 12.5 3 3 6-7"/>',
  info:'<circle cx="12" cy="12" r="9.5"/><path d="M12 11v6m0-10h.01"/>'
 };
 const titleFor={danger:'Please Confirm',warning:'Attention Required',error:'Unable to Complete',
  success:'Successfully Updated',info:'System Notification'};
 const subtitleFor={danger:'CONFIRM ACTION',warning:'IMPORTANT NOTICE',error:'SYSTEM ALERT',
  success:'ACTION COMPLETED',info:'DON MAC POS'};
 const classify=(message,confirmation=false)=>{
  const m=String(message||'');
  if(confirmation&&/\b(delet(?:e|ion)?|remov(?:e|al)?|archiv\w*|restor\w*|void\w*|revok\w*|deactivat\w*|disabl\w*|reject\w*|declin\w*|overturn\w*|suspend\w*|clear|replac\w*)\b/i.test(m))return'danger';
  if(/\b(error|failed|failure|unable|could not|invalid|insufficient|unavailable|expired|cannot|can't|forbidden|denied|unauthorized)\b/i.test(m))return'error';
  if(/\b(must|required|please enter|before|warning|not enough|not found|missing|need to|not allowed|cannot|continue\?)\b/i.test(m))return'warning';
  if(/\b(success|created|completed|saved|recorded|updated|approved|submitted|sent|refreshed|verified|ready|up to date)\b/i.test(m))return'success';
  return confirmation?'warning':'info';
 };
 function init(){
  if(state.dialog)return true;
  if(!document.body)return false;
  const d=document.createElement('dialog');
  d.id='dmUnifiedSystemPrompt';d.className='dm-system-dialog';
  d.setAttribute('aria-labelledby','dmPromptHeading');
  d.setAttribute('aria-describedby','dmPromptBody');
  d.innerHTML='<div class="dm-system-card" data-prompt-variant="info">'+
   '<header class="dm-system-header">'+
   '<span class="dm-system-icon" aria-hidden="true"><svg id="dmPromptIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"></svg></span>'+
   '<div class="dm-system-head-copy"><span id="dmPromptHeading" class="dm-system-kicker">DON MAC POS</span>'+
   '<h2 id="dmPromptTitle">System Notification</h2></div>'+
   '<button type="button" class="dm-system-close" id="dmPromptClose" aria-label="Close notification">×</button>'+
   '</header><div class="dm-system-content">'+
   '<p id="dmPromptBody" class="dm-system-body"></p>'+
   '<label id="dmPromptInputWrap" class="dm-system-input-wrap" hidden>'+
   '<span id="dmPromptInputLabel">Details</span>'+
   '<textarea id="dmPromptInput" rows="3" maxlength="1000" spellcheck="true"></textarea>'+
   '</label></div>'+
   '<footer class="dm-system-actions">'+
   '<button class="dm-system-btn dm-system-btn-secondary" id="dmPromptCancel" type="button">Cancel</button>'+
   '<button class="dm-system-btn dm-system-btn-primary" id="dmPromptConfirm" type="button">OK</button>'+
   '</footer></div>';
  document.body.appendChild(d);
  state.dialog=d;
  state.heading=d.querySelector('#dmPromptHeading');
  state.title=d.querySelector('#dmPromptTitle');
  state.body=d.querySelector('#dmPromptBody');
  state.inputWrap=d.querySelector('#dmPromptInputWrap');
  state.input=d.querySelector('#dmPromptInput');
  state.confirm=d.querySelector('#dmPromptConfirm');
  state.cancel=d.querySelector('#dmPromptCancel');
  state.close=d.querySelector('#dmPromptClose');
  state.icon=d.querySelector('#dmPromptIcon');
  state.card=d.querySelector('.dm-system-card');
  state.confirm.addEventListener('click',()=>{
   if(!state.current)return;
   if(state.current.kind==='input'){
    const answer=state.input.value.trim();
    const min=Math.max(0,Number(state.current.minLength)||0);
    if(answer.length<min){
     state.input.setCustomValidity('Enter at least '+min+' characters.');
     state.input.reportValidity();state.input.focus();return;
    }
    settle(answer);return;
   }
   settle(state.current.kind==='confirm'?true:undefined);
  });
  state.cancel.addEventListener('click',()=>settle(state.current?.kind==='input'?null:false));
  state.close.addEventListener('click',()=>settle(state.current?.kind==='input'?null:false));
  d.addEventListener('cancel',e=>{
   e.preventDefault();settle(state.current?.kind==='input'?null:false);
  });
  d.addEventListener('click',e=>{if(e.target===d&&!state.current?.persistent)
    settle(state.current?.kind==='input'?null:false)});
  state.input.addEventListener('input',()=>state.input.setCustomValidity(''));
  return true;
 }
 function settle(value){
  const item=state.current;
  if(!item)return;
  state.current=null;
  if(state.dialog?.open)state.dialog.close();
  item.resolve(value);
  try{state.restoringFocus?.focus?.({preventScroll:true})}catch(_){}
  state.restoringFocus=null;
  if(state.queue.length)queueMicrotask(showNext);
 }
 function showNext(){
  if(state.current||!state.queue.length)return;
  if(!init()){
   const item=state.queue.shift();item.resolve(item.kind==='input'?null:false);return;
  }
  const item=state.queue.shift();state.current=item;
  const variant=['info','success','warning','error','danger'].includes(item.variant)?
   item.variant:classify(item.message,item.kind==='confirm');
  state.card.dataset.promptVariant=variant;
  state.dialog.setAttribute('role',item.kind==='confirm'||variant==='error'||variant==='danger'?'alertdialog':'dialog');
  state.heading.textContent=item.kicker||subtitleFor[variant];
  state.title.textContent=item.title||titleFor[variant];
  state.body.textContent=String(item.message||'');
  state.body.hidden=!item.message;
  state.icon.innerHTML=icons[variant]||icons.info;
  state.cancel.hidden=item.kind==='notice';
  state.cancel.textContent=item.cancelText||'Cancel';
  state.confirm.textContent=item.confirmText||(item.kind==='confirm'?'Continue':item.kind==='input'?'Submit':'OK');
  state.inputWrap.hidden=item.kind!=='input';
  state.input.value=item.defaultValue||'';
  state.input.setCustomValidity('');
  if(item.kind==='input'){
   state.input.placeholder=item.placeholder||'Enter details…';
   state.input.maxLength=Number(item.maxLength)||1000;
   state.inputWrap.querySelector('span').textContent=item.inputLabel||'Details';
  }
  state.close.hidden=item.persistent===true;
  state.restoringFocus=document.activeElement;
  try{state.dialog.showModal()}
  catch(_){state.current=null;item.resolve(item.kind==='input'?null:false);queueMicrotask(showNext);return}
  (item.kind==='input'?state.input:item.kind==='notice'?state.confirm:state.cancel).focus({preventScroll:true});
 }
 function enqueue(kind,message,options={}){
  const text=String(message??'').trim();
  if(!text)return Promise.resolve(kind==='confirm'?false:kind==='input'?null:undefined);
  const now=Date.now();
  if(kind==='notice'&&state.lastMessage===text&&now-state.lastTime<1400)
   return Promise.resolve(undefined);
  state.lastMessage=text;state.lastTime=now;
  return new Promise(resolve=>{
   // Ensure action confirmations never sit behind an accumulation of passive notices.
   if(kind!=='notice'){
    state.queue=state.queue.filter(item=>{
     if(item.kind==='notice'){item.resolve(undefined);return false}return true;
    });
    if(state.current?.kind==='notice')settle(undefined);
   }
   // Avoid queues of redundant background/status messages on rapid refresh.
   if(kind==='notice'){
    const waitingNotices=state.queue.filter(x=>x.kind==='notice');
    if(waitingNotices.length>=3){waitingNotices[0].resolve(undefined);
     state.queue.splice(state.queue.indexOf(waitingNotices[0]),1)}
   }
   state.queue.push({kind,message:text,resolve,...options});
   showNext();
  });
 }
 const notify=(message,options={})=>enqueue('notice',message,options);
 const confirm=(message,options={})=>enqueue('confirm',message,options);
 const input=(message,options={})=>enqueue('input',message,{variant:'warning',...options});
 const reset=()=>{
  for(const item of state.queue.splice(0))item.resolve(item.kind==='input'?null:false);
  if(state.current)settle(state.current.kind==='input'?null:false);
 };
 window.donmacPrompt={notify,confirm,input,reset,classify};
})();
