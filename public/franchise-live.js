'use strict';
(()=>{
 const $=id=>document.getElementById(id);
 const escape=x=>String(x==null?'':x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=x=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(x)||0);
 const qty=x=>Number(x||0).toLocaleString('en-PH',{maximumFractionDigits:6});
 const stock=window.donmacPosStock;
 const state={me:null,branchId:null,catalog:null,inventory:[],manage:null,cart:[],
   quote:null,quoteSeq:0,checkoutId:null,stockId:null,salesPage:1,salesTotal:0,view:'overview'};
 let loadingCatalog=false,quoteTimer=0,refreshLock=false;
 function notice(message,error=false){const n=$('notice');n.textContent=message||'';n.classList.toggle('error',error)}
 async function api(path,options={}){
  const r=await fetch(path,{credentials:'same-origin',cache:'no-store',
   headers:{...(options.body?{'Content-Type':'application/json'}:{})},...options});
  const data=await r.json().catch(()=>({}));
  if(!r.ok){const e=new Error(data.error||'Request failed');e.status=r.status;e.details=data.details;throw e}
  return data;
 }
 const get=(path)=>api('/api/live/'+path);
 const post=(path,data)=>api('/api/live/'+path,{method:'POST',body:JSON.stringify(data)});
 const put=(path,data)=>api('/api/live/'+path,{method:'PUT',body:JSON.stringify(data)});
 const selection=()=>'?branchId='+encodeURIComponent(state.branchId);
 const isOwner=()=>state.me?.role==='Admin';
 function selectView(view){
  if((!isOwner()&&['catalog','inventory','reports','expenses','team'].includes(view))||
    (isOwner()&&view==='pos'))return;
  state.view=view;
  document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x.id==='view-'+view));
  document.querySelectorAll('.nav-btn').forEach(x=>x.classList.toggle('selected',x.dataset.view===view));
  $('activeSection').textContent=({overview:'Overview',pos:'Point of Sale',transactions:'Transactions',
   inventory:'Inventory',catalog:'Catalog & Recipes',reports:'Reports',
   expenses:'Expenses',team:'Cashiers & Access'})[view]||'Franchise';
  document.querySelector('.live-app').classList.remove('menu-open');
  if(view==='pos')renderPos();
  if(view==='inventory')renderInventory();
  if(view==='catalog')loadManage().catch(e=>notice(e.message,true));
  if(view==='transactions')loadSales().catch(e=>notice(e.message,true));
  if(view==='reports')loadReports().catch(e=>notice(e.message,true));
  if(view==='expenses')loadExpenses().catch(e=>notice(e.message,true));
  if(view==='team')loadCashiers().catch(e=>notice(e.message,true));
 }
 function product(kind,id){
  const name=kind==='product'?'products':kind==='package'?'packages':'addOns';
  return(state.catalog?.[name]||[]).find(x=>Number(x.id)===Number(id));
 }
 function next(kind,id){return stock.next(state.catalog,state.cart,kind,id)}
 function totals(){return state.cart.reduce((sum,x)=>sum+Number(product(x.kind,x.id)?.price||0)*x.qty,0)}
 function categoryOptions(){
  const cats=[...new Set((state.catalog?.products||[]).map(x=>x.category))].sort();
  const previous=$('productCategory').value;
  $('productCategory').innerHTML='<option value="">All products</option>'+
   cats.map(x=>'<option value="'+escape(x)+'">'+escape(x)+'</option>').join('')+
   '<option value="@packages">Packages</option><option value="@addons">Add-ons</option>';
  if([...cats,'@packages','@addons'].includes(previous))$('productCategory').value=previous;
 }
 function renderProducts(){
  if(!state.catalog)return;
  const category=$('productCategory').value,search=$('productSearch').value.toLowerCase().trim();
  const choices=[];
  if(category!=='@packages'&&category!=='@addons')
    choices.push(...(state.catalog.products||[]).filter(x=>
      (!category||x.category===category)).map(x=>({...x,kind:'product'})));
  if(category===''||category==='@packages')
    choices.push(...(state.catalog.packages||[]).map(x=>({...x,kind:'package',category:'Package'})));
  if(category==='@addons')
    choices.push(...(state.catalog.addOns||[]).map(x=>({...x,kind:'addon',category:'Add-on'})));
  const filtered=choices.filter(x=>!search||x.name.toLowerCase().includes(search));
  $('productGrid').innerHTML=filtered.map(x=>{
   const decision=x.kind==='addon'?{ok:!!$('promoSelect').value,message:'Add-ons need an active POS promotion.',low:[]}:
     stock.lowFor(state.catalog,state.cart,x.kind,x.id);
   const available=x.kind==='addon'?!!$('promoSelect').value:x.available&&decision.ok;
   const low=!!(decision.low?.length||x.stockWarnings?.length);
   const label=x.kind!=='addon'&&!x.available?'UNAVAILABLE · '+(x.availabilityMessage||'Recipe required'):
     !decision.ok?'OUT OF STOCK · '+(decision.message||'Insufficient ingredients'):
     low?'LOW INGREDIENT STOCK':'Available';
   const warning=!available?'soldout':low?'low':'';
   return'<button type="button" class="product-tile '+warning+'" data-add-kind="'+x.kind+
     '" data-add-id="'+Number(x.id)+'" '+(available?'':'disabled')+
     ' title="'+escape((x.availabilityMessage||'')+'\n'+(decision.message||''))+'">'+
     '<small class="category">'+escape(x.category||'Product')+'</small>'+
     '<h3>'+escape(x.name)+'</h3><span class="tile-state">'+escape(label)+'</span>'+
     '<strong class="price">'+money(x.price)+'</strong></button>';
  }).join('')||'<p class="empty">No products match this search.</p>';
 }
 function renderCart(){
  $('cartRows').innerHTML=state.cart.map(x=>{
   const p=product(x.kind,x.id);
   if(!p)return'';
   const check=x.kind==='addon'?{ok:!!$('promoSelect').value,message:'POS promotion required'}:next(x.kind,x.id);
   const limit=!check.ok;
   return'<div class="cart-row"><div><h4>'+escape(p.name)+'</h4><small>'+
     money(p.price)+' each · '+escape(x.kind)+'</small></div><div class="qty">'+
     '<button type="button" data-cart-minus="'+escape(x.kind+':'+x.id)+'">−</button>'+
     '<strong>'+x.qty+'</strong><button type="button" data-cart-plus="'+escape(x.kind+':'+x.id)+
     '" '+(limit?'disabled':'')+' title="'+escape(limit?check.message:'Add one')+'">+</button></div></div>';
  }).join('')||'<p class="empty">Choose a product to start a sale.</p>';
  $('grossTotal').textContent=money(totals());
 }
 function currentInput(){return{
  branchId:state.branchId,items:state.cart.map(x=>({kind:x.kind,id:x.id,qty:x.qty})),
  promoId:$('promoSelect').value?Number($('promoSelect').value):null,
  senior:$('seniorEnabled').checked?{enabled:true,name:$('seniorName').value,id:$('seniorId').value}:null
 }}
 function scheduleQuote(){
  clearTimeout(quoteTimer);
  state.quote=null;
  $('checkoutButton').disabled=true;
  if(!state.cart.length){$('amountDue').textContent=money(0);$('discountTotal').textContent=money(0);$('stockMessage').textContent='';return}
  const decision=stock.evaluate(state.catalog,state.cart);
  if(!decision.ok){$('stockMessage').textContent=decision.message; $('stockMessage').classList.add('error');return}
  if($('seniorEnabled').checked&&(!$('seniorName').value.trim()||!$('seniorId').value.trim())){
   $('stockMessage').textContent='Enter the Senior Citizen name and number to calculate the discount.';return}
  const seq=++state.quoteSeq;
  quoteTimer=setTimeout(async()=>{
   try{
    const q=await post('quote',currentInput());
    if(seq!==state.quoteSeq)return;
    state.quote=q;
    $('amountDue').textContent=money(q.actual);
    $('discountTotal').textContent=money(q.adjustment);
    $('stockMessage').textContent=decision.message||'Ingredient availability verified.';
    $('stockMessage').classList.remove('error');
    updatePaymentUI();
   }catch(e){
    if(seq!==state.quoteSeq)return;
    $('stockMessage').textContent=e.message;
    $('stockMessage').classList.add('error');
    $('checkoutButton').disabled=true;
    state.quote=null;
   }
  },220);
 }
 function updatePaymentUI(){
  const cash=$('paymentMode').value==='Cash';
  $('tenderField').classList.toggle('hidden',!cash);
  $('referenceField').classList.toggle('hidden',cash);
  $('changeTotal').textContent=money(cash&&state.quote?
    Math.max(0,Number($('cashTender').value||0)-state.quote.actual):0);
  const tender=Number($('cashTender').value);
  const valid=!!state.quote&&(cash?
    Number.isFinite(tender)&&tender>=state.quote.actual:
    !!$('paymentReference').value.trim());
  $('checkoutButton').disabled=!valid;
  $('checkoutButton').textContent=state.quote?
    'Complete checkout · '+money(state.quote.actual):'Checkout unavailable';
 }
 function renderPos(){if(!state.catalog)return;categoryOptions();promoOptions();renderProducts();renderCart();scheduleQuote()}
 function promoOptions(){
  const selected=$('promoSelect').value;
  $('promoSelect').innerHTML='<option value="">No POS promo</option>'+
   (state.catalog?.promos||[]).map(x=>'<option value="'+Number(x.id)+'">'+escape(x.name)+'</option>').join('');
  if((state.catalog?.promos||[]).some(x=>String(x.id)===selected))$('promoSelect').value=selected;
 }
 function changedCart(){
  state.checkoutId=null;renderProducts();renderCart();scheduleQuote();
 }
 function addItem(kind,id){
  const p=product(kind,id);
  if(!p)return;
  if(kind==='addon'&&!$('promoSelect').value){notice('Choose a POS promotion before adding an upgrade.',true);return}
  const check=next(kind,id);
  if(!check.ok){notice(check.message||'Ingredient stock is insufficient.',true);return}
  const line=state.cart.find(x=>x.kind===kind&&x.id===id);
  if(line)line.qty++;
  else state.cart.push({kind,id,qty:1});
  changedCart();
 }
 async function fetchCatalog(){
  if(loadingCatalog)return;
  loadingCatalog=true;
  try{
   const c=await get('catalog'+selection());
   if(Number(c.branchId)!==state.branchId)return;
   state.catalog=c;categoryOptions();renderProducts();renderCart();
   if(state.view==='pos')scheduleQuote();
  }finally{loadingCatalog=false}
 }
 async function fetchInventory(){
  const data=await get('inventory'+selection());
  if(Number(data.branchId)!==state.branchId)return;
  state.inventory=data.items||[];
  renderInventory();
 }
 function renderInventory(){
  $('inventoryBody').innerHTML=state.inventory.map(x=>{
   const low=x.stock<=x.lowStockThreshold;
   return'<tr><td><strong>'+escape(x.name)+'</strong><br><small>'+escape(x.code)+'</small></td>'+
    '<td>'+qty(x.stock)+' '+escape(x.uom)+'</td><td>'+qty(x.lowStockThreshold)+'</td>'+
    '<td><span class="pill '+(x.stock<=0?'danger':low?'low':'')+'">'+
    (x.stock<=0?'Out of stock':low?'Low':'In stock')+'</span></td></tr>';
  }).join('')||'<tr><td colspan="4">No branch ingredients.</td></tr>';
  const previous=$('stockIngredient').value;
  $('stockIngredient').innerHTML=state.inventory.filter(x=>x.active).map(x=>
    '<option value="'+x.id+'">'+escape(x.name)+' ('+qty(x.stock)+' '+escape(x.uom)+')</option>').join('');
  if(state.inventory.some(x=>String(x.id)===previous))$('stockIngredient').value=previous;
 }
 async function loadSales(){
  const data=await get('transactions'+selection()+'&page='+state.salesPage);
  state.salesTotal=data.total;
  $('salesBody').innerHTML=(data.rows||[]).map(x=>
   '<tr><td><strong>'+escape(x.reference)+'</strong></td><td>'+escape(new Date(x.date).toLocaleString('en-PH'))+'</td>'+
   '<td>'+escape(x.cashier)+'</td><td>'+escape(x.paymentMode)+'</td><td>'+money(x.actual)+'</td>'+
   '<td><span class="pill '+(x.status!=='Sold'?'danger':'')+'">'+escape(x.status)+'</span></td>'+
   '<td><button class="ghost" data-receipt="'+escape(x.reference)+'">View</button></td></tr>'
  ).join('')||'<tr><td colspan="7">No live transactions for this branch.</td></tr>';
  $('salesPageLabel').textContent='Page '+state.salesPage+' · '+data.total+' records';
  $('salesPrev').disabled=state.salesPage<=1;
  $('salesNext').disabled=state.salesPage*20>=data.total;
  $('statOrders').textContent=data.total;
  $('statRevenue').textContent=money(data.revenue);
 }
 async function receipt(reference){
  const data=await get('transactions/'+encodeURIComponent(reference)+selection());
  $('receiptContent').innerHTML='<div class="receipt-meta">Receipt: <strong>'+escape(data.reference)+
   '</strong><br>Cashier: '+escape(data.cashier)+'<br>Time: '+escape(new Date(data.soldAt).toLocaleString('en-PH'))+
   '<br>Payment: '+escape(data.paymentMode)+(data.paymentReference?' · '+escape(data.paymentReference):'')+
   '<br>Status: '+escape(data.status)+'</div>'+
   '<div class="receipt-lines">'+data.items.map(x=>'<div><span>'+escape(x.name)+' × '+x.qty+
    '</span><strong>'+money(x.total)+'</strong></div>').join('')+'</div>'+
   '<p class="receipt-total">'+money(data.actual)+'</p>'+
   (isOwner()&&data.status==='Sold'?'<div class="form-actions"><button type="button" class="ghost" data-void="'+escape(data.reference)+'">Void receipt</button></div>':'');
  $('receiptDialog').showModal();
 }
 async function loadManage(){
  const data=await get('manage'+selection());
  state.manage=data;
  $('manageProductsBody').innerHTML=data.products.map(x=>
   '<tr><td><strong>'+escape(x.name)+'</strong><br><small>'+escape(x.category)+'</small></td>'+
   '<td>'+money(x.price)+'</td><td>'+escape(x.active?'Active':'Inactive')+'</td><td>'+
   '<button class="ghost" data-edit-product="'+x.id+'">Edit</button> '+
   '<button class="ghost" data-recipe-product="'+x.id+'">Recipe</button></td></tr>'
  ).join('')||'<tr><td colspan="4">No products.</td></tr>';
  $('manageIngredientsBody').innerHTML=data.ingredients.map(x=>
   '<tr><td><strong>'+escape(x.name)+'</strong><br><small>'+escape(x.uom)+'</small></td>'+
   '<td>'+qty(x.stock)+'</td><td>'+money(x.unitCost)+'</td><td>'+
   '<button class="ghost" data-edit-ingredient="'+x.id+'">Edit</button></td></tr>'
  ).join('')||'<tr><td colspan="4">No ingredients.</td></tr>';
 }
 function clearProduct(){
  $('productForm').reset();$('productEditId').value='';$('productFormTitle').textContent='Add product';
 }
 function clearIngredient(){
  $('ingredientForm').reset();$('ingredientEditId').value='';$('ingredientLow').value='0';
  $('ingredientCost').value='0';$('ingredientFormTitle').textContent='Add ingredient';
 }
 async function loadRecipe(pid){
  const data=await get('recipes/'+pid+selection());
  $('recipeProductId').value=String(pid);
  $('recipeTitle').textContent='Recipe & costing · '+data.product.name;
  $('recipeRows').innerHTML='';
  for(const row of data.items)addRecipeLine(row);
  $('saveRecipe').disabled=false;
 }
 function addRecipeLine(item=null){
  if(!$('recipeProductId').value){notice('Select a product recipe first.',true);return}
  const div=document.createElement('div');div.className='recipe-line';
  div.innerHTML='<select class="recipe-ingredient">'+(state.manage?.ingredients||[]).filter(x=>x.active).map(x=>
   '<option value="'+x.id+'">'+escape(x.name)+' · '+escape(x.uom)+'</option>').join('')+'</select>'+
   '<input class="recipe-quantity" type="number" min=".000001" step=".000001" title="Ingredient amount per product" value="'+Number(item?.quantity||1)+'">'+
   '<input class="recipe-cost" type="number" min="0" step=".0001" title="Unit costing contribution" placeholder="Cost" value="'+(item?.cost??'')+'">'+
   '<button type="button" class="recipe-remove" aria-label="Remove ingredient">×</button>';
  $('recipeRows').append(div);
  if(item)div.querySelector('.recipe-ingredient').value=String(item.ingredientId);
 }
 async function loadReports(){
  const report=await get('report'+selection()+'&range='+encodeURIComponent($('reportRange').value));
  $('reportCount').textContent=report.transactionCount;
  $('reportSales').textContent=money(report.actual);
  $('reportExpenses').textContent=money(report.expenses);
  $('reportNet').textContent=money(report.netAfterExpenses);
  $('reportPayments').innerHTML=(report.payments||[]).map(x=>
   '<tr><td>'+escape(x.mode)+'</td><td>'+x.count+'</td><td>'+money(x.amount)+'</td></tr>').join('')||
   '<tr><td colspan="3">No payments in this period.</td></tr>';
  $('reportProducts').innerHTML=(report.products||[]).map(x=>
   '<tr><td>'+escape(x.name)+'</td><td>'+x.qty+'</td><td>'+money(x.gross)+'</td><td>'+money(x.costing)+'</td></tr>').join('')||
   '<tr><td colspan="4">No products sold in this period.</td></tr>';
 }
 async function loadExpenses(){
  const data=await get('expenses'+selection());
  $('expensesBody').innerHTML=(data.rows||[]).map(x=>
    '<tr><td>'+escape(new Date(x.incurredAt).toLocaleString('en-PH'))+'</td><td>'+
    escape(x.category)+'</td><td>'+escape(x.notes||'')+'</td><td>'+money(x.amount)+'</td></tr>'
  ).join('')||'<tr><td colspan="4">No branch expenses.</td></tr>';
 }
 async function loadCashiers(){
  const data=await get('cashiers');
  $('cashiersBody').innerHTML=(data.cashiers||[]).map(x=>
   '<tr><td>'+escape(x.username)+'</td><td>'+escape(x.fullName)+'</td><td>'+
    escape(state.me.branches.find(b=>Number(b.id)===Number(x.branchId))?.name||String(x.branchId))+
    '</td><td>'+escape(x.active?'Active':'Inactive')+'</td></tr>'
  ).join('')||'<tr><td colspan="4">No cashiers registered.</td></tr>';
 }
 async function refreshAll(){
  if(refreshLock||!state.me)return;
  refreshLock=true;
  try{
   await Promise.all([fetchCatalog(),fetchInventory(),loadSales()]);
   $('statIngredients').textContent=state.inventory.length;
   $('statLow').textContent=state.inventory.filter(x=>x.stock<=x.lowStockThreshold).length;
   if(isOwner()&&state.view==='catalog')await loadManage();
  }catch(e){notice(e.message,true)}
  finally{refreshLock=false}
 }
 function wire(){
  document.querySelectorAll('[data-admin-only]').forEach(x=>x.classList.toggle('hidden',!isOwner()));
  document.querySelectorAll('[data-cashier-only]').forEach(x=>x.classList.toggle('hidden',isOwner()));
  $('liveNav').addEventListener('click',e=>{
   const b=e.target.closest('button[data-view]');if(b)selectView(b.dataset.view)});
  $('menuToggle').addEventListener('click',()=>document.querySelector('.live-app').classList.toggle('menu-open'));
  $('branchSelect').addEventListener('change',async()=>{
   state.branchId=Number($('branchSelect').value);
   state.cart=[];state.quote=null;state.checkoutId=null;state.salesPage=1;
   await refreshAll();selectView(state.view);
  });
  $('refreshAll').addEventListener('click',refreshAll);
  $('posRefresh').addEventListener('click',refreshAll);
  $('inventoryRefresh').addEventListener('click',refreshAll);
  $('catalogRefresh').addEventListener('click',async()=>{await refreshAll();await loadManage()});
  $('salesRefresh').addEventListener('click',loadSales);
  $('productSearch').addEventListener('input',renderProducts);
  $('productCategory').addEventListener('change',renderProducts);
  $('productGrid').addEventListener('click',e=>{
   const b=e.target.closest('button[data-add-id]');if(b&&!b.disabled)addItem(b.dataset.addKind,Number(b.dataset.addId));
  });
  $('cartRows').addEventListener('click',e=>{
   const plus=e.target.closest('[data-cart-plus]'),minus=e.target.closest('[data-cart-minus]');
   if(!plus&&!minus)return;
   const [kind,idText]=(plus?.dataset.cartPlus||minus.dataset.cartMinus).split(':'),id=Number(idText);
   const line=state.cart.find(x=>x.kind===kind&&x.id===id);
   if(!line)return;
   if(plus){const check=next(kind,id);if(!check.ok){notice(check.message,true);return}line.qty++}
   else{line.qty--;if(line.qty<=0)state.cart=state.cart.filter(x=>x!==line)}
   changedCart();
  });
  $('clearCart').addEventListener('click',()=>{state.cart=[];changedCart()});
  for(const id of ['promoSelect','seniorEnabled','seniorName','seniorId'])
   $(id).addEventListener('change',()=>{$('seniorDetails').classList.toggle('hidden',!$('seniorEnabled').checked);state.checkoutId=null;renderProducts();renderCart();scheduleQuote()});
  for(const id of ['seniorName','seniorId'])$(id).addEventListener('input',scheduleQuote);
  $('paymentMode').addEventListener('change',()=>{state.checkoutId=null;updatePaymentUI()});
  $('cashTender').addEventListener('input',updatePaymentUI);
  $('paymentReference').addEventListener('input',updatePaymentUI);
  $('checkoutButton').addEventListener('click',async()=>{
   if(!state.quote||$('checkoutButton').disabled)return;
   if(!state.checkoutId)state.checkoutId=crypto.randomUUID();
   const b=$('checkoutButton');b.disabled=true;b.textContent='Saving live transaction…';
   try{
    const sale=await post('checkout',{...currentInput(),clientRequestId:state.checkoutId,
     paymentMode:$('paymentMode').value,paymentReference:$('paymentReference').value.trim(),
     tender:Number($('cashTender').value||0),orderType:$('orderType').value,
     customerName:$('customerName').value.trim(),tableLabel:$('tableLabel').value.trim()});
    state.cart=[];state.checkoutId=null;state.quote=null;
    $('cashTender').value='';$('paymentReference').value='';
    notice('Live receipt '+sale.reference+' saved. Ingredient stock deducted only from this branch.');
    await refreshAll();renderPos();await receipt(sale.reference);
   }catch(e){
    notice(e.message,true);await refreshAll();renderPos();
   }finally{updatePaymentUI()}
  });
  $('salesBody').addEventListener('click',e=>{
   const b=e.target.closest('[data-receipt]');if(b)receipt(b.dataset.receipt).catch(err=>notice(err.message,true));
  });
  $('receiptClose').addEventListener('click',()=>$('receiptDialog').close());
  $('receiptContent').addEventListener('click',async e=>{
   const b=e.target.closest('[data-void]');if(!b)return;
   if(!confirm('Void this real receipt and restore its ingredient stock?'))return;
   try{await post('transactions/'+b.dataset.void+'/void',{restoreStock:true,branchId:state.branchId});
    $('receiptDialog').close();notice('Receipt voided and isolated stock restored.');
    await refreshAll();
   }catch(err){notice(err.message,true)}
  });
  $('salesPrev').addEventListener('click',()=>{state.salesPage=Math.max(1,state.salesPage-1);loadSales()});
  $('salesNext').addEventListener('click',()=>{state.salesPage++;loadSales()});
  $('reportRange').addEventListener('change',loadReports);
  $('stockType').addEventListener('change',()=>{
   state.stockId=null;
   $('stockSource').value=$('stockType').value==='INITIAL_STOCK'?'Opening Inventory':'Supplier';
  });
  for(const id of ['stockIngredient','stockQuantity','stockSource','stockNotes'])$(id).addEventListener('change',()=>{state.stockId=null});
  $('stockForm').addEventListener('submit',async e=>{
   e.preventDefault();const button=e.currentTarget.querySelector('button[type="submit"]');button.disabled=true;
   state.stockId=state.stockId||crypto.randomUUID();
   try{
    const data=await post('stock',{clientRequestId:state.stockId,entryType:$('stockType').value,
     receivingBranchId:state.branchId,items:[{ingredientId:Number($('stockIngredient').value),
      qty:Number($('stockQuantity').value)}],sourceLabel:$('stockSource').value,
     remarks:$('stockNotes').value.trim()});
    state.stockId=null;notice(data.message||'Branch stock saved.');
    await refreshAll();
   }catch(err){notice(err.message,true)}
   finally{button.disabled=false}
  });
  $('productForm').addEventListener('submit',async e=>{
   e.preventDefault();const identifier=Number($('productEditId').value||0);
   try{
    const data={branchId:state.branchId,name:$('productName').value.trim(),
     category:$('productCategoryEdit').value,price:Number($('productPrice').value),
     active:$('productActive').checked};
    const out=identifier?await put('products/'+identifier,data):await post('products',data);
    clearProduct();notice('Branch product saved.');
    await loadManage();await fetchCatalog();
    if(!identifier&&out.id)await loadRecipe(out.id);
   }catch(err){notice(err.message,true)}
  });
  $('ingredientForm').addEventListener('submit',async e=>{
   e.preventDefault();const identifier=Number($('ingredientEditId').value||0);
   try{
    const data={branchId:state.branchId,name:$('ingredientName').value.trim(),
     uom:$('ingredientUom').value.trim(),lowStockThreshold:Number($('ingredientLow').value),
     unitCost:Number($('ingredientCost').value),active:$('ingredientActive').checked};
    identifier?await put('ingredients/'+identifier,data):await post('ingredients',data);
    clearIngredient();notice('Branch ingredient saved.');
    await loadManage();await fetchInventory();await fetchCatalog();
   }catch(err){notice(err.message,true)}
  });
  $('clearProduct').addEventListener('click',clearProduct);
  $('clearIngredient').addEventListener('click',clearIngredient);
  $('manageProductsBody').addEventListener('click',async e=>{
   const edit=e.target.closest('[data-edit-product]'),recipe=e.target.closest('[data-recipe-product]');
   if(edit){
    const x=state.manage.products.find(x=>x.id===Number(edit.dataset.editProduct));if(!x)return;
    $('productFormTitle').textContent='Edit · '+x.name;
    $('productEditId').value=x.id;$('productName').value=x.name;$('productPrice').value=x.price;
    if(![...$('productCategoryEdit').options].some(o=>o.value===x.category))
      $('productCategoryEdit').add(new Option(x.category,x.category));
    $('productCategoryEdit').value=x.category;$('productActive').checked=x.active;
    $('productForm').scrollIntoView({behavior:'smooth',block:'center'});
   }
   if(recipe)try{await loadRecipe(Number(recipe.dataset.recipeProduct));
     $('recipeTitle').scrollIntoView({behavior:'smooth',block:'center'});
   }catch(err){notice(err.message,true)}
  });
  $('manageIngredientsBody').addEventListener('click',e=>{
   const b=e.target.closest('[data-edit-ingredient]');if(!b)return;
   const x=state.manage.ingredients.find(x=>x.id===Number(b.dataset.editIngredient));if(!x)return;
   $('ingredientFormTitle').textContent='Edit · '+x.name;
   $('ingredientEditId').value=x.id;$('ingredientName').value=x.name;
   $('ingredientUom').value=x.uom;$('ingredientLow').value=x.lowStockThreshold;
   $('ingredientCost').value=x.unitCost;$('ingredientActive').checked=x.active;
   $('ingredientForm').scrollIntoView({behavior:'smooth',block:'center'});
  });
  $('addRecipeRow').addEventListener('click',()=>addRecipeLine());
  $('recipeRows').addEventListener('click',e=>{
   const b=e.target.closest('.recipe-remove');if(b)b.closest('.recipe-line').remove();
  });
  $('saveRecipe').addEventListener('click',async()=>{
   const pid=Number($('recipeProductId').value);if(!pid)return;
   const rows=[...$('recipeRows').querySelectorAll('.recipe-line')].map(el=>({
    ingredientId:Number(el.querySelector('.recipe-ingredient').value),
    quantity:Number(el.querySelector('.recipe-quantity').value),
    cost:el.querySelector('.recipe-cost').value||null}));
   try{await put('recipes/'+pid,{branchId:state.branchId,items:rows});
    notice('Recipe saved to this branch. Product availability updated.');
    await fetchCatalog();await loadManage();
   }catch(err){notice(err.message,true)}
  });
  $('expenseForm').addEventListener('submit',async e=>{
   e.preventDefault();
   try{await post('expenses',{branchId:state.branchId,category:$('expenseCategory').value.trim(),
    amount:Number($('expenseAmount').value),notes:$('expenseNotes').value.trim()});
    e.currentTarget.reset();await loadExpenses();notice('Branch expense recorded.');
   }catch(err){notice(err.message,true)}
  });
  $('cashierForm').addEventListener('submit',async e=>{
   e.preventDefault();
   try{const result=await post('cashiers',{username:$('cashierUsername').value.trim(),
    fullName:$('cashierName').value.trim(),password:$('cashierPassword').value,
    branchId:Number($('cashierBranch').value)});
    $('cashierForm').reset();notice('Cashier '+result.username+' created. They can sign in with their password.');
    await loadCashiers();
   }catch(err){notice(err.message,true)}
  });
  $('logout').addEventListener('click',async()=>{
   try{await api('/api/auth/logout',{method:'POST'})}catch(_){}
   location.replace('/');
  });
  window.addEventListener('focus',()=>{if(!document.hidden)refreshAll()});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshAll()});
  setInterval(()=>{if(!document.hidden)refreshAll()},15000);
 }
 async function boot(){
  try{
   const me=await api('/api/auth/me');
   if(!me.user?.liveMode){location.replace('/');return}
   const info=await get('status');
   state.me=info;state.branchId=info.branchId;
   $('sidebarWorkspace').textContent='Workspace #'+info.workspaceId;
   $('planTag').textContent=info.plan||'Approved franchise';
   $('userChip').textContent=info.username+' · '+info.role;
   $('branchSelect').innerHTML=info.branches.map(x=>
     '<option value="'+x.id+'">'+escape(x.name)+'</option>').join('');
   $('branchSelect').value=String(state.branchId);
   $('branchSelect').disabled=!isOwner()||info.branches.length<=1;
   $('cashierBranch').innerHTML=info.branches.map(x=>
     '<option value="'+x.id+'">'+escape(x.name)+'</option>').join('');
   $('overviewRoleNote').textContent=isOwner()?
     'You can manage the branch catalog, ingredients, finance and cashier accounts. Only cashiers may process sales.':
     'Cashier access: real checkout, transaction history and branch stock availability.';
   wire();await refreshAll();
   selectView(isOwner()?'overview':'pos');
   notice('Connected to '+info.branchName+' · independent production franchise workspace.');
  }catch(err){notice('Unable to load your live franchise POS: '+err.message,true)}
 }
 boot();
})();