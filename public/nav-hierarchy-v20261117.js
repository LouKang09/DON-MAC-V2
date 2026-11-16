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
   leaf.type='button';leaf.className='dm-expense-leaf';
   leaf.dataset.expenseSubitem=key;leaf.textContent=label;
   if(role==='admin')leaf.dataset.expenseAdmin='true';
   leaf.addEventListener('click',event=>{
    event.stopPropagation();
    if(key==='payroll'&&window.donmacAuthenticatedRole!=='Admin')return;
    expense.click();
    window.donmacPayroll?.open?.(key);
    openExpense(true);
    updateLeaf();
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
   const active=nav.querySelector('.nav[data-view="expenses"].active');
   leaves.querySelectorAll('.dm-expense-leaf').forEach(el=>{
    const chosen=active&&window.donmacPayroll?.currentTab?.()===el.dataset.expenseSubitem;
    el.classList.toggle('active',!!chosen);
    if(chosen)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');
   });
  }
  caret.onclick=event=>{event.stopPropagation();openExpense(leaves.hidden);};
  expense.addEventListener('click',()=>{
   openExpense(true);
   // Main heading selects the existing Expenses Ledger. The separate leaf
   // "Payroll & Attendance" is the only direct route to the payroll tab.
   window.donmacPayroll?.open?.('ledger');
   updateLeaf();
  });
  window.donmacExpenseMenu={expand:openExpense,sync:updateLeaf};
  openExpense(false);
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
 function sync(){
  const role=window.donmacAuthenticatedRole;
  nav.querySelectorAll('[data-expense-admin]').forEach(el=>{
   el.hidden=role!=='Admin';
  });
  const active=nav.querySelector('.nav.active[data-view]');
  const targetSection=active?.closest('.nav-section');
  if(targetSection){
   targetSection.classList.remove('dm-group-collapsed');
   targetSection.querySelector('.dm-nav-group-toggle')?.setAttribute('aria-expanded','true');
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