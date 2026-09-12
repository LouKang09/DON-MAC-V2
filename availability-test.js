const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

assert(app.includes('function availabilityTip(item)'));
assert(app.includes('data-availability-tip'));
assert(app.includes('RECIPE REQUIRED'));
assert(app.includes('LOW/INSUFFICIENT'));
assert(app.includes('bindAvailabilityTooltips()'));
assert(css.includes('.availability-tooltip'));
assert(css.includes('.availability-hover'));
assert(server.includes("availabilityStatus=!recipeConfigured?'recipe_required'"));
assert(server.includes("reason:'recipe_required'"));
assert(server.includes("recipeConfigured=rec.length>0"));
console.log('PRODUCT AVAILABILITY UI TEST PASSED');
