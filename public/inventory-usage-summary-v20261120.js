/* Don Mac POS — branch-isolated sold ingredient usage in Inventory. */
(()=>{
 'use strict';
 const $=id=>document.getElementById(id),box=$('inventoryUsageSummary');
 if(!box||window.donmacInventoryUsage)return;
 const view=$('view-inventory'),branch=$('inventoryBranch'),period=$('inventoryUsagePeriod'),
  chart=$('inventoryUsageChartType'),start=$('inventoryUsageStart'),end=$('inventoryUsageEnd'),
  feedback=$('inventoryUsageFeedback'),results=$('inventoryUsageResults');
 const colors=['#087e4a','#e39b47','#2591a1','#8a6abe','#cf6c63','#698f45','#b986b0','#4d86bb'];
 let data=null,requestId=0,active=null,currentBranch='',loading=false,lastKey='';
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const currency=x=>'₱'+Number(x||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
 const num=x=>Number(x||0).toLocaleString('en-PH',{maximumFractionDigits:3});
 const today=()=>{
  const p=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Manila',year:'numeric',
   month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const m=Object.fromEntries(p.filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  return m.year+'-'+m.month+'-'+m.day;
 };
 const isoAdd=(s,n)=>new Date(Date.parse(s+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
 const displayQty=(q,u)=>{
  const value=Number(q||0),unit=String(u||'unit').trim();
  if(/^g(rams?)?$/i.test(unit)&&Math.abs(value)>=1000)return num(value/1000)+' kg';
  if(/^m(l|illiliters?)$/i.test(unit)&&Math.abs(value)>=1000)return num(value/1000)+' L';
  return num(value)+' '+unit;
 };
 const activeView=()=>!!view?.classList.contains('active')&&!document.getElementById('app')?.classList.contains('hidden');
 const generation=()=>window.donmacSessionGeneration?.();
 const selectedBranch=()=>String(branch?.value||'').trim();
 const scopeLabel=()=>branch?.selectedOptions?.[0]?.textContent?.trim()||'Selected branch';
 function setFeedback(message,isError=false){
  feedback.textContent=String(message);feedback.classList.toggle('is-error',isError);
  feedback.hidden=!message;
 }
 function series(){
  const days=data?.days||[],keys=new Map();
  const mode=days.length>62?'month':days.length>32?'week':'day';
  for(const d of days){
   const key=mode==='month'?d.day.slice(0,7):mode==='week'?
     isoAdd(d.day,-((new Date(d.day+'T00:00:00Z').getUTCDay()+6)%7)):d.day;
   const x=keys.get(key)||{name:key,grossCost:0,netCost:0};
   x.grossCost+=Number(d.grossCost||0);x.netCost+=Number(d.netCost||0);
   keys.set(key,x);
  }
  return [...keys.values()];
 }
 function lineChart(){
  const rows=series();
  if(!rows.length)return'<p class="inv-usage-empty">No recorded ingredient costs in this period.</p>';
  const width=Math.max(620,Math.min(1300,rows.length*35)),height=270,left=78,right=24,top=21,bottom=55;
  const plotW=width-left-right,plotH=height-top-bottom;
  const max=Math.max(1,...rows.flatMap(r=>[Number(r.grossCost),Number(r.netCost)]));
  const x=i=>left+(rows.length===1?plotW/2:i*plotW/(rows.length-1));
  const y=n=>top+plotH-(Math.max(0,Number(n||0))/max)*plotH;
  const grid=[0,.25,.5,.75,1].map(v=>{
   const yy=y(max*v).toFixed(1);
   return'<line x1="'+left+'" y1="'+yy+'" x2="'+(width-right)+'" y2="'+yy+
    '" stroke="#dceadf" stroke-width="1"/><text x="'+(left-10)+'" y="'+(Number(yy)+4)+
    '" text-anchor="end" fill="#698072" font-size="11">'+esc(currency(max*v))+'</text>';
  }).join('');
  const plots=[['grossCost',colors[1],'Gross Cost'],['netCost',colors[0],'Net Cost']].map(([key,color,name])=>{
   const points=rows.map((r,i)=>x(i).toFixed(1)+','+y(r[key]).toFixed(1)).join(' ');
   return'<polyline fill="none" stroke="'+color+'" stroke-width="2.6" stroke-linejoin="round" '+
    'stroke-linecap="round" points="'+points+'"/>'+
    rows.map((r,i)=>'<circle cx="'+x(i).toFixed(1)+'" cy="'+y(r[key]).toFixed(1)+
    '" r="3.8" fill="white" stroke="'+color+'" stroke-width="2"><title>'+
    esc(r.name+' · '+name+' · '+currency(r[key]))+'</title></circle>').join('');
  }).join('');
  const step=Math.max(1,Math.ceil(rows.length/12));
  const labels=rows.map((r,i)=>i%step===0||i===rows.length-1?
   '<text x="'+x(i).toFixed(1)+'" y="'+(height-15)+'" text-anchor="middle" '+
   'fill="#637a6d" font-size="11" transform="rotate(-32 '+x(i).toFixed(1)+' '+(height-15)+')">'+
   esc(r.name.slice(5)||r.name)+'</text>':'').join('');
  return'<div class="inv-usage-plot-scroll"><svg role="img" aria-label="Gross and net ingredient costs by period" viewBox="0 0 '+
   width+' '+height+'" style="min-width:'+Math.min(width,1100)+'px">'+grid+plots+labels+'</svg></div>'+
   '<div class="inv-usage-legend"><span><i style="background:'+colors[1]+'"></i>Gross Cost</span>'+
   '<span><i style="background:'+colors[0]+'"></i>Net Cost</span></div>';
 }
 function tileChart(){
  const list=(data?.ingredients||[]).filter(x=>Number(x.netCost)>0).slice(0,12);
  if(!list.length)return'<p class="inv-usage-empty">No sold ingredient cost to compare.</p>';
  const top=Math.max(1,...list.map(x=>Number(x.netCost)));
  return'<div class="inv-usage-tile-chart">'+list.map((r,i)=>'<div class="inv-usage-tile-row">'+
   '<span title="'+esc(r.name)+'">'+esc(r.name)+'</span>'+
   '<div class="inv-usage-bar-track"><i style="width:'+(Number(r.netCost)/top*100).toFixed(2)+
   '%;background:'+colors[i%colors.length]+'"></i></div><b>'+currency(r.netCost)+'</b></div>').join('')+'</div>';
 }
 function pieChart(){
  const list=(data?.ingredients||[]).filter(x=>Number(x.netCost)>0).slice();
  const total=list.reduce((a,b)=>a+Number(b.netCost||0),0);
  if(!total)return'<p class="inv-usage-empty">No completed-sale ingredient costs to distribute.</p>';
  const shown=list.slice(0,7),rest=list.slice(7).reduce((a,x)=>a+Number(x.netCost||0),0);
  if(rest>0)shown.push({name:'Other ingredients',netCost:rest});
  let cursor=0;
  const slices=shown.map((r,i)=>{
   const from=cursor;cursor+=Number(r.netCost)/total*100;
   return colors[i%colors.length]+' '+from.toFixed(3)+'% '+cursor.toFixed(3)+'%';
  });
  return'<div class="inv-usage-pie-layout"><div class="inv-usage-pie" role="img" aria-label="'+
   esc(shown.map(r=>r.name+': '+currency(r.netCost)).join(', '))+
   '" style="background:conic-gradient('+slices.join(',')+')"><div><strong>'+
   currency(total)+'</strong><small>Net ingredient cost</small></div></div>'+
   '<div class="inv-usage-pie-legend">'+shown.map((r,i)=>'<div><i style="background:'+
    colors[i%colors.length]+'"></i><span>'+esc(r.name)+'</span><b>'+
    (Number(r.netCost)/total*100).toFixed(1)+'%</b></div>').join('')+'</div></div>';
 }
 function drawChart(){
  if(!data)return;
  $('inventoryUsageChart').innerHTML=chart.value==='pie'?pieChart():chart.value==='tile'?tileChart():lineChart();
 }
 function drawTable(){
  if(!data)return;
  const term=String($('inventoryUsageSearch').value||'').trim().toLocaleLowerCase();
  const filtered=data.ingredients.filter(x=>(x.name+' '+x.uom+' '+x.products.map(p=>p.name).join(' ')).toLocaleLowerCase().includes(term));
  const html=filtered.map((r,i)=>{
   const products=r.products||[],known=products.filter(p=>Number(p.qty)>0),
    count=known.reduce((sum,p)=>sum+Number(p.qty||0),0);
   const detail=products.length?
    '<details class="inv-usage-detail"><summary>View '+products.length+' product'+(products.length===1?'':'s')+
    '</summary><div class="inv-usage-detail-list">'+products.map(p=>'<div><span>'+esc(p.name)+
     ' <b>'+(Number(p.qty)>0?'× '+num(p.qty):'historical')+'</b></span>'+
     '<span>'+esc(displayQty(p.usageQty,r.uom))+'</span><b>'+currency(p.netCost)+'</b></div>').join('')+
    '</div></details>':'—';
   return'<tr><td><strong>'+esc(r.name)+'</strong>'+(r.estimated?
    '<small class="inv-usage-estimated">Estimated historical cost</small>':'')+
    '</td><td>'+(count>0?num(count)+' sold units':'Historical checkout')+
    '</td><td class="num">'+esc(displayQty(r.qty,r.uom))+
    '</td><td class="num">'+currency(r.grossCost)+'</td><td class="num">'+currency(r.netCost)+
    '</td><td>'+detail+'</td></tr>';
  }).join('');
  $('inventoryUsageBody').innerHTML=html||'<tr><td colspan="6" class="inv-usage-empty">'+
    (term?'No ingredients match this search.':'No completed sales or ingredient use for this selection.')+
    '</td></tr>';
  $('inventoryUsageTableCaption').textContent=filtered.length+' of '+data.ingredients.length+
    ' ingredients · '+data.period.start+' to '+data.period.end;
 }
 function draw(){
  if(!data)return;
  $('inventoryUsageGross').textContent=currency(data.totals.grossCost);
  $('inventoryUsageNet').textContent=currency(data.totals.netCost);
  $('inventoryUsageCount').textContent=String(data.totals.ingredientTypes);
  $('inventoryUsageScope').textContent=data.branch.name;
  $('inventoryUsageChartScope').textContent=data.period.start+' – '+data.period.end;
  $('inventoryUsageNotes').textContent=data.sourceNote+' Gross Cost includes checkout costs before excluded void/deleted sales; Net Cost includes completed sales only. Displayed quantity counts sold ingredient usage, not purchases or transfers.';
  results.hidden=false;drawTable();drawChart();
 }
 async function load(force=false){
  if(!activeView())return;
  const id=selectedBranch(),range=period.value;
  if(!/^[1-9]\d*$/.test(id)){
   requestId++;if(active)active.abort();data=null;results.hidden=true;
   setFeedback('Select an authorized Inventory Branch above to view its sold ingredient usage.');return;
  }
  const params=new URLSearchParams({branchId:id,range});
  if(range==='custom'){
   if(!start.value||!end.value){setFeedback('Choose the From and To dates, then click Apply.',true);return;}
   if(start.value>end.value){setFeedback('The From date must not be after the To date.',true);return;}
   params.set('start',start.value);params.set('end',end.value);
  }
  const key=id+'|'+params.toString()+'|'+generation();
  if(!force&&key===lastKey&&data){draw();return;}
  const token=++requestId,session=generation();if(active)active.abort();
  active=new AbortController();loading=true;currentBranch=id;
  setFeedback('Loading sold ingredient usage…');results.hidden=true;
  const endpoint=window.donmacFranchiseUnified===true?'/api/live/inventory/usage-summary':'/api/inventory/usage-summary';
  try{
   const response=await fetch(endpoint+'?'+params.toString(),{credentials:'same-origin',
    cache:'no-store',signal:active.signal});
   const result=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(result.error||'Unable to retrieve ingredient usage.');
   if(token!==requestId||session!==generation()||!activeView()||selectedBranch()!==id)return;
   if(!Array.isArray(result.ingredients)||!Array.isArray(result.days))throw Error('Unexpected ingredient usage response.');
   data=result;lastKey=key;setFeedback('');draw();
  }catch(err){
   if(token!==requestId||err.name==='AbortError')return;
   data=null;results.hidden=true;setFeedback(err.message||'Could not load ingredient usage.',true);
  }finally{if(token===requestId)loading=false;}
 }
 const t=today();
 start.max=t;end.max=t;start.value=isoAdd(t,-29);end.value=t;
 const onBranch=()=>{
  lastKey='';
  // The replenish form updates inventoryBranch.value in another change
  // handler. A microtask observes that final branch, not the previous one.
  queueMicrotask(()=>void load(true));
 };
 branch?.addEventListener('change',onBranch);
 $('replenishReceivingBranch')?.addEventListener('change',onBranch);
 period.addEventListener('change',()=>{
  $('inventoryUsageCustom').hidden=period.value!=='custom';
  if(period.value!=='custom')void load(true);
  else setFeedback('Select custom dates and click Apply.');
 });
 $('inventoryUsageApply').addEventListener('click',()=>void load(true));
 chart.addEventListener('change',drawChart);
 $('inventoryUsageSearch').addEventListener('input',drawTable);
 // Inventory can be opened after this script loads. Observe only the view
 // activation and branch <option> changes, not unrelated app mutations.
 if(view&&typeof MutationObserver!=='undefined'){
  new MutationObserver(()=>{if(activeView())void load(false);else if(active)active.abort()})
   .observe(view,{attributes:true,attributeFilter:['class']});
 }
 if(branch&&typeof MutationObserver!=='undefined'){
  new MutationObserver(()=>{if(activeView()&&selectedBranch()!==currentBranch)void load(true)})
   .observe(branch,{childList:true,subtree:true});
 }
 window.addEventListener('pageshow',()=>{if(activeView())void load(false)});
 window.donmacInventoryUsage={refresh:()=>load(true)};
 if(activeView())void load();
})();
