'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const stock=require('../public/pos-stock-limit-v20261114.js');
const row=(ingredientId,required,current,threshold=0,active=true,name='Coffee Beans')=>({
 ingredientId,required,current,threshold,active,name,code:'ING-'+ingredientId,uom:'KG'
});
const p=(id,name,recipeStock)=>({id,name,category:'Coffee',available:true,
 recipeConfigured:true,recipeStock,stockWarnings:[],availabilityDetails:[]});
const cats=(products,packages=[])=>({products,packages});
const one=cats([p(1,'New product test1',[row(9,.5,1.2,.7)]),
 p(2,'Other product same beans',[row(9,.7,1.2,.7)]),
 p(3,'Sugar latte',[row(10,.25,.5,.1,true,'Sugar')])],
 [{id:7,name:'Coffee package',sellable:true,available:true,
 recipeStock:[row(9,.75,1.2,.7)]}]);
const chosen=[];
assert.equal(stock.next(one,chosen,'product',1).ok,true);
assert.equal(stock.next(one,[{kind:'product',id:1,qty:1}],'product',1).ok,true,
 'Two units should fit 1.2 kg');
const full=stock.next(one,[{kind:'product',id:1,qty:2}],'product',1);
assert.equal(full.ok,false,'Third unit would require 1.5kg');
assert.equal(full.shortages[0].ingredientId,9);
assert.match(full.message,/Coffee Beans.*1.5/);
assert.equal(stock.lowFor(one,[{kind:'product',id:1,qty:1}],'product',1).low.length,1,
 'Show low-stock warning while there is still one last unit available');
assert.equal(stock.lowFor(one,[{kind:'product',id:1,qty:1}],'product',1).lastUnit,true);
const conflict=stock.next(one,[{kind:'product',id:1,qty:1}],'product',2);
assert.equal(conflict.ok,true,'0.5 + 0.7 equals available stock');
assert.equal(stock.next(one,[{kind:'product',id:1,qty:2}],'product',2).ok,false,
 'Shared ingredient is allocated across different cart products');
assert.equal(stock.next(one,[{kind:'package',id:7,qty:1}],'product',1).ok,false,
 'Package ingredient usage shares the same cart stock budget');
assert.equal(stock.next(one,[{kind:'product',id:1,qty:1}],'package',7).ok,false);
assert.equal(stock.next(one,[{kind:'product',id:1,qty:1}],'product',3).ok,true,
 'Unrelated ingredients may still be sold');
assert.equal(stock.next(one,[], 'addon',99).ok,true);
assert.equal(stock.evaluate(one,[{kind:'product',id:1,qty:0}]).ok,false);
assert.equal(stock.next(cats([p(1,'Just added',[row(9,.2,0)])]),[],'product',1).ok,false,
 'Zero-stock newly created product must be disabled');
assert.equal(stock.next(cats([p(1,'Inactive ingredient',[row(9,.2,20,0,false)])]),[],'product',1).ok,false);
assert.match(stock.next(cats([{id:1,name:'No recipe',available:false,recipeConfigured:false,recipeStock:[]}]),[],'product',1).message,/needs a recipe/);
assert.equal(stock.next(cats([], [{id:7,name:'Unconfigured package',sellable:false,available:false}]),[],'package',7).ok,false);
const accountOther=cats([p(1,'Same product name',[row(9,.5,0)])]);
assert.equal(stock.next(accountOther,[], 'product',1).ok,false);
assert.equal(stock.next(one,[], 'product',1).ok,true,'No module-global stock is shared between tenants');

const code=fs.readFileSync('public/app-core.js','utf8');
const server=fs.readFileSync('server.js','utf8');
const loader=fs.readFileSync('public/app.js','utf8');
const index=fs.readFileSync('public/index.html','utf8');
assert.match(loader,/loadScript\('\/pos-stock-limit-v20261114\.js'\)/);
assert.match(index,/app\.js\?v=1\.6\.06/);
assert.match(code,/const stockPlanner=window\.donmacPosStock/);
assert.match(code,/decision=stockPlanner\.lowFor/);
assert.match(code,/const decision=stockNext\('package',id\)/);
assert.match(code,/const decision=stockNext\('product',id\)/);
assert.match(code,/data-plus=.*full\?'disabled'/s);
assert.match(code,/const stock=cartStock\(\);if\(!stock\.ok\)/);
assert.match(code,/renderCatalog\(\);renderOrder\(\);if\(state\.cart\.length\)/);
assert.match(server,/recipeStock=rec\.map/);
assert.match(server,/recipeStock:\[\.\.\.req\.values\(\)\]/);
assert.match(server,/await marlouCheckoutStockBridge\.previewSale\(conn/);
assert.match(server,/Math\.min\(Number\(r\.stock_qty\),Number\(own\.stock_qty\)\)/);
assert.match(server,/user\.role==='User'\?Number\(user\.branchId\|\|0\):0/);
console.log('PASS: new-product zero/low stock, last-unit cap, shared ingredients, package overlap, tenant separation and UI pre-checkout warning.');
