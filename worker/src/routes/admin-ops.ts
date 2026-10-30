/** Admin operations: dashboard, customers, seasons, delivery zones & geo, couriers, synonyms, inventory, outbox, audit. */
import { Hono, type Context } from 'hono';
import type { AppEnv } from '../env';
import { TAG } from '../lib/cache-tags';
import { bdDate, daysBetween, isIsoDate } from '../lib/dates';
import { bad, HttpError, int, notFound, parseJson, posInt, readJson, slugify, str } from '../lib/http';
import { localPhone, phonePrefixRange } from '../lib/phone';
import { isSeasonActive, nextSeason, productAvailability } from '../lib/seasons';
import { STAGE_MEANING, STAGES, STATUS_LABELS } from '../lib/state-machine';
import { SMS } from '../lib/sms';
import { listAudit } from '../repo/admins';
import { purgeBacklog } from '../repo/cache';
import { getSeasons } from '../repo/catalog';
import { listCustomers, setTrusted } from '../repo/customers';
import { dashboardFigures, stageCounts } from '../repo/dashboard';
import { attemptsToday } from '../repo/fraud';
import {
  addPostcode, assignDistrictZone, assignUpazilaZone, bulkAssignPostcodes, courierAreas, deleteZone, districtById, fixPostcode, listPostcodes, postcodeDistrict, postcodeSummary,
  saveCourierArea, saveZone as saveZoneRow, unmatchedPostcodeCounts, upazilaDistrict, upazilasOf, zoneIsDefault, zonesOverview, zoneUsedByOrders,
} from '../repo/geo';
import { newIncompleteCount } from '../repo/incomplete';
import { ADJUST_REASONS, adjustStock, inventoryList, lowStock, movements, productAvailable, stockValue, variantProduct } from '../repo/inventory';
import { addSynonym, deleteSynonym, listSynonyms, listWholesale, markNotified, notifySummary, setWholesaleStatus, waitingNotify } from '../repo/misc';
import { createSeason, deleteSeason, resetEndedSeasons, seasonReadiness, seasonsOfProduct, seasonsWithCounts, updateSeason } from '../repo/seasons';
import { bumpGeoVersion, loadSettings } from '../repo/settings';
import { listOutbox } from '../repo/sms';
import { productRow } from '../repo/catalog-admin';
import { sendSms } from '../services/sms';
import { COURIERS } from '../services/orders';
import { allowed, audit, need, refresh } from './admin-helpers';

export const adminOps = new Hono<AppEnv>();

/** UTC ISO range for a Bangladesh calendar day. */
function bdDayRange(day: string): [string, string] {
  const start = new Date(Date.parse(`${day}T00:00:00+06:00`)).toISOString();
  const end = new Date(Date.parse(`${day}T00:00:00+06:00`) + 86_400_000).toISOString();
  return [start, end];
}

// ───────────── Dashboard ─────────────

adminOps.get('/dashboard', need('dashboard'), async c => {
  const db = c.env.DB;
  const today = bdDate();
  const [start, end] = bdDayRange(today);
  const chartStart = bdDayRange(new Date(Date.now() - 13 * 86_400_000 + 6 * 3_600_000).toISOString().slice(0, 10))[0];
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [stages, fig, low, geo, attempts, incomplete, backlog] = await Promise.all([
    stageCounts(db, new Date(Date.now() - 30 * 86_400_000).toISOString()),
    dashboardFigures(db, { todayStartIso: start, todayEndIso: end, chartStartIso: chartStart, weekAgoIso: weekAgo, todayBd: today }),
    lowStock(db),
    unmatchedPostcodeCounts(db),
    attemptsToday(db, start),
    newIncompleteCount(db, weekAgo),
    purgeBacklog(db),
  ]);

  const seasons = await getSeasons(db);
  const active = seasons.filter(s => isSeasonActive(s, today)).map(s => ({ id: s.id, name: s.name, endsOn: s.ends_on, daysLeft: daysBetween(today, s.ends_on!) }));
  const next = nextSeason(seasons, today);
  const undated = seasons.filter(s => s.is_enabled && (!s.starts_on || !s.ends_on)).map(s => s.name);

  // "Needs your attention today" (Section 31).
  const attention: Array<{ level: 'info' | 'warn' | 'alert'; text: string; href: string }> = [];
  if (stages.new) attention.push({ level: 'alert', text: `${stages.new} new order(s) waiting for confirmation`, href: '#/orders?status=new' });
  if (stages.held) attention.push({ level: 'alert', text: `${stages.held} order(s) on hold for review (possible duplicate or too many orders)`, href: '#/orders?status=held' });
  if (incomplete) attention.push({ level: 'info', text: `${incomplete} incomplete checkout(s) to call in the last 7 days`, href: '#/incomplete' });
  if (fig.advancesToVerify) attention.push({ level: 'warn', text: `${fig.advancesToVerify} advance payment(s) to verify`, href: '#/orders?advance=submitted' });
  if (stages.awaitingReturnScan) attention.push({ level: 'warn', text: `${stages.awaitingReturnScan} returned parcel(s) not scanned in yet (stock comes back on scan)`, href: '#/returns' });
  if (low.length) attention.push({ level: 'warn', text: `${low.length} option(s) with 5 or fewer available`, href: '#/inventory' });
  if (fig.preordersToDispatch) attention.push({ level: 'info', text: `${fig.preordersToDispatch} confirmed pre-order(s) to dispatch`, href: '#/preorders' });
  if (geo.unmatched) attention.push({ level: 'info', text: `${geo.unmatched} postcode(s) not linked to an area yet`, href: '#/geo?status=unmatched' });
  if (attempts) attention.push({ level: 'info', text: `${attempts} blocked or held attempt(s) today to glance through`, href: '#/security' });
  if (undated.length) attention.push({ level: 'warn', text: `Set this year's dates for: ${undated.join(', ')}`, href: '#/seasons' });
  if (next && next.daysUntil <= 30) {
    const r = await seasonReadiness(db, next.season.id);
    attention.push({ level: 'warn', text: `${next.season.name} starts in ${next.daysUntil} day(s). ${r.hidden} product(s) still hidden and ${r.empty} with no stock.`, href: '#/seasons' });
  }
  if (fig.expiredFood) attention.push({ level: 'alert', text: `${fig.expiredFood} live food product(s) are past their best-before date`, href: '#/products?status=published' });

  const s = await loadSettings(db);
  const wallets = parseJson<unknown[]>(s.manual_wallets, []);
  const health = [
    { label: 'Cash on Delivery', ok: true, text: 'Cash on Delivery working' },
    { label: 'Mobile wallets', ok: wallets.length > 0, text: wallets.length ? `${wallets.length} wallet number(s) for advances` : 'Add bKash/Nagad numbers for advances' },
    { label: 'SMS', ok: Boolean(c.env.SMS_PROVIDER && c.env.SMS_API_KEY), text: c.env.SMS_PROVIDER ? 'SMS provider connected' : 'SMS provider not connected (messages are logged only)' },
    { label: 'Bot check', ok: Boolean(c.env.TURNSTILE_SECRET), text: c.env.TURNSTILE_SECRET ? 'Turnstile on checkout' : 'Turnstile not configured' },
    { label: 'Edge cache', ok: backlog < 50, text: backlog ? `${backlog} page tag(s) waiting to refresh` : 'Pages up to date at the edge' },
    { label: 'Photo storage', ok: Boolean(c.env.MEDIA), text: c.env.MEDIA ? 'Photo storage (R2) on' : 'Photo storage off: switch on R2 in Cloudflare' },
    { label: 'Courier', ok: false, text: 'Courier API not connected yet (Phase 2)' },
  ];

  return c.json({
    stages: STAGES.map(st => ({ value: st, label: STATUS_LABELS[st], meaning: STAGE_MEANING[st], count: stages[st], scope: ['new', 'confirmed', 'packed', 'in_courier'].includes(st) ? 'now' : 'last 30 days' })),
    held: stages.held, awaitingReturnScan: stages.awaitingReturnScan, incomplete,
    kpis: {
      todayOrders: fig.todayOrders, todayRevenuePaisa: fig.todayRevenuePaisa, codWithCourierPaisa: fig.codWithCourierPaisa,
      awaitingConfirmation: stages.new, lowStock: low.length, ...(allowed(c, 'cost:read') ? { stockValuePaisa: (await stockValue(db)).valuePaisa } : {}),
    },
    seasons: { active, next: next ? { name: next.season.name, startsOn: next.season.starts_on, daysUntil: next.daysUntil } : null, undated },
    chart: fig.chart, recentOrders: fig.recent, lowStock: low, attention, health, fuzzyPostcodes: geo.fuzzy,
  });
});

// ───────────── Customers, notify-me, wholesale ─────────────

adminOps.get('/customers', need('customers:read'), async c => {
  const q = str(c.req.query('q'), 60);
  const rows = await listCustomers(c.env.DB, { phoneRange: q ? phonePrefixRange(q) : null, namePrefix: q && !phonePrefixRange(q) ? q : null });
  return c.json(rows.map(r => ({ ...r, phone: localPhone(String(r.phone)) })));
});

adminOps.post('/customers/:id/trusted', need('orders:write'), async c => {
  const trusted = Boolean((await readJson(c)).trusted);
  await setTrusted(c.env.DB, posInt(c.req.param('id')) ?? 0, trusted);
  await audit(c, 'customer.trusted', 'customer', c.req.param('id'), { trusted });
  return c.json({ ok: true });
});

adminOps.get('/notify-requests', need('orders:read'), async c => c.json(await notifySummary(c.env.DB)));

export async function sendBackInSeason(env: AppEnv['Bindings'], productId: number): Promise<number> {
  const p = await productRow(env.DB, productId);
  if (!p) return 0;
  const seasonRows = await seasonsOfProduct(env.DB, productId);
  const stock = await productAvailable(env.DB, productId);
  const avail = productAvailability(p as { fulfilment_mode: string }, seasonRows as never, stock, bdDate());
  if (!avail.canBuy) throw new HttpError(409, `${String(p.name)} is not available yet (${avail.label}).`);
  const waiting = await waitingNotify(env.DB, productId);
  for (const w of waiting) {
    await sendSms(env, { to: w.phone, body: SMS.backInSeason(String(p.name), `${env.SITE_URL}/p/${String(p.slug)}`), kind: 'back_in_season' });
    await markNotified(env.DB, w.id);
  }
  return waiting.length;
}

adminOps.post('/notify-requests/send', need('orders:write'), async c => {
  const productId = posInt((await readJson(c)).productId) ?? 0;
  const sent = await sendBackInSeason(c.env, productId);
  await audit(c, 'notify.send', 'product', productId, { sent });
  return c.json({ ok: true, sent });
});

adminOps.get('/wholesale', need('customers:read'), async c => c.json((await listWholesale(c.env.DB)).map(r => ({ ...r, phone: localPhone(String(r.phone)) }))));
adminOps.put('/wholesale/:id', need('orders:write'), async c => {
  const status = str((await readJson(c)).status);
  if (!['new', 'contacted', 'won', 'lost'].includes(status)) throw bad('Unknown status.');
  await setWholesaleStatus(c.env.DB, posInt(c.req.param('id')) ?? 0, status);
  return c.json({ ok: true });
});

// ───────────── Seasons ─────────────

adminOps.get('/seasons', need('catalog:read'), async c => {
  const today = bdDate();
  return c.json((await seasonsWithCounts(c.env.DB)).map(s => {
    const state = !s.starts_on || !s.ends_on ? 'needs_dates' : !s.is_enabled ? 'off' : String(s.ends_on) < today ? 'past' : String(s.starts_on) > today ? 'upcoming' : 'active';
    return { ...s, banners: parseJson(s.banners, []), state, daysUntil: s.starts_on && state === 'upcoming' ? daysBetween(today, String(s.starts_on)) : null, daysLeft: state === 'active' ? daysBetween(today, String(s.ends_on)) : null };
  }));
});

async function saveSeason(c: Context<AppEnv>, id: number | null) {
  const b = await readJson(c);
  const name = str(b.name, 60);
  if (!name) throw bad('Name the season.');
  const starts = str(b.startsOn, 10) || null;
  const ends = str(b.endsOn, 10) || null;
  if ((starts && !isIsoDate(starts)) || (ends && !isIsoDate(ends))) throw bad('Use real dates.');
  if (starts && ends && ends < starts) throw bad('The season must end after it starts.');
  const banners = Array.isArray(b.banners) ? (b.banners as Array<Record<string, unknown>>).slice(0, 5).map(x => ({
    headline: str(x.headline, 80), subline: str(x.subline, 160), cta_text: str(x.cta_text, 30) || 'Shop now', cta_href: str(x.cta_href, 200) || '/',
    theme: ['chili', 'turmeric', 'clove', 'leaf'].includes(String(x.theme)) ? String(x.theme) : 'chili', image: str(x.image, 300),
  })).filter(x => x.headline) : [];
  const input = {
    name, startsOn: starts, endsOn: ends, accentLabel: str(b.accentLabel, 40) || null, accentColor: /^#[0-9a-fA-F]{6}$/.test(str(b.accentColor)) ? str(b.accentColor) : null,
    banners, landingIntro: str(b.landingIntro, 300) || null, backInSeasonText: str(b.backInSeasonText, 40) || null, isEnabled: b.isEnabled !== false,
  };
  let sid = id;
  let slug: string | null;
  if (id) {
    slug = await updateSeason(c.env.DB, id, input);
    if (!slug) throw notFound();
  } else {
    slug = slugify(str(b.slug, 60) || name);
    try { sid = await createSeason(c.env.DB, slug, input); } catch { throw bad('A season with that web address already exists.'); }
  }
  await audit(c, id ? 'season.update' : 'season.create', 'season', sid, { name, starts, ends });
  // Season dates and banners change the homepage, the menu (seasonal categories) and the season page.
  await refresh(c, [TAG.site, TAG.season(slug)]);
  return c.json({ id: sid }, id ? 200 : 201);
}

adminOps.post('/seasons', need('seasons:write'), c => saveSeason(c, null));
adminOps.put('/seasons/:id', need('seasons:write'), c => saveSeason(c, posInt(c.req.param('id'))));
adminOps.delete('/seasons/:id', need('seasons:write'), async c => {
  const id = posInt(c.req.param('id')) ?? 0;
  const slug = await deleteSeason(c.env.DB, id);
  await audit(c, 'season.delete', 'season', id);
  await refresh(c, [TAG.site, ...(slug ? [TAG.season(slug)] : [])]);
  return c.json({ ok: true });
});

/** "Copy last year's seasons": seasons that have ended keep their products and banners, with dates cleared for the owner to confirm. */
adminOps.post('/seasons/copy-last-year', need('seasons:write'), async c => {
  const reset = await resetEndedSeasons(c.env.DB, bdDate());
  await audit(c, 'season.copy_last_year', 'season', null, { reset });
  await refresh(c, [TAG.site]);
  return c.json({ ok: true, reset });
});

// ───────────── Delivery zones & geo ─────────────

adminOps.get('/zones', need('settings:read'), async c => c.json({ ...(await zonesOverview(c.env.DB)), couriers: COURIERS }));

async function saveZone(c: Context<AppEnv>, id: number | null) {
  const b = await readJson(c);
  const name = str(b.name, 60);
  if (!name) throw bad('Name the zone.');
  const money = (k: string) => { const n = int(b[k]); if (n === null || n < 0) throw bad('Charges must be 0 or more.'); return n; };
  const courier = str(b.defaultCourier, 30) || null;
  if (courier && !(courier in COURIERS)) throw bad('Unknown courier.');
  try {
    await saveZoneRow(c.env.DB, id, {
      name, baseChargePaisa: money('baseChargePaisa'), baseWeightGrams: posInt(b.baseWeightGrams) ?? 1000, extraPerKgPaisa: money('extraPerKgPaisa'),
      bulkyChargePaisa: money('bulkyChargePaisa'), etaText: str(b.etaText, 40) || '3–5 days', isDefault: Boolean(b.isDefault), sortOrder: int(b.sortOrder) ?? 0, defaultCourier: courier,
    });
  } catch { throw bad('A zone with that name already exists.'); }
  await audit(c, id ? 'zone.update' : 'zone.create', 'zone', id, { name });
  await refresh(c, ['zones']);
  return c.json({ ok: true }, id ? 200 : 201);
}

adminOps.post('/zones', need('geo:write'), c => saveZone(c, null));
adminOps.put('/zones/:id', need('geo:write'), c => saveZone(c, posInt(c.req.param('id'))));
adminOps.delete('/zones/:id', need('geo:write'), async c => {
  const id = posInt(c.req.param('id')) ?? 0;
  if (await zoneIsDefault(c.env.DB, id)) throw bad('Choose another default zone first.');
  if (await zoneUsedByOrders(c.env.DB, id)) throw bad('Orders use this zone. Move its districts instead of deleting it.');
  await deleteZone(c.env.DB, id);
  await audit(c, 'zone.delete', 'zone', id);
  await refresh(c, ['zones']);
  return c.json({ ok: true });
});

adminOps.put('/zones/assign-district', need('geo:write'), async c => {
  const b = await readJson(c);
  const d = posInt(b.districtId);
  if (!d) throw bad('Choose a district.');
  await assignDistrictZone(c.env.DB, d, posInt(b.zoneId));
  await audit(c, 'zone.assign_district', 'district', d, { zone: posInt(b.zoneId) });
  return c.json({ ok: true });
});

adminOps.put('/zones/assign-upazila', need('geo:write'), async c => {
  const b = await readJson(c);
  const u = posInt(b.upazilaId);
  if (!u) throw bad('Choose an area.');
  await assignUpazilaZone(c.env.DB, u, posInt(b.zoneId));
  await audit(c, 'zone.assign_upazila', 'upazila', u, { zone: posInt(b.zoneId) });
  return c.json({ ok: true });
});

adminOps.get('/geo/summary', need('settings:read'), async c => c.json(await postcodeSummary(c.env.DB)));

adminOps.get('/geo/postcodes', need('settings:read'), async c => {
  const status = c.req.query('status');
  return c.json(await listPostcodes(c.env.DB, {
    status: status && ['exact', 'alias', 'fuzzy', 'unmatched', 'manual'].includes(status) ? status : undefined,
    districtId: posInt(c.req.query('district')), q: str(c.req.query('q'), 40) || undefined, page: Math.max(1, Number(c.req.query('page')) || 1),
  }));
});

adminOps.get('/geo/districts/:id/upazilas', need('settings:read'), async c => c.json(await upazilasOf(c.env.DB, posInt(c.req.param('id')) ?? 0)));

async function checkUpazila(db: D1Database, districtId: number, upazilaId: number | null) {
  if (!upazilaId) return;
  if ((await upazilaDistrict(db, upazilaId)) !== districtId) throw bad('That area is not in the postcode’s district.');
}

adminOps.put('/geo/postcodes/:id', need('geo:write'), async c => {
  const id = posInt(c.req.param('id')) ?? 0;
  const b = await readJson(c);
  const district = await postcodeDistrict(c.env.DB, id);
  if (!district) throw notFound();
  const upazilaId = posInt(b.upazilaId);
  await checkUpazila(c.env.DB, district, upazilaId);
  await fixPostcode(c.env.DB, id, upazilaId, str(b.postOffice, 80) || null);
  await bumpGeoVersion(c.env.DB);
  await audit(c, 'geo.postcode_fix', 'postcode', id, { upazilaId });
  return c.json({ ok: true });
});

adminOps.post('/geo/postcodes/bulk-assign', need('geo:write'), async c => {
  const b = await readJson(c);
  const ids = Array.isArray(b.ids) ? (b.ids as unknown[]).map(Number).filter(Number.isInteger).slice(0, 200) : [];
  const upazilaId = posInt(b.upazilaId);
  if (!ids.length || !upazilaId) throw bad('Choose postcodes and an area.');
  const district = await upazilaDistrict(c.env.DB, upazilaId);
  if (!district) throw bad('Unknown area.');
  const updated = await bulkAssignPostcodes(c.env.DB, ids, upazilaId, district);
  await bumpGeoVersion(c.env.DB);
  await audit(c, 'geo.postcode_bulk', 'upazila', upazilaId, { ids });
  return c.json({ ok: true, updated });
});

adminOps.post('/geo/postcodes', need('geo:write'), async c => {
  const b = await readJson(c);
  const postcode = str(b.postcode, 4);
  if (!/^\d{4}$/.test(postcode)) throw bad('Postcodes have 4 digits.');
  const office = str(b.postOffice, 80);
  if (!office) throw bad('Add the post office name.');
  const d = await districtById(c.env.DB, posInt(b.districtId) ?? 0);
  if (!d) throw bad('Choose the district.');
  const upazilaId = posInt(b.upazilaId);
  await checkUpazila(c.env.DB, d.id, upazilaId);
  await addPostcode(c.env.DB, { postcode, postOffice: office, divisionId: d.division_id, districtId: d.id, upazilaId });
  await bumpGeoVersion(c.env.DB);
  await audit(c, 'geo.postcode_add', 'postcode', postcode);
  return c.json({ ok: true }, 201);
});

adminOps.get('/courier-areas', need('settings:read'), async c => {
  const courier = str(c.req.query('courier'), 30) || 'steadfast';
  const district = posInt(c.req.query('district'));
  return c.json(district ? await courierAreas(c.env.DB, courier, district) : []);
});

adminOps.put('/courier-areas', need('geo:write'), async c => {
  const b = await readJson(c);
  const courier = str(b.courier, 30);
  const upazilaId = posInt(b.upazilaId);
  if (!courier || !upazilaId) throw bad('Choose the courier and area.');
  await saveCourierArea(c.env.DB, { courier, upazilaId, cityId: str(b.cityId, 20) || null, zoneId: str(b.zoneId, 20) || null, areaId: str(b.areaId, 20) || null, label: str(b.label, 80) || null });
  await audit(c, 'courier.map', 'upazila', upazilaId, { courier });
  return c.json({ ok: true });
});

// ───────────── Synonyms, inventory, outbox, audit ─────────────

adminOps.get('/synonyms', need('catalog:read'), async c => c.json(await listSynonyms(c.env.DB)));
adminOps.post('/synonyms', need('catalog:write'), async c => {
  const b = await readJson(c);
  const group = slugify(str(b.groupKey, 40)).replace(/-/g, '_');
  const term = str(b.term, 60).toLowerCase();
  if (!group || !term) throw bad('Enter the group and the search word.');
  try { await addSynonym(c.env.DB, group, term); } catch { throw bad('That word is already in a group.'); }
  await audit(c, 'synonym.add', 'synonym', term, { group });
  return c.json({ ok: true }, 201);
});
adminOps.delete('/synonyms/:id', need('catalog:write'), async c => {
  await deleteSynonym(c.env.DB, posInt(c.req.param('id')) ?? 0);
  return c.json({ ok: true });
});

adminOps.get('/inventory/reasons', need('catalog:read'), c => c.json(ADJUST_REASONS));

/** Stock adjustments always go through the ledger with a reason (damaged, expired, missing… or received). */
adminOps.post('/inventory/adjust', need('inventory:write'), async c => {
  const b = await readJson(c);
  const variantId = posInt(b.variantId);
  const change = int(b.change);
  const reason = str(b.reason);
  if (!variantId || !change) throw bad('Enter the option and how many to add or remove.');
  if (!(reason in ADJUST_REASONS)) throw bad('Choose the reason for the change.');
  if (reason === 'received' && change < 0) throw bad('Received stock adds to the count. Use another reason to remove stock.');
  try {
    await adjustStock(c.env.DB, { variantId, change, reason, batchNo: str(b.batchNo, 60) || null, note: str(b.note, 300) || null, adminId: c.var.session.adminId });
  } catch (e) {
    if (/CHECK/.test(String(e))) throw bad('Stock cannot go below zero or below what confirmed orders are holding.');
    throw e;
  }
  await audit(c, 'inventory.adjust', 'variant', variantId, { change, reason });
  const v = await variantProduct(c.env.DB, variantId);
  // Stock shows through /api/live, but "Out of stock" badges and availability are also in the cached HTML.
  if (v) await refresh(c, [TAG.product(v.product_id)]);
  return c.json({ ok: true });
});

adminOps.get('/inventory', need('catalog:read'), async c => {
  const rows = await inventoryList(c.env.DB, allowed(c, 'cost:read'));
  return c.json({ items: rows.map(v => ({ ...v, attributes: parseJson(v.attributes, {}) })), ...(allowed(c, 'cost:read') ? { stockValue: await stockValue(c.env.DB) } : {}) });
});

adminOps.get('/inventory/log', need('catalog:read'), async c => c.json(await movements(c.env.DB, { variantId: posInt(c.req.query('variantId')), batchNo: str(c.req.query('batch'), 60) || null, cursorId: posInt(c.req.query('before')) })));

adminOps.get('/sms-outbox', need('orders:read'), async c => c.json(await listOutbox(c.env.DB, posInt(c.req.query('before')))));

adminOps.get('/audit', need('audit:read'), async c => c.json(await listAudit(c.env.DB, posInt(c.req.query('before')))));
