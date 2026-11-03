(() => {
'use strict';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const peso=n=>'₱'+Number(n||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
const stamp=d=>d?new Intl.DateTimeFormat('en-PH',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Manila'}).format(new Date(d)):'—';
const title=s=>String(s||'').replaceAll('_',' ').toLowerCase().replace(/^./,x=>x.toUpperCase());
const PAGE_SIZE=10;
let all=[],current=null,page=1,activePage='requests',timer=null;
function notice(msg,error=false){const n=$('officeNotice');n.classList.remove('hidden');n.textContent=msg;n.style.background=error?'#ffebec':'#e7f4e9';n.style.color=error?'#a3262b':'#145537';}
async function api(path,options={}){
 const result=await fetch(path,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});
 const data=await result.json().catch(()=>({}));
 if(!result.ok){if(result.status===401){$('officeApp').classList.add('hidden');$('officeLogin').classList.remove('hidden');}throw Error(data.error||'Request failed ('+result.status+')');}
 return data;
}
function loggedIn(ok){
 $('officeLogin').classList.toggle('hidden',ok);
 $('officeApp').classList.toggle('hidden',!ok);
 if(ok){refresh();if(!timer)timer=setInterval(refresh,30000);}
}
$('officeLoginForm').addEventListener('submit',async e=>{
 e.preventDefault();$('officeLoginError').textContent='';
 try{
  const data=await api('/api/supply/office/login',{method:'POST',body:JSON.stringify({username:$('officeUsername').value,password:$('officePassword').value})});
  $('officeSignedInAs').textContent=$('officeUsername').value;$('officePassword').value='';
  loggedIn(!!data.ok);
 }catch(err){$('officeLoginError').textContent=err.message;}
});
$('officeLogout').onclick=async()=>{try{await api('/api/supply/office/logout',{method:'POST'});}catch(_){}loggedIn(false);};
function selectPage(name){
 activePage=name;
 document.querySelectorAll('[data-office-page]').forEach(b=>b.classList.toggle('active',b.dataset.officePage===name));
 for(const section of ['requests','catalog','settings'])$('page-'+section).classList.toggle('hidden',section!==name);
 $('officePageHeading').textContent=({requests:'Purchase requests',catalog:'Supply catalog',settings:'Urgent fee settings'})[name];
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
 try{const d=await api('/api/supply/office/catalog');$('officeCatalogBody').innerHTML=d.products.map(p=>`<tr><td>${esc(p.name)}</td><td>${esc(p.uom)}</td><td><b>${peso(p.price)}</b></td></tr>`).join('');}catch(err){notice(err.message,true);}
}
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
   ['Branch',o.branch_name],['Requested by',o.requester],['Priority',o.priority],
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
  $('officeMessages').innerHTML=o.messages.map(m=>'<div class="bubble '+(m.sender_role==='office'?'office':'')+'"><small>'+esc(m.sender_name)+' · '+stamp(m.created_at)+'</small>'+esc(m.body)+'</div>').join('')||'<p class="muted">No messages yet. Start a conversation with the franchise.</p>';
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
$('officeMessageForm').onsubmit=async e=>{
 e.preventDefault();if(!current)return;
 const message=$('officeMessageText').value.trim();if(!message)return;
 try{await api('/api/supply/office/orders/'+current.id+'/messages',{method:'POST',body:JSON.stringify({body:message})});$('officeMessageText').value='';await openOrder(current.id,true);}catch(err){notice(err.message,true);}
};
api('/api/supply/office/me').then(u=>{$('officeSignedInAs').textContent=u.username||'Main Office';loggedIn(true);}).catch(()=>loggedIn(false));
})();