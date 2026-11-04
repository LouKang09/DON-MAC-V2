/* v1.5.65 - Branch address suggestions & saved logistics coordinates.
   Photon (OpenStreetMap) supports search-as-you-type. No Nominatim autocomplete. */
(()=>{
  'use strict';
  const $=id=>document.getElementById(id);
  const form=$('branchForm');
  if(!form||window.donmacBranchGeo)return;
  const fields=[
    {id:'branchAddress',type:'street'},
    {id:'branchCity',type:'city'},
    {id:'branchProvince',type:'province'}
  ];
  const cache=new Map();
  let lastRequest=0;
  let pendingTimer=null;
  let pendingController=null;
  let searchToken=0;
  const latEl=$('branchLatitude'),lonEl=$('branchLongitude');
  const status=$('branchMapStatus'),preview=$('branchMapPreview');
  const iframe=$('branchMapFrame'),directions=$('branchDirectionsLink');
  function coords(){
    const a=latEl.value.trim(),b=lonEl.value.trim();
    if(!a&&!b)return{latitude:null,longitude:null};
    const latitude=Number(a),longitude=Number(b);
    if(!a||!b||!Number.isFinite(latitude)||!Number.isFinite(longitude)||
       latitude < -90||latitude > 90||longitude < -180||longitude > 180)
       return{latitude:null,longitude:null,invalid:true};
    return{latitude,longitude};
  }
  function updateMap(){
    const c=coords();
    if(c.latitude===null){
      preview.classList.add('hidden');directions.classList.add('hidden');
      iframe.removeAttribute('src');
      status.textContent=c.invalid?'Enter both valid coordinates to save a map pin.':'No map pin selected. Choose an address suggestion or enter coordinates.';
      return;
    }
    const lat=c.latitude,lon=c.longitude,offset=.012;
    const params=new URLSearchParams({
      bbox:[lon-offset,lat-offset,lon+offset,lat+offset].join(','),
      layer:'mapnik',marker:lat+','+lon
    });
    const next='https://www.openstreetmap.org/export/embed.html?'+params.toString();
    if(iframe.src!==next)iframe.src=next;
    const dest=new URL('https://www.google.com/maps/dir/');
    dest.searchParams.set('api','1');dest.searchParams.set('destination',lat+','+lon);
    directions.href=dest.toString();
    preview.classList.remove('hidden');directions.classList.remove('hidden');
    status.textContent='Destination pin ready — save this Branch to store its coordinates.';
  }
  function setCoordinates(latitude,longitude){
    const valid=latitude!=null&&longitude!=null&&
      Number.isFinite(Number(latitude))&&Number.isFinite(Number(longitude));
    latEl.value=valid?String(latitude):'';
    lonEl.value=valid?String(longitude):'';
    updateMap();
  }
  function reset(){
    clearSuggestions();
    setCoordinates(null,null);
  }
  function clearSuggestions(){
    clearTimeout(pendingTimer);
    ++searchToken;
    if(pendingController)pendingController.abort();
    pendingController=null;
    fields.forEach(({id})=>{
      const input=$(id),list=$(id+'Suggestions');
      list.replaceChildren();list.classList.remove('is-open');
      input.setAttribute('aria-expanded','false');
    });
  }
  function composeQuery(type,value){
    const city=$('branchCity').value.trim(),province=$('branchProvince').value.trim();
    const country=$('branchCountry').value==='Philippines'?'Philippines':'';
    if(type==='street')return [value,city,province,country].filter(Boolean).join(', ');
    if(type==='city')return [value,province,country].filter(Boolean).join(', ');
    return [value,country].filter(Boolean).join(', ');
  }
  function labelFor(f,type){
    const p=f.properties||{};
    if(type==='city')return p.city||p.name||p.county||'';
    if(type==='province')return p.state||p.county||p.name||'';
    return [p.name,p.street,p.city,p.county,p.state].filter((x,i,a)=>x&&a.indexOf(x)===i).join(', ');
  }
  function pick(feature,type,value){
    const p=feature.properties||{},g=feature.geometry||{};
    if(type==='street'){
      $('branchAddress').value=[p.housenumber,p.street||p.name].filter(Boolean).join(' ')||value;
      if(p.city||p.town)$('branchCity').value=p.city||p.town;
      if(p.state)$('branchProvince').value=p.state;
      if(Array.isArray(g.coordinates)&&g.coordinates.length>=2)
        setCoordinates(g.coordinates[1],g.coordinates[0]);
    }else if(type==='city'){
      $('branchCity').value=p.city||p.name||value;
      if(p.state)$('branchProvince').value=p.state;
    }else{
      $('branchProvince').value=p.state||p.county||p.name||value;
    }
    clearSuggestions();
  }
  async function suggest(id,type,value,token){
    const list=$(id+'Suggestions'),input=$(id);
    const query=composeQuery(type,value);
    const key=type+'|'+query.toLowerCase();
    let features=cache.get(key);
    if(!features){
      const wait=Math.max(0,1000-(Date.now()-lastRequest));
      if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
      if(token!==searchToken)return;
      lastRequest=Date.now();
      const controller=new AbortController();pendingController=controller;
      const url=new URL('https://photon.komoot.io/api/');
      url.searchParams.set('q',query);
      url.searchParams.set('limit','6');
      url.searchParams.set('lang','en');
      if($('branchCountry').value==='Philippines')
        url.searchParams.set('bbox','116,4,128,22');
      const response=await fetch(url.toString(),{signal:controller.signal});
      if(!response.ok)throw Error('Location service unavailable');
      const data=await response.json();
      features=(Array.isArray(data.features)?data.features:[]).filter(f=>
        $('branchCountry').value!=='Philippines'||
        !f.properties?.countrycode||
        String(f.properties.countrycode).toUpperCase()==='PH'
      ).slice(0,5);
      if(cache.size>=100)cache.delete(cache.keys().next().value);
      cache.set(key,features);
    }
    if(token!==searchToken||input.value.trim()!==value)return;
    list.replaceChildren();
    if(!features.length){
      const hint=document.createElement('p');hint.className='branch-suggestions-note';
      hint.textContent='No match found. You can enter the address manually.';
      list.appendChild(hint);
    }else{
      const seen=new Set();
      for(const feature of features){
        const label=labelFor(feature,type);
        if(!label||seen.has(label))continue;seen.add(label);
        const button=document.createElement('button');
        button.type='button';button.className='branch-suggestion';
        const context=[feature.properties?.city,feature.properties?.state].filter(Boolean).join(', ');
        button.textContent=label+(context&&!label.includes(context)?' — '+context:'');
        button.setAttribute('role','option');
        button.addEventListener('click',()=>pick(feature,type,value));
        list.appendChild(button);
      }
    }
    list.classList.add('is-open');input.setAttribute('aria-expanded','true');
  }
  for(const {id,type} of fields){
    const input=$(id);
    input.addEventListener('input',()=>{
      clearSuggestions();setCoordinates(null,null);
      const value=input.value.trim();
      if(value.length<3)return;
      const token=searchToken;
      pendingTimer=setTimeout(()=>suggest(id,type,value,token).catch(err=>{
        if(err.name!=='AbortError'&&token===searchToken){
          const list=$(id+'Suggestions');list.innerHTML='<p class="branch-suggestions-note">Suggestions unavailable. Enter manually.</p>';
          list.classList.add('is-open');input.setAttribute('aria-expanded','true');
        }
      }),900);
    });
    input.addEventListener('keydown',e=>{
      if(e.key==='Escape')clearSuggestions();
      if(e.key==='ArrowDown'){
        const first=$(id+'Suggestions').querySelector('button');
        if(first){e.preventDefault();first.focus();}
      }
    });
  }
  for(const input of [latEl,lonEl]){
    input.addEventListener('input',updateMap);
    input.addEventListener('change',updateMap);
  }
  $('branchCountry').addEventListener('change',reset);
  document.addEventListener('click',e=>{
    if(!e.target.closest('.branch-autocomplete'))clearSuggestions();
  });
  window.donmacBranchGeo={reset,setCoordinates,getCoordinates:coords};
  updateMap();
})();
