'use strict';
(()=>{
 const $=id=>document.getElementById(id);
 let accounts=[],summary={},page=1,search='',status='all',selected=null,officeName='Main Office';
 const PAGE_SIZE=10,expandedOwners=new Set(),expandedBranches=new Set();
 const esc=x=>String(x==null?'':x).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
 const number=x=>new Intl.NumberFormat('en-PH').format(Number(x)||0);
 const peso=x=>x===null||x===undefined?'—':new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(x)||0);
 const date=x=>{if(!x)return'—';const d=new Date(x);return Number.isNaN(d.getTime())?'—':new Intl.DateTimeFormat('en-PH',{day:'2-digit',month:'short',year:'numeric',timeZone:'Asia/Manila'}).format(d)};
 const badge=(value,type)=>'<span class="status '+esc(type)+'">'+esc(value)+'</span>';
 const opened=(set,key)=>set.has(String(key));
 async function api(path,options={}){
  const response=await fetch('/api/supply/office/'+path,{credentials:'same-origin',cache:'no-store',
   ...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok){const error=new Error(payload.error||'Request failed ('+response.status+').');error.status=response.status;throw error;}
  return payload;
 }
 function error(id,message){const el=$(id);el.textContent=message||'';el.classList.toggle('hidden',!message)}
 function showApp(username){officeName=username||'Main Office';$('officeUserLabel').textContent=officeName;
  $('platformLogin').classList.add('hidden');$('platformApp').classList.remove('hidden')}
 function showLogin(message=''){$('platformLogin').classList.remove('hidden');$('platformApp').classList.add('hidden');
  error('platformLoginError',message);}
 async function checkSession(){
  try{
   const user=await api('me');
   if(user.mustChangePassword){showLogin('Change the temporary Main Office password in Supply Chain before using account management.');return;}
   showApp(user.username);await reload();
  }catch(err){showLogin(err.status===401?'':err.message)}
 }
 $('platformLoginForm').addEventListener('submit',async event=>{
  event.preventDefault();const button=$('platformLoginButton');button.disabled=true;
  error('platformLoginError','');
  try{
   const result=await api('login',{method:'POST',body:JSON.stringify({
    username:$('platformUsername').value.trim(),password:$('platformPassword').value})});
   $('platformPassword').value='';
   if(result.mustChangePassword)throw new Error('Please change the temporary password in Supply Chain first.');
   showApp($('platformUsername').value.trim());await reload();
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
   render();
  }catch(err){
   error('tableMessage',err.message);
   if(err.status===401)showLogin('Please sign in again.');
  }finally{button.disabled=false}
 }
 $('refreshAccounts').addEventListener('click',reload);
 const findOwner=ws=>accounts.find(x=>x.workspaceId===Number(ws));
 const findUser=(owner,uid)=>[...owner.branches.flatMap(b=>b.users||[]),...owner.unassigned].find(u=>u.id===Number(uid));
 const allText=a=>[a.ownerUsername,a.ownerFullName,a.ownerEmail,...a.branches.flatMap(b=>[b.name,...b.users.flatMap(u=>[u.username,u.fullName,u.email])]),...a.unassigned.flatMap(u=>[u.username,u.fullName,u.email])].join(' ').toLowerCase();
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
   blocks+='<div class="branch-row"><button class="expand" type="button" aria-expanded="'+open+'" data-toggle-branch="'+esc(key)+'">'+(open?'⌄':'›')+'</button>'+
    '<div class="branch-title"><strong>'+esc(b.name)+'</strong><small>'+esc([b.city,b.province].filter(Boolean).join(', ')||'Location not specified')+'</small></div>'+
    '<span class="branch-counter">'+number(b.users.length)+' users</span>'+badge(b.active?'Active':'Inactive',b.active?'active':'inactive')+'</div>';
   if(open)blocks+=renderStaff(b.users,owner);
  }
  if(owner.unassigned.length){
   const key=owner.workspaceId+':unassigned',open=opened(expandedBranches,key)||!!search;
   blocks+='<div class="branch-row"><button type="button" class="expand" aria-expanded="'+open+'" data-toggle-branch="'+key+'">'+(open?'⌄':'›')+'</button>'+
    '<div class="branch-title"><strong>Owner / Unassigned Users</strong><small>Administrators and staff without branch assignments</small></div>'+
    '<span class="branch-counter">'+number(owner.unassigned.length)+' users</span></div>';
   if(open)blocks+=renderStaff(owner.unassigned,owner);
  }
  if(!blocks)blocks='<p class="empty">No branches or users registered.</p>';
  return'<tr class="hierarchy-row"><td colspan="6"><div class="hierarchy"><div class="hierarchy-head">BRANCHES &amp; MEMBERS · '+number(owner.userCount)+' USERS</div>'+blocks+'</div></td></tr>';
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
    '" aria-expanded="'+open+'" aria-label="'+(open?'Collapse':'Expand')+' '+esc(owner.ownerUsername)+'">'+(open?'⌄':'›')+'</button>'+
    '<div class="owner-identity"><strong>'+esc(owner.ownerUsername)+'</strong><small>'+esc(owner.ownerFullName||'Account Owner')+'</small>'+
    '<div class="owner-controls"><button class="link-btn" type="button" data-subscribe="'+owner.workspaceId+'">Manage subscription</button>'+
    (owner.ownerId?'<button class="link-btn" type="button" data-edit-user="'+owner.workspaceId+':'+owner.ownerId+'">Edit owner</button>':'')+
    '</div></div></div></td>'+
    '<td><span class="num">'+number(owner.branchCount)+'</span></td>'+
    '<td>'+(sub?badge(sub.plan,sub.status==='PAID'?'active':'on-hold'):'<span class="status unknown">Not configured</span>')+'</td>'+
    '<td class="currency">'+peso(sub?.amount)+'</td><td>'+esc(date(owner.joinedAt))+'</td>'+
    '<td>'+badge(owner.active?'Active':'Inactive',owner.active?'active':'inactive')+'</td></tr>');
   if(open)rows.push(branchSection(owner));
  }
  $('ownersBody').innerHTML=rows.join('')||'<tr><td colspan="6" class="empty">No matching franchise accounts.</td></tr>';
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
  error('subscriptionError','');
  $('subscriptionDialog').showModal();
 }
 $('subscriptionForm').addEventListener('submit',async e=>{
  e.preventDefault();if(selected?.kind!=='subscription')return;
  const btn=$('saveSubscription');btn.disabled=true;error('subscriptionError','');
  try{
   await api('accounts/'+selected.owner.workspaceId+'/subscription',{method:'PUT',
    body:JSON.stringify({plan:$('subPlan').value,status:$('subStatus').value,amount:$('subAmount').value})});
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
 $('menuToggle').addEventListener('click',()=>$('platformApp').classList.toggle('nav-open'));
 document.querySelectorAll('.sidebar a').forEach(a=>a.addEventListener('click',()=>$('platformApp').classList.remove('nav-open')));
 checkSession();
})();
