/* Supply Office activity bell and system logs; scoped to authenticated Main Office. */
(()=>{
 'use strict';
 const app=document.getElementById('officeApp'),bell=document.getElementById('officeAlertBell');
 if(!app||!bell||window.donmacOfficeActivity)return;
 const $=id=>document.getElementById(id);
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const date=s=>s?new Date(s).toLocaleString('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}):'';
 const api=async(path,options={})=>{
  const response=await fetch(path,{credentials:'same-origin',cache:'no-store',
   ...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(body.error||'Request failed ('+response.status+')');
  return body;
 };
 const live=()=>!app.classList.contains('hidden')&&
  !app.querySelector('[data-office-page="dashboard"]')?.classList.contains('hidden');
 let alertData=[],logOffset=0,logTotal=0,latest=0,alertsLoading=false;
 let systemTerm='',systemType='',logRequest=0;
 const status=message=>{$('officeAlertItems').innerHTML='<p class="muted office-alert-empty">'+esc(message)+'</p>'};
 const showPanel=open=>{
  $('officeAlertPanel').classList.toggle('hidden',!open);
  bell.setAttribute('aria-expanded',String(open));
  if(open)void refreshAlerts();
 };
 async function refreshAlerts(){
  if(!live()||alertsLoading)return;
  alertsLoading=true;
  try{
   const data=await api('/api/supply/office/alerts');
   alertData=data.alerts||[];
   const unread=Number(data.unread||0);
   const count=$('officeAlertCount');
   count.classList.toggle('hidden',unread===0);
   count.textContent=unread>99?'99+':String(unread);
   bell.classList.toggle('has-unread',unread>0);
   bell.title=unread?unread+' unread warehouse alerts':'Warehouse notifications';
   const rows=alertData.map(item=>
    '<button type="button" class="office-alert-row'+(item.read?' is-read':' is-unread')+
    '" data-office-alert="'+esc(item.key)+'" data-office-route="'+esc(item.route)+'" role="listitem">'+
    '<span class="office-alert-dot '+esc(item.priority||'normal')+'"></span>'+
    '<span class="office-alert-copy"><strong>'+esc(item.title)+'</strong><small>'+esc(item.message)+'</small>'+
    '<em>'+esc(item.type==='expiry'?'Expiry tracking':'Franchise purchase request')+'</em></span>'+
    (!item.read?'<span class="office-alert-new">New</span>':'')+'</button>'
   ).join('');
   $('officeAlertItems').innerHTML=rows||'<p class="muted office-alert-empty">No active purchase-request or expiry alerts.</p>';
   $('officeAlertMarkAll').disabled=unread===0;
  }catch(error){
   // Staff logins cannot access Main Office notifications. Do not display
   // a false alarm merely because a user is not authorized.
   if(!/401|403|sign-in|required/i.test(error.message))
    status('Unable to load warehouse alerts. Use Refresh to try again.');
  }finally{alertsLoading=false}
 }
 async function mark(keys){
  if(!keys.length)return;
  await api('/api/supply/office/alerts/read',{method:'POST',body:JSON.stringify({keys})});
  await refreshAlerts();
 }
 bell.addEventListener('click',e=>{e.stopPropagation();showPanel($('officeAlertPanel').classList.contains('hidden'))});
 $('officeAlertClose').addEventListener('click',()=>showPanel(false));
 $('officeAlertReload').addEventListener('click',()=>void refreshAlerts());
 $('officeAlertMarkAll').addEventListener('click',()=>{
  void mark(alertData.filter(x=>!x.read).map(x=>x.key)).catch(error=>status(error.message));
 });
 $('officeAlertItems').addEventListener('click',event=>{
  const btn=event.target.closest('[data-office-alert]');if(!btn)return;
  const key=btn.dataset.officeAlert,route=btn.dataset.officeRoute;
  void (async()=>{
   if(!alertData.find(x=>x.key===key)?.read)await mark([key]);
   showPanel(false);
   app.querySelector('[data-office-page="'+route+'"]')?.click();
  })().catch(error=>status(error.message));
 });
 document.addEventListener('click',e=>{
  if(!e.target.closest('.office-alert-wrap'))showPanel(false);
 });
 document.addEventListener('keydown',e=>{if(e.key==='Escape')showPanel(false)});
 const actionLabel=code=>String(code||'').replaceAll('_',' ').toLowerCase().replace(/\b\w/g,c=>c.toUpperCase());
 const shortDetail=value=>{
  if(!value)return'—';
  try{
   const parsed=JSON.parse(value);
   if(typeof parsed==='string')return parsed;
   return Object.entries(parsed).map(([k,v])=>k+': '+(typeof v==='object'?JSON.stringify(v):String(v))).join(' · ');
  }catch{return String(value)}
 };
 const logsStatus=message=>{
  $('officeLogRows').innerHTML='<tr><td colspan="5">'+esc(message)+'</td></tr>';
 };
 async function loadLogs(){
  if($('page-logs')?.classList.contains('hidden'))return;
  const sequence=++logRequest;
  logsStatus('Loading recent Main Office changes…');
  try{
   const term=$('officeLogSearch').value.trim(),filter=$('officeLogType').value;
   const params=new URLSearchParams({limit:'50',offset:String(logOffset),
    term:term.slice(0,100),category:filter});
   const data=await api('/api/supply/office/system-logs?'+params);
   if(sequence!==logRequest)return;
   logTotal=Number(data.total||0);
   $('officeLogRows').innerHTML=(data.logs||[]).map(x=>
    '<tr><td>'+esc(date(x.created_at))+'</td><td>'+esc(x.actor)+'</td>'+
    '<td><b>'+esc(actionLabel(x.action))+'</b></td>'+
    '<td>'+esc(x.entity||'')+(x.entity_id?' <small>'+esc(x.entity_id)+'</small>':'')+'</td>'+
    '<td class="office-log-detail">'+esc(shortDetail(x.detail))+'</td></tr>').join('')||
    '<tr><td colspan="5">No matching changes have been recorded yet.</td></tr>';
   const prev=logOffset>0,next=logOffset+50<logTotal;
   $('officeLogPages').innerHTML='<span>Showing '+(logTotal?logOffset+1:0)+'–'+Math.min(logTotal,logOffset+50)+
    ' of '+logTotal+' records</span><button type="button" data-log-page="-1" '+(!prev?'disabled':'')+
    '>Previous</button><button type="button" data-log-page="1" '+(!next?'disabled':'')+'>Next</button>';
  }catch(e){logsStatus(e.message)}
 }
 $('officeLogSearch').addEventListener('input',()=>{
  const next=$('officeLogSearch').value;
  if(systemTerm===next)return;
  systemTerm=next;logOffset=0;
  // Apply shortly after typing without issuing an API request for every keystroke.
  clearTimeout(latest);latest=setTimeout(()=>void loadLogs(),300);
 });
 $('officeLogType').addEventListener('change',()=>{systemType=$('officeLogType').value;logOffset=0;void loadLogs()});
 $('officeLogRefresh').addEventListener('click',()=>void loadLogs());
 $('officeLogPages').addEventListener('click',e=>{
  const b=e.target.closest('[data-log-page]');if(!b)return;
  logOffset=Math.max(0,logOffset+50*Number(b.dataset.logPage));void loadLogs();
 });
 const nav=app.querySelector('[data-office-page="logs"]');
 nav?.addEventListener('click',()=>{logOffset=0;void loadLogs()});
 window.donmacOfficeActivity={refreshAlerts,load:loadLogs};
 // Refresh the bell when the Main Office signs in and while it is visible.
 setTimeout(()=>{if(live())void refreshAlerts()},700);
 setInterval(()=>{if(live())void refreshAlerts()},45000);
})();
