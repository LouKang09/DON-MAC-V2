'use strict';
// The sale archive remains owned by its franchise and downloadable after the online window.
const fail=(m,status=400)=>Object.assign(new Error(m),{status});
const today=()=>{const t=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const x=k=>t.find(p=>p.type===k)?.value;return x('year')+'-'+x('month')+'-'+x('day');};
function minusMonths(value,count){
 const [y,m,d]=value.split('-').map(Number),a=new Date(Date.UTC(y,m-1-count,1));
 const last=new Date(Date.UTC(a.getUTCFullYear(),a.getUTCMonth()+1,0)).getUTCDate();
 a.setUTCDate(Math.min(d,last));return a.toISOString().slice(0,10);
}
const start=d=>new Date(d+'T00:00:00+08:00').toISOString();
async function policy(db,user){
 if(!user?.id)throw fail('Authentication required.',401);
 const q=await db.query('SELECT m.workspace_id,p.plan FROM chat_memberships m LEFT JOIN platform_account_plans p ON p.workspace_id=m.workspace_id WHERE m.user_id=$1 ORDER BY m.workspace_id LIMIT 2',[user.id]);
 if(q.rows.length!==1)throw fail('Account must belong to exactly one franchise workspace.',403);
 const workspaceId=Number(q.rows[0].workspace_id),plan=q.rows[0].plan==='BUSINESS'?'BUSINESS':'PRO';
 if(!Number.isSafeInteger(workspaceId)||workspaceId<1)throw fail('Franchise workspace not found.',403);
 const includedMonths=plan==='BUSINESS'?24:12,cutoffDate=minusMonths(today(),includedMonths);
 return{workspaceId,plan,includedMonths,cutoffDate,cutoffUtc:start(cutoffDate),exportAlwaysAvailable:true,recordsDeleted:false};
}
function csv(v){
 let x=String(v??'').replace(/\u0000/g,'');
 if(/^\s*[=+@-]/.test(x))x="'"+x;
 return '"'+x.replace(/"/g,'""')+'"';
}
async function exportCsv(db,user,filter={}){
 if(user?.role!=='Admin')throw fail('Only a franchise Owner or Co-Owner can export sales.',403);
 const access=await policy(db,user),yearString=String(filter.year||'');
 const maxYear=Number(today().slice(0,4));
 if(!/^\d{4}$/.test(yearString)||Number(yearString)<2000||Number(yearString)>maxYear)throw fail('Choose a valid year to export.');
 const year=Number(yearString),option=String(filter.branchId||'all');
 const branchId=option==='all'?null:Number(option);
 if(branchId!==null){
  if(!Number.isSafeInteger(branchId)||branchId<=0)throw fail('Invalid branch.');
  const scope=await db.query('SELECT 1 FROM chat_workspace_branches WHERE workspace_id=$1 AND branch_id=$2',[access.workspaceId,branchId]);
  if(!scope.rows.length)throw fail('Branch is outside your franchise workspace.',403);
 }
 const args=[access.workspaceId,start(year+'-01-01'),start((year+1)+'-01-01'),...(branchId===null?[]:[branchId])];
 const r=await db.query(
  'SELECT s.reference,s.sold_at,s.status,s.payment_mode,s.payment_reference,s.cashier_name_snapshot,'+
  's.customer_name,s.order_type,s.gross,s.adjustment,s.actual,s.discount_amount,b.name AS branch_name,'+
  'i.product_name_snapshot,i.quantity,i.unit_price,i.line_total FROM sales s '+
  'JOIN chat_workspace_branches w ON w.branch_id=s.branch_id JOIN branches b ON b.id=s.branch_id '+
  'LEFT JOIN sale_items i ON i.sale_id=s.id WHERE w.workspace_id=$1 AND s.sold_at >= $2 AND s.sold_at < $3'+
  (branchId===null?'':' AND s.branch_id=$4')+' ORDER BY s.sold_at,s.id,i.id LIMIT 75001',args);
 if(r.rows.length>75000)throw fail('Export exceeds 75,000 lines. Request a bulk export.',413);
 const fmt=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 const lines=[['reference','sold_at_ph','branch','status','payment_mode','payment_reference','cashier','customer','order_type','gross','adjustment','net','discount','item','quantity','unit_price','line_total'].join(',')];
 for(const row of r.rows)lines.push([
  row.reference,row.sold_at?fmt.format(new Date(row.sold_at)):'',row.branch_name,row.status,row.payment_mode,
  row.payment_reference,row.cashier_name_snapshot,row.customer_name,row.order_type,row.gross,row.adjustment,
  row.actual,row.discount_amount,row.product_name_snapshot,row.quantity,row.unit_price,row.line_total].map(csv).join(','));
 const buffer=Buffer.from('\uFEFF'+lines.join('\r\n')+'\r\n');
 if(buffer.length>50*1024*1024)throw fail('Export exceeds 50 MB. Request a bulk export.',413);
 return{buffer,filename:'DonMac_Sales_'+year+(branchId===null?'':'_Branch_'+branchId)+'.csv'};
}
module.exports={today,minusMonths,start,policy,exportCsv};