/* Don Mac POS v1.5.67: Google Maps branch search, address autofill and saved pin.
   Uses Google Maps JavaScript API + Places API (New) + Geocoding API.
   Map API key is supplied by the authenticated server, never committed to GitHub. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  if (!$('branchForm') || window.donmacBranchGeo) return;
  const mapEl = $('branchGoogleMap');
  const placeholder = $('branchMapPlaceholder');
  const status = $('branchMapStatus');
  const directions = $('branchDirectionsLink');
  const DEFAULT_CENTER = {lat:12.8797,lng:121.7740};
  let selected = null;
  let map = null, marker = null, geocoder = null, autocomplete = null;
  let ready = false, osmMap = null, osmMarker = null;
  let searchDelay = null, searchAbort = null;
  let initPromise = null, reverseToken = 0;
  const coordsValid = (lat,lng) =>
    Number.isFinite(lat)&&Number.isFinite(lng)&&lat>=-90&&lat<=90&&lng>=-180&&lng<=180;
  function getCoordinates(){
    return selected?{latitude:selected.lat,longitude:selected.lng}:{latitude:null,longitude:null};
  }
  function showStatus(message){status.textContent=message;}
  function directionsLink(){
    directions.classList.toggle('hidden',!selected);
    if(!selected)return;
    const url = new URL('https://www.google.com/maps/dir/');
    url.searchParams.set('api','1');
    url.searchParams.set('destination',selected.lat+','+selected.lng);
    directions.href=url.toString();
  }
  function putPin(){
    if(osmMap){
      if(!selected){if(osmMarker)osmMap.removeLayer(osmMarker);osmMarker=null;return;}
      const pos=[selected.lat,selected.lng];
      if(!osmMarker){
        osmMarker=L.marker(pos,{draggable:true,title:'Branch delivery destination'}).addTo(osmMap);
        osmMarker.on('dragend',e=>reverseFromOsm(e.target.getLatLng()));
      }else{osmMarker.addTo(osmMap);osmMarker.setLatLng(pos);}
      osmMap.setView(pos,16);
      return;
    }
    if(!ready||!map)return;
    if(!selected){if(marker)marker.setMap(null);return;}
    const where = {lat:selected.lat,lng:selected.lng};
    if(!marker){
      marker = new google.maps.Marker({
        position:where,map,draggable:true,title:'Branch delivery destination',
        animation:google.maps.Animation.DROP
      });
      marker.addListener('dragend',e=>{if(e.latLng)reverseLookup(e.latLng);});
    } else {marker.setMap(map);marker.setPosition(where);}
    map.setCenter(where);map.setZoom(17);
  }
  function setCoordinates(lat,lng){
    const a=lat==null?NaN:Number(lat),b=lng==null?NaN:Number(lng);
    selected=coordsValid(a,b)?{lat:a,lng:b}:null;
    directionsLink();
    putPin();
    showStatus(selected?'Destination pin selected. Save Branch to store it for logistics.':'Search Google Maps to select a delivery destination.');
  }
  function reset(){
    reverseToken++;
    setCoordinates(null,null);
    if(map){map.setCenter(DEFAULT_CENTER);map.setZoom(6);}
    if(osmMap){osmMap.setView([DEFAULT_CENTER.lat,DEFAULT_CENTER.lng],6);}
    const osmSearch=$('branchOpenMapSearch');if(osmSearch)osmSearch.value='';
    const suggestions=$('branchOpenMapResults');if(suggestions)suggestions.replaceChildren();
    if(autocomplete)autocomplete.value='';
  }
  function typeOf(parts,type){
    const item=(parts||[]).find(c=>(c.types||[]).includes(type));
    return item?String(item.longText||item.long_name||'').trim():'';
  }
  function chooseAddress(parts,formatted){
    const num=typeOf(parts,'street_number');
    const route=typeOf(parts,'route');
    const landmark=typeOf(parts,'premise')||typeOf(parts,'point_of_interest');
    const sublocality=typeOf(parts,'sublocality_level_1')||typeOf(parts,'neighborhood');
    const city=typeOf(parts,'locality')||typeOf(parts,'postal_town')||typeOf(parts,'administrative_area_level_3')||typeOf(parts,'administrative_area_level_2');
    const state2=typeOf(parts,'administrative_area_level_2');
    const state1=typeOf(parts,'administrative_area_level_1');
    const province=(state2&&state2!==city?state2:state1)||state1;
    const street=[landmark,[num,route].filter(Boolean).join(' '),sublocality]
      .filter(Boolean).join(', ')||String(formatted||'').split(',')[0].trim();
    // Populate only verified components; keep other manually entered data if unknown.
    if(street)$('branchAddress').value=street.slice(0,250);
    if(city)$('branchCity').value=city.slice(0,100);
    if(province)$('branchProvince').value=province.slice(0,100);
    const postal=typeOf(parts,'postal_code');
    if(postal)$('branchPostalCode').value=postal.slice(0,12);
    const country=typeOf(parts,'country');
    if(country)$('branchCountry').value=country==='Philippines'?'Philippines':'Other';
  }
  async function reverseLookup(latLng){
    if(!latLng)return;
    const lat=typeof latLng.lat==='function'?latLng.lat():Number(latLng.lat);
    const lng=typeof latLng.lng==='function'?latLng.lng():Number(latLng.lng);
    if(!coordsValid(lat,lng))return;
    const token=++reverseToken;
    setCoordinates(lat,lng);
    showStatus('Looking up the selected Google Maps location…');
    try{
      const results=await geocoder.geocode({location:{lat,lng}});
      if(token!==reverseToken)return;
      if(results.results&&results.results[0]){
        const result=results.results[0];
        chooseAddress((result.address_components||[]).map(p=>({types:p.types,longText:p.long_name})),result.formatted_address);
      }
      showStatus('Map location selected. Review the address fields, then Save Branch.');
    }catch(e){
      if(token===reverseToken)showStatus('Pin saved locally. Address lookup failed; fill the street, city and province manually.');
    }
  }
  async function selectedPlace(event){
    const place=event.placePrediction?.toPlace?.();
    if(!place)return;
    showStatus('Loading the selected Google Maps address…');
    try{
      await place.fetchFields({fields:['formattedAddress','location','addressComponents']});
      if(!place.location)throw Error('This place has no mapped location.');
      const lat=typeof place.location.lat==='function'?place.location.lat():Number(place.location.lat);
      const lng=typeof place.location.lng==='function'?place.location.lng():Number(place.location.lng);
      if(!coordsValid(lat,lng))throw Error('Invalid map coordinates.');
      reverseToken++;
      chooseAddress(place.addressComponents||[],place.formattedAddress);
      setCoordinates(lat,lng);
      showStatus('Address, city and province filled from Google Maps. Review and Save Branch.');
    }catch(e){showStatus('Google Maps could not resolve that place: '+(e.message||'Try another result.'));}
  }
  async function loadGoogleMaps(apiKey){
    if(window.google?.maps?.importLibrary)return;
    await new Promise((resolve,reject)=>{
      const callback='__donmacGoogleMapsLoaded';
      const script=document.createElement('script');
      const cleanup=()=>{delete window[callback];};
      const timeout=setTimeout(()=>{cleanup();reject(new Error('Google Maps timed out.'))},15000);
      window[callback]=()=>{clearTimeout(timeout);cleanup();resolve();};
      script.async=true;
      script.src='https://maps.googleapis.com/maps/api/js?key='+encodeURIComponent(apiKey)+'&v=weekly&loading=async&callback='+callback;
      script.onerror=()=>{clearTimeout(timeout);cleanup();reject(new Error('Google Maps script was blocked. Check the API key and permitted domain.'))};
      document.head.appendChild(script);
    });
  }
  // Key-free alternative: use the exact mapping stack from Cebu Transport Guide,
  // with an OSM basemap and manually confirmable destination pins.
  async function initOsmPicker(){
    await window.donmacLeafletReady();
    const Lf=window.L;
    osmMap=Lf.map(mapEl,{zoomControl:true,scrollWheelZoom:false,attributionControl:true})
      .setView([DEFAULT_CENTER.lat,DEFAULT_CENTER.lng],6);
    Lf.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
      maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
    }).addTo(osmMap);
    mapEl.setAttribute('aria-label','OpenStreetMap branch location picker');
    placeholder.classList.add('hidden');
    const host=$('branchGoogleSearch');
    const searchInput=document.createElement('input');
    searchInput.id='branchOpenMapSearch';searchInput.type='search';
    searchInput.placeholder='Search Philippine branches, streets or landmarks';
    searchInput.autocomplete='off';
    searchInput.setAttribute('aria-label','Search branch location');
    const choices=document.createElement('div');choices.id='branchOpenMapResults';
    choices.className='branch-open-map-results';
    host.replaceChildren(searchInput,choices);
    searchInput.addEventListener('input',()=>{
      clearTimeout(searchDelay);if(searchAbort)searchAbort.abort();
      choices.replaceChildren();
      const query=searchInput.value.trim();
      if(query.length<3)return;
      searchDelay=setTimeout(async()=>{
        const controller=new AbortController();searchAbort=controller;
        try{
          const url=new URL('https://photon.komoot.io/api/');
          url.searchParams.set('q',query+', Philippines');url.searchParams.set('limit','5');
          url.searchParams.set('bbox','116,4,128,22');url.searchParams.set('lang','en');
          const reply=await fetch(url,{signal:controller.signal});
          if(!reply.ok)throw Error('Search temporarily unavailable.');
          const data=await reply.json();
          if(searchInput.value.trim()!==query||controller.signal.aborted)return;
          choices.replaceChildren();
          for(const f of (data.features||[]).slice(0,5)){
            const p=f.properties||{},c=f.geometry?.coordinates||[];
            if(String(p.countrycode||'PH').toUpperCase()!=='PH'||!coordsValid(Number(c[1]),Number(c[0])))continue;
            const button=document.createElement('button');
            button.type='button';button.className='branch-open-map-result';
            button.textContent=[p.name||p.street,p.city||p.county,p.state].filter(Boolean).join(', ');
            button.addEventListener('click',()=>{
              searchInput.value=button.textContent;
              choices.replaceChildren();applyOsmAddress(p);
              setCoordinates(c[1],c[0]);
              showStatus('Destination pin selected. Review the address and Save Branch.');
            });
            choices.appendChild(button);
          }
        }catch(e){if(e.name!=='AbortError')showStatus('Search unavailable. Click the map to select your delivery destination.');}
      },850);
    });
    osmMap.on('click',e=>reverseFromOsm(e.latlng));
    if(selected)putPin();
    showStatus('OpenStreetMap ready (no API key). Search for the branch or click the map to place its pin.');
    setTimeout(()=>osmMap.invalidateSize(),180);
  }
  function applyOsmAddress(p){
    if(!p)return;
    const street=[p.name,p.housenumber,p.street,p.district].filter(Boolean).join(', ');
    if(street)$('branchAddress').value=street.slice(0,250);
    if(p.city||p.town||p.county)$('branchCity').value=String(p.city||p.town||p.county).slice(0,100);
    if(p.state)$('branchProvince').value=String(p.state).slice(0,100);
    if(p.postcode)$('branchPostalCode').value=String(p.postcode).slice(0,12);
    if(p.country)$('branchCountry').value=p.country==='Philippines'?'Philippines':'Other';
  }
  async function reverseFromOsm(point){
    const lat=Number(point.lat),lng=Number(point.lng);
    if(!coordsValid(lat,lng))return;
    const token=++reverseToken;
    setCoordinates(lat,lng);
    showStatus('Pin selected. Finding nearby address information…');
    try{
      const u=new URL('https://photon.komoot.io/reverse');
      u.searchParams.set('lat',String(lat));u.searchParams.set('lon',String(lng));u.searchParams.set('limit','1');
      const r=await fetch(u);
      if(!r.ok)throw Error('Geocoding unavailable');
      const data=await r.json();
      if(token!==reverseToken)return;
      applyOsmAddress(data.features?.[0]?.properties);
      showStatus('Pin saved on map. Confirm the street, city and province, then Save Branch.');
    }catch(e){
      if(token===reverseToken)showStatus('Pin selected. Enter or verify the address manually, then Save Branch.');
    }
  }
  async function init(){
    if(initPromise)return initPromise;
    initPromise=(async()=>{
      showStatus('Checking Google Maps configuration…');
      const response=await fetch('/api/maps/config',{credentials:'same-origin',cache:'no-store'});
      if(!response.ok)throw Error('Cannot load the Google Maps configuration.');
      const config=await response.json();
      if(!config.enabled||!config.key){
        placeholder.textContent='Opening the key-free map…';
        await initOsmPicker();
        return;
      }
      placeholder.textContent='Loading Google Maps…';
      await loadGoogleMaps(config.key);
      const [{Map},{PlaceAutocompleteElement},{Geocoder}]=await Promise.all([
        google.maps.importLibrary('maps'),
        google.maps.importLibrary('places'),
        google.maps.importLibrary('geocoding')
      ]);
      map=new Map(mapEl,{center:selected||DEFAULT_CENTER,zoom:selected?17:6,
        mapTypeControl:false,streetViewControl:false,fullscreenControl:true,clickableIcons:false});
      geocoder=new Geocoder();
      autocomplete=new PlaceAutocompleteElement();
      autocomplete.placeholder='Search a branch, building, street or landmark';
      autocomplete.includedRegionCodes=['ph'];
      $('branchGoogleSearch').replaceChildren(autocomplete);
      autocomplete.addEventListener('gmp-select',selectedPlace);
      map.addListener('click',e=>{if(e.latLng)reverseLookup(e.latLng)});
      // Initialize even when the editing form was populated before the map became visible.
      ready=true;
      placeholder.classList.add('hidden');
      putPin();
      if(!selected)showStatus('Search for a place above, or click the map to select the branch entrance.');
      const obs=new ResizeObserver(()=>{
        if(ready && mapEl.clientWidth>0 && mapEl.clientHeight>0){
          google.maps.event.trigger(map,'resize');
          if(selected)map.setCenter(selected);
        }
      });
      obs.observe(mapEl);
    })().catch(err=>{
      placeholder.classList.remove('hidden');
      placeholder.textContent='Google Maps could not load. Check your API key, enabled Maps/Places/Geocoding APIs and billing.';
      showStatus(err.message||'Google Maps unavailable.');
      console.warn('Branch Google Maps:',err);
    });
    return initPromise;
  }
  for(const id of ['branchAddress','branchCity','branchProvince']){
    $(id).addEventListener('input',()=>{
      if(selected){setCoordinates(null,null);showStatus('Address was changed manually. Search the map again to confirm the destination pin.');}
    });
  }
  $('branchCountry').addEventListener('change',()=>{
    if(selected)setCoordinates(null,null);
  });
  window.donmacBranchGeo={reset,setCoordinates,getCoordinates,open:init};
  if('IntersectionObserver' in window){
    const observer=new IntersectionObserver(entries=>{
      if(entries.some(e=>e.isIntersecting)){observer.disconnect();init();}
    });
    observer.observe(mapEl);
  }else init();
})();