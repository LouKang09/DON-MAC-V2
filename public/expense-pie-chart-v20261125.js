(()=>{
 'use strict';
 // Shared, dependency-free expense pie chart: dashboard and Expenses Ledger.
 // The server returns complete category totals for the permitted date and branch.
 const categories=[
  ['rent','Rent','#087E65','#ffffff'],
  ['stocks','Stocks','#E97924','#172e24'],
  ['salary','Salary','#3867D6','#ffffff'],
  ['transportation','Transportation','#8854D0','#ffffff'],
  ['electricity','Electricity','#F2C94C','#172e24'],
  ['ice','Ice','#DD3D72','#ffffff'],
  ['water','Water','#00AABF','#112f39'],
  ['misc','Miscellaneous','#55657C','#ffffff']
 ];
 const escape=x=>String(x??'').replace(/[&<>"']/g,c=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const peso=x=>'₱'+Number(x).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
 const tidy=summary=>{
  const items=categories.map(([key,label,color,textColor])=>({
   key,label,color,textColor,amount:Math.max(0,Number(summary?.[key]||0))
  })).filter(x=>Number.isFinite(x.amount)&&x.amount>0);
  const total=items.reduce((sum,x)=>sum+x.amount,0);
  return {items,total};
 };
 const center=160,radius=108;
 const point=(angle,r=radius)=>{
  const a=(angle-90)*Math.PI/180;
  return{x:center+r*Math.cos(a),y:center+r*Math.sin(a)};
 };
 const coord=n=>Number(n).toFixed(2);
 function piePath(from,to){
  const first=point(from),last=point(to);
  return 'M '+center+' '+center+' L '+coord(first.x)+' '+coord(first.y)+
   ' A '+radius+' '+radius+' 0 '+(to-from>180?1:0)+' 1 '+
   coord(last.x)+' '+coord(last.y)+' Z';
 }
 function markup(summary,options={}){
  const {items,total}=tidy(summary);
  const emptyMessage=options.emptyMessage||'No recorded expenses match the selected filters.';
  if(total<=0)return '<div class="dm-expense-pie-empty">'+escape(emptyMessage)+'</div>';
  let angle=0;
  const sectors=items.map((item,index)=>{
   const from=angle;
   angle=index===items.length-1?360:from+360*item.amount/total;
   return {...item,index,from,to:angle,mid:(from+angle)/2,share:100*item.amount/total};
  });
  // Every slice gets a permanently visible percentage. Small slices
  // receive an external leader label to avoid illegible pie text.
  const narrow=sectors.filter(x=>x.share<8&&sectors.length>1).map(x=>{
   const centerPoint=point(x.mid,137);
   return {...x,labelX:centerPoint.x,labelY:centerPoint.y,
    side:centerPoint.x>=center?'right':'left'};
  });
  for(const side of ['left','right']){
   const labels=narrow.filter(x=>x.side===side).sort((a,b)=>a.labelY-b.labelY);
   let previous=15;
   for(const label of labels){
    label.labelY=Math.min(301,Math.max(previous+14,label.labelY));
    previous=label.labelY;
   }
   if(labels.length&&labels[labels.length-1].labelY>294){
    let next=294;
    for(let i=labels.length-1;i>=0;i--){
     labels[i].labelY=Math.min(labels[i].labelY,next);
     next=labels[i].labelY-14;
    }
   }
  }
  const slices=sectors.map(x=>{
   const percent=x.share.toFixed(1)+'%';
   const element=sectors.length===1?
    '<circle cx="'+center+'" cy="'+center+'" r="'+radius+'" fill="'+x.color+'"></circle>':
    '<path d="'+piePath(x.from,x.to)+'" fill="'+x.color+'"></path>';
   return '<g class="dm-expense-pie-slice" tabindex="0" role="button" aria-label="'+
    escape(x.label+': '+peso(x.amount)+' ('+percent+')')+'" '+
    'data-dm-exp-pie-name="'+escape(x.label)+'" data-dm-exp-pie-value="'+
    escape(peso(x.amount))+'" data-dm-exp-pie-share="'+percent+'" '+
    'data-dm-exp-pie-index="'+x.index+'">'+element+'</g>';
  }).join('');
  const labels=sectors.map(x=>{
   const label=x.share.toFixed(1)+'%';
   const small=narrow.find(n=>n.index===x.index);
   if(small){
    const origin=point(x.mid,112),elbow=point(x.mid,125);
    const xText=Math.max(22,Math.min(298,small.labelX+(small.side==='right'?8:-8)));
    return '<g class="dm-expense-pie-percent dm-expense-pie-percent-external" aria-hidden="true">'+
     '<path d="M '+coord(origin.x)+' '+coord(origin.y)+' L '+coord(elbow.x)+' '+coord(elbow.y)+
     ' L '+coord(xText)+' '+coord(small.labelY)+'" fill="none" stroke="'+x.color+
     '" stroke-width="1.6"></path>'+
     '<text x="'+coord(xText)+'" y="'+coord(small.labelY)+'" text-anchor="'+
     (small.side==='right'?'start':'end')+'" dominant-baseline="middle">'+label+'</text></g>';
   }
   const p=point(x.mid,70);
   return '<text class="dm-expense-pie-percent dm-expense-pie-percent-inside" x="'+
    coord(p.x)+'" y="'+coord(p.y)+'" text-anchor="middle" dominant-baseline="middle" '+
    'fill="'+x.textColor+'" aria-hidden="true">'+label+'</text>';
  }).join('');
  const legend=sectors.map(x=>'<button class="dm-expense-pie-legend-row" type="button" '+
   'data-dm-exp-pie-name="'+escape(x.label)+'" data-dm-exp-pie-value="'+escape(peso(x.amount))+
   '" data-dm-exp-pie-share="'+x.share.toFixed(1)+'%" '+
   'data-dm-exp-pie-index="'+x.index+'" aria-label="'+escape(x.label+': '+peso(x.amount))+'">'+
   '<span class="dm-expense-pie-swatch" style="background:'+x.color+'"></span>'+
   '<span class="dm-expense-pie-legend-label">'+escape(x.label)+'</span>'+
   '<strong>'+escape(peso(x.amount))+'</strong>'+
   '<small>'+x.share.toFixed(1)+'%</small></button>').join('');
  return '<div class="dm-expense-pie" data-dm-exp-pie-total="'+escape(peso(total))+'">'+
   '<div class="dm-expense-pie-chart">'+
   '<svg viewBox="0 0 320 320" width="320" height="320" role="group" aria-label="Expense categories pie chart">'+
   slices+labels+'</svg>'+
   '<div class="dm-expense-pie-tooltip" role="status" aria-live="polite">'+
   '<span data-dm-exp-pie-current-name>Total expenses</span>'+
   '<strong data-dm-exp-pie-current-value>'+escape(peso(total))+'</strong>'+
   '<small data-dm-exp-pie-current-share>Hover a segment or category</small></div>'+
   '</div><div class="dm-expense-pie-legend">'+legend+'</div></div>';
 }
 function mount(host){
  if(!host||host.dataset.dmExpensePieBound==='1')return;
  host.dataset.dmExpensePieBound='1';
  const selector='[data-dm-exp-pie-index]';
  const highlight=el=>{
   const graph=host.querySelector('.dm-expense-pie');
   if(!graph)return;
   const index=el?.dataset?.dmExpPieIndex??null;
   for(const target of graph.querySelectorAll(selector))
    target.classList.toggle('dm-expense-pie-active',index!==null&&target.dataset.dmExpPieIndex===index);
   const name=graph.querySelector('[data-dm-exp-pie-current-name]'),
    value=graph.querySelector('[data-dm-exp-pie-current-value]'),
    share=graph.querySelector('[data-dm-exp-pie-current-share]');
   if(name)name.textContent=el?.dataset?.dmExpPieName||'Total expenses';
   if(value)value.textContent=el?.dataset?.dmExpPieValue||graph.dataset.dmExpPieTotal;
   if(share)share.textContent=el?.dataset?.dmExpPieShare||'Hover a segment or category';
  };
  host.addEventListener('pointerover',event=>{
   const item=event.target.closest?.(selector);
   if(item&&host.contains(item))highlight(item);
  });
  host.addEventListener('pointerleave',()=>highlight(null));
  host.addEventListener('focusin',event=>{
   const item=event.target.closest?.(selector);
   if(item&&host.contains(item))highlight(item);
  });
  host.addEventListener('focusout',event=>{
   if(!host.contains(event.relatedTarget))highlight(null);
  });
  host.addEventListener('click',event=>{
   const item=event.target.closest?.(selector);
   if(item&&host.contains(item))highlight(item);
  });
  host.addEventListener('keydown',event=>{
   if(event.key==='Escape')highlight(null);
  });
 }
 window.donmacExpensePie={markup,mount,tidy};
})();
