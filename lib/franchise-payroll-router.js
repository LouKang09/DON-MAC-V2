'use strict';
const entitlement=require('./franchise-payroll-entitlement');
const attendance=require('./franchise-attendance');
const payroll=require('./franchise-payroll-ledger');
async function run(db,user,method,url,readBody){
 const ctx=await entitlement.context(db,user),path=url.pathname,q=url.searchParams;
 if(method==='GET'&&path==='/api/payroll/status'){
  const shift=ctx.entitlement.enabled&&ctx.role==='User'?await attendance.current(db,ctx):null;
  return{status:200,data:{...ctx.entitlement,role:ctx.role,shift,workday:attendance.day(),
    shiftEnd:'18:00',scheduledMinutes:540,lunchMinutes:60}};
 }
 if(method==='GET'&&path==='/api/payroll/team')return{status:200,data:await attendance.team(db,ctx)};
 const matchAction=path.match(/^\/api\/payroll\/attendance\/(time-in|lunch-start|lunch-end|time-out|continue)$/);
 if(method==='POST'&&matchAction)return{status:200,data:await attendance.action(db,ctx,matchAction[1],await readBody())};
 if(method==='GET'&&path==='/api/payroll/records'){
  const from=q.get('from'),to=q.get('to'),employeeId=q.get('employeeId');
  return{status:200,data:{days:await attendance.records(db,ctx,employeeId,from,to)}};
 }
 const edit=path.match(/^\/api\/payroll\/records\/([0-9a-f-]{36})$/i);
 if(edit&&method==='PATCH')return{status:200,data:await attendance.correct(db,ctx,edit[1],await readBody())};
 if(edit&&method==='POST'&&q.get('action')==='close'){
  const body=await readBody();return{status:200,data:await attendance.adminClose(db,ctx,edit[1],body.reason)};
 }
 if(method==='GET'&&path==='/api/payroll/preview')
  return{status:200,data:await payroll.preview(db,ctx,Object.fromEntries(q))};
 if(method==='GET'&&path==='/api/payroll/slips')return{status:200,data:await payroll.slips(db,ctx)};
 if(method==='POST'&&path==='/api/payroll/slips')return{status:200,data:await payroll.saveSlip(db,ctx,await readBody())};
 const slip=path.match(/^\/api\/payroll\/slips\/([0-9a-f-]{36})$/i);
 if(slip&&method==='DELETE')return{status:200,data:await payroll.deleteSlip(db,ctx,slip[1])};
 if(method==='GET'&&path==='/api/payroll/settings')return{status:200,data:await payroll.settings(db,ctx)};
 if(method==='PUT'&&path==='/api/payroll/settings')return{status:200,data:await payroll.setNumber(db,ctx,await readBody())};
 if(method==='POST'&&path==='/api/payroll/rate')return{status:200,data:await payroll.setRate(db,ctx,await readBody())};
 throw entitlement.bad('Unknown payroll API endpoint.',404);
}
module.exports={run};
