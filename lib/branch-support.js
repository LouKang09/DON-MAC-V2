async function migrateBranches(db) {
  if (db.engine === 'postgres') {
    await db.exec("CREATE TABLE IF NOT EXISTS branches (id BIGSERIAL PRIMARY KEY, name VARCHAR(120) NOT NULL UNIQUE, address VARCHAR(250), active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
    await db.exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS branch_id BIGINT REFERENCES branches(id)");
    await db.exec("ALTER TABLE sales ADD COLUMN IF NOT EXISTS branch_id BIGINT REFERENCES branches(id)");
    await db.exec("CREATE INDEX IF NOT EXISTS idx_sales_branch_sold_at ON sales(branch_id,sold_at)");
    await db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_branches_name_ci ON branches((LOWER(name)))");
  } else {
    await db.exec("CREATE TABLE IF NOT EXISTS branches (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, address TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
    const usersCols = (await db.query("PRAGMA table_info(users)")).rows.map(x=>x.name);
    const salesCols = (await db.query("PRAGMA table_info(sales)")).rows.map(x=>x.name);
    if (!usersCols.includes('branch_id')) await db.exec("ALTER TABLE users ADD COLUMN branch_id INTEGER REFERENCES branches(id)");
    if (!salesCols.includes('branch_id')) await db.exec("ALTER TABLE sales ADD COLUMN branch_id INTEGER REFERENCES branches(id)");
    await db.exec("CREATE INDEX IF NOT EXISTS idx_sales_branch_sold_at ON sales(branch_id,sold_at)");
    await db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_branches_name_ci ON branches(LOWER(name))");
  }
  const existing = await db.query("SELECT id FROM branches ORDER BY id LIMIT 1");
  if (!existing.rows.length) await db.query("INSERT INTO branches(name,address,active) VALUES ($1,$2,$3)",['Main Branch','',true]);
  const main = await db.query("SELECT id FROM branches ORDER BY id LIMIT 1");
  const mainId=Number(main.rows[0].id);
  await db.query("UPDATE users SET branch_id=$1 WHERE role='User' AND branch_id IS NULL",[mainId]);
  await db.query("UPDATE sales SET branch_id=$1 WHERE branch_id IS NULL",[mainId]);
}

async function listBranches(db) {
  const r = await db.query("SELECT b.id,b.name,b.address,b.active,(SELECT COUNT(*) FROM users u WHERE u.branch_id=b.id) AS users_count,(SELECT COUNT(*) FROM sales s WHERE s.branch_id=b.id) AS sales_count FROM branches b ORDER BY b.id");
  return r.rows.map(x=>({id:Number(x.id),name:x.name,address:x.address||'',active:x.active===true||x.active===1||x.active==='1',usersCount:Number(x.users_count),salesCount:Number(x.sales_count)}));
}

async function resolveAssignment(db,role,raw) {
  if(role==='Admin') return null;
  let id=Number(raw||0);
  if(!id) {
    const d=await db.query("SELECT id FROM branches WHERE active=$1 ORDER BY id LIMIT 1",[true]);
    id=Number(d.rows[0]?.id||0);
  }
  const r=await db.query("SELECT id,active FROM branches WHERE id=$1",[id]);
  if(!r.rows.length||!(r.rows[0].active===true||r.rows[0].active===1||r.rows[0].active==='1')) throw Object.assign(new Error('Select an active branch for this user.'),{status:400});
  return id;
}

async function salesScope(db,user,requested,forCheckout=false) {
  if(user.role==='Admin'){
    if(requested===undefined||requested===null||requested===''||requested==='all'){
      if(!forCheckout) return null;
      throw Object.assign(new Error('Choose an active branch before completing a sale.'),{status:400});
    }
    const id=Number(requested);
    if(!Number.isSafeInteger(id)||id<1) throw Object.assign(new Error('Invalid branch.'),{status:400});
    const r=await db.query('SELECT id,active FROM branches WHERE id=$1',[id]);
    if(!r.rows.length || (forCheckout && !(r.rows[0].active===true||r.rows[0].active===1||r.rows[0].active==='1')))throw Object.assign(new Error('Branch not found or inactive.'),{status:400});
    return id;
  }
  const id=Number(user.branchId||0);
  if(!id)throw Object.assign(new Error('Your user account has no assigned branch. Ask the administrator to assign one.'),{status:403});
  if(forCheckout) {
    const r=await db.query("SELECT active FROM branches WHERE id=$1",[id]);
    if(!r.rows.length||!(r.rows[0].active===true||r.rows[0].active===1||r.rows[0].active==='1'))throw Object.assign(new Error('This branch is inactive. Ask the administrator to reactivate it.'),{status:403});
  }
  return id;
}

async function saveBranch(db,actor,body,id,logAction) {
  const name=String(body.name||'').trim().replace(/\s+/g,' ');
  const address=String(body.address||'').trim();
  if(name.length<2||name.length>120||address.length>250)throw Object.assign(new Error('Branch name must be 2–120 characters; address up to 250.'),{status:400});
  const active=body.active===undefined?true:body.active===true;
  const duplicate=await db.query("SELECT id FROM branches WHERE LOWER(name)=LOWER($1)",[name]);
  if(duplicate.rows.some(x=>Number(x.id)!==Number(id||0)))throw Object.assign(new Error('A branch with this name already exists.'),{status:409});
  if(id){
    const existing=await db.query('SELECT id FROM branches WHERE id=$1',[id]);
    if(!existing.rows.length)throw Object.assign(new Error('Branch not found.'),{status:404});
    if(!active){
      const activeUsers=await db.query("SELECT COUNT(*) AS c FROM users WHERE branch_id=$1 AND role='User' AND active=$2",[id,true]);
      if(Number(activeUsers.rows[0].c)>0)throw Object.assign(new Error('Reassign or deactivate active users before disabling this branch.'),{status:409});
    }
    await db.query('UPDATE branches SET name=$1,address=$2,active=$3 WHERE id=$4',[name,address,active,id]);
  }else{
    const r=await db.query('INSERT INTO branches (name,address,active) VALUES ($1,$2,$3) RETURNING id',[name,address,active]);
    id=Number(r.rows[0].id);
  }
  await logAction(actor,'Branch saved: '+name,id?'Branch Updated':'Branch Added',active?'Active':'Inactive');
  return {id,name,address,active};
}

async function deleteBranch(db,actor,id,logAction) {
  const b=await db.query('SELECT id,name FROM branches WHERE id=$1',[id]);
  if(!b.rows.length)throw Object.assign(new Error('Branch not found.'),{status:404});
  const refs=await db.query("SELECT (SELECT COUNT(*) FROM users WHERE branch_id=$1) AS users_count,(SELECT COUNT(*) FROM sales WHERE branch_id=$1) AS sales_count",[id]);
  if(Number(refs.rows[0].users_count)||Number(refs.rows[0].sales_count))
    throw Object.assign(new Error('This branch has assigned users or sales. Reassign users and deactivate the branch to preserve transaction history.'),{status:409});
  await db.query('DELETE FROM branches WHERE id=$1',[id]);
  await logAction(actor,'Branch deleted: '+b.rows[0].name,'Branch Deleted',null);
  return {ok:true};
}

function validDay(value) {
  if(typeof value!=='string'||! /^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const d=new Date(value+'T00:00:00Z');
  return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;
}

function dateAdd(d,n){const x=new Date(d+'T00:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);}

function manilaDay(date){
  const f=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'});
  const parts=Object.fromEntries(f.formatToParts(date).map(x=>[x.type,x.value]));
  return parts.year+'-'+parts.month+'-'+parts.day;
}

async function buildTrend(db,params,branchId){
  const now=manilaDay(new Date());
  const view=['hourly','10days','custom'].includes(params.view)?params.view:'hourly';
  const from=view==='hourly'?now:view==='10days'?dateAdd(now,-9):String(params.from||'');
  const to=view==='custom'?String(params.to||''):now;
  if(!validDay(from)||!validDay(to)||from>to)throw Object.assign(new Error('Choose a valid custom start and end date.'),{status:400});
  const days=Math.round((Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/86400000)+1;
  if(days>366)throw Object.assign(new Error('Choose a range of up to 366 days.'),{status:400});
  const grain=days===1?'hourly':'daily';
  const after=dateAdd(to,1);
  const startAt=new Date(from+'T00:00:00+08:00').toISOString();
  const endAt=new Date(after+'T00:00:00+08:00').toISOString();
  const where=branchId?" AND branch_id=$4":"";
  const args=branchId?['Sold',startAt,endAt,branchId]:['Sold',startAt,endAt];
  const r=await db.query("SELECT sold_at,actual FROM sales WHERE status=$1 AND sold_at >= $2 AND sold_at < $3"+where,args);
  const points=[];
  if(grain==='hourly'){
    for(let h=0;h<24;h++){const label=((h+11)%12+1)+(h<12?' AM':' PM');points.push({label,key:String(h).padStart(2,'0'),actual:0,transactions:0});}
  }else{
    for(let i=0;i<days;i++){const day=dateAdd(from,i);points.push({label:day.slice(5),key:day,actual:0,transactions:0});}
  }
  const map=new Map(points.map(p=>[p.key,p]));
  for(const sale of r.rows) {
    const date=new Date(sale.sold_at);
    const day=manilaDay(date);
    const hour=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Manila',hour:'2-digit',hourCycle:'h23'}).format(date);
    const point=map.get(grain==='hourly'?hour:day);
    if(point){point.actual=Math.round((point.actual+Number(sale.actual||0))*100)/100;point.transactions++;}
  }
  return {view,grain,from,to,days,trend:points.map(({label,actual,transactions})=>({label,actual,transactions})),rangeActual:Math.round(points.reduce((n,p)=>n+p.actual,0)*100)/100,rangeTransactions:points.reduce((n,p)=>n+p.transactions,0)};
}

module.exports={migrateBranches,listBranches,resolveAssignment,salesScope,saveBranch,deleteBranch,buildTrend};
