'use strict';
// Branch-scoped and owner-scoped group conversations; no user can choose
// their workspace or branch via request parameters.
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const id=x=>Number.isSafeInteger(Number(x))&&Number(x)>0?Number(x):0;
const now=()=>new Date().toISOString();
const RATE=new Map();
const MAX_BYTES=120*1024;
const REACTIONS=new Set(['❤️','👍','😂','😮','😢','🙏']);
function validateImage(value){
  if(value==null||value==='')return null;
  if(typeof value!=='string'||value.length>MAX_BYTES*1.4+48)throw fail('Photo too large after compression.',413);
  const m=/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if(!m)throw fail('Invalid photo. Use JPEG, PNG, or WebP.');
  const b=Buffer.from(m[2],'base64');
  if(b.length<32||b.length>MAX_BYTES)throw fail('Photo exceeds the stored image size limit.',413);
  const ok=m[1]==='jpeg'&&b[0]===255&&b[1]===216&&b[2]===255||
    m[1]==='png'&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||
    m[1]==='webp'&&b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP';
  if(!ok)throw fail('Image content does not match its format.');
  return value;
}
function checkWrite(req){
 if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw fail('JSON request required.',415);
 if(req.headers.origin){let host;try{host=new URL(req.headers.origin).host;}catch(_){throw fail('Bad request origin.',403);}
 if(host!==req.headers.host)throw fail('Cross-site messaging is blocked.',403);}
}
async function migrate(db) {
  const fk=db.engine==='postgres'?'BIGINT':'INTEGER';
  const pk=db.engine==='postgres'?'BIGSERIAL PRIMARY KEY':'INTEGER PRIMARY KEY AUTOINCREMENT';
  const dt=db.engine==='postgres'?'TIMESTAMPTZ':'TEXT';
  await db.exec(
    'CREATE TABLE IF NOT EXISTS chat_workspace_branches ('+
      'branch_id '+fk+' PRIMARY KEY REFERENCES branches(id) ON DELETE CASCADE,'+
      'workspace_id '+fk+' NOT NULL REFERENCES chat_workspaces(id) ON DELETE CASCADE);'+
    'CREATE TABLE IF NOT EXISTS chat_groups ('+
      'id '+pk+',workspace_id '+fk+' NOT NULL REFERENCES chat_workspaces(id) ON DELETE CASCADE,'+
      "kind TEXT NOT NULL CHECK(kind IN ('all','branch')),branch_id "+fk+' NOT NULL DEFAULT 0,'+
      'created_at '+dt+' NOT NULL DEFAULT CURRENT_TIMESTAMP,'+
      'UNIQUE(workspace_id,kind,branch_id));'+
    'CREATE TABLE IF NOT EXISTS chat_group_messages ('+
      'id '+pk+',group_id '+fk+' NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,'+
      'sender_id '+fk+' NOT NULL REFERENCES users(id) ON DELETE RESTRICT,'+
      "body TEXT NOT NULL DEFAULT '',image_data TEXT,created_at "+dt+
      ' NOT NULL DEFAULT CURRENT_TIMESTAMP,deleted_at '+dt+');'+
    'CREATE TABLE IF NOT EXISTS chat_group_reads ('+
      'group_id '+fk+' NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,'+
      'user_id '+fk+' NOT NULL REFERENCES users(id) ON DELETE CASCADE,'+
      'last_read_id '+fk+' NOT NULL DEFAULT 0,PRIMARY KEY(group_id,user_id));'+
    'CREATE TABLE IF NOT EXISTS chat_group_reactions ('+
      'message_id '+fk+' NOT NULL REFERENCES chat_group_messages(id) ON DELETE CASCADE,'+
      'user_id '+fk+' NOT NULL REFERENCES users(id) ON DELETE CASCADE,'+
      'emoji TEXT NOT NULL,PRIMARY KEY(message_id,user_id));'+
    'CREATE INDEX IF NOT EXISTS idx_chat_group_messages ON chat_group_messages(group_id,id DESC);'
  );
  const workspaces=await db.query('SELECT id FROM chat_workspaces ORDER BY id');
  if(workspaces.rows.length===1){
    // Single-owner legacy migration: all existing branches belong to this owner.
    await db.query('INSERT INTO chat_workspace_branches(branch_id,workspace_id) '+
      'SELECT b.id,$1 FROM branches b WHERE NOT EXISTS (SELECT 1 FROM chat_workspace_branches x WHERE x.branch_id=b.id) '+
      'ON CONFLICT(branch_id) DO NOTHING',[workspaces.rows[0].id]);
  }else if(workspaces.rows.length>1){
    // In multi-workspace mode never assign an unowned branch by inference.
    // Existing staff allocations may identify their branch when no other mapping exists.
    await db.query('INSERT INTO chat_workspace_branches(branch_id,workspace_id) '+
      'SELECT u.branch_id,MIN(m.workspace_id) FROM users u JOIN chat_memberships m ON m.user_id=u.id '+
      'WHERE u.branch_id IS NOT NULL AND u.role=$1 GROUP BY u.branch_id HAVING COUNT(DISTINCT m.workspace_id)=1 '+
      'ON CONFLICT(branch_id) DO NOTHING',['User']);
  }
}
async function assignBranch(db,actorId,branchId){
  const a=await db.query('SELECT workspace_id FROM chat_memberships WHERE user_id=$1',[id(actorId)]);
  if(!a.rows.length)throw fail('Your owner workspace is not configured.',403);
  const w=Number(a.rows[0].workspace_id),b=id(branchId);
  if(!b)throw fail('Invalid branch.');
  await db.query('INSERT INTO chat_workspace_branches(branch_id,workspace_id) VALUES ($1,$2) ON CONFLICT(branch_id) DO NOTHING',[b,w]);
  const owner=await db.query('SELECT workspace_id FROM chat_workspace_branches WHERE branch_id=$1',[b]);
  if(Number(owner.rows[0]?.workspace_id)!==w)throw fail('This branch belongs to another owner.',403);
}
async function isOwnerOrCoowner(db,workspace,user){
  if(user.role!=='Admin')return false;
  const r=await db.query('SELECT 1 FROM chat_memberships WHERE user_id=$1 AND workspace_id=$2',[user.id,workspace]);
  return r.rows.length>0;
}
async function allGroups(db,workspace,user){
  const elevated=await isOwnerOrCoowner(db,workspace,user);
  // Owner and Co-Owner can see every branch assigned to this workspace,
  // including branches without employees yet; staff only see their own.
  const branchRows=await db.query(
    'SELECT b.id,b.name FROM chat_workspace_branches wb JOIN branches b ON b.id=wb.branch_id '+
    'WHERE wb.workspace_id=$1 AND b.active=$2 ORDER BY b.name',[workspace,true]);
  const allowed=branchRows.rows.filter(b=>elevated||Number(b.id)===Number(user.branchId));
  const specs=[{kind:'all',branchId:0,label:'All Branches',subtitle:'Group · All branches'},...allowed.map(b=>({
    kind:'branch',branchId:Number(b.id),label:String(b.name),subtitle:'Group · '+String(b.name)
  }))];
  const groups=[];
  for(const spec of specs){
    await db.query('INSERT INTO chat_groups(workspace_id,kind,branch_id) VALUES ($1,$2,$3) ON CONFLICT(workspace_id,kind,branch_id) DO NOTHING',
      [workspace,spec.kind,spec.branchId]);
    const found=await db.query('SELECT id FROM chat_groups WHERE workspace_id=$1 AND kind=$2 AND branch_id=$3',
      [workspace,spec.kind,spec.branchId]);
    const gid=Number(found.rows[0].id);
    const [last,unread]=await Promise.all([
      db.query('SELECT id,body,CASE WHEN image_data IS NOT NULL THEN 1 ELSE 0 END AS has_photo,created_at,deleted_at FROM chat_group_messages WHERE group_id=$1 ORDER BY id DESC LIMIT 1',[gid]),
      db.query('SELECT COUNT(*) AS n FROM chat_group_messages g LEFT JOIN chat_group_reads r ON r.group_id=g.group_id AND r.user_id=$2 '+
        'WHERE g.group_id=$1 AND g.sender_id<>$2 AND g.id>COALESCE(r.last_read_id,0) AND g.deleted_at IS NULL',[gid,user.id])
    ]);
    const recent=last.rows[0];
    groups.push({id:gid,kind:spec.kind,branchId:spec.branchId,label:spec.label,subtitle:spec.subtitle,
      unread:Number(unread.rows[0]?.n||0),
      lastMessage:recent?{id:Number(recent.id),text:recent.deleted_at?'Message deleted':recent.body||(recent.has_photo?'📷 Photo':''),
        createdAt:recent.created_at}:null});
  }
  return groups;
}
async function getGroup(db,workspace,user,raw){
  const groupId=id(raw);
  if(!groupId)throw fail('Invalid group.',400);
  const r=await db.query('SELECT g.id,g.kind,g.branch_id,b.name AS branch_name FROM chat_groups g '+
    'LEFT JOIN branches b ON b.id=g.branch_id WHERE g.id=$1 AND g.workspace_id=$2',[groupId,workspace]);
  const g=r.rows[0];if(!g)throw fail('Group unavailable.',404);
  if(g.kind==='all')return g;
  if(user.role==='Admin') {
    // Ownership mapping prevents access to branches from another business.
    const allowed=await db.query('SELECT 1 FROM chat_workspace_branches WHERE workspace_id=$1 AND branch_id=$2',[workspace,g.branch_id]);
    if(allowed.rows.length)return g;
  }else if(Number(user.branchId)===Number(g.branch_id)){
    const assigned=await db.query('SELECT 1 FROM chat_workspace_branches WHERE workspace_id=$1 AND branch_id=$2',[workspace,g.branch_id]);
    if(assigned.rows.length)return g;
  }
  throw fail('This branch group is not available to your account.',403);
}
async function thread(db,workspace,user,raw,query){
  const g=await getGroup(db,workspace,user,raw);
  const after=id(query.get('after')),before=id(query.get('before'));
  let args=[Number(g.id)],filter='';
  if(after){args.push(after);filter=' AND gm.id>$2';}
  else if(before){args.push(before);filter=' AND gm.id<$2';}
  const found=await db.query('SELECT gm.id,gm.sender_id,gm.body,gm.image_data,gm.created_at,gm.deleted_at,'+
    'u.username,u.role,w.owner_user_id,b.name AS branch_name FROM chat_group_messages gm '+
    'JOIN users u ON u.id=gm.sender_id JOIN chat_groups cg ON cg.id=gm.group_id '+
    'JOIN chat_workspaces w ON w.id=cg.workspace_id LEFT JOIN branches b ON b.id=u.branch_id '+
    'WHERE gm.group_id=$1'+filter+' ORDER BY gm.id DESC LIMIT 60',args);
  const rows=found.rows.reverse(),reactions=new Map();
  if(rows.length){
    const ids=rows.map(x=>Number(x.id)),p=ids.map((_,i)=>'$'+(i+1)).join(',');
    const r=await db.query('SELECT message_id,user_id,emoji FROM chat_group_reactions WHERE message_id IN ('+p+')',ids);
    for(const x of r.rows){
      const mid=Number(x.message_id);if(!reactions.has(mid))reactions.set(mid,[]);
      reactions.get(mid).push({userId:Number(x.user_id),emoji:x.emoji});
    }
  }
  return {messages:rows.map(r=>({
    id:Number(r.id),senderId:Number(r.sender_id),text:r.deleted_at?'':r.body,
    photo:r.deleted_at?null:r.image_data,deleted:!!r.deleted_at,createdAt:r.created_at,
    readAt:null,mine:Number(r.sender_id)===user.id,
    senderLabel:String(r.username)+' - '+(Number(r.sender_id)===Number(r.owner_user_id)?'Owner':r.role==='Admin'?'Co-Owner':r.branch_name||'Unassigned Branch'),
    reactions:reactions.get(Number(r.id))||[]
  })),hasMore:rows.length===60};
}
function rate(user){
  const t=Date.now(),k='group:'+user.id,values=(RATE.get(k)||[]).filter(x=>t-x<12000);
  if(values.length>=12)throw fail('Too many messages. Please wait.',429);
  values.push(t);RATE.set(k,values);
  if(RATE.size>500)for(const [key,arr] of RATE)if(!arr.some(x=>t-x<12000))RATE.delete(key);
}
async function send(db,workspace,user,raw,payload){
  const g=await getGroup(db,workspace,user,raw);
  rate(user);
  const text=typeof payload.text==='string'?payload.text.trim():'';
  if(text.length>3000)throw fail('Message must be under 3,000 characters.');
  const image=validateImage(payload.photo);
  if(!text&&!image)throw fail('Write a message or attach a photo.');
  const r=await db.query('INSERT INTO chat_group_messages(group_id,sender_id,body,image_data,created_at) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [g.id,user.id,text,image,now()]);
  return {id:Number(r.rows[0].id)};
}
async function groupMessage(db,workspace,user,groupId,msgId){
  await getGroup(db,workspace,user,groupId);
  const r=await db.query('SELECT m.id,m.sender_id,m.deleted_at FROM chat_group_messages m WHERE m.id=$1 AND m.group_id=$2',[id(msgId),id(groupId)]);
  if(!r.rows.length)throw fail('Message not found.',404);
  return r.rows[0];
}
async function handle({req,res,url,user,db,scope,readJson,json,safeHeaders}){
  if(!url.pathname.startsWith('/api/chat/groups'))return false;
  const reply=(status,data)=>json(res,status,data,safeHeaders({'Cache-Control':'no-store'}));
  const p=url.pathname,method=req.method;
  if(method==='GET'&&p==='/api/chat/groups'){
    reply(200,{groups:await allGroups(db,scope,user)});return true;
  }
  const messages=p.match(/^\/api\/chat\/groups\/(\d+)\/messages$/);
  if(messages){
    if(method==='GET'){reply(200,await thread(db,scope,user,messages[1],url.searchParams));return true;}
    if(method==='POST'){checkWrite(req);reply(201,await send(db,scope,user,messages[1],await readJson(req)));return true;}
  }
  const mark=p.match(/^\/api\/chat\/groups\/(\d+)\/read$/);
  if(mark&&method==='POST'){
    checkWrite(req);
    const group=await getGroup(db,scope,user,mark[1]);
    const last=await db.query('SELECT MAX(id) AS newest FROM chat_group_messages WHERE group_id=$1',[group.id]);
    const lastId=Number(last.rows[0]?.newest||0);
    await db.query('INSERT INTO chat_group_reads(group_id,user_id,last_read_id) VALUES ($1,$2,$3) '+
      'ON CONFLICT(group_id,user_id) DO UPDATE SET last_read_id=CASE WHEN excluded.last_read_id>chat_group_reads.last_read_id '+
      'THEN excluded.last_read_id ELSE chat_group_reads.last_read_id END',[group.id,user.id,lastId]);
    reply(200,{ok:true});return true;
  }
  const reaction=p.match(/^\/api\/chat\/groups\/(\d+)\/reaction\/(\d+)$/);
  if(reaction&&(method==='PUT'||method==='DELETE')){
    checkWrite(req);
    const msg=await groupMessage(db,scope,user,reaction[1],reaction[2]);
    if(msg.deleted_at)throw fail('Message deleted.',409);
    const emoji=method==='DELETE'?null:(await readJson(req)).emoji;
    if(emoji!==null&&!REACTIONS.has(emoji))throw fail('Invalid reaction.');
    if(emoji===null)await db.query('DELETE FROM chat_group_reactions WHERE message_id=$1 AND user_id=$2',[msg.id,user.id]);
    else await db.query('INSERT INTO chat_group_reactions(message_id,user_id,emoji) VALUES ($1,$2,$3) '+
      'ON CONFLICT(message_id,user_id) DO UPDATE SET emoji=excluded.emoji',[msg.id,user.id,emoji]);
    reply(200,{ok:true});return true;
  }
  const del=p.match(/^\/api\/chat\/groups\/(\d+)\/message\/(\d+)$/);
  if(del&&method==='DELETE'){
    checkWrite(req);const m=await groupMessage(db,scope,user,del[1],del[2]);
    if(Number(m.sender_id)!==user.id)throw fail('You can delete only your own messages.',403);
    await db.query('UPDATE chat_group_messages SET body=$1,image_data=NULL,deleted_at=$2 WHERE id=$3 AND group_id=$4',
      ['',now(),m.id,id(del[1])]);
    reply(200,{ok:true});return true;
  }
  throw fail('Group route not found.',404);
}
module.exports={migrate,assignBranch,allGroups,handle};