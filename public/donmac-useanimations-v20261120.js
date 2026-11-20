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
    dashboardRefresh:'refresh',dashboardPrintReport:'printer'
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
    animated.set(el,item);live.add({el,item});
    item.addEventListener('DOMLoaded',() => {
      if (!el.isConnected) return;
      el.classList.add('dm-ua-mounted');
      el.dataset.dmUaMounted='ready';
      item.goToAndStop(0,true);
    });
    item.addEventListener('data_failed',() => {
      el.classList.remove('dm-ua-mounted');
      animated.delete(el);
      slot.remove();delete el.dataset.dmUaMounted;
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
        install(button,groupMap[name],svg,'dm-ua-icon dm-ua-group');
      });
    }
    for (const [id,name] of Object.entries(actions)) {
      const button=document.getElementById(id);
      install(button,name,button?.querySelector(':scope > svg'),'dm-ua-icon dm-ua-action');
    }
  }
  function scheduleScan(){
    if(scanPending)return;
    scanPending=true;
    window.requestAnimationFrame(()=>{
      scanPending=false;
      scan();
      for(const entry of live)if(!entry.el.isConnected){
        try{entry.item.destroy()}catch(_){}
        live.delete(entry);
      }
    });
  }
  document.addEventListener('pointerover',e=>{
    const el=e.target.closest?.('.dm-ua-mounted');
    if(!el || el.contains(e.relatedTarget))return;
    play(el);
  },true);
  document.addEventListener('pointerout',e=>{
    const el=e.target.closest?.('.dm-ua-mounted');
    if(!el || el.contains(e.relatedTarget))return;
    reset(el);
  },true);
  document.addEventListener('focusin',e=>{
    const el=e.target.closest?.('.dm-ua-mounted');if(el)play(el);
  },true);
  document.addEventListener('focusout',e=>{
    const el=e.target.closest?.('.dm-ua-mounted');if(el)reset(el);
  },true);
  document.addEventListener('click',e=>{
    const el=e.target.closest?.('.dm-ua-mounted');if(el)play(el);
  },true);
  const disable=()=> {
    for (const entry of live){
      entry.el.classList.remove('dm-ua-mounted');
      entry.el.querySelector(':scope > .dm-ua-icon')?.remove();
      entry.el.querySelector('.dm-nav-group-icon > .dm-ua-group')?.remove();
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
  if(reduce?.matches) return;
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
  }).catch(()=>{/* Native SVGs remain functional if an icon bundle fails. */});
})();
