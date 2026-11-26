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
 if(c.deleted)return'DELETED';
 if(c.held)return'ON_HOLD';
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
const promoGlyph={
 arrow:'<svg class="dm-ua-native" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>',
 trash:'<svg class="dm-ua-native" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3"/></svg>'
};
const statusLabel={LIVE:'Live',UPCOMING:'Scheduled',ON_HOLD:'On hold',INACTIVE:'Deactivated',ENDED:'Ended',DELETED:'Deleted'};
function actionEntry(label,attribute,enabled=true,danger=false){
 return '<button type="button" role="menuitem" class="office-promo-menu-action'+(danger?' office-promo-danger':'')+
  '" '+attribute+(enabled?'':' disabled')+'>'+
  (danger?'<span data-dm-icon="trash2" class="office-promo-delete-icon">'+promoGlyph.trash+'</span>':'')+
  '<span>'+label+'</span></button>';
}
function renderCampaigns(){
 $('officeCampaignRows').innerHTML=campaigns.map(c=>{
  const status=currentStatus(c),period=fmt(c.startsAt)+' → '+fmt(c.endsAt);
  const supply=(c.requirements||[]).map(x=>esc(x.name)+' × '+Number(x.unitsPerSale)).join(' · ');
  const hold=Boolean(c.active)&&!c.held&&(status==='LIVE'||status==='UPCOMING');
  const reactivate=status==='INACTIVE'||status==='ON_HOLD'||status==='ENDED';
  const id=esc(c.id);
  const actions='<details class="office-promo-actions" data-promo-menu="'+id+'">'+
   '<summary class="office-promo-menu-trigger" aria-label="Actions for '+esc(c.title)+'">Actions '+promoGlyph.arrow+'</summary>'+
   '<div class="office-promo-menu-list" role="menu" aria-label="Manage '+esc(c.title)+'">'+
    actionEntry('Deactivate','data-campaign-deactivate="'+id+'"',c.active)+
    actionEntry('Hold Promotion','data-campaign-hold="'+id+'"',hold)+
    actionEntry('Reactivate','data-campaign-reactivate="'+id+'"',reactivate)+
    actionEntry('View History','data-campaign-history="'+id+'"')+
    '<div class="office-promo-menu-divider" role="separator"></div>'+
    actionEntry('Delete','data-campaign-delete="'+id+'"',true,true)+
   '</div></details>';
  return '<tr><td>'+(c.iconData?'<img class="office-campaign-row-icon" src="'+esc(c.iconData)+'" alt="" loading="lazy">':'')+
    '<strong>'+esc(c.title)+'</strong><small>'+esc(c.description)+'</small></td>'+
   '<td><strong>'+esc(c.buttonName)+'</strong><small>'+money(c.price)+' · '+supply+'</small></td>'+
   '<td><span class="office-campaign-status" data-status="'+esc(status)+'" data-campaign-status="'+id+'">'+
    esc(statusLabel[status]||status)+'</span>'+
   '<small data-campaign-countdown="'+id+'">'+(status==='UPCOMING'?'Scheduled':timeRemaining(c.endsAt))+'</small></td>'+
   '<td class="office-promo-period">'+esc(period)+'</td><td>'+
    '<button class="btn solid office-promo-participants" type="button" data-campaign-participants="'+id+'">View franchisees</button></td>'+
   '<td class="office-promo-actions-cell">'+actions+'</td></tr>';
 }).join('')||'<tr><td colspan="6">No Main Office promotions yet.</td></tr>';
}
function renderTimers(){
 for(const c of campaigns){
  const status=$('officeCampaignRows').querySelector('[data-campaign-status="'+c.id+'"]');
  const count=$('officeCampaignRows').querySelector('[data-campaign-countdown="'+c.id+'"]');
  const current=currentStatus(c);
  if(status){status.textContent=statusLabel[current]||current;status.dataset.status=current;}
  if(count)count.textContent=current==='UPCOMING'?'Starts in '+timeRemaining(c.startsAt):
   current==='LIVE'?'Ends in '+timeRemaining(c.endsAt):
   current==='ON_HOLD'?'Temporarily paused':
   current==='ENDED'?'Ended':current==='INACTIVE'?'Deactivated':'Deleted';
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
 if(!requirements.length){ingredientFeedback('Select at least one Supply Catalog ingredient to define required stock per sale. Branches qualify using their on-hand inventory; no purchase is required. Typed items are descriptive only.');return;}
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
const reactivateDialog=$('officeCampaignReactivateDialog');
const historyDialog=$('officeCampaignHistoryDialog');
let reactivatingId=null;
const actionFeedback=message=>{$('officeCampaignFeedback').textContent=message;};
const confirmAction=async(message,title,button)=>{
 if(window.donmacPrompt?.confirm)return !!(await window.donmacPrompt.confirm(message,{
  title,confirmText:button,cancelText:'Cancel'
 }));
 return window.confirm(message);
};
function dismissPromoMenu(){
 $('officeCampaignRows').querySelectorAll('.office-promo-actions[open]').forEach(el=>{el.open=false});
}
function openDialog(dialog){
 if(typeof dialog.showModal==='function')dialog.showModal();
 else{dialog.setAttribute('open','');dialog.classList.add('office-promo-dialog-fallback');}
}
function closeDialog(dialog){
 if(typeof dialog.close==='function')dialog.close();
 else{dialog.removeAttribute('open');dialog.classList.remove('office-promo-dialog-fallback');}
}
function nextPhilippineTime(){
 // Asia/Manila is UTC+08 with no daylight-saving time.
 const local=new Date(Date.now()+8*3600000+86400000).toISOString().slice(0,10);
 return local+'T09:00';
}
function fillPhilippineDateTime(prefix,start){
 $(prefix+'Date').value=start.slice(0,10);
 $(prefix+'Time').value=start.slice(11,16);
}
function editReactivation(id){
 const item=campaigns.find(x=>x.id===id);if(!item)return;
 reactivatingId=id;
 $('officeCampaignReactivateName').textContent=item.title;
 $('officeReactivationError').textContent='';
 const next=nextPhilippineTime();
 const rawDuration=Date.parse(item.endsAt)-Date.parse(item.startsAt);
 const duration=Math.min(366*86400000,Math.max(60000,Number.isFinite(rawDuration)?rawDuration:3600000));
 const end=new Date(Date.parse(phTime(next))+duration+8*3600000).toISOString().slice(0,16);
 fillPhilippineDateTime('officeReactivation',next);
 $('officeReactivationEndDate').value=end.slice(0,10);
 $('officeReactivationEndTime').value=end.slice(11,16);
 openDialog(reactivateDialog);
}
$('officeCampaignReactivateForm').addEventListener('submit',async e=>{
 e.preventDefault();
 if(!reactivatingId)return;
 const btn=$('officeReactivationSave'),error=$('officeReactivationError');
 try{
  const body={
   startsAt:phTime($('officeReactivationDate').value+'T'+$('officeReactivationTime').value),
   endsAt:phTime($('officeReactivationEndDate').value+'T'+$('officeReactivationEndTime').value)
  };
  if(Date.parse(body.startsAt)<Date.now()-60000)throw Error('Reactivation must start in the future.');
  if(Date.parse(body.endsAt)<=Date.parse(body.startsAt))throw Error('End date must be after the new start.');
  btn.disabled=true;error.textContent='';
  await api('promotions/'+reactivatingId+'/reactivate',{method:'POST',body:JSON.stringify(body)});
  closeDialog(reactivateDialog);reactivatingId=null;
  actionFeedback('Promotion reactivation scheduled. It will start automatically at the selected Philippine date and time.');
  await load();
 }catch(err){error.textContent=err.message}
 finally{btn.disabled=false;}
});
async function showHistory(id){
 const item=campaigns.find(x=>x.id===id);if(!item)return;
 $('officeCampaignHistoryName').textContent=item.title;
 $('officeCampaignHistorySummary').textContent='Loading promotion history…';
 $('officeCampaignHistoryRows').textContent='';
 openDialog(historyDialog);
 try{
  const data=await api('promotions/'+id+'/history'),events=data.events||[];
  const completed=events.filter(e=>e.action==='REACTIVATED'&&Date.parse(e.startsAt)<=Date.now()).length;
  const queued=events.filter(e=>e.action==='REACTIVATED'&&Date.parse(e.startsAt)>Date.now()).length;
  $('officeCampaignHistorySummary').innerHTML=
   '<div><small>Reactivations started</small><strong>'+completed+'</strong></div>'+
   '<div><small>Scheduled reactivations</small><strong>'+queued+'</strong></div>'+
   '<div><small>Recorded changes</small><strong>'+events.length+'</strong></div>';
  const labels={CREATED:'Promotion created',HELD:'Promotion placed on hold',
   DEACTIVATED:'Promotion deactivated',REACTIVATED:'Promotion reactivation scheduled',
   DELETED:'Promotion deleted'};
  $('officeCampaignHistoryRows').innerHTML=events.slice().reverse().map(event=>
   '<article class="office-promo-history-event"><div><strong>'+
    esc(labels[event.action]||event.action)+'</strong>'+
    '<time>'+esc(fmt(event.occurredAt))+'</time></div>'+
    '<p>By '+esc(event.actor||'Main Office')+'</p>'+
    (event.startsAt?'<small>Promotion window: '+esc(fmt(event.startsAt))+' — '+esc(fmt(event.endsAt))+'</small>':'')+
    (event.note?'<small>'+esc(event.note)+'</small>':'')+'</article>'
  ).join('')||'<p>No prior activity is recorded for this promotion.</p>';
 }catch(err){$('officeCampaignHistorySummary').textContent=err.message;}
}
document.querySelectorAll('[data-office-promo-close]').forEach(btn=>btn.addEventListener('click',()=>{
 closeDialog(btn.dataset.officePromoClose==='history'?historyDialog:reactivateDialog);
}));
for(const dlg of [reactivateDialog,historyDialog])dlg.addEventListener('click',e=>{
 if(e.target===dlg)closeDialog(dlg);
});
$('officeCampaignRows').addEventListener('toggle',e=>{
 const menu=e.target.closest('details.office-promo-actions');if(!menu?.open)return;
 $('officeCampaignRows').querySelectorAll('details.office-promo-actions[open]').forEach(x=>{if(x!==menu)x.open=false});
},true);
document.addEventListener('click',e=>{
 if(!e.target.closest('.office-promo-actions'))dismissPromoMenu();
});
$('officeCampaignRows').addEventListener('click',async e=>{
 const btn=e.target.closest('[data-campaign-deactivate],[data-campaign-hold],[data-campaign-reactivate],'+
  '[data-campaign-history],[data-campaign-delete],[data-campaign-participants]');
 if(!btn)return;
 const attr=btn.dataset,id=attr.campaignDeactivate||attr.campaignHold||attr.campaignReactivate||
  attr.campaignHistory||attr.campaignDelete||attr.campaignParticipants;
 const campaign=campaigns.find(x=>x.id===id);if(!campaign)return;
 dismissPromoMenu();
 if(attr.campaignReactivate){editReactivation(id);return;}
 if(attr.campaignHistory){await showHistory(id);return;}
 if(attr.campaignDeactivate||attr.campaignHold||attr.campaignDelete){
  const action=attr.campaignDelete?'delete':attr.campaignHold?'hold':'deactivate';
  const warning=action==='delete'?
   'Delete "'+campaign.title+'" from active promotions? This will prevent selling and hide it from the promotional catalog. Past POS transactions and audit history remain preserved.':
   action==='hold'?
   'Put "'+campaign.title+'" on hold? Selling stops immediately. You may schedule a new reactivation later.':
   'Deactivate "'+campaign.title+'"? Selling stops immediately across participating franchisees.';
  const confirmed=await confirmAction(warning,action==='delete'?'Delete Promotion':
   action==='hold'?'Hold Promotion':'Deactivate Promotion',action==='delete'?'Delete':action==='hold'?'Hold':'Deactivate');
  if(!confirmed)return;
  btn.disabled=true;
  try{
   await api('promotions/'+id+(action==='delete'?'':'/'+action),{method:action==='delete'?'DELETE':'POST'});
   actionFeedback(action==='delete'?'Promotion deleted from active lists. Sales and history retained.':
    action==='hold'?'Promotion placed on hold.':'Promotion deactivated.');
   await load();
  }catch(err){actionFeedback(err.message)}
  finally{if(btn.isConnected)btn.disabled=false}
  return;
 }
 if(attr.campaignParticipants){
  const box=$('officeCampaignParticipants');box.classList.remove('hidden');
  box.textContent='Checking branch ingredient stock and promotional sales…';
  try{
   const data=await api('promotions/'+id+'/participants');
   box.innerHTML='<h3>Franchise promotional participation</h3><p>Branches can sell immediately when their ingredients are sufficient—no supply purchase required.</p><div class="table-scroll"><table><thead><tr><th>Franchise / Branch</th><th>Available ingredients</th><th>Promotional sales</th></tr></thead><tbody>'+
    (data.participants||[]).map(row=>'<tr><td><strong>'+esc(row.owner)+'</strong><small>'+esc(row.branch||'Branch')+' · Workspace #'+row.workspaceId+'</small></td>'+
      '<td>'+(row.eligible?'Ready to sell':'Not enough branch stock')+'<small>'+row.supplies.map(x=>esc(x.name)+': '+Number(x.available||0)+' '+esc(x.uom||'')+' on hand, '+Number(x.requiredPerSale||0)+' needed'+(x.matched?'':' · item/unit not matched')).join(' · ')+'</small></td>'+
      '<td>'+Number(row.sold||0)+' units · '+Number(row.orders||0)+' transactions</td></tr>').join('')+
    '</tbody></table></div>';
  }catch(err){box.textContent=err.message}
 }
});
setInterval(()=>{if(document.querySelector('#page-promotions:not(.hidden)'))renderTimers()},1000);
window.officeCampaignUI={load};
})();