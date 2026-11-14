'use strict';
// Owner/workspace-scoped destination lists and server-side selection validation.
// Does not itself alter inventory balances.
const reject=(message,status=403)=>Object.assign(new Error(message),{status});
const numeric=x=>Number.isSafeInteger(Number(x))&&Number(x)>0?Number(x):0;
const active=x=>x===true||x===1||x==='1';
async function list(db,user,sourceInput){
 if(!numeric(user?.id))throw reject('Sign in before transferring inventory.',401);
 const membership=(await db.query('SELECT workspace_id FROM chat_memberships WHERE user_id=$1 ORDER BY workspace_id LIMIT 2',[user.id])).rows;
 if(membership.length!==1||!numeric(membership[0].workspace_id))
  throw reject('The account must belong to one franchise workspace.');
 const workspaceId=numeric(membership[0].workspace_id);
 const rows=(await db.query(
  'SELECT b.id,b.name,b.active FROM chat_workspace_branches wb '+
  'JOIN branches b ON b.id=wb.branch_id WHERE wb.workspace_id=$1 ORDER BY b.name,b.id',
  [workspaceId])).rows;
 const branches=rows.filter(x=>active(x.active)).map(x=>({id:numeric(x.id),name:String(x.name)})).filter(x=>x.id);
 const isAdmin=user.role==='Admin';
 const requested=numeric(sourceInput);
 const assigned=numeric(user.branchId);
 const sourceBranchId=isAdmin?requested||branches[0]?.id:assigned;
 if(!sourceBranchId||!branches.some(x=>x.id===sourceBranchId))
  throw reject('Select an active branch belonging to your franchise.');
 if(!isAdmin&&requested&&requested!==assigned)
  throw reject('Cashiers cannot transfer stock from a different branch.');
 return{workspaceId,sourceBranchId,sourceBranchName:branches.find(x=>x.id===sourceBranchId).name,
  branches:isAdmin?branches:branches.filter(x=>x.id===sourceBranchId),
  destinations:branches.filter(x=>x.id!==sourceBranchId)};
}
async function validate(db,user,body){
 const data=await list(db,user,body.sourceBranchId);
 const targetId=numeric(body.destinationBranchId);
 const receivingId=numeric(body.receivedByBranchId);
 if(!targetId||!receivingId)throw reject('Choose a destination and receiving branch.',400);
 const target=data.destinations.find(x=>x.id===targetId);
 if(!target)throw reject('Destination must be another active branch owned by this franchise.');
 if(receivingId!==targetId)throw reject('The receiving branch must match the destination branch.',400);
 return{workspaceId:data.workspaceId,sourceBranchId:data.sourceBranchId,
  sourceBranchName:data.sourceBranchName,destinationBranchId:target.id,
  destinationBranchName:target.name,receivingBranchName:target.name};
}
module.exports={list,validate};
