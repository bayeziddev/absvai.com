-- Order tracking: one row per step the customer sees on the tracking page (/track), in plain words.
-- order_events stays the full staff history (calls, risk, notes); this table holds only what is safe to show the
-- customer: the stage changes, courier updates and messages the shop writes for them. Additive only.

CREATE TABLE order_tracking (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id      INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  step          TEXT NOT NULL,          -- an order stage (new, confirmed, packed, in_courier, delivered, partial_delivered, cancelled, returned), courier_update or shop_note
  title         TEXT NOT NULL,          -- what the customer reads, e.g. "Handed to the courier"
  title_bn      TEXT,                   -- the same in Bangla
  detail        TEXT,                   -- e.g. "Steadfast · tracking SFR123", the courier's own words, or the shop's message
  courier       TEXT,
  tracking_code TEXT,
  source        TEXT NOT NULL DEFAULT 'shop' CHECK (source IN ('shop','courier','customer','system')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_order_tracking_order ON order_tracking (order_id, id);

-- Orders placed before this table existed: their stage changes, in the order they happened.
INSERT INTO order_tracking (order_id, step, title, title_bn, detail, courier, tracking_code, source, created_at)
SELECT e.order_id, e.to_status,
  CASE e.to_status
    WHEN 'new' THEN 'Order placed' WHEN 'confirmed' THEN 'Order confirmed' WHEN 'packed' THEN 'Packed and ready to ship'
    WHEN 'in_courier' THEN 'Handed to the courier' WHEN 'delivered' THEN 'Delivered' WHEN 'partial_delivered' THEN 'Partly delivered'
    WHEN 'cancelled' THEN 'Order cancelled' WHEN 'returned' THEN 'Returned to the shop' ELSE 'Update' END,
  CASE e.to_status
    WHEN 'new' THEN 'অর্ডার করা হয়েছে' WHEN 'confirmed' THEN 'অর্ডার নিশ্চিত হয়েছে' WHEN 'packed' THEN 'প্যাক করা হয়েছে, পাঠানোর জন্য প্রস্তুত'
    WHEN 'in_courier' THEN 'কুরিয়ারে দেওয়া হয়েছে' WHEN 'delivered' THEN 'ডেলিভারি হয়েছে' WHEN 'partial_delivered' THEN 'আংশিক ডেলিভারি হয়েছে'
    WHEN 'cancelled' THEN 'অর্ডার বাতিল হয়েছে' WHEN 'returned' THEN 'দোকানে ফেরত এসেছে' ELSE 'আপডেট' END,
  CASE WHEN e.to_status = 'in_courier' AND o.tracking_id IS NOT NULL THEN
    CASE o.courier WHEN 'steadfast' THEN 'Steadfast' WHEN 'pathao' THEN 'Pathao' WHEN 'redx' THEN 'RedX' WHEN 'carrybee' THEN 'Carrybee' WHEN 'own_delivery' THEN 'Own delivery' ELSE o.courier END
    || ' · tracking ' || o.tracking_id END,
  CASE WHEN e.to_status = 'in_courier' THEN o.courier END,
  CASE WHEN e.to_status = 'in_courier' THEN o.tracking_id END,
  CASE e.actor_type WHEN 'courier' THEN 'courier' WHEN 'customer' THEN 'customer' WHEN 'system' THEN 'system' ELSE 'shop' END,
  e.created_at
FROM order_events e JOIN orders o ON o.id = e.order_id
WHERE e.kind = 'status' AND e.to_status IS NOT NULL
ORDER BY e.id;
