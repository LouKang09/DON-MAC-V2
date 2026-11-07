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
let campaigns=[],supplies=[],loading=false;
function phTime(value){
 if(!value||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw Error('Choose valid Philippine local start and end times.');
 return new Date(value+':00+08:00').toISOString();
}
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
function renderSupplies(){
 $('officeCampaignSupplies').innerHTML=supplies.filter(p=>p.active).map(p=>
 '<label class="office-campaign-ingredient"><span><input type="checkbox" data-campaign-supply="'+p.id+'"/>'+
 '<strong>'+esc(p.name)+'</strong><small>'+esc(p.uom)+'</small></span>'+
 '<span>Per sale <input type="number" min="1" max="10000" step="1" value="1" data-campaign-qty="'+p.id+'" aria-label="Units required of '+esc(p.name)+'"/></span></label>'
 ).join('')||'<p>No active Main Office supplies available.</p>';
}
function renderCampaigns(){
 $('officeCampaignRows').innerHTML=campaigns.map(c=>{
  const status=currentStatus(c),period=fmt(c.startsAt)+' → '+fmt(c.endsAt);
  const supply=(c.requirements||[]).map(x=>esc(x.name)+' × '+x.unitsPerSale).join(' · ');
  return '<tr><td><strong>'+esc(c.title)+'</strong><small>'+esc(c.description)+'</small></td>'+
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
  renderCampaigns();renderSupplies();
 }catch(e){$('officeCampaignFeedback').textContent=e.message;}
 finally{loading=false;}
}
$('officeCampaignForm').addEventListener('submit',async e=>{
 e.preventDefault();const btn=$('officeCampaignCreate');if(btn.disabled)return;
 const requirements=supplies.filter(p=>$('officeCampaignSupplies').querySelector('[data-campaign-supply="'+p.id+'"]')?.checked)
 .map(p=>({productId:p.id,unitsPerSale:Number($('officeCampaignSupplies').querySelector('[data-campaign-qty="'+p.id+'"]')?.value||0)}));
 if(!requirements.length){$('officeCampaignFeedback').textContent='Choose at least one required supply item.';return;}
 btn.disabled=true;
 try{
  const data={title:$('officeCampaignTitle').value.trim(),buttonName:$('officeCampaignButton').value.trim(),
   description:$('officeCampaignDescription').value.trim(),price:$('officeCampaignPrice').value,
   startsAt:phTime($('officeCampaignStarts').value),endsAt:phTime($('officeCampaignEnds').value),requirements};
  await api('promotions',{method:'POST',body:JSON.stringify(data)});
  $('officeCampaignForm').reset();$('officeCampaignFeedback').textContent='Main Office promotion scheduled and published to active franchisees.';
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