'use strict';
const assert=require('node:assert/strict');
const resend=require('../lib/resend-otp');
const oldSend=resend.sendFranchiseOtp,oldApi=process.env.RESEND_API_KEY;
process.env.RESEND_API_KEY='testing-only-not-live';
const delivered=[];
resend.sendFranchiseOtp=async details=>{delivered.push(details);return{ok:true,provider:'test'}};
const mail=require('../lib/franchise-email-verification');
const staging=require('../lib/franchise-tenant-staging');
const appId='62e6de51-1568-4707-9001-d087ccc205a1';
const appId2='62e6de51-1568-4707-9001-d087ccc205a2';
const rows=[
 {id:appId,email:'newowner@example.com',full_name:'First Owner',status:'CONTACTED',email_verified_at:null,
  verification_hash:null,verification_expires_at:null,verification_sent_at:null,verification_attempts:0},
 {id:appId2,email:'other@example.com',full_name:'Second Owner',status:'CONTACTED',email_verified_at:'2026-11-08T00:00:00Z',
  verification_hash:null,verification_expires_at:null,verification_sent_at:null,verification_attempts:0}
];
// Model the verified, versioned starter-template snapshot used by current provisioning.
const verifiedStarterTemplate={
 version:2,
 products:[
  {sourceId:11,sku:'COFFEE-A',name:'Coffee A',category:'Coffee',price:89,imageData:null,active:true},
  {sourceId:12,sku:'COLD-LATTE',name:'Cold Latte',category:'Non Coffee',price:110,imageData:null,active:true}
 ],
 ingredients:[{sourceId:99,code:'BEANS',name:'Coffee Beans',uom:'kg',threshold:2,active:true}],
 recipes:[{sourceProductId:11,sourceIngredientId:99,quantityRequired:.01,costContribution:4}],
 categories:[{name:'Coffee',iconData:null,sortOrder:1,builtin:true,active:true},
             {name:'Non Coffee',iconData:null,sortOrder:2,builtin:true,active:true}],
 categoryProducts:[{categoryName:'Coffee',sourceProductId:11},{categoryName:'Non Coffee',sourceProductId:12}],
 addOns:[{sourceId:22,name:'Extra Pearl',price:10,excludeFromCosting:true,active:true}],
 promos:[],packages:[],packageItems:[]
};
const stages=[],products=[],ingredients=[],recipes=[],addOns=[],writes=[],schema=[];
const db={
 engine:'postgres',
 async exec(sql){schema.push(sql)},
 async transaction(fn){return fn(db)},
 async query(sql,p=[]){
  if(sql.startsWith('SELECT id,source_workspace_id,source_branch_id,template_json,checksum_sha256 ')){
    return{rows:[{id:1,source_workspace_id:100,source_branch_id:null,
      template_json:JSON.stringify(verifiedStarterTemplate),checksum_sha256:null}]};
  }
  if(sql.startsWith('SELECT id,email,full_name,status,email_verified_at'))return{rows:rows.filter(x=>x.email===p[0]&&['PENDING','CONTACTED'].includes(x.status)).slice(-1)};
  if(sql.startsWith('UPDATE public_franchise_requests SET verification_hash=')){
   const x=rows.find(a=>a.id===p[3]);
   if(!x||x.email_verified_at||x.verification_sent_at&&Date.parse(x.verification_sent_at)>Date.parse(p[4]))return{rows:[]};
   [x.verification_hash,x.verification_expires_at,x.verification_sent_at]=p.slice(0,3);x.verification_attempts=0;return{rows:[{id:x.id}]};
  }
  if(sql.startsWith('UPDATE public_franchise_requests SET verification_attempts=verification_attempts+1')){
   const x=rows.find(a=>a.id===p[0]);
   if(!x||x.verification_hash!==p[1]||x.verification_attempts>=5)return{rows:[]};
   x.verification_attempts++;return{rows:[{verification_attempts:x.verification_attempts}]};
  }
  if(sql.startsWith('UPDATE public_franchise_requests SET email_verified_at=')){
   const x=rows.find(a=>a.id===p[1]);
   if(!x||x.verification_hash!==p[2]||x.email_verified_at)return{rows:[]};
   x.email_verified_at=p[0];x.verification_hash=null;x.verification_expires_at=null;x.verification_sent_at=null;return{rows:[{id:x.id}]};
  }
  if(sql.startsWith('UPDATE public_franchise_requests SET verification_hash=NULL,'))return{rows:[]};
  if(sql.startsWith('SELECT id,status,email_verified_at FROM public_franchise_requests'))return{rows:rows.filter(x=>x.id===p[0])};
  if(sql.startsWith('SELECT request_id,workspace_key,template_version,stage_status,'))return{rows:stages.filter(x=>x.request_id===p[0])};
  if(sql.startsWith('SELECT COUNT(*) AS n FROM franchise_staged_')){
   const collection=sql.includes('franchise_staged_products')?products:sql.includes('franchise_staged_ingredients')?ingredients:sql.includes('franchise_staged_recipes')?recipes:addOns;
   return{rows:[{n:collection.filter(x=>x.request_id===p[0]).length}]};
  }
  if(sql.startsWith('SELECT COALESCE(SUM(stock_qty),0)'))return{rows:[{qty:ingredients.filter(x=>x.request_id===p[0]).reduce((n,x)=>n+x.stock_qty,0)}]};
  if(sql.startsWith('SELECT id,name,category,price,image_data,active FROM products'))return{rows:[
   {id:11,name:'Coffee A',category:'Coffee',price:89,image_data:null,active:true},
   {id:12,name:'Cold Latte',category:'Non Coffee',price:110,image_data:null,active:true}]};
  if(sql.startsWith('SELECT id,name,price,exclude_from_costing,active FROM add_ons'))return{rows:[{id:22,name:'Extra Pearl',price:10,exclude_from_costing:true,active:true}]};
  if(sql.startsWith('SELECT pi.product_id,i.id AS ingredient_id'))return{rows:[
   {product_id:11,ingredient_id:99,code:'BEANS',display_name:'Coffee Beans',uom:'kg',
    low_stock_threshold:2,quantity_required:.01,cost_contribution:4}]};
  if(sql.startsWith('INSERT INTO franchise_provisioning_stages(')){
   if(stages.some(x=>x.request_id===p[0]))return{rows:[]};
   stages.push({request_id:p[0],workspace_key:p[1],template_version:p[2],stage_status:p[3],
     created_at:p[4],created_by:p[5]});writes.push(sql);return{rows:[{request_id:p[0]}]};
  }
  if(sql.startsWith('INSERT INTO franchise_staged_products(')){
   products.push({id:p[0],request_id:p[1],source_product_id:p[2],sku:p[3],name:p[4],price:p[6]});writes.push(sql);return{rows:[]};
  }
  if(sql.startsWith('INSERT INTO franchise_staged_ingredients(')){
   ingredients.push({id:p[0],request_id:p[1],code:p[3],stock_qty:p[6]});writes.push(sql);return{rows:[]};
  }
  if(sql.startsWith('INSERT INTO franchise_staged_recipes(')){
   recipes.push({request_id:p[0],product_id:p[1],ingredient_id:p[2],qty:p[3]});writes.push(sql);return{rows:[]};
  }
  if(sql.startsWith('INSERT INTO franchise_staged_addons(')){
   addOns.push({id:p[0],request_id:p[1],name:p[3]});writes.push(sql);return{rows:[]};
  }
  throw Error('Unexpected SQL: '+sql.slice(0,150));
 }
};
(async()=>{
 await mail.migrate(db);await staging.migrate(db);
 assert(schema.some(x=>x.includes('email_verified_at')));
 assert(schema.some(x=>x.includes('franchise_staged_products')));
 let unverifiedRejected=false;try{
  await staging.prepare(db,appId,{confirmation:'APPROVE STARTER CATALOG'},'Admin Control');
 }catch(e){unverifiedRejected=e.status===409}
 assert(unverifiedRejected,'Unverified requests cannot receive staged catalog');
 const sent=await mail.requestCode(db,'newowner@example.com');
 assert.equal(sent.sent,true);
 assert.equal(delivered.length,1);
 assert(/^[0-9]{6}$/.test(delivered[0].code));
 assert(!rows[0].verification_hash.includes(delivered[0].code));
 await mail.requestCode(db,'newowner@example.com');
 assert.equal(delivered.length,1,'Resend throttled to one minute');
 await assert.rejects(mail.verify(db,'newowner@example.com','1234567'));
 const confirmed=await mail.verify(db,'newowner@example.com',delivered[0].code);
 assert.equal(confirmed.verified,true);
 assert(rows[0].email_verified_at);
 assert.equal(rows[0].verification_hash,null,'Used code deleted');
 const template=await staging.preview(db);
 assert.equal(template.counts.coffee,1);
 assert.equal(template.counts.ingredients,1);
 await assert.rejects(staging.prepare(db,appId,{confirmation:'NO'},'Admin Control'));
 const first=await staging.prepare(db,appId,{confirmation:'APPROVE STARTER CATALOG'},'Admin Control');
 assert(first.prepared);
 assert.equal(first.openingStock,0);
 assert.equal(first.loginEnabled,false);
 assert.equal(first.counts.products,2);
 assert.equal(first.counts.ingredients,1);
 assert.equal(first.counts.recipes,1);
 assert.equal(first.counts.addOns,1);
 const again=await staging.prepare(db,appId,{confirmation:'APPROVE STARTER CATALOG'},'Admin Control');
 assert.equal(again.newlyPrepared,undefined,'Idempotent staging does not duplicate');
 await staging.prepare(db,appId2,{confirmation:'APPROVE STARTER CATALOG'},'Admin Control');
 assert.equal(stages.length,2);
 assert.equal(products.length,4);
 assert.notEqual(stages[0].workspace_key,stages[1].workspace_key);
 assert.notEqual(products[0].id,products[2].id,'Independent product IDs');
 assert(ingredients.every(x=>x.stock_qty===0),'Every new workspace starts with zero stock');
 assert(writes.every(x=>!/(INSERT INTO users|INSERT INTO sales|INSERT INTO sessions|INSERT INTO inventory_movements)/i.test(x)),
  'Staging never creates logins, sales or historical stock');
 console.log('Franchise OTP verification, distinct isolated starter catalogs, zero-stock and no-login checks passed.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{
 resend.sendFranchiseOtp=oldSend;
 if(oldApi==null)delete process.env.RESEND_API_KEY;else process.env.RESEND_API_KEY=oldApi;
});
