/* Don Macchiatos v1.5.19 | Reversible Lottie animation pilot.
   Original animations are retained; only Coffee and Food are overridden when
   local preference is enabled. MIT Lottie player bundled in /vendor.
   No transaction, product, inventory or authentication logic is touched. */
(function(){
  'use strict';
  const categoryPanel=document.getElementById('categoryTabs');
  const toggle=document.getElementById('posAnimationPilotToggle');
  const KEY='donmac.pos.lottie-pilot';
  if(!categoryPanel||!toggle)return;
  const reduced=window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  const animations=new Map();
  const staticValue=v=>({a:0,k:v});
  const rgb=hex=>{
    const n=parseInt(hex.slice(1),16);
    return [((n>>16)&255)/255,((n>>8)&255)/255,(n&255)/255,1];
  };
  function motion(stops){
    return {a:1,k:stops.map((entry,i)=>{
      const next=stops[Math.min(i+1,stops.length-1)];
      const frame={t:entry[0],s:entry[1],i:{x:.58,y:1},o:{x:.38,y:0}};
      if(i<stops.length-1)frame.e=next[1];
      return frame;
    })};
  }
  function ellipse(x,y,w,h){return {ty:'el',d:1,p:staticValue([x,y]),s:staticValue([w,h]),nm:'Circle'};}
  function rect(x,y,w,h,r){return {ty:'rc',d:1,p:staticValue([x,y]),s:staticValue([w,h]),r:staticValue(r||0),nm:'Rectangle'};}
  function customPath(vertices,closed,smooth){
    const count=vertices.length,ins=[],outs=[];
    for(let i=0;i<count;i++){
      if(!smooth){ins.push([0,0]);outs.push([0,0]);continue;}
      const prev=vertices[(i+count-1)%count],next=vertices[(i+1)%count];
      const vx=(next[0]-prev[0])*.17,vy=(next[1]-prev[1])*.17;
      ins.push([-vx,-vy]);outs.push([vx,vy]);
    }
    return {ty:'sh',d:1,ks:staticValue({v:vertices,i:ins,o:outs,c:closed!==false}),nm:'Illustration outline'};
  }
  function shape(geometry,fill,stroke,strokeWidth){
    const items=[geometry];
    if(fill)items.push({ty:'fl',c:staticValue(rgb(fill)),o:staticValue(100),r:1,nm:'Fill'});
    if(stroke)items.push({ty:'st',c:staticValue(rgb(stroke)),o:staticValue(100),w:staticValue(strokeWidth||2.5),lc:2,lj:2,nm:'Stroke'});
    items.push({ty:'tr',p:staticValue([0,0]),a:staticValue([0,0]),s:staticValue([100,100]),r:staticValue(0),o:staticValue(100)});
    return {ty:'gr',it:items,nm:'Vector'};
  }
  function layer(name,shapes,opts){
    opts=opts||{};
    return {
      ddd:0,ind:0,ty:4,nm:name,
      ks:{o:opts.opacity||staticValue(100),r:staticValue(0),p:opts.position||staticValue([0,0,0]),
        a:staticValue([0,0,0]),s:staticValue([100,100,100])},
      ao:0,shapes:shapes,ip:0,op:90,st:0,bm:0
    };
  }
  function animation(layers){
    layers.forEach((entry,i)=>entry.ind=i+1);
    return {v:'5.7.4',fr:30,ip:0,op:90,w:128,h:128,nm:'Original Don Macchiatos POS vector pilot',
      ddd:0,assets:[],layers:layers,markers:[]};
  }
  function steamShape(){
    return customPath([[0,14],[-4,8],[3,-1],[-1,-11],[1,-18]],false,true);
  }
  function coffee(){
    const dark='#54382b',caramel='#b7794a',cream='#f9e6bd',foam='#f4d59c';
    const steam=[
      [35,0],[60,-.55],[90,-1]
    ].map((entry,i)=>{
      const x=[41,63,83][i],t=i*5;
      return layer('Steam '+(i+1),[shape(steamShape(),null,foam,4.3)],{
        position:motion([[0,[x,32,0]],[25,[x-3,15,0]],[52,[x+3,1,0]],[70,[x-2,-9,0]],[90,[x,32,0]]]),
        opacity:motion([[0,[0]],[12,[100]],[45,[85]],[66,[0]],[90,[0]]])
      });
    });
    const cup=[
      layer('Warm espresso highlight',[
        shape(ellipse(62,65,58,13),'#ce9967',null),
        shape(ellipse(62,63,56,8),'#6f4731',null)
      ]),
      layer('Coffee bean',[
        shape(ellipse(62,88,13,20),'#a66a3e',null),
        shape(customPath([[63,79],[59,85],[64,91],[61,97]],false,true),null,dark,1.6)
      ]),
      layer('Cream ceramic cup',[
        shape(rect(62,83,67,45,13),cream,dark,3.7),
        shape(rect(62,65,67,16,7),foam,dark,3),
        shape(customPath([[34,77],[90,77]],false),null,'#d3a677',2.5)
      ]),
      layer('Cup handle',[shape(ellipse(98,83,28,29),null,dark,6)]),
      layer('Saucer',[
        shape(ellipse(63,112,86,13),'#e4caa0',dark,2.8),
        shape(ellipse(63,111,56,6),'#fbedd3',null)
      ])
    ];
    return animation(steam.concat(cup));
  }
  function cookie(){
    const outline='#633e2a', dough='#d1a36b', chip='#6f4029';
    const chips=[[45,49,8],[67,44,8],[52,70,7],[75,76,9],[40,85,6],[67,93,5],[78,55,5]];
    const wholeCookie=[
      shape(ellipse(62,70,75,75),dough,outline,4.2),
      shape(ellipse(55,57,50,44),null,'#e9bf83',2)
    ].concat(chips.map(([x,y,size])=>shape(ellipse(x,y,size,size),chip,null)));
    // Bite: an intentionally jagged, large missing section on the upper-right.
    const biteOutline=[[62,32],[45,35],[31,45],[25,64],[28,83],[42,99],[61,106],[78,99],[89,86],
      [84,78],[79,72],[87,66],[79,60],[85,50],[77,45],[76,37]];
    const bittenCookie=[
      shape(customPath(biteOutline,true,false),dough,outline,3.6)
    ].concat(chips.slice(0,5).map(([x,y,size])=>shape(ellipse(x,y,size,size),chip,null)));
    const mouth=[
      shape(customPath([[88,47],[99,41],[112,43]],false,true),null,'#633e2a',3.7),
      shape(customPath([[88,78],[100,85],[112,84]],false,true),null,'#633e2a',3.7),
      shape(customPath([[91,51],[95,56],[99,51]],false),null,'#633e2a',2.4)
    ];
    const layers=[];
    for(let i=0;i<6;i++){
      const x=[84,93,100,85,106,95][i],y=[44,62,72,87,58,92][i];
      layers.push(layer('Falling crumb '+i,[shape(ellipse(x,y,i%2?5:6,i%2?5:6),chip,null)],{
        position:motion([[0,[0,-8,0]],[29,[0,-8,0]],[42,[i%2?5:-4,-2,0]],[74,[i%2?20:-15,26,0]],[90,[0,-8,0]]]),
        opacity:motion([[0,[0]],[30,[0]],[38,[100]],[73,[65]],[86,[0]],[90,[0]]])
      }));
    }
    layers.push(layer('Biting mouth',mouth,{
      position:motion([[0,[33,0,0]],[14,[33,0,0]],[29,[-11,0,0]],[40,[-14,0,0]],[57,[35,0,0]],[90,[33,0,0]]]),
      opacity:motion([[0,[0]],[8,[0]],[16,[100]],[42,[100]],[55,[0]],[90,[0]]])
    }));
    layers.push(layer('Cookie after bite',bittenCookie,{
      opacity:motion([[0,[0]],[31,[0]],[33,[100]],[79,[100]],[81,[0]],[90,[0]]])
    }));
    layers.push(layer('Whole cookie',wholeCookie,{
      opacity:motion([[0,[100]],[31,[100]],[33,[0]],[79,[0]],[81,[100]],[90,[100]]])
    }));
    return animation(layers);
  }

  const artData={Coffee:coffee(),Food:cookie()};
  let enabled=true;
  try{enabled=localStorage.getItem(KEY)!=='off';}catch(_){}
  function updateToggle(){
    toggle.textContent='New animations: '+(enabled?'ON':'OFF');
    toggle.classList.toggle('is-on',enabled);
    toggle.setAttribute('aria-pressed',String(enabled));
    toggle.title=enabled?'Use the original Coffee and Food animations':'Try the new Lottie Coffee and Food animations';
  }
  function clearButton(button,entry){
    try{entry.instance?.destroy();}catch(err){console.warn('Lottie animation cleanup:',err);}
    if(button.isConnected){
      const symbol=button.querySelector('.category-symbol');
      if(symbol&&entry.originalHtml!=null)symbol.innerHTML=entry.originalHtml;
      button.classList.remove('lottie-pilot-tile');
    }
    animations.delete(button);
  }
  function reconcile(){
    for(const [button,entry] of Array.from(animations.entries())){
      if(!button.isConnected||!enabled)clearButton(button,entry);
    }
    if(!enabled)return;
    if(!window.lottie||typeof window.lottie.loadAnimation!=='function')return;
    for(const name of Object.keys(artData)){
      const button=Array.from(categoryPanel.querySelectorAll('button[data-cat]'))
        .find(el=>el.dataset.cat===name);
      if(!button||animations.has(button))continue;
      const symbol=button.querySelector('.category-symbol');
      if(!symbol)continue;
      const originalHtml=symbol.innerHTML;
      try{
        symbol.innerHTML='<span class="pos-lottie-illustration" aria-hidden="true"></span>';
        const slot=symbol.firstElementChild;
        const instance=window.lottie.loadAnimation({
          container:slot,renderer:'svg',loop:true,autoplay:false,
          animationData:JSON.parse(JSON.stringify(artData[name])),
          rendererSettings:{preserveAspectRatio:'xMidYMid meet',progressiveLoad:true}
        });
        const entry={originalHtml,instance};
        animations.set(button,entry);
        button.classList.add('lottie-pilot-tile');
        instance.goToAndStop(0,true);
        button.addEventListener('mouseenter',()=>{
          if(enabled&&!reduced?.matches)instance.goToAndPlay(0,true);
        },{signal:undefined});
        button.addEventListener('mouseleave',()=>instance.goToAndStop(0,true));
        button.addEventListener('focusin',()=>{
          if(enabled&&!reduced?.matches)instance.goToAndPlay(0,true);
        });
        button.addEventListener('focusout',()=>{
          if(!button.matches(':focus-within'))instance.goToAndStop(0,true);
        });
        button.addEventListener('pointerdown',()=>{
          if(enabled&&!reduced?.matches)instance.goToAndPlay(0,true);
        });
      }catch(err){
        console.warn('POS Lottie '+name+' pilot unavailable; original artwork retained.',err);
        symbol.innerHTML=originalHtml;
        button.classList.remove('lottie-pilot-tile');
        animations.delete(button);
      }
    }
  }

  toggle.addEventListener('click',()=>{
    enabled=!enabled;
    try{localStorage.setItem(KEY,enabled?'on':'off');}catch(_){}
    updateToggle();
    reconcile();
  });
  if(reduced?.addEventListener)reduced.addEventListener('change',()=>{
    if(reduced.matches)for(const entry of animations.values())entry.instance.goToAndStop(0,true);
  });
  const observer=new MutationObserver(reconcile);
  observer.observe(categoryPanel,{childList:true});
  window.addEventListener('pagehide',()=>{
    observer.disconnect();
    for(const [button,entry] of Array.from(animations.entries()))clearButton(button,entry);
  });
  updateToggle();
  reconcile();
})();