(() => {
'use strict';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const peso=n=>'₱'+Number(n||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
const stamp=d=>d?new Intl.DateTimeFormat('en-PH',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Manila'}).format(new Date(d)):'—';
const title=s=>String(s||'').replaceAll('_',' ').toLowerCase().replace(/^./,x=>x.toUpperCase());
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

const PAGE_SIZE=10;
let all=[],current=null,page=1,activePage='requests',timer=null,catalogPage=1,catalogProducts=[],chatPhoto=null;
function notice(msg,error=false){const n=$('officeNotice');n.classList.remove('hidden');n.textContent=msg;n.style.background=error?'#ffebec':'#e7f4e9';n.style.color=error?'#a3262b':'#145537';}
async function api(path,options={}){
 const result=await fetch(path,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});
 const data=await result.json().catch(()=>({}));
 if(!result.ok){if(result.status===401){$('officeApp').classList.add('hidden');$('officeLogin').classList.remove('hidden');}throw Error(data.error||'Request failed ('+result.status+')');}
 return data;
}
function loggedIn(ok,requiresPasswordChange=false){
 $('officeLogin').classList.toggle('hidden',ok);
 $('officeApp').classList.toggle('hidden',!ok);
 if(ok&&!requiresPasswordChange){refresh();if(!timer)timer=setInterval(refresh,30000);}else if(requiresPasswordChange&&timer){clearInterval(timer);timer=null;}
}
$('officeLoginForm').addEventListener('submit',async e=>{
 e.preventDefault();$('officeLoginError').textContent='';
 try{
  const data=await api('/api/supply/office/login',{method:'POST',body:JSON.stringify({username:$('officeUsername').value,password:$('officePassword').value})});
  $('officeSignedInAs').textContent=$('officeUsername').value;$('officePassword').value='';
  loggedIn(!!data.ok,!!data.mustChangePassword);
  if(data.mustChangePassword){selectPage('security');notice('Change the temporary password before managing supply requests.');}
 }catch(err){$('officeLoginError').textContent=err.message;}
});
$('officeLogout').onclick=async()=>{try{await api('/api/supply/office/logout',{method:'POST'});}catch(_){}loggedIn(false);};
function selectPage(name){
 activePage=name;
 document.querySelectorAll('[data-office-page]').forEach(b=>b.classList.toggle('active',b.dataset.officePage===name));
 for(const section of ['requests','catalog','settings','security'])$('page-'+section).classList.toggle('hidden',section!==name);
 $('officePageHeading').textContent=({requests:'Purchase requests',catalog:'Supply catalog',settings:'Office settings',security:'Change password'})[name];
 if(name==='catalog')loadCatalog();
 if(name==='settings')loadSettings();
}
document.querySelectorAll('[data-office-page]').forEach(b=>b.onclick=()=>selectPage(b.dataset.officePage));
$('officeRefresh').onclick=refresh;
$('officeClock').textContent=new Intl.DateTimeFormat('en-PH',{dateStyle:'medium',timeZone:'Asia/Manila'}).format(new Date());
async function refresh(){
 if($('officeApp').classList.contains('hidden'))return;
 try{
  const d=await api('/api/supply/office/orders');all=d.orders||[];
  $('statTotal').textContent=all.length;
  $('statPending').textContent=all.filter(x=>x.status==='PENDING_REVIEW').length;
  $('statHold').textContent=all.filter(x=>x.status==='ON_HOLD').length;
  $('statActive').textContent=all.filter(x=>['APPROVED','PREPARING','DISPATCHED','DELIVERED'].includes(x.status)).length;
  $('pendingBadge').textContent=all.filter(x=>x.status==='PENDING_REVIEW').length;
  render();
  if(current&&$('officeDetailOverlay').getAttribute('aria-hidden')==='false')await openOrder(current.id,true);
 }catch(err){notice(err.message,true);}
}
function render(){
 const q=$('officeSearch').value.toLowerCase().trim(),status=$('officeStatusFilter').value;
 const matched=all.filter(x=>(!status||x.status===status)&&(!q||
  [x.id,x.branch_name,x.requester,x.status,x.priority].some(y=>String(y||'').toLowerCase().includes(q))));
 const pages=Math.max(1,Math.ceil(matched.length/PAGE_SIZE));page=Math.max(1,Math.min(page,pages));
 const subset=matched.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE);
 $('officeOrdersBody').innerHTML=subset.map(o=>`<tr><td><b>${esc(o.id.slice(0,8).toUpperCase())}</b></td>
 <td><strong>${esc(o.branch_name||'—')}</strong><div class="muted">${esc(o.requester||'Franchise')}</div></td>
 <td>${o.priority==='URGENT'?'⚡ Urgent':'Standard'}</td><td><b>${peso(o.total)}</b></td>
 <td><span class="badge ${esc(o.status.toLowerCase())}">${esc(title(o.status))}</span></td>
 <td>${stamp(o.created_at)}</td><td><button class="table-action" data-office-open="${esc(o.id)}">Review</button></td></tr>`).join('')
 ||'<tr><td colspan="7">No matching requests.</td></tr>';
 $('officeOrderPages').innerHTML='<span>Page '+page+' of '+pages+' · '+matched.length+' requests</span>'+
 '<button type="button" data-office-page-nav="-1" '+(page===1?'disabled':'')+'>Previous</button>'+
 '<button type="button" data-office-page-nav="1" '+(page===pages?'disabled':'')+'>Next</button>';
 $('officeOrdersBody').querySelectorAll('[data-office-open]').forEach(b=>b.onclick=()=>openOrder(b.dataset.officeOpen));
 $('officeOrderPages').querySelectorAll('button').forEach(b=>b.onclick=()=>{page+=Number(b.dataset.officePageNav);render();});
}
$('officeSearch').oninput=()=>{page=1;render();};
$('officeStatusFilter').onchange=()=>{page=1;render();};
async function loadCatalog(){
 try{const d=await api('/api/supply/office/catalog');catalogProducts=d.products||[];renderCatalog();}catch(err){notice(err.message,true);}
}
function renderCatalog(){
 const pages=Math.max(1,Math.ceil(catalogProducts.length/10));
 catalogPage=Math.min(pages,Math.max(1,catalogPage));
 $('officeCatalogBody').innerHTML=catalogProducts.slice((catalogPage-1)*10,catalogPage*10).map(p=>
 '<tr data-catalog-product="'+p.id+'"><td><b>'+esc(p.name)+'</b></td>'+
 '<td><input aria-label="Unit of measure for '+esc(p.name)+'" class="office-uom" maxlength="80" value="'+esc(p.uom)+'"></td>'+
 '<td><input class="office-price" aria-label="Franchise price for '+esc(p.name)+'" type="number" min="0.01" max="1000000" step="0.01" value="'+Number(p.price).toFixed(2)+'"></td>'+
 '<td><input class="office-stock" aria-label="Available stock for '+esc(p.name)+'" type="number" min="0" max="10000000" step="1" value="'+p.stockQty+'"></td>'+
 '<td><input class="office-promo-price" aria-label="Promo price for '+esc(p.name)+'" type="number" min="0.01" step="0.01" placeholder="No promo" value="'+(p.promoPrice==null?'':Number(p.promoPrice).toFixed(2))+'"></td>'+
 '<td><input class="office-promo-enabled" type="checkbox" aria-label="Enable promo for '+esc(p.name)+'" '+(p.promoActive?'checked':'')+'></td>'+
 '<td><button type="button" class="btn solid office-product-save" data-office-save="'+p.id+'">Save</button></td></tr>'
 ).join('');
 $('officeCatalogPages').innerHTML='<span>Page '+catalogPage+' of '+pages+' · '+catalogProducts.length+' supplies</span>'+
 '<button type="button" data-catalog-offset="-1" '+(catalogPage===1?'disabled':'')+'>Previous</button>'+
 '<button type="button" data-catalog-offset="1" '+(catalogPage===pages?'disabled':'')+'>Next</button>';
 $('officeCatalogPages').querySelectorAll('button').forEach(b=>b.onclick=()=>{catalogPage+=Number(b.dataset.catalogOffset);renderCatalog();});
 $('officeCatalogBody').querySelectorAll('[data-office-save]').forEach(button=>button.onclick=async()=>{
  const row=button.closest('tr');const id=Number(button.dataset.officeSave);
  const details={uom:row.querySelector('.office-uom').value,price:row.querySelector('.office-price').value,
   stockQty:row.querySelector('.office-stock').value,promoPrice:row.querySelector('.office-promo-price').value,
   promoActive:row.querySelector('.office-promo-enabled').checked};
  button.disabled=true;
  try{
   await api('/api/supply/office/products/'+id,{method:'PUT',body:JSON.stringify(details)});
   notice('Supply pricing, promo and Main Office inventory saved.');await loadCatalog();
  }catch(err){notice(err.message,true);}finally{button.disabled=false;}
 });
}

$('officePasswordForm').onsubmit=async e=>{
 e.preventDefault();
 const currentPassword=$('officeOldPassword').value,newPassword=$('officeNewPassword').value;
 if(newPassword!==$('officeConfirmPassword').value){notice('New passwords do not match.',true);return;}
 try{
  await api('/api/supply/office/change-password',{method:'POST',body:JSON.stringify({currentPassword,newPassword})});
  $('officePasswordForm').reset();
  selectPage('requests');notice('Main Office password changed successfully. Previous sessions have been revoked.');loggedIn(true);
 }catch(err){notice(err.message,true);}
};
async function loadSettings(){try{const d=await api('/api/supply/office/settings');$('officeUrgentFee').value=Number(d.urgentFee).toFixed(2);}catch(err){notice(err.message,true);}}
$('urgentFeeForm').onsubmit=async e=>{
 e.preventDefault();
 try{const d=await api('/api/supply/office/settings',{method:'PUT',body:JSON.stringify({urgentFee:$('officeUrgentFee').value})});notice('Urgent fee is now '+peso(d.urgentFee)+'. Existing orders are unchanged.');}catch(err){notice(err.message,true);}
};
async function openOrder(id,quiet=false){
 try{
  const d=await api('/api/supply/office/orders/'+encodeURIComponent(id));current=d.order;const o=current;
  $('detailTitle').textContent='Request '+o.id.slice(0,8).toUpperCase();
  $('officeDetailSummary').innerHTML='<div class="info-grid">'+[
   ['Branch',o.branch_name],['Franchise Owner',o.franchise_owner||'—'],['Requested by',o.requester],['Priority',o.priority],
   ['Status',title(o.status)],['Item subtotal',peso(o.subtotal)],
   ['Urgent fee',peso(o.urgent_fee)],['Total',peso(o.total)],['Submitted',stamp(o.created_at)]].map(([k,v])=>'<span><small>'+esc(k)+'</small><b>'+esc(v)+'</b></span>').join('')+'</div>';
  $('officeDetailItems').innerHTML=o.items.map(i=>'<tr><td>'+esc(i.product_name)+'</td><td>'+esc(i.uom)+'</td><td>'+i.quantity+'</td><td>'+peso(i.amount)+'</td></tr>').join('');
  $('officePaymentReference').textContent='Payment reference: '+(o.payment_reference||'Not provided. Verify the attached proof.');
  const src=String(o.paymentImage||'');
  $('officePaymentImage').innerHTML=/^data:image\/(png|jpeg|webp);base64,[\w+/]+=*$/.test(src)?
   '<a href="'+src+'" target="_blank" rel="noopener noreferrer" title="Open full payment proof"><img class="payment-shot" src="'+src+'" alt="Submitted payment proof" decoding="async"></a>':
   '<p class="error">The payment image could not be decoded.</p>';
  const img=$('officePaymentImage').querySelector('img');
  if(img)img.addEventListener('error',()=>{$('officePaymentImage').textContent='Payment photo could not be decoded.';});
  $('officeNextStatus').value=o.status;$('officeStatusNote').value=o.office_note||'';
  $('officeTimeline').innerHTML=o.history.map(h=>'<p><b>'+esc(title(h.status))+'</b> · '+stamp(h.created_at)+'<br/>'+esc(h.note||'')+'</p>').join('');
  $('officeMessages').innerHTML=o.messages.map(m=>'<div class="bubble '+(m.sender_role==='office'?'office':'')+'"><small>'+esc(m.sender_name)+' · '+stamp(m.created_at)+'</small>'+esc(m.body)+photoHtml(m.image)+'</div>').join('')||'<p class="muted">No messages yet. Start a conversation with the franchise.</p>';
  $('officeMessages').scrollTop=$('officeMessages').scrollHeight;
  $('officeDetailOverlay').classList.remove('hidden');$('officeDetailOverlay').setAttribute('aria-hidden','false');
  if(!quiet)$('officeDetailClose').focus();
 }catch(err){notice(err.message,true);}
}
function closeOrder(){$('officeDetailOverlay').classList.add('hidden');$('officeDetailOverlay').setAttribute('aria-hidden','true');current=null;}
$('officeDetailClose').onclick=closeOrder;
$('officeDetailOverlay').addEventListener('click',e=>{if(e.target===$('officeDetailOverlay'))closeOrder();});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeOrder();});
$('officeStatusForm').onsubmit=async e=>{
 e.preventDefault();if(!current)return;
 try{
  const d=await api('/api/supply/office/orders/'+current.id+'/status',{method:'POST',body:JSON.stringify({status:$('officeNextStatus').value,note:$('officeStatusNote').value})});
  notice('Request status updated to '+title(d.status)+'. Franchise notified.');await refresh();await openOrder(current.id,true);
 }catch(err){notice(err.message,true);}
};
$('officeChatPhoto').onchange=async e=>{
 try{
  chatPhoto=await compactPhoto(e.target.files?.[0]);
  $('officeChatPreview').classList.toggle('hidden',!chatPhoto);
  $('officeChatPreview').innerHTML=chatPhoto?'<img src="'+chatPhoto+'" alt="Attached photo preview"><button type="button" id="officeChatRemove">Remove</button>':'';
  if(chatPhoto)$('officeChatRemove').onclick=()=>{chatPhoto=null;$('officeChatPhoto').value='';$('officeChatPreview').classList.add('hidden');};
 }catch(err){chatPhoto=null;$('officeChatPhoto').value='';notice(err.message,true);}
};
$('officeMessageForm').onsubmit=async e=>{
 e.preventDefault();if(!current)return;
 const message=$('officeMessageText').value.trim();if(!message&&!chatPhoto)return;
 const image=chatPhoto;
 try{
  await api('/api/supply/office/orders/'+current.id+'/messages',{method:'POST',body:JSON.stringify({body:message,image})});
  $('officeMessageText').value='';$('officeChatPhoto').value='';chatPhoto=null;
  $('officeChatPreview').classList.add('hidden');await openOrder(current.id,true);
 }catch(err){notice(err.message,true);}
};
api('/api/supply/office/me').then(u=>{$('officeSignedInAs').textContent=u.username||'Main Office';loggedIn(true,!!u.mustChangePassword);if(u.mustChangePassword){selectPage('security');notice('Change the temporary password to continue.');}}).catch(()=>loggedIn(false));
})();