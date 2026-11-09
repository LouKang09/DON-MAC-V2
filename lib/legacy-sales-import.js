'use strict';
/* Strict, preview-first import of historical sales. No inventory mutation, 
 * no client-supplied IDs or executable SQL, and one atomic commit per batch. */
const REQUIRED=[
 'reference','sold_at','branch_name','status','payment_mode',
 'item_name','quantity','unit_price','sale_total'
];
const OPTIONAL=['customer_name','cashier_name','order_type','discount_amount','payment_reference','remark'];
const COLUMNS=[...REQUIRED,...OPTIONAL];
const MAX_ROWS=500,MAX_SALES=200;
const norm=v=>String(v??'').trim();
const upper=v=>norm(v).toUpperCase();
const money=v=>Math.round((v+Number.EPSILON)*100)/100;
const err=(msg,status=400)=>Object.assign(new Error(msg),{status});
function num(v,{allowEmpty=false,max=9999999999.99,places=2}={}){
 const t=norm(v);
 if(allowEmpty&&!t)return 0;
 if(!new RegExp('^\\d+(?:\\.\\d{1,'+places+'})?$').test(t))return null;
 const n=Number(t);
 return Number.isFinite(n)&&n<=max?n:null;
}
function historicalDate(raw){
 const text=norm(raw);
 let iso=text;
 const local=text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
 if(local){
  const y=Number(local[1]),m=Number(local[2]),day=Number(local[3]),hour=Number(local[4]),min=Number(local[5]),sec=Number(local[6]||0);
  const test=new Date(Date.UTC(y,m-1,day,hour,min,sec));
  if(test.getUTCFullYear()!==y||test.getUTCMonth()!==m-1||test.getUTCDate()!==day||hour>23||min>59||sec>59)return null;
  iso=local[1]+'-'+local[2]+'-'+local[3]+'T'+local[4]+':'+local[5]+':'+String(sec).padStart(2,'0')+'+08:00';
 }else if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(text))return null;
 const date=new Date(iso);
 return Number.isFinite(date.getTime())&&date.getTime()<=Date.now()+86400000?date.toISOString():null;
}
const same=(a,b)=>a.date===b.date&&a.branchId===b.branchId&&a.status===b.status&&
 a.paymentMode===b.paymentMode&&a.total===b.total&&a.discount===b.discount&&
 a.customer===b.customer&&a.cashier===b.cashier&&a.orderType===b.orderType&&a.paymentReference===b.paymentReference;
async function validate(db,rows,user){
 if(!Array.isArray(rows)||!rows.length||rows.length>MAX_ROWS)
  throw err('Choose a CSV containing 1–'+MAX_ROWS+' item rows.');
 if(rows.some(x=>!x||typeof x!=='object'||Array.isArray(x)))throw err('Each CSV row must be a column/value object.');
 if(user?.role!=='Admin')throw err('Owner or Co-Owner required to import sales.',403);
 const m=await db.query('SELECT workspace_id FROM chat_memberships WHERE user_id=$1 ORDER BY workspace_id LIMIT 2',[Number(user.id)]);
 if(m.rows.length!==1)throw err('Franchise workspace not found or ambiguous.',403);
 const branchRows=(await db.query('SELECT b.id,b.name FROM branches b JOIN chat_workspace_branches w ON w.branch_id=b.id WHERE w.workspace_id=$1',[Number(m.rows[0].workspace_id)])).rows;
 const branches=new Map(branchRows.map(x=>[upper(x.name),{id:Number(x.id),name:x.name}]));
 const problems=[],groups=new Map();
 const error=(row,message)=>{if(problems.length<100)problems.push({row,message});};
 for(let i=0;i<rows.length;i++){
  const row=rows[i],line=Number(row.__row)||i+2;
  if(!Number.isInteger(line)||line<2||line>1000000){error(i+2,'Invalid row number.');continue;}
  if(Object.keys(row).some(k=>!COLUMNS.includes(k)&&k!=='__row')){error(line,'Unexpected CSV column; download the provided template.');continue;}
  const reference=norm(row.reference);
  if(!reference||reference.length>80||/[\r\n\x00-\x1F]/.test(reference)){error(line,'reference is required (maximum 80 printable characters).');continue;}
  const date=historicalDate(row.sold_at);
  if(!date){error(line,'sold_at must be a valid Philippines local date and time: YYYY-MM-DD HH:mm.');continue;}
  const branch=branches.get(upper(row.branch_name));
  if(!branch){error(line,'branch_name must match an existing branch in Branches & Cashiers.');continue;}
  const rawStatus=upper(row.status).replace(/\s+/g,'');
  const status=['SOLD','SALE','COMPLETED','PAID'].includes(rawStatus)?'Sold':
   ['VOID','VOIDED','CANCEL','CANCELED','CANCELLED','DELETED'].includes(rawStatus)?'Deleted':null;
  if(!status){error(line,'status must be Sold, Voided or Cancelled (no pending/unpaid imports).');continue;}
  const rawMode=upper(row.payment_mode).replace(/\s+/g,'');
  const paymentMode=rawMode==='CASH'?'Cash':rawMode==='GCASH'?'GCash':null;
  if(!paymentMode){error(line,'payment_mode must be Cash or GCash under the current POS database format.');continue;}
  const item=norm(row.item_name);
  if(!item||item.length>150){error(line,'item_name must be 1–150 characters. Use a separate row for each item.');continue;}
  const quantity=num(row.quantity,{max:999999999.999,places:3});
  const unitPrice=num(row.unit_price);
  const total=num(row.sale_total);
  const discount=num(row.discount_amount,{allowEmpty:true});
  if(quantity===null||quantity<=0){error(line,'quantity must be greater than zero, with up to 3 decimals.');continue;}
  if(unitPrice===null){error(line,'unit_price must be a non-negative number with up to 2 decimals (no ₱ or commas).');continue;}
  if(total===null||discount===null){error(line,'sale_total and discount_amount must be valid amounts with up to 2 decimals.');continue;}
  const orderRaw=upper(row.order_type).replace(/\s+/g,'');
  const orderType=!orderRaw?'Take Away':orderRaw==='DINEIN'?'Dine In':orderRaw==='TAKEAWAY'?'Take Away':
   (orderRaw==='ORDERONLINE'||orderRaw==='ONLINE')?'Order Online':null;
  if(!orderType){error(line,'order_type must be Dine In, Take Away or Order Online.');continue;}
  const customer=norm(row.customer_name),cashier=norm(row.cashier_name)||'Historical Import';
  const paymentReference=norm(row.payment_reference),remark=norm(row.remark);
  if(customer.length>120||cashier.length>100||paymentReference.length>150||remark.length>300){
   error(line,'customer_name, cashier_name, payment_reference or remark is too long.');continue;
  }
  const sale={reference,date,branchId:branch.id,branchName:branch.name,status,paymentMode,customer,cashier,
   orderType,paymentReference,remark,total,discount,items:[],firstRow:line};
  const key=upper(reference);
  const existing=groups.get(key);
  if(existing&&!same(existing,sale)){error(line,'Sale-level values conflict with another row of reference '+reference+'.');continue;}
  const target=existing||sale;
  target.items.push({name:item,qty:quantity,unitPrice,lineTotal:money(quantity*unitPrice),row:line});
  if(!existing)groups.set(key,sale);
 }
 if(groups.size>MAX_SALES)error(0,'Maximum '+MAX_SALES+' sales per batch.');
 for(const sale of groups.values()){
   const gross=money(sale.items.reduce((x,y)=>x+y.lineTotal,0));
   if(gross>9999999999.99){error(sale.firstRow,'Gross amount exceeds the database monetary limit.');continue;}
   if(sale.discount>gross){error(sale.firstRow,'discount_amount exceeds this sale gross.');continue;}
   if(Math.abs(money(gross-sale.discount)-sale.total)>0.01)
     error(sale.firstRow,'sale_total must equal the sum of quantity × unit_price minus discount_amount; expected '+money(gross-sale.discount).toFixed(2)+'.');
   sale.gross=gross;
 }
 if(groups.size){
  const refList=[...groups.keys()];
  const placeholders=refList.map((_,i)=>'$'+(i+1)).join(',');
  const existing=(await db.query('SELECT reference FROM sales WHERE UPPER(reference) IN ('+placeholders+')',refList)).rows;
  for(const record of existing){
   const sale=groups.get(upper(record.reference));
   if(sale)error(sale.firstRow,'Reference '+sale.reference+' already exists. Import never overwrites a sale.');
  }
 }
 return{ok:!problems.length,errors:problems,salesCount:groups.size,itemRows:rows.length,
  total:money([...groups.values()].reduce((acc,s)=>acc+s.total,0)),groups:[...groups.values()],
  preview:[...groups.values()].slice(0,8).map(s=>({
   reference:s.reference,date:s.date,branch:s.branchName,status:s.status,
   paymentMode:s.paymentMode,total:s.total,items:s.items.length
  }))};
}
async function run({db,user,rows,commit=false,logAction}){
 if(!commit){
  const result=await validate(db,rows,user);
  const {groups,...publicResult}=result;
  return{...publicResult,notice:'Preview only. No sales have been saved and inventory remains unchanged.'};
 }
 return db.transaction(async tx=>{
  const result=await validate(tx,rows,user);
  if(!result.ok)return{...result,groups:undefined,committed:false,
   notice:'Nothing imported. Fix every validation error and preview again.'};
  for(const sale of result.groups){
   const fields=['reference','cashier_user_id','cashier_name_snapshot','payment_mode','payment_reference',
    'tender','change_amount','status','remark','senior_details','discount_amount','gross','adjustment',
    'actual','promo_id','sold_at','client_request_id','branch_id','order_type','customer_name',
    'table_label','deleted_at','deleted_by'];
   const values=[sale.reference,null,sale.cashier,sale.paymentMode,sale.paymentReference||null,
    sale.total,0,sale.status,
    'HISTORICAL CSV IMPORT — inventory unchanged; historical costs not reconstructed. '+sale.remark,
    null,sale.discount,sale.gross,-sale.discount,sale.total,null,sale.date,null,
    sale.branchId,sale.orderType,sale.customer||null,null,
    sale.status==='Deleted'?sale.date:null,null];
   const placeholders=fields.map((_,i)=>'$'+(i+1)).join(',');
   const inserted=await tx.query('INSERT INTO sales ('+fields.join(',')+') VALUES ('+placeholders+') RETURNING id',values);
   const saleId=Number(inserted.rows[0].id);
   for(const item of sale.items){
    await tx.query('INSERT INTO sale_items (sale_id,product_id,add_on_id,package_id,product_name_snapshot,quantity,unit_price,line_total,is_add_on,is_package,exclude_from_costing) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
    [saleId,null,null,null,item.name,item.qty,item.unitPrice,item.lineTotal,false,false,true]);
   }
  }
  if(typeof logAction==='function'){
   await logAction(user,'Historical CSV sales import','Import',result.salesCount+
      ' sales, '+result.itemRows+' item rows. No historical inventory deduction.',tx);
  }
  return{ok:true,committed:true,salesCount:result.salesCount,itemRows:result.itemRows,total:result.total,
   notice:'Imported atomically. Existing sales and stock were not modified. Historical ingredient costs remain unavailable.'};
 });
}
module.exports={REQUIRED,OPTIONAL,COLUMNS,validate,run};
