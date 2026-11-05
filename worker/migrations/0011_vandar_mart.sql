-- The shop is Vandar Mart now (vandarmart.com). Its name lives in one setting (Website & banners → Shop name) and the
-- store, emails, SMS and invoices read it from there. This moves the few places where the old name was stored as data.
-- Only the old name is replaced: anything the owner typed differently is left alone.

UPDATE settings SET value = 'Vandar Mart' WHERE key = 'store_name' AND (value = '' OR value = 'Abs Vai');
UPDATE settings SET value = (SELECT value FROM settings WHERE key = 'store_name') WHERE key = 'company_name' AND value = 'ABS VAI LTD';
UPDATE settings SET value = (SELECT value FROM settings WHERE key = 'store_name') || substr(value, 8) WHERE key = 'email_from' AND value LIKE 'Abs Vai <%';

-- Products, their details and the categories.
UPDATE products SET brand = (SELECT value FROM settings WHERE key = 'store_name') WHERE brand = 'Abs Vai';
UPDATE products SET
  name = replace(name, 'Abs Vai', (SELECT value FROM settings WHERE key = 'store_name')),
  short_description = replace(short_description, 'Abs Vai', (SELECT value FROM settings WHERE key = 'store_name')),
  description = replace(replace(description, 'ABS VAI LTD', (SELECT value FROM settings WHERE key = 'store_name')), 'Abs Vai', (SELECT value FROM settings WHERE key = 'store_name')),
  benefit_chips = replace(benefit_chips, 'Abs Vai', (SELECT value FROM settings WHERE key = 'store_name')),
  meta_title = replace(meta_title, 'Abs Vai', (SELECT value FROM settings WHERE key = 'store_name')),
  meta_description = replace(meta_description, 'Abs Vai', (SELECT value FROM settings WHERE key = 'store_name'))
WHERE (name || coalesce(short_description, '') || coalesce(description, '') || coalesce(benefit_chips, '') || coalesce(meta_title, '') || coalesce(meta_description, '')) LIKE '%abs vai%';
UPDATE product_spec_values SET value = replace(replace(value, 'ABS VAI LTD', (SELECT value FROM settings WHERE key = 'store_name')), 'Abs Vai', (SELECT value FROM settings WHERE key = 'store_name')) WHERE value LIKE '%abs vai%';
UPDATE categories SET description = replace(description, 'Abs Vai', (SELECT value FROM settings WHERE key = 'store_name')) WHERE description LIKE '%Abs Vai%';

-- "Who honours the warranty": the shop's own name instead of the old one.
UPDATE template_spec_fields SET options = replace(options, '"Abs Vai"', '"' || (SELECT value FROM settings WHERE key = 'store_name') || '"') WHERE options LIKE '%"Abs Vai"%';
UPDATE template_spec_fields SET placeholder = replace(placeholder, 'ABS VAI LTD', (SELECT value FROM settings WHERE key = 'store_name')) WHERE placeholder LIKE '%ABS VAI LTD%';

-- Every cached page is rebuilt with the new name.
INSERT INTO cache_purges (tag) VALUES ('site') ON CONFLICT(tag) DO NOTHING;
