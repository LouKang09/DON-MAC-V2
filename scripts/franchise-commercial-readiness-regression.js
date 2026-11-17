'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const html=read('public/index.html');
const collapse=read('public/sidebar-collapse-core-v20261117.js');
const hierarchy=read('public/nav-hierarchy-v20261117.js');
const adapter=read('public/franchise-unified-adapter.js');
const router=read('lib/franchise-live-router.js');
const core=read('public/app-core.js');
const logs=require('../lib/franchise-live-system-logs');
async function run(){
 assert.match(html,/sidebar-collapse-core-v20261117\.js/);
 assert.match(html,/franchise-system-logs-v20261117\.css/);
 assert.match(adapter,/p==='\/api\/system-logs'&&method==='GET'/);
 assert.match(router,/p==='\/api\/live\/system-logs'/);
 assert.match(core,/liveSystemLogControls/);
 const dom=new JSDOM(html,{url:'https://donmacpos.com/',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;
 w.eval(hierarchy);w.eval(collapse);
 const app=w.document.getElementById('app');
 const toggle=w.document.getElementById('sidebarToggle');
 assert(toggle&&app);
 assert.equal(app.classList.contains('sidebar-collapsed'),false);
 toggle.click();
 assert.equal(app.classList.contains('sidebar-collapsed'),true);
 assert.equal(toggle.getAttribute('aria-expanded'),'false');
 assert.equal(toggle.getAttribute('aria-label'),'Expand navigation');
 assert.equal(w.localStorage.getItem('donmac.sidebar.collapsed'),'1');
 toggle.click();
 assert.equal(app.classList.contains('sidebar-collapsed'),false);
 assert.equal(toggle.getAttribute('aria-expanded'),'true');
 w.donmacSidebarCollapse.set(true);
 assert.equal(app.classList.contains('sidebar-collapsed'),true);
 assert.equal(w.document.querySelectorAll('#mainNav button.nav[data-view]').length>3,true);
 assert(!w.document.querySelector('#mainNav .nav[data-view="dashboard"]').classList.contains('hidden'),
  'Collapse must preserve authorized navigation');
 w.close();
 let calls=0;
 const db={query:async(sql,args)=>{
  calls++;
  assert.equal(args[0],17,'Every audit query must be restricted to the authenticated workspace');
  assert.equal(args[1],50,'Every audit query must be bounded');
  assert.match(sql,/WHERE [a-z]\.workspace_id=\$1/,
    'Every query must select one workspace before returning rows');
  assert.match(sql,/chat_workspace_branches/,'Audit reads must join branch membership');
  if(sql.includes('FROM branch_sale_audit_events'))return{rows:[{
   id:'s1',event_name:'SALE_COMPLETED',note:'10 Matcha sold',created_at:'2026-11-17T01:00:00Z',
   branch_name:'Mabolo',reference:'BR-123',actor:'mark01'}]};
  if(sql.includes('FROM branch_inventory_movements'))return{rows:[
   {id:1,branch_id:42,movement_type:'LIVE_SALE',quantity_change:-.15,reference:'BR-123',
    remarks:'Checkout',created_at:'2026-11-17T01:00:00Z',display_name:'Milk',uom:'KG',
    branch_name:'Mabolo',actor:'mark01'},
   {id:2,branch_id:42,movement_type:'LIVE_SALE',quantity_change:-10,reference:'BR-123',
    remarks:'Checkout',created_at:'2026-11-17T01:00:00Z',display_name:'Cup',uom:'PCS',
    branch_name:'Mabolo',actor:'mark01'}
  ]};
  if(sql.includes('FROM branch_live_expenses'))return{rows:[{
   id:'e1',category:'Supplies',amount:125,notes:'Paper bag',incurred_at:'2026-11-17T00:00:00Z',
   branch_name:'Mabolo',actor:'mark01'}]};
  throw Error('Unexpected audit SQL: '+sql);
 }};
 const result=await logs.list(db,{admin:true,workspaceId:17},50);
 assert.equal(calls,3);
 assert.equal(result.logs.length,3,'Two stock rows for one sale should be grouped into a single audit entry');
 assert.deepEqual(new Set(result.logs.map(x=>x.category)),new Set(['Sales','Inventory','Expenses']));
 assert(result.logs.some(x=>/2 ingredient movement/.test(x.activity)));
 assert(result.logs.every(x=>x.remark.includes('Mabolo')));
 assert.match(result.coverage,/not backfilled/);
 await assert.rejects(logs.list(db,{admin:false,workspaceId:17},50),{status:403});
 await assert.rejects(logs.list(db,{admin:true,workspaceId:0},50),{status:403});
 console.log('PASS: shared sidebar toggle, visible navigation, workspace-scoped System Logs and owner-only authorization');
}
run().catch(e=>{console.error(e);process.exitCode=1});
