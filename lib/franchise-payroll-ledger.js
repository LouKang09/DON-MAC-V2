'use strict';
const crypto=require('node:crypto'),ent=require('./franchise-payroll-entitlement'),
 attendance=require('./franchise-attendance');
const {bad,id,now,requireAdmin}=ent;
const money=n=>Math.round((Number(n)+Number.EPSILON)*100)/100;
function cutoff(year,month,half){
 const y=Number(year),m=Number(month),h=String(half);
 if(!Number.isInteger(y)||y<2020||y>2100||!Number.isInteger(m)||m<1||m>12||!['first','second'].includes(h))
  throw bad('Select an appropriate 15th or month-end cutoff.');
 const end=h==='first'?15:new Date(Date.UTC(y,m,0)).getUTCDate(),first=h==='first'?1:16;
 const date=n=>y+'-'+String(m).padStart(2,'0')+'-'+String(n).padStart(2,'0');
 const monthText=new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'long',year:'numeric'}).format(new Date(Date.UTC(y,m-1,1)));
 return{from:date(first),to:date(end),label:first+'–'+end+' '+monthText};
}
function parseRows(input){
 if(!Array.isArray(input)||input.length>15)throw bad('Up to 15 payroll rows can be entered per column.');
 return input.map(x=>{
  const label=String(x?.label||'').trim(),amount=Number(x?.amount);
  if(!label||label.length>100||!Number.isFinite(amount)||amount<0||amount>10000000)
   throw bad('Each payroll row needs a label and a nonnegative amount.');
  return{label,amount:money(amount)};
 });
}
const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
async function migrate(db){
 const fk=db.engine==='postgres'?'BIGINT':'INTEGER';
 await db.exec('CREATE TABLE IF NOT EXISTS franchise_payroll_rates('+
  'workspace_id '+fk+' NOT NULL REFERENCES chat_workspaces(id) ON DELETE CASCADE,'+
  'user_id '+fk+' NOT NULL REFERENCES users(id) ON DELETE CASCADE,'+
  'daily_wage NUMERIC(12,2) NOT NULL DEFAULT 582,updated_at TEXT,'+
  'PRIMARY KEY(workspace_id,user_id))');
 await db.exec('CREATE TABLE IF NOT EXISTS franchise_payroll_counters('+
  'workspace_id '+fk+' PRIMARY KEY REFERENCES chat_workspaces(id) ON DELETE CASCADE,next_no INTEGER NOT NULL DEFAULT 1)');
 await db.exec('CREATE TABLE IF NOT EXISTS franchise_payroll_slips('+
  'id VARCHAR(40) PRIMARY KEY,workspace_id '+fk+' NOT NULL REFERENCES chat_workspaces(id) ON DELETE CASCADE,'+
  'user_id '+fk+' NOT NULL REFERENCES users(id),payslip_no INTEGER NOT NULL,'+
  'period_from VARCHAR(10) NOT NULL,period_to VARCHAR(10) NOT NULL,pay_date VARCHAR(10) NOT NULL,'+
  'employee_name VARCHAR(120) NOT NULL,period_label VARCHAR(120) NOT NULL,'+
  'earnings TEXT NOT NULL,deductions TEXT NOT NULL,notes TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,'+
  'UNIQUE(workspace_id,payslip_no),UNIQUE(workspace_id,user_id,period_from,period_to))');
 await db.exec('CREATE INDEX IF NOT EXISTS idx_franchise_payroll_scope ON franchise_payroll_slips(workspace_id,user_id,period_from)');
 await db.exec('CREATE TABLE IF NOT EXISTS franchise_payroll_slip_audit('+
  'id VARCHAR(40) PRIMARY KEY,workspace_id '+fk+' NOT NULL REFERENCES chat_workspaces(id),'+
  'slip_id VARCHAR(40) NOT NULL,actor_id '+fk+' NOT NULL REFERENCES users(id),action VARCHAR(24) NOT NULL,'+
  'snapshot TEXT NOT NULL,at TEXT NOT NULL)');
}
async function rate(db,ctx,userId){
 await attendance.employee(db,ctx,userId);
 const r=await db.query('SELECT daily_wage FROM franchise_payroll_rates WHERE workspace_id=$1 AND user_id=$2',
  [ctx.workspaceId,id(userId)]);
 return Number(r.rows[0]?.daily_wage??582);
}
async function setRate(db,ctx,body){
 requireAdmin(ctx);
 const userId=id(body?.employeeId),amount=Number(body?.dailyWage);
 await attendance.employee(db,ctx,userId);
 if(!Number.isFinite(amount)||amount<0||amount>1000000)throw bad('Enter a valid employee daily wage.');
 const salary=money(amount);
 await db.query('INSERT INTO franchise_payroll_rates(workspace_id,user_id,daily_wage,updated_at) '+
  'VALUES($1,$2,$3,$4) ON CONFLICT(workspace_id,user_id) DO UPDATE SET daily_wage=excluded.daily_wage,updated_at=excluded.updated_at',
  [ctx.workspaceId,userId,salary,now()]);
 return{ok:true,employeeId:userId,dailyWage:salary};
}
function slipView(row){
 const earn=JSON.parse(row.earnings),deduct=JSON.parse(row.deductions);
 const gross=money(earn.reduce((a,x)=>a+Number(x.amount),0)),deductionTotal=money(deduct.reduce((a,x)=>a+Number(x.amount),0));
 return{id:row.id,employeeId:Number(row.user_id),payslipNo:Number(row.payslip_no),
  periodFrom:row.period_from,periodTo:row.period_to,payDate:row.pay_date,
  employeeName:row.employee_name,periodLabel:row.period_label,earnings:earn,deductions:deduct,notes:row.notes,
  gross,deductionTotal,netPay:money(gross-deductionTotal),updatedAt:row.updated_at};
}
async function preview(db,ctx,query){
 requireAdmin(ctx);
 const employee=await attendance.employee(db,ctx,query.employeeId),period=cutoff(query.year,query.month,query.half);
 employee.dailyWage=await rate(db,ctx,employee.id);
 const days=await attendance.records(db,ctx,employee.id,period.from,period.to);
 let completedDays=0,openDays=0,lateMinutes=0,earlyMinutes=0,extraLunchMinutes=0,pausedMinutes=0;
 const details=days.map(x=>{
  if(x.state!=='out'){openDays++;return{...x,completed:false,lateDeductedMinutes:0};}
  completedDays++;
  // Water POS policy: 9 AM–6 PM, 1 unpaid lunch hour; 30-minute grace for lateness.
  // Deductions never exceed the 8-hour base per completed day.
  let remaining=480;
  const late=Math.min(remaining,x.lateMinutes>=30?x.lateMinutes:0);remaining-=late;
  const early=Math.min(remaining,x.earlyMinutes);remaining-=early;
  const lunch=Math.min(remaining,Math.max(0,x.lunchMinutes-60));remaining-=lunch;
  const gap=Math.min(remaining,x.pausedMinutes);
  lateMinutes+=late;earlyMinutes+=early;extraLunchMinutes+=lunch;pausedMinutes+=gap;
  return{...x,completed:true,lateDeductedMinutes:late,
   earlyDeductedMinutes:early,extraLunchDeductedMinutes:lunch,gapDeductedMinutes:gap};
 });
 const gross=money(completedDays*employee.dailyWage),unit=employee.dailyWage/480;
 const earnings=[{label:period.label+' · '+completedDays+' completed day(s) × ₱'+employee.dailyWage.toFixed(2),amount:gross}];
 const deductions=[{label:'Late',amount:money(lateMinutes*unit)},
  {label:'Early Time Out',amount:money(earlyMinutes*unit)},
  {label:'Excess Lunch',amount:money(extraLunchMinutes*unit)},
  {label:'Time-Out Gap',amount:money(pausedMinutes*unit)}];
 const r=await db.query('SELECT * FROM franchise_payroll_slips WHERE workspace_id=$1 AND user_id=$2 AND period_from=$3 AND period_to=$4',
  [ctx.workspaceId,employee.id,period.from,period.to]);
 const count=await db.query('SELECT next_no FROM franchise_payroll_counters WHERE workspace_id=$1',[ctx.workspaceId]);
 return{employee,period,payDate:attendance.day(),days:details,completedDays,openDays,
  lateMinutes,earlyMinutes,extraLunchMinutes,pausedMinutes,earnings,deductions,
  estimatedPayslipNo:r.rows[0]?Number(r.rows[0].payslip_no):Number(count.rows[0]?.next_no||1),
  saved:r.rows[0]?slipView(r.rows[0]):null};
}
async function saveSlip(db,ctx,body){
 requireAdmin(ctx);
 const employee=await attendance.employee(db,ctx,body?.employeeId),period=cutoff(body?.year,body?.month,body?.half);
 const earnings=parseRows(body.earnings),deductions=parseRows(body.deductions);
 const employeeName=String(body.employeeName||employee.name).trim(),periodLabel=String(body.periodLabel||period.label).trim(),
  payDate=String(body.payDate||attendance.day()),notes=String(body.notes||'').trim();
 if(!earnings.length||!employeeName||employeeName.length>120||!periodLabel||periodLabel.length>120||
  !validDate(payDate)||notes.length>500)throw bad('Enter employee name, pay period and valid pay date.');
 return db.transaction(async tx=>{
  const old=await tx.query('SELECT * FROM franchise_payroll_slips WHERE workspace_id=$1 AND user_id=$2 '+
   'AND period_from=$3 AND period_to=$4'+(tx.engine==='postgres'?' FOR UPDATE':''),
   [ctx.workspaceId,employee.id,period.from,period.to]);
  let row;
  const values=[payDate,employeeName,periodLabel,JSON.stringify(earnings),JSON.stringify(deductions),notes,now()];
  if(old.rows.length){
   row=(await tx.query('UPDATE franchise_payroll_slips SET pay_date=$1,employee_name=$2,period_label=$3,'+
    'earnings=$4,deductions=$5,notes=$6,updated_at=$7 WHERE id=$8 RETURNING *',[...values,old.rows[0].id])).rows[0];
  }else{
   await tx.query('INSERT INTO franchise_payroll_counters(workspace_id,next_no) VALUES($1,$2) '+
    'ON CONFLICT(workspace_id) DO NOTHING',[ctx.workspaceId,1]);
   const c=await tx.query('SELECT next_no FROM franchise_payroll_counters WHERE workspace_id=$1'+
    (tx.engine==='postgres'?' FOR UPDATE':''),[ctx.workspaceId]);
   const next=Number(c.rows[0].next_no);
   row=(await tx.query('INSERT INTO franchise_payroll_slips('+
    'id,workspace_id,user_id,payslip_no,period_from,period_to,pay_date,employee_name,period_label,earnings,deductions,notes,created_at,updated_at) '+
    'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *',
    [crypto.randomUUID(),ctx.workspaceId,employee.id,next,period.from,period.to,
     payDate,employeeName,periodLabel,JSON.stringify(earnings),JSON.stringify(deductions),notes,now(),now()])).rows[0];
   await tx.query('UPDATE franchise_payroll_counters SET next_no=$1 WHERE workspace_id=$2',[next+1,ctx.workspaceId]);
  }
  await tx.query('INSERT INTO franchise_payroll_slip_audit(id,workspace_id,slip_id,actor_id,action,snapshot,at) '+
   'VALUES($1,$2,$3,$4,$5,$6,$7)',[crypto.randomUUID(),ctx.workspaceId,row.id,ctx.userId,
    old.rows.length?'edit':'create',JSON.stringify(slipView(row)),now()]);
  return{ok:true,slip:slipView(row)};
 });
}
async function slips(db,ctx){
 requireAdmin(ctx);
 const r=await db.query('SELECT * FROM franchise_payroll_slips WHERE workspace_id=$1 ORDER BY updated_at DESC LIMIT 80',
  [ctx.workspaceId]);
 return{slips:r.rows.map(slipView)};
}
async function settings(db,ctx){
 requireAdmin(ctx);
 const r=await db.query('SELECT next_no FROM franchise_payroll_counters WHERE workspace_id=$1',[ctx.workspaceId]);
 return{nextPayslipNo:Number(r.rows[0]?.next_no||1)};
}
async function setNumber(db,ctx,body){
 requireAdmin(ctx);
 const n=Number(body?.nextPayslipNo);
 if(!Number.isSafeInteger(n)||n<1||n>1000000000)throw bad('Choose a valid payslip number.');
 const q=await db.query('SELECT MAX(payslip_no) AS max_no FROM franchise_payroll_slips WHERE workspace_id=$1',
  [ctx.workspaceId]);
 if(n<=Number(q.rows[0]?.max_no||0))throw bad('Next number must exceed the highest issued payslip.');
 await db.query('INSERT INTO franchise_payroll_counters(workspace_id,next_no) VALUES($1,$2) '+
  'ON CONFLICT(workspace_id) DO UPDATE SET next_no=excluded.next_no',[ctx.workspaceId,n]);
 return{ok:true,nextPayslipNo:n};
}
async function deleteSlip(db,ctx,slipId){
 requireAdmin(ctx);
 return db.transaction(async tx=>{
  const q=await tx.query('SELECT * FROM franchise_payroll_slips WHERE workspace_id=$1 AND id=$2'+
   (tx.engine==='postgres'?' FOR UPDATE':''),[ctx.workspaceId,slipId]);
  const row=q.rows[0];if(!row)throw bad('Payslip not found.',404);
  await tx.query('INSERT INTO franchise_payroll_slip_audit(id,workspace_id,slip_id,actor_id,action,snapshot,at) '+
   'VALUES($1,$2,$3,$4,$5,$6,$7)',[crypto.randomUUID(),ctx.workspaceId,row.id,ctx.userId,'delete',
    JSON.stringify(slipView(row)),now()]);
  await tx.query('DELETE FROM franchise_payroll_slips WHERE workspace_id=$1 AND id=$2',[ctx.workspaceId,slipId]);
  return{ok:true,id:slipId};
 });
}
module.exports={migrate,cutoff,preview,saveSlip,slips,settings,setNumber,rate,setRate,deleteSlip};
