/** Admin catalog: templates, option types, three-level categories, products (smart upload form), media, claims and CSV. */
import { Hono, type Context } from 'hono';
import type { AppEnv } from '../env';
import { validGtin } from '../lib/barcode';
import { TAG } from '../lib/cache-tags';
import { CLAIM_BADGES, healthClaimIn } from '../lib/claims';
import { bad, HttpError, int, mediaBucket, notFound, parseJson, posInt, readJson, slugify, str } from '../lib/http';
import { attributesKey, formatSku, productCodeFromName, SKU_PATTERN, variantCode } from '../lib/sku';
import { effectiveSpecFields, effectiveVariantAttributes, parseNetQuantity, publishChecklist, validateSpecValue, type ProductTemplate } from '../lib/templates';
import { clearTemplateCache, getSeasons, rowToVariant } from '../repo/catalog';
import * as cat from '../repo/catalog-admin';
import { nextSkuSequence } from '../repo/numbering';
import { loadTemplate } from '../repo/templates';
import { allowed, audit, need, refresh } from './admin-helpers';

export const adminCatalog = new Hono<AppEnv>();

const SPEC_TYPES = ['text', 'longtext', 'number', 'date', 'select', 'dimensions', 'file', 'boolean'];
const PROFILES = ['standard', 'fragile', 'heavy_bulky', 'perishable'];
const FULFILMENT = ['in_stock', 'pre_order', 'made_to_order'];
const KEY = /^[a-z][a-z0-9_]{1,40}$/;
export const MAX_CATEGORY_DEPTH = 3;

/** Template or option-type changes can alter any product page or listing. */
async function catalogChanged(c: Context<AppEnv>, tags: string[] = [TAG.site]) {
  clearTemplateCache();
  await refresh(c, tags);
}

/** What a product save must refresh: its page, its category chain and every listing it can appear in. */
async function productTags(db: D1Database, productId: number, categoryId: number | null): Promise<string[]> {
  const rows = await cat.categoryRows(db);
  const chain: number[] = [];
  let id = categoryId;
  for (let i = 0; id && i < MAX_CATEGORY_DEPTH; i++) { chain.push(id); id = rows.find(r => r.id === id)?.parent_id ?? null; }
  return [TAG.product(productId), ...chain.map(TAG.category), TAG.listing, TAG.home];
}

// ───────────── Attribute types ─────────────

adminCatalog.get('/attribute-types', need('catalog:read'), async c => c.json(await cat.listAttributeTypes(c.env.DB)));

function parseValues(values: unknown): Array<{ value: string; hex: string | null }> | null {
  if (!Array.isArray(values)) return null;
  return values.slice(0, 100).map(v => {
    const value = str(typeof v === 'string' ? v : (v as { value?: string })?.value, 60);
    const hex = typeof v === 'object' && v ? str((v as { hex?: string }).hex, 7) : '';
    return { value, hex: /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : null };
  }).filter(v => v.value);
}

adminCatalog.post('/attribute-types', need('catalog:write'), async c => {
  const b = await readJson(c);
  const id = str(b.id, 40) || slugify(str(b.name, 60)).replace(/-/g, '_');
  if (!KEY.test(id)) throw bad('Use a short ID like "grade" (lowercase letters and underscores).');
  if (!str(b.name, 60)) throw bad('Give the option a name, e.g. "Grade".');
  const input = ['chips', 'swatch', 'select'].includes(String(b.input)) ? String(b.input) : 'chips';
  try {
    await cat.createAttributeType(c.env.DB, { id, name: str(b.name, 60), input, helpText: str(b.helpText, 200) || null });
  } catch { throw bad('An option type with that ID already exists.'); }
  const values = parseValues(b.values);
  if (values) await cat.replaceAttributeValues(c.env.DB, id, values);
  await audit(c, 'attribute_type.create', 'attribute_type', id);
  await catalogChanged(c, []);
  return c.json({ id }, 201);
});

adminCatalog.put('/attribute-types/:id', need('catalog:write'), async c => {
  const b = await readJson(c);
  const id = c.req.param('id');
  const ok = await cat.updateAttributeType(c.env.DB, id, { name: str(b.name, 60) || null, input: ['chips', 'swatch', 'select'].includes(String(b.input)) ? String(b.input) : null, helpText: str(b.helpText, 200) || null });
  if (!ok) throw notFound();
  const values = parseValues(b.values);
  if (values) await cat.replaceAttributeValues(c.env.DB, id, values);
  await audit(c, 'attribute_type.update', 'attribute_type', id);
  await catalogChanged(c);
  return c.json({ ok: true });
});

// ───────────── Templates (data, not code) ─────────────

adminCatalog.get('/templates', need('catalog:read'), async c => c.json(await cat.listTemplates(c.env.DB)));

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
  const ids = await cat.attributeTypeIds(db);
  for (const a of t.variantAttributes) if (!ids.has(a.attributeTypeId)) throw bad(`Unknown option type "${a.attributeTypeId}". Create it under Attribute Types first.`);
  await cat.writeTemplate(db, t, isNew);
}

adminCatalog.post('/templates', need('catalog:write'), async c => {
  const t = parseTemplateBody(await readJson(c));
  if (await cat.templateStatus(c.env.DB, t.id)) throw bad('A template with that ID already exists.');
  await writeTemplate(c.env.DB, t, true);
  await audit(c, 'template.create', 'template', t.id);
  await catalogChanged(c, []);
  return c.json({ id: t.id }, 201);
});

adminCatalog.put('/templates/:id', need('catalog:write'), async c => {
  const t = parseTemplateBody({ ...(await readJson(c)), id: c.req.param('id') });
  if (!(await cat.templateStatus(c.env.DB, t.id))) throw notFound();
  await writeTemplate(c.env.DB, t, false);
  await audit(c, 'template.update', 'template', t.id);
  // Info panels, card lines and filters of every product on this template change.
  await catalogChanged(c, [TAG.listing, TAG.home, ...(await cat.productIdsWithTemplate(c.env.DB, t.id)).map(TAG.product)]);
  return c.json({ ok: true });
});

/** A template in use can't be deleted, only retired (no new categories can choose it). */
adminCatalog.post('/templates/:id/retire', need('catalog:write'), async c => {
  const ok = await cat.setTemplateStatus(c.env.DB, c.req.param('id'), (await readJson(c)).restore ? 'active' : 'retired');
  if (!ok) throw notFound();
  await audit(c, 'template.retire', 'template', c.req.param('id'));
  await catalogChanged(c, []);
  return c.json({ ok: true });
});

adminCatalog.delete('/templates/:id', need('catalog:write'), async c => {
  const id = c.req.param('id');
  if ((await cat.templateUsage(c.env.DB, id)) > 0) throw new HttpError(409, 'This template is used by categories or products. Retire it instead.');
  await cat.deleteTemplate(c.env.DB, id);
  await audit(c, 'template.delete', 'template', id);
  await catalogChanged(c, []);
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
    if (col === 'cost_taka') return '800';
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
    'price_taka', 'compare_at_taka', 'cost_taka', 'stock', 'packed_weight_grams', 'net_quantity', 'sku',
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

// ───────────── Categories (three levels, drag-and-drop) ─────────────

adminCatalog.get('/categories', need('catalog:read'), async c => {
  const rows = await cat.listCategories(c.env.DB);
  const byId = new Map(rows.map(r => [Number(r.id), r]));
  const effective = (r: Record<string, unknown>, guard = 0): string | null => (r.template_id as string) ?? (r.parent_id && guard < MAX_CATEGORY_DEPTH ? effective(byId.get(Number(r.parent_id))!, guard + 1) : null);
  return c.json(rows.map(r => ({ ...r, effective_template_id: effective(r), inherits_template: r.template_id == null })));
});

/** Resolves the effective template of every category from parent links (a NULL template inherits the parent's). */
function effectiveTemplates(rows: cat.CategoryRow[]): Map<number, string | null> {
  const byId = new Map(rows.map(r => [r.id, r]));
  const out = new Map<number, string | null>();
  const resolve = (r: cat.CategoryRow, guard = 0): string | null => r.template_id ?? (r.parent_id && guard < MAX_CATEGORY_DEPTH && byId.get(r.parent_id) ? resolve(byId.get(r.parent_id)!, guard + 1) : null);
  for (const r of rows) out.set(r.id, resolve(r));
  return out;
}

function subtree(rows: cat.CategoryRow[], id: number): number[] {
  const ids = [id];
  for (let i = 0; i < ids.length; i++) for (const r of rows) if (r.parent_id === ids[i] && !ids.includes(r.id)) ids.push(r.id);
  return ids;
}

/** Depth of the deepest descendant below `id`, relative to it (0 when it has no children). */
function subtreeHeight(rows: cat.CategoryRow[], id: number): number {
  const kids = rows.filter(r => r.parent_id === id);
  return kids.length ? 1 + Math.max(...kids.map(k => subtreeHeight(rows, k.id))) : 0;
}

/** "Organic & Seasonal Food" → "OSF", "Shoes" → "SHO". */
function autoCode(name: string): string {
  const words = name.toUpperCase().replace(/[^A-Z ]/g, ' ').split(/\s+/).filter(w => w && !['AND', 'THE', 'OF', 'FOR'].includes(w));
  const code = words.length >= 2 ? words.slice(0, 3).map(w => w[0]).join('') : (words[0] ?? '').slice(0, 3);
  return code.length >= 2 ? code : 'CAT';
}

async function saveCategory(c: Context<AppEnv>, id: number | null) {
  const db = c.env.DB;
  const b = await readJson(c);
  const name = str(b.name, 80);
  if (!name) throw bad('Give the category a name.');
  const slug = str(b.slug, 80) ? slugify(str(b.slug, 80)) : slugify(name);
  const rows = await cat.categoryRows(db);
  // The short code starts every SKU. Left empty, a subcategory reuses its parent's and a new top-level category gets one
  // from its name (Organic Food → ORF), so the owner never has to think about it.
  const parentForCode = posInt(b.parentId) ? rows.find(r => r.id === posInt(b.parentId)) : null;
  const code = (str(b.code, 5) || (parentForCode ? '' : autoCode(name)) || (await cat.categoryCode(db, parentForCode?.id ?? 0)) || autoCode(name)).toUpperCase();
  if (!/^[A-Z]{2,5}$/.test(code)) throw bad('Category code is 2–5 capital letters, e.g. ORG. It starts every SKU in this category.');
  const current = id ? rows.find(r => r.id === id) : null;
  if (id && !current) throw notFound();
  const parentId = posInt(b.parentId);
  const parent = parentId ? rows.find(r => r.id === parentId) : null;
  if (parentId && !parent) throw bad('Choose an existing parent category.');
  if (id && parentId && subtree(rows, id).includes(parentId)) throw bad('A category cannot sit inside itself or one of its own subcategories.');
  const depth = parent ? parent.depth + 1 : 1;
  if (depth + (id ? subtreeHeight(rows, id) : 0) > MAX_CATEGORY_DEPTH) throw bad('Categories go three levels deep at most: Category → Subcategory → Child category.');

  // Child categories inherit their parent's template unless they choose their own.
  const templateId = str(b.templateId, 40) || null;
  if (!templateId && !parent) throw bad('Choose a product template. Only subcategories can use their parent’s template.');
  if (templateId) {
    const status = await cat.templateStatus(db, templateId);
    if (!status) throw bad('Choose a product template.');
    if (status === 'retired' && current?.template_id !== templateId) throw bad('That template is retired. Choose another.');
  }
  const vis = b.seasonVisibility === 'seasons' ? 'seasons' : 'always';
  const seasonIds = Array.isArray(b.seasonIds) ? (b.seasonIds as unknown[]).map(Number).filter(n => Number.isInteger(n) && n > 0) : [];
  if (vis === 'seasons' && !seasonIds.length) throw bad('Pick at least one season, or show the category always.');

  // Which categories' effective template changes? Live products there would no longer match their template.
  const before = effectiveTemplates(rows);
  const after = effectiveTemplates(rows.map(r => (r.id === id ? { ...r, template_id: templateId, parent_id: parentId, depth } : r)).concat(id ? [] : [{ id: -1, parent_id: parentId, depth, template_id: templateId, name, slug, sort_order: 0 }]));
  const changed = id ? subtree(rows, id).filter(x => before.get(x) !== after.get(x)) : [];
  if (changed.length && (await cat.liveProductCount(db, changed)) > 0) throw bad('Products in this category (or its subcategories) are live on the current template. Move or unpublish them first, or keep the same template.');

  let catId: number;
  try {
    catId = await cat.saveCategory(db, id, {
      slug, name, code, parentId, depth, templateId, iconUrl: str(b.iconUrl, 300) || null, description: str(b.description, 500) || null, seasonVisibility: vis,
      isActive: b.isActive !== false, sortOrder: int(b.sortOrder) ?? current?.sort_order ?? rows.filter(r => r.parent_id === parentId).length, metaTitle: str(b.metaTitle, 120) || null, metaDescription: str(b.metaDescription, 300) || null,
    });
  } catch (e) {
    if (/UNIQUE/.test(String(e))) throw bad('Another category already uses that web address (slug).');
    throw e;
  }
  await cat.afterCategorySave(db, catId, vis === 'seasons' ? seasonIds : [], changed.map(x => ({ categoryId: x, templateId: after.get(x)! })).filter(u => u.templateId));
  await audit(c, id ? 'category.update' : 'category.create', 'category', catId, { name, templateId, parentId });
  // The menu on every page shows the category tree.
  await catalogChanged(c, [TAG.site, TAG.category(catId)]);
  return c.json({ id: catId }, id ? 200 : 201);
}

adminCatalog.post('/categories', need('catalog:write'), c => saveCategory(c, null));

const CATEGORY_IMAGE_TYPES: Record<string, string> = { 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/svg+xml': 'svg' };

/** Category picture (menu and category tiles). Returns the URL for the category form to save. */
adminCatalog.post('/category-image', need('catalog:write'), async c => {
  const file = (await c.req.formData()).get('file');
  if (!(file instanceof File)) throw bad('Choose a picture.');
  const ext = CATEGORY_IMAGE_TYPES[file.type];
  if (!ext) throw bad('Upload the picture as JPG, PNG, WebP or SVG.');
  if (file.size > 2 * 1024 * 1024) throw bad('The picture must be under 2 MB.');
  const media = mediaBucket(c.env);
  const key = `c/${crypto.randomUUID()}.${ext}`;
  await media.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type, cacheControl: 'public, max-age=31536000, immutable' } });
  await audit(c, 'category.image', 'category', null, { key });
  return c.json({ url: `/media/${key}` }, 201);
});
adminCatalog.put('/categories/:id', need('catalog:write'), c => saveCategory(c, posInt(c.req.param('id'))));

/**
 * Drag-and-drop result: the full new arrangement as [{id, parentId, sortOrder}]. Validated as a whole (no cycles,
 * at most three levels, no template change for live products), saved in one batch, and the menu cache refreshed.
 */
adminCatalog.put('/categories-order', need('catalog:write'), async c => {
  const db = c.env.DB;
  const b = await readJson(c);
  const items = Array.isArray(b.items) ? (b.items as Array<Record<string, unknown>>).slice(0, 500).map(i => ({ id: posInt(i.id), parentId: posInt(i.parentId), sortOrder: int(i.sortOrder) ?? 0 })) : [];
  if (!items.length || items.some(i => !i.id)) throw bad('Send the new order of the categories.');
  const rows = await cat.categoryRows(db);
  const moved = new Map(items.map(i => [i.id!, i]));
  for (const i of items) if (!rows.some(r => r.id === i.id) || (i.parentId && !rows.some(r => r.id === i.parentId))) throw bad('A category in the list no longer exists. Reload the page.');
  const next = rows.map(r => (moved.has(r.id) ? { ...r, parent_id: moved.get(r.id)!.parentId, sort_order: moved.get(r.id)!.sortOrder } : r));
  const byId = new Map(next.map(r => [r.id, r]));
  const depthOf = (r: cat.CategoryRow, seen = new Set<number>()): number => {
    if (seen.has(r.id)) throw bad('A category cannot sit inside one of its own subcategories.');
    seen.add(r.id);
    return r.parent_id ? depthOf(byId.get(r.parent_id)!, seen) + 1 : 1;
  };
  const depths = new Map(next.map(r => [r.id, depthOf(r)]));
  if ([...depths.values()].some(d => d > MAX_CATEGORY_DEPTH)) throw bad('Categories go three levels deep at most: Category → Subcategory → Child category.');
  const withDepth = next.map(r => ({ ...r, depth: depths.get(r.id)! }));
  for (const r of withDepth) if (!r.template_id && !r.parent_id) throw bad(`"${r.name}" uses its parent's template, so it can't become a top-level category. Give it its own template first.`);
  const before = effectiveTemplates(rows);
  const after = effectiveTemplates(withDepth);
  const changed = rows.filter(r => before.get(r.id) !== after.get(r.id)).map(r => r.id);
  if (changed.length && (await cat.liveProductCount(db, changed)) > 0) throw bad('That move would change the template of live products (they inherit it from the new parent). Give the category its own template first.');
  const changedRows = withDepth.filter(r => { const o = rows.find(x => x.id === r.id)!; return o.parent_id !== r.parent_id || o.sort_order !== r.sort_order || o.depth !== r.depth; });
  await cat.applyCategoryOrder(db, changedRows.map(r => ({ id: r.id, parentId: r.parent_id, sortOrder: r.sort_order, depth: r.depth })));
  await audit(c, 'category.reorder', 'category', null, { moved: changedRows.length });
  await catalogChanged(c, [TAG.site, TAG.home, ...changedRows.map(r => TAG.category(r.id))]);
  return c.json({ ok: true, moved: changedRows.length });
});

adminCatalog.delete('/categories/:id', need('catalog:write'), async c => {
  const id = posInt(c.req.param('id')) ?? 0;
  if ((await cat.categoryBlockers(c.env.DB, id)) > 0) throw new HttpError(409, 'Move or delete its products and subcategories first.');
  await cat.softDeleteCategory(c.env.DB, id);
  await audit(c, 'category.delete', 'category', id);
  await catalogChanged(c, [TAG.site, TAG.category(id)]);
  return c.json({ ok: true });
});

// ───────────── Products ─────────────

adminCatalog.get('/products', need('catalog:read'), async c => {
  const status = c.req.query('status');
  const catId = posInt(c.req.query('category'));
  return c.json(await cat.listAdminProducts(c.env.DB, {
    status: status && ['draft', 'scheduled', 'published', 'archived'].includes(status) ? status : undefined,
    categoryIds: catId ? subtree(await cat.categoryRows(c.env.DB), catId) : undefined,
    q: str(c.req.query('q'), 80) || undefined, page: Math.max(1, Number(c.req.query('page')) || 1),
  }));
});

/** Effective template of a category (its own, or inherited from its parent). */
async function categoryTemplate(db: D1Database, categoryId: number): Promise<{ category: cat.CategoryRow; templateId: string; code: string } | null> {
  const rows = await cat.categoryRows(db);
  const category = rows.find(r => r.id === categoryId);
  if (!category) return null;
  const templateId = effectiveTemplates(rows).get(categoryId);
  const code = await cat.categoryCode(db, categoryId);
  return templateId && code ? { category, templateId, code } : null;
}

async function loadAdminProduct(c: Context<AppEnv>, id: number) {
  const db = c.env.DB;
  const rows = await cat.adminProductRows(db, id);
  if (!rows) throw notFound('Product not found.');
  const p = rows.product;
  const template = await loadTemplate(db, String(p.template_id));
  if (!template) throw notFound('Template missing.');
  const showCost = allowed(c, 'cost:read');
  // Field-level rule: cost price is visible to Owner/Accountant only (Section 18).
  const vs = rows.variants.map(rowToVariant).map(v => ({ ...v, costPaisa: showCost ? v.costPaisa : null, barcode: v.sku }));
  const promoted = parseJson<string[]>(p.promoted_spec_keys, []);
  const mediaRows = rows.media;
  const checklist = publishChecklist(template, {
    name: p.name as string, slug: p.slug as string, shortDescription: p.short_description as string, brand: p.brand as string, description: p.description as string,
    benefitChips: parseJson(p.benefit_chips, []), fulfilmentMode: p.fulfilment_mode as 'in_stock', preorderDispatchDate: p.preorder_dispatch_date as string,
    preorderAdvanceType: p.preorder_advance_type as string, preorderAdvancePaisa: p.preorder_advance_paisa as number, madeToOrderLeadDays: p.made_to_order_lead_days as number,
    promotedSpecKeys: promoted, sizeChart: parseJson(p.size_chart, null), imageCount: mediaRows.filter(m => m.kind === 'image').length,
  }, rows.specs, vs.filter(v => v.isActive));
  return {
    product: { ...p, benefit_chips: parseJson(p.benefit_chips, []), promoted_spec_keys: promoted, size_chart: parseJson(p.size_chart, null) } as Record<string, unknown>,
    template,
    effectiveVariantAttributes: effectiveVariantAttributes(template, promoted),
    effectiveSpecFields: effectiveSpecFields(template, promoted),
    variants: vs,
    specs: rows.specs,
    media: mediaRows,
    seasonIds: rows.seasonIds,
    claims: rows.claims,
    claimBadges: CLAIM_BADGES,
    checklist,
    canSeeCost: showCost,
  };
}

adminCatalog.get('/products/:id', need('catalog:read'), async c => c.json(await loadAdminProduct(c, posInt(c.req.param('id')) ?? 0)));

async function uniqueSlug(db: D1Database, base: string, exceptId: number | null): Promise<string> {
  let slug = base || 'product';
  for (let i = 2; i < 50; i++) {
    const hit = await cat.productBySlug(db, slug);
    if (!hit || hit === exceptId) return slug;
    slug = `${base}-${i}`;
  }
  return `${base}-${Date.now()}`;
}

adminCatalog.post('/products', need('catalog:write'), async c => {
  const b = await readJson(c);
  const ct = await categoryTemplate(c.env.DB, posInt(b.categoryId) ?? 0);
  if (!ct) throw bad('Pick a category first.');
  const t = await loadTemplate(c.env.DB, ct.templateId);
  if (!t) throw bad('Template missing.');
  const name = str(b.name, 160) || 'Untitled product';
  const id = await cat.insertProduct(c.env.DB, {
    slug: await uniqueSlug(c.env.DB, slugify(name), null), categoryId: ct.category.id, templateId: ct.templateId, name, code: productCodeFromName(name),
    shippingProfile: t.defaultShippingProfile, brand: b.isOriginal ? 'Abs Vai' : null, isOriginal: Boolean(b.isOriginal),
  });
  await audit(c, 'product.create', 'product', id, { name });
  return c.json({ id }, 201);
});

interface VariantIn {
  id: number | null; attributes: Record<string, string>; pricePaisa: number; compareAtPricePaisa: number | null; costPaisa: number | null; stock: number; packedWeightGrams: number;
  netValue: number | null; netUnit: string | null; sku: string; gtin: string | null; shelfLocation: string | null; wholesaleTiers: Array<{ minQty: number; pricePaisa: number }>; imageIds: number[]; isActive: boolean;
}

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
    let netUnit = ['g', 'kg', 'ml', 'l', 'm', 'pcs'].includes(String(v.netUnit)) ? String(v.netUnit) : null;
    if (!netValue) {
      // Fill net quantity from a weight/volume/length/pack value like "500g", "1l" or "2.5m" so staff don't type it twice.
      const parsed = Object.values(attributes).map(parseNetQuantity).find(Boolean);
      if (parsed) { netValue = parsed.value; netUnit = parsed.unit; }
    }
    const gtin = str(v.gtin, 14).replace(/\s/g, '') || null;
    if (gtin && !validGtin(gtin)) throw bad(`Option ${i + 1}: GTIN ${gtin} is not a valid GS1 barcode number. Check the digits, or leave it empty.`);
    const tiers = Array.isArray(v.wholesaleTiers) ? (v.wholesaleTiers as Array<Record<string, unknown>>).map(t => ({ minQty: int(t.minQty) ?? 0, pricePaisa: int(t.pricePaisa) ?? 0 })).filter(t => t.minQty > 1 && t.pricePaisa > 0).slice(0, 5) : [];
    const cost = v.costPaisa === null || v.costPaisa === undefined || v.costPaisa === '' ? null : nonNeg(v.costPaisa, 'cost');
    return {
      id: posInt(v.id), attributes, pricePaisa: nonNeg(v.pricePaisa, 'price'), compareAtPricePaisa: posInt(v.compareAtPricePaisa), costPaisa: cost, stock: nonNeg(v.stock, 'stock'),
      packedWeightGrams: nonNeg(v.packedWeightGrams, 'packed weight'), netValue, netUnit, sku: str(v.sku, 60).toUpperCase(), gtin, shelfLocation: str(v.shelfLocation, 30) || null, wholesaleTiers: tiers,
      imageIds: Array.isArray(v.imageIds) ? (v.imageIds as unknown[]).map(Number).filter(n => Number.isInteger(n)).slice(0, 10) : [], isActive: v.isActive !== false,
    };
  });
}

adminCatalog.put('/products/:id', need('catalog:write'), async c => {
  const id = posInt(c.req.param('id'));
  if (!id) throw notFound();
  const db = c.env.DB;
  const b = await readJson(c);
  const existing = await cat.productRow(db, id);
  if (!existing) throw notFound();

  const ct = await categoryTemplate(db, posInt(b.categoryId) ?? Number(existing.category_id));
  if (!ct) throw bad('Pick a category.');
  if (ct.templateId !== existing.template_id && existing.status !== 'draft') throw bad('Live products can only move to a category with the same template.');
  const template = await loadTemplate(db, ct.templateId);
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

  // SKUs (and so barcodes): generate any that are blank, then check they are unique across the store.
  const existingVariants = await cat.variantsOfProduct(db, id);
  const byId = new Map(existingVariants.map(v => [v.id, v]));
  for (const v of variants) {
    if (v.id && !byId.has(v.id)) throw bad('An option belongs to another product. Reload the page.');
    if (!v.sku) v.sku = formatSku(ct.code, code, variantCode(v.attributes), await nextSkuSequence(db, ct.code));
    if (!SKU_PATTERN.test(v.sku)) throw bad(`SKU "${v.sku}" should look like ${ct.code}-${code}-500G-0001.`);
    const before = v.id ? byId.get(v.id)! : null;
    if (before && v.stock < before.reserved) throw bad(`${v.sku}: ${before.reserved} are held by confirmed orders, so stock can't go below that.`);
    // Cost price is Owner/Accountant only: other roles keep whatever is saved.
    if (!allowed(c, 'cost:read')) v.costPaisa = before?.cost_paisa ?? null;
  }
  const skus = variants.map(v => v.sku);
  if (new Set(skus).size !== skus.length) throw bad('Two options have the same SKU.');
  const clash = await cat.skusTakenElsewhere(db, skus, id);
  if (clash.length) throw bad(`SKU ${clash[0]} is already used by another product.`);
  const gtins = variants.map(v => v.gtin).filter((g): g is string => Boolean(g));
  if (new Set(gtins).size !== gtins.length) throw bad('Two options have the same GTIN.');
  const gtinClash = await cat.gtinsTakenElsewhere(db, gtins, id);
  if (gtinClash.length) throw bad(`GTIN ${gtinClash[0]} is already used by another product.`);

  // Live products must keep passing the checklist.
  const productLike = {
    name, slug, shortDescription: str(b.shortDescription, 300), brand: str(b.brand, 80), description: str(b.description, 10000), benefitChips: chips,
    fulfilmentMode: fulfilment as 'in_stock', preorderDispatchDate: str(b.preorderDispatchDate, 10) || null, preorderAdvanceType: str(b.preorderAdvanceType, 20) || null,
    preorderAdvancePaisa: int(b.preorderAdvancePaisa), madeToOrderLeadDays: int(b.madeToOrderLeadDays), promotedSpecKeys: promoted, sizeChart, imageCount: await cat.imageCount(db, id),
  };
  const checklist = publishChecklist(template, productLike, specs, variants.filter(v => v.isActive));
  if ((existing.status === 'published' || existing.status === 'scheduled') && !checklist.ready) {
    throw new HttpError(409, `This product is live. ${checklist.items.find(i => !i.ok)!.message}`, { checklist });
  }

  const keep = new Set(variants.filter(v => v.id).map(v => v.id!));
  try {
    await cat.saveProduct(db, {
      id, adminId: c.var.session.adminId, batchNo: specs.batch_no ?? null,
      fields: {
        category_id: ct.category.id, template_id: ct.templateId, name, slug, code, short_description: productLike.shortDescription || null, description: productLike.description || null,
        brand: productLike.brand || null, is_original: b.isOriginal ? 1 : 0, show_on_home: b.showOnHome ? 1 : 0, benefit_chips: JSON.stringify(chips), fulfilment_mode: fulfilment,
        preorder_dispatch_date: productLike.preorderDispatchDate, preorder_advance_type: productLike.preorderAdvanceType, preorder_advance_paisa: productLike.preorderAdvancePaisa,
        made_to_order_lead_days: productLike.madeToOrderLeadDays, shipping_profile: shipping, bulky_delivery_mode: b.bulkyDeliveryMode === 'confirm_by_phone' ? 'confirm_by_phone' : 'zone_fixed',
        free_delivery: b.freeDelivery ? 1 : 0, video_url: video || null, promoted_spec_keys: JSON.stringify(promoted), size_chart: sizeChart ? JSON.stringify(sizeChart) : null,
        search_keywords: str(b.searchKeywords, 300) || null, meta_title: str(b.metaTitle, 120) || null, meta_description: str(b.metaDescription, 300) || null,
      },
      specs,
      seasonIds: Array.isArray(b.seasonIds) ? (b.seasonIds as unknown[]).map(Number).filter(n => Number.isInteger(n) && n > 0) : [],
      removedVariantIds: existingVariants.filter(v => !keep.has(v.id)).map(v => v.id),
      variants: variants.map((v, i) => ({
        id: v.id, sku: v.sku, attributes: v.attributes, attributesKey: attributesKey(v.attributes) + (v.isActive ? '' : `#off${i}`), pricePaisa: v.pricePaisa,
        compareAtPricePaisa: v.compareAtPricePaisa, costPaisa: v.costPaisa, wholesaleTiers: v.wholesaleTiers, stock: v.stock, packedWeightGrams: v.packedWeightGrams,
        netValue: v.netValue, netUnit: v.netUnit, imageIds: v.imageIds, isActive: v.isActive, sortOrder: i, gtin: v.gtin, shelfLocation: v.shelfLocation,
        stockChange: v.id ? v.stock - byId.get(v.id)!.stock : 0,
      })),
    });
  } catch (e) {
    if (/UNIQUE constraint failed: product_variants.sku/.test(String(e))) throw bad('One of the SKUs is already used. Leave SKU empty to generate a new one.');
    if (/UNIQUE constraint failed: product_variants.gtin/.test(String(e))) throw bad('One of the GTINs is already used by another product.');
    if (/UNIQUE constraint failed: product_variants.product_id/.test(String(e))) throw bad('Two options have exactly the same choices.');
    if (/CHECK constraint failed/.test(String(e))) throw bad('Stock cannot go below what confirmed orders are holding.');
    throw e;
  }
  await audit(c, 'product.update', 'product', id, { name, variants: variants.length });
  await catalogChanged(c, [...new Set([...(await productTags(db, id, ct.category.id)), ...(await productTags(db, id, Number(existing.category_id)))])]);
  return c.json(await loadAdminProduct(c, id));
});

adminCatalog.post('/products/:id/publish', need('catalog:write'), async c => {
  const id = posInt(c.req.param('id')) ?? 0;
  const b = await readJson(c);
  const data = await loadAdminProduct(c, id);
  if (!data.checklist.ready) throw new HttpError(409, data.checklist.items.find(i => !i.ok)!.message, { checklist: data.checklist });
  const at = str(b.publishAt, 30);
  const scheduled = Boolean(at && Date.parse(at) > Date.now());
  await cat.setPublishState(c.env.DB, id, scheduled ? 'scheduled' : 'published', scheduled ? new Date(at).toISOString() : null);
  await audit(c, scheduled ? 'product.schedule' : 'product.publish', 'product', id, scheduled ? { at } : undefined);
  await catalogChanged(c, await productTags(c.env.DB, id, Number(data.product.category_id)));
  return c.json({ ok: true, status: scheduled ? 'scheduled' : 'published' });
});

adminCatalog.post('/products/:id/unpublish', need('catalog:write'), async c => {
  const id = posInt(c.req.param('id')) ?? 0;
  const p = await cat.productRow(c.env.DB, id);
  await cat.setPublishState(c.env.DB, id, 'draft', null);
  await audit(c, 'product.unpublish', 'product', id);
  await catalogChanged(c, await productTags(c.env.DB, id, p ? Number(p.category_id) : null));
  return c.json({ ok: true });
});

/** Copies everything except SKUs, barcodes and stock. */
adminCatalog.post('/products/:id/duplicate', need('catalog:write'), async c => {
  const id = posInt(c.req.param('id')) ?? 0;
  const db = c.env.DB;
  const p = await cat.productRow(db, id);
  if (!p) throw notFound();
  const code = await cat.categoryCode(db, Number(p.category_id));
  const skus = new Map<number, string>();
  for (const v of await cat.activeVariantsForCopy(db, id)) {
    skus.set(v.id, formatSku(code!, String(p.code), variantCode(parseJson<Record<string, string>>(v.attributes, {})), await nextSkuSequence(db, code!)));
  }
  const newId = await cat.duplicateProduct(db, id, await uniqueSlug(db, `${p.slug}-copy`, null), skus);
  await audit(c, 'product.duplicate', 'product', newId, { from: id });
  return c.json({ id: newId }, 201);
});

adminCatalog.delete('/products/:id', need('catalog:write'), async c => {
  const id = posInt(c.req.param('id')) ?? 0;
  const p = await cat.productRow(c.env.DB, id);
  await cat.trashProduct(c.env.DB, id);
  await audit(c, 'product.trash', 'product', id);
  await catalogChanged(c, await productTags(c.env.DB, id, p ? Number(p.category_id) : null));
  return c.json({ ok: true });
});

adminCatalog.post('/products/:id/restore', need('catalog:write'), async c => {
  const id = posInt(c.req.param('id')) ?? 0;
  await cat.restoreProduct(c.env.DB, id);
  await audit(c, 'product.restore', 'product', id);
  return c.json({ ok: true });
});

adminCatalog.get('/products-trash', need('catalog:read'), async c => c.json(await cat.listTrash(c.env.DB)));

adminCatalog.post('/skus/check', need('catalog:read'), async c => {
  const b = await readJson(c);
  const skus = Array.isArray(b.skus) ? (b.skus as unknown[]).map(s => str(s, 60).toUpperCase()).filter(Boolean).slice(0, 200) : [];
  if (!skus.length) return c.json({ taken: [] });
  return c.json({ taken: await cat.skusTakenElsewhere(c.env.DB, skus, posInt(b.productId) ?? 0), invalid: skus.filter(s => !SKU_PATTERN.test(s)) });
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
  const p = await cat.productRow(c.env.DB, productId);
  if (!p) throw notFound();
  const media = mediaBucket(c.env);
  const key = `p/${productId}/${crypto.randomUUID()}.${ext}`;
  // R2 needs a known length; a FormData file stream has none, so read it (files are capped at 8 MB above).
  await media.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type, cacheControl: 'public, max-age=31536000, immutable' } });
  const r = await cat.insertMedia(c.env.DB, { productId, kind, key, url: `/media/${key}`, alt: str(form.get('alt'), 200) || null, width: int(form.get('width')), height: int(form.get('height')), sortOrder: await cat.nextMediaSort(c.env.DB, productId) });
  await audit(c, 'media.upload', 'product', productId, { kind, key });
  await catalogChanged(c, await productTags(c.env.DB, productId, Number(p.category_id)));
  return c.json(r, 201);
});

adminCatalog.delete('/media/:id', need('catalog:write'), async c => {
  const id = posInt(c.req.param('id')) ?? 0;
  const m = await cat.mediaById(c.env.DB, id);
  if (!m) throw notFound();
  if (await cat.mediaSupportsClaim(c.env.DB, id)) throw bad('This document supports a claim badge. Remove the badge first.');
  await cat.deleteMedia(c.env.DB, id);
  if (m.r2_key && c.env.MEDIA && !(await cat.r2KeyInUse(c.env.DB, m.r2_key))) await c.env.MEDIA.delete(m.r2_key);
  await audit(c, 'media.delete', 'product', m.product_id, { id });
  await catalogChanged(c, await productTags(c.env.DB, m.product_id, null));
  return c.json({ ok: true });
});

adminCatalog.put('/products/:id/media-order', need('catalog:write'), async c => {
  const b = await readJson(c);
  const id = posInt(c.req.param('id')) ?? 0;
  await cat.reorderMedia(c.env.DB, id, Array.isArray(b.ids) ? (b.ids as unknown[]).map(Number).filter(Number.isInteger) : []);
  await catalogChanged(c, await productTags(c.env.DB, id, null));
  return c.json({ ok: true });
});

// ───────────── Claim badges (earned, not typed) ─────────────

adminCatalog.post('/products/:id/claims', need('catalog:write'), async c => {
  const id = posInt(c.req.param('id')) ?? 0;
  const b = await readJson(c);
  const claim = str(b.claim, 40);
  if (!CLAIM_BADGES.includes(claim)) throw bad(`Choose one of: ${CLAIM_BADGES.join(', ')}.`);
  if (healthClaimIn(claim)) throw bad('Health claims are not allowed.');
  const docId = posInt(b.documentMediaId) ?? 0;
  if (!(await cat.claimDocumentExists(c.env.DB, docId, id))) throw bad('Attach the supporting document or supplier declaration first.');
  await cat.upsertClaim(c.env.DB, id, claim, docId, c.var.session.adminId);
  await audit(c, 'claim.add', 'product', id, { claim });
  await catalogChanged(c, await productTags(c.env.DB, id, null));
  return c.json({ ok: true });
});

adminCatalog.delete('/products/:id/claims/:claim', need('catalog:write'), async c => {
  const id = posInt(c.req.param('id')) ?? 0;
  await cat.deleteClaim(c.env.DB, id, decodeURIComponent(c.req.param('claim')));
  await audit(c, 'claim.remove', 'product', id, { claim: c.req.param('claim') });
  await catalogChanged(c, await productTags(c.env.DB, id, null));
  return c.json({ ok: true });
});

// ───────────── CSV import (always creates drafts) ─────────────

adminCatalog.post('/products/import', need('catalog:write'), async c => {
  const db = c.env.DB;
  const b = await readJson(c);
  const ct = await categoryTemplate(db, posInt(b.categoryId) ?? 0);
  if (!ct) throw bad('Pick the category to import into.');
  const template = await loadTemplate(db, ct.templateId);
  if (!template) throw bad('Template missing.');
  const rows = parseCsv(str(b.csv, 2_000_000));
  if (rows.length < 2) throw bad('The file has no product rows.');
  const header = rows[0].map(h => h.trim());
  const expected = csvColumns(template).filter(col => col !== 'cost_taka');
  const missing = expected.filter(col => !header.includes(col));
  if (missing.length) throw bad(`This CSV does not match the ${template.name} template. Missing columns: ${missing.slice(0, 5).join(', ')}. Download the template again.`);
  const col = (r: string[], name: string) => (header.includes(name) ? (r[header.indexOf(name)] ?? '').trim() : '');
  const groups = new Map<string, string[][]>();
  for (const r of rows.slice(1)) {
    const n = col(r, 'product_name');
    if (n) groups.set(n, [...(groups.get(n) ?? []), r]);
  }
  const showCost = allowed(c, 'cost:read');
  const errors: Array<{ product: string; message: string }> = [];
  let created = 0;
  for (const [name, rs] of groups) {
    let productId: number | null = null;
    try {
      const first = rs[0];
      const code = (col(first, 'product_code').toUpperCase().replace(/[^A-Z0-9]/g, '') || productCodeFromName(name)).slice(0, 8);
      productId = await cat.insertProduct(db, {
        slug: await uniqueSlug(db, slugify(name), null), categoryId: ct.category.id, templateId: ct.templateId, name, code, shippingProfile: template.defaultShippingProfile,
        brand: col(first, 'brand') || null, isOriginal: false, shortDescription: col(first, 'short_description') || null, description: col(first, 'description') || null,
      });
      const specs: Array<[string, string]> = [];
      for (const f of template.specFields) {
        const v = col(first, `spec_${f.key}`);
        if (v && !validateSpecValue(f, v)) specs.push([f.key, v]);
      }
      const taka = (s: string) => (/^\d+(\.\d{1,2})?$/.test(s) ? Math.round(Number(s) * 100) : null);
      const variants = [];
      for (const r of rs) {
        const attrs: Record<string, string> = {};
        for (const a of template.variantAttributes) { const v = col(r, `option_${a.attributeTypeId}`); if (v) attrs[a.attributeTypeId] = v; }
        const net = parseNetQuantity(col(r, 'net_quantity')) ?? Object.values(attrs).map(parseNetQuantity).find(Boolean) ?? null;
        variants.push({
          sku: col(r, 'sku').toUpperCase() || formatSku(ct.code, code, variantCode(attrs), await nextSkuSequence(db, ct.code)), attributes: attrs, attributesKey: attributesKey(attrs),
          pricePaisa: taka(col(r, 'price_taka')) ?? 0, compareAtPricePaisa: taka(col(r, 'compare_at_taka')), costPaisa: showCost ? taka(col(r, 'cost_taka')) : null,
          stock: Math.max(0, Number(col(r, 'stock')) || 0), packedWeightGrams: Math.max(0, Number(col(r, 'packed_weight_grams')) || 0), netValue: net?.value ?? null, netUnit: net?.unit ?? null,
        });
      }
      await cat.insertImportedRows(db, productId, specs, variants);
      created++;
    } catch (e) {
      if (productId) await cat.deleteProductHard(db, productId);
      errors.push({ product: name, message: /UNIQUE/.test(String(e)) ? 'A SKU or option is duplicated.' : String((e as Error).message ?? e) });
    }
  }
  await audit(c, 'product.import', 'category', ct.category.id, { created, errors: errors.length });
  return c.json({ created, errors });
});

// Seasons list for the product form's season picker.
adminCatalog.get('/season-options', need('catalog:read'), async c => c.json((await getSeasons(c.env.DB)).map(s => ({ id: s.id, name: s.name, starts_on: s.starts_on, ends_on: s.ends_on }))));
