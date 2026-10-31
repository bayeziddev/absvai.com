-- Growth tools: landing pages, coupons, product reviews, and what the sales report needs to tell them apart.
-- The three tables were created empty in 0001 for this phase; this adds the columns they were missing. Additive only.

-- Landing pages: the page content (headline, photos, details, video, FAQ, reviews, order button…) lives in `blocks`
-- as JSON, so new sections need no new columns. Views are counted for the conversion rate in the report.
ALTER TABLE landing_pages ADD COLUMN updated_at TEXT;
ALTER TABLE landing_pages ADD COLUMN views INTEGER NOT NULL DEFAULT 0;
ALTER TABLE landing_pages ADD COLUMN deleted_at TEXT;
CREATE INDEX idx_landing_status ON landing_pages (status, created_at DESC) WHERE deleted_at IS NULL;

-- Orders remember the landing page and the coupon they came with (reports and coupon limits).
ALTER TABLE orders ADD COLUMN landing_page_id INTEGER REFERENCES landing_pages(id);
ALTER TABLE orders ADD COLUMN coupon_code TEXT;
CREATE INDEX idx_orders_landing ON orders (landing_page_id, created_at) WHERE landing_page_id IS NOT NULL;
CREATE INDEX idx_orders_coupon ON orders (coupon_code, created_at) WHERE coupon_code IS NOT NULL;

-- Coupons: a cap for percentage coupons, a per-customer limit and a note for the team.
ALTER TABLE coupons ADD COLUMN max_discount_paisa INTEGER;
ALTER TABLE coupons ADD COLUMN per_phone_limit INTEGER;
ALTER TABLE coupons ADD COLUMN note TEXT;
ALTER TABLE coupons ADD COLUMN created_at TEXT;
ALTER TABLE coupons ADD COLUMN updated_at TEXT;

-- Each use of a coupon: the per-customer limit counts these (cancelled orders give the use back).
CREATE TABLE coupon_redemptions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  coupon_id      INTEGER NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  order_id       INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  phone          TEXT NOT NULL,
  discount_paisa INTEGER NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX idx_redemptions_order ON coupon_redemptions (order_id);
CREATE INDEX idx_redemptions_coupon_phone ON coupon_redemptions (coupon_id, phone);

-- Reviews: the reviewer's mobile number (never shown; one review per product per number, and "verified buyer" when
-- that number received the product), the shop's public reply, and reviews the shop adds itself (e.g. from Facebook).
ALTER TABLE reviews ADD COLUMN phone TEXT;
ALTER TABLE reviews ADD COLUMN verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reviews ADD COLUMN reply TEXT;
ALTER TABLE reviews ADD COLUMN source TEXT NOT NULL DEFAULT 'customer';
ALTER TABLE reviews ADD COLUMN ip_hash TEXT;
ALTER TABLE reviews ADD COLUMN updated_at TEXT;
CREATE INDEX idx_reviews_product ON reviews (product_id, status, created_at DESC);
CREATE INDEX idx_reviews_status ON reviews (status, created_at DESC);
CREATE UNIQUE INDEX idx_reviews_once ON reviews (product_id, phone) WHERE phone IS NOT NULL;

INSERT OR IGNORE INTO settings (key, value) VALUES ('reviews_enabled', '1'), ('reviews_auto_publish_verified', '0');
