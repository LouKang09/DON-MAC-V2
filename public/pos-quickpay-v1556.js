/* v1.5.59: Viewport-aware fixed checkout with off-screen Pay fallback.
   Delegates to the original native Pay button; does not alter cart or payment APIs. */
(() => {
  'use strict';
  const nativePay=document.getElementById('payButton');
  const posView=document.getElementById('view-pos');
  const order=document.querySelector('#view-pos .order-panel');
  if(!nativePay||!posView||!order||document.getElementById('posQuickPayDock'))return;

  const quick=document.createElement('button');
  quick.id='posQuickPayDock';
  quick.type='button';
  quick.setAttribute('aria-label','View current checkout');
  quick.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5h2l2.5 11h10.5l2-8H6"/><circle cx="10" cy="20" r="1"/><circle cx="18" cy="20" r="1"/></svg><span>View Checkout</span>';
  document.body.appendChild(quick);

  const desktopPane=window.matchMedia('(min-width:700px)');
  let scheduled=false;

  function renderedInViewport(element){
    const style=window.getComputedStyle(element);
    if(style.display==='none'||style.visibility==='hidden')return false;
    const rect=element.getBoundingClientRect();
    const viewHeight=window.visualViewport?.height||window.innerHeight;
    const top=window.visualViewport?.offsetTop||0;
    return rect.width>0&&rect.height>0&&rect.top>=top+2&&rect.bottom<=top+viewHeight-2;
  }

  function setMetric(name,value){
    if(order.style.getPropertyValue(name)!==value)order.style.setProperty(name,value);
  }

  function update(){
    scheduled=false;
    const active=posView.classList.contains('active')&&
      !document.getElementById('app')?.classList.contains('hidden');
    const hasDialog=!!document.querySelector('dialog[open]');

    // Anchor the checkout to the actual visible viewport (not the height
    // of the product grid). Handles browser zoom, compact laptop windows
    // and Android's desktop-site mode without guessing a fixed header size.
    if(desktopPane.matches){
      const header=document.querySelector('#app .topbar');
      const headerBottom=header?.getBoundingClientRect().bottom||82;
      const visibleHeight=window.visualViewport?.height||window.innerHeight;
      const top=Math.max(0,Math.min(Math.round(headerBottom+8),Math.max(0,visibleHeight-200)));
      const height=Math.max(160,Math.round(visibleHeight-top-12));
      setMetric('--pos-payment-top',top+'px');
      setMetric('--pos-payment-height',height+'px');
      const box=order.getBoundingClientRect();
      const left=Math.max(8,Math.round(box.left+10));
      const width=Math.max(100,Math.min(Math.round(box.width-20),Math.round(window.innerWidth-left-8)));
      if(box.width>120){
        quick.style.setProperty('--pos-pay-dock-left',left+'px');
        quick.style.setProperty('--pos-pay-dock-width',width+'px');
      }
    }else{
      order.style.removeProperty('--pos-payment-top');
      order.style.removeProperty('--pos-payment-height');
      quick.style.removeProperty('--pos-pay-dock-left');
      quick.style.removeProperty('--pos-pay-dock-width');
    }

    const offScreen=!renderedInViewport(nativePay);
    const show=active&&!hasDialog&&offScreen;
    document.body.classList.toggle('pos-quickpay-visible',show);

    const ready=!nativePay.disabled&&nativePay.isConnected;
    const label=ready?(nativePay.textContent||'Pay').trim():'View Checkout';
    const display=quick.querySelector('span');
    if(display&&display.textContent!==label)display.textContent=label;
    quick.dataset.action=ready?'pay':'view';
    quick.setAttribute('aria-label',ready?'Open payment for '+label:'View current order and checkout');
    quick.title=ready?'Continue to payment':'Scroll to the current order';
  }

  function schedule(){
    if(scheduled)return;
    scheduled=true;
    requestAnimationFrame(update);
  }

  quick.addEventListener('click',()=>{
    if(!posView.classList.contains('active'))return;
    if(!nativePay.disabled){
      nativePay.click();
      schedule();
    }else{
      order.scrollIntoView({behavior:'smooth',block:'start'});
      order.scrollTop=order.scrollHeight;
    }
  });

  const observer=new MutationObserver(schedule);
  observer.observe(nativePay,{attributes:true,attributeFilter:['disabled','class','hidden'],childList:true,characterData:true,subtree:true});
  observer.observe(posView,{attributes:true,attributeFilter:['class']});
  const app=document.getElementById('app');
  if(app)observer.observe(app,{attributes:true,attributeFilter:['class']});

  document.addEventListener('scroll',schedule,{passive:true,capture:true});
  window.addEventListener('resize',schedule,{passive:true});
  window.visualViewport?.addEventListener('resize',schedule,{passive:true});
  window.visualViewport?.addEventListener('scroll',schedule,{passive:true});
  if(typeof ResizeObserver==='function'){
    const bar=document.querySelector('#app .topbar');
    if(bar)new ResizeObserver(schedule).observe(bar);
  }
  desktopPane.addEventListener?.('change',schedule);
  document.addEventListener('visibilitychange',schedule);
  update();
})();
