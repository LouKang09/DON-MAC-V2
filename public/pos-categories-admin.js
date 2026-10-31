/* Don Macchiatos POS 1.5.20 — icon and category button editor.
   A custom POS button is a collection of existing products, not a new pricing,
   inventory or promo type. All writes use existing admin-only API authentication. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  if(!$('posCategoryForm'))return;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const builtinSlugs={Coffee:'coffee','Non Coffee':'noncoffee',Food:'food','Add-ons':'addons',Promos:'promos',Packages:'packages'};
  let categories=[],products=[],chosenIcon=null,processing=false,invalid=false,generation=0;
  async function request(path,method='GET',body){
    const options={method,credentials:'same-origin',headers:{}};
    if(body!==undefined){options.headers['Content-Type']='application/json';options.body=JSON.stringify(body);}
    const resp=await fetch(path,options);
    let payload={};try{payload=await resp.json();}catch(_){}
    if(!resp.ok)throw new Error(payload.error||'Category request failed ('+resp.status+').');
    return payload;
  }
  function status(message,error){
    const el=$('posCategoryIconStatus');
    el.textContent=message;
    el.classList.toggle('error',!!error);
    $('posCategorySave').disabled=processing||invalid;
  }
  function iconHtml(item){
    if(item?.iconData&&/^data:image\/(png|webp);base64,/.test(item.iconData))
      return '<span class="pos-admin-icon"><img src="'+esc(item.iconData)+'" alt="" /></span>';
    return '<span class="pos-admin-icon category-icon-'+(builtinSlugs[item?.name]||'packages')+'"></span>';
  }
  function preview(){
    const name=$('posCategoryEditKey').value||'Packages';
    $('posCategoryIconPreview').innerHTML=iconHtml({name,iconData:chosenIcon});
  }
  function options(selected=[]){
    $('posCategoryProductChoices').innerHTML=products.filter(p=>p.active).map(p=>
      '<label class="pos-category-product-option"><input type="checkbox" value="'+Number(p.id)+'"'+
      (selected.includes(Number(p.id))?' checked':'')+' /><span>'+esc(p.name)+
      '<small>'+esc(p.category)+'</small></span></label>'
    ).join('')||'<span class="muted tiny">No active products available.</span>';
  }
  function clear(){
    generation++;chosenIcon=null;invalid=false;processing=false;
    $('posCategoryEditKey').value='';$('posCategoryName').value='';$('posCategoryName').readOnly=false;
    $('posCategoryActive').checked=true;$('posCategoryActive').disabled=false;
    $('posCategoryFormTitle').textContent='New Category Button';
    $('posCategoryIconFile').value='';
    $('posCategoryProductsFieldset').classList.remove('hidden');
    options([]);
    preview();status('Upload a PNG, JPG or WebP icon (optional).',false);
  }
  function edit(name){
    const c=categories.find(x=>x.name===name);
    if(!c)return;
    generation++;invalid=false;processing=false;
    $('posCategoryEditKey').value=c.name;
    $('posCategoryName').value=c.name;
    $('posCategoryName').readOnly=true;
    $('posCategoryActive').checked=c.active;
    $('posCategoryActive').disabled=c.builtin;
    $('posCategoryIconFile').value='';
    chosenIcon=c.iconData||null;
    $('posCategoryFormTitle').textContent='Edit '+c.name;
    $('posCategoryProductsFieldset').classList.toggle('hidden',!!c.builtin);
    options(c.productIds||[]);
    preview();status(c.iconData?'Custom icon loaded.':'Showing the standard icon.',false);
    $('posCategoryForm').scrollIntoView({behavior:'smooth',block:'nearest'});
  }
  function render(){
    $('posCategoryAdminList').innerHTML=categories.map(c=>
      '<div class="pos-category-admin-row">'+iconHtml(c)+
      '<div class="pos-category-admin-info"><strong>'+esc(c.name)+'</strong><small>'+
      (c.builtin?'Built-in category':'Custom product collection · '+c.productIds.length+' selected')+
      (c.active?'':' · Hidden')+'</small></div>'+
      '<div class="pos-category-admin-actions"><button type="button" data-category-edit="'+esc(c.name)+'">Edit icon</button>'+
      (c.builtin?'':'<button type="button" class="danger-link" data-category-delete="'+esc(c.name)+'">Remove</button>')+
      '</div></div>'
    ).join('')||'<p class="muted">No categories configured.</p>';
    $('posCategoryAdminList').querySelectorAll('[data-category-edit]').forEach(b=>b.addEventListener('click',()=>edit(b.dataset.categoryEdit)));
    $('posCategoryAdminList').querySelectorAll('[data-category-delete]').forEach(b=>b.addEventListener('click',()=>remove(b.dataset.categoryDelete)));
  }
  async function load(){
    try{
      const [cat,prods]=await Promise.all([request('/api/admin/pos-categories'),request('/api/admin/products')]);
      categories=cat.categories||[];products=prods.products||[];
      render();
      options([]);
      preview();
    }catch(err){status(err.message,true);$('posCategoryAdminList').textContent=err.message;}
  }
  async function remove(name){
    if(!confirm('Remove the '+name+' category button? The products and existing sales will remain unchanged.'))return;
    try{
      await request('/api/admin/pos-categories/'+encodeURIComponent(name),'DELETE');
      clear();await load();
      await window.refreshPosCatalogCategories?.();
    }catch(err){status(err.message,true);}
  }
  $('posCategoryClear').addEventListener('click',clear);
  $('posCategoryIconReset').addEventListener('click',()=>{
    generation++;processing=false;invalid=false;chosenIcon=null;$('posCategoryIconFile').value='';
    preview();status('Default icon selected. Save Category to apply it.',false);
  });
  $('posCategoryIconFile').addEventListener('change',async ev=>{
    const file=ev.target.files?.[0];if(!file)return;
    const run=++generation;
    const fail=msg=>{
      if(run!==generation)return;
      processing=false;invalid=true;ev.target.value='';status(msg,true);
    };
    processing=true;invalid=false;status('Checking and optimizing icon…',false);
    if(file.size>1024*1024){fail('Icon exceeds 1 MB. Choose a smaller file.');return;}
    if(file.size<32||!['image/png','image/jpeg','image/webp'].includes(file.type)){
      fail('Invalid icon. Choose PNG, JPG or WebP.');return;
    }
    try{
      const head=new Uint8Array(await file.slice(0,16).arrayBuffer());
      const png=[137,80,78,71,13,10,26,10].every((b,i)=>head[i]===b);
      const jpeg=head[0]===255&&head[1]===216&&head[2]===255;
      const webp=String.fromCharCode(...head.slice(0,4))==='RIFF'&&
        String.fromCharCode(...head.slice(8,12))==='WEBP';
      if(!(file.type==='image/png'&&png||file.type==='image/jpeg'&&jpeg||file.type==='image/webp'&&webp))
        throw new Error('This file is not a valid PNG, JPG or WebP image.');
      const src=await new Promise((resolve,reject)=>{
        const reader=new FileReader();reader.onload=()=>resolve(reader.result);
        reader.onerror=()=>reject(new Error('Could not read the icon.'));reader.readAsDataURL(file);
      });
      const img=new Image();await new Promise((resolve,reject)=>{
        img.onload=resolve;img.onerror=()=>reject(new Error('Could not decode the icon.'));
        img.src=src;
      });
      if(!img.naturalWidth||!img.naturalHeight||img.naturalWidth>12000||img.naturalHeight>12000)
        throw new Error('Invalid icon dimensions.');
      const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
      if(!ctx)throw new Error('Image processing is not supported by this browser.');
      let result=null,bytes=Infinity;
      for(const size of [180,144,112,88,64]){
        canvas.width=size;canvas.height=size;ctx.clearRect(0,0,size,size);
        const ratio=Math.min((size-8)/img.naturalWidth,(size-8)/img.naturalHeight);
        const width=img.naturalWidth*ratio,height=img.naturalHeight*ratio;
        ctx.drawImage(img,(size-width)/2,(size-height)/2,width,height);
        let data=canvas.toDataURL('image/webp',.75);
        if(!data.startsWith('data:image/webp;'))data=canvas.toDataURL('image/png');
        const amount=Math.ceil((data.length-data.indexOf(',')-1)*3/4);
        if(amount<=32*1024){result=data;bytes=amount;break;}
      }
      if(!result)throw new Error('Could not compress the icon below 32 KB. Choose a simpler image.');
      if(run!==generation)return;
      chosenIcon=result;processing=false;invalid=false;preview();
      status('Icon ready ('+Math.ceil(bytes/1024)+' KB). Save Category to apply.',false);
    }catch(error){fail(error.message||'Unable to process icon.');}
  });
  $('posCategoryForm').addEventListener('submit',async e=>{
    e.preventDefault();
    if(processing||invalid){status('Finish choosing a valid icon first.',true);return;}
    const key=$('posCategoryEditKey').value;
    const c=categories.find(x=>x.name===key);
    const body={
      name:$('posCategoryName').value.trim(),
      iconData:chosenIcon,
      active:$('posCategoryActive').checked,
      productIds:c?.builtin?[]:[...$('posCategoryProductChoices').querySelectorAll('input:checked')].map(x=>Number(x.value))
    };
    const btn=$('posCategorySave');btn.disabled=true;
    try{
      await request(key?'/api/admin/pos-categories/'+encodeURIComponent(key):'/api/admin/pos-categories',
        key?'PUT':'POST',body);
      clear();await load();
      await window.refreshPosCatalogCategories?.();
      status('Category saved. POS buttons updated.',false);
    }catch(error){status(error.message,true);}
    finally{btn.disabled=processing||invalid;}
  });
  document.querySelectorAll('#adminTabs [data-admin-tab="categories"]').forEach(btn=>{
    btn.addEventListener('click',load);
  });
  clear();
})();