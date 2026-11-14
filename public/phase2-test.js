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
   const selectOptions=(arr)=>arr.map(x=>'<option value="'+Number(x.id)+'">'+esc(x.name)+'</option>').join('');
   const oldStock=$('stockIngredient').value,oldSale=$('saleProduct').value,oldPrice=$('priceProduct').value;
   $('stockIngredient').innerHTML=selectOptions(data.inventory||[]);
   $('saleProduct').innerHTML=selectOptions(data.catalog.products||[]);
   $('priceProduct').innerHTML=selectOptions(data.catalog.products||[]);
   if(oldStock)$('stockIngredient').value=oldStock;
   if(oldSale)$('saleProduct').value=oldSale;
   if(oldPrice)$('priceProduct').value=oldPrice;
   const report=data.report||{count:0,revenue:0,recent:[]};
   $('testSaleCount').textContent=report.count+' simulated sales';
   $('testRevenue').textContent=price(report.revenue);
   $('testSales').innerHTML=(report.recent||[]).map(x=>
      '<tr><td>'+esc(x.product)+'</td><td>'+Number(x.quantity)+'</td><td>'+price(x.total)+'</td><td>'+esc(new Date(x.at).toLocaleString('en-PH'))+'</td></tr>'
   ).join('')||'<tr><td colspan="4">No test transactions.</td></tr>';
   $('message').textContent='Authenticated as '+me.user.username+'. Workspace '+data.workspaceId+' is isolated. All simulated sales are test-only.';
  }catch(e){$('message').textContent=e.message;if(e.status===401)location.replace('/');}
 }
 const operation=async(form,endpoint,method,payload)=>{
   const submit=form.querySelector('button[type="submit"]');submit.disabled=true;
   $('operationMessage').textContent='Running isolated test operation…';
   try{
     const response=await api(endpoint,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
     $('operationMessage').textContent=response.testOnly?'Test-only operation saved. No real sale or payment was created.':'Test stock updated in the isolated branch.';
     await load();
   }catch(e){$('operationMessage').textContent='Not saved: '+e.message}
   finally{submit.disabled=false}
 };
 $('stockForm').addEventListener('submit',e=>{
   e.preventDefault();operation(e.currentTarget,'/api/phase2-test/stock','POST',{
     ingredientId:Number($('stockIngredient').value),quantity:Number($('stockQuantity').value)});
 });
 $('saleForm').addEventListener('submit',e=>{
   e.preventDefault();operation(e.currentTarget,'/api/phase2-test/sale','POST',{
     productId:Number($('saleProduct').value),quantity:Number($('saleQuantity').value)});
 });
 $('priceForm').addEventListener('submit',e=>{
   e.preventDefault();operation(e.currentTarget,'/api/phase2-test/products/'+encodeURIComponent($('priceProduct').value)+'/price','PUT',{
     price:$('priceAmount').value});
 });
 $('refresh').addEventListener('click',load);
 $('logout').addEventListener('click',async()=>{try{await api('/api/auth/logout',{method:'POST'})}catch(_){}location.replace('/');});
 $('checkLegacy').addEventListener('click',async()=>{
  try{await api('/api/catalog');$('accessCheck').textContent='Unexpected: global catalog endpoint is reachable. Do not use this test account.';$('accessCheck').className='bad'}
  catch(e){$('accessCheck').textContent=e.status===403?'PASS · shared catalog blocked (403)':'Unexpected response: '+e.status+' · '+e.message;$('accessCheck').className=e.status===403?'good':'bad'}
 });
 load();
})();