-- Customers open an account with a password, straight away (no code). The 6-digit email code is only for "forgot
-- password", to choose a new one.
ALTER TABLE customer_accounts ADD COLUMN password_hash TEXT;
-- The email is proven once the customer types a code sent to it; only then do earlier orders placed with that email
-- show on the account. Accounts opened with a code (before passwords) proved it already.
ALTER TABLE customer_accounts ADD COLUMN email_verified_at TEXT;
UPDATE customer_accounts SET email_verified_at = created_at WHERE email_verified_at IS NULL;

-- Orders placed while signed in belong to that account.
ALTER TABLE orders ADD COLUMN account_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_orders_account ON orders (account_id);
CREATE INDEX IF NOT EXISTS idx_customer_accounts_phone ON customer_accounts (phone);

-- The company name was saved in lower case ("vandar mart"); pages show "Made and packed by Vandar Mart".
UPDATE settings SET value = 'Vandar Mart' WHERE key = 'company_name' AND value = 'vandar mart';
INSERT INTO cache_purges (tag) VALUES ('site') ON CONFLICT(tag) DO NOTHING;
