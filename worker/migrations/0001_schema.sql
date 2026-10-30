-- Abs Vai core schema (Cloudflare D1 / SQLite).
-- Money is always integer paisa (৳1 = 100). Dates are ISO-8601 text.
-- Bangladesh-local calendar dates (season start/end, invoice dates) are stored as YYYY-MM-DD.
-- Phones are stored normalized as 8801XXXXXXXXX. Device IDs and IPs are stored only as salted hashes.
-- Revised before the first production deploy for the v2 operations platform (8-stage pipeline, stock reservation,
-- incomplete orders, fraud tables). From the first deploy on, every change is a new additive migration.

PRAGMA foreign_keys = ON;

-- ───────────────────────── Settings, staff, audit ─────────────────────────

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,                 -- secrets hold "v1:<iv>:<ciphertext>" (AES-GCM), never plain text
  is_secret  INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE admins (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('super_admin','manager','order_processor','warehouse','accountant','viewer')),
  password_hash TEXT NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1,
  on_duty       INTEGER NOT NULL DEFAULT 1,
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
CREATE INDEX idx_audit_entity ON audit_log (entity, entity_id);

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
  default_courier    TEXT,                    -- steadfast | pathao | redx | carrybee | own_delivery
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
  depth             INTEGER NOT NULL DEFAULT 1 CHECK (depth BETWEEN 1 AND 3),   -- Category → Subcategory → Child category
  template_id       TEXT REFERENCES product_templates(id),                      -- NULL: inherits the parent's template
  icon_url          TEXT,
  description       TEXT,
  season_visibility TEXT NOT NULL DEFAULT 'always' CHECK (season_visibility IN ('always','seasons')),
  is_active         INTEGER NOT NULL DEFAULT 1,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  meta_title        TEXT,
  meta_description  TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at        TEXT,
  CHECK (template_id IS NOT NULL OR parent_id IS NOT NULL)
);
CREATE INDEX idx_categories_parent ON categories (parent_id, sort_order);

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
  show_on_home            INTEGER NOT NULL DEFAULT 0,
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
CREATE INDEX idx_products_status ON products (status, published_at);
CREATE INDEX idx_products_home ON products (show_on_home) WHERE show_on_home = 1;

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
  cost_paisa             INTEGER CHECK (cost_paisa >= 0),  -- weighted-average cost; Owner/Accountant only
  wholesale_tiers        TEXT NOT NULL DEFAULT '[]',
  stock                  INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),     -- on hand in the warehouse
  reserved               INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0),  -- held by confirmed orders not yet with the courier
  packed_weight_grams    INTEGER NOT NULL CHECK (packed_weight_grams >= 0), -- 0 only on drafts: the publish checklist blocks it
  net_value              REAL,
  net_unit               TEXT CHECK (net_unit IN ('g','kg','ml','l','m','pcs')),
  gtin                   TEXT UNIQUE,         -- official GS1 GTIN/EAN-13 when the client has one; internal barcode = SKU (Code 128)
  shelf_location         TEXT,                -- sorts the picking list
  image_ids              TEXT NOT NULL DEFAULT '[]',
  is_active              INTEGER NOT NULL DEFAULT 1,
  sort_order             INTEGER NOT NULL DEFAULT 0,
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (product_id, attributes_key),
  CHECK (reserved <= stock)   -- confirming more than is on hand fails the whole batch
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
  last_order_at   TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_customers_updated ON customers (updated_at DESC);

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
  -- Eight-stage pipeline, enforced by worker/src/lib/state-machine.ts.
  status                 TEXT NOT NULL DEFAULT 'new' CHECK (status IN (
                           'new','confirmed','packed','in_courier','delivered','partial_delivered','cancelled','returned')),
  sub_status             TEXT,                   -- new: call_attempted · in_courier: picked_up, in_transit, out_for_delivery, on_hold, awaiting_approval · returned: in_transit_back, received
  call_attempts          INTEGER NOT NULL DEFAULT 0,
  hold_reason            TEXT,                   -- set by a fraud rule; the order can't be confirmed until staff release it
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
  phone                  TEXT NOT NULL,          -- 8801XXXXXXXXX
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
  packed_at              TEXT,
  in_courier_at          TEXT,
  delivered_at           TEXT,
  cancel_reason          TEXT,
  return_reason          TEXT CHECK (return_reason IN ('refused','unreachable','wrong_address','damaged','other')),
  returned_at            TEXT,
  return_received_at     TEXT,                   -- set only by the warehouse scan; this is when stock comes back
  return_received_by     TEXT,
  courier                TEXT,
  consignment_id         TEXT,
  tracking_id            TEXT,
  last_courier_update_at TEXT,
  last_transition_id     TEXT,                   -- written with every status change; guards the rest of that batch
  -- Sales channel. Manual orders require one (feeds per-channel reports).
  source                 TEXT NOT NULL DEFAULT 'web' CHECK (source IN (
                           'web','landing','facebook_comment','messenger','whatsapp','phone_call','instagram','walk_in','other')),
  source_detail          TEXT,
  utm                    TEXT NOT NULL DEFAULT '{}',
  checkout_session_id    TEXT,
  device_hash            TEXT,
  ip_hash                TEXT,
  created_by             TEXT REFERENCES admins(id),   -- staff member credited with a manual order
  assigned_to            TEXT REFERENCES admins(id),
  is_test                INTEGER NOT NULL DEFAULT 0,
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- Composite indexes for the admin's top queries (checked with EXPLAIN QUERY PLAN in tests/integration/scale.test.ts).
CREATE INDEX idx_orders_status_created  ON orders (status, created_at DESC);
CREATE INDEX idx_orders_phone_created   ON orders (phone, created_at DESC);
CREATE INDEX idx_orders_assigned_created ON orders (assigned_to, created_at DESC);  -- "Mine" and "Unassigned" tabs
CREATE INDEX idx_orders_ip_created      ON orders (ip_hash, created_at);
CREATE INDEX idx_orders_device_created  ON orders (device_hash, created_at);
CREATE INDEX idx_orders_source_created  ON orders (source, created_at);
CREATE INDEX idx_orders_created         ON orders (created_at DESC);
CREATE INDEX idx_orders_tracking        ON orders (tracking_id) WHERE tracking_id IS NOT NULL;
CREATE INDEX idx_orders_held            ON orders (created_at) WHERE hold_reason IS NOT NULL;
CREATE INDEX idx_orders_risk_created    ON orders (risk_level, created_at DESC);
CREATE INDEX idx_orders_advance_created ON orders (advance_status, created_at DESC);
CREATE INDEX idx_orders_preorder        ON orders (status, created_at DESC) WHERE fulfilment_type = 'pre_order';
-- Dashboard stage cards count from the index alone (status, test flag, last change).
CREATE INDEX idx_orders_stage_counts    ON orders (status, is_test, updated_at);
-- "Returned parcels not scanned in yet": only the few rows waiting at the warehouse are indexed.
CREATE INDEX idx_orders_return_scan     ON orders (status) WHERE status IN ('returned','partial_delivered') AND return_received_at IS NULL;
CREATE UNIQUE INDEX idx_orders_consignment ON orders (courier, consignment_id) WHERE consignment_id IS NOT NULL;

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
  returned_qty        INTEGER NOT NULL DEFAULT 0,          -- partial delivery: how many come back
  line_total_paisa    INTEGER NOT NULL,
  packed_weight_grams INTEGER NOT NULL,
  fulfilment_mode     TEXT NOT NULL,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (returned_qty BETWEEN 0 AND qty)
);
CREATE INDEX idx_order_items_order ON order_items (order_id);
CREATE INDEX idx_items_variant_created ON order_items (variant_id, created_at);

-- Status history and activity: every transition records who or what made it (staff, customer, courier, system) and why.
CREATE TABLE order_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,              -- status | rejected_transition | call | otp | payment | note | risk | hold | return_scan
  from_status TEXT,
  to_status   TEXT,
  outcome     TEXT,                        -- for calls: confirmed | no_answer | wrong_number | cancel_requested | call_back
  note        TEXT,
  actor_type  TEXT NOT NULL DEFAULT 'staff' CHECK (actor_type IN ('staff','customer','courier','system')),
  admin_id    TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_order_events_order ON order_events (order_id, id);

CREATE TABLE order_otps (
  order_id   INTEGER PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  code_hash  TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  sends      INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Every OTP send (and every refused one). Caps are counted here, a strict limit, not by the approximate edge limiter.
CREATE TABLE otp_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  phone       TEXT NOT NULL,
  device_hash TEXT,
  ip_hash     TEXT,
  order_id    INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  status      TEXT NOT NULL CHECK (status IN ('sent','capped_phone','capped_device','capped_global')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_otp_phone_created ON otp_log (phone, created_at);
CREATE INDEX idx_otp_device_created ON otp_log (device_hash, created_at);
CREATE INDEX idx_otp_created ON otp_log (created_at);

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
CREATE INDEX idx_payments_order ON payments (order_id);

CREATE TABLE refunds (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id     INTEGER NOT NULL REFERENCES orders(id),
  amount_paisa INTEGER NOT NULL,
  reason       TEXT,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','rejected')),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Incomplete orders: one row per checkout session (HttpOnly cookie), upserted as the customer types. Never a row per keystroke.
CREATE TABLE abandoned_checkouts (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  checkout_session_id TEXT NOT NULL,
  phone               TEXT NOT NULL,            -- only valid, normalized numbers create a row
  name                TEXT,
  address             TEXT NOT NULL DEFAULT '{}',
  cart                TEXT NOT NULL DEFAULT '[]', -- [{variantId, qty, pricePaisa, name, sku}]
  subtotal_paisa      INTEGER NOT NULL DEFAULT 0,
  source              TEXT NOT NULL DEFAULT '{}', -- {landingPageId, utm}
  device_hash         TEXT,
  ip_hash             TEXT,
  risk_level          TEXT NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low','medium','high','blocked')),
  risk_reasons        TEXT NOT NULL DEFAULT '[]',
  status              TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','converted','not_interested','unreachable','spam')),
  converted_order_id  INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  converted_at        TEXT,
  contacted_at        TEXT,
  assigned_to         TEXT REFERENCES admins(id),
  note                TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX idx_abandoned_session ON abandoned_checkouts (checkout_session_id);
CREATE INDEX idx_abandoned_status_updated ON abandoned_checkouts (status, updated_at DESC);
CREATE INDEX idx_abandoned_phone ON abandoned_checkouts (phone);

CREATE TABLE risk_flags (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  customer_id INTEGER REFERENCES customers(id),
  code        TEXT NOT NULL,
  detail      TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_risk_flags_order ON risk_flags (order_id);

-- ───────────────────────── Fraud & bot protection ─────────────────────────

-- Phone, device and IP blocks. Values are salted hashes; value_hint is a masked form staff can recognise.
-- IP blocks must expire (many mobile customers share one IP); a permanent IP block needs an explicit reason.
CREATE TABLE block_list (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT NOT NULL CHECK (type IN ('phone','device','ip')),
  value_hash TEXT NOT NULL,
  value_hint TEXT,
  reason     TEXT NOT NULL,
  expires_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (type != 'ip' OR expires_at IS NOT NULL OR length(reason) >= 10)
);
CREATE UNIQUE INDEX idx_blocklist ON block_list (type, value_hash);

-- Every block, hold or rate limit, so false positives are visible and reversible.
CREATE TABLE blocked_attempts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  layer       TEXT NOT NULL CHECK (layer IN ('phone','device','ip','velocity','interval','otp','bot','honeypot','token')),
  action      TEXT NOT NULL CHECK (action IN ('blocked','held','rate_limited','silently_rejected')),
  route       TEXT NOT NULL,
  reason      TEXT NOT NULL,
  phone_hint  TEXT,
  phone_hash  TEXT,
  device_hash TEXT,
  ip_hash     TEXT,
  order_id    INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  block_id    INTEGER REFERENCES block_list(id) ON DELETE SET NULL,
  reviewed_at TEXT,
  reviewed_by TEXT,
  review_note TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_blocked_attempts_created ON blocked_attempts (created_at DESC);

-- ───────────────────────── Operations ─────────────────────────

-- Stock movements ledger: every change to on-hand or reserved stock, with who, when and why. Stock is never edited silently.
CREATE TABLE stock_movements (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  variant_id      INTEGER NOT NULL REFERENCES product_variants(id),
  change          INTEGER NOT NULL,               -- on-hand change
  reserved_change INTEGER NOT NULL DEFAULT 0,
  kind            TEXT NOT NULL CHECK (kind IN ('initial','purchase_received','reserve','release','sale','pos_sale','return_received','adjustment','transfer')),
  reason          TEXT,                            -- adjustments: received, count_correction, damaged_in_transit, damaged_in_storage, expired, missing, lost_by_courier
  batch_no        TEXT,
  note            TEXT,
  order_id        INTEGER REFERENCES orders(id),
  admin_id        TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_stock_moves_variant ON stock_movements (variant_id, created_at);
CREATE INDEX idx_stock_moves_batch ON stock_movements (batch_no) WHERE batch_no IS NOT NULL;

-- Edge-cache purge queue: one row per tag, so a bulk edit of 200 products becomes one batched purge.
CREATE TABLE cache_purges (
  tag          TEXT PRIMARY KEY,
  requested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  attempts     INTEGER NOT NULL DEFAULT 0
);

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
CREATE INDEX idx_sms_outbox_created ON sms_outbox (created_at);

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
