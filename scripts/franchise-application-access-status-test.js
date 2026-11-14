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

assert.match(html,/<th>Account Access<\/th><th>Review Action<\/th>/);
assert.match(html,/colspan="10">Loading applications/);
assert.match(html,/Mark Contacted records outreach only/);
assert.match(html,/platform-admin\.js\?v=1\.0\.12/);
assert.match(html,/platform-admin\.css\?v=1\.0\.8/);
assert.match(css,/\.application-access-note\{/);

assert.match(app,/x\.status==='CONTACTED'\?'Contacted · review only'/);
assert.match(app,/Mark Contacted \(review only\)/);
assert.match(app,/Mark Contacted does not grant POS login/);
assert.match(app,/Activation pending/);
assert.match(app,/POS login remains locked until Phase 2 tenant isolation/);
assert.match(app,/Applicant must verify email before starter catalog preparation/);
assert.match(app,/Prepare starter catalog next/);
assert.match(app,/x\.stageStatus/);
assert.match(app,/No franchise applications received/);

// Application review must never silently activate a new franchise account.
assert.match(requests,/new Set\(\['PENDING','CONTACTED','REJECTED'\]\)/);
assert.doesNotMatch(requests,/INSERT INTO users/i);
assert.match(readiness,/activationEnabled:false/);
assert.match(staging,/PREPARED_NO_ACCESS/);
assert.match(staging,/loginEnabled:false/);
console.log('PASS: application review and POS activation are visibly distinct; provisioning remains fail-closed');
