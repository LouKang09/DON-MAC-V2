/* v1.5.73 — five-row transaction paging with expandable purchase details. */
(()=>{
 'use strict';
 const $=id=>document.getElementById(id);
 const status=$('dashboardActivityStatus'),period=$('dashboardActivityPeriod'),inventory=$('dashboardInventoryStatus');
 if(!status||!period||!inventory)return;
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fmt=n=>Number(n||0).toLocaleString('en-PH',{maximumFractionDigits:3});
 const pesos=n=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(n||0));
 const date=d=>{try{return new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(d))}catch(_){return String(d||'').slice(0,20)}};
 let activityRequest=0,inventoryRequest=0,inventoryPage=1,activityPage=1,allInventory=[],inventoryLoadedAt=0;
 let lastActivitySignature='',lastActivityBranch=null,activityLoaded=false;
 const pages=$('dashboardActivityPages')||(()=>{
  const nav=document.createElement('nav');nav.id='dashboardActivityPages';
  nav.className='dashboard-activity-pages';nav.setAttribute('aria-label','Recent transaction pages');
  $('dashboardRecentTransactions').after(nav);return nav;
 })();
 const stockClass=item=>{
  const stock=Number(item.stock)||0,threshold=Number(item.lowStockThreshold)||0;
  return stock<=0?'out':stock<=threshold?'low':'healthy';
 };
 function renderInventory(){
  const chosen=inventory.value;
  const selected=allInventory.filter(item=>chosen==='all'||(chosen==='attention'?item.low||stockClass(item)==='out':stockClass(item)===chosen))
    .sort((a,b)=>(Number(a.stock)||0)-(Number(b.stock)||0)||String(a.name).localeCompare(String(b.name)));
  const total=Math.max(1,Math.ceil(selected.length/10));
  inventoryPage=Math.max(1,Math.min(inventoryPage,total));
  const slice=selected.slice((inventoryPage-1)*10,inventoryPage*10);
  $('dashboardLowStock').innerHTML=slice.map(item=>
   '<tr><td>'+esc(item.name)+'</td><td>'+esc(String(item.uom||'').toUpperCase())+'</td>'+
   '<td class="num '+(stockClass(item)==='out'?'stock-low':'')+'">'+fmt(item.stock)+'</td>'+
   '<td class="num">'+fmt(item.lowStockThreshold)+'</td></tr>'
  ).join('')||'<tr><td colspan="4" class="stock-ok">No matching ingredients.</td></tr>';
  $('dashboardInventoryCount').textContent=selected.length+' of '+allInventory.length+' ingredients · '+
   inventory.selectedOptions[0].textContent+' · Company-wide stock (shared)';
  const pager=$('dashboardInventoryPager');
  if(!pager)return;
  pager.innerHTML=total<=1?'':'<span>Page '+inventoryPage+' of '+total+'</span>'+
   '<button type="button" data-stock-page="-1" '+(inventoryPage===1?'disabled':'')+'>Previous</button>'+
   '<button type="button" data-stock-page="1" '+(inventoryPage===total?'disabled':'')+'>Next</button>';
  pager.querySelectorAll('[data-stock-page]').forEach(button=>button.onclick=()=>{
   inventoryPage=Math.max(1,Math.min(total,inventoryPage+Number(button.dataset.stockPage)));
   renderInventory();
  });
 }
 async function refreshInventory(){
  if(inventoryLoadedAt&&Date.now()-inventoryLoadedAt<12000){renderInventory();return;}
  const seq=++inventoryRequest;
  $('dashboardInventoryCount').textContent='Loading shared company inventory…';
  try{
   const res=await fetch('/api/inventory',{credentials:'same-origin',cache:'no-store'});
   if(!res.ok)throw Error('Inventory unavailable (HTTP '+res.status+').');
   const data=await res.json();if(seq!==inventoryRequest)return;
   allInventory=Array.isArray(data.items)?data.items:[];inventoryLoadedAt=Date.now();renderInventory();
  }catch(e){
   if(seq!==inventoryRequest)return;
   $('dashboardInventoryCount').textContent=e.message;
   $('dashboardLowStock').innerHTML='<tr><td colspan="4">Inventory unavailable.</td></tr>';
  }
 }
 async function refreshActivity(){
  const seq=++activityRequest;
  const params=new URLSearchParams({status:status.value,period:period.value,page:String(activityPage)});
  const branch=$('dashboardBranch');
  if(branch&&branch.value&&branch.value!=='all')params.set('branchId',branch.value);
  const holder=$('dashboardRecentTransactions');
  // Retain existing rows and pagination during background refresh to prevent layout jumps.
  holder.setAttribute('aria-busy','true');
  try{
   const res=await fetch('/api/dashboard/activity?'+params.toString(),{credentials:'same-origin',cache:'no-store'});
   if(!res.ok)throw Error('Transactions unavailable (HTTP '+res.status+').');
   const d=await res.json();if(seq!==activityRequest)return;
   const records=Array.isArray(d.rows)?d.rows:[];
   activityPage=Number(d.page)||1;
   const totalPages=Math.max(1,Number(d.pages)||1);
   const signature=JSON.stringify({status:status.value,period:period.value,
      branch:params.get('branchId')||'all',page:activityPage,pages:totalPages,total:d.total,rows:records});
   if(activityLoaded&&signature===lastActivitySignature){
     holder.removeAttribute('aria-busy');return;
   }
   const oldScroll=holder.scrollTop,oldHorizontalScroll=holder.scrollLeft;
   const expanded=new Set([...holder.querySelectorAll('button[data-activity-items][aria-expanded="true"]')]
     .map(button=>button.closest('tr')?.querySelector('[data-sale-reference]')?.dataset.saleReference)
     .filter(Boolean));
   activityLoaded=true;
   lastActivitySignature=signature;
   $('dashboardRecentScope').textContent=status.selectedOptions[0].textContent+' · '+period.selectedOptions[0].textContent+
    ' · '+(Number(d.total)||0)+' transaction(s)';
   pages.innerHTML='<span>Page '+activityPage+' of '+totalPages+'</span>'+
    '<button type="button" data-activity-page="-1" '+(activityPage===1?'disabled':'')+'>Previous</button>'+
    '<button type="button" data-activity-page="1" '+(activityPage===totalPages?'disabled':'')+'>Next</button>';
   pages.querySelectorAll('[data-activity-page]').forEach(button=>button.onclick=()=>{
    activityPage=Math.max(1,Math.min(totalPages,activityPage+Number(button.dataset.activityPage)));
    refreshActivity();
   });
   if(!records.length){
     holder.innerHTML='<div class="dashboard-recent-empty">No matching transactions.</div>';
     holder.removeAttribute('aria-busy');return;
   }
   holder.innerHTML='<table class="dashboard-recent-table"><thead><tr>'+
    '<th>Receipt / Date</th><th>Customer / Type</th><th>Items</th><th>Payment</th>'+
    '<th>Status</th><th class="recent-amount">Total</th><th></th></tr></thead><tbody>'+
    records.map((row,index)=>{
     const list=Array.isArray(row.items)?row.items:[];
     const reference=String(row.reference||''),voided=row.status==='Deleted';
     const isExpanded=expanded.has(reference);
     const breakdown='<div class="recent-items-breakdown"><strong>Purchased items · '+esc(reference)+'</strong>'+
      '<table><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Line total</th></tr></thead><tbody>'+
      list.map(item=>'<tr><td>'+esc(item.name||'Item')+'</td><td class="num">'+fmt(item.qty)+'</td>'+
       '<td class="num">'+pesos(item.unitPrice)+'</td><td class="num">'+pesos(item.lineTotal)+'</td></tr>').join('')+
      '</tbody></table></div>';
     return '<tr><td><strong>'+esc(reference)+'</strong><small>'+esc(date(row.soldAt))+'</small></td>'+
      '<td><b>'+esc(row.customerName||'Walk-in customer')+'</b><small>'+esc(row.orderType||'Take Away')+'</small></td>'+
      '<td><button type="button" data-activity-items="'+index+'" aria-expanded="'+String(isExpanded)+'">'+list.length+' items · '+(isExpanded?'Hide':'View')+'</button></td>'+
      '<td><span class="dashboard-paymode">'+esc(row.paymentMode||'—')+'</span></td>'+
      '<td><span class="dashboard-activity-status '+(voided?'voided':'sold')+'">'+(voided?'Voided / Cancelled':'Sale')+'</span></td>'+
      '<td class="recent-amount">'+pesos(row.amount)+'</td>'+
      '<td><button type="button" class="dashboard-view-sale" data-sale-reference="'+esc(reference)+'">View</button></td></tr>'+
      '<tr class="activity-items-detail" data-activity-detail="'+index+'" '+(isExpanded?'':'hidden')+'><td colspan="7">'+breakdown+'</td></tr>';
    }).join('')+'</tbody></table>';
   holder.scrollTop=oldScroll;holder.scrollLeft=oldHorizontalScroll;
   holder.removeAttribute('aria-busy');
  }catch(e){
   if(seq!==activityRequest)return;
   if(!activityLoaded){
     holder.innerHTML='<div class="dashboard-recent-empty">'+esc(e.message)+'</div>';
   }else{
     $('dashboardRecentScope').textContent='Could not refresh transactions · previous records retained';
   }
   holder.removeAttribute('aria-busy');
  }
 }
 $('dashboardRecentTransactions').addEventListener('click',event=>{
  const trigger=event.target.closest('button[data-activity-items]');
  if(!trigger)return;
  const tr=$('dashboardRecentTransactions').querySelector('tr[data-activity-detail="'+trigger.dataset.activityItems+'"]');
  if(!tr)return;
  const expanded=trigger.getAttribute('aria-expanded')==='true';
  tr.hidden=expanded;trigger.setAttribute('aria-expanded',String(!expanded));
  trigger.textContent=trigger.textContent.replace(expanded?'Hide':'View',expanded?'View':'Hide');
 });
 function refresh(){
  const branch=$('dashboardBranch');
  const selectedBranch=branch&&branch.value&&branch.value!=='all'?branch.value:'all';
  if(lastActivityBranch!==selectedBranch){
    activityPage=1;lastActivityBranch=selectedBranch;lastActivitySignature='';
  }
  refreshActivity();refreshInventory();
 }
 status.addEventListener('change',()=>{activityPage=1;refreshActivity()});
 period.addEventListener('change',()=>{activityPage=1;refreshActivity()});
 inventory.addEventListener('change',()=>{inventoryPage=1;renderInventory()});
 window.donmacDashboardFilters={refresh,refreshActivity,refreshInventory};
 if(window.__donmacDashboardData)refresh();
})();
