-- Vandar Mart delivers from Rajbari: ৳70 inside Rajbari district, ৳130 everywhere else in Bangladesh, a flat charge (no
-- per-kg extra). The starting delivery areas (named for Dhaka) become these two, with Bangla names and a short note under
-- each name, as the checkout shows them. Only areas the shop has not renamed are touched; the owner can rename an area,
-- change its note or its charge, or add more (e.g. another district) in Settings → Delivery areas.
ALTER TABLE delivery_zones ADD COLUMN note TEXT NOT NULL DEFAULT '';

UPDATE delivery_zones SET name = 'রাজবাড়ীর ভিতরে', note = 'Local delivery', extra_per_kg_paisa = 0, bulky_charge_paisa = base_charge_paisa,
    eta_text = CASE WHEN eta_text = '1–2 days' THEN '১–২ দিন' ELSE eta_text END
  WHERE name = 'Inside Dhaka City' AND NOT EXISTS (SELECT 1 FROM delivery_zones WHERE name = 'রাজবাড়ীর ভিতরে');
UPDATE delivery_zones SET name = 'রাজবাড়ীর বাইরে', note = 'সারা বাংলাদেশ', extra_per_kg_paisa = 0, bulky_charge_paisa = base_charge_paisa,
    eta_text = CASE WHEN eta_text = '3–5 days' THEN '৩–৫ দিন' ELSE eta_text END
  WHERE name = 'Outside Dhaka' AND NOT EXISTS (SELECT 1 FROM delivery_zones WHERE name = 'রাজবাড়ীর বাইরে');

-- "Inside Rajbari" covers Rajbari district (it covered the Dhaka city corporations before).
DELETE FROM zone_upazila_overrides WHERE zone_id IN (SELECT id FROM delivery_zones WHERE name = 'রাজবাড়ীর ভিতরে');
INSERT OR REPLACE INTO zone_districts (district_id, zone_id)
  SELECT d.id, z.id FROM geo_districts d, delivery_zones z WHERE d.name = 'Rajbari' AND z.name = 'রাজবাড়ীর ভিতরে';

-- The Dhaka-suburbs area is not a choice for a shop in Rajbari: its districts go to the main area (৳130), and the area
-- itself goes when no order used it.
DELETE FROM zone_districts WHERE zone_id IN (SELECT id FROM delivery_zones WHERE name = 'Dhaka Suburbs');
DELETE FROM zone_upazila_overrides WHERE zone_id IN (SELECT id FROM delivery_zones WHERE name = 'Dhaka Suburbs');
DELETE FROM delivery_zones WHERE name = 'Dhaka Suburbs' AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.delivery_zone_id = delivery_zones.id);
UPDATE delivery_zones SET name = 'ঢাকার আশেপাশে', note = 'সাভার, গাজীপুর, নারায়ণগঞ্জ' WHERE name = 'Dhaka Suburbs';

-- The checkout and landing pages are rebuilt with the new areas.
INSERT INTO cache_purges (tag) VALUES ('site') ON CONFLICT(tag) DO NOTHING;
