/* Don Macchiatos team messages — browser client; no third-party chat services. */
(()=>{
 'use strict';
 const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 if(!$('view-chat'))return;
 const state={contacts:[],selected:0,messages:[],image:null,loading:false,sending:false,refreshing:false,open:false,unreadTimer:null,threadTimer:null,turn:0,hasMore:false};
 const emojis=['❤️','👍','😂','😮','😢','🙏'];
 function mineUserId(){return Number(window.donmacChat?.userId||0);}
 function dateString(value){try{return new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(value));}catch(_){return '';}}
 function initials(name){return String(name||'?').trim().split(/\s+/).slice(0,2).map(x=>x[0]?.toUpperCase()||'').join('');}
 async function request(url,options={}){
   const ctrl=new AbortController(),t=setTimeout(()=>ctrl.abort(),18000);
   try{
     const resp=await fetch(url,{credentials:'same-origin',...options,signal:ctrl.signal,
       headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}});
     let data={};try{data=await resp.json();}catch(_){}
     if(!resp.ok)throw new Error(data.error||'Chat request failed ('+resp.status+').');
     return data;
   }finally{clearTimeout(t);}
 }
 function notice(msg){$('chatDraftError').textContent=msg;$('chatDraftError').classList.toggle('hidden',!msg);}
 function formatContact(c){
   const badge=c.isGroup?(c.groupKind==='all'?'ALL':'GC'):initials(c.username);
   return '<span class="chat-avatar'+(c.isGroup?' is-group':'')+'" aria-hidden="true">'+esc(badge)+'</span>'+
     '<span class="chat-person-info"><strong>'+esc(c.label)+'</strong><small>'+esc(c.subtitle)+'</small></span>';
 }
 function contactById(id){return state.contacts.find(c=>Number(c.id)===Number(id));}
 function ensureCheckoutClearance(){
   const launcher=$('chatFloatingLauncher'),pay=$('payButton');
   if(!launcher)return;
   let bottom=96;
   if(pay&&$('view-pos')?.classList.contains('active')){
     const rect=pay.getBoundingClientRect();
     // Only compensate while the Pay button is visible in the viewport.
     if(rect.bottom>0&&rect.top<innerHeight){
       const bubbleRight=innerWidth-(innerWidth>=700?Math.max(16,Math.min(32,innerWidth*.02)):15);
       const bubbleLeft=bubbleRight-56;
       const inX=rect.right>bubbleLeft-10&&rect.left<bubbleRight+10;
       const bubbleTop=innerHeight-bottom-56;
       const inY=rect.bottom>bubbleTop-10&&rect.top<innerHeight-bottom+10;
       if(inX&&inY){
         // Move the launcher up above Pay, leaving a visible 15px gap.
         bottom=Math.max(96,Math.min(innerHeight-64,innerHeight-rect.top+15));
       }
     }
   }
   launcher.style.setProperty('--chat-launcher-bottom',bottom+'px');
 }
 let clearanceQueued=false;
 function queueCheckoutClearance(){
   if(clearanceQueued)return;
   clearanceQueued=true;
   requestAnimationFrame(()=>{clearanceQueued=false;ensureCheckoutClearance();});
 }
 window.addEventListener('scroll',queueCheckoutClearance,{passive:true,capture:true});
 window.addEventListener('resize',queueCheckoutClearance,{passive:true});
 function updateUnread(total){
   const b=$('chatUnreadBadge');if(!b)return;
   b.textContent=total>99?'99+':String(total||'');
   b.classList.toggle('hidden',!total);
   b.setAttribute('aria-label',String(total||0)+' unread messages');
 }
 function renderContacts(){
   const query=$('chatSearch').value.trim().toLowerCase();
   const roster=state.contacts.filter(c=>(c.label+' '+c.subtitle).toLowerCase().includes(query));
   $('chatPeople').innerHTML=roster.length?roster.map((c,i)=>
      (i===0||!!roster[i-1].isGroup!==!!c.isGroup?'<div class="chat-list-heading">'+(c.isGroup?'GROUP CHATS':'DIRECT MESSAGES')+'</div>':'')+
      '<button type="button" class="chat-person'+(state.selected===c.id?' is-active':'')+'" data-contact="'+c.id+'" aria-current="'+(state.selected===c.id?'true':'false')+'">'+
       formatContact(c)+'<span class="chat-person-side">'+
       (c.unread?'<span class="chat-person-unread">'+(c.unread>99?'99+':c.unread)+'</span>':'')+
       (c.lastMessage?'<small class="chat-last-date">'+esc(dateString(c.lastMessage.createdAt))+'</small>':'')+
       '</span><span class="chat-person-last">'+esc(c.lastMessage?.text||(c.isGroup?'Team conversation':c.role==='Admin'?'Owner':'Tap to start a conversation'))+'</span></button>'
     ).join(''):'<div class="chat-empty">'+(query?'No matching team members.':'No other active members in your owner account yet.')+'</div>';
 }
 async function refreshContacts(){
   if(!window.donmacChat?.authenticated)return;
   try{
     const data=await request('/api/chat/people');
     const groupItems=(data.groups||[]).map(g=>({...g,id:-Number(g.id),groupId:Number(g.id),isGroup:true,groupKind:g.kind,
        username:g.kind==='all'?'All':g.label,label:g.kind==='all'?'All':g.label,
        subtitle:g.kind==='all'?'All Branches · Group Chat':'Branch Group Chat'}));
     state.contacts=[...groupItems,...(data.people||[])];updateUnread(data.unreadTotal||0);renderContacts();
     if(state.selected&&!contactById(state.selected)){
       state.selected=0;state.messages=[];renderHeader();renderMessages();
     }
   }catch(err){
     if(state.open)$('chatPeople').innerHTML='<p class="chat-empty">'+esc(err.message)+'</p>';
   }
 }
 function renderHeader(){
   const member=contactById(state.selected);
   $('chatThreadHeader').innerHTML=member?'<div class="chat-thread-person">'+formatContact(member)+'</div>'+
     '<div class="chat-thread-actions"><span class="chat-private-label">'+(member.isGroup?'Group conversation':'Private team chat')+'</span><button id="chatMobileBack" type="button" class="chat-mobile-back" aria-label="Back to contacts">Contacts</button></div>':
     '<div class="chat-thread-placeholder">Select a colleague to start chatting.</div>';
   $('chatCompose').classList.toggle('chat-compose-disabled',!member);
   $('chatText').disabled=!member;$('chatPhotoInput').disabled=!member;
   updateSend();
 }
 function updateSend(){
   $('chatSend').disabled=!state.selected||state.sending||(!$('chatText').value.trim()&&!state.image);
 }
 function renderMessage(m){
   const byMe=!!m.mine;
   const myReaction=m.reactions?.find(r=>Number(r.userId)===mineUserId())?.emoji;
   const reactions=(m.reactions||[]).reduce((p,r)=>(p[r.emoji]=(p[r.emoji]||0)+1,p),{});
   const row=emojis.filter(x=>reactions[x]).map(e=>'<span class="chat-reaction-pill'+(myReaction===e?' mine':'')+'">'+e+' '+reactions[e]+'</span>').join('');
   const text=m.deleted?'<span class="chat-deleted">Message deleted</span>':(m.text?'<p>'+esc(m.text).replace(/\n/g,'\n')+'</p>':'');
   const image=!m.deleted&&m.photo?'<button class="chat-message-photo" type="button" data-photo-id="'+m.id+'" aria-label="Open attached photo"><img src="'+esc(m.photo)+'" loading="lazy" alt="Photo shared in chat" /></button>':'';
   const actions=m.deleted?'':'<div class="chat-message-actions" aria-label="React to message">'+
     emojis.map(e=>'<button class="chat-emoji'+(myReaction===e?' is-mine':'')+'" type="button" data-message="'+m.id+'" data-emoji="'+e+'" aria-label="React '+e+'">'+e+'</button>').join('')+
     (byMe?'<button type="button" class="chat-delete-message" data-delete="'+m.id+'" aria-label="Delete message">Delete</button>':'')+'</div>';
   return '<article class="chat-message '+(byMe?'is-mine':'is-theirs')+'" data-message-id="'+m.id+'">'+
     (m.senderLabel&&!byMe?'<div class="chat-message-sender">'+esc(m.senderLabel)+'</div>':'')+
     '<div class="chat-bubble">'+image+text+'<div class="chat-msg-meta">'+esc(dateString(m.createdAt))+
     (byMe&&!m.deleted?' · '+(m.readAt?'Seen':'Sent'):'')+'</div></div>'+
     (row?'<div class="chat-reaction-list">'+row+'</div>':'')+actions+'</article>';
 }
 function renderMessages(opts={}){
   const box=$('chatMessages'),stick=opts.stick!==false;
   const previousBottom=box.scrollHeight-box.scrollTop-box.clientHeight;
   if(!state.selected){
     box.innerHTML='<div class="chat-thread-start">Your team conversations are visible only to your owner account.</div>';
     return;
   }
   const list=state.messages.map(renderMessage).join('');
   box.innerHTML=(state.hasMore?'<button type="button" id="chatLoadEarlier" class="chat-load-earlier">Load earlier messages</button>':'')+
     (list||'<div class="chat-thread-start">No messages yet. Say hello!</div>');
   if(stick||previousBottom<75)box.scrollTop=box.scrollHeight;
 }
 async function refreshThread(force=false){
   const id=state.selected;if(!id||!state.open||state.refreshing)return;
   const turn=state.turn;state.refreshing=true;
   try{
     const after=!force&&state.messages.length?state.messages[state.messages.length-1].id:0;
     const path=id<0?'/api/chat/groups/'+(-id)+'/messages':'/api/chat/messages/'+id;
     const data=await request(path+(after?'?after='+encodeURIComponent(after):''));
     if(turn!==state.turn||state.selected!==id)return;
     if(after){
       const seen=new Set(state.messages.map(m=>m.id));
       const fresh=(data.messages||[]).filter(m=>!seen.has(m.id));
       if(fresh.length){state.messages=state.messages.concat(fresh);renderMessages();}
     }else{
       const oldLength=state.messages.length;
       state.messages=data.messages||[];state.hasMore=!!data.hasMore;
       renderMessages({stick:!oldLength});
     }
     if((data.messages||[]).some(m=>!m.mine&&!m.readAt)){
       await request(id<0?'/api/chat/groups/'+(-id)+'/read':'/api/chat/read/'+id,{method:'POST',body:'{}'});
       refreshContacts().catch(()=>{});
     }
   }catch(err){notice(err.message);}
   finally{state.refreshing=false;}
 }
 async function setContact(id){
   if(state.selected===id&&state.open)return;
   state.selected=id;state.messages=[];state.hasMore=false;state.turn++;
   notice('');renderContacts();renderHeader();renderMessages();
   $('view-chat').classList.add('chat-thread-open');
   await refreshThread(true);
 }
 async function loadEarlier(){
   if(!state.messages.length||!state.hasMore||state.refreshing)return;
   const first=state.messages[0].id,id=state.selected,turn=state.turn;
   try{
     const box=$('chatMessages'),prevHeight=box.scrollHeight;
     const url=id<0?'/api/chat/groups/'+(-id)+'/messages':'/api/chat/messages/'+id;
     const data=await request(url+'?before='+first);
     if(turn!==state.turn)return;
     state.messages=[...data.messages,...state.messages];
     state.hasMore=!!data.hasMore;renderMessages({stick:false});
     box.scrollTop+=box.scrollHeight-prevHeight;
   }catch(err){notice(err.message);}
 }
 async function makePhoto(file){
   if(file.size>1024*1024)throw new Error('Photo must be 1 MB or smaller.');
   if(file.size<30||!['image/jpeg','image/png','image/webp'].includes(file.type))
     throw new Error('Choose a valid JPG, PNG or WebP image.');
   const header=new Uint8Array(await file.slice(0,16).arrayBuffer());
   const valid=file.type==='image/jpeg'&&header[0]===255&&header[1]===216&&header[2]===255||
      file.type==='image/png'&&[137,80,78,71,13,10,26,10].every((x,i)=>header[i]===x)||
      file.type==='image/webp'&&String.fromCharCode(...header.slice(0,4))==='RIFF'&&String.fromCharCode(...header.slice(8,12))==='WEBP';
   if(!valid)throw new Error('The selected file is not a valid photo.');
   const url=URL.createObjectURL(file),img=new Image();
   try{
     await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('Photo could not be decoded.'));img.src=url;});
     if(!img.naturalWidth||!img.naturalHeight||img.naturalWidth>10000||img.naturalHeight>10000)
       throw new Error('The photo dimensions are not supported.');
     const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
     if(!ctx)throw new Error('Your browser cannot compress photos.');
     for(const edge of [1100,900,700,560,420,320]){
       const ratio=Math.min(1,edge/Math.max(img.naturalWidth,img.naturalHeight));
       canvas.width=Math.max(1,Math.round(img.naturalWidth*ratio));
       canvas.height=Math.max(1,Math.round(img.naturalHeight*ratio));
       ctx.clearRect(0,0,canvas.width,canvas.height);
       ctx.drawImage(img,0,0,canvas.width,canvas.height);
       for(const quality of [.75,.62,.5]){
         let data=canvas.toDataURL('image/webp',quality);
         if(!data.startsWith('data:image/webp;'))data=canvas.toDataURL('image/jpeg',quality);
         const bytes=Math.ceil((data.length-data.indexOf(',')-1)*3/4);
         if(bytes<120*1024)return data;
       }
     }
     throw new Error('Photo could not be compressed to 120 KB. Choose another photo.');
   }finally{URL.revokeObjectURL(url);}
 }
 function photoPreview(){
   const box=$('chatPhotoDraft');box.classList.toggle('hidden',!state.image);
   box.innerHTML=state.image?'<img src="'+esc(state.image)+'" alt="Photo to send"/><span>Photo ready</span>'+
     '<button type="button" id="chatRemovePhoto" aria-label="Remove attached photo">×</button>':'';
   updateSend();
 }
 async function send(e){
   e.preventDefault();if(state.sending||!state.selected)return;
   const text=$('chatText').value.trim(),photo=state.image;
   if(!text&&!photo)return;
   state.sending=true;updateSend();notice('');
   const partner=state.selected;
   try{
     const url=partner<0?'/api/chat/groups/'+(-partner)+'/messages':'/api/chat/messages';
     const payload=partner<0?{text,photo}:{recipientId:partner,text,photo};
     await request(url,{method:'POST',body:JSON.stringify(payload)});
     $('chatText').value='';state.image=null;$('chatPhotoInput').value='';photoPreview();
     await refreshThread(true);await refreshContacts();
   }catch(err){notice(err.message);}
   finally{state.sending=false;updateSend();}
 }
 async function react(id,emoji){
   const msg=state.messages.find(m=>m.id===id);if(!msg)return;
   const mine=msg.reactions?.find(r=>r.userId===mineUserId())?.emoji;
   try{
     const url=state.selected<0?'/api/chat/groups/'+(-state.selected)+'/reaction/'+id:'/api/chat/reaction/'+id;
     await request(url,{method:mine===emoji?'DELETE':'PUT',
       body:mine===emoji?'{}':JSON.stringify({emoji})});
     // Refresh the whole thread so all reaction badges reflect the server.
     await refreshThread(true);
   }catch(err){notice(err.message);}
 }
 async function remove(id){
   if(!confirm('Delete this message for both people?'))return;
   const url=state.selected<0?'/api/chat/groups/'+(-state.selected)+'/message/'+id:'/api/chat/message/'+id;
   try{await request(url,{method:'DELETE',body:'{}'});await refreshThread(true);await refreshContacts();}
   catch(err){notice(err.message);}
 }
 function stopThread(){if(state.threadTimer){clearInterval(state.threadTimer);state.threadTimer=null;}}
 function open(){
   if(!window.donmacChat?.authenticated)return;
   const panel=$('chatFloatingPanel'),launcher=$('chatFloatingLauncher');
   if(!panel||!launcher)return;
   if(state.open)return close();
   state.open=true;
   queueCheckoutClearance();
   panel.classList.remove('hidden');
   launcher.classList.add('is-open');
   launcher.setAttribute('aria-expanded','true');
   launcher.setAttribute('aria-label','Close team messages');
   $('view-chat').classList.remove('chat-thread-open');
   notice('');refreshContacts();
   renderHeader();renderMessages();
   stopThread();let cycle=0;
   state.threadTimer=setInterval(()=>{
     if(document.hidden||!state.open)return;
     cycle++;
     refreshThread(cycle%8===0);
     if(cycle%3===0)refreshContacts();
   },5000);
   if(window.innerWidth>699)$('chatSearch').focus({preventScroll:true});
 }
 function close(){
   state.open=false;stopThread();
   const panel=$('chatFloatingPanel'),launcher=$('chatFloatingLauncher');
   panel?.classList.add('hidden');
   launcher?.classList.remove('is-open');
   launcher?.setAttribute('aria-expanded','false');
   launcher?.setAttribute('aria-label','Open team messages');
 }
 function resetSession(){
   close();if(state.unreadTimer){clearInterval(state.unreadTimer);state.unreadTimer=null;}
   state.contacts=[];state.selected=0;state.messages=[];state.turn++;
   state.image=null;photoPreview();updateUnread(0);
 }
 function loggedIn(id){
   window.donmacChat.userId=Number(id)||0;
   window.donmacChat.authenticated=!!id;
   if(!id){resetSession();return;}
   refreshContacts();
   queueCheckoutClearance();
   if(!state.unreadTimer)state.unreadTimer=setInterval(()=>{
     if(!document.hidden&&window.donmacChat?.authenticated)refreshContacts();
   },15000);
 }
 $('chatFloatingLauncher').addEventListener('click',open);
 $('chatFloatingClose').addEventListener('click',()=>{
   close();$('chatFloatingLauncher').focus({preventScroll:true});
 });
 document.addEventListener('keydown',e=>{
   if(e.key==='Escape'&&state.open&&!$('chatPhotoViewer').open){
     close();$('chatFloatingLauncher').focus({preventScroll:true});
   }
 });
 // A chat window should never trap clicks intended for the payment system.
 document.addEventListener('pointerdown',e=>{
   if(!state.open||$('chatPhotoViewer')?.open)return;
   const panel=$('chatFloatingPanel'),launcher=$('chatFloatingLauncher');
   if(!panel.contains(e.target)&&!launcher.contains(e.target))close();
 });
 $('chatSearch').addEventListener('input',renderContacts);
 $('chatRefresh').addEventListener('click',refreshContacts);
 $('chatPeople').addEventListener('click',e=>{
   const item=e.target.closest('button[data-contact]');
   if(item)setContact(Number(item.dataset.contact));
 });
 $('chatThreadHeader').addEventListener('click',e=>{
   if(e.target.closest('#chatMobileBack'))$('view-chat').classList.remove('chat-thread-open');
 });
 $('chatText').addEventListener('input',updateSend);
 $('chatText').addEventListener('keydown',e=>{
   if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('chatCompose').requestSubmit();}
 });
 $('chatCompose').addEventListener('submit',send);
 $('chatPhotoInput').addEventListener('change',async e=>{
   const file=e.target.files?.[0];if(!file)return;notice('');
   try{state.image=await makePhoto(file);photoPreview();}catch(err){notice(err.message);e.target.value='';}
 });
 $('chatPhotoDraft').addEventListener('click',e=>{
   if(e.target.closest('#chatRemovePhoto')){state.image=null;$('chatPhotoInput').value='';photoPreview();}
 });
 $('chatMessages').addEventListener('click',e=>{
   const more=e.target.closest('#chatLoadEarlier');if(more){loadEarlier();return;}
   const pic=e.target.closest('[data-photo-id]');
   if(pic){
     const item=state.messages.find(m=>m.id===Number(pic.dataset.photoId));
     if(item?.photo){$('chatPhotoLarge').src=item.photo;$('chatPhotoViewer').showModal();}
     return;
   }
   const reaction=e.target.closest('button[data-emoji]');if(reaction){react(Number(reaction.dataset.message),reaction.dataset.emoji);return;}
   const del=e.target.closest('button[data-delete]');if(del)remove(Number(del.dataset.delete));
 });
 $('chatPhotoClose').addEventListener('click',()=>$('chatPhotoViewer').close());
 $('chatPhotoViewer').addEventListener('close',()=>{$('chatPhotoLarge').removeAttribute('src');});
 window.donmacChat={open,close,loggedIn,userId:0,authenticated:false};
})();
