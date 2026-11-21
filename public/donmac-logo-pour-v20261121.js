/* Don Macchiatos login barista: user-supplied SVG on hover/tap.
 * The visible original IMG stays in the DOM; no SVG DOMParser or replacement.
 * A fresh external animated-SVG resource replays its own timeline on each gesture.
 */
(()=>{
 'use strict';
 const animated='/donmac-logo-hover-original.svg?v=uploaded-20261121';
 let cycle=0;
 function init(){
  document.querySelectorAll('#authScreen .auth-brand-panel img.auth-brand-logo').forEach(img=>{
   if(img.dataset.dmPourBound==='1')return;
   img.dataset.dmPourBound='1';
   img.tabIndex=0;
   img.setAttribute('role','button');
   img.setAttribute('aria-label','Don Macchiatos logo — hover, tap or press Enter to see coffee pour');
   img.title='Hover or tap to pour coffee';
   const original=img.getAttribute('src')||'/donmac-logo-hires.svg';
   let playing=false,finish=0;
   function restore(){
    clearTimeout(finish);
    playing=false;
    img.src=original;
    img.classList.remove('dm-pour-active');
   }
   function play(){
    if(playing||document.documentElement.classList.contains('dm-icon-motion-off'))return;
    playing=true;
    img.classList.add('dm-pour-active');
    const next=animated+'&cycle='+(++cycle);
    // A distinct URL restarts the supplied SVG's own 4.8-second animation from frame 0.
    img.src=next;
    finish=setTimeout(restore,4850);
   }
   img.addEventListener('pointerenter',e=>{if(e.pointerType!=='touch')play()});
   // Leaving the logo stops the pour immediately — don't wait for the
   // remaining SVG frames or the original 4.8s restore timer.
   img.addEventListener('pointerleave',e=>{if(e.pointerType!=='touch')restore()});
   img.addEventListener('pointerdown',e=>{if(e.pointerType==='touch')play()});
   img.addEventListener('focus',play);
   img.addEventListener('keydown',e=>{
    if(e.key==='Enter'||e.key===' '){e.preventDefault();play()}
   });
   img.addEventListener('error',()=>{
    if(playing)restore();
   });
  });
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
 else init();
 window.donmacLogoPour={refresh:init};
})();