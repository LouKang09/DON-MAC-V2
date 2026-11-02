/* v1.5.44: accessible batch selection and drag/drop for recipe and composition. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const bridge=window.DonMacCatalogBatchBridge;
  if(!bridge || !$('recipeBatchArea') || !$('compositionBatchArea'))return;
  const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const models={
    recipe:{selected:new Set(),anchor:null,query:'',focused:null},
    composition:{selected:new Set(),anchor:null,query:'',focused:null}
  };
  function fields(kind){
    const pre=kind==='recipe'?'recipeBatch':'compositionBatch';
    return {area:$(pre+'Area'),search:$(pre+'Search'),all:$(pre+'All'),count:$(pre+'Count'),
      list:$(pre+'Choices'),drop:$(pre+'Drop'),add:$(pre+'AddSelected')};
  }
  function visible(kind){
    const q=models[kind].query.trim().toUpperCase();
    return bridge.source(kind).filter(x=>!q||String(x.name).toUpperCase().includes(q)||String(x.unit).toUpperCase().includes(q));
  }
  function refresh(kind){
    const m=models[kind],f=fields(kind),available=bridge.source(kind);
    const existing=new Set(available.map(x=>Number(x.id)));
    for(const id of m.selected)if(!existing.has(id))m.selected.delete(id);
    const rows=visible(kind),assigned=new Set(bridge.selected(kind).map(Number));
    f.list.innerHTML=rows.map(x=>{
      const id=Number(x.id),chosen=m.selected.has(id);
      return '<div class="catalog-batch-choice'+(chosen?' selected':'')+
        '" draggable="true" data-batch-id="'+id+'">'+
        '<input type="checkbox" aria-label="Select '+escape(x.name)+'" data-batch-check="'+id+'" '+
        (chosen?'checked ':'')+'/>'+
        '<span class="catalog-batch-name"><strong>'+escape(x.name)+'</strong>'+
        '<small>'+escape(x.unit||'')+(assigned.has(id)?' · Added to editor':'')+'</small></span>'+
        '<button type="button" data-batch-add="'+id+'" aria-label="Add '+escape(x.name)+' to editor" '+
        (assigned.has(id)?'disabled':'')+'>'+(assigned.has(id)?'Added':'＋ Add')+'</button></div>';
    }).join('')||'<p class="muted">No items match your search.</p>';
    const displayedIds=rows.map(x=>Number(x.id));
    const checked=displayedIds.filter(id=>m.selected.has(id)).length;
    f.count.textContent=m.selected.size+' selected';
    f.all.checked=rows.length>0&&checked===rows.length;
    f.all.indeterminate=checked>0&&checked<rows.length;
  }
  function add(kind,ids){
    const toAdd=[...new Set(ids)].filter(id=>Number.isInteger(Number(id)));
    if(!toAdd.length)return;
    bridge.add(kind,toAdd);
    models[kind].selected.clear();
    refresh(kind);
  }
  for(const kind of ['recipe','composition']){
    const m=models[kind],f=fields(kind);
    f.search.addEventListener('input',()=>{
      m.query=f.search.value;
      m.anchor=null;
      refresh(kind);
    });
    f.all.addEventListener('change',()=>{
      for(const x of visible(kind)){
        if(f.all.checked)m.selected.add(Number(x.id));
        else m.selected.delete(Number(x.id));
      }
      refresh(kind);
    });
    f.list.addEventListener('click',e=>{
      const row=e.target.closest('[data-batch-id]');
      if(!row)return;
      const id=Number(row.dataset.batchId);
      const addBtn=e.target.closest('[data-batch-add]');
      if(addBtn){add(kind,[id]);return;}
      if(e.target.closest('input[type=checkbox]'))return;
      const box=row.querySelector('input[type=checkbox]');
      box.checked=!box.checked;
      box.dataset.shiftHeld=e.shiftKey?'1':'0';
      box.dispatchEvent(new Event('change',{bubbles:true}));
    });
    f.list.addEventListener('change',e=>{
      const field=e.target.closest('[data-batch-check]');
      if(!field)return;
      const id=Number(field.dataset.batchCheck),ids=visible(kind).map(x=>Number(x.id));
      // Shift selection works between the first and last clicked checkbox.
      if((field.dataset.shiftHeld==='1'||e.shiftKey)&&m.anchor!==null&&ids.includes(m.anchor)){
        const first=ids.indexOf(m.anchor),last=ids.indexOf(id);
        for(let index=Math.min(first,last);index<=Math.max(first,last);index++){
          if(field.checked)m.selected.add(ids[index]);else m.selected.delete(ids[index]);
        }
      }else if(field.checked)m.selected.add(id);
      else m.selected.delete(id);
      m.anchor=id;
      field.dataset.shiftHeld='0';
      refresh(kind);
    });
    f.list.addEventListener('pointerdown',e=>{
      // checkbox clicks can carry the original Shift modifier through pointer events.
      const input=e.target.closest('input[data-batch-check]');
      if(input)input.dataset.shiftHeld=e.shiftKey?'1':'0';
    });
    f.list.addEventListener('dragstart',e=>{
      const row=e.target.closest('[data-batch-id]');
      if(!row||!e.dataTransfer)return;
      const id=Number(row.dataset.batchId);
      const ids=m.selected.has(id)?[...m.selected]:[id];
      e.dataTransfer.effectAllowed='copy';
      e.dataTransfer.setData('application/x-donmac-catalog-batch',JSON.stringify({kind,ids}));
      e.dataTransfer.setData('text/plain',kind+' item selection');
    });
    f.drop.addEventListener('dragover',e=>{
      e.preventDefault();
      if(e.dataTransfer)e.dataTransfer.dropEffect='copy';
      f.drop.classList.add('dragover');
    });
    f.drop.addEventListener('dragleave',()=>f.drop.classList.remove('dragover'));
    f.drop.addEventListener('drop',e=>{
      e.preventDefault();f.drop.classList.remove('dragover');
      try{
        const data=JSON.parse(e.dataTransfer?.getData('application/x-donmac-catalog-batch')||'null');
        if(data?.kind===kind&&Array.isArray(data.ids))add(kind,data.ids.slice(0,500));
      }catch(_){}
    });
    f.add.addEventListener('click',()=>add(kind,[...m.selected]));
    refresh(kind);
  }
  window.DonMacCatalogBatch={refresh};
})();
