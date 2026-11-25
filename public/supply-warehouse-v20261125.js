/* Main Office operational warehouse console: no client-side stock calculations
 * are persisted. All purchases, receipts and corrections go through server
 * transactions; audit rows are server owned.
 */
(()=>{
'use strict';
const $=id=>document.getElementById(id),root=$('page-warehouse');
if(!root||window.donmacWarehouse)return;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=x=>'₱'+Number(x||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
const num=x=>Number(x||0).toLocaleString('en-PH',{maximumFractionDigits:0});
const localDay=()=>{
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'})
  .formatToParts(new Date()).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
 return p.year+'-'+p.month+'-'+p.day;
};
const dayShift=(s,n)=>{const d=new Date(s+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
const fmt=d=>d?new Intl.DateTimeFormat('en-PH',{dateStyle:'medium',timeZone:'Asia/Manila'}).format(new Date(d)):'—';
const tabs=[['overview','Stock & Reorder'],['purchasing','Purchasing & Receiving'],['movements','Stock Movements'],
 ['batches','Batches & Expiry'],['fulfillment','Fulfillment'],['claims','Returns & Claims'],['finance','Warehouse Finance'],['staff','Staff & Roles'],['password','My Password']];
let active='overview',data=null,orders=[],staffList=[],loading=false,receiving=null,editingReorder=null,
 receiptRows=1,financeData=null,financeFrom=dayShift(localDay(),-29),financeTo=localDay();
const base='/api/supply/office/warehouse';
const allowedTabs=()=>{
 const role=data?.staffRole||'MAIN_OFFICE';
 const permissions={MAIN_OFFICE:['overview','purchasing','movements','batches','fulfillment','claims','finance','staff'],
  WAREHOUSE_MANAGER:['overview','purchasing','movements','batches','fulfillment','claims','finance','password'],
  PURCHASING:['overview','purchasing','password'],INVENTORY:['overview','purchasing','movements','batches','claims','password'],
  FULFILLMENT:['overview','fulfillment','claims','password'],FINANCE:['overview','finance','password']};
 return permissions[role]||['overview'];
};
const tabHtml=()=>tabs.filter(([id])=>allowedTabs().includes(id)).map(([id,label])=>
 '<button type="button" class="warehouse-op-tab'+(active===id?' active':'')+
 '" data-warehouse-tab="'+id+'" aria-current="'+(active===id?'page':'false')+'">'+label+'</button>').join('');
const valid=()=>!$('officeApp').classList.contains('hidden')&&!root.classList.contains('hidden');
function notice(message,error=false){
 const n=$('warehouseOperationsNotice');n.textContent=String(message||'');n.classList.toggle('error',error);
}
async function request(path,method='GET',body){
 const r=await fetch(base+path,{method,credentials:'same-origin',cache:'no-store',
  headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
 const d=await r.json().catch(()=>({}));
 if(!r.ok)throw Error(d.error||'Warehouse action failed ('+r.status+').');
 return d;
}
async function load(force=false){
 if(!valid()||loading&&!force)return;
 loading=true;notice('Loading warehouse stock, purchases and audit records…');
 try{
  data=await request('/overview');
  if(!allowedTabs().includes(active))active='overview';
  if(active==='claims'||active==='fulfillment')await loadOrders();
  if(active==='staff')await loadStaff();
  if(active==='finance')await loadFinance();
  notice('Warehouse records updated · '+new Date().toLocaleTimeString('en-PH',{hour:'numeric',minute:'2-digit'}));
  render();
 }catch(e){notice(e.message,true);if(!data)$('warehouseOperationsBody').textContent='Unable to load warehouse records. Please refresh.'}
 finally{loading=false}
}
async function loadOrders(){
 const r=await request('/orders');
 orders=r.orders||[];
}
async function loadStaff(){
 const r=await request('/staff');staffList=r.staff||[];
}
async function loadFinance(){
 financeData=await request('/finance?'+new URLSearchParams({from:financeFrom,to:financeTo}));
}
function option(value,title,selected){return '<option value="'+esc(value)+'" '+(selected?'selected':'')+'>'+esc(title)+'</option>'}
const productOptions=(current)=>data.inventory.map(p=>option(p.id,p.name+' ('+p.uom+')',String(p.id)===String(current))).join('');
const supplierOptions=()=>data.suppliers.filter(s=>s.active).map(s=>option(s.id,s.name)).join('');
const orderOptions=delivered=>orders.filter(o=>delivered?
 ['DELIVERED','COMPLETED'].includes(o.status):
 ['APPROVED','PREPARING','DISPATCHED','DELIVERED','COMPLETED'].includes(o.status))
 .map(o=>option(o.id,o.id.slice(0,8).toUpperCase()+' · '+(o.branch_name||'Branch')+' · '+o.status)).join('');
function empty(txt,colspan){return '<tr><td colspan="'+colspan+'" class="wh-muted">'+esc(txt)+'</td></tr>'}
function summary(){
 const rows=data.inventory||[],stockouts=rows.filter(p=>p.available<=0).length,
 need=rows.filter(p=>p.configured&&p.suggestedPurchase>0).length,
 expiring=(data.batches||[]).filter(b=>b.expiry_date&&b.expiry_date<=dayShift(localDay(),30)&&b.remaining_qty>0).length;
 return '<div class="wh-metrics">'+[
  ['Active supplies',num(rows.length),'warehouse catalog'],
  ['Available units',num(rows.reduce((a,p)=>a+p.available,0)),'sum of listed SKU units'],
  ['Reserved units',num(rows.reduce((a,p)=>a+p.reserved,0)),'approved not dispatched'],
  ['In transit',num(rows.reduce((a,p)=>a+p.inTransit,0)),'dispatched supply units'],
  ['Out of stock',num(stockouts),'zero available'],
  ['Reorder needed',num(need),'configured thresholds'],
  ['Expiring batches',num(expiring),'next 30 days, receipt records only']
 ].map(x=>'<div class="wh-metric"><small>'+x[0]+'</small><strong>'+x[1]+'</strong><span>'+x[2]+'</span></div>').join('')+'</div>';
}
function overview(){
 const columns='<tr><th>Ingredient / Supply</th><th>Available</th><th>Reserved</th><th>In transit</th><th>Incoming PO</th><th>Reorder point</th><th>Suggested PO</th><th></th></tr>';
 const rows=data.inventory.map(p=>
  '<tr><th scope="row">'+esc(p.name)+'<small>'+esc(p.uom)+'</small></th><td>'+num(p.available)+'</td><td>'+num(p.reserved)+'</td><td>'+num(p.inTransit)+
  '</td><td>'+num(p.purchaseIncoming)+'</td><td>'+(p.configured?num(p.reorderPoint):'<span class="wh-pill neutral">Not configured</span>')+
  '</td><td><span class="wh-pill '+(p.suggestedPurchase>0?'warning':'ok')+'">'+num(p.suggestedPurchase)+'</span></td>'+
  '<td>'+(allowedTabs().includes('movements')?'<button type="button" class="btn outline wh-tiny" data-act="reorder" data-id="'+p.id+'">Set levels</button>':'—')+'</td></tr>').join('');
 const selected=data.inventory.find(p=>p.id===editingReorder);
 const form=selected?'<form class="wh-form wh-subform" id="whReorderForm"><h4>Reorder planning · '+esc(selected.name)+'</h4>'+
  '<input type="hidden" name="productId" value="'+selected.id+'"/>'+
  '<label>Reorder point<input name="reorderPoint" type="number" min="0" step="1" value="'+selected.reorderPoint+'" required/></label>'+
  '<label>Safety stock<input name="safetyStock" type="number" min="0" step="1" value="'+selected.safetyStock+'" required/></label>'+
  '<label>Supplier lead days<input name="leadDays" type="number" min="0" max="365" step="1" value="'+selected.leadDays+'" required/></label>'+
  '<button class="btn solid" type="submit">Save planning levels</button>'+
  '<button class="btn outline" data-act="cancel-reorder" type="button">Cancel</button></form>':'';
 return summary()+
  '<section class="wh-section"><div class="wh-head"><div><h3>Available, Reserved & In-Transit</h3><p>Approval deducts available inventory only once. Reserved and in-transit quantities are calculated from existing franchise orders; they are not deducted again.</p></div></div>'+
  '<div class="wh-table-wrap"><table><thead>'+columns+'</thead><tbody>'+ (rows||empty('No supplies configured.',8))+'</tbody></table></div>'+form+
  '<p class="wh-footnote">Suggested PO quantities use the last 30 days of completed supply distributions and configured lead days / safety stock. Stock quantities use each product\'s own unit; do not add unlike units for valuation.</p></section>';
}
function poLine(index){
 return '<div class="wh-line wh-po-line" data-line="'+index+'">'+
 '<label>Supply item<select class="wh-po-product" required><option value="">Select</option>'+productOptions()+'</select></label>'+
 '<label>Quantity<input class="wh-po-qty" type="number" min="1" max="1000000" step="1" required placeholder="Units"/></label>'+
 '<label>Unit purchase cost (₱)<input class="wh-po-cost" type="number" min=".01" max="1000000" step=".01" required placeholder="Cost"/></label>'+
 '<button type="button" class="btn outline wh-remove-line" data-act="remove-line" aria-label="Remove purchase line">×</button></div>';
}
function receiptForm(order){
 if(!order)return'';
 const lines=order.lines.filter(x=>Number(x.received_qty)<Number(x.ordered_qty));
 return'<section class="wh-subform"><h4>Receive shipment · '+esc(order.reference)+'</h4><p class="wh-muted">Record only physically verified quantities. Each saved receipt increases available stock once and creates a batch and movement record.</p>'+
 '<form id="whReceiveForm"><input type="hidden" name="purchaseId" value="'+esc(order.id)+'"/>'+
 lines.map(l=>'<div class="wh-receive-line" data-line-id="'+esc(l.id)+'"><strong>'+esc(l.product_name)+' <small>Remaining '+num(Number(l.ordered_qty)-Number(l.received_qty))+' '+esc(l.uom)+'</small></strong>'+
 '<label>Received qty<input type="number" class="wh-receive-qty" min="0" max="'+(Number(l.ordered_qty)-Number(l.received_qty))+'" step="1" value="0" required/></label>'+
 '<label>Batch / Lot<input type="text" class="wh-receive-lot" maxlength="100" placeholder="Supplier lot number"/></label>'+
 '<label>Expiry<input type="date" class="wh-receive-expiry" min="'+localDay()+'"/></label></div>').join('')+
 '<div class="wh-actions"><button type="submit" class="btn solid">Confirm received stock</button>'+
 '<button type="button" class="btn outline" data-act="cancel-receive">Cancel</button></div></form></section>';
}
function purchasing(){
 const receivingOnly=data?.staffRole==='INVENTORY';
 return(receivingOnly?'':'<div class="wh-grid-two"><section class="wh-section"><h3>Add Supplier</h3>'+
 '<form class="wh-form" id="whSupplierForm"><label>Supplier name<input name="name" maxlength="120" required/></label>'+
 '<label>Contact person<input name="contact" maxlength="100"/></label>'+
 '<label>Phone<input name="phone" maxlength="50" inputmode="tel"/></label>'+
 '<label>Email<input name="email" type="email" maxlength="120"/></label>'+
 '<label>Lead days<input name="leadDays" type="number" min="0" max="365" value="7" required/></label>'+
 '<button class="btn solid">Add supplier</button></form></section>'+
 '<section class="wh-section"><h3>Create Supplier Purchase Order</h3><form id="whPurchaseForm" class="wh-form">'+
 '<label>Supplier<select name="supplierId" required><option value="">Choose supplier</option>'+supplierOptions()+'</select></label>'+
 '<label>Reference<input name="reference" maxlength="75" placeholder="PO reference (generated if blank)"/></label>'+
 '<label>Expected date<input name="expectedOn" type="date"/></label>'+
 '<label>Notes<input name="note" maxlength="1000" placeholder="Delivery instructions"/></label>'+
 '<div class="wh-line-head"><h4>Purchase items</h4><button type="button" class="btn outline wh-tiny" data-act="add-line">+ Add item</button></div>'+
 '<div id="whPurchaseLines">'+poLine(0)+'</div>'+
 '<button class="btn solid">Create purchase order</button></form></section></div>')+
 '<section class="wh-section"><h3>Purchase Orders & Receipts</h3>'+
 '<div class="wh-table-wrap"><table><thead><tr><th>Reference</th><th>Supplier</th><th>Status</th><th>Received / Ordered</th><th>Expected</th><th>Action</th></tr></thead><tbody>'+
 data.purchases.map(o=>{const ordered=o.lines.reduce((a,l)=>a+Number(l.ordered_qty),0),received=o.lines.reduce((a,l)=>a+Number(l.received_qty),0);
  return'<tr><th>'+esc(o.reference)+'</th><td>'+esc(o.supplier)+'</td><td>'+esc(o.status)+'</td>'+
  '<td>'+num(received)+' / '+num(ordered)+'</td><td>'+esc(o.expected_on||'—')+'</td>'+
  '<td>'+(['ORDERED','PARTIAL'].includes(o.status)?'<button class="btn outline wh-tiny" data-act="receive" data-id="'+esc(o.id)+'">Receive</button>':'Complete')+'</td></tr>'}).join('')||
  empty('No purchase orders yet.',6)+'</tbody></table></div>'+receiptForm(data.purchases.find(o=>o.id===receiving))+'</section>';
}
function movements(){
 return'<div class="wh-grid-two"><section class="wh-section"><h3>Stock Count Correction / Damage</h3><p class="wh-muted">Use a signed change (+ for verified additional stock, − for verified loss). Receipts should use Purchasing & Receiving instead.</p>'+
 '<form class="wh-form" id="whAdjustForm"><label>Supply item<select name="productId" required><option value="">Choose</option>'+productOptions()+'</select></label>'+
 '<label>Quantity change<input name="delta" type="number" step="1" required placeholder="+5 or -2"/></label>'+
 '<label>Reason<select name="reason"><option value="STOCKTAKE">Stock count</option><option value="DAMAGE">Damaged in warehouse</option><option value="EXPIRED">Expired in warehouse</option><option value="CORRECTION">Other correction</option></select></label>'+
 '<label>Reference<input name="reference" maxlength="100" placeholder="Count sheet or incident #"/></label>'+
 '<label class="wh-wide">Explanation<textarea name="notes" rows="2" maxlength="1000" required></textarea></label>'+
 '<button class="btn solid" type="submit">Record audited adjustment</button></form></section>'+
 '<section class="wh-section"><h3>Movement Definitions</h3><p class="wh-muted">All warehouse stock changes have before/after counts, product references, date/time, and the acting Main Office account. Approval reserves available stock, and delivery does not deduct it again.</p>'+
 '<div class="wh-legend">RECEIPT · OPENING · RESERVE · RELEASE · DISPATCH · DELIVERY CONFIRMED · RETURN · STOCKTAKE · DAMAGE · EXPIRED</div></section></div>'+
 '<section class="wh-section"><h3>Most Recent Stock Movements</h3><div class="wh-table-wrap"><table>'+
 '<thead><tr><th>Date</th><th>Supply</th><th>Movement</th><th>Change</th><th>Before → After</th><th>Reference / Reason</th></tr></thead><tbody>'+
 data.movements.map(x=>'<tr><td>'+fmt(x.created_at)+'</td><th>'+esc(x.product_name)+'</th>'+
 '<td>'+esc(x.movement_type)+'</td><td>'+ (Number(x.quantity_change)>0?'+':'')+num(x.quantity_change)+'</td>'+
 '<td>'+num(x.before_qty)+' → '+num(x.after_qty)+'</td><td><strong>'+esc(x.reference||'—')+'</strong><small>'+esc(x.reason||'')+'</small></td></tr>').join('')||
 empty('New transactions will appear in this audit ledger. Earlier changes predate the ledger.',6)+'</tbody></table></div></section>';
}
function batches(){
 const today=localDay(),soon=dayShift(today,30);
 return'<section class="wh-section"><h3>Received Supplier Batches & Expiry Dates</h3>'+
 '<p class="wh-muted">Batch and lot records begin with new supplier receipts. Historical stock without lots is not assigned retroactively. Remaining lot quantities are receipt-level records; automatic FEFO allocation to franchise orders is not enabled yet.</p>'+
 '<div class="wh-table-wrap"><table><thead><tr><th>Supply</th><th>Lot</th><th>Supplier</th><th>Received</th><th>Receipt balance*</th><th>Expiry date</th><th>Flag</th></tr></thead><tbody>'+
 data.batches.map(b=>{const exp=b.expiry_date||'',flag=exp&&exp<today?'Expired':exp&&exp<=soon?'Within 30 days':'—';
  return'<tr><th>'+esc(b.product_name)+'</th><td>'+esc(b.lot_number)+'</td><td>'+esc(b.supplier_name||'—')+'</td><td>'+num(b.received_qty)+'</td><td>'+num(b.remaining_qty)+'</td><td>'+esc(exp||'Not recorded')+'</td><td><span class="wh-pill '+(flag==='Expired'?'danger':flag!=='—'?'warning':'neutral')+'">'+esc(flag)+'</span></td></tr>'}).join('')||
  empty('No lot records. Receive a new supplier shipment to begin tracking.',7)+'</tbody></table></div>'+
 '<p class="wh-footnote">*This is not an authoritative FEFO-remaining count until order-level batch allocations are introduced. Use the Available Stock tab for actual available totals.</p></section>';
}
function finance(){
 const d=financeData;
 const cards=d?'<div class="wh-metrics">'+[
  ['Delivered supply revenue',money(d.revenue)],
  ['Recorded purchase costs',money(d.knownCost)],
  ['Warehouse operating expenses',money(d.operatingExpenses)],
  ['Gross profit',d.grossProfit==null?'Cost incomplete':money(d.grossProfit)],
  ['Operating contribution',d.operatingProfit==null?'Cost incomplete':money(d.operatingProfit)],
  ['Uncosted delivered lines',num(d.unknownCostLines)]
 ].map(x=>'<div class="wh-metric"><small>'+x[0]+'</small><strong>'+x[1]+'</strong></div>').join('')+'</div>'+
 '<p class="wh-footnote">'+esc(d.note)+'</p>':'<p>Choose the date range and load warehouse finance.</p>';
 return'<section class="wh-section"><div class="wh-head"><div><h3>Supply Chain Operating Finance</h3><p>Warehouse supply sales only; royalties and franchise retail transactions are separate.</p></div></div>'+
 '<form id="whFinanceFilter" class="wh-form wh-horizontal"><label>From<input name="from" type="date" value="'+financeFrom+'" required/></label>'+
 '<label>To<input name="to" type="date" value="'+financeTo+'" required/></label><button class="btn outline">Apply range</button></form>'+cards+'</section>'+
 '<div class="wh-grid-two"><section class="wh-section"><h3>Add Warehouse Expense</h3>'+
 '<form id="whExpenseForm" class="wh-form"><label>Date<input name="spentOn" type="date" value="'+localDay()+'" required/></label>'+
 '<label>Category<select name="category"><option value="RENT">Rent</option><option value="UTILITIES">Utilities</option><option value="FREIGHT">Freight / Logistics</option><option value="PAYROLL">Warehouse Payroll</option><option value="SUPPLIES">Warehouse Supplies</option><option value="MAINTENANCE">Maintenance</option><option value="OTHER">Other</option></select></label>'+
 '<label>Amount (₱)<input name="amount" type="number" min=".01" step=".01" required/></label>'+
 '<label>Notes<input name="notes" maxlength="1000" placeholder="Expense details"/></label>'+
 '<button class="btn solid">Record expense</button></form></section>'+
 '<section class="wh-section"><h3>Operating Expense Ledger</h3><div class="wh-table-wrap"><table><thead><tr><th>Date</th><th>Category</th><th>Amount</th><th>Notes</th></tr></thead><tbody>'+
 data.expenses.map(x=>'<tr><td>'+esc(x.spent_on)+'</td><th>'+esc(x.category)+'</th><td>'+money(x.amount)+'</td><td>'+esc(x.notes||'—')+'</td></tr>').join('')||
 empty('No warehouse expenses recorded.',4)+'</tbody></table></div></section></div>';
}
function claims(){
 return'<div class="wh-grid-two"><section class="wh-section"><h3>Register Return, Shortage or Recall</h3><p class="wh-muted">Delivery shortages are records only. Only physically verified restocked goods increase available stock.</p>'+
 '<form class="wh-form" id="whClaimForm"><label>Delivered order<select name="orderId" required><option value="">Choose delivered order</option>'+orderOptions(true)+'</select></label>'+
 '<label>Supply item<select name="productId" required><option value="">Choose delivered item</option>'+productOptions()+'</select></label>'+
 '<label>Quantity<input name="quantity" type="number" min="1" step="1" required/></label>'+
 '<label>Claim type<select name="reason"><option value="RETURN">Physical return</option><option value="SHORTAGE">Missing upon delivery</option><option value="DAMAGED">Damaged item</option><option value="RECALL">Recall</option></select></label>'+
 '<label>Disposition<select name="disposition"><option value="RECORD_ONLY">Document only</option><option value="QUARANTINE">Quarantine / review</option><option value="RESTOCK">Verified returned to warehouse stock</option></select></label>'+
 '<label class="wh-wide">Explanation<textarea name="notes" rows="2" required maxlength="1000"></textarea></label>'+
 '<button class="btn solid">Record claim</button></form></section>'+
 '<section class="wh-section"><h3>Claims & Resolutions</h3><div class="wh-table-wrap"><table><thead><tr><th>Date</th><th>Order</th><th>Item / Qty</th><th>Reason</th><th>Disposition</th></tr></thead><tbody>'+
 data.returns.map(x=>'<tr><td>'+fmt(x.created_at)+'</td><td>'+esc(x.order_id.slice(0,8))+'</td><th>'+esc(x.product_name)+' ×'+num(x.quantity)+'</th><td>'+esc(x.reason)+'</td><td>'+esc(x.disposition)+'</td></tr>').join('')||
 empty('No claims recorded.',5)+'</tbody></table></div></section></div>';
}
function fulfillment(){
 return'<div class="wh-grid-two"><section class="wh-section"><h3>Picking, Packing & Delivery Evidence</h3>'+
 '<p class="wh-muted">Record a human-verified checkpoint for an approved order. Order status remains controlled by the existing Purchase Requests workflow.</p>'+
 '<form id="whFulfillmentForm" class="wh-form"><label>Order<select name="orderId" required><option value="">Choose order</option>'+orderOptions(false)+'</select></label>'+
 '<label>Checkpoint<select name="step"><option value="PICKED">Picked from warehouse</option><option value="PACKED">Packed and verified</option><option value="HANDOFF">Handed to delivery</option><option value="PROOF_OF_DELIVERY">Proof of delivery recorded</option></select></label>'+
 '<label>Courier / proof reference<input name="trackingRef" maxlength="120" placeholder="Courier tracking / receiving reference"/></label>'+
 '<label class="wh-wide">Recorded details<textarea name="note" rows="3" required maxlength="1000" placeholder="Prepared by, received by, condition or delivery evidence reference"></textarea></label>'+
 '<button class="btn solid">Add fulfillment checkpoint</button></form></section>'+
 '<section class="wh-section"><h3>View Checkpoint History</h3><form id="whFulfillmentHistoryFilter" class="wh-form wh-horizontal"><label>Order<select name="orderId" required><option value="">Choose order</option>'+orderOptions(false)+'</select></label><button class="btn outline">Show history</button></form>'+
 '<div id="whFulfillmentHistory"><p class="wh-muted">Select an order to see its picking and delivery events.</p></div>'+
 '</section></div>';
}
const whRoleOptions=['WAREHOUSE_MANAGER','PURCHASING','INVENTORY','FULFILLMENT','FINANCE'];
function staff(){
 const list=staffList.map(person=>
  '<tr><th scope="row">'+esc(person.fullName)+'<small>'+esc(person.username)+'</small></th>'+
  '<td>'+esc(person.role.replaceAll('_',' '))+'</td><td>'+ (person.active?'Active':'Disabled')+'</td>'+
  '<td class="wh-staff-actions"><button type="button" class="btn outline wh-tiny" data-act="toggle-staff" data-id="'+esc(person.id)+'" data-active="'+(person.active?'1':'0')+'" data-role="'+esc(person.role)+'">'+
   (person.active?'Disable':'Enable')+'</button>'+
  '<button type="button" class="btn outline wh-tiny" data-act="reset-staff" data-id="'+esc(person.id)+'">Reset password</button></td></tr>').join('');
 return '<div class="wh-grid-two"><section class="wh-section"><h3>Add Warehouse Employee</h3>'+
  '<p class="wh-muted">Each employee receives only the warehouse actions assigned to their role. Main Office approvals and billing are not accessible.</p>'+
  '<form id="whStaffForm" class="wh-form"><label>Full name<input name="fullName" minlength="2" maxlength="120" required/></label>'+
  '<label>Username<input name="username" minlength="3" maxlength="80" pattern="[A-Za-z0-9_.-]+" autocomplete="off" required/></label>'+
  '<label>Role<select name="role">'+whRoleOptions.map(r=>option(r,r.replaceAll('_',' '))).join('')+'</select></label>'+
  '<label>Temporary password (minimum 10 characters)<input name="password" type="password" minlength="10" maxlength="128" autocomplete="new-password" required/></label>'+
  '<button type="submit" class="btn solid">Create staff account</button></form></section>'+
  '<section class="wh-section"><h3>Role access</h3>'+
  '<p class="wh-muted"><strong>Warehouse Manager:</strong> all warehouse operations except creating staff accounts.</p>'+
  '<p class="wh-muted"><strong>Purchasing:</strong> supplier and purchase orders, stock overview.</p>'+
  '<p class="wh-muted"><strong>Inventory:</strong> verified receiving, stock corrections, expiry and reorder settings.</p>'+
  '<p class="wh-muted"><strong>Fulfillment:</strong> picking/packing, dispatch and claims.</p>'+
  '<p class="wh-muted"><strong>Finance:</strong> warehouse operating expenses and financial reports.</p>'+
  '<p class="wh-muted">Role changes and deactivation revoke all existing staff sessions. Only Main Office may manage staff credentials.</p></section></div>'+
  '<section class="wh-section"><h3>Warehouse Team</h3><div class="wh-table-wrap"><table>'+
  '<thead><tr><th>Staff member</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead><tbody>'+
  (list||empty('No warehouse staff accounts yet.',4))+'</tbody></table></div></section>';
}
function password(){
 return '<section class="wh-section"><h3>Change My Password</h3>'+
 '<p class="wh-muted">Changing your password invalidates existing staff sessions. You will sign in again with your new credentials.</p>'+
 '<form id="whStaffPasswordForm" class="wh-form" style="max-width:420px">'+
 '<label>Current password<input type="password" name="currentPassword" minlength="10" autocomplete="current-password" required/></label>'+
 '<label>New password<input type="password" name="newPassword" minlength="10" maxlength="128" autocomplete="new-password" required/></label>'+
 '<label>Confirm password<input type="password" name="confirmation" minlength="10" maxlength="128" autocomplete="new-password" required/></label>'+
 '<button class="btn solid" type="submit">Update Password & Sign Out</button></form></section>';
}
function render(){
 if(!data)return;
 if(!allowedTabs().includes(active))active='overview';
 $('warehouseOperationsTabs').innerHTML=tabHtml();
 const body={overview,purchasing,movements,batches,finance,claims,fulfillment,staff,password}[active];
 $('warehouseOperationsBody').innerHTML=body?body():'';
}
async function changeTab(tab){
 if(!allowedTabs().includes(tab))return;
 active=tab;receiving=null;editingReorder=null;
 if(!data){await load();return}
 if(tab==='claims'||tab==='fulfillment'){try{await loadOrders()}catch(err){notice(err.message,true)}}
 if(tab==='finance'){try{await loadFinance()}catch(err){notice(err.message,true)}}
 if(tab==='staff'){try{await loadStaff()}catch(err){notice(err.message,true)}}
 render();
}
async function mutate(path,method,payload,msg){
 const r=await request(path,method,payload);
 notice(msg||'Saved successfully.');
 await load(true);
 return r;
}
const fields=form=>Object.fromEntries(new FormData(form).entries());
async function submit(form){
 const id=form.id,d=fields(form);
 if(id==='whStaffForm'){
  await mutate('/staff','POST',d,'Warehouse employee created. Share the temporary password securely.');
  await loadStaff();render();
 }else if(id==='whStaffPasswordForm'){
  if(d.newPassword!==d.confirmation)throw Error('New passwords do not match.');
  await request('/change-password','POST',d);
  window.location.reload();
 }else if(id==='whSupplierForm'){
  if(!d.name?.trim())throw Error('Enter supplier name.');
  await mutate('/suppliers','POST',d,'Supplier registered.');
 }else if(id==='whPurchaseForm'){
  const lines=[...form.querySelectorAll('.wh-po-line')].map(x=>({
   productId:x.querySelector('.wh-po-product').value,quantity:x.querySelector('.wh-po-qty').value,
   unitCost:x.querySelector('.wh-po-cost').value
  }));
  if(lines.some(x=>!x.productId))throw Error('Select all purchased items.');
  await mutate('/purchases','POST',{...d,lines},'Purchase order created. Receive quantities only when physically delivered.');
 }else if(id==='whReceiveForm'){
  const lines=[...form.querySelectorAll('.wh-receive-line')]
   .map(x=>({lineId:x.dataset.lineId,quantity:Number(x.querySelector('.wh-receive-qty').value),
    lotNumber:x.querySelector('.wh-receive-lot').value,expiryDate:x.querySelector('.wh-receive-expiry').value}))
   .filter(x=>x.quantity>0);
  if(!lines.length)throw Error('Enter at least one verified received quantity.');
  const purchaseId=d.purchaseId;receiving=null;
  await mutate('/purchases/'+encodeURIComponent(purchaseId)+'/receive','POST',{lines},'Receipt posted. Stock and batch entries updated.');
 }else if(id==='whReorderForm'){
  const productId=Number(d.productId);editingReorder=null;
  await mutate('/reorder/'+productId,'PUT',d,'Reorder planning levels saved.');
 }else if(id==='whAdjustForm'){
  if(Number(d.delta)===0)throw Error('Enter a nonzero signed stock change.');
  await mutate('/adjust','POST',d,'Warehouse adjustment audited.');
 }else if(id==='whExpenseForm'){
  await mutate('/expenses','POST',d,'Warehouse expense recorded.');
 }else if(id==='whFinanceFilter'){
  financeFrom=d.from;financeTo=d.to;await loadFinance();render();
 }else if(id==='whClaimForm'){
  if(d.reason==='SHORTAGE'&&d.disposition==='RESTOCK')throw Error('Shortages cannot be restocked.');
  await mutate('/returns','POST',d,'Delivery issue recorded.');
 }else if(id==='whFulfillmentForm'){
  await mutate('/fulfillment','POST',d,'Fulfillment checkpoint recorded.');
 }else if(id==='whFulfillmentHistoryFilter'){
  if(!d.orderId)throw Error('Choose an order.');
  const r=await request('/fulfillment?orderId='+encodeURIComponent(d.orderId));
  $('whFulfillmentHistory').innerHTML=(r.events||[]).map(x=>
   '<div class="wh-timeline"><strong>'+esc(x.step)+'</strong><span>'+fmt(x.created_at)+
   ' · '+esc(x.actor)+'</span><p>'+esc(x.note||'')+'</p><small>'+esc(x.tracking_ref||'')+'</small></div>').join('')||
   '<p class="wh-muted">No checkpoints recorded for this order.</p>';
 }
}
$('warehouseOperationsRefresh')?.addEventListener('click',()=>{void load(true)});
$('warehouseOperationsTabs')?.addEventListener('click',event=>{
 const node=event.target.closest('[data-warehouse-tab]');
 if(node)void changeTab(node.dataset.warehouseTab);
});
$('warehouseOperationsBody')?.addEventListener('click',event=>{
 const node=event.target.closest('[data-act]');if(!node)return;
 const act=node.dataset.act;
 if(act==='toggle-staff'){
  const active=node.dataset.active==='1',id=node.dataset.id;
  if(!window.confirm((active?'Disable':'Enable')+' this warehouse staff account?'))return;
  void mutate('/staff/'+encodeURIComponent(id),'PUT',{active:!active,role:node.dataset.role},
   'Staff account '+(active?'disabled':'enabled')+'.').then(async()=>{await loadStaff();render()}).catch(e=>notice(e.message,true));
  return;
 }else if(act==='reset-staff'){
  const password=window.prompt('Enter a new temporary password for this employee (minimum 10 characters):');
  if(password===null)return;
  if(password.length<10){notice('Use at least 10 characters.',true);return;}
  void mutate('/staff/'+encodeURIComponent(node.dataset.id)+'/reset-password','POST',{password},
   'Password reset. Existing staff sessions are invalidated.').then(async()=>{await loadStaff();render()}).catch(e=>notice(e.message,true));
  return;
 }else if(act==='reorder')editingReorder=Number(node.dataset.id);
 else if(act==='cancel-reorder')editingReorder=null;
 else if(act==='receive')receiving=node.dataset.id;
 else if(act==='cancel-receive')receiving=null;
 else if(act==='add-line'){
  const host=$('whPurchaseLines');const idx=host.children.length;
  if(idx<100)host.insertAdjacentHTML('beforeend',poLine(idx));
  return;
 }else if(act==='remove-line'){
  const host=$('whPurchaseLines');if(host.children.length>1)node.closest('.wh-po-line').remove();
  return;
 }else return;
 render();
});
$('warehouseOperationsBody')?.addEventListener('submit',async event=>{
 const form=event.target;if(!form.id?.startsWith('wh'))return;
 event.preventDefault();const button=form.querySelector('button[type="submit"],button:not([type])');
 if(button)button.disabled=true;
 try{await submit(form)}
 catch(error){notice(error.message,true)}
 finally{if(button&&button.isConnected)button.disabled=false}
});
window.donmacWarehouse={load,changeTab};
})();
