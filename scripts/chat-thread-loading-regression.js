'use strict';
// Simulates overlapping team-chat requests without a browser or database.
// Run: node scripts/chat-thread-loading-regression.js
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/internal-chat.js'),'utf8');
const deferred=()=>{
 let resolve,reject;
 const promise=new Promise((a,b)=>{resolve=a;reject=b});
 return{promise,resolve,reject};
};
class Classes{
 constructor(){this.values=new Set();}
 add(name){this.values.add(name);}
 remove(name){this.values.delete(name);}
 contains(name){return this.values.has(name);}
 toggle(name,on){if(on===undefined?!this.values.has(name):on)this.add(name);else this.remove(name);}
}
class Element{
 constructor(id){
  this.id=id;this.value='';this.innerHTML='';this.textContent='';
  this.classList=new Classes();this.style={setProperty(){}};
  this.events={};this.dataset={};this.parentElement=null;
  this.disabled=false;this.scrollHeight=220;this.scrollTop=0;this.clientHeight=100;
  this.children=[];
 }
 addEventListener(name,fn){this.events[name]=fn;}
 setAttribute(){}
 getAttribute(){return null;}
 focus(){}
 closest(){return null;}
 getBoundingClientRect(){return{width:150,height:100,bottom:200,top:0,left:0,right:200};}
 appendChild(child){child.parentElement=this;return child;}
 append(){}
 removeAttribute(){}
 showModal(){}
 close(){}
 querySelector(){return null;}
}
const items=new Map(),el=id=>{
 if(!items.has(id))items.set(id,new Element(id));
 return items.get(id);
};
const main=el('main'),chat=el('view-chat'),nav=el('nav');
chat.parentElement=main;
nav.dataset.view='chat';nav.classList.add('active');
const document={
 body:el('body'),
 getElementById:id=>id==='dmMobileTeam'?null:el(id),
 querySelector:q=>q==='main.main'?main:q==='.nav.active'?nav:null,
 querySelectorAll:()=>[],
 addEventListener(){}
};
const window={
 innerHeight:800,innerWidth:1280,donmacAuthenticatedRole:'Admin',
 matchMedia:()=>({matches:false,addEventListener(){}}),
 addEventListener(){},
 donmacPrompt:{confirm:async()=>true}
};
const reply=data=>({ok:true,json:async()=>data});
const A={id:7,label:'Alice - Cashier',username:'alice',subtitle:'Staff',role:'User',unread:0};
const B={id:8,label:'Bob - Cashier',username:'bob',subtitle:'Staff',role:'User',unread:0};
const pendingAlice=deferred(),calls=[];
let aliceCalls=0,emptyBob=false;
const message=(id,text)=>({id,text,mine:false,readAt:'read',createdAt:'2026-11-23T10:00:00Z',reactions:[]});
async function fetch(url){
 url=String(url);calls.push(url);
 if(url==='/api/chat/people')return reply({people:[A,B],groups:[],unreadTotal:0});
 if(url==='/api/chat/messages/7'){
  if(++aliceCalls===1)return pendingAlice.promise;
  return reply({messages:[message(1,'Alice earlier conversation')],hasMore:false});
 }
 if(url==='/api/chat/messages/8')
  return reply({messages:emptyBob?[]:[message(2,'Bob saved conversation')],hasMore:false});
 if(url.startsWith('/api/chat/read/'))return reply({ok:true});
 throw Error('Unexpected chat request '+url);
}
const flush=async()=>{for(let n=0;n<15;n++)await Promise.resolve();};
const contact=id=>el('chatPeople').events.click({
 target:{closest:selector=>selector==='button[data-contact]'?{dataset:{contact:String(id)}}:null}
});
async function run(){
 // Execute real chat source with an intentionally small fake DOM.
 new Function('window','document','fetch','AbortController','setTimeout','clearTimeout',
  'setInterval','clearInterval','requestAnimationFrame','MutationObserver','getComputedStyle',source)(
  window,document,fetch,
  class{constructor(){this.signal={};}abort(){}},
  ()=>1,()=>{},()=>1,()=>{},fn=>fn(),class{observe(){}},
  ()=>({display:'block',visibility:'visible'})
 );
 window.donmacChat.loggedIn(42);
 window.donmacChat.onViewChange('chat');
 await flush();
 contact(7);await flush();
 assert.match(el('chatMessages').innerHTML,/Loading conversation/);
 assert.doesNotMatch(el('chatMessages').innerHTML,/No messages yet/);
 contact(8);await flush();
 assert(calls.includes('/api/chat/messages/8'),'Bob must load without waiting for Alice');
 assert.match(el('chatMessages').innerHTML,/Bob saved conversation/);
 pendingAlice.resolve(reply({messages:[message(99,'STALE ALICE')],hasMore:false}));
 await flush();
 assert.doesNotMatch(el('chatMessages').innerHTML,/STALE ALICE/);
 contact(7);await flush();
 assert.match(el('chatMessages').innerHTML,/Alice earlier conversation/);
 contact(8);await flush();
 assert.match(el('chatMessages').innerHTML,/Bob saved conversation/);
 emptyBob=true;
 contact(8);await flush();
 assert.match(el('chatMessages').innerHTML,/Bob saved conversation/,
  'A transient empty fetch should not erase the history already displayed');
 window.donmacChat.loggedIn(0);await flush();
 assert.doesNotMatch(el('chatMessages').innerHTML,/Bob saved conversation/);
 assert.doesNotMatch(el('chatMessages').innerHTML,/Alice earlier conversation/);
 console.log('PASS chat thread loading/race/cache/logout regression');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
