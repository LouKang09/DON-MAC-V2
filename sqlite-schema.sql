CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT,
  role TEXT NOT NULL CHECK (role IN ('Admin','User')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  category TEXT NOT NULL CHECK (category IN ('Coffee','Non Coffee','Food')),
  price REAL NOT NULL CHECK (price >= 0),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS add_ons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  price REAL NOT NULL CHECK (price >= 0),
  exclude_from_costing INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ingredients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  uom TEXT NOT NULL,
  stock_qty REAL NOT NULL DEFAULT 0,
  low_stock_threshold REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS product_ingredients (
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
  quantity_required REAL NOT NULL CHECK (quantity_required >= 0),
  cost_contribution REAL,
  PRIMARY KEY (product_id, ingredient_id)
);

CREATE TABLE IF NOT EXISTS packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  price REAL NOT NULL CHECK (price >= 0),
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS package_items (
  package_id INTEGER NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity REAL NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (package_id, product_id)
);

CREATE TABLE IF NOT EXISTS promos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  inclusion_label TEXT NOT NULL,
  promo_price REAL NOT NULL CHECK (promo_price >= 0),
  food_limit INTEGER,
  coffee_limit INTEGER,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  cashier_user_id INTEGER REFERENCES users(id),
  cashier_name_snapshot TEXT,
  payment_mode TEXT NOT NULL CHECK (payment_mode IN ('Cash','GCash')),
  payment_reference TEXT,
  tender REAL,
  change_amount REAL,
  status TEXT NOT NULL DEFAULT 'Sold' CHECK (status IN ('Sold','Deleted')),
  remark TEXT,
  senior_details TEXT,
  discount_amount REAL NOT NULL DEFAULT 0,
  gross REAL NOT NULL DEFAULT 0,
  adjustment REAL NOT NULL DEFAULT 0,
  actual REAL NOT NULL DEFAULT 0,
  promo_id INTEGER REFERENCES promos(id),
  sold_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  deleted_by INTEGER REFERENCES users(id),
  client_request_id TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_client_request_id ON sales(client_request_id) WHERE client_request_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  product_id INTEGER REFERENCES products(id),
  add_on_id INTEGER REFERENCES add_ons(id),
  package_id INTEGER REFERENCES packages(id),
  product_name_snapshot TEXT NOT NULL,
  quantity REAL NOT NULL CHECK (quantity > 0),
  unit_price REAL NOT NULL,
  line_total REAL NOT NULL,
  is_add_on INTEGER NOT NULL DEFAULT 0,
  is_package INTEGER NOT NULL DEFAULT 0,
  exclude_from_costing INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sale_item_components (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_item_id INTEGER NOT NULL REFERENCES sale_items(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  product_name_snapshot TEXT NOT NULL,
  quantity REAL NOT NULL CHECK (quantity > 0)
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
  movement_type TEXT NOT NULL,
  quantity_change REAL NOT NULL,
  balance_after REAL,
  reference TEXT,
  branch TEXT,
  received_by TEXT,
  delivered_by TEXT,
  remarks TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS system_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity TEXT NOT NULL,
  actor_user_id INTEGER REFERENCES users(id),
  actor_name_snapshot TEXT,
  status TEXT,
  remark TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sales_sold_at ON sales(sold_at);
CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(status);
CREATE INDEX IF NOT EXISTS idx_sales_cashier ON sales(cashier_user_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_item_components_sale_item ON sale_item_components(sale_item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_created ON inventory_movements(created_at);
CREATE INDEX IF NOT EXISTS idx_system_logs_created ON system_logs(created_at);
