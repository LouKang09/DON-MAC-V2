'use strict';
(()=>{
 const $=id=>document.getElementById(id);
 const esc=x=>String(x==null?'':x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const price=x=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(x)||0);
 let currentProducts=[];
 const qtyText=x=>Number(x||0).toLocaleString('en-PH',{maximumFractionDigits:6});
 function productCapacity(p){
   if(!p||!p.recipeConfigured||!Array.isArray(p.recipeStock)||!p.recipeStock.length)
     return{max:0,warning:'Recipe required: configure ingredients before selling this product.',low:false};
   const rows=p.recipeStock;
   const unavailable=rows.filter(x=>x.active===false||!(Number(x.required)>0)||
      Number(x.current)+1e-9<Number(x.required));
   if(unavailable.length){
     const notes=unavailable.map(x=>x.name+': '+qtyText(x.current)+' '+x.uom+
       ' on hand; need '+qtyText(x.required)+' '+x.uom+' per unit');
     return{max:0,warning:'OUT OF STOCK / INSUFFICIENT INGREDIENTS — '+notes.join(' · '),low:true};
   }
   const rawMax=Math.min(...rows.map(x=>Math.floor((Number(x.current)+1e-9)/Number(x.required))));
   const max=Math.max(0,Math.min(25,rawMax));
   const low=rows.some(x=>Number(x.current)<=Number(x.threshold)||Number(x.current)<2*Number(x.required));
   const warning=max===0?'OUT OF STOCK — insufficient ingredients.':
     low?'LOW INGREDIENT STOCK — at most '+max+' unit(s) available. '+
       rows.map(x=>x.name+': '+qtyText(x.current)+' '+x.uom).join(', '):
     'Available stock supports '+(rawMax>25?'at least ':'')+max+' unit(s)'+
       (rawMax>25?' (test checkout maximum 25)':'')+'.';
   return{max,warning,low};
 }
 function selectedProduct(){return currentProducts.find(x=>Number(x.id)===Number($('saleProduct').value))}
 function syncSaleCapacity(){
   const p=selectedProduct(),status=productCapacity(p);
   const qty=$('saleQuantity'),submit=$('saleForm').querySelector('button[type="submit"]');
   qty.disabled=status.max<1;
   qty.max=String(Math.max(1,status.max));
   let clamped=false;
   if(status.max>0&&Number(qty.value)>status.max){qty.value=String(status.max);clamped=true}
   submit.disabled=status.max<1||!Number.isInteger(Number(qty.value))||
     Number(qty.value)<1||Number(qty.value)>status.max;
   const banner=$('saleStockWarning');
   banner.textContent=(clamped?'Quantity limited to '+status.max+' because of available ingredients. ':'')+status.warning;
   banner.className='sale-stock-warning '+(status.max<1?'danger':status.low?'warning':'ready');
   $('saleProduct').title=status.warning;
   submit.title=submit.disabled?status.warning:'Simulation uses this branch inventory only';
   return{...status,allowed:!submit.disabled};
 }

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
   currentProducts=data.catalog.products||[];
   const selectOptions=(arr)=>arr.map(x=>'<option value="'+Number(x.id)+'">'+esc(x.name)+'</option>').join('');
   const productOptions=currentProducts.map(x=>{
     const capacity=productCapacity(x),label=capacity.max<1?' · OUT OF STOCK':
       capacity.low?' · LOW STOCK ('+capacity.max+' left)':' · up to '+capacity.max;
     return'<option value="'+Number(x.id)+'">'+esc(x.name+label)+'</option>';
   }).join('');
   const oldStock=$('stockIngredient').value,oldSale=$('saleProduct').value,oldPrice=$('priceProduct').value;
   $('stockIngredient').innerHTML=selectOptions(data.inventory||[]);
   $('saleProduct').innerHTML=productOptions;
   $('priceProduct').innerHTML=selectOptions(data.catalog.products||[]);
   if(oldStock)$('stockIngredient').value=oldStock;
   if(oldSale)$('saleProduct').value=oldSale;
   if(oldPrice)$('priceProduct').value=oldPrice;
   syncSaleCapacity();
   const report=data.report||{count:0,revenue:0,recent:[]};
   $('testSaleCount').textContent=report.count+' simulated sales';
   $('testRevenue').textContent=price(report.revenue);
   $('testSales').innerHTML=(report.recent||[]).map(x=>
      '<tr><td>'+esc(x.product)+'</td><td>'+Number(x.quantity)+'</td><td>'+price(x.total)+'</td><td>'+esc(new Date(x.at).toLocaleString('en-PH'))+'</td></tr>'
   ).join('')||'<tr><td colspan="4">No test transactions.</td></tr>';
   $('message').textContent='Authenticated as '+me.user.username+'. Workspace '+data.workspaceId+' is isolated. All simulated sales are test-only.';
  }catch(e){$('message').textContent=e.message;if(e.status===401)location.replace('/');}
 }
 let stockRequestId=null;
 const newStockRequestId=()=>globalThis.crypto?.randomUUID?.();
 $('stockEntryType').addEventListener('change',()=>{
   stockRequestId=null;
   $('stockSourceLabel').value=$('stockEntryType').value==='INITIAL_STOCK'?'Opening Inventory':'External Supplier';
 });
 for(const id of ['stockIngredient','stockQuantity','stockSourceLabel']){
   $(id).addEventListener('change',()=>{stockRequestId=null});
 }
 const operation=async(form,endpoint,method,payload)=>{
   const submit=form.querySelector('button[type="submit"]');submit.disabled=true;
   $('operationMessage').textContent='Running isolated test operation…';
   try{
     const response=await api(endpoint,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
     $('operationMessage').textContent=response.message||
       (response.testOnly?'Test-only operation saved. No real payment was created.':'Stock updated in the isolated branch.');
     if(form.id==='stockForm')stockRequestId=null;
     await load();
   }catch(e){$('operationMessage').textContent='Not saved: '+e.message;if(e.status===409)await load();}
   finally{if(form.id==='saleForm')syncSaleCapacity();else submit.disabled=false}
 };
 $('stockForm').addEventListener('submit',e=>{
   e.preventDefault();
   stockRequestId=stockRequestId||newStockRequestId();
   if(!stockRequestId){$('operationMessage').textContent='Secure stock request ID unavailable. Refresh and retry.';return;}
   operation(e.currentTarget,'/api/phase2-test/stock','POST',{
     ingredientId:Number($('stockIngredient').value),quantity:Number($('stockQuantity').value),
     clientRequestId:stockRequestId,entryType:$('stockEntryType').value,
     sourceLabel:$('stockSourceLabel').value.trim()});
 });
 $('saleProduct').addEventListener('change',syncSaleCapacity);
 $('saleQuantity').addEventListener('input',syncSaleCapacity);
 $('saleForm').addEventListener('submit',e=>{
   e.preventDefault();
   const checked=syncSaleCapacity();
   if(!checked.allowed){$('operationMessage').textContent=checked.warning;return;}
   operation(e.currentTarget,'/api/phase2-test/sale','POST',{
     productId:Number($('saleProduct').value),quantity:Number($('saleQuantity').value)});
 });
 $('priceForm').addEventListener('submit',e=>{
   e.preventDefault();operation(e.currentTarget,'/api/phase2-test/products/'+encodeURIComponent($('priceProduct').value)+'/price','PUT',{
     price:$('priceAmount').value});
 });
 $('refresh').addEventListener('click',load);
 window.addEventListener('focus',()=>{if(!document.hidden)load().catch(()=>{});});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)load().catch(()=>{});});
 $('logout').addEventListener('click',async()=>{try{await api('/api/auth/logout',{method:'POST'})}catch(_){}location.replace('/');});
 $('checkLegacy').addEventListener('click',async()=>{
  try{await api('/api/catalog');$('accessCheck').textContent='Unexpected: global catalog endpoint is reachable. Do not use this test account.';$('accessCheck').className='bad'}
  catch(e){$('accessCheck').textContent=e.status===403?'PASS · shared catalog blocked (403)':'Unexpected response: '+e.status+' · '+e.message;$('accessCheck').className=e.status===403?'good':'bad'}
 });
 load();
})();