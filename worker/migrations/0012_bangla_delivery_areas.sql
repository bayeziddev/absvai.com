-- Customers read the checkout in Bangla, so the three starting delivery areas get Bangla names and delivery times.
-- Only names and times the shop has not changed are touched. The owner can rename any area, or change its charge,
-- in Settings → Delivery areas.
UPDATE delivery_zones SET name = 'ঢাকা সিটির ভিতরে'
  WHERE name = 'Inside Dhaka City' AND NOT EXISTS (SELECT 1 FROM delivery_zones WHERE name = 'ঢাকা সিটির ভিতরে');
UPDATE delivery_zones SET name = 'ঢাকার আশেপাশে (সাভার, গাজীপুর, নারায়ণগঞ্জ)'
  WHERE name = 'Dhaka Suburbs' AND NOT EXISTS (SELECT 1 FROM delivery_zones WHERE name = 'ঢাকার আশেপাশে (সাভার, গাজীপুর, নারায়ণগঞ্জ)');
UPDATE delivery_zones SET name = 'ঢাকার বাইরে'
  WHERE name = 'Outside Dhaka' AND NOT EXISTS (SELECT 1 FROM delivery_zones WHERE name = 'ঢাকার বাইরে');

UPDATE delivery_zones SET eta_text = '১–২ দিন' WHERE eta_text = '1–2 days';
UPDATE delivery_zones SET eta_text = '২–৩ দিন' WHERE eta_text = '2–3 days';
UPDATE delivery_zones SET eta_text = '৩–৫ দিন' WHERE eta_text = '3–5 days';

-- The checkout and landing pages are rebuilt with the new names.
INSERT INTO cache_purges (tag) VALUES ('site') ON CONFLICT(tag) DO NOTHING;
