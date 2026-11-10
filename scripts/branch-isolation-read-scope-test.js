'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
assert.match(server,/SELECT COUNT\(\*\) AS count FROM sales s WHERE s\.status=\$1/);
assert.match(server,/wb\.workspace_id=\$4 AND wb\.branch_id=s\.branch_id/);
assert.match(server,/listInventoryMovements\(url\.searchParams\.get\('limit'\),user\)/);
assert.match(server,/chat_memberships cm WHERE cm\.workspace_id=\$1 AND cm\.user_id=m\.created_by/);
console.log('PASS: today count and inventory movement read queries are franchise-workspace scoped');