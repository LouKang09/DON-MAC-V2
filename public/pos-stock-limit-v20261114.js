'use strict';
// Stock-aware POS cart planner. Uses the server's active recipe snapshots and
// never changes inventory. Actual checkout remains the final transactional guard.
(function(root,factory){
 const engine=factory();
 if(typeof module==='object'&&module.exports)module.exports=engine;
 if(root)root.donmacPosStock=engine;
})(typeof window!=='undefined'?window:null,function(){
 const n=x=>Number(x||0);
 const valid=x=>Number.isFinite(n(x))&&n(x)>=0;
 const match=(items,id)=>items.find(x=>String(x.id)===String(id));
 const fmt=x=>n(x).toLocaleString('en-PH',{maximumFractionDigits:6});
 const phrase=x=>x?.name||x?.code||'Ingredient';
 function stockRows(catalog,line){
  if(line.kind==='product'){
   const product=match(catalog?.products||[],line.id);
   if(!product)return{error:'Selected product is no longer available.'};
   if(!product.recipeConfigured||!Array.isArray(product.recipeStock)||!product.recipeStock.length)
    return{error:product.name+' needs a recipe before it can be sold.'};
   return{rows:product.recipeStock,product};
  }
  if(line.kind==='package'){
   const item=match(catalog?.packages||[],line.id);
   if(!item||!item.sellable||!item.available)
    return{error:(item?.name||'Package')+' has unavailable contents or ingredients.'};
   if(!Array.isArray(item.recipeStock)||!item.recipeStock.length)
    return{error:(item?.name||'Package')+' needs a configured ingredient recipe.'};
   return{rows:item.recipeStock,product:item};
  }
  return{rows:[]};
 }
 function evaluate(catalog,cart){
  if(!catalog)return{ok:false,message:'Product stock is being loaded.',shortages:[]};
  const required=new Map();
  for(const line of cart||[]){
   if(!['product','package'].includes(line.kind))continue;
   const qty=Number(line.qty);
   if(!Number.isSafeInteger(qty)||qty<1)
    return{ok:false,message:'Quantity must be a positive whole number.',shortages:[]};
   const found=stockRows(catalog,line);
   if(found.error)return{ok:false,message:found.error,shortages:[]};
   for(const row of found.rows){
    const id=Number(row.ingredientId),unit=Number(row.required);
    if(!Number.isSafeInteger(id)||id<1||!Number.isFinite(unit)||unit<=0||
       !valid(row.current)||!valid(row.threshold))
     return{ok:false,message:'Ingredient quantities need to be refreshed before checkout.',shortages:[]};
    const use=unit*qty;
    if(!required.has(id))required.set(id,{ingredientId:id,name:phrase(row),uom:row.uom||'',
      stock:n(row.current),threshold:n(row.threshold),needed:0,active:row.active!==false});
    const current=required.get(id);
    current.stock=Math.min(current.stock,n(row.current));
    current.threshold=Math.max(current.threshold,n(row.threshold));
    current.active=current.active&&row.active!==false;
    current.needed+=use;
   }
  }
  const shortages=[...required.values()].filter(x=>!x.active||x.needed>x.stock+1e-9)
   .map(x=>({...x,shortage:Math.max(0,x.needed-x.stock)}));
  if(shortages.length){
   const first=shortages[0];
   const why=!first.active?' is unavailable':
    ' needs '+fmt(first.needed)+' '+first.uom+' (on hand '+fmt(first.stock)+' '+first.uom+')';
   return{ok:false,shortages,usage:[...required.values()],
    message:first.name+why+(shortages.length>1?' and '+(shortages.length-1)+' other ingredient(s)':'')+'.'};
  }
  const low=[...required.values()].filter(x=>x.stock-x.needed<=x.threshold+1e-9);
  return{ok:true,usage:[...required.values()],shortages:[],low,
    message:low.length?'Low remaining ingredient stock: '+low.map(x=>x.name).join(', '):''};
 }
 function next(catalog,cart,kind,id){
  const draft=(cart||[]).map(x=>({...x}));
  const found=draft.find(x=>x.kind===kind&&String(x.id)===String(id));
  if(found)found.qty++;
  else draft.push({kind,id,qty:1});
  return evaluate(catalog,draft);
 }
 function lowFor(catalog,cart,kind,id){
  const item=next(catalog,cart,kind,id);
  if(!item.ok)return{...item,low:[]};
  const after=next(catalog,[...(cart||[]).map(x=>({...x})),
    {kind,id,qty:1}],kind,id);
  const fresh=stockRows(catalog,{kind,id});
  const usages=(item.usage||[]), ids=new Set((fresh.rows||[]).map(x=>Number(x.ingredientId)));
  const thresholds=usages.filter(x=>ids.has(x.ingredientId)&&
    (x.stock-x.needed<=x.threshold+1e-9||
     (!after.ok&&(after.shortages||[]).some(s=>s.ingredientId===x.ingredientId))));
  return{...item,low:thresholds,lastUnit:!after.ok};
 }
 return{evaluate,next,lowFor,fmt};
});
