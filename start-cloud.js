// Railway/PostgreSQL startup shim for Coffee POS v1.5.6.
// Keeps PostgreSQL timestamps ISO-normalized and applies small production-only
// validation/version patches without mutating the historical server source.
const fs = require('fs');
const path = require('path');
const Module = require('module');

try {
  const { types } = require('pg');
  types.setTypeParser(1184, value => new Date(value).toISOString());
} catch (err) {
  console.error('Unable to configure PostgreSQL timestamp parser:', err.message);
}

const serverPath = path.join(__dirname, 'server.js');
let source = fs.readFileSync(serverPath, 'utf8');
source = source.replace(/const APP_VERSION = '[^']+';/, "const APP_VERSION = '1.5.6';");

if (!source.includes('Delivered By is required. Enter who will deliver the stock.')) {
  source = source.replace(
    "if(deliveredBy.length>150)throw Object.assign(new Error('Delivered By must be at most 150 characters.'),{status:400});\n  if(remarks.length>500)throw Object.assign(new Error('Remarks must be at most 500 characters.'),{status:400});",
    "if(!deliveredBy)throw Object.assign(new Error('Delivered By is required. Enter who will deliver the stock.'),{status:400});\n  if(!remarks)throw Object.assign(new Error('Remarks are required. Add delivery details such as the contact name or phone number.'),{status:400});\n  if(deliveredBy.length>150)throw Object.assign(new Error('Delivered By must be at most 150 characters.'),{status:400});\n  if(remarks.length>500)throw Object.assign(new Error('Remarks must be at most 500 characters.'),{status:400});"
  );
}
if (!source.includes('Remarks are required. Add the expected delivery time and delivery person.')) {
  source = source.replace(
    "if(!branch||!receivedBy)throw Object.assign(new Error('Transfer To and Received By are required.'),{status:400});\n  if(branch.length>150||receivedBy.length>150)throw Object.assign(new Error('Transfer To and Received By must be at most 150 characters.'),{status:400});\n  if(remarks.length>500)throw Object.assign(new Error('Remarks must be at most 500 characters.'),{status:400});",
    "if(!branch||!receivedBy)throw Object.assign(new Error('Transfer To and Received By are required.'),{status:400});\n  if(!remarks)throw Object.assign(new Error('Remarks are required. Add the expected delivery time and delivery person.'),{status:400});\n  if(branch.length>150||receivedBy.length>150)throw Object.assign(new Error('Transfer To and Received By must be at most 150 characters.'),{status:400});\n  if(remarks.length>500)throw Object.assign(new Error('Remarks must be at most 500 characters.'),{status:400});"
  );
}

if (!source.includes('Delivered By is required. Enter who will deliver the stock.') ||
    !source.includes('Remarks are required. Add the expected delivery time and delivery person.')) {
  throw new Error('Coffee POS v1.5.6 startup patch could not find the expected inventory validation code.');
}

const compiled = new Module(serverPath, module);
compiled.filename = serverPath;
compiled.paths = Module._nodeModulePaths(path.dirname(serverPath));
compiled._compile(source, serverPath);
