-- PostgreSQL 15+ production schema for Coffee POS 0.4 web migration.
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  username VARCHAR(80) NOT NULL UNIQUE,
  password_hash TEXT,
  role VARCHAR(20) NOT NULL CHECK (role IN ('Admin','User')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id BIGSERIAL PRIMARY KEY,
  sku VARCHAR(120) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL UNIQUE,
  category VARCHAR(30) NOT NULL CHECK (category IN ('Coffee','Non Coffee','Food')),
  price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS add_ons (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL UNIQUE,
  price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  exclude_from_costing BOOLEAN NOT NULL DEFAULT TRUE,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS ingredients (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(160) NOT NULL UNIQUE,
  display_name VARCHAR(150) NOT NULL,
  uom VARCHAR(40) NOT NULL,
  stock_qty NUMERIC(18,6) NOT NULL DEFAULT 0,
  low_stock_threshold NUMERIC(18,6) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_ingredients (
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  ingredient_id BIGINT NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
  quantity_required NUMERIC(18,9) NOT NULL CHECK (quantity_required >= 0),
  cost_contribution NUMERIC(18,9),
  PRIMARY KEY (product_id, ingredient_id)
);

CREATE TABLE IF NOT EXISTS packages (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL UNIQUE,
  price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS package_items (
  package_id BIGINT NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (package_id, product_id)
);

CREATE TABLE IF NOT EXISTS promos (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL UNIQUE,
  inclusion_label VARCHAR(100) NOT NULL,
  promo_price NUMERIC(12,2) NOT NULL CHECK (promo_price >= 0),
  food_limit INTEGER,
  coffee_limit INTEGER,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS sales (
  id BIGSERIAL PRIMARY KEY,
  reference VARCHAR(80) NOT NULL UNIQUE,
  cashier_user_id BIGINT REFERENCES users(id),
  cashier_name_snapshot VARCHAR(100),
  payment_mode VARCHAR(20) NOT NULL CHECK (payment_mode IN ('Cash','GCash')),
  payment_reference VARCHAR(150),
  tender NUMERIC(12,2),
  change_amount NUMERIC(12,2),
  status VARCHAR(20) NOT NULL DEFAULT 'Sold' CHECK (status IN ('Sold','Deleted')),
  remark TEXT,
  senior_details TEXT,
  discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  gross NUMERIC(12,2) NOT NULL DEFAULT 0,
  adjustment NUMERIC(12,2) NOT NULL DEFAULT 0,
  actual NUMERIC(12,2) NOT NULL DEFAULT 0,
  promo_id BIGINT REFERENCES promos(id),
  sold_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  deleted_by BIGINT REFERENCES users(id),
  client_request_id VARCHAR(128)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_client_request_id ON sales(client_request_id) WHERE client_request_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS sale_items (
  id BIGSERIAL PRIMARY KEY,
  sale_id BIGINT NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  product_id BIGINT REFERENCES products(id),
  add_on_id BIGINT REFERENCES add_ons(id),
  package_id BIGINT REFERENCES packages(id),
  product_name_snapshot VARCHAR(150) NOT NULL,
  quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12,2) NOT NULL,
  line_total NUMERIC(12,2) NOT NULL,
  is_add_on BOOLEAN NOT NULL DEFAULT FALSE,
  is_package BOOLEAN NOT NULL DEFAULT FALSE,
  exclude_from_costing BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS sale_item_components (
  id BIGSERIAL PRIMARY KEY,
  sale_item_id BIGINT NOT NULL REFERENCES sale_items(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES products(id),
  product_name_snapshot VARCHAR(150) NOT NULL,
  quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0)
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id BIGSERIAL PRIMARY KEY,
  ingredient_id BIGINT NOT NULL REFERENCES ingredients(id),
  movement_type VARCHAR(30) NOT NULL,
  quantity_change NUMERIC(18,9) NOT NULL,
  balance_after NUMERIC(18,9),
  reference VARCHAR(100),
  branch VARCHAR(150),
  received_by VARCHAR(150),
  delivered_by VARCHAR(150),
  remarks TEXT,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS system_logs (
  id BIGSERIAL PRIMARY KEY,
  activity TEXT NOT NULL,
  actor_user_id BIGINT REFERENCES users(id),
  actor_name_snapshot VARCHAR(100),
  status VARCHAR(100),
  remark TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_settings (
  setting_key VARCHAR(120) PRIMARY KEY,
  setting_value TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_sold_at ON sales(sold_at);
CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(status);
CREATE INDEX IF NOT EXISTS idx_sales_cashier ON sales(cashier_user_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_item_components_sale_item ON sale_item_components(sale_item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_created ON inventory_movements(created_at);
CREATE INDEX IF NOT EXISTS idx_system_logs_created ON system_logs(created_at);


-- Keep named catalog/account keys case-insensitively unique, matching local SQLite behavior.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_ci ON users((LOWER(username)));
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_name_ci ON products((LOWER(name)));
CREATE UNIQUE INDEX IF NOT EXISTS idx_add_ons_name_ci ON add_ons((LOWER(name)));
CREATE UNIQUE INDEX IF NOT EXISTS idx_packages_name_ci ON packages((LOWER(name)));
CREATE UNIQUE INDEX IF NOT EXISTS idx_promos_name_ci ON promos((LOWER(name)));
