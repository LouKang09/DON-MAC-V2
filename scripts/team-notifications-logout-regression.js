'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const root=path.join(__dirname,'..');
const source=file=>fs.readFileSync(path.join(root,file),'utf8');
const html=source('public/index.html');
const chat=source('public/internal-chat.js');
const nav=source('public/nav-hierarchy-v20261117.js');
const notifications=source('public/notifications-campaigns-v20261108.js');
const app=source('public/app-core.js');
const initial=app.indexOf("  $('logoutButton').onclick=async()=>{");
assert(initial>=0,'Sign Out must register a click handler');
const handler=app.slice(initial,app.indexOf('\n  };',initial));
assert(handler.indexOf("await api('/api/auth/logout'")<
 handler.indexOf('state.user=null;'),'Sign Out must revoke the session before resetting its DOM');
assert.match(chat,/heading\.insertBefore\(badge,tail\)/,
 'Team badge must use a direct heading child or append');
assert.match(chat,/try\{updateUnread\(data\.unreadTotal\|\|0\);\}/,
 'Sidebar badge failures must not block chat roster rendering');
assert.match(notifications,/RELEASES=\[/,'System Updates must include expanded release notes');
assert.match(notifications,/\/api\/live\/office-promotions/,
 'New franchise promotions must be read from isolated Supply Chain office route');
async function run(){
 const dom=new JSDOM(html,{url:'https://donmacpos.com/',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window,doc=w.document;
 w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
 w.donmacAuthenticatedRole='Admin';w.donmacChatUserId=901;
 w.donmacFranchiseUnified=true;
 const salePromo={id:'campaign-1',title:'Main Office Supply Chain Offer',
  buttonName:'OFFICE OFFER',active:true,price:39,
  startsAt:new Date(Date.now()-3600000).toISOString(),
  endsAt:new Date(Date.now()+3600000).toISOString(),
  credits:[{name:'Supply Pack',requiredPerSale:1,purchased:15}],
  eligible:true,remaining:15};
 const requests=[];
 w.fetch=async(url)=>{
  requests.push(String(url));
  if(String(url)==='/api/chat/people')return{ok:true,json:async()=>({
   unreadTotal:2,groups:[{id:3,label:'Mabolo Branch',kind:'branch',unread:1}],
   people:[{id:7,label:'Mark 01',username:'mark01',subtitle:'Mabolo · Cashier',
    role:'User',unread:2,lastMessage:{createdAt:new Date().toISOString(),text:'Test message'}}]
  })};
  if(String(url)==='/api/live/office-promotions')return{ok:true,json:async()=>({campaigns:[salePromo]})};
  throw Error('Unintended request '+url);
 };
 w.eval(nav);w.eval(chat);
 const team=doc.querySelector('#mainNav .dm-nav-group-toggle[data-group="team"]');
 assert(team,'Team heading should exist after hierarchy initialization');
 w.donmacChat.loggedIn(901);
 w.donmacChat.onViewChange('chat');
 await new Promise(resolve=>setTimeout(resolve,70));
 const roster=doc.getElementById('chatPeople');
 assert.match(roster.textContent,/Mark 01/,'Chat contacts must load instead of displaying insertBefore error');
 assert.match(roster.textContent,/Mabolo Branch/);
 assert.match(roster.textContent,/Test message/);
 assert.equal(team.querySelector('.dm-team-unread-count')?.textContent,'2');
 assert.equal(doc.getElementById('chatDesktopUnread')?.textContent,'2');
 team.click();
 assert.equal(team.querySelector('.dm-team-unread-count')?.textContent,'2',
  'Unread count should remain visible in collapsed Team');
 w.donmacChat.loggedIn(null);
 assert.equal(team.querySelector('.dm-team-unread-count')?.hidden,true,
  'Logging out must clear Team badges without throwing');
 const bell=doc.createElement('button');bell.type='button';bell.id='whatsNewButton';
 const badge=doc.createElement('span');badge.id='whatsNewBadge';
 bell.appendChild(badge);doc.querySelector('.topbar-right').prepend(bell);
 w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
 w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
 // Current user, as it would be after the next login.
 w.donmacAuthenticatedRole='Admin';w.donmacChatUserId=901;
 w.eval(notifications);
 bell.click();
 const system=doc.getElementById('franchiseSystemTab');
 assert.match(system.textContent,/System Logs/,'Keep original version 1.5 release breakdown');
 assert.match(system.textContent,/Messages, account access & notifications/);
 assert(system.querySelectorAll('details.dm-system-update-entry').length>=4);
 assert.equal(badge.classList.contains('hidden'),true,'Reading updates clears their unread badge');
 doc.querySelector('[data-notif-tab="promotions"]').click();
 await new Promise(resolve=>setTimeout(resolve,45));
 assert(requests.includes('/api/live/office-promotions'),
  'Only Main Office Supply Chain campaigns are authoritative');
 const promo=doc.getElementById('franchisePromoTab');
 assert.match(promo.textContent,/Main Office Supply Chain Offer/);
 assert.match(promo.textContent,/POS Catalog promos do not trigger bell notifications/);
 assert.equal(badge.classList.contains('hidden'),true,'Viewing Supply Chain offer clears promo unread status');
 w.close();
 console.log('PASS: Team count, conversation list, logout badge teardown and original System Updates/Supply Chain notifications');
}
run().catch(err=>{console.error(err);process.exitCode=1;});
