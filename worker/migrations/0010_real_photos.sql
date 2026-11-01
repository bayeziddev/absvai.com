-- Real photos in place of the drawn placeholder pictures: categories, the demo products, the homepage, season and
-- second banners. Only pictures the shop has not changed yet (still a /img/placeholders/ drawing) are replaced.
-- The photos are in public/img/photos (scripts/photos.py makes their smaller copies).

-- Category pictures (menu and the round pictures on the homepage).
UPDATE categories SET icon_url = '/img/photos/sq/cat-organic.webp' WHERE slug = 'organic-seasonal-food' AND icon_url LIKE '/img/placeholders/%';
UPDATE categories SET icon_url = '/img/photos/sq/cat-khejur-gur.webp' WHERE slug = 'khejur-gur' AND icon_url LIKE '/img/placeholders/%';
UPDATE categories SET icon_url = '/img/photos/sq/cat-spices.webp' WHERE slug = 'spices-masala' AND icon_url LIKE '/img/placeholders/%';
UPDATE categories SET icon_url = '/img/photos/sq/cat-press.webp' WHERE slug = 'food-business-machines' AND icon_url LIKE '/img/placeholders/%';
UPDATE categories SET icon_url = '/img/photos/sq/cat-press.webp' WHERE slug = 'presses' AND icon_url LIKE '/img/placeholders/%';
UPDATE categories SET icon_url = '/img/photos/sq/p-press.webp' WHERE slug = 'chanachur-presses' AND icon_url LIKE '/img/placeholders/%';
UPDATE categories SET icon_url = '/img/photos/sq/cat-sealer.webp' WHERE slug = 'sealers' AND icon_url LIKE '/img/placeholders/%';
UPDATE categories SET icon_url = '/img/photos/sq/cat-wooden.webp' WHERE slug = 'kitchen-wooden-tools' AND icon_url LIKE '/img/placeholders/%';
UPDATE categories SET icon_url = '/img/photos/sq/cat-furniture.webp' WHERE slug = 'home-furniture' AND icon_url LIKE '/img/placeholders/%';
UPDATE categories SET icon_url = '/img/photos/sq/cat-clothing.webp' WHERE slug = 'clothing' AND icon_url LIKE '/img/placeholders/%';
UPDATE categories SET icon_url = '/img/photos/sq/cat-winter-wear.webp' WHERE slug = 'winter-wear' AND icon_url LIKE '/img/placeholders/%';
UPDATE categories SET icon_url = '/img/photos/sq/p-fabric.webp' WHERE slug = 'unstitched-fabric' AND icon_url LIKE '/img/placeholders/%';
UPDATE categories SET icon_url = '/img/photos/sq/cat-shoes.webp' WHERE slug = 'shoes' AND icon_url LIKE '/img/placeholders/%';
UPDATE categories SET icon_url = '/img/photos/sq/cat-gadgets.webp' WHERE slug = 'gadgets-electronics' AND icon_url LIKE '/img/placeholders/%';
UPDATE categories SET icon_url = '/img/photos/sq/cat-accessories.webp' WHERE slug = 'accessories' AND icon_url LIKE '/img/placeholders/%';
UPDATE categories SET icon_url = '/img/photos/sq/cat-packaging.webp' WHERE slug = 'packaging-supplies' AND icon_url LIKE '/img/placeholders/%';

-- Product photos of the demo catalog, where it was loaded.
UPDATE product_media SET url = '/img/photos/sq/cat-khejur-gur.webp', width = 1024, height = 1024 WHERE url LIKE '/img/placeholders/%' AND kind = 'image' AND product_id = (SELECT id FROM products WHERE slug = 'khejur-patali-gur');
UPDATE product_media SET url = '/img/photos/sq/p-liquid-gur.webp', width = 1024, height = 1024 WHERE url LIKE '/img/placeholders/%' AND kind = 'image' AND product_id = (SELECT id FROM products WHERE slug = 'liquid-khejur-gur');
UPDATE product_media SET url = '/img/photos/sq/p-mango.webp', width = 1024, height = 1024 WHERE url LIKE '/img/placeholders/%' AND kind = 'image' AND product_id = (SELECT id FROM products WHERE slug = 'himsagar-mango-pre-order');
UPDATE product_media SET url = '/img/photos/sq/p-mango.webp', width = 1024, height = 1024 WHERE url LIKE '/img/placeholders/%' AND kind = 'image' AND product_id = (SELECT id FROM products WHERE slug = 'langra-mango');
UPDATE product_media SET url = '/img/photos/sq/p-honey.webp', width = 1024, height = 1024 WHERE url LIKE '/img/placeholders/%' AND kind = 'image' AND product_id = (SELECT id FROM products WHERE slug = 'sundarbans-honey');
UPDATE product_media SET url = '/img/photos/sq/p-masala.webp', width = 1024, height = 1024 WHERE url LIKE '/img/placeholders/%' AND kind = 'image' AND product_id = (SELECT id FROM products WHERE slug = '42-item-master-masala');
UPDATE product_media SET url = '/img/photos/sq/p-sealer.webp', width = 1024, height = 1024 WHERE url LIKE '/img/placeholders/%' AND kind = 'image' AND product_id = (SELECT id FROM products WHERE slug = 'electronic-impulse-sealer-pfs');
UPDATE product_media SET url = '/img/photos/sq/p-press.webp', width = 1024, height = 1024 WHERE url LIKE '/img/placeholders/%' AND kind = 'image' AND product_id = (SELECT id FROM products WHERE slug = 'manual-chanachur-press');
UPDATE product_media SET url = '/img/photos/sq/cat-wooden.webp', width = 1024, height = 1024 WHERE url LIKE '/img/placeholders/%' AND kind = 'image' AND product_id = (SELECT id FROM products WHERE slug = 'mahogany-velpuri-maker');
UPDATE product_media SET url = '/img/photos/sq/cat-wooden.webp', width = 1024, height = 1024 WHERE url LIKE '/img/placeholders/%' AND kind = 'image' AND product_id = (SELECT id FROM products WHERE slug = 'wooden-hand-masher');
UPDATE product_media SET url = '/img/photos/sq/p-clothes-rack.webp', width = 1024, height = 1024 WHERE url LIKE '/img/placeholders/%' AND kind = 'image' AND product_id = (SELECT id FROM products WHERE slug = 'wooden-clothes-rack');
UPDATE product_media SET url = '/img/photos/sq/cat-clothing.webp', width = 1024, height = 1024 WHERE url LIKE '/img/placeholders/%' AND kind = 'image' AND product_id = (SELECT id FROM products WHERE slug = 'mens-cotton-panjabi');
UPDATE product_media SET url = '/img/photos/sq/p-fabric.webp', width = 1024, height = 1024 WHERE url LIKE '/img/placeholders/%' AND kind = 'image' AND product_id = (SELECT id FROM products WHERE slug = 'cotton-voile-fabric');
UPDATE product_media SET url = '/img/photos/sq/p-shawl.webp', width = 1024, height = 1024 WHERE url LIKE '/img/placeholders/%' AND kind = 'image' AND product_id = (SELECT id FROM products WHERE slug = 'winter-wool-shawl');
UPDATE product_media SET url = '/img/photos/sq/cat-shoes.webp', width = 1024, height = 1024 WHERE url LIKE '/img/placeholders/%' AND kind = 'image' AND product_id = (SELECT id FROM products WHERE slug = 'mens-leather-loafer');
UPDATE product_media SET url = '/img/photos/sq/cat-gadgets.webp', width = 1024, height = 1024 WHERE url LIKE '/img/placeholders/%' AND kind = 'image' AND product_id = (SELECT id FROM products WHERE slug = 'smart-watch-basic');
UPDATE product_media SET url = '/img/photos/sq/cat-packaging.webp', width = 1024, height = 1024 WHERE url LIKE '/img/placeholders/%' AND kind = 'image' AND product_id = (SELECT id FROM products WHERE slug = 'kraft-food-pouch');

-- Banners: full-width photos ("wide") fill the banner; square photos sit on its right half.
UPDATE seasons SET banners = replace(replace(banners, '"image":"/img/placeholders/gur.svg"', '"image":"/img/photos/wide/hero-winter-gur.webp","wide":true'), '"image":"/img/placeholders/shawl.svg"', '"image":"/img/photos/sq/banner-winter-wear.webp"') WHERE slug = 'winter';
UPDATE settings SET value = replace(replace(value, '"image":"/img/placeholders/masala.svg"', '"image":"/img/photos/sq/banner-pantry.webp"'), '"image":"/img/placeholders/press.svg"', '"image":"/img/photos/wide/hero-food-business.webp","wide":true') WHERE key = 'default_banners';
UPDATE settings SET value = replace(value, '"image":"/img/placeholders/masala.svg"', '"image":"/img/photos/sq/banner-street-food.webp"') WHERE key = 'promo_banner';

-- Refresh every cached page so the new pictures show (the next scheduled run sends it to the edge cache).
INSERT INTO cache_purges (tag) VALUES ('site') ON CONFLICT(tag) DO NOTHING;
