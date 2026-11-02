'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const read=path=>fs.readFileSync(path,'utf8');
const html=read('public/index.html');
const css=read('public/catalog-icons-packages-v1545.css');
const loader=read('public/app.js');
const server=read('server.js');

const tabs={
 products:'products.png', categories:'categories.png', ingredients:'ingredients.png',
 recipes:'recipes.png',promos:'promos.png',packages:'packages.png',backups:'backups.png'
};
const assetDir='public/assets/catalog';
for(const [key,filename] of Object.entries({...tabs,save:'save.png',question:'question.png'})){
 const file=path.join(assetDir,filename);
 assert(fs.existsSync(file),'Missing user-supplied image '+file);
 const buf=fs.readFileSync(file);
 assert(buf.length>200,'Icon missing PNG data: '+file);
 assert.equal(buf.subarray(0,8).toString('hex'),'89504e470d0a1a0a','Invalid PNG: '+file);
 const w=buf.readUInt32BE(16),h=buf.readUInt32BE(20);
 assert(w>=40 && h>=40,'Insufficient icon resolution: '+file);
}
const matchTabs=html.match(/<div class="admin-tabs" id="adminTabs">([\s\S]*?)<\/div>/);
assert(matchTabs,'POS Catalog tabs missing');
for(const [kind,filename] of Object.entries(tabs)){
 const re=new RegExp('<button[^>]+data-admin-tab="'+kind+'"[^>]*>\\s*<img[^>]+src="/assets/catalog/'+filename.replace('.','\\.')+'"');
 assert(re.test(matchTabs[1]),'Wrong or missing user icon for '+kind);
}
assert(!/<span aria-hidden="true">[☕▦◈⚖★▣⤓]<\/span>/.test(matchTabs[1]),
  'Emoji and placeholder glyphs must be replaced');
const saveButtons=[
 'productSaveButton','posCategorySave','saveRecipe','saveComposition','saveRetentionPreference'
];
for(const id of saveButtons){
 const b=html.match(new RegExp('<button[^>]*id="'+id+'"[^>]*>([\\s\\S]*?)<\\/button>'));
 assert(b,'Missing save button '+id);
 assert(b[1].includes('src="/assets/catalog/save.png"'),'Save image not used on '+id);
}
for(const label of ['Save Ingredient','Save Promo','Save Package']){
 const loc=html.indexOf(label);
 assert(loc>=0,'Save action missing: '+label);
 const open=html.lastIndexOf('<button',loc);
 assert(html.slice(open,loc).includes('src="/assets/catalog/save.png"'),
  'Save image not used for '+label);
}
assert((html.match(/class="catalog-save-icon"/g)||[]).length>=8,
 'Save image should be used throughout Catalog');
assert((html.match(/class="catalog-question-icon"/g)||[]).length>=5,
 'Question gear should be used across active/help fields');
const helps=[...html.matchAll(/<span class="catalog-help"([^>]+)>([\s\S]*?)<\/span>/g)];
assert(helps.length>=5,'Help tooltips are missing');
for(const help of helps){
 assert(help[0].includes('data-tooltip='),'Tooltip was lost');
 assert(help[0].includes('tabindex="0"'),'Help is not keyboard focusable');
 assert(help[0].includes('src="/assets/catalog/question.png"'),'Help image mismatched');
}
const section=html.match(/<div id="admin-packages"[^>]*>([\s\S]*?)<div id="admin-settings"/);
assert(section,'Packages section missing');
const body=section[1];
const listIndex=body.indexOf('id="adminPackagesBody"');
const formIndex=body.indexOf('id="packageForm"');
const masterIndex=body.indexOf('class="package-master-fields"');
const compositionIndex=body.indexOf('class="package-composition-section"');
assert(listIndex>=0 && formIndex>listIndex,
 'The Package List must precede the full-width editor');
assert(masterIndex>formIndex && compositionIndex>masterIndex,
 'Master fields must precede composition');
assert(body.includes('class="package-master-actions"'),'Actions grouping missing');
assert(body.includes('class="package-composition-heading"'),'Composition heading missing');
assert(body.includes('id="compositionBatchArea"'),'Composition drag-and-drop missing');
for(const id of ['packageForm','packageName','packagePrice','packageActive','packageFormClear',
 'compositionPackage','compositionBatchDrop','compositionAdd','compositionList','saveComposition']){
 assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,'Duplicated/missing control '+id);
}
assert(/#view-catalog #admin-packages\.admin-panel\.section-grid\.active\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*!important/.test(css),
 'Package list needs the full-width single-column override');
assert(css.includes('grid-column: 1 / -1'),'List and editor should each span the single column');
assert(css.includes('.package-master-fields'),'Package master rows are not responsive');
assert(css.includes('@media (max-width: 700px)'),'Mobile layout needed');
assert(css.includes('.catalog-tab-icon') && css.includes('.catalog-save-icon') && css.includes('.catalog-question-icon'));
assert(loader.includes("loadCss('catalogIconsPackagesV1545Css', '/catalog-icons-packages-v1545.css')"),
 'Icon/layout CSS not loaded');
assert(loader.includes("const VERSION = '1.5.45-catalog-icons-package-layout';"));
assert(server.includes("const APP_VERSION = '1.5.45-catalog-icons-package-layout';"));
assert(html.includes('/app.js?v=1.5.45'));
console.log('v1.5.45 icon assets, form wiring, and responsive Packages layout checks passed.');
