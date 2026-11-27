(() => {
 'use strict';
 const $=id=>document.getElementById(id);
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=x=>'₱'+Number(x||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
 const pad=n=>String(n).padStart(2,'0');
 const manila=value=>Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Manila',
  year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(value===undefined||value===null?new Date():new Date(value))
  .filter(p=>p.type!=='literal').map(x=>[x.type,x.value]));
 const localDate=value=>{const p=manila(value||new Date());return p.year+'-'+p.month+'-'+p.day;};
 const localInput=value=>{if(!value)return'';const p=manila(value);return p.year+'-'+p.month+'-'+p.day+'T'+p.hour+':'+p.minute;};
 const toISO=value=>value?new Date(value+':00+08:00').toISOString():null;
 const stamp=value=>value?new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',
  timeStyle:'short'}).format(new Date(value)):'—';
 const clock=value=>value?new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',hour:'numeric',
  minute:'2-digit'}).format(new Date(value)):'—';
 const minuteText=n=>Math.floor(Math.max(0,n)/60)+'h '+pad(Math.max(0,n)%60)+'m';
 let user=null,token=0,entitlement=null,shift=null,shiftReceivedAt=0,employees=[],previewData=null,savedSlip=null;
 let loadInProgress=false,expenseTab='ledger',branches=[];
 const mobileViewport=window.matchMedia('(max-width:699px)');
 function syncMobileAttendance(){
  const eligible=!!(user?.role==='User'&&entitlement?.enabled&&mobileViewport.matches);
  window.donmacAttendanceEligible=eligible;
  document.querySelectorAll('#app .dm-attendance-entry').forEach(button=>{
   button.classList.toggle('hidden',!eligible);
   button.disabled=!eligible;
   button.setAttribute('aria-hidden',String(!eligible));
  });
  // A cashier may have no other Management permissions; the mobile timekeeper
  // must still make the corresponding menu and More tab reachable.
  const management=document.querySelector('#mainNav .nav-management');
  if(management&&user?.role==='User'){
   const hasItems=[...management.querySelectorAll('button.nav[data-view]')]
    .some(button=>!button.classList.contains('hidden'));
   management.classList.toggle('hidden',!hasItems);
  }
  const more=document.getElementById('mobileMoreButton');
  if(more&&user?.role==='User'){
   const permitted=[...document.querySelectorAll('#mobileMorePanel .mobile-more-item')]
    .some(button=>!button.classList.contains('hidden'));
   const messages=(user.accessPermissions||[]).includes('messages.view');
   more.classList.toggle('hidden',!permitted&&!messages);
  }
  if(!eligible&&document.querySelector('#view-attendance.active'))
   window.donmacNavigateView?.('pos');
  window.donmacNavHierarchy?.sync?.();
 }
 async function api(path,method='GET',data){
  const res=await fetch(path,{method,credentials:'same-origin',cache:'no-store',
   headers:data===undefined?{}:{'Content-Type':'application/json'},
   body:data===undefined?undefined:JSON.stringify(data)});
  const json=await res.json().catch(()=>({}));
  if(!res.ok)throw Object.assign(new Error(json.error||'Request failed ('+res.status+').'),{status:res.status});
  return json;
 }
 function message(text,{silent=false}={}){if($('dmPayrollMessage'))$('dmPayrollMessage').textContent=text||'';if(!silent&&text&&window.donmacPrompt&&!/^(loading|checking|refreshing|connecting)\b/i.test(text))void window.donmacPrompt.notify(text);}
 function reset(){
  shift=null;entitlement=null;employees=[];branches=[];previewData=null;savedSlip=null;expenseTab='ledger';loadInProgress=false;
  if($('dmPayrollBranchFilter'))$('dmPayrollBranchFilter').value='all';
  if($('dmExpenseTabs'))$('dmExpenseTabs').hidden=true;
  if($('dmPayrollTabs'))$('dmPayrollTabs').hidden=true;
  const area=$('view-expenses');
  if(area)area.dataset.expenseMode='ledger';
  const pane=$('dmPayrollManager');
  if(pane){pane.classList.add('dm-expense-pane-inactive');pane.inert=true;}
  const expenseLedger=document.querySelector('#view-expenses>.pos-finance-shell');
  if(expenseLedger){expenseLedger.classList.remove('dm-expense-pane-inactive');expenseLedger.inert=false;}
  const ledger=document.querySelector('#view-expenses>.pos-finance-shell');if(ledger)ledger.hidden=false;
  $('dmAttendanceWidget')?.setAttribute('hidden','');
  syncMobileAttendance();
  $('dmPayrollManager')?.setAttribute('hidden','');
  $('dmPayrollReady')?.setAttribute('hidden','');
  $('dmPayrollLocked')?.setAttribute('hidden','');
  $('dmPayrollPurchase')?.setAttribute('hidden','');$('dmPayrollApkPanel')?.setAttribute('hidden','');
  if($('dmPayrollRoster'))$('dmPayrollRoster').replaceChildren();
  if($('dmPayrollDtr'))$('dmPayrollDtr').innerHTML='<tr><td colspan="8">Choose a cashier and preview.</td></tr>';
  // Tenant switch: remove all financial data from previous user's DOM and JS state.
  window.__donmacPayrollSavedList=[];
  for(const key of ['dmPayrollEmployee','dmPayrollEarnings','dmPayrollDeductions','dmPayrollStats','dmPayrollSaved']){
   const node=$(key);if(node)node.replaceChildren();
  }
  for(const key of ['dmPayrollSlipEmployee','dmPayrollPeriodLabel','dmPayrollPayDate','dmPayrollNotes',
   'dmPayrollRate','dmPayrollNet','dmPayrollSlipNumber','dmAttendanceStatus','dmAttendanceInfo','dmAttendanceTimer']){
   const node=$(key);if(node)node.value!==undefined && /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName) ? node.value='' : node.textContent='';
  }
  if($('dmPayrollDtrDialog')?.open)$('dmPayrollDtrDialog').close();
  message('');
 }
 function switchExpenseTab(tab,navigate=true){
  if(!user||user.role!=='Admin')return;
  expenseTab=tab==='payroll'?'payroll':'ledger';
  const destination=expenseTab==='payroll'?'payroll':'expenses';
  if(navigate&&!document.getElementById('view-'+destination)?.classList.contains('active'))
   window.donmacNavigateView?.(destination);
  // These are independent top-level pages; the Expenses Ledger cannot be
  // displayed on the Payroll route by an old theme or finance enhancement.
  const payroll=$('dmPayrollManager');
  if(payroll){
   const visible=expenseTab==='payroll';
   payroll.hidden=!visible;payroll.inert=!visible;
   payroll.classList.toggle('dm-expense-pane-inactive',!visible);
   payroll.setAttribute('aria-hidden',String(!visible));
  }
  const ledger=document.querySelector('#view-expenses>.pos-finance-shell');
  if(ledger){ledger.hidden=false;ledger.inert=false;ledger.classList.remove('dm-expense-pane-inactive');}
  if(document.querySelector('#view-'+destination+'.active')){
   if($('viewTitle'))$('viewTitle').textContent=expenseTab==='payroll'?'Payroll & Attendance':'Expenses Ledger';
   if($('viewEyebrow'))$('viewEyebrow').textContent=expenseTab==='payroll'?'EMPLOYEE MANAGEMENT':'TRANSACTIONS';
  }
  for(const id of ['dmExpenseTabs','dmPayrollTabs']){
   $(id)?.querySelectorAll('[data-expense-tab]').forEach(button=>{
    const selected=button.dataset.expenseTab===expenseTab;
    button.classList.toggle('active',selected);
    button.setAttribute('aria-pressed',String(selected));
   });
  }
  window.donmacExpenseMenu?.sync?.();
  if(expenseTab==='payroll'){
   if(!entitlement)refreshStatus();else if(entitlement.enabled)loadTeam();
  }
 }
 function markAttendance(){
  const widget=$('dmAttendanceWidget');
  if(!widget)return;
  if(!user||user.role!=='User'||!entitlement?.enabled||!mobileViewport.matches){
   widget.hidden=true;return;
  }
  widget.hidden=false;
  const state=shift?.state||'not-in';
  const name={working:'Working / Clocked In',lunch:'Lunch Break',out:'Timed Out','not-in':'Not Clocked In'}[state]||state;
  $('dmAttendanceStatus').textContent=name;
  $('dmAttendanceInfo').textContent=shift?'Branch-linked attendance · '+shift.day:
   'Press Time In to begin your paid shift. POS login is not a Time In.';
  $('dmAttendanceWidget').querySelectorAll('[data-attendance-action]').forEach(b=>{
   const a=b.dataset.attendanceAction;
   b.disabled=!(state==='not-in'&&a==='time-in'||state==='working'&&(a==='lunch-start'||a==='time-out')||
    state==='lunch'&&a==='lunch-end'||state==='out'&&a==='continue');
  });
  const increment=state==='working'?Math.max(0,Math.floor((Date.now()-shiftReceivedAt)/60000)):0;
  $('dmAttendanceTimer').textContent=minuteText((shift?.paidWorkMinutes||0)+increment);
 }
 async function refreshStatus(){
  if(!user)return;
  const thisToken=token;
  try{
   const info=await api('/api/payroll/status');
   if(thisToken!==token)return;
   entitlement=info;
   shift=info.shift||null;shiftReceivedAt=Date.now();
   syncMobileAttendance();
   if(user.role==='Admin'){
    $('dmPayrollManager').hidden=expenseTab!=='payroll';
    $('dmPayrollLocked').hidden=info.enabled;
    $('dmPayrollPurchase').hidden=!info.canPurchase;
    $('dmPayrollApkPanel').hidden=!(info.enabled||info.addon?.fee>0);
    if(!$('dmPayrollApkPanel').hidden)void checkAttendanceApk();
    $('dmPayrollReady').hidden=!info.enabled;
    $('dmPayrollLockTitle').textContent=info.canPurchase?'Unlock Payroll & Attendance':'Payroll unavailable';
    $('dmPayrollLockText').textContent=info.message;
    if(info.enabled&&document.querySelector('#view-expenses.active'))loadTeam();
   }else markAttendance();
  }catch(error){
   if(thisToken===token){
    if(user.role==='Admin'){$('dmPayrollManager').hidden=expenseTab!=='payroll';$('dmPayrollLocked').hidden=false;
     $('dmPayrollLockText').textContent=error.message;}
    else if($('dmAttendanceMessage'))$('dmAttendanceMessage').textContent=error.message;
    entitlement=null;syncMobileAttendance();
   }
  }
 }
 async function takeAction(action){
  if(!user||user.role!=='User'||!entitlement?.enabled)return;
  const buttons=[...$('dmAttendanceWidget').querySelectorAll('[data-attendance-action]')];
  buttons.forEach(b=>b.disabled=true);
  $('dmAttendanceMessage').textContent='Recording '+action.replace(/-/g,' ')+'…';
  try{
   let result;
   try{result=await api('/api/payroll/attendance/'+action,'POST',{});}
   catch(error){
    if(action==='time-out'&&error.status===409 &&
       await window.donmacPrompt.confirm('Early Time Out warning: you have not completed the scheduled 9 AM–6 PM shift. Continue clocking out?'))
     result=await api('/api/payroll/attendance/time-out','POST',{confirmEarly:true});
    else throw error;
   }
   shift=result.shift;shiftReceivedAt=Date.now();
   $('dmAttendanceMessage').textContent='Attendance saved. Logging out of POS does not end your work shift.';
  }catch(error){$('dmAttendanceMessage').textContent=error.message;}
  markAttendance();
 }
 const statusName=state=>({
  working:'Working · Clocked In',lunch:'On Lunch Break',out:'Timed Out','not-in':'Not Clocked In'
 })[state]||state;
 function renderBranchRoster(){
  const root=$('dmPayrollRoster');
  if(!root)return;
  const openBranches=new Set([...root.querySelectorAll('details.dm-payroll-branch[open]')].map(el=>el.dataset.branch));
  const openStaff=new Set([...root.querySelectorAll('details.dm-payroll-staff[open]')].map(el=>el.dataset.employee));
  const filter=$('dmPayrollBranchFilter')?.value||'all';
  const allowed=filter==='all'?branches:branches.filter(b=>String(b.id)===filter);
  $('dmPayrollBranchCount').textContent=allowed.length+' branch(es) · '+employees.filter(e=>
   allowed.some(b=>b.id===e.branchId)).length+' cashiers';
  root.innerHTML=allowed.length?allowed.map(branch=>{
   const staff=employees.filter(e=>e.branchId===branch.id);
   const working=staff.filter(e=>e.status==='working').length;
   const lunch=staff.filter(e=>e.status==='lunch').length;
   const expanded=openBranches.has(String(branch.id))||filter!=='all';
   return '<details class="dm-payroll-branch" data-branch="'+branch.id+'" '+(expanded?'open':'')+'>'+
    '<summary><span class="dm-payroll-branch-icon" aria-hidden="true">▦</span><span><strong>'+esc(branch.name)+
    '</strong><small>'+(branch.active?'Active':'Inactive')+' branch · '+staff.length+' cashier(s)</small></span>'+
    '<span class="dm-payroll-branch-badges"><b>'+working+' working</b><b>'+lunch+' on lunch</b></span>'+
    '<span class="dm-payroll-branch-arrow" aria-hidden="true">⌄</span></summary>'+
    '<div class="dm-payroll-staff-list">'+(staff.length?staff.map(e=>{
     const expandedStaff=openStaff.has(String(e.id));
     return '<details class="dm-payroll-staff" data-employee="'+e.id+'" '+(expandedStaff?'open':'')+'>'+
      '<summary><span class="dm-payroll-staff-avatar" aria-hidden="true">'+esc(e.name.charAt(0).toUpperCase())+'</span>'+
      '<span class="dm-payroll-staff-name"><strong>'+esc(e.name)+'</strong><small>'+esc(e.active?'Active employee':'Inactive employee')+
      ' · '+esc(clock(e.clockIn))+' Time In</small></span>'+
      '<em class="dm-payroll-staff-status" data-state="'+esc(e.status)+'">'+esc(statusName(e.status))+'</em>'+
      '<span class="dm-payroll-staff-arrow" aria-hidden="true">⌄</span></summary>'+
      '<div class="dm-payroll-staff-history" data-employee-history="'+e.id+'">'+
       '<p class="dm-payroll-history-placeholder">Open this employee to view daily Time In, Lunch and Time Out.</p></div>'+
      '</details>';
    }).join(''):'<p class="dm-payroll-empty">No cashiers assigned to this branch yet.</p>')+'</div></details>';
  }).join(''):'<p class="dm-payroll-empty">No franchise branches available for this view.</p>';
  for(const staffId of openStaff){
   const target=root.querySelector('details.dm-payroll-staff[data-employee="'+staffId+'"][open]');
   if(target)loadEmployeeHistory(Number(staffId));
  }
 }
 async function loadEmployeeHistory(employeeId){
  const employee=employees.find(x=>x.id===employeeId);
  const panel=$('dmPayrollRoster')?.querySelector('[data-employee-history="'+employeeId+'"]');
  if(!employee||!panel)return;
  panel.textContent='Loading the past 30 days of this cashier’s time records…';
  const end=localDate(),start=new Date(Date.parse(end+'T00:00:00Z')-29*86400000).toISOString().slice(0,10);
  const key=token;
  try{
   const qs=new URLSearchParams({employeeId:String(employeeId),from:start,to:end});
   const r=await api('/api/payroll/records?'+qs);
   if(token!==key || !$('dmPayrollRoster')?.contains(panel))return;
   const days=r.days||[];
   panel.innerHTML='<div class="dm-payroll-staff-history-title"><strong>Daily time records · last 30 days</strong>'+
    '<button type="button" data-roster-preview="'+employeeId+'">Open Payroll / DTR Editor</button></div>'+
    (days.length?'<div class="dm-payroll-day-list">'+days.slice().reverse().map(d=>
      '<details class="dm-payroll-day"><summary><strong>'+esc(d.day)+'</strong><span>'+esc(statusName(d.state))+
      '</span><small>'+esc(minuteText(d.paidWorkMinutes))+' paid</small><span aria-hidden="true">⌄</span></summary>'+
      '<div class="dm-payroll-day-timeline">'+
      '<div><b>Time In</b><strong>'+esc(clock(d.clockIn))+'</strong></div>'+
      '<div><b>Lunch Start</b><strong>'+esc(clock(d.lunchStart))+'</strong></div>'+
      '<div><b>Lunch End</b><strong>'+esc(clock(d.lunchEnd))+'</strong></div>'+
      '<div><b>Time Out</b><strong>'+esc(clock(d.clockOut))+'</strong></div>'+
      '<div><b>Paid Work</b><strong>'+esc(minuteText(d.paidWorkMinutes))+'</strong></div>'+
      '<div><b>Lunch / Breaks</b><strong>'+esc(d.lunchMinutes)+' / '+esc(d.pausedMinutes)+' min</strong></div>'+
      '</div></details>').join('')+'</div>':
      '<p class="dm-payroll-empty">No shifts recorded during the last 30 days.</p>');
  }catch(error){if(token===key && $('dmPayrollRoster')?.contains(panel))panel.textContent=error.message;}
 }
 async function loadTeam(){
  if(!user||user.role!=='Admin'||!entitlement?.enabled||loadInProgress)return;
  const thisToken=token;loadInProgress=true;
  try{
   const result=await api('/api/payroll/team');
   if(thisToken!==token)return;
   employees=result.employees||[];
   branches=result.branches||[];
   $('dmPayrollToday').textContent='As of '+stamp(new Date());
   const filter=$('dmPayrollBranchFilter'),previousBranch=filter.value||'all';
   filter.innerHTML='<option value="all">All branches</option>'+
    branches.map(b=>'<option value="'+b.id+'">'+esc(b.name)+(b.active?'':' (inactive)')+'</option>').join('');
   filter.value=previousBranch==='all'||branches.some(b=>String(b.id)===previousBranch)?previousBranch:'all';
   renderBranchRoster();
   const selected=$('dmPayrollEmployee').value;
   $('dmPayrollEmployee').innerHTML=employees.map(e=>'<option value="'+e.id+'">'+esc(e.name)+
    ' · '+esc(e.branchName)+(e.active?'':' (Inactive)')+'</option>').join('');
   if(employees.some(x=>String(x.id)===selected))$('dmPayrollEmployee').value=selected;
   if(employees.length)await previewPayroll();
   const saved=await api('/api/payroll/slips');
   if(thisToken!==token)return;
   renderSaved(saved.slips||[]);
   const settings=await api('/api/payroll/settings');
   if(thisToken===token)$('dmPayrollNextNumber').value=settings.nextPayslipNo||46;
  }catch(error){message(error.message);}
  finally{loadInProgress=false;}
 }
 function settings(){return{
  employeeId:Number($('dmPayrollEmployee').value||0),year:Number($('dmPayrollYear').value),
  month:Number($('dmPayrollMonth').value),half:$('dmPayrollHalf').value};}
 async function previewPayroll(){
  const p=settings();
  if(!p.employeeId)return;
  const at=token;
  try{
   const query=new URLSearchParams(p);
   const result=await api('/api/payroll/preview?'+query);
   if(at!==token)return;
   previewData=result;
   $('dmPayrollRate').value=result.employee.dailyWage;
   $('dmPayrollSlipNumber').textContent='#'+(result.saved?.payslipNo||result.estimatedPayslipNo);
   $('dmPayrollSlipEmployee').value=result.saved?.employeeName||result.employee.name;
   $('dmPayrollPeriodLabel').value=result.saved?.periodLabel||result.period.label;
   $('dmPayrollPayDate').value=result.saved?.payDate||result.payDate;
   $('dmPayrollNotes').value=result.saved?.notes||'';
   $('dmPayrollStats').innerHTML=
    '<span><strong>'+result.completedDays+'</strong> Completed days</span>'+
    '<span><strong>'+result.openDays+'</strong> Pending time-outs</span>'+
    '<span><strong>'+result.lateMinutes+'</strong> Late minutes charged</span>'+
    '<span><strong>'+money(result.completedDays*result.employee.dailyWage)+'</strong> Basic gross</span>';
   const rows=result.days||[];
   $('dmPayrollDtr').innerHTML=rows.length?rows.map(x=>'<tr><td>'+esc(x.day)+'</td>'+
    '<td>'+esc(x.completed?'Completed':x.state)+'</td><td>'+esc(clock(x.clockIn))+'</td>'+
    '<td>'+esc(clock(x.lunchStart))+' – '+esc(clock(x.lunchEnd))+'</td><td>'+esc(clock(x.clockOut))+'</td>'+
    '<td>'+esc(minuteText(x.paidWorkMinutes||0))+'</td><td>'+esc(x.lateDeductedMinutes||0)+' min</td>'+
    '<td><button type="button" data-dtr-edit="'+esc(x.id)+'">Edit</button>'+
    (x.completed?'':' <button type="button" data-dtr-close="'+esc(x.id)+'">Admin Time Out</button>')+'</td></tr>').join(''):
    '<tr><td colspan="8">No attendance records in this cutoff.</td></tr>';
   showRows('dmPayrollEarnings',result.saved?.earnings||result.earnings);
   showRows('dmPayrollDeductions',result.saved?.deductions||result.deductions);
   savedSlip=result.saved;
   total();
   message(result.openDays?'Warning: '+result.openDays+' incomplete shift(s) excluded.':
    result.saved?'Saved payslip loaded. Saved figures are retained until you choose Recalculate from DTR.':
    'Payroll preview ready. Verify amounts before saving.',{silent:!result.openDays});
  }catch(error){message(error.message);}
 }
 function addRow(holder,row={}){
  const div=document.createElement('div');div.className='dm-payroll-row';
  const label=document.createElement('input');label.type='text';label.maxLength=100;label.placeholder='Particulars';
  label.value=row.label||'';
  const value=document.createElement('input');value.type='number';value.min='0';value.step='0.01';
  value.placeholder='0.00';value.value=Number(row.amount||0).toFixed(2);
  const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.title='Remove row';
  remove.onclick=()=>{div.remove();total();};
  [label,value].forEach(input=>input.addEventListener('input',total));
  div.append(label,value,remove);$(holder).appendChild(div);
 }
 function showRows(holder,rows){$(holder).replaceChildren();(rows||[]).forEach(r=>addRow(holder,r));}
 function rows(holder){return [...$(holder).querySelectorAll('.dm-payroll-row')].map(x=>({
  label:x.children[0].value.trim(),amount:Number(x.children[1].value||0)})).filter(x=>x.label||x.amount);}
 function total(){
  const amount=holder=>rows(holder).reduce((a,x)=>a+x.amount,0);
  $('dmPayrollNet').textContent=money(amount('dmPayrollEarnings')-amount('dmPayrollDeductions'));
 }
 async function saveSlip(){
  if(!previewData)return message('Preview an employee and cutoff first.');
  const body={...settings(),employeeName:$('dmPayrollSlipEmployee').value,periodLabel:$('dmPayrollPeriodLabel').value,
   payDate:$('dmPayrollPayDate').value,notes:$('dmPayrollNotes').value,
   earnings:rows('dmPayrollEarnings'),deductions:rows('dmPayrollDeductions')};
  $('dmPayrollSaveSlip').disabled=true;
  try{
   const result=await api('/api/payroll/slips','POST',body);
   savedSlip=result.slip;$('dmPayrollSlipNumber').textContent='#'+savedSlip.payslipNo;
   message('Payslip #'+savedSlip.payslipNo+' saved. Amounts and DTR source remain auditable.');
   const saved=await api('/api/payroll/slips');renderSaved(saved.slips||[]);
   const counter=await api('/api/payroll/settings');$('dmPayrollNextNumber').value=counter.nextPayslipNo;
  }catch(error){message(error.message);}
  finally{$('dmPayrollSaveSlip').disabled=false;}
 }
 function renderSaved(slips){
  $('dmPayrollSaved').innerHTML=slips.length?slips.map(x=>
   '<div class="dm-payroll-saved-row"><div><strong>#'+esc(x.payslipNo)+' · '+esc(x.employeeName)+
   '</strong><span>'+esc(x.periodFrom)+' – '+esc(x.periodTo)+' · '+money(x.netPay)+'</span></div>'+
   '<div><button type="button" data-slip-load="'+esc(x.id)+'">Open</button> '+
   '<button type="button" data-slip-delete="'+esc(x.id)+'">Delete</button></div></div>').join(''):
   '<p>No payslips saved yet.</p>';
  window.__donmacPayrollSavedList=slips;
 }
 async function savedAction(id,remove){
  const slip=(window.__donmacPayrollSavedList||[]).find(x=>x.id===id);if(!slip)return;
  if(remove){
   if(!await window.donmacPrompt.confirm('Delete payslip #'+slip.payslipNo+'? Audit history is preserved.'))return;
   try{await api('/api/payroll/slips/'+id,'DELETE');renderSaved((await api('/api/payroll/slips')).slips||[]);}
   catch(error){message(error.message);}return;
  }
  $('dmPayrollEmployee').value=String(slip.employeeId);
  $('dmPayrollYear').value=Number(slip.periodFrom.slice(0,4));
  $('dmPayrollMonth').value=Number(slip.periodFrom.slice(5,7));
  $('dmPayrollHalf').value=Number(slip.periodFrom.slice(8,10))===1?'first':'second';
  await previewPayroll();
  $('dmPayrollSlipPanel').scrollIntoView({block:'start',behavior:'smooth'});
 }
 function openDtr(id){
  const d=previewData?.days?.find(x=>x.id===id);if(!d)return;
  $('dmPayrollDtrId').value=d.id;
  $('dmPayrollDtrIn').value=localInput(d.clockIn);
  $('dmPayrollDtrOut').value=localInput(d.clockOut);
  $('dmPayrollDtrLunchStart').value=localInput(d.lunchStart);
  $('dmPayrollDtrLunchEnd').value=localInput(d.lunchEnd);
  $('dmPayrollDtrReason').value='';
  $('dmPayrollDtrDialog').showModal();
 }
 async function editDtr(event){
  event.preventDefault();
  const id=$('dmPayrollDtrId').value,body={
   clockIn:toISO($('dmPayrollDtrIn').value),clockOut:toISO($('dmPayrollDtrOut').value),
   lunchStart:toISO($('dmPayrollDtrLunchStart').value),lunchEnd:toISO($('dmPayrollDtrLunchEnd').value),
   reason:$('dmPayrollDtrReason').value};
  try{await api('/api/payroll/records/'+id,'PATCH',body);$('dmPayrollDtrDialog').close();await previewPayroll();await loadTeam();}
  catch(error){await window.donmacPrompt.notify(error.message,{variant:'error'});}
 }
 async function closeDtr(id){
  const reason=await window.donmacPrompt.input('Supervisor Time Out: enter a detailed reason (at least 5 characters).',{title:'Supervisor Time Out',inputLabel:'Reason for Time Out',minLength:5,confirmText:'Submit Reason'});
  if(!reason)return;
  try{await api('/api/payroll/records/'+id+'?action=close','POST',{reason});await previewPayroll();await loadTeam();}
  catch(error){message(error.message);}
 }
 function printSlip(){
  if(!savedSlip){message('Save the payslip before printing so it has an issued number.');return;}
  // Print only the persisted payslip, not unsaved edits from the live editor.
  const name=savedSlip.employeeName,period=savedSlip.periodLabel,
   payday=savedSlip.payDate,earn=savedSlip.earnings,ded=savedSlip.deductions,
   gross=Number(savedSlip.gross),deduct=Number(savedSlip.deductionTotal);
  const page=window.open('','_blank','width=850,height=980');
  if(!page){message('Allow pop-ups to print the payslip.');return;}
  const printTable=(title,items)=>'<h3>'+title+'</h3><table>'+
   items.map(x=>'<tr><td>'+esc(x.label)+'</td><td>'+money(x.amount)+'</td></tr>').join('')+'</table>';
  page.document.open();page.document.write('<!doctype html><html><head><title>Don Mac Payslip #'+savedSlip.payslipNo+
   '</title><style>body{font:14px Arial,sans-serif;max-width:760px;margin:40px auto;color:#173b28}header{border-bottom:3px solid #12643b;padding-bottom:12px}h1{font-size:25px}table{width:100%;border-collapse:collapse}td{padding:9px;border-bottom:1px solid #ddd}td:last-child{text-align:right}h3{margin-top:30px}.net{font-size:24px;font-weight:800;text-align:right;border-top:2px solid #12643b;padding:20px}p{line-height:1.5}button{margin:20px 0;background:#146438;border:0;border-radius:9px;padding:12px;color:white}@media print{button{display:none}}</style></head><body>'+
   '<header><h1>DON MACCHIATOS · PAYSLIP #'+savedSlip.payslipNo+'</h1><p><b>Employee:</b> '+esc(name)+
   '<br><b>Pay Period:</b> '+esc(period)+'<br><b>Pay Date:</b> '+esc(payday)+'</p></header>'+
   printTable('Earnings',earn)+printTable('Deductions',ded)+'<div class="net">Net Pay: '+money(gross-deduct)+'</div>'+
   '<p><b>Notes:</b> '+esc(savedSlip.notes||'—')+'</p>'+
   '<p>Prepared from the franchise payroll system. Verify against the saved Daily Time Record.</p>'+
   '<button onclick="window.print()">Print / Save PDF</button></body></html>');
  page.document.close();page.focus();
 }
 function onViewChange(view){
  if(user?.role==='User'){
   if(view==='attendance'){markAttendance();refreshStatus();}
   return;
  }
  if(user?.role!=='Admin')return;
  if(view==='payroll')switchExpenseTab('payroll',false);
  else if(view==='expenses')switchExpenseTab('ledger',false);
 }
 function onLogin(next){
  token++;user=next;reset();
  if(!next)return;
  if(next.role==='Admin'){
   $('dmExpenseTabs').hidden=false;
   $('dmPayrollTabs').hidden=false;
   switchExpenseTab('ledger',false);
  }
  refreshStatus();
 }
 function onLogout(){token++;user=null;reset();}
 const nowParts=manila();
 $('dmPayrollYear').value=nowParts.year;$('dmPayrollMonth').value=Number(nowParts.month);
 $('dmPayrollHalf').value=Number(nowParts.day)<=15?'first':'second';
 $('dmAttendanceWidget')?.addEventListener('click',e=>{
  const b=e.target.closest('[data-attendance-action]');if(b)takeAction(b.dataset.attendanceAction);
 });
 $('dmExpenseTabs').addEventListener('click',event=>{const button=event.target.closest('[data-expense-tab]');if(button)switchExpenseTab(button.dataset.expenseTab);});
 $('dmPayrollTabs').addEventListener('click',event=>{const button=event.target.closest('[data-expense-tab]');if(button)switchExpenseTab(button.dataset.expenseTab);});
 $('dmPayrollBranchFilter').addEventListener('change',renderBranchRoster);
 $('dmPayrollRoster').addEventListener('click',event=>{
  const previewButton=event.target.closest('[data-roster-preview]');
  if(previewButton){
   event.preventDefault();event.stopPropagation();
   $('dmPayrollEmployee').value=previewButton.dataset.rosterPreview;
   previewPayroll();
   $('dmPayrollSlipPanel')?.scrollIntoView({behavior:'smooth',block:'start'});
   return;
  }
  const header=event.target.closest('details.dm-payroll-staff > summary');
  if(!header)return;
  const detail=header.parentElement;
  if(!detail.open)setTimeout(()=>{if(detail.open)loadEmployeeHistory(Number(detail.dataset.employee));},0);
 });
 const attendanceApk='/downloads/donmac-attendance-test.apk';
 async function checkAttendanceApk(){
  const btn=$('dmPayrollApk'),note=$('dmPayrollApkPanel').querySelector('.muted');
  btn.disabled=true;
  try{
   const response=await fetch(attendanceApk,{method:'HEAD',cache:'no-store'});
   if(!response.ok||!response.headers.get('content-type')?.includes('application/vnd.android.package-archive'))throw Error('not ready');
   btn.disabled=false;note.textContent='Android test build · install only on authorized test devices.';
  }catch(_){note.textContent='Android APK is not published yet.';}
 }
 $('dmPayrollApk').onclick=()=>{if($('dmPayrollApk').disabled)return;const link=document.createElement('a');link.href=attendanceApk;link.download='donmac-attendance-test.apk';link.click();};
 $('dmPayrollPurchase').onclick=async()=>{
  const button=$('dmPayrollPurchase');if(button.disabled||!entitlement?.canPurchase)return;
  button.disabled=true;
  try{
   const yes=await window.donmacPrompt.confirm('Add Payroll & Attendance for ₱1,000 to your next subscription payment? If you are on an active trial, payroll and attendance unlock immediately. The ₱1,000 fee is included in your next subscription payment. If the add-on is not paid at renewal, payroll access will be locked. Do you want to proceed?');
   if(!yes)return;
   await api('/api/payroll/addon/purchase','POST',{});
   await refreshStatus();
   message(entitlement?.enabled?'Payroll & Attendance is now active. The ₱1,000 add-on will be included in your next payment.':'Payroll add-on added to your next payment. Access unlocks after payment approval.');
  }catch(error){message(error.message);}finally{button.disabled=false;}
 };
 $('dmPayrollRefresh').onclick=()=>{refreshStatus();if(entitlement?.enabled)loadTeam();};
 $('dmPayrollPreview').onclick=previewPayroll;
 for(const id of ['dmPayrollEmployee','dmPayrollYear','dmPayrollMonth','dmPayrollHalf'])
  $(id).addEventListener('change',previewPayroll);
 $('dmPayrollRateSave').onclick=async()=>{
  try{await api('/api/payroll/rate','POST',{employeeId:Number($('dmPayrollEmployee').value),
   dailyWage:Number($('dmPayrollRate').value)});await previewPayroll();message('Daily pay rate updated.');}
  catch(error){message(error.message);}
 };
 $('dmPayrollAddEarning').onclick=()=>addRow('dmPayrollEarnings');
 $('dmPayrollAddDeduction').onclick=()=>addRow('dmPayrollDeductions');
 $('dmPayrollRecalculate').onclick=async()=>{
  if(!previewData)return;
  if(!await window.donmacPrompt.confirm('Replace the unsaved earnings and deductions in the editor with the current DTR calculation?'))return;
  showRows('dmPayrollEarnings',previewData.earnings);
  showRows('dmPayrollDeductions',previewData.deductions);total();message('Recalculated from DTR. Save to update the payslip.');
 };
 $('dmPayrollSaveSlip').onclick=saveSlip;$('dmPayrollPrintSlip').onclick=printSlip;
 $('dmPayrollSaveNext').onclick=async()=>{
  try{const d=await api('/api/payroll/settings','PUT',{nextPayslipNo:Number($('dmPayrollNextNumber').value)});
   $('dmPayrollNextNumber').value=d.nextPayslipNo;message('Payslip numbering updated.');}
  catch(error){message(error.message);}
 };
 $('dmPayrollSaved').addEventListener('click',e=>{
  const load=e.target.closest('[data-slip-load]'),del=e.target.closest('[data-slip-delete]');
  if(load)savedAction(load.dataset.slipLoad,false);if(del)savedAction(del.dataset.slipDelete,true);
 });
 $('dmPayrollDtr').addEventListener('click',e=>{
  const edit=e.target.closest('[data-dtr-edit]'),close=e.target.closest('[data-dtr-close]');
  if(edit)openDtr(edit.dataset.dtrEdit);if(close)closeDtr(close.dataset.dtrClose);
 });
 $('dmPayrollDtrCancel').onclick=()=>$('dmPayrollDtrDialog').close();
 $('dmPayrollDtrForm').onsubmit=editDtr;
 mobileViewport.addEventListener?.('change',()=>{
  syncMobileAttendance();
  markAttendance();
 });
 setInterval(()=>{if(user?.role==='User'&&entitlement?.enabled&&
  document.querySelector('#view-attendance.active'))markAttendance();},1000);
 setInterval(()=>{if(user&&document.visibilityState==='visible')refreshStatus();},60000);
 window.donmacPayroll={onLogin,onLogout,onViewChange,refreshStatus,
  open(tab){if(user?.role==='Admin')switchExpenseTab(tab);},
  currentTab(){return expenseTab;},
  loadRoster(){if(user?.role==='Admin'&&entitlement?.enabled)loadTeam();}};
})();
