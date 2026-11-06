'use strict';
(()=>{
 const $=id=>document.getElementById(id);
 let accounts=[],summary={},page=1,search='',status='all',selected=null,officeName='Admin Control',mustChangeAdminPassword=false;
 let officeSubscription=null,billingFilter=null,platformChartData=[];
 const PAGE_SIZE=10,expandedOwners=new Set(),expandedBranches=new Set();
 const headerClock=new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',weekday:'long',month:'long',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',hour12:true});
 function updateAdminHeaderDate(){const el=$('adminHeaderDate');if(el)el.textContent=headerClock.format(new Date());}
 updateAdminHeaderDate();setInterval(updateAdminHeaderDate,60000);
 const esc=x=>String(x==null?'':x).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
 const number=x=>new Intl.NumberFormat('en-PH').format(Number(x)||0);
 const peso=x=>x===null||x===undefined?'—':new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(x)||0);
 const date=x=>{if(!x)return'—';const d=new Date(x);return Number.isNaN(d.getTime())?'—':new Intl.DateTimeFormat('en-PH',{day:'2-digit',month:'short',year:'numeric',timeZone:'Asia/Manila'}).format(d)};
 const badge=(value,type)=>'<span class="status '+esc(type)+'">'+esc(value)+'</span>';
  const expandChevron="<svg class=\"expand-chevron\" viewBox=\"0 0 24 24\" width=\"19\" height=\"19\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"m6 9 6 6 6-6\"/></svg>";
  const paymentStatus=sub=>{
    if(!sub)return'<span class="payment-state unset">Not configured</span>';
    const st=['PAID','ON_HOLD','UNPAID'].includes(sub.status)?sub.status:'UNKNOWN';
    const label=st==='ON_HOLD'?'On Hold':st==='PAID'?'Paid':st==='UNPAID'?'Unpaid':'Unknown';
    const svg=st==='PAID'?"<svg class=\"payment-icon\" viewBox=\"0 0 24 24\" width=\"20\" height=\"20\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><rect x=\"2\" y=\"5\" width=\"20\" height=\"14\" rx=\"2\"/><path d=\"M5.5 9h.01M18.5 15h.01M12 8v8M14 10c-1.2-1.5-4.1-1.5-4.1.3 0 2 4.2.9 4.2 3.1 0 1.8-3 2.2-4.3.7\"/></svg>":st==='UNPAID'?"<svg class=\"payment-icon\" viewBox=\"0 0 24 24\" width=\"20\" height=\"20\" aria-hidden=\"true\"><circle cx=\"12\" cy=\"12\" r=\"11\" fill=\"currentColor\"/><path d=\"M12 6.7v7.1\" stroke=\"#fff\" stroke-width=\"2.8\" stroke-linecap=\"round\"/><circle cx=\"12\" cy=\"17.5\" r=\"1.45\" fill=\"#fff\"/></svg>":"<svg class=\"payment-icon\" viewBox=\"0 0 24 24\" width=\"20\" height=\"20\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.1\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M12 3 22 20H2L12 3Z\"/><path d=\"M12 9v5M12 17.5h.01\"/></svg>";
    return'<span class="payment-state '+(st==='PAID'?'paid':st==='ON_HOLD'?'hold':st==='UNPAID'?'unpaid':'unset')+'" title="'+label+'">'+svg+'<span>'+label+'</span></span>';
  };
  const dueDays=value=>{
   if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value||'')))return null;
   const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).filter(x=>x.type!=='literal').map(x=>[x.type,Number(x.value)]));
   const start=Date.UTC(parts.year,parts.month-1,parts.day),end=Date.parse(value+'T00:00:00Z');
   return Number.isFinite(end)?Math.round((end-start)/86400000):null;
  };
  const daysRemaining=value=>{const n=dueDays(value);if(n===null)return'<span class="due-days unset">—</span>';
   if(n<0)return'<span class="due-days overdue">'+number(-n)+' day'+(n===-1?'':'s')+' overdue</span>';
   return'<span class="due-days '+(n<=7?'soon':'normal')+'">'+(n===0?'Due today':number(n)+' day'+(n===1?'':'s')+' left')+'</span>';
  };
 const opened=(set,key)=>set.has(String(key));
 async function api(path,options={}){
  const response=await fetch('/api/supply/office/platform/'+path,{credentials:'same-origin',cache:'no-store',
   ...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok){const error=new Error(payload.error||'Request failed ('+response.status+').');error.status=response.status;throw error;}
  return payload;
 }
 function error(id,message){const el=$(id);el.textContent=message||'';el.classList.toggle('hidden',!message)}
 function showApp(username){officeName=username||'Main Office';updateAdminHeaderDate();
  $('platformLogin').classList.add('hidden');$('platformApp').classList.remove('hidden')}
 function showLogin(message=''){mustChangeAdminPassword=false;if($('adminCredentialsDialog').open)$('adminCredentialsDialog').close();$('platformLogin').classList.remove('hidden');$('platformApp').classList.add('hidden');
  error('platformLoginError',message);}
 async function checkSession(){
  try{
   const user=await api('me');
   showApp(user.username);if(user.mustChangePassword){openAdminCredentials(true);return;}await reload();
  }catch(err){showLogin(err.status===401?'':err.message)}
 }
 $('platformLoginForm').addEventListener('submit',async event=>{
  event.preventDefault();const button=$('platformLoginButton');button.disabled=true;
  error('platformLoginError','');
  try{
   const result=await api('login',{method:'POST',body:JSON.stringify({
    username:$('platformUsername').value.trim(),password:$('platformPassword').value})});
   $('platformPassword').value='';
   showApp(result.username||$('platformUsername').value.trim());
   if(result.mustChangePassword){openAdminCredentials(true);return;}await reload();
  }catch(err){error('platformLoginError',err.message)}
  finally{button.disabled=false}
 });
 $('platformLogout').addEventListener('click',async()=>{
  try{await api('logout',{method:'POST'})}catch(_){}
  accounts=[];showLogin();$('platformPassword').value='';
 });
 async function reload(){
  const button=$('refreshAccounts');button.disabled=true;error('tableMessage','');
  try{
   const data=await api('accounts');
   accounts=Array.isArray(data.accounts)?data.accounts:[];
   summary=data.summary||{};
   $('metricOwners').textContent=number(summary.owners);
   $('metricBranches').textContent=number(summary.branches);
   $('metricUsers').textContent=number(summary.users);
   $('metricActive').textContent=number(summary.activeOwners);
   render();await reloadBilling();
  }catch(err){
   error('tableMessage',err.message);
   if(err.status===401)showLogin('Please sign in again.');
  }finally{button.disabled=false}
 }
 $('refreshAccounts').addEventListener('click',reload);
 const findOwner=ws=>accounts.find(x=>x.workspaceId===Number(ws));
 const findUser=(owner,uid)=>[...(owner.allBranchAdmins||[]),...owner.branches.flatMap(b=>b.users||[]),...owner.unassigned].find(u=>u.id===Number(uid));
 const allText=a=>[a.ownerUsername,a.ownerFullName,a.ownerEmail,...a.branches.flatMap(b=>[b.name,...b.users.flatMap(u=>[u.username,u.fullName,u.email])]),...(a.allBranchAdmins||[]).flatMap(u=>[u.username,u.fullName,u.email]),...a.unassigned.flatMap(u=>[u.username,u.fullName,u.email])].join(' ').toLowerCase();
 function filtered(){
  return accounts.filter(x=>(status==='all'||(status==='active')===!!x.active)&&(!search||allText(x).includes(search)));
 }
 function renderStaff(users,owner){
  if(!users.length)return'<div class="staff-wrap"><div class="empty">No users assigned.</div></div>';
  return'<div class="staff-wrap"><table class="staff-table"><thead><tr><th>Username / Name</th><th>Email</th><th>Role</th><th>Status</th><th>Action</th></tr></thead><tbody>'+
   users.map(u=>'<tr><td><strong>'+esc(u.username)+'</strong><small>'+esc(u.fullName||'No name recorded')+'</small></td>'+
    '<td>'+esc(u.email||'Not provided')+'</td><td>'+esc(u.isOwner?'Owner':u.role==='Admin'?'Co-Owner':'Cashier')+'</td>'+
    '<td>'+badge(u.active?'Active':'Inactive',u.active?'active':'inactive')+'</td>'+
    '<td><button class="link-btn" data-edit-user="'+owner.workspaceId+':'+u.id+'" type="button">Edit user</button></td></tr>'
   ).join('')+'</tbody></table></div>';
 }
 function branchSection(owner){
  const active=opened(expandedOwners,owner.workspaceId);
  if(!active&&!search)return'';
  let blocks='';
  for(const b of owner.branches){
   const key=owner.workspaceId+':'+b.id,open=opened(expandedBranches,key)||!!search;
   blocks+='<div class="branch-row"><button class="expand" type="button" aria-expanded="'+open+'" data-toggle-branch="'+esc(key)+'">'+expandChevron+'</button>'+
    '<div class="branch-title"><strong>'+esc(b.name)+'</strong><small>'+esc([b.city,b.province].filter(Boolean).join(', ')||'Location not specified')+'</small></div>'+
    '<span class="branch-counter">'+number(b.users.length)+' users</span>'+badge(b.active?'Active':'Inactive',b.active?'active':'inactive')+'</div>';
   if(open)blocks+=renderStaff(b.users,owner);
  }
  const coOwners=(owner.allBranchAdmins||[]).filter(u=>!u.isOwner);
  if(coOwners.length){
   const key=owner.workspaceId+':all-branch-admins',open=opened(expandedBranches,key)||!!search;
   blocks+='<div class="branch-row"><button type="button" class="expand" aria-expanded="'+open+'" data-toggle-branch="'+key+'">'+expandChevron+'</button>'+
    '<div class="branch-title"><strong>Co-Owners · All Branches</strong><small>Account administrators can manage every branch</small></div>'+
    '<span class="branch-counter">'+number(coOwners.length)+' administrators</span></div>';
   if(open)blocks+=renderStaff(coOwners,owner);
  }
  if(owner.unassigned.length){
   const key=owner.workspaceId+':unassigned',open=opened(expandedBranches,key)||!!search;
   blocks+='<div class="branch-row"><button type="button" class="expand" aria-expanded="'+open+'" data-toggle-branch="'+key+'">'+expandChevron+'</button>'+
    '<div class="branch-title"><strong>Unassigned Users</strong><small>Staff members without branch assignments</small></div>'+
    '<span class="branch-counter">'+number(owner.unassigned.length)+' users</span></div>';
   if(open)blocks+=renderStaff(owner.unassigned,owner);
  }
  if(!blocks)blocks='<p class="empty">No branches or users registered.</p>';
  return'<tr class="hierarchy-row"><td colspan="9"><div class="hierarchy"><div class="hierarchy-head">BRANCHES &amp; MEMBERS · '+number(owner.userCount)+' USERS</div>'+blocks+'</div></td></tr>';
 }
 function render(){
  const list=filtered(),pages=Math.max(1,Math.ceil(list.length/PAGE_SIZE));
  page=Math.max(1,Math.min(pages,page));
  const selected=list.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE);
  $('recordCount').textContent=number(list.length)+' accounts';
  $('pageInfo').textContent=list.length?'Showing '+((page-1)*PAGE_SIZE+1)+'–'+Math.min(page*PAGE_SIZE,list.length)+' of '+list.length+' owners':'No matching owners';
  $('pagePrevious').disabled=page<=1;$('pageNext').disabled=page>=pages;
  const rows=[];
  for(const owner of selected){
   const open=opened(expandedOwners,owner.workspaceId)||!!search;
   const sub=owner.subscription;
   rows.push('<tr class="owner-row"><td><div class="owner-heading"><button type="button" class="expand" data-toggle-owner="'+owner.workspaceId+
    '" aria-expanded="'+open+'" aria-label="'+(open?'Collapse':'Expand')+' '+esc(owner.ownerUsername)+'">'+expandChevron+'</button>'+
    '<div class="owner-identity"><strong>'+esc(owner.ownerUsername)+'</strong><small>'+esc(owner.ownerFullName||'Account Owner')+'</small>'+
    '<div class="owner-controls"><button class="link-btn" type="button" data-subscribe="'+owner.workspaceId+'">Manage subscription</button>'+
    (owner.ownerId?'<button class="link-btn" type="button" data-edit-user="'+owner.workspaceId+':'+owner.ownerId+'">Edit owner</button>':'')+
    '</div></div></div></td>'+
    '<td><span class="num">'+number(owner.branchCount)+'</span></td>'+
    '<td>'+(sub?badge(sub.plan,'active'):'<span class="status unknown">Not configured</span>')+'</td>'+
    '<td class="currency">'+peso(sub?.amount)+'</td>'+
    '<td>'+paymentStatus(sub)+'</td>'+
    '<td class="due-date">'+(sub?.nextPaymentDate?esc(date(sub.nextPaymentDate+'T12:00:00Z')):'—')+'</td>'+
    '<td>'+daysRemaining(sub?.nextPaymentDate)+'</td><td>'+esc(date(owner.joinedAt))+'</td>'+
    '<td>'+badge(owner.active?'Active':'Inactive',owner.active?'active':'inactive')+'</td></tr>');
   if(open)rows.push(branchSection(owner));
  }
  if(page===1&&(!search||'supply chain main office tenant'.includes(search))&&(status==='all'||status==='active')){
   const sub=officeSubscription;
   rows.unshift('<tr class="owner-row office-tenant-row"><td><div class="owner-heading"><span class="office-tenant-icon" aria-hidden="true">▣</span><div class="owner-identity"><strong>Supply Chain / Main Office</strong><small>Independent platform tenant</small><div class="owner-controls"><button class="link-btn" data-office-subscription="true" type="button">Manage subscription</button></div></div></div></td>'+
    '<td><span class="num">—</span></td><td>'+(sub?badge(sub.plan,'active'):'<span class="status unknown">Not configured</span>')+'</td>'+
    '<td class="currency">'+peso(sub?.amount)+'</td><td>'+paymentStatus(sub)+'</td>'+
    '<td class="due-date">'+(sub?.nextPaymentDate?esc(date(sub.nextPaymentDate+'T12:00:00Z')):'—')+'</td>'+
    '<td>'+daysRemaining(sub?.nextPaymentDate)+'</td><td>—</td><td>'+badge('Active','active')+'</td></tr>');
  }
  $('ownersBody').innerHTML=rows.join('')||'<tr><td colspan="9" class="empty">No matching tenants.</td></tr>';
 }
 $('accountSearch').addEventListener('input',e=>{search=e.target.value.trim().toLowerCase();page=1;render()});
 $('statusFilter').addEventListener('change',e=>{status=e.target.value;page=1;render()});
 $('pagePrevious').addEventListener('click',()=>{page--;render()});
 $('pageNext').addEventListener('click',()=>{page++;render()});
 $('ownersBody').addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.hasAttribute('data-toggle-owner')){
   const key=button.dataset.toggleOwner;
   if(expandedOwners.has(key))expandedOwners.delete(key);else expandedOwners.add(key);
   render();return;
  }
  if(button.hasAttribute('data-toggle-branch')){
   const key=button.dataset.toggleBranch;
   if(expandedBranches.has(key))expandedBranches.delete(key);else expandedBranches.add(key);
   render();return;
  }
  if(button.hasAttribute('data-subscribe'))openPlan(findOwner(button.dataset.subscribe));
  if(button.hasAttribute('data-edit-user')){
   const [ws,uid]=button.dataset.editUser.split(':'),owner=findOwner(ws);
   if(owner)openUser(owner,findUser(owner,uid));
  }
 });
 function openPlan(owner){
  if(!owner)return;
  selected={kind:'subscription',owner};
  $('subscriptionOwner').textContent=owner.ownerUsername+' · Workspace #'+owner.workspaceId;
  $('subPlan').value=owner.subscription?.plan||'PRO';
  $('subStatus').value=owner.subscription?.status||'UNPAID';
  $('subAmount').value=owner.subscription?.amount??'';
  $('subNextPaymentDate').value=owner.subscription?.nextPaymentDate||'';
  error('subscriptionError','');
  $('subscriptionDialog').showModal();
 }
 $('subscriptionForm').addEventListener('submit',async e=>{
  e.preventDefault();if(selected?.kind!=='subscription')return;
  const btn=$('saveSubscription');btn.disabled=true;error('subscriptionError','');
  try{
   await api('accounts/'+selected.owner.workspaceId+'/subscription',{method:'PUT',
    body:JSON.stringify({plan:$('subPlan').value,status:$('subStatus').value,amount:$('subAmount').value,nextPaymentDate:$('subNextPaymentDate').value})});
   $('subscriptionDialog').close();await reload();
  }catch(err){error('subscriptionError',err.message)}
  finally{btn.disabled=false}
 });
 function syncBranch(){
  const role=$('userRole').value;
  $('userBranch').disabled=role==='Admin'||selected?.user?.isOwner;
  if(role==='Admin')$('userBranch').value='';
 }
 $('userRole').addEventListener('change',syncBranch);
 function openUser(owner,user){
  if(!owner||!user)return;
  selected={kind:'user',owner,user};
  $('userSummary').textContent=user.username+' · '+owner.ownerUsername;
  $('userUsername').value=user.username||'';
  $('userFullName').value=user.fullName||'';
  $('userEmail').value=user.email||'';
  $('userPhone').value=user.phone||'';
  $('userRole').value=user.isOwner?'Admin':user.role;
  $('userRole').disabled=!!user.isOwner;
  $('userBranch').innerHTML='<option value="">No branch</option>'+
   owner.branches.map(b=>'<option value="'+b.id+'">'+esc(b.name)+'</option>').join('');
  $('userBranch').value=user.branchId==null?'':String(user.branchId);
  $('userActive').checked=!!user.active;
  $('userOwnerNotice').classList.toggle('hidden',!user.isOwner);
  error('userError','');syncBranch();$('userDialog').showModal();
 }
 $('userForm').addEventListener('submit',async e=>{
  e.preventDefault();if(selected?.kind!=='user')return;
  const {owner,user}=selected;
  const active=$('userActive').checked;
  let confirmOwner=false;
  if(user.isOwner&&!active&&user.active){
   confirmOwner=window.confirm('Deactivate this franchise Owner? This does NOT disable their branch staff accounts. Continue?');
   if(!confirmOwner)return;
  }
  const button=$('saveUser');button.disabled=true;error('userError','');
  try{
   await api('accounts/'+owner.workspaceId+'/users/'+user.id,{method:'PUT',
    body:JSON.stringify({fullName:$('userFullName').value,email:$('userEmail').value,
     phone:$('userPhone').value,role:$('userRole').value,
     branchId:$('userBranch').value||null,active,confirmOwner})});
   $('userDialog').close();await reload();
  }catch(err){error('userError',err.message)}
  finally{button.disabled=false}
 });
 document.querySelectorAll('[data-close-dialog]').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
 function syncPlatformNavigation(){
  const app=$('platformApp'),mobile=window.matchMedia('(max-width:720px)').matches;
  const expanded=mobile?app.classList.contains('nav-open'):!app.classList.contains('nav-collapsed');
  $('platformSidebarToggle').setAttribute('aria-expanded',String(expanded));
  $('platformSidebarToggle').setAttribute('aria-label',expanded?'Collapse navigation':'Expand navigation');
  $('platformSidebarToggle').title=expanded?'Collapse navigation':'Expand navigation';
  $('menuToggle').setAttribute('aria-expanded',String(app.classList.contains('nav-open')));
 }
 $('platformSidebarToggle').addEventListener('click',()=>{
  const app=$('platformApp');
  if(window.matchMedia('(max-width:720px)').matches)app.classList.remove('nav-open');
  else app.classList.toggle('nav-collapsed');
  syncPlatformNavigation();
 });
 $('menuToggle').addEventListener('click',()=>{$('platformApp').classList.toggle('nav-open');syncPlatformNavigation();});
 document.querySelectorAll('.sidebar a').forEach(a=>a.addEventListener('click',()=>{$('platformApp').classList.remove('nav-open');syncPlatformNavigation();}));
 window.addEventListener('resize',syncPlatformNavigation);
 syncPlatformNavigation();


 let adminInvoices=[],billingPage=1,billingTotal=0;
 function renderBillingLedger(){
  const records=adminInvoices,pages=Math.max(1,Math.ceil(billingTotal/10));
  billingPage=Math.max(1,Math.min(pages,billingPage));
  $('adminBillingCount').textContent=number(billingTotal)+' invoices';
  $('adminBillingPageInfo').textContent='Page '+billingPage+' of '+pages;
  $('adminBillingPrevious').disabled=billingPage===1;$('adminBillingNext').disabled=billingPage===pages;
  $('adminBillingRows').innerHTML=records.map(i=>{
   const name=i.tenantKind==='SUPPLY_OFFICE'?'Supply Chain / Main Office':(findOwner(i.tenantId)?.ownerUsername||'Franchise #'+i.tenantId);
   return'<tr><td><strong>'+esc(i.id.slice(0,8).toUpperCase())+'</strong></td><td>'+esc(name)+'</td><td>'+esc(i.plan)+'</td>'+
   '<td>'+peso(i.amount)+'</td><td>'+badge(String(i.status).replaceAll('_',' '),i.status==='PAID'?'active':i.status==='PENDING'?'on-hold':'unknown')+'</td>'+
   '<td>'+esc(i.paymentMethod||'—')+'</td><td>'+esc(date(i.createdAt))+'</td><td>'+esc(date(i.paidAt))+'</td></tr>';
  }).join('')||'<tr><td colspan="8" class="empty">No subscription payments recorded yet.</td></tr>';
 }
 async function reloadBilling(){
  try{
   const data=await api('billing?page='+billingPage),ready=Boolean(data.checkoutConfigured);
   $('adminPayMongoStatus').textContent=ready?'PayMongo '+String(data.paymentMode).toUpperCase()+' configured':'PayMongo not connected';
   $('adminPayMongoStatus').classList.toggle('ready',ready);
   $('adminBillingMode').textContent=ready?data.paymentMode:'Not connected';
   adminInvoices=Array.isArray(data.invoices)?data.invoices:[];
   billingTotal=Number(data.totalCount||0);
   $('adminBillingPaid').textContent=number(data.paidCount||0);
   $('adminBillingPending').textContent=number(data.pendingCount||0);
   $('adminBillingNotice').textContent=ready?'PayMongo keys detected. Payments require merchant activation and registered webhooks.':
    'PayMongo is not connected. Tenant payment buttons are disabled, and no money is being collected.';
   const office=data.supplyOffice;
   $('adminOfficePlan').value=office?.plan||'PRO';$('adminOfficeAmount').value=office?.amount??'';
   $('adminOfficeStatus').value=office?.status||'UNPAID';$('adminOfficeDue').value=office?.nextPaymentDate||'';
   renderBillingLedger();
  }catch(err){$('adminBillingNotice').textContent='Billing cannot load: '+err.message;}
 }
 $('adminOfficePlanForm').addEventListener('submit',async e=>{
  e.preventDefault();const save=$('adminOfficeSave');save.disabled=true;error('adminOfficeError','');
  try{
   await api('billing/supply-office',{method:'PUT',body:JSON.stringify({
    plan:$('adminOfficePlan').value,amount:$('adminOfficeAmount').value,
    status:$('adminOfficeStatus').value,nextPaymentDate:$('adminOfficeDue').value})});
   await reloadBilling();
   $('adminBillingNotice').textContent='Supply Chain subscription saved.';
  }catch(err){error('adminOfficeError',err.message)}finally{save.disabled=false;}
 });
 $('adminBillingPrevious').addEventListener('click',()=>{billingPage--;reloadBilling()});
 $('adminBillingNext').addEventListener('click',()=>{billingPage++;reloadBilling()});
 $('platformBillingButton').addEventListener('click',()=>{
  $('platformBilling').scrollIntoView({behavior:'smooth',block:'start'});
  $('platformApp').classList.remove('nav-open');syncPlatformNavigation();
 });

function openAdminCredentials(required=false){
 mustChangeAdminPassword=required;
 $('adminCredentialsForm').reset();
 $('adminNewUsername').value=officeName;
 error('adminCredentialsError','');
 $('adminCredentialsTitle').textContent=required?'Secure your Admin Control account':'Update login credentials';
 $('adminCredentialsDescription').textContent=required?'The initial credentials are temporary. Choose a private password to enable account management.':'Change the username, password, or both. Supply Chain credentials will not be affected.';
 $('adminNewPassword').required=required;
 $('adminConfirmPassword').required=required;
 $('adminCredentialsCancel').classList.toggle('hidden',required);
 $('adminCredentialsClose').classList.toggle('hidden',required);
 if(!$('adminCredentialsDialog').open)$('adminCredentialsDialog').showModal();
}
$('platformAccountSettingsButton').addEventListener('click',()=>openAdminCredentials(mustChangeAdminPassword));
$('adminCredentialsCancel').addEventListener('click',()=>{if(!mustChangeAdminPassword)$('adminCredentialsDialog').close();});
$('adminCredentialsClose').addEventListener('click',()=>{if(!mustChangeAdminPassword)$('adminCredentialsDialog').close();});
$('adminCredentialsDialog').addEventListener('cancel',event=>{if(mustChangeAdminPassword)event.preventDefault();});
$('adminCredentialsForm').addEventListener('submit',async event=>{
 event.preventDefault();
 const currentPassword=$('adminCurrentPassword').value,newPassword=$('adminNewPassword').value;
 if(newPassword!==$('adminConfirmPassword').value){error('adminCredentialsError','New passwords do not match.');return;}
 const save=$('adminCredentialsSave');save.disabled=true;error('adminCredentialsError','');
 try{
  const result=await api('credentials',{method:'POST',body:JSON.stringify({currentPassword,newUsername:$('adminNewUsername').value.trim(),newPassword})});
  officeName=result.username;
  mustChangeAdminPassword=false;
  $('adminCredentialsForm').reset();
  $('adminCredentialsDialog').close();
  await reload();
 }catch(err){error('adminCredentialsError',err.message);}
 finally{save.disabled=false;}
});
$('platformPasswordToggle').addEventListener('click',()=>{
 const input=$('platformPassword'),show=input.type==='password';input.type=show?'text':'password';
 $('platformPasswordToggle').setAttribute('aria-pressed',String(show));
 $('platformPasswordToggle').setAttribute('aria-label',show?'Hide password':'Show password');
});

 checkSession();
})();
