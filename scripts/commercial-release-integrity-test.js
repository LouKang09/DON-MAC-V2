'use strict';
// Commercial release asset integrity. Only local static resources; no prod writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../public');
const pages=['index.html','platform-admin.html','supply-office.html'];
let checked=0;
function asset(url,source){
 const pathname=url.split(/[?#]/)[0];
 if(!pathname.startsWith('/')||pathname.startsWith('//')||!(/\.(?:js|css)$/i.test(pathname)))return;
 const file=path.resolve(root,pathname.slice(1));
 assert(file.startsWith(root+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile(),source+' missing '+pathname);
 assert(fs.statSync(file).size>0,source+' empty '+pathname);
 checked++;
}
for(const page of pages){
 const html=fs.readFileSync(path.join(root,page),'utf8');
 assert.match(html,/<meta\s+name="viewport"[^>]*width=device-width/i,page+' needs responsive viewport');
 for(const m of html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)=["']([^"']+)["']/gi))asset(m[1],page);
}
const loader=fs.readFileSync(path.join(root,'app.js'),'utf8');
for(const m of loader.matchAll(/["'](\/[^"']+?\.(?:js|css)(?:\?[^"']*)?)["']/g))asset(m[1],'app.js');
assert(checked>50,'Asset scan must exercise the real shared shell');
console.log('PASS commercial release: '+checked+' local script/stylesheet references exist and are nonempty.');
