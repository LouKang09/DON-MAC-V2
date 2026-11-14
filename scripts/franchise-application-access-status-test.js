'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const read=p=>fs.readFileSync(p,'utf8');
const html=read('public/platform-admin.html');
const css=read('public/platform-admin.css');
const app=read('public/platform-admin.js');
const requests=read('lib/public-franchise-requests.js');
const readiness=read('lib/franchise-activation-readiness.js');
const staging=read('lib/franchise-tenant-staging.js');

assert.match(html,/<th>Requested \/ Assigned Plan<\/th><th>Account Access<\/th><th>Review Action<\/th>/);
assert.match(html,/colspan="11">Loading applications/);
assert.match(html,/Marking a plan Paid activates that franchise/);
assert.match(html,/platform-admin\.js\?v=1\.0\.16/);
assert.match(html,/platform-admin\.css\?v=1\.0\.10/);
assert.match(css,/\.application-access-note\{/);

assert.match(app,/const paid=x\.assignedStatus==='PAID'/);
assert.match(app,/Mark Contacted/);
assert.match(app,/Create Account/);
assert.match(app,/Awaiting payment/);
assert.match(app,/Live POS active/);
assert.match(app,/Email verification required/);
assert.match(app,/Prepare Starter Catalog/);
assert.match(app,/x\.stageStatus/);
assert.match(app,/data-request-access/);
assert.match(app,/Disable login/);
assert.match(html,/phase2TestLoginDialog/);
assert.match(html,/Copy Credentials/);
assert.match(app,/No franchise applications received/);
assert.match(app,/Requested: /);
assert.match(app,/data-request-plan/);
assert.match(app,/openPlan\(owner\)/);
assert.match(app,/Assign Plan/);
assert.match(requests,/requested_plan/);
assert.match(html,/Requested \/ Assigned Plan/);

// Application review must never silently activate a new franchise account.
assert.match(requests,/new Set\(\['PENDING','CONTACTED','REJECTED'\]\)/);
assert.doesNotMatch(requests,/INSERT INTO users/i);
assert.doesNotMatch(app,/reloadFranchiseActivationReadiness/);
assert.doesNotMatch(html,/Checking franchise data isolation/);
assert.doesNotMatch(html,/Production activation remains locked/);
assert.match(readiness,/activationEnabled:false/); // retained for internal diagnostics only
assert.match(staging,/PREPARED_NO_ACCESS/);
assert.match(staging,/loginEnabled:false/);
console.log('PASS: applications show real Paid-plan live POS states; obsolete Phase 2 banner and controls removed.');
