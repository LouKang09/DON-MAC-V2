'use strict';
const assert=require('node:assert/strict'),g=require('../lib/legacy-catalog-guard');
const db={async query(sql,p){
 assert(sql.includes('starter_catalog_templates'));
 return{rows:p[0]===1?[{one:1}]:[]};
}};
(async()=>{
 for(const path of ['/api/catalog','/api/quote','/api/sales','/api/dashboard',
  '/api/inventory/transfer','/api/reports/sales','/api/admin/products/1',
  '/api/backups/data-export']){
  assert(g.usesSharedCatalog(path),path);
  await g.preventSharedCatalogLeak(db,{id:1},path);
  await assert.rejects(g.preventSharedCatalogLeak(db,{id:2},path),{status:409});
 }
 for(const path of ['/api/branches','/api/admin/isolation/catalog-preview',
  '/api/account/subscription','/api/chat/messages']){
  assert(!g.usesSharedCatalog(path),path);
  await g.preventSharedCatalogLeak(db,{id:2},path);
 }
 console.log('PASS: legacy catalog endpoints blocked for uncutover franchise tenants');
})().catch(e=>{console.error(e);process.exitCode=1;});
