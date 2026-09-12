(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.CoffeePosUiUtils=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  function text(log){
    return `${log?.status||''} ${log?.activity||''} ${log?.remark||''} ${log?.actor||''}`.toUpperCase();
  }
  function classifyLogEntry(log){
    const t=text(log);
    if(/\b(REPORT|EMAIL SENT|EMAIL FAILED|SALES PDF|COSTING PDF|DAILY REPORT|WEEKLY REPORT|MONTHLY REPORT|YEARLY REPORT)\b/.test(t))return'reports';
    if(/\b(SALE|SOLD|DELETED|TRANSACTION)\b/.test(t))return'sales';
    if(/\b(REPLENISH|REPLENISHED|TRANSFER|TRANSFERRED|STOCK|INVENTORY)\b/.test(t))return'inventory';
    if(/\b(USER|ACCOUNT|PASSWORD|LOGIN|SIGN IN|SIGNED IN|ACCESS)\b/.test(t))return'users';
    if(/\b(DATABASE|BACKUP|RESTORE|RESTORED|DATABASE SAVED)\b/.test(t))return'database';
    if(/\b(PRODUCT|PROMO|PACKAGE|RECIPE|INGREDIENT|SETTINGS|SETUP|CATALOG|MEASUREMENT)\b/.test(t))return'catalog';
    return'other';
  }
  function filterLogs(logs,category='all',search=''){
    const q=String(search||'').trim().toUpperCase();
    return (logs||[]).filter(log=>{
      if(category&&category!=='all'&&classifyLogEntry(log)!==category)return false;
      if(!q)return true;
      return text(log).includes(q);
    });
  }
  function isUpdateUnread(currentVersion,seenVersion){
    const current=String(currentVersion||'').trim(),seen=String(seenVersion||'').trim();
    return !!current&&current!==seen;
  }
  function mergeBatchItem(batch,item){
    const id=Number(item?.ingredientId),qty=Number(item?.qty);
    if(!Number.isInteger(id)||id<=0||!Number.isFinite(qty)||qty<=0)return Array.isArray(batch)?batch.slice():[];
    const out=(Array.isArray(batch)?batch:[]).map(x=>({...x}));
    const found=out.find(x=>Number(x.ingredientId)===id);
    if(found)found.qty=Number(found.qty||0)+qty;
    else out.push({...item,ingredientId:id,qty});
    return out;
  }
  return{classifyLogEntry,filterLogs,isUpdateUnread,mergeBatchItem};
});
