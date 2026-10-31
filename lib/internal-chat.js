'use strict';
// Owner/workspace-scoped internal messages. No audio or public media URLs.
const MAX_PHOTO=120*1024, MAX_TEXT=3000;
const REACTIONS=new Set(['❤️','👍','😂','😮','😢','🙏']);
const rates=new Map();
const bad=(message,status=400)=>Object.assign(new Error(message),{status});
const positive=x=>{const v=Number(x);return Number.isSafeInteger(v)&&v>0?v:0;};
const now=()=>new Date().toISOString();

async function migrate(db) {
  const pk=db.engine==='postgres'?'BIGSERIAL':'INTEGER';
  const fk=db.engine==='postgres'?'BIGINT':'INTEGER';
  const ts=db.engine==='postgres'?'TIMESTAMPTZ':'TEXT';
  const auto=db.engine==='postgres'?'':' AUTOINCREMENT';
  // No columns are added to existing POS business tables.
  await db.exec('CREATE TABLE IF NOT EXISTS chat_workspaces ('+
    'id '+pk+' PRIMARY KEY'+auto+',owner_user_id '+fk+' REFERENCES users(id) ON DELETE SET NULL,created_at '+ts+' DEFAULT CURRENT_TIMESTAMP);'+
    'CREATE TABLE IF NOT EXISTS chat_memberships ('+
    'user_id '+fk+' PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,workspace_id '+fk+' NOT NULL REFERENCES chat_workspaces(id) ON DELETE CASCADE);'+
    'CREATE TABLE IF NOT EXISTS chat_messages ('+
    'id '+pk+' PRIMARY KEY'+auto+',workspace_id '+fk+' NOT NULL REFERENCES chat_workspaces(id) ON DELETE CASCADE,'+
    'sender_id '+fk+' NOT NULL REFERENCES users(id) ON DELETE CASCADE,'+
    'recipient_id '+fk+' NOT NULL REFERENCES users(id) ON DELETE CASCADE,'+
    "body TEXT NOT NULL DEFAULT '',image_data TEXT,created_at "+ts+' DEFAULT CURRENT_TIMESTAMP,read_at '+ts+',deleted_at '+ts+');'+
    'CREATE TABLE IF NOT EXISTS chat_reactions ('+
    'message_id '+fk+' NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,'+
    'user_id '+fk+' NOT NULL REFERENCES users(id) ON DELETE CASCADE,emoji TEXT NOT NULL,'+
    'PRIMARY KEY(message_id,user_id));'+
    'CREATE INDEX IF NOT EXISTS idx_chat_threads ON chat_messages(workspace_id,sender_id,recipient_id,id DESC);'+
    'CREATE INDEX IF NOT EXISTS idx_chat_unread ON chat_messages(workspace_id,recipient_id,read_at);'+
    'CREATE INDEX IF NOT EXISTS idx_chat_reactions_message ON chat_reactions(message_id);');
  // Backfill only the existing legacy shop; never auto-enroll later signups.
  const exists=await db.query('SELECT id FROM chat_workspaces LIMIT 1');
  if(!exists.rows.length){
    const users=await db.query('SELECT id,role FROM users ORDER BY id');
    if(users.rows.length){
      const owner=users.rows.find(u=>u.role==='Admin')||users.rows[0];
      await db.transaction(async tx=>{
        const w=await tx.query('INSERT INTO chat_workspaces(owner_user_id) VALUES ($1) RETURNING id',[owner.id]);
        for(const u of users.rows)
          await tx.query('INSERT INTO chat_memberships(user_id,workspace_id) VALUES ($1,$2)',[u.id,w.rows[0].id]);
      });
    }
  }
}
async function assignNewUser(db,actorId,newUserId){
  const id=positive(newUserId);if(!id)throw bad('Invalid user.');
  let workspaceId;
  if(actorId){
    const x=await db.query('SELECT workspace_id FROM chat_memberships WHERE user_id=$1',[positive(actorId)]);
    workspaceId=x.rows[0]?.workspace_id;
    if(!workspaceId)throw bad('Owner messaging workspace is unavailable.',409);
  }else{
    const x=await db.query('INSERT INTO chat_workspaces(owner_user_id) VALUES ($1) RETURNING id',[id]);
    workspaceId=x.rows[0].id;
  }
  await db.query('INSERT INTO chat_memberships(user_id,workspace_id) VALUES ($1,$2) ON CONFLICT(user_id) DO NOTHING',[id,workspaceId]);
}
async function scopeFor(db,user){
  const r=await db.query('SELECT m.workspace_id FROM chat_memberships m JOIN users u ON u.id=m.user_id WHERE u.id=$1 AND u.active=$2',[user.id,true]);
  if(!r.rows.length)throw bad('Messaging workspace not configured for this account.',403);
  return Number(r.rows[0].workspace_id);
}
async function contact(db,scope,user,raw){
  const id=positive(raw);
  if(!id||id===user.id)throw bad('Select another team member.');
  const r=await db.query(
    'SELECT u.id,u.username,u.role,u.branch_id,b.name AS branch_name FROM chat_memberships m '+
    'JOIN users u ON u.id=m.user_id LEFT JOIN branches b ON b.id=u.branch_id '+
    'WHERE m.workspace_id=$1 AND u.id=$2 AND u.active=$3',[scope,id,true]);
  if(!r.rows.length)throw bad('Team member unavailable in this owner account.',403);
  return r.rows[0];
}
function asContact(r){
  const isAdmin=r.role==='Admin',username=String(r.username);
  return {id:Number(r.id),username,role:r.role,branchId:r.branch_id==null?null:Number(r.branch_id),
    branchName:r.branch_name||null,label:username+' - '+(isAdmin?'Owner':(r.branch_name||'Unassigned Branch')),
    subtitle:isAdmin?'Admin':'User'};
}
function checkWrite(req){
  if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw bad('JSON request required.',415);
  if(req.headers.origin){
    let host;try{host=new URL(req.headers.origin).host;}catch(_){throw bad('Invalid request origin.',403);}
    if(host!==req.headers.host)throw bad('Cross-origin messaging blocked.',403);
  }
}
function photo(data){
  if(data==null||data==='')return null;
  if(typeof data!=='string'||data.length>MAX_PHOTO*1.4+48)throw bad('Image exceeds 120 KB compressed limit.',413);
  const m=/^data:image\/(png|jpeg|webp);base64,([a-zA-Z0-9+/]+={0,2})$/.exec(data);
  if(!m)throw bad('Photo must be JPEG, PNG or WebP.');
  const bin=Buffer.from(m[2],'base64');
  if(bin.length<32||bin.length>MAX_PHOTO)throw bad('Image exceeds 120 KB compressed limit.',413);
  const valid=m[1]==='jpeg'&&bin[0]===255&&bin[1]===216&&bin[2]===255||
    m[1]==='png'&&bin.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||
    m[1]==='webp'&&bin.toString('ascii',0,4)==='RIFF'&&bin.toString('ascii',8,12)==='WEBP';
  if(!valid)throw bad('Image file content is invalid.');
  return data;
}
function rate(user){
  const t=Date.now(),items=(rates.get(user.id)||[]).filter(x=>t-x<12000);
  if(items.length>=12)throw bad('Too many messages. Try again shortly.',429);
  items.push(t);rates.set(user.id,items);
  if(rates.size>500)for(const [id,ts] of rates)if(!ts.some(x=>t-x<12000))rates.delete(id);
}
async function people(db,user,scope){
  const r=await db.query(
    'SELECT u.id,u.username,u.role,u.branch_id,b.name AS branch_name FROM users u '+
    'JOIN chat_memberships m ON m.user_id=u.id LEFT JOIN branches b ON b.id=u.branch_id '+
    'WHERE m.workspace_id=$1 AND u.active=$2 AND u.id<>$3 ORDER BY u.username',[scope,true,user.id]);
  const members=[];let unreadTotal=0;
  for(const row of r.rows){
    const id=Number(row.id);
    const [last,unread]=await Promise.all([
      db.query('SELECT id,body,image_data,deleted_at,sender_id,created_at FROM chat_messages WHERE workspace_id=$1 '+
        'AND ((sender_id=$2 AND recipient_id=$3) OR (sender_id=$3 AND recipient_id=$2)) ORDER BY id DESC LIMIT 1',[scope,user.id,id]),
      db.query('SELECT COUNT(*) AS n FROM chat_messages WHERE workspace_id=$1 AND sender_id=$2 AND recipient_id=$3 AND read_at IS NULL',[scope,id,user.id])
    ]);
    const latest=last.rows[0],count=Number(unread.rows[0]?.n||0);unreadTotal+=count;
    members.push({...asContact(row),unread:count,lastMessage:latest?{
      id:Number(latest.id),text:latest.deleted_at?'Message deleted':latest.body||(latest.image_data?'📷 Photo':''),
      createdAt:latest.created_at,mine:Number(latest.sender_id)===user.id}:null});
  }
  members.sort((a,b)=>b.unread-a.unread||(b.lastMessage?.id||0)-(a.lastMessage?.id||0)||a.username.localeCompare(b.username));
  return {people:members,unreadTotal};
}
async function messages(db,user,scope,partner,query){
  const after=positive(query.get('after')),before=positive(query.get('before'));
  const args=[scope,user.id,partner];
  let limitClause='';
  if(after){args.push(after);limitClause=' AND id>$'+args.length;}
  else if(before){args.push(before);limitClause=' AND id<$'+args.length;}
  const r=await db.query('SELECT id,sender_id,recipient_id,body,image_data,created_at,read_at,deleted_at FROM chat_messages '+
    'WHERE workspace_id=$1 AND ((sender_id=$2 AND recipient_id=$3) OR (sender_id=$3 AND recipient_id=$2))'+
    limitClause+' ORDER BY id DESC LIMIT 60',args);
  const rows=r.rows.reverse(),reactions=new Map();
  if(rows.length){
    const ids=rows.map(x=>Number(x.id));
    const q=await db.query('SELECT message_id,user_id,emoji FROM chat_reactions WHERE message_id IN ('+
      ids.map((_,i)=>'$'+(i+1)).join(',')+')',ids);
    for(const item of q.rows){const k=Number(item.message_id);if(!reactions.has(k))reactions.set(k,[]);
      reactions.get(k).push({userId:Number(item.user_id),emoji:item.emoji});}
  }
  return {messages:rows.map(x=>({id:Number(x.id),senderId:Number(x.sender_id),recipientId:Number(x.recipient_id),
    text:x.deleted_at?'':x.body,photo:x.deleted_at?null:x.image_data,
    createdAt:x.created_at,readAt:x.read_at,deleted:!!x.deleted_at,
    mine:Number(x.sender_id)===user.id,reactions:reactions.get(Number(x.id))||[]})),hasMore:rows.length===60};
}
async function react(db,user,scope,id,emoji){
  const r=await db.query('SELECT sender_id,recipient_id,deleted_at FROM chat_messages WHERE id=$1 AND workspace_id=$2',[positive(id),scope]);
  const m=r.rows[0];
  if(!m||![Number(m.sender_id),Number(m.recipient_id)].includes(user.id))throw bad('Message not found.',404);
  if(m.deleted_at)throw bad('Message was deleted.',409);
  if(emoji!==null&&!REACTIONS.has(emoji))throw bad('Invalid reaction.');
  if(emoji===null)await db.query('DELETE FROM chat_reactions WHERE message_id=$1 AND user_id=$2',[positive(id),user.id]);
  else await db.query('INSERT INTO chat_reactions(message_id,user_id,emoji) VALUES ($1,$2,$3) ON CONFLICT(message_id,user_id) DO UPDATE SET emoji=excluded.emoji',[positive(id),user.id,emoji]);
  return {ok:true};
}
async function handle({req,res,url,user,db,readJson,json,safeHeaders}){
  const p=url.pathname,method=req.method;
  if(!p.startsWith('/api/chat/'))return false;
  const scope=await scopeFor(db,user);
  const reply=(status,obj)=>json(res,status,obj,safeHeaders({'Cache-Control':'no-store'}));
  if(method==='GET'&&p==='/api/chat/people'){reply(200,await people(db,user,scope));return true;}
  const thread=p.match(/^\/api\/chat\/messages\/(\d+)$/);
  if(method==='GET'&&thread){
    const other=await contact(db,scope,user,thread[1]);
    reply(200,{contact:asContact(other),...(await messages(db,user,scope,Number(other.id),url.searchParams))});return true;
  }
  if(method==='POST'&&p==='/api/chat/messages'){
    checkWrite(req);rate(user);
    const body=await readJson(req),recipient=positive(body.recipientId);
    await contact(db,scope,user,recipient);
    const content=typeof body.text==='string'?body.text.trim():'';
    if(content.length>MAX_TEXT)throw bad('Message must be under 3,000 characters.');
    const picture=photo(body.photo);
    if(!content&&!picture)throw bad('Write a message or add a photo.');
    const result=await db.query('INSERT INTO chat_messages(workspace_id,sender_id,recipient_id,body,image_data,created_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [scope,user.id,recipient,content,picture,now()]);
    reply(201,{id:Number(result.rows[0].id)});return true;
  }
  const markRead=p.match(/^\/api\/chat\/read\/(\d+)$/);
  if(method==='POST'&&markRead){
    checkWrite(req);
    const other=await contact(db,scope,user,markRead[1]);
    await db.query('UPDATE chat_messages SET read_at=$1 WHERE workspace_id=$2 AND sender_id=$3 AND recipient_id=$4 AND read_at IS NULL',
      [now(),scope,other.id,user.id]);
    reply(200,{ok:true});return true;
  }
  const reaction=p.match(/^\/api\/chat\/reaction\/(\d+)$/);
  if(reaction&&(method==='PUT'||method==='DELETE')){
    checkWrite(req);
    const emoji=method==='DELETE'?null:(await readJson(req)).emoji;
    reply(200,await react(db,user,scope,reaction[1],emoji));return true;
  }
  const remove=p.match(/^\/api\/chat\/message\/(\d+)$/);
  if(remove&&method==='DELETE'){
    checkWrite(req);
    const r=await db.query('UPDATE chat_messages SET deleted_at=$1,body=$2,image_data=NULL WHERE id=$3 AND workspace_id=$4 AND sender_id=$5 RETURNING id',
      [now(),'',positive(remove[1]),scope,user.id]);
    if(!r.rows.length)throw bad('You can delete only your own messages.',403);
    reply(200,{ok:true});return true;
  }
  throw bad('Chat route not found.',404);
}
module.exports={migrate,assignNewUser,handle};
