(() => {
'use strict';
const $=id=>document.getElementById(id);
if(!$('officeCampaignForm'))return;
const esc=s=>String(s??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const money=n=>'₱'+Number(n||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
const fmt=t=>t?new Intl.DateTimeFormat('en-PH',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Manila'}).format(new Date(t)):'—';
async function api(path,options={}){
 const response=await fetch('/api/supply/office/'+path,{credentials:'same-origin',
  headers:{'content-type':'application/json'},...options,cache:'no-store'});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(data.error||'Main Office request failed.');
 return data;
}
let campaigns=[],supplies=[],loading=false,selectedIngredients=[];
function phTime(value){
 if(!value||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw Error('Choose valid Philippine local start and end times.');
 const parsed=new Date(value+':00+08:00');
 if(!Number.isFinite(parsed.getTime()))throw Error('Choose a valid Philippine date and time.');
 return parsed.toISOString();
}
async function compressIcon(file){
 if(!file)return '';
 if(!/^image\/(png|jpeg|webp)$/.test(file.type)||file.size>2*1024*1024)
  throw Error('Choose a PNG, JPEG or WebP icon up to 2 MB.');
 const url=URL.createObjectURL(file),img=new Image();
 try{
  await new Promise((resolve,reject)=>{
   img.onload=resolve;img.onerror=()=>reject(Error('Unable to read the promotion icon.'));img.src=url;
  });
  if(!img.naturalWidth||!img.naturalHeight||img.naturalWidth>8000||img.naturalHeight>8000)
   throw Error('The promotion icon dimensions are too large.');
  const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('This browser cannot prepare an icon.');
  const ratio=Math.min(128/img.naturalWidth,128/img.naturalHeight);
  const w=Math.round(img.naturalWidth*ratio),h=Math.round(img.naturalHeight*ratio);
  ctx.clearRect(0,0,128,128);ctx.drawImage(img,(128-w)/2,(128-h)/2,w,h);
  let result=canvas.toDataURL('image/webp',0.82);
  if(!/^data:image\/(webp|png|jpeg);base64,/.test(result)||result.length>85000){
   canvas.width=96;canvas.height=96;
   const small=canvas.getContext('2d'),r=Math.min(96/img.naturalWidth,96/img.naturalHeight);
   const sw=Math.round(img.naturalWidth*r),sh=Math.round(img.naturalHeight*r);
   small.drawImage(img,(96-sw)/2,(96-sh)/2,sw,sh);
   result=canvas.toDataURL('image/webp',0.70);
  }
  if(result.length>85000)throw Error('The icon is too detailed to fit. Try a simpler image.');
  return result;
 }finally{URL.revokeObjectURL(url);}
}
let iconPreviewRevision=0;
$('officeCampaignIcon').addEventListener('change',async()=>{
 const ticket=++iconPreviewRevision,file=$('officeCampaignIcon').files[0];
 const preview=$('officeCampaignIconPreview');
 if(!file){preview.classList.add('hidden');$('officeCampaignIconImage').removeAttribute('src');return;}
 try{
  const encoded=await compressIcon(file);if(ticket!==iconPreviewRevision)return;
  $('officeCampaignIconImage').src=encoded;preview.classList.remove('hidden');
  $('officeCampaignFeedback').textContent='';
 }catch(err){
  if(ticket!==iconPreviewRevision)return;
  $('officeCampaignIcon').value='';$('officeCampaignIconImage').removeAttribute('src');
  preview.classList.add('hidden');$('officeCampaignFeedback').textContent=err.message;
 }
});
$('officeCampaignClearIcon').addEventListener('click',()=>{
 ++iconPreviewRevision;$('officeCampaignIcon').value='';
 $('officeCampaignIconImage').removeAttribute('src');$('officeCampaignIconPreview').classList.add('hidden');
});
function timeRemaining(end){
 const left=Date.parse(end)-Date.now();
 if(left<=0)return'Ended';
 const sec=Math.ceil(left/1000),d=Math.floor(sec/86400),h=Math.floor(sec%86400/3600),m=Math.floor(sec%3600/60),s=sec%60;
 return (d?d+'d ':'')+[h,m,s].map(x=>String(x).padStart(2,'0')).join(':');
}
function currentStatus(c){
 if(!c.active)return'INACTIVE';
 if(Date.now()<Date.parse(c.startsAt))return'UPCOMING';
 if(Date.now()>=Date.parse(c.endsAt))return'ENDED';
 return'LIVE';
}
const quantity=value=>{
 const n=Number(value);
 if(!Number.isSafeInteger(n)||n<1||n>10000)throw Error('Ingredient quantity must be a whole number between 1 and 10,000.');
 return n;
};
function ingredientDescription(){
 const catalog=selectedIngredients.filter(x=>x.kind==='catalog');
 const custom=selectedIngredients.filter(x=>x.kind==='custom');
 const format=x=>x.name+' × '+x.qty+(x.uom?' '+x.uom:'');
 return [catalog.length?'Main Office supplies: '+catalog.map(format).join(', '):'',
  custom.length?'Additional ingredients (not stock-tracked): '+custom.map(format).join(', '):'']
 .filter(Boolean).join(' | ');
}
function renderSupplies(){
 const select=$('officeCampaignSupplySelect'),current=select.value;
 const available=supplies.filter(p=>p.active&&!selectedIngredients.some(x=>x.kind==='catalog'&&Number(x.id)===Number(p.id)));
 select.innerHTML='<option value="">'+(available.length?'Select a supply item':'No more available supply items')+'</option>'+
  available.map(p=>'<option value="'+Number(p.id)+'">'+esc(p.name)+' · '+esc(p.uom)+'</option>').join('');
 if(available.some(p=>String(p.id)===current))select.value=current;
 $('officeCampaignSupplies').innerHTML=selectedIngredients.length?selectedIngredients.map((x,i)=>
  '<div class="office-campaign-ingredient" role="listitem"><span class="office-campaign-ingredient-name">'+
  '<strong>'+esc(x.name)+'</strong><small>'+(x.kind==='catalog'?'Supply Catalog · '+esc(x.uom):'Typed ingredient'+(x.uom?' · '+esc(x.uom):''))+'</small></span>'+
  '<label class="office-campaign-line-quantity">Qty per sale<input type="number" data-ingredient-qty="'+i+'" min="1" max="10000" step="1" value="'+x.qty+'" aria-label="Quantity per sale for '+esc(x.name)+'"></label>'+
  '<button type="button" class="btn outline office-campaign-remove" data-ingredient-remove="'+i+'" aria-label="Remove '+esc(x.name)+'">Remove</button></div>'
 ).join(''):'<p class="muted">No ingredients selected yet.</p>';
 const summary=ingredientDescription();
 $('officeCampaignIngredientsSummary').textContent=summary||'Select or type the ingredients above.';
 $('officeCampaignIngredientsSummary').classList.toggle('office-campaign-overlimit',summary.length>900);
}
function ingredientFeedback(message){$('officeCampaignFeedback').textContent=message;}
$('officeCampaignAddSupply').addEventListener('click',()=>{
 try{
  const id=Number($('officeCampaignSupplySelect').value),p=supplies.find(x=>Number(x.id)===id&&x.active);
  if(!p)throw Error('Select a supply from the list.');
  if(selectedIngredients.filter(x=>x.kind==='catalog').length>=12)throw Error('You can select up to 12 catalog supplies.');
  if(selectedIngredients.some(x=>x.kind==='catalog'&&Number(x.id)===id))throw Error('This supply has already been added.');
  selectedIngredients.push({kind:'catalog',id:Number(p.id),name:String(p.name),uom:String(p.uom||''),qty:quantity($('officeCampaignSupplyQty').value)});
  $('officeCampaignSupplyQty').value='1';ingredientFeedback('');renderSupplies();
 }catch(err){ingredientFeedback(err.message);}
});
function addCustomIngredient(){
 try{
  const name=$('officeCampaignCustomName').value.trim().replace(/\s+/g,' ');
  const uom=$('officeCampaignCustomUnit').value.trim().replace(/\s+/g,' ');
  if(!name||name.length>80)throw Error('Enter a custom ingredient name (up to 80 characters).');
  if(uom.length>24)throw Error('Custom units must be 24 characters or fewer.');
  if(selectedIngredients.filter(x=>x.kind==='custom').length>=12)throw Error('You can add up to 12 custom ingredients.');
  if(selectedIngredients.some(x=>x.name.toLocaleLowerCase()===name.toLocaleLowerCase()))
   throw Error('This ingredient is already included.');
  if(supplies.some(p=>p.active&&String(p.name).toLocaleLowerCase()===name.toLocaleLowerCase()))
   throw Error('This ingredient is in the Supply Catalog. Please use the catalog picker.');
  selectedIngredients.push({kind:'custom',name,uom,qty:quantity($('officeCampaignCustomQty').value)});
  $('officeCampaignCustomName').value='';$('officeCampaignCustomUnit').value='';$('officeCampaignCustomQty').value='1';
  ingredientFeedback('');renderSupplies();
 }catch(err){ingredientFeedback(err.message);}
}
$('officeCampaignAddCustom').addEventListener('click',addCustomIngredient);
$('officeCampaignCustomName').addEventListener('keydown',event=>{
 if(event.key==='Enter'){event.preventDefault();addCustomIngredient();}
});
$('officeCampaignSupplies').addEventListener('click',event=>{
 const remove=event.target.closest('[data-ingredient-remove]');
 if(!remove)return;
 selectedIngredients.splice(Number(remove.dataset.ingredientRemove),1);
 ingredientFeedback('');renderSupplies();
});
$('officeCampaignSupplies').addEventListener('change',event=>{
 const field=event.target.closest('[data-ingredient-qty]');
 if(!field)return;
 const index=Number(field.dataset.ingredientQty);
 try{selectedIngredients[index].qty=quantity(field.value);ingredientFeedback('');renderSupplies();}
 catch(err){ingredientFeedback(err.message);field.value=selectedIngredients[index].qty;}
});
function renderCampaigns(){
 $('officeCampaignRows').innerHTML=campaigns.map(c=>{
  const status=currentStatus(c),period=fmt(c.startsAt)+' → '+fmt(c.endsAt);
  const supply=(c.requirements||[]).map(x=>esc(x.name)+' × '+x.unitsPerSale).join(' · ');
  return '<tr><td>'+(c.iconData?'<img class="office-campaign-row-icon" src="'+esc(c.iconData)+'" alt="" loading="lazy">':'')+'<strong>'+esc(c.title)+'</strong><small>'+esc(c.description)+'</small></td>'+
   '<td><strong>'+esc(c.buttonName)+'</strong><small>'+money(c.price)+' · '+supply+'</small></td>'+
   '<td><span class="office-campaign-status" data-campaign-status="'+c.id+'">'+status+'</span>'+
   '<small data-campaign-countdown="'+esc(c.endsAt)+'">'+(status==='UPCOMING'?'Scheduled':timeRemaining(c.endsAt))+'</small></td>'+
   '<td>'+esc(period)+'</td><td><button class="btn outline" data-campaign-participants="'+c.id+'">View franchisees</button></td>'+
   '<td>'+(c.active?'<button class="btn outline" data-campaign-deactivate="'+c.id+'">Deactivate</button>':'Deactivated')+'</td></tr>';
 }).join('')||'<tr><td colspan="6">No Main Office promotions yet.</td></tr>';
}
function renderTimers(){
 for(const c of campaigns){
  const status=$('officeCampaignRows').querySelector('[data-campaign-status="'+c.id+'"]');
  const count=$('officeCampaignRows').querySelector('[data-campaign-countdown="'+c.endsAt+'"]');
  if(status)status.textContent=currentStatus(c);
  if(count)count.textContent=currentStatus(c)==='UPCOMING'?'Starts in '+timeRemaining(c.startsAt):
   currentStatus(c)==='LIVE'?'Ends in '+timeRemaining(c.endsAt):currentStatus(c)==='ENDED'?'Ended':'Deactivated';
 }
}
async function load(){
 if(loading)return;loading=true;
 try{
  const [c,p]=await Promise.all([api('promotions'),api('catalog')]);
  campaigns=c.campaigns||[];supplies=p.products||[];
  selectedIngredients=selectedIngredients.map(item=>{
   const fresh=item.kind==='catalog'?supplies.find(p=>Number(p.id)===Number(item.id)&&p.active):null;
   return fresh?{...item,name:String(fresh.name),uom:String(fresh.uom||'')}:item;
  });
  renderCampaigns();renderSupplies();
 }catch(e){$('officeCampaignFeedback').textContent=e.message;}
 finally{loading=false;}
}
$('officeCampaignForm').addEventListener('submit',async e=>{
 e.preventDefault();const btn=$('officeCampaignCreate');if(btn.disabled)return;
 const requirements=selectedIngredients.filter(x=>x.kind==='catalog').map(x=>({productId:x.id,unitsPerSale:x.qty}));
 if(!requirements.length){ingredientFeedback('Select at least one Supply Catalog ingredient so franchise delivery eligibility can be verified. Typed items are descriptive only.');return;}
 const description=ingredientDescription();
 if(description.length>900){ingredientFeedback('The generated ingredient description is too long. Remove or shorten some ingredients.');return;}
 btn.disabled=true;
 try{
  const data={title:$('officeCampaignTitle').value.trim(),buttonName:$('officeCampaignButton').value.trim(),
   description,price:$('officeCampaignPrice').value,
   startsAt:phTime($('officeCampaignStartDate').value+'T'+$('officeCampaignStartTime').value),
   endsAt:phTime($('officeCampaignEndDate').value+'T'+$('officeCampaignEndTime').value),
   iconData:await compressIcon($('officeCampaignIcon').files[0]),requirements};
  await api('promotions',{method:'POST',body:JSON.stringify(data)});
  $('officeCampaignForm').reset();selectedIngredients=[];renderSupplies();++iconPreviewRevision;
  $('officeCampaignIconImage').removeAttribute('src');$('officeCampaignIconPreview').classList.add('hidden');
  $('officeCampaignFeedback').textContent='Main Office promotion scheduled and published to active franchisees.';
  await load();
 }catch(e){$('officeCampaignFeedback').textContent=e.message}
 finally{btn.disabled=false}
});
$('officeCampaignRefresh').onclick=load;
$('officeCampaignRows').addEventListener('click',async e=>{
 const deactivate=e.target.closest('[data-campaign-deactivate]'),participants=e.target.closest('[data-campaign-participants]');
 if(deactivate){
  if(!confirm('Deactivate the Main Office promo button for all franchises? Selling will stop immediately.'))return;
  deactivate.disabled=true;
  try{await api('promotions/'+deactivate.dataset.campaignDeactivate+'/deactivate',{method:'POST'});
   $('officeCampaignFeedback').textContent='Campaign deactivated. Franchise buttons will disappear when refreshed.';
   await load();
  }catch(err){$('officeCampaignFeedback').textContent=err.message}
  finally{deactivate.disabled=false}
 }
 if(participants){
  const box=$('officeCampaignParticipants');box.classList.remove('hidden');
  box.textContent='Checking franchise purchases and sales…';
  try{
   const data=await api('promotions/'+participants.dataset.campaignParticipants+'/participants');
   box.innerHTML='<h3>Franchise promotional participation</h3><div class="table-scroll"><table><thead><tr><th>Franchise</th><th>Required supplies received</th><th>Promotional sales</th></tr></thead><tbody>'+
    (data.participants||[]).map(row=>'<tr><td><strong>'+esc(row.owner)+'</strong><small>Workspace #'+row.workspaceId+'</small></td>'+
      '<td>'+(row.purchased?'Purchased':'Not yet qualified')+'<small>'+row.supplies.map(x=>esc(x.name)+': '+x.quantity+' received, '+x.requiredPerSale+' needed').join(' · ')+'</small></td>'+
      '<td>'+Number(row.sold||0)+' units · '+Number(row.orders||0)+' transactions</td></tr>').join('')+
    '</tbody></table></div>';
  }catch(err){box.textContent=err.message}
 }
});
setInterval(()=>{if(document.querySelector('#page-promotions:not(.hidden)'))renderTimers()},1000);
window.officeCampaignUI={load};
})();