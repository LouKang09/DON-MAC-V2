/* Don Macchiatos login logo — user's exact SVG.
 * The idle asset is extracted from the same vector paths as the animated asset.
 * Ease the idle artwork into its final scale before starting SMIL pouring.
 * Leaving hover restores idle immediately; the scale eases gently to rest.
 */
(()=>{
 'use strict';
 const idle='/donmac-logo-hover-still.svg?v=20261121-framed-v1';
 const animated='/donmac-logo-hover-original.svg?v=20261121-framed-v1';
 const ZOOM_MS=280;
 const POUR_MS=4800;
 let cycle=0;
 function init(){
  document.querySelectorAll('#authScreen .auth-brand-panel > img.auth-brand-logo').forEach(img=>{
   if(img.dataset.dmPourBound==='1')return;
   img.dataset.dmPourBound='1';
   img.tabIndex=0;
   img.setAttribute('role','button');
   img.setAttribute('aria-label','Don Macchiatos logo — hover or tap to pour coffee');
   img.title='Hover or tap to pour coffee';
   let phase='idle',prep=0,finish=0;
   let hasPointer=false;
   // The HTML already uses the identical still frame. The fallback remains
   // the original logo if this new asset is unexpectedly unavailable.
   const fallback=img.getAttribute('src')||idle;
   function clearTimers(){clearTimeout(prep);clearTimeout(finish);}
   function restore(){
    clearTimers();
    if(phase==='idle')return;
    phase='idle';
    img.src=fallback;
    img.classList.remove('dm-pour-preparing','dm-pour-active');
   }
   function play(){
    if(phase!=='idle'||document.documentElement.classList.contains('dm-icon-motion-off'))return;
    phase='preparing';
    img.classList.add('dm-pour-preparing');
    prep=setTimeout(()=>{
     if(phase!=='preparing')return;
     phase='pouring';
     img.classList.remove('dm-pour-preparing');
     img.classList.add('dm-pour-active');
     // Each unique URL restarts the supplied SVG's built-in 4.8s timeline.
     img.src=animated+'&cycle='+(++cycle);
     finish=setTimeout(restore,POUR_MS);
    },ZOOM_MS);
   }
   img.addEventListener('pointerenter',e=>{
    if(e.pointerType==='touch')return;
    hasPointer=true;
    play();
   });
   img.addEventListener('pointerleave',e=>{
    if(e.pointerType==='touch')return;
    hasPointer=false;
    restore();
   });
   img.addEventListener('pointerdown',e=>{if(e.pointerType==='touch')play()});
   img.addEventListener('focus',()=>{if(!hasPointer)play()});
   img.addEventListener('blur',()=>{if(!hasPointer)restore()});
   img.addEventListener('keydown',e=>{
    if(e.key==='Enter'||e.key===' '){e.preventDefault();play()}
   });
   img.addEventListener('error',()=>{
    if(phase!=='idle')restore();
   });
  });
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
 else init();
 window.donmacLogoPour={refresh:init};
})();