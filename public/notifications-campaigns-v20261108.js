(() => {
 'use strict';
 const $=id=>document.getElementById(id);
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=n=>'₱'+Number(n||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
 const time=n=>new Intl.DateTimeFormat('en-PH',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Manila'}).format(new Date(n));
 const count=n=>{
  const sec=Math.ceil(n/1000);if(sec<=0)return'Ended';
  const d=Math.floor(sec/86400),h=Math.floor(sec%86400/3600),m=Math.floor(sec%3600/60),s=sec%60;
  return(d?d+'d ':'')+[h,m,s].map(x=>String(x).padStart(2,'0')).join(':');
 };
 const screen=document.querySelector('.topbar-right');
 if(!screen)return;
 const modal=document.createElement('dialog');modal.className='dm-notifications-dialog';
 modal.id='franchiseNotificationDialog';
 modal.innerHTML='<div class="dm-notifications-card"><div class="dm-notifications-heading"><h2>Notifications</h2>'+
  '<button type="button" id="franchiseNotificationClose" aria-label="Close">×</button></div>'+
  '<div class="dm-notification-tabs" role="tablist">'+
   '<button type="button" data-notif-tab="system" class="active" role="tab">System Updates</button>'+
   '<button type="button" data-notif-tab="promotions" role="tab">Promotions <span id="franchisePromoCount"></span></button></div>'+
  '<div id="franchiseSystemTab" class="dm-notifications-content"></div>'+
  '<div id="franchisePromoTab" class="dm-notifications-content hidden" aria-live="polite"></div></div>';
 document.body.appendChild(modal);
 let tab='system',campaigns=[],lastPoll=0,loaded=false;
 const system=$('franchiseSystemTab'),promotions=$('franchisePromoTab');
 function systemUpdates(){
  const existing=$('whatsNewDialog');
  if(!existing){system.innerHTML='<p>System updates are currently unavailable.</p>';return;}
  const sections=[...existing.querySelectorAll('.update-section,.version-history-section')].map(e=>e.outerHTML);
  system.innerHTML='<div class="dm-notif-version">Current system updates and release notes</div>'+sections.join('');
 }
 function renderPromos(){
  const relevant=campaigns.filter(x=>x.active&&Date.parse(x.endsAt)>Date.now());
  $('franchisePromoCount').textContent=relevant.length?'('+relevant.length+')':'';
  promotions.innerHTML=relevant.length?relevant.map(x=>{
   const started=Date.now()>=Date.parse(x.startsAt),eligible=x.eligible&&started;
   return '<article class="dm-notif-promo"><div><strong>'+esc(x.title)+'</strong>'+
    '<span class="dm-promo-pill">'+(started?'LIVE':'UPCOMING')+'</span></div>'+
    '<p>'+esc(x.description||x.buttonName)+'</p>'+
    '<p><b>POS Button:</b> '+esc(x.buttonName)+' · '+money(x.price)+'</p>'+
    '<p class="dm-notif-times">'+time(x.startsAt)+' – '+time(x.endsAt)+'</p>'+
    '<p data-promo-timer="'+esc(x.endsAt)+'" data-promo-start="'+esc(x.startsAt)+'"></p>'+
    '<p class="'+(eligible?'dm-promo-ready':'dm-promo-locked')+'">'+(eligible?
      'Eligible to sell · '+Number(x.remaining||0)+' supply-backed sales remaining':
      started?'Not eligible to sell yet · purchase and receive the required Main Office supplies.':
       'Starts at the scheduled Philippine time.')+'</p>'+
    (!eligible&&window.donmacAuthenticatedRole==='Admin'?'<button type="button" data-promo-supply="1">View Main Office Supplies</button>':'')+
    '</article>';
  }).join(''):'<p class="dm-notif-empty">No active Main Office promotions.</p>';
  refreshTimers();
 }
 function refreshTimers(){
  promotions.querySelectorAll('[data-promo-timer]').forEach(node=>{
   const start=Date.parse(node.dataset.promoStart),end=Date.parse(node.dataset.promoTimer);
   node.textContent=Date.now()<start?'Starts in '+count(start-Date.now()):
     Date.now()<end?'Ends in '+count(end-Date.now()):'Ended';
   if(Date.now()>=end)node.closest('.dm-notif-promo')?.remove();
  });
 }
 async function loadPromos(force=false){
  if(!force&&Date.now()-lastPoll<25000&&loaded)return;
  if(!window.donmacAuthenticatedRole)return;
  lastPoll=Date.now();
  try{
   const response=await fetch('/api/office-promotions',{credentials:'same-origin',cache:'no-store'});
   if(!response.ok)throw Error('Promotions could not be loaded.');
   const r=await response.json();campaigns=r.campaigns||[];loaded=true;renderPromos();
   const keys=campaigns.filter(x=>x.active&&Date.parse(x.endsAt)>Date.now()).map(x=>x.id).join(',');
   const prev=localStorage.getItem('dm_seen_office_campaigns');
   if(prev!==keys&&keys){
    const badge=$('whatsNewBadge');
    if(badge){badge.classList.remove('hidden');badge.textContent='NEW';}
   }
  }catch(e){if(tab==='promotions')promotions.innerHTML='<p class="dm-notif-empty">'+esc(e.message)+'</p>';}
 }
 function show(next){
  tab=next;modal.querySelectorAll('[data-notif-tab]').forEach(e=>{
    const active=e.dataset.notifTab===next;e.classList.toggle('active',active);e.setAttribute('aria-selected',String(active));
  });
  system.classList.toggle('hidden',next!=='system');
  promotions.classList.toggle('hidden',next!=='promotions');
  if(next==='system')systemUpdates();
  else{
   loadPromos(true);
   const badge=$('whatsNewBadge');
   if(badge){badge.classList.add('hidden');}
   localStorage.setItem('dm_seen_office_campaigns',campaigns.map(x=>x.id).join(','));
  }
 }
 function install(){
  const bell=$('whatsNewButton');if(!bell)return false;
  bell.setAttribute('aria-label','Open notifications: System Updates and Promotions');
  if(bell.dataset.dmUnified==='1')return true;
  bell.dataset.dmUnified='1';
  bell.addEventListener('click',event=>{
   event.preventDefault();event.stopImmediatePropagation();
   show('system');if(!modal.open)modal.showModal();
  },true);
  return true;
 }
 $('franchiseNotificationClose').onclick=()=>modal.close();
 modal.addEventListener('click',e=>{if(e.target===modal)modal.close()});
 modal.querySelectorAll('[data-notif-tab]').forEach(b=>b.onclick=()=>show(b.dataset.notifTab));
 promotions.addEventListener('click',e=>{
  if(e.target.closest('[data-promo-supply]')){
   modal.close();
   document.querySelector('[data-view="supply"]')?.click();
  }
 });
 const installObserver=new MutationObserver(()=>{if(install())installObserver.disconnect()});
 if(!install()){installObserver.observe(screen,{childList:true,subtree:true});}
 setInterval(()=>{
  if(!window.donmacAuthenticatedRole)return;
  if(modal.open&&tab==='promotions')refreshTimers();
  loadPromos();
 },15000);
 window.donmacPromotionNotifications={refresh:()=>loadPromos(true)};
})();