/* Don Mac POS — useAnimations Lottie icons.
 * Preserves all original SVGs as a fallback, and never changes click handlers.
 * MIT icon assets from useAnimations; SVG Lottie player from lottie-web. */
(() => {
  'use strict';
  if (window.donmacAnimatedIcons) return;
  // All icon animations are user-triggered. Do not replace their artwork based
  // on the Windows/browser system motion setting; let users opt out explicitly.
  const motionStorageKey='donmac-icon-motion-v1';
  let motionEnabled=true;
  try{motionEnabled=window.localStorage.getItem(motionStorageKey)!=='off'}catch(_){}
  document.documentElement.classList.toggle('dm-icon-motion-off',!motionEnabled);
  const navMap = {
    dashboard:'grid',pos:'shoppingCart',inventory:'package',chat:'messageCircle',
    transactions:'fileText',expenses:'dollarSign',reports:'barChart',
    advanced:'pieChart',supply:'truck',catalog:'clipboard',
    users:'users',logs:'clock',account:'user'
  };
  const actions = {
    sidebarToggle:'menu',logoutButton:'logOut',dashboardChartRefresh:'refresh',
    dashboardRefresh:'refresh',dashboardPrintReport:'printer',whatsNewButton:'notification'
  };
  const groupMap = {main:'grid',team:'users',transactions:'fileText',management:'settings'};
  const animated = new WeakMap();
  const records = new WeakMap();
  const live = new Set();
  let catalog = {}, observer, scanPending = false;
  const diagnostics = {loadedBundles:0, mounted:0, failed:0, lastError:null};
  const loadCatalog = async () => {
    const files = ['/animations/donmac-nav-icons.json',
      '/animations/donmac-action-icons.json',
      '/animations/donmac-secondary-icons.json'];
    const response = await Promise.allSettled(files.map(async url => {
      const r = await fetch(url, {credentials:'same-origin',cache:'no-store'});
      if (!r.ok) throw new Error('Icon bundle unavailable: '+url);
      return r.json();
    }));
    diagnostics.loadedBundles=response.filter(x=>x.status==='fulfilled').length;
    catalog = Object.assign({}, ...response.filter(x=>x.status==='fulfilled').map(x=>x.value));
    if (!Object.keys(catalog).length) throw new Error('No icon animation bundles loaded');
    syncMotionControl();
  };
  // Exactly one Lottie playback per interaction. Hover, focus, and click
  // often arrive together, particularly on touch and hybrid laptops.
  const play = el => {
    if (!motionEnabled || document.hidden) return;
    const record = records.get(el);
    if (!record || !record.ready || record.playing ||
        !el.isConnected || el.disabled || el.hidden ||
        el.closest('.hidden,[hidden],[inert]')) return;
    record.playing=true;
    try { record.item.goToAndPlay(0,true); }
    catch(error){record.playing=false;diagnostics.lastError=String(error?.message||error)}
  };
  const reset = el => {
    // Do not interrupt an animation halfway through just because the pointer
    // leaves. The 'complete' listener returns it to its idle first frame.
    // It must NOT call play() here.
  };
  function install(el, name, original, slotClass='dm-ua-icon') {
    if (!el || !original || !catalog[name] || el.dataset.dmUaMounted) return;
    el.dataset.dmUaMounted='pending';
    const slot = document.createElement('span');
    slot.className=slotClass;
    slot.setAttribute('aria-hidden','true');
    // Keep the pending renderer out of layout until it replaces the SVG.
    slot.style.setProperty('position','absolute','important');
    slot.style.setProperty('visibility','hidden','important');
    const clone = JSON.parse(JSON.stringify(catalog[name]));
    original.insertAdjacentElement('afterend',slot);
    let item;
    try {
      item=window.lottie.loadAnimation({
        container:slot,renderer:'svg',loop:false,autoplay:false,animationData:clone,
        rendererSettings:{progressiveLoad:false,preserveAspectRatio:'xMidYMid meet'}
      });
    } catch(e) {
      slot.remove();delete el.dataset.dmUaMounted;return;
    }
    const record={el,item,original,slot,ready:false,playing:false};
    animated.set(el,item);records.set(el,record);live.add(record);
    item.addEventListener('complete',()=>{
      record.playing=false;
      try{item.goToAndStop(0,true)}catch(_){}
    });
    let committed=false;
    const commit=()=>{
      if(committed||!el.isConnected||!original.isConnected||!slot.isConnected||
         el.dataset.dmUaMounted!=='pending'||!motionEnabled)return;
      // DOMLoaded is emitted by lottie-web after its SVG is built. Some
      // versions emit it before the caller attaches an event listener:
      // also accept an already populated SVG and data_ready.
      if(!slot.querySelector('svg'))return;
      committed=true;
      original.replaceWith(slot);
      slot.style.removeProperty('position');
      slot.style.removeProperty('visibility');
      el.classList.add('dm-ua-mounted');
      el.dataset.dmUaMounted='ready';
      record.ready=true;
      diagnostics.mounted++;
      // Lottie is inert until hover, click, tap or keyboard activation.
      try{item.goToAndStop(0,true)}catch(error){
        diagnostics.lastError=String(error?.message||error);
      }
    };
    const failed=error=>{
      if(committed)return;
      diagnostics.failed++;
      diagnostics.lastError=String(error?.message||error||'Lottie icon could not mount');
      if (!original.isConnected && slot.isConnected)slot.replaceWith(original);
      else slot.remove();
      el.classList.remove('dm-ua-mounted');
      animated.delete(el);
      records.delete(el);
      live.delete(record);
      delete el.dataset.dmUaMounted;
      try{item.destroy()}catch(_){}
    };
    item.addEventListener('DOMLoaded',commit);
    item.addEventListener('data_ready',commit);
    item.addEventListener('data_failed',failed);
    item.addEventListener('error',failed);
    // Ensure that icons remain visible even when the player emitted
    // DOMLoaded synchronously. Do not leave 'pending' icons forever.
    requestAnimationFrame(commit);
    setTimeout(()=>{
      if(!committed&&el.dataset.dmUaMounted==='pending'){
        commit();
        if(!committed)failed('Lottie SVG was not created');
      }
    },2000);
  }
  function scan() {
    if (!motionEnabled || !window.lottie?.loadAnimation) return;
    const nav=document.getElementById('mainNav');
    if(nav){
      nav.querySelectorAll('button.nav[data-view]').forEach(button => {
        const svg=button.querySelector(':scope > svg.nav-icon');
        install(button,navMap[button.dataset.view],svg,'nav-icon dm-ua-icon');
      });
      nav.querySelectorAll('button.dm-nav-group-toggle').forEach(button => {
        const name=button.textContent?.trim().toLowerCase()?.replace(/\d+/g,'').trim();
        const svg=button.querySelector('.dm-nav-group-icon > svg');
        install(button,name==='management'&&window.donmacAuthenticatedRole==='User'?'info':groupMap[name],svg,'dm-ua-icon dm-ua-group');
      });
    }
    for (const [id,name] of Object.entries(actions)) {
      const button=document.getElementById(id);
      install(button,name,button?.querySelector(':scope > svg'),'dm-ua-icon dm-ua-action');
    }
    // Dynamic buttons, inline KPI symbols and Advanced Analytics nav glyphs.
    document.querySelectorAll('[data-dm-icon]').forEach(el=>{
      install(el,el.dataset.dmIcon,
        el.querySelector(':scope > svg.dm-ua-native,:scope > img.dm-ua-native,:scope > span.dm-ua-native'),
        'dm-ua-icon dm-ua-context');
    });
  }
  function scheduleScan(){
    if(scanPending)return;
    scanPending=true;
    window.requestAnimationFrame(()=>{
      scanPending=false;
      for(const entry of live)if(!entry.el.isConnected || !entry.slot.isConnected){
        entry.el.classList.remove('dm-ua-mounted');
        delete entry.el.dataset.dmUaMounted;
        animated.delete(entry.el);
        records.delete(entry.el);
        try{entry.item.destroy()}catch(_){}
        live.delete(entry);
      }
      scan();
    });
  }
  const targets=e=>{
    const target=e.target;
    if(!(target instanceof Element))return [];
    const control=target.closest('button,[role="button"],[tabindex]');
    if(!control)return [];
    // Include direct button glyphs and nested KPI/nav glyphs exactly once.
    const found=new Set();
    if(control.classList.contains('dm-ua-mounted'))found.add(control);
    control.querySelectorAll('.dm-ua-mounted').forEach(el=>found.add(el));
    return [...found];
  };
  document.addEventListener('pointerover',e=>{
    // Do not retrigger when moving between the SVG, label and button.
    // Browser pointerover is emitted for child elements as well as buttons.
    for(const el of targets(e)){
      const control=el.closest('button,[role="button"]')||el;
      if(e.relatedTarget instanceof Node && control.contains(e.relatedTarget))continue;
      play(el);
    }
  },true);
  // Leaving the button never restarts an animation.
  document.addEventListener('pointerout',e=>{
    for(const el of targets(e))if(!el.contains(e.relatedTarget))reset(el);
  },true);
  document.addEventListener('focusin',e=>{targets(e).forEach(play);},true);
  document.addEventListener('focusout',e=>{targets(e).forEach(reset);},true);
  document.addEventListener('click',e=>{
    targets(e).forEach(play);
    // Do not run the legacy CSS bell shake on top of the Lottie bell.
    const bell=e.target.closest?.('#whatsNewButton');
    if(bell&&!bell.classList.contains('dm-ua-mounted')){
      bell.classList.remove('is-ringing');void bell.offsetWidth;
      bell.classList.add('is-ringing');
      setTimeout(()=>bell.classList.remove('is-ringing'),2250);
    }
  },true);
  const disable=()=> {
    for (const entry of live){
      entry.el.classList.remove('dm-ua-mounted');
      // Reduced-motion restores the existing native SVG, never two icons.
      if(entry.slot.isConnected && !entry.original.isConnected)
        entry.slot.replaceWith(entry.original);
      else entry.slot.remove();
      delete entry.el.dataset.dmUaMounted;
      animated.delete(entry.el);
      records.delete(entry.el);
      try{entry.item.destroy()}catch(_){}
    }
    live.clear();
  };
  const syncMotionControl=()=>{
    const input=document.getElementById('dmIconMotionEnabled');
    if(input)input.checked=motionEnabled;
    const detail=document.getElementById('dmIconMotionStatus');
    if(detail)detail.textContent=motionEnabled
      ? 'Animated icons enabled · '+diagnostics.loadedBundles+' packs loaded'
      : 'Animations paused on this device; original icons remain visible';
  };
  const setEnabled=value=>{
    motionEnabled=!!value;
    try{window.localStorage.setItem(motionStorageKey,motionEnabled?'on':'off')}catch(_){}
    document.documentElement.classList.toggle('dm-icon-motion-off',!motionEnabled);
    if(!motionEnabled)disable();
    else if(Object.keys(catalog).length)scheduleScan();
    else loadCatalog().then(scheduleScan).catch(error=>{
      diagnostics.lastError=String(error?.message||error);
    });
    syncMotionControl();
  };
  const bindMotionControl=()=>{
    const input=document.getElementById('dmIconMotionEnabled');
    if(!input || input.dataset.dmMotionBound)return;
    input.dataset.dmMotionBound='1';
    input.addEventListener('change',()=>setEnabled(input.checked));
    syncMotionControl();
  };
  if(document.readyState==='loading')
    document.addEventListener('DOMContentLoaded',bindMotionControl,{once:true});
  else bindMotionControl();
  window.donmacAnimatedIcons={refresh:scheduleScan,setEnabled,
    status:()=>({...diagnostics,availableIcons:Object.keys(catalog).length,
      activePlayers:live.size,motionEnabled,
      systemReducedMotion:!!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
      lottieAvailable:!!window.lottie?.loadAnimation})};
  loadCatalog().then(()=>{
    scan();
    const nav=document.getElementById('mainNav');
    if(nav){
      observer=new MutationObserver(changes=>{
        // Ignore SVG internals created by the Lottie renderer itself.
        if(changes.some(c=>[...c.addedNodes].some(n=>
          n.nodeType===1 && (n.matches?.('button.nav,button.dm-nav-group-toggle,.nav-section') ||
          n.querySelector?.('button.nav,button.dm-nav-group-toggle'))))) scheduleScan();
      });
      observer.observe(nav,{childList:true,subtree:true});
    }
    // Observe new matching controls, not the internal SVG nodes Lottie draws.
    const selector='[data-dm-icon],button[id],button[data-aa-section],.dash-summary-icon,.dm-kpi-arrow,.rd-nav-glyph,.catalog-save-icon,.catalog-btn-icon,.users-action';
    const bodyObserver=new MutationObserver(changes=>{
      if(changes.some(c=>[...c.addedNodes].some(n=>n.nodeType===1&&(
        n.matches?.(selector)||n.querySelector?.(selector)))))scheduleScan();
    });
    bodyObserver.observe(document.body,{childList:true,subtree:true});
  }).catch(error=>{
    diagnostics.lastError=String(error?.message||error);
    // Keep native SVGs visible if the bundles are temporarily unavailable.
    // A refresh/revisit can retry without requiring users to clear their cache.
    window.donmacAnimatedIcons.refresh=()=>loadCatalog().then(scheduleScan).catch(()=>{});
  });
})();
