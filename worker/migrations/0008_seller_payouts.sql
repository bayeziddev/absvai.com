-- Seller payment accounts: where the shop pays each seller (bKash, Nagad, Rocket or a bank account). A seller can add
-- several; each one is used only after the owner approves it, so a stolen seller password can't redirect payments.
-- sellers.payout_method / payout_number keep the most recently approved account for the lists. Additive only.

CREATE TABLE seller_payouts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id       INTEGER NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  method          TEXT NOT NULL CHECK (method IN ('bkash','nagad','rocket','bank')),
  account_number  TEXT NOT NULL,
  account_name    TEXT,                 -- name on the account
  account_type    TEXT,                 -- wallets: personal | merchant | agent
  bank_name       TEXT,                 -- banks only
  branch          TEXT,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  review_note     TEXT,
  reviewed_by     TEXT,
  reviewed_at     TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_seller_payouts_seller ON seller_payouts (seller_id, id);
CREATE INDEX idx_seller_payouts_pending ON seller_payouts (created_at) WHERE status = 'pending';

-- Accounts given at registration so far: approved for sellers the owner already approved (they saw them then).
INSERT INTO seller_payouts (seller_id, method, account_number, status, reviewed_by, reviewed_at, created_at)
SELECT id, payout_method, payout_number, CASE WHEN status = 'approved' THEN 'approved' ELSE 'pending' END,
       CASE WHEN status = 'approved' THEN reviewed_by END, CASE WHEN status = 'approved' THEN reviewed_at END, created_at
  FROM sellers WHERE payout_method IN ('bkash','nagad','rocket','bank') AND payout_number IS NOT NULL AND trim(payout_number) != '';

-- The AI answer limits had only built-in defaults, so the Settings page sent them empty; store the defaults.
INSERT OR IGNORE INTO settings (key, value) VALUES ('assistant_daily_limit', '300'), ('admin_assistant_daily_limit', '100');
