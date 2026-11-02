'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const read=p=>fs.readFileSync(p,'utf8');
const html=read('public/index.html'),core=read('public/app-core.js'),
 server=read('server.js'),batch=read('public/catalog-batch-v1544.js'),
 css=read('public/pos-catalog-v1544.css'),loader=read('public/app.js');
for(const id of ['adminProductsBodyPagination','adminIngredientsBodyPagination','adminPromosBodyPagination',
 'adminPackagesBodyPagination','recipeBatchArea','compositionBatchArea','recipeBatchDrop',
 'compositionBatchDrop','downloadDataArchive','retentionDemoEnabled','retentionFrequency','saveRetentionPreference']){
 assert.equal([...html.matchAll(new RegExp('id="'+id+'"','g'))].length,1,'Control missing/duplicated: '+id);
}
assert(html.includes('POS Catalog'));
assert(!html.includes('data-admin-tab="settings"'),'Settings tab should be removed');
assert(!html.includes('To preserve the original VBA rule'));
for(const id of ['productActive','ingredientActive','promoActive','packageActive','posCategoryActive']){
 assert(html.includes('id="'+id+'"'));
}
assert.equal([...html.matchAll(/class="catalog-help"/g)].length>=5,true);
assert(html.includes('Save Recipe') && html.includes('Save Composition'));
for(const type of ['products','ingredients','promos','packages']){
 assert(core.includes("catalogPage('"+type+"'"),type+' list is missing 10-row pagination');
}
assert(css.includes('pos-category-product-option input[type=checkbox]'));
assert(css.includes('.pos-category-product-option span'));
assert(css.includes('.catalog-batch-grid'));
assert(css.includes('.catalog-active-row'));
assert(loader.includes('catalog-batch-v1544.js'));
assert(loader.includes('pos-catalog-v1544.css'));
assert(server.includes("const APP_VERSION = '1.5.45-catalog-icons-package-layout';"));
assert(!server.includes('DELETE FROM sales WHERE sold_at <'));
assert(server.includes("/api/backups/data-export"));
assert(server.includes("makePortableDataExport"));
assert(server.includes("historicDataAccessRestricted:false"));
assert(server.includes("automaticOffsiteBackupActive:false"));

// Exercise batch selection with a minimal fake DOM; no browser/build deps.
const elements=new Map();
class Element {
 constructor(id){this.id=id;this.handlers={};this.value='';this.checked=false;this.indeterminate=false;this.dataset={};this.innerHTML='';this.textContent='';this.classList={add(){},remove(){}};}
 addEventListener(name,handler){this.handlers[name]=handler;}
}
function get(id){if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id);}
const added={recipe:[],composition:[]};
const bridge={
 source(kind){return kind==='recipe'
  ?[1,2,3,4].map(id=>({id,name:'Ingredient '+id,unit:'g'}))
  :[5,6,7].map(id=>({id,name:'Product '+id,unit:'Food'}));},
 selected(kind){return added[kind];},
 add(kind,ids){added[kind].push(...ids);}
};
vm.runInNewContext(batch,{
 window:{DonMacCatalogBatchBridge:bridge},
 document:{getElementById:get},
 Event:class Event{},
 JSON,Set,Number,Math,String
});
function check(kind,id,checked,shift=false){
 const pre=kind==='recipe'?'recipeBatch':'compositionBatch';
 const field={dataset:{batchCheck:String(id),shiftHeld:shift?'1':'0'},checked,
   closest(selector){return selector==='[data-batch-check]'?this:null;}};
 get(pre+'Choices').handlers.change({target:field,shiftKey:false});
}
check('recipe',1,true);
check('recipe',3,true,true);
assert.equal(get('recipeBatchCount').textContent,'3 selected',
 'Shift-check should select full range of items');
get('recipeBatchAddSelected').handlers.click();
assert.deepEqual([...added.recipe],[1,2,3]);
assert.equal(get('recipeBatchCount').textContent,'0 selected');
check('composition',5,true);
get('compositionBatchAddSelected').handlers.click();
assert.deepEqual([...added.composition],[5]);
let dragged;
const transfer={
 effectAllowed:'',setData(type,data){if(type==='application/x-donmac-catalog-batch')dragged=data;},
 getData(type){return type==='application/x-donmac-catalog-batch'?dragged:''}
};
get('compositionBatchChoices').handlers.dragstart({target:{
 dataset:{batchId:'6'},closest(selector){return selector==='[data-batch-id]'?this:null;}
},dataTransfer:transfer});
get('compositionBatchDrop').handlers.drop({preventDefault(){},dataTransfer:transfer});
assert.deepEqual([...added.composition],[5,6]);

// Export must use fixed allowlisted business tables, never credentials/tokens.
const from=server.indexOf('const DATA_EXPORT_TABLES='),to=server.indexOf('async function deleteSale(',from);
assert(from>=0&&to>from);
let preference=null;const writes=[],now='2026-11-02T08:00:00.000Z';
const tables={sales:[{id:1,reference:'SALE-1',actual:100}],products:[{id:2,name:'Don Coffee'}]};
const fakeTx={
 engine:'postgres',
 async query(sql,args=[]){
  if(sql.startsWith('SET TRANSACTION'))return {rows:[]};
  if(sql.includes('information_schema.tables'))
   return {rows:Object.hasOwn(tables,args[1])?[{ok:1}]:[]};
  if(sql.startsWith('SELECT * FROM ')){
   const table=sql.slice('SELECT * FROM '.length).split(' ')[0];
   return {rows:tables[table]||[]};
  }
  if(sql.startsWith('SELECT setting_value FROM app_settings'))
   return {rows:preference?[{setting_value:preference}]:[]};
  if(sql.startsWith('INSERT INTO app_settings')){
   preference=args[1];writes.push(preference);return {rows:[]};
  }
  throw Error('Unknown SQL in export test: '+sql);
 }
};
const scope={
 db:{...fakeTx,async transaction(callback){return callback(fakeTx);}},
 Buffer,Date,JSON,Number,String,Math,
 nowIso:()=>now,
 requireAdminRole:u=>{if(u?.role!=='Admin')throw Object.assign(new Error('Admin required'),{status:403});},
 logAction:async()=>{},Object
};
vm.runInNewContext(server.slice(from,to),scope);
(async()=>{
 const data=await scope.makePortableDataExport();
 const json=JSON.parse(data.buffer.toString('utf8'));
 assert.equal(json.format,'donmac-business-data-archive');
 assert.equal(json.restoreSupported,false);
 assert.equal(json.tables.sales.length,1);
 assert.equal(json.tables.products.length,1);
 assert(!('sessions' in json.tables));
 assert(!('users' in json.tables));
 assert(!('chat_messages' in json.tables));
 assert(data.filename.endsWith('.json'));
 let retention=await scope.getRetentionPreview();
 assert.equal(retention.demoEnabled,false);
 assert.equal(retention.automaticRetentionActive,false);
 assert.equal(retention.historicDataAccessRestricted,false);
 await assert.rejects(()=>scope.saveRetentionPreview({role:'User'},{
  demoEnabled:true,frequency:'monthly'}),e=>e.status===403);
 retention=await scope.saveRetentionPreview({role:'Admin',id:1},{
  demoEnabled:true,frequency:'quarterly'});
 assert.equal(retention.demoEnabled,true);
 assert.equal(retention.frequency,'quarterly');
 assert.equal(retention.automaticOffsiteBackupActive,false);
 assert.equal(writes.length,1);
 await assert.rejects(()=>scope.saveRetentionPreview({role:'Admin',id:1},{
  demoEnabled:true,frequency:'weekly'}),e=>e.status===400);
 console.log('v1.5.44 catalog batch, 10-row navigation, and safe archive tests passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
