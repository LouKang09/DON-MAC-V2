(() => {
'use strict';
const $=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>'₱'+Number(n||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
const title=s=>s==='APPEAL_REVIEW'?'Appeal review':String(s||'').replaceAll('_',' ').toLowerCase().replace(/^./,x=>x.toUpperCase());
const date=s=>new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}).format(new Date(s));
let products=[],branches=[],urgentFee=0,royaltyQuote={dueTotal:0,dueMonths:[],reservedTotal:0},orders=[],notices=[],currentId=null,encodedPhoto='',page=1,productPage=1,chatPhoto=null,loaded=false,timer=null,processing=false;
const quantities=new Map();
async function compactPhoto(file){
 if(!file)return null;
 if(file.size>8*1024*1024||file.size<50||!['image/png','image/jpeg','image/webp'].includes(file.type))
   throw Error('Select a valid JPG, PNG or WebP photo up to 8 MB.');
 const blob=URL.createObjectURL(file);
 try{
  const image=new Image();image.src=blob;
  try{await image.decode();}catch(_){throw Error('Photo cannot be decoded. Choose another image.');}
  if(!image.naturalWidth||!image.naturalHeight)throw Error('Photo cannot be decoded.');
  for(const max of [960,720,540,400]){
   const scale=Math.min(1,max/Math.max(image.naturalWidth,image.naturalHeight));
   const canvas=document.createElement('canvas');
   canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));
   canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
   const ctx=canvas.getContext('2d');if(!ctx)throw Error('Photo compression is unavailable.');
   ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
   ctx.drawImage(image,0,0,canvas.width,canvas.height);
   for(const quality of [.72,.53,.37]){
    const url=canvas.toDataURL('image/jpeg',quality);
    if(url.length<235000)return url;
   }
  }
  throw Error('Photo could not be compressed below 180 KB.');
 }finally{URL.revokeObjectURL(blob);}
}
function photoHtml(data){
 return /^data:image\/jpeg;base64,[a-zA-Z0-9+/]+={0,2}$/.test(data||'')?
 '<img class="office-chat-image" src="'+data+'" alt="Attached chat photo" loading="lazy" decoding="async">':'';
}

let noticeTimeout=null;
const alert=(msg,bad=false)=>{
 const x=$('supplyAlert');clearTimeout(noticeTimeout);
 x.classList.remove('hidden');x.textContent=msg;
 x.style.color=bad?'#9d3138':'#165939';
 x.style.background=bad?'#ffe8e8':'#e6f5e9';
 if(msg==='Supply Chain is up to date.')noticeTimeout=setTimeout(()=>x.classList.add('hidden'),3200);
};
async function api(path,options={}){
 const r=await fetch(path,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});
 const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||'Request failed ('+r.status+').');
 return data;
}
function subtotal(){return products.reduce((a,p)=>a+(quantities.get(p.id)||0)*(p.promoActive&&p.promoPrice!=null&&p.promoPrice<p.price?p.promoPrice:p.price),0);}
function totals(){
 const sub=subtotal(),extra=$('supplyPriority').value==='URGENT'?urgentFee:0;
 const royalty=Number(royaltyQuote.dueTotal||0);
 $('supplySubtotal').textContent=money(sub);
 $('supplyUrgentFee').textContent=money(extra);
 $('supplyRoyaltyDue').textContent=money(royalty);
 $('supplyTotal').textContent=money(sub+extra+royalty);
 const months=(royaltyQuote.dueMonths||[]).map(m=>m.period).join(', ');
 const pending=Number(royaltyQuote.reservedTotal||0);
 $('supplyRoyaltyNotice').textContent=royalty>0?
  'Outstanding royalty for '+months+' is included in this order. It will be marked Paid only after Main Office approves your payment.':
  pending>0?'A royalty balance of '+money(pending)+' is already included in a pending supply request and will not be charged again.':
  'No outstanding royalty is due for this new purchase.';
}
function renderProducts(){
 const term=$('supplyProductSearch').value.toLowerCase().trim();
 const matched=products.filter(x=>x.active&&x.name.toLowerCase().includes(term));
 const pages=Math.max(1,Math.ceil(matched.length/10));
 productPage=Math.min(pages,Math.max(1,productPage));
 $('supplyProductsList').innerHTML=matched.slice((productPage-1)*10,productPage*10).map(p=>{
  const value=quantities.get(p.id)||0;
  return '<div class="supply-product-row '+(value?'selected':'')+'"><div><strong>'+esc(p.name)+'</strong><small>'+esc(p.uom)+'</small></div>'+
  '<span class="supply-price">'+(p.promoActive&&p.promoPrice!=null&&p.promoPrice<p.price?
 '<del class="supply-old-price">'+money(p.price)+'</del><strong class="supply-new-price">'+money(p.promoPrice)+'</strong>':money(p.price))+'</span><input type="number" inputmode="numeric" min="0" max="10000" step="1" aria-label="Quantity for '+esc(p.name)+'" data-supply-qty="'+p.id+'" value="'+(value||'')+'" placeholder="0" /></div>';
 }).join('')||'<p class="muted" style="padding:18px">No supplies match this search.</p>';
 $('supplyProductPages').innerHTML='<span>Page '+productPage+' of '+pages+' · '+matched.length+' supplies</span>'+
 '<button type="button" data-product-page="-1" '+(productPage===1?'disabled':'')+'>Previous</button>'+
 '<button type="button" data-product-page="1" '+(productPage===pages?'disabled':'')+'>Next</button>';
 $('supplyProductPages').querySelectorAll('button').forEach(b=>b.onclick=()=>{productPage+=Number(b.dataset.productPage);renderProducts();});
 $('supplyProductsList').querySelectorAll('[data-supply-qty]').forEach(el=>el.onchange=()=>{
  const id=Number(el.dataset.supplyQty),quantity=Number(el.value||0);
  if(!Number.isInteger(quantity)||quantity<0||quantity>10000){alert('Quantity must be a whole number between 0 and 10,000.',true);el.value=String(quantities.get(id)||0);return;}
  if(quantity)quantities.set(id,quantity);else quantities.delete(id);
  el.closest('.supply-product-row').classList.toggle('selected',!!quantity);totals();
 });
}
async function decodePhoto(file){
 if(!file)throw Error('Attach a payment confirmation image.');
 if(file.size>8*1024*1024)throw Error('Payment photo exceeds 8 MB. Choose a smaller photo.');
 if(file.size<50||!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('Use a valid JPG, PNG, or WebP photo.');
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
  for(const max of [1600,1400,1200,1000]){
   const ratio=Math.min(1,max/Math.max(image.naturalWidth,image.naturalHeight)),canvas=document.createElement('canvas');
   canvas.width=Math.max(1,Math.round(image.naturalWidth*ratio));canvas.height=Math.max(1,Math.round(image.naturalHeight*ratio));
   const ctx=canvas.getContext('2d');if(!ctx)throw Error('This browser cannot decode the selected photo.');
   ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
   for(const quality of [.88,.77,.66,.52]){
    const output=canvas.toDataURL('image/jpeg',quality);
    if(output.length<=760000)return output;
   }
  }
  throw Error('Payment photo could not be compressed below 600 KB. Select a smaller image.');
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
$('supplyProductSearch').oninput=()=>{productPage=1;renderProducts();};
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
   paymentReference:$('supplyPaymentReference').value.trim(),paymentImage:encodedPhoto,
   expectedRoyaltyTotal:Number(royaltyQuote.dueTotal||0),
   expectedTotal:Math.round((subtotal()+($('supplyPriority').value==='URGENT'?urgentFee:0)+Number(royaltyQuote.dueTotal||0))*100)/100
  })});
  alert('Supply request '+data.order.id.slice(0,8).toUpperCase()+' submitted!'+
    (Number(data.order.royaltyTotal||0)>0?' Included royalty: '+money(data.order.royaltyTotal)+'.':'')+
    ' Waiting for Main Office payment verification.');
  quantities.clear();encodedPhoto='';$('supplyPaymentPhoto').value='';$('supplyPaymentReference').value='';
  $('supplyPhotoPreview').classList.add('hidden');await loadCatalog();await loadOrders();await openOrder(data.order.id);
 }catch(err){alert(err.message,true);if(/royalt|prices.*changed/i.test(err.message))await loadCatalog().catch(()=>{});}
 finally{btn.disabled=false;}
};
async function loadCatalog(){
 const d=await api('/api/supply/catalog');
 products=d.products||[];branches=(d.branches||[]).filter(b=>b.active);urgentFee=Number(d.urgentFee||0);royaltyQuote=d.royalty||{dueTotal:0,dueMonths:[],reservedTotal:0};
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
   ['Royalty included',money(o.royalty_total||0)],['Payment reference',o.payment_reference||'Attached photo'],['Main Office note',o.office_note||'Awaiting update']
  ].map(([k,v])=>'<span><small>'+esc(k)+'</small><b>'+esc(v)+'</b></span>').join('');
  configureAppeal(o);
  $('supplyTimeline').innerHTML=o.history.map(x=>'<div><b>'+esc(title(x.status))+'</b><small>'+date(x.created_at)+' · '+esc(x.actor)+(x.note?' · '+esc(x.note):'')+'</small></div>').join('');
  $('supplyDetailItems').innerHTML=o.items.map(i=>'<tr><td>'+esc(i.product_name)+'</td><td>'+esc(i.uom)+'</td><td>'+i.quantity+'</td><td>'+money(i.amount)+'</td></tr>').join('');
  $('supplyMessages').innerHTML=o.messages.map(m=>'<div class="supply-message '+esc(m.sender_role)+'"><small>'+esc(m.sender_name)+' · '+date(m.created_at)+'</small>'+esc(m.body)+photoHtml(m.image)+'</div>').join('')||'<p class="muted">No messages yet.</p>';
  $('supplyMessages').scrollTop=$('supplyMessages').scrollHeight;
  $('supplyOrderDetail').scrollIntoView({behavior:'smooth',block:'start'});
 }catch(err){alert(err.message,true);}
}

function configureAppeal(order){
 const count=Math.max(0,Number(order.appeal_count||0)),denied=order.status==='DENIED';
 const remaining=Math.max(0,2-count),available=denied&&remaining>0;
 $('supplyAppealPanel').classList.toggle('hidden',!available);
 $('supplyAppealMessage').classList.toggle('hidden',available||(!denied&&order.status!=='APPEAL_REVIEW'));
 if(available){
  $('supplyAppealInfo').textContent='You may submit up to two appeals. '+remaining+' appeal'+(remaining===1?'':'s')+' remaining. Main Office will review your explanation.';
  $('supplyAppealReason').value='';
 }else if(order.status==='APPEAL_REVIEW'){
  $('supplyAppealMessage').textContent='Appeal '+count+' of 2 submitted. Awaiting Main Office review.';
 }else if(denied){
  $('supplyAppealMessage').textContent='Both appeals were denied. No further appeal can be submitted for this request.';
 }
}
$('supplyAppealForm').onsubmit=async event=>{
 event.preventDefault();if(!currentId)return;
 const reason=$('supplyAppealReason').value.trim();
 if(reason.length<10){alert('Please enter an appeal reason with at least 10 characters.',true);return;}
 const button=$('supplyAppealSubmit');button.disabled=true;
 try{
  const id=currentId;
  const response=await api('/api/supply/orders/'+encodeURIComponent(id)+'/appeal',
   {method:'POST',body:JSON.stringify({reason})});
  alert('Appeal '+response.appealCount+' of 2 submitted for review.');
  await Promise.all([loadOrders(),openOrder(id)]);
 }catch(err){alert(err.message,true);}
 finally{button.disabled=false;}
};
$('supplyDetailClose').onclick=()=>{$('supplyOrderDetail').classList.add('hidden');currentId=null;};
$('supplyChatPhoto').onchange=async e=>{
 try{
  chatPhoto=await compactPhoto(e.target.files?.[0]);
  $('supplyChatPreview').classList.toggle('hidden',!chatPhoto);
  $('supplyChatPreview').innerHTML=chatPhoto?'<img src="'+chatPhoto+'" alt="Chat attachment preview"><button type="button" id="supplyChatRemove">Remove photo</button>':'';
  if(chatPhoto)$('supplyChatRemove').onclick=()=>{chatPhoto=null;$('supplyChatPhoto').value='';$('supplyChatPreview').classList.add('hidden');};
 }catch(err){chatPhoto=null;$('supplyChatPhoto').value='';alert(err.message,true);}
};
$('supplyMessageForm').onsubmit=async e=>{
 e.preventDefault();if(!currentId)return;
 const body=$('supplyMessageText').value.trim();if(!body&&!chatPhoto)return;
 try{
  await api('/api/supply/orders/'+currentId+'/messages',{method:'POST',body:JSON.stringify({body,image:chatPhoto})});
  $('supplyMessageText').value='';$('supplyChatPhoto').value='';chatPhoto=null;$('supplyChatPreview').classList.add('hidden');
  await openOrder(currentId);
 }catch(err){alert(err.message,true);}
};
const noticePageSize=5;
let noticePage=1;
function renderNotices(){
 const maxPage=Math.max(1,Math.ceil(notices.length/noticePageSize));
 noticePage=Math.max(1,Math.min(noticePage,maxPage));
 const list=$('supplyNotificationsList');
 list.innerHTML=notices.slice((noticePage-1)*noticePageSize,noticePage*noticePageSize).map(n=>
   '<button type="button" class="supply-notice-row '+(!n.read?'new':'')+'" data-supply-notice="'+esc(n.id)+'" aria-label="Open supply request notification">'+
   '<span>'+esc(n.message)+'</span><small>'+date(n.createdAt)+'</small></button>'
 ).join('')||'<p class="muted">No updates yet.</p>';
 list.querySelectorAll('[data-supply-notice]').forEach(button=>button.onclick=async()=>{
  if(button.disabled)return;button.disabled=true;
  const notice=notices.find(n=>String(n.id)===button.dataset.supplyNotice);
  if(!notice){button.disabled=false;return;}
  try{
   if(!notice.read)await api('/api/supply/notifications/read',{method:'POST',body:JSON.stringify({ids:[notice.id]})});
   notice.read=true;
   await loadNotices();
   $('supplyNotificationsPanel').classList.add('hidden');
   $('supplyNotificationsButton').setAttribute('aria-expanded','false');
   if(notice.orderId)await openOrder(notice.orderId);
  }catch(err){alert(err.message,true);button.disabled=false;}
 });
 const nav=$('supplyNotificationsPagination');
 nav.innerHTML=notices.length>noticePageSize
  ?'<span>Page '+noticePage+' of '+maxPage+' · '+notices.length+' updates</span>'+
   '<button type="button" data-notice-page="-1" '+(noticePage===1?'disabled':'')+'>Previous</button>'+
   '<button type="button" data-notice-page="1" '+(noticePage===maxPage?'disabled':'')+'>Next</button>'
  :'';
 nav.querySelectorAll('[data-notice-page]').forEach(button=>button.onclick=()=>{
  noticePage+=Number(button.dataset.noticePage);renderNotices();
 });
}
async function loadNotices(){
 try{
  const d=await api('/api/supply/notifications');notices=d.notices||[];
  const unread=Number(d.unread||0);
  $('supplyUnreadCount').textContent=unread;
  $('supplyNavUnread')?.classList.toggle('hidden',!unread);
  renderNotices();
  return true;
 }catch(err){console.warn('Unable to load supply notifications:',err.message);return false;}
}
$('supplyNotificationsButton').onclick=async()=>{
 const button=$('supplyNotificationsButton'),panel=$('supplyNotificationsPanel');
 const opening=panel.classList.contains('hidden');
 panel.classList.toggle('hidden',!opening);
 button.setAttribute('aria-expanded',String(opening));
 if(!opening)return;
 noticePage=1;
 button.disabled=true;
 try{
  const d=await api('/api/supply/notifications');notices=d.notices||[];
  renderNotices();
  const unreadIds=notices.filter(n=>!n.read).map(n=>n.id);
  if(unreadIds.length)await api('/api/supply/notifications/read',{
   method:'POST',body:JSON.stringify({ids:unreadIds})
  });
  notices.forEach(n=>{n.read=true;});
  $('supplyUnreadCount').textContent='0';
  $('supplyNavUnread')?.classList.add('hidden');
  renderNotices();
  await loadNotices();
 }catch(err){
  alert('Could not mark supply notifications as read: '+err.message,true);
  await loadNotices();
 }finally{button.disabled=false;}
};
$('supplyRefresh').onclick=async()=>{try{await Promise.all([loadCatalog(),loadOrders(),loadNotices()]);alert('Supply Chain is up to date.');}catch(err){alert(err.message,true);}};
async function open(){
 if(!loaded){
  try{await Promise.all([loadCatalog(),loadOrders(),loadNotices()]);loaded=true;}catch(err){alert(err.message,true);}
 }else await Promise.all([loadCatalog(),loadOrders(),loadNotices()]);
 if(!timer)timer=setInterval(()=>{if($('view-supply')?.classList.contains('active')){loadCatalog().catch(()=>{});loadOrders().catch(()=>{});loadNotices();}},30000);
}
// Update the sidebar notification indicator even when the owner is working in POS.
setInterval(()=>{
 if(!$('app')?.classList.contains('hidden')&&!$('view-supply')?.classList.contains('active'))
   loadNotices();
},45000);
window.donmacSupply={open,refreshNotices:loadNotices};
})();