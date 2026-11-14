'use strict';
// Independently grant finance capabilities to a cashier within a single franchise.
// POS checkout remains a cashier-role feature; Owners/Co-Owners retain admin access.
const KEYS=Object.freeze(['transactions.view','expenses.view','expenses.manage']);
const fail=(message,status=403)=>Object.assign(new Error(message),{status});
function normalize(input){
 if(!Array.isArray(input))throw fail('Permissions must be a list.',400);
 if(input.length>KEYS.length||input.some(x=>typeof x!=='string'||!KEYS.includes(x)))
  throw fail('Unknown account permission.',400);
 const unique=[...new Set(input)];
 if(unique.includes('expenses.manage')&&!unique.includes('expenses.view'))
  unique.push('expenses.view');
 return KEYS.filter(x=>unique.includes(x));
}
async function migrate(db){
 const fk=db.engine==='postgres'?'BIGINT':'INTEGER';
 const dt=db.engine==='postgres'?'TIMESTAMPTZ':'TEXT';
 await db.exec('CREATE TABLE IF NOT EXISTS cashier_feature_grants ('+
  'workspace_id '+fk+' NOT NULL REFERENCES chat_workspaces(id) ON DELETE CASCADE,'+
  'user_id '+fk+' NOT NULL REFERENCES users(id) ON DELETE CASCADE,'+
  'permission_key VARCHAR(40) NOT NULL,'+
  'granted_by '+fk+' REFERENCES users(id) ON DELETE SET NULL,'+
  'granted_at '+dt+' NOT NULL DEFAULT CURRENT_TIMESTAMP,'+
  'PRIMARY KEY(workspace_id,user_id,permission_key))');
 await db.exec('CREATE INDEX IF NOT EXISTS idx_cashier_feature_grants_user ON cashier_feature_grants(user_id)');
}
async function oneWorkspace(conn,userId){
 const rows=(await conn.query('SELECT workspace_id FROM chat_memberships WHERE user_id=$1 ORDER BY workspace_id LIMIT 2',[Number(userId)])).rows;
 if(rows.length!==1||!Number.isSafeInteger(Number(rows[0].workspace_id))||Number(rows[0].workspace_id)<1)
  throw fail('Account must have exactly one franchise workspace.');
 return Number(rows[0].workspace_id);
}
async function forUser(conn,user){
 if(!user?.id)return[];
 if(user.role==='Admin')return[...KEYS];
 const ws=await oneWorkspace(conn,user.id);
 const rows=(await conn.query(
  'SELECT permission_key FROM cashier_feature_grants WHERE workspace_id=$1 AND user_id=$2',
  [ws,Number(user.id)])).rows;
 return KEYS.filter(k=>rows.some(r=>r.permission_key===k));
}
async function allowed(conn,user,key){
 if(!KEYS.includes(key))return false;
 if(user?.role==='Admin')return true;
 if(user?.role!=='User'||!user?.branchActive&&user?.branchActive!==undefined)return false;
 return(await forUser(conn,user)).includes(key);
}
async function requireAccess(conn,user,key){
 if(!(await allowed(conn,user,key)))
  throw fail('This feature has not been granted by your Owner. Contact your Owner for access.');
}
async function forWorkspace(conn,workspaceId){
 const rows=(await conn.query(
  'SELECT user_id,permission_key FROM cashier_feature_grants WHERE workspace_id=$1',[Number(workspaceId)])).rows;
 const grants=new Map();
 for(const r of rows){
  if(!KEYS.includes(r.permission_key))continue;
  const id=Number(r.user_id);
  if(!grants.has(id))grants.set(id,[]);
  grants.get(id).push(r.permission_key);
 }
 return grants;
}
async function set(conn,actor,targetId,permissions){
 if(actor?.role!=='Admin')throw fail('Only an Owner or Co-Owner can grant cashier access.');
 const keys=normalize(permissions),ws=await oneWorkspace(conn,actor.id);
 if(!Number.isSafeInteger(Number(targetId))||Number(targetId)<1)throw fail('Invalid cashier account.',400);
 return conn.transaction(async tx=>{
  const targets=(await tx.query(
   'SELECT u.id,u.role FROM users u JOIN chat_memberships m ON m.user_id=u.id '+
   'WHERE m.workspace_id=$1 AND u.id=$2',[ws,Number(targetId)])).rows;
  if(targets.length!==1)throw fail('The selected user does not belong to your franchise.');
  if(targets[0].role!=='User'){
   if(keys.length)throw fail('Owner and Co-Owner access is managed by role, not cashier checkboxes.',400);
  }
  await tx.query('DELETE FROM cashier_feature_grants WHERE workspace_id=$1 AND user_id=$2',[ws,Number(targetId)]);
  for(const key of keys){
   await tx.query('INSERT INTO cashier_feature_grants(workspace_id,user_id,permission_key,granted_by) '+
    'VALUES($1,$2,$3,$4)',[ws,Number(targetId),key,Number(actor.id)]);
  }
  return keys;
 });
}
module.exports={KEYS,normalize,migrate,oneWorkspace,forUser,allowed,requireAccess,forWorkspace,set};
