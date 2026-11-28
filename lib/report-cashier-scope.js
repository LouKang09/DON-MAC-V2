'use strict';
// Report selections are authenticated workspace member IDs, never a client user ID.
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
function parse(query){
 const raw=query.get('cashiers');let names=[];
 if(raw){try{names=JSON.parse(raw)}catch{throw fail('Invalid cashier selection.');}}
 else if(query.get('cashier'))names=[query.get('cashier')];
 if(!Array.isArray(names)||names.length>200||names.some(x=>typeof x!=='string'||!x.trim()||x.length>150))throw fail('Choose up to 200 valid cashiers.');
 return [...new Set(names.map(x=>x.trim().toLowerCase()))];
}
async function resolve(db,ctx,names=[]){
 if(!ctx.admin){const id=Number(ctx.userId);if(!Number.isSafeInteger(id)||id<1)throw fail('Invalid authenticated cashier.',403);return [id];}
 if(!names.length)return null;
 const args=[ctx.workspaceId,...names];
 const marks=names.map((_,i)=>'$'+(i+2)).join(',');
 const rows=(await db.query("SELECT DISTINCT u.id,LOWER(u.username) AS name FROM users u JOIN chat_memberships m ON m.user_id=u.id WHERE m.workspace_id=$1 AND u.role='User' AND LOWER(u.username) IN ("+marks+")",args)).rows;
 const found=new Set(rows.map(x=>String(x.name)));
 if(names.some(n=>!found.has(n)))throw fail('One or more selected cashiers are no longer available in this franchise. Refresh the cashier list.',403);
 return [...new Set(rows.map(x=>Number(x.id)))];
}
// null = unrestricted owner; [] = no matching records, never unrestricted.
function clause(column,args,ids){
 if(ids==null)return '';
 const list=Array.isArray(ids)?ids:[ids];
 if(!list.length)return ' AND 1=0';
 if(list.some(x=>!Number.isSafeInteger(Number(x))||Number(x)<1))throw fail('Invalid cashier scope.',403);
 if(list.length===1){args.push(Number(list[0]));return ' AND '+column+'=$'+args.length;}
 const marks=list.map(x=>{args.push(Number(x));return '$'+args.length;});
 return ' AND '+column+' IN ('+marks.join(',')+')';
}
module.exports={parse,resolve,clause};
