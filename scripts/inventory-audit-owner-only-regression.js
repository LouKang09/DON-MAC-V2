'use strict';
// Run: node scripts/inventory-audit-owner-only-regression.js
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const html=source('public/index.html'),core=source('public/app-core.js'),
 css=source('public/audit-logs-compact-v1552.css'),
 bootstrap=source('public/app.js'),
 server=source('server.js'),router=source('lib/franchise-live-router.js');
assert.match(html,/<div id="inventoryAuditSection" class="card spaced inv-audit-card admin-only hidden" hidden inert aria-hidden="true">/);
assert.match(css,/#inventoryAuditSection\[hidden\]/);
assert.match(css,/#inventoryAuditSection\.hidden/);
assert.match(css,/display:none!important/);
assert.match(bootstrap,/app-core\.js\?v=20261125-audit-owner-only/);
assert.match(html,/app\.js\?v=1\.6\.57-inventory-audit-owner-only/);
assert.match(server,/if\(user\.role!=='Admin'\)throw Object\.assign\(new Error\('Inventory audit is Owner\/Admin-only\.'/);
assert.match(router,/if\(!ctx\.admin\)throw scope\.fail\('Inventory audit is Owner\/Admin-only\.',403\)/);
const start=core.indexOf("    const inventoryAllowed=isAdmin||userGrants.includes('inventory.view');");
const end=core.indexOf("    if($('replenishEntryType'))",start);
assert(start>=0&&end>start);
const body=core.slice(start,end);
assert.doesNotMatch(body,/\['#incomingSupplyPanel','.inv-operation-launch','.inv-audit-card'\]/);
const makeElement=()=>{
 const set=new Set(['hidden']);
 return {hidden:true,inert:true,attrs:{},classList:{
  contains:key=>set.has(key),toggle:(key,enabled)=>enabled?set.add(key):set.delete(key)
 },setAttribute(key,value){this.attrs[key]=value;}};
};
const audit=makeElement(),incoming=makeElement(),launch=makeElement();
const elements={'inventoryAuditSection':audit};
const doc={querySelectorAll(selector){
 if(selector==='#view-inventory #incomingSupplyPanel')return[incoming];
 if(selector==='#view-inventory .inv-operation-launch')return[launch];
 throw Error('Unexpected selector '+selector);
}};
const execute=new Function('isAdmin','userGrants','document','$',body);
const run=(isAdmin,grants)=>execute(isAdmin,grants,doc,id=>elements[id]);
run(false,['inventory.view']);
assert.equal(audit.hidden,true);
assert.equal(audit.inert,true);
assert.equal(audit.classList.contains('hidden'),true);
assert.equal(audit.attrs['aria-hidden'],'true');
assert.equal(incoming.classList.contains('hidden'),false,'Cashier granted stock operations must stay available');
assert.equal(launch.classList.contains('hidden'),false);
run(true,[]);
assert.equal(audit.hidden,false);
assert.equal(audit.inert,false);
assert.equal(audit.classList.contains('hidden'),false);
assert.equal(audit.attrs['aria-hidden'],'false');
run(false,[]);
assert.equal(audit.hidden,true);
assert.equal(audit.classList.contains('hidden'),true);
assert.equal(incoming.classList.contains('hidden'),true);
run(false,['inventory.view']);
assert.equal(audit.hidden,true,'No grant may make cashier audit card visible');
console.log('PASS Owner/Admin audit container, cashier inventory grants, role switch, API protection and cache refresh');
