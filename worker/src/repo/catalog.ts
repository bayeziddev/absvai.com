/** Storefront catalog queries. Everything shown to customers is computed from templates, seasons and variants here. */
import { bdDate } from '../lib/dates';
import { parseJson } from '../lib/http';
import { formatUnitPrice, unitPrice, type NetUnit } from '../lib/money';
import { categoryVisible, isSeasonActive, productAvailability, type Availability, type SeasonRow } from '../lib/seasons';
import { likeEscape } from '../lib/search';
import { cardKeySpecLine, type ProductTemplate } from '../lib/templates';
import { loadTemplate } from './templates';

export interface Variant {
  id: number;
  sku: string;
  attributes: Record<string, string>;
  pricePaisa: number;
  compareAtPricePaisa: number | null;
  wholesaleTiers: Array<{ minQty: number; pricePaisa: number }>;
  /** On hand in the warehouse. */
  stock: number;
  /** Held by confirmed orders that have not left with the courier yet. */
  reserved: number;
  /** What customers can still order: stock − reserved. */
  available: number;
  packedWeightGrams: number;
  netValue: number | null;
  netUnit: NetUnit | null;
  imageIds: number[];
  isActive: boolean;
  costPaisa: number | null;
  gtin: string | null;
  shelfLocation: string | null;
}

export interface ProductCard {
  id: number;
  slug: string;
  name: string;
  shortDescription: string;
  categorySlug: string;
  categoryName: string;
  image: string;
  alt: string;
  pricePaisa: number;
  compareAtPaisa: number | null;
  savePaisa: number;
  unitPriceText: string;
  keySpecs: string;
  isOriginal: boolean;
  freeDelivery: boolean;
  availability: Availability;
  variantCount: number;
  defaultVariantId: number | null;
}

const templateCache = new Map<string, { t: ProductTemplate; at: number }>();

export async function getTemplate(db: D1Database, id: string): Promise<ProductTemplate | null> {
  const hit = templateCache.get(id);
  if (hit && Date.now() - hit.at < 30_000) return hit.t;
  const t = await loadTemplate(db, id);
  if (t) templateCache.set(id, { t, at: Date.now() });
  return t;
}

export function clearTemplateCache() {
  templateCache.clear();
}

export async function getSeasons(db: D1Database): Promise<SeasonRow[]> {
  const r = await db.prepare('SELECT * FROM seasons ORDER BY sort_order').all<SeasonRow>();
  return r.results;
}

export function rowToVariant(v: Record<string, unknown>): Variant {
  return {
    id: Number(v.id),
    sku: String(v.sku),
    attributes: typeof v.attributes === 'string' ? parseJson(v.attributes, {}) : (v.attributes as Record<string, string>) ?? {},
    pricePaisa: Number(v.price_paisa),
    compareAtPricePaisa: v.compare_at_price_paisa == null ? null : Number(v.compare_at_price_paisa),
    wholesaleTiers: typeof v.wholesale_tiers === 'string' ? parseJson(v.wholesale_tiers, []) : (v.wholesale_tiers as Variant['wholesaleTiers']) ?? [],
    stock: Number(v.stock),
    reserved: Number(v.reserved ?? 0),
    available: Math.max(0, Number(v.stock) - Number(v.reserved ?? 0)),
    packedWeightGrams: Number(v.packed_weight_grams),
    netValue: v.net_value == null ? null : Number(v.net_value),
    netUnit: (v.net_unit as NetUnit) ?? null,
    imageIds: typeof v.image_ids === 'string' ? parseJson(v.image_ids, []) : (v.image_ids as number[]) ?? [],
    isActive: Boolean(v.is_active ?? 1),
    costPaisa: v.cost_paisa == null ? null : Number(v.cost_paisa),
    gtin: (v.gtin as string) ?? null,
    shelfLocation: (v.shelf_location as string) ?? null,
  };
}

export const PUBLISHED_SQL = "p.deleted_at IS NULL AND (p.status = 'published' OR (p.status = 'scheduled' AND p.publish_at <= ?))";

export interface ProductQuery {
  categoryIds?: number[];
  productIds?: number[];
  terms?: string[];
  seasonIds?: number[];
  originals?: boolean;
  featured?: boolean;
  deals?: boolean;
  freeDelivery?: boolean;
  newSinceIso?: string;
  specFilters?: Record<string, string[]>;
  attrFilters?: Record<string, string[]>;
  minPricePaisa?: number;
  maxPricePaisa?: number;
  sort?: 'default' | 'price_asc' | 'price_desc' | 'newest' | 'best_selling' | 'discount';
  limit?: number;
  offset?: number;
  excludeId?: number;
}

const KEY_RE = /^[a-z][a-z0-9_]{0,40}$/;

export async function queryProducts(db: D1Database, q: ProductQuery, now = new Date()): Promise<{ items: ProductCard[]; total: number }> {
  const where: string[] = [PUBLISHED_SQL];
  const params: unknown[] = [now.toISOString()];
  const inList = (col: string, ids: number[]) => { where.push(`${col} IN (${ids.map(() => '?').join(',')})`); params.push(...ids); };

  if (q.categoryIds?.length) inList('p.category_id', q.categoryIds);
  if (q.productIds?.length) inList('p.id', q.productIds);
  if (q.seasonIds) {
    if (!q.seasonIds.length) return { items: [], total: 0 };
    where.push(`EXISTS (SELECT 1 FROM product_seasons ps WHERE ps.product_id = p.id AND ps.season_id IN (${q.seasonIds.map(() => '?').join(',')}))`);
    params.push(...q.seasonIds);
  }
  if (q.originals) where.push('p.is_original = 1');
  if (q.featured) where.push('p.show_on_home = 1');
  if (q.freeDelivery) where.push('p.free_delivery = 1');
  if (q.newSinceIso) { where.push('p.published_at >= ?'); params.push(q.newSinceIso); }
  if (q.deals) where.push('EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1 AND v.compare_at_price_paisa > v.price_paisa)');
  if (q.excludeId) { where.push('p.id != ?'); params.push(q.excludeId); }
  if (q.terms?.length) {
    const ors = q.terms.map(() => "(p.name LIKE ? ESCAPE '\\' OR p.short_description LIKE ? ESCAPE '\\' OR p.search_keywords LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\')");
    where.push(`(${ors.join(' OR ')})`);
    for (const t of q.terms) { const l = `%${likeEscape(t)}%`; params.push(l, l, l, l); }
  }
  for (const [key, values] of Object.entries(q.specFilters ?? {})) {
    if (!KEY_RE.test(key) || !values.length) continue;
    where.push(`EXISTS (SELECT 1 FROM product_spec_values s WHERE s.product_id = p.id AND s.field_key = ? AND s.value IN (${values.map(() => '?').join(',')}))`);
    params.push(key, ...values);
  }
  for (const [key, values] of Object.entries(q.attrFilters ?? {})) {
    if (!KEY_RE.test(key) || !values.length) continue;
    where.push(`EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1 AND json_extract(v.attributes, ?) IN (${values.map(() => '?').join(',')}))`);
    params.push(`$.${key}`, ...values);
  }
  const minPrice = '(SELECT MIN(v.price_paisa) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1)';
  if (q.minPricePaisa) { where.push(`${minPrice} >= ?`); params.push(q.minPricePaisa); }
  if (q.maxPricePaisa) { where.push(`${minPrice} <= ?`); params.push(q.maxPricePaisa); }

  const order = {
    default: 'p.sold_count DESC, p.published_at DESC',
    best_selling: 'p.sold_count DESC',
    newest: 'p.published_at DESC, p.id DESC',
    price_asc: 'min_price ASC',
    price_desc: 'min_price DESC',
    discount: 'max_saving DESC',
  }[q.sort ?? 'default'];

  const whereSql = where.join(' AND ');
  const limit = Math.min(Math.max(q.limit ?? 20, 1), 60);
  const offset = Math.max(q.offset ?? 0, 0);
  const [rows, count] = await db.batch([
    db.prepare(
      `SELECT p.*, c.slug AS category_slug, c.name AS category_name, ${minPrice} AS min_price,
         (SELECT MAX(v.compare_at_price_paisa - v.price_paisa) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1) AS max_saving,
         (SELECT url FROM product_media m WHERE m.product_id = p.id AND m.kind = 'image' ORDER BY m.sort_order, m.id LIMIT 1) AS image_url,
         (SELECT json_group_array(json_object('id', v.id, 'sku', v.sku, 'attributes', json(v.attributes), 'price_paisa', v.price_paisa,
             'compare_at_price_paisa', v.compare_at_price_paisa, 'stock', v.stock, 'reserved', v.reserved, 'packed_weight_grams', v.packed_weight_grams,
             'net_value', v.net_value, 'net_unit', v.net_unit, 'wholesale_tiers', json(v.wholesale_tiers), 'image_ids', json(v.image_ids)))
            FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1) AS variants_json,
         (SELECT json_group_object(s.field_key, s.value) FROM product_spec_values s WHERE s.product_id = p.id) AS specs_json,
         (SELECT json_group_array(ps.season_id) FROM product_seasons ps WHERE ps.product_id = p.id) AS season_ids
       FROM products p JOIN categories c ON c.id = p.category_id
       WHERE ${whereSql} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`,
    ).bind(...params),
    db.prepare(`SELECT COUNT(*) AS n FROM products p JOIN categories c ON c.id = p.category_id WHERE ${whereSql}`).bind(...params),
  ]);
  const seasons = await getSeasons(db);
  const today = bdDate(now);
  const items: ProductCard[] = [];
  for (const r of rows.results as Array<Record<string, unknown>>) {
    const template = await getTemplate(db, String(r.template_id));
    if (!template) continue;
    items.push(toCard(r, template, seasons, today));
  }
  return { items, total: Number((count.results[0] as { n: number })?.n ?? 0) };
}

export function toCard(r: Record<string, unknown>, template: ProductTemplate, seasons: SeasonRow[], today: string): ProductCard {
  const variants = parseJson<Array<Record<string, unknown>>>(r.variants_json, []).map(rowToVariant);
  const specs = parseJson<Record<string, string>>(r.specs_json, {});
  const seasonIds = parseJson<number[]>(r.season_ids, []);
  const linked = seasons.filter(s => seasonIds.includes(s.id));
  const cheapest = [...variants].sort((a, b) => a.pricePaisa - b.pricePaisa)[0] ?? null;
  const stock = variants.reduce((s, v) => s + v.available, 0);
  const availability = productAvailability(r as { fulfilment_mode: string }, linked, stock, today);
  const compare = cheapest?.compareAtPricePaisa && cheapest.compareAtPricePaisa > cheapest.pricePaisa ? cheapest.compareAtPricePaisa : null;
  return {
    id: Number(r.id),
    slug: String(r.slug),
    name: String(r.name),
    shortDescription: String(r.short_description ?? ''),
    categorySlug: String(r.category_slug),
    categoryName: String(r.category_name),
    image: String(r.image_url ?? '/img/placeholders/none.svg'),
    alt: String(r.name),
    pricePaisa: cheapest?.pricePaisa ?? 0,
    compareAtPaisa: compare,
    savePaisa: compare && cheapest ? compare - cheapest.pricePaisa : 0,
    unitPriceText: cheapest ? formatUnitPrice(unitPrice(cheapest.pricePaisa, cheapest.netValue, cheapest.netUnit)) : '',
    keySpecs: cardKeySpecLine(template, specs, cheapest),
    isOriginal: Boolean(r.is_original),
    freeDelivery: Boolean(r.free_delivery),
    availability,
    variantCount: variants.length,
    defaultVariantId: variants.length === 1 ? variants[0].id : cheapest?.id ?? null,
  };
}

export interface ProductDetail {
  product: Record<string, unknown>;
  template: ProductTemplate;
  category: { id: number; slug: string; name: string; parent: { slug: string; name: string } | null };
  variants: Variant[];
  specs: Record<string, string>;
  media: Array<{ id: number; url: string; alt: string | null; kind: string }>;
  seasons: SeasonRow[];
  claims: Array<{ claim: string }>;
  availabilityByVariant: Record<number, Availability>;
  availability: Availability;
  benefitChips: string[];
  promotedSpecKeys: string[];
  sizeChart: { columns: string[]; rows: Array<{ size: string; values: string[] }> } | null;
}

export async function getProductDetail(db: D1Database, slug: string, opts: { preview?: boolean; now?: Date } = {}): Promise<ProductDetail | null> {
  const now = opts.now ?? new Date();
  const product = await db.prepare(
    `SELECT p.*, c.slug AS category_slug, c.name AS category_name, c.id AS cat_id, pc.slug AS parent_slug, pc.name AS parent_name
       FROM products p JOIN categories c ON c.id = p.category_id LEFT JOIN categories pc ON pc.id = c.parent_id
      WHERE p.slug = ? AND ${opts.preview ? 'p.deleted_at IS NULL' : PUBLISHED_SQL}`,
  ).bind(...(opts.preview ? [slug] : [slug, now.toISOString()])).first<Record<string, unknown>>();
  if (!product) return null;
  const id = Number(product.id);
  const [variants, specs, media, seasonIds, claims] = await db.batch([
    db.prepare('SELECT * FROM product_variants WHERE product_id = ? AND is_active = 1 ORDER BY sort_order, id').bind(id),
    db.prepare('SELECT field_key, value FROM product_spec_values WHERE product_id = ?').bind(id),
    db.prepare("SELECT id, url, alt, kind FROM product_media WHERE product_id = ? ORDER BY sort_order, id").bind(id),
    db.prepare('SELECT season_id FROM product_seasons WHERE product_id = ?').bind(id),
    db.prepare('SELECT claim FROM product_claims WHERE product_id = ?').bind(id),
  ]);
  const template = await getTemplate(db, String(product.template_id));
  if (!template) return null;
  const allSeasons = await getSeasons(db);
  const ids = (seasonIds.results as Array<{ season_id: number }>).map(r => r.season_id);
  const linked = allSeasons.filter(s => ids.includes(s.id));
  const vs = (variants.results as Array<Record<string, unknown>>).map(rowToVariant);
  const today = bdDate(now);
  const availabilityByVariant: Record<number, Availability> = {};
  for (const v of vs) availabilityByVariant[v.id] = productAvailability(product as { fulfilment_mode: string }, linked, v.available, today);
  const totalStock = vs.reduce((s, v) => s + v.available, 0);
  return {
    product,
    template,
    category: {
      id: Number(product.cat_id), slug: String(product.category_slug), name: String(product.category_name),
      parent: product.parent_slug ? { slug: String(product.parent_slug), name: String(product.parent_name) } : null,
    },
    variants: vs,
    specs: Object.fromEntries((specs.results as Array<{ field_key: string; value: string }>).map(s => [s.field_key, s.value])),
    media: media.results as ProductDetail['media'],
    seasons: linked,
    claims: claims.results as Array<{ claim: string }>,
    availabilityByVariant,
    availability: productAvailability(product as { fulfilment_mode: string }, linked, totalStock, today),
    benefitChips: parseJson<string[]>(product.benefit_chips, []),
    promotedSpecKeys: parseJson<string[]>(product.promoted_spec_keys, []),
    sizeChart: parseJson(product.size_chart, null),
  };
}

export interface CategoryNode { id: number; slug: string; name: string; icon: string; description: string; templateId: string; ownTemplateId: string | null; depth: number; seasonIds: number[]; children: CategoryNode[]; parentId: number | null; visible: boolean }

export async function getCategoryTree(db: D1Database, now = new Date()): Promise<CategoryNode[]> {
  const [cats, links] = await db.batch([
    db.prepare('SELECT * FROM categories WHERE is_active = 1 AND deleted_at IS NULL ORDER BY sort_order, name'),
    db.prepare('SELECT category_id, season_id FROM category_seasons'),
  ]);
  const seasons = await getSeasons(db);
  const today = bdDate(now);
  const linkMap = new Map<number, number[]>();
  for (const l of links.results as Array<{ category_id: number; season_id: number }>) linkMap.set(l.category_id, [...(linkMap.get(l.category_id) ?? []), l.season_id]);
  const nodes = (cats.results as Array<Record<string, unknown>>).map<CategoryNode>(c => ({
    id: Number(c.id), slug: String(c.slug), name: String(c.name), icon: String(c.icon_url ?? '/img/placeholders/none.svg'),
    description: String(c.description ?? ''), templateId: String(c.template_id ?? ''), ownTemplateId: (c.template_id as string) ?? null, depth: Number(c.depth ?? 1), seasonIds: linkMap.get(Number(c.id)) ?? [],
    parentId: c.parent_id == null ? null : Number(c.parent_id),
    children: [], visible: categoryVisible(c as { season_visibility: string }, seasons.filter(s => (linkMap.get(Number(c.id)) ?? []).includes(s.id)), today),
  }));
  const byId = new Map(nodes.map(n => [n.id, n]));
  // A child category inherits its parent's template unless it sets its own.
  const resolve = (n: CategoryNode, guard = 0): string => n.ownTemplateId ?? (n.parentId && guard < 3 && byId.get(n.parentId) ? resolve(byId.get(n.parentId)!, guard + 1) : '');
  for (const n of nodes) n.templateId = resolve(n);
  const roots: CategoryNode[] = [];
  for (const n of nodes) {
    if (n.parentId && byId.get(n.parentId)) byId.get(n.parentId)!.children.push(n);
    else if (!n.parentId) roots.push(n);
  }
  return roots;
}

export function visibleTree(tree: CategoryNode[]): CategoryNode[] {
  return tree.filter(n => n.visible).map(n => ({ ...n, children: visibleTree(n.children) }));
}

export function flatten(tree: CategoryNode[]): CategoryNode[] {
  return tree.flatMap(n => [n, ...flatten(n.children)]);
}

/** Active seasons first (their categories move to the front of the carousel). */
export function activeSeasonIds(seasons: SeasonRow[], now = new Date()): number[] {
  const today = bdDate(now);
  return seasons.filter(s => isSeasonActive(s, today)).map(s => s.id);
}

export async function seasonalCategoryIds(db: D1Database, seasonIds: number[]): Promise<Set<number>> {
  if (!seasonIds.length) return new Set();
  const r = await db.prepare(`SELECT DISTINCT category_id FROM category_seasons WHERE season_id IN (${seasonIds.map(() => '?').join(',')})`).bind(...seasonIds).all<{ category_id: number }>();
  return new Set(r.results.map(x => x.category_id));
}

export async function synonymGroups(db: D1Database): Promise<Map<string, string[]>> {
  const r = await db.prepare('SELECT group_key, term FROM search_synonyms').all<{ group_key: string; term: string }>();
  const m = new Map<string, string[]>();
  for (const s of r.results) m.set(s.group_key, [...(m.get(s.group_key) ?? []), s.term]);
  return m;
}

/** Listing filters come from the category's template: filterable spec fields + variant attributes, with real counts. */
export async function facets(db: D1Database, categoryIds: number[], template: ProductTemplate, now = new Date()): Promise<Array<{ key: string; label: string; kind: 'f' | 'a'; values: Array<{ value: string; count: number; label?: string }> }>> {
  if (!categoryIds.length) return [];
  const inCats = categoryIds.map(() => '?').join(',');
  const specKeys = template.specFields.filter(f => f.filterable).map(f => f.key);
  const out: Array<{ key: string; label: string; kind: 'f' | 'a'; values: Array<{ value: string; count: number; label?: string }> }> = [];
  const stmts: D1PreparedStatement[] = [
    db.prepare(`SELECT j.key AS k, j.value AS v, COUNT(DISTINCT p.id) AS n FROM products p JOIN product_variants pv ON pv.product_id = p.id AND pv.is_active = 1, json_each(pv.attributes) j
                 WHERE ${PUBLISHED_SQL} AND p.category_id IN (${inCats}) GROUP BY j.key, j.value ORDER BY j.key, n DESC`).bind(now.toISOString(), ...categoryIds),
  ];
  if (specKeys.length) {
    stmts.push(db.prepare(`SELECT s.field_key AS k, s.value AS v, COUNT(DISTINCT p.id) AS n FROM products p JOIN product_spec_values s ON s.product_id = p.id
                 WHERE ${PUBLISHED_SQL} AND p.category_id IN (${inCats}) AND s.field_key IN (${specKeys.map(() => '?').join(',')}) GROUP BY s.field_key, s.value ORDER BY n DESC`).bind(now.toISOString(), ...categoryIds, ...specKeys));
  }
  const [attrs, specs] = await db.batch(stmts);
  const group = (rows: Array<{ k: string; v: string; n: number }>) => {
    const m = new Map<string, Array<{ value: string; count: number }>>();
    for (const r of rows) m.set(r.k, [...(m.get(r.k) ?? []), { value: String(r.v), count: Number(r.n) }]);
    return m;
  };
  const a = group(attrs.results as Array<{ k: string; v: string; n: number }>);
  for (const va of template.variantAttributes) {
    const values = a.get(va.attributeTypeId);
    if (values && values.length > 1) out.push({ key: va.attributeTypeId, label: va.label, kind: 'a', values: values.slice(0, 20) });
  }
  if (specs) {
    const s = group(specs.results as Array<{ k: string; v: string; n: number }>);
    for (const f of template.specFields.filter(x => x.filterable)) {
      const values = s.get(f.key);
      if (values && values.length > 1) out.push({ key: f.key, label: f.label, kind: 'f', values: values.map(v => ({ ...v, label: f.type === 'boolean' ? (v.value === '1' ? 'Yes' : 'No') : v.value })).slice(0, 20) });
    }
  }
  return out;
}

/** Category page header: the category, its effective template (inherited when not set) and its season links. */
export async function getCategoryBySlug(db: D1Database, slug: string): Promise<{ id: number; slug: string; name: string; description: string | null; metaTitle: string | null; metaDescription: string | null; seasonVisibility: string; templateId: string; parentId: number | null; isActive: boolean; seasonIds: number[] } | null> {
  const r = await db.prepare(
    `WITH RECURSIVE up(id, parent_id, template_id, lvl) AS (
       SELECT id, parent_id, template_id, 0 FROM categories WHERE slug = ? AND deleted_at IS NULL
       UNION ALL SELECT c.id, c.parent_id, c.template_id, up.lvl + 1 FROM categories c JOIN up ON c.id = up.parent_id WHERE up.template_id IS NULL AND up.lvl < 3)
     SELECT c.*, (SELECT template_id FROM up WHERE template_id IS NOT NULL ORDER BY lvl LIMIT 1) AS effective_template,
            (SELECT json_group_array(season_id) FROM category_seasons cs WHERE cs.category_id = c.id) AS season_ids
       FROM categories c WHERE c.slug = ? AND c.deleted_at IS NULL`,
  ).bind(slug, slug).first<Record<string, unknown>>();
  if (!r) return null;
  return {
    id: Number(r.id), slug: String(r.slug), name: String(r.name), description: (r.description as string) ?? null, metaTitle: (r.meta_title as string) ?? null,
    metaDescription: (r.meta_description as string) ?? null, seasonVisibility: String(r.season_visibility), templateId: String(r.effective_template ?? ''),
    parentId: r.parent_id == null ? null : Number(r.parent_id), isActive: Boolean(r.is_active), seasonIds: parseJson<number[]>(r.season_ids, []),
  };
}

/** Delivery zone summary for the product page delivery panel. */
export async function zoneSummaries(db: D1Database): Promise<Array<{ name: string; eta_text: string; base_charge_paisa: number }>> {
  return (await db.prepare('SELECT name, eta_text, base_charge_paisa FROM delivery_zones ORDER BY sort_order').all<{ name: string; eta_text: string; base_charge_paisa: number }>()).results;
}

export async function sitemapEntries(db: D1Database, nowIso: string): Promise<{ products: Array<{ slug: string; updated_at: string }>; categories: Array<{ slug: string; updated_at: string }> }> {
  const [products, cats] = await db.batch([
    db.prepare("SELECT slug, updated_at FROM products WHERE deleted_at IS NULL AND (status = 'published' OR (status = 'scheduled' AND publish_at <= ?))").bind(nowIso),
    db.prepare('SELECT slug, updated_at FROM categories WHERE is_active = 1 AND deleted_at IS NULL'),
  ]);
  return { products: products.results as Array<{ slug: string; updated_at: string }>, categories: cats.results as Array<{ slug: string; updated_at: string }> };
}

export async function suggestCategories(db: D1Database, terms: string[]): Promise<Array<{ slug: string; name: string }>> {
  if (!terms.length) return [];
  return (await db.prepare(`SELECT slug, name FROM categories WHERE is_active = 1 AND deleted_at IS NULL AND (${terms.map(() => "name LIKE ? ESCAPE '\\'").join(' OR ')}) LIMIT 4`)
    .bind(...terms.map(t => `%${likeEscape(t)}%`)).all<{ slug: string; name: string }>()).results;
}

export async function productExists(db: D1Database, id: number): Promise<boolean> {
  return Boolean(await db.prepare('SELECT 1 FROM products WHERE id = ? AND deleted_at IS NULL').bind(id).first());
}

export interface LiveVariant { id: number; pricePaisa: number; compareAtPricePaisa: number | null; available: number; canBuy: boolean; label: string }

/**
 * Live price and stock for cached pages (Section 2.2): /api/live?ids=… fills these in after the cached HTML paints.
 * Checkout always re-validates on the server.
 */
export async function liveProducts(db: D1Database, ids: number[], now = new Date()): Promise<Record<number, { variants: LiveVariant[]; availability: Availability }>> {
  if (!ids.length) return {};
  const rows = await db.prepare(
    `SELECT p.id AS pid, p.fulfilment_mode, p.preorder_dispatch_date, v.id, v.price_paisa, v.compare_at_price_paisa, v.stock, v.reserved,
            (SELECT json_group_array(ps.season_id) FROM product_seasons ps WHERE ps.product_id = p.id) AS season_ids
       FROM products p JOIN product_variants v ON v.product_id = p.id AND v.is_active = 1
      WHERE p.id IN (${ids.map(() => '?').join(',')}) AND ${PUBLISHED_SQL} ORDER BY v.sort_order, v.id`,
  ).bind(...ids, now.toISOString()).all<Record<string, unknown>>();
  const seasons = await getSeasons(db);
  const today = bdDate(now);
  const out: Record<number, { variants: LiveVariant[]; availability: Availability }> = {};
  const totals = new Map<number, number>();
  for (const r of rows.results) {
    const pid = Number(r.pid);
    const linked = seasons.filter(s => parseJson<number[]>(r.season_ids, []).includes(s.id));
    const available = Math.max(0, Number(r.stock) - Number(r.reserved));
    const a = productAvailability(r as { fulfilment_mode: string; preorder_dispatch_date: string | null }, linked, available, today);
    (out[pid] ??= { variants: [], availability: a }).variants.push({
      id: Number(r.id), pricePaisa: Number(r.price_paisa), compareAtPricePaisa: r.compare_at_price_paisa == null ? null : Number(r.compare_at_price_paisa),
      available, canBuy: a.canBuy, label: a.label,
    });
    totals.set(pid, (totals.get(pid) ?? 0) + available);
    out[pid].availability = productAvailability(r as { fulfilment_mode: string; preorder_dispatch_date: string | null }, linked, totals.get(pid)!, today);
  }
  return out;
}

/** Variant rows with everything cart pricing needs (prices always come from here, never from the browser). */
export async function cartVariantRows(db: D1Database, ids: number[]): Promise<Array<Record<string, unknown>>> {
  if (!ids.length) return [];
  return (await db.prepare(
    `SELECT v.*, p.id AS pid, p.slug, p.name, p.template_id, p.status, p.publish_at, p.deleted_at, p.free_delivery, p.shipping_profile,
            p.bulky_delivery_mode, p.fulfilment_mode, p.preorder_advance_type, p.preorder_advance_paisa, p.preorder_dispatch_date,
            p.made_to_order_lead_days,
            (SELECT url FROM product_media m WHERE m.product_id = p.id AND m.kind = 'image' ORDER BY m.sort_order, m.id LIMIT 1) AS image_url,
            (SELECT json_group_array(ps.season_id) FROM product_seasons ps WHERE ps.product_id = p.id) AS season_ids
       FROM product_variants v JOIN products p ON p.id = v.product_id
      WHERE v.id IN (${ids.map(() => '?').join(',')})`,
  ).bind(...ids).all<Record<string, unknown>>()).results;
}
