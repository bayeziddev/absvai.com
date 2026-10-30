-- Abs Vai core schema (Cloudflare D1 / SQLite).
-- Money is always integer paisa (৳1 = 100). Dates are ISO-8601 text.
-- Bangladesh-local calendar dates (season start/end, invoice dates) are stored as YYYY-MM-DD.

PRAGMA foreign_keys = ON;

-- ───────────────────────── Settings, staff, audit ─────────────────────────

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE admins (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('super_admin','manager','order_processor','viewer')),
  password_hash TEXT NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id   TEXT,
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  TEXT,
  detail     TEXT,
  ip         TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_audit_created ON audit_log (created_at);

-- Named sequences (invoice numbers per day, order numbers per day, SKU sequence per category code).
CREATE TABLE counters (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

-- ───────────────────────── Geo & delivery ─────────────────────────

CREATE TABLE geo_divisions (
  id      INTEGER PRIMARY KEY,
  name    TEXT NOT NULL,
  bn_name TEXT,
  source  TEXT NOT NULL DEFAULT 'bangladesh-geocode'
);

CREATE TABLE geo_districts (
  id          INTEGER PRIMARY KEY,
  division_id INTEGER NOT NULL REFERENCES geo_divisions(id),
  name        TEXT NOT NULL,
  bn_name     TEXT,
  lat         REAL,
  lon         REAL,
  source      TEXT NOT NULL DEFAULT 'bangladesh-geocode'
);
CREATE INDEX idx_districts_division ON geo_districts (division_id);

-- kind = 'city_corporation' rows are an Abs Vai supplement (source = 'absvai-supplement'):
-- the source dataset has no city-corporation areas, so Dhaka city customers could not pick an area.
CREATE TABLE geo_upazilas (
  id          INTEGER PRIMARY KEY,
  district_id INTEGER NOT NULL REFERENCES geo_districts(id),
  name        TEXT NOT NULL,
  bn_name     TEXT,
  kind        TEXT NOT NULL DEFAULT 'upazila' CHECK (kind IN ('upazila','city_corporation')),
  source      TEXT NOT NULL DEFAULT 'bangladesh-geocode'
);
CREATE INDEX idx_upazilas_district ON geo_upazilas (district_id);

CREATE TABLE geo_unions (
  id         INTEGER PRIMARY KEY,
  upazila_id INTEGER NOT NULL REFERENCES geo_upazilas(id),
  name       TEXT NOT NULL,
  bn_name    TEXT
);
CREATE INDEX idx_unions_upazila ON geo_unions (upazila_id);

-- Post offices. upazila_id is NULL when the import could not link the row with confidence.
CREATE TABLE geo_postcodes (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  postcode             TEXT NOT NULL,
  post_office          TEXT NOT NULL,
  division_id          INTEGER NOT NULL REFERENCES geo_divisions(id),
  district_id          INTEGER NOT NULL REFERENCES geo_districts(id),
  upazila_id           INTEGER REFERENCES geo_upazilas(id),
  source_division_name TEXT,
  source_district_name TEXT,
  source_upazila_name  TEXT,
  match_status         TEXT NOT NULL CHECK (match_status IN ('exact','alias','fuzzy','unmatched','manual')),
  match_note           TEXT,
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_postcodes_code ON geo_postcodes (postcode);
CREATE INDEX idx_postcodes_status ON geo_postcodes (match_status);

CREATE TABLE delivery_zones (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  name               TEXT NOT NULL UNIQUE,
  base_charge_paisa  INTEGER NOT NULL,
  base_weight_grams  INTEGER NOT NULL DEFAULT 1000,
  extra_per_kg_paisa INTEGER NOT NULL DEFAULT 0,
  bulky_charge_paisa INTEGER NOT NULL DEFAULT 0,
  eta_text           TEXT NOT NULL,
  is_default         INTEGER NOT NULL DEFAULT 0,
  sort_order         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE zone_districts (
  district_id INTEGER PRIMARY KEY REFERENCES geo_districts(id),
  zone_id     INTEGER NOT NULL REFERENCES delivery_zones(id) ON DELETE CASCADE
);

CREATE TABLE zone_upazila_overrides (
  upazila_id INTEGER PRIMARY KEY REFERENCES geo_upazilas(id),
  zone_id    INTEGER NOT NULL REFERENCES delivery_zones(id) ON DELETE CASCADE
);

-- Couriers use their own city/zone/area IDs. Never assume they match ours.
CREATE TABLE courier_area_map (
  courier          TEXT NOT NULL,
  upazila_id       INTEGER NOT NULL REFERENCES geo_upazilas(id),
  courier_city_id  TEXT,
  courier_zone_id  TEXT,
  courier_area_id  TEXT,
  label            TEXT,
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (courier, upazila_id)
);

-- ───────────────────────── Catalog: templates ─────────────────────────

CREATE TABLE attribute_types (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  input      TEXT NOT NULL DEFAULT 'chips' CHECK (input IN ('chips','swatch','select')),
  help_text  TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE attribute_values (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  attribute_type_id TEXT NOT NULL REFERENCES attribute_types(id) ON DELETE CASCADE,
  value             TEXT NOT NULL,
  swatch_hex        TEXT,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  UNIQUE (attribute_type_id, value)
);

CREATE TABLE product_templates (
  id                       TEXT PRIMARY KEY,
  name                     TEXT NOT NULL,
  explanation              TEXT NOT NULL,
  default_shipping_profile TEXT NOT NULL CHECK (default_shipping_profile IN ('standard','fragile','heavy_bulky','perishable')),
  allowed_fulfilment       TEXT NOT NULL,            -- JSON array of in_stock | pre_order | made_to_order
  requires_size_chart      INTEGER NOT NULL DEFAULT 0,
  size_chart_columns       TEXT,                      -- JSON array of measurement column labels
  requires_brand           INTEGER NOT NULL DEFAULT 0,
  requires_net_quantity    INTEGER NOT NULL DEFAULT 0,
  card_key_specs           TEXT NOT NULL DEFAULT '[]',-- JSON array of spec keys / "net_weight" / "variant.<attr>"
  status                   TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
  created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE template_variant_attributes (
  template_id         TEXT NOT NULL REFERENCES product_templates(id) ON DELETE CASCADE,
  attribute_type_id   TEXT NOT NULL REFERENCES attribute_types(id),
  label               TEXT,
  required            INTEGER NOT NULL DEFAULT 0,
  preset_values       TEXT NOT NULL DEFAULT '[]',
  allow_custom_values INTEGER NOT NULL DEFAULT 1,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (template_id, attribute_type_id)
);

CREATE TABLE template_spec_fields (
  template_id          TEXT NOT NULL REFERENCES product_templates(id) ON DELETE CASCADE,
  key                  TEXT NOT NULL,
  label                TEXT NOT NULL,
  type                 TEXT NOT NULL CHECK (type IN ('text','longtext','number','date','select','dimensions','file','boolean')),
  unit                 TEXT,
  required             INTEGER NOT NULL DEFAULT 0,
  help_text            TEXT,
  placeholder          TEXT,
  options              TEXT,                 -- JSON array for select fields
  panel                TEXT NOT NULL DEFAULT 'details',
  show_on_product_page INTEGER NOT NULL DEFAULT 1,
  can_become_variant   INTEGER NOT NULL DEFAULT 0,
  filterable           INTEGER NOT NULL DEFAULT 0,
  card_format          TEXT,                 -- e.g. "{value} warranty"
  sort_order           INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (template_id, key)
);

-- ───────────────────────── Catalog: categories, products ─────────────────────────

CREATE TABLE categories (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  slug              TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  code              TEXT NOT NULL,            -- SKU category code, e.g. ORG
  parent_id         INTEGER REFERENCES categories(id),
  template_id       TEXT NOT NULL REFERENCES product_templates(id),
  icon_url          TEXT,
  description       TEXT,
  season_visibility TEXT NOT NULL DEFAULT 'always' CHECK (season_visibility IN ('always','seasons')),
  is_active         INTEGER NOT NULL DEFAULT 1,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  meta_title        TEXT,
  meta_description  TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at        TEXT
);
CREATE INDEX idx_categories_parent ON categories (parent_id);

CREATE TABLE products (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  slug                    TEXT NOT NULL UNIQUE,
  category_id             INTEGER NOT NULL REFERENCES categories(id),
  template_id             TEXT NOT NULL REFERENCES product_templates(id),
  name                    TEXT NOT NULL,
  code                    TEXT NOT NULL,      -- SKU product code, e.g. PTGR
  short_description       TEXT,
  description             TEXT,
  brand                   TEXT,
  is_original             INTEGER NOT NULL DEFAULT 0,
  benefit_chips           TEXT NOT NULL DEFAULT '[]',
  status                  TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','published','archived')),
  publish_at              TEXT,
  published_at            TEXT,
  fulfilment_mode         TEXT NOT NULL DEFAULT 'in_stock' CHECK (fulfilment_mode IN ('in_stock','pre_order','made_to_order')),
  preorder_dispatch_date  TEXT,
  preorder_advance_type   TEXT CHECK (preorder_advance_type IN ('delivery_charge','fixed')),
  preorder_advance_paisa  INTEGER,
  made_to_order_lead_days INTEGER,
  shipping_profile        TEXT NOT NULL CHECK (shipping_profile IN ('standard','fragile','heavy_bulky','perishable')),
  bulky_delivery_mode     TEXT NOT NULL DEFAULT 'zone_fixed' CHECK (bulky_delivery_mode IN ('zone_fixed','confirm_by_phone')),
  free_delivery           INTEGER NOT NULL DEFAULT 0,
  video_url               TEXT,
  promoted_spec_keys      TEXT NOT NULL DEFAULT '[]',
  size_chart              TEXT,               -- JSON {columns:[], rows:[{size, values:[]}]}
  search_keywords         TEXT,
  meta_title              TEXT,
  meta_description        TEXT,
  sold_count              INTEGER NOT NULL DEFAULT 0,
  created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at              TEXT
);
CREATE INDEX idx_products_category ON products (category_id);
CREATE INDEX idx_products_status ON products (status);

CREATE TABLE product_spec_values (
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  field_key  TEXT NOT NULL,
  value      TEXT NOT NULL,
  PRIMARY KEY (product_id, field_key)
);

CREATE TABLE product_variants (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id             INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku                    TEXT NOT NULL UNIQUE,
  attributes             TEXT NOT NULL DEFAULT '{}',
  attributes_key         TEXT NOT NULL,      -- canonical sorted form, unique per product
  price_paisa            INTEGER NOT NULL CHECK (price_paisa >= 0),
  compare_at_price_paisa INTEGER,
  wholesale_tiers        TEXT NOT NULL DEFAULT '[]',
  stock                  INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),  -- a sale that would go negative fails the whole order batch
  packed_weight_grams    INTEGER NOT NULL CHECK (packed_weight_grams >= 0), -- 0 only on drafts: the publish checklist blocks it
  net_value              REAL,
  net_unit               TEXT CHECK (net_unit IN ('g','kg','ml','l','pcs')),
  image_ids              TEXT NOT NULL DEFAULT '[]',
  is_active              INTEGER NOT NULL DEFAULT 1,
  sort_order             INTEGER NOT NULL DEFAULT 0,
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (product_id, attributes_key)
);
CREATE INDEX idx_variants_product ON product_variants (product_id);

CREATE TABLE product_media (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL DEFAULT 'image' CHECK (kind IN ('image','manual','claim_doc','spec_file')),
  r2_key      TEXT,
  url         TEXT NOT NULL,
  alt         TEXT,
  width       INTEGER,
  height      INTEGER,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_media_product ON product_media (product_id);

-- Claim badges ("Organic", "100% Natural", ...) are earned: each needs an attached document.
CREATE TABLE product_claims (
  product_id        INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  claim             TEXT NOT NULL,
  document_media_id INTEGER NOT NULL REFERENCES product_media(id),
  added_by          TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (product_id, claim)
);

CREATE TABLE bundles (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  description  TEXT,
  price_paisa  INTEGER NOT NULL,
  is_active    INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE bundle_items (
  bundle_id  INTEGER NOT NULL REFERENCES bundles(id) ON DELETE CASCADE,
  variant_id INTEGER NOT NULL REFERENCES product_variants(id),
  qty        INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (bundle_id, variant_id)
);

-- Synonym groups: every term in a group finds the same products ("fuchka" = "phuchka" = "panipuri").
CREATE TABLE search_synonyms (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  group_key TEXT NOT NULL,
  term      TEXT NOT NULL UNIQUE COLLATE NOCASE
);
CREATE INDEX idx_synonyms_group ON search_synonyms (group_key);

-- ───────────────────────── Seasons ─────────────────────────

CREATE TABLE seasons (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  slug                TEXT NOT NULL UNIQUE,
  name                TEXT NOT NULL,
  starts_on           TEXT,                 -- YYYY-MM-DD, Bangladesh date. NULL = needs dates.
  ends_on             TEXT,
  accent_label        TEXT,
  accent_color        TEXT,
  banners             TEXT NOT NULL DEFAULT '[]',
  landing_intro       TEXT,
  back_in_season_text TEXT,                 -- e.g. "November"
  is_enabled          INTEGER NOT NULL DEFAULT 1,
  started_notified_on TEXT,                 -- set by cron after back-in-season messages go out
  sort_order          INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE product_seasons (
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  season_id  INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, season_id)
);

CREATE TABLE category_seasons (
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  season_id   INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  PRIMARY KEY (category_id, season_id)
);

CREATE TABLE notify_requests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  phone       TEXT NOT NULL,
  channel     TEXT NOT NULL DEFAULT 'sms' CHECK (channel IN ('sms','whatsapp')),
  status      TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','sent','cancelled')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  notified_at TEXT,
  UNIQUE (product_id, phone)
);

-- ───────────────────────── Customers ─────────────────────────

CREATE TABLE customers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  phone           TEXT NOT NULL UNIQUE,
  name            TEXT,
  email           TEXT,
  is_trusted      INTEGER NOT NULL DEFAULT 0,
  order_count     INTEGER NOT NULL DEFAULT 0,
  delivered_count INTEGER NOT NULL DEFAULT 0,
  returned_count  INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- No raw GPS is ever stored: only the chosen area IDs, postcode and the typed address.
CREATE TABLE addresses (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id  INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  division_id  INTEGER NOT NULL REFERENCES geo_divisions(id),
  district_id  INTEGER NOT NULL REFERENCES geo_districts(id),
  upazila_id   INTEGER NOT NULL REFERENCES geo_upazilas(id),
  union_id     INTEGER REFERENCES geo_unions(id),
  postcode     TEXT,
  post_office  TEXT,
  address_line TEXT NOT NULL,
  landmark     TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ───────────────────────── Orders ─────────────────────────

CREATE TABLE orders (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no               TEXT NOT NULL UNIQUE,   -- AV-YYMMDD-#### or PRE-YYMMDD-#### for pre-orders
  access_token           TEXT NOT NULL,          -- lets the customer open their own order page
  invoice_no             TEXT UNIQUE,            -- INV-YYYYMMDD-#### once confirmed
  customer_id            INTEGER REFERENCES customers(id),
  status                 TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                           'pending','confirmation_attempted','confirmed','packed','shipped','delivered',
                           'cancelled','refused_at_delivery','returned')),
  fulfilment_type        TEXT NOT NULL DEFAULT 'standard' CHECK (fulfilment_type IN ('standard','pre_order','made_to_order')),
  payment_method         TEXT NOT NULL CHECK (payment_method IN ('cod','manual_mobile','bkash','nagad','rocket','card')),
  payment_status         TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','partially_paid','paid','refunded')),
  advance_required       INTEGER NOT NULL DEFAULT 0,
  advance_reason         TEXT,
  advance_amount_paisa   INTEGER,
  advance_status         TEXT NOT NULL DEFAULT 'not_required' CHECK (advance_status IN ('not_required','pending','submitted','paid','refunded')),
  advance_trx_id         TEXT,
  advance_wallet         TEXT,
  subtotal_paisa         INTEGER NOT NULL,
  delivery_charge_paisa  INTEGER,
  delivery_charge_status TEXT NOT NULL DEFAULT 'final' CHECK (delivery_charge_status IN ('final','to_confirm')),
  cod_fee_paisa          INTEGER NOT NULL DEFAULT 0,
  discount_paisa         INTEGER NOT NULL DEFAULT 0,
  total_paisa            INTEGER NOT NULL,
  delivery_zone_id       INTEGER REFERENCES delivery_zones(id),
  eta_text               TEXT,
  customer_name          TEXT NOT NULL,
  phone                  TEXT NOT NULL,
  division_id            INTEGER NOT NULL,
  district_id            INTEGER NOT NULL,
  upazila_id             INTEGER NOT NULL,
  union_id               INTEGER,
  postcode               TEXT,
  post_office            TEXT,
  division_name          TEXT NOT NULL,
  district_name          TEXT NOT NULL,
  upazila_name           TEXT NOT NULL,
  union_name             TEXT,
  address_line           TEXT NOT NULL,
  landmark               TEXT,
  customer_note          TEXT,
  risk_level             TEXT NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low','medium','high')),
  risk_reasons           TEXT NOT NULL DEFAULT '[]',
  duplicate_of_order_id  INTEGER REFERENCES orders(id),
  confirmation_method    TEXT CHECK (confirmation_method IN ('otp','call','prepaid')),
  otp_verified_at        TEXT,
  confirmed_at           TEXT,
  shipped_at             TEXT,
  delivered_at           TEXT,
  cancel_reason          TEXT,
  courier                TEXT,
  tracking_id            TEXT,
  source                 TEXT NOT NULL DEFAULT 'web',
  utm                    TEXT NOT NULL DEFAULT '{}',
  is_test                INTEGER NOT NULL DEFAULT 0,
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_orders_status ON orders (status);
CREATE INDEX idx_orders_phone ON orders (phone);
CREATE INDEX idx_orders_created ON orders (created_at);

CREATE TABLE order_items (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id            INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id          INTEGER NOT NULL REFERENCES products(id),
  variant_id          INTEGER NOT NULL REFERENCES product_variants(id),
  sku                 TEXT NOT NULL,
  name                TEXT NOT NULL,
  variant_label       TEXT,
  unit_price_paisa    INTEGER NOT NULL,
  qty                 INTEGER NOT NULL CHECK (qty > 0),
  line_total_paisa    INTEGER NOT NULL,
  packed_weight_grams INTEGER NOT NULL,
  fulfilment_mode     TEXT NOT NULL
);
CREATE INDEX idx_order_items_order ON order_items (order_id);

CREATE TABLE order_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,              -- status | call | otp | payment | note | risk
  from_status TEXT,
  to_status   TEXT,
  outcome     TEXT,                        -- for calls: confirmed | no_answer | wrong_number | cancel_requested | call_back
  note        TEXT,
  admin_id    TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_order_events_order ON order_events (order_id);

CREATE TABLE order_otps (
  order_id   INTEGER PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  code_hash  TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  sends      INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE invoices (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER NOT NULL UNIQUE REFERENCES orders(id),
  invoice_no  TEXT NOT NULL UNIQUE,
  issued_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  total_paisa INTEGER NOT NULL
);

CREATE TABLE payments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id     INTEGER NOT NULL REFERENCES orders(id),
  kind         TEXT NOT NULL CHECK (kind IN ('advance','full','cod_collection')),
  method       TEXT NOT NULL,
  amount_paisa INTEGER NOT NULL,
  trx_id       TEXT,
  status       TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','verified','rejected','refunded')),
  verified_by  TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE refunds (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id     INTEGER NOT NULL REFERENCES orders(id),
  amount_paisa INTEGER NOT NULL,
  reason       TEXT,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','rejected')),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE abandoned_checkouts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  token          TEXT NOT NULL UNIQUE,
  phone          TEXT,
  name           TEXT,
  address        TEXT NOT NULL DEFAULT '{}',
  cart           TEXT NOT NULL DEFAULT '[]',
  subtotal_paisa INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','converted','contacted','dismissed')),
  order_id       INTEGER REFERENCES orders(id),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_abandoned_status ON abandoned_checkouts (status, updated_at);

CREATE TABLE risk_flags (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  customer_id INTEGER REFERENCES customers(id),
  code        TEXT NOT NULL,
  detail      TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ───────────────────────── Operations ─────────────────────────

CREATE TABLE inventory_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  variant_id INTEGER NOT NULL REFERENCES product_variants(id),
  change     INTEGER NOT NULL,
  reason     TEXT NOT NULL CHECK (reason IN ('receive','sale','adjust','return','cancel','initial')),
  batch_no   TEXT,
  note       TEXT,
  order_id   INTEGER REFERENCES orders(id),
  admin_id   TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_inventory_variant ON inventory_log (variant_id);

CREATE TABLE sms_outbox (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  to_phone     TEXT NOT NULL,
  body         TEXT NOT NULL,
  kind         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','logged')),
  provider_ref TEXT,
  order_id     INTEGER REFERENCES orders(id),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  sent_at      TEXT
);

-- Phase 2/3 modules: tables exist now so later releases need no destructive migrations.
CREATE TABLE coupons (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  code               TEXT NOT NULL UNIQUE COLLATE NOCASE,
  kind               TEXT NOT NULL CHECK (kind IN ('percent','fixed','free_delivery')),
  value              INTEGER NOT NULL DEFAULT 0,
  min_subtotal_paisa INTEGER NOT NULL DEFAULT 0,
  starts_at          TEXT,
  ends_at            TEXT,
  usage_limit        INTEGER,
  used_count         INTEGER NOT NULL DEFAULT 0,
  is_active          INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE reviews (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  order_id    INTEGER REFERENCES orders(id),
  name        TEXT NOT NULL,
  rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body        TEXT,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE recipes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE,
  kind        TEXT NOT NULL DEFAULT 'recipe' CHECK (kind IN ('recipe','business_guide')),
  title       TEXT NOT NULL,
  summary     TEXT,
  body        TEXT,
  video_url   TEXT,
  image_url   TEXT,
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE recipe_products (
  recipe_id  INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  PRIMARY KEY (recipe_id, product_id)
);

CREATE TABLE wholesale_inquiries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  phone      TEXT NOT NULL,
  business   TEXT,
  district   TEXT,
  message    TEXT,
  status     TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','won','lost')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE landing_pages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  template    TEXT NOT NULL CHECK (template IN ('ad_match','seasonal_collection','starter_kit')),
  blocks      TEXT NOT NULL DEFAULT '[]',
  product_id  INTEGER REFERENCES products(id),
  season_id   INTEGER REFERENCES seasons(id),
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
