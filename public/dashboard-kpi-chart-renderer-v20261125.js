/* Don Mac POS: shared Owner dashboard KPI chart renderer.
 * This module only renders reporting data already returned by tenant-scoped APIs.
 * Pie labels and branch series are not fabricated.
 */
(()=>{
 'use strict';
 if(window.donmacKpiChartRenderer)return;
 const colors=['#0b8064','#ed8023','#3c69df','#8854d3','#e0b12d','#d84e82',
  '#10a4b5','#58718a','#a3512d','#72a75b','#5865ba','#b45380'];
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
 const value=n=>Number.isFinite(Number(n))?Number(n):0;
 const peso=n=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(value(n));
 const qty=n=>Number(n||0).toLocaleString('en-PH',{maximumFractionDigits:0});
 const human=(n,monetary)=>monetary?peso(n):qty(n);
 const addDay=(date,delta)=>new Date(Date.parse(date+'T00:00:00Z')+delta*86400000).toISOString().slice(0,10);
 function metricField(key){
  if(key==='orders')return'transactions';
  if(key==='discount')return'discount';
  return'gross';
 }
 function titleFor(key){
  return key==='orders'?'Completed orders':key==='discount'?'Applied discounts':
   key==='deposited'?'Gross Revenue (sales context)':
   key==='expenses'?'Gross Revenue (sales context)':
   key==='alerts'?'Gross Revenue (sales context)':'Gross Revenue';
 }
 const scalar=(d,key)=>({
  revenue:d?.rangeRevenueNet,orders:d?.rangeTransactions,today:d?.metrics?.todayNetAfterExpenses,
  month:d?.metrics?.monthActual,expenses:d?.rangeTotalStoreExpenses,
  deposited:d?.shiftDeposits?.total,discount:d?.rangeDiscount,
  alerts:d?.metrics?.lowStockCount
 })[key];
 function series(datasets,key,interval){
  const field=metricField(key);
  return datasets.map((d,i)=>{
   const data=d.data||{};
   let points=Array.isArray(data.trend)?data.trend.map((p,j)=>({
    label:String(p.label||''),value:Math.max(0,value(p[field])),index:j
   })):[];
   if(interval==='daily'&&data.grain==='hourly'){
    points=[{label:data.to||'',value:points.reduce((sum,p)=>sum+p.value,0),index:0}];
   }
   if(interval==='daily'&&data.grain==='daily'){
    points=points.map((p,j)=>({...p,label:new Intl.DateTimeFormat('en-GB',
     {day:'2-digit',month:'short',timeZone:'UTC'}).format(new Date(addDay(data.from,j)+'T00:00:00Z'))}));
   }
   return{name:d.name||'Selected branch',color:colors[i%colors.length],points};
  });
 }
 const pointOnPie=(angle,r,cx=158,cy=158)=>{
  const a=(angle-90)*Math.PI/180;
  return{x:cx+Math.cos(a)*r,y:cy+Math.sin(a)*r};
 };
 const fix=n=>Number(n).toFixed(2);
 function pie(dataset,key,main,interval){
  let categories=[];
  let subtitle='Share of selected values by branch';
  const branches=dataset.length>1;
  if(key==='expenses'&&main?.rangeExpenseCategories){
   const labels={rent:'Rent',stocks:'Stocks',salary:'Salary',transportation:'Transportation',
    electricity:'Electricity',ice:'Ice',water:'Water',misc:'Miscellaneous'};
   categories=Object.entries(main.rangeExpenseCategories).map(([k,n])=>({
    name:labels[k]||k,amount:Math.max(0,value(n))
   }));
   subtitle='Staff-entered Expenses Ledger categories · selected period';
  }else if(branches){
   categories=dataset.map(d=>({
    name:d.name,amount:Math.max(0,value(scalar(d.data,key)))
   }));
   subtitle=key==='deposited'?'Recorded cashier deposits by branch':
    'Selected metric across permitted branches';
  }else if(key==='deposited'){
   categories=[{name:'Recorded cashier deposits',amount:Math.max(0,value(main?.shiftDeposits?.total))}];
   subtitle='Recorded deposits for this period; not bank-confirmed';
  }else if(key==='alerts'){
   categories=[{name:'Low-stock ingredients',amount:Math.max(0,value(main?.metrics?.lowStockCount))}];
   subtitle='Current low-stock ingredient count (not a sales activity series)';
  }else{
   const data=dataset[0]?.data;
   categories=(data?.trend||[]).map(p=>({name:String(p.label),amount:Math.max(0,value(p[metricField(key)]))}));
   subtitle=key==='alerts'||key==='expenses'?'Contextual completed POS sales (not inventory/expense snapshots)':
    'Completed POS sales by '+(interval==='hourly'?'hour':'day')+' of the selected period';
  }
  categories=categories.filter(x=>Number.isFinite(x.amount)&&x.amount>0);
  if(!categories.length)return '<p class="dm-kpi-empty">No recorded values available for this pie chart.</p>';
  const total=categories.reduce((sum,x)=>sum+x.amount,0);
  const formatShare=(key==='orders'||key==='alerts')?qty:peso;
  let angle=0;
  const slices=categories.map((p,i)=>{
   const from=angle,to=i===categories.length-1?360:angle+360*p.amount/total;angle=to;
   return {...p,index:i,from,to,share:100*p.amount/total,color:colors[i%colors.length]};
  });
  // Stagger outside labels on each side to prevent small-slice percentage
  // callouts from overlapping when 10+ time slots are represented.
  const outside=new Map();
  for(const side of ['left','right']){
   const entries=slices.filter(x=>x.share<8&&slices.length>1).map(x=>{
    const pt=pointOnPie((x.from+x.to)/2,137);
    return{index:x.index,side:pt.x<158?'left':'right',x:pt.x,y:pt.y};
   }).filter(x=>x.side===side).sort((a,b)=>a.y-b.y);
   let nextY=9;
   for(const entry of entries){entry.y=Math.max(entry.y,nextY);nextY=entry.y+15;}
   if(entries.length&&entries[entries.length-1].y>305){
    let maxY=305;
    for(let i=entries.length-1;i>=0;i--){entries[i].y=Math.min(entries[i].y,maxY);maxY=entries[i].y-15;}
   }
   for(const entry of entries)outside.set(entry.index,entry);
  }
  const svg=slices.map(p=>{
   const text=p.share.toFixed(1)+'%';
   let shape='';
   if(slices.length===1)shape='<circle cx="158" cy="158" r="108" fill="'+p.color+'"/>';
   else{
    const a=pointOnPie(p.from,108),b=pointOnPie(p.to,108);
    shape='<path d="M 158 158 L '+fix(a.x)+' '+fix(a.y)+' A 108 108 0 '+
     (p.to-p.from>180?1:0)+' 1 '+fix(b.x)+' '+fix(b.y)+' Z" fill="'+p.color+'"/>';
   }
   const small=p.share<8&&slices.length>1;
   const mark=pointOnPie((p.from+p.to)/2,small?137:68);
   const outsidePoint=outside.get(p.index);
   const label=small?
    '<path d="M '+fix(pointOnPie((p.from+p.to)/2,112).x)+' '+
     fix(pointOnPie((p.from+p.to)/2,112).y)+' L '+fix(mark.x)+' '+fix(mark.y)+
     ' L '+fix(mark.x)+' '+fix(outsidePoint?.y??mark.y)+
     '" fill="none" stroke="'+p.color+'" stroke-width="1.8"/>'+
    '<text x="'+fix(mark.x+(mark.x>158?7:-7))+'" y="'+fix(outsidePoint?.y??mark.y)+
     '" text-anchor="'+(mark.x>158?'start':'end')+'" class="dm-kpi-pie-outside" dominant-baseline="middle">'+text+'</text>':
    '<text x="'+fix(mark.x)+'" y="'+fix(mark.y)+'" text-anchor="middle" dominant-baseline="middle"'+
     ' class="dm-kpi-pie-inside" style="fill:'+
     ([1,4,6,9].includes(p.index%colors.length)?'#1a3529':'#ffffff')+'">'+text+'</text>';
   return '<g class="dm-kpi-pie-slice" data-kpi-slice="'+p.index+'" tabindex="0" role="button" '+
    'aria-label="'+esc(p.name+': '+formatShare(p.amount)+' ('+text+')')+'">'+shape+
    '<title>'+esc(p.name+' · '+formatShare(p.amount)+' · '+text)+'</title></g>'+label;
  }).join('');
  const legend=slices.map(p=>'<button type="button" class="dm-kpi-pie-legend-row" data-kpi-slice="'+
   p.index+'" aria-label="'+esc(p.name+' '+formatShare(p.amount))+'">'+
   '<span class="dm-kpi-pie-swatch" style="background:'+p.color+'"></span>'+
   '<span>'+esc(p.name)+'</span><strong>'+esc(formatShare(p.amount))+
   '</strong><small>'+p.share.toFixed(1)+'%</small></button>').join('');
  return '<div class="dm-kpi-pie-shell" data-pie-total="'+esc(formatShare(total))+'">'+
   '<div class="dm-kpi-pie-drawing"><svg viewBox="0 0 320 320" role="group" '+
   'aria-label="Interactive category percentages pie chart">'+svg+'</svg>'+
   '<p id="dmKpiPieSelected" role="status">Total · '+
   esc(formatShare(total))+'</p></div>'+
   '<div class="dm-kpi-pie-legend">'+legend+'</div></div>'+
   '<p class="dm-kpi-pie-caption">'+esc(subtitle)+'</p>';
 }
 function linePath(values,xAt,yAt){
  if(!values.length)return'';
  if(values.length===1)return'M '+fix(xAt(0))+' '+fix(yAt(values[0]));
  let d='M '+fix(xAt(0))+' '+fix(yAt(values[0]));
  for(let i=0;i<values.length-1;i++){
   const x0=xAt(i),x1=xAt(i+1);
   const y0=yAt(values[i]),y1=yAt(values[i+1]);
   const previous=yAt(values[Math.max(0,i-1)]);
   const next=yAt(values[Math.min(values.length-1,i+2)]);
   // Smoothed cubic Bezier, constrained to adjacent values to avoid
   // inventing negative transactions or spurious peaks between points.
   const min=Math.min(y0,y1),max=Math.max(y0,y1);
   const ctrl1=Math.max(min,Math.min(max,y0+(y1-previous)/6));
   const ctrl2=Math.max(min,Math.min(max,y1-(next-y0)/6));
   d+=' C '+fix(x0+(x1-x0)/3)+' '+fix(ctrl1)+' '+
    fix(x1-(x1-x0)/3)+' '+fix(ctrl2)+' '+fix(x1)+' '+fix(y1);
  }
  return d;
 }
 function lineBar(datasets,key,interval,type){
  const bundles=series(datasets,key,interval);
  const n=Math.max(0,...bundles.map(b=>b.points.length));
  if(!n)return '<p class="dm-kpi-empty">No completed transactions in this selected range.</p>';
  const w=Math.max(950,n*40+165),h=355,L=112,R=35,T=36,B=86;
  const left=L,right=w-R,bottom=h-B,top=T,dy=bottom-top;
  const money=key!=='orders';
  const maximum=Math.max(0,...bundles.flatMap(b=>b.points.map(p=>p.value)));
  const step=(()=>{
   const ideal=Math.max(1,Math.ceil(maximum/4)),power=10**Math.floor(Math.log10(ideal));
   return [1,2,5,10].map(x=>x*power).find(x=>x>=ideal)||ideal;
  })();
  const topValue=step*4;
  const xAt=i=>n===1?(left+right)/2:left+(right-left)*i/(n-1);
  const yAt=v=>bottom-Math.max(0,v)/topValue*dy;
  const grid=Array.from({length:5},(_,j)=>{
   const y=bottom-dy*j/4;
   return '<line class="dm-activity-grid-line" x1="'+left+'" y1="'+fix(y)+'" x2="'+right+
    '" y2="'+fix(y)+'"/><text class="dm-activity-y-label" x="'+(left-16)+'" y="'+fix(y+4)+
    '" text-anchor="end">'+esc(human(step*j,money))+'</text>';
  }).join('');
  const labels=(bundles[0]?.points||[]).map((p,i)=>
   (i%Math.max(1,Math.ceil(n/24))===0||i===n-1)?
   '<text class="dm-activity-x-label" text-anchor="end" transform="translate('+
   fix(xAt(i)+4)+' '+(bottom+20)+') rotate(-48)">'+esc(p.label)+'</text>':'').join('');
  const paths=bundles.map((bundle,k)=>{
   const points=bundle.points;
   if(type==='bar'){
    const inner=(right-left)/Math.max(1,n),width=Math.max(3,Math.min(18,inner*.64/bundles.length));
    return points.map((p,i)=>{
     const x=xAt(i)+(k-(bundles.length-1)/2)*width;
     return '<rect x="'+fix(x-width/2)+'" y="'+fix(yAt(p.value))+'" width="'+fix(width-1)+'" '+
      'height="'+fix(Math.max(1,bottom-yAt(p.value)))+'" rx="3" style="fill:'+bundle.color+
      '" class="dm-activity-bar"><title>'+esc(bundle.name+' · '+p.label+' · '+human(p.value,money))+'</title></rect>';
    }).join('');
   }
   return '<path class="dm-activity-line" style="stroke:'+bundle.color+'" d="'+
    linePath(points.map(x=>x.value),xAt,yAt)+'"/>'+
    points.map((p,i)=>'<circle class="dm-activity-marker" cx="'+fix(xAt(i))+
     '" cy="'+fix(yAt(p.value))+'" r="3.2" style="stroke:'+bundle.color+
     '" tabindex="0" role="img" aria-label="'+esc(bundle.name+' '+p.label+' '+human(p.value,money))+
     '"><title>'+esc(bundle.name+' · '+p.label+' · '+human(p.value,money))+'</title></circle>').join('');
  }).join('');
  const legend=bundles.length>1?'<div class="dm-kpi-chart-branch-legend">'+
   bundles.map(b=>'<span><i style="background:'+b.color+'"></i>'+esc(b.name)+'</span>').join('')+'</div>':'';
  const description=interval==='hourly'?'Hourly totals combined across all selected days':
   'Completed sales by calendar day';
  return legend+'<p class="dm-kpi-pie-caption">'+esc(description)+'</p>'+
   '<div class="dm-activity-scroll" tabindex="0" aria-label="Scroll sales activity chart">'+
   '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+w+' '+h+'" width="'+w+'" height="'+h+
   '" class="dm-activity-svg" role="img" aria-label="'+esc(titleFor(key)+' · '+description)+'">'+
   grid+paths+labels+'</svg></div>';
 }
 function draw(host,{datasets,key,interval,type,main}){
  if(!host)return;
  host.innerHTML=type==='pie'?pie(datasets,key,main,interval):lineBar(datasets,key,interval,type);
  if(type==='pie'){
   const total=host.querySelector('#dmKpiPieSelected');
   const elements=[...host.querySelectorAll('[data-kpi-slice]')];
   const select=node=>{
    const i=node?.dataset?.kpiSlice;
    elements.forEach(e=>e.classList.toggle('dm-kpi-pie-selected',i!==undefined&&e.dataset.kpiSlice===i));
    if(total)total.textContent=node?.getAttribute('aria-label')||
      'Total · '+host.querySelector('[data-pie-total]')?.dataset.pieTotal;
   };
   elements.forEach(el=>{
    el.addEventListener('pointerenter',()=>select(el));
    el.addEventListener('focus',()=>select(el));
    el.addEventListener('click',()=>select(el));
   });
   if(!host.dataset.dmKpiPieLeaveBound){
    host.addEventListener('pointerleave',()=>{
     const current=host.querySelector('#dmKpiPieSelected');
     host.querySelectorAll('[data-kpi-slice]').forEach(e=>e.classList.remove('dm-kpi-pie-selected'));
     if(current)current.textContent='Total · '+(host.querySelector('[data-pie-total]')?.dataset.pieTotal||'');
    });
    host.dataset.dmKpiPieLeaveBound='1';
   }
  }
 }
 window.donmacKpiChartRenderer={draw,series,linePath,pie,colors};
})();
