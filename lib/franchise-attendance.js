'use strict';
const crypto=require('node:crypto'),ent=require('./franchise-payroll-entitlement');
const {bad,id,now,requireAdmin,requireCashier}=ent;
const pieces=(value=new Date())=>Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
 timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'
}).formatToParts(new Date(value)).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
const day=(value=new Date())=>{const p=pieces(value);return p.year+'-'+p.month+'-'+p.day;};
const minuteOfDay=value=>{const p=pieces(value);return Number(p.hour)*60+Number(p.minute);};
const duration=(a,b)=>a&&b?Math.max(0,(new Date(b).getTime()-new Date(a).getTime())/60000):0;
const stamped=x=>{const t=new Date(x);if(!Number.isFinite(t.getTime())||t>Date.now())throw bad('Enter a valid time in the past.');return t.toISOString();};
async function migrate(db){
 const fk=db.engine==='postgres'?'BIGINT':'INTEGER';
 await db.exec('CREATE TABLE IF NOT EXISTS franchise_attendance_shifts('+
  'id VARCHAR(40) PRIMARY KEY,workspace_id '+fk+' NOT NULL REFERENCES chat_workspaces(id) ON DELETE CASCADE,'+
  'branch_id '+fk+' NOT NULL REFERENCES branches(id),user_id '+fk+' NOT NULL REFERENCES users(id),'+
  'work_day VARCHAR(10) NOT NULL,clock_in TEXT NOT NULL,clock_out TEXT,state VARCHAR(12) NOT NULL,'+
  'updated_at TEXT NOT NULL,UNIQUE(workspace_id,user_id,work_day))');
 await db.exec('CREATE INDEX IF NOT EXISTS idx_franchise_attendance_scope ON franchise_attendance_shifts(workspace_id,branch_id,work_day)');
 await db.exec('CREATE TABLE IF NOT EXISTS franchise_attendance_breaks('+
  'id VARCHAR(40) PRIMARY KEY,shift_id VARCHAR(40) NOT NULL REFERENCES franchise_attendance_shifts(id) ON DELETE CASCADE,'+
  'kind VARCHAR(12) NOT NULL,started_at TEXT NOT NULL,ended_at TEXT)');
 await db.exec('CREATE TABLE IF NOT EXISTS franchise_attendance_audit('+
  'id VARCHAR(40) PRIMARY KEY,workspace_id '+fk+' NOT NULL REFERENCES chat_workspaces(id),'+
  'user_id '+fk+' NOT NULL REFERENCES users(id),shift_id VARCHAR(40),action VARCHAR(36) NOT NULL,'+
  'actor_id '+fk+' NOT NULL REFERENCES users(id),note TEXT,at TEXT NOT NULL)');
}
async function breaks(db,shiftId){
 return(await db.query('SELECT kind,started_at,ended_at FROM franchise_attendance_breaks WHERE shift_id=$1 ORDER BY started_at',[shiftId])).rows;
}
async function view(db,s){
 if(!s)return null;
 const nowOrOut=s.state==='out'?s.clock_out:now();
 const pauses=await breaks(db,s.id);
 let lunchMinutes=0,pausedMinutes=0;
 for(const b of pauses){
  const v=duration(b.started_at,b.ended_at||nowOrOut);
  if(b.kind==='lunch')lunchMinutes+=v;else pausedMinutes+=v;
 }
 return{id:s.id,userId:Number(s.user_id),branchId:Number(s.branch_id),day:s.work_day,
  clockIn:s.clock_in,clockOut:s.clock_out,state:s.state,
  lunchStart:pauses.find(x=>x.kind==='lunch')?.started_at||null,
  lunchEnd:pauses.find(x=>x.kind==='lunch')?.ended_at||null,
  lunchMinutes:Math.round(lunchMinutes),pausedMinutes:Math.round(pausedMinutes),
  paidWorkMinutes:Math.max(0,Math.round(duration(s.clock_in,nowOrOut)-lunchMinutes-pausedMinutes)),
  lateMinutes:Math.max(0,minuteOfDay(s.clock_in)-540),
  earlyMinutes:s.clock_out?Math.max(0,1080-minuteOfDay(s.clock_out)):0};
}
async function current(db,ctx){
 const q=await db.query('SELECT * FROM franchise_attendance_shifts WHERE workspace_id=$1 AND user_id=$2 AND work_day=$3',
  [ctx.workspaceId,ctx.userId,day()]);
 return view(db,q.rows[0]);
}
async function action(db,ctx,name,body={}){
 requireCashier(ctx);
 if(!['time-in','time-out','lunch-start','lunch-end','continue'].includes(name))throw bad('Unknown time record action.',404);
 const currentAt=now(),today=day();
 return db.transaction(async tx=>{
  const q=await tx.query('SELECT * FROM franchise_attendance_shifts WHERE workspace_id=$1 AND user_id=$2 AND work_day=$3'+
   (tx.engine==='postgres'?' FOR UPDATE':''),[ctx.workspaceId,ctx.userId,today]);
  let s=q.rows[0];
  if(name==='time-in'){
   if(s)throw bad('Already clocked in today. If you timed out, use Continue Shift.',409);
   const inserted=await tx.query('INSERT INTO franchise_attendance_shifts(id,workspace_id,branch_id,user_id,'+
    'work_day,clock_in,state,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) '+
    'ON CONFLICT(workspace_id,user_id,work_day) DO NOTHING RETURNING *',
    [crypto.randomUUID(),ctx.workspaceId,ctx.branchId,ctx.userId,today,currentAt,'working',currentAt]);
   s=inserted.rows[0];if(!s)throw bad('A shift has already been created for today.',409);
  }else{
   if(!s)throw bad('Please Time In before recording attendance.',409);
   if(name==='lunch-start'){
    if(s.state!=='working')throw bad('Finish your current break or Continue Shift first.',409);
    await tx.query('INSERT INTO franchise_attendance_breaks(id,shift_id,kind,started_at) VALUES($1,$2,$3,$4)',
     [crypto.randomUUID(),s.id,'lunch',currentAt]);
    await tx.query('UPDATE franchise_attendance_shifts SET state=$1,updated_at=$2 WHERE id=$3',
     ['lunch',currentAt,s.id]);s.state='lunch';
   }else if(name==='lunch-end'){
    if(s.state!=='lunch')throw bad('You have not started lunch.',409);
    await tx.query('UPDATE franchise_attendance_breaks SET ended_at=$1 WHERE shift_id=$2 AND kind=$3 AND ended_at IS NULL',
     [currentAt,s.id,'lunch']);
    await tx.query('UPDATE franchise_attendance_shifts SET state=$1,updated_at=$2 WHERE id=$3',
     ['working',currentAt,s.id]);s.state='working';
   }else if(name==='time-out'){
    if(s.state==='lunch')throw bad('End lunch before timing out.',409);
    if(s.state==='out')throw bad('Already timed out. Use Continue Shift if necessary.',409);
    const v=await view(tx,s);
    if((v.paidWorkMinutes<480||minuteOfDay(currentAt)<1080)&&body.confirmEarly!==true)
     throw bad('Early Time Out: confirm that you want to end your shift.',409);
    await tx.query('UPDATE franchise_attendance_shifts SET state=$1,clock_out=$2,updated_at=$3 WHERE id=$4',
     ['out',currentAt,currentAt,s.id]);
    await tx.query('INSERT INTO franchise_attendance_breaks(id,shift_id,kind,started_at) VALUES($1,$2,$3,$4)',
     [crypto.randomUUID(),s.id,'pause',currentAt]);
    s.state='out';s.clock_out=currentAt;
   }else if(name==='continue'){
    if(s.state!=='out')throw bad('Continue Shift is only available after Time Out.',409);
    await tx.query('UPDATE franchise_attendance_breaks SET ended_at=$1 WHERE shift_id=$2 AND kind=$3 AND ended_at IS NULL',
     [currentAt,s.id,'pause']);
    await tx.query('UPDATE franchise_attendance_shifts SET state=$1,clock_out=NULL,updated_at=$2 WHERE id=$3',
     ['working',currentAt,s.id]);
    s.state='working';s.clock_out=null;
   }
  }
  await tx.query('INSERT INTO franchise_attendance_audit(id,workspace_id,user_id,shift_id,action,actor_id,note,at) '+
   'VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
   [crypto.randomUUID(),ctx.workspaceId,ctx.userId,s.id,name,ctx.userId,
    name==='time-out'&&body.confirmEarly?'Early Time Out confirmed':null,currentAt]);
  return{ok:true,shift:await view(tx,s)};
 });
}
async function employee(db,ctx,userId){
 const r=await db.query('SELECT u.id,u.role,u.branch_id,u.active,b.name AS branch_name,'+
  "COALESCE(NULLIF(u.full_name,''),COALESCE(u.login_username,u.username)) AS name "+
  'FROM users u JOIN chat_memberships m ON m.user_id=u.id LEFT JOIN branches b ON b.id=u.branch_id '+
  'WHERE m.workspace_id=$1 AND u.id=$2 AND u.role=$3',[ctx.workspaceId,id(userId),'User']);
 if(r.rows.length!==1)throw bad('Cashier not found in this franchise.',404);
 const x=r.rows[0];return{id:Number(x.id),name:x.name,branchId:Number(x.branch_id),
  branchName:x.branch_name||'',active:x.active===true||x.active===1};
}
async function team(db,ctx){
 requireAdmin(ctx);
 const r=await db.query('SELECT u.id,u.active,u.branch_id,b.name AS branch_name,'+
  "COALESCE(NULLIF(u.full_name,''),COALESCE(u.login_username,u.username)) AS name,"+
  's.state,s.clock_in,s.clock_out FROM users u JOIN chat_memberships m ON m.user_id=u.id '+
  'LEFT JOIN branches b ON b.id=u.branch_id '+
  'LEFT JOIN franchise_attendance_shifts s ON s.workspace_id=m.workspace_id AND s.user_id=u.id AND s.work_day=$2 '+
  'WHERE m.workspace_id=$1 AND u.role=$3 ORDER BY b.name,u.full_name,u.username',
  [ctx.workspaceId,day(),'User']);
 return{employees:r.rows.map(x=>({id:Number(x.id),name:x.name,branchId:Number(x.branch_id||0),
  branchName:x.branch_name||'',active:x.active===true||x.active===1,
  status:x.state||'not-in',clockIn:x.clock_in,clockOut:x.clock_out}))};
}
async function records(db,ctx,userId,from,to){
 requireAdmin(ctx);
 await employee(db,ctx,userId);
 const valid=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+'T00:00:00Z'));
 if(!valid(from)||!valid(to)||from>to||Date.parse(to)-Date.parse(from)>100*86400000)
  throw bad('Select a valid date range of up to 100 days.');
 const rows=await db.query('SELECT * FROM franchise_attendance_shifts WHERE workspace_id=$1 AND user_id=$2 '+
  'AND work_day BETWEEN $3 AND $4 ORDER BY work_day',[ctx.workspaceId,id(userId),from,to]);
 return Promise.all(rows.rows.map(x=>view(db,x)));
}
async function adminClose(db,ctx,shiftId,note){
 requireAdmin(ctx);
 const reason=String(note||'').trim();if(reason.length<5||reason.length>400)throw bad('An admin Time Out requires a reason.');
 return db.transaction(async tx=>{
  const r=await tx.query('SELECT * FROM franchise_attendance_shifts WHERE id=$1 AND workspace_id=$2'+
   (tx.engine==='postgres'?' FOR UPDATE':''),[shiftId,ctx.workspaceId]);
  const s=r.rows[0];if(!s)throw bad('DTR not found.',404);
  if(s.state==='out')throw bad('Already timed out.',409);
  const currentAt=now();
  if(s.state==='lunch')await tx.query('UPDATE franchise_attendance_breaks SET ended_at=$1 WHERE shift_id=$2 AND kind=$3 AND ended_at IS NULL',
   [currentAt,s.id,'lunch']);
  await tx.query('UPDATE franchise_attendance_shifts SET state=$1,clock_out=$2,updated_at=$3 WHERE id=$4',
   ['out',currentAt,currentAt,s.id]);
  await tx.query('INSERT INTO franchise_attendance_breaks(id,shift_id,kind,started_at) VALUES($1,$2,$3,$4)',
   [crypto.randomUUID(),s.id,'pause',currentAt]);
  await tx.query('INSERT INTO franchise_attendance_audit(id,workspace_id,user_id,shift_id,action,actor_id,note,at) '+
   'VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[crypto.randomUUID(),ctx.workspaceId,Number(s.user_id),s.id,'admin-time-out',ctx.userId,reason,currentAt]);
  return{ok:true};
 });
}
async function correct(db,ctx,shiftId,body){
 requireAdmin(ctx);
 const reason=String(body?.reason||'').trim();
 if(reason.length<5||reason.length>400)throw bad('DTR edit requires a detailed reason.');
 const t={clockIn:stamped(body.clockIn),clockOut:body.clockOut?stamped(body.clockOut):null,
  lunchStart:body.lunchStart?stamped(body.lunchStart):null,lunchEnd:body.lunchEnd?stamped(body.lunchEnd):null};
 if(t.clockOut&&t.clockOut<=t.clockIn||t.lunchEnd&&!t.lunchStart||t.lunchStart&&t.lunchStart<t.clockIn||
  t.lunchEnd&&t.lunchEnd<t.lunchStart||t.clockOut&&t.lunchEnd&&t.lunchEnd>t.clockOut)
  throw bad('Time In, lunch and Time Out timestamps are out of sequence.');
 return db.transaction(async tx=>{
  const r=await tx.query('SELECT * FROM franchise_attendance_shifts WHERE id=$1 AND workspace_id=$2'+
   (tx.engine==='postgres'?' FOR UPDATE':''),[shiftId,ctx.workspaceId]);
  const s=r.rows[0];if(!s)throw bad('DTR not found.',404);
  if(Object.values(t).some(x=>x&&day(x)!==s.work_day))throw bad('DTR dates must stay on the original Philippine workday.');
  const state=t.clockOut?'out':t.lunchStart&&!t.lunchEnd?'lunch':'working';
  await tx.query('UPDATE franchise_attendance_shifts SET clock_in=$1,clock_out=$2,state=$3,updated_at=$4 WHERE id=$5',
   [t.clockIn,t.clockOut,state,now(),s.id]);
  await tx.query('DELETE FROM franchise_attendance_breaks WHERE shift_id=$1',[s.id]);
  if(t.lunchStart)await tx.query('INSERT INTO franchise_attendance_breaks(id,shift_id,kind,started_at,ended_at) '+
   'VALUES($1,$2,$3,$4,$5)',[crypto.randomUUID(),s.id,'lunch',t.lunchStart,t.lunchEnd]);
  await tx.query('INSERT INTO franchise_attendance_audit(id,workspace_id,user_id,shift_id,action,actor_id,note,at) '+
   'VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[crypto.randomUUID(),ctx.workspaceId,Number(s.user_id),s.id,'admin-edit',ctx.userId,reason,now()]);
  return{ok:true,shift:await view(tx,{...s,clock_in:t.clockIn,clock_out:t.clockOut,state})};
 });
}
module.exports={migrate,current,action,view,team,records,employee,adminClose,correct,day,minuteOfDay};
