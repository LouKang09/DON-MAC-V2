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
    if(!art||!legend)return;
    const products=(Array.isArray(data.performanceProducts)?data.performanceProducts:data.topProducts||[])
      .filter(p=>p&&p.name).slice(0,8);
    if(countLabel)countLabel.textContent=products.length+' menu products';
    if(!products.length){
      art.innerHTML='<div class="dashboard-empty-performance">No products in the current catalog.</div>';
      legend.innerHTML='';art.setAttribute('aria-label','No catalog products');return;
    }
    // Eight real product positions (including zero-sales products when present);
    // keep the octagonal grid even with a small catalog, with unused axes unlabeled.
    const N=8,cx=255,cy=171,r=118;
    const point=(radius,i)=>[cx+Math.sin(i*Math.PI*2/N)*radius,cy-Math.cos(i*Math.PI*2/N)*radius];
    const coords=(radius,i)=>point(radius,i).map(v=>v.toFixed(1)).join(',');
    const largest=Math.max(1,...products.map(p=>Number(p.qty)||0));
    const mesh=[.25,.5,.75,1].map(f=>'<polygon points="'+Array.from({length:N},(_,i)=>coords(r*f,i)).join(' ')+'" fill="none" stroke="#e0e9df" stroke-width="1.15"/>').join('');
    const axes=Array.from({length:N},(_,i)=>{
      const [x,y]=point(r,i);
      return '<line x1="'+cx+'" y1="'+cy+'" x2="'+x.toFixed(1)+'" y2="'+y.toFixed(1)+'" stroke="#e6ede6" stroke-width="1.1"/>';
    }).join('');
    // Missing products are not invented: zero-length spokes draw at the center.
    const points=Array.from({length:N},(_,i)=>coords(r*(Number(products[i]?.qty||0)/largest),i)).join(' ');
    const dots=products.map((p,i)=>{
      const [x,y]=point(r*(Number(p.qty||0)/largest),i);
      return '<circle cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="3.8" fill="#24734b" stroke="white" stroke-width="1.9"><title>'+esc(p.name)+': '+number(p.qty)+' sold</title></circle>';
    }).join('');
    const labels=products.map((p,i)=>{
      const [x,y]=point(r+35,i),value=String(p.name);
      const short=value.length>16?value.slice(0,15)+'…':value;
      const anchor=x<cx-42?'end':x>cx+42?'start':'middle';
      return '<text x="'+x.toFixed(1)+'" y="'+(y+3.5).toFixed(1)+'" font-size="11.5" font-weight="600" text-anchor="'+anchor+'" fill="#697d6c"><title>'+esc(value)+'</title>'+esc(short)+'</text>';
    }).join('');
    art.innerHTML='<svg viewBox="0 0 510 350" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">'+
      '<defs><linearGradient id="dashRadarFill" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e4ecb7" stop-opacity=".7"/><stop offset="1" stop-color="#abc881" stop-opacity=".25"/></linearGradient></defs>'+
      mesh+axes+'<polygon points="'+points+'" fill="url(#dashRadarFill)" stroke="#43855c" stroke-width="2.3" stroke-linejoin="round"/>'+dots+labels+'</svg>';
    art.setAttribute('aria-label','Items sold this month: '+products.map(p=>p.name+' '+number(p.qty)).join('; '));
    legend.innerHTML=products.map(p=>'<div class="radar-legend-item"><span class="radar-legend-dot"></span><span class="radar-legend-name" title="'+esc(p.name)+'">'+esc(p.name)+'</span><strong>'+number(p.qty)+'</strong></div>').join('');
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
    renderSalesChart(data);renderItemsPerformance(data);renderRecentTransactions(data);
    for(const id of ['dashboardRecentRefresh','dashboardChartRefresh']){
      const button=$(id);
      if(button&&!button.dataset.bound){
        button.dataset.bound='1';button.addEventListener('click',()=>$('dashboardRefresh')?.click());
      }
    }
  };
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