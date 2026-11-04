/* Don Mac POS v1.5.72 — guided, explicit, preview-first historical sales importer. */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const fileInput=$('csvSalesFile');
if(!fileInput||window.donmacSalesCsvImport)return;
const REQUIRED=['reference','sold_at','branch_name','status','payment_mode','item_name','quantity','unit_price','sale_total'];
const OPTIONAL=['customer_name','cashier_name','order_type','discount_amount','payment_reference','remark'];
const FIELDS=[...REQUIRED,...OPTIONAL];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let rows=null,valid=false,busy=false,completed=false;
const note=(message,bad=false)=>{
 const el=$('csvSalesMessage');el.textContent=message;el.classList.toggle('is-error',bad);
};
function reset(){
 rows=null;valid=false;completed=false;busy=false;
 $('csvSalesCommit').disabled=true;
 $('csvSalesConfirm').checked=false;
 $('csvSalesPreviewResult').classList.add('hidden');
 $('csvSalesErrors').classList.add('hidden');$('csvSalesErrors').replaceChildren();
 $('csvSalesPreviewRows').replaceChildren();
 $('csvSalesPreview').disabled=false;
 note('Choose a CSV file and click Preview & Validate.');
}
function parseCsv(source){
 const text=String(source||'').replace(/^\uFEFF/,'');
 const records=[];let row=[],cell='',quoted=false,line=1,start=1;
 function finish(){
   row.push(cell);
   if(row.some(x=>x.trim()!==''))records.push({cells:row,line:start});
   row=[];cell='';
 }
 for(let i=0;i<text.length;i++){
  const c=text[i],next=text[i+1];
  if(quoted){
    if(c==='"'&&next==='"'){cell+='"';i++;}
    else if(c==='"'){quoted=false;}
    else{cell+=c;if(c==='\n')line++;}
  }else if(c==='"'){
    if(cell.trim()!=='')throw Error('Unexpected quotation mark on line '+line+'.');
    quoted=true;cell='';
  }else if(c===','){
    row.push(cell);cell='';
  }else if(c==='\n'||c==='\r'){
    finish();
    if(c==='\r'&&next==='\n')i++;
    line++;start=line;
  }else{cell+=c;}
 }
 if(quoted)throw Error('Unclosed quoted field near line '+start+'.');
 if(cell.length||row.length)finish();
 if(records.length<2)throw Error('The file has no sales rows. Download the template and fill its columns.');
 const heads=records.shift().cells.map(x=>x.trim().toLowerCase());
 const seen=new Set();
 for(const h of heads){
   if(!h||seen.has(h))throw Error('CSV column names cannot be blank or duplicated.');
   seen.add(h);
   if(!FIELDS.includes(h))throw Error('Unsupported column "'+h+'". Please use the exact template header names.');
 }
 const missing=REQUIRED.filter(h=>!seen.has(h));
 if(missing.length)throw Error('Missing required columns: '+missing.join(', ')+'. Download the template for the exact format.');
 if(records.length>500)throw Error('Maximum 500 item rows per upload. Split the sheet into smaller batches.');
 return records.map(rec=>{
   if(rec.cells.length!==heads.length)throw Error('Line '+rec.line+' has '+rec.cells.length+' columns; expected '+heads.length+'. Check commas and quotes.');
   const item={__row:rec.line};
   heads.forEach((h,i)=>{item[h]=rec.cells[i].trim();});
   return item;
 });
}
function downloadTemplate(){
 const content=FIELDS.join(',')+'\r\n';
 const blob=new Blob(['\uFEFF'+content],{type:'text/csv;charset=utf-8'});
 const link=document.createElement('a');link.href=URL.createObjectURL(blob);
 link.download='donmac-historical-sales-template.csv';
 document.body.appendChild(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(link.href),1000);
}
function errors(list){
 const host=$('csvSalesErrors');host.replaceChildren();
 if(!Array.isArray(list)||!list.length){host.classList.add('hidden');return;}
 const heading=document.createElement('strong');heading.textContent=list.length+' validation issue(s) to fix';host.appendChild(heading);
 const ul=document.createElement('ul');
 list.slice(0,20).forEach(problem=>{
   const li=document.createElement('li');
   li.textContent=(problem.row?'Row '+problem.row+': ':'')+String(problem.message||problem);
   ul.appendChild(li);
 });
 host.appendChild(ul);
 if(list.length>20){const rest=document.createElement('p');rest.textContent='Additional errors not displayed. Correct these and preview again.';host.appendChild(rest);}
 host.classList.remove('hidden');
}
async function post(endpoint,payload){
 const r=await fetch('/api/admin/imports/sales/'+endpoint,{method:'POST',credentials:'same-origin',
  headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),cache:'no-store'});
 const data=await r.json().catch(()=>({}));
 if(!r.ok)throw Error(data.error||'Sales import request failed (HTTP '+r.status+').');
 return data;
}
function showPreview(result){
 const section=$('csvSalesPreviewResult');
 section.classList.remove('hidden');
 $('csvSalesSummary').textContent=result.salesCount+' distinct sales · '+result.itemRows+
  ' item rows · '+new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(result.total||0)+
  ' total recorded amounts. First '+(result.preview||[]).length+' sales shown.';
 $('csvSalesPreviewRows').innerHTML=(result.preview||[]).map(item=>
  '<tr><td>'+esc(item.reference)+'</td><td>'+esc(new Date(item.date).toLocaleString('en-PH',{timeZone:'Asia/Manila'}))+'</td>'+
  '<td>'+esc(item.branch)+'</td><td>'+esc(item.status==='Deleted'?'Voided / Cancelled':'Sold')+'</td>'+
  '<td>'+esc(item.items)+'</td><td class="num">'+esc(Number(item.total).toFixed(2))+'</td></tr>'
 ).join('');
 $('csvSalesConfirm').checked=false;
 $('csvSalesCommit').disabled=true;
}
async function preview(){
 if(busy)return;
 const file=fileInput.files?.[0];
 reset();
 if(!file){note('Choose a CSV file first.',true);return;}
 if(!/\.csv$/i.test(file.name)){note('Save the Excel sheet as a .csv file first.',true);return;}
 if(file.size>1024*1024){note('File exceeds 1 MB. Split it into multiple CSV batches.',true);return;}
 busy=true;$('csvSalesPreview').disabled=true;note('Reading and validating the CSV…');
 try{
  const parsed=parseCsv(await file.text());
  rows=parsed;
  const result=await post('preview',{rows});
  errors(result.errors);
  if(!result.ok){note('Validation failed. No records were imported. Correct the errors and preview again.',true);return;}
  valid=true;showPreview(result);
  note('Validation passed. Review the preview, then check the confirmation box to enable Import.');
 }catch(e){note(e.message||'CSV could not be validated.',true);}
 finally{busy=false;$('csvSalesPreview').disabled=false;}
}
async function commit(){
 if(busy||!valid||completed||!rows||!$('csvSalesConfirm').checked)return;
 busy=true;$('csvSalesCommit').disabled=true;$('csvSalesPreview').disabled=true;
 note('Importing validated sales in one database transaction…');
 try{
  const result=await post('commit',{rows});
  errors(result.errors);
  if(!result.ok||!result.committed){
   valid=false;note('Import cancelled: validation changed. No records were saved. Preview again.',true);return;
  }
  completed=true;valid=false;
  $('csvSalesConfirm').checked=false;
  note('Imported '+result.salesCount+' sales and '+result.itemRows+' items successfully. No current stock was deducted. Historical costing needs review.');
  $('csvSalesSummary').textContent='Import complete · '+result.salesCount+' sales · '+result.itemRows+' items. Existing transactions were not overwritten.';
  $('dashboardRefresh')?.click();
 }catch(e){valid=false;note(e.message||'Import failed; no records committed.',true);}
 finally{busy=false;$('csvSalesPreview').disabled=false;}
}
async function displayBranches(){
 try{
  const response=await fetch('/api/branches',{credentials:'same-origin',cache:'no-store'});
  if(!response.ok)throw Error();
  const d=await response.json();
  const names=(d.branches||[]).map(x=>x.name);
  $('csvSalesBranches').textContent=names.length?'Existing branch names: '+names.join(' · '):'Create a branch before importing its sales.';
 }catch(_){$('csvSalesBranches').textContent='Branch names must match those in Branches & Cashiers.';}
}
fileInput.addEventListener('change',reset);
$('csvSalesTemplate').addEventListener('click',downloadTemplate);
$('csvSalesPreview').addEventListener('click',preview);
$('csvSalesCommit').addEventListener('click',commit);
$('csvSalesConfirm').addEventListener('change',()=>{
 $('csvSalesCommit').disabled=!valid||busy||completed||!$('csvSalesConfirm').checked;
});
displayBranches();
window.donmacSalesCsvImport={parseCsv};
})();
