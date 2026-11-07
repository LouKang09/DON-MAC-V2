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
 const idByCategory={rent:'financeRent',stocks:'financeStocks',salary:'financeSalary',
  transportation:'financeTransportation',electricity:'financeElectricity',ice:'financeIce',
  water:'financeWater',misc:'financeMisc'};
 const state={transactions:{page:1,branches:[],loading:false,queued:false},expenses:{page:1,branches:[],loading:false}};
 const now=today();
 for(const id of ['financeTransactionEnd','financeExpenseEnd','financeExpenseDate'])$(id).value=now;
 for(const id of ['financeTransactionStart','financeExpenseStart'])$(id).value=now.slice(0,7)+'-01';
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
  if(state[kind].loading){
   if(kind==='transactions')state.transactions.queued=true;
   return;
  }
  state[kind].loading=true;
  const requestQuery=query(kind);
  try{
   const data=await api('/api/finance/'+kind+'?'+requestQuery);
   // Do not overwrite results for newer search text or filter selections.
   if(kind==='transactions'&&requestQuery!==query('transactions')){
    state.transactions.queued=true;
    return;
   }
   state[kind].page=Math.min(Math.max(1,state[kind].page),Math.max(1,Math.ceil(Number(data.total||0)/10)));
   state[kind].branches=data.branches||[];
   if(kind==='transactions'){
    bindBranchOptions($('financeTransactionBranch'),data.branches||[],true);
    $('financeTransactionCount').textContent=Number(data.total||0).toLocaleString('en-PH');
    $('financeTransactionTotal').textContent=peso(data.salesTotal);
    $('financeTransactionsBody').innerHTML=(data.rows||[]).map(r=>
     '<tr><td>'+esc(when(r.date))+'</td><td><strong>'+esc(r.reference)+'</strong></td>'+
     '<td>'+esc(r.branch)+'</td><td>'+esc(r.cashier)+'</td><td>'+esc(r.payment)+'</td>'+
     '<td>'+esc(r.orderType||'—')+'</td><td>'+esc(r.status)+'</td><td>'+peso(r.amount)+'</td></tr>'
    ).join('')||'<tr><td colspan="8">No matching POS transactions.</td></tr>';
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
      '<td>'+esc(r.note||'—')+'</td><td><button type="button" class="finance-edit" data-edit-expense="'+esc(r.id)+'">Edit</button></td></tr>';
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
   if(kind==='transactions')$('financeTransactionsBody').innerHTML='<tr><td colspan="8">'+esc(err.message)+'</td></tr>';
   else message(err.message,true);
  }finally{
   state[kind].loading=false;
   if(kind==='transactions'&&state.transactions.queued){
    state.transactions.queued=false;
    load('transactions');
   }
  }
 }
 $('financeTransactionRefresh').onclick=()=>load('transactions');
 $('financeExpenseRefresh').onclick=()=>load('expenses');
 let transactionSearchTimer=null;
 const applyTransactionFilters=()=>{
  if(transactionSearchTimer!==null){clearTimeout(transactionSearchTimer);transactionSearchTimer=null;}
  state.transactions.page=1;
  load('transactions');
 };
 // Text searches are debounced to avoid issuing one network call per keystroke.
 $('financeTransactionSearch').addEventListener('input',()=>{
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
  $('financeTransactionStart').value=now.slice(0,7)+'-01';
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
  const btn=$('financeExpenseSave');btn.disabled=true;message('Saving expenses…');
  try{
   const body={date:$('financeExpenseDate').value,branchId:$('financeExpenseBranch').value,
    note:$('financeExpenseNote').value.trim()};
   for(const c of categories)body[c]=$(idByCategory[c]).value||'0';
   await api('/api/finance/expenses',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   message('Daily expenses saved for '+body.date+'.');
   state.expenses.page=1;await load('expenses');
  }catch(err){message(err.message,true);}
  finally{btn.disabled=false;}
 });
 window.donmacFinance={open(view){if(view==='transactions'||view==='expenses')load(view);}};
})();
