'use strict';
// Owner-only chart defaults scoped to the signed-in franchise and owner user.
// Cashier dashboard permissions do NOT grant settings access.
const TYPES=['line','bar','pie'];
const CARDS=['revenue','orders','today','month','expenses','deposited','discount','alerts'];
const empty=()=>({defaultType:'line',overrides:{}});
const key=(workspaceId,userId)=>'dashboard_drilldown_charts_v1_'+Number(workspaceId)+'_'+Number(userId);
function validate(body){
 if(!body||typeof body!=='object'||Array.isArray(body)||!TYPES.includes(body.defaultType))
  throw Object.assign(new Error('Choose Line, Bar, or Pie as the default chart.'),{status:400});
 const overrides=body.overrides==null?{}:body.overrides;
 if(!overrides||typeof overrides!=='object'||Array.isArray(overrides))
  throw Object.assign(new Error('Invalid per-category chart preferences.'),{status:400});
 const saved={defaultType:body.defaultType,overrides:{}};
 for(const [name,type] of Object.entries(overrides)){
  if(!CARDS.includes(name)||!TYPES.includes(type))
   throw Object.assign(new Error('Unknown dashboard category or chart type.'),{status:400});
  saved.overrides[name]=type;
 }
 return saved;
}
async function settings(db,{workspaceId,userId,admin},body){
 if(!admin)throw Object.assign(new Error('Dashboard display settings are Owner/Admin-only.'),{status:403});
 if(!Number.isSafeInteger(Number(workspaceId))||Number(workspaceId)<1||
  !Number.isSafeInteger(Number(userId))||Number(userId)<1)
  throw Object.assign(new Error('Cannot resolve the signed-in workspace and owner.'),{status:403});
 const settingKey=key(workspaceId,userId);
 if(body!==undefined){
  const normalized=validate(body);
  await db.query('INSERT INTO app_settings(setting_key,setting_value,updated_at) VALUES($1,$2,$3) '+
   'ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_at=excluded.updated_at',
   [settingKey,JSON.stringify(normalized),new Date().toISOString()]);
  return normalized;
 }
 const stored=(await db.query('SELECT setting_value FROM app_settings WHERE setting_key=$1',
  [settingKey])).rows[0];
 if(!stored)return empty();
 try{return validate(JSON.parse(stored.setting_value))}
 catch(_){return empty()}
}
module.exports={settings,validate,empty,TYPES,CARDS,key};
