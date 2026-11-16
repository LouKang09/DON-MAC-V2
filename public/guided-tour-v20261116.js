/* Focused, role-aware tour engine for Don Mac POS. */
(() => {
  'use strict';
  const LIB = window.donmacGuideLibrary || {};
  const BASE_KEY = 'donmac-guides-first-visit-v1';
  const rootApp = () => document.getElementById('app');
  const $ = selector => document.querySelector(selector);
  const make = (tag, cls, text) => { const e = document.createElement(tag); if(cls)e.className=cls; if(text!==undefined)e.textContent=text; return e; };
  const navFor = key => $('#mainNav button.nav[data-view="' + key + '"]');
  const topicParent = key => LIB[key] && (LIB[key].parent || key);
  let identity = '';
  let overlay = null, shade = [], ring = null, panel = null;
  let mode = '', currentTopic = '', steps = [], index = 0;
  let previouslyFocused = null, wasInert = false, savedBodyOverflow = '', savedHtmlOverflow = '';
  let welcomeDelay = null, loginSequence = 0, generated = false;
  let redrawFrame = 0, settledDraw = 0, resizeWatcher = null;
  const isHidden = el => {
    if(!el || !el.isConnected)return true;
    for(let a=el; a && a!==document.body; a=a.parentElement){
      if(a.hidden || a.classList.contains('hidden') || a.getAttribute('aria-hidden')==='true')return true;
    }
    return window.getComputedStyle(el).display==='none' || window.getComputedStyle(el).visibility==='hidden';
  };
  const allowed = key => {
    const p = topicParent(key);
    const n = navFor(p);
    return !!(n && !n.disabled && !n.classList.contains('hidden') &&
      !n.closest('.nav-section')?.classList.contains('hidden') && rootApp() && !rootApp().classList.contains('hidden'));
  };
  const topicsAvailable = () => {
    const top = Array.from($('#mainNav')?.querySelectorAll('button.nav[data-view]') || [])
      .map(el=>el.dataset.view).filter((key,pos,arr)=>arr.indexOf(key)===pos && LIB[key] && allowed(key));
    const result = [];
    top.forEach(key=>{
      result.push(key);
      Object.keys(LIB).filter(k=>LIB[k].parent===key).forEach(k=>result.push(k));
    });
    return result;
  };
  const withoutInteraction = callback => {
    const app=rootApp();
    const inert=app?.inert;
    if(app)app.inert=false;
    try{return callback();}finally{if(app)app.inert=!!inert;}
  };
  const selectTab = (group, tab) => {
    if(!tab)return;
    const selector = group==='catalog'
      ? '#adminTabs button[data-admin-tab="' + tab + '"]'
      : group==='users'
        ? '#view-users button[data-users-page="' + tab + '"]'
        : group==='inventory' && tab==='replenish'
          ? '#inventoryReplenishTab'
          : '';
    if(!selector)return;
    const button=$(selector);
    if(button && !button.classList.contains('active') && !button.disabled && !isHidden(button)){
      withoutInteraction(()=>button.click());
    }
  };
  const navigateTopic = key => {
    const parent=topicParent(key);
    if(!allowed(key))return false;
    const button=navFor(parent);
    if(!button || button.disabled)return false;
    const active=$('.view.active');
    if(!active || active.id !== 'view-' + parent)withoutInteraction(()=>button.click());
    if(LIB[key]?.tab)selectTab(parent,LIB[key].tab);
    return true;
  };
  const shadeBox = (element, left, top, width, height) => {
    element.style.left = Math.max(0,left)+'px';
    element.style.top = Math.max(0,top)+'px';
    element.style.width = Math.max(0,width)+'px';
    element.style.height = Math.max(0,height)+'px';
  };
  const scrollClip = el => {
    const r=el.getBoundingClientRect(), w=window.innerWidth, h=window.innerHeight;
    let box={left:r.left,top:r.top,right:r.right,bottom:r.bottom};
    for(let node=el.parentElement;node&&node!==document.body;node=node.parentElement){
      const cs=window.getComputedStyle(node);
      const x=/(auto|scroll|hidden|clip)/.test(cs.overflowX);
      const y=/(auto|scroll|hidden|clip)/.test(cs.overflowY);
      if(!x&&!y)continue;
      const c=node.getBoundingClientRect();
      if(x){box.left=Math.max(box.left,c.left);box.right=Math.min(box.right,c.right);}
      if(y){box.top=Math.max(box.top,c.top);box.bottom=Math.min(box.bottom,c.bottom);}
    }
    box.left=Math.max(0,box.left);box.top=Math.max(0,box.top);
    box.right=Math.min(w,box.right);box.bottom=Math.min(h,box.bottom);
    if(box.right-box.left<8 || box.bottom-box.top<8)return null;
    return box;
  };
  const hasScreenRect=el => !!el && !isHidden(el) && el.getClientRects().length>0;
  const currentTarget = step => {
    const el=step?.target?$(step.target):null;
    if(!hasScreenRect(el))return null;
    const r=el.getBoundingClientRect();
    // Whole pages/panels are not useful instructional highlights.
    // Target the first real heading or toolbar instead of outlining thousands of pixels.
    if(r.width>window.innerWidth*.78 && r.height>window.innerHeight*.46){
      for(const selector of ['.card-head h2','.card-head h3','.users-heading h2',
        '.inv-toolbar','.supply-head','.admin-tabs','.pos-layout .catalog-tools',
        'h2','h3','[role="tablist"]','input','select','button']){
        const child=el.querySelector(selector);
        if(hasScreenRect(child) && scrollClip(child))return child;
      }
    }
    return el;
  };
  const positionCard = bounds => {
    const w=window.innerWidth,h=window.innerHeight,margin=12;
    const card=panel;
    const cardW=Math.min(w-2*margin,w>=760?420:Math.min(480,w-2*margin));
    card.style.width=cardW+'px';
    card.style.transform='none';
    card.style.top='12px';card.style.bottom='auto';
    const cardH=Math.min(card.offsetHeight,h-24);
    const clamp=(n,min,max)=>Math.min(Math.max(n,min),Math.max(min,max));
    const x=bounds?.left ?? w/2, y=bounds?.top ?? h/2;
    if(!bounds){
      card.style.left=clamp((w-cardW)/2,margin,w-cardW-margin)+'px';
      card.style.top=clamp((h-cardH)/2,margin,h-cardH-margin)+'px';
      return;
    }
    const options=w>=760
      ? [{left:bounds.right+18,top:clamp(y,margin,h-cardH-margin)},
         {left:bounds.left-cardW-18,top:clamp(y,margin,h-cardH-margin)},
         {left:clamp(x,margin,w-cardW-margin),top:bounds.bottom+18},
         {left:clamp(x,margin,w-cardW-margin),top:bounds.top-cardH-18}]
      : [{left:margin,top:margin},
         {left:margin,top:h-cardH-margin}];
    let best=null,bestScore=Infinity;
    for(const candidate of options){
      const left=clamp(candidate.left,margin,w-cardW-margin);
      const top=clamp(candidate.top,margin,h-cardH-margin);
      const overlapX=Math.max(0,Math.min(left+cardW,bounds.right)-Math.max(left,bounds.left));
      const overlapY=Math.max(0,Math.min(top+cardH,bounds.bottom)-Math.max(top,bounds.top));
      const overlaps=overlapX*overlapY;
      const displaced=Math.abs(candidate.left-left)+Math.abs(candidate.top-top);
      const score=overlaps*100+displaced + (left<margin||top<margin?10000:0);
      if(score<bestScore){bestScore=score;best={left,top};}
    }
    card.style.left=best.left+'px';card.style.top=best.top+'px';
  };
  const draw = () => {
    if(!overlay || mode!=='tour' || !panel)return;
    const target=currentTarget(steps[index]);
    const clipped=target ? scrollClip(target) : null;
    const w=window.innerWidth,h=window.innerHeight;
    const pad=5;
    const bounds=clipped
      ? {left:Math.max(4,clipped.left-pad),top:Math.max(4,clipped.top-pad),
        right:Math.min(w-4,clipped.right+pad),bottom:Math.min(h-4,clipped.bottom+pad)}
      : null;
    const left=bounds?.left??w/2,top=bounds?.top??h/2,
      right=bounds?.right??w/2,bottom=bounds?.bottom??h/2;
    shadeBox(shade[0],0,0,w,top);
    shadeBox(shade[1],0,top,left,bottom-top);
    shadeBox(shade[2],right,top,w-right,bottom-top);
    shadeBox(shade[3],0,bottom,w,h-bottom);
    ring.hidden=!bounds;
    if(bounds)shadeBox(ring,left,top,right-left,bottom-top);
    panel.classList.toggle('dm-guide-centered',!bounds);
    positionCard(bounds);
  };
  const queueDraw = () => {
    if(redrawFrame)cancelAnimationFrame(redrawFrame);
    redrawFrame=requestAnimationFrame(()=>{redrawFrame=0;draw();});
  };
  const findStepTarget = step => {
    const target=currentTarget(step);
    if(!target)return;
    try{
      // Center in the scrollable content rather than leaving the target under
      // sticky headers or the fixed tutorial card.
      target.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
    }catch(_){}
  };
  const watchTarget = () => {
    resizeWatcher?.disconnect();resizeWatcher=null;
    const target=currentTarget(steps[index]);
    if(target && typeof ResizeObserver!=='undefined'){
      resizeWatcher=new ResizeObserver(queueDraw);
      resizeWatcher.observe(target);
    }
  };
  const lockedWheel = event => {
    if(!overlay)return;
    if(!event.target.closest('.dm-guide-card'))event.preventDefault();
  };
  const keyTrap = event => {
    if(!overlay)return;
    const focusables=Array.from(panel.querySelectorAll('button:not([disabled]),select:not([disabled]),a[href],input:not([disabled])'))
      .filter(el=>!isHidden(el));
    if(event.key==='Escape'){event.preventDefault();finish(false);return;}
    if(event.key==='Tab'){
      if(!focusables.length){event.preventDefault();return;}
      const first=focusables[0],last=focusables[focusables.length-1];
      if(event.shiftKey && (document.activeElement===first || !panel.contains(document.activeElement))){event.preventDefault();last.focus();}
      else if(!event.shiftKey && (document.activeElement===last || !panel.contains(document.activeElement))){event.preventDefault();first.focus();}
      return;
    }
    if((event.key==='ArrowRight'||event.key==='ArrowLeft') && mode==='tour' && event.target.tagName!=='SELECT'){
      event.preventDefault();
      move(event.key==='ArrowRight'?1:-1);
      return;
    }
    if(!panel.contains(event.target) || ['PageDown','PageUp','Home','End',' '].includes(event.key) && event.target===panel)event.preventDefault();
  };
  const createOverlay = () => {
    if(overlay)return;
    previouslyFocused=document.activeElement;
    const app=rootApp();wasInert=app?.inert||false;
    savedBodyOverflow=document.body.style.overflow;
    savedHtmlOverflow=document.documentElement.style.overflow;
    document.body.classList.add('dm-tour-active');
    document.body.style.overflow='hidden';
    document.documentElement.style.overflow='hidden';
    overlay=make('div','dm-guide-root');
    overlay.setAttribute('role','presentation');
    for(let i=0;i<4;i++){const d=make('div','dm-guide-shade');shade.push(d);overlay.appendChild(d);}
    ring=make('div','dm-guide-ring');ring.hidden=true;overlay.appendChild(ring);
    panel=make('section','dm-guide-card');
    panel.setAttribute('role','dialog');
    panel.setAttribute('aria-modal','true');
    panel.setAttribute('aria-label','Don Macchiatos guided help');
    panel.setAttribute('tabindex','-1');
    overlay.appendChild(panel);
    overlay.addEventListener('click',e=>{if(!panel.contains(e.target)){e.preventDefault();e.stopPropagation();panel.focus();}});
    document.body.appendChild(overlay);
    if(app)app.inert=true;
    window.addEventListener('keydown',keyTrap,true);
    window.addEventListener('wheel',lockedWheel,{passive:false,capture:true});
    window.addEventListener('touchmove',lockedWheel,{passive:false,capture:true});
    window.addEventListener('resize',queueDraw);
    window.addEventListener('scroll',queueDraw,true);
  };
  const clearPanel=()=>{
    if(!panel)return;
    panel.replaceChildren();
    panel.classList.remove('dm-guide-centered');
    panel.style.cssText='';
  };
  const addButton=(parent,text,onClick,kind)=>{
    const b=make('button','dm-guide-btn '+(kind||''),text);
    b.type='button';b.addEventListener('click',onClick);
    parent.appendChild(b);return b;
  };
  const addHeader=(eyebrow,title,lead)=>{
    const header=make('div','dm-guide-card-head');
    header.appendChild(make('span','dm-guide-eyebrow',eyebrow));
    const h=make('h2','',title);header.appendChild(h);
    if(lead)header.appendChild(make('p','dm-guide-lead',lead));
    panel.appendChild(header);
    return header;
  };
  const addFooter=()=>{
    const foot=make('div','dm-guide-footnote','During a tour the POS is locked. Highlighted elements are for explanation only; no transactions or inventory updates occur.');
    panel.appendChild(foot);
  };
  const markSeen = () => {
    if(!identity)return;
    try{localStorage.setItem(BASE_KEY+':'+identity,'1');}catch(_){}
  };
  const finish=(completed)=>{
    if(!overlay)return;
    if(completed)markSeen();
    resizeWatcher?.disconnect();resizeWatcher=null;
    clearTimeout(settledDraw);settledDraw=0;
    if(redrawFrame)cancelAnimationFrame(redrawFrame);redrawFrame=0;
    overlay.remove();overlay=null;shade=[];ring=null;panel=null;
    document.body.classList.remove('dm-tour-active');
    document.body.style.overflow=savedBodyOverflow;
    document.documentElement.style.overflow=savedHtmlOverflow;
    const app=rootApp();
    if(app)app.inert=app.classList.contains('hidden')?true:wasInert;
    window.removeEventListener('keydown',keyTrap,true);
    window.removeEventListener('wheel',lockedWheel,true);
    window.removeEventListener('touchmove',lockedWheel,true);
    window.removeEventListener('resize',queueDraw);
    window.removeEventListener('scroll',queueDraw,true);
    if(previouslyFocused?.isConnected && !isHidden(previouslyFocused) && !previouslyFocused.disabled)previouslyFocused.focus();
    previouslyFocused=null;mode='';currentTopic='';steps=[];index=0;
  };
  const showWelcome=()=>{
    if(!identity || rootApp()?.classList.contains('hidden'))return;
    createOverlay();clearPanel();mode='welcome';
    overlay.classList.remove('dm-guide-mode-tour');ring.hidden=true;
    addHeader('WELCOME TO DON MACCHIATOS','Your interactive POS guide',
      'Learn the screens available to your account before using live transactions, inventory or reports.');
    const list=make('div','dm-guide-welcome-list');
    ['Short overview of every permitted sidebar section','Detailed step-by-step tours for each section and subcategory','Safe, read-only guidance with background clicks and scrolling disabled','Reopen any guide later using the Help buttons'].forEach(t=>list.appendChild(make('p','', '✓  '+t)));
    panel.appendChild(list);
    const actions=make('div','dm-guide-actions');
    addButton(actions,'Start system tour',()=>start('overview'),'primary');
    addButton(actions,'Choose a category',showBrowser,'');
    addButton(actions,'Maybe later',()=>{markSeen();finish(false);},'muted');
    panel.appendChild(actions);addFooter();panel.focus();
  };
  const showBrowser=()=>{
    if(!identity || rootApp()?.classList.contains('hidden'))return;
    createOverlay();clearPanel();mode='browser';
    overlay.classList.remove('dm-guide-mode-tour');ring.hidden=true;
    addHeader('GUIDE LIBRARY','Explore the system','Choose a category or a specific subcategory. Only pages available to your role and granted access are listed.');
    const scroll=make('div','dm-guide-library');
    const intro=make('div','dm-guide-library-entry');
    addButton(intro,'▶ Start full sidebar overview',()=>start('overview'),'primary');
    scroll.appendChild(intro);
    topicsAvailable().forEach(key=>{
      const record=LIB[key];
      const parent=record.parent;
      const row=make('div','dm-guide-library-entry '+(parent?'is-subtopic':''));
      const label=make('div','dm-guide-library-copy');
      label.appendChild(make('strong','',record.label));
      label.appendChild(make('small','',record.intro));
      row.appendChild(label);
      addButton(row,'View guide',()=>start(key),'small');
      scroll.appendChild(row);
    });
    panel.appendChild(scroll);
    const actions=make('div','dm-guide-actions');
    addButton(actions,'Close',()=>finish(false),'muted');
    panel.appendChild(actions);
    panel.classList.add('dm-guide-browser');
    panel.focus();
  };
  const overviewSteps = () => {
    const available=topicsAvailable().filter(key=>!LIB[key].parent);
    const a=[
      {title:'Welcome to your workspace',body:'This tour introduces only the modules that your role can access. Use the question-mark icons next to sidebar sections or the Help button to revisit detailed walkthroughs.',target:'#mainNav'},
      {title:'Navigate by category',body:'Select a sidebar category to open its workspace. Managers see management tools; cashiers only see POS and specifically granted features.',target:'#mainNav'}
    ];
    available.forEach(key=>a.push({title:LIB[key].label,body:LIB[key].intro + ' Open the detailed '+LIB[key].label+' guide at any time for step-by-step instructions.',target:'#mainNav button.nav[data-view="'+key+'"]'}));
    a.push({title:'Rewatch guides at any time',body:'Click Guide Center in the left panel, the Help button near the top of the page, or a section’s ? control. Guides never change business data.',target:'#dmGuideSidebarOpen'});
    return a;
  };
  const renderStep=()=>{
    if(!overlay || mode!=='tour')return;
    const step=steps[index];
    if(!step){finish(true);return;}
    if(currentTopic!=='overview'){
      const parent=topicParent(currentTopic);
      const tab=step.tab || LIB[currentTopic].tab;
      if(tab)selectTab(parent,tab);
    }
    clearPanel();
    const record=LIB[currentTopic]||{label:'Sidebar overview'};
    addHeader('GUIDED TOUR · '+(index+1)+' / '+steps.length,step.title,step.body);
    const meter=make('div','dm-guide-progress');
    const bar=make('div','dm-guide-progress-bar');
    bar.style.width=String(Math.round((index+1)/steps.length*100))+'%';
    meter.appendChild(bar);
    meter.setAttribute('aria-label','Step '+(index+1)+' of '+steps.length);
    panel.appendChild(meter);
    panel.appendChild(make('p','dm-guide-context','Section: '+record.label));
    const actions=make('div','dm-guide-actions');
    addButton(actions,'Back',()=>move(-1),'muted').disabled=index===0;
    addButton(actions,index===steps.length-1?'Finish tour':'Next',()=>move(1),'primary');
    addButton(actions,'Exit tour',()=>{markSeen();finish(false);},'exit');
    panel.appendChild(actions);addFooter();
    findStepTarget(step);
    watchTarget();
    queueDraw();
    clearTimeout(settledDraw);
    settledDraw=setTimeout(()=>{findStepTarget(steps[index]);watchTarget();queueDraw();},170);
    panel.focus();
  };
  const move=offset=>{
    if(!overlay||mode!=='tour')return;
    const n=index+offset;
    if(n<0)return;
    if(n>=steps.length){markSeen();finish(true);return;}
    index=n;renderStep();
  };
  const start = topic => {
    if(topic!=='overview' && (!LIB[topic] || !allowed(topic)))return;
    if(topic==='overview' && !topicsAvailable().length)return;
    createOverlay();
    currentTopic=topic;
    if(topic!=='overview'){
      if(!navigateTopic(topic)){showBrowser();return;}
      steps=LIB[topic].steps.filter(Boolean);
    }else steps=overviewSteps();
    if(!steps.length){showBrowser();return;}
    mode='tour';overlay.classList.add('dm-guide-mode-tour');index=0;markSeen();renderStep();
  };
  const refreshNavButtons = () => {
    $('#mainNav')?.querySelectorAll('button.nav[data-view]').forEach(nav=>{
      if(!LIB[nav.dataset.view])return;
      let wrap=nav.parentElement;
      if(!wrap.classList.contains('dm-guide-nav-row')){
        wrap=make('div','dm-guide-nav-row');
        nav.parentNode.insertBefore(wrap,nav);
        wrap.appendChild(nav);
        const guide=make('button','dm-guide-inline','?');
        guide.type='button';
        guide.dataset.guideFor=nav.dataset.view;
        guide.title='View '+LIB[nav.dataset.view].label+' guide';
        guide.setAttribute('aria-label','View '+LIB[nav.dataset.view].label+' guide');
        guide.addEventListener('click',()=>start(nav.dataset.view));
        wrap.appendChild(guide);
      }
      wrap.classList.toggle('hidden',!allowed(nav.dataset.view));
    });
  };
  const createLaunchers = () => {
    if(!$('#dmGuideSidebarOpen')){
      const sidebar=$('.sidebar .sidebar-bottom');
      if(sidebar){
        const b=make('button','dm-guide-launcher','?  Guide Center');
        b.id='dmGuideSidebarOpen';b.type='button';
        b.setAttribute('aria-label','Open Guide Center');
        b.title='View step-by-step guides';
        b.addEventListener('click',showBrowser);
        sidebar.insertBefore(b,sidebar.firstChild);
      }
    }
    if(!$('#dmGuideTopbarOpen')){
      const area=$('.topbar-right');
      if(area){
        const b=make('button','dm-guide-topbar-launcher','?  Help');
        b.id='dmGuideTopbarOpen';b.type='button';
        b.setAttribute('aria-label','Open interactive user guides');
        b.addEventListener('click',showBrowser);
        area.insertBefore(b,area.firstChild);
      }
    }
    refreshNavButtons();generated=true;
  };
  const onLogin = user => {
    if(!user || user.id===undefined || !rootApp() || rootApp().classList.contains('hidden'))return;
    const key = [user.workspaceId||'legacy', user.id, user.username||'', user.role||''].join(':');
    const changed=identity!==key;
    if(changed && overlay)finish(false);
    identity=key;
    loginSequence++;
    clearTimeout(welcomeDelay);
    createLaunchers();
    if(changed){
      let seen=false;
      try{seen=localStorage.getItem(BASE_KEY+':'+identity)==='1';}catch(_){}
      if(!seen){
        const request=loginSequence;
        welcomeDelay=setTimeout(()=>{
          if(request===loginSequence && identity===key && !rootApp()?.classList.contains('hidden') && !overlay)showWelcome();
        },850);
      }
    }
  };
  const onLogout = () => {
    loginSequence++;
    clearTimeout(welcomeDelay);
    if(overlay)finish(false);
    identity='';
  };
  // Recover safely from auth transitions and from account switches outside this module.
  new MutationObserver(()=>{
    if(rootApp()?.classList.contains('hidden') && overlay)onLogout();
  }).observe(rootApp()||document.documentElement,{attributes:true,attributeFilter:['class']});
  window.donmacGuides={onLogin,onLogout,start,open:showBrowser,available:topicsAvailable};
})();
