(() => {
 'use strict';
 const $=id=>document.getElementById(id);
 if(!$('view-expenses')||!$('view-transactions'))return;
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const peso=n=>'₱'+Number(n||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
 const when=v=>{const d=new Date(v);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat('en-PH',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Manila'}).format(d):String(v||'—');};
 const today=()=>{
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'Asia/Manila'}).formatToParts(new Date()).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  return parts.year+'-'+parts.month+'-'+parts.day;
 };
 const categories=['rent','stocks','salary','transportation','electricity','ice','water','misc'];
 const financeApiBase=window.donmacFranchiseUnified?'/api/live/finance':'/api/finance';
 const boundSession=window.donmacSessionGeneration?.();
 const sessionStillValid=()=>!window.donmacSessionGeneration||window.donmacSessionGeneration()===boundSession;
 const idByCategory={rent:'financeRent',stocks:'financeStocks',salary:'financeSalary',
  transportation:'financeTransportation',electricity:'financeElectricity',ice:'financeIce',
  water:'financeWater',misc:'financeMisc'};
 const state={transactions:{page:1,branches:[],loading:false,queued:false},expenses:{page:1,branches:[],loading:false}};
 // These totals always describe ALL records matching the current filters,
 // not only the ten transactions on the visible page.
 function transactionSummaryPending(){
  $('financeTransactionCount').textContent='…';
  $('financeTransactionTotal').textContent='…';
  $('financeTransactionCount').closest('.pos-finance-summary')?.setAttribute('aria-busy','true');
 }
 function transactionSummaryReady(){
  $('financeTransactionCount').closest('.pos-finance-summary')?.setAttribute('aria-busy','false');
 }
 function canManageExpenses(){return window.donmacFinanceAccess?.manageExpenses===true;}
 function enforceHistoryBounds(){
  if(cashierHistoryDays()===null)return;
  const min=firstAllowedDate();
  for(const id of ['financeTransactionStart','financeExpenseStart','financeTransactionEnd','financeExpenseEnd']){
   const el=$(id);if(!el)continue;el.min=min;el.max=now;
   if(el.value<min)el.value=min;
   if(el.value>now)el.value=now;
  }
 }
 function applyFinanceAccess(){
   const canManage=canManageExpenses();
   $('financeExpenseForm')?.classList.toggle('hidden',!canManage);
   $('financeExpenseForm')?.toggleAttribute('aria-hidden',!canManage);
 }
 const now=today();
 for(const id of ['financeTransactionEnd','financeExpenseEnd','financeExpenseDate'])$(id).value=now;
 const cashierHistoryDays=()=>{
  if(!window.donmacFranchiseUnified||window.donmacAuthenticatedRole!=='User')return null;
  const permissions=window.donmacCashierPermissions||[];
  return permissions.includes('report.window.month')?30:permissions.includes('report.window.week')?7:1;
 };
 const firstAllowedDate=()=>{
  const days=cashierHistoryDays();if(days===null)return now.slice(0,7)+'-01';
  return new Date(Date.parse(now+'T00:00:00Z')-(days-1)*86400000).toISOString().slice(0,10);
 };
 for(const id of ['financeTransactionStart','financeExpenseStart'])$(id).value=firstAllowedDate();
 function message(text,bad=false){
  const box=$('financeExpenseMessage');
  box.classList.toggle('hidden',!text);box.textContent=text;box.classList.toggle('bad',bad);
 }
 async function api(url,options={}){
  const res=await fetch(url,{credentials:'same-origin',cache:'no-store',...options});
  const body=await res.json().catch(()=>({}));
  if(!res.ok)throw Error(body.error||'Request failed ('+res.status+').');
  return body;
 }
 function query(kind){
  const trans=kind==='transactions',base=trans?'financeTransaction':'financeExpense';
  const p=new URLSearchParams();
  const branch=$(trans?'financeTransactionBranch':'financeExpenseFilterBranch').value;
  if(branch)p.set('branchId',branch);
  const start=$(base+'Start').value,end=$(base+'End').value;
  if(start)p.set('start',start);if(end)p.set('end',end);
  if(trans){
   for(const [key,id] of [['status','financeTransactionStatus'],['payment','financeTransactionPayment'],
    ['orderType','financeTransactionOrderType'],['search','financeTransactionSearch']]){
     const value=$(id)?.value?.trim();if(value)p.set(key,value);
   }
  }
  p.set('page',state[kind].page);
  return p.toString();
 }
 function bindBranchOptions(select,branches,all=false){
  const previous=select.value;
  select.innerHTML=(all?'<option value="">ALL</option>':'<option value="">Select branch</option>')+
   branches.map(b=>'<option value="'+b.id+'">'+esc(b.name)+'</option>').join('');
  if([...select.options].some(o=>o.value===previous))select.value=previous;
  else if(!all&&branches.length===1)select.value=String(branches[0].id);
 }
 function renderPager(id,pages,kind){
  const current=state[kind].page;
  $(id).innerHTML='<span>Page '+current+' of '+pages+'</span>'+
   '<button type="button" data-next="-1" '+(current<=1?'disabled':'')+'>Previous</button>'+
   '<button type="button" data-next="1" '+(current>=pages?'disabled':'')+'>Next</button>';
  $(id).querySelectorAll('[data-next]').forEach(b=>b.addEventListener('click',()=>{state[kind].page+=Number(b.dataset.next);load(kind);}));
 }
 async function load(kind){
  if(!sessionStillValid())return;
  if(state[kind].loading){
   if(kind==='transactions')state.transactions.queued=true;
   return;
  }
  state[kind].loading=true;
  const requestQuery=query(kind);
  if(kind==='transactions')transactionSummaryPending();
  try{
   const data=await api(financeApiBase+'/'+kind+'?'+requestQuery);
   if(!sessionStillValid())return; // Never render previous account results.
   // Do not overwrite results for newer search text or filter selections.
   if(kind==='transactions'&&requestQuery!==query('transactions')){
    state.transactions.queued=true;
    return;
   }
   state[kind].page=Math.min(Math.max(1,state[kind].page),Math.max(1,Math.ceil(Number(data.total||0)/10)));
   state[kind].branches=data.branches||[];
   if(kind==='transactions'){
    bindBranchOptions($('financeTransactionBranch'),data.branches||[],true);
    // API calculates both aggregates from exactly the same cashier/reference,
    // branch, status, and start/end-date WHERE clause as the ledger rows.
    $('financeTransactionCount').textContent=Number(data.total||0).toLocaleString('en-PH');
    $('financeTransactionTotal').textContent=peso(data.salesTotal);
    transactionSummaryReady();
    $('financeTransactionsBody').innerHTML=(data.rows||[]).map(r=>{
     const voided=r.status==='Voided'||r.status==='Deleted';
     const footprint=voided?'<small class="dm-void-footprint">'+
      'Voided '+esc(r.voidedAt?when(r.voidedAt):'at an earlier date')+
      '<span>By: '+esc(r.voidedBy||'Not recorded')+'</span>'+
      '<span>Reason: '+esc(r.voidReason||'Not recorded for this receipt')+'</span></small>':'';
     const action=r.status==='Sold'?
      '<button type="button" class="dm-void-action" data-void-ref="'+esc(r.reference)+'" data-void-branch="'+esc(r.branchId)+'" '+
      'data-dm-icon="trash2" title="Void" aria-label="Void transaction '+esc(r.reference)+'">'+
      '<svg class="dm-ua-native" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true">'+
      '<path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3"/></svg><span>Void</span></button>':
      '<span class="dm-void-unavailable" title="Voided transactions remain in the audit ledger">—</span>';
     return '<tr><td>'+esc(when(r.date))+'</td><td><strong>'+esc(r.reference)+'</strong></td>'+
      '<td>'+esc(r.branch)+'</td><td>'+esc(r.cashier)+'</td><td>'+esc(r.payment)+'</td>'+
      '<td>'+esc(r.orderType||'—')+'</td><td class="dm-void-status"><strong>'+esc(voided?'Voided':r.status)+'</strong>'+footprint+'</td>'+
      '<td>'+peso(r.amount)+'</td><td>'+action+'</td></tr>';
    }).join('')||'<tr><td colspan="9">No matching POS transactions.</td></tr>';
    window.donmacAnimatedIcons?.refresh?.();
    renderPager('financeTransactionPages',Math.max(1,Math.ceil(Number(data.total||0)/10)),kind);
   }else{
    bindBranchOptions($('financeExpenseBranch'),data.branches||[],false);
    bindBranchOptions($('financeExpenseFilterBranch'),data.branches||[],true);
    $('financeExpenseTotal').textContent=peso(data.grandTotal);
    $('financeExpenseCount').textContent=Number(data.total||0).toLocaleString('en-PH');
    $('financeExpensesBody').innerHTML=(data.rows||[]).map(r=>{
     const total=categories.reduce((sum,k)=>sum+Number(r[k]||0),0);
     return'<tr><td>'+esc(r.date)+'</td><td>'+esc(r.branch)+'</td>'+
      categories.map(k=>'<td>'+peso(r[k])+'</td>').join('')+'<td><strong>'+peso(total)+'</strong></td>'+
      '<td>'+esc(r.note||'—')+'</td><td>'+(canManageExpenses()?'<button type="button" class="finance-edit" data-edit-expense="'+esc(r.id)+'">Edit</button>':'View only')+'</td></tr>';
    }).join('')||'<tr><td colspan="13">No expense records for the selected range.</td></tr>';
    const byId=new Map((data.rows||[]).map(x=>[x.id,x]));
    $('financeExpensesBody').querySelectorAll('[data-edit-expense]').forEach(b=>b.addEventListener('click',()=>{
     const record=byId.get(b.dataset.editExpense);if(!record)return;
     $('financeExpenseDate').value=record.date;$('financeExpenseBranch').value=String(record.branchId);
     for(const c of categories)$(idByCategory[c]).value=String(record[c]||0);
     $('financeExpenseNote').value=record.note||'';
     message('Editing '+record.branch+' expenses for '+record.date+'. Save to update this day.');
     $('financeExpenseForm').scrollIntoView({behavior:'smooth',block:'center'});
    }));
    renderPager('financeExpensePages',Math.max(1,Math.ceil(Number(data.total||0)/10)),kind);
   }
  }catch(err){
   if(!sessionStillValid())return;
   if(kind==='transactions'&&requestQuery!==query('transactions')){
    state.transactions.queued=true;return;
   }
   if(kind==='transactions'){
    $('financeTransactionsBody').innerHTML='<tr><td colspan="9">'+esc(err.message)+'</td></tr>';
    $('financeTransactionCount').textContent='—';
    $('financeTransactionTotal').textContent='—';
    transactionSummaryReady();
   }
   else message(err.message,true);
  }finally{
   state[kind].loading=false;
   if(kind==='transactions'&&state.transactions.queued){
    state.transactions.queued=false;
    load('transactions');
   }
  }
 }
 $('financeTransactionsBody').addEventListener('click',async event=>{
  const button=event.target.closest('button[data-void-ref]');
  if(!button||button.disabled)return;
  // Owners may inspect the row, but only cashiers can void a completed sale.
  if(window.donmacAuthenticatedRole!=='User'){
   await window.donmacPrompt.notify('Voiding transactions is allowed only for cashiers.',{
    title:'Cashier-Only Action',variant:'warning'});
   return;
  }
  if(!window.donmacFranchiseUnified){
   await window.donmacPrompt.notify('Voiding this legacy receipt is unavailable here. Only isolated franchise sales can be voided.',{
    title:'Void Not Available',variant:'warning'});
   return;
  }
  const ref=button.dataset.voidRef,branchId=button.dataset.voidBranch;
  if(!/^BR-[A-F0-9]{18}$/.test(ref)||!/^\d+$/.test(branchId))return;
  const reason=await window.donmacPrompt.input('Why are you voiding receipt '+ref+'? This action is permanently recorded.',{
   title:'Void Transaction',inputLabel:'Reason (required)',placeholder:'Enter the reason for voiding this sale',
   minLength:5,maxLength:500,confirmText:'Review Void',cancelText:'No',variant:'danger'});
  if(reason===null)return;
  if(!await window.donmacPrompt.confirm('Void '+ref+' and restore the ingredients to this branch? Reason: '+reason,{
   title:'Confirm Void',confirmText:'Yes, Void',cancelText:'No',variant:'danger'}))return;
  button.disabled=true;
  try{
   await api('/api/live/transactions/'+encodeURIComponent(ref)+'/void',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({branchId,restoreStock:true,reason})});
   await window.donmacPrompt.notify('Receipt '+ref+' was voided. The cashier, reason and void time are recorded.',{variant:'success'});
   await load('transactions');
  }catch(error){await window.donmacPrompt.notify(error.message,{variant:'error'});}
  finally{button.disabled=false;}
 });
 $('financeTransactionRefresh').onclick=()=>load('transactions');
 $('financeExpenseRefresh').onclick=()=>load('expenses');
 let transactionSearchTimer=null;
 const applyTransactionFilters=()=>{
  if(transactionSearchTimer!==null){clearTimeout(transactionSearchTimer);transactionSearchTimer=null;}
  state.transactions.page=1;
  transactionSummaryPending();
  load('transactions');
 };
 // Text searches are debounced to avoid issuing one network call per keystroke.
 $('financeTransactionSearch').addEventListener('input',()=>{
  // Immediately invalidate the previous cashier/date totals while typing,
  // including when an older search is still waiting on the server.
  transactionSummaryPending();
  if(transactionSearchTimer!==null)clearTimeout(transactionSearchTimer);
  transactionSearchTimer=setTimeout(()=>{
   transactionSearchTimer=null;
   applyTransactionFilters();
  },260);
 });
 for(const id of ['financeTransactionStart','financeTransactionEnd','financeTransactionBranch',
  'financeTransactionStatus','financeTransactionPayment','financeTransactionOrderType']){
  $(id).addEventListener('change',applyTransactionFilters);
 }
 $('financeTransactionReset').onclick=()=>{
  if(transactionSearchTimer!==null){clearTimeout(transactionSearchTimer);transactionSearchTimer=null;}
  $('financeTransactionStart').value=firstAllowedDate();
  $('financeTransactionEnd').value=now;
  for(const id of ['financeTransactionBranch','financeTransactionStatus','financeTransactionPayment',
   'financeTransactionOrderType','financeTransactionSearch'])$(id).value='';
  applyTransactionFilters();
 };
 $('financeTransactionSearch').addEventListener('keydown',event=>{
  if(event.key==='Enter'){event.preventDefault();applyTransactionFilters();}
 });
 $('financeExpenseApply').onclick=()=>{state.expenses.page=1;load('expenses');};
 $('financeExpenseForm').addEventListener('submit',async e=>{
  e.preventDefault();
  if(!canManageExpenses()){message('Your Owner has not granted permission to record or edit expenses.',true);return;}
  const btn=$('financeExpenseSave');btn.disabled=true;message('Saving expenses…');
  try{
   const body={date:$('financeExpenseDate').value,branchId:$('financeExpenseBranch').value,
    note:$('financeExpenseNote').value.trim()};
   for(const c of categories)body[c]=$(idByCategory[c]).value||'0';
   await api(financeApiBase+'/expenses',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   message('Daily expenses saved for '+body.date+'.');
   state.expenses.page=1;await load('expenses');
  }catch(err){message(err.message,true);}
  finally{btn.disabled=false;}
 });
 window.donmacFinance={open(view){enforceHistoryBounds();applyFinanceAccess();if(view==='transactions'||view==='expenses')load(view);}};
})();
