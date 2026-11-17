(() => {
 'use strict';
 const $=id=>document.getElementById(id);
 const nav=$('mainNav');
 if(!nav||nav.dataset.dmHierarchyReady==='1')return;
 nav.dataset.dmHierarchyReady='1';
 const app=$('app'),groups=[...nav.querySelectorAll(':scope > .nav-section')];
 const groupTitles=['Main','Team','Transactions','Management'];
 const groupIcons=[
  '<rect x="3.5" y="3.5" width="7" height="7" rx="1.3"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.3"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.3"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.3"/>',
  '<circle cx="9" cy="8" r="3"/><path d="M3.5 20v-1.4A5.4 5.4 0 0 1 9 13.2a5.4 5.4 0 0 1 5.5 5.4V20M17 5.7a3 3 0 0 1 0 5.8M17 13.5a5 5 0 0 1 4 5V20"/>',
  '<rect x="4" y="2.5" width="16" height="19" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  '<rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M8 8h8M8 12h8M8 16h8"/>'
 ];
 const icons=i=>'<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+groupIcons[i]+'</svg>';
 // Cashier accounts are a Team function; move the existing permission-aware
 // button instead of duplicating it or changing its view authorization.
 const team=groups.find(el=>el.classList.contains('nav-communication'));
 const users=nav.querySelector('.nav[data-view="users"]');
 if(team&&users)team.appendChild(users);
 const expense=nav.querySelector('.nav[data-view="expenses"]');
 if(expense){
  const row=document.createElement('div');
  row.className='dm-expense-menu';
  expense.before(row);row.appendChild(expense);
  expense.setAttribute('aria-controls','dmExpenseTree');
  expense.setAttribute('aria-expanded','false');
  const caret=document.createElement('button');
  caret.type='button';caret.className='dm-expense-chevron';
  caret.setAttribute('aria-label','Expand Expenses categories');
  caret.setAttribute('aria-controls','dmExpenseTree');
  caret.setAttribute('aria-expanded','false');
  caret.title='Expand Expenses categories';
  caret.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.1"><path d="m6 9 6 6 6-6"/></svg>';
  row.appendChild(caret);
  const leaves=document.createElement('div');
  leaves.id='dmExpenseTree';leaves.className='dm-expense-children';
  leaves.hidden=true;
  for(const [key,label,role] of [
   ['ledger','Expenses Ledger','all'],['payroll','Payroll & Attendance','admin']
  ]){
   const leaf=document.createElement('button');
   leaf.type='button';leaf.className='nav dm-expense-leaf';
   leaf.dataset.expenseSubitem=key;
   leaf.dataset.view=key==='payroll'?'payroll':'expenses';
   leaf.textContent=label;
   if(role==='admin'){
    leaf.dataset.expenseAdmin='true';leaf.classList.add('admin-only');
   }
   leaf.addEventListener('click',event=>{
    event.stopPropagation();
    if(key==='payroll'&&window.donmacAuthenticatedRole!=='Admin')return;
    openExpense(true);
    requestAnimationFrame(updateLeaf);
   });
   leaves.appendChild(leaf);
  }
  row.after(leaves);
  function openExpense(open){
   leaves.hidden=!open;
   caret.setAttribute('aria-expanded',String(open));
   expense.setAttribute('aria-expanded',String(open));
   caret.title=open?'Collapse Expenses categories':'Expand Expenses categories';
   row.classList.toggle('is-open',open);
  }
  function updateLeaf(){
   const activeView=document.querySelector('.view.active')?.id;
   leaves.querySelectorAll('.dm-expense-leaf').forEach(el=>{
    const chosen=activeView==='view-'+el.dataset.view;
    el.classList.toggle('active',chosen);
    if(chosen)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');
   });
  }
  caret.onclick=event=>{event.stopPropagation();openExpense(leaves.hidden);};
  expense.addEventListener('click',()=>{
   openExpense(true);
   // Main heading selects the existing Expenses Ledger. The separate leaf
   // "Payroll & Attendance" is the only direct route to the payroll tab.
   requestAnimationFrame(updateLeaf);
  });
  window.donmacExpenseMenu={expand:openExpense,sync:updateLeaf};
  openExpense(false);
 }
 // Phones retain Main in the bottom bar; the More drawer uses the same
 // Team / Transactions / Management hierarchy without duplicating POS buttons.
 const mobilePanel=$('mobileMorePanel');
 if(mobilePanel && mobilePanel.dataset.hierarchyReady!=='1'){
  mobilePanel.dataset.hierarchyReady='1';
  const mobileHeader=mobilePanel.querySelector('.mobile-more-heading');
  if(mobileHeader){
   mobilePanel.prepend(mobileHeader);
   const h=mobileHeader.querySelector('strong');if(h)h.textContent='Navigation';
  }
  const defs=[
   {name:'Team',views:['users']},
   {name:'Transactions',views:['transactions','expenses']},
   {name:'Management',views:['reports','advanced','supply','catalog','logs','account']}
  ];
  const mobileGroups=[];
  defs.forEach(def=>{
   const wrap=document.createElement('section');wrap.className='dm-mobile-nav-group';
   const header=document.createElement('button');header.type='button';
   header.className='dm-mobile-nav-group-toggle';
   header.innerHTML='<span>'+def.name+'</span><span class="dm-mobile-nav-arrow" aria-hidden="true">⌄</span>';
   const pane=document.createElement('div');pane.className='dm-mobile-nav-group-items';
   pane.id='dmMobile'+def.name;
   header.setAttribute('aria-controls',pane.id);
   header.setAttribute('aria-expanded',String(def.name==='Transactions'));
   pane.hidden=def.name!=='Transactions';
   header.onclick=()=>{pane.hidden=!pane.hidden;header.setAttribute('aria-expanded',String(!pane.hidden));};
   wrap.append(header,pane);
   mobilePanel.appendChild(wrap);
   def.views.forEach(view=>{
    const button=mobilePanel.querySelector('.mobile-more-item[data-view="'+view+'"]');
    if(button)pane.appendChild(button);
    if(view==='expenses'&&button){
     const payroll=document.createElement('button');payroll.type='button';
     payroll.className='dm-mobile-expense-payroll';payroll.dataset.mobilePayroll='true';
     payroll.textContent='Payroll & Attendance';
     payroll.onclick=()=>{
      if(window.donmacAuthenticatedRole!=='Admin')return;
      button.click();window.donmacPayroll?.open?.('payroll');
      $('mobileMoreClose')?.click();
     };
     pane.appendChild(payroll);
    }
   });
   mobileGroups.push(wrap);
  });
  const syncMobile=()=>{
   for(const group of mobileGroups){
    const hasVisible=[...group.querySelectorAll('.mobile-more-item')].some(x=>!x.classList.contains('hidden'));
    group.hidden=!hasVisible;
   }
   const sub=mobilePanel.querySelector('[data-mobile-payroll]');
   if(sub)sub.hidden=window.donmacAuthenticatedRole!=='Admin';
  };
  new MutationObserver(()=>syncMobile()).observe(mobilePanel,{
   subtree:true,attributes:true,attributeFilter:['class']
  });
  syncMobile();
 }
 const sectionName=section=>{
  if(section.classList.contains('nav-communication'))return 'Team';
  if(section.classList.contains('nav-finance'))return 'Transactions';
  if(section.classList.contains('nav-management'))return 'Management';
  return 'Main';
 };
 for(let i=0;i<groups.length;i++){
  const section=groups[i],label=sectionName(section),key=label.toLowerCase();
  const old=section.querySelector(':scope > .nav-section-label');
  if(!old)continue;
  const tree=document.createElement('div');
  tree.className='dm-menu-group-items';tree.id='dmMenuGroup'+label.replace(/\s/g,'');
  const header=document.createElement('button');
  header.type='button';
  header.className='nav-section-label dm-nav-group-toggle';
  header.dataset.group=key;
  header.setAttribute('aria-controls',tree.id);
  header.setAttribute('aria-expanded','false');
  header.setAttribute('aria-label',label+' navigation group');
  const originalIcon=groupIcons[groupTitles.indexOf(label)]||groupIcons[0];
  header.innerHTML='<span class="dm-nav-group-icon">'+icons(groupTitles.indexOf(label))+'</span>'+
   '<span class="dm-nav-group-name">'+label+'</span>'+
   '<svg class="dm-nav-group-chevron" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  old.replaceWith(header);
  while(header.nextSibling)tree.appendChild(header.nextSibling);
  section.appendChild(tree);
  const setOpen=open=>{
   section.classList.toggle('dm-group-collapsed',!open);
   header.setAttribute('aria-expanded',String(open));
   tree.setAttribute('aria-hidden',String(!open));
  };
  header.onclick=()=>setOpen(section.classList.contains('dm-group-collapsed'));
  // Open Main initially; all other groups are available via the caret.
  setOpen(label==='Main');
  tree.addEventListener('click',event=>{
   if(event.target.closest('.nav[data-view]')||event.target.closest('[data-expense-subitem]'))
    setOpen(true);
  });
 }
 // Keep navigation usable after account switching and permission filtering.
 // Do not store the open/closed state across different franchise logins.
 let lastActiveView='';
 function sync(){
  const role=window.donmacAuthenticatedRole;
  nav.querySelectorAll('[data-expense-admin]').forEach(el=>{
   el.hidden=role!=='Admin';
  });
  const active=nav.querySelector('.nav.active[data-view]');
  const targetSection=active?.closest('.nav-section');
  const currentView=active?.dataset.view||'';
  // Open the new destination group on navigation, not on every unrelated
  // mutation; users must be able to close a group while its item is active.
  if(currentView!==lastActiveView){
   lastActiveView=currentView;
   if(targetSection){
    targetSection.classList.remove('dm-group-collapsed');
    targetSection.querySelector('.dm-nav-group-toggle')?.setAttribute('aria-expanded','true');
   }
  }
  window.donmacExpenseMenu?.sync?.();
 }
 const observer=new MutationObserver(()=>{
  if(nav.dataset.dmSyncing==='1')return;
  nav.dataset.dmSyncing='1';
  // Use an animation frame to avoid recursively observing our own tree changes.
  requestAnimationFrame(()=>{sync();nav.dataset.dmSyncing='0';});
 });
 observer.observe(nav,{subtree:true,attributes:true,attributeFilter:['class']});
 sync();
 window.donmacNavHierarchy={sync};
})();