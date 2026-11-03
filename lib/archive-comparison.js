'use strict';
const crypto=require('node:crypto');
const MAX_ARCHIVE_BYTES=60*1024*1024;
const MAX_ROWS=75000;
const LIFETIME_MS=24*60*60*1000;
const TABLES=Object.freeze([
  'branches','products','add_ons','ingredients','product_ingredients','packages',
  'package_items','promos','pos_categories','pos_category_products','sales',
  'sale_items','sale_item_components','inventory_movements','system_logs'
]);
const TABLE_SET=new Set(TABLES);
const COMPOSITE_KEYS={
  product_ingredients:['product_id','ingredient_id'],
  package_items:['package_id','product_id'],
  pos_category_products:['pos_category_id','product_id'],
  sale_item_components:['sale_item_id','ingredient_id']
};
const failure=(message,status=400)=>Object.assign(new Error(message),{status});
async function readArchiveUpload(req){
  const len=Number(req.headers['content-length']||0);
  if(len>MAX_ARCHIVE_BYTES)throw failure('Archive is larger than 60 MB. Upload a smaller JSON data export.',413);
  const chunks=[];let size=0;
  const raw=await new Promise((resolve,reject)=>{
    let finished=false;
    const fail=e=>{if(finished)return;finished=true;reject(e);};
    req.on('data',chunk=>{
      if(finished)return;
      size+=chunk.length;
      if(size>MAX_ARCHIVE_BYTES){fail(failure('Archive is larger than 60 MB.',413));req.resume();return;}
      chunks.push(chunk);
    });
    req.on('end',()=>{if(finished)return;finished=true;resolve(Buffer.concat(chunks,size));});
    req.on('error',fail);
    req.on('aborted',()=>fail(failure('Archive upload interrupted.',400)));
  });
  if(!raw.length)throw failure('Choose a downloaded Don Mac JSON data archive.');
  let archive;try{archive=JSON.parse(raw.toString('utf8'));}catch(_){throw failure('The uploaded archive is not valid JSON.');}
  if(!archive||archive.format!=='donmac-business-data-archive'||archive.version!==1||
      !archive.tables||typeof archive.tables!=='object'||Array.isArray(archive.tables)||
      !archive.counts||typeof archive.counts!=='object'||Array.isArray(archive.counts))
    throw failure('Unsupported archive. Upload the JSON created by Download Data Archive in Don Mac POS.');
  const keys=Object.keys(archive.tables);
  if(!keys.length||keys.some(t=>!TABLE_SET.has(t)))throw failure('Archive includes unsupported or missing tables.');
  for(const table of keys){
    const rows=archive.tables[table];
    if(!Array.isArray(rows)||rows.length>MAX_ROWS||
        !rows.every(row=>row&&typeof row==='object'&&!Array.isArray(row))||
        archive.counts[table]!==rows.length)
      throw failure('Invalid archive rows or row counts in '+table+'.');
  }
  if(archive.exportedAt&&!Number.isFinite(Date.parse(archive.exportedAt)))
    throw failure('Archive export date is invalid.');
  return {archive,byteLength:size,sha256:crypto.createHash('sha256').update(raw).digest('hex')};
}
const rowId=(table,row,i)=>{
  if(row.id!==undefined&&row.id!==null)return String(row.id);
  const keys=COMPOSITE_KEYS[table];
  if(keys&&keys.every(k=>row[k]!==undefined))return keys.map(k=>String(row[k])).join('|');
  return '#'+i;
};
const canonical=value=>{
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object'&&!(value instanceof Date))
    return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value instanceof Date?value.toISOString():value;
};
const digest=row=>crypto.createHash('sha256').update(JSON.stringify(canonical(row))).digest('hex');
function compareTable(table,archived,live){
  const fromRows=new Map(archived.map((x,i)=>[rowId(table,x,i),digest(x)]));
  const liveRows=new Map(live.map((x,i)=>[rowId(table,x,i),digest(x)]));
  let onlyArchive=0,onlyLive=0,changed=0,identical=0;
  for(const [key,hash] of fromRows){
    if(!liveRows.has(key))onlyArchive++;
    else if(liveRows.get(key)!==hash)changed++;
    else identical++;
  }
  for(const key of liveRows.keys())if(!fromRows.has(key))onlyLive++;
  return{table,archiveRows:archived.length,liveRows:live.length,
    onlyArchive,onlyLive,changed,identical};
}
async function compareArchive(conn,archive){
  return conn.transaction(async tx=>{
    if(tx.engine==='postgres')
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    const rows=[];
    for(const table of TABLES){
      if(!Object.hasOwn(archive.tables,table))continue;
      const check=tx.engine==='postgres'
        ?await tx.query('SELECT 1 FROM information_schema.tables WHERE table_schema=$1 AND table_name=$2',['public',table])
        :await tx.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=$1",[table]);
      if(!check.rows.length){rows.push({table,archiveRows:archive.tables[table].length,liveRows:0,
        onlyArchive:archive.tables[table].length,onlyLive:0,changed:0,identical:0});continue;}
      const live=await tx.query('SELECT * FROM '+table+' LIMIT '+(MAX_ROWS+1));
      if(live.rows.length>MAX_ROWS)throw failure('Live '+table+' exceeds the comparison row limit.',413);
      rows.push(compareTable(table,archive.tables[table],live.rows));
    }
    return rows;
  });
}
const keyForWorkspace=workspaceId=>'archive_compare_24h_ws_'+Number(workspaceId);
async function saveComparison(conn,workspaceId,user,info,filename){
  const comparedAt=new Date(),expiresAt=new Date(comparedAt.getTime()+LIFETIME_MS);
  const rows=await compareArchive(conn,info.archive);
  const value={filename:String(filename||'DonMac_Data_Archive.json').slice(0,180),
    uploadedAt:comparedAt.toISOString(),expiresAt:expiresAt.toISOString(),
    exportedAt:info.archive.exportedAt||null,engine:info.archive.databaseEngine||'unknown',
    sha256:info.sha256,size:info.byteLength,uploadedBy:user.username,
    tables:rows,viewOnly:true,restoreSupported:false};
  await conn.query('INSERT INTO app_settings(setting_key,setting_value,updated_at) VALUES($1,$2,$3) '+
    'ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_at=excluded.updated_at',
    [keyForWorkspace(workspaceId),JSON.stringify(value),comparedAt.toISOString()]);
  return {...value,active:true};
}
async function getComparison(conn,workspaceId,details=false){
  const record=await conn.query('SELECT setting_value FROM app_settings WHERE setting_key=$1',
    [keyForWorkspace(workspaceId)]);
  if(!record.rows.length)return{uploaded:false,active:false};
  let value;
  try{value=JSON.parse(record.rows[0].setting_value);}catch(_){return{uploaded:false,active:false};}
  const active=Number.isFinite(Date.parse(value.expiresAt))&&Date.now()<Date.parse(value.expiresAt);
  const meta={uploaded:true,active,filename:value.filename,uploadedAt:value.uploadedAt,
    expiresAt:value.expiresAt,exportedAt:value.exportedAt,uploadedBy:value.uploadedBy,
    viewOnly:true,restoreSupported:false};
  if(details&&!active)throw failure('This read-only comparison expired after 24 hours. Upload a new data archive to compare again.',410);
  return details?{...meta,tables:value.tables||[]}:meta;
}
module.exports={TABLES,readArchiveUpload,compareTable,compareArchive,saveComparison,getComparison};
