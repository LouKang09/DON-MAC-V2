'use strict';
(()=>{
 const $=id=>document.getElementById(id);
 const esc=x=>String(x==null?'':x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const price=x=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(x)||0);
 async function api(path,options){
  const r=await fetch(path,{credentials:'same-origin',cache:'no-store',...(options||{})});
  const d=await r.json().catch(()=>({}));
  if(!r.ok){const e=new Error(d.error||'Request failed');e.status=r.status;throw e}
  return d;
 }
 async function load(){
  $('message').textContent='Checking the assigned test workspace…';
  try{
   const me=await api('/api/auth/me');
   if(!me.user?.testMode){location.replace('/');return;}
   const data=await api('/api/phase2-test/overview');
   $('ws').textContent='WS '+data.workspaceId;
   $('branch').textContent=data.branchName+' (#'+data.branchId+')';
   $('productCount').textContent=(data.catalog.products||[]).length;
   $('ingredientCount').textContent=(data.inventory||[]).length;
   const stock=(data.inventory||[]).reduce((v,x)=>v+Number(x.stock||0),0);
   $('stockCount').textContent=stock.toLocaleString('en-PH')+' (total units)';
   $('products').innerHTML=(data.catalog.products||[]).map(x=>'<tr><td>'+esc(x.name)+'</td><td>'+esc(x.category)+'</td><td>'+price(x.price)+'</td><td class="'+(x.available?'good':'bad')+'">'+esc(x.availabilityMessage)+'</td></tr>').join('')||'<tr><td colspan="4">No products staged.</td></tr>';
   $('ingredients').innerHTML=(data.inventory||[]).map(x=>'<tr><td>'+esc(x.name)+'</td><td>'+esc(x.uom)+'</td><td>'+Number(x.stock).toLocaleString('en-PH')+'</td></tr>').join('')||'<tr><td colspan="3">No ingredients staged.</td></tr>';
   $('message').textContent='Authenticated as '+me.user.username+'. Your test data belongs exclusively to workspace '+data.workspaceId+'. Checkout is intentionally restricted.';
  }catch(e){$('message').textContent=e.message;if(e.status===401)location.replace('/');}
 }
 $('refresh').addEventListener('click',load);
 $('logout').addEventListener('click',async()=>{try{await api('/api/auth/logout',{method:'POST'})}catch(_){}location.replace('/');});
 $('checkLegacy').addEventListener('click',async()=>{
  try{await api('/api/catalog');$('accessCheck').textContent='Unexpected: global catalog endpoint is reachable. Do not use this test account.';$('accessCheck').className='bad'}
  catch(e){$('accessCheck').textContent=e.status===403?'PASS · shared catalog blocked (403)':'Unexpected response: '+e.status+' · '+e.message;$('accessCheck').className=e.status===403?'good':'bad'}
 });
 load();
})();