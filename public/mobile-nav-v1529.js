/* Don Macchiatos v1.5.29: mobile navigation enhancements.
 * Reuses the existing app-core .nav handlers and logoutButton action.
 * No duplicate authentication, routing, or payment logic is introduced. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const bar=$('mobileBottomNav'),panel=$('mobileMorePanel');
  const more=$('mobileMoreButton'),closeButton=$('mobileMoreClose'),signout=$('mobileSignOutButton');
  if(!bar||!panel||!more||!closeButton||!signout)return;

  const management=new Set(['reports','catalog','users','logs','supply','advanced','account','transactions','expenses','payroll','chat']);
  const mobile=window.matchMedia('(max-width:699px)');
  let lastFocus=null;

  function activeView(){
    return document.querySelector('#app main.main > .view.active')?.id?.replace(/^view-/,'') ||
      document.querySelector('#mainNav .nav.active:not(.hidden)')?.dataset.view || 'pos';
  }
  function sync(){
    const current=activeView();
    bar.querySelectorAll('[data-view]').forEach(button=>{
      const currentTab=button.dataset.view===current&&!button.classList.contains('hidden')&&button.getAttribute('aria-hidden')!=='true';
      button.classList.toggle('active',currentTab);
      if(currentTab)button.setAttribute('aria-current','page');
      else button.removeAttribute('aria-current');
    });
    panel.querySelectorAll('[data-view]').forEach(button=>{
      const currentTab=button.dataset.view===current&&!button.classList.contains('hidden')&&button.getAttribute('aria-hidden')!=='true';
      button.classList.toggle('active',currentTab);
      if(currentTab)button.setAttribute('aria-current','page');
      else button.removeAttribute('aria-current');
    });
    // The More tab remains highlighted when a management screen is selected.
    more.classList.toggle('active',management.has(current));
  }
  function closeMenu(restoreFocus=false){
    const wasOpen=!panel.classList.contains('hidden');
    panel.classList.add('hidden');
    more.setAttribute('aria-expanded','false');
    more.setAttribute('aria-label','More management pages');
    if(restoreFocus&&wasOpen)more.focus({preventScroll:true});
  }
  function openMenu(){
    if(!mobile.matches||more.classList.contains('hidden'))return;
    const transactions=$('dmMobileTransactions');
    if(transactions){transactions.hidden=true;transactions.parentElement?.querySelector('.dm-mobile-nav-group-toggle')?.setAttribute('aria-expanded','false');}
    panel.classList.remove('hidden');
    more.setAttribute('aria-expanded','true');
    more.setAttribute('aria-label','Close management menu');
    panel.querySelector('.mobile-more-item:not(.hidden)')?.focus({preventScroll:true});
  }

  more.addEventListener('click',()=>{
    if(panel.classList.contains('hidden'))openMenu();else closeMenu(true);
  });
  closeButton.addEventListener('click',()=>closeMenu(true));
  for(const button of bar.querySelectorAll('[data-view]')){
    button.addEventListener('click',()=>{
      closeMenu();
      sync();
    });
  }
  for(const button of panel.querySelectorAll('[data-view]')){
    button.addEventListener('click',()=>{
      closeMenu();
      sync();
    });
  }
  signout.addEventListener('click',()=>{
    closeMenu();
    // The original logout includes server session invalidation and order cleanup.
    $('logoutButton')?.click();
  });
  document.addEventListener('pointerdown',event=>{
    if(!mobile.matches||panel.classList.contains('hidden'))return;
    if(!panel.contains(event.target)&&!more.contains(event.target))closeMenu();
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&!panel.classList.contains('hidden')){
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
    }
  });
  const onBreakpoint=()=>{closeMenu();sync()};
  if(mobile.addEventListener)mobile.addEventListener('change',onBreakpoint);
  else mobile.addListener?.(onBreakpoint);
  // Preserve the active state after any existing app-core view switch.
  const desktopNav=$('mainNav');
  if(desktopNav){
    const observer=new MutationObserver(changes=>{
      if(changes.some(m=>m.attributeName==='class'))sync();
    });
    observer.observe(desktopNav,{subtree:true,attributes:true,attributeFilter:['class']});
  }
  const app=$('app');
  if(app){
    const viewObserver=new MutationObserver(sync);
    app.querySelectorAll('main.main > .view').forEach(view=>viewObserver.observe(view,{attributes:true,attributeFilter:['class']}));
    new MutationObserver(()=>{if(app.classList.contains('hidden'))closeMenu();})
      .observe(app,{attributes:true,attributeFilter:['class']});
  }
  sync();
})();