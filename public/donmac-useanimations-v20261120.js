/* Don Mac POS — useAnimations Lottie icons.
 * Preserves all original SVGs as a fallback, and never changes click handlers.
 * MIT icon assets from useAnimations; SVG Lottie player from lottie-web. */
(() => {
  'use strict';
  if (window.donmacAnimatedIcons) return;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)');
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
  const live = new Set();
  let catalog = {}, observer, scanning = false, scanPending = false;
  const loadCatalog = async () => {
    const files = ['/animations/donmac-nav-icons.json',
      '/animations/donmac-action-icons.json',
      '/animations/donmac-secondary-icons.json'];
    const response = await Promise.all(files.map(async url => {
      const r = await fetch(url, {credentials:'same-origin'});
      if (!r.ok) throw new Error('Icon bundle unavailable: '+url);
      return r.json();
    }));
    catalog = Object.assign({}, ...response);
  };
  const play = el => {
    if (reduce?.matches) return;
    const item = animated.get(el);
    if (!item || !el.isConnected || el.disabled || el.hidden ||
        el.closest('.hidden,[hidden],[inert]')) return;
    try { item.goToAndPlay(0,true); } catch(_){}
  };
  const reset = el => {
    const item = animated.get(el);
    if (!item) return;
    try { item.goToAndStop(0,true); } catch(_){}
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
    const record={el,item,original,slot};
    animated.set(el,item);live.add(record);
    item.addEventListener('DOMLoaded',() => {
      if (!el.isConnected || !el.contains(original) ||
          el.dataset.dmUaMounted!=='pending' || reduce?.matches) return;
      // One icon in the original position: physically replace the old SVG.
      original.replaceWith(slot);
      slot.style.removeProperty('position');
      slot.style.removeProperty('visibility');
      el.classList.add('dm-ua-mounted');
      el.dataset.dmUaMounted='ready';
      item.goToAndStop(0,true);
      // Analytics rebuilds its navigation after a click. Start the newly
      // selected icon's animation once its Lottie SVG has mounted.
      if(el.matches('.rd-nav-glyph')&&el.closest('button[data-aa-section].active')){
        requestAnimationFrame(()=>{
          if(el.isConnected&&!reduce?.matches)try{item.goToAndPlay(0,true)}catch(_){}
        });
      }
    });
    item.addEventListener('data_failed',() => {
      if (!original.isConnected && slot.isConnected) slot.replaceWith(original);
      else slot.remove();
      el.classList.remove('dm-ua-mounted');
      animated.delete(el);
      live.delete(record);
      delete el.dataset.dmUaMounted;
      try{item.destroy()}catch(_){}
    });
  }
  function scan() {
    if (reduce?.matches || !window.lottie?.loadAnimation) return;
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
        try{entry.item.destroy()}catch(_){}
        live.delete(entry);
      }
      scan();
    });
  }
  const targets=e=>{
    const el=e.target.closest?.('.dm-ua-mounted');
    if(el)return [el];
    const parent=e.target.closest?.('button');
    return parent?[...parent.querySelectorAll('[data-dm-icon].dm-ua-mounted')]:[];
  };
  document.addEventListener('pointerover',e=>{
    for(const el of targets(e))if(!el.contains(e.relatedTarget))play(el);
  },true);
  document.addEventListener('pointerout',e=>{
    for(const el of targets(e))if(!el.contains(e.relatedTarget))reset(el);
  },true);
  document.addEventListener('focusin',e=>{targets(e).forEach(play);},true);
  document.addEventListener('focusout',e=>{targets(e).forEach(reset);},true);
  document.addEventListener('click',e=>{
    targets(e).forEach(play);
    const bell=e.target.closest?.('#whatsNewButton');
    if(bell){bell.classList.remove('is-ringing');void bell.offsetWidth;
      bell.classList.add('is-ringing');
      setTimeout(()=>bell.classList.remove('is-ringing'),2250);}
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
      try{entry.item.destroy()}catch(_){}
    }
    live.clear();
  };
  reduce?.addEventListener?.('change', e=>{
    if(e.matches) disable();
    else scheduleScan();
  });
  window.donmacAnimatedIcons={refresh:scheduleScan};
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
  }).catch(()=>{/* Native SVGs remain functional if an icon bundle fails. */});
})();
