(() => {
'use strict';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const peso=n=>'₱'+Number(n||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
const stamp=d=>d?new Intl.DateTimeFormat('en-PH',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Manila'}).format(new Date(d)):'—';
const title=s=>s==='PENDING_REVIEW'?'Pending for review':s==='APPEAL_REVIEW'?'Appeal review':s==='DELIVERED'?'Delivered · Complete':String(s||'').replaceAll('_',' ').toLowerCase().replace(/^./,x=>x.toUpperCase());
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
let all=[],current=null,page=1,activePage='requests',timer=null,catalogPage=1,catalogProducts=[],chatPhoto=null,franchiseOwners=[],franchiseProfile=null,franchisePage=1,franchiseOrderPage=1,franchiseRoyaltyPage=1,franchiseTab='orders';
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
 if(ok&&!requiresPasswordChange){refresh();if(!timer)timer=setInterval(refresh,30000);}else if(timer){clearInterval(timer);timer=null;}
 if(!ok){$('officeApp').classList.remove('mobile-nav-open');syncOfficeNavigation();}
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
$('officePasswordToggle').addEventListener('click',()=>{
 const input=$('officePassword'),show=input.type==='password';input.type=show?'text':'password';
 $('officePasswordToggle').setAttribute('aria-pressed',String(show));
 $('officePasswordToggle').setAttribute('aria-label',show?'Hide password':'Show password');
});
function syncOfficeNavigation(){
 const app=$('officeApp'),mobile=window.matchMedia('(max-width:720px)').matches;
 if(!mobile)app.classList.remove('mobile-nav-open');
 const opened=mobile?app.classList.contains('mobile-nav-open'):!app.classList.contains('side-collapsed');
 $('officeSidebarToggle').setAttribute('aria-expanded',String(opened));
 $('officeSidebarToggle').setAttribute('aria-label',opened?'Collapse navigation':'Expand navigation');
 $('officeSidebarToggle').title=opened?'Collapse navigation':'Expand navigation';
 $('officeMobileToggle').setAttribute('aria-expanded',String(app.classList.contains('mobile-nav-open')));
 $('officeNavScrim').classList.toggle('hidden',!app.classList.contains('mobile-nav-open'));
}
$('officeSidebarToggle').addEventListener('click',()=>{
 const app=$('officeApp');
 if(window.matchMedia('(max-width:720px)').matches)app.classList.remove('mobile-nav-open');
 else app.classList.toggle('side-collapsed');
 syncOfficeNavigation();
});
$('officeMobileToggle').addEventListener('click',()=>{
 $('officeApp').classList.toggle('mobile-nav-open');syncOfficeNavigation();
});
$('officeNavScrim').addEventListener('click',()=>{
 $('officeApp').classList.remove('mobile-nav-open');syncOfficeNavigation();
});
window.addEventListener('resize',syncOfficeNavigation);
document.querySelectorAll('[data-office-page]').forEach(button=>{
 button.title=button.querySelector('.side-text')?.textContent?.trim()||'Office navigation';
});
syncOfficeNavigation();
$('officeLogout').onclick=async()=>{
 try{await api('/api/supply/office/logout',{method:'POST'});}catch(_){}
 loggedIn(false);
};
function selectPage(name){
 activePage=name;
 document.querySelectorAll('[data-office-page]').forEach(b=>b.classList.toggle('active',b.dataset.officePage===name));
 for(const section of ['requests','franchisees','catalog','settings','security'])$('page-'+section).classList.toggle('hidden',section!==name);
 $('officePageHeading').textContent=({requests:'Purchase requests',franchisees:'Franchisee Profile',catalog:'Supply catalog',settings:'Office settings',security:'Change password'})[name];
 $('officeApp').classList.remove('mobile-nav-open');syncOfficeNavigation();
 if(name==='franchisees')loadFranchisees();
 if(name==='catalog')loadCatalog();
 if(name==='settings')loadSettings();
}
document.querySelectorAll('[data-office-page]').forEach(b=>b.onclick=()=>selectPage(b.dataset.officePage));
$('officeRefresh').onclick=()=>{if(activePage==='franchisees')loadFranchisees();else refresh();};
const refreshIcon="<svg viewBox=\"0 0 24 24\" width=\"21\" height=\"21\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.3\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M21 11a9 9 0 1 1-2.51-6.33\"/><path d=\"M21 3v6h-6\"/></svg>";
$('officeRefresh').innerHTML=refreshIcon;
$('officeRefresh').classList.add('office-round-refresh');
$('officeRefresh').setAttribute('aria-label','Refresh Main Office data');
$('officeRefresh').setAttribute('title','Refresh Main Office data');

const headerClock=new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',weekday:'long',month:'long',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',hour12:true});
function updateOfficeHeaderDate(){$('officeClock').textContent=headerClock.format(new Date());}
updateOfficeHeaderDate();setInterval(updateOfficeHeaderDate,60000);
async function refresh(){
 if($('officeApp').classList.contains('hidden'))return;
 try{
  const d=await api('/api/supply/office/orders');all=d.orders||[];
  $('statTotal').textContent=all.length;
  $('statPending').textContent=all.filter(x=>['PENDING_REVIEW','APPEAL_REVIEW'].includes(x.status)).length;
  $('statHold').textContent=all.filter(x=>x.status==='ON_HOLD').length;
  $('statActive').textContent=all.filter(x=>['APPROVED','PREPARING','DISPATCHED','DELIVERED'].includes(x.status)).length;
  $('pendingBadge').textContent=all.filter(x=>['PENDING_REVIEW','APPEAL_REVIEW'].includes(x.status)).length;
  render();
  // Keep the in-progress selection and reason intact while the list auto-refreshes.
 }catch(err){notice(err.message,true);}
}
const expandedOwnerGroups=new Set();
const expandChevron="<svg class=\"expand-chevron\" viewBox=\"0 0 24 24\" width=\"19\" height=\"19\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"m6 9 6 6 6-6\"/></svg>";
function render(){
 const q=$('officeSearch').value.toLowerCase().trim(),status=$('officeStatusFilter').value;
 const matched=all.filter(o=>(!status||o.status===status)&&(!q||
  [o.id,o.franchise_owner,o.branch_name,o.requester,o.status,o.priority].some(y=>String(y||'').toLowerCase().includes(q))));
 const byAccount=new Map();
 for(const order of matched){
  const account=String(order.workspace_id||'unknown-'+order.requested_by);
  if(!byAccount.has(account))byAccount.set(account,{
    id:account,owner:order.franchise_owner||order.requester||'Franchise owner',orders:[],total:0,branches:new Set()
  });
  const group=byAccount.get(account);
  group.orders.push(order);group.total+=Number(order.total||0);
  if(order.branch_name)group.branches.add(order.branch_name);
 }
 const groups=[...byAccount.values()].sort((x,y)=>
  new Date(y.orders[0]?.created_at||0)-new Date(x.orders[0]?.created_at||0));
 const pages=Math.max(1,Math.ceil(groups.length/PAGE_SIZE));
 page=Math.max(1,Math.min(page,pages));
 const chosen=groups.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE);
 const lines=[];
 for(const g of chosen){
  const open=expandedOwnerGroups.has(g.id);
  const pending=g.orders.filter(o=>['PENDING_REVIEW','APPEAL_REVIEW'].includes(o.status)).length;
  const branches=[...g.branches];
  lines.push('<tr class="office-account-summary"><td>'+
   '<button class="office-account-expand" type="button" data-office-owner="'+esc(g.id)+'" aria-expanded="'+open+
   '" aria-label="'+(open?'Collapse':'Expand')+' purchase orders for '+esc(g.owner)+'">'+
   '<span class="office-account-chevron" aria-hidden="true">'+expandChevron+'</span>'+
   '<strong>'+g.orders.length+' order'+(g.orders.length===1?'':'s')+'</strong></button></td>'+
   '<td><strong>'+esc(g.owner)+'</strong><div class="muted">Owner account · '+branches.length+' branch'+(branches.length===1?'':'es')+
   '</div><small>'+esc(branches.slice(0,3).join(', '))+(branches.length>3?'…':'')+'</small></td>'+
   '<td>Franchise account</td><td><b>'+peso(g.total)+'</b></td>'+
   '<td><span class="office-account-status">'+pending+' awaiting review</span></td>'+
   '<td>'+stamp(g.orders[0]?.created_at)+'</td><td><button type="button" class="office-account-expand office-account-expand-tail" data-office-owner="'+esc(g.id)+'" aria-expanded="'+open+'" aria-label="'+(open?'Collapse':'Expand')+' purchase orders for '+esc(g.owner)+'"><span class="office-tail-label">'+(open?'Collapse':'Expand')+'</span>'+expandChevron+'</button></td></tr>');
  if(open){
   for(const o of g.orders){
    lines.push('<tr class="office-account-order"><td><b>'+esc(o.id.slice(0,8).toUpperCase())+'</b></td>'+
     '<td><strong>'+esc(o.branch_name||'—')+'</strong><div class="muted">'+esc(o.requester||'Franchise')+'</div></td>'+
     '<td>'+(o.priority==='URGENT'?'⚡ Urgent':'Standard')+'</td><td><b>'+peso(o.total)+'</b></td>'+
     '<td><span class="badge '+esc(o.status.toLowerCase())+'">'+esc(title(o.status))+'</span></td>'+
     '<td>'+stamp(o.created_at)+'</td>'+
     '<td><button class="table-action" data-office-open="'+esc(o.id)+'">Review</button></td></tr>');
   }
  }
 }
 $('officeOrdersBody').innerHTML=lines.join('')||'<tr><td colspan="7">No matching franchise accounts.</td></tr>';
 $('officeOrderPages').innerHTML='<span>Page '+page+' of '+pages+' · '+groups.length+' franchise owners · '+matched.length+' orders</span>'+
  '<button type="button" data-office-page-nav="-1" '+(page===1?'disabled':'')+'>Previous</button>'+
  '<button type="button" data-office-page-nav="1" '+(page===pages?'disabled':'')+'>Next</button>';
 $('officeOrdersBody').querySelectorAll('[data-office-open]').forEach(button=>
  button.onclick=()=>openOrder(button.dataset.officeOpen));
 $('officeOrdersBody').querySelectorAll('[data-office-owner]').forEach(button=>button.onclick=()=>{
  const id=button.dataset.officeOwner;
  if(expandedOwnerGroups.has(id))expandedOwnerGroups.delete(id);else expandedOwnerGroups.add(id);
  render();
 });
 $('officeOrderPages').querySelectorAll('button').forEach(button=>button.onclick=()=>{
  page+=Number(button.dataset.officePageNav);render();
 });
}
$('officeSearch').oninput=()=>{page=1;render();};
$('officeStatusFilter').onchange=()=>{page=1;render();};
async function loadFranchisees(){
 try{
  const d=await api('/api/supply/office/franchisees');
  franchiseOwners=d.franchisees||[];
  renderFranchisees();
  if(franchiseProfile)await openFranchise(franchiseProfile.owner.workspaceId,true);
 }catch(e){notice(e.message,true);}
}
const royaltyBadge=(status)=>status==='PAID'?'<span class="royalty-badge paid">Paid</span>':status==='PENDING'?'<span class="royalty-badge pending">Pending</span>':'<span class="royalty-badge unset">Not configured</span>';
function pages(container,total,limit,current,action){
 const pageCount=Math.max(1,Math.ceil(total/limit));
 $(container).innerHTML='<span>Page '+current+' of '+pageCount+' · '+total+' records</span>'+
 '<button type="button" data-profile-page="-1" '+(current===1?'disabled':'')+'>Previous</button>'+
 '<button type="button" data-profile-page="1" '+(current===pageCount?'disabled':'')+'>Next</button>';
 $(container).querySelectorAll('button').forEach(button=>button.onclick=()=>action(Number(button.dataset.profilePage)));
}
function renderFranchisees(){
 const term=$('franchiseSearch').value.toLowerCase().trim();
 const data=franchiseOwners.filter(x=>String(x.ownerName||'').toLowerCase().includes(term)||String(x.workspaceId).includes(term));
 franchisePage=Math.min(Math.max(1,franchisePage),Math.max(1,Math.ceil(data.length/10)));
 $('franchiseProfilesBody').innerHTML=data.slice((franchisePage-1)*10,franchisePage*10).map(x=>
 '<tr><td><strong>'+esc(x.ownerName)+'</strong><small class="franchise-subline">Owner · Account '+x.workspaceId+'</small></td>'+
 '<td>'+x.branchCount+'</td><td><strong>'+peso(x.monthlyFee)+'</strong></td>'+
 '<td>'+royaltyBadge(x.royaltyStatus)+'</td><td><strong>'+peso(x.pendingTotal)+'</strong><small class="franchise-subline">'+x.pendingMonths+' pending month(s)</small></td>'+
 '<td>'+stamp(x.joinedAt)+'</td><td><button class="table-action" type="button" data-franchise-owner="'+x.workspaceId+'">View</button></td></tr>'
 ).join('')||'<tr><td colspan="7">No franchise owners found.</td></tr>';
 $('franchiseProfilesBody').querySelectorAll('[data-franchise-owner]').forEach(b=>b.onclick=()=>openFranchise(Number(b.dataset.franchiseOwner)));
 pages('franchiseProfilesPages',data.length,10,franchisePage,by=>{franchisePage+=by;renderFranchisees();});
}
async function openFranchise(workspaceId,quiet=false){
 try{
  const d=await api('/api/supply/office/franchisees/'+workspaceId);
  franchiseProfile=d;
  $('franchiseDetailPanel').classList.remove('hidden');
  $('franchiseDetailName').textContent=d.owner.ownerName;
  $('franchiseDetailMeta').textContent='Original account owner · Joined '+stamp(d.owner.joinedAt);
  $('franchiseMonthlyFee').value=Number(d.owner.monthlyFee).toFixed(2);
  $('franchiseDetailSummary').innerHTML=[
   ['Branches',d.owner.branchCount+' · '+(d.branches.map(x=>x.name).join(', ')||'No branches')],
   ['Royalty status',d.owner.royaltyStatus==='NOT_SET'?'Not configured':title(d.owner.royaltyStatus)],
   ['Monthly fee',peso(d.owner.monthlyFee)],
   ['Unpaid royalties',peso(d.owner.pendingTotal)]
  ].map(([k,v])=>'<div class="franchise-summary-card"><small>'+esc(k)+'</small><strong>'+esc(v)+'</strong></div>').join('');
  renderFranchiseDetail();
  if(!quiet)$('franchiseDetailPanel').scrollIntoView({behavior:'smooth',block:'start'});
 }catch(e){notice(e.message,true);}
}
function renderFranchiseDetail(){
 if(!franchiseProfile)return;
 const data=franchiseProfile;
 document.querySelectorAll('[data-franchise-tab]').forEach(b=>{
  const active=b.dataset.franchiseTab===franchiseTab;
  b.classList.toggle('active',active);b.setAttribute('aria-selected',active?'true':'false');
 });
 $('franchiseOrdersPanel').classList.toggle('hidden',franchiseTab!=='orders');
 $('franchiseRoyaltiesPanel').classList.toggle('hidden',franchiseTab!=='royalties');
 const orders=data.orders||[],royalties=data.months||[];
 franchiseOrderPage=Math.min(Math.max(1,franchiseOrderPage),Math.max(1,Math.ceil(orders.length/10)));
 franchiseRoyaltyPage=Math.min(Math.max(1,franchiseRoyaltyPage),Math.max(1,Math.ceil(royalties.length/10)));
 $('franchiseOrderRows').innerHTML=orders.slice((franchiseOrderPage-1)*10,franchiseOrderPage*10).map(o=>
 '<tr><td><strong>'+esc(o.id.slice(0,8).toUpperCase())+'</strong></td><td>'+stamp(o.created_at)+'</td>'+
 '<td>'+peso(o.subtotal)+'</td><td>'+peso(o.royaltyTotal)+'</td><td><strong>'+peso(o.total)+'</strong></td>'+
 '<td><span class="badge '+esc(o.status.toLowerCase())+'">'+esc(title(o.status))+'</span></td></tr>'
 ).join('')||'<tr><td colspan="6">No supply orders yet.</td></tr>';
 pages('franchiseOrderPages',orders.length,10,franchiseOrderPage,n=>{franchiseOrderPage+=n;renderFranchiseDetail();});
 $('franchiseRoyaltyRows').innerHTML=royalties.slice((franchiseRoyaltyPage-1)*10,franchiseRoyaltyPage*10).map(m=>{
  const reserved=!!m.reserved_order_id,manualPaid=m.status==='PAID'&&m.paid_via==='MANUAL';
  const action=reserved?'<span class="muted">Linked to order</span>':
   m.status==='PENDING'?'<button type="button" class="table-action" data-royalty-id="'+esc(m.id)+'" data-next-status="PAID">Mark Paid</button>':
   manualPaid?'<button type="button" class="table-action" data-royalty-id="'+esc(m.id)+'" data-next-status="PENDING">Reopen</button>':
   '<span class="muted">Paid via order</span>';
  return '<tr><td>'+esc(m.period)+'</td><td><strong>'+peso(m.amount)+'</strong></td>'+
   '<td>'+royaltyBadge(m.status)+'</td><td>'+(reserved?'Request '+esc(m.reserved_order_id.slice(0,8).toUpperCase()):
   m.paid_via==='MANUAL'?'Manual payment':m.paid_via==='SUPPLY_ORDER'?'Supply order':m.paid_at?'Paid':'Awaiting payment')+'</td>'+
   '<td>'+action+'</td></tr>';
 }).join('')||'<tr><td colspan="5">No royalty months have been issued. Set the monthly fee to begin billing.</td></tr>';
 $('franchiseRoyaltyRows').querySelectorAll('[data-royalty-id]').forEach(b=>b.onclick=async()=>{
  const status=b.dataset.nextStatus,id=b.dataset.royaltyId;
  if(!window.confirm(status==='PAID'?'Confirm receipt of this monthly royalty payment?':'Reopen this manually paid royalty as Pending?'))return;
  b.disabled=true;
  try{
   await api('/api/supply/office/franchisees/'+data.owner.workspaceId+'/royalties/'+id+'/status',
    {method:'POST',body:JSON.stringify({status})});
   notice('Royalty status updated to '+title(status)+'.');
   await loadFranchisees();
  }catch(e){notice(e.message,true);}finally{b.disabled=false;}
 });
 pages('franchiseRoyaltyPages',royalties.length,10,franchiseRoyaltyPage,n=>{franchiseRoyaltyPage+=n;renderFranchiseDetail();});
}
$('franchiseSearch').oninput=()=>{franchisePage=1;renderFranchisees();};
$('franchiseDetailClose').onclick=()=>{$('franchiseDetailPanel').classList.add('hidden');franchiseProfile=null;};
document.querySelectorAll('[data-franchise-tab]').forEach(b=>b.onclick=()=>{franchiseTab=b.dataset.franchiseTab;renderFranchiseDetail();});
$('franchiseFeeForm').onsubmit=async event=>{
 event.preventDefault();if(!franchiseProfile)return;
 const id=franchiseProfile.owner.workspaceId;
 try{
  const result=await api('/api/supply/office/franchisees/'+id+'/royalty-fee',{
   method:'PUT',body:JSON.stringify({monthlyFee:$('franchiseMonthlyFee').value})});
  notice('Monthly royalty fee saved. Existing issued periods and prior orders are unchanged.');
  await loadFranchisees();
 }catch(e){notice(e.message,true);}
};
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

/* Workflow actions are supplied by the server, so the menu cannot drift
   from the backend's allowed next stages. Only the next decision is shown. */
const officeActionLabels={
 PENDING_REVIEW:{APPROVED:'Approve payment',ON_HOLD:'Place on hold',DENIED:'Deny request'},
 ON_HOLD:{APPROVED:'Approve payment',DENIED:'Deny request'},
 APPEAL_REVIEW:{APPROVED:'Overturn denial → Approved',DENIED:'Deny appeal'},
 APPROVED:{PREPARING:'Start preparing',DISPATCHED:'Mark dispatched',DELIVERED:'Mark delivered (complete)'},
 PREPARING:{DISPATCHED:'Mark dispatched',DELIVERED:'Mark delivered (complete)'},
 DISPATCHED:{DELIVERED:'Mark delivered (complete)'}
};
const stageHelp={
 PENDING_REVIEW:'Pending for review. Verify the submitted payment, then approve, hold, or deny this request.',
 ON_HOLD:'This request is on hold. Review the reason before approving payment or denying it.',
 DENIED:'This request was denied. Only the franchise can appeal (up to two times). Wait for an appeal before acting.',
 APPEAL_REVIEW:'An appeal was submitted. Review its reason, then overturn the denial or deny the appeal.',
 APPROVED:'Payment approved. Choose Preparing, Dispatched, or Delivered (Complete) based on the actual order progress.',
 PREPARING:'Preparing supplies. Mark as Dispatched, or Delivered (Complete) once the order reaches the customer.',
 DISPATCHED:'Supplies dispatched. Confirm delivery to complete this request.',
 DELIVERED:'Delivered and complete. No further decisions are available.',
 COMPLETED:'This legacy request is complete. No further decisions are available.'
};
function updateDecisionNote(){
 const next=$('officeNextStatus').value,overturn=current?.status==='APPEAL_REVIEW'&&next==='APPROVED';
 const requires=next==='ON_HOLD'||next==='DENIED'||overturn||current?.status==='APPEAL_REVIEW';
 $('officeStatusNote').required=requires;
 $('officeStatusNote').placeholder=overturn?'Required: explain why the denial is being overturned':
  next==='ON_HOLD'?'Required: reason for putting this request on hold':
  next==='DENIED'&&current?.status==='APPEAL_REVIEW'?'Required: reason for denying this appeal':
  next==='DENIED'?'Required: reason for denying this request':
  'Optional notes for the franchise';
 const label=officeActionLabels[current?.status]?.[next]||'Choose next action';
 $('officeStatusSave').textContent=next?(overturn?'Overturn denial & notify franchise':label+' & notify franchise'):'Choose a decision';
 $('officeStatusSave').disabled=!next;
}
$('officeNextStatus').addEventListener('change',updateDecisionNote);
function configureOfficeStage(order){
 const state=String(order.status||''),available=Array.isArray(order.nextStatuses)?order.nextStatuses:[];
 const terminal=state==='DELIVERED'||state==='COMPLETED'||!available.length;
 $('officeCurrentStage').textContent=title(state);
 $('officeCurrentStage').className='office-stage-pill '+state.toLowerCase();
 $('officeStageHint').textContent=(stageHelp[state]||'Review the current request status.')+
  (state==='APPEAL_REVIEW'?' (Appeal '+Number(order.appeal_count||0)+' of 2)':state==='DENIED'&&Number(order.appeal_count||0)>=2?' (Both appeals denied; final decision)':'');
 $('officeStageDone').classList.toggle('hidden',!terminal);
 $('officeStageDone').textContent=state==='DELIVERED'?'Delivered · Complete. No further action is required.':
  'This request has no available next action.';
 $('officeStatusForm').classList.toggle('hidden',terminal);
 const select=$('officeNextStatus');
 select.replaceChildren();
 const placeholder=document.createElement('option');
 placeholder.value='';placeholder.textContent='Select next decision';placeholder.disabled=true;placeholder.selected=true;
 select.appendChild(placeholder);
 const actions=officeActionLabels[state]||{};
 for(const next of available){
  if(!Object.prototype.hasOwnProperty.call(actions,next))continue;
  const item=document.createElement('option');
  item.value=next;item.textContent=actions[next];
  select.appendChild(item);
 }
 $('officeStatusNote').value='';
 updateDecisionNote();
}
async function openOrder(id,quiet=false){
 try{
  const d=await api('/api/supply/office/orders/'+encodeURIComponent(id));current=d.order;const o=current;
  $('detailTitle').textContent='Request '+o.id.slice(0,8).toUpperCase();
  $('officeDetailSummary').innerHTML='<div class="info-grid">'+[
   ['Branch',o.branch_name],['Franchise Owner',o.franchise_owner||'—'],['Requested by',o.requester],['Priority',o.priority],
   ['Status',title(o.status)],['Item subtotal',peso(o.subtotal)],
   ['Urgent fee',peso(o.urgent_fee)],['Monthly royalties',peso(o.royalty_total||0)],['Total',peso(o.total)],['Submitted',stamp(o.created_at)]].map(([k,v])=>'<span><small>'+esc(k)+'</small><b>'+esc(v)+'</b></span>').join('')+'</div>';
  $('officeDetailItems').innerHTML=o.items.map(i=>'<tr><td>'+esc(i.product_name)+'</td><td>'+esc(i.uom)+'</td><td>'+i.quantity+'</td><td>'+peso(i.amount)+'</td></tr>').join('');
  $('officePaymentReference').textContent='Payment reference: '+(o.payment_reference||'Not provided. Verify the attached proof.');
  const src=String(o.paymentImage||'');
  $('officePaymentImage').innerHTML=/^data:image\/(png|jpeg|webp);base64,[\w+/]+=*$/.test(src)?
   '<a href="'+src+'" target="_blank" rel="noopener noreferrer" title="Open full payment proof"><img class="payment-shot" src="'+src+'" alt="Submitted payment proof" decoding="async"></a>':
   '<p class="error">The payment image could not be decoded.</p>';
  const img=$('officePaymentImage').querySelector('img');
  if(img)img.addEventListener('error',()=>{$('officePaymentImage').textContent='Payment photo could not be decoded.';});
  configureOfficeStage(o);
  const appeal=(o.history||[]).filter(x=>x.status==='APPEAL_REVIEW').at(-1);
  $('officeAppealNotice').classList.toggle('hidden',!appeal||o.status!=='APPEAL_REVIEW');
  $('officeAppealNotice').textContent=appeal?'Appeal '+Number(o.appeal_count||0)+' of 2: '+String(appeal.note||'No reason provided'):'';
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
 const next=$('officeNextStatus').value;
 if(!next||!Array.isArray(current.nextStatuses)||!current.nextStatuses.includes(next)){
  notice('Select an available next decision for this request.',true);return;
 }
 const overturn=current.status==='APPEAL_REVIEW'&&next==='APPROVED';
 const note=$('officeStatusNote').value.trim();
 if((next==='ON_HOLD'||next==='DENIED'||overturn||current.status==='APPEAL_REVIEW')&&!note){
  notice('Enter a reason before confirming this decision.',true);$('officeStatusNote').focus();return;
 }
 if(overturn&&!window.confirm('Overturn this denial and approve payment? This will reserve the required stock and original royalty charges.'))return;
 const save=$('officeStatusSave');save.disabled=true;
 try{
  const d=await api('/api/supply/office/orders/'+current.id+'/status',{method:'POST',body:JSON.stringify({status:next,note})});
  notice(overturn?'Denial overturned. Payment approved and franchise notified.':
   d.status==='DELIVERED'?'Delivery confirmed. Request is complete and franchise notified.':
   'Request updated to '+title(d.status)+'. Franchise notified.');
  const savedId=current.id;
  await refresh();await openOrder(savedId,true);
 }catch(err){notice(err.message,true);}
 finally{save.disabled=false;updateDecisionNote();}
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