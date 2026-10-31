-- Email through Resend. Every email the shop sends goes through this outbox: it is queued (in the same request that
-- placed or changed the order), sent right after the response and retried by the cron, so a slow or failing email
-- never slows down or breaks checkout. The owner sees what went out, and why something failed, in Admin → Emails.
CREATE TABLE email_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT NOT NULL,           -- owner_new_order, owner_update, owner_daily, owner_inquiry, customer_receipt, customer_invoice, customer_shipped, customer_delivered, marketing, test
  dedupe_key   TEXT UNIQUE,             -- one email per order event, however often the event is retried
  to_email     TEXT NOT NULL,
  subject      TEXT NOT NULL,
  html         TEXT NOT NULL,
  text         TEXT NOT NULL,
  order_id     INTEGER REFERENCES orders(id),
  status       TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','skipped')),
  attempts     INTEGER NOT NULL DEFAULT 0,
  provider_id  TEXT,                    -- the Resend email id
  error        TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  sent_at      TEXT
);
CREATE INDEX idx_email_log_queue ON email_log (status, id) WHERE status = 'queued';
CREATE INDEX idx_email_log_created ON email_log (created_at DESC);

-- The customer's email is optional at checkout; with it they get the receipt, the invoice and delivery updates.
ALTER TABLE orders ADD COLUMN customer_email TEXT;
-- Offers by email only for customers who ticked the box; every offer email carries a one-tap unsubscribe link.
ALTER TABLE customers ADD COLUMN email_marketing INTEGER NOT NULL DEFAULT 0;

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('notify_email', 'absvai1020@gmail.com'),
  ('email_from', 'Abs Vai <onboarding@resend.dev>'),
  ('email_reply_to', 'absvai1020@gmail.com'),
  ('email_owner_new_order', '1'),
  ('email_owner_updates', '1'),
  ('email_owner_daily', '1'),
  ('email_customer_updates', '1');
