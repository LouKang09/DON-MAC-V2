const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createDb } = require('./db');
const { makePdf, salesReportLines, costingReportLines } = require('./lib/pdf');
const { sendMail } = require('./lib/smtp');

const ROOT = __dirname;
function loadEnvFile(file){
  if(!fs.existsSync(file))return;
  const lines=fs.readFileSync(file,'utf8').split(/\r?\n/);
  for(const raw of lines){
    const line=raw.trim();if(!line||line.startsWith('#'))continue;
    const i=line.indexOf('=');if(i<1)continue;
    const key=line.slice(0,i).trim();if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)||process.env[key]!==undefined)continue;
    let value=line.slice(i+1).trim();
    if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);
    process.env[key]=value;
  }
}
loadEnvFile(path.join(ROOT,'.env'));
const PUBLIC_DIR = path.join(ROOT, 'public');
const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR || path.join(ROOT, 'backups'));
const REQUESTED_PORT = Number(process.env.PORT || 3100);
const HOST = process.env.HOST || '127.0.0.1';
const PORT_EXPLICIT = String(process.env.STRICT_PORT || '').toLowerCase() === 'true';
const SESSION_HOURS_RAW = Number(process.env.SESSION_HOURS || 12);
const SESSION_HOURS = Number.isFinite(SESSION_HOURS_RAW) && SESSION_HOURS_RAW > 0 ? Math.min(SESSION_HOURS_RAW, 168) : 12;
const MANILA_TZ = 'Asia/Manila';
const APP_VERSION = '1.4.0-stable';
const MAX_MONEY = 9_999_999_999.99;
const MAX_STOCK = 999_999_999_999;
const MAX_RECIPE_VALUE = 999_999_999;
const MAX_PACKAGE_QTY = 999_999_999;

let db;
let maintenanceMode=false;

const money = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const normalize = s => String(s || '').trim().replace(/\s+/g, ' ').toUpperCase();
const nowIso = () => new Date().toISOString();
const bool = v => v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true';

function json(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload), ...headers });
  res.end(payload);
}

function text(res, status, body, contentType = 'text/plain; charset=utf-8', headers = {}) {
  const payload = Buffer.from(body);
  res.writeHead(status, { 'Content-Type': contentType, 'Content-Length': payload.length, ...headers });
  res.end(payload);
}

async function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 1024 * 1024) reject(Object.assign(new Error('Request too large.'), { status: 413 }));
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch (_) { reject(Object.assign(new Error('Invalid JSON body.'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function parseCookies(req) {
  const cookie = req.headers.cookie || '';
  const out = {};
  cookie.split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${key}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, salt, expected] = stored.split('$');
  const actual = crypto.scryptSync(String(password), salt, 64).toString('hex');
  const a = Buffer.from(actual, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function cookieHeader(token, maxAgeSeconds) {
  const secure = String(process.env.COOKIE_SECURE || '').toLowerCase() === 'true' ? '; Secure' : '';
  return `pos_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}${secure}`;
}

async function getUser(req, conn = db) {
  const token = parseCookies(req).pos_session;
  if (!token) return null;
  const tokenHash = hashToken(token);
  const result = await conn.query(
    `SELECT u.id, u.username, u.role, u.active, s.expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1`, [tokenHash]
  );
  const row = result.rows[0];
  if (!row || !bool(row.active) || new Date(row.expires_at).getTime() <= Date.now()) {
    await conn.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
    return null;
  }
  return { id: Number(row.id), username: row.username, role: row.role };
}

async function requireUser(req, res, role) {
  const user = await getUser(req);
  if (!user) {
    json(res, 401, { error: 'Authentication required.' });
    return null;
  }
  if (role && user.role !== role) {
    json(res, 403, { error: 'Administrator access required.' });
    return null;
  }
  return user;
}

function placeholders(start, count) {
  return Array.from({ length: count }, (_, i) => `$${start + i}`).join(',');
}

async function initSchema() {
  const schemaFile = db.engine === 'postgres'
    ? path.join(ROOT, 'database', 'postgres-schema.sql')
    : path.join(ROOT, 'database', 'sqlite-schema.sql');
  await db.exec(fs.readFileSync(schemaFile, 'utf8'));
}

async function seedDatabase() {
  const seeded = await db.query("SELECT value FROM meta WHERE key = 'seed_version'");
  if (seeded.rows[0]?.value === 'coffee-pos-0.4-v2') return;

  const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'seed-data.json'), 'utf8'));
  await db.transaction(async tx => {
    const productIds = new Map();
    for (let i = 0; i < seed.products.length; i++) {
      const p = seed.products[i];
      const sku = `P${String(i + 1).padStart(3, '0')}-${normalize(p.name).replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
      const r = await tx.query(
        `INSERT INTO products (sku, name, category, price, active)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (name) DO UPDATE SET category = excluded.category, price = excluded.price, active = excluded.active
         RETURNING id`, [sku, p.name, p.category, p.price, true]
      );
      productIds.set(normalize(p.name), Number(r.rows[0].id));
    }

    const addOnIds = new Map();
    for (const a of seed.add_ons || []) {
      const r = await tx.query(
        `INSERT INTO add_ons (name, price, exclude_from_costing, active)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (name) DO UPDATE SET price = excluded.price, exclude_from_costing = excluded.exclude_from_costing, active = excluded.active
         RETURNING id`, [a.name, a.price, !!a.exclude_from_costing, !!a.active]
      );
      addOnIds.set(normalize(a.name), Number(r.rows[0].id));
    }

    const ingredientIds = new Map();
    for (const ing of seed.ingredients) {
      const r = await tx.query(
        `INSERT INTO ingredients (code, display_name, uom, stock_qty, low_stock_threshold, active)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (code) DO UPDATE SET display_name=excluded.display_name, uom=excluded.uom, stock_qty=excluded.stock_qty, active=excluded.active
         RETURNING id`, [ing.code, ing.name, ing.uom || '', ing.stock, 0, true]
      );
      ingredientIds.set(ing.code, Number(r.rows[0].id));
    }

    const costMap = new Map((seed.costs || []).map(c => [`${normalize(c.product)}|${c.ingredient_code}`, c.cost]));
    for (const rec of seed.recipes) {
      const pid = productIds.get(normalize(rec.product));
      const iid = ingredientIds.get(rec.ingredient_code);
      if (!pid || !iid) continue;
      const cost = costMap.get(`${normalize(rec.product)}|${rec.ingredient_code}`) ?? null;
      await tx.query(
        `INSERT INTO product_ingredients (product_id, ingredient_id, quantity_required, cost_contribution)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (product_id, ingredient_id) DO UPDATE SET quantity_required=excluded.quantity_required, cost_contribution=excluded.cost_contribution`,
        [pid, iid, rec.quantity, cost]
      );
    }

    const promoIds = new Map();
    for (const p of seed.promos) {
      const r = await tx.query(
        `INSERT INTO promos (name, inclusion_label, promo_price, food_limit, coffee_limit, active)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (name) DO UPDATE SET inclusion_label=excluded.inclusion_label, promo_price=excluded.promo_price, food_limit=excluded.food_limit, coffee_limit=excluded.coffee_limit, active=excluded.active
         RETURNING id`, [p.name, p.inclusion, p.price, p.food_limit, p.coffee_limit, true]
      );
      promoIds.set(normalize(p.name), Number(r.rows[0].id));
    }

    for (const p of seed.packages) {
      await tx.query(
        `INSERT INTO packages (name, price, active) VALUES ($1,$2,$3)
         ON CONFLICT (name) DO UPDATE SET price=excluded.price, active=excluded.active`, [p.name, p.price, true]
      );
    }

    const userIds = new Map();
    for (const u of seed.legacy_users || []) {
      const r = await tx.query(
        `INSERT INTO users (username, password_hash, role, active, created_at)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (username) DO UPDATE SET role=excluded.role
         RETURNING id`, [u.username, null, u.role, false, u.created_at || nowIso()]
      );
      userIds.set(normalize(u.username), Number(r.rows[0].id));
    }

    // Historical sales are normalized by reference. Excel passwords and email credentials are not imported.
    for (const s of seed.historical_sales || []) {
      const cashierId = userIds.get(normalize(s.cashier)) || null;
      const promoId = s.promo_name ? (promoIds.get(normalize(s.promo_name)) || null) : null;
      const saleR = await tx.query(
        `INSERT INTO sales
          (reference, cashier_user_id, cashier_name_snapshot, payment_mode, payment_reference, tender, change_amount,
           status, remark, senior_details, discount_amount, gross, adjustment, actual, promo_id, sold_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         ON CONFLICT (reference) DO NOTHING
         RETURNING id`,
        [s.reference, cashierId, s.cashier, s.payment_mode === 'GCash' ? 'GCash' : 'Cash', s.payment_reference,
         s.tender, 0, s.status, s.remark, s.senior_details, s.discount_amount, s.gross, s.adjustment, s.actual, promoId, s.sold_at || nowIso()]
      );
      let saleId = saleR.rows[0]?.id;
      if (!saleId) {
        const existing = await tx.query('SELECT id FROM sales WHERE reference=$1', [s.reference]);
        saleId = existing.rows[0]?.id;
      }
      if (!saleId) continue;
      const existingItems = await tx.query('SELECT COUNT(*) AS c FROM sale_items WHERE sale_id=$1', [saleId]);
      if (Number(existingItems.rows[0]?.c || 0) > 0) continue;
      for (const item of s.items) {
        const pid = productIds.get(normalize(item.product_name)) || null;
        const aid = addOnIds.get(normalize(item.product_name)) || null;
        await tx.query(
          `INSERT INTO sale_items
            (sale_id, product_id, add_on_id, product_name_snapshot, quantity, unit_price, line_total, is_add_on, exclude_from_costing)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [saleId, pid, aid, item.product_name, item.quantity, item.unit_price, item.line_total, !!item.is_add_on, !!item.exclude_from_costing]
        );
      }
    }

    for (const l of seed.historical_system_logs || []) {
      const actorId = userIds.get(normalize(l.actor)) || null;
      await tx.query(
        `INSERT INTO system_logs (activity, actor_user_id, actor_name_snapshot, status, remark, created_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [l.activity || '', actorId, l.actor, l.status, l.remark, l.created_at || nowIso()]
      );
    }

    await tx.query(
      `INSERT INTO meta (key,value) VALUES ('seed_version',$1)
       ON CONFLICT (key) DO UPDATE SET value=excluded.value`, ['coffee-pos-0.4-v2']
    );
  });
}

async function appStatus() {
  const activeAdmin = await db.query("SELECT COUNT(*) AS c FROM users WHERE role='Admin' AND active=$1 AND password_hash IS NOT NULL", [true]);
  return { setupRequired: Number(activeAdmin.rows[0]?.c || 0) === 0, engine: db.engine, source: 'Coffee POS 0.4.xlsm' };
}

async function migrateSchema() {
  if (db.engine === 'sqlite') {
    const cols = await db.query('PRAGMA table_info(sale_items)');
    const names = new Set(cols.rows.map(x => x.name));
    if (!names.has('package_id')) await db.exec('ALTER TABLE sale_items ADD COLUMN package_id INTEGER REFERENCES packages(id);');
    if (!names.has('is_package')) await db.exec('ALTER TABLE sale_items ADD COLUMN is_package INTEGER NOT NULL DEFAULT 0;');
    const saleCols = await db.query('PRAGMA table_info(sales)');
    const saleNames = new Set(saleCols.rows.map(x => x.name));
    if (!saleNames.has('client_request_id')) await db.exec('ALTER TABLE sales ADD COLUMN client_request_id TEXT;');
    await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_client_request_id ON sales(client_request_id) WHERE client_request_id IS NOT NULL;');
  } else {
    await db.exec('ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS package_id BIGINT REFERENCES packages(id);');
    await db.exec('ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS is_package BOOLEAN NOT NULL DEFAULT FALSE;');
    await db.exec('ALTER TABLE sales ADD COLUMN IF NOT EXISTS client_request_id VARCHAR(128);');
    await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_client_request_id ON sales(client_request_id) WHERE client_request_id IS NOT NULL;');
    await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_ci ON users((LOWER(username)));');
    await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_products_name_ci ON products((LOWER(name)));');
    await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_add_ons_name_ci ON add_ons((LOWER(name)));');
    await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_packages_name_ci ON packages((LOWER(name)));');
    await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_promos_name_ci ON promos((LOWER(name)));');
  }
  await db.query(`INSERT INTO meta (key,value) VALUES ('app_version',$1) ON CONFLICT (key) DO UPDATE SET value=excluded.value`, [APP_VERSION]);
}

async function logAction(user, activity, status, remark=null, conn=db) {
  await conn.query(
    `INSERT INTO system_logs (activity,actor_user_id,actor_name_snapshot,status,remark,created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
    [activity,user?.id||null,user?.username||null,status||null,remark,nowIso()]
  );
}

function requireAdminRole(user) {
  if (!user || user.role !== 'Admin') throw Object.assign(new Error('Administrator access required.'), { status:403 });
}

async function getCatalog(conn=db) {
  const productsR=await conn.query(`SELECT id,sku,name,category,price,active FROM products WHERE active=$1 ORDER BY category,name`,[true]);
  const addR=await conn.query(`SELECT id,name,price,exclude_from_costing,active FROM add_ons WHERE active=$1 ORDER BY name`,[true]);
  const promoR=await conn.query(`SELECT id,name,inclusion_label,promo_price,food_limit,coffee_limit,active FROM promos WHERE active=$1 ORDER BY id`,[true]);
  const packageR=await conn.query(`SELECT id,name,price,active FROM packages WHERE active=$1 ORDER BY id`,[true]);
  const recR=await conn.query(`SELECT pi.product_id,pi.ingredient_id,pi.quantity_required,i.code,i.display_name,i.uom,i.stock_qty,i.low_stock_threshold,i.active FROM product_ingredients pi JOIN ingredients i ON i.id=pi.ingredient_id`);
  const packItemsR=await conn.query(`SELECT pi.package_id,pi.product_id,pi.quantity,p.name AS product_name,p.active AS product_active FROM package_items pi JOIN products p ON p.id=pi.product_id ORDER BY pi.package_id,p.name`);
  const recipeByProduct=new Map();
  for(const r of recR.rows){const pid=Number(r.product_id);if(!recipeByProduct.has(pid))recipeByProduct.set(pid,[]);recipeByProduct.get(pid).push(r);}
  const productMap=new Map(productsR.rows.map(p=>[Number(p.id),p]));
  const products=productsR.rows.map(p=>{
    const rec=recipeByProduct.get(Number(p.id))||[];
    const recipeConfigured=rec.length>0;
    const issues=[];const warnings=[];
    for(const r of rec){
      const required=Number(r.quantity_required),stock=Number(r.stock_qty),threshold=Number(r.low_stock_threshold||0),uom=String(r.uom||'').toUpperCase();
      if(!bool(r.active))issues.push({ingredientId:Number(r.ingredient_id),code:r.code,name:r.display_name,uom,required,current:stock,shortage:Math.max(0,required-stock),status:'ingredient_unavailable'});
      else if(stock+1e-9<required)issues.push({ingredientId:Number(r.ingredient_id),code:r.code,name:r.display_name,uom,required,current:stock,shortage:Math.max(0,required-stock),status:stock<=0?'out_of_stock':'low_stock'});
      else if(threshold>0&&stock<=threshold)warnings.push({ingredientId:Number(r.ingredient_id),code:r.code,name:r.display_name,uom,required,current:stock,threshold,status:'low_stock_warning'});
    }
    const available=recipeConfigured&&issues.length===0;
    const availabilityStatus=!recipeConfigured?'recipe_required':issues.length?'insufficient_stock':'available';
    const availabilityMessage=!recipeConfigured?'Recipe required: add at least one ingredient before selling this product.':issues.length?'One or more recipe ingredients are unavailable or below the required quantity.':warnings.length?'Available, but one or more ingredients are low in stock.':'Available';
    return {id:Number(p.id),sku:p.sku,name:p.name,category:p.category,price:Number(p.price),available,recipeConfigured,availabilityStatus,availabilityMessage,availabilityDetails:issues,stockWarnings:warnings};
  });
  const itemsByPackage=new Map();
  for(const r of packItemsR.rows){const id=Number(r.package_id);if(!itemsByPackage.has(id))itemsByPackage.set(id,[]);itemsByPackage.get(id).push({productId:Number(r.product_id),name:r.product_name,qty:Number(r.quantity),active:bool(r.product_active)});}
  const packages=packageR.rows.map(p=>{
    const contents=itemsByPackage.get(Number(p.id))||[];const req=new Map();let activeComponents=true;const componentIssues=[];
    for(const c of contents){
      activeComponents=activeComponents&&c.active;
      if(!c.active)componentIssues.push({name:c.name,status:'product_unavailable',message:'Package component is archived.'});
      const rec=recipeByProduct.get(c.productId)||[];
      if(!rec.length)componentIssues.push({name:c.name,status:'recipe_required',message:'Package component has no recipe/ingredients yet.'});
      for(const r of rec){const iid=Number(r.ingredient_id);if(!req.has(iid))req.set(iid,{ingredientId:iid,code:r.code,name:r.display_name,uom:String(r.uom||'').toUpperCase(),need:0,stock:Number(r.stock_qty),threshold:Number(r.low_stock_threshold||0),active:bool(r.active)});req.get(iid).need+=c.qty*Number(r.quantity_required);}
    }
    const ingredientIssues=[];const warnings=[];
    for(const x of req.values()){
      if(!x.active)ingredientIssues.push({...x,required:x.need,current:x.stock,shortage:Math.max(0,x.need-x.stock),status:'ingredient_unavailable'});
      else if(x.stock+1e-9<x.need)ingredientIssues.push({...x,required:x.need,current:x.stock,shortage:Math.max(0,x.need-x.stock),status:x.stock<=0?'out_of_stock':'low_stock'});
      else if(x.threshold>0&&x.stock<=x.threshold)warnings.push({...x,required:x.need,current:x.stock,status:'low_stock_warning'});
    }
    const sellable=contents.length>0&&componentIssues.every(x=>x.status!=='recipe_required');
    const available=sellable&&activeComponents&&ingredientIssues.length===0;
    const availabilityStatus=!contents.length?'composition_required':componentIssues.some(x=>x.status==='recipe_required')?'recipe_required':!activeComponents?'component_unavailable':ingredientIssues.length?'insufficient_stock':'available';
    const availabilityMessage=!contents.length?'Package composition required.':componentIssues.some(x=>x.status==='recipe_required')?'A package component needs ingredients/recipe setup.':!activeComponents?'A package component is unavailable.':ingredientIssues.length?'One or more package ingredients are unavailable or below the required quantity.':warnings.length?'Available, but one or more ingredients are low in stock.':'Available';
    return {id:Number(p.id),name:p.name,price:Number(p.price),itemCount:contents.length,sellable,available,contents,availabilityStatus,availabilityMessage,availabilityDetails:[...componentIssues,...ingredientIssues],stockWarnings:warnings};
  });
  return {
    products,
    addOns:addR.rows.map(a=>({id:Number(a.id),name:a.name,price:Number(a.price),excludeFromCosting:bool(a.exclude_from_costing)})),
    promos:promoR.rows.map(p=>({id:Number(p.id),name:p.name,inclusion:p.inclusion_label,price:Number(p.promo_price),foodLimit:Number(p.food_limit||0),coffeeLimit:Number(p.coffee_limit||0)})),
    packages
  };
}

function validateCartInput(items){
  if(!Array.isArray(items)||!items.length)throw Object.assign(new Error('Add at least one item to the order.'),{status:400});
  if(items.length>100)throw Object.assign(new Error('Order has too many lines.'),{status:400});
  for(const x of items){
    if(!['product','addon','package'].includes(x.kind))throw Object.assign(new Error('Invalid item type.'),{status:400});
    if(!Number.isInteger(Number(x.id))||Number(x.id)<=0)throw Object.assign(new Error('Invalid item id.'),{status:400});
    if(!Number.isInteger(Number(x.qty))||Number(x.qty)<=0||Number(x.qty)>999)throw Object.assign(new Error('Quantity must be a positive whole number.'),{status:400});
  }
}

async function quoteOrder(conn,input){
  const items=input.items||[];validateCartInput(items);
  const productLines=items.filter(x=>x.kind==='product');
  const addonLines=items.filter(x=>x.kind==='addon');
  const packageLines=items.filter(x=>x.kind==='package');
  const productIds=[...new Set(productLines.map(x=>Number(x.id)))];
  const addonIds=[...new Set(addonLines.map(x=>Number(x.id)))];
  const packageIds=[...new Set(packageLines.map(x=>Number(x.id)))];
  const productMap=new Map(),addonMap=new Map(),packageMap=new Map();
  if(productIds.length){const r=await conn.query(`SELECT id,name,category,price,active FROM products WHERE id IN (${placeholders(1,productIds.length)})`,productIds);for(const p of r.rows)productMap.set(Number(p.id),p);}
  if(addonIds.length){const r=await conn.query(`SELECT id,name,price,exclude_from_costing,active FROM add_ons WHERE id IN (${placeholders(1,addonIds.length)})`,addonIds);for(const a of r.rows)addonMap.set(Number(a.id),a);}
  if(packageIds.length){
    const r=await conn.query(`SELECT id,name,price,active FROM packages WHERE id IN (${placeholders(1,packageIds.length)})`,packageIds);for(const p of r.rows)packageMap.set(Number(p.id),{...p,components:[]});
    const c=await conn.query(`SELECT pi.package_id,pi.product_id,pi.quantity,p.name,p.active FROM package_items pi JOIN products p ON p.id=pi.product_id WHERE pi.package_id IN (${placeholders(1,packageIds.length)}) ORDER BY pi.package_id,p.id`,packageIds);
    for(const x of c.rows){const p=packageMap.get(Number(x.package_id));if(p)p.components.push({productId:Number(x.product_id),name:x.name,qty:Number(x.quantity),active:bool(x.active)});}
  }
  const lines=[];let gross=0,addonSubtotal=0,foodCount=0,coffeeCount=0;
  const productQtyForStock=new Map();
  for(const x of productLines){
    const p=productMap.get(Number(x.id));if(!p||!bool(p.active))throw Object.assign(new Error('A selected product is no longer available.'),{status:409});
    const qty=Number(x.qty),lineTotal=money(Number(p.price)*qty);gross=money(gross+lineTotal);
    if(p.category==='Food')foodCount+=qty;if(p.category==='Coffee'||p.category==='Non Coffee')coffeeCount+=qty;
    productQtyForStock.set(Number(p.id),(productQtyForStock.get(Number(p.id))||0)+qty);
    lines.push({kind:'product',id:Number(p.id),productId:Number(p.id),addOnId:null,packageId:null,name:p.name,category:p.category,qty,unitPrice:Number(p.price),lineTotal,isAddOn:false,isPackage:false,excludeFromCosting:false,components:[]});
  }
  for(const x of packageLines){
    const p=packageMap.get(Number(x.id));if(!p||!bool(p.active))throw Object.assign(new Error('A selected package is no longer available.'),{status:409});
    if(!p.components.length)throw Object.assign(new Error(`${p.name} has no package composition yet.`),{status:409});
    if(p.components.some(c=>!c.active))throw Object.assign(new Error(`${p.name} contains an inactive product.`),{status:409});
    const qty=Number(x.qty),lineTotal=money(Number(p.price)*qty);gross=money(gross+lineTotal);
    const components=p.components.map(c=>({productId:c.productId,name:c.name,qty:c.qty*qty}));
    for(const c of components)productQtyForStock.set(c.productId,(productQtyForStock.get(c.productId)||0)+c.qty);
    lines.push({kind:'package',id:Number(p.id),productId:null,addOnId:null,packageId:Number(p.id),name:p.name,category:'Package',qty,unitPrice:Number(p.price),lineTotal,isAddOn:false,isPackage:true,excludeFromCosting:false,components});
  }
  for(const x of addonLines){
    const a=addonMap.get(Number(x.id));if(!a||!bool(a.active))throw Object.assign(new Error('A selected add-on is no longer available.'),{status:409});
    const qty=Number(x.qty),lineTotal=money(Number(a.price)*qty);gross=money(gross+lineTotal);addonSubtotal=money(addonSubtotal+lineTotal);
    lines.push({kind:'addon',id:Number(a.id),productId:null,addOnId:Number(a.id),packageId:null,name:a.name,category:'Add-on',qty,unitPrice:Number(a.price),lineTotal,isAddOn:true,isPackage:false,excludeFromCosting:bool(a.exclude_from_costing),components:[]});
  }
  if(input.promoId&&packageLines.length)throw Object.assign(new Error('Packages cannot be combined with a promo.'),{status:400});
  if(addonLines.length&&!input.promoId)throw Object.assign(new Error('FLAVORED FRIES and PREMIUM COFFEE upgrades can only be used during a promo.'),{status:400});
  if(addonLines.length){
    for(const line of lines.filter(x=>x.isAddOn)){
      const n=normalize(line.name);
      if(n==='FLAVORED FRIES'&&line.qty>foodCount)throw Object.assign(new Error('Flavored Fries upgrades cannot exceed the selected promo Food quantity.'),{status:400});
      if(n==='PREMIUM COFFEE'&&line.qty>coffeeCount)throw Object.assign(new Error('Premium Coffee upgrades cannot exceed the selected promo Coffee quantity.'),{status:400});
    }
  }
  const requirements=new Map();const stockPids=[...productQtyForStock.keys()];const recipeProductIds=new Set();
  if(stockPids.length){
    const r=await conn.query(`SELECT pi.product_id,pi.ingredient_id,pi.quantity_required,i.code,i.display_name,i.uom,i.stock_qty,i.active FROM product_ingredients pi JOIN ingredients i ON i.id=pi.ingredient_id WHERE pi.product_id IN (${placeholders(1,stockPids.length)})`,stockPids);
    for(const r0 of r.rows){const pid=Number(r0.product_id);recipeProductIds.add(pid);const q=productQtyForStock.get(pid)||0;if(!q)continue;const iid=Number(r0.ingredient_id),need=Number(r0.quantity_required)*q;if(!requirements.has(iid))requirements.set(iid,{ingredientId:iid,code:r0.code,name:r0.display_name,uom:r0.uom,stock:Number(r0.stock_qty),needed:0,active:bool(r0.active)});requirements.get(iid).needed+=need;}
    const missingRecipeIds=stockPids.filter(pid=>!recipeProductIds.has(pid));
    if(missingRecipeIds.length){
      const names=[];
      for(const pid of missingRecipeIds){
        const direct=productMap.get(pid);if(direct){names.push(direct.name);continue;}
        for(const pack of packageMap.values()){const c=pack.components?.find(x=>x.productId===pid);if(c){names.push(c.name);break;}}
      }
      const unique=[...new Set(names.filter(Boolean))];
      const e=new Error(unique.length===1?`${unique[0]} is not available until its ingredients/recipe are configured.`:'One or more selected products are not available until their ingredients/recipes are configured.');
      e.status=409;e.details={reason:'recipe_required',products:unique};throw e;
    }
  }
  const shortages=[...requirements.values()].filter(r=>!r.active||r.stock+1e-9<r.needed).map(r=>({...r,shortage:Math.max(0,r.needed-r.stock)}));
  if(shortages.length){const e=new Error('Insufficient ingredient stock.');e.status=409;e.details={shortages};throw e;}
  let promo=null,senior=null,adjustment=0,discountAmount=0,actual=gross,remark=null,seniorDetails=null;
  if(input.promoId){
    if(input.senior?.enabled)throw Object.assign(new Error('Unable to add Senior Citizen discount with an existing promo.'),{status:400});
    const r=await conn.query(`SELECT id,name,inclusion_label,promo_price,food_limit,coffee_limit,active FROM promos WHERE id=$1`,[Number(input.promoId)]);const p=r.rows[0];
    if(!p||!bool(p.active))throw Object.assign(new Error('Selected promo is unavailable.'),{status:409});
    const foodLimit=Number(p.food_limit||0),coffeeLimit=Number(p.coffee_limit||0);
    if(foodCount!==foodLimit||coffeeCount!==coffeeLimit){const e=new Error(`Complete the promo selection: ${foodLimit} Food and ${coffeeLimit} Coffee item(s) are required.`);e.status=400;e.details={foodCount,coffeeCount,foodLimit,coffeeLimit};throw e;}
    actual=money(Number(p.promo_price)+addonSubtotal);adjustment=money(actual-gross);discountAmount=money(Math.max(0,gross-actual));promo={id:Number(p.id),name:p.name,inclusion:p.inclusion_label,price:Number(p.promo_price),foodLimit,coffeeLimit};remark=p.name;
  }else if(input.senior?.enabled){
    const name=String(input.senior.name||'').trim(),id=String(input.senior.id||'').trim();if(!name)throw Object.assign(new Error("Please enter Senior Citizen's full name first."),{status:400});if(name.length>150)throw Object.assign(new Error("Senior Citizen's full name must be at most 150 characters."),{status:400});if(!/^\d{6,12}$/.test(id))throw Object.assign(new Error('Please enter a valid 6-12 digit Senior Citizen number.'),{status:400});
    discountAmount=money(gross*.20);adjustment=money(-discountAmount);actual=money(gross+adjustment);seniorDetails=`${name}(${id})`;senior={name,id,discountRate:.20};remark='With Senior Discount.';
  }
  if(![gross,Math.abs(adjustment),discountAmount,actual].every(Number.isFinite)||gross>MAX_MONEY||actual>MAX_MONEY)throw Object.assign(new Error('Order total is too large to record safely.'),{status:400});
  return {lines,requirements:[...requirements.values()],promo,senior,gross:money(gross),addonSubtotal:money(addonSubtotal),adjustment:money(adjustment),discountAmount:money(discountAmount),actual:money(actual),remark,seniorDetails,counts:{food:foodCount,coffee:coffeeCount}};
}

function makeReference(){const a=Array.from({length:3},()=>crypto.randomBytes(2).toString('hex').toUpperCase());return `REF#-${a.join('-')}`;}

async function createSale(user,body){
  const mode=String(body.paymentMode||'').trim();if(!['Cash','GCash'].includes(mode))throw Object.assign(new Error('Please choose Cash or GCash.'),{status:400});
  const clientRequestId=String(body.clientRequestId||'').trim();
  if(clientRequestId&&!/^[A-Za-z0-9._:-]{8,128}$/.test(clientRequestId))throw Object.assign(new Error('Invalid checkout request id.'),{status:400});
  return db.transaction(async tx=>{
    if(clientRequestId){
      if(tx.engine==='postgres')await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',[clientRequestId]);
      const previous=await tx.query('SELECT reference,payment_mode,tender,change_amount,gross,adjustment,actual,status FROM sales WHERE client_request_id=$1',[clientRequestId]);
      const p=previous.rows[0];
      if(p){
        if(p.status!=='Sold')throw Object.assign(new Error('This checkout request was already used by a deleted transaction. Start a new payment.'),{status:409});
        return {reference:p.reference,paymentMode:p.payment_mode,tender:Number(p.tender||0),change:Number(p.change_amount||0),gross:Number(p.gross||0),adjustment:Number(p.adjustment||0),actual:Number(p.actual||0),idempotent:true};
      }
    }
    const quote=await quoteOrder(tx,body);let tender=quote.actual,change=0,paymentReference=null;
    if(mode==='Cash'){tender=money(Number(body.tender||0));if(!Number.isFinite(tender)||tender<quote.actual||tender>MAX_MONEY)throw Object.assign(new Error('Cash tender must cover the amount due and stay within the supported amount range.'),{status:400});change=money(tender-quote.actual);}else{paymentReference=String(body.paymentReference||'').trim();if(!paymentReference||paymentReference.length>150)throw Object.assign(new Error('Enter a GCash reference up to 150 characters.'),{status:400});}
    let reference=null;for(let tries=0;tries<8;tries++){const candidate=makeReference();const exists=await tx.query('SELECT id FROM sales WHERE reference=$1',[candidate]);if(!exists.rows.length){reference=candidate;break;}}if(!reference)throw new Error('Unable to generate a unique sale reference.');
    const saleR=await tx.query(`INSERT INTO sales (reference,cashier_user_id,cashier_name_snapshot,payment_mode,payment_reference,tender,change_amount,status,remark,senior_details,discount_amount,gross,adjustment,actual,promo_id,sold_at,client_request_id) VALUES ($1,$2,$3,$4,$5,$6,$7,'Sold',$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,[reference,user.id,user.username,mode,paymentReference,tender,change,quote.remark,quote.seniorDetails,quote.discountAmount,quote.gross,quote.adjustment,quote.actual,quote.promo?.id||null,nowIso(),clientRequestId||null]);
    const saleId=Number(saleR.rows[0].id);
    for(const line of quote.lines){
      const itemR=await tx.query(`INSERT INTO sale_items (sale_id,product_id,add_on_id,package_id,product_name_snapshot,quantity,unit_price,line_total,is_add_on,is_package,exclude_from_costing) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,[saleId,line.productId,line.addOnId,line.packageId,line.name,line.qty,line.unitPrice,line.lineTotal,line.isAddOn,line.isPackage,line.excludeFromCosting]);
      const saleItemId=Number(itemR.rows[0].id);
      if(line.isPackage)for(const c of line.components)await tx.query(`INSERT INTO sale_item_components (sale_item_id,product_id,product_name_snapshot,quantity) VALUES ($1,$2,$3,$4)`,[saleItemId,c.productId,c.name,c.qty]);
    }
    const locked=new Map();if(tx.engine==='postgres'&&quote.requirements.length){const ids=quote.requirements.map(r=>r.ingredientId).sort((a,b)=>a-b);const lr=await tx.query(`SELECT id,stock_qty FROM ingredients WHERE id IN (${placeholders(1,ids.length)}) ORDER BY id FOR UPDATE`,ids);for(const row of lr.rows)locked.set(Number(row.id),Number(row.stock_qty));}
    for(const req of quote.requirements){let current;if(locked.has(req.ingredientId))current=locked.get(req.ingredientId);else{const cr=await tx.query('SELECT stock_qty FROM ingredients WHERE id=$1',[req.ingredientId]);current=Number(cr.rows[0]?.stock_qty??0);}if(current+1e-9<req.needed)throw Object.assign(new Error(`Insufficient stock for ${req.name}.`),{status:409});const balance=current-req.needed;await tx.query('UPDATE ingredients SET stock_qty=$1,updated_at=$2 WHERE id=$3',[balance,nowIso(),req.ingredientId]);await tx.query(`INSERT INTO inventory_movements (ingredient_id,movement_type,quantity_change,balance_after,reference,remarks,created_by,created_at) VALUES ($1,'SALE',$2,$3,$4,$5,$6,$7)`,[req.ingredientId,-req.needed,balance,reference,`Sale ${reference}`,user.id,nowIso()]);}
    await logAction(user,`Sale completed: ${reference}`,'Sold',quote.remark,tx);return {reference,paymentMode:mode,tender,change,...quote};
  });
}

async function getInventory(includeInactive=false){
  const r=includeInactive?await db.query(`SELECT id,code,display_name,uom,stock_qty,low_stock_threshold,active,updated_at FROM ingredients ORDER BY id`):await db.query(`SELECT id,code,display_name,uom,stock_qty,low_stock_threshold,active,updated_at FROM ingredients WHERE active=$1 ORDER BY id`,[true]);
  return r.rows.map(x=>({id:Number(x.id),code:x.code,name:x.display_name,uom:x.uom,stock:Number(x.stock_qty),lowStockThreshold:Number(x.low_stock_threshold||0),low:Number(x.stock_qty)<=Number(x.low_stock_threshold||0),active:bool(x.active),updatedAt:x.updated_at}));
}
function validateMovementItems(items){if(!Array.isArray(items)||!items.length)throw Object.assign(new Error('Select at least one ingredient.'),{status:400});for(const x of items){const qty=Number(x.qty);if(!Number.isInteger(Number(x.ingredientId))||Number(x.ingredientId)<=0)throw Object.assign(new Error('Invalid ingredient.'),{status:400});if(!Number.isFinite(qty)||!(qty>0))throw Object.assign(new Error('Each quantity must be a finite number greater than zero.'),{status:400});}}
async function replenish(user,body){
  validateMovementItems(body.items);
  const deliveredBy=String(body.deliveredBy||'').trim(),remarks=String(body.remarks||'').trim();
  if(deliveredBy.length>150)throw Object.assign(new Error('Delivered By must be at most 150 characters.'),{status:400});
  if(remarks.length>500)throw Object.assign(new Error('Remarks must be at most 500 characters.'),{status:400});
  return db.transaction(async tx=>{
    const details=[];
    for(const x of body.items){
      const lock=tx.engine==='postgres'?' FOR UPDATE':'';
      const r=await tx.query(`SELECT id,display_name,uom,stock_qty FROM ingredients WHERE id=$1 AND active=$2${lock}`,[Number(x.ingredientId),true]);
      const ing=r.rows[0];if(!ing)throw Object.assign(new Error('Ingredient not found.'),{status:404});
      const qty=Number(x.qty),balance=Number(ing.stock_qty)+qty;
      if(!Number.isFinite(balance)||balance>MAX_STOCK)throw Object.assign(new Error(`Stock balance for ${ing.display_name} would exceed the supported range.`),{status:400});
      await tx.query('UPDATE ingredients SET stock_qty=$1,updated_at=$2 WHERE id=$3',[balance,nowIso(),Number(ing.id)]);
      await tx.query(`INSERT INTO inventory_movements (ingredient_id,movement_type,quantity_change,balance_after,delivered_by,remarks,created_by,created_at) VALUES ($1,'REPLENISH',$2,$3,$4,$5,$6,$7)`,[Number(ing.id),qty,balance,deliveredBy||null,remarks||null,user.id,nowIso()]);
      details.push(`- ${ing.display_name}: (${qty}) ${String(ing.uom||'').toUpperCase()}`);
    }
    const activity=`Cashier: ${user.username}\nDelivered By: (${deliveredBy||'N/A'})\n\nItems Replenished:\n${details.join('\n')}`;
    await logAction(user,activity,'Replenished stock',remarks||null,tx);
    return {ok:true,activity};
  });
}
async function transfer(user,body){
  validateMovementItems(body.items);
  const branch=String(body.branch||'').trim(),receivedBy=String(body.receivedBy||'').trim(),remarks=String(body.remarks||'').trim();
  if(!branch||!receivedBy)throw Object.assign(new Error('Transfer To and Received By are required.'),{status:400});
  if(branch.length>150||receivedBy.length>150)throw Object.assign(new Error('Transfer To and Received By must be at most 150 characters.'),{status:400});
  if(remarks.length>500)throw Object.assign(new Error('Remarks must be at most 500 characters.'),{status:400});
  return db.transaction(async tx=>{
    const details=[];
    for(const x of body.items){
      const lock=tx.engine==='postgres'?' FOR UPDATE':'';
      const r=await tx.query(`SELECT id,display_name,uom,stock_qty FROM ingredients WHERE id=$1 AND active=$2${lock}`,[Number(x.ingredientId),true]);
      const ing=r.rows[0];if(!ing)throw Object.assign(new Error('Ingredient not found.'),{status:404});
      const qty=Number(x.qty),current=Number(ing.stock_qty);
      if(current+1e-9<qty)throw Object.assign(new Error(`Not enough ${ing.display_name} stock for transfer.`),{status:409});
      const balance=current-qty;
      await tx.query('UPDATE ingredients SET stock_qty=$1,updated_at=$2 WHERE id=$3',[balance,nowIso(),Number(ing.id)]);
      await tx.query(`INSERT INTO inventory_movements (ingredient_id,movement_type,quantity_change,balance_after,branch,received_by,remarks,created_by,created_at) VALUES ($1,'TRANSFER',$2,$3,$4,$5,$6,$7,$8)`,[Number(ing.id),-qty,balance,branch,receivedBy,remarks||null,user.id,nowIso()]);
      details.push(`- ${ing.display_name}: (${qty}) ${String(ing.uom||'').toUpperCase()}`);
    }
    const activity=`Cashier: ${user.username}\nTransfer To: (${branch})\nReceived By: (${receivedBy})\n\nItems Transferred:\n${details.join('\n')}`;
    await logAction(user,activity,'Transferred stock',remarks||null,tx);
    return {ok:true,activity};
  });
}
async function listInventoryMovements(limit=300){const n=Math.max(1,Math.min(1000,Number(limit)||300));const r=await db.query(`SELECT m.id,m.movement_type,m.quantity_change,m.balance_after,m.reference,m.branch,m.received_by,m.delivered_by,m.remarks,m.created_at,i.display_name,i.uom,u.username FROM inventory_movements m JOIN ingredients i ON i.id=m.ingredient_id LEFT JOIN users u ON u.id=m.created_by ORDER BY m.created_at DESC LIMIT ${n}`);return r.rows.map(x=>({id:Number(x.id),type:x.movement_type,ingredient:x.display_name,uom:x.uom,quantityChange:Number(x.quantity_change),balanceAfter:Number(x.balance_after),reference:x.reference,branch:x.branch,receivedBy:x.received_by,deliveredBy:x.delivered_by,remarks:x.remarks,createdBy:x.username,createdAt:x.created_at}));}

function manilaDateString(value){if(!value)return'';const raw=String(value);if(!/[zZ]|[+-]\d\d:\d\d$/.test(raw))return raw.slice(0,10);const d=new Date(raw);if(Number.isNaN(d.getTime()))return raw.slice(0,10);const parts=new Intl.DateTimeFormat('en-CA',{timeZone:MANILA_TZ,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);const map=Object.fromEntries(parts.map(p=>[p.type,p.value]));return `${map.year}-${map.month}-${map.day}`;}
function sundayOf(dateStr){const[y,m,d]=dateStr.split('-').map(Number);const dt=new Date(Date.UTC(y,m-1,d));dt.setUTCDate(dt.getUTCDate()-dt.getUTCDay());return dt.toISOString().slice(0,10);}
function addDays(dateStr,n){const[y,m,d]=dateStr.split('-').map(Number);const dt=new Date(Date.UTC(y,m-1,d+n));return dt.toISOString().slice(0,10);}
function matchesPeriod(soldAt,period,target){const d=manilaDateString(soldAt);if(!target)return true;if(period==='daily')return d===target;if(period==='monthly')return d.slice(0,7)===target.slice(0,7);if(period==='yearly')return d.slice(0,4)===target.slice(0,4);if(period==='weekly'){const start=sundayOf(target),end=addDays(start,6);return d>=start&&d<=end;}return d===target;}
function validIsoDate(value){const s=String(value||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;const[y,m,d]=s.split('-').map(Number),dt=new Date(Date.UTC(y,m-1,d));return dt.getUTCFullYear()===y&&dt.getUTCMonth()===m-1&&dt.getUTCDate()===d;}
function reportParams(params){const period=['daily','weekly','monthly','yearly'].includes(params.period)?params.period:'daily';const fallback=new Intl.DateTimeFormat('en-CA',{timeZone:MANILA_TZ}).format(new Date());const raw=String(params.date||fallback).slice(0,10);if(!validIsoDate(raw))throw Object.assign(new Error('Report date must be a valid YYYY-MM-DD date.'),{status:400});const cashier=String(params.cashier||'').trim().toUpperCase();if(cashier.length>80)throw Object.assign(new Error('Cashier filter must be at most 80 characters.'),{status:400});return {period,target:raw,cashier};}
async function periodSales(params){const {period,target,cashier}=reportParams(params);const r=await db.query(`SELECT s.*,CASE WHEN s.promo_id IS NOT NULL THEN COALESCE(s.remark,p.name) ELSE NULL END AS promo_name FROM sales s LEFT JOIN promos p ON p.id=s.promo_id ORDER BY s.sold_at ASC`);const eligible=r.rows.filter(s=>matchesPeriod(s.sold_at,period,target)&&(!cashier||normalize(s.cashier_name_snapshot)===cashier));return {period,target,cashier,eligible,sold:eligible.filter(s=>s.status==='Sold')};}

async function productUnitCosts(conn=db){const r=await conn.query(`SELECT p.id,p.name,COALESCE(SUM(COALESCE(pi.cost_contribution,0)),0) AS unit_cost FROM products p LEFT JOIN product_ingredients pi ON pi.product_id=p.id GROUP BY p.id,p.name`);return new Map(r.rows.map(x=>[Number(x.id),Number(x.unit_cost||0)]));}

async function salesReport(params){
  const scope=await periodSales(params),saleIds=scope.sold.map(s=>Number(s.id));let items=[];
  if(saleIds.length){const r=await db.query(`SELECT id,sale_id,product_id,add_on_id,package_id,product_name_snapshot,quantity,line_total,is_add_on,is_package,exclude_from_costing FROM sale_items WHERE sale_id IN (${placeholders(1,saleIds.length)}) ORDER BY sale_id,id`,saleIds);items=r.rows;}
  const unitCosts=await productUnitCosts();const packageItemIds=items.filter(x=>bool(x.is_package)).map(x=>Number(x.id));const packageCost=new Map();
  if(packageItemIds.length){const c=await db.query(`SELECT c.sale_item_id,c.product_id,c.quantity FROM sale_item_components c WHERE c.sale_item_id IN (${placeholders(1,packageItemIds.length)})`,packageItemIds);for(const x of c.rows)packageCost.set(Number(x.sale_item_id),(packageCost.get(Number(x.sale_item_id))||0)+Number(x.quantity)*Number(unitCosts.get(Number(x.product_id))||0));}
  const bySale=new Map();for(const i of items){const sid=Number(i.sale_id);if(!bySale.has(sid))bySale.set(sid,[]);bySale.get(sid).push(i);}
  const productMap=new Map();
  for(const sale of scope.sold){const saleItems=bySale.get(Number(sale.id))||[];const eligibleAdj=saleItems.filter(i=>!bool(i.is_add_on));const base=eligibleAdj.reduce((a,i)=>a+Number(i.line_total),0);let allocated=0;
    for(let idx=0;idx<saleItems.length;idx++){const i=saleItems[idx];let adj=0;if(!bool(i.is_add_on)&&Math.abs(Number(sale.adjustment||0))>1e-9&&base>0){const isLast=eligibleAdj.indexOf(i)===eligibleAdj.length-1;adj=isLast?money(Number(sale.adjustment)-allocated):money(Number(sale.adjustment)*Number(i.line_total)/base);allocated=money(allocated+adj);}const gross=money(Number(i.line_total)),actual=money(gross+adj);let costing=0;if(bool(i.is_package))costing=money(packageCost.get(Number(i.id))||0);else if(i.product_id)costing=money(Number(unitCosts.get(Number(i.product_id))||0)*Number(i.quantity));const key=`${normalize(i.product_name_snapshot)}|${bool(i.is_package)?'P':bool(i.is_add_on)?'A':'R'}`;if(!productMap.has(key))productMap.set(key,{name:i.product_name_snapshot,qty:0,gross:0,adjusted:0,actual:0,costing:0,net:0,isAddOn:bool(i.is_add_on),isPackage:bool(i.is_package)});const x=productMap.get(key);x.qty+=Number(i.quantity);x.gross=money(x.gross+gross);x.adjusted=money(x.adjusted+adj);x.actual=money(x.actual+actual);x.costing=money(x.costing+costing);x.net=money(x.actual-x.costing);}
  }
  const promoMap=new Map();for(const s of scope.sold){if(!s.promo_name)continue;const key=normalize(s.promo_name);if(!promoMap.has(key))promoMap.set(key,{name:s.promo_name,qty:0,gross:0,adjustment:0,actual:0});const x=promoMap.get(key);x.qty+=1;x.gross=money(x.gross+Number(s.gross));x.adjustment=money(x.adjustment+Number(s.adjustment));x.actual=money(x.actual+Number(s.actual));}
  const sum=f=>money(scope.sold.reduce((a,s)=>a+Number(s[f]||0),0));
  return {period:scope.period,target:scope.target,cashier:scope.cashier||null,transactionCount:scope.sold.length,deletedCount:scope.eligible.length-scope.sold.length,gross:sum('gross'),adjustment:sum('adjustment'),actual:sum('actual'),products:[...productMap.values()].sort((a,b)=>b.qty-a.qty||a.name.localeCompare(b.name)),promos:[...promoMap.values()].sort((a,b)=>b.qty-a.qty||a.name.localeCompare(b.name)),transactions:scope.eligible.map(s=>({reference:s.reference,cashier:s.cashier_name_snapshot,paymentMode:s.payment_mode,paymentReference:s.payment_reference,status:s.status,soldAt:s.sold_at,remark:s.remark,seniorDetails:s.senior_details,gross:Number(s.gross),adjustment:Number(s.adjustment),actual:Number(s.actual)}))};
}

async function getSaleDetail(reference){
  const ref=String(reference||'').trim();
  if(!ref||ref.length>200)throw Object.assign(new Error('Invalid transaction reference.'),{status:400});
  const saleR=await db.query(`SELECT s.*,p.name AS promo_name,du.username AS deleted_by_username
    FROM sales s
    LEFT JOIN promos p ON p.id=s.promo_id
    LEFT JOIN users du ON du.id=s.deleted_by
    WHERE s.reference=$1`,[ref]);
  const s=saleR.rows[0];
  if(!s)throw Object.assign(new Error('Transaction not found.'),{status:404});

  const itemsR=await db.query(`SELECT id,product_id,add_on_id,package_id,product_name_snapshot,quantity,unit_price,line_total,is_add_on,is_package,exclude_from_costing
    FROM sale_items WHERE sale_id=$1 ORDER BY id`,[Number(s.id)]);
  const itemIds=itemsR.rows.map(x=>Number(x.id));
  const componentsByItem=new Map();
  if(itemIds.length){
    const cR=await db.query(`SELECT sale_item_id,product_id,product_name_snapshot,quantity
      FROM sale_item_components WHERE sale_item_id IN (${placeholders(1,itemIds.length)}) ORDER BY sale_item_id,id`,itemIds);
    for(const c of cR.rows){
      const id=Number(c.sale_item_id);if(!componentsByItem.has(id))componentsByItem.set(id,[]);
      componentsByItem.get(id).push({productId:Number(c.product_id),name:c.product_name_snapshot,qty:Number(c.quantity)});
    }
  }
  const items=itemsR.rows.map(i=>({
    id:Number(i.id),name:i.product_name_snapshot,qty:Number(i.quantity),unitPrice:Number(i.unit_price),lineTotal:Number(i.line_total),
    type:bool(i.is_package)?'Package':bool(i.is_add_on)?'Promo Upgrade':'Product',
    isPackage:bool(i.is_package),isAddOn:bool(i.is_add_on),excludeFromCosting:bool(i.exclude_from_costing),
    components:componentsByItem.get(Number(i.id))||[]
  }));

  const movementsR=await db.query(`SELECT m.id,m.movement_type,m.quantity_change,m.balance_after,m.remarks,m.created_at,
      i.display_name,i.uom,u.username AS created_by_username
    FROM inventory_movements m
    JOIN ingredients i ON i.id=m.ingredient_id
    LEFT JOIN users u ON u.id=m.created_by
    WHERE m.reference=$1 ORDER BY m.created_at,m.id`,[ref]);
  const inventoryMovements=movementsR.rows.map(m=>({id:Number(m.id),type:m.movement_type,ingredient:m.display_name,uom:m.uom,quantityChange:Number(m.quantity_change),balanceAfter:m.balance_after==null?null:Number(m.balance_after),remarks:m.remarks,createdBy:m.created_by_username,createdAt:m.created_at}));

  const logsR=await db.query(`SELECT id,activity,actor_name_snapshot,status,remark,created_at
    FROM system_logs WHERE activity LIKE $1 ORDER BY created_at,id`,[`%${ref}%`]);
  const auditEvents=logsR.rows.map(l=>({id:Number(l.id),activity:l.activity,actor:l.actor_name_snapshot,status:l.status,remark:l.remark,createdAt:l.created_at}));

  return {
    reference:s.reference,status:s.status,cashier:s.cashier_name_snapshot||null,soldAt:s.sold_at,
    paymentMode:s.payment_mode,paymentReference:s.payment_reference||null,tender:s.tender==null?null:Number(s.tender),change:Number(s.change_amount||0),
    promo:s.promo_id?{id:Number(s.promo_id),name:s.promo_name||s.remark||'Promo'}:null,
    remark:s.remark||null,seniorDetails:s.senior_details||null,discountAmount:Number(s.discount_amount||0),
    gross:Number(s.gross||0),adjustment:Number(s.adjustment||0),actual:Number(s.actual||0),
    deletedAt:s.deleted_at||null,deletedBy:s.deleted_by_username||null,
    items,inventoryMovements,auditEvents
  };
}

async function costingReport(params){
  const scope=await periodSales(params),saleIds=scope.sold.map(s=>Number(s.id));const qtyByProduct=new Map();if(saleIds.length){const r=await db.query(`SELECT id,product_id,quantity,is_package FROM sale_items WHERE sale_id IN (${placeholders(1,saleIds.length)}) AND is_add_on=$${saleIds.length+1}`,[...saleIds,false]);for(const i of r.rows){if(i.product_id)qtyByProduct.set(Number(i.product_id),(qtyByProduct.get(Number(i.product_id))||0)+Number(i.quantity));}
    const packageIds=r.rows.filter(x=>bool(x.is_package)).map(x=>Number(x.id));if(packageIds.length){const c=await db.query(`SELECT product_id,quantity FROM sale_item_components WHERE sale_item_id IN (${placeholders(1,packageIds.length)})`,packageIds);for(const x of c.rows)qtyByProduct.set(Number(x.product_id),(qtyByProduct.get(Number(x.product_id))||0)+Number(x.quantity));}}
  const pids=[...qtyByProduct.keys()];const groups=new Map();if(pids.length){const r=await db.query(`SELECT pi.product_id,p.name AS product,pi.quantity_required,pi.cost_contribution,i.id AS ingredient_id,i.display_name,i.uom FROM product_ingredients pi JOIN products p ON p.id=pi.product_id JOIN ingredients i ON i.id=pi.ingredient_id WHERE pi.product_id IN (${placeholders(1,pids.length)}) ORDER BY i.id,p.name`,pids);for(const row of r.rows){const productQty=qtyByProduct.get(Number(row.product_id))||0,usage=productQty*Number(row.quantity_required),costPerItem=Number(row.cost_contribution||0),totalCost=money(productQty*costPerItem),iid=Number(row.ingredient_id);if(!groups.has(iid))groups.set(iid,{ingredientId:iid,name:row.display_name,uom:row.uom,totalQty:0,totalCost:0,details:[]});const g=groups.get(iid);g.totalQty+=usage;g.totalCost=money(g.totalCost+totalCost);g.details.push({product:row.product,productQty,quantityRequired:Number(row.quantity_required),usageQty:usage,costPerItem,totalCost});}}
  const ingredients=[...groups.values()].sort((a,b)=>a.name.localeCompare(b.name));return {period:scope.period,target:scope.target,cashier:scope.cashier||null,totalCost:money(ingredients.reduce((a,x)=>a+x.totalCost,0)),ingredients};
}

async function listLogs(limit=300){const n=Math.max(1,Math.min(1000,Number(limit)||300));const r=await db.query(`SELECT id,activity,actor_name_snapshot,status,remark,created_at FROM system_logs ORDER BY created_at DESC LIMIT ${n}`);return r.rows.map(x=>({id:Number(x.id),activity:x.activity,actor:x.actor_name_snapshot,status:x.status,remark:x.remark,createdAt:x.created_at}));}
async function listUsers(){const r=await db.query('SELECT id,username,role,active,created_at,password_hash FROM users ORDER BY id');return r.rows.map(u=>({id:Number(u.id),username:u.username,role:u.role,active:bool(u.active),hasWebPassword:!!u.password_hash,createdAt:u.created_at}));}
async function createOrActivateUser(body,actor=null){
  const username=String(body.username||'').trim(),password=String(body.password||''),role=String(body.role||'User'),active=body.active===undefined?true:!!body.active;
  if(!['Admin','User'].includes(role))throw Object.assign(new Error('Role must be Admin or User.'),{status:400});
  if(username.length<2||username.length>80)throw Object.assign(new Error('Username must be 2-80 characters.'),{status:400});
  if(password.length<8||password.length>256)throw Object.assign(new Error('Password must be 8-256 characters.'),{status:400});
  const existing=await db.query('SELECT id,username,password_hash,role,active FROM users WHERE LOWER(username)=LOWER($1)',[username]);
  if(existing.rows[0]){
    const old=existing.rows[0];
    // Existing web accounts must be changed through the Edit flow. POST is kept
    // only for first-run/legacy Excel accounts that do not yet have a web password.
    if(actor&&old.password_hash)throw Object.assign(new Error('This username already has a web account. Use Edit to change it.'),{status:409});
    if(actor&&Number(old.id)===actor.id&&!active)throw Object.assign(new Error('You cannot deactivate your own signed-in account.'),{status:400});
    if(actor&&old.role==='Admin'&&bool(old.active)&&(role!=='Admin'||!active)){
      const c=await db.query(`SELECT COUNT(*) AS c FROM users WHERE role='Admin' AND active=$1 AND password_hash IS NOT NULL`,[true]);
      if(Number(c.rows[0]?.c||0)<=1)throw Object.assign(new Error('At least one active Web Admin must remain.'),{status:400});
    }
    await db.query('UPDATE users SET password_hash=$1,role=$2,active=$3 WHERE id=$4',[hashPassword(password),role,active,Number(old.id)]);
    await db.query('DELETE FROM sessions WHERE user_id=$1',[Number(old.id)]);
    return{id:Number(old.id),username:old.username,role,active};
  }
  const r=await db.query('INSERT INTO users (username,password_hash,role,active,created_at) VALUES ($1,$2,$3,$4,$5) RETURNING id',[username,hashPassword(password),role,active,nowIso()]);
  return{id:Number(r.rows[0].id),username,role,active};
}
async function updateUserAccount(actor,id,body){const targetR=await db.query('SELECT id,username,role,active FROM users WHERE id=$1',[Number(id)]);const target=targetR.rows[0];if(!target)throw Object.assign(new Error('User not found.'),{status:404});const role=body.role===undefined?target.role:String(body.role),active=typeof body.active==='boolean'?body.active:bool(target.active),password=String(body.password||'');if(!['Admin','User'].includes(role))throw Object.assign(new Error('Role must be Admin or User.'),{status:400});if(Number(id)===actor.id&&!active)throw Object.assign(new Error('You cannot deactivate your own signed-in account.'),{status:400});if((target.role==='Admin'&&bool(target.active))&&(role!=='Admin'||!active)){const c=await db.query(`SELECT COUNT(*) AS c FROM users WHERE role='Admin' AND active=$1 AND password_hash IS NOT NULL`,[true]);if(Number(c.rows[0].c)<=1)throw Object.assign(new Error('At least one active Web Admin must remain.'),{status:400});}if(password&&(password.length<8||password.length>256))throw Object.assign(new Error('Password must be 8-256 characters.'),{status:400});if(password)await db.query('UPDATE users SET role=$1,active=$2,password_hash=$3 WHERE id=$4',[role,active,hashPassword(password),Number(id)]);else await db.query('UPDATE users SET role=$1,active=$2 WHERE id=$3',[role,active,Number(id)]);if(!active||(password&&Number(id)!==actor.id))await db.query('DELETE FROM sessions WHERE user_id=$1',[Number(id)]);await logAction(actor,`Web user updated: ${target.username}`,'User Updated',`${role} / ${active?'Active':'Inactive'}`);return{ok:true};}

async function listAdminProducts(){const r=await db.query(`SELECT p.id,p.sku,p.name,p.category,p.price,p.active,p.created_at,p.updated_at,COUNT(pi.ingredient_id) AS recipe_count,COALESCE(SUM(COALESCE(pi.cost_contribution,0)),0) AS unit_cost FROM products p LEFT JOIN product_ingredients pi ON pi.product_id=p.id GROUP BY p.id,p.sku,p.name,p.category,p.price,p.active,p.created_at,p.updated_at ORDER BY p.category,p.name`);return r.rows.map(x=>({id:Number(x.id),sku:x.sku,name:x.name,category:x.category,price:Number(x.price),active:bool(x.active),recipeCount:Number(x.recipe_count||0),unitCost:Number(x.unit_cost||0)}));}
function validCategory(c){return['Coffee','Non Coffee','Food'].includes(c);}
function slug(s){return normalize(s).replace(/[^A-Z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,70)||'ITEM';}
async function createProduct(user,body){const name=String(body.name||'').trim(),category=String(body.category||''),price=Number(body.price);if(!name||name.length>150||!validCategory(category)||!Number.isFinite(price)||price<0||price>MAX_MONEY)throw Object.assign(new Error('Product name (max 150 characters), valid category, and a supported non-negative price are required.'),{status:400});const dup=await db.query('SELECT id FROM products WHERE LOWER(name)=LOWER($1)',[name]);if(dup.rows.length)throw Object.assign(new Error('Product name already exists.'),{status:409});const active=body.active===undefined?true:!!body.active;const sku=`WEB-${slug(name)}-${Date.now().toString(36).toUpperCase()}`;const r=await db.query('INSERT INTO products (sku,name,category,price,active,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',[sku,name,category,money(price),active,nowIso(),nowIso()]);await logAction(user,`Product added: ${name}`,'Product Added',category);return{id:Number(r.rows[0].id)};}
async function activePackagesUsingProduct(productId,conn=db){const r=await conn.query(`SELECT p.name FROM package_items pi JOIN packages p ON p.id=pi.package_id WHERE pi.product_id=$1 AND p.active=$2 ORDER BY p.name`,[Number(productId),true]);return r.rows.map(x=>x.name);}
async function assertProductCanDeactivate(productId,conn=db){const packages=await activePackagesUsingProduct(productId,conn);if(packages.length)throw Object.assign(new Error(`This product is used by active package(s): ${packages.slice(0,5).join(', ')}. Remove it from those package compositions or disable the packages first.`),{status:409});}
async function updateProduct(user,id,body){const r=await db.query('SELECT * FROM products WHERE id=$1',[Number(id)]);const p=r.rows[0];if(!p)throw Object.assign(new Error('Product not found.'),{status:404});const category=body.category===undefined?p.category:String(body.category),price=body.price===undefined?Number(p.price):Number(body.price),active=body.active===undefined?bool(p.active):!!body.active;if(!validCategory(category)||!Number.isFinite(price)||price<0||price>MAX_MONEY)throw Object.assign(new Error('Invalid product update.'),{status:400});if(bool(p.active)&&!active)await assertProductCanDeactivate(Number(id));await db.query('UPDATE products SET category=$1,price=$2,active=$3,updated_at=$4 WHERE id=$5',[category,money(price),active,nowIso(),Number(id)]);await logAction(user,`Product updated: ${p.name}`,'Product Updated',`${category} / PHP ${money(price)}`);return{ok:true};}
async function archiveProduct(user,id){const r=await db.query('SELECT name,active FROM products WHERE id=$1',[Number(id)]);if(!r.rows[0])throw Object.assign(new Error('Product not found.'),{status:404});if(bool(r.rows[0].active))await assertProductCanDeactivate(Number(id));await db.query('UPDATE products SET active=$1,updated_at=$2 WHERE id=$3',[false,nowIso(),Number(id)]);await logAction(user,`Product archived: ${r.rows[0].name}`,'Product Archived',null);return{ok:true};}
async function getRecipe(productId){const p=await db.query('SELECT id,name FROM products WHERE id=$1',[Number(productId)]);if(!p.rows[0])throw Object.assign(new Error('Product not found.'),{status:404});const r=await db.query(`SELECT pi.ingredient_id,i.code,i.display_name,i.uom,pi.quantity_required,pi.cost_contribution FROM product_ingredients pi JOIN ingredients i ON i.id=pi.ingredient_id WHERE pi.product_id=$1 ORDER BY i.id`,[Number(productId)]);return{product:{id:Number(p.rows[0].id),name:p.rows[0].name},items:r.rows.map(x=>({ingredientId:Number(x.ingredient_id),code:x.code,name:x.display_name,uom:x.uom,quantity:Number(x.quantity_required),cost:x.cost_contribution===null?null:Number(x.cost_contribution)}))};}
async function saveRecipe(user,productId,body){const p=await db.query('SELECT id,name FROM products WHERE id=$1',[Number(productId)]);if(!p.rows[0])throw Object.assign(new Error('Product not found.'),{status:404});const items=Array.isArray(body.items)?body.items:[];const seen=new Set();for(const x of items){const iid=Number(x.ingredientId),qty=Number(x.quantity),cost=x.cost===null||x.cost===''?null:Number(x.cost);if(!Number.isInteger(iid)||iid<=0||!Number.isFinite(qty)||!(qty>0)||qty>MAX_RECIPE_VALUE||(cost!==null&&(!Number.isFinite(cost)||cost<0||cost>MAX_RECIPE_VALUE)))throw Object.assign(new Error('Every recipe row needs an ingredient, quantity greater than zero, and optional non-negative cost.'),{status:400});if(seen.has(iid))throw Object.assign(new Error('An ingredient can appear only once in a product recipe.'),{status:400});seen.add(iid);}await db.transaction(async tx=>{await tx.query('DELETE FROM product_ingredients WHERE product_id=$1',[Number(productId)]);for(const x of items){const check=await tx.query('SELECT id,active FROM ingredients WHERE id=$1',[Number(x.ingredientId)]);if(!check.rows.length)throw Object.assign(new Error('Recipe ingredient not found.'),{status:404});if(!bool(check.rows[0].active))throw Object.assign(new Error('Archived ingredients cannot be added to a recipe.'),{status:409});await tx.query('INSERT INTO product_ingredients (product_id,ingredient_id,quantity_required,cost_contribution) VALUES ($1,$2,$3,$4)',[Number(productId),Number(x.ingredientId),Number(x.quantity),x.cost===null||x.cost===''?null:Number(x.cost)]);}await logAction(user,`Recipe saved: ${p.rows[0].name}`,'Recipe Updated',`${items.length} ingredient(s)`,tx);});return{ok:true};}

async function listAdminIngredients(){return getInventory(true);}
async function createIngredient(user,body){const name=String(body.name||'').trim(),uom=String(body.uom||'').trim(),threshold=Number(body.lowStockThreshold||0);if(!name||name.length>150)throw Object.assign(new Error('Ingredient name is required and must be at most 150 characters.'),{status:400});if(uom.length>40)throw Object.assign(new Error('UOM is too long.'),{status:400});if(!Number.isFinite(threshold)||threshold<0||threshold>MAX_STOCK)throw Object.assign(new Error('Low-stock threshold must be zero or greater and within the supported stock range.'),{status:400});const active=body.active===undefined?true:!!body.active;const code=`ING_WEB_${Date.now().toString(36).toUpperCase()}_${slug(name).slice(0,35)}`;const r=await db.query('INSERT INTO ingredients (code,display_name,uom,stock_qty,low_stock_threshold,active,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',[code,name,uom,0,threshold,active,nowIso()]);await logAction(user,`Ingredient added: ${name}`,'Ingredient Added',uom.toUpperCase());return{id:Number(r.rows[0].id),code};}
async function updateIngredient(user,id,body){const r=await db.query('SELECT * FROM ingredients WHERE id=$1',[Number(id)]);const ing=r.rows[0];if(!ing)throw Object.assign(new Error('Ingredient not found.'),{status:404});const name=body.name===undefined?ing.display_name:String(body.name).trim(),uom=body.uom===undefined?ing.uom:String(body.uom).trim(),threshold=body.lowStockThreshold===undefined?Number(ing.low_stock_threshold):Number(body.lowStockThreshold),active=body.active===undefined?bool(ing.active):!!body.active;if(!name||name.length>150||uom.length>40||!Number.isFinite(threshold)||threshold<0||threshold>MAX_STOCK)throw Object.assign(new Error('Invalid ingredient update. Name max 150 characters; UOM max 40; threshold must be zero or greater.'),{status:400});if(bool(ing.active)&&!active){const used=await db.query('SELECT COUNT(*) AS c FROM product_ingredients WHERE ingredient_id=$1',[Number(id)]);if(Number(used.rows[0]?.c||0)>0)throw Object.assign(new Error('This ingredient is still used by one or more product recipes. Remove it from those recipes before disabling it.'),{status:409});}await db.query('UPDATE ingredients SET display_name=$1,uom=$2,low_stock_threshold=$3,active=$4,updated_at=$5 WHERE id=$6',[name,uom,threshold,active,nowIso(),Number(id)]);await logAction(user,`Ingredient updated: ${name}`,'Ingredient Updated',`${String(uom).toUpperCase()} / low ${threshold}`);return{ok:true};}
async function archiveIngredient(user,id){const r=await db.query('SELECT display_name FROM ingredients WHERE id=$1',[Number(id)]);if(!r.rows[0])throw Object.assign(new Error('Ingredient not found.'),{status:404});const used=await db.query('SELECT COUNT(*) AS c FROM product_ingredients WHERE ingredient_id=$1',[Number(id)]);if(Number(used.rows[0].c)>0)throw Object.assign(new Error('This ingredient is still used by one or more product recipes. Remove it from those recipes first.'),{status:409});await db.query('UPDATE ingredients SET active=$1,updated_at=$2 WHERE id=$3',[false,nowIso(),Number(id)]);await logAction(user,`Ingredient archived: ${r.rows[0].display_name}`,'Ingredient Archived',null);return{ok:true};}

async function listAdminPromos(){const r=await db.query('SELECT id,name,inclusion_label,promo_price,food_limit,coffee_limit,active FROM promos ORDER BY id');return r.rows.map(x=>({id:Number(x.id),name:x.name,inclusion:x.inclusion_label,price:Number(x.promo_price),foodLimit:Number(x.food_limit||0),coffeeLimit:Number(x.coffee_limit||0),active:bool(x.active)}));}
async function savePromo(user,id,body){const name=String(body.name||'').trim(),inclusion=String(body.inclusion||'').trim(),price=Number(body.price),foodLimit=Number(body.foodLimit||0),coffeeLimit=Number(body.coffeeLimit||0),active=body.active===undefined?true:!!body.active;if(!name||name.length>150||!inclusion||inclusion.length>100||!Number.isFinite(price)||price<0||price>MAX_MONEY||!Number.isInteger(foodLimit)||foodLimit<0||!Number.isInteger(coffeeLimit)||coffeeLimit<0||foodLimit+coffeeLimit<1)throw Object.assign(new Error('Promo name (max 150), inclusion (max 100), price, and whole-number limits are required; at least one Food or Coffee item must be included.'),{status:400});if(id){const old=await db.query('SELECT name FROM promos WHERE id=$1',[Number(id)]);if(!old.rows[0])throw Object.assign(new Error('Promo not found.'),{status:404});const dup=await db.query('SELECT id FROM promos WHERE LOWER(name)=LOWER($1) AND id<>$2',[name,Number(id)]);if(dup.rows.length)throw Object.assign(new Error('Promo name already exists.'),{status:409});await db.query('UPDATE promos SET name=$1,inclusion_label=$2,promo_price=$3,food_limit=$4,coffee_limit=$5,active=$6 WHERE id=$7',[name,inclusion,money(price),foodLimit,coffeeLimit,active,Number(id)]);await logAction(user,`Promo updated: ${name}`,'Promo Updated',inclusion);return{ok:true};}const dup=await db.query('SELECT id FROM promos WHERE LOWER(name)=LOWER($1)',[name]);if(dup.rows.length)throw Object.assign(new Error('Promo name already exists.'),{status:409});const r=await db.query('INSERT INTO promos (name,inclusion_label,promo_price,food_limit,coffee_limit,active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',[name,inclusion,money(price),foodLimit,coffeeLimit,active]);await logAction(user,`Promo added: ${name}`,'Promo Added',inclusion);return{id:Number(r.rows[0].id)};}
async function archivePromo(user,id){const r=await db.query('SELECT name FROM promos WHERE id=$1',[Number(id)]);if(!r.rows[0])throw Object.assign(new Error('Promo not found.'),{status:404});await db.query('UPDATE promos SET active=$1 WHERE id=$2',[false,Number(id)]);await logAction(user,`Promo disabled: ${r.rows[0].name}`,'Promo Disabled',null);return{ok:true};}

async function listAdminPackages(){const r=await db.query('SELECT id,name,price,active FROM packages ORDER BY id');const c=await db.query(`SELECT pi.package_id,pi.product_id,pi.quantity,p.name AS product_name FROM package_items pi JOIN products p ON p.id=pi.product_id ORDER BY pi.package_id,p.name`);const map=new Map();for(const x of c.rows){const id=Number(x.package_id);if(!map.has(id))map.set(id,[]);map.get(id).push({productId:Number(x.product_id),name:x.product_name,qty:Number(x.quantity)});}return r.rows.map(x=>({id:Number(x.id),name:x.name,price:Number(x.price),active:bool(x.active),items:map.get(Number(x.id))||[]}));}
async function savePackage(user,id,body){const name=String(body.name||'').trim(),price=Number(body.price),active=body.active===undefined?true:!!body.active;if(!name||name.length>150||!Number.isFinite(price)||price<0||price>MAX_MONEY)throw Object.assign(new Error('Package name (max 150 characters) and a supported non-negative price are required.'),{status:400});let packageId=Number(id)||null;if(packageId){const old=await db.query('SELECT id FROM packages WHERE id=$1',[packageId]);if(!old.rows.length)throw Object.assign(new Error('Package not found.'),{status:404});const dup=await db.query('SELECT id FROM packages WHERE LOWER(name)=LOWER($1) AND id<>$2',[name,packageId]);if(dup.rows.length)throw Object.assign(new Error('Package name already exists.'),{status:409});await db.query('UPDATE packages SET name=$1,price=$2,active=$3 WHERE id=$4',[name,money(price),active,packageId]);}else{const dup=await db.query('SELECT id FROM packages WHERE LOWER(name)=LOWER($1)',[name]);if(dup.rows.length)throw Object.assign(new Error('Package name already exists.'),{status:409});const r=await db.query('INSERT INTO packages (name,price,active) VALUES ($1,$2,$3) RETURNING id',[name,money(price),active]);packageId=Number(r.rows[0].id);}await logAction(user,`${id?'Package updated':'Package added'}: ${name}`,id?'Package Updated':'Package Added',null);return{id:packageId};}
async function savePackageComposition(user,id,body){const p=await db.query('SELECT id,name FROM packages WHERE id=$1',[Number(id)]);if(!p.rows[0])throw Object.assign(new Error('Package not found.'),{status:404});const items=Array.isArray(body.items)?body.items:[];const seen=new Set();for(const x of items){const pid=Number(x.productId),qty=Number(x.qty);if(!Number.isInteger(pid)||pid<=0||!Number.isInteger(qty)||!(qty>0)||qty>MAX_PACKAGE_QTY)throw Object.assign(new Error('Every package item requires a product and a positive whole-number quantity within the supported range.'),{status:400});if(seen.has(pid))throw Object.assign(new Error('A product can appear only once in a package.'),{status:400});seen.add(pid);}await db.transaction(async tx=>{await tx.query('DELETE FROM package_items WHERE package_id=$1',[Number(id)]);for(const x of items){const check=await tx.query('SELECT id,active FROM products WHERE id=$1',[Number(x.productId)]);if(!check.rows.length)throw Object.assign(new Error('Package product not found.'),{status:404});if(!bool(check.rows[0].active))throw Object.assign(new Error('Archived products cannot be added to a package.'),{status:409});await tx.query('INSERT INTO package_items (package_id,product_id,quantity) VALUES ($1,$2,$3)',[Number(id),Number(x.productId),Number(x.qty)]);}await logAction(user,`Package composition saved: ${p.rows[0].name}`,'Package Composition',`${items.length} product(s)`,tx);});return{ok:true};}
async function archivePackage(user,id){const r=await db.query('SELECT name FROM packages WHERE id=$1',[Number(id)]);if(!r.rows[0])throw Object.assign(new Error('Package not found.'),{status:404});await db.query('UPDATE packages SET active=$1 WHERE id=$2',[false,Number(id)]);await logAction(user,`Package disabled: ${r.rows[0].name}`,'Package Disabled',null);return{ok:true};}

async function getSetting(key, fallback=null){const r=await db.query('SELECT setting_value FROM app_settings WHERE setting_key=$1',[key]);return r.rows[0]?.setting_value??fallback;}
async function setSetting(key,value){await db.query(`INSERT INTO app_settings (setting_key,setting_value,updated_at) VALUES ($1,$2,$3) ON CONFLICT (setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_at=excluded.updated_at`,[key,value,nowIso()]);}
async function getSettings(){return{shopName:await getSetting('shop_name','Don Macchiatos'),defaultReportEmail:await getSetting('default_report_email',process.env.REPORT_EMAIL_TO||''),smtp:{configured:!!(process.env.SMTP_USER&&process.env.SMTP_PASS),host:process.env.SMTP_HOST||'smtp.gmail.com',port:Number(process.env.SMTP_PORT||465),user:process.env.SMTP_USER||''},appVersion:APP_VERSION};}
async function saveSettings(user,body){const shopName=String(body.shopName||'').trim()||'Don Macchiatos',email=String(body.defaultReportEmail||'').trim();if(shopName.length>100)throw Object.assign(new Error('Shop name must be at most 100 characters.'),{status:400});if(email.length>320||email&& !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Object.assign(new Error('Default report email is invalid.'),{status:400});await setSetting('shop_name',shopName);await setSetting('default_report_email',email);await logAction(user,'Application settings updated','Settings Updated',email||'No default report email');return getSettings();}

function titleCase(s){return String(s||'').replace(/\b\w/g,c=>c.toUpperCase());}
function reportFilename(report,kind='sales'){const safeDate=String(report.target||'report').replace(/[^0-9-]/g,'');return `${kind==='costing'?'Costing':'Sales'}_${titleCase(report.period)}_${safeDate}.pdf`;}
async function salesPdf(params){const report=await salesReport(params);const shop=await getSetting('shop_name','Don Macchiatos');const title=`${shop} - ${titleCase(report.period)} Sales Report`;return{report,filename:reportFilename(report,'sales'),buffer:makePdf(salesReportLines(report,title),{title})};}
async function costingPdf(params){const report=await costingReport(params);const shop=await getSetting('shop_name','Don Macchiatos');const title=`${shop} - ${titleCase(report.period)} Costing Report`;return{report,filename:reportFilename(report,'costing'),buffer:makePdf(costingReportLines(report,title),{title})};}
async function emailSalesReport(user,body){const params={period:body.period,date:body.date,cashier:body.cashier};const {report,filename,buffer}=await salesPdf(params);const settings=await getSettings();let to=settings.defaultReportEmail;if(user.role==='Admin'&&String(body.to||'').trim())to=String(body.to).trim();if(!to)throw Object.assign(new Error('Configure a default report recipient first.'),{status:400});if(to.length>320||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to))throw Object.assign(new Error('Report recipient email is invalid.'),{status:400});if(!process.env.SMTP_USER||!process.env.SMTP_PASS)throw Object.assign(new Error('Email is not configured on the server. Set SMTP_USER and SMTP_PASS in the server environment.'),{status:503});const daily=report.period==='daily';const subject=daily?'Daily Report Notification':`${titleCase(report.period)} Report Notification`;const bodyText=daily?'Hello, attached are the daily reports.':`Hello, attached are the ${report.period} reports.`;try{await sendMail({host:process.env.SMTP_HOST||'smtp.gmail.com',port:Number(process.env.SMTP_PORT||465),user:process.env.SMTP_USER,pass:process.env.SMTP_PASS,from:process.env.SMTP_FROM||process.env.SMTP_USER,to,subject,text:bodyText,attachments:[{filename,contentType:'application/pdf',data:buffer}]});await logAction(user,`Report emailed: ${filename}`,'Email Sent',to);return{ok:true,to,filename};}catch(err){await logAction(user,`Report email failed: ${filename}`,'Email Failed',err.message);const e=new Error('Unable to send the report email. Please check the server internet/SMTP settings and try again.');e.status=502;e.details={reason:err.message};throw e;}}

async function dashboardData(){
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:MANILA_TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const todayR=await salesReport({period:'daily',date:today});const monthR=await salesReport({period:'monthly',date:today});
  const salesR=await db.query(`SELECT id,sold_at,actual,gross,status FROM sales WHERE status=$1 ORDER BY sold_at ASC`,['Sold']);
  const end=today,start=addDays(today,-29),trendMap=new Map();for(let d=start;d<=end;d=addDays(d,1))trendMap.set(d,{date:d,actual:0,transactions:0});for(const s of salesR.rows){const d=manilaDateString(s.sold_at);if(d>=start&&d<=end&&trendMap.has(d)){const x=trendMap.get(d);x.actual=money(x.actual+Number(s.actual));x.transactions++;}}
  const inv=await getInventory();const lowStock=inv.filter(x=>x.low).sort((a,b)=>a.stock-b.stock).slice(0,10);
  const topProducts=monthR.products.filter(x=>!x.isAddOn).sort((a,b)=>b.qty-a.qty).slice(0,8);
  const saleIds=[];const monthScope=await periodSales({period:'monthly',date:today});for(const s of monthScope.sold)saleIds.push(Number(s.id));const categoryMap=new Map();if(saleIds.length){const r=await db.query(`SELECT si.line_total,si.is_add_on,si.is_package,p.category FROM sale_items si LEFT JOIN products p ON p.id=si.product_id WHERE si.sale_id IN (${placeholders(1,saleIds.length)})`,saleIds);for(const x of r.rows){const cat=bool(x.is_add_on)?'Add-ons':bool(x.is_package)?'Packages':x.category||'Other';categoryMap.set(cat,money((categoryMap.get(cat)||0)+Number(x.line_total)));}}
  return{today,metrics:{todayActual:todayR.actual,todayGross:todayR.gross,todayTransactions:todayR.transactionCount,monthActual:monthR.actual,monthTransactions:monthR.transactionCount,lowStockCount:inv.filter(x=>x.low).length},trend:[...trendMap.values()],topProducts:topProducts.map(x=>({name:x.name,qty:x.qty,actual:x.actual})),lowStock,categorySales:[...categoryMap].map(([name,amount])=>({name,amount}))};
}

function safeBackupName(name){const base=path.basename(String(name||''));if(!/^[A-Za-z0-9._-]+\.sqlite$/.test(base))throw Object.assign(new Error('Invalid backup file name.'),{status:400});return base;}
async function listBackups(){fs.mkdirSync(BACKUP_DIR,{recursive:true});if(db.engine!=='sqlite')return{supported:false,engine:db.engine,items:[],note:'Use managed PostgreSQL backups or pg_dump for production PostgreSQL.'};const items=fs.readdirSync(BACKUP_DIR).filter(x=>x.endsWith('.sqlite')).map(name=>{const st=fs.statSync(path.join(BACKUP_DIR,name));return{name,size:st.size,createdAt:st.mtime.toISOString()};}).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));return{supported:true,engine:db.engine,items};}
async function createBackup(user,prefix='manual'){if(db.engine!=='sqlite'||!db.backupTo)throw Object.assign(new Error('In-app backup is available in SQLite mode. Use PostgreSQL provider backups/pg_dump in production.'),{status:400});fs.mkdirSync(BACKUP_DIR,{recursive:true});const stamp=new Date().toISOString().replace(/[:.]/g,'-');const name=`${prefix}-${stamp}.sqlite`,dest=path.join(BACKUP_DIR,name);await db.backupTo(dest);if(user)await logAction(user,`Database backup created: ${name}`,'Database Saved',null);const autos=fs.readdirSync(BACKUP_DIR).filter(x=>x.startsWith('auto-')&&x.endsWith('.sqlite')).sort().reverse();for(const old of autos.slice(30))try{fs.unlinkSync(path.join(BACKUP_DIR,old));}catch(_){}return{name,size:fs.statSync(dest).size};}
async function ensureAutomaticBackup(){if(db.engine!=='sqlite'||!db.backupTo)return;fs.mkdirSync(BACKUP_DIR,{recursive:true});const day=new Intl.DateTimeFormat('en-CA',{timeZone:MANILA_TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());const exists=fs.readdirSync(BACKUP_DIR).some(x=>x.startsWith(`auto-${day}`));if(!exists){const name=`auto-${day}-${new Date().toISOString().slice(11,19).replace(/:/g,'-')}.sqlite`;await db.backupTo(path.join(BACKUP_DIR,name));}}
async function restoreBackup(user,name){
  if(db.engine!=='sqlite'||!db.filePath)throw Object.assign(new Error('In-app restore is available only in SQLite mode.'),{status:400});
  if(maintenanceMode)throw Object.assign(new Error('Database maintenance is already in progress.'),{status:409});
  name=safeBackupName(name);const source=path.join(BACKUP_DIR,name);if(!fs.existsSync(source))throw Object.assign(new Error('Backup file not found.'),{status:404});
  maintenanceMode=true;
  const dbPath=db.filePath;
  let recovery=null;
  try{
    recovery=await createBackup(user,'pre-restore');
    const incoming=dbPath+'.restore-incoming';
    fs.copyFileSync(source,incoming);
    await db.close();
    for(const suffix of ['-wal','-shm'])try{fs.unlinkSync(dbPath+suffix);}catch(_){}
    try{fs.unlinkSync(dbPath);}catch(_){}
    fs.renameSync(incoming,dbPath);
    db=await createDb();await initSchema();await migrateSchema();await seedDatabase();await db.query('DELETE FROM sessions');
    await logAction({id:null,username:user.username},`Database restored from: ${name}`,'Restored','Automatic pre-restore backup created; all web sessions cleared');
    return{ok:true,name,requiresRelogin:true};
  }catch(err){
    // Restore failures must never leave the shop without a usable database. Recover
    // the exact pre-restore snapshot before allowing new requests through.
    try{await db?.close?.();}catch(_){}
    if(recovery?.name){
      try{
        const recoveryFile=path.join(BACKUP_DIR,recovery.name);
        for(const suffix of ['-wal','-shm'])try{fs.unlinkSync(dbPath+suffix);}catch(_){}
        fs.copyFileSync(recoveryFile,dbPath);
        db=await createDb();await initSchema();await migrateSchema();await seedDatabase();
      }catch(recoveryErr){
        console.error('CRITICAL: restore recovery failed:',recoveryErr);
        err.message=`${err.message} Recovery also failed; use the pre-restore backup file manually.`;
      }
    }
    throw err;
  }finally{
    try{fs.unlinkSync(dbPath+'.restore-incoming');}catch(_){}
    maintenanceMode=false;
  }
}

async function deleteSale(user,reference,body){
  if(typeof body.restoreStock!=='boolean')throw Object.assign(new Error('Specify whether stock should be restored.'),{status:400});
  return db.transaction(async tx=>{
    const sR=await tx.query('SELECT * FROM sales WHERE reference=$1',[reference]),sale=sR.rows[0];
    if(!sale)throw Object.assign(new Error('Sale not found.'),{status:404});
    if(sale.status==='Deleted')throw Object.assign(new Error('Sale is already deleted.'),{status:409});
    let restoredIngredients=0,restoredQuantity=0,restoreNote='Stock not restored';
    if(body.restoreStock){
      const movements=await tx.query(`SELECT ingredient_id,SUM(quantity_change) AS net_change FROM inventory_movements WHERE reference=$1 AND movement_type='SALE' GROUP BY ingredient_id`,[reference]);
      for(const m of movements.rows){
        const deducted=Math.max(0,-Number(m.net_change||0));if(!(deducted>0))continue;
        const iid=Number(m.ingredient_id),lock=tx.engine==='postgres'?' FOR UPDATE':'';
        const cr=await tx.query(`SELECT stock_qty,display_name FROM ingredients WHERE id=$1${lock}`,[iid]);if(!cr.rows[0])continue;
        const balance=Number(cr.rows[0].stock_qty||0)+deducted;
        await tx.query('UPDATE ingredients SET stock_qty=$1,updated_at=$2 WHERE id=$3',[balance,nowIso(),iid]);
        await tx.query(`INSERT INTO inventory_movements (ingredient_id,movement_type,quantity_change,balance_after,reference,remarks,created_by,created_at) VALUES ($1,'SALE_REVERSAL',$2,$3,$4,$5,$6,$7)`,[iid,deducted,balance,reference,'Stock restored from original sale deduction',user.id,nowIso()]);
        restoredIngredients++;restoredQuantity+=deducted;
      }
      restoreNote=restoredIngredients?`Stock restored from original sale movements (${restoredIngredients} ingredient(s))`:'No original web stock deduction was found; stock left unchanged';
    }
    await tx.query('UPDATE sales SET status=$1,deleted_at=$2,deleted_by=$3 WHERE id=$4',['Deleted',nowIso(),user.id,Number(sale.id)]);
    await logAction(user,`Sale deleted: ${reference}`,'Deleted',restoreNote,tx);
    return{reference,status:'Deleted',stockRestored:body.restoreStock&&restoredIngredients>0,restoredIngredients,restoredQuantity:money(restoredQuantity),restoreNote};
  });
}

function mimeType(file){const ext=path.extname(file).toLowerCase();return({'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'})[ext]||'application/octet-stream';}
function safeHeaders(extra={}){return{'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Frame-Options':'DENY','Permissions-Policy':'camera=(), microphone=(), geolocation=()','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",...extra};}
function binary(res,status,buffer,contentType,headers={}){res.writeHead(status,safeHeaders({'Content-Type':contentType,'Content-Length':buffer.length,...headers}));res.end(buffer);}
function serveStatic(req,res,pathname){const rel=pathname==='/'?'index.html':decodeURIComponent(pathname).replace(/^\/+/,''),file=path.resolve(PUBLIC_DIR,rel);if(!file.startsWith(path.resolve(PUBLIC_DIR)+path.sep)&&file!==path.join(PUBLIC_DIR,'index.html'))return false;if(!fs.existsSync(file)||!fs.statSync(file).isFile())return false;const data=fs.readFileSync(file);res.writeHead(200,safeHeaders({'Content-Type':mimeType(file),'Content-Length':data.length,'Cache-Control':'no-store'}));res.end(data);return true;}

const loginAttempts=new Map();
function loginRateKey(req,username){return `${req.socket.remoteAddress||'local'}|${normalize(username).slice(0,80)}`;}
function checkLoginRate(req,username){const key=loginRateKey(req,username),now=Date.now(),windowMs=10*60*1000,max=20;const arr=(loginAttempts.get(key)||[]).filter(t=>now-t<windowMs);if(arr.length>=max)throw Object.assign(new Error('Too many login attempts for this account. Please try again later.'),{status:429});arr.push(now);loginAttempts.set(key,arr);}
function clearLoginRate(req,username){loginAttempts.delete(loginRateKey(req,username));}

async function handleApi(req,res,url){
  const p=url.pathname,method=req.method;
  if(maintenanceMode)return json(res,503,{error:'Database maintenance is in progress. Please retry in a moment.'},safeHeaders({'Retry-After':'2'}));
  if(method==='GET'&&p==='/api/status')return json(res,200,{...(await appStatus()),version:APP_VERSION},safeHeaders());
  if(method==='GET'&&p==='/api/health'){const probe=await db.query('SELECT 1 AS ok');return json(res,200,{ok:Number(probe.rows[0]?.ok||0)===1,app:'coffee-pos-web',version:APP_VERSION,engine:db.engine,time:nowIso(),uptimeSeconds:Math.round(process.uptime())},safeHeaders({'Cache-Control':'no-store'}));}
  if(method==='POST'&&p==='/api/setup'){const status=await appStatus();if(!status.setupRequired)return json(res,409,{error:'Initial setup has already been completed.'},safeHeaders());const body=await readJson(req),username=String(body.username||'').trim(),password=String(body.password||'');if(username.length<2||password.length<8)return json(res,400,{error:'Use a username of at least 2 characters and a password of at least 8 characters.'},safeHeaders());const user=await createOrActivateUser({username,password,role:'Admin',active:true},null);await logAction(user,'Web POS initial admin activated','Setup',null);return json(res,201,{ok:true,user},safeHeaders());}
  if(method==='POST'&&p==='/api/auth/login'){const body=await readJson(req),username=String(body.username||'').trim();checkLoginRate(req,username);const r=await db.query('SELECT id,username,password_hash,role,active FROM users WHERE LOWER(username)=LOWER($1)',[username]);const u=r.rows[0];if(!u||!bool(u.active)||!verifyPassword(String(body.password||''),u.password_hash))return json(res,401,{error:'Invalid username or password.'},safeHeaders());clearLoginRate(req,username);const token=crypto.randomBytes(32).toString('hex'),expires=new Date(Date.now()+SESSION_HOURS*3600*1000).toISOString();await db.query('DELETE FROM sessions WHERE user_id=$1 OR expires_at<$2',[Number(u.id),nowIso()]);await db.query('INSERT INTO sessions (token_hash,user_id,expires_at,created_at) VALUES ($1,$2,$3,$4)',[hashToken(token),Number(u.id),expires,nowIso()]);return json(res,200,{user:{id:Number(u.id),username:u.username,role:u.role}},safeHeaders({'Set-Cookie':cookieHeader(token,SESSION_HOURS*3600)}));}
  if(method==='POST'&&p==='/api/auth/logout'){const token=parseCookies(req).pos_session;if(token)await db.query('DELETE FROM sessions WHERE token_hash=$1',[hashToken(token)]);return json(res,200,{ok:true},safeHeaders({'Set-Cookie':cookieHeader('',0)}));}
  if(method==='GET'&&p==='/api/auth/me'){const user=await getUser(req);return user?json(res,200,{user},safeHeaders()):json(res,401,{error:'Not signed in.'},safeHeaders());}
  const user=await requireUser(req,res);if(!user)return;
  if(method==='GET'&&p==='/api/catalog')return json(res,200,await getCatalog(),safeHeaders());
  if(method==='POST'&&p==='/api/quote')return json(res,200,await quoteOrder(db,await readJson(req)),safeHeaders());
  if(method==='POST'&&p==='/api/sales')return json(res,201,await createSale(user,await readJson(req)),safeHeaders());
  const saleDetail=p.match(/^\/api\/sales\/([^/]+)$/);if(method==='GET'&&saleDetail)return json(res,200,await getSaleDetail(decodeURIComponent(saleDetail[1])),safeHeaders());
  if(method==='GET'&&p==='/api/inventory')return json(res,200,{items:await getInventory()},safeHeaders());
  if(method==='GET'&&p==='/api/inventory/movements')return json(res,200,{items:await listInventoryMovements(url.searchParams.get('limit'))},safeHeaders());
  if(method==='POST'&&p==='/api/inventory/replenish')return json(res,201,await replenish(user,await readJson(req)),safeHeaders());
  if(method==='POST'&&p==='/api/inventory/transfer')return json(res,201,await transfer(user,await readJson(req)),safeHeaders());
  if(method==='GET'&&p==='/api/dashboard')return json(res,200,await dashboardData(),safeHeaders());
  if(method==='GET'&&p==='/api/reports/sales')return json(res,200,await salesReport(Object.fromEntries(url.searchParams)),safeHeaders());
  if(method==='GET'&&p==='/api/reports/costing')return json(res,200,await costingReport(Object.fromEntries(url.searchParams)),safeHeaders());
  if(method==='GET'&&p==='/api/reports/sales.pdf'){const d=await salesPdf(Object.fromEntries(url.searchParams));return binary(res,200,d.buffer,'application/pdf',{'Content-Disposition':`attachment; filename="${d.filename}"`});}
  if(method==='GET'&&p==='/api/reports/costing.pdf'){const d=await costingPdf(Object.fromEntries(url.searchParams));return binary(res,200,d.buffer,'application/pdf',{'Content-Disposition':`attachment; filename="${d.filename}"`});}
  if(method==='POST'&&p==='/api/reports/email')return json(res,200,await emailSalesReport(user,await readJson(req)),safeHeaders());
  if(method==='GET'&&p==='/api/system-logs')return json(res,200,{logs:await listLogs(url.searchParams.get('limit'))},safeHeaders());

  const delSale=p.match(/^\/api\/sales\/(.+)\/delete$/);if(method==='POST'&&delSale){requireAdminRole(user);return json(res,200,await deleteSale(user,decodeURIComponent(delSale[1]),await readJson(req)),safeHeaders());}

  requireAdminRole(user);
  if(method==='GET'&&p==='/api/users')return json(res,200,{users:await listUsers()},safeHeaders());
  if(method==='POST'&&p==='/api/users'){const created=await createOrActivateUser(await readJson(req),user);await logAction(user,`Web user saved: ${created.username}`,'User Updated',`${created.role} / ${created.active?'Active':'Inactive'}`);return json(res,201,{user:created},safeHeaders());}
  const userMatch=p.match(/^\/api\/users\/(\d+)$/);if(method==='PUT'&&userMatch)return json(res,200,await updateUserAccount(user,Number(userMatch[1]),await readJson(req)),safeHeaders());

  if(method==='GET'&&p==='/api/admin/products')return json(res,200,{products:await listAdminProducts()},safeHeaders());
  if(method==='POST'&&p==='/api/admin/products')return json(res,201,await createProduct(user,await readJson(req)),safeHeaders());
  const productMatch=p.match(/^\/api\/admin\/products\/(\d+)$/);if(method==='PUT'&&productMatch)return json(res,200,await updateProduct(user,Number(productMatch[1]),await readJson(req)),safeHeaders());if(method==='DELETE'&&productMatch)return json(res,200,await archiveProduct(user,Number(productMatch[1])),safeHeaders());
  const recipeMatch=p.match(/^\/api\/admin\/products\/(\d+)\/recipe$/);if(method==='GET'&&recipeMatch)return json(res,200,await getRecipe(Number(recipeMatch[1])),safeHeaders());if(method==='PUT'&&recipeMatch)return json(res,200,await saveRecipe(user,Number(recipeMatch[1]),await readJson(req)),safeHeaders());

  if(method==='GET'&&p==='/api/admin/ingredients')return json(res,200,{ingredients:await listAdminIngredients()},safeHeaders());
  if(method==='POST'&&p==='/api/admin/ingredients')return json(res,201,await createIngredient(user,await readJson(req)),safeHeaders());
  const ingMatch=p.match(/^\/api\/admin\/ingredients\/(\d+)$/);if(method==='PUT'&&ingMatch)return json(res,200,await updateIngredient(user,Number(ingMatch[1]),await readJson(req)),safeHeaders());if(method==='DELETE'&&ingMatch)return json(res,200,await archiveIngredient(user,Number(ingMatch[1])),safeHeaders());

  if(method==='GET'&&p==='/api/admin/promos')return json(res,200,{promos:await listAdminPromos()},safeHeaders());
  if(method==='POST'&&p==='/api/admin/promos')return json(res,201,await savePromo(user,null,await readJson(req)),safeHeaders());
  const promoMatch=p.match(/^\/api\/admin\/promos\/(\d+)$/);if(method==='PUT'&&promoMatch)return json(res,200,await savePromo(user,Number(promoMatch[1]),await readJson(req)),safeHeaders());if(method==='DELETE'&&promoMatch)return json(res,200,await archivePromo(user,Number(promoMatch[1])),safeHeaders());

  if(method==='GET'&&p==='/api/admin/packages')return json(res,200,{packages:await listAdminPackages()},safeHeaders());
  if(method==='POST'&&p==='/api/admin/packages')return json(res,201,await savePackage(user,null,await readJson(req)),safeHeaders());
  const packMatch=p.match(/^\/api\/admin\/packages\/(\d+)$/);if(method==='PUT'&&packMatch)return json(res,200,await savePackage(user,Number(packMatch[1]),await readJson(req)),safeHeaders());if(method==='DELETE'&&packMatch)return json(res,200,await archivePackage(user,Number(packMatch[1])),safeHeaders());
  const compMatch=p.match(/^\/api\/admin\/packages\/(\d+)\/items$/);if(method==='PUT'&&compMatch)return json(res,200,await savePackageComposition(user,Number(compMatch[1]),await readJson(req)),safeHeaders());

  if(method==='GET'&&p==='/api/admin/settings')return json(res,200,await getSettings(),safeHeaders());
  if(method==='PUT'&&p==='/api/admin/settings')return json(res,200,await saveSettings(user,await readJson(req)),safeHeaders());
  if(method==='GET'&&p==='/api/backups')return json(res,200,await listBackups(),safeHeaders());
  if(method==='POST'&&p==='/api/backups')return json(res,201,await createBackup(user,'manual'),safeHeaders());
  const backupDownload=p.match(/^\/api\/backups\/([^/]+)$/);if(method==='GET'&&backupDownload){const name=safeBackupName(decodeURIComponent(backupDownload[1])),file=path.join(BACKUP_DIR,name);if(!fs.existsSync(file))return json(res,404,{error:'Backup file not found.'},safeHeaders());return binary(res,200,fs.readFileSync(file),'application/vnd.sqlite3',{'Content-Disposition':`attachment; filename="${name}"`});}
  const backupRestore=p.match(/^\/api\/backups\/([^/]+)\/restore$/);if(method==='POST'&&backupRestore)return json(res,200,await restoreBackup(user,decodeURIComponent(backupRestore[1])),safeHeaders());

  return json(res,404,{error:'API route not found.'},safeHeaders());
}

async function listenServer(server,status){
  let port=Number.isInteger(REQUESTED_PORT)&&REQUESTED_PORT>=0&&REQUESTED_PORT<=65535?REQUESTED_PORT:3100;
  const maxAttempts=PORT_EXPLICIT?1:25;
  for(let attempt=0;attempt<maxAttempts;attempt++){
    const candidate=port===0?0:port+attempt;
    try{
      const actual=await new Promise((resolve,reject)=>{
        const onError=err=>{server.off('listening',onListening);reject(err);};
        const onListening=()=>{server.off('error',onError);const a=server.address();resolve(typeof a==='object'&&a?a.port:candidate);};
        server.once('error',onError);server.once('listening',onListening);server.listen(candidate,HOST);
      });
      const displayHost=(HOST==='0.0.0.0'||HOST==='::')?'127.0.0.1':HOST;
      const url=`http://${displayHost}:${actual}`;
      try{fs.mkdirSync(path.join(ROOT,'data'),{recursive:true});fs.writeFileSync(path.join(ROOT,'data','runtime.json'),JSON.stringify({url,host:HOST,port:actual,pid:process.pid,startedAt:nowIso(),version:APP_VERSION},null,2));}catch(_){}
      console.log(`Coffee POS Web ${APP_VERSION} running on ${url}`);
      console.log(`Database engine: ${db.engine}`);
      if(status.setupRequired)console.log('First run: create the Web Admin account in the browser. Excel passwords were not imported.');
      if(actual!==REQUESTED_PORT&&REQUESTED_PORT!==0)console.log(`Port ${REQUESTED_PORT} was busy, so Coffee POS safely moved to port ${actual}.`);
      return {port:actual,url};
    }catch(err){
      if(err?.code==='EADDRINUSE'&&!PORT_EXPLICIT&&candidate!==0){console.warn(`Port ${candidate} is already in use; trying the next port...`);continue;}
      throw err;
    }
  }
  throw new Error(`Unable to find a free local port starting at ${port}.`);
}

async function main(){
  fs.mkdirSync(BACKUP_DIR,{recursive:true});db=await createDb();await initSchema();await migrateSchema();await seedDatabase();await ensureAutomaticBackup();const backupTimer=setInterval(()=>ensureAutomaticBackup().catch(err=>console.error('Automatic backup failed:',err.message)),60*60*1000);backupTimer.unref?.();const status=await appStatus();
  const server=http.createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
      if(url.pathname.startsWith('/api/'))return await handleApi(req,res,url);
      if(serveStatic(req,res,url.pathname))return;
      if(req.method==='GET')return serveStatic(req,res,'/')||text(res,404,'Not found','text/plain; charset=utf-8',safeHeaders());
      text(res,404,'Not found','text/plain; charset=utf-8',safeHeaders());
    }catch(err){
      const code=Number(err.status)||500;if(code>=500)console.error(err);
      if(res.headersSent||res.writableEnded){try{res.end();}catch(_){}return;}
      json(res,code,{error:code===500?'Internal server error.':err.message,details:err.details||undefined},safeHeaders());
    }
  });
  server.requestTimeout=30000;
  server.headersTimeout=35000;
  server.keepAliveTimeout=5000;
  server.maxRequestsPerSocket=1000;
  server.on('clientError',(err,socket)=>{try{if(socket.writable)socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');}catch(_){}if(process.env.DEBUG==='1')console.error('Client error',err.message);});
  await listenServer(server,status);
  const shutdown=async()=>{clearInterval(backupTimer);try{await new Promise(resolve=>server.close(()=>resolve()));}catch(_){}try{await db.close();}catch(_){}try{fs.unlinkSync(path.join(ROOT,'data','runtime.json'));}catch(_){}process.exit(0);};
  process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
  process.on('uncaughtException',err=>{console.error('Uncaught exception:',err);});
  process.on('unhandledRejection',err=>{console.error('Unhandled rejection:',err);});
}
main().catch(err=>{console.error(err);process.exit(1);});
