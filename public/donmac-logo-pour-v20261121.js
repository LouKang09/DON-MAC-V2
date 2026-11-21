/* Don Mac login logo animation — source vector stays visible until SVG is ready.
 * One raise/pour/return per hover, touch or keyboard activation. */
(()=>{
 'use strict';
 const src='/donmac-logo-pour.svg?v=20261121-pour-v1';
 function attach(img,svg){
  svg.classList.add('auth-brand-logo','dm-pour-logo');
  svg.setAttribute('tabindex','0');
  svg.setAttribute('aria-label','Don Macchiatos barista — hover or tap to pour coffee');
  let playing=false;
  const play=()=>{
   if(playing || document.documentElement.classList.contains('dm-icon-motion-off') ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
   playing=true;
   svg.classList.remove('dm-logo-pouring');
   void svg.getBoundingClientRect().width;
   svg.classList.add('dm-logo-pouring');
  };
  svg.addEventListener('pointerenter',e=>{if(e.pointerType!=='touch')play()});
  svg.addEventListener('click',play);
  svg.addEventListener('keydown',e=>{
   if(e.key==='Enter'||e.key===' '){e.preventDefault();play()}
  });
  svg.addEventListener('animationend',e=>{
   if(e.target.id==='dmPourArm'){
    playing=false;
    svg.classList.remove('dm-logo-pouring');
   }
  });
  img.replaceWith(svg);
 }
 const init=async()=>{
  const logos=[...document.querySelectorAll('#authScreen .auth-brand-panel > img.auth-brand-logo')];
  if(!logos.length)return;
  try{
   const response=await fetch(src,{credentials:'same-origin',cache:'no-store'});
   if(!response.ok)throw new Error('Animated logo unavailable: '+response.status);
   const parsed=new DOMParser().parseFromString(await response.text(),'image/svg+xml');
   const base=parsed.documentElement;
   if(base.localName!=='svg'||parsed.querySelector('parsererror'))throw new Error('Invalid logo SVG');
   for(const img of logos){
    if(!img.isConnected)continue;
    const svg=document.importNode(base,true);
    attach(img,svg);
   }
  }catch(error){
   // Original approved logo must always remain visible.
   console.warn('[DonMac Logo] Keeping original static logo:',error.message);
  }
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
 else init();
})();
