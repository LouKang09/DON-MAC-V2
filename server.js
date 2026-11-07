const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const legacySalesImport = require('./lib/legacy-sales-import');
const { createDb } = require('./db');
const { makePdf, salesReportLines, costingReportLines } = require('./lib/pdf');
const { sendMail } = require('./lib/smtp');
const accountRecovery = require('./lib/account-recovery');
const branchSupport = require('./lib/branch-support');
const internalChat = require('./lib/internal-chat');
const devSubscription = require('./lib/development-subscriptions');
const platformAccounts = require('./lib/platform-accounts');
const branchPlans = require('./lib/franchise-branch-plans');
const officePromotions = require('./lib/office-promotions');
const platformAdminAuth = require('./lib/platform-admin-auth');
const platformBilling = require('./lib/platform-billing');
const posFinance = require('./lib/pos-finance');
const advancedAnalytics = require('./lib/advanced-analytics');
const franchiseRequests = require('./lib/public-franchise-requests');
const franchiseEmailVerification = require('./lib/franchise-email-verification');
const franchiseStaging = require('./lib/franchise-tenant-staging');
const supplyChain = require('./lib/supply-chain');
const supplyRoyalties = require('./lib/supply-royalties');
const archiveComparison = require('./lib/archive-comparison');

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
const SUPPLY_OFFICE_PORTAL=process.env.SUPPLY_OFFICE_PORTAL==='true';
const APP_VERSION = '1.6.00-branch-subscriptions-office-campaigns';
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

async function readJson(req,maxBytes=1024*1024) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (Buffer.byteLength(raw) > maxBytes) { reject(Object.assign(new Error('Request too large.'), { status: 413 })); req.resume(); }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch (_) { reject(Object.assign(new Error('Invalid JSON body.'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

async function readRawWebhook(req,maxBytes=262144){
 const chunks=[];let size=0;
 for await(const chunk of req){
  size+=chunk.length;
  if(size>maxBytes)throw Object.assign(new Error('Webhook payload too large.'),{status:413});
  chunks.push(chunk);
 }
 return Buffer.concat(chunks);
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
    `SELECT u.id, u.username, u.role, u.active, u.branch_id, u.profile_photo, assigned_branch.active AS assigned_branch_active,
         COALESCE(u.login_username,u.username) AS login_name, s.expires_at, w.owner_user_id
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN branches assigned_branch ON assigned_branch.id=u.branch_id
       LEFT JOIN chat_memberships cm ON cm.user_id=u.id
       LEFT JOIN chat_workspaces w ON w.id=cm.workspace_id
      WHERE s.token_hash = $1`, [tokenHash]
  );
  const row = result.rows[0];
  if (!row || !bool(row.active) || new Date(row.expires_at).getTime() <= Date.now()) {
    await conn.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
    return null;
  }
  return { id: Number(row.id), username: row.login_name||row.username, photoData:row.profile_photo||null, role: row.role,
    branchId: row.branch_id==null?null:Number(row.branch_id),
    branchActive:row.role==='Admin'||bool(row.assigned_branch_active),
    isOwner:Number(row.owner_user_id)===Number(row.id) };
}

async function requireUser(req, res, role) {
  const user = await getUser(req);
  if (!user) {
    json(res, 401, { error: 'Authentication required.' });
    return null;
  }
  if(user.role==='User'&&!user.branchActive){
    json(res,403,{error:'Your assigned branch was deactivated after a plan change. Contact your Owner to move your account to an active branch.',
      code:'BRANCH_INACTIVE'},safeHeaders({'Cache-Control':'no-store'}));
    return null;
  }
  if (role && user.role !== role) {
    json(res, 403, { error: 'Administrator access required.' });
    return null;
  }
  const access=await platformAccounts.workspaceAccess(db,user.id);
  if(!access.allowed){
    json(res,403,{error:'Your subscription is '+(access.status==='ON_HOLD'?'on hold':'unpaid')+
      '. POS access is disabled. Please contact Admin Control.',
      code:'SUBSCRIPTION_INACTIVE',status:access.status},safeHeaders({'Cache-Control':'no-store'}));
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
  for(const [i,name] of ['Coffee','Non Coffee','Food','Add-ons','Promos','Packages'].entries()){
    await db.query('INSERT INTO pos_categories (name,sort_order,builtin,active) VALUES ($1,$2,$3,$4) ON CONFLICT (name) DO NOTHING',[name,i,true,true]);
  }
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
    const productCols = await db.query('PRAGMA table_info(products)');
    if (!productCols.rows.some(x => x.name === 'image_data')) await db.exec('ALTER TABLE products ADD COLUMN image_data TEXT;');
    const saleCols = await db.query('PRAGMA table_info(sales)');
    const saleNames = new Set(saleCols.rows.map(x => x.name));
    if (!saleNames.has('client_request_id')) await db.exec('ALTER TABLE sales ADD COLUMN client_request_id TEXT;');
    if (!saleNames.has('order_type')) await db.exec("ALTER TABLE sales ADD COLUMN order_type TEXT DEFAULT 'Take Away';");
    if (!saleNames.has('customer_name')) await db.exec('ALTER TABLE sales ADD COLUMN customer_name TEXT;');
    if (!saleNames.has('table_label')) await db.exec('ALTER TABLE sales ADD COLUMN table_label TEXT;');
    await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_client_request_id ON sales(client_request_id) WHERE client_request_id IS NOT NULL;');
  } else {
    await db.exec('ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS package_id BIGINT REFERENCES packages(id);');
    await db.exec('ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS is_package BOOLEAN NOT NULL DEFAULT FALSE;');
    await db.exec('ALTER TABLE sales ADD COLUMN IF NOT EXISTS client_request_id VARCHAR(128);');
    await db.exec('ALTER TABLE products ADD COLUMN IF NOT EXISTS image_data TEXT;');
    await db.exec("ALTER TABLE sales ADD COLUMN IF NOT EXISTS order_type VARCHAR(24) DEFAULT 'Take Away';");
    await db.exec('ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_name VARCHAR(120);');
    await db.exec('ALTER TABLE sales ADD COLUMN IF NOT EXISTS table_label VARCHAR(80);');
    await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_client_request_id ON sales(client_request_id) WHERE client_request_id IS NOT NULL;');
    await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_ci ON users((LOWER(username)));');
    await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_products_name_ci ON products((LOWER(name)));');
    await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_add_ons_name_ci ON add_ons((LOWER(name)));');
    await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_packages_name_ci ON packages((LOWER(name)));');
    await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_promos_name_ci ON promos((LOWER(name)));');
  }
  await db.query(`INSERT INTO meta (key,value) VALUES ('app_version',$1) ON CONFLICT (key) DO UPDATE SET value=excluded.value`, [APP_VERSION]);
  // Persist one merchant-wide development plan on first deploy. Existing
  // saved test plan and its history are not overwritten on subsequent starts.
  await db.query(
    'INSERT INTO app_settings (setting_key,setting_value,updated_at) VALUES ($1,$2,$3) ON CONFLICT (setting_key) DO NOTHING',
    [devSubscription.KEY,JSON.stringify(devSubscription.initial()),nowIso()]
  );
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

async function subscriptionState(conn=db){
  // Return the same persisted baseline every day, including across deploys.
  // Never manufacture a new history row merely because someone viewed the page.
  let result=await conn.query('SELECT setting_value FROM app_settings WHERE setting_key=$1',[devSubscription.KEY]);
  if(!result.rows.length){
    const created=devSubscription.initial();
    await conn.query(
      'INSERT INTO app_settings(setting_key,setting_value,updated_at) VALUES($1,$2,$3) ON CONFLICT(setting_key) DO NOTHING',
      [devSubscription.KEY,JSON.stringify(created),created.startedAt]
    );
    result=await conn.query('SELECT setting_value FROM app_settings WHERE setting_key=$1',[devSubscription.KEY]);
  }
  const current=devSubscription.parse(result.rows[0]?.setting_value);
  if(!current)throw Object.assign(new Error('Subscription settings require administrator review; history was not reset.'),{status:409});
  return current;
}
async function getSubscriptionForUi(user){
 const ws=await workspaceIdForUser(user.id);
 if(!ws)throw Object.assign(new Error('Subscription account not found.'),{status:404});
 const current=await platformAccounts.accountSubscription(db,ws);
 const common={plan:current.plan,status:current.status,configured:current.configured,
  entitlements:devSubscription.entitlements(current.plan)};
 if(user.role!=='Admin')return common;
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const remaining=renewAt=>{
  if(!renewAt)return null;
  const date=String(renewAt).slice(0,10);
  const days=Math.round((Date.parse(date+'T00:00:00Z')-Date.parse(today+'T00:00:00Z'))/86400000);
  return Number.isFinite(days)?Math.max(0,days):null;
 };
 return {...current,...common,daysRemaining:remaining(current.renewAt)};
}
async function requestSubscriptionPlan(user,input){
 requireAdminRole(user);
 const ws=await workspaceIdForUser(user.id);
 if(!ws)throw Object.assign(new Error('Franchise workspace is unavailable.'),{status:404});
 const plan=String(input?.plan||'').trim().toUpperCase();
 const result=await platformAccounts.requestPlan(db,ws,user,plan,input?.keepBranchIds);
 await logAction(user,'Subscription plan requested: '+plan,'Plan Request',result.message);
 return{...result,subscription:await getSubscriptionForUi(user)};
}
async function requireBusinessPlan(user){
 const ws=await workspaceIdForUser(user.id);
 const sub=ws?await platformAccounts.accountSubscription(db,ws):null;
 if(sub?.plan!=='BUSINESS'||!sub?.configured)
  throw Object.assign(new Error('Inventory transfer requires an approved Business plan. Contact Admin Control to update your subscription.'),{
   status:403,code:'BUSINESS_PLAN_REQUIRED'
  });
}

async function getCatalog(conn=db,workspaceId=0) {
  const productsR=await conn.query(`SELECT id,sku,name,category,price,image_data,active FROM products WHERE active=$1 ORDER BY category,name`,[true]);
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
    return {id:Number(p.id),sku:p.sku,name:p.name,category:p.category,price:Number(p.price),imageData:p.image_data||null,available,recipeConfigured,availabilityStatus,availabilityMessage,availabilityDetails:issues,stockWarnings:warnings};
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
    packages,
    officePromos:workspaceId?await officePromotions.forWorkspace(conn,workspaceId):[],
    categories:(await listPosCategories()).filter(c=>c.active)
  };
}

function validateCartInput(items){
  if(!Array.isArray(items)||!items.length)throw Object.assign(new Error('Add at least one item to the order.'),{status:400});
  if(items.length>100)throw Object.assign(new Error('Order has too many lines.'),{status:400});
  for(const x of items){
    if(!['product','addon','package','officePromo'].includes(x.kind))throw Object.assign(new Error('Invalid item type.'),{status:400});
    if((x.kind==='officePromo'?!/^[0-9a-f-]{36}$/i.test(String(x.id||'')):
      (!Number.isInteger(Number(x.id))||Number(x.id)<=0)))throw Object.assign(new Error('Invalid item id.'),{status:400});
    if(!Number.isInteger(Number(x.qty))||Number(x.qty)<=0||Number(x.qty)>999)throw Object.assign(new Error('Quantity must be a positive whole number.'),{status:400});
  }
}

async function quoteOrder(conn,input,workspaceId=0){
  const items=input.items||[];validateCartInput(items);
  const productLines=items.filter(x=>x.kind==='product');
  const addonLines=items.filter(x=>x.kind==='addon');
  const packageLines=items.filter(x=>x.kind==='package');
  const campaignLines=items.filter(x=>x.kind==='officePromo');
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
  if(campaignLines.length&&(input.promoId||input.senior?.enabled||addonLines.length))
    throw Object.assign(new Error('Main Office promotional buttons cannot be combined with additional discounts or POS promos.'),{status:400});
  if(campaignLines.length&&!workspaceId)throw Object.assign(new Error('Franchise workspace is required for Main Office promotions.'),{status:403});
  for(const c of campaignLines){
    const campaign=await officePromotions.verifySale(conn,workspaceId,String(c.id),Number(c.qty));
    const price=Number(campaign.price),qty=Number(c.qty),lineTotal=money(price*qty);
    gross=money(gross+lineTotal);
    lines.push({kind:'officePromo',id:String(c.id),productId:null,addOnId:null,packageId:null,
      name:campaign.buttonName,category:'Main Office Promotion',qty,unitPrice:price,lineTotal,
      isAddOn:false,isPackage:false,excludeFromCosting:true,components:[]});
  }
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
  if(user?.role!=='User')throw Object.assign(new Error('Only assigned Cashier accounts can process sales. Owners and Co-Owners have view-only access to sales records.'),{status:403,code:'CASHIER_ONLY_CHECKOUT'});
  const mode=String(body.paymentMode||'').trim();if(!['Cash','GCash'].includes(mode))throw Object.assign(new Error('Please choose Cash or GCash.'),{status:400});
  const branchId=await branchSupport.salesScope(db,user,body.branchId,true);
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
    const orderType=String(body.orderType||'Take Away').trim();
    const customerName=String(body.customerName||'').trim();
    const tableLabel=String(body.tableLabel||'').trim();
    if(!['Dine In','Take Away','Order Online'].includes(orderType))throw Object.assign(new Error('Choose a valid order type.'),{status:400});
    if(customerName.length>120||tableLabel.length>80)throw Object.assign(new Error('Customer name or table label is too long.'),{status:400});
    const workspace=await workspaceIdForUser(user.id);
    if((body.items||[]).some(x=>x.kind==='officePromo'))await officePromotions.lockForSale(tx,workspace,body.items);
    const quote=await quoteOrder(tx,body,workspace);let tender=quote.actual,change=0,paymentReference=null;
    if(mode==='Cash'){tender=money(Number(body.tender||0));if(!Number.isFinite(tender)||tender<quote.actual||tender>MAX_MONEY)throw Object.assign(new Error('Cash tender must cover the amount due and stay within the supported amount range.'),{status:400});change=money(tender-quote.actual);}else{paymentReference=String(body.paymentReference||'').trim();if(!paymentReference||paymentReference.length>150)throw Object.assign(new Error('Enter a GCash reference up to 150 characters.'),{status:400});}
    let reference=null;for(let tries=0;tries<8;tries++){const candidate=makeReference();const exists=await tx.query('SELECT id FROM sales WHERE reference=$1',[candidate]);if(!exists.rows.length){reference=candidate;break;}}if(!reference)throw new Error('Unable to generate a unique sale reference.');
    const saleR=await tx.query(`INSERT INTO sales (reference,cashier_user_id,cashier_name_snapshot,payment_mode,payment_reference,tender,change_amount,status,remark,senior_details,discount_amount,gross,adjustment,actual,promo_id,sold_at,client_request_id,branch_id,order_type,customer_name,table_label) VALUES ($1,$2,$3,$4,$5,$6,$7,'Sold',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING id`,[reference,user.id,user.username,mode,paymentReference,tender,change,quote.remark,quote.seniorDetails,quote.discountAmount,quote.gross,quote.adjustment,quote.actual,quote.promo?.id||null,nowIso(),clientRequestId||null,branchId,orderType,customerName||null,tableLabel||null]);
    const saleId=Number(saleR.rows[0].id);
    for(const line of quote.lines){
      const itemR=await tx.query(`INSERT INTO sale_items (sale_id,product_id,add_on_id,package_id,product_name_snapshot,quantity,unit_price,line_total,is_add_on,is_package,exclude_from_costing) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,[saleId,line.productId,line.addOnId,line.packageId,line.name,line.qty,line.unitPrice,line.lineTotal,line.isAddOn,line.isPackage,line.excludeFromCosting]);
      const saleItemId=Number(itemR.rows[0].id);
      if(line.kind==='officePromo')await officePromotions.recordSale(tx,saleId,workspace,branchId,line.id,line.qty);
      if(line.isPackage)for(const c of line.components)await tx.query(`INSERT INTO sale_item_components (sale_item_id,product_id,product_name_snapshot,quantity) VALUES ($1,$2,$3,$4)`,[saleItemId,c.productId,c.name,c.qty]);
    }
    const locked=new Map();if(tx.engine==='postgres'&&quote.requirements.length){const ids=quote.requirements.map(r=>r.ingredientId).sort((a,b)=>a-b);const lr=await tx.query(`SELECT id,stock_qty FROM ingredients WHERE id IN (${placeholders(1,ids.length)}) ORDER BY id FOR UPDATE`,ids);for(const row of lr.rows)locked.set(Number(row.id),Number(row.stock_qty));}
    for(const req of quote.requirements){let current;if(locked.has(req.ingredientId))current=locked.get(req.ingredientId);else{const cr=await tx.query('SELECT stock_qty FROM ingredients WHERE id=$1',[req.ingredientId]);current=Number(cr.rows[0]?.stock_qty??0);}if(current+1e-9<req.needed)throw Object.assign(new Error(`Insufficient stock for ${req.name}.`),{status:409});const balance=current-req.needed;await tx.query('UPDATE ingredients SET stock_qty=$1,updated_at=$2 WHERE id=$3',[balance,nowIso(),req.ingredientId]);await tx.query(`INSERT INTO inventory_movements (ingredient_id,movement_type,quantity_change,balance_after,reference,remarks,created_by,created_at) VALUES ($1,'SALE',$2,$3,$4,$5,$6,$7)`,[req.ingredientId,-req.needed,balance,reference,`Sale ${reference}`,user.id,nowIso()]);}
    await logAction(user,`Sale completed: ${reference}`,'Sold',quote.remark,tx);return {reference,paymentMode:mode,tender,change,orderType,customerName,tableLabel,...quote};
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
  const movementReference='RPL-'+crypto.randomUUID().toUpperCase();
  const movementTime=nowIso();
  return db.transaction(async tx=>{
    const details=[];
    for(const x of body.items){
      const lock=tx.engine==='postgres'?' FOR UPDATE':'';
      const r=await tx.query(`SELECT id,display_name,uom,stock_qty FROM ingredients WHERE id=$1 AND active=$2${lock}`,[Number(x.ingredientId),true]);
      const ing=r.rows[0];if(!ing)throw Object.assign(new Error('Ingredient not found.'),{status:404});
      const qty=Number(x.qty),balance=Number(ing.stock_qty)+qty;
      if(!Number.isFinite(balance)||balance>MAX_STOCK)throw Object.assign(new Error(`Stock balance for ${ing.display_name} would exceed the supported range.`),{status:400});
      await tx.query('UPDATE ingredients SET stock_qty=$1,updated_at=$2 WHERE id=$3',[balance,nowIso(),Number(ing.id)]);
      await tx.query(`INSERT INTO inventory_movements (ingredient_id,movement_type,quantity_change,balance_after,reference,delivered_by,remarks,created_by,created_at) VALUES ($1,'REPLENISH',$2,$3,$4,$5,$6,$7,$8)`,[Number(ing.id),qty,balance,movementReference,deliveredBy||null,remarks||null,user.id,movementTime]);
      details.push(`- ${ing.display_name}: (${qty}) ${String(ing.uom||'').toUpperCase()}`);
    }
    const activity=`Cashier: ${user.username}\nDelivered By: (${deliveredBy||'N/A'})\n\nItems Replenished:\n${details.join('\n')}`;
    await logAction(user,activity,'Replenished stock',remarks||null,tx);
    return {ok:true,activity};
  });
}
async function transfer(user,body){
  // Enforce entitlements in the mutation route as well as the UI; direct
  // API requests from Pro accounts cannot bypass the disabled button.
  await requireBusinessPlan(user);
  validateMovementItems(body.items);
  const branch=String(body.branch||'').trim(),receivedBy=String(body.receivedBy||'').trim(),remarks=String(body.remarks||'').trim();
  if(!branch||!receivedBy)throw Object.assign(new Error('Transfer To and Received By are required.'),{status:400});
  if(branch.length>150||receivedBy.length>150)throw Object.assign(new Error('Transfer To and Received By must be at most 150 characters.'),{status:400});
  if(remarks.length>500)throw Object.assign(new Error('Remarks must be at most 500 characters.'),{status:400});
  const movementReference='TRF-'+crypto.randomUUID().toUpperCase();
  const movementTime=nowIso();
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
      await tx.query(`INSERT INTO inventory_movements (ingredient_id,movement_type,quantity_change,balance_after,reference,branch,received_by,remarks,created_by,created_at) VALUES ($1,'TRANSFER',$2,$3,$4,$5,$6,$7,$8,$9)`,[Number(ing.id),-qty,balance,movementReference,branch,receivedBy,remarks||null,user.id,movementTime]);
      details.push(`- ${ing.display_name}: (${qty}) ${String(ing.uom||'').toUpperCase()}`);
    }
    const activity=`Cashier: ${user.username}\nTransfer To: (${branch})\nReceived By: (${receivedBy})\n\nItems Transferred:\n${details.join('\n')}`;
    await logAction(user,activity,'Transferred stock',remarks||null,tx);
    return {ok:true,activity};
  });
}
async function listInventoryMovements(limit=300){const n=Math.max(1,Math.min(1000,Number(limit)||300));const r=await db.query(`SELECT m.id,m.movement_type,m.quantity_change,m.balance_after,m.reference,m.branch,m.received_by,m.delivered_by,m.remarks,m.created_at,i.display_name,i.uom,COALESCE(u.login_username,u.username) AS username FROM inventory_movements m JOIN ingredients i ON i.id=m.ingredient_id LEFT JOIN users u ON u.id=m.created_by ORDER BY m.created_at DESC,m.id DESC LIMIT ${n}`);return r.rows.map(x=>({id:Number(x.id),type:x.movement_type,ingredient:x.display_name,uom:x.uom,quantityChange:Number(x.quantity_change),balanceAfter:Number(x.balance_after),reference:x.reference,branch:x.branch,receivedBy:x.received_by,deliveredBy:x.delivered_by,remarks:x.remarks,createdBy:x.username,createdAt:x.created_at}));}

function manilaDateString(value){if(!value)return'';const raw=String(value);if(!/[zZ]|[+-]\d\d:\d\d$/.test(raw))return raw.slice(0,10);const d=new Date(raw);if(Number.isNaN(d.getTime()))return raw.slice(0,10);const parts=new Intl.DateTimeFormat('en-CA',{timeZone:MANILA_TZ,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);const map=Object.fromEntries(parts.map(p=>[p.type,p.value]));return `${map.year}-${map.month}-${map.day}`;}
function sundayOf(dateStr){const[y,m,d]=dateStr.split('-').map(Number);const dt=new Date(Date.UTC(y,m-1,d));dt.setUTCDate(dt.getUTCDate()-dt.getUTCDay());return dt.toISOString().slice(0,10);}
function addDays(dateStr,n){const[y,m,d]=dateStr.split('-').map(Number);const dt=new Date(Date.UTC(y,m-1,d+n));return dt.toISOString().slice(0,10);}
function matchesPeriod(soldAt,period,target){const d=manilaDateString(soldAt);if(!target)return true;if(period==='daily')return d===target;if(period==='monthly')return d.slice(0,7)===target.slice(0,7);if(period==='yearly')return d.slice(0,4)===target.slice(0,4);if(period==='weekly'){const start=sundayOf(target),end=addDays(start,6);return d>=start&&d<=end;}return d===target;}
function validIsoDate(value){const s=String(value||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;const[y,m,d]=s.split('-').map(Number),dt=new Date(Date.UTC(y,m-1,d));return dt.getUTCFullYear()===y&&dt.getUTCMonth()===m-1&&dt.getUTCDate()===d;}
function reportParams(params){
  const period=['daily','weekly','monthly','yearly'].includes(params.period)?params.period:'daily';
  const fallback=new Intl.DateTimeFormat('en-CA',{timeZone:MANILA_TZ}).format(new Date());
  const raw=String(params.date||fallback).slice(0,10);
  if(!validIsoDate(raw))throw Object.assign(new Error('Report date must be a valid YYYY-MM-DD date.'),{status:400});
  const cashier=String(params.cashier||'').trim().toUpperCase();
  if(cashier.length>80)throw Object.assign(new Error('Cashier filter must be at most 80 characters.'),{status:400});
  // Multi-select arrives as an encoded JSON array so names containing commas,
  // spaces and special characters remain unambiguous. Legacy single cashier
  // queries continue to work (including emailed and older bookmarked reports).
  let cashiers=[];
  if(params.cashiers!==undefined && params.cashiers!==''){
    let parsed;
    try{parsed=JSON.parse(params.cashiers);}catch(_){
      throw Object.assign(new Error('Invalid cashier selection.'),{status:400});
    }
    if(!Array.isArray(parsed)||parsed.length>200||parsed.some(name=>typeof name!=='string'||!name.trim()||name.length>80))
      throw Object.assign(new Error('Choose up to 200 valid cashiers.'),{status:400});
    cashiers=[...new Set(parsed.map(name=>normalize(name)))];
  }else if(cashier){
    cashiers=[normalize(cashier)];
  }
  return {period,target:raw,cashier,cashiers};
}
async function periodSales(params){
  const {period,target,cashier,cashiers}=reportParams(params);
  const r=await db.query(`SELECT s.*,CASE WHEN s.promo_id IS NOT NULL THEN COALESCE(s.remark,p.name) ELSE NULL END AS promo_name
    FROM sales s LEFT JOIN promos p ON p.id=s.promo_id ORDER BY s.sold_at ASC`);
  const selected=new Set(cashiers);
  const eligible=r.rows.filter(s=>
    matchesPeriod(s.sold_at,period,target) &&
    (!selected.size||selected.has(normalize(s.cashier_name_snapshot))) &&
    (params.branchId==null||Number(s.branch_id)===Number(params.branchId))
  );
  return {period,target,cashier,cashiers,eligible,sold:eligible.filter(s=>s.status==='Sold')};
}
async function reportCashierChoices(branchId){
  // Only accounts with the Cashier (internal 'User') role belong here.
  // Admin, Owner, and Co-Owner accounts never appear as options.
  // Keep inactive Cashier accounts so old transaction reports remain filterable.
  const scoped=branchId!=null;
  const sql='SELECT username AS cashier FROM users WHERE role=$1 '+
    (scoped?'AND branch_id=$2 ':'')+'ORDER BY LOWER(username),username';
  const rows=(await db.query(sql,scoped?['User',Number(branchId)]:['User'])).rows;
  return {cashiers:rows.map(row=>row.cashier)};
}

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
  const discounts=money(scope.sold.reduce((a,s)=>a+Number(s.discount_amount||0),0));
  const soldCost=money([...productMap.values()].reduce((a,p)=>a+p.costing,0));
  const voided=scope.eligible.filter(s=>s.status==='Deleted');
  const refund=money(voided.reduce((a,s)=>a+Number(s.actual||0),0));
  return {
    period:scope.period,target:scope.target,cashier:scope.cashier||null,
    cashiers:scope.cashiers,
    transactionCount:scope.sold.length,
    allTransactionCount:scope.eligible.length,
    deletedCount:scope.eligible.length-scope.sold.length,
    gross:sum('gross'),
    adjustment:sum('adjustment'),
    discounts,
    actual:sum('actual'),
    grossProfit:money(sum('actual')-soldCost),
    refund,
    products:[...productMap.values()].sort((a,b)=>b.qty-a.qty||a.name.localeCompare(b.name)),
    promos:[...promoMap.values()].sort((a,b)=>b.qty-a.qty||a.name.localeCompare(b.name)),
    transactions:scope.eligible.map(s=>({
      reference:s.reference,cashier:s.cashier_name_snapshot,paymentMode:s.payment_mode,
      paymentReference:s.payment_reference,status:s.status,soldAt:s.sold_at,
      remark:s.remark,seniorDetails:s.senior_details,gross:Number(s.gross),
      adjustment:Number(s.adjustment),actual:Number(s.actual)
    }))
  };
}

async function getSaleDetail(reference,user){
  const ref=String(reference||'').trim();
  if(!ref||ref.length>200)throw Object.assign(new Error('Invalid transaction reference.'),{status:400});
  const saleR=await db.query(`SELECT s.*,p.name AS promo_name,COALESCE(du.login_username,du.username) AS deleted_by_username
    FROM sales s
    LEFT JOIN promos p ON p.id=s.promo_id
    LEFT JOIN users du ON du.id=s.deleted_by
    WHERE s.reference=$1`,[ref]);
  const s=saleR.rows[0];
  if(!s)throw Object.assign(new Error('Transaction not found.'),{status:404});
  if(user?.role!=='Admin'&&Number(s.branch_id)!==Number(user?.branchId))throw Object.assign(new Error('This sale belongs to another branch.'),{status:403});

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
      i.display_name,i.uom,COALESCE(u.login_username,u.username) AS created_by_username
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
    gross:Number(s.gross||0),adjustment:Number(s.adjustment||0),actual:Number(s.actual||0),orderType:s.order_type||'Take Away',customerName:s.customer_name||null,tableLabel:s.table_label||null,
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

async function listLogs(limit=300,user=null){const n=Math.max(1,Math.min(1000,Number(limit)||300));const restricted=user&&user.role!=='Admin';const sql=restricted?`SELECT id,activity,actor_name_snapshot,status,remark,created_at FROM system_logs WHERE actor_user_id=$1 ORDER BY created_at DESC LIMIT ${n}`:`SELECT id,activity,actor_name_snapshot,status,remark,created_at FROM system_logs ORDER BY created_at DESC LIMIT ${n}`;const r=await db.query(sql,restricted?[user.id]:[]);return r.rows.map(x=>({id:Number(x.id),activity:x.activity,actor:x.actor_name_snapshot,status:x.status,remark:x.remark,createdAt:x.created_at}));}
async function initialOwnerId(forUserId){
 const x=await db.query('SELECT w.owner_user_id FROM chat_workspaces w JOIN chat_memberships m ON m.workspace_id=w.id WHERE m.user_id=$1 LIMIT 1',[Number(forUserId)]);
 return Number(x.rows[0]?.owner_user_id||0);
}
async function protectOwnerUpdate(actor,id,role,active){
 const owner=await initialOwnerId(id);
 if(owner&&Number(id)===owner){
   if(Number(actor?.id)!==owner)throw Object.assign(new Error('Only the Owner can edit their own account.'),{status:403});
   if(role!=='Admin'||!active)throw Object.assign(new Error('The original Owner must remain active and cannot be changed to another role.'),{status:403});
 }
}

async function migrateCashierProfiles(){
  // Add without rebuilding the legacy users table, which already has a unique
  // username column and may be referenced by historical sales/sessions.
  const fields={login_username:'VARCHAR(80)',owner_scope_id:'BIGINT',full_name:'VARCHAR(120)',email:'VARCHAR(180)',phone:'VARCHAR(32)',profile_photo:'TEXT'};
  if(db.engine==='postgres'){
    for(const [name,type] of Object.entries(fields))await db.exec('ALTER TABLE users ADD COLUMN IF NOT EXISTS '+name+' '+type);
  }else{
    const cols=new Set((await db.query('PRAGMA table_info(users)')).rows.map(x=>x.name));
    for(const [name,type] of Object.entries(fields))if(!cols.has(name))await db.exec('ALTER TABLE users ADD COLUMN '+name+' '+(name==='owner_scope_id'?'INTEGER':type));
  }
  await db.query('UPDATE users SET login_username=username WHERE login_username IS NULL');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_cashier_login_name ON users(login_username)');
  // Database-enforced uniqueness, including concurrent account creation.
  await db.query('UPDATE users SET owner_scope_id=(SELECT workspace_id FROM chat_memberships WHERE user_id=users.id) WHERE owner_scope_id IS NULL');
  await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS ux_cashier_name_owner_branch ON users(owner_scope_id,(COALESCE(branch_id,0)),LOWER(login_username)) WHERE owner_scope_id IS NOT NULL');
}
async function workspaceIdForUser(id){
  const r=await db.query('SELECT workspace_id FROM chat_memberships WHERE user_id=$1',[Number(id)]);
  return Number(r.rows[0]?.workspace_id||0);
}
async function requireSameOwnerWorkspace(actor,targetId){
  const [own,target]=await Promise.all([workspaceIdForUser(actor.id),workspaceIdForUser(targetId)]);
  if(!own||!target||own!==target)throw Object.assign(new Error('This account is outside your owner workspace.'),{status:403});
  return own;
}
async function ensureBranchInOwnerWorkspace(actor,branchId){
  if(!branchId)return;
  const workspaceId=await workspaceIdForUser(actor.id);
  const r=await db.query('SELECT 1 FROM chat_workspace_branches WHERE branch_id=$1 AND workspace_id=$2',[Number(branchId),workspaceId]);
  if(!r.rows.length)throw Object.assign(new Error('Selected branch does not belong to your owner account.'),{status:403});
}
async function accessibleBranches(actor){
  const ws=await workspaceIdForUser(actor.id);
  const all=await branchSupport.listBranches(db);
  const r=await db.query('SELECT branch_id FROM chat_workspace_branches WHERE workspace_id=$1',[ws]);
  const allowed=new Set(r.rows.map(x=>Number(x.branch_id)));
  return all.filter(b=>allowed.has(Number(b.id))&&(actor.role==='Admin'||Number(actor.branchId)===Number(b.id)));
}
async function usernameAtScope(username,workspaceId,branchId,exceptId=0){
  const r=await db.query(
    'SELECT u.id,u.username,u.password_hash,u.role,u.active,u.branch_id FROM users u '+
    'JOIN chat_memberships m ON m.user_id=u.id '+
    'WHERE m.workspace_id=$1 AND LOWER(COALESCE(u.login_username,u.username))=LOWER($2) '+
    'AND COALESCE(u.branch_id,0)=$3 AND u.id<>$4',
    [workspaceId,username,Number(branchId||0),exceptId]);
  return r.rows[0]||null;
}
function validateCashierPhoto(raw){
  if(raw==null||raw==='')return null;
  if(typeof raw!=='string'||raw.length>170000)throw Object.assign(new Error('Photo is too large. Select an image of 1 MB or less.'),{status:413});
  const match=/^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(raw);
  if(!match)throw Object.assign(new Error('Photo could not be decoded. Upload a valid JPG, PNG, or WebP image under 1 MB.'),{status:400});
  const bytes=Buffer.from(match[1],'base64');
  if(bytes.length<64||bytes.length>120*1024||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255||
    bytes[bytes.length-2]!==255||bytes[bytes.length-1]!==217)
    throw Object.assign(new Error('Photo could not be decoded, or the compressed image is too large.'),{status:400});
  return raw;
}
function staffProfile(body){
  const p={fullName:String(body.fullName||'').trim(),email:String(body.email||'').trim(),
    phone:String(body.phone||'').trim()};
  if(p.fullName.length>120||p.email.length>180||p.phone.length>32)
    throw Object.assign(new Error('Name, email or phone is too long.'),{status:400});
  if(p.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email))
    throw Object.assign(new Error('Enter a valid cashier email address.'),{status:400});
  return p;
}
async function listUsers(actor){
  const workspaceId=await workspaceIdForUser(actor.id);
  if(!workspaceId)throw Object.assign(new Error('Owner workspace unavailable.'),{status:403});
  const r=await db.query(
    'SELECT u.id,u.username,COALESCE(u.login_username,u.username) AS login_name,u.full_name,u.email,u.phone,'+
    'u.role,u.active,u.created_at,u.password_hash,u.branch_id,u.profile_photo,b.name AS branch_name,w.owner_user_id '+
    'FROM users u JOIN chat_memberships m ON m.user_id=u.id '+
    'JOIN chat_workspaces w ON w.id=m.workspace_id LEFT JOIN branches b ON b.id=u.branch_id '+
    'WHERE m.workspace_id=$1 ORDER BY u.id',[workspaceId]);
  return r.rows.map(u=>({id:Number(u.id),username:u.login_name,fullName:u.full_name||'',email:u.email||'',phone:u.phone||'',photoData:u.profile_photo||null,
    role:u.role,roleLabel:Number(u.id)===Number(u.owner_user_id)?'Owner/Admin':u.role==='Admin'?'Co-Owner/Admin':'Cashier',
    isOwner:Number(u.id)===Number(u.owner_user_id),active:bool(u.active),
    branchId:u.branch_id==null?null:Number(u.branch_id),branchName:u.branch_name||null,
    hasWebPassword:!!u.password_hash,createdAt:u.created_at}));
}
async function createOrActivateUser(body,actor=null){
  const username=String(body.username||'').trim(),password=String(body.password||'');
  const role=String(body.role||'User'),active=body.active===undefined?true:!!body.active;
  if(!['Admin','User'].includes(role))throw Object.assign(new Error('Role must be Admin or User.'),{status:400});
  if(username.length<2||username.length>80)throw Object.assign(new Error('Username must be 2–80 characters.'),{status:400});
  if(password.length<8||password.length>256)throw Object.assign(new Error('Password must be 8–256 characters.'),{status:400});
  const profile=staffProfile(body);
  const photoData=validateCashierPhoto(body.photoData);
  const branchId=await branchSupport.resolveAssignment(db,role,body.branchId);
  if(actor)await ensureBranchInOwnerWorkspace(actor,branchId);
  const ws=actor?await workspaceIdForUser(actor.id):0;
  if(actor&&!ws)throw Object.assign(new Error('Owner workspace unavailable.'),{status:403});
  const existing=actor
    ?await usernameAtScope(username,ws,branchId)
    :(await db.query('SELECT id,username,password_hash,role,active,branch_id FROM users WHERE LOWER(username)=LOWER($1)',[username])).rows[0];
  // New usernames are unique across every franchise and branch, not
  // just within one Owner/branch combination.
  const globalAliases=(await db.query(
    'SELECT id FROM users WHERE LOWER(COALESCE(login_username,username))=LOWER($1) OR LOWER(username)=LOWER($1)',
    [username])).rows;
  if(globalAliases.some(x=>Number(x.id)!==Number(existing?.id||0)))
    throw Object.assign(new Error('This username is already in use. Choose a unique username.'),{status:409});

  if(existing){
    const old=existing;
    if(actor&&old.password_hash)throw Object.assign(new Error('This username already exists in the selected branch of your owner account. Use Edit instead.'),{status:409});
    if(actor&&Number(old.id)===actor.id&&!active)throw Object.assign(new Error('You cannot deactivate your own account.'),{status:400});
    if(actor)await protectOwnerUpdate(actor,old.id,role,active);
    await db.query('UPDATE users SET password_hash=$1,role=$2,active=$3,branch_id=$4,login_username=$5,full_name=$6,email=$7,phone=$8,profile_photo=$9 WHERE id=$10',
      [hashPassword(password),role,active,branchId,username,profile.fullName,profile.email,profile.phone,photoData,Number(old.id)]);
    await db.query('DELETE FROM sessions WHERE user_id=$1',[Number(old.id)]);
    await internalChat.assignNewUser(db,actor?.id||null,Number(old.id));
    const actualWs=await workspaceIdForUser(Number(old.id));
    await db.query('UPDATE users SET owner_scope_id=$1 WHERE id=$2',[actualWs,Number(old.id)]);
    return{id:Number(old.id),username,role,active};
  }
  // Keep the pre-existing globally unique physical username key for foreign
  // keys and legacy imports; expose the branch-scoped username separately.
  let internalUsername=username;
  const globalMatch=await db.query('SELECT id FROM users WHERE LOWER(username)=LOWER($1)',[username]);
  if(globalMatch.rows.length)internalUsername='dm_'+crypto.randomBytes(13).toString('hex');
  const row=await db.query(
    'INSERT INTO users (username,login_username,password_hash,role,active,created_at,branch_id,full_name,email,phone,profile_photo) '+
    'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id',
    [internalUsername,username,hashPassword(password),role,active,nowIso(),branchId,profile.fullName,profile.email,profile.phone,photoData]);
  await internalChat.assignNewUser(db,actor?.id||null,Number(row.rows[0].id));
  const actualWs=await workspaceIdForUser(Number(row.rows[0].id));
  await db.query('UPDATE users SET owner_scope_id=$1 WHERE id=$2',[actualWs,Number(row.rows[0].id)]);
  return{id:Number(row.rows[0].id),username,role,active};
}

async function deleteUserAccount(actor,id){
  await requireSameOwnerWorkspace(actor,id);
  if(Number(id)===(await initialOwnerId(id)))throw Object.assign(new Error('The original Owner cannot be deleted.'),{status:403});
  if(Number(id)===actor.id)throw Object.assign(new Error('You cannot delete your own account.'),{status:400});
  const r=await db.query('SELECT id,username,role,active FROM users WHERE id=$1',[id]);const u=r.rows[0];
  if(!u)throw Object.assign(new Error('User not found.'),{status:404});
  const refs=await db.query('SELECT (SELECT COUNT(*) FROM sales WHERE cashier_user_id=$1 OR deleted_by=$1) AS sales_count,'+
    '(SELECT COUNT(*) FROM system_logs WHERE actor_user_id=$1) AS logs_count,'+
    '(SELECT COUNT(*) FROM inventory_movements WHERE created_by=$1) AS movements_count,'+
    '(SELECT COUNT(*) FROM chat_messages WHERE sender_id=$1 OR recipient_id=$1) AS chat_count,'+
    '(SELECT COUNT(*) FROM chat_group_messages WHERE sender_id=$1) AS group_chat_count',[id]);
  if(Object.values(refs.rows[0]).some(Number))throw Object.assign(new Error('This account has transaction or audit history. Deactivate it instead.'),{status:409});
  if(u.role==='Admin'&&bool(u.active)){
    const ws=await workspaceIdForUser(actor.id);
    const count=await db.query('SELECT COUNT(*) AS c FROM users u JOIN chat_memberships m ON m.user_id=u.id WHERE m.workspace_id=$1 AND u.role=$2 AND u.active=$3 AND u.password_hash IS NOT NULL',[ws,'Admin',true]);
    if(Number(count.rows[0].c)<=1)throw Object.assign(new Error('At least one active Admin must remain.'),{status:400});
  }
  await db.query('DELETE FROM sessions WHERE user_id=$1',[id]);
  await db.query('DELETE FROM users WHERE id=$1',[id]);
  await logAction(actor,'Web user deleted: '+u.username,'User Deleted',null);
  return{ok:true};
}
async function updateUserAccount(actor,id,body){
  const ws=await requireSameOwnerWorkspace(actor,id);
  const targetR=await db.query('SELECT id,username,COALESCE(login_username,username) AS login_name,role,active,branch_id,full_name,email,phone,profile_photo FROM users WHERE id=$1',[Number(id)]);
  const target=targetR.rows[0];if(!target)throw Object.assign(new Error('User not found.'),{status:404});
  const role=body.role===undefined?target.role:String(body.role);
  const active=typeof body.active==='boolean'?body.active:bool(target.active),password=String(body.password||'');
  if(!['Admin','User'].includes(role))throw Object.assign(new Error('Role must be Admin or User.'),{status:400});
  await protectOwnerUpdate(actor,id,role,active);
  if(Number(id)===actor.id&&!active)throw Object.assign(new Error('You cannot deactivate your own account.'),{status:400});
  if(password&&(password.length<8||password.length>256))throw Object.assign(new Error('Password must be 8–256 characters.'),{status:400});
  if(target.role==='Admin'&&bool(target.active)&&(role!=='Admin'||!active)){
    const c=await db.query('SELECT COUNT(*) AS c FROM users u JOIN chat_memberships m ON m.user_id=u.id WHERE m.workspace_id=$1 AND u.role=$2 AND u.active=$3 AND u.password_hash IS NOT NULL',[ws,'Admin',true]);
    if(Number(c.rows[0].c)<=1)throw Object.assign(new Error('At least one active Admin must remain.'),{status:400});
  }
  const branchId=await branchSupport.resolveAssignment(db,role,body.branchId===undefined?target.branch_id:body.branchId);
  await ensureBranchInOwnerWorkspace(actor,branchId);
  if(await usernameAtScope(target.login_name,ws,branchId,id))
    throw Object.assign(new Error('Another user in the selected branch already has this username.'),{status:409});
  const profile=staffProfile({...body,fullName:body.fullName===undefined?target.full_name:body.fullName,
    email:body.email===undefined?target.email:body.email,phone:body.phone===undefined?target.phone:body.phone});
  const photoData=body.photoData===undefined?target.profile_photo:validateCashierPhoto(body.photoData);
  if(password)await db.query('UPDATE users SET role=$1,active=$2,password_hash=$3,branch_id=$4,full_name=$5,email=$6,phone=$7,profile_photo=$8 WHERE id=$9',
    [role,active,hashPassword(password),branchId,profile.fullName,profile.email,profile.phone,photoData,Number(id)]);
  else await db.query('UPDATE users SET role=$1,active=$2,branch_id=$3,full_name=$4,email=$5,phone=$6,profile_photo=$7 WHERE id=$8',
    [role,active,branchId,profile.fullName,profile.email,profile.phone,photoData,Number(id)]);
  if(!active||(password&&Number(id)!==actor.id))await db.query('DELETE FROM sessions WHERE user_id=$1',[Number(id)]);
  await logAction(actor,'Web user updated: '+target.login_name,'User Updated',role+' / '+(active?'Active':'Inactive'));
  return{ok:true};
}

async function listAdminProducts(){const r=await db.query(`SELECT p.id,p.sku,p.name,p.category,p.price,p.active,p.created_at,p.updated_at,MAX(p.image_data) AS image_data,COUNT(pi.ingredient_id) AS recipe_count,COALESCE(SUM(COALESCE(pi.cost_contribution,0)),0) AS unit_cost FROM products p LEFT JOIN product_ingredients pi ON pi.product_id=p.id GROUP BY p.id,p.sku,p.name,p.category,p.price,p.active,p.created_at,p.updated_at ORDER BY p.category,p.name`);return r.rows.map(x=>({id:Number(x.id),sku:x.sku,name:x.name,category:x.category,price:Number(x.price),active:bool(x.active),imageData:x.image_data||null,recipeCount:Number(x.recipe_count||0),unitCost:Number(x.unit_cost||0)}));}
function validatedProductImage(value) {
  if(value===undefined)return undefined;
  if(value===null||value==='')return null;
  // The browser converts all accepted file types to compressed JPEG before upload.
  // Enforce this contract in the API too: no uncompressed PNG/WebP bytes enter storage.
  if(typeof value!=='string'||value.length>165000||
     !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value))
    throw Object.assign(new Error('Product image must be a compressed JPEG of 115 KB or less. Select a JPG, PNG or WebP file under 1 MB in Catalog Admin.'),{status:400});
  const raw=Buffer.from(value.slice(value.indexOf(',')+1),'base64');
  if(raw.length<32||raw.length>115*1024||raw[0]!==255||raw[1]!==216||raw[2]!==255)
    throw Object.assign(new Error('Invalid or oversized compressed product image (maximum 115 KB stored).'),{status:400});
  return value;
}
function validCategory(c){return['Coffee','Non Coffee','Food'].includes(c);}

function validPosIcon(value){
 if(value===undefined)return undefined;
 if(value===null||value==='')return null;
 if(typeof value!=='string'||value.length>46000||!/^data:image\/(?:png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value))
   throw Object.assign(new Error('Use a valid compressed PNG or WebP icon up to 32 KB.'),{status:400});
 const bytes=Buffer.from(value.slice(value.indexOf(',')+1),'base64');
 const png=bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 const webp=bytes.length>=12&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
 if(bytes.length<32||bytes.length>32768||!(value.startsWith('data:image/png;')&&png||value.startsWith('data:image/webp;')&&webp))
   throw Object.assign(new Error('Invalid or oversized category icon (32 KB maximum after compression).'),{status:400});
 return value;
}
async function listPosCategories(){
 const [rows,links]=await Promise.all([
   db.query('SELECT name,icon_data,sort_order,builtin,active FROM pos_categories ORDER BY sort_order,name'),
   db.query('SELECT category_name,product_id FROM pos_category_products ORDER BY category_name,product_id')
 ]);
 const products=new Map();
 for(const link of links.rows){
   if(!products.has(link.category_name))products.set(link.category_name,[]);
   products.get(link.category_name).push(Number(link.product_id));
 }
 return rows.rows.map(c=>({name:c.name,iconData:c.icon_data||null,
   sortOrder:Number(c.sort_order),builtin:bool(c.builtin),active:bool(c.active),productIds:products.get(c.name)||[]}));
}
async function savePosCategory(user,key,body){
 const record=key?(await db.query('SELECT * FROM pos_categories WHERE name=$1',[key])).rows[0]:null;
 if(key&&!record)throw Object.assign(new Error('Category not found.'),{status:404});
 const name=record?.name||String(body.name||'').trim().replace(/\s+/g,' ');
 if(name.length<2||name.length>32||/[<>]/.test(name))
   throw Object.assign(new Error('Category name must have 2–32 characters.'),{status:400});
 if(!record){
   const duplicates=await db.query('SELECT name FROM pos_categories WHERE LOWER(name)=LOWER($1)',[name]);
   if(duplicates.rows.length)throw Object.assign(new Error('Category already exists.'),{status:409});
   const size=await db.query('SELECT COUNT(*) AS n FROM pos_categories');
   if(Number(size.rows[0]?.n||0)>=30)throw Object.assign(new Error('Maximum 30 categories.'),{status:400});
 }
 const icon=body.iconData===undefined?record?.icon_data||null:validPosIcon(body.iconData);
 const builtin=record?bool(record.builtin):false;
 const active=builtin?true:body.active!==false;
 const ids=Array.isArray(body.productIds)?[...new Set(body.productIds.map(Number))]:[];
 if(ids.length>500||ids.some(x=>!Number.isInteger(x)||x<1))
   throw Object.assign(new Error('Invalid product selections.'),{status:400});
 if(ids.length){
   const available=await db.query('SELECT id FROM products WHERE id IN ('+placeholders(1,ids.length)+')',ids);
   if(available.rows.length!==ids.length)throw Object.assign(new Error('An assigned product was not found.'),{status:400});
 }
 await db.transaction(async tx=>{
   if(record)await tx.query('UPDATE pos_categories SET icon_data=$1,active=$2 WHERE name=$3',[icon,active,name]);
   else await tx.query('INSERT INTO pos_categories (name,icon_data,sort_order,builtin,active) VALUES ($1,$2,$3,$4,$5)',
     [name,icon,100,false,active]);
   if(!builtin){
     await tx.query('DELETE FROM pos_category_products WHERE category_name=$1',[name]);
     for(const id of ids)await tx.query('INSERT INTO pos_category_products (category_name,product_id) VALUES ($1,$2)',[name,id]);
   }
 });
 await logAction(user, 'POS category saved: '+name,'POS Category Updated',null);
 return {ok:true,name};
}
async function deletePosCategory(user,name){
 const r=await db.query('SELECT builtin FROM pos_categories WHERE name=$1',[name]);
 if(!r.rows.length)throw Object.assign(new Error('Category not found.'),{status:404});
 if(bool(r.rows[0].builtin))throw Object.assign(new Error('Built-in categories cannot be deleted.'),{status:400});
 await db.query('DELETE FROM pos_categories WHERE name=$1',[name]);
 await logAction(user,'POS category deleted: '+name,'POS Category Deleted',null);
 return {ok:true};
}

function slug(s){return normalize(s).replace(/[^A-Z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,70)||'ITEM';}
async function createProduct(user,body){const name=String(body.name||'').trim(),category=String(body.category||''),price=Number(body.price);if(!name||name.length>150||!validCategory(category)||!Number.isFinite(price)||price<0||price>MAX_MONEY)throw Object.assign(new Error('Product name (max 150 characters), valid category, and a supported non-negative price are required.'),{status:400});const dup=await db.query('SELECT id FROM products WHERE LOWER(name)=LOWER($1)',[name]);if(dup.rows.length)throw Object.assign(new Error('Product name already exists.'),{status:409});const active=body.active===undefined?true:!!body.active;const imageData=validatedProductImage(body.imageData)??null;const sku=`WEB-${slug(name)}-${Date.now().toString(36).toUpperCase()}`;const r=await db.query('INSERT INTO products (sku,name,category,price,active,created_at,updated_at,image_data) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',[sku,name,category,money(price),active,nowIso(),nowIso(),imageData]);await logAction(user,`Product added: ${name}`,'Product Added',category);return{id:Number(r.rows[0].id)};}
async function activePackagesUsingProduct(productId,conn=db){const r=await conn.query(`SELECT p.name FROM package_items pi JOIN packages p ON p.id=pi.package_id WHERE pi.product_id=$1 AND p.active=$2 ORDER BY p.name`,[Number(productId),true]);return r.rows.map(x=>x.name);}
async function assertProductCanDeactivate(productId,conn=db){const packages=await activePackagesUsingProduct(productId,conn);if(packages.length)throw Object.assign(new Error(`This product is used by active package(s): ${packages.slice(0,5).join(', ')}. Remove it from those package compositions or disable the packages first.`),{status:409});}
async function updateProduct(user,id,body){const r=await db.query('SELECT * FROM products WHERE id=$1',[Number(id)]);const p=r.rows[0];if(!p)throw Object.assign(new Error('Product not found.'),{status:404});const category=body.category===undefined?p.category:String(body.category),price=body.price===undefined?Number(p.price):Number(body.price),active=body.active===undefined?bool(p.active):!!body.active;if(!validCategory(category)||!Number.isFinite(price)||price<0||price>MAX_MONEY)throw Object.assign(new Error('Invalid product update.'),{status:400});if(bool(p.active)&&!active)await assertProductCanDeactivate(Number(id));const nextImage=body.imageData===p.image_data?p.image_data:validatedProductImage(body.imageData);await db.query('UPDATE products SET category=$1,price=$2,active=$3,updated_at=$4,image_data=$5 WHERE id=$6',[category,money(price),active,nowIso(),nextImage===undefined?p.image_data||null:nextImage,Number(id)]);await logAction(user,`Product updated: ${p.name}`,'Product Updated',`${category} / PHP ${money(price)}`);return{ok:true};}
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
async function emailSalesReport(user,body){const params={period:body.period,date:body.date,cashier:body.cashier,branchId:body.branchId};const {report,filename,buffer}=await salesPdf(params);const settings=await getSettings();let to=settings.defaultReportEmail;if(user.role==='Admin'&&String(body.to||'').trim())to=String(body.to).trim();if(!to)throw Object.assign(new Error('Configure a default report recipient first.'),{status:400});if(to.length>320||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to))throw Object.assign(new Error('Report recipient email is invalid.'),{status:400});if(!process.env.SMTP_USER||!process.env.SMTP_PASS)throw Object.assign(new Error('Email is not configured on the server. Set SMTP_USER and SMTP_PASS in the server environment.'),{status:503});const daily=report.period==='daily';const subject=daily?'Daily Report Notification':`${titleCase(report.period)} Report Notification`;const bodyText=daily?'Hello, attached are the daily reports.':`Hello, attached are the ${report.period} reports.`;try{await sendMail({host:process.env.SMTP_HOST||'smtp.gmail.com',port:Number(process.env.SMTP_PORT||465),user:process.env.SMTP_USER,pass:process.env.SMTP_PASS,from:process.env.SMTP_FROM||process.env.SMTP_USER,to,subject,text:bodyText,attachments:[{filename,contentType:'application/pdf',data:buffer}]});await logAction(user,`Report emailed: ${filename}`,'Email Sent',to);return{ok:true,to,filename};}catch(err){await logAction(user,`Report email failed: ${filename}`,'Email Failed',err.message);const e=new Error('Unable to send the report email. Please check the server internet/SMTP settings and try again.');e.status=502;e.details={reason:err.message};throw e;}}

/* Dashboard sales activity, branch scoped. Deleted covers void/cancel in legacy schema. */
/* Dashboard activity is paged and branch-scoped; 5 sales per view. */
async function dashboardActivity(user,params={}){
 const status=String(params.status||'all').toLowerCase(),period=String(params.period||'all').toLowerCase();
 if(!['all','sold','voided'].includes(status)||!['all','today','7days','30days'].includes(period))
  throw Object.assign(new Error('Invalid dashboard activity filter.'),{status:400});
 const page=Math.min(10000,Math.max(1,Number(params.page)||1));
 if(!Number.isSafeInteger(page))throw Object.assign(new Error('Invalid activity page.'),{status:400});
 const branchId=await branchSupport.salesScope(db,user,params.branchId);
 if(user.role==='Admin'&&branchId!=null)await ensureBranchInOwnerWorkspace(user,branchId);
 const args=[],parts=[];
 if(branchId!=null){args.push(branchId);parts.push('branch_id=$'+args.length);}
 else{
  const workspace=await workspaceIdForUser(user.id);
  if(!workspace)throw Object.assign(new Error('Franchise workspace not found.'),{status:403});
  args.push(workspace);
  parts.push('EXISTS (SELECT 1 FROM chat_workspace_branches wb WHERE wb.workspace_id=$'+
    args.length+' AND wb.branch_id=sales.branch_id)');
 }
 if(status!=='all'){args.push(status==='sold'?'Sold':'Deleted');parts.push('status=$'+args.length);}
 if(period!=='all'){
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:MANILA_TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const back=period==='today'?0:period==='7days'?-6:-29;
  args.push(new Date(addDays(today,back)+'T00:00:00+08:00').toISOString());parts.push('sold_at >= $'+args.length);
 }
 const where=parts.length?'WHERE '+parts.join(' AND '):'';
 const total=Number((await db.query('SELECT COUNT(*) AS c FROM sales '+where,args)).rows[0]?.c||0);
 const pages=Math.max(1,Math.ceil(total/5)),safePage=Math.min(page,pages);
 const query='SELECT id,reference,sold_at,cashier_name_snapshot,payment_mode,actual,order_type,customer_name,table_label,status FROM sales '+
  where+' ORDER BY sold_at DESC,id DESC LIMIT 5 OFFSET '+(5*(safePage-1));
 const list=(await db.query(query,args)).rows;
 const ids=list.map(x=>Number(x.id)),byId=new Map();
 if(ids.length){
  const records=(await db.query('SELECT sale_id,product_name_snapshot,quantity,unit_price,line_total FROM sale_items WHERE sale_id IN ('+
   placeholders(1,ids.length)+') ORDER BY sale_id,id',ids)).rows;
  for(const item of records){
   const id=Number(item.sale_id);if(!byId.has(id))byId.set(id,[]);
   byId.get(id).push({name:item.product_name_snapshot,qty:Number(item.quantity),
     unitPrice:Number(item.unit_price),lineTotal:Number(item.line_total)});
  }
 }
 return{status,period,page:safePage,pages,total,rows:list.map(x=>({
  reference:x.reference,soldAt:x.sold_at,cashier:x.cashier_name_snapshot||null,
  paymentMode:x.payment_mode,amount:Number(x.actual||0),orderType:x.order_type||'Take Away',
  customerName:x.customer_name||null,tableLabel:x.table_label||null,status:x.status,
  items:byId.get(Number(x.id))||[]
 }))};
}

/* User-facing widget settings are stored per owner workspace and plan.
   Admin and Co-Owner share their franchise account's layout across devices. */
const PLAN_WIDGETS={
 PRO:['pro-bought-together','pro-addon-conversion','pro-sales-growth',
  'pro-opportunity-hours','pro-product-pairings','pro-daily-insights','standout-insights'],
 BUSINESS:['pro-bought-together','pro-addon-conversion','pro-sales-growth','pro-opportunity-hours',
  'pro-product-pairings','pro-daily-insights','biz-branch-health','biz-same-store',
  'biz-product-comparison','biz-cash-variance','biz-transaction-monitor',
  'biz-stock-transfers','standout-insights']
};
async function widgetSettings(user,plan,body){
 requireAdminRole(user);
 if(!Object.hasOwn(PLAN_WIDGETS,plan))throw Object.assign(new Error('Invalid subscription plan.'),{status:400});
 const ws=await workspaceIdForUser(user.id);
 if(!ws)throw Object.assign(new Error('Franchise account workspace is unavailable.'),{status:403});
 const key='dashboard_widgets_v1573_'+ws+'_'+plan;
 if(body!=null){
  const allowed=new Set(PLAN_WIDGETS[plan]);
  if(!Array.isArray(body.order)||body.order.length>allowed.size||body.order.some(x=>!allowed.has(x))||
    new Set(body.order).size!==body.order.length||
    !Array.isArray(body.hidden)||body.hidden.length>allowed.size||body.hidden.some(x=>!allowed.has(x))||
    new Set(body.hidden).size!==body.hidden.length)
   throw Object.assign(new Error('Widget preferences contain invalid or duplicate cards.'),{status:400});
  const setting={order:body.order,hidden:body.hidden};
  await db.query('INSERT INTO app_settings(setting_key,setting_value,updated_at) VALUES($1,$2,$3) '+
    'ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_at=excluded.updated_at',
    [key,JSON.stringify(setting),nowIso()]);
  return setting;
 }
 const found=(await db.query('SELECT setting_value FROM app_settings WHERE setting_key=$1',[key])).rows;
 if(!found.length)return{order:[],hidden:[]};
 try{
  const value=JSON.parse(found[0].setting_value);
  const allowed=new Set(PLAN_WIDGETS[plan]);
  return{order:Array.isArray(value.order)?value.order.filter(x=>allowed.has(x)):[],
    hidden:Array.isArray(value.hidden)?value.hidden.filter(x=>allowed.has(x)):[]};
 }catch(_){throw Object.assign(new Error('Widget settings require review.'),{status:409});}
}

async function dashboardData(params={},branchId=null,user=null){
  const workspace=await workspaceIdForUser(user?.id);
  if(!workspace)throw Object.assign(new Error('Franchise workspace not found.'),{status:403});
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:MANILA_TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const monthStart=today.slice(0,7)+'-01';
  const nextMonth=new Date(Date.UTC(Number(today.slice(0,4)),Number(today.slice(5,7)),1)).toISOString().slice(0,10);
  const dayAfter=addDays(today,1);
  const toUtc=day=>new Date(day+'T00:00:00+08:00').toISOString();
  const scopeId=branchId==null?workspace:Number(branchId);
  const scopedArgs=(from,to)=>['Sold',toUtc(from),toUtc(to),scopeId];
  const branchClause=branchId==null?
    ' AND EXISTS (SELECT 1 FROM chat_workspace_branches wb WHERE wb.workspace_id=$4 AND wb.branch_id=s.branch_id)':
    ' AND s.branch_id=$4';
  // Dashboard cards need lightweight sums, not complete sale reports and product costing.
  const summarize=async(from,to)=>{
    const r=await db.query(
      'SELECT COUNT(*) AS ct,COALESCE(SUM(s.gross),0) AS gross,COALESCE(SUM(s.actual),0) AS actual '+
      'FROM sales s WHERE s.status=$1 AND s.sold_at >= $2 AND s.sold_at < $3'+branchClause,
      scopedArgs(from,to));
    const x=r.rows[0]||{};
    return{transactionCount:Number(x.ct||0),gross:money(Number(x.gross||0)),actual:money(Number(x.actual||0))};
  };
  const [todayR,monthR,trendResult,inv,monthItemsR,activeR]=await Promise.all([
    summarize(today,dayAfter),summarize(monthStart,nextMonth),
    branchSupport.buildTrend(db,params,branchId,workspace),getInventory(),
    db.query('SELECT si.product_name_snapshot,si.is_add_on,si.is_package,p.category,'+
      'SUM(si.quantity) AS qty,SUM(si.line_total) AS amount FROM sale_items si '+
      'JOIN sales s ON s.id=si.sale_id LEFT JOIN products p ON p.id=si.product_id '+
      'WHERE s.status=$1 AND s.sold_at >= $2 AND s.sold_at < $3'+branchClause+
      ' GROUP BY si.product_name_snapshot,si.is_add_on,si.is_package,p.category',
      scopedArgs(monthStart,nextMonth)),
    db.query('SELECT id,name FROM products WHERE active=$1 ORDER BY name LIMIT 150',[true])
  ]);
  const monthItems=monthItemsR.rows;
  const activeProducts=activeR.rows;
  // Real net sales, allocated to menu categories by each sale's adjustment ratio.
  // Match the selected branch, date range, and Manila clock used by the total trend.
  const startUtc=new Date(trendResult.from+'T00:00:00+08:00').toISOString();
  const endUtc=new Date(addDays(trendResult.to,1)+'T00:00:00+08:00').toISOString();
  const trendArgs=['Sold',startUtc,endUtc,scopeId];
  const expensePromise=user?.role==='Admin'?
    posFinance.expenses(db,user,{start:trendResult.from,end:trendResult.to,
      ...(branchId==null?{}:{branchId})}).then(x=>x.grandTotal)
      .catch(error=>{console.warn('Dashboard expenses unavailable:',error.message);return null;}):
    Promise.resolve(null);
  const [trendRows,rangeTotalsR,totalExpenses]=await Promise.all([
    db.query('SELECT s.id,s.sold_at,s.gross,s.actual,si.line_total,si.is_add_on,si.is_package,p.category '+
      'FROM sales s JOIN sale_items si ON si.sale_id=s.id LEFT JOIN products p ON p.id=si.product_id '+
      'WHERE s.status=$1 AND s.sold_at >= $2 AND s.sold_at < $3'+
      branchClause+' ORDER BY s.sold_at,s.id,si.id',trendArgs),
    db.query('SELECT COALESCE(SUM(s.gross),0) AS gross,'+
      'COALESCE(SUM(s.discount_amount),0) AS discount FROM sales s '+
      'WHERE s.status=$1 AND s.sold_at >= $2 AND s.sold_at < $3'+
      branchClause,trendArgs),
    expensePromise
  ]);
  const rangeTotals=rangeTotalsR.rows[0]||{};
  const categoryNames=['Coffee','Non Coffee','Food','Add-ons','Packages','Other'];
  const categoryBuckets=new Map(categoryNames.map(name=>[name,Array(trendResult.trend.length).fill(0)]));
  const dayIndex=new Map();
  if(trendResult.grain==='daily'){
    for(let i=0;i<trendResult.days;i++)dayIndex.set(addDays(trendResult.from,i),i);
  }
  const hourFormatter=new Intl.DateTimeFormat('en-GB',{timeZone:MANILA_TZ,hour:'2-digit',hourCycle:'h23'});
  for(const row of trendRows.rows){
    const when=new Date(row.sold_at);
    const slot=trendResult.grain==='hourly'?Number(hourFormatter.format(when)):dayIndex.get(manilaDateString(when.toISOString()));
    if(!Number.isInteger(slot)||slot<0||slot>=trendResult.trend.length)continue;
    const category=bool(row.is_add_on)?'Add-ons':bool(row.is_package)?'Packages':
      (['Coffee','Non Coffee','Food'].includes(row.category)?row.category:'Other');
    const factor=Number(row.gross)>0?Number(row.actual||0)/Number(row.gross):0;
    categoryBuckets.get(category)[slot]+=Number(row.line_total||0)*factor;
  }
  const categoryTrends=categoryNames.filter(name=>{
    const vals=categoryBuckets.get(name);
    return ['Coffee','Non Coffee','Food'].includes(name)||vals.some(v=>v>0);
  }).map(name=>({name,values:categoryBuckets.get(name).map(v=>money(v))}));

  const lowStock=inv.filter(x=>x.low).sort((a,b)=>a.stock-b.stock).slice(0,10);
  const groupedProducts=new Map();
  for(const row of monthItems){
    if(bool(row.is_add_on))continue;
    const name=String(row.product_name_snapshot||'Product'),key=normalize(name);
    const previous=groupedProducts.get(key)||{name,qty:0};
    previous.qty+=Number(row.qty||0);groupedProducts.set(key,previous);
  }
  const topProducts=[...groupedProducts.values()].sort((a,b)=>b.qty-a.qty).slice(0,8);
  const performanceProducts=topProducts.map(x=>({name:x.name,qty:Number(x.qty)}));
  const performanceNames=new Set(performanceProducts.map(x=>normalize(x.name)));
  for(const p of activeProducts){
    if(performanceProducts.length>=8)break;
    if(!performanceNames.has(normalize(p.name))){
      performanceProducts.push({name:p.name,qty:0});
      performanceNames.add(normalize(p.name));
    }
  }
  const categoryMap=new Map();
  for(const row of monthItems){
    const cat=bool(row.is_add_on)?'Add-ons':bool(row.is_package)?'Packages':row.category||'Other';
    categoryMap.set(cat,money((categoryMap.get(cat)||0)+Number(row.amount||0)));
  }
  // Compact recent activity, already scoped by the authorized dashboard branch.
  // Keep this query bounded; product/customer details are optional on historical sales.
  const recentArgs=['Sold',scopeId];
  const recentClause=branchId==null?
    ' AND EXISTS (SELECT 1 FROM chat_workspace_branches wb WHERE wb.workspace_id=$2 AND wb.branch_id=s.branch_id)':
    ' AND s.branch_id=$2';
  const recentR=await db.query(
    'SELECT s.id,s.reference,s.sold_at,s.cashier_name_snapshot,s.payment_mode,s.actual,s.order_type,s.customer_name,s.table_label '+
    'FROM sales s WHERE s.status=$1'+recentClause+' ORDER BY s.sold_at DESC,s.id DESC LIMIT 8',recentArgs
  );
  const recentIds=recentR.rows.map(s=>Number(s.id));
  const itemsBySale=new Map();
  if(recentIds.length){
    const recentItems=await db.query(
      'SELECT sale_id,product_name_snapshot,quantity FROM sale_items WHERE sale_id IN ('+
      placeholders(1,recentIds.length)+') ORDER BY sale_id,id',recentIds
    );
    for(const item of recentItems.rows){
      const id=Number(item.sale_id);
      if(!itemsBySale.has(id))itemsBySale.set(id,[]);
      itemsBySale.get(id).push({name:item.product_name_snapshot,qty:Number(item.quantity)});
    }
  }
  const recentTransactions=recentR.rows.map(x=>({
    reference:x.reference,soldAt:x.sold_at,cashier:x.cashier_name_snapshot||null,
    paymentMode:x.payment_mode,amount:Number(x.actual||0),
    orderType:x.order_type||'Take Away',customerName:x.customer_name||null,
    tableLabel:x.table_label||null,items:itemsBySale.get(Number(x.id))||[]
  }));
  return{today,metrics:{todayActual:todayR.actual,todayGross:todayR.gross,todayTransactions:todayR.transactionCount,
    monthActual:monthR.actual,monthGross:monthR.gross,monthTransactions:monthR.transactionCount,
    lowStockCount:inv.filter(x=>x.low).length,inventoryCount:inv.length},
    ...trendResult,rangeGross:money(Number(rangeTotals.gross||0)),
    rangeDiscount:money(Number(rangeTotals.discount||0)),rangeExpenses:totalExpenses,
    branchId,categoryTrends,performanceProducts,
    topProducts:topProducts.map(x=>({name:x.name,qty:x.qty,actual:null})),
    lowStock,categorySales:[...categoryMap].map(([name,amount])=>({name,amount})),recentTransactions};
}

/* Plan dashboard insights: read-only aggregates from saved transactions.
   Current metrics cover rolling 30 days, with week and prior-window comparisons.
   No subscription billing or POS writes. */
async function planDashboardInsights(user,requestedBranch){
  requireAdminRole(user);
  const workspace=await workspaceIdForUser(user.id);
  const plan=workspace?(await platformAccounts.accountSubscription(db,workspace)).plan:'PRO';
  const branchId=await branchSupport.salesScope(db,user,requestedBranch);
  if(branchId!=null)await ensureBranchInOwnerWorkspace(user,branchId);
  const today=new Intl.DateTimeFormat('en-CA',{
    timeZone:MANILA_TZ,year:'numeric',month:'2-digit',day:'2-digit'
  }).format(new Date());
  const oldest=addDays(today,-60),end=addDays(today,1);
  const startIso=new Date(oldest+'T00:00:00+08:00').toISOString();
  const endIso=new Date(end+'T00:00:00+08:00').toISOString();
  if(!workspace)throw Object.assign(new Error('Franchise account has no workspace.'),{status:403});
  const baseParams=[startIso,endIso,workspace,...(branchId==null?[]:[branchId])];
  const whereBranch=branchId==null?'':' AND s.branch_id=$4';
  const salesR=await db.query(
    'SELECT s.id,s.sold_at,s.branch_id,s.status,s.actual,s.discount_amount,s.payment_mode '+
    'FROM sales s JOIN chat_workspace_branches w ON w.branch_id=s.branch_id '+
    'WHERE s.sold_at >= $1 AND s.sold_at < $2 AND w.workspace_id=$3'+whereBranch+
    ' ORDER BY s.sold_at DESC,s.id DESC LIMIT 15001',baseParams
  );
  const partialSales=salesR.rows.length>15000;
  const sales=salesR.rows.slice(0,15000);
  const validSales=sales.filter(x=>x.status==='Sold');
  const date=x=>manilaDateString(new Date(x.sold_at).toISOString());
  const dayMinus=n=>addDays(today,-n);
  const sum=(list)=>money(list.reduce((v,x)=>v+Number(x.actual||0),0));
  const within=(rows,low,high)=>rows.filter(x=>date(x)>=low&&date(x)<=high);
  const last30=within(validSales,dayMinus(29),today);
  const week=within(validSales,dayMinus(6),today);
  const prevWeek=within(validSales,dayMinus(13),dayMinus(7));
  const prior30=within(validSales,dayMinus(59),dayMinus(30));
  const weekActual=sum(week),prevWeekActual=sum(prevWeek);
  const growthPercent=prevWeekActual>0?Math.round((weekActual-prevWeekActual)/prevWeekActual*1000)/10:null;
  const current30Total=sum(last30),prior30Total=sum(prior30);
  const itemsR=await db.query(
    'SELECT s.id AS sale_id,s.branch_id,si.product_name_snapshot,si.quantity,si.line_total,si.is_add_on '+
    'FROM sale_items si JOIN sales s ON s.id=si.sale_id '+
    'JOIN chat_workspace_branches w ON w.branch_id=s.branch_id '+
    'WHERE s.status=$1 AND s.sold_at >= $2 AND s.sold_at < $3 AND w.workspace_id=$4'+
    (branchId==null?'':' AND s.branch_id=$5')+
    ' ORDER BY s.id DESC,si.id LIMIT 30001',
    ['Sold',new Date(dayMinus(29)+'T00:00:00+08:00').toISOString(),endIso,workspace,
      ...(branchId==null?[]:[branchId])]
  );
  const partialItems=itemsR.rows.length>30000;
  const items=itemsR.rows.slice(0,30000);
  const basketMap=new Map(),byBranchProduct=new Map();
  let addonRevenue=0;
  for(const item of items){
    const sid=Number(item.sale_id),name=String(item.product_name_snapshot||'Unnamed item');
    if(!basketMap.has(sid))basketMap.set(sid,{names:new Set(),hasAddon:false});
    const basket=basketMap.get(sid);
    if(bool(item.is_add_on)){basket.hasAddon=true;addonRevenue+=Number(item.line_total||0);}
    else basket.names.add(name);
    const key=String(item.branch_id||'')+'\u001f'+name;
    byBranchProduct.set(key,(byBranchProduct.get(key)||0)+Number(item.quantity||0));
  }
  const counts=new Map();
  for(const basket of basketMap.values()){
    const names=[...basket.names].slice(0,30).sort();
    for(let i=0;i<names.length;i++)for(let j=i+1;j<names.length;j++){
      const k=JSON.stringify([names[i],names[j]]);
      counts.set(k,(counts.get(k)||0)+1);
    }
  }
  const pairs=[...counts].sort((a,b)=>b[1]-a[1]).slice(0,6).map(([key,count])=>({
    items:JSON.parse(key),orders:count
  }));
  const addOnOrders=[...basketMap.values()].filter(x=>x.hasAddon).length;
  const addonRate=basketMap.size?Math.round(addOnOrders/basketMap.size*1000)/10:null;
  const hourly=new Array(10).fill(0);
  const fmtHour=new Intl.DateTimeFormat('en-GB',{timeZone:MANILA_TZ,hour:'2-digit',hourCycle:'h23'});
  for(const sale of last30){const h=Number(fmtHour.format(new Date(sale.sold_at)));if(h>=9&&h<=18)hourly[h-9]++;}
  const hours=hourly.map((orders,i)=>({hour:i+9,orders}));
  const todaySales=within(validSales,today,today),yesterdaySales=within(validSales,dayMinus(1),dayMinus(1));
  const last30ByBranch=new Map();
  for(const sale of last30){
    const id=Number(sale.branch_id||0);
    if(!last30ByBranch.has(id))last30ByBranch.set(id,{orders:0,actual:0});
    const o=last30ByBranch.get(id);o.orders++;o.actual+=Number(sale.actual||0);
  }
  const result={
    plan,scope:branchId,today,period:'rolling 30 days',
    partial:partialSales||partialItems,
    pro:{
      pairs,addOnOrders,addOnSales:money(addonRevenue),addonRate,
      salesWindow:{current:weekActual,previous:prevWeekActual,growthPercent},
      hours,
      today:{actual:sum(todaySales),orders:todaySales.length,
        previousActual:sum(yesterdaySales),previousOrders:yesterdaySales.length},
      ordersAnalyzed:basketMap.size,
      total30:{actual:current30Total,orders:last30.length}
    }
  };
  if(plan==='BUSINESS'){
    const bRows=(await db.query('SELECT b.id,b.name,b.created_at FROM branches b '+
      'JOIN chat_workspace_branches w ON w.branch_id=b.id WHERE w.workspace_id=$1 ORDER BY b.id',
      [workspace])).rows;
    const names=new Map(bRows.map(b=>[Number(b.id),b.name]));
    const storeResults=bRows
      .filter(b=>branchId==null||Number(b.id)===branchId)
      .map(b=>{
        const id=Number(b.id);
        const current=last30ByBranch.get(id)||{actual:0,orders:0};
        const previous=sum(prior30.filter(x=>Number(x.branch_id)===id));
        const eligible=manilaDateString(new Date(b.created_at).toISOString())<=dayMinus(59);
        return{name:b.name,id,orders:current.orders,
          current:money(current.actual),previous,comparable:eligible,
          growthPercent:eligible&&previous>0?Math.round((current.actual-previous)/previous*1000)/10:null};
      });
    const products=[...byBranchProduct].map(([key,qty])=>{
      const [rawId,name]=key.split('\u001f');
      return{branchId:Number(rawId),branch:names.get(Number(rawId))||'Unknown branch',name,qty:Math.round(qty*100)/100};
    }).sort((a,b)=>b.qty-a.qty).slice(0,60);
    const reviews=within(sales,dayMinus(29),today);
    const voided=reviews.filter(x=>x.status==='Deleted').length;
    const discounted=last30.filter(x=>Number(x.discount_amount||0)>0).length;
    // Transfer records are scoped to the current owner account's users.
    // Branch filters match the recorded destination, not a nonexistent origin field.
    const workspaceId=await workspaceIdForUser(user.id);
    const transferParams=[workspaceId];
    let destinationFilter='';
    if(branchId!=null){
      const selected=(await db.query('SELECT name FROM branches WHERE id=$1',[branchId])).rows[0];
      if(selected){transferParams.push(selected.name);destinationFilter=' AND LOWER(m.branch)=LOWER($2)';}
    }
    const transferRows=(await db.query(
      'SELECT m.reference,m.branch,m.created_at,m.remarks,m.received_by,m.quantity_change,'+
      'i.display_name AS ingredient,i.uom FROM inventory_movements m '+
      'JOIN ingredients i ON i.id=m.ingredient_id '+
      "WHERE m.movement_type='TRANSFER' "+
      'AND EXISTS (SELECT 1 FROM chat_memberships cm WHERE cm.user_id=m.created_by AND cm.workspace_id=$1)'+
      destinationFilter+' ORDER BY m.created_at DESC,m.id DESC LIMIT 1000',transferParams
    )).rows;
    const transferGroups=new Map();
    for(const line of transferRows){
      const key=String(line.reference||'')+'|'+String(line.branch||'');
      if(!transferGroups.has(key))transferGroups.set(key,{
        reference:line.reference,location:line.branch||'Unknown location',
        description:'Stock transfer '+String(line.reference||'').slice(0,14),
        dateTime:line.created_at,remarks:line.remarks||'',receivedBy:line.received_by||'',
        lines:[]
      });
      transferGroups.get(key).lines.push({
        description:line.ingredient,uom:line.uom,quantity:Math.abs(Number(line.quantity_change||0))
      });
    }
    result.business={
      branches:storeResults,products,
      cashVariance:{available:false,reason:'A physical cash-count recording workflow is needed before variance can be calculated.'},
      health:{available:false,reason:'Define a validated branch health formula and branch-level stock data first.'},
      reviewSignals:{voided,discounted,scope:'rolling 30 days',note:'Review signals only; not evidence of suspicious activity.'},
      transfers:[...transferGroups.values()].slice(0,15),
      sameStoreEligible:storeResults.filter(x=>x.comparable).length
    };
  }
  return result;
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
    db=await createDb();await initSchema();await migrateSchema();await seedDatabase();await branchSupport.migrateBranches(db);await internalChat.migrate(db);await migrateCashierProfiles();await db.query('DELETE FROM sessions');
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

// Portable non-credential business data export, not an automated database
// snapshot or a restorable native PostgreSQL dump. Admin-only and read-only.
const DATA_EXPORT_TABLES=Object.freeze([
  'branches','products','add_ons','ingredients','product_ingredients',
  'packages','package_items','promos','pos_categories','pos_category_products',
  'sales','sale_items','sale_item_components','inventory_movements','system_logs'
]);
async function makePortableDataExport(){
  const result=await db.transaction(async tx=>{
    if(tx.engine==='postgres')
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    const manifest={},rows={};
    for(const table of DATA_EXPORT_TABLES){
      // Table names come only from this fixed allowlist, never from the client.
      const existing=tx.engine==='postgres'
        ?await tx.query('SELECT 1 FROM information_schema.tables WHERE table_schema=$1 AND table_name=$2',['public',table])
        :await tx.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=$1",[table]);
      if(!existing.rows.length)continue;
      const result=await tx.query('SELECT * FROM '+table+' LIMIT 75001');
      if(result.rows.length>75000)
        throw Object.assign(new Error('Data export exceeds the per-table row limit. Use a full PostgreSQL database dump for this dataset.'),{status:413});
      rows[table]=result.rows;
      manifest[table]=result.rows.length;
    }
    return {manifest,rows};
  });
  const body={
    format:'donmac-business-data-archive',
    version:1,
    exportedAt:nowIso(),
    databaseEngine:db.engine,
    restoreSupported:false,
    note:'Read-only business data archive; not a replacement for a restorable full database backup. Auth credentials, sessions, and private chat messages are excluded.',
    tables:result.rows,
    counts:result.manifest
  };
  const buffer=Buffer.from(JSON.stringify(body));
  if(buffer.length>60*1024*1024)
    throw Object.assign(new Error('Archive exceeds 60 MB. Request a managed PostgreSQL database dump for larger exports.'),{status:413});
  return {buffer,filename:'DonMac_Data_Archive_'+nowIso().slice(0,10)+'.json'};
}
const RETENTION_PREF_KEY='retention_preview_frequency_v1';
async function getRetentionPreview(){
  const r=await db.query('SELECT setting_value FROM app_settings WHERE setting_key=$1',[RETENTION_PREF_KEY]);
  let p=null;
  try{p=JSON.parse(r.rows[0]?.setting_value||'null');}catch(_){}
  const enabled=p?.demoEnabled===true;
  const frequency=['monthly','quarterly','yearly'].includes(p?.frequency)?p.frequency:'monthly';
  return {demoEnabled:enabled,frequency,subscriptionActive:false,
    automaticOffsiteBackupActive:false,automaticRetentionActive:false,
    historicDataAccessRestricted:false,
    priceMonthly:299,priceYearly:2990,
    note:'Saved preferences only; no real subscription, billing, automatic off-site backup, expiration or annual data-locking is active.'};
}
async function saveRetentionPreview(user,input){
  requireAdminRole(user);
  const enabled=input?.demoEnabled===true;
  const frequency=String(input?.frequency||'monthly');
  if(!['monthly','quarterly','yearly'].includes(frequency))
    throw Object.assign(new Error('Choose Monthly, Quarterly or Yearly.'),{status:400});
  const value={demoEnabled:enabled,frequency,updatedAt:nowIso(),updatedBy:user.id};
  await db.transaction(async tx=>{
    await tx.query('INSERT INTO app_settings (setting_key,setting_value,updated_at) VALUES ($1,$2,$3) ON CONFLICT (setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_at=excluded.updated_at',
      [RETENTION_PREF_KEY,JSON.stringify(value),nowIso()]);
    await logAction(user,'Retention preview preference saved','Retention Preview',
      (enabled?'Enabled':'Disabled')+' / '+frequency+' (no billing or automatic storage)',tx);
  });
  return getRetentionPreview();
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
function safeHeaders(extra={}){return{'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Frame-Options':'DENY','Permissions-Policy':'camera=(), microphone=(), geolocation=()','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",...extra};}
function binary(res,status,buffer,contentType,headers={}){res.writeHead(status,safeHeaders({'Content-Type':contentType,'Content-Length':buffer.length,...headers}));res.end(buffer);}
function serveStatic(req,res,pathname){const rel=pathname==='/'?'index.html':decodeURIComponent(pathname).replace(/^\/+/,''),file=path.resolve(PUBLIC_DIR,rel);if(!file.startsWith(path.resolve(PUBLIC_DIR)+path.sep)&&file!==path.join(PUBLIC_DIR,'index.html'))return false;if(!fs.existsSync(file)||!fs.statSync(file).isFile())return false;const stat=fs.statSync(file),etag='"'+stat.size.toString(16)+'-'+Math.trunc(stat.mtimeMs).toString(16)+'"';
 const headers=safeHeaders({'Content-Type':mimeType(file),'Cache-Control':'private, no-cache','ETag':etag});
 if(req.headers['if-none-match']===etag){res.writeHead(304,headers);res.end();return true;}
 const data=fs.readFileSync(file);res.writeHead(200,{...headers,'Content-Length':data.length});res.end(data);return true;}

const loginAttempts=new Map();
function loginRateKey(req,username){return `${req.socket.remoteAddress||'local'}|${normalize(username).slice(0,80)}`;}
function checkLoginRate(req,username){const key=loginRateKey(req,username),now=Date.now(),windowMs=10*60*1000,max=20;const arr=(loginAttempts.get(key)||[]).filter(t=>now-t<windowMs);if(arr.length>=max)throw Object.assign(new Error('Too many login attempts for this account. Please try again later.'),{status:429});arr.push(now);loginAttempts.set(key,arr);}
function clearLoginRate(req,username){loginAttempts.delete(loginRateKey(req,username));}

const OFFICE_CREDENTIAL_KEY='supply_office_credential_v2';
async function officeCredential(){
 const r=await db.query('SELECT setting_value FROM app_settings WHERE setting_key=$1',[OFFICE_CREDENTIAL_KEY]);
 if(!r.rows.length)return null;
 try{return JSON.parse(r.rows[0].setting_value);}catch(_){throw Object.assign(new Error('Main Office credentials require administrative review.'),{status:409});}
}
const officePasswordHash=password=>{
 const salt=crypto.randomBytes(16).toString('hex');
 return{salt,hash:crypto.scryptSync(password,salt,64).toString('hex'),
  version:crypto.randomBytes(20).toString('hex')};
};
const officePasswordMatches=(password,record)=>{
 if(record){
  const supplied=crypto.scryptSync(password,record.salt,64);
  const stored=Buffer.from(record.hash,'hex');
  return stored.length===supplied.length&&crypto.timingSafeEqual(stored,supplied);
 }
 const stored=String(process.env.SUPPLY_OFFICE_PASSWORD_SHA256||'');
 const supplied=crypto.createHash('sha256').update(password).digest('hex');
 return stored.length===supplied.length&&crypto.timingSafeEqual(Buffer.from(stored),Buffer.from(supplied));
};
function officeSessionToken(req){
 const secret=process.env.SUPPLY_OFFICE_SESSION_KEY||'';
 const cookie=parseCookies(req).supply_office_session;
 if(!secret||!cookie)return null;
 const [payload,signature]=cookie.split('.');
 if(!payload||!signature||payload.length>400)return null;
 const expected=crypto.createHmac('sha256',secret).update(payload).digest('hex');
 if(signature.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))return null;
 try{
  const data=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
  return data.role==='main-office'&&data.exp>Date.now()&&data.exp<Date.now()+13*3600*1000?data:null;
 }catch(_){return null;}
}
async function supplyOfficeAuth(req){
 const data=officeSessionToken(req);if(!data)return false;
 const record=await officeCredential();
 return data.credentialVersion===(record?.version||'bootstrap');
}
function issueSupplyOfficeSession(credentialVersion='bootstrap'){
 const secret=process.env.SUPPLY_OFFICE_SESSION_KEY;
 const payload=Buffer.from(JSON.stringify({role:'main-office',exp:Date.now()+12*3600*1000,
    credentialVersion,id:crypto.randomBytes(16).toString('hex')})).toString('base64url');
 const signature=crypto.createHmac('sha256',secret).update(payload).digest('hex');
 const secure=process.env.NODE_ENV==='production'||process.env.COOKIE_SECURE==='true'?'; Secure':'';
 return 'supply_office_session='+payload+'.'+signature+'; HttpOnly; SameSite=Lax; Path=/api/supply/office; Max-Age=43200'+secure;
}
async function handleOfficeApi(req,res,p,method){
  if(!SUPPLY_OFFICE_PORTAL)return json(res,404,{error:'Office portal unavailable on this service.'},safeHeaders());
  // Public callback has no user cookie: PayMongo's signed raw body is mandatory.
  if(method==='POST'&&p==='/api/supply/office/billing/webhook'){
   const raw=await readRawWebhook(req);
   return json(res,200,await platformBilling.processWebhook(db,raw,req.headers['paymongo-signature']),safeHeaders({'Cache-Control':'no-store'}));
  }
  if(p.startsWith('/api/supply/office/platform/'))return platformAdminAuth.handle(req,res,p,method,{db,readJson,json,safeHeaders,parseCookies,checkLoginRate,clearLoginRate,platformAccounts,logAction});
  if(method==='POST'&&p==='/api/supply/office/login'){
    const credentials=await readJson(req);
    const user=String(credentials.username||'').trim(),pass=String(credentials.password||'');
    checkLoginRate(req,'supply-office-'+user);
    const record=await officeCredential();
    const validUser=String(process.env.SUPPLY_OFFICE_USERNAME||'').toLowerCase()===user.toLowerCase();
    if(!validUser||!process.env.SUPPLY_OFFICE_SESSION_KEY||
       !officePasswordMatches(pass,record))
      return json(res,401,{error:'Invalid Main Office credentials.'},safeHeaders());
    clearLoginRate(req,'supply-office-'+user);
    return json(res,200,{ok:true,role:'main-office',mustChangePassword:!record},safeHeaders({'Set-Cookie':issueSupplyOfficeSession(record?.version||'bootstrap')}));
  }
  if(!await supplyOfficeAuth(req))return json(res,401,{error:'Main Office sign-in required.'},safeHeaders());
  if(method==='POST'&&p==='/api/supply/office/change-password'){
    const body=await readJson(req);
    const oldPassword=String(body.currentPassword||''),newPassword=String(body.newPassword||'');
    const record=await officeCredential();
    if(!officePasswordMatches(oldPassword,record))return json(res,403,{error:'Current password is incorrect.'},safeHeaders());
    if(newPassword.length<10||newPassword.length>128||newPassword===oldPassword)
      return json(res,400,{error:'Use a different password with 10–128 characters.'},safeHeaders());
    const updated=officePasswordHash(newPassword);
    await db.query('INSERT INTO app_settings(setting_key,setting_value,updated_at) VALUES($1,$2,$3) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_at=excluded.updated_at',
      [OFFICE_CREDENTIAL_KEY,JSON.stringify(updated),new Date().toISOString()]);
    return json(res,200,{ok:true,mustChangePassword:false},safeHeaders({'Set-Cookie':issueSupplyOfficeSession(updated.version)}));
  }
  const activeCredential=await officeCredential();
  if(!activeCredential&&p!=='/api/supply/office/me'&&p!=='/api/supply/office/logout')
    return json(res,403,{error:'Change the temporary Main Office password before managing requests.'},safeHeaders());
  if(method==='POST'&&p==='/api/supply/office/logout')
    return json(res,200,{ok:true},safeHeaders({'Set-Cookie':'supply_office_session=; Max-Age=0; Path=/api/supply/office; HttpOnly; SameSite=Lax'}));
  if(method==='GET'&&p==='/api/supply/office/me')return json(res,200,{role:'main-office',username:process.env.SUPPLY_OFFICE_USERNAME,mustChangePassword:!activeCredential},safeHeaders());
  if(method==='GET'&&p==='/api/supply/office/billing/me')
    return json(res,200,await platformBilling.tenantSummary(db,'SUPPLY_OFFICE','supply-office'),safeHeaders({'Cache-Control':'no-store'}));
  if(method==='POST'&&p==='/api/supply/office/billing/checkout')
    return json(res,200,await platformBilling.requestCheckout(db,'SUPPLY_OFFICE','supply-office',
      process.env.PAYMONGO_OFFICE_RETURN_URL||'https://don-mac-supply-office-production.up.railway.app/supply-office.html?billing=return'),safeHeaders({'Cache-Control':'no-store'}));
  if(method==='GET'&&p==='/api/supply/office/dashboard')return json(res,200,await supplyChain.operationsDashboard(db),safeHeaders({'Cache-Control':'no-store'}));
  if(method==='GET'&&p==='/api/supply/office/distributions'){
    const page=new URL(req.url,'http://localhost').searchParams.get('page');
    return json(res,200,await supplyChain.distributionHistory(db,page),safeHeaders({'Cache-Control':'no-store'}));
  }
  if(method==='POST'&&p==='/api/supply/office/products')
    return json(res,201,await supplyChain.createProduct(db,await readJson(req)),safeHeaders());
  if(method==='GET'&&p==='/api/supply/office/catalog')return json(res,200,await supplyChain.catalog(db,true),safeHeaders());
  const productMatch=p.match(/^\/api\/supply\/office\/products\/(\d+)$/);
  if(method==='PUT'&&productMatch)
    return json(res,200,await supplyChain.saveProduct(db,Number(productMatch[1]),await readJson(req)),safeHeaders());
  if(method==='GET'&&p==='/api/supply/office/franchisees')
    return json(res,200,{franchisees:await supplyRoyalties.franchisees(db)},safeHeaders());
  const franchiseProfile=p.match(/^\/api\/supply\/office\/franchisees\/(\d+)$/);
  if(method==='GET'&&franchiseProfile)return json(res,200,await supplyRoyalties.profile(db,Number(franchiseProfile[1])),safeHeaders());
  const franchiseFee=p.match(/^\/api\/supply\/office\/franchisees\/(\d+)\/royalty-fee$/);
  if(method==='PUT'&&franchiseFee){
    const body=await readJson(req);
    return json(res,200,await supplyRoyalties.setFee(db,Number(franchiseFee[1]),body.monthlyFee,process.env.SUPPLY_OFFICE_USERNAME||'Main Office'),safeHeaders());
  }
  const royaltyStatus=p.match(/^\/api\/supply\/office\/franchisees\/(\d+)\/royalties\/([0-9a-f-]{36})\/status$/i);
  if(method==='POST'&&royaltyStatus){
    const body=await readJson(req);
    return json(res,200,await supplyRoyalties.setMonthStatus(db,Number(royaltyStatus[1]),royaltyStatus[2],String(body.status||''),process.env.SUPPLY_OFFICE_USERNAME||'Main Office'),safeHeaders());
  }
  if(method==='GET'&&p==='/api/supply/office/promotions')
    return json(res,200,{campaigns:await officePromotions.all(db)},safeHeaders({'Cache-Control':'no-store'}));
  if(method==='POST'&&p==='/api/supply/office/promotions')
    return json(res,201,await officePromotions.create(db,await readJson(req,12000),process.env.SUPPLY_OFFICE_USERNAME||'Main Office'),safeHeaders());
  const promotion=p.match(/^\/api\/supply\/office\/promotions\/([0-9a-f-]{36})(?:\/(participants|deactivate))?$/i);
  if(promotion){
    if(method==='GET'&&promotion[2]==='participants')
      return json(res,200,{participants:await officePromotions.participants(db,promotion[1])},safeHeaders());
    if(method==='POST'&&promotion[2]==='deactivate')
      return json(res,200,await officePromotions.deactivate(db,promotion[1]),safeHeaders());
  }
  if(method==='GET'&&p==='/api/supply/office/orders')return json(res,200,{orders:await supplyChain.list(db)},safeHeaders());
  if(method==='GET'&&p==='/api/supply/office/settings')return json(res,200,await supplyChain.priceSettings(db),safeHeaders());
  if(method==='PUT'&&p==='/api/supply/office/settings')return json(res,200,await supplyChain.setUrgentFee(db,(await readJson(req)).urgentFee),safeHeaders());
  const match=p.match(/^\/api\/supply\/office\/orders\/([0-9a-f-]{36})(?:\/(status|messages))?$/i);
  if(match){
    const [,id,action]=match;
    if(method==='GET'&&!action)return json(res,200,{order:await supplyChain.detail(db,id,null,true)},safeHeaders());
    if(method==='POST'&&action==='status'){
      const body=await readJson(req);
      return json(res,200,await supplyChain.status(db,id,String(body.status||''),body.note||'',process.env.SUPPLY_OFFICE_USERNAME||'Main Office'),safeHeaders());
    }
    if(method==='POST'&&action==='messages')return json(res,201,await (async()=>{const b=await readJson(req);return supplyChain.send(db,id,null,'office','Main Office',b.body,b.image)})(),safeHeaders());
  }
  return json(res,404,{error:'Unknown office endpoint.'},safeHeaders());
}
async function handleFranchiseSupplyApi(req,res,p,method,user){
  if(SUPPLY_OFFICE_PORTAL)throw Object.assign(new Error('Use the separate Main Office portal.'),{status:403});
  if(user.role!=='Admin')throw Object.assign(new Error('Supply Chain is available to franchise Owners and Co-Owners.'),{status:403});
  const workspaceId=await supplyChain.scope(db,user);
  if(method==='GET'&&p==='/api/supply/catalog')
    return json(res,200,{...(await supplyChain.catalog(db)),branches:await supplyChain.ownerBranches(db,workspaceId),royalty:await supplyRoyalties.quote(db,workspaceId)},safeHeaders());
  if(method==='GET'&&p==='/api/supply/orders')return json(res,200,{orders:await supplyChain.list(db,workspaceId)},safeHeaders());
  if(method==='POST'&&p==='/api/supply/orders')return json(res,201,
    {order:await supplyChain.submit(db,user,await readJson(req,2500000))},safeHeaders());
  if(method==='GET'&&p==='/api/supply/notifications')return json(res,200,await supplyChain.notices(db,user),safeHeaders());
  if(method==='POST'&&p==='/api/supply/notifications/read')
    return json(res,200,await supplyChain.markRead(db,user,(await readJson(req)).ids),safeHeaders());
  const match=p.match(/^\/api\/supply\/orders\/([0-9a-f-]{36})(?:\/(messages|appeal))?$/i);
  if(match){
    if(method==='GET'&&p.endsWith(match[1]))return json(res,200,{order:await supplyChain.detail(db,match[1],workspaceId,false)},safeHeaders());
    if(method==='POST'&&p.endsWith('/appeal'))return json(res,201,await (async()=>{const body=await readJson(req);return supplyChain.submitAppeal(db,user,match[1],body.reason)})(),safeHeaders());
    if(method==='POST'&&p.endsWith('/messages'))return json(res,201,
      await (async()=>{const b=await readJson(req);return supplyChain.send(db,match[1],workspaceId,'franchise',user.username,b.body,b.image)})(),safeHeaders());
  }
  return json(res,404,{error:'Unknown supply endpoint.'},safeHeaders());
}
async function handleApi(req,res,url){
  const p=url.pathname,method=req.method;
  if(SUPPLY_OFFICE_PORTAL && p!=='/api/health' && !p.startsWith('/api/supply/office/'))return json(res,404,{error:'Office portal only.'},safeHeaders());
  if(p.startsWith('/api/supply/office/'))return handleOfficeApi(req,res,p,method);
  if(maintenanceMode)return json(res,503,{error:'Database maintenance is in progress. Please retry in a moment.'},safeHeaders({'Retry-After':'2'}));
  if(method==='GET'&&p==='/api/status')return json(res,200,{...(await appStatus()),version:APP_VERSION,authFeatures:{emailOtpAvailable:accountRecovery.isConfigured(),publicOwnerSignupAvailable:false,publicFranchiseRequestAvailable:true,franchiseEmailOtpAvailable:franchiseEmailVerification.configured()}},safeHeaders());
  if(method==='GET'&&p==='/api/health'){const probe=await db.query('SELECT 1 AS ok');return json(res,200,{ok:Number(probe.rows[0]?.ok||0)===1,app:'coffee-pos-web',version:APP_VERSION,engine:db.engine,time:nowIso(),uptimeSeconds:Math.round(process.uptime())},safeHeaders({'Cache-Control':'no-store'}));}
  if(method==='POST'&&p==='/api/setup'){const status=await appStatus();if(!status.setupRequired)return json(res,409,{error:'Initial setup has already been completed.'},safeHeaders());const body=await readJson(req),username=String(body.username||'').trim(),password=String(body.password||'');if(username.length<2||password.length<8)return json(res,400,{error:'Use a username of at least 2 characters and a password of at least 8 characters.'},safeHeaders());const user=await createOrActivateUser({username,password,role:'Admin',active:true},null);await db.query('UPDATE chat_workspaces SET owner_user_id=$1 WHERE id IN (SELECT workspace_id FROM chat_memberships WHERE user_id=$1)',[user.id]);await logAction(user,'Web POS initial admin activated','Setup',null);return json(res,201,{ok:true,user},safeHeaders());}
  if(method==='POST'&&p==='/api/auth/login'){
    const body=await readJson(req),username=String(body.username||'').trim();
    checkLoginRate(req,username);
    // The public username is the only login identifier. If older franchises
    // still have duplicate aliases, a password must match exactly ONE account;
    // no Owner/Branch field is needed and ambiguous credentials never log in.
    const r=await db.query(
      'SELECT u.id,u.username,COALESCE(u.login_username,u.username) AS login_name,'+
      'u.password_hash,u.role,u.active,u.branch_id,u.profile_photo,b.active AS branch_active '+
      'FROM users u LEFT JOIN branches b ON b.id=u.branch_id '+
      'WHERE LOWER(COALESCE(u.login_username,u.username))=LOWER($1) ORDER BY u.id LIMIT 25',[username]);
    const matches=r.rows.filter(u=>bool(u.active)&&verifyPassword(String(body.password||''),u.password_hash));
    if(matches.length!==1)
      return json(res,401,{error:'Invalid username or password. If more than one account uses these credentials, contact your franchise Owner to assign a unique username.'},safeHeaders());
    const u=matches[0];
    if(u.role==='User'&&!bool(u.branch_active))
      return json(res,403,{error:'Your assigned branch is inactive. Please contact your Owner or Co-Owner to move your account to an active branch.',
        code:'BRANCH_INACTIVE'},safeHeaders({'Cache-Control':'no-store'}));
    const access=await platformAccounts.workspaceAccess(db,u.id);
    if(!access.allowed)return json(res,403,{
      error:'This account is '+(access.status==='ON_HOLD'?'on hold':'unpaid')+
        '. POS access is disabled. Please contact Admin Control.',
      code:'SUBSCRIPTION_INACTIVE',status:access.status},safeHeaders({'Cache-Control':'no-store'}));
    clearLoginRate(req,username);
    const token=crypto.randomBytes(32).toString('hex'),expires=new Date(Date.now()+SESSION_HOURS*3600*1000).toISOString();
    await db.query('DELETE FROM sessions WHERE user_id=$1 OR expires_at<$2',[Number(u.id),nowIso()]);
    await db.query('INSERT INTO sessions (token_hash,user_id,expires_at,created_at) VALUES ($1,$2,$3,$4)',[hashToken(token),Number(u.id),expires,nowIso()]);
    const owner=await initialOwnerId(u.id);
    return json(res,200,{user:{id:Number(u.id),username:u.login_name,photoData:u.profile_photo||null,role:u.role,
      branchId:u.branch_id==null?null:Number(u.branch_id),isOwner:Number(u.id)===owner}},
      safeHeaders({'Set-Cookie':cookieHeader(token,SESSION_HOURS*3600)}));
  }
  if(method==='GET'&&p==='/api/auth/username-available'){
    const value=String(url.searchParams.get('username')||'').trim();
    if(!/^[a-zA-Z0-9._-]{3,80}$/.test(value))
      return json(res,200,{available:false,reason:'3–80 letters, numbers, dots, dashes or underscores.'},safeHeaders({'Cache-Control':'no-store'}));
    const used=(await db.query(
      'SELECT 1 FROM users WHERE LOWER(COALESCE(login_username,username))=LOWER($1) OR LOWER(username)=LOWER($1) LIMIT 1',
      [value])).rows.length>0;
    return json(res,200,{available:!used},safeHeaders({'Cache-Control':'no-store'}));
  }
  if(method==='POST'&&p==='/api/auth/forgot/request'){
    const body=await readJson(req,4096);
    const ip=String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'').split(',')[0].trim();
    return json(res,200,await accountRecovery.request(db,body.identifier,ip),
      safeHeaders({'Cache-Control':'no-store'}));
  }
  if(method==='POST'&&p==='/api/auth/forgot/confirm'){
    const body=await readJson(req,4096);
    const result=await accountRecovery.confirm(db,body.identifier,String(body.code||''),
      body.password,body.confirmPassword,hashPassword);
    if(!result.ok)return json(res,400,{error:'Invalid or expired code. Check your email and try again.'},safeHeaders({'Cache-Control':'no-store'}));
    return json(res,200,{ok:true,message:'Password updated. Sign in with your new password.'},
      safeHeaders({'Cache-Control':'no-store'}));
  }
  if(method==='POST'&&p==='/api/auth/register'){
    // Only an application is created. No user, password or shared stock is activated.
    checkLoginRate(req,'public-franchise-request');
    const body=await readJson(req,4096);
    const applied=await franchiseRequests.request(db,body);
    let verification={sent:false};
    try{verification=await franchiseEmailVerification.requestCode(db,body.email);}
    catch(err){verification.error=err.message;}
    return json(res,202,{...applied,verificationRequired:true,
      verificationSent:!!verification.sent,
      message:applied.message+(verification.sent?' Check your email for the 6-digit verification code.':
      ' Email verification remains pending. '+(verification.error||'You may request another code below.'))},
      safeHeaders({'Cache-Control':'no-store'}));
  }
  if(method==='POST'&&p==='/api/auth/register/verify/resend'){
    checkLoginRate(req,'franchise-email-resend');
    const body=await readJson(req,1024);
    return json(res,200,await franchiseEmailVerification.requestCode(db,body.email),
      safeHeaders({'Cache-Control':'no-store'}));
  }
  if(method==='POST'&&p==='/api/auth/register/verify'){
    checkLoginRate(req,'franchise-email-verification');
    const body=await readJson(req,1024);
    return json(res,200,await franchiseEmailVerification.verify(db,body.email,body.code),
      safeHeaders({'Cache-Control':'no-store'}));
  }
  if(method==='POST'&&p==='/api/auth/logout'){const token=parseCookies(req).pos_session;if(token)await db.query('DELETE FROM sessions WHERE token_hash=$1',[hashToken(token)]);return json(res,200,{ok:true},safeHeaders({'Set-Cookie':cookieHeader('',0)}));}
  if(method==='GET'&&p==='/api/auth/me'){
    const user=await getUser(req);
    if(!user)return json(res,401,{error:'Not signed in.'},safeHeaders());
    const access=await platformAccounts.workspaceAccess(db,user.id);
    if(!access.allowed)return json(res,403,{error:'This account is '+(access.status==='ON_HOLD'?'on hold':'unpaid')+
      '. POS access is disabled. Please contact Admin Control.',
      code:'SUBSCRIPTION_INACTIVE',status:access.status},safeHeaders({'Cache-Control':'no-store'}));
    return json(res,200,{user},safeHeaders());
  }
  const user=await requireUser(req,res);if(!user)return;
  // POS tenant operations; all data is restricted to the signed-in franchise workspace.
  if(p==='/api/finance/expenses' || p==='/api/finance/transactions'){
    const q=new URL(req.url,'http://localhost').searchParams;
    const params={page:q.get('page'),branchId:q.get('branchId'),start:q.get('start'),end:q.get('end'),status:q.get('status'),payment:q.get('payment'),orderType:q.get('orderType'),search:q.get('search')};
    if(method==='GET')return json(res,200,p.endsWith('/expenses')?
      await posFinance.expenses(db,user,params):await posFinance.transactions(db,user,params),safeHeaders({'Cache-Control':'no-store'}));
    if(method==='POST'&&p.endsWith('/expenses'))
      return json(res,200,await posFinance.saveExpense(db,user,await readJson(req)),safeHeaders());
    return json(res,405,{error:'Method not allowed.'},safeHeaders());
  }
  if(p==='/api/billing/me'||p==='/api/billing/checkout'){
   if(user.role!=='Admin')return json(res,403,{error:'Subscription billing is available to franchise Owners and Co-Owners only.'},safeHeaders());
   const membership=await db.query('SELECT workspace_id FROM chat_memberships WHERE user_id=$1 ORDER BY workspace_id LIMIT 1',[user.id]);
   const ws=membership.rows[0]?.workspace_id;
   if(!ws)return json(res,404,{error:'Tenant workspace not found.'},safeHeaders());
   if(method==='GET'&&p==='/api/billing/me')
    return json(res,200,await platformBilling.tenantSummary(db,'FRANCHISE',ws),safeHeaders({'Cache-Control':'no-store'}));
   if(method==='POST'&&p==='/api/billing/checkout')
    return json(res,200,await platformBilling.requestCheckout(db,'FRANCHISE',ws,
      process.env.PAYMONGO_POS_RETURN_URL||'https://donmacpos.com/?billing=return'),safeHeaders({'Cache-Control':'no-store'}));
  }
  if(p.startsWith('/api/supply/'))return handleFranchiseSupplyApi(req,res,p,method,user);
  if(method==='GET'&&p==='/api/account/subscription')
    return json(res,200,await getSubscriptionForUi(user),safeHeaders({'Cache-Control':'no-store'}));
  if(method==='POST'&&p==='/api/account/subscription/update-plan')
    return json(res,200,await requestSubscriptionPlan(user,await readJson(req)),safeHeaders({'Cache-Control':'no-store'}));
  if(method==='POST'&&p==='/api/account/subscription/demo')
    return json(res,410,{error:'This subscription preview endpoint has been retired. Update your plan through Account Settings.'},safeHeaders());
  if(p.startsWith('/api/chat/'))return internalChat.handle({req,res,url,user,db,readJson,json,safeHeaders});
  if(method==='GET'&&p==='/api/pos/today-count'){
    const branchId=await branchSupport.salesScope(db,user,url.searchParams.get('branchId'));
    if(user.role==='Admin'&&branchId!=null)await ensureBranchInOwnerWorkspace(user,branchId);
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',
      year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const after=addDays(today,1);
    const args=['Sold',new Date(today+'T00:00:00+08:00').toISOString(),
      new Date(after+'T00:00:00+08:00').toISOString()];
    if(branchId!=null)args.push(Number(branchId));
    const rows=await db.query('SELECT COUNT(*) AS count FROM sales WHERE status=$1 AND sold_at >= $2 AND sold_at < $3'+
      (branchId==null?'':' AND branch_id=$4'),args);
    return json(res,200,{count:Number(rows.rows[0]?.count||0)},safeHeaders({'Cache-Control':'no-store'}));
  }
  if(method==='GET'&&p==='/api/catalog')return json(res,200,await getCatalog(db,await workspaceIdForUser(user.id)),safeHeaders());
  if(method==='GET'&&p==='/api/office-promotions')
    return json(res,200,{campaigns:await officePromotions.forWorkspace(db,await workspaceIdForUser(user.id))},safeHeaders({'Cache-Control':'no-store'}));
  if(method==='POST'&&p==='/api/quote')return json(res,200,await quoteOrder(db,await readJson(req),await workspaceIdForUser(user.id)),safeHeaders());
  if(method==='POST'&&p==='/api/sales')return json(res,201,await createSale(user,await readJson(req)),safeHeaders());
  const saleDetail=p.match(/^\/api\/sales\/([^/]+)$/);if(method==='GET'&&saleDetail)return json(res,200,await getSaleDetail(decodeURIComponent(saleDetail[1]),user),safeHeaders());
  if(method==='GET'&&p==='/api/inventory')return json(res,200,{items:await getInventory()},safeHeaders());
  if(method==='GET'&&p==='/api/inventory/movements')return json(res,200,{items:await listInventoryMovements(url.searchParams.get('limit'))},safeHeaders());
  if(method==='POST'&&p==='/api/inventory/replenish')return json(res,201,await replenish(user,await readJson(req)),safeHeaders());
  if(method==='POST'&&p==='/api/inventory/transfer')return json(res,201,await transfer(user,await readJson(req)),safeHeaders());
  if(method==='GET'&&p==='/api/branches'){
    const branches=await accessibleBranches(user);
    const ws=await workspaceIdForUser(user.id);
    return json(res,200,{branches,
      branchPricing:user.role==='Admin'&&ws?await branchPlans.entitlements(db,ws):null},safeHeaders());
  }
  if((method==='GET'||method==='PUT')&&p==='/api/dashboard/widgets'){
    const plan=String(url.searchParams.get('plan')||'').toUpperCase();
    return json(res,200,await widgetSettings(user,plan,method==='PUT'?await readJson(req,4096):null),
      safeHeaders({'Cache-Control':'no-store'}));
  }
  if(method==='GET'&&p==='/api/dashboard/activity')return json(res,200,await dashboardActivity(user,Object.fromEntries(url.searchParams)),safeHeaders());
  if(method==='GET'&&p==='/api/advanced/analytics'){
    return json(res,200,await advancedAnalytics.read(db,user,Object.fromEntries(url.searchParams)),
      safeHeaders({'Cache-Control':'no-store'}));
  }
  if(method==='GET'&&p==='/api/dashboard/plan-insights')return json(res,200,await planDashboardInsights(user,url.searchParams.get('branchId')),safeHeaders());
  if(method==='GET'&&p==='/api/dashboard'){const branchId=await branchSupport.salesScope(db,user,url.searchParams.get('branchId'));if(user.role==='Admin'&&branchId!=null)await ensureBranchInOwnerWorkspace(user,branchId);return json(res,200,await dashboardData(Object.fromEntries(url.searchParams),branchId,user),safeHeaders());}
  if(method==='GET'&&p==='/api/reports/cashiers'){
    const branchId=await branchSupport.salesScope(db,user,url.searchParams.get('branchId'));
    return json(res,200,await reportCashierChoices(branchId),safeHeaders());
  }
  if(method==='GET'&&p==='/api/reports/sales')return json(res,200,await salesReport({...Object.fromEntries(url.searchParams),branchId:await branchSupport.salesScope(db,user,url.searchParams.get('branchId'))}),safeHeaders());
  if(method==='GET'&&p==='/api/reports/costing')return json(res,200,await costingReport({...Object.fromEntries(url.searchParams),branchId:await branchSupport.salesScope(db,user,url.searchParams.get('branchId'))}),safeHeaders());
  if(method==='GET'&&p==='/api/reports/sales/print'){
    // Dashboard staff action: daily PDF for the authenticated user's assigned branch.
    // Do not trust client-provided branch or date values for this shortcut.
    const ownBranch=await branchSupport.salesScope(db,user,null);
    const d=await salesPdf({period:'daily',branchId:ownBranch});
    return binary(res,200,d.buffer,'application/pdf',{'Content-Disposition':`inline; filename="${d.filename}"`});
  }
  if(method==='GET'&&p==='/api/reports/sales.pdf'){const d=await salesPdf({...Object.fromEntries(url.searchParams),branchId:await branchSupport.salesScope(db,user,url.searchParams.get('branchId'))});return binary(res,200,d.buffer,'application/pdf',{'Content-Disposition':`attachment; filename="${d.filename}"`});}
  if(method==='GET'&&p==='/api/reports/costing.pdf'){const d=await costingPdf({...Object.fromEntries(url.searchParams),branchId:await branchSupport.salesScope(db,user,url.searchParams.get('branchId'))});return binary(res,200,d.buffer,'application/pdf',{'Content-Disposition':`attachment; filename="${d.filename}"`});}
  if(method==='POST'&&p==='/api/reports/email'){const body=await readJson(req);body.branchId=await branchSupport.salesScope(db,user,body.branchId);return json(res,200,await emailSalesReport(user,body),safeHeaders());}
  if(method==='GET'&&p==='/api/system-logs')return json(res,200,{logs:await listLogs(url.searchParams.get('limit'),user)},safeHeaders());

  const delSale=p.match(/^\/api\/sales\/(.+)\/delete$/);if(method==='POST'&&delSale){requireAdminRole(user);return json(res,200,await deleteSale(user,decodeURIComponent(delSale[1]),await readJson(req)),safeHeaders());}

  requireAdminRole(user);
  if(method==='GET'&&p==='/api/users')return json(res,200,{users:await listUsers(user)},safeHeaders());
  if(method==='POST'&&p==='/api/users'){const created=await createOrActivateUser(await readJson(req),user);await logAction(user,`Web user saved: ${created.username}`,'User Updated',`${created.role} / ${created.active?'Active':'Inactive'}`);return json(res,201,{user:created},safeHeaders());}
  const userMatch=p.match(/^\/api\/users\/(\d+)$/);if(method==='PUT'&&userMatch)return json(res,200,await updateUserAccount(user,Number(userMatch[1]),await readJson(req)),safeHeaders());if(method==='DELETE'&&userMatch)return json(res,200,await deleteUserAccount(user,Number(userMatch[1])),safeHeaders());
  if(method==='POST'&&p==='/api/branches'){
    const body=await readJson(req),ws=await workspaceIdForUser(user.id);
    if(!ws)throw Object.assign(new Error('Franchise workspace is unavailable.'),{status:403});
    const branch=await db.transaction(async tx=>{
      await branchPlans.allowNewBranch(tx,ws);
      const created=await branchSupport.saveBranch(tx,user,body,null,async()=>{});
      await internalChat.assignBranch(tx,user.id,created.id);
      await branchPlans.updateRenewalTotal(tx,ws);
      return created;
    });
    await logAction(user,'Branch saved: '+branch.name,'Branch Added','Next renewal amount recalculated');
    return json(res,201,{branch,branchPricing:await branchPlans.entitlements(db,ws)},safeHeaders());
  }
  const branchMatch=p.match(/^\/api\/branches\/(\d+)$/);if(branchMatch&&method==='PUT'){
    await ensureBranchInOwnerWorkspace(user,Number(branchMatch[1]));
    const ws=await workspaceIdForUser(user.id),body=await readJson(req);
    const branch=await db.transaction(async tx=>{
      await branchPlans.lock(tx,ws);
      const current=await branchPlans.entitlements(tx,ws);
      const old=current.branches.find(x=>x.id===Number(branchMatch[1]));
      if(current.plan==='PRO'&&old&&!old.active&&body.active!==false&&current.activeBranches>=3)
        throw Object.assign(new Error('Upgrade to Business to add more active branches.'),{status:409});
      const saved=await branchSupport.saveBranch(tx,user,body,Number(branchMatch[1]),async()=>{});
      await branchPlans.updateRenewalTotal(tx,ws);
      return saved;
    });
    await logAction(user,'Branch updated: '+branch.name,'Branch Updated',null);
    return json(res,200,{branch,branchPricing:await branchPlans.entitlements(db,ws)},safeHeaders());
  }if(branchMatch&&method==='DELETE'){await ensureBranchInOwnerWorkspace(user,Number(branchMatch[1]));return json(res,200,await branchSupport.deleteBranch(db,user,Number(branchMatch[1]),logAction),safeHeaders());}

   if(method==='GET'&&p==='/api/admin/pos-categories')
     return json(res,200,{categories:await listPosCategories()},safeHeaders());
   if(method==='POST'&&p==='/api/admin/pos-categories')
     return json(res,201,await savePosCategory(user,null,await readJson(req)),safeHeaders());
   const categoryMatch=p.match(/^\/api\/admin\/pos-categories\/([^/]+)$/);
   if(categoryMatch){
     const categoryName=decodeURIComponent(categoryMatch[1]);
     if(method==='PUT')return json(res,200,await savePosCategory(user,categoryName,await readJson(req)),safeHeaders());
     if(method==='DELETE')return json(res,200,await deletePosCategory(user,categoryName),safeHeaders());
   }
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
  if(p==='/api/backups/comparison'&&(method==='GET'||method==='POST')){
    requireAdminRole(user);
    const workspaceId=await workspaceIdForUser(user.id);
    if(!workspaceId)throw Object.assign(new Error('Owner workspace unavailable.'),{status:403});
    if(method==='GET'){
      const detail=url.searchParams.get('details')==='1';
      return json(res,200,await archiveComparison.getComparison(db,workspaceId,detail),safeHeaders());
    }
    if(!String(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))
      throw Object.assign(new Error('Select a Don Mac JSON data archive.'),{status:415});
    const info=await archiveComparison.readArchiveUpload(req);
    const filename=String(req.headers['x-archive-filename']||'DonMac_Data_Archive.json').slice(0,180);
    if(!/\.json$/i.test(filename)||/[\\/\r\n]/.test(filename))
      throw Object.assign(new Error('Upload a JSON archive with a safe filename.'),{status:400});
    const record=await archiveComparison.saveComparison(db,workspaceId,user,info,filename);
    await logAction(user,'Read-only archive comparison uploaded','Database Compare',
      'Comparison metadata only; 24h access; no live data changed');
    return json(res,201,{...record,message:'Read-only comparison created. It expires in 24 hours; your upload record will remain visible.'},safeHeaders());
  }
  if(method==='POST'&&(p==='/api/admin/imports/sales/preview'||p==='/api/admin/imports/sales/commit')){
    const payload=await readJson(req,2*1024*1024);
    const commit=p.endsWith('/commit');
    try{
      const result=await legacySalesImport.run({db,user,rows:payload.rows,commit,logAction});
      return json(res,200,result,safeHeaders({'Cache-Control':'no-store'}));
    }catch(e){
      if(e.code==='23505'||e.code==='SQLITE_CONSTRAINT_UNIQUE')
        throw Object.assign(new Error('A reference in this file now exists in the database. Nothing was imported; preview the file again.'),{status:409});
      throw e;
    }
  }
  if(method==='GET'&&p==='/api/backups/data-export'){
    const archive=await makePortableDataExport();
    return binary(res,200,archive.buffer,'application/json; charset=utf-8',
      {'Content-Disposition':'attachment; filename="'+archive.filename+'"','Cache-Control':'no-store'});
  }
  if(method==='GET'&&p==='/api/backups/retention-preview')
    return json(res,200,await getRetentionPreview(),safeHeaders({'Cache-Control':'no-store'}));
  if(method==='PUT'&&p==='/api/backups/retention-preview')
    return json(res,200,await saveRetentionPreview(user,await readJson(req)),safeHeaders({'Cache-Control':'no-store'}));
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
  fs.mkdirSync(BACKUP_DIR,{recursive:true});db=await createDb();await initSchema();await migrateSchema();await seedDatabase();await branchSupport.migrateBranches(db);await internalChat.migrate(db);await migrateCashierProfiles();await accountRecovery.migrate(db);await supplyChain.migrate(db);await officePromotions.migrate(db);await platformAccounts.migrate(db);await franchiseRequests.migrate(db);await franchiseEmailVerification.migrate(db);await franchiseStaging.migrate(db);await platformBilling.migrate(db);await posFinance.migrate(db);await ensureAutomaticBackup();const backupTimer=setInterval(()=>ensureAutomaticBackup().catch(err=>console.error('Automatic backup failed:',err.message)),60*60*1000);backupTimer.unref?.();const status=await appStatus();
  const server=http.createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
      if(url.pathname.startsWith('/api/'))return await handleApi(req,res,url);
      if(SUPPLY_OFFICE_PORTAL){
        const allowed=new Set(['/supply-office.html','/supply-office.js','/supply-office.css','/platform-admin.html','/platform-admin.css','/platform-admin.js','/tenant-billing-ui.js','/tenant-billing.css','/refresh-controls-v20261107.css','/refresh-controls-v20261107.js','/coffee-workspace-theme-v20261107.css','/assets/refresh-clockwise-v20261107.svg','/donmac-logo-hires.svg','/auth-login-v1574.css','/office-login-pos.css','/assets/login-coffee-pattern-approved-hd.png','/assets/catalog/v1562-coffee-beans.svg','/assets/login-coffee-beans-bold-outline-v1585.svg','/assets/login-coffee-beans-white-outline-v1586.svg','/assets/login-coffee-beans-all-white-strokes-v1587.svg']);
        const target=url.pathname==='/'?'/supply-office.html':url.pathname;
        if(allowed.has(target)&&serveStatic(req,res,target))return;
        return text(res,404,'Not found','text/plain; charset=utf-8',safeHeaders());
      }
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
