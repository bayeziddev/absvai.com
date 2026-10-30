/** Admin catalog: templates, attribute types, categories, products (smart upload form), media, claims and CSV. */
import { Hono, type Context } from 'hono';
import type { AppEnv } from '../env';
import { clearTemplateCache, getSeasons, rowToVariant } from '../data/catalog';
import { bumpCatalogVersion } from '../data/settings';
import { CLAIM_BADGES, healthClaimIn } from '../lib/claims';
import { bad, HttpError, int, notFound, parseJson, posInt, readJson, slugify, str } from '../lib/http';
import { nextSkuSequence } from '../lib/numbering';
import { attributesKey, formatSku, productCodeFromName, SKU_PATTERN, variantCode } from '../lib/sku';
import { effectiveSpecFields, effectiveVariantAttributes, loadTemplate, parseNetQuantity, publishChecklist, validateSpecValue, type ProductTemplate } from '../lib/templates';
import { audit, need } from './admin-helpers';

export const adminCatalog = new Hono<AppEnv>();

const SPEC_TYPES = ['text', 'longtext', 'number', 'date', 'select', 'dimensions', 'file', 'boolean'];
const PROFILES = ['standard', 'fragile', 'heavy_bulky', 'perishable'];
const FULFILMENT = ['in_stock', 'pre_order', 'made_to_order'];
const KEY = /^[a-z][a-z0-9_]{1,40}$/;

async function changed(c: Context<AppEnv>) {
  clearTemplateCache();
  await bumpCatalogVersion(c.env.DB);
}

// ───────────── Attribute types ─────────────

adminCatalog.get('/attribute-types', need('catalog:read'), async c => {
  const [types, values] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT * FROM attribute_types ORDER BY name'),
    c.env.DB.prepare('SELECT * FROM attribute_values ORDER BY sort_order, id'),
  ]);
  const vals = values.results as Array<{ attribute_type_id: string; value: string; swatch_hex: string | null }>;
  return c.json((types.results as Array<Record<string, unknown>>).map(t => ({ ...t, values: vals.filter(v => v.attribute_type_id === t.id).map(v => ({ value: v.value, hex: v.swatch_hex })) })));
});

async function saveAttributeValues(db: D1Database, typeId: string, values: unknown) {
  if (!Array.isArray(values)) return;
  const stmts = [db.prepare('DELETE FROM attribute_values WHERE attribute_type_id = ?').bind(typeId)];
  values.slice(0, 100).forEach((v, i) => {
    const value = str(typeof v === 'string' ? v : (v as { value?: string })?.value, 60);
    const hex = typeof v === 'object' && v ? str((v as { hex?: string }).hex, 7) : '';
    if (value) stmts.push(db.prepare('INSERT OR IGNORE INTO attribute_values (attribute_type_id, value, swatch_hex, sort_order) VALUES (?, ?, ?, ?)').bind(typeId, value, /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : null, i));
  });
  await db.batch(stmts);
}

adminCatalog.post('/attribute-types', need('catalog:write'), async c => {
  const b = await readJson(c);
  const id = str(b.id, 40) || slugify(str(b.name, 60)).replace(/-/g, '_');
  if (!KEY.test(id)) throw bad('Use a short ID like "grade" (lowercase letters and underscores).');
  if (!str(b.name, 60)) throw bad('Give the option a name, e.g. "Grade".');
  const input = ['chips', 'swatch', 'select'].includes(String(b.input)) ? String(b.input) : 'chips';
  try {
    await c.env.DB.prepare('INSERT INTO attribute_types (id, name, input, help_text) VALUES (?, ?, ?, ?)').bind(id, str(b.name, 60), input, str(b.helpText, 200) || null).run();
  } catch { throw bad('An option type with that ID already exists.'); }
  await saveAttributeValues(c.env.DB, id, b.values);
  await audit(c, 'attribute_type.create', 'attribute_type', id);
  await changed(c);
  return c.json({ id }, 201);
});

adminCatalog.put('/attribute-types/:id', need('catalog:write'), async c => {
  const b = await readJson(c);
  const id = c.req.param('id');
  const r = await c.env.DB.prepare('UPDATE attribute_types SET name = COALESCE(?, name), input = COALESCE(?, input), help_text = ? WHERE id = ?')
    .bind(str(b.name, 60) || null, ['chips', 'swatch', 'select'].includes(String(b.input)) ? String(b.input) : null, str(b.helpText, 200) || null, id).run();
  if (!r.meta.changes) throw notFound();
  await saveAttributeValues(c.env.DB, id, b.values);
  await audit(c, 'attribute_type.update', 'attribute_type', id);
  await changed(c);
  return c.json({ ok: true });
});

// ───────────── Templates (data, not code) ─────────────

adminCatalog.get('/templates', need('catalog:read'), async c => {
  const r = await c.env.DB.prepare(
    `SELECT t.*, (SELECT COUNT(*) FROM categories c WHERE c.template_id = t.id AND c.deleted_at IS NULL) AS category_count,
            (SELECT COUNT(*) FROM products p WHERE p.template_id = t.id AND p.deleted_at IS NULL) AS product_count
       FROM product_templates t ORDER BY t.status, t.name`,
  ).all();
  return c.json(r.results);
});

adminCatalog.get('/templates/:id', need('catalog:read'), async c => {
  const t = await loadTemplate(c.env.DB, c.req.param('id'));
  if (!t) throw notFound();
  return c.json(t);
});

function parseTemplateBody(b: Record<string, unknown>): Omit<ProductTemplate, 'status'> {
  const id = str(b.id, 40);
  if (!KEY.test(id)) throw bad('Template ID must be lowercase letters, numbers and underscores, e.g. fresh_produce.');
  const name = str(b.name, 80);
  if (!name) throw bad('Give the template a name.');
  const profile = str(b.defaultShippingProfile);
  if (!PROFILES.includes(profile)) throw bad('Choose a shipping profile.');
  const fulfilment = Array.isArray(b.allowedFulfilment) ? (b.allowedFulfilment as string[]).filter(f => FULFILMENT.includes(f)) : [];
  if (!fulfilment.length) throw bad('Allow at least one fulfilment mode.');
  const attrs = Array.isArray(b.variantAttributes) ? (b.variantAttributes as Array<Record<string, unknown>>) : [];
  const fields = Array.isArray(b.specFields) ? (b.specFields as Array<Record<string, unknown>>) : [];
  const seen = new Set<string>();
  const specFields = fields.map(f => {
    const key = str(f.key, 40) || slugify(str(f.label, 60)).replace(/-/g, '_');
    if (!KEY.test(key)) throw bad(`Field "${str(f.label)}" needs a key of lowercase letters and underscores.`);
    if (seen.has(key)) throw bad(`Two fields use the key "${key}".`);
    seen.add(key);
    const type = str(f.type);
    if (!SPEC_TYPES.includes(type)) throw bad(`Field "${key}" has an unknown type.`);
    const options = type === 'select' ? (Array.isArray(f.options) ? (f.options as unknown[]).map(o => str(o, 60)).filter(Boolean) : []) : null;
    if (type === 'select' && !options?.length) throw bad(`Field "${key}" is a list: add the choices.`);
    return {
      key, label: str(f.label, 80) || key, type: type as ProductTemplate['specFields'][number]['type'], unit: str(f.unit, 12) || null, required: Boolean(f.required),
      helpText: str(f.helpText, 200) || null, placeholder: str(f.placeholder, 120) || null, options, panel: str(f.panel, 20) || 'details',
      showOnProductPage: f.showOnProductPage !== false, canBecomeVariant: Boolean(f.canBecomeVariant), filterable: Boolean(f.filterable), cardFormat: str(f.cardFormat, 60) || null,
    };
  });
  const attrIds = new Set<string>();
  return {
    id, name, explanation: str(b.explanation, 200) || `${name} products.`,
    variantAttributes: attrs.map(a => {
      const aid = str(a.attributeTypeId, 40);
      if (attrIds.has(aid)) throw bad('Each option type can only be added once.');
      attrIds.add(aid);
      return { attributeTypeId: aid, label: str(a.label, 60), required: Boolean(a.required), presetValues: Array.isArray(a.presetValues) ? (a.presetValues as unknown[]).map(v => str(v, 60)).filter(Boolean) : [], allowCustomValues: a.allowCustomValues !== false, input: 'chips' as const };
    }),
    specFields,
    defaultShippingProfile: profile as ProductTemplate['defaultShippingProfile'],
    allowedFulfilment: fulfilment as ProductTemplate['allowedFulfilment'],
    requiresSizeChart: Boolean(b.requiresSizeChart),
    sizeChartColumns: Array.isArray(b.sizeChartColumns) ? (b.sizeChartColumns as unknown[]).map(x => str(x, 40)).filter(Boolean) : [],
    requiresBrand: Boolean(b.requiresBrand),
    requiresNetQuantity: Boolean(b.requiresNetQuantity),
    cardKeySpecs: Array.isArray(b.cardKeySpecs) ? (b.cardKeySpecs as unknown[]).map(x => str(x, 60)).filter(Boolean).slice(0, 3) : [],
  };
}

async function writeTemplate(db: D1Database, t: Omit<ProductTemplate, 'status'>, isNew: boolean) {
  const known = await db.prepare('SELECT id FROM attribute_types').all<{ id: string }>();
  const ids = new Set(known.results.map(r => r.id));
  for (const a of t.variantAttributes) if (!ids.has(a.attributeTypeId)) throw bad(`Unknown option type "${a.attributeTypeId}". Create it under Attribute Types first.`);
  const head = isNew
    ? db.prepare(`INSERT INTO product_templates (id, name, explanation, default_shipping_profile, allowed_fulfilment, requires_size_chart, size_chart_columns, requires_brand, requires_net_quantity, card_key_specs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(t.id, t.name, t.explanation, t.defaultShippingProfile, JSON.stringify(t.allowedFulfilment), t.requiresSizeChart ? 1 : 0, JSON.stringify(t.sizeChartColumns), t.requiresBrand ? 1 : 0, t.requiresNetQuantity ? 1 : 0, JSON.stringify(t.cardKeySpecs))
    : db.prepare(`UPDATE product_templates SET name = ?, explanation = ?, default_shipping_profile = ?, allowed_fulfilment = ?, requires_size_chart = ?, size_chart_columns = ?, requires_brand = ?, requires_net_quantity = ?, card_key_specs = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`)
      .bind(t.name, t.explanation, t.defaultShippingProfile, JSON.stringify(t.allowedFulfilment), t.requiresSizeChart ? 1 : 0, JSON.stringify(t.sizeChartColumns), t.requiresBrand ? 1 : 0, t.requiresNetQuantity ? 1 : 0, JSON.stringify(t.cardKeySpecs), t.id);
  const stmts = [head, db.prepare('DELETE FROM template_variant_attributes WHERE template_id = ?').bind(t.id), db.prepare('DELETE FROM template_spec_fields WHERE template_id = ?').bind(t.id)];
  t.variantAttributes.forEach((a, i) => stmts.push(db.prepare('INSERT INTO template_variant_attributes (template_id, attribute_type_id, label, required, preset_values, allow_custom_values, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(t.id, a.attributeTypeId, a.label || null, a.required ? 1 : 0, JSON.stringify(a.presetValues), a.allowCustomValues ? 1 : 0, i)));
  t.specFields.forEach((f, i) => stmts.push(db.prepare(`INSERT INTO template_spec_fields (template_id, key, label, type, unit, required, help_text, placeholder, options, panel, show_on_product_page, can_become_variant, filterable, card_format, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(t.id, f.key, f.label, f.type, f.unit ?? null, f.required ? 1 : 0, f.helpText ?? null, f.placeholder ?? null, f.options ? JSON.stringify(f.options) : null, f.panel, f.showOnProductPage ? 1 : 0, f.canBecomeVariant ? 1 : 0, f.filterable ? 1 : 0, f.cardFormat ?? null, i)));
  await db.batch(stmts);
}

adminCatalog.post('/templates', need('catalog:write'), async c => {
  const t = parseTemplateBody(await readJson(c));
  if (await c.env.DB.prepare('SELECT 1 FROM product_templates WHERE id = ?').bind(t.id).first()) throw bad('A template with that ID already exists.');
  await writeTemplate(c.env.DB, t, true);
  await audit(c, 'template.create', 'template', t.id);
  await changed(c);
  return c.json({ id: t.id }, 201);
});

adminCatalog.put('/templates/:id', need('catalog:write'), async c => {
  const t = parseTemplateBody({ ...(await readJson(c)), id: c.req.param('id') });
  if (!(await c.env.DB.prepare('SELECT 1 FROM product_templates WHERE id = ?').bind(t.id).first())) throw notFound();
  await writeTemplate(c.env.DB, t, false);
  await audit(c, 'template.update', 'template', t.id);
  await changed(c);
  return c.json({ ok: true });
});

/** A template in use can't be deleted, only retired (no new categories can choose it). */
adminCatalog.post('/templates/:id/retire', need('catalog:write'), async c => {
  const r = await c.env.DB.prepare("UPDATE product_templates SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").bind((await readJson(c)).restore ? 'active' : 'retired', c.req.param('id')).run();
  if (!r.meta.changes) throw notFound();
  await audit(c, 'template.retire', 'template', c.req.param('id'));
  await changed(c);
  return c.json({ ok: true });
});

adminCatalog.delete('/templates/:id', need('catalog:write'), async c => {
  const id = c.req.param('id');
  const used = await c.env.DB.prepare('SELECT (SELECT COUNT(*) FROM categories WHERE template_id = ?) + (SELECT COUNT(*) FROM products WHERE template_id = ?) AS n').bind(id, id).first<{ n: number }>();
  if ((used?.n ?? 0) > 0) throw new HttpError(409, 'This template is used by categories or products. Retire it instead.');
  await c.env.DB.prepare('DELETE FROM product_templates WHERE id = ?').bind(id).run();
  await audit(c, 'template.delete', 'template', id);
  await changed(c);
  return c.json({ ok: true });
});

/** One CSV layout per template so the columns always match the upload form. */
adminCatalog.get('/templates/:id/csv', need('catalog:read'), async c => {
  const t = await loadTemplate(c.env.DB, c.req.param('id'));
  if (!t) throw notFound();
  const cols = csvColumns(t);
  const example = cols.map(col => {
    if (col === 'product_name') return 'Example product';
    if (col === 'price_taka') return '1200';
    if (col === 'stock') return '10';
    if (col === 'packed_weight_grams') return '900';
    const a = t.variantAttributes.find(x => `option_${x.attributeTypeId}` === col);
    if (a) return a.presetValues[0] ?? '';
    const f = t.specFields.find(x => `spec_${x.key}` === col);
    return f?.placeholder ?? '';
  });
  const csv = [cols, example].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  return c.body(csv, 200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="absvai-${t.id}-import.csv"` });
});

export function csvColumns(t: ProductTemplate): string[] {
  return [
    'product_name', 'short_description', 'description', 'brand', 'product_code',
    ...t.variantAttributes.map(a => `option_${a.attributeTypeId}`),
    'price_taka', 'compare_at_taka', 'stock', 'packed_weight_grams', 'net_quantity', 'sku',
    ...t.specFields.filter(f => f.type !== 'file').map(f => `spec_${f.key}`),
  ];
}

function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some(x => x.trim())) rows.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some(x => x.trim())) rows.push(row);
  return rows;
}

// ───────────── Categories ─────────────

adminCatalog.get('/categories', need('catalog:read'), async c => {
  const [cats, links] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT c.*, t.name AS template_name, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.deleted_at IS NULL) AS product_count
                        FROM categories c JOIN product_templates t ON t.id = c.template_id WHERE c.deleted_at IS NULL ORDER BY c.sort_order, c.name`),
    c.env.DB.prepare('SELECT category_id, season_id FROM category_seasons'),
  ]);
  const l = links.results as Array<{ category_id: number; season_id: number }>;
  return c.json((cats.results as Array<Record<string, unknown>>).map(x => ({ ...x, season_ids: l.filter(y => y.category_id === x.id).map(y => y.season_id) })));
});

async function saveCategory(c: Context<AppEnv>, id: number | null) {
  const b = await readJson(c);
  const name = str(b.name, 80);
  if (!name) throw bad('Give the category a name.');
  const slug = str(b.slug, 80) ? slugify(str(b.slug, 80)) : slugify(name);
  const code = str(b.code, 5).toUpperCase();
  if (!/^[A-Z]{2,5}$/.test(code)) throw bad('Category code is 2–5 capital letters, e.g. ORG. It starts every SKU in this category.');
  const templateId = str(b.templateId, 40);
  const t = await c.env.DB.prepare('SELECT status FROM product_templates WHERE id = ?').bind(templateId).first<{ status: string }>();
  if (!t) throw bad('Choose a product template.');
  const parentId = posInt(b.parentId);
  if (parentId && parentId === id) throw bad('A category cannot be its own parent.');
  if (id) {
    const current = await c.env.DB.prepare('SELECT template_id FROM categories WHERE id = ?').bind(id).first<{ template_id: string }>();
    if (!current) throw notFound();
    if (current.template_id !== templateId) {
      const live = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM products WHERE category_id = ? AND status != 'draft' AND deleted_at IS NULL").bind(id).first<{ n: number }>();
      if ((live?.n ?? 0) > 0) throw bad('This category has live products. Move them first, or keep the same template.');
    }
  } else if (t.status === 'retired') throw bad('That template is retired. Choose another.');
  const vis = b.seasonVisibility === 'seasons' ? 'seasons' : 'always';
  const seasonIds = Array.isArray(b.seasonIds) ? (b.seasonIds as unknown[]).map(Number).filter(n => Number.isInteger(n) && n > 0) : [];
  if (vis === 'seasons' && !seasonIds.length) throw bad('Pick at least one season, or show the category always.');
  const vals = [slug, name, code, parentId, templateId, str(b.iconUrl, 300) || null, str(b.description, 500) || null, vis, b.isActive === false ? 0 : 1, int(b.sortOrder) ?? 0, str(b.metaTitle, 120) || null, str(b.metaDescription, 300) || null];
  let catId = id;
  try {
    if (id) {
      await c.env.DB.prepare(`UPDATE categories SET slug = ?, name = ?, code = ?, parent_id = ?, template_id = ?, icon_url = ?, description = ?, season_visibility = ?, is_active = ?, sort_order = ?, meta_title = ?, meta_description = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).bind(...vals, id).run();
    } else {
      const r = await c.env.DB.prepare('INSERT INTO categories (slug, name, code, parent_id, template_id, icon_url, description, season_visibility, is_active, sort_order, meta_title, meta_description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id').bind(...vals).first<{ id: number }>();
      catId = r!.id;
    }
  } catch (e) {
    if (/UNIQUE/.test(String(e))) throw bad('Another category already uses that web address (slug).');
    throw e;
  }
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM category_seasons WHERE category_id = ?').bind(catId),
    ...(vis === 'seasons' ? seasonIds : []).map(s => c.env.DB.prepare('INSERT OR IGNORE INTO category_seasons (category_id, season_id) VALUES (?, ?)').bind(catId, s)),
    c.env.DB.prepare("UPDATE products SET template_id = ? WHERE category_id = ? AND status = 'draft'").bind(templateId, catId),
  ]);
  await audit(c, id ? 'category.update' : 'category.create', 'category', catId, { name, templateId });
  await changed(c);
  return c.json({ id: catId }, id ? 200 : 201);
}

adminCatalog.post('/categories', need('catalog:write'), c => saveCategory(c, null));
adminCatalog.put('/categories/:id', need('catalog:write'), c => saveCategory(c, posInt(c.req.param('id'))));
adminCatalog.delete('/categories/:id', need('catalog:write'), async c => {
  const id = posInt(c.req.param('id'));
  const n = await c.env.DB.prepare('SELECT (SELECT COUNT(*) FROM products WHERE category_id = ? AND deleted_at IS NULL) + (SELECT COUNT(*) FROM categories WHERE parent_id = ? AND deleted_at IS NULL) AS n').bind(id, id).first<{ n: number }>();
  if ((n?.n ?? 0) > 0) throw new HttpError(409, 'Move or delete its products and subcategories first.');
  await c.env.DB.prepare("UPDATE categories SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), slug = slug || '-deleted-' || id WHERE id = ?").bind(id).run();
  await audit(c, 'category.delete', 'category', id);
  await changed(c);
  return c.json({ ok: true });
});

// ───────────── Products ─────────────

adminCatalog.get('/products', need('catalog:read'), async c => {
  const status = c.req.query('status');
  const where = ['p.deleted_at IS NULL'];
  const params: unknown[] = [];
  if (status && ['draft', 'scheduled', 'published', 'archived'].includes(status)) { where.push('p.status = ?'); params.push(status); }
  const cat = posInt(c.req.query('category'));
  if (cat) { where.push('(p.category_id = ? OR p.category_id IN (SELECT id FROM categories WHERE parent_id = ?))'); params.push(cat, cat); }
  const q = str(c.req.query('q'), 80);
  if (q) { where.push('(p.name LIKE ? OR p.slug LIKE ? OR EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.sku LIKE ?))'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const page = Math.max(1, Number(c.req.query('page')) || 1);
  const r = await c.env.DB.prepare(
    `SELECT p.id, p.name, p.slug, p.status, p.publish_at, p.updated_at, p.fulfilment_mode, p.is_original, c.name AS category_name, t.name AS template_name,
            (SELECT MIN(price_paisa) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1) AS min_price,
            (SELECT SUM(stock) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1) AS stock,
            (SELECT COUNT(*) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1) AS variant_count,
            (SELECT url FROM product_media m WHERE m.product_id = p.id AND m.kind = 'image' ORDER BY m.sort_order, m.id LIMIT 1) AS image_url
       FROM products p JOIN categories c ON c.id = p.category_id JOIN product_templates t ON t.id = p.template_id
      WHERE ${where.join(' AND ')} ORDER BY p.updated_at DESC LIMIT 50 OFFSET ${(page - 1) * 50}`,
  ).bind(...params).all();
  return c.json(r.results);
});

async function loadAdminProduct(db: D1Database, id: number) {
  const p = await db.prepare('SELECT p.*, c.code AS category_code, c.name AS category_name FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id = ? AND p.deleted_at IS NULL').bind(id).first<Record<string, unknown>>();
  if (!p) throw notFound('Product not found.');
  const [variants, specs, media, seasons, claims] = await db.batch([
    db.prepare('SELECT * FROM product_variants WHERE product_id = ? ORDER BY is_active DESC, sort_order, id').bind(id),
    db.prepare('SELECT field_key, value FROM product_spec_values WHERE product_id = ?').bind(id),
    db.prepare('SELECT * FROM product_media WHERE product_id = ? ORDER BY sort_order, id').bind(id),
    db.prepare('SELECT season_id FROM product_seasons WHERE product_id = ?').bind(id),
    db.prepare('SELECT claim, document_media_id FROM product_claims WHERE product_id = ?').bind(id),
  ]);
  const template = await loadTemplate(db, String(p.template_id));
  if (!template) throw notFound('Template missing.');
  const specMap = Object.fromEntries((specs.results as Array<{ field_key: string; value: string }>).map(s => [s.field_key, s.value]));
  const vs = (variants.results as Array<Record<string, unknown>>).map(rowToVariant);
  const mediaRows = media.results as Array<Record<string, unknown>>;
  const promoted = parseJson<string[]>(p.promoted_spec_keys, []);
  const checklist = publishChecklist(template, {
    name: p.name as string, slug: p.slug as string, shortDescription: p.short_description as string, brand: p.brand as string, description: p.description as string,
    benefitChips: parseJson(p.benefit_chips, []), fulfilmentMode: p.fulfilment_mode as 'in_stock', preorderDispatchDate: p.preorder_dispatch_date as string,
    preorderAdvanceType: p.preorder_advance_type as string, preorderAdvancePaisa: p.preorder_advance_paisa as number, madeToOrderLeadDays: p.made_to_order_lead_days as number,
    promotedSpecKeys: promoted, sizeChart: parseJson(p.size_chart, null), imageCount: mediaRows.filter(m => m.kind === 'image').length,
  }, specMap, vs.filter(v => v.isActive));
  return {
    product: { ...p, benefit_chips: parseJson(p.benefit_chips, []), promoted_spec_keys: promoted, size_chart: parseJson(p.size_chart, null) },
    template,
    effectiveVariantAttributes: effectiveVariantAttributes(template, promoted),
    effectiveSpecFields: effectiveSpecFields(template, promoted),
    variants: vs,
    specs: specMap,
    media: mediaRows,
    seasonIds: (seasons.results as Array<{ season_id: number }>).map(s => s.season_id),
    claims: claims.results,
    claimBadges: CLAIM_BADGES,
    checklist,
  };
}

adminCatalog.get('/products/:id', need('catalog:read'), async c => c.json(await loadAdminProduct(c.env.DB, posInt(c.req.param('id')) ?? 0)));

async function uniqueSlug(db: D1Database, base: string, exceptId: number | null): Promise<string> {
  let slug = base || 'product';
  for (let i = 2; i < 50; i++) {
    const hit = await db.prepare('SELECT id FROM products WHERE slug = ?').bind(slug).first<{ id: number }>();
    if (!hit || hit.id === exceptId) return slug;
    slug = `${base}-${i}`;
  }
  return `${base}-${Date.now()}`;
}

adminCatalog.post('/products', need('catalog:write'), async c => {
  const b = await readJson(c);
  const cat = await c.env.DB.prepare('SELECT c.*, t.default_shipping_profile, t.status AS template_status FROM categories c JOIN product_templates t ON t.id = c.template_id WHERE c.id = ? AND c.deleted_at IS NULL').bind(posInt(b.categoryId)).first<Record<string, string>>();
  if (!cat) throw bad('Pick a category first.');
  const name = str(b.name, 160) || 'Untitled product';
  const slug = await uniqueSlug(c.env.DB, slugify(name), null);
  const r = await c.env.DB.prepare(
    `INSERT INTO products (slug, category_id, template_id, name, code, shipping_profile, brand, is_original) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  ).bind(slug, cat.id, cat.template_id, name, productCodeFromName(name), cat.default_shipping_profile, b.isOriginal ? 'Abs Vai' : null, b.isOriginal ? 1 : 0).first<{ id: number }>();
  await audit(c, 'product.create', 'product', r!.id, { name });
  return c.json({ id: r!.id }, 201);
});

interface VariantIn { id: number | null; attributes: Record<string, string>; pricePaisa: number; compareAtPricePaisa: number | null; stock: number; packedWeightGrams: number; netValue: number | null; netUnit: string | null; sku: string; wholesaleTiers: Array<{ minQty: number; pricePaisa: number }>; imageIds: number[]; isActive: boolean }

function parseVariants(raw: unknown, allowedKeys: string[]): VariantIn[] {
  if (!Array.isArray(raw)) return [];
  if (raw.length > 200) throw bad('A product can have at most 200 options.');
  return raw.map((v: Record<string, unknown>, i) => {
    const attributes: Record<string, string> = {};
    for (const [k, val] of Object.entries((v.attributes as Record<string, unknown>) ?? {})) {
      const s = str(val, 60);
      if (!s) continue;
      if (!allowedKeys.includes(k)) throw bad(`Option ${i + 1}: "${k}" is not a choice for this category.`);
      attributes[k] = s;
    }
    const nonNeg = (x: unknown, label: string) => { const n = int(x) ?? 0; if (n < 0) throw bad(`Option ${i + 1}: ${label} cannot be negative.`); return n; };
    let netValue = typeof v.netValue === 'number' && v.netValue > 0 ? v.netValue : null;
    let netUnit = ['g', 'kg', 'ml', 'l', 'pcs'].includes(String(v.netUnit)) ? String(v.netUnit) : null;
    if (!netValue) {
      // Fill net quantity from a weight/pack-size/pack-qty value like "500g" so staff don't type it twice.
      const parsed = Object.values(attributes).map(parseNetQuantity).find(Boolean);
      if (parsed) { netValue = parsed.value; netUnit = parsed.unit; }
    }
    const tiers = Array.isArray(v.wholesaleTiers) ? (v.wholesaleTiers as Array<Record<string, unknown>>).map(t => ({ minQty: int(t.minQty) ?? 0, pricePaisa: int(t.pricePaisa) ?? 0 })).filter(t => t.minQty > 1 && t.pricePaisa > 0).slice(0, 5) : [];
    return {
      id: posInt(v.id), attributes, pricePaisa: nonNeg(v.pricePaisa, 'price'), compareAtPricePaisa: posInt(v.compareAtPricePaisa), stock: nonNeg(v.stock, 'stock'),
      packedWeightGrams: nonNeg(v.packedWeightGrams, 'packed weight'), netValue, netUnit, sku: str(v.sku, 60).toUpperCase(), wholesaleTiers: tiers,
      imageIds: Array.isArray(v.imageIds) ? (v.imageIds as unknown[]).map(Number).filter(n => Number.isInteger(n)).slice(0, 10) : [], isActive: v.isActive !== false,
    };
  });
}

adminCatalog.put('/products/:id', need('catalog:write'), async c => {
  const id = posInt(c.req.param('id'));
  if (!id) throw notFound();
  const db = c.env.DB;
  const b = await readJson(c);
  const existing = await db.prepare('SELECT * FROM products WHERE id = ? AND deleted_at IS NULL').bind(id).first<Record<string, unknown>>();
  if (!existing) throw notFound();

  const categoryId = posInt(b.categoryId) ?? Number(existing.category_id);
  const cat = await db.prepare('SELECT * FROM categories WHERE id = ? AND deleted_at IS NULL').bind(categoryId).first<Record<string, string>>();
  if (!cat) throw bad('Pick a category.');
  if (cat.template_id !== existing.template_id && existing.status !== 'draft') throw bad('Live products can only move to a category with the same template.');
  const template = await loadTemplate(db, cat.template_id);
  if (!template) throw bad('Template missing.');

  const promoted = (Array.isArray(b.promotedSpecKeys) ? (b.promotedSpecKeys as unknown[]).map(String) : []).filter(k => template.specFields.some(f => f.key === k && f.canBecomeVariant));
  const variantKeys = effectiveVariantAttributes(template, promoted).map(a => a.attributeTypeId);
  const variants = parseVariants(b.variants, variantKeys);
  const keys = variants.filter(v => v.isActive).map(v => attributesKey(v.attributes));
  if (new Set(keys).size !== keys.length) throw bad('Two options have exactly the same choices.');

  const specs: Record<string, string> = {};
  for (const f of effectiveSpecFields(template, promoted)) {
    const raw = (b.specs as Record<string, unknown> | undefined)?.[f.key];
    const v = f.type === 'boolean' ? (raw === true || raw === '1' || raw === 'true' ? '1' : raw === false || raw === '0' || raw === 'false' ? '0' : '') : str(raw, 5000);
    if (!v) continue;
    const err = validateSpecValue(f, v);
    if (err) throw bad(err);
    specs[f.key] = v;
  }

  const fulfilment = FULFILMENT.includes(str(b.fulfilmentMode)) ? str(b.fulfilmentMode) : 'in_stock';
  const shipping = PROFILES.includes(str(b.shippingProfile)) ? str(b.shippingProfile) : template.defaultShippingProfile;
  const code = (str(b.code, 8).toUpperCase().replace(/[^A-Z0-9]/g, '') || String(existing.code)).slice(0, 8);
  const name = str(b.name, 160) || String(existing.name);
  const slug = await uniqueSlug(db, slugify(str(b.slug, 80) || name), id);
  const chips = Array.isArray(b.benefitChips) ? (b.benefitChips as unknown[]).map(x => str(x, 40)).filter(Boolean).slice(0, 4) : [];
  const sizeChart = b.sizeChart && typeof b.sizeChart === 'object' ? {
    columns: ((b.sizeChart as { columns?: unknown[] }).columns ?? []).map(x => str(x, 40)).slice(0, 6),
    rows: ((b.sizeChart as { rows?: Array<{ size?: unknown; values?: unknown[] }> }).rows ?? []).slice(0, 30).map(r => ({ size: str(r.size, 20), values: (r.values ?? []).map(x => str(x, 20)).slice(0, 6) })).filter(r => r.size),
  } : null;
  const video = str(b.videoUrl, 300);
  if (video && !/^https:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[\w-]{6,}/.test(video)) throw bad('Paste a YouTube link like https://youtu.be/… or https://www.youtube.com/watch?v=…');

  // SKUs: generate any that are blank, then check they are unique across the store.
  const existingVariants = await db.prepare('SELECT id, sku, stock FROM product_variants WHERE product_id = ?').bind(id).all<{ id: number; sku: string; stock: number }>();
  const byId = new Map(existingVariants.results.map(v => [v.id, v]));
  for (const v of variants) {
    if (v.id && !byId.has(v.id)) throw bad('An option belongs to another product. Reload the page.');
    if (!v.sku) v.sku = formatSku(cat.code, code, variantCode(v.attributes), await nextSkuSequence(db, cat.code));
    if (!SKU_PATTERN.test(v.sku)) throw bad(`SKU "${v.sku}" should look like ${cat.code}-${code}-500G-0001.`);
  }
  const skus = variants.map(v => v.sku);
  if (new Set(skus).size !== skus.length) throw bad('Two options have the same SKU.');
  if (skus.length) {
    const clash = await db.prepare(`SELECT sku FROM product_variants WHERE sku IN (${skus.map(() => '?').join(',')}) AND product_id != ?`).bind(...skus, id).all<{ sku: string }>();
    if (clash.results.length) throw bad(`SKU ${clash.results[0].sku} is already used by another product.`);
  }

  // Live products must keep passing the checklist.
  const mediaCount = await db.prepare("SELECT COUNT(*) AS n FROM product_media WHERE product_id = ? AND kind = 'image'").bind(id).first<{ n: number }>();
  const productLike = {
    name, slug, shortDescription: str(b.shortDescription, 300), brand: str(b.brand, 80), description: str(b.description, 10000), benefitChips: chips,
    fulfilmentMode: fulfilment as 'in_stock', preorderDispatchDate: str(b.preorderDispatchDate, 10) || null, preorderAdvanceType: str(b.preorderAdvanceType, 20) || null,
    preorderAdvancePaisa: int(b.preorderAdvancePaisa), madeToOrderLeadDays: int(b.madeToOrderLeadDays), promotedSpecKeys: promoted, sizeChart, imageCount: mediaCount?.n ?? 0,
  };
  const checklist = publishChecklist(template, productLike, specs, variants.filter(v => v.isActive));
  if ((existing.status === 'published' || existing.status === 'scheduled') && !checklist.ready) {
    throw new HttpError(409, `This product is live. ${checklist.items.find(i => !i.ok)!.message}`, { checklist });
  }

  const now = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
  const stmts: D1PreparedStatement[] = [
    db.prepare(`UPDATE products SET category_id = ?, template_id = ?, name = ?, slug = ?, code = ?, short_description = ?, description = ?, brand = ?, is_original = ?, benefit_chips = ?,
                 fulfilment_mode = ?, preorder_dispatch_date = ?, preorder_advance_type = ?, preorder_advance_paisa = ?, made_to_order_lead_days = ?, shipping_profile = ?, bulky_delivery_mode = ?,
                 free_delivery = ?, video_url = ?, promoted_spec_keys = ?, size_chart = ?, search_keywords = ?, meta_title = ?, meta_description = ?, updated_at = ${now} WHERE id = ?`)
      .bind(categoryId, cat.template_id, name, slug, code, productLike.shortDescription || null, productLike.description || null, productLike.brand || null, b.isOriginal ? 1 : 0, JSON.stringify(chips),
        fulfilment, productLike.preorderDispatchDate, productLike.preorderAdvanceType, productLike.preorderAdvancePaisa, productLike.madeToOrderLeadDays, shipping,
        b.bulkyDeliveryMode === 'confirm_by_phone' ? 'confirm_by_phone' : 'zone_fixed', b.freeDelivery ? 1 : 0, video || null, JSON.stringify(promoted),
        sizeChart ? JSON.stringify(sizeChart) : null, str(b.searchKeywords, 300) || null, str(b.metaTitle, 120) || null, str(b.metaDescription, 300) || null, id),
    db.prepare('DELETE FROM product_spec_values WHERE product_id = ?').bind(id),
    ...Object.entries(specs).map(([k, v]) => db.prepare('INSERT INTO product_spec_values (product_id, field_key, value) VALUES (?, ?, ?)').bind(id, k, v)),
    db.prepare('DELETE FROM product_seasons WHERE product_id = ?').bind(id),
    ...(Array.isArray(b.seasonIds) ? (b.seasonIds as unknown[]).map(Number).filter(n => Number.isInteger(n) && n > 0) : []).map(s => db.prepare('INSERT OR IGNORE INTO product_seasons (product_id, season_id) VALUES (?, ?)').bind(id, s)),
  ];

  // Variants: update in place, insert new, retire removed ones (kept if any order references them).
  const keep = new Set(variants.filter(v => v.id).map(v => v.id!));
  for (const old of existingVariants.results) {
    if (keep.has(old.id)) continue;
    stmts.push(db.prepare(`UPDATE product_variants SET is_active = 0, sku = sku || '-RETIRED-' || id, attributes_key = attributes_key || '#' || id, updated_at = ${now} WHERE id = ? AND EXISTS (SELECT 1 FROM order_items WHERE variant_id = ?)`).bind(old.id, old.id));
    // Never sold or adjusted: drop its opening-stock row first (foreign key), then the option itself.
    const unused = "NOT EXISTS (SELECT 1 FROM order_items WHERE variant_id = ?) AND NOT EXISTS (SELECT 1 FROM inventory_log WHERE variant_id = ? AND reason != 'initial')";
    stmts.push(db.prepare(`DELETE FROM inventory_log WHERE variant_id = ? AND reason = 'initial' AND ${unused}`).bind(old.id, old.id, old.id));
    stmts.push(db.prepare(`DELETE FROM product_variants WHERE id = ? AND ${unused}`).bind(old.id, old.id, old.id));
  }
  variants.forEach((v, i) => {
    const vals = [v.sku, JSON.stringify(v.attributes), attributesKey(v.attributes) + (v.isActive ? '' : `#off${i}`), v.pricePaisa, v.compareAtPricePaisa, JSON.stringify(v.wholesaleTiers), v.stock, v.packedWeightGrams, v.netValue, v.netUnit, JSON.stringify(v.imageIds), v.isActive ? 1 : 0, i];
    if (v.id) {
      const before = byId.get(v.id)!;
      stmts.push(db.prepare(`UPDATE product_variants SET sku = ?, attributes = ?, attributes_key = ?, price_paisa = ?, compare_at_price_paisa = ?, wholesale_tiers = ?, stock = ?, packed_weight_grams = ?, net_value = ?, net_unit = ?, image_ids = ?, is_active = ?, sort_order = ?, updated_at = ${now} WHERE id = ?`).bind(...vals, v.id));
      if (before.stock !== v.stock) stmts.push(db.prepare("INSERT INTO inventory_log (variant_id, change, reason, note, admin_id) VALUES (?, ?, 'adjust', 'Edited in product form', ?)").bind(v.id, v.stock - before.stock, c.var.session.adminId));
    } else {
      stmts.push(db.prepare('INSERT INTO product_variants (product_id, sku, attributes, attributes_key, price_paisa, compare_at_price_paisa, wholesale_tiers, stock, packed_weight_grams, net_value, net_unit, image_ids, is_active, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, ...vals));
      if (v.stock > 0) stmts.push(db.prepare("INSERT INTO inventory_log (variant_id, change, reason, batch_no, note, admin_id) SELECT id, ?, 'initial', ?, 'Opening stock', ? FROM product_variants WHERE sku = ?").bind(v.stock, specs.batch_no ?? null, c.var.session.adminId, v.sku));
    }
  });
  try {
    await db.batch(stmts);
  } catch (e) {
    if (/UNIQUE constraint failed: product_variants.sku/.test(String(e))) throw bad('One of the SKUs is already used. Leave SKU empty to generate a new one.');
    if (/UNIQUE constraint failed: product_variants.product_id/.test(String(e))) throw bad('Two options have exactly the same choices.');
    throw e;
  }
  await audit(c, 'product.update', 'product', id, { name, variants: variants.length });
  await changed(c);
  return c.json(await loadAdminProduct(db, id));
});

adminCatalog.post('/products/:id/publish', need('catalog:write'), async c => {
  const id = posInt(c.req.param('id')) ?? 0;
  const b = await readJson(c);
  const data = await loadAdminProduct(c.env.DB, id);
  if (!data.checklist.ready) throw new HttpError(409, data.checklist.items.find(i => !i.ok)!.message, { checklist: data.checklist });
  const at = str(b.publishAt, 30);
  const scheduled = at && Date.parse(at) > Date.now();
  await c.env.DB.prepare(`UPDATE products SET status = ?, publish_at = ?, published_at = COALESCE(published_at, ?), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`)
    .bind(scheduled ? 'scheduled' : 'published', scheduled ? new Date(at).toISOString() : null, scheduled ? new Date(at).toISOString() : new Date().toISOString(), id).run();
  await audit(c, scheduled ? 'product.schedule' : 'product.publish', 'product', id, scheduled ? { at } : undefined);
  await changed(c);
  return c.json({ ok: true, status: scheduled ? 'scheduled' : 'published' });
});

adminCatalog.post('/products/:id/unpublish', need('catalog:write'), async c => {
  const id = posInt(c.req.param('id'));
  await c.env.DB.prepare("UPDATE products SET status = 'draft', publish_at = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").bind(id).run();
  await audit(c, 'product.unpublish', 'product', id);
  await changed(c);
  return c.json({ ok: true });
});

/** Copies everything except SKUs and stock. */
adminCatalog.post('/products/:id/duplicate', need('catalog:write'), async c => {
  const id = posInt(c.req.param('id')) ?? 0;
  const db = c.env.DB;
  const p = await db.prepare('SELECT * FROM products WHERE id = ? AND deleted_at IS NULL').bind(id).first<Record<string, unknown>>();
  if (!p) throw notFound();
  const cat = await db.prepare('SELECT code FROM categories WHERE id = ?').bind(p.category_id).first<{ code: string }>();
  const slug = await uniqueSlug(db, `${p.slug}-copy`, null);
  const cols = ['category_id', 'template_id', 'code', 'short_description', 'description', 'brand', 'is_original', 'benefit_chips', 'fulfilment_mode', 'preorder_dispatch_date', 'preorder_advance_type', 'preorder_advance_paisa', 'made_to_order_lead_days', 'shipping_profile', 'bulky_delivery_mode', 'free_delivery', 'video_url', 'promoted_spec_keys', 'size_chart', 'search_keywords'];
  const copy = await db.prepare(`INSERT INTO products (slug, name, ${cols.join(', ')}) SELECT ?, name || ' (copy)', ${cols.join(', ')} FROM products WHERE id = ? RETURNING id`).bind(slug, id).first<{ id: number }>();
  const newId = copy!.id;
  const variants = await db.prepare('SELECT * FROM product_variants WHERE product_id = ? AND is_active = 1 ORDER BY sort_order').bind(id).all<Record<string, unknown>>();
  const stmts: D1PreparedStatement[] = [
    db.prepare('INSERT INTO product_spec_values (product_id, field_key, value) SELECT ?, field_key, value FROM product_spec_values WHERE product_id = ?').bind(newId, id),
    db.prepare('INSERT INTO product_seasons (product_id, season_id) SELECT ?, season_id FROM product_seasons WHERE product_id = ?').bind(newId, id),
    db.prepare("INSERT INTO product_media (product_id, kind, r2_key, url, alt, width, height, sort_order) SELECT ?, kind, r2_key, url, alt, width, height, sort_order FROM product_media WHERE product_id = ? AND kind IN ('image','manual','spec_file')").bind(newId, id),
  ];
  for (const v of variants.results) {
    const attrs = parseJson<Record<string, string>>(v.attributes, {});
    const sku = formatSku(cat!.code, String(p.code), variantCode(attrs), await nextSkuSequence(db, cat!.code));
    stmts.push(db.prepare('INSERT INTO product_variants (product_id, sku, attributes, attributes_key, price_paisa, compare_at_price_paisa, wholesale_tiers, stock, packed_weight_grams, net_value, net_unit, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)')
      .bind(newId, sku, v.attributes, v.attributes_key, v.price_paisa, v.compare_at_price_paisa, v.wholesale_tiers, v.packed_weight_grams, v.net_value, v.net_unit, v.sort_order));
  }
  await db.batch(stmts);
  await audit(c, 'product.duplicate', 'product', newId, { from: id });
  return c.json({ id: newId }, 201);
});

adminCatalog.delete('/products/:id', need('catalog:write'), async c => {
  const id = posInt(c.req.param('id'));
  await c.env.DB.prepare("UPDATE products SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), status = 'archived', slug = slug || '-trash-' || id WHERE id = ?").bind(id).run();
  await audit(c, 'product.trash', 'product', id);
  await changed(c);
  return c.json({ ok: true });
});

adminCatalog.post('/products/:id/restore', need('catalog:write'), async c => {
  const id = posInt(c.req.param('id'));
  await c.env.DB.prepare("UPDATE products SET deleted_at = NULL, status = 'draft', slug = replace(slug, '-trash-' || id, '') WHERE id = ?").bind(id).run();
  await audit(c, 'product.restore', 'product', id);
  return c.json({ ok: true });
});

adminCatalog.get('/products-trash', need('catalog:read'), async c => {
  const r = await c.env.DB.prepare('SELECT id, name, deleted_at FROM products WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 100').all();
  return c.json(r.results);
});

adminCatalog.post('/skus/check', need('catalog:read'), async c => {
  const b = await readJson(c);
  const skus = Array.isArray(b.skus) ? (b.skus as unknown[]).map(s => str(s, 60).toUpperCase()).filter(Boolean).slice(0, 200) : [];
  if (!skus.length) return c.json({ taken: [] });
  const r = await c.env.DB.prepare(`SELECT sku FROM product_variants WHERE sku IN (${skus.map(() => '?').join(',')}) AND product_id != ?`).bind(...skus, posInt(b.productId) ?? 0).all<{ sku: string }>();
  return c.json({ taken: r.results.map(x => x.sku), invalid: skus.filter(s => !SKU_PATTERN.test(s)) });
});

// ───────────── Media (R2) ─────────────

const MEDIA_TYPES: Record<string, string> = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/avif': 'avif', 'application/pdf': 'pdf' };

adminCatalog.post('/media', need('catalog:write'), async c => {
  const form = await c.req.formData();
  const file = form.get('file');
  const productId = posInt(form.get('productId'));
  const kind = ['image', 'manual', 'claim_doc', 'spec_file'].includes(String(form.get('kind'))) ? String(form.get('kind')) : 'image';
  if (!(file instanceof File) || !productId) throw bad('Choose a file.');
  const ext = MEDIA_TYPES[file.type];
  if (!ext) throw bad('Upload a JPG, PNG, WebP or AVIF photo, or a PDF.');
  if (kind === 'image' && ext === 'pdf') throw bad('Product photos must be images.');
  if (file.size > 8 * 1024 * 1024) throw bad('That file is over 8 MB. Photos are compressed in the browser; PDFs must be under 8 MB.');
  if (!(await c.env.DB.prepare('SELECT 1 FROM products WHERE id = ?').bind(productId).first())) throw notFound();
  const key = `p/${productId}/${crypto.randomUUID()}.${ext}`;
  // R2 needs a known length; a FormData file stream has none, so read it (files are capped at 8 MB above).
  await c.env.MEDIA.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type, cacheControl: 'public, max-age=31536000, immutable' } });
  const max = await c.env.DB.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM product_media WHERE product_id = ?').bind(productId).first<{ n: number }>();
  const r = await c.env.DB.prepare('INSERT INTO product_media (product_id, kind, r2_key, url, alt, width, height, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id, url')
    .bind(productId, kind, key, `/media/${key}`, str(form.get('alt'), 200) || null, int(form.get('width')), int(form.get('height')), max?.n ?? 0).first<{ id: number; url: string }>();
  await audit(c, 'media.upload', 'product', productId, { kind, key });
  await changed(c);
  return c.json(r, 201);
});

adminCatalog.delete('/media/:id', need('catalog:write'), async c => {
  const id = posInt(c.req.param('id'));
  const m = await c.env.DB.prepare('SELECT * FROM product_media WHERE id = ?').bind(id).first<{ id: number; r2_key: string | null; product_id: number }>();
  if (!m) throw notFound();
  if (await c.env.DB.prepare('SELECT 1 FROM product_claims WHERE document_media_id = ?').bind(id).first()) throw bad('This document supports a claim badge. Remove the badge first.');
  await c.env.DB.prepare('DELETE FROM product_media WHERE id = ?').bind(id).run();
  if (m.r2_key) {
    const others = await c.env.DB.prepare('SELECT 1 FROM product_media WHERE r2_key = ?').bind(m.r2_key).first();
    if (!others) await c.env.MEDIA.delete(m.r2_key);
  }
  await audit(c, 'media.delete', 'product', m.product_id, { id });
  await changed(c);
  return c.json({ ok: true });
});

adminCatalog.put('/products/:id/media-order', need('catalog:write'), async c => {
  const b = await readJson(c);
  const id = posInt(c.req.param('id'));
  const ids = Array.isArray(b.ids) ? (b.ids as unknown[]).map(Number).filter(Number.isInteger) : [];
  await c.env.DB.batch(ids.map((m, i) => c.env.DB.prepare('UPDATE product_media SET sort_order = ? WHERE id = ? AND product_id = ?').bind(i, m, id)));
  await changed(c);
  return c.json({ ok: true });
});

// ───────────── Claim badges (earned, not typed) ─────────────

adminCatalog.post('/products/:id/claims', need('catalog:write'), async c => {
  const id = posInt(c.req.param('id'));
  const b = await readJson(c);
  const claim = str(b.claim, 40);
  if (!CLAIM_BADGES.includes(claim)) throw bad(`Choose one of: ${CLAIM_BADGES.join(', ')}.`);
  if (healthClaimIn(claim)) throw bad('Health claims are not allowed.');
  const doc = await c.env.DB.prepare("SELECT id FROM product_media WHERE id = ? AND product_id = ? AND kind = 'claim_doc'").bind(posInt(b.documentMediaId), id).first();
  if (!doc) throw bad('Attach the supporting document or supplier declaration first.');
  await c.env.DB.prepare('INSERT INTO product_claims (product_id, claim, document_media_id, added_by) VALUES (?, ?, ?, ?) ON CONFLICT(product_id, claim) DO UPDATE SET document_media_id = excluded.document_media_id').bind(id, claim, posInt(b.documentMediaId), c.var.session.adminId).run();
  await audit(c, 'claim.add', 'product', id, { claim });
  await changed(c);
  return c.json({ ok: true });
});

adminCatalog.delete('/products/:id/claims/:claim', need('catalog:write'), async c => {
  await c.env.DB.prepare('DELETE FROM product_claims WHERE product_id = ? AND claim = ?').bind(posInt(c.req.param('id')), decodeURIComponent(c.req.param('claim'))).run();
  await audit(c, 'claim.remove', 'product', c.req.param('id'), { claim: c.req.param('claim') });
  await changed(c);
  return c.json({ ok: true });
});

// ───────────── CSV import (always creates drafts) ─────────────

adminCatalog.post('/products/import', need('catalog:write'), async c => {
  const b = await readJson(c);
  const cat = await c.env.DB.prepare('SELECT * FROM categories WHERE id = ? AND deleted_at IS NULL').bind(posInt(b.categoryId)).first<Record<string, string>>();
  if (!cat) throw bad('Pick the category to import into.');
  const template = await loadTemplate(c.env.DB, cat.template_id);
  if (!template) throw bad('Template missing.');
  const rows = parseCsv(str(b.csv, 2_000_000));
  if (rows.length < 2) throw bad('The file has no product rows.');
  const header = rows[0].map(h => h.trim());
  const expected = csvColumns(template);
  const missing = expected.filter(col => !header.includes(col));
  if (missing.length) throw bad(`This CSV does not match the ${template.name} template. Missing columns: ${missing.slice(0, 5).join(', ')}. Download the template again.`);
  const col = (r: string[], name: string) => (r[header.indexOf(name)] ?? '').trim();
  const groups = new Map<string, string[][]>();
  for (const r of rows.slice(1)) {
    const n = col(r, 'product_name');
    if (n) groups.set(n, [...(groups.get(n) ?? []), r]);
  }
  const errors: Array<{ product: string; message: string }> = [];
  let created = 0;
  for (const [name, rs] of groups) {
    try {
      const first = rs[0];
      const code = (col(first, 'product_code').toUpperCase().replace(/[^A-Z0-9]/g, '') || productCodeFromName(name)).slice(0, 8);
      const slug = await uniqueSlug(c.env.DB, slugify(name), null);
      const p = await c.env.DB.prepare('INSERT INTO products (slug, category_id, template_id, name, code, short_description, description, brand, shipping_profile) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id')
        .bind(slug, cat.id, cat.template_id, name, code, col(first, 'short_description') || null, col(first, 'description') || null, col(first, 'brand') || null, template.defaultShippingProfile).first<{ id: number }>();
      const stmts: D1PreparedStatement[] = [];
      for (const f of template.specFields) {
        const v = col(first, `spec_${f.key}`);
        if (v && !validateSpecValue(f, v)) stmts.push(c.env.DB.prepare('INSERT INTO product_spec_values (product_id, field_key, value) VALUES (?, ?, ?)').bind(p!.id, f.key, v));
      }
      for (const [i, r] of rs.entries()) {
        const attrs: Record<string, string> = {};
        for (const a of template.variantAttributes) { const v = col(r, `option_${a.attributeTypeId}`); if (v) attrs[a.attributeTypeId] = v; }
        const taka = (s: string) => (/^\d+(\.\d{1,2})?$/.test(s) ? Math.round(Number(s) * 100) : null);
        const net = parseNetQuantity(col(r, 'net_quantity')) ?? Object.values(attrs).map(parseNetQuantity).find(Boolean) ?? null;
        const sku = col(r, 'sku').toUpperCase() || formatSku(cat.code, code, variantCode(attrs), await nextSkuSequence(c.env.DB, cat.code));
        stmts.push(c.env.DB.prepare('INSERT INTO product_variants (product_id, sku, attributes, attributes_key, price_paisa, compare_at_price_paisa, stock, packed_weight_grams, net_value, net_unit, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(p!.id, sku, JSON.stringify(attrs), attributesKey(attrs), taka(col(r, 'price_taka')) ?? 0, taka(col(r, 'compare_at_taka')), Math.max(0, Number(col(r, 'stock')) || 0), Math.max(0, Number(col(r, 'packed_weight_grams')) || 0), net?.value ?? null, net?.unit ?? null, i));
      }
      await c.env.DB.batch(stmts);
      created++;
    } catch (e) {
      errors.push({ product: name, message: /UNIQUE/.test(String(e)) ? 'A SKU or option is duplicated.' : String((e as Error).message ?? e) });
    }
  }
  await audit(c, 'product.import', 'category', cat.id, { created, errors: errors.length });
  return c.json({ created, errors });
});

// Seasons list for the product form's season picker.
adminCatalog.get('/season-options', need('catalog:read'), async c => c.json((await getSeasons(c.env.DB)).map(s => ({ id: s.id, name: s.name, starts_on: s.starts_on, ends_on: s.ends_on }))));
