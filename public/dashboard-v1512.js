/* Supplemental Dashboard insights — no changes to core POS/order calculations. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const peso=value=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(value||0));
  const count=value=>Number(value||0).toLocaleString('en-PH',{maximumFractionDigits:0});
  const dateTime=value=>{
    if(!value)return 'Date unavailable';
    try{
      const parsed=new Date(value);
      if(!Number.isFinite(parsed.getTime()))return String(value).slice(0,19).replace('T',' ');
      return new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}).format(parsed);
    }catch(_){return String(value).slice(0,19).replace('T',' ');}
  };
  const posIndex=(cx,cy,r,n,i)=>[cx+Math.sin(i*Math.PI*2/n)*r,cy-Math.cos(i*Math.PI*2/n)*r];

  function renderItemsPerformance(data){
    const art=$('dashboardRadar'),legend=$('dashboardRadarLegend');
    if(!art||!legend)return;
    const products=(Array.isArray(data.topProducts)?data.topProducts:[])
      .filter(x=>x&&Number(x.qty)>0).slice(0,6);
    if(products.length===0){
      art.innerHTML='<div class="dashboard-empty-performance">No products sold in the selected month yet.</div>';
      legend.innerHTML='';art.setAttribute('aria-label','No product sales this month');return;
    }
    if(products.length<3){
      const max=Math.max(1,...products.map(p=>Number(p.qty)||0));
      art.innerHTML='<div class="dashboard-performance-bars">'+products.map(p=>'<div class="dashboard-performance-bar"><div><b>'+esc(p.name)+'</b><span>'+count(p.qty)+' sold</span></div><div class="dashboard-performance-track"><i style="width:'+Math.max(0,Math.min(100,Number(p.qty)/max*100))+'%"></i></div></div>').join('')+'</div>';
      legend.innerHTML='';art.setAttribute('aria-label',products.map(p=>p.name+': '+count(p.qty)+' units').join(', '));return;
    }
    const n=products.length,cx=180,cy=145,r=100,largest=Math.max(1,...products.map(p=>Number(p.qty)||0));
    const point=(radius,index)=>posIndex(cx,cy,radius,n,index).map(v=>v.toFixed(1)).join(',');
    const grids=[.25,.5,.75,1].map(frac=>'<polygon points="'+products.map((_,i)=>point(r*frac,i)).join(' ')+'" fill="none" stroke="#dce9df" stroke-width="1" />').join('');
    const axes=products.map((_,i)=>'<line x1="'+cx+'" y1="'+cy+'" x2="'+posIndex(cx,cy,r,i)[0].toFixed(1)+'" y2="'+posIndex(cx,cy,r,i)[1].toFixed(1)+'" stroke="#e3eae3" stroke-width="1" />').join('');
    const polygon=products.map((p,i)=>point(r*(Number(p.qty)||0)/largest,i)).join(' ');
    const dots=products.map((p,i)=>{
      const [x,y]=posIndex(cx,cy,r*(Number(p.qty)||0)/largest,i);
      return '<circle cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="4.3" fill="#176343" stroke="white" stroke-width="2"><title>'+esc(p.name)+': '+count(p.qty)+' sold</title></circle>';
    }).join('');
    const labels=products.map((p,i)=>{
      const [x,y]=posIndex(cx,cy,r+27,i);
      const label=String(p.name||'Product');
      const shortened=label.length>16?label.slice(0,15)+'…':label;
      return '<text x="'+x.toFixed(1)+'" y="'+(y+4).toFixed(1)+'" text-anchor="middle" font-size="10.5" font-weight="600" fill="#5d7568"><title>'+esc(label)+'</title>'+esc(shortened)+'</text>';
    }).join('');
    art.innerHTML='<svg viewBox="0 0 360 294" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false"><defs><linearGradient id="dashboardProductArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#b4d48e" stop-opacity=".47"/><stop offset="1" stop-color="#e5f0bb" stop-opacity=".2"/></linearGradient></defs>'+grids+axes+'<polygon points="'+polygon+'" fill="url(#dashboardProductArea)" stroke="#3f825b" stroke-width="2" stroke-linejoin="round"/>'+dots+labels+'</svg>';
    art.setAttribute('aria-label','This month top products by quantity: '+products.map(p=>p.name+' '+count(p.qty)).join(', '));
    legend.innerHTML=products.map((p,i)=>'<div class="radar-legend-item"><span class="radar-legend-dot" aria-hidden="true"></span><span class="radar-legend-name" title="'+esc(p.name)+'">'+esc(p.name)+'</span><strong>'+count(p.qty)+'</strong></div>').join('');
  }

  function renderRecentTransactions(data){
    const wrap=$('dashboardRecentTransactions'),scope=$('dashboardRecentScope');
    if(!wrap)return;
    if(scope)scope.textContent=data.branchId==null
      ? 'Latest completed transactions across all branches.'
      : 'Latest completed transactions for this branch.';
    const rows=Array.isArray(data.recentTransactions)?data.recentTransactions:[];
    if(!rows.length){
      wrap.innerHTML='<div class="dashboard-recent-empty">No completed transactions yet for this branch scope.</div>';
      return;
    }
    const body=rows.map(row=>{
      const reference=String(row.reference||'');
      const customer=row.customerName||'Walk-in customer';
      const items=(Array.isArray(row.items)?row.items:[]).map(item=>count(item.qty)+'× '+String(item.name||'Item')).join(', ');
      const compactItems=items.length>82?items.slice(0,79)+'…':items;
      return '<tr>'+
        '<td><strong>'+esc(reference)+'</strong><small>'+esc(dateTime(row.soldAt))+'</small></td>'+
        '<td><b>'+esc(customer)+'</b><small>'+esc(row.orderType||'Take Away')+'</small></td>'+
        '<td class="recent-items" title="'+esc(items)+'">'+esc(compactItems||'—')+'</td>'+
        '<td><span class="dashboard-paymode">'+esc(row.paymentMode||'—')+'</span></td>'+
        '<td class="recent-amount">'+peso(row.amount)+'</td>'+
        '<td><button type="button" class="dashboard-view-sale" data-sale-reference="'+esc(reference)+'" aria-label="View sale '+esc(reference)+'">View</button></td>'+
      '</tr>';
    }).join('');
    wrap.innerHTML='<table class="dashboard-recent-table"><thead><tr><th>Receipt / Date</th><th>Customer / Type</th><th>Items</th><th>Payment</th><th class="recent-amount">Total</th><th></th></tr></thead><tbody>'+body+'</tbody></table>';
  }

  window.renderDonMacDashboardExtras=data=>{
    if(!data)return;
    renderItemsPerformance(data);
    renderRecentTransactions(data);
    const refresh=$('dashboardRecentRefresh');
    if(refresh&&!refresh.dataset.bound){
      refresh.dataset.bound='1';
      refresh.addEventListener('click',()=>$('dashboardRefresh')?.click());
    }
  };
  $('dashboardRecentTransactions')?.addEventListener('click',event=>{
    const button=event.target.closest('button[data-sale-reference]');
    if(!button)return;
    if(typeof window.donmacOpenTransactionDetail==='function')
      window.donmacOpenTransactionDetail(button.dataset.saleReference);
  });
})();
