(()=>{
'use strict';
const $=id=>document.getElementById(id);
if(!$('historicalExportYear'))return;
const y=$('historicalExportYear'),b=$('historicalExportBranch'),msg=$('historicalExportStatus');
const current=Number(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Manila',year:'numeric'}).format(new Date()));
for(let i=current;i>=2000;i--){const o=document.createElement('option');o.value=i;o.textContent=i;y.add(o);}
let loaded=false;
function note(s,error=false){msg.textContent=s;msg.style.color=error?'#ac2525':'#37654b';}
async function load(){
 try{
  const [p,br]=await Promise.all([fetch('/api/historical-sales/policy',{credentials:'same-origin',cache:'no-store'}),fetch('/api/branches',{credentials:'same-origin',cache:'no-store'})]);
  if(!p.ok||!br.ok)throw Error('Sign in to view historical export options.');
  const policy=await p.json(),data=await br.json(),prior=b.value;b.replaceChildren();
  const all=document.createElement('option');all.value='all';all.textContent='All branches';b.add(all);
  for(const x of data.branches||[]){const o=document.createElement('option');o.value=x.id;o.textContent=x.name;b.add(o);}
  if([...b.options].some(o=>o.value===prior))b.value=prior;
  loaded=true;note(policy.includedMonths+' months of online sales viewing with '+policy.plan+'. Free yearly CSV downloads remain available.');
 }catch(e){note(e.message,true);}
}
$('historicalExportDownload').addEventListener('click',async()=>{
 if(!loaded){await load();if(!loaded)return;}
 const button=$('historicalExportDownload');button.disabled=true;
 try{
  const q=new URLSearchParams({year:y.value,branchId:b.value});
  const r=await fetch('/api/historical-sales/export.csv?'+q.toString(),{credentials:'same-origin',cache:'no-store'});
  if(!r.ok){const error=await r.json().catch(()=>({}));throw Error(error.error||'Export failed.');}
  const link=document.createElement('a'),url=URL.createObjectURL(await r.blob());
  link.href=url;link.download='DonMac_Sales_'+y.value+'.csv';document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);note('Your historical sales CSV has been downloaded.');
 }catch(e){note(e.message,true);}finally{button.disabled=false;}
});
document.querySelectorAll('[data-view="reports"]').forEach(x=>x.addEventListener('click',load));
window.donmacHistoricalSales={load};
})();