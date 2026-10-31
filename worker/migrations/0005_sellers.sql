-- Marketplace: outside sellers register, the owner approves them, and approved sellers add products from their own
-- seller portal. Seller products go live only after the owner approves each one. Orders, delivery and payment stay
-- with the shop; sellers see the sales of their own products and what they will be paid (after commission).
CREATE TABLE sellers (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_name           TEXT NOT NULL,
  slug                TEXT NOT NULL UNIQUE,
  owner_name          TEXT NOT NULL,
  email               TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone               TEXT NOT NULL,                 -- 8801XXXXXXXXX
  password_hash       TEXT NOT NULL,
  district            TEXT,
  address             TEXT,
  business_type       TEXT,
  sells               TEXT,                          -- what they plan to sell, in their words
  about               TEXT,                          -- shown on their store page once approved
  payout_method       TEXT,                          -- bkash | nagad | rocket | bank
  payout_number       TEXT,
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','suspended')),
  review_note         TEXT,
  reviewed_by         TEXT,
  reviewed_at         TEXT,
  commission_percent  INTEGER NOT NULL DEFAULT 10 CHECK (commission_percent BETWEEN 0 AND 90),
  last_login_at       TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_sellers_status ON sellers (status, created_at DESC);

-- Products from sellers: who owns them, and the owner's review of each one (pending → approved / changes needed).
ALTER TABLE products ADD COLUMN seller_id INTEGER REFERENCES sellers(id);
ALTER TABLE products ADD COLUMN review_status TEXT CHECK (review_status IN ('pending','approved','rejected'));
ALTER TABLE products ADD COLUMN review_note TEXT;
CREATE INDEX idx_products_seller ON products (seller_id, updated_at DESC) WHERE seller_id IS NOT NULL;
CREATE INDEX idx_products_review ON products (review_status, updated_at) WHERE review_status = 'pending';

INSERT OR IGNORE INTO settings (key, value) VALUES ('seller_commission_percent', '10'), ('sellers_open', '1');
