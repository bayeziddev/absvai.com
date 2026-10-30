/** Admin catalog writes and reads: option types, templates, three-level categories, products, media, claims, CSV import. */
import type { ProductTemplate } from '../lib/templates';

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
export type Row = Record<string, unknown>;

// ───────────── Attribute (option) types ─────────────

export async function listAttributeTypes(db: D1Database) {
  const [types, values] = await db.batch([
    db.prepare('SELECT * FROM attribute_types ORDER BY name'),
    db.prepare('SELECT * FROM attribute_values ORDER BY sort_order, id'),
  ]);
  const vals = values.results as Array<{ attribute_type_id: string; value: string; swatch_hex: string | null }>;
  return (types.results as Row[]).map(t => ({ ...t, values: vals.filter(v => v.attribute_type_id === t.id).map(v => ({ value: v.value, hex: v.swatch_hex })) }));
}

export async function attributeTypeIds(db: D1Database): Promise<Set<string>> {
  return new Set((await db.prepare('SELECT id FROM attribute_types').all<{ id: string }>()).results.map(r => r.id));
}

export async function createAttributeType(db: D1Database, a: { id: string; name: string; input: string; helpText: string | null }): Promise<void> {
  await db.prepare('INSERT INTO attribute_types (id, name, input, help_text) VALUES (?, ?, ?, ?)').bind(a.id, a.name, a.input, a.helpText).run();
}

export async function updateAttributeType(db: D1Database, id: string, a: { name: string | null; input: string | null; helpText: string | null }): Promise<boolean> {
  const r = await db.prepare('UPDATE attribute_types SET name = COALESCE(?, name), input = COALESCE(?, input), help_text = ? WHERE id = ?').bind(a.name, a.input, a.helpText, id).run();
  return (r.meta.changes ?? 0) > 0;
}

export async function replaceAttributeValues(db: D1Database, typeId: string, values: Array<{ value: string; hex: string | null }>): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM attribute_values WHERE attribute_type_id = ?').bind(typeId),
    ...values.map((v, i) => db.prepare('INSERT OR IGNORE INTO attribute_values (attribute_type_id, value, swatch_hex, sort_order) VALUES (?, ?, ?, ?)').bind(typeId, v.value, v.hex, i)),
  ]);
}

// ───────────── Templates ─────────────

export async function listTemplates(db: D1Database) {
  return (await db.prepare(
    `SELECT t.*, (SELECT COUNT(*) FROM categories c WHERE c.template_id = t.id AND c.deleted_at IS NULL) AS category_count,
            (SELECT COUNT(*) FROM products p WHERE p.template_id = t.id AND p.deleted_at IS NULL) AS product_count
       FROM product_templates t ORDER BY t.status, t.name`,
  ).all()).results;
}

export async function templateStatus(db: D1Database, id: string): Promise<string | null> {
  return (await db.prepare('SELECT status FROM product_templates WHERE id = ?').bind(id).first<{ status: string }>())?.status ?? null;
}

export async function writeTemplate(db: D1Database, t: Omit<ProductTemplate, 'status'>, isNew: boolean): Promise<void> {
  const head = isNew
    ? db.prepare(`INSERT INTO product_templates (id, name, explanation, default_shipping_profile, allowed_fulfilment, requires_size_chart, size_chart_columns, requires_brand, requires_net_quantity, card_key_specs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(t.id, t.name, t.explanation, t.defaultShippingProfile, JSON.stringify(t.allowedFulfilment), t.requiresSizeChart ? 1 : 0, JSON.stringify(t.sizeChartColumns), t.requiresBrand ? 1 : 0, t.requiresNetQuantity ? 1 : 0, JSON.stringify(t.cardKeySpecs))
    : db.prepare(`UPDATE product_templates SET name = ?, explanation = ?, default_shipping_profile = ?, allowed_fulfilment = ?, requires_size_chart = ?, size_chart_columns = ?, requires_brand = ?, requires_net_quantity = ?, card_key_specs = ?, updated_at = ${NOW} WHERE id = ?`)
      .bind(t.name, t.explanation, t.defaultShippingProfile, JSON.stringify(t.allowedFulfilment), t.requiresSizeChart ? 1 : 0, JSON.stringify(t.sizeChartColumns), t.requiresBrand ? 1 : 0, t.requiresNetQuantity ? 1 : 0, JSON.stringify(t.cardKeySpecs), t.id);
  const stmts = [head, db.prepare('DELETE FROM template_variant_attributes WHERE template_id = ?').bind(t.id), db.prepare('DELETE FROM template_spec_fields WHERE template_id = ?').bind(t.id)];
  t.variantAttributes.forEach((a, i) => stmts.push(db.prepare('INSERT INTO template_variant_attributes (template_id, attribute_type_id, label, required, preset_values, allow_custom_values, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(t.id, a.attributeTypeId, a.label || null, a.required ? 1 : 0, JSON.stringify(a.presetValues), a.allowCustomValues ? 1 : 0, i)));
  t.specFields.forEach((f, i) => stmts.push(db.prepare(`INSERT INTO template_spec_fields (template_id, key, label, type, unit, required, help_text, placeholder, options, panel, show_on_product_page, can_become_variant, filterable, card_format, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(t.id, f.key, f.label, f.type, f.unit ?? null, f.required ? 1 : 0, f.helpText ?? null, f.placeholder ?? null, f.options ? JSON.stringify(f.options) : null, f.panel, f.showOnProductPage ? 1 : 0, f.canBecomeVariant ? 1 : 0, f.filterable ? 1 : 0, f.cardFormat ?? null, i)));
  await db.batch(stmts);
}

export async function setTemplateStatus(db: D1Database, id: string, status: 'active' | 'retired'): Promise<boolean> {
  const r = await db.prepare(`UPDATE product_templates SET status = ?, updated_at = ${NOW} WHERE id = ?`).bind(status, id).run();
  return (r.meta.changes ?? 0) > 0;
}

export async function templateUsage(db: D1Database, id: string): Promise<number> {
  return Number((await db.prepare('SELECT (SELECT COUNT(*) FROM categories WHERE template_id = ?) + (SELECT COUNT(*) FROM products WHERE template_id = ?) AS n').bind(id, id).first<{ n: number }>())?.n ?? 0);
}

export async function deleteTemplate(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM product_templates WHERE id = ?').bind(id).run();
}

export async function productIdsWithTemplate(db: D1Database, templateId: string): Promise<number[]> {
  return (await db.prepare('SELECT id FROM products WHERE template_id = ? AND deleted_at IS NULL').bind(templateId).all<{ id: number }>()).results.map(r => r.id);
}

// ───────────── Categories (three levels) ─────────────

export interface CategoryRow { id: number; parent_id: number | null; depth: number; template_id: string | null; name: string; slug: string; sort_order: number }

/** All live categories, for validating moves (depth ≤ 3, no cycles) and resolving inherited templates. */
export async function categoryRows(db: D1Database): Promise<CategoryRow[]> {
  return (await db.prepare('SELECT id, parent_id, depth, template_id, name, slug, sort_order FROM categories WHERE deleted_at IS NULL').all<CategoryRow>()).results;
}

export async function listCategories(db: D1Database) {
  const [cats, links] = await db.batch([
    db.prepare(`SELECT c.*, t.name AS template_name, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.deleted_at IS NULL) AS product_count
                  FROM categories c LEFT JOIN product_templates t ON t.id = c.template_id WHERE c.deleted_at IS NULL ORDER BY c.depth, c.sort_order, c.name`),
    db.prepare('SELECT category_id, season_id FROM category_seasons'),
  ]);
  const l = links.results as Array<{ category_id: number; season_id: number }>;
  return (cats.results as Row[]).map((x): Row & { season_ids: number[] } => ({ ...x, season_ids: l.filter(y => y.category_id === x.id).map(y => y.season_id) }));
}

export async function liveProductCount(db: D1Database, categoryIds: number[]): Promise<number> {
  if (!categoryIds.length) return 0;
  return Number((await db.prepare(`SELECT COUNT(*) AS n FROM products WHERE category_id IN (${categoryIds.map(() => '?').join(',')}) AND status != 'draft' AND deleted_at IS NULL`)
    .bind(...categoryIds).first<{ n: number }>())?.n ?? 0);
}

export interface CategoryInput { slug: string; name: string; code: string; parentId: number | null; depth: number; templateId: string | null; iconUrl: string | null; description: string | null; seasonVisibility: string; isActive: boolean; sortOrder: number; metaTitle: string | null; metaDescription: string | null }

export async function saveCategory(db: D1Database, id: number | null, c: CategoryInput): Promise<number> {
  const vals = [c.slug, c.name, c.code, c.parentId, c.depth, c.templateId, c.iconUrl, c.description, c.seasonVisibility, c.isActive ? 1 : 0, c.sortOrder, c.metaTitle, c.metaDescription];
  if (id) {
    await db.prepare(`UPDATE categories SET slug = ?, name = ?, code = ?, parent_id = ?, depth = ?, template_id = ?, icon_url = ?, description = ?, season_visibility = ?, is_active = ?, sort_order = ?, meta_title = ?, meta_description = ?, updated_at = ${NOW} WHERE id = ?`).bind(...vals, id).run();
    return id;
  }
  const r = await db.prepare('INSERT INTO categories (slug, name, code, parent_id, depth, template_id, icon_url, description, season_visibility, is_active, sort_order, meta_title, meta_description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id').bind(...vals).first<{ id: number }>();
  return r!.id;
}

/** Category seasons, and draft products in categories whose effective template changed. */
export async function afterCategorySave(db: D1Database, catId: number, seasonIds: number[], draftTemplateUpdates: Array<{ categoryId: number; templateId: string }>): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM category_seasons WHERE category_id = ?').bind(catId),
    ...seasonIds.map(s => db.prepare('INSERT OR IGNORE INTO category_seasons (category_id, season_id) VALUES (?, ?)').bind(catId, s)),
    ...draftTemplateUpdates.map(u => db.prepare("UPDATE products SET template_id = ? WHERE category_id = ? AND status = 'draft'").bind(u.templateId, u.categoryId)),
  ]);
}

/** Drag-and-drop result: new parent, order and depth for every moved category, in one batch. */
export async function applyCategoryOrder(db: D1Database, items: Array<{ id: number; parentId: number | null; sortOrder: number; depth: number }>): Promise<void> {
  await db.batch(items.map(i => db.prepare(`UPDATE categories SET parent_id = ?, sort_order = ?, depth = ?, updated_at = ${NOW} WHERE id = ? AND deleted_at IS NULL`).bind(i.parentId, i.sortOrder, i.depth, i.id)));
}

export async function categoryBlockers(db: D1Database, id: number): Promise<number> {
  return Number((await db.prepare('SELECT (SELECT COUNT(*) FROM products WHERE category_id = ? AND deleted_at IS NULL) + (SELECT COUNT(*) FROM categories WHERE parent_id = ? AND deleted_at IS NULL) AS n').bind(id, id).first<{ n: number }>())?.n ?? 0);
}

export async function softDeleteCategory(db: D1Database, id: number): Promise<void> {
  await db.prepare(`UPDATE categories SET deleted_at = ${NOW}, slug = slug || '-deleted-' || id WHERE id = ?`).bind(id).run();
}

export async function categoryCode(db: D1Database, id: number): Promise<string | null> {
  return (await db.prepare('SELECT code FROM categories WHERE id = ?').bind(id).first<{ code: string }>())?.code ?? null;
}

// ───────────── Products ─────────────

export async function listAdminProducts(db: D1Database, f: { status?: string; categoryIds?: number[]; q?: string; page: number }) {
  const where = ['p.deleted_at IS NULL'];
  const params: unknown[] = [];
  if (f.status) { where.push('p.status = ?'); params.push(f.status); }
  if (f.categoryIds?.length) { where.push(`p.category_id IN (${f.categoryIds.map(() => '?').join(',')})`); params.push(...f.categoryIds); }
  if (f.q) {
    const like = `%${f.q.replace(/[\\%_]/g, m => `\\${m}`)}%`;
    where.push("(p.name LIKE ? ESCAPE '\\' OR p.slug LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND (v.sku LIKE ? ESCAPE '\\' OR v.gtin = ?)))");
    params.push(like, like, like, f.q);
  }
  return (await db.prepare(
    `SELECT p.id, p.name, p.slug, p.status, p.publish_at, p.updated_at, p.fulfilment_mode, p.is_original, p.show_on_home, c.name AS category_name, t.name AS template_name,
            (SELECT MIN(price_paisa) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1) AS min_price,
            (SELECT SUM(stock - reserved) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1) AS stock,
            (SELECT COUNT(*) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1) AS variant_count,
            (SELECT url FROM product_media m WHERE m.product_id = p.id AND m.kind = 'image' ORDER BY m.sort_order, m.id LIMIT 1) AS image_url
       FROM products p JOIN categories c ON c.id = p.category_id JOIN product_templates t ON t.id = p.template_id
      WHERE ${where.join(' AND ')} ORDER BY p.updated_at DESC LIMIT 50 OFFSET ${(f.page - 1) * 50}`,
  ).bind(...params).all()).results;
}

export async function adminProductRows(db: D1Database, id: number) {
  const p = await db.prepare('SELECT p.*, c.code AS category_code, c.name AS category_name FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id = ? AND p.deleted_at IS NULL').bind(id).first<Row>();
  if (!p) return null;
  const [variants, specs, media, seasons, claims] = await db.batch([
    db.prepare('SELECT * FROM product_variants WHERE product_id = ? ORDER BY is_active DESC, sort_order, id').bind(id),
    db.prepare('SELECT field_key, value FROM product_spec_values WHERE product_id = ?').bind(id),
    db.prepare('SELECT * FROM product_media WHERE product_id = ? ORDER BY sort_order, id').bind(id),
    db.prepare('SELECT season_id FROM product_seasons WHERE product_id = ?').bind(id),
    db.prepare('SELECT claim, document_media_id FROM product_claims WHERE product_id = ?').bind(id),
  ]);
  return {
    product: p, variants: variants.results as Row[],
    specs: Object.fromEntries((specs.results as Array<{ field_key: string; value: string }>).map(s => [s.field_key, s.value])),
    media: media.results as Row[], seasonIds: (seasons.results as Array<{ season_id: number }>).map(s => s.season_id), claims: claims.results as Row[],
  };
}

export async function productBySlug(db: D1Database, slug: string): Promise<number | null> {
  return (await db.prepare('SELECT id FROM products WHERE slug = ?').bind(slug).first<{ id: number }>())?.id ?? null;
}

export async function productRow(db: D1Database, id: number): Promise<Row | null> {
  return db.prepare('SELECT * FROM products WHERE id = ? AND deleted_at IS NULL').bind(id).first<Row>();
}

export async function categoryRow(db: D1Database, id: number): Promise<Row | null> {
  return db.prepare('SELECT * FROM categories WHERE id = ? AND deleted_at IS NULL').bind(id).first<Row>();
}

export async function insertProduct(db: D1Database, p: { slug: string; categoryId: number; templateId: string; name: string; code: string; shippingProfile: string; brand: string | null; isOriginal: boolean; shortDescription?: string | null; description?: string | null }): Promise<number> {
  const r = await db.prepare('INSERT INTO products (slug, category_id, template_id, name, code, shipping_profile, brand, is_original, short_description, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id')
    .bind(p.slug, p.categoryId, p.templateId, p.name, p.code, p.shippingProfile, p.brand, p.isOriginal ? 1 : 0, p.shortDescription ?? null, p.description ?? null).first<{ id: number }>();
  return r!.id;
}

export async function variantsOfProduct(db: D1Database, productId: number): Promise<Array<{ id: number; sku: string; stock: number; reserved: number; cost_paisa: number | null }>> {
  return (await db.prepare('SELECT id, sku, stock, reserved, cost_paisa FROM product_variants WHERE product_id = ?').bind(productId).all<{ id: number; sku: string; stock: number; reserved: number; cost_paisa: number | null }>()).results;
}

export async function skusTakenElsewhere(db: D1Database, skus: string[], productId: number): Promise<string[]> {
  if (!skus.length) return [];
  return (await db.prepare(`SELECT sku FROM product_variants WHERE sku IN (${skus.map(() => '?').join(',')}) AND product_id != ?`).bind(...skus, productId).all<{ sku: string }>()).results.map(r => r.sku);
}

export async function gtinsTakenElsewhere(db: D1Database, gtins: string[], productId: number): Promise<string[]> {
  if (!gtins.length) return [];
  return (await db.prepare(`SELECT gtin FROM product_variants WHERE gtin IN (${gtins.map(() => '?').join(',')}) AND product_id != ?`).bind(...gtins, productId).all<{ gtin: string }>()).results.map(r => r.gtin);
}

export async function imageCount(db: D1Database, productId: number): Promise<number> {
  return Number((await db.prepare("SELECT COUNT(*) AS n FROM product_media WHERE product_id = ? AND kind = 'image'").bind(productId).first<{ n: number }>())?.n ?? 0);
}

export interface VariantWrite {
  id: number | null; sku: string; attributes: Record<string, string>; attributesKey: string; pricePaisa: number; compareAtPricePaisa: number | null; costPaisa: number | null;
  wholesaleTiers: unknown[]; stock: number; packedWeightGrams: number; netValue: number | null; netUnit: string | null; imageIds: number[]; isActive: boolean; sortOrder: number;
  gtin: string | null; shelfLocation: string | null;
  /** Stock edits in the form are recorded as count corrections in the ledger. */
  stockChange: number;
}

export interface ProductWrite {
  id: number; fields: Record<string, string | number | null>; specs: Record<string, string>; seasonIds: number[];
  variants: VariantWrite[]; removedVariantIds: number[]; adminId: string; batchNo: string | null;
}

const PRODUCT_COLUMNS = ['category_id', 'template_id', 'name', 'slug', 'code', 'short_description', 'description', 'brand', 'is_original', 'show_on_home', 'benefit_chips',
  'fulfilment_mode', 'preorder_dispatch_date', 'preorder_advance_type', 'preorder_advance_paisa', 'made_to_order_lead_days', 'shipping_profile', 'bulky_delivery_mode',
  'free_delivery', 'video_url', 'promoted_spec_keys', 'size_chart', 'search_keywords', 'meta_title', 'meta_description'];

/** Saves the whole smart-upload form in one batch. Variants that orders reference are retired, never deleted. */
export async function saveProduct(db: D1Database, w: ProductWrite): Promise<void> {
  const cols = PRODUCT_COLUMNS.filter(c => c in w.fields);
  const stmts: D1PreparedStatement[] = [
    db.prepare(`UPDATE products SET ${cols.map(c => `${c} = ?`).join(', ')}, updated_at = ${NOW} WHERE id = ?`).bind(...cols.map(c => w.fields[c]), w.id),
    db.prepare('DELETE FROM product_spec_values WHERE product_id = ?').bind(w.id),
    ...Object.entries(w.specs).map(([k, v]) => db.prepare('INSERT INTO product_spec_values (product_id, field_key, value) VALUES (?, ?, ?)').bind(w.id, k, v)),
    db.prepare('DELETE FROM product_seasons WHERE product_id = ?').bind(w.id),
    ...w.seasonIds.map(s => db.prepare('INSERT OR IGNORE INTO product_seasons (product_id, season_id) VALUES (?, ?)').bind(w.id, s)),
  ];
  for (const oldId of w.removedVariantIds) {
    stmts.push(db.prepare(`UPDATE product_variants SET is_active = 0, sku = sku || '-RETIRED-' || id, gtin = NULL, attributes_key = attributes_key || '#' || id, updated_at = ${NOW} WHERE id = ? AND EXISTS (SELECT 1 FROM order_items WHERE variant_id = ?)`).bind(oldId, oldId));
    // Never sold or adjusted: drop its opening-stock movement first (foreign key), then the option itself.
    const unused = "NOT EXISTS (SELECT 1 FROM order_items WHERE variant_id = ?) AND NOT EXISTS (SELECT 1 FROM stock_movements WHERE variant_id = ? AND kind != 'initial')";
    stmts.push(db.prepare(`DELETE FROM stock_movements WHERE variant_id = ? AND kind = 'initial' AND ${unused}`).bind(oldId, oldId, oldId));
    stmts.push(db.prepare(`DELETE FROM product_variants WHERE id = ? AND ${unused}`).bind(oldId, oldId, oldId));
  }
  for (const v of w.variants) {
    const vals = [v.sku, JSON.stringify(v.attributes), v.attributesKey, v.pricePaisa, v.compareAtPricePaisa, v.costPaisa, JSON.stringify(v.wholesaleTiers), v.stock, v.packedWeightGrams, v.netValue, v.netUnit, JSON.stringify(v.imageIds), v.isActive ? 1 : 0, v.sortOrder, v.gtin, v.shelfLocation];
    if (v.id) {
      stmts.push(db.prepare(`UPDATE product_variants SET sku = ?, attributes = ?, attributes_key = ?, price_paisa = ?, compare_at_price_paisa = ?, cost_paisa = ?, wholesale_tiers = ?, stock = ?, packed_weight_grams = ?, net_value = ?, net_unit = ?, image_ids = ?, is_active = ?, sort_order = ?, gtin = ?, shelf_location = ?, updated_at = ${NOW} WHERE id = ?`).bind(...vals, v.id));
      if (v.stockChange) stmts.push(db.prepare("INSERT INTO stock_movements (variant_id, change, kind, reason, note, admin_id) VALUES (?, ?, 'adjustment', 'count_correction', 'Edited in product form', ?)").bind(v.id, v.stockChange, w.adminId));
    } else {
      stmts.push(db.prepare('INSERT INTO product_variants (product_id, sku, attributes, attributes_key, price_paisa, compare_at_price_paisa, cost_paisa, wholesale_tiers, stock, packed_weight_grams, net_value, net_unit, image_ids, is_active, sort_order, gtin, shelf_location) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(w.id, ...vals));
      if (v.stock > 0) stmts.push(db.prepare("INSERT INTO stock_movements (variant_id, change, kind, reason, batch_no, note, admin_id) SELECT id, ?, 'initial', 'received', ?, 'Opening stock', ? FROM product_variants WHERE sku = ?").bind(v.stock, w.batchNo, w.adminId, v.sku));
    }
  }
  await db.batch(stmts);
}

export async function setPublishState(db: D1Database, id: number, status: 'published' | 'scheduled' | 'draft', publishAtIso: string | null): Promise<void> {
  if (status === 'draft') await db.prepare(`UPDATE products SET status = 'draft', publish_at = NULL, updated_at = ${NOW} WHERE id = ?`).bind(id).run();
  else await db.prepare(`UPDATE products SET status = ?, publish_at = ?, published_at = COALESCE(published_at, ?), updated_at = ${NOW} WHERE id = ?`)
    .bind(status, status === 'scheduled' ? publishAtIso : null, publishAtIso ?? new Date().toISOString(), id).run();
}

export async function trashProduct(db: D1Database, id: number): Promise<void> {
  await db.prepare(`UPDATE products SET deleted_at = ${NOW}, status = 'archived', slug = slug || '-trash-' || id WHERE id = ?`).bind(id).run();
}

export async function restoreProduct(db: D1Database, id: number): Promise<void> {
  await db.prepare("UPDATE products SET deleted_at = NULL, status = 'draft', slug = replace(slug, '-trash-' || id, '') WHERE id = ?").bind(id).run();
}

export async function listTrash(db: D1Database) {
  return (await db.prepare('SELECT id, name, deleted_at FROM products WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 100').all()).results;
}

/** Copies everything except SKUs, barcodes and stock. */
export async function duplicateProduct(db: D1Database, id: number, slug: string, newSkus: Map<number, string>): Promise<number> {
  const cols = ['category_id', 'template_id', 'code', 'short_description', 'description', 'brand', 'is_original', 'benefit_chips', 'fulfilment_mode', 'preorder_dispatch_date', 'preorder_advance_type', 'preorder_advance_paisa', 'made_to_order_lead_days', 'shipping_profile', 'bulky_delivery_mode', 'free_delivery', 'video_url', 'promoted_spec_keys', 'size_chart', 'search_keywords'];
  const copy = await db.prepare(`INSERT INTO products (slug, name, ${cols.join(', ')}) SELECT ?, name || ' (copy)', ${cols.join(', ')} FROM products WHERE id = ? RETURNING id`).bind(slug, id).first<{ id: number }>();
  const newId = copy!.id;
  const stmts: D1PreparedStatement[] = [
    db.prepare('INSERT INTO product_spec_values (product_id, field_key, value) SELECT ?, field_key, value FROM product_spec_values WHERE product_id = ?').bind(newId, id),
    db.prepare('INSERT INTO product_seasons (product_id, season_id) SELECT ?, season_id FROM product_seasons WHERE product_id = ?').bind(newId, id),
    db.prepare("INSERT INTO product_media (product_id, kind, r2_key, url, alt, width, height, sort_order) SELECT ?, kind, r2_key, url, alt, width, height, sort_order FROM product_media WHERE product_id = ? AND kind IN ('image','manual','spec_file')").bind(newId, id),
  ];
  for (const [variantId, sku] of newSkus) {
    stmts.push(db.prepare(`INSERT INTO product_variants (product_id, sku, attributes, attributes_key, price_paisa, compare_at_price_paisa, cost_paisa, wholesale_tiers, stock, packed_weight_grams, net_value, net_unit, shelf_location, sort_order)
                            SELECT ?, ?, attributes, attributes_key, price_paisa, compare_at_price_paisa, cost_paisa, wholesale_tiers, 0, packed_weight_grams, net_value, net_unit, shelf_location, sort_order FROM product_variants WHERE id = ?`).bind(newId, sku, variantId));
  }
  await db.batch(stmts);
  return newId;
}

export async function activeVariantsForCopy(db: D1Database, productId: number): Promise<Array<{ id: number; attributes: string }>> {
  return (await db.prepare('SELECT id, attributes FROM product_variants WHERE product_id = ? AND is_active = 1 ORDER BY sort_order').bind(productId).all<{ id: number; attributes: string }>()).results;
}

// ───────────── Media & claims ─────────────

export async function nextMediaSort(db: D1Database, productId: number): Promise<number> {
  return Number((await db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM product_media WHERE product_id = ?').bind(productId).first<{ n: number }>())?.n ?? 0);
}

export async function insertMedia(db: D1Database, m: { productId: number; kind: string; key: string; url: string; alt: string | null; width: number | null; height: number | null; sortOrder: number }) {
  return db.prepare('INSERT INTO product_media (product_id, kind, r2_key, url, alt, width, height, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id, url')
    .bind(m.productId, m.kind, m.key, m.url, m.alt, m.width, m.height, m.sortOrder).first<{ id: number; url: string }>();
}

export async function mediaById(db: D1Database, id: number) {
  return db.prepare('SELECT * FROM product_media WHERE id = ?').bind(id).first<{ id: number; r2_key: string | null; product_id: number }>();
}

export async function mediaSupportsClaim(db: D1Database, id: number): Promise<boolean> {
  return Boolean(await db.prepare('SELECT 1 FROM product_claims WHERE document_media_id = ?').bind(id).first());
}

export async function deleteMedia(db: D1Database, id: number): Promise<void> {
  await db.prepare('DELETE FROM product_media WHERE id = ?').bind(id).run();
}

export async function r2KeyInUse(db: D1Database, key: string): Promise<boolean> {
  return Boolean(await db.prepare('SELECT 1 FROM product_media WHERE r2_key = ?').bind(key).first());
}

export async function reorderMedia(db: D1Database, productId: number, ids: number[]): Promise<void> {
  if (ids.length) await db.batch(ids.map((m, i) => db.prepare('UPDATE product_media SET sort_order = ? WHERE id = ? AND product_id = ?').bind(i, m, productId)));
}

export async function claimDocumentExists(db: D1Database, mediaId: number, productId: number): Promise<boolean> {
  return Boolean(await db.prepare("SELECT id FROM product_media WHERE id = ? AND product_id = ? AND kind = 'claim_doc'").bind(mediaId, productId).first());
}

export async function upsertClaim(db: D1Database, productId: number, claim: string, mediaId: number, adminId: string): Promise<void> {
  await db.prepare('INSERT INTO product_claims (product_id, claim, document_media_id, added_by) VALUES (?, ?, ?, ?) ON CONFLICT(product_id, claim) DO UPDATE SET document_media_id = excluded.document_media_id')
    .bind(productId, claim, mediaId, adminId).run();
}

export async function deleteClaim(db: D1Database, productId: number, claim: string): Promise<void> {
  await db.prepare('DELETE FROM product_claims WHERE product_id = ? AND claim = ?').bind(productId, claim).run();
}

// ───────────── CSV import ─────────────

export async function insertImportedRows(db: D1Database, productId: number, specs: Array<[string, string]>, variants: Array<{ sku: string; attributes: Record<string, string>; attributesKey: string; pricePaisa: number; compareAtPricePaisa: number | null; costPaisa: number | null; stock: number; packedWeightGrams: number; netValue: number | null; netUnit: string | null }>): Promise<void> {
  await db.batch([
    ...specs.map(([k, v]) => db.prepare('INSERT INTO product_spec_values (product_id, field_key, value) VALUES (?, ?, ?)').bind(productId, k, v)),
    ...variants.map((v, i) => db.prepare('INSERT INTO product_variants (product_id, sku, attributes, attributes_key, price_paisa, compare_at_price_paisa, cost_paisa, stock, packed_weight_grams, net_value, net_unit, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(productId, v.sku, JSON.stringify(v.attributes), v.attributesKey, v.pricePaisa, v.compareAtPricePaisa, v.costPaisa, v.stock, v.packedWeightGrams, v.netValue, v.netUnit, i)),
  ]);
}

export async function deleteProductHard(db: D1Database, id: number): Promise<void> {
  await db.prepare('DELETE FROM products WHERE id = ?').bind(id).run();
}
