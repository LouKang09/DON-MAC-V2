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
   '<button type="button" data-notif-tab="promotions" role="tab">Supply Chain Promotions <span id="franchisePromoCount"></span></button></div>'+
  '<div id="franchiseSystemTab" class="dm-notifications-content"></div>'+
  '<div id="franchisePromoTab" class="dm-notifications-content hidden" aria-live="polite"></div></div>';
 document.body.appendChild(modal);
 let tab='system',campaigns=[],lastPoll=0,loaded=false;
 const system=$('franchiseSystemTab'),promotions=$('franchisePromoTab');
 // Preserve the detailed, versioned "What's New" history from the original
 // Don Mac POS, and show changes shipped to current franchise users.
 const RELEASE_NOTICE='donmac-2026-11-17-team-chat-signout';
 const RELEASES=[
  {version:'November 17, 2026',title:'Messages, account access & notifications',current:true,notes:[
   'Team shows the unread message total, even while the navigation group is collapsed.',
   'Messages again loads group conversations, direct messages and message previews.',
   'Sign Out revokes the active server session and clears the POS before returning to Sign In.',
   'The notification bell opens System Updates and Main Office Supply Chain promotions.'
  ]},
  {version:'November 17, 2026',title:'Checkout, reporting & payroll',notes:[
   'POS order types now correctly switch between Dine In, Take Away and Order Online.',
   'Inventory Audit and Transaction Audit show purchased quantity, per-ingredient costing and sale totals.',
   'Pro Dashboard Insights load using isolated franchise and branch sales records.',
   'Payroll & Attendance opens its own page; opening Expenses no longer shows Payroll or vice versa.'
  ]},
  {version:'November 2026',title:'Franchise isolation & inventory',notes:[
   'Live franchise sales, inventory and product data are scoped to the franchise workspace and branch.',
   'Transaction details include stock movements and checkout audit events when available.',
   'Historical costing allocations are clearly identified when original ingredient snapshots are unavailable.',
   'Branch replenishment and transfer workflows include acceptance, delivery and inventory audit details.'
  ]},
  {version:'v1.5.0 · Original release',title:'System Logs, batch stock & notifications',notes:[
   'System Logs gained Sales, Reports, Inventory, Catalog, Users, Database and Other filters, plus search and a fixed-height result panel.',
   'The original What’s New notification was introduced with a version-aware unread badge and an Upcoming section.',
   'Replenish added required Delivered By and Remarks; Transfer added Received By and Remarks.',
   'Replenish and Transfer gained multi-ingredient batch processing that preserves edits during live refresh.'
  ]},
  {version:'v1.4.0 · Original release',title:'Product availability & recipe protection',notes:[
   'Product availability explains ingredient shortages, on-hand stock and unit of measure.',
   'Products without a valid recipe are marked Recipe Required and cannot be sold.',
   'Packages identify unavailable component products and insufficient ingredients.'
  ]},
  {version:'v1.3.0 · Original release',title:'Transaction audit trail',notes:[
   'The Reports Audit Trail changed from Delete to a read-only View action.',
   'Transaction detail includes cashier, date, payment, products, totals, inventory movements and matching system events.'
  ]}
 ];
 const seenKey=prefix=>prefix+'_user_'+String(window.donmacChatUserId||'anonymous');
 const storageRead=key=>{try{return localStorage.getItem(key)||'';}catch(_){return '';}};
 const storageWrite=(key,value)=>{try{localStorage.setItem(key,value);}catch(_){}};
 const activeCampaigns=()=>campaigns.filter(x=>x.active&&Date.parse(x.endsAt)>Date.now());
 function setBellBadge(){
  const newerSystem=storageRead(seenKey('dm_system_updates_read'))!==RELEASE_NOTICE;
  const promoIds=activeCampaigns().map(x=>String(x.id)).sort().join(',');
  const saved=storageRead(seenKey('dm_supply_promotions_read'));
  const newerPromo=loaded&&!!promoIds&&promoIds!==saved;
  const bell=$('whatsNewButton'),badge=$('whatsNewBadge');
  if(badge){badge.classList.toggle('hidden',!newerSystem&&!newerPromo);
   badge.textContent=newerSystem||newerPromo?'NEW':'';}
  bell?.classList.toggle('has-update',newerSystem||newerPromo);
  bell?.setAttribute('aria-label','Notifications'+(newerSystem||newerPromo?' · new updates':'')+
   ': System Updates and Supply Chain Promotions');
 }
 function systemUpdates(){
  const version=$('appVersion')?.textContent?.trim()||'Current release';
  system.innerHTML='<div class="dm-system-updates-intro"><strong>What’s New in Don Mac POS</strong>'+
   '<p>Current system version: '+esc(version)+'. Browse recent changes and the original release history below.</p></div>'+
   '<div class="dm-system-update-timeline">'+RELEASES.map((r,i)=>
    '<details class="dm-system-update-entry" '+(i===0?'open':'')+'>'+
    '<summary><span><small>'+esc(r.version)+'</small><strong>'+esc(r.title)+'</strong></span>'+
    '<span class="dm-system-update-expand" aria-hidden="true">⌄</span></summary>'+
    '<div class="dm-system-update-breakdown"><ul>'+
      r.notes.map(item=>'<li>'+esc(item)+'</li>').join('')+
     '</ul></div></details>').join('')+'</div>';
 }
 function renderPromos(){
  const relevant=campaigns.filter(x=>x.active&&Date.parse(x.endsAt)>Date.now());
  $('franchisePromoCount').textContent=relevant.length?'('+relevant.length+')':'';
  promotions.innerHTML='<p class="dm-notif-source">Only campaigns published through the Main Office Supply Chain are shown. Franchise POS Catalog promos do not trigger bell notifications.</p>'+
   (relevant.length?relevant.map(x=>{
   const started=Date.now()>=Date.parse(x.startsAt),eligible=x.eligible&&started;
   return '<article class="dm-notif-promo">'+(x.iconData?'<img class="dm-notif-promo-icon" src="'+esc(x.iconData)+'" alt="" loading="lazy">':'')+'<div><strong>'+esc(x.title)+'</strong>'+
    '<span class="dm-promo-pill">'+(started?'LIVE':'UPCOMING')+'</span></div>'+
    '<p>'+esc(x.description||x.buttonName)+'</p>'+
    '<p><b>POS Button:</b> '+esc(x.buttonName)+' · '+money(x.price)+'</p>'+
    '<p class="dm-notif-times">'+time(x.startsAt)+' – '+time(x.endsAt)+'</p>'+
    '<p><b>Supplies required per promotional sale:</b> '+(x.credits||[]).map(c=>
      esc(c.name)+' × '+c.requiredPerSale+' (received '+c.purchased+')').join(' · ')+'</p>'+
    '<p data-promo-timer="'+esc(x.endsAt)+'" data-promo-start="'+esc(x.startsAt)+'"></p>'+
    '<p class="'+(eligible?'dm-promo-ready':'dm-promo-locked')+'">'+(eligible?
      'Eligible to sell · '+Number(x.remaining||0)+' supply-backed sales remaining':
      started?'Not eligible to sell yet · purchase and receive the required Main Office supplies.':
       'Starts at the scheduled Philippine time.')+'</p>'+
    (!eligible&&window.donmacAuthenticatedRole==='Admin'?'<button type="button" data-promo-supply="1">View Main Office Supplies</button>':'')+
    '</article>';
  }).join(''):'<p class="dm-notif-empty">No active Supply Chain promotions.</p>');
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
   // Office campaigns originate in the Supply Chain's Main Office promotion
   // tool, NOT from branch POS Catalog/discount entries.
   const url=window.donmacFranchiseUnified?
    '/api/live/office-promotions':'/api/office-promotions';
   const response=await fetch(url,{credentials:'same-origin',cache:'no-store'});
   if(!response.ok)throw Error('Supply Chain promotions could not be loaded.');
   const r=await response.json();
   campaigns=Array.isArray(r.campaigns)?r.campaigns:[];loaded=true;
   renderPromos();
   if(tab==='promotions'&&modal.open)
     storageWrite(seenKey('dm_supply_promotions_read'),
      activeCampaigns().map(x=>String(x.id)).sort().join(','));
   setBellBadge();
  }catch(e){
   if(tab==='promotions')promotions.innerHTML='<p class="dm-notif-empty">'+esc(e.message)+'</p>';
  }
 }
 function show(next){
  tab=next;
  modal.querySelectorAll('[data-notif-tab]').forEach(e=>{
   const active=e.dataset.notifTab===next;
   e.classList.toggle('active',active);e.setAttribute('aria-selected',String(active));
  });
  system.classList.toggle('hidden',next!=='system');
  promotions.classList.toggle('hidden',next!=='promotions');
  if(next==='system'){
   systemUpdates();
   storageWrite(seenKey('dm_system_updates_read'),RELEASE_NOTICE);
   setBellBadge();
  }else{
   // Do not acknowledge promotions before their authoritative list loads.
   loadPromos(true);
  }
 }
 function install(){
  const bell=$('whatsNewButton');if(!bell)return false;
  bell.setAttribute('aria-label','Open notifications: System Updates and Promotions');
  if(bell.dataset.dmUnified==='1'){setBellBadge();return true;}
  bell.dataset.dmUnified='1';
  setBellBadge();
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