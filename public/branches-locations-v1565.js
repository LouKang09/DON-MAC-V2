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
  let ready = false;
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
  async function init(){
    if(initPromise)return initPromise;
    initPromise=(async()=>{
      showStatus('Checking Google Maps configuration…');
      const response=await fetch('/api/maps/config',{credentials:'same-origin',cache:'no-store'});
      if(!response.ok)throw Error('Cannot load the Google Maps configuration.');
      const config=await response.json();
      if(!config.enabled||!config.key){
        placeholder.textContent='Google Maps is not configured. Add GOOGLE_MAPS_BROWSER_API_KEY in Railway to enable interactive search and pin selection.';
        showStatus('Google Maps needs a browser API key. Branch addresses can still be entered and saved manually.');
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
      if(selected){setCoordinates(null,null);showStatus('Address was changed manually. Search Google Maps again to confirm the destination pin.');}
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