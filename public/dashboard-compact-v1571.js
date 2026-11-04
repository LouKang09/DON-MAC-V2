/* Dashboard v1.5.71: live activity statuses and paged inventory filters.
 * Both widgets stay independent of the sales trend and its chart state. */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const status=$('dashboardActivityStatus'),period=$('dashboardActivityPeriod'),inventory=$('dashboardInventoryStatus');
if(!status||!period||!inventory||window.donmacDashboardFilters)return;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>Number(n||0).toLocaleString('en-PH',{maximumFractionDigits:3});
const pesos=n=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(n||0));
const date=d=>{try{return new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(d))}catch(_){return String(d||'').slice(0,20)}};
let activityRequest=0,inventoryRequest=0,page=1,allInventory=[],initialized=false;
const stockClass=item=>{
 const stock=Number(item.stock)||0,threshold=Number(item.lowStockThreshold)||0;
 return stock<=0?'out':stock<=threshold?'low':'healthy';
};
function renderInventory(){
 const chosen=inventory.value;
 const selected=allInventory.filter(item=>chosen==='all'||(chosen==='attention'?item.low||stockClass(item)==='out':stockClass(item)===chosen))
   .sort((a,b)=>(Number(a.stock)||0)-(Number(b.stock)||0)||String(a.name).localeCompare(String(b.name)));
 const pages=Math.max(1,Math.ceil(selected.length/10));
 page=Math.max(1,Math.min(page,pages));
 const current=selected.slice((page-1)*10,page*10);
 $('dashboardLowStock').innerHTML=current.map(item=>
  '<tr><td>'+esc(item.name)+'</td><td>'+esc(String(item.uom||'').toUpperCase())+'</td>'+
  '<td class="num '+(stockClass(item)==='out'?'stock-low':'')+'">'+fmt(item.stock)+'</td>'+
  '<td class="num">'+fmt(item.lowStockThreshold)+'</td></tr>'
 ).join('')||'<tr><td colspan="4" class="stock-ok">No matching ingredients.</td></tr>';
 $('dashboardInventoryCount').textContent=selected.length+' of '+allInventory.length+' ingredients · '+inventory.selectedOptions[0].textContent;
 const pager=$('dashboardInventoryPager');
 if(!pager)return;
 pager.innerHTML=pages<=1?'':'<span>Page '+page+' of '+pages+'</span>'+
  '<button type="button" data-stock-page="-1" '+(page===1?'disabled':'')+'>Previous</button>'+
  '<button type="button" data-stock-page="1" '+(page===pages?'disabled':'')+'>Next</button>';
 pager.querySelectorAll('[data-stock-page]').forEach(button=>button.onclick=()=>{
   page=Math.max(1,Math.min(pages,page+Number(button.dataset.stockPage)));
   renderInventory();
 });
}
async function refreshInventory(){
 const seq=++inventoryRequest;
 $('dashboardInventoryCount').textContent='Loading inventory…';
 try{
  const res=await fetch('/api/inventory',{credentials:'same-origin',cache:'no-store'});
  if(!res.ok)throw Error('Inventory could not be loaded ('+res.status+').');
  const body=await res.json();
  if(seq!==inventoryRequest)return;
  allInventory=Array.isArray(body.items)?body.items:[];
  renderInventory();
 }catch(e){
  if(seq!==inventoryRequest)return;
  $('dashboardInventoryCount').textContent=e.message;
  $('dashboardLowStock').innerHTML='<tr><td colspan="4">Inventory unavailable.</td></tr>';
 }
}
async function refreshActivity(){
 const seq=++activityRequest;
 const params=new URLSearchParams({status:status.value,period:period.value});
 const branch=$('dashboardBranch');
 if(branch&&branch.value&&branch.value!=='all')params.set('branchId',branch.value);
 const holder=$('dashboardRecentTransactions');
 holder.innerHTML='<div class="dashboard-recent-empty">Loading matching transactions…</div>';
 try{
  const res=await fetch('/api/dashboard/activity?'+params.toString(),{credentials:'same-origin',cache:'no-store'});
  if(!res.ok)throw Error('Activity could not be loaded ('+res.status+').');
  const d=await res.json();if(seq!==activityRequest)return;
  const records=Array.isArray(d.rows)?d.rows:[];
  const label=status.selectedOptions[0].textContent+' · '+period.selectedOptions[0].textContent+
    ' · '+records.length+' shown';
  $('dashboardRecentScope').textContent=label+(records.length===10?' (latest 10)':'');
  if(!records.length){holder.innerHTML='<div class="dashboard-recent-empty">No matching transactions.</div>';return;}
  holder.innerHTML='<table class="dashboard-recent-table"><thead><tr>'+
    '<th>Receipt / Date</th><th>Customer / Type</th><th>Items</th><th>Payment</th><th>Status</th><th class="recent-amount">Total</th><th></th>'+
    '</tr></thead><tbody>'+records.map(row=>{
      const items=(Array.isArray(row.items)?row.items:[]).map(x=>fmt(x.qty)+'× '+String(x.name||'Item')).join(', ');
      const voided=row.status==='Deleted',reference=String(row.reference||'');
      return '<tr><td><strong>'+esc(reference)+'</strong><small>'+esc(date(row.soldAt))+'</small></td>'+
      '<td><b>'+esc(row.customerName||'Walk-in customer')+'</b><small>'+esc(row.orderType||'Take Away')+'</small></td>'+
      '<td class="recent-items" title="'+esc(items)+'">'+esc(items.length>70?items.slice(0,68)+'…':items||'—')+'</td>'+
      '<td><span class="dashboard-paymode">'+esc(row.paymentMode||'—')+'</span></td>'+
      '<td><span class="dashboard-activity-status '+(voided?'voided':'sold')+'">'+(voided?'Voided / Cancelled':'Sale')+'</span></td>'+
      '<td class="recent-amount">'+pesos(row.amount)+'</td>'+
      '<td><button type="button" class="dashboard-view-sale" data-sale-reference="'+esc(reference)+'" aria-label="View sale '+esc(reference)+'">View</button></td></tr>';
    }).join('')+'</tbody></table>';
 }catch(e){
  if(seq===activityRequest)holder.innerHTML='<div class="dashboard-recent-empty">'+esc(e.message)+'</div>';
 }
}
function refresh(){if(!initialized)initialized=true;refreshActivity();refreshInventory();}
status.addEventListener('change',refreshActivity);
period.addEventListener('change',refreshActivity);
inventory.addEventListener('change',()=>{page=1;renderInventory()});
window.donmacDashboardFilters={refresh};
if(window.__donmacDashboardData)refresh();
})();
