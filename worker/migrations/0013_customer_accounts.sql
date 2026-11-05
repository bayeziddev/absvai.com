-- Customer accounts: sign up and sign in with a 6-digit code sent by email (no passwords to forget). The verified email
-- is the account. Orders placed with that email (signed in, or earlier) show on the account page with tracking and the
-- invoice; the name, mobile and last address fill in the checkout by themselves. Offers chosen here reach the customer
-- through the existing offers list (customers.email_marketing).
CREATE TABLE customer_accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  phone         TEXT,                         -- 8801XXXXXXXXX
  address_line  TEXT,                         -- the last delivery address, as typed
  zone_id       INTEGER,                      -- the last delivery area
  offers        INTEGER NOT NULL DEFAULT 1,   -- "email me offers"
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_login_at TEXT
);

-- A code waiting to be typed: one per email, kept only as a hash, valid for 10 minutes and 5 tries. Sign-up details
-- wait here until the code is right, so an account exists only for an email that was proven.
CREATE TABLE account_codes (
  email      TEXT PRIMARY KEY COLLATE NOCASE,
  code_hash  TEXT NOT NULL,
  name       TEXT,
  phone      TEXT,
  offers     INTEGER NOT NULL DEFAULT 1,
  attempts   INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_orders_customer_email ON orders (customer_email);

-- Coupons the owner shows to signed-in customers on their account page ("Your offers").
ALTER TABLE coupons ADD COLUMN for_members INTEGER NOT NULL DEFAULT 0;
