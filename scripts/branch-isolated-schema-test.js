'use strict';
const assert=require('node:assert/strict');
const schema=require('../lib/branch-isolated-schema');
assert.equal(schema.TABLES.length,11);
for(const engine of ['postgres','sqlite']){
 const sql=schema.statements(engine);
 assert.equal(sql.filter(s=>s.startsWith('CREATE TABLE IF NOT EXISTS')).length,11);
 assert(sql.every(s=>/^CREATE (TABLE|UNIQUE INDEX|INDEX) IF NOT EXISTS/.test(s)));
 assert(sql.some(s=>s.includes('REFERENCES chat_workspace_branches(branch_id,workspace_id)')));
 for(const table of ['branch_recipes','branch_category_products','branch_package_items','branch_inventory_movements']){
  const ddl=sql.find(s=>s.includes('CREATE TABLE IF NOT EXISTS '+table+'('));
  assert(ddl.includes('workspace_id'),table+' requires workspace');
  assert(ddl.includes('branch_id'),table+' requires branch');
  assert(ddl.includes('REFERENCES branch_'),table+' requires scoped child FK');
  assert(ddl.includes('id,workspace_id,branch_id)'),table+' requires scoped reference');
 }
}
(async()=>{
 for(const engine of ['postgres','sqlite']){
  let commands=[],locked=false;
  const tx={
   engine,
   async exec(sql){commands.push(sql);},
   async query(sql){
    if(sql.includes('pg_advisory_xact_lock')){locked=true;return{rows:[]};}
    if(sql.includes('information_schema.tables')||sql.includes('sqlite_master'))
     return{rows:schema.TABLES.map(table_name=>({table_name}))};
    throw new Error('Unexpected SQL: '+sql);
   }
  };
  const db={engine,transaction:async fn=>fn(tx)};
  for(let n=0;n<2;n++){
   const result=await schema.migrate(db);
   assert(result.ready);
   assert.equal(result.tablesCreated,11);
  }
  assert.equal(commands.length,2*schema.statements(engine).length);
  assert.equal(locked,engine==='postgres');
 }
 console.log('PASS: additive branch isolation migration for PostgreSQL and SQLite');
})().catch(err=>{console.error(err);process.exitCode=1;});
