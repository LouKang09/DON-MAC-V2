'use strict';
// Account data routing is assigned by the SERVER, not by browser or username.
// SHARED = established legacy storage, NEW = isolated commercial franchise,
// TEMPORARY = explicit phase-2 sandbox. All modes use the same main POS origin.
const MODES=Object.freeze({SHARED:'SHARED',NEW:'NEW',TEMPORARY:'TEMPORARY'});
const allowed=new Set(Object.values(MODES));
const goodId=value=>Number.isSafeInteger(Number(value))&&Number(value)>0?Number(value):0;
function fail(message,status=403){return Object.assign(new Error(message),{status,code:'ACCOUNT_DATA_MODE'});}
async function migrate(db){
 const fk=db.engine==='postgres'?'BIGINT':'INTEGER';
 const timestamp=db.engine==='postgres'?'TIMESTAMPTZ':'TEXT';
 await db.exec('CREATE TABLE IF NOT EXISTS franchise_account_modes ('+
  'workspace_id '+fk+' PRIMARY KEY REFERENCES chat_workspaces(id) ON DELETE RESTRICT,'+
  "data_mode VARCHAR(12) NOT NULL CHECK(data_mode IN ('SHARED','NEW','TEMPORARY')),"+
  'assigned_at '+timestamp+' NOT NULL DEFAULT CURRENT_TIMESTAMP,'+
  'assigned_by VARCHAR(100) NOT NULL)');
}
// Only called in the same database transaction that provisions the workspace.
// A collision is never silently overwritten, avoiding live/sandbox reclassification.
async function register(tx,workspaceId,dataMode,assignedBy){
 const ws=goodId(workspaceId);
 if(!ws||!allowed.has(dataMode))throw fail('Invalid franchise workspace or data mode.',400);
 const actor=String(assignedBy||'Account provisioning').slice(0,100);
 await tx.query('INSERT INTO franchise_account_modes(workspace_id,data_mode,assigned_by) '+
  'VALUES($1,$2,$3) ON CONFLICT(workspace_id) DO NOTHING',[ws,dataMode,actor]);
 const stored=(await tx.query('SELECT data_mode FROM franchise_account_modes WHERE workspace_id=$1',[ws])).rows[0]?.data_mode;
 if(stored!==dataMode)throw fail('This franchise already has a different data mode. Contact Admin Control.',409);
 return stored;
}
async function forUser(db,userId){
 const uid=goodId(userId);
 if(!uid)throw fail('Authenticated user is required.',401);
 const r=await db.query('SELECT m.workspace_id,a.data_mode, '+
  'EXISTS(SELECT 1 FROM franchise_test_accounts f WHERE f.workspace_id=m.workspace_id) AS provisioned '+
  'FROM chat_memberships m LEFT JOIN franchise_account_modes a ON a.workspace_id=m.workspace_id '+
  'WHERE m.user_id=$1 ORDER BY m.workspace_id LIMIT 2',[uid]);
 if(r.rows.length>1)throw fail('A user cannot resolve to multiple franchise workspaces.');
 if(!r.rows.length)return{mode:MODES.SHARED,workspaceId:null,source:'legacy'};
 const x=r.rows[0],ws=goodId(x.workspace_id);
 if(!ws)throw fail('Invalid franchise workspace assignment.');
 const provisioned=x.provisioned===true||x.provisioned===1||x.provisioned==='1';
 const mode=x.data_mode||(provisioned?MODES.NEW:MODES.SHARED);
 if(!allowed.has(mode))throw fail('Unknown franchise data mode.');
 if(provisioned&&mode===MODES.SHARED || !provisioned&&mode!==MODES.SHARED)
  throw fail('Franchise data mode conflicts with its provisioned workspace.');
 return{mode,workspaceId:ws,source:x.data_mode?'explicit':'compatible-default'};
}
module.exports={MODES,migrate,register,forUser,fail};
