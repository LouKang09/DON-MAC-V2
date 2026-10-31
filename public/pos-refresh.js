// Don Macchiatos v1.5.12: presentation only; pricing, stock and cashier actions stay in app-core.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const app=$('app');
  const sidebarToggle=$('sidebarToggle');
  const logout=$('logoutButton');
  const orderType=$('posOrderType');
  const tableWrap=$('posTableWrap');

  const navButtons=[...document.querySelectorAll('.sidebar #mainNav .nav')];

  function setSidebar(collapsed){
    if(!app||!sidebarToggle)return;
    app.classList.toggle('sidebar-collapsed',collapsed);
    sidebarToggle.setAttribute('aria-expanded',String(!collapsed));
    sidebarToggle.setAttribute('aria-label',collapsed?'Expand navigation':'Collapse navigation');
    sidebarToggle.title=collapsed?'Expand navigation':'Collapse navigation';
    sidebarToggle.innerHTML=collapsed
      ? '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m8 6 6 6-6 6M14 6l6 6-6 6"/></svg>'
      : '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m16 6-6 6 6 6M10 6l-6 6 6 6"/></svg>';
    for(const button of navButtons){
      const name=button.dataset.tooltip||button.getAttribute('aria-label')||'';
      button.title=collapsed?name:'';
    }
    if(logout)logout.title='Sign out';
    try{localStorage.setItem('donmac.sidebar.collapsed',collapsed?'1':'0');}catch(_){}
  }
  function syncNavigationAccessibility(){
    for(const button of navButtons){
      if(button.classList.contains('active'))button.setAttribute('aria-current','page');
      else button.removeAttribute('aria-current');
    }
  }
  if(sidebarToggle&&app){
    let collapsed=false;
    try{collapsed=localStorage.getItem('donmac.sidebar.collapsed')==='1';}catch(_){}
    setSidebar(collapsed);
    sidebarToggle.addEventListener('click',()=>setSidebar(!app.classList.contains('sidebar-collapsed')));
  }
  syncNavigationAccessibility();
  const navObserver=new MutationObserver(syncNavigationAccessibility);
  navButtons.forEach(button=>navObserver.observe(button,{attributes:true,attributeFilter:['class']}));

  function setOrderType(type) {
    if(!['Dine In','Take Away','Order Online'].includes(type))return;
    orderType.value=type;
    document.querySelectorAll('[data-order-type]').forEach(button=>{
      const active=button.dataset.orderType===type;
      button.classList.toggle('active',active);
      button.setAttribute('aria-pressed',String(active));
    });
    tableWrap?.classList.toggle('hidden',type!=='Dine In');
  }

  document.querySelectorAll('[data-order-type]').forEach(button=>{
    button.addEventListener('click',()=>setOrderType(button.dataset.orderType));
  });
  if(orderType)setOrderType(orderType.value||'Dine In');

  const bell=$('whatsNewButton');
  if(bell) {
    bell.title="What's New";
    bell.setAttribute('aria-label',"What's New");
    const icon=bell.querySelector('.whats-new-icon');
    if(icon) icon.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9z"/><path d="M10 21h4"/></svg>';
  }

  const latest=[
    'Dashboard now includes the item-performance radar and a table of recent completed transactions, with the existing charts and filters retained.',
    'The sidebar collapse control now uses subtle directional chevrons instead of the previous heavy panel icon.',
    'Choose Dine In, Take Away or Order Online; customer name is optional for every type.',
    'Today’s order count is now in the checkout panel; the header welcomes the cashier.',
    'Fixed PNG and JPEG upload previews blocked by browser image URL security rules. The 1 MB limit, compression and save verification remain in place.',
    'Product stock restrictions, recipes, payments and branch reporting are unchanged.'
  ];
  const list=$('whatsNewList');
  if(list)list.innerHTML=latest.map(item=>'<li>'+item+'</li>').join('');
  const version=$('whatsNewVersion');
  if(version)version.textContent='v1.5.12';
  const history=document.querySelector('#versionHistorySection .version-history');
  if(history&&!history.querySelector('[data-version="1.5.12"]')) {
    history.querySelectorAll('.version-entry.current').forEach(el=>el.classList.remove('current'));
    const entry=document.createElement('details');
    entry.className='version-entry current';
    entry.open=true;
    entry.dataset.version='1.5.12';
    entry.innerHTML='<summary><span class="version-meta"><span class="version-chip">v1.5.12</span><span>Don Macchiatos navigation update</span></span></summary><ul>'+latest.map(x=>'<li>'+x+'</li>').join('')+'</ul>';
    history.prepend(entry);
  }

  // When checkout clears a cart, app-core restores the first order type.
  // Keep aria-pressed in sync for keyboard/screen-reader users.
  const clear=$('clearCart');
  clear?.addEventListener('click',()=>setOrderType('Dine In'));
  const receiptClose=$('receiptClose');
  receiptClose?.addEventListener('click',()=>setOrderType('Dine In'));
  console.info('Don Macchiatos POS presentation v1.5.12 ready');
})();
