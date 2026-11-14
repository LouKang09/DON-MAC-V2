'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const incoming=fs.readFileSync(path.join(__dirname,'..','lib','branch-incoming-supply.js'),'utf8');

// Today's sales count must remain restricted to the authenticated workspace/branch.
assert.match(server,/SELECT COUNT\(\*\) AS count FROM sales s WHERE s\.status=\$1/);
assert.match(server,/wb\.workspace_id=\$4 AND wb\.branch_id=s\.branch_id/);

// The live inventory-movement endpoint was switched from the legacy global ledger
// to the isolated branch inventory movement reader. Verify the current route.
assert.match(server,/p==='\/api\/inventory\/movements'[\s\S]*?branchIncomingSupply\.movements\(db,user,url\.searchParams\.get\('branchId'\),url\.searchParams\.get\('limit'\)\)/);
assert.match(incoming,/async function movements\(db,user,rawBranch,rawLimit\)/);
assert.match(incoming,/const own=await readBranch\(db,user,rawBranch\)/);
assert.match(incoming,/FROM branch_inventory_movements m JOIN branch_ingredients i/);
assert.match(incoming,/WHERE m\.workspace_id=\$1 AND m\.branch_id=\$2/);
assert.match(incoming,/\[own\.workspaceId,own\.sourceBranchId\]/);
console.log('PASS: today sales count and branch inventory movement API are workspace/branch scoped');
