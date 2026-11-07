/* Don Macchiatos Dashboard v1.5.13: reference-inspired SVG charts, actual sales only. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const peso=value=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(value||0));
  const number=value=>Number(value||0).toLocaleString('en-PH',{maximumFractionDigits:0});
  const dateTime=value=>{
    if(!value)return 'Date unavailable';
    try {
      const parsed=new Date(value);
      return Number.isFinite(parsed.getTime())?
        new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}).format(parsed):
        String(value).slice(0,19).replace('T',' ');
    } catch(_){return String(value).slice(0,19).replace('T',' ');}
  };
  const palette={
    'Coffee':'#176943','Non Coffee':'#edba3e','Food':'#f17072',
    'Add-ons':'#43a7a6','Packages':'#9780bb','Other':'#82928c'
  };
  const hiddenSeries=new Set();
  let currentData=null;

  let chartMode='lines';
  function showChartTip(event,content){
    const tip=$('trendTooltip'),holder=$('salesTrendChart');
    if(!tip||!holder)return;
    const rect=holder.getBoundingClientRect();
    tip.innerHTML=content;
    tip.style.left=Math.max(75,Math.min(rect.width-75,event.clientX-rect.left))+'px';
    tip.style.top=Math.max(26,Math.min(rect.height-18,event.clientY-rect.top-18))+'px';
    tip.classList.remove('hidden');
  }
  // Tiles renders grouped vertical columns (categories beside one another per period).
  function renderTileChart(holder,tip,labels,active){
    if(!active.length){
      holder.innerHTML='<div class="dashboard-recent-empty">Select a category to compare sales.</div>';
      return;
    }
    const count=labels.length,seriesCount=active.length;
    const groupWidth=Math.max(56,Math.min(112,seriesCount*17+24));
    const W=Math.max(660,80+count*groupWidth),H=304,L=62,R=18,T=20,B=48;
    const plotW=W-L-R,plotH=H-T-B;
    const max=Math.max(1,...active.flatMap(s=>s.values.map(v=>Math.max(0,Number(v)||0))));
    const magnitude=Math.pow(10,Math.floor(Math.log10(max))),normalized=max/magnitude;
    const multiplier=normalized<=1?1:normalized<=2?2:normalized<=2.5?2.5:normalized<=5?5:10;
    const ceiling=Math.max(1,multiplier*magnitude);
    const step=plotW/count,spacing=3;
    const barWidth=Math.max(4,Math.min(22,(step-15-(seriesCount-1)*spacing)/seriesCount));
    const cluster=seriesCount*barWidth+(seriesCount-1)*spacing;
    const fmt=value=>value>=1000000?(value/1000000).toFixed(1)+'m':
      value>=1000?(value/1000).toFixed(value%1000===0?0:1)+'k':
      Number(value.toFixed(2)).toLocaleString('en-PH');
    const grid=Array.from({length:5},(_,i)=>{
      const y=T+i*plotH/4,amount=ceiling*(4-i)/4;
      return '<line x1="'+L+'" x2="'+(W-R)+'" y1="'+y+'" y2="'+y+
        '" stroke="#d9dfd9" stroke-width="1"/>'+
        '<text x="'+(L-11)+'" y="'+(y+4)+'" text-anchor="end" fill="#526658" font-size="12">'+
        fmt(amount)+'</text>';
    }).join('');
    const every=Math.max(1,Math.ceil(count/12));
    const ticks=labels.map((label,i)=>{
      if(i!==0&&i!==count-1&&i%every!==0)return '';
      const x=L+(i+.5)*step;
      return '<text x="'+x+'" y="'+(H-17)+'" text-anchor="middle" font-size="12" fill="#53695a">'+
        esc(label)+'</text>';
    }).join('');
    const rects=labels.map((label,i)=>{
      const x0=L+i*step+(step-cluster)/2;
      return active.map((series,j)=>{
        const amount=Math.max(0,Number(series.values[i])||0);
        const height=amount/ceiling*plotH;
        if(height<=0)return '';
        const x=x0+j*(barWidth+spacing),y=T+plotH-height;
        return '<rect class="dm-bar-column" data-bar-series="'+esc(series.name)+
          '" data-bar-index="'+i+'" tabindex="0" role="img" aria-label="'+
          esc(series.name+' · '+label+' · '+peso(amount))+'" '+
          'x="'+x.toFixed(2)+'" y="'+y.toFixed(2)+'" width="'+barWidth.toFixed(2)+
          '" height="'+height.toFixed(2)+'" rx="1.5" fill="'+
          (palette[series.name]||'#6d8f7c')+'"/>';
      }).join('');
    }).join('');
    holder.innerHTML='<div class="dm-bars-scroll" role="group" aria-label="Grouped sales columns. Scroll for more dates.">'+
      '<svg class="dm-bars-svg" width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+
      '" xmlns="http://www.w3.org/2000/svg" aria-label="Grouped column chart of category sales">'+
      '<g>'+grid+ticks+'</g><g>'+rects+'</g></svg></div>';
    holder.setAttribute('aria-label','Grouped sales columns: '+active.map(s=>s.name+
      ' '+peso(s.values.reduce((n,v)=>n+Number(v||0),0))).join('; '));
    function announce(event,el){
      const series=active.find(s=>s.name===el.dataset.barSeries),i=Number(el.dataset.barIndex);
      if(!series||!Number.isInteger(i)||i<0||i>=labels.length)return;
      showChartTip(event,'<span>'+esc(labels[i])+' · '+esc(series.name)+'</span>'+
        '<div><strong>'+peso(series.values[i])+'</strong></div>');
    }
    holder.onpointermove=event=>{
      const bar=event.target.closest('.dm-bar-column');
      if(bar)announce(event,bar);else tip?.classList.add('hidden');
    };
    holder.onpointerleave=()=>tip?.classList.add('hidden');
    holder.onfocusin=event=>{
      const bar=event.target.closest('.dm-bar-column');if(!bar)return;
      const rect=bar.getBoundingClientRect();
      announce({clientX:rect.left+rect.width/2,clientY:rect.top},bar);
    };
    holder.onfocusout=()=>tip?.classList.add('hidden');
  }
  function renderPieChart(holder,tip,active){
    const segments=active.map(s=>({
      name:s.name,value:s.values.reduce((sum,v)=>sum+(Number(v)||0),0),
      color:palette[s.name]||'#6d8f7c'
    })).filter(s=>s.value>0);
    const total=segments.reduce((sum,s)=>sum+s.value,0);
    if(!total){
      holder.innerHTML='<div class="dashboard-recent-empty">No completed sales for this range.</div>';
      holder.setAttribute('aria-label','No completed sales for this range');return;
    }
    const cx=165,cy=150,r=112;
    let angle=-Math.PI/2;
    const shapes=segments.map((s,i)=>{
      const span=s.value/total*2*Math.PI,finish=angle+span;
      const start=[cx+r*Math.cos(angle),cy+r*Math.sin(angle)];
      const end=[cx+r*Math.cos(finish),cy+r*Math.sin(finish)];
      const arc=segments.length===1?
        '<circle cx="'+cx+'" cy="'+cy+'" r="'+r+'" fill="'+s.color+'"/>':
        '<path d="M '+cx+' '+cy+' L '+start[0]+' '+start[1]+' A '+r+' '+r+' 0 '+(span>Math.PI?1:0)+
          ' 1 '+end[0]+' '+end[1]+' Z" fill="'+s.color+'"/>';
      angle=finish;
      return '<g tabindex="0" class="dm-pie-segment" data-pie-index="'+i+'" role="img" aria-label="'+
        esc(s.name+' '+peso(s.value)+' '+(s.value/total*100).toFixed(1)+' percent')+'">'+arc+'</g>';
    }).join('');
    holder.innerHTML='<div class="dm-pie-chart"><svg viewBox="0 0 330 300" aria-label="Sales share by category">'+
      shapes+'<circle cx="165" cy="150" r="60" fill="white" pointer-events="none"/>'+
      '<text x="165" y="143" text-anchor="middle" fill="#456451" font-size="13" pointer-events="none">NET SALES</text>'+
      '<text x="165" y="165" text-anchor="middle" fill="#153d2a" font-size="19" font-weight="800" pointer-events="none">'+
      esc(peso(total))+'</text></svg></div>';
    holder.setAttribute('aria-label','Net sales by category: '+segments.map(s=>s.name+' '+peso(s.value)).join('; '));
    function announce(event,element){
      const selected=segments[Number(element.dataset.pieIndex)];if(!selected)return;
      showChartTip(event,'<span>'+esc(selected.name)+' · '+(selected.value/total*100).toFixed(1)+'%</span>'+
        '<div><strong>'+peso(selected.value)+'</strong></div>');
    }
    holder.onpointermove=event=>{
      const segment=event.target.closest('.dm-pie-segment');
      if(segment)announce(event,segment);else tip?.classList.add('hidden');
    };
    holder.onpointerleave=()=>tip?.classList.add('hidden');
    holder.onfocusin=event=>{
      const segment=event.target.closest('.dm-pie-segment');if(!segment)return;
      const rect=segment.getBoundingClientRect();
      announce({clientX:rect.left+rect.width/2,clientY:rect.top+rect.height/2},segment);
    };
    holder.onfocusout=()=>tip?.classList.add('hidden');
  }

  function renderSalesChart(data){
    const holder=$('salesTrendChart'),legend=$('dashboardSalesLegend'),tip=$('trendTooltip');
    if(!holder||!legend)return;
    const labels=(data.trend||[]).map(p=>p.label);
    const series=(Array.isArray(data.categoryTrends)?data.categoryTrends:[]).filter(x=>Array.isArray(x.values));
    const range=$('dashboardRangePill');
    if(range)range.textContent=data.grain==='hourly'?'Day':'Date range';
    if(!labels.length||!series.length){
      holder.innerHTML='<div class="dashboard-recent-empty">No sales data for this period.</div>';
      legend.innerHTML='';if(tip)tip.classList.add('hidden');return;
    }
    legend.innerHTML=series.map(s=>'<button class="dashboard-series-key'+(hiddenSeries.has(s.name)?' series-muted':'')+'" type="button" data-series="'+esc(s.name)+'" aria-pressed="'+String(!hiddenSeries.has(s.name))+'" title="'+esc(s.name)+' sales"><i style="background:'+palette[s.name]+'"></i>'+esc(s.name)+'</button>').join('');
    const active=series.filter(s=>!hiddenSeries.has(s.name));
    holder.onpointermove=null;holder.onpointerleave=null;holder.onfocusin=null;holder.onfocusout=null;
    if(chartMode==='tiles'){renderTileChart(holder,tip,labels,active);return;}
    if(chartMode==='pie'){renderPieChart(holder,tip,active);return;}
    const maxValue=Math.max(1,...active.flatMap(s=>s.values.map(Number)));
    const W=990,H=295,L=69,R=23,T=27,B=43;
    const PW=W-L-R,PH=H-T-B;
    const ceiling=maxValue<=5?5:Math.ceil(maxValue/5)*5;
    const pos=(value,index)=>({
      x:L+(labels.length<=1?PW/2:index/(labels.length-1)*PW),
      y:T+PH-Math.max(0,Number(value)||0)/ceiling*PH
    });
    const yLines=Array.from({length:5},(_,i)=>{
      const y=T+i*PH/4,value=ceiling*(4-i)/4;
      return '<line x1="'+L+'" y1="'+y+'" x2="'+(W-R)+'" y2="'+y+'" stroke="#e5ece5" stroke-width="1"/>'+
        '<text x="'+(L-12)+'" y="'+(y+3.5)+'" fill="#86968c" text-anchor="end" font-size="12">'+
        esc(value>=1000?(value/1000).toFixed(1)+'k':Math.round(value*100)/100)+'</text>';
    }).join('');
    const ticks=[];
    const labelEvery=Math.max(1,Math.ceil(labels.length/7));
    labels.forEach((label,i)=>{
      if(i!==0&&i!==labels.length-1&&i%labelEvery!==0)return;
      const x=pos(0,i).x;
      ticks.push('<line x1="'+x+'" y1="'+T+'" x2="'+x+'" y2="'+(T+PH)+'" stroke="#e8eee9" stroke-dasharray="2 8" />'+
        '<text x="'+x+'" y="'+(H-12)+'" font-size="12" text-anchor="middle" fill="#899990">'+esc(label)+'</text>');
    });
    const smoothPath=pts=>{
      if(!pts.length)return '';
      let d='M'+pts[0].x.toFixed(2)+','+pts[0].y.toFixed(2);
      for(let i=1;i<pts.length;i++){
        const a=pts[i-1],b=pts[i],dx=(b.x-a.x)/3;
        d+=' C'+(a.x+dx).toFixed(2)+','+a.y.toFixed(2)+' '+(b.x-dx).toFixed(2)+','+b.y.toFixed(2)+' '+b.x.toFixed(2)+','+b.y.toFixed(2);
      }
      return d;
    };
    const lines=active.map(s=>{
      const pts=s.values.map((v,i)=>pos(v,i));
      const color=palette[s.name]||'#6d8f7c';
      const d=smoothPath(pts);
      return '<path d="'+d+'" fill="none" stroke="'+color+'" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>';
    }).join('');
    const hadSales=active.some(s=>s.values.some(v=>Number(v)>0));
    holder.innerHTML='<svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" class="dashboard-sales-svg" aria-hidden="true" focusable="false">'+
      '<g>'+yLines+ticks.join('')+'</g><g>'+lines+'</g>'+
      '<line id="dashboardGraphGuide" x1="-20" y1="'+T+'" x2="-20" y2="'+(T+PH)+'" stroke="#9eaaa0" stroke-dasharray="4 5" stroke-width="1.3"/>'+
      '<circle id="dashboardGraphDot" cx="-20" cy="-20" r="5" fill="#176943" stroke="white" stroke-width="2"/>'+
      '</svg>'+
      (!hadSales?'<span class="dashboard-chart-no-sales">No recorded category sales for this range</span>':'');
    holder.setAttribute('aria-label','Sales by category: '+active.map(s=>s.name+', total '+peso(s.values.reduce((a,v)=>a+Number(v||0),0))).join('; '));

    const svg=holder.querySelector('svg');
    const nearest=(evt)=>{
      if(!svg||!active.length||!tip)return;
      const rect=svg.getBoundingClientRect();
      const x=(evt.clientX-rect.left)/rect.width*W;
      const y=(evt.clientY-rect.top)/rect.height*H;
      if(x<L-15||x>W-R+15||y<T-12||y>T+PH+18){tip.classList.add('hidden');return;}
      const index=Math.max(0,Math.min(labels.length-1,Math.round((x-L)/PW*(labels.length-1))));
      let selected=null,dist=Infinity;
      for(const s of active){
        const p=pos(s.values[index],index);
        const diff=Math.abs(p.y-y);
        if(diff<dist){selected={s,p};dist=diff;}
      }
      if(!selected)return;
      const dot=svg.querySelector('#dashboardGraphDot'),guide=svg.querySelector('#dashboardGraphGuide');
      dot.setAttribute('cx',selected.p.x);dot.setAttribute('cy',selected.p.y);
      dot.setAttribute('fill',palette[selected.s.name]||'#176943');
      guide.setAttribute('x1',selected.p.x);guide.setAttribute('x2',selected.p.x);
      tip.innerHTML='<span>'+esc(labels[index])+' · '+esc(selected.s.name)+'</span><div><strong>'+peso(selected.s.values[index])+'</strong></div>';
      const wrap=holder.getBoundingClientRect();
      tip.style.left=Math.max(74,Math.min(wrap.width-76,(selected.p.x/W)*wrap.width))+'px';
      tip.style.top=Math.max(24,selected.p.y/H*wrap.height-9)+'px';
      tip.classList.remove('hidden');
    };
    svg.addEventListener('pointermove',nearest);
    svg.addEventListener('pointerdown',nearest);
    svg.addEventListener('pointerleave',()=>{
      tip?.classList.add('hidden');
      svg.querySelector('#dashboardGraphGuide')?.setAttribute('x1','-20');
      svg.querySelector('#dashboardGraphGuide')?.setAttribute('x2','-20');
      svg.querySelector('#dashboardGraphDot')?.setAttribute('cx','-20');
    });
  }

  function renderItemsPerformance(data){
    const art=$('dashboardRadar'),legend=$('dashboardRadarLegend'),countLabel=$('performanceCountLabel');
    if(!legend)return;
    // Product-quantity list only. The old spider-web SVG has been retired.
    if(art)art.remove();
    const products=(Array.isArray(data.performanceProducts)?data.performanceProducts:data.topProducts||[])
      .filter(p=>p&&p.name).slice(0,8);
    if(countLabel)countLabel.textContent=products.length+' menu products';
    legend.innerHTML=products.length?products.map(p=>
      '<div class="radar-legend-item"><span class="radar-legend-dot"></span>'+
      '<span class="radar-legend-name" title="'+esc(p.name)+'">'+esc(p.name)+'</span>'+
      '<strong>'+number(p.qty)+'</strong></div>').join(''):
      '<div class="dashboard-empty-performance">No product sales for this period.</div>';
    legend.setAttribute('aria-label','Product quantities: '+products.map(p=>p.name+' '+number(p.qty)).join('; '));
  }

  function renderRecentTransactions(data){
    const wrap=$('dashboardRecentTransactions'),scope=$('dashboardRecentScope');
    if(!wrap)return;
    if(scope)scope.textContent=data.branchId==null?'Latest orders across all branches.':'Latest orders for the selected branch.';
    const rows=Array.isArray(data.recentTransactions)?data.recentTransactions:[];
    if(!rows.length){
      wrap.innerHTML='<div class="dashboard-recent-empty">No completed transactions yet for this branch scope.</div>';return;
    }
    const body=rows.map(row=>{
      const ref=String(row.reference||''),customer=row.customerName||'Walk-in customer';
      const items=(Array.isArray(row.items)?row.items:[]).map(x=>number(x.qty)+'× '+String(x.name||'Item')).join(', ');
      return '<tr><td><strong>'+esc(ref)+'</strong><small>'+esc(dateTime(row.soldAt))+'</small></td>'+
        '<td><b>'+esc(customer)+'</b><small>'+esc(row.orderType||'Take Away')+'</small></td>'+
        '<td class="recent-items" title="'+esc(items)+'">'+esc(items.length>80?items.slice(0,78)+'…':items||'—')+'</td>'+
        '<td><span class="dashboard-paymode">'+esc(row.paymentMode||'—')+'</span></td>'+
        '<td class="recent-amount">'+peso(row.amount)+'</td>'+
        '<td><button type="button" class="dashboard-view-sale" data-sale-reference="'+esc(ref)+'" aria-label="View sale '+esc(ref)+'">View</button></td></tr>';
    }).join('');
    wrap.innerHTML='<table class="dashboard-recent-table"><thead><tr><th>Receipt / Date</th><th>Customer / Type</th><th>Items</th><th>Payment</th><th class="recent-amount">Total</th><th></th></tr></thead><tbody>'+body+'</tbody></table>';
  }

  window.renderDonMacDashboardExtras=data=>{
    if(!data)return;
    currentData=data;
    renderSalesChart(data);renderItemsPerformance(data);
    if(!window.donmacDashboardFilters)renderRecentTransactions(data);
    for(const id of ['dashboardRecentRefresh','dashboardChartRefresh']){
      const button=$(id);
      if(button&&!button.dataset.bound){
        button.dataset.bound='1';button.addEventListener('click',()=>$('dashboardRefresh')?.click());
      }
    }
  };
  $('dashboardChartMode')?.addEventListener('change',event=>{
    chartMode=['lines','tiles','pie'].includes(event.target.value)?event.target.value:'lines';
    if(currentData)renderSalesChart(currentData);
  });
  $('dashboardSalesLegend')?.addEventListener('click',event=>{
    const button=event.target.closest('button[data-series]');if(!button)return;
    const name=button.dataset.series;
    if(hiddenSeries.has(name))hiddenSeries.delete(name);else hiddenSeries.add(name);
    if(currentData)renderSalesChart(currentData);
  });
  $('dashboardRecentTransactions')?.addEventListener('click',event=>{
    const button=event.target.closest('button[data-sale-reference]');
    if(button&&typeof window.donmacOpenTransactionDetail==='function')
      window.donmacOpenTransactionDetail(button.dataset.saleReference);
  });
  if(window.__donmacDashboardData)window.renderDonMacDashboardExtras(window.__donmacDashboardData);
})();