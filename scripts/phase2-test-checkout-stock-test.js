'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const page=fs.readFileSync('public/phase2-test.js','utf8');
const branch=fs.readFileSync('lib/branch-catalog-read.js','utf8');
const html=fs.readFileSync('public/phase2-test.html','utf8');
const css=fs.readFileSync('public/phase2-test.css','utf8');
const start=page.indexOf(' let currentProducts=[];'),end=page.indexOf(' async function api(',start);
assert(start>0&&end>start,'Phase 2 capacity helper must be implemented in the test portal');
const fields={
 saleProduct:{value:'1',title:''},
 saleQuantity:{value:'1',disabled:false,max:'25'},
 saleStockWarning:{textContent:'',className:''}
};
const submit={disabled:false,title:''};
fields.saleForm={querySelector:()=>submit};
const helpers=vm.runInNewContext('(function(){'+page.slice(start,end)+
 '\nreturn{productCapacity,setProducts:products=>{currentProducts=products;},syncSaleCapacity};})()',
 {$:id=>fields[id],Number,Math,Intl});
const recipe=(id,required,current,threshold=0,active=true)=>({
 ingredientId:id,code:'ING'+id,name:'Ingredient '+id,required,current,threshold,active,uom:'KG'
});
const product=(id,...recipeStock)=>({id,recipeConfigured:true,recipeStock});

let x=helpers.productCapacity(product(1,recipe(1,.5,0)));
assert.equal(x.max,0);
assert.match(x.warning,/OUT OF STOCK/);
helpers.setProducts([product(1,recipe(1,.5,0))]);
x=helpers.syncSaleCapacity();
assert.equal(x.max,0);
assert.equal(submit.disabled,true,'Simulator checkout button disables on stock exhaustion');
assert.equal(fields.saleQuantity.disabled,true);
assert.match(fields.saleStockWarning.textContent,/OUT OF STOCK/);

helpers.setProducts([product(1,recipe(1,.5,.9))]);
fields.saleQuantity.value='4';
x=helpers.syncSaleCapacity();
assert.equal(x.max,1);
assert.equal(x.low,true);
assert.equal(submit.disabled,false);
assert.equal(fields.saleQuantity.disabled,false);
assert.equal(fields.saleQuantity.value,'1','Input quantity automatically clamps to available ingredient quantity');
assert.equal(fields.saleQuantity.max,'1');
assert.match(fields.saleStockWarning.className,/warning/);

helpers.setProducts([product(1,recipe(1,.5,2),recipe(2,.2,.55))]);
fields.saleQuantity.value='2';
x=helpers.syncSaleCapacity();
assert.equal(x.max,2,'Maximum quantity is limited by the scarcest ingredient');
assert.equal(submit.disabled,false);

helpers.setProducts([product(1,recipe(1,.5,0))]);
x=helpers.syncSaleCapacity();
assert.equal(x.allowed,false);
assert.equal(submit.disabled,true,'After last sale, resync cannot re-enable submit');

helpers.setProducts([product(1,recipe(1,.001,200))]);
fields.saleQuantity.value='25';
x=helpers.syncSaleCapacity();
assert.equal(x.max,25,'Test portal retains its transaction size limit of 25');

helpers.setProducts([{id:1,recipeConfigured:false,recipeStock:[]}]);
x=helpers.syncSaleCapacity();
assert.equal(x.max,0,'A new product with no recipe cannot be sold');

helpers.setProducts([product(1,recipe(1,.5,20,0,false))]);
x=helpers.syncSaleCapacity();
assert.equal(x.max,0,'Inactive ingredient disables test checkout');

helpers.setProducts([product(1,recipe(1,.1,1.5))]);
fields.saleQuantity.value='1';x=helpers.syncSaleCapacity();assert.equal(x.max,15);
helpers.setProducts([product(1,recipe(1,.1,0))]);
x=helpers.syncSaleCapacity();assert.equal(x.max,0,'Tenant-specific product recipe stock never persists across reloads');

assert.match(branch,/recipeStock:recipes\.map/);
assert.match(branch,/ingredientId:number\(r\.ingredient_id\)/);
assert(page.includes("$('saleProduct').addEventListener('change',syncSaleCapacity)"));
assert(page.includes("$('saleQuantity').addEventListener('input',syncSaleCapacity)"));
assert.match(page,/if\(form\.id==='saleForm'\)syncSaleCapacity\(\);else submit\.disabled=false/);
assert.match(page,/if\(e\.status===409\)await load\(\)/);
assert.match(html,/id="saleStockWarning"/);
assert.match(html,/phase2-test\.js\?v=3/);
assert.match(css,/\.sale-stock-warning\.danger/);
console.log('PASS: Phase 2 new-product low-stock warning, quantity cap, no-recipe disabled, sold-out submit locked, cross-account stock reset.');
