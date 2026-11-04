/* Don Mac POS v1.5.68 — Leaflet/OpenStreetMap franchise map with schematic connections.
   Follows the same mapping stack used by Cebu Transport Guide.
   Lines indicate geographic relationships, never turn-by-turn road routes. */
(()=>{
  'use strict';
  const $=id=>document.getElementById(id);
  if(!$('branchNetworkMap')||window.donmacBranchNetwork)return;
  const JS='https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js';
  const CSS='https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css';
  const JS_SRI='sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
  const CSS_SRI='sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
  window.donmacLeafletReady=()=>{
    if(window.L?.map)return Promise.resolve(window.L);
    if(window.__donmacLeafletPromise)return window.__donmacLeafletPromise;
    window.__donmacLeafletPromise=new Promise((resolve,reject)=>{
      const style=document.createElement('link');
      style.rel='stylesheet';style.href=CSS;style.integrity=CSS_SRI;style.crossOrigin='anonymous';
      const script=document.createElement('script');
      script.src=JS;script.async=true;script.integrity=JS_SRI;script.crossOrigin='anonymous';
      let styleReady=false,scriptReady=false,failed=false;
      const check=()=>{if(styleReady&&scriptReady&&window.L?.map)resolve(window.L)};
      const fail=()=>{if(!failed){failed=true;reject(new Error('Leaflet map assets could not load.'))}};
      style.onload=()=>{styleReady=true;check()};
      script.onload=()=>{scriptReady=true;check()};
      style.onerror=fail;script.onerror=fail;
      document.head.appendChild(style);document.head.appendChild(script);
    }).catch(err=>{window.__donmacLeafletPromise=null;throw err});
    return window.__donmacLeafletPromise;
  };
  let map=null,locations=[],lines=null,pins=null,sourceId=null,loading=false;
  const origin=$('branchNetworkOrigin'),notice=$('branchNetworkNotice');
  const host=$('branchNetworkMap');
  const coordsValid=b=>{
    const lat=b.latitude==null?NaN:Number(b.latitude);
    const lng=b.longitude==null?NaN:Number(b.longitude);
    return Number.isFinite(lat)&&Number.isFinite(lng)&&lat>=-90&&lat<=90&&lng>=-180&&lng<=180;
  };
  const visible=()=>$('view-users')?.classList.contains('active')
    &&!$('usersBranchesPage')?.hidden;
  function popText(b,hub){
    const box=document.createElement('div');
    const heading=document.createElement('strong');heading.textContent=b.name;
    box.appendChild(heading);
    const line=document.createElement('p');line.style.margin='4px 0';
    line.textContent=[b.address,b.city,b.province].filter(Boolean).join(', ')||'Saved branch location';
    box.appendChild(line);
    const role=document.createElement('p');role.style.margin='4px 0';
    role.textContent=hub?'Connection origin':'Franchise destination';
    box.appendChild(role);
    const url=new URL('https://www.google.com/maps/dir/');
    url.searchParams.set('api','1');url.searchParams.set('destination',b.latitude+','+b.longitude);
    const source=locations.find(x=>String(x.id)===String(sourceId));
    if(source&&!hub&&coordsValid(source))url.searchParams.set('origin',source.latitude+','+source.longitude);
    url.searchParams.set('travelmode','driving');
    const anchor=document.createElement('a');anchor.href=url.toString();anchor.target='_blank';
    anchor.rel='noopener noreferrer';anchor.textContent='Open driving directions';
    box.appendChild(anchor);return box;
  }
  function syncOrigin(){
    const good=locations.filter(coordsValid);
    const old=String(origin.value||sourceId||'');
    origin.replaceChildren(new Option('Choose an origin (saved pin required)',''));
    good.forEach(b=>origin.add(new Option(b.name,String(b.id))));
    const chosen=good.find(x=>String(x.id)===old)
      ||good.find(x=>/^main branch$/i.test(String(x.name||'').trim()))
      ||good[0];
    sourceId=chosen?String(chosen.id):null;
    origin.value=sourceId||'';
  }
  function draw(){
    if(!map)return;
    lines.clearLayers();pins.clearLayers();
    const good=locations.filter(coordsValid);
    const originBranch=good.find(x=>String(x.id)===String(sourceId));
    const bounds=[];
    for(const b of good){
      const lat=Number(b.latitude),lng=Number(b.longitude);
      const hub=!!originBranch&&String(b.id)===String(sourceId);
      const point=[lat,lng];bounds.push(point);
      window.L.circleMarker(point,{
        radius:hub?10:8,color:'#ffffff',weight:2.5,
        fillColor:hub?'#0c6843':'#3277c9',fillOpacity:1
      }).bindPopup(popText(b,hub)).addTo(pins);
      if(originBranch&&!hub){
        window.L.polyline([[Number(originBranch.latitude),Number(originBranch.longitude)],point],{
          color:'#0e8857',opacity:.85,weight:3,dashArray:'7 5',lineCap:'round'
        }).addTo(lines);
      }
    }
    $('branchNetworkMapped').textContent=good.length+' mapped '+(good.length===1?'branch':'branches');
    $('branchNetworkLinks').textContent=(originBranch?Math.max(0,good.length-1):0)+' connections';
    $('branchNetworkUnmapped').textContent=(locations.length-good.length)+' without a map pin';
    if(!good.length)notice.textContent='No branch coordinates saved yet. Edit a Branch and select its location on the map to plot it here.';
    else if(good.length===1)notice.textContent='One saved location. Add more franchise branch pins to see connecting lines.';
    else notice.textContent='Schematic geographic connections from '+originBranch.name+'. Lines do not follow roads.';
    notice.classList.toggle('is-empty',!good.length);
    if(bounds.length===1)map.setView(bounds[0],13);
    else if(bounds.length>1)map.fitBounds(bounds,{padding:[35,35],maxZoom:13});
    else map.setView([12.8797,121.774],6);
  }
  async function show(){
    if(!visible())return;
    if(map){map.invalidateSize();draw();return;}
    if(loading)return;
    loading=true;
    try{
      await window.donmacLeafletReady();
      if(!visible())return;
      map=window.L.map(host,{zoomControl:true,scrollWheelZoom:false,attributionControl:true})
        .setView([12.8797,121.774],6);
      window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
        maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
      }).addTo(map);
      lines=window.L.layerGroup().addTo(map);
      pins=window.L.layerGroup().addTo(map);
      draw();
      setTimeout(()=>map?.invalidateSize(),120);
    }catch(e){notice.textContent='Map unavailable: '+e.message;console.warn('Franchise map:',e);}
    finally{loading=false;}
  }
  async function update(data){
    if(Array.isArray(data)){locations=data.slice();syncOrigin();if(map)draw();}
    else{
      try{
        const response=await fetch('/api/branches',{credentials:'same-origin',cache:'no-store'});
        if(response.ok){const json=await response.json();locations=json.branches||[];syncOrigin();}
      }catch(e){notice.textContent='Unable to load branch locations.';}
    }
    if(visible())show();
  }
  origin.addEventListener('change',()=>{sourceId=origin.value||null;if(map)draw();});
  const watcher=new MutationObserver(()=>{if(visible())show();});
  watcher.observe($('view-users'),{attributes:true,attributeFilter:['class']});
  watcher.observe($('usersBranchesPage'),{attributes:true,attributeFilter:['hidden']});
  window.addEventListener('resize',()=>{if(visible()&&map)map.invalidateSize()});
  window.donmacBranchNetwork={update,show};
  update();
})();