'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync('public/index.html','utf8');
const css = fs.readFileSync('public/pos-catalog-tiles-v1546.css','utf8');
const app = fs.readFileSync('public/app.js','utf8');
const server = fs.readFileSync('server.js','utf8');
const labels = new Map([
 ['products',['Products','coffee-pack.png']],
 ['categories',['POS Categories','category-removebg-preview.png']],
 ['ingredients',['Ingredients','coffee-removebg-preview.png']],
 ['recipes',['Recipes &amp; Costing','recipe-removebg-preview.png']],
 ['promos',['Promos','promo-removebg-preview.png']],
 ['packages',['Packages','goods.png']],
 ['backups',['Backups','backup-removebg-preview.png']]
]);
assert.equal((html.match(/data-admin-tab="/g)||[]).length,7);
for(const [tab,[label,filename]] of labels){
 const re=new RegExp('<button class="catalog-tile(?: active)?" type="button" data-admin-tab="'+tab+'"[^>]*>([\\s\\S]*?)<\\/button>');
 const match=html.match(re);
 assert(match,'Tile markup missing for '+tab);
 assert(match[1].includes('<span class="catalog-tile-label">'+label+'</span>'),'Wrong label for '+tab);
 assert(match[1].includes('src="/assets/catalog/'+filename+'"'),'Wrong icon for '+tab);
 assert(match[1].includes('class="catalog-tile-status"'));
 const bytes=fs.readFileSync(path.join('public/assets/catalog',filename));
 assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a','Not a PNG: '+filename);
 assert(bytes.length>900,'Icon too small or missing: '+filename);
 const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
 assert(width>=90&&height>=90,'Uploaded icon has insufficient dimensions: '+filename);
}
assert(css.includes('grid-template-columns: repeat(3, minmax(0, 1fr))'),'3-column POS grid missing');
assert(css.includes('min-height: 110px'),'POS tile height mismatch');
assert(css.includes('width: 67px'),'POS icon size mismatch');
assert(css.includes("content: 'Selected';")&&css.includes("content: 'Browse';"));
assert(css.includes('@media (max-width: 540px)'),'Mobile breakpoint missing');
assert(css.includes('grid-template-columns: repeat(2, minmax(0, 1fr))'),'Small screen overflow risk');
assert(app.includes("loadCss('posCatalogTilesV1546Css', '/pos-catalog-tiles-v1546.css')"));
assert(app.includes("const VERSION = '1.5.46-pos-style-catalog-cards';"));
assert(server.includes("const APP_VERSION = '1.5.46-pos-style-catalog-cards';"));
assert(html.includes('/app.js?v=1.5.46'));
for(const [id,label] of [['createBackup','Create Backup'],['downloadDataArchive','Download Data Archive']]){
 const match=html.match(new RegExp('<button[^>]+id="'+id+'"[^>]*>([\\s\\S]*?)<\\/button>'));
 assert(match,'Missing '+id);
 assert(match[0].includes('catalog-download-button'),'Green download button class missing for '+id);
 assert(match[1].includes('class="catalog-download-icon"'),'Download SVG missing for '+id);
 assert(match[1].includes(label),'Label missing for '+id);
}
assert(css.includes('#view-catalog #admin-backups #createBackup'));
assert(css.includes('#view-catalog #admin-backups #downloadDataArchive'));
assert(css.includes('background: #146040 !important'),'Green background missing');
assert(css.includes('button.catalog-download-button:disabled'),'Disabled PostgreSQL backup not distinguished');
assert(server.includes("if(db.engine!=='sqlite'||!db.backupTo)"),'Server-side backup capability guards must be preserved');
console.log('v1.5.46 POS-sized tiles, seven user icons and backup button checks passed.');
