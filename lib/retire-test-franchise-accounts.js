'use strict';
// One-time, explicitly requested retirement of the two old demo franchise owners.
// Their financial/stock/audit records are retained by ID; usernames are released.
// Never delete transaction data or touch a non-onboarding tenant with these names.
const TARGETS=Object.freeze(['test1','test123']);
const KEY='retired_test1_test123_live_reset_20261115_v1';
const fail=m=>Object.assign(new Error(m),{status:409});
const goodId=x=>Number.isSafeInteger(Number(x))&&Number(x)>0?Number(x):0;
async function retire(db){
 if(db.engine!=='postgres')return{status:'not_applicable',reason:'Production-only operation'};
 return db.transaction(async tx=>{
  await tx.query('SELECT pg_advisory_xact_lock(2026111503::bigint)');
  const completed=(await tx.query('SELECT value FROM meta WHERE key=$1',[KEY])).rows[0];
  if(completed){
   let saved={};try{saved=JSON.parse(completed.value)}catch(_){}
   return{status:'already_processed',results:saved.results||[]};
  }
  const results=[];
  for(const login of TARGETS){
   const r=await tx.query('SELECT r.id AS request_id,r.username,t.user_id,t.workspace_id,t.branch_id,'+
    'w.owner_user_id,u.role,u.active FROM public_franchise_requests r '+
    'JOIN franchise_test_accounts t ON t.request_id=r.id '+
    'JOIN users u ON u.id=t.user_id '+
    'JOIN chat_workspaces w ON w.id=t.workspace_id '+
    'JOIN chat_memberships m ON m.user_id=t.user_id AND m.workspace_id=t.workspace_id '+
    'WHERE LOWER(r.username)=LOWER($1) '+
    'AND LOWER(COALESCE(u.login_username,u.username))=LOWER($1) '+
    'AND r.status<>$2 FOR UPDATE OF r,u',[login,'RETIRED']);
   if(!r.rows.length){results.push({username:login,status:'not_found_or_not_original_onboarding'});continue}
   if(r.rows.length!==1){results.push({username:login,status:'ambiguous_blocked'});continue}
   const x=r.rows[0],ownerId=goodId(x.user_id),workspace=goodId(x.workspace_id);
   if(!ownerId||!workspace||Number(x.owner_user_id)!==ownerId||x.role!=='Admin'){
    results.push({username:login,status:'ownership_mismatch_blocked'});continue;
   }
   const external=(await tx.query('SELECT 1 FROM chat_memberships WHERE user_id=$1 AND workspace_id<>$2 LIMIT 1',
    [ownerId,workspace])).rows;
   if(external.length){results.push({username:login,status:'multi_workspace_owner_blocked'});continue}
   const collision=(await tx.query('SELECT 1 FROM users WHERE id<>$1 AND '+
    '(LOWER(username)=LOWER($2) OR LOWER(COALESCE(login_username,username))=LOWER($2)) LIMIT 1',
    [ownerId,'retired_demo_'+login+'_'+ownerId])).rows;
   if(collision.length){results.push({username:login,status:'archive_alias_collision_blocked'});continue}
   const archive='retired_demo_'+login+'_'+ownerId,stamp=new Date().toISOString();
   const owner=await tx.query('UPDATE users SET username=$1,login_username=$1,active=$2 WHERE id=$3 '+
    'AND LOWER(COALESCE(login_username,username))=LOWER($4) RETURNING id',
    [archive,archive===null,ownerId,login]);
   if(owner.rows.length!==1)throw fail('The old demo username changed during retirement. Rolling back.');
   // This workspace can have cashiers; revoke *only* users exclusively in it.
   await tx.query('UPDATE users SET active=$1 WHERE id IN '+
    '(SELECT m.user_id FROM chat_memberships m WHERE m.workspace_id=$2 '+
    'AND NOT EXISTS(SELECT 1 FROM chat_memberships other '+
    'WHERE other.user_id=m.user_id AND other.workspace_id<>$2))',[false,workspace]);
   await tx.query('DELETE FROM sessions WHERE user_id IN '+
    '(SELECT m.user_id FROM chat_memberships m WHERE m.workspace_id=$1 '+
    'AND NOT EXISTS(SELECT 1 FROM chat_memberships other '+
    'WHERE other.user_id=m.user_id AND other.workspace_id<>$1))',[workspace]);
   await tx.query('UPDATE branches SET active=$1 WHERE id IN '+
    '(SELECT branch_id FROM chat_workspace_branches WHERE workspace_id=$2)',[false,workspace]);
   await tx.query('UPDATE platform_account_plans SET status=$1,updated_at=$2,updated_by=$3 '+
    'WHERE workspace_id=$4',['ON_HOLD',stamp,'Admin-authorized demo retirement',workspace]);
   const req=await tx.query('UPDATE public_franchise_requests SET status=$1,updated_at=$2,'+
    'reviewed_by=$3,review_note=$4 WHERE id=$5 RETURNING id',
    ['RETIRED',stamp,'Admin Control',
     'Demo login retired and username released for fresh live registration; historical transactions preserved.',
     x.request_id]);
   if(req.rows.length!==1)throw fail('Retirement could not archive the old application.');
   results.push({username:login,status:'retired_and_username_released',
    formerWorkspaceId:workspace});
  }
  // Once-only marker prevents a newly re-created account from ever being retired by restart.
  await tx.query('INSERT INTO meta(key,value) VALUES($1,$2) ON CONFLICT(key) DO NOTHING',
   [KEY,JSON.stringify({completedAt:new Date().toISOString(),results})]);
  return{status:'completed',results};
 });
}
module.exports={TARGETS,KEY,retire};
