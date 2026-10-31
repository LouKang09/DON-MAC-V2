// Don Macchiatos v1.5.10: presentation only; pricing, stock and cashier actions stay in app-core.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const app=$('app');
  const sidebarToggle=$('sidebarToggle');
  const logout=$('logoutButton');
  const orderType=$('posOrderType');
  const tableWrap=$('posTableWrap');

  function setSidebar(collapsed) {
    app.classList.toggle('sidebar-collapsed',collapsed);
    sidebarToggle.setAttribute('aria-expanded',String(!collapsed));
    sidebarToggle.setAttribute('aria-label',collapsed?'Expand navigation':'Collapse navigation');
    sidebarToggle.title=collapsed?'Expand navigation':'Collapse navigation';
    sidebarToggle.innerHTML=collapsed
      ? '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16m4-12 4 4-4 4"/></svg>'
      : '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16m8-12-4 4 4 4"/></svg>';
    logout.textContent=collapsed?'⇥':'Sign out';
    logout.title='Sign out';
    for(const button of document.querySelectorAll('.sidebar .nav')) {
      button.title=button.querySelector('span')?.textContent||'';
    }
    try{localStorage.setItem('donmac.sidebar.collapsed',collapsed?'1':'0');}catch(_){}
  }

  if(sidebarToggle&&app) {
    let collapsed=false;
    try{collapsed=localStorage.getItem('donmac.sidebar.collapsed')==='1';}catch(_){}
    setSidebar(collapsed);
    sidebarToggle.addEventListener('click',()=>setSidebar(!app.classList.contains('sidebar-collapsed')));
  }

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
    'Don Macchiatos branding replaces the redundant sidebar title; categories now have clean line icons.',
    'Collapse or expand the desktop navigation without losing access to POS tools.',
    'Choose Dine In, Take Away or Order Online; customer name is optional for every type.',
    'Today’s order count is now in the checkout panel; the header welcomes the cashier.',
    'Fixed PNG and JPEG upload previews blocked by browser image URL security rules. The 1 MB limit, compression and save verification remain in place.',
    'Product stock restrictions, recipes, payments and branch reporting are unchanged.'
  ];
  const list=$('whatsNewList');
  if(list)list.innerHTML=latest.map(item=>'<li>'+item+'</li>').join('');
  const version=$('whatsNewVersion');
  if(version)version.textContent='v1.5.10';
  const history=document.querySelector('#versionHistorySection .version-history');
  if(history&&!history.querySelector('[data-version="1.5.10"]')) {
    history.querySelectorAll('.version-entry.current').forEach(el=>el.classList.remove('current'));
    const entry=document.createElement('details');
    entry.className='version-entry current';
    entry.open=true;
    entry.dataset.version='1.5.10';
    entry.innerHTML='<summary><span class="version-meta"><span class="version-chip">v1.5.10</span><span>Don Macchiatos POS design refresh</span></span></summary><ul>'+latest.map(x=>'<li>'+x+'</li>').join('')+'</ul>';
    history.prepend(entry);
  }

  // When checkout clears a cart, app-core restores the first order type.
  // Keep aria-pressed in sync for keyboard/screen-reader users.
  const clear=$('clearCart');
  clear?.addEventListener('click',()=>setOrderType('Dine In'));
  const receiptClose=$('receiptClose');
  receiptClose?.addEventListener('click',()=>setOrderType('Dine In'));
  console.info('Don Macchiatos POS presentation v1.5.10 ready');
})();
