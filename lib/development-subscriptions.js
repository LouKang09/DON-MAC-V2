'use strict';
// A development-only plan switch for this single-merchant POS.
// No payment gateway, invoices, or real entitlement verification exists yet.
const KEY='development_subscription_v1';
const PLANS=Object.freeze(['PRO','BUSINESS']);
const STATUSES=Object.freeze(['PAID','ON_HOLD','UNPAID']);

function nextRenewAt(iso){
  const d=new Date(iso);
  if(Number.isNaN(d.getTime()))throw Error('Invalid subscription start');
  const day=d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth()+1);
  const maxDay=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();
  d.setUTCDate(Math.min(day,maxDay));
  return d.toISOString();
}
function entry(plan,status,startedAt,actorId=null){
  return {date:startedAt,plan,startDate:startedAt,renewDate:nextRenewAt(startedAt),status,actorId};
}
function initial(now=new Date().toISOString()){
  return {
    plan:'PRO',status:'PAID',startedAt:now,renewAt:nextRenewAt(now),
    developmentMode:true,history:[entry('PRO','PAID',now)]
  };
}
// The development preview must be event-driven, never a daily ledger.
// Remove repeated synthetic snapshots while retaining genuine plan/status
// changes and any future identified billing/renewal events.
function normalizeHistory(rows){
  if(!Array.isArray(rows))return [];
  const clean=[];
  for(const item of rows){
    if(!item||typeof item!=='object'||!PLANS.includes(item.plan)||
       !STATUSES.includes(item.status))continue;
    const date=String(item.date||'');
    if(!Number.isFinite(Date.parse(date)))continue;
    const record={...item};
    const previous=clean[clean.length-1];
    if(previous && !record.eventId && !record.billingEventId &&
       !previous.eventId && !previous.billingEventId &&
       previous.plan===record.plan && previous.status===record.status){
      const samePeriod=previous.startDate===record.startDate &&
        previous.renewDate===record.renewDate;
      const repeatedAutomaticBaseline=(previous.actorId==null &&
        record.actorId==null && previous.eventType==null && record.eventType==null);
      if(samePeriod||repeatedAutomaticBaseline)continue;
    }
    clean.push(record);
  }
  return clean.slice(-500);
}
function parse(raw){
  if(!raw)return null;
  try{
    const s=JSON.parse(raw);
    if(!PLANS.includes(s.plan)||!STATUSES.includes(s.status)||
       !Array.isArray(s.history)||Number.isNaN(new Date(s.startedAt).getTime())||
       Number.isNaN(new Date(s.renewAt).getTime()))return null;
    return {...s,history:normalizeHistory(s.history),developmentMode:true};
  }catch(_){return null;}
}
function transition(previous,plan,status,actorId,now=new Date().toISOString()){
  if(!PLANS.includes(plan))throw Object.assign(new Error('Select a valid Pro or Business plan.'),{status:400});
  if(!STATUSES.includes(status))throw Object.assign(new Error('Select a valid demo subscription status.'),{status:400});
  const prior=previous||initial(now);
  if(prior.plan===plan&&prior.status===status)return prior;
  const changed=prior.plan!==plan;
  const startedAt=changed?now:prior.startedAt;
  const renewAt=changed?nextRenewAt(now):prior.renewAt;
  const history=normalizeHistory(prior.history).slice(-499);
  history.push({date:now,plan,startDate:startedAt,renewDate:renewAt,status,actorId});
  return {plan,status,startedAt,renewAt,developmentMode:true,history};
}
function entitlements(plan){
  return {replenish:true,transfer:plan==='BUSINESS',advancedInventory:plan==='BUSINESS'};
}
function remainingDays(renewAt,now=new Date().toISOString()){
  const delta=new Date(renewAt).getTime()-new Date(now).getTime();
  return Number.isFinite(delta)?Math.max(0,Math.ceil(delta/86400000)):0;
}
module.exports={KEY,PLANS,STATUSES,initial,parse,transition,normalizeHistory,entitlements,remainingDays,nextRenewAt};
