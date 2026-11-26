/* Don Mac info affordances · hover/focus help next to section headings.
 * Never replace data-bound source elements: code may update their textContent.
 * Preserve warnings, live statuses, critical confirmations and consent wording.
 */
(()=>{
 'use strict';
 if(window.donmacDisclaimers)return;
 const app=document.getElementById('officeApp')||document.getElementById('app');
 if(!app)return;
 const isOffice=app.id==='officeApp';
 const noteTerms=/\b(?:does not|do not|cannot|never|not automatically|not included|excluded|excluding|limited by|limited to|retain|preserv|manual verification|manually|historical|billed per|billed separately|not tracked|not counted|before selling|before approval|must be|cannot be|doesn't|not yet|only after|not franchise|independent of|is separate from)\b/i;
 const selectOffice=[
  '#officeApp .office-page .panel-head p.muted',
  '#officeApp .office-page .warehouse-chart-header p.muted',
  '#officeApp .office-page .warehouse-section-title p.muted',
  '#officeApp .office-page .warehouse-cost-review > p.muted',
  '#officeApp .office-page .office-campaign-inventory-note',
  '#officeApp .office-page .office-campaign-ingredient-composer > p.muted',
  '#officeApp .office-page p.distribution-note',
  '#officeApp .office-page .franchise-fee-form p.muted',
  '#officeApp .office-page p.muted',
  '#officeApp .warehouse-lifetime > summary > small'
 ];
 const selectPos=[
  '#app main.main .view .panel-head p.muted',
  '#app main.main .view .card-head p.muted',
  '#app main.main .view p.inv-direct-stock-tip',
  '#app main.main .view p.advanced-data-notice',
  '#app main.main .view p.supply-notification-hint',
  '#app main.main .view p.dm-transaction-count-note',
  '#app main.main .view p.muted'
 ];
 const selectors=(isOffice?selectOffice:selectPos).join(',');
 const tooltip=document.createElement('div');
 tooltip.id='dmInfoHoverTooltip';tooltip.className='dm-info-hover-tooltip';
 tooltip.setAttribute('role','tooltip');tooltip.hidden=true;
 document.body.appendChild(tooltip);
 let active=null,converted=0,pending=false;
 const headingIcons=new WeakMap();
 const noteText=el=>(el?.textContent||'').replace(/\s+/g,' ').trim();
 const special=el=>el.matches(
  '.office-campaign-inventory-note,.inv-direct-stock-tip,.advanced-data-notice,'+
  '.supply-notification-hint,.dm-transaction-count-note,.distribution-note,'+
  '.warehouse-lifetime > summary > small,.panel-head p.muted,'+
  '.warehouse-chart-header p.muted,.warehouse-section-title p.muted,'+
  '.office-campaign-ingredient-composer > p.muted'
 );
 function eligible(el){
  if(!el||el.dataset.dmInfoSource||el.closest('.dm-info-hover-tooltip,.dm-info-hover-icon'))return false;
  if(el.closest('[role="alert"],[role="status"],.toast,.notification,.warning,.error,.chat-history,.auth-page,.auth-panel,.auth-screen,[data-terms],[data-policy]'))return false;
  if(el.id&&/notice|status|warning|feedback|error/i.test(el.id))return false;
  if(el.matches('small')&&!el.matches('.warehouse-lifetime > summary > small'))return false;
  if(el.querySelector('a,button,input,select,textarea'))return false;
  const value=noteText(el);
  if(value.length<22)return false;
  if(!special(el)&&!(value.length>=65&&noteTerms.test(value)))return false;
  return true;
 }
 function heading(el){
  if(el.matches('.warehouse-lifetime > summary > small'))return el.parentElement;
  if(el.id==='distCostNote')return el.closest('.warehouse-lifetime')?.querySelector(':scope > summary');
  const local=el.closest('.panel-head,.warehouse-heading,.warehouse-chart-header,'+
   '.warehouse-section-title,.office-campaign-ingredient-composer,.warehouse-cost-review,.card-head,.section-header');
  if(local){
   const h=local.querySelector('h1,h2,h3,h4,summary');
   if(h)return h;
   if(local.matches('summary'))return local;
  }
  let prev=el.previousElementSibling;
  for(let n=0;prev&&n<4;n++,prev=prev.previousElementSibling){
   if(prev.matches('h1,h2,h3,h4,summary'))return prev;
   const h=prev.querySelector?.('h1,h2,h3,h4');
   if(h)return h;
  }
  const parent=el.closest('.panel,.warehouse-chart-panel,.warehouse-detail-card,'+
   '.card,.section-card,.view-section,.office-campaign-ingredient-composer');
  if(!parent)return null;
  return parent.querySelector(':scope > .panel-head h2,:scope > .panel-head h3,'+
   ':scope > .warehouse-chart-header h3,:scope > .warehouse-section-title h3,'+
   ':scope > h2,:scope > h3,:scope > summary');
 }
 const hide=()=>{
  active=null;tooltip.hidden=true;tooltip.textContent='';
  document.querySelectorAll('.dm-info-hover-icon.is-active').forEach(el=>el.classList.remove('is-active'));
 };
 function show(icon){
  if(!icon?.isConnected)return;
  const sources=icon._dmInfoSources||[];
  const message=sources.map(noteText).filter(Boolean).join('\n\n');
  if(!message){hide();return}
  active=icon;
  icon.setAttribute('aria-label','Information: '+message);
  tooltip.textContent=message;tooltip.hidden=false;
  icon.classList.add('is-active');
  tooltip.style.visibility='hidden';
  tooltip.style.top='0px';tooltip.style.left='0px';
  const rect=icon.getBoundingClientRect();
  const width=Math.min(360,window.innerWidth-24);
  const left=Math.max(12,Math.min(window.innerWidth-width-12,rect.left-12));
  tooltip.style.width=width+'px';tooltip.style.left=Math.round(left)+'px';
  const height=tooltip.getBoundingClientRect().height;
  const fitsTop=rect.top>=height+15;
  const y=fitsTop?rect.top-height-10:rect.bottom+10;
  tooltip.style.top=Math.round(Math.max(8,Math.min(y,window.innerHeight-height-8)))+'px';
  tooltip.style.visibility='visible';
 }
 function mount(el){
  const target=heading(el);if(!target)return;
  const message=noteText(el);
  const existing=headingIcons.get(target);
  if(existing&&existing.isConnected){
   existing._dmInfoSources.push(el);
   el.classList.add('dm-info-source');
   el.dataset.dmInfoSource='1';el.setAttribute('aria-hidden','true');
   converted++;
   return;
  }
  const icon=document.createElement('span');
  icon.className='dm-info-hover-icon';
  icon.setAttribute('tabindex','0');
  icon.setAttribute('role','img');
  icon.setAttribute('aria-label','Information about '+noteText(target).slice(0,80)+'. '+message);
  icon.setAttribute('aria-describedby','dmInfoHoverTooltip');
  icon.setAttribute('title','Hover or focus for information');
  icon.innerHTML='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+
   '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></svg>';
  icon._dmInfoSources=[el];
  headingIcons.set(target,icon);
  icon.addEventListener('mouseenter',()=>show(icon));
  icon.addEventListener('mouseleave',()=>{if(active===icon&&!icon.matches(':focus'))hide()});
  icon.addEventListener('focus',()=>show(icon));
  icon.addEventListener('blur',()=>{if(active===icon)hide()});
  // Touch can focus the same non-button icon; tapping again dismisses it.
  icon.addEventListener('click',event=>{
   if(!window.matchMedia?.('(hover: none)').matches)return;
   if(active===icon){hide();icon.blur();}
   else{icon.focus();show(icon)}
   event.stopPropagation();
  });
  target.classList.add('dm-info-heading');
  target.appendChild(icon);
  // Do NOT remove or replace the paragraph, even when dynamically populated.
  // Hidden data-bound notes remain addressable by their original ID.
  el.classList.add('dm-info-source');
  el.dataset.dmInfoSource='1';
  el.setAttribute('aria-hidden','true');
  converted++;
 }
 function scan(){
  for(const el of app.querySelectorAll(selectors)){
   if(eligible(el))mount(el);
  }
 }
 const schedule=()=>{
  if(pending)return;pending=true;
  setTimeout(()=>{pending=false;scan()},75);
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',scan,{once:true});
 else scan();
 const observer=new MutationObserver(records=>{
  if(records.some(r=>[...r.addedNodes].some(n=>n.nodeType===1&&
   (n.matches?.('p,small,.panel,.office-page,.view,.panel-head')||n.querySelector?.('p')))))schedule();
 });
 observer.observe(app,{childList:true,subtree:true});
 document.addEventListener('pointerdown',event=>{
  if(active&&!event.target.closest?.('.dm-info-hover-icon'))hide();
 },true);
 document.addEventListener('keydown',event=>{if(event.key==='Escape')hide()});
 window.addEventListener('resize',hide);
 window.addEventListener('scroll',()=>{if(active)hide()},{passive:true,capture:true});
 window.donmacDisclaimers={refresh:schedule,stats:()=>({converted}),hide};
})();
