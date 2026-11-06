(()=>{'use strict';
const root=document.getElementById('tenantBilling');
if(!root)return;
const $=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','"':'&#39;'}[c]));
const peso=n=>'₱'+Number(n||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
const when=d=>{if(!d)return'—';const dt=new Date(d);return Number.isFinite(dt.getTime())?new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium'}).format(dt):String(d);};
const url=root.dataset.apiBase;
let busy=false,latest=null,lastLoad=0;
function message(text,bad=false){
 const x=$('tenantBillingMessage');x.textContent=text;x.classList.toggle('hidden',!text);
 x.classList.toggle('is-error',bad);
}
function render(data){
 latest=data;
 const sub=data.subscription||null,connected=!!data.checkoutConfigured;
 $('tenantBillingPlan').textContent=sub?.plan||'Not configured';
 $('tenantBillingAmount').textContent=sub?peso(sub.amount):'—';
 $('tenantBillingStatus').textContent=sub?.status?.replaceAll('_',' ')||'Not configured';
 $('tenantBillingDue').textContent=sub?.nextPaymentDate?when(sub.nextPaymentDate+'T12:00:00Z'):'—';
 $('tenantBillingGateway').textContent=connected?'PayMongo '+data.paymentMode+' connected':'PayMongo not connected yet';
 $('tenantBillingGateway').className='tenant-gateway '+(connected?'ready':'disabled');
 const button=$('tenantPayNow');
 button.disabled=busy||!data.canPay;
 button.title=data.canPay?'Pay your subscription securely through PayMongo':'PayMongo checkout will be available after activation and plan configuration';
 const records=Array.isArray(data.invoices)?data.invoices:[];
 $('tenantBillingHistory').innerHTML=records.slice(0,10).map(i=>
  '<tr><td>'+esc(i.id.slice(0,8).toUpperCase())+'</td>'+
  '<td>'+esc(i.plan)+'</td><td>'+peso(i.amount)+'</td>'+
  '<td><span class="tenant-billing-state '+esc(i.status.toLowerCase())+'">'+esc(i.status.replaceAll('_',' '))+'</span></td>'+
  '<td>'+esc(when(i.paidAt||i.createdAt))+'</td></tr>').join('')||
  '<tr><td colspan="5" class="tenant-billing-empty">No subscription payment transactions yet.</td></tr>';
 if(!sub)message('Subscription billing is available to this account. Admin Control must first assign your plan, amount and next payment date.');
 else if(!connected)message('PayMongo has not been connected by the platform owner yet. No online payments are being collected.');
 else if(!sub.nextPaymentDate||sub.amount<=0)message('Your next payment date or subscription amount needs to be configured in Admin Control.');
 else message('Ready for secure checkout. Your subscription becomes Paid only after PayMongo verifies the payment.');
}
async function load(force=false){
 if(busy||!url)return;
 if(!force&&Date.now()-lastLoad<6000)return;
 lastLoad=Date.now();
 try{
  const response=await fetch(url+'/me',{credentials:'same-origin',cache:'no-store'});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(data.error||'Billing information is unavailable.');
  render(data);
 }catch(err){message(err.message,true);}
}
$('tenantPayNow').addEventListener('click',async()=>{
 if(busy||!latest?.canPay)return;
 busy=true;$('tenantPayNow').disabled=true;message('Preparing PayMongo checkout…');
 try{
  const response=await fetch(url+'/checkout',{method:'POST',credentials:'same-origin',
   headers:{'Content-Type':'application/json'},body:'{}'});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(data.error||'Could not start payment.');
  const u=new URL(data.checkoutUrl);
  if(u.protocol!=='https:'||u.hostname!=='checkout.paymongo.com')throw Error('Invalid PayMongo checkout destination.');
  window.location.assign(u.href);
 }catch(err){message(err.message,true);busy=false;$('tenantPayNow').disabled=!latest?.canPay;}
});
$('tenantBillingReload').addEventListener('click',()=>load(true));
const account=document.getElementById('view-account');
if(account){
 const visible=()=>account.classList.contains('active')&&!account.classList.contains('hidden');
 const observer=new MutationObserver(()=>{if(visible())load(true);});
 observer.observe(account,{attributes:true,attributeFilter:['class']});
 document.querySelectorAll('[data-view="account"]').forEach(x=>x.addEventListener('click',()=>setTimeout(()=>load(true),0)));
 if(visible())load(true);
}
window.donmacTenantBilling={load};
})();
