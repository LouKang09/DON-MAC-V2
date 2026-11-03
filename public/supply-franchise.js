(() => {
'use strict';
const $=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>'₱'+Number(n||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
const title=s=>String(s||'').replaceAll('_',' ').toLowerCase().replace(/^./,x=>x.toUpperCase());
const date=s=>new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}).format(new Date(s));
let products=[],branches=[],urgentFee=0,orders=[],notices=[],currentId=null,encodedPhoto='',page=1,loaded=false,timer=null,processing=false;
const quantities=new Map();
const alert=(msg,bad=false)=>{const x=$('supplyAlert');x.classList.remove('hidden');x.textContent=msg;x.style.color=bad?'#9d3138':'#165939';x.style.background=bad?'#ffe8e8':'#e6f5e9';};
async function api(path,options={}){
 const r=await fetch(path,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});
 const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||'Request failed ('+r.status+').');
 return data;
}
function subtotal(){return products.reduce((a,p)=>a+(quantities.get(p.id)||0)*p.price,0);}
function totals(){
 const sub=subtotal(),extra=$('supplyPriority').value==='URGENT'?urgentFee:0;
 $('supplySubtotal').textContent=money(sub);$('supplyUrgentFee').textContent=money(extra);$('supplyTotal').textContent=money(sub+extra);
}
function renderProducts(){
 const term=$('supplyProductSearch').value.toLowerCase().trim();
 $('supplyProductsList').innerHTML=products.filter(x=>x.active&&x.name.toLowerCase().includes(term)).map(p=>{
  const value=quantities.get(p.id)||0;
  return '<div class="supply-product-row '+(value?'selected':'')+'"><div><strong>'+esc(p.name)+'</strong><small>'+esc(p.uom)+'</small></div>'+
  '<span class="supply-price">'+money(p.price)+'</span><input type="number" inputmode="numeric" min="0" max="10000" step="1" aria-label="Quantity for '+esc(p.name)+'" data-supply-qty="'+p.id+'" value="'+(value||'')+'" placeholder="0" /></div>';
 }).join('')||'<p class="muted" style="padding:18px">No supplies match this search.</p>';
 $('supplyProductsList').querySelectorAll('[data-supply-qty]').forEach(el=>el.onchange=()=>{
  const id=Number(el.dataset.supplyQty),quantity=Number(el.value||0);
  if(!Number.isInteger(quantity)||quantity<0||quantity>10000){alert('Quantity must be a whole number between 0 and 10,000.',true);el.value=String(quantities.get(id)||0);return;}
  if(quantity)quantities.set(id,quantity);else quantities.delete(id);
  el.closest('.supply-product-row').classList.toggle('selected',!!quantity);totals();
 });
}
async function decodePhoto(file){
 if(!file)throw Error('Attach a payment confirmation image.');
 if(file.size>1024*1024)throw Error('Payment photo exceeds 1 MB. Select or compress the image before submitting.');
 if(file.size<50||!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('Use a valid JPG, PNG, or WebP file smaller than 1 MB.');
 const head=new Uint8Array(await file.slice(0,16).arrayBuffer());
 const valid=(file.type==='image/jpeg'&&head[0]===255&&head[1]===216&&head[2]===255)||
 (file.type==='image/png'&&[137,80,78,71,13,10,26,10].every((n,i)=>head[i]===n))||
 (file.type==='image/webp'&&String.fromCharCode(...head.slice(0,4))==='RIFF'&&String.fromCharCode(...head.slice(8,12))==='WEBP');
 if(!valid)throw Error('Photo could not be decoded: file contents do not match its type.');
 const url=URL.createObjectURL(file);
 try{
  const image=new Image();image.src=url;
  try{await image.decode();}catch(_){throw Error('Photo could not be decoded. Please take or select another photo.');}
  if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth>10000||image.naturalHeight>10000)throw Error('Invalid image dimensions.');
  const max=1400,ratio=Math.min(1,max/Math.max(image.naturalWidth,image.naturalHeight)),canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(image.naturalWidth*ratio));canvas.height=Math.max(1,Math.round(image.naturalHeight*ratio));
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('This browser cannot decode the selected photo.');
  ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
  let output=canvas.toDataURL('image/jpeg',.78);
  if(output.length>1300000)output=canvas.toDataURL('image/jpeg',.48);
  if(output.length>1300000)throw Error('Compressed payment photo still exceeds 1 MB. Select a smaller image.');
  return output;
 }finally{URL.revokeObjectURL(url);}
}
$('supplyPaymentPhoto').onchange=async e=>{
 const file=e.target.files?.[0];encodedPhoto='';$('supplyPhotoPreview').classList.add('hidden');
 if(!file)return;
 processing=true;$('supplyPhotoError').classList.add('hidden');
 try{
  encodedPhoto=await decodePhoto(file);$('supplyPhotoPreview').src=encodedPhoto;$('supplyPhotoPreview').classList.remove('hidden');
  $('supplyPhotoPreview').onerror=()=>{encodedPhoto='';$('supplyPhotoError').textContent='Payment photo could not be decoded.';$('supplyPhotoError').classList.remove('hidden');};
 }catch(err){$('supplyPhotoError').textContent=err.message;$('supplyPhotoError').classList.remove('hidden');}
 finally{processing=false;}
};
$('supplyProductSearch').oninput=renderProducts;
$('supplyPriority').onchange=totals;
$('supplyRequestForm').onsubmit=async e=>{
 e.preventDefault();if(processing)return alert('Payment photo is still processing.',true);
 if(!quantities.size)return alert('Select at least one supply and enter its quantity.',true);
 if(!encodedPhoto)return alert('Upload and verify a payment photo before submitting.',true);
 const btn=$('supplyPlaceOrder');btn.disabled=true;
 try{
  const data=await api('/api/supply/orders',{method:'POST',body:JSON.stringify({
   branchId:Number($('supplyBranch').value),priority:$('supplyPriority').value,
   items:[...quantities].map(([productId,quantity])=>({productId,quantity})),
   paymentReference:$('supplyPaymentReference').value.trim(),paymentImage:encodedPhoto
  })});
  alert('Supply request '+data.order.id.slice(0,8).toUpperCase()+' submitted! Waiting for Main Office payment verification.');
  quantities.clear();encodedPhoto='';$('supplyPaymentPhoto').value='';$('supplyPaymentReference').value='';
  $('supplyPhotoPreview').classList.add('hidden');renderProducts();totals();await loadOrders();await openOrder(data.order.id);
 }catch(err){alert(err.message,true);}
 finally{btn.disabled=false;}
};
async function loadCatalog(){
 const d=await api('/api/supply/catalog');
 products=d.products||[];branches=(d.branches||[]).filter(b=>b.active);urgentFee=Number(d.urgentFee||0);
 const urgentOption=$('supplyPriority').querySelector('option[value="URGENT"]');
 urgentOption.disabled=!(urgentFee>0);
 urgentOption.textContent=urgentFee>0?'Urgent — additional '+money(urgentFee):'Urgent — awaiting Main Office fee setup';
 if(!urgentFee&&$('supplyPriority').value==='URGENT')$('supplyPriority').value='STANDARD';
 $('supplyBranch').innerHTML=branches.map(b=>'<option value="'+b.id+'">'+esc(b.name)+(b.address?' · '+esc(b.address):'')+'</option>').join('');
 if(!branches.length)alert('There are no active branches assigned to your franchise. Create or activate a branch before requesting supplies.',true);
 renderProducts();totals();
}
async function loadOrders(){
 const d=await api('/api/supply/orders');orders=d.orders||[];renderOrders();
}
function renderOrders(){
 const filter=$('supplyHistoryStatus').value;
 const filtered=orders.filter(o=>!filter||o.status===filter);
 const pages=Math.max(1,Math.ceil(filtered.length/10));page=Math.max(1,Math.min(page,pages));
 $('supplyOrdersBody').innerHTML=filtered.slice((page-1)*10,page*10).map(o=>
 '<tr><td><b>'+esc(o.id.slice(0,8).toUpperCase())+'</b></td><td>'+esc(o.branch_name||'—')+'</td><td>'+esc(title(o.priority))+'</td>'+
 '<td><b>'+money(o.total)+'</b></td><td><span class="supply-status '+esc(o.status.toLowerCase())+'">'+esc(title(o.status))+'</span></td>'+
 '<td>'+date(o.created_at)+'</td><td><button type="button" class="supply-view" data-supply-order="'+esc(o.id)+'">View / Chat</button></td></tr>'
 ).join('')||'<tr><td colspan="7" class="muted">No supply requests yet.</td></tr>';
 $('supplyOrdersPagination').innerHTML='<span>Page '+page+' of '+pages+' · '+filtered.length+' requests</span>'+
 '<button type="button" data-supply-page="-1" '+(page===1?'disabled':'')+'>Previous</button>'+
 '<button type="button" data-supply-page="1" '+(page===pages?'disabled':'')+'>Next</button>';
 $('supplyOrdersBody').querySelectorAll('[data-supply-order]').forEach(b=>b.onclick=()=>openOrder(b.dataset.supplyOrder));
 $('supplyOrdersPagination').querySelectorAll('button').forEach(b=>b.onclick=()=>{page+=Number(b.dataset.supplyPage);renderOrders();});
}
$('supplyHistoryStatus').onchange=()=>{page=1;renderOrders();};
const stages=['PENDING_REVIEW','APPROVED','PREPARING','DISPATCHED','DELIVERED','COMPLETED'];
async function openOrder(id){
 try{
  const d=await api('/api/supply/orders/'+id),o=d.order;currentId=o.id;
  $('supplyOrderDetail').classList.remove('hidden');
  $('supplyDetailHeading').textContent='Request '+o.id.slice(0,8).toUpperCase()+' · '+title(o.status);
  $('supplyDetailSummary').innerHTML=[
   ['Branch',o.branch_name],['Priority',title(o.priority)],['Total',money(o.total)],['Submitted',date(o.created_at)],
   ['Payment reference',o.payment_reference||'Attached photo'],['Main Office note',o.office_note||'Awaiting update']
  ].map(([k,v])=>'<span><small>'+esc(k)+'</small><b>'+esc(v)+'</b></span>').join('');
  $('supplyTimeline').innerHTML=o.history.map(x=>'<div><b>'+esc(title(x.status))+'</b><small>'+date(x.created_at)+' · '+esc(x.actor)+(x.note?' · '+esc(x.note):'')+'</small></div>').join('');
  $('supplyDetailItems').innerHTML=o.items.map(i=>'<tr><td>'+esc(i.product_name)+'</td><td>'+esc(i.uom)+'</td><td>'+i.quantity+'</td><td>'+money(i.amount)+'</td></tr>').join('');
  $('supplyMessages').innerHTML=o.messages.map(m=>'<div class="supply-message '+esc(m.sender_role)+'"><small>'+esc(m.sender_name)+' · '+date(m.created_at)+'</small>'+esc(m.body)+'</div>').join('')||'<p class="muted">No messages yet.</p>';
  $('supplyMessages').scrollTop=$('supplyMessages').scrollHeight;
  $('supplyOrderDetail').scrollIntoView({behavior:'smooth',block:'start'});
 }catch(err){alert(err.message,true);}
}
$('supplyDetailClose').onclick=()=>{$('supplyOrderDetail').classList.add('hidden');currentId=null;};
$('supplyMessageForm').onsubmit=async e=>{
 e.preventDefault();if(!currentId)return;
 const body=$('supplyMessageText').value.trim();if(!body)return;
 try{await api('/api/supply/orders/'+currentId+'/messages',{method:'POST',body:JSON.stringify({body})});$('supplyMessageText').value='';await openOrder(currentId);}catch(err){alert(err.message,true);}
};
async function loadNotices(){
 try{
  const d=await api('/api/supply/notifications');notices=d.notices||[];
  $('supplyUnreadCount').textContent=d.unread||0;
  $('supplyNavUnread')?.classList.toggle('hidden',!d.unread);
  $('supplyNotificationsList').innerHTML=notices.map(n=>
   '<div class="supply-notice-row '+(!n.read?'new':'')+'">'+esc(n.message)+'<small>'+date(n.createdAt)+'</small></div>'
  ).join('')||'<p class="muted">No updates yet.</p>';
 }catch(_){}
}
$('supplyNotificationsButton').onclick=()=>$('supplyNotificationsPanel').classList.toggle('hidden');
$('supplyMarkRead').onclick=async()=>{
 try{await api('/api/supply/notifications/read',{method:'POST',body:JSON.stringify({ids:notices.filter(n=>!n.read).map(n=>n.id)})});await loadNotices();}catch(err){alert(err.message,true);}
};
$('supplyRefresh').onclick=async()=>{try{await Promise.all([loadOrders(),loadNotices()]);alert('Supply Chain is up to date.');}catch(err){alert(err.message,true);}};
async function open(){
 if(!loaded){
  try{await Promise.all([loadCatalog(),loadOrders(),loadNotices()]);loaded=true;}catch(err){alert(err.message,true);}
 }else await Promise.all([loadOrders(),loadNotices()]);
 if(!timer)timer=setInterval(()=>{if($('view-supply')?.classList.contains('active')){loadOrders().catch(()=>{});loadNotices();}},30000);
}
// Update the sidebar notification indicator even when the owner is working in POS.
setInterval(()=>{
 if(!$('app')?.classList.contains('hidden')&&!$('view-supply')?.classList.contains('active'))
   loadNotices();
},45000);
window.donmacSupply={open,refreshNotices:loadNotices};
})();