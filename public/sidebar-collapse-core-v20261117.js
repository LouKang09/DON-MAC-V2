/* Global sidebar collapse controller for both legacy and isolated franchises.
 * Runs before the optional POS enhancements, so the button always works. */
(() => {
 'use strict';
 const app=document.getElementById('app');
 const toggle=document.getElementById('sidebarToggle');
 const nav=document.getElementById('mainNav');
 if(!app||!toggle||!nav||window.donmacSidebarCollapse)return;
 const STORAGE_KEY='donmac.sidebar.collapsed';
 const elements=()=>[...nav.querySelectorAll('button.nav[data-view]')];
 function set(collapsed,save=true){
  const compact=Boolean(collapsed);
  app.classList.toggle('sidebar-collapsed',compact);
  toggle.setAttribute('aria-expanded',String(!compact));
  toggle.setAttribute('aria-label',compact?'Expand navigation':'Collapse navigation');
  toggle.setAttribute('title',compact?'Expand navigation':'Collapse navigation');
  toggle.setAttribute('aria-pressed',String(compact));
  for(const item of elements()){
   const label=item.dataset.tooltip||item.getAttribute('aria-label')||item.textContent.trim();
   if(label)item.title=compact?label:(item.dataset.tooltip||label);
  }
  if(save){
   try{localStorage.setItem(STORAGE_KEY,compact?'1':'0');}catch(_){}
  }
  window.donmacNavHierarchy?.sync?.();
 }
 function saved(){
  try{return localStorage.getItem(STORAGE_KEY)==='1';}catch(_){return false;}
 }
 toggle.addEventListener('click',()=>set(!app.classList.contains('sidebar-collapsed')));
 // Initial state persists across refresh but never changes tenant access.
 set(saved(),false);
 window.donmacSidebarCollapse={set,sync:()=>set(app.classList.contains('sidebar-collapsed'),false)};
})();
