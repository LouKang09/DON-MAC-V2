(()=>{
 'use strict';
 // Shared, dependency-free expense pie chart: dashboard and Expenses Ledger.
 // The server returns complete category totals for the permitted date and branch.
 const categories=[
  ['rent','Rent','#136f50'],['stocks','Stocks','#248d70'],
  ['salary','Salary','#459d83'],['transportation','Transportation','#78b29b'],
  ['electricity','Electricity','#e7ac47'],['ice','Ice','#d68b44'],
  ['water','Water','#5b9ec6'],['misc','Miscellaneous','#7b7dc6']
 ];
 const escape=x=>String(x??'').replace(/[&<>"']/g,c=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const peso=x=>'₱'+Number(x).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
 const tidy=summary=>{
  const items=categories.map(([key,label,color])=>({key,label,color,
   amount:Math.max(0,Number(summary?.[key]||0))}))
   .filter(x=>Number.isFinite(x.amount)&&x.amount>0);
  const total=items.reduce((sum,x)=>sum+x.amount,0);
  return {items,total};
 };
 const point=(angle,r=100)=>{
  const a=(angle-90)*Math.PI/180;
  return{x:(120+r*Math.cos(a)).toFixed(3),y:(120+r*Math.sin(a)).toFixed(3)};
 };
 function piePath(from,to){
  const first=point(from),last=point(to);
  return 'M 120 120 L '+first.x+' '+first.y+
   ' A 100 100 0 '+(to-from>180?1:0)+' 1 '+last.x+' '+last.y+' Z';
 }
 function markup(summary,options={}){
  const {items,total}=tidy(summary);
  const emptyMessage=options.emptyMessage||'No recorded expenses match the selected filters.';
  if(total<=0)return '<div class="dm-expense-pie-empty">'+escape(emptyMessage)+'</div>';
  let angle=0;
  const slices=items.map((item,index)=>{
   const start=angle;angle=index===items.length-1?360:start+360*item.amount/total;
   const percent=(100*item.amount/total).toFixed(1);
   const element=items.length===1?
    '<circle cx="120" cy="120" r="100" fill="'+item.color+'"></circle>':
    '<path d="'+piePath(start,angle)+'" fill="'+item.color+'"></path>';
   return '<g class="dm-expense-pie-slice" tabindex="0" role="button" aria-label="'+
    escape(item.label+': '+peso(item.amount)+' ('+percent+'%)')+'" '+
    'data-dm-exp-pie-name="'+escape(item.label)+'" data-dm-exp-pie-value="'+
    escape(peso(item.amount))+'" data-dm-exp-pie-share="'+percent+'%" '+
    'data-dm-exp-pie-index="'+index+'">'+element+'</g>';
  }).join('');
  const legend=items.map((item,index)=>'<button class="dm-expense-pie-legend-row" type="button" '+
   'data-dm-exp-pie-name="'+escape(item.label)+'" data-dm-exp-pie-value="'+escape(peso(item.amount))+
   '" data-dm-exp-pie-share="'+(100*item.amount/total).toFixed(1)+'%" '+
   'data-dm-exp-pie-index="'+index+'" aria-label="'+escape(item.label+': '+peso(item.amount))+'">'+
   '<span class="dm-expense-pie-swatch" style="background:'+item.color+'"></span>'+
   '<span class="dm-expense-pie-legend-label">'+escape(item.label)+'</span>'+
   '<strong>'+escape(peso(item.amount))+'</strong>'+
   '<small>'+(100*item.amount/total).toFixed(1)+'%</small></button>').join('');
  return '<div class="dm-expense-pie" data-dm-exp-pie-total="'+escape(peso(total))+'">'+
   '<div class="dm-expense-pie-chart">'+
   '<svg viewBox="0 0 240 240" width="240" height="240" role="group" aria-label="Expense categories pie chart">'+
   slices+'</svg>'+
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
