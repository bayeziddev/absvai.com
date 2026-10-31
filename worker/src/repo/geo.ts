/** Geo hierarchy, postcodes, delivery zones and courier area mapping. IDs always come from the imported data files. */
import { rowToZone, type Zone } from '../lib/delivery-charge';

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

// ───────────── Address validation (server re-validates every checkout) ─────────────

export interface AddressIds {
  divisionId: number;
  districtId: number;
  upazilaId: number;
  unionId: number | null;
  postcode: string | null;
}

export interface ValidatedAddress {
  ok: true;
  names: { division: string; district: string; upazila: string; union: string | null };
  postOffice: string | null;
  postcodeMismatch: boolean;
}

/** Every ID exists and belongs to its parent; the postcode is checked against the district (a mismatch is a risk signal). */
export async function validateAddress(db: D1Database, a: AddressIds): Promise<ValidatedAddress | { ok: false; error: string }> {
  const row = await db.prepare(
    `SELECT dv.name AS division, d.name AS district, u.name AS upazila, d.division_id, u.district_id
       FROM geo_districts d JOIN geo_divisions dv ON dv.id = d.division_id
       JOIN geo_upazilas u ON u.id = ? WHERE d.id = ?`,
  ).bind(a.upazilaId, a.districtId).first<{ division: string; district: string; upazila: string; division_id: number; district_id: number }>();
  if (!row) return { ok: false, error: 'Please choose your district and area again.' };
  if (row.division_id !== a.divisionId) return { ok: false, error: 'That district is not in the chosen division.' };
  if (row.district_id !== a.districtId) return { ok: false, error: 'That area is not in the chosen district.' };
  let union: string | null = null;
  if (a.unionId) {
    const u = await db.prepare('SELECT name, upazila_id FROM geo_unions WHERE id = ?').bind(a.unionId).first<{ name: string; upazila_id: number }>();
    if (!u || u.upazila_id !== a.upazilaId) return { ok: false, error: 'That union is not in the chosen area.' };
    union = u.name;
  }
  let postOffice: string | null = null;
  let postcodeMismatch = false;
  if (a.postcode) {
    if (!/^\d{4}$/.test(a.postcode)) return { ok: false, error: 'Postcodes have 4 digits.' };
    const pcs = await db.prepare('SELECT post_office, district_id, upazila_id FROM geo_postcodes WHERE postcode = ?').bind(a.postcode).all<{ post_office: string; district_id: number; upazila_id: number | null }>();
    const inDistrict = pcs.results.filter(p => p.district_id === a.districtId);
    if (pcs.results.length && !inDistrict.length) postcodeMismatch = true;
    postOffice = (inDistrict.find(p => p.upazila_id === a.upazilaId) ?? inDistrict[0])?.post_office ?? null;
  }
  return { ok: true, names: { division: row.division, district: row.district, upazila: row.upazila, union }, postOffice, postcodeMismatch };
}

/**
 * Zone for an address: upazila override → district mapping → default zone.
 * needsArea is true when the district has upazila overrides with different zones and no upazila was chosen,
 * so the shown charge could still change.
 */
export async function resolveZone(db: D1Database, districtId: number, upazilaId: number | null): Promise<{ zone: Zone; needsArea: boolean; defaultCourier: string | null } | null> {
  if (upazilaId) {
    const o = await db.prepare('SELECT z.* FROM zone_upazila_overrides o JOIN delivery_zones z ON z.id = o.zone_id WHERE o.upazila_id = ?').bind(upazilaId).first<Record<string, unknown>>();
    if (o) return { zone: rowToZone(o), needsArea: false, defaultCourier: (o.default_courier as string) ?? null };
  }
  const d = await db.prepare('SELECT z.* FROM zone_districts zd JOIN delivery_zones z ON z.id = zd.zone_id WHERE zd.district_id = ?').bind(districtId).first<Record<string, unknown>>();
  const zoneRow = d ?? (await db.prepare('SELECT * FROM delivery_zones WHERE is_default = 1 ORDER BY sort_order LIMIT 1').first<Record<string, unknown>>());
  if (!zoneRow) return null;
  let needsArea = false;
  if (!upazilaId) {
    const ov = await db.prepare(`SELECT COUNT(*) AS n FROM zone_upazila_overrides o JOIN geo_upazilas u ON u.id = o.upazila_id
                                 WHERE u.district_id = ? AND o.zone_id != ?`).bind(districtId, zoneRow.id).first<{ n: number }>();
    needsArea = (ov?.n ?? 0) > 0;
  }
  return { zone: rowToZone(zoneRow), needsArea, defaultCourier: (zoneRow.default_courier as string) ?? null };
}

// ───────────── Static geo JSON for checkout (versioned, cached forever) ─────────────

export async function geoHierarchy(db: D1Database) {
  const [dv, ds, up] = await db.batch([
    db.prepare('SELECT id, name FROM geo_divisions ORDER BY name'),
    db.prepare('SELECT id, division_id, name, lat, lon FROM geo_districts ORDER BY name'),
    db.prepare('SELECT id, district_id, name, kind FROM geo_upazilas ORDER BY kind ASC, name'),
  ]);
  return {
    divisions: (dv.results as Array<{ id: number; name: string }>).map(r => [r.id, r.name]),
    districts: (ds.results as Array<{ id: number; division_id: number; name: string; lat: number; lon: number }>).map(r => [r.id, r.division_id, r.name, r.lat, r.lon]),
    upazilas: (up.results as Array<{ id: number; district_id: number; name: string }>).map(r => [r.id, r.district_id, r.name]),
  };
}

/** postcode → [post office, division, district, upazila (or null), Bangla post office name (when known)] for checkout. */
export async function postcodeMap(db: D1Database): Promise<Record<string, Array<[string, number, number, number | null] | [string, number, number, number | null, string]>>> {
  const rows = await db.prepare('SELECT postcode, post_office, post_office_bn, division_id, district_id, upazila_id FROM geo_postcodes ORDER BY postcode')
    .all<{ postcode: string; post_office: string; post_office_bn: string | null; division_id: number; district_id: number; upazila_id: number | null }>();
  const map: Record<string, Array<[string, number, number, number | null] | [string, number, number, number | null, string]>> = {};
  for (const r of rows.results) (map[r.postcode] ??= []).push(r.post_office_bn ? [r.post_office, r.division_id, r.district_id, r.upazila_id, r.post_office_bn] : [r.post_office, r.division_id, r.district_id, r.upazila_id]);
  return map;
}

export async function unionsOf(db: D1Database, upazilaId: number): Promise<Array<[number, string]>> {
  const rows = await db.prepare('SELECT id, name FROM geo_unions WHERE upazila_id = ? ORDER BY name').bind(upazilaId).all<{ id: number; name: string }>();
  return rows.results.map(r => [r.id, r.name]);
}

export async function upazilasOf(db: D1Database, districtId: number) {
  return (await db.prepare('SELECT id, name, kind FROM geo_upazilas WHERE district_id = ? ORDER BY kind ASC, name').bind(districtId).all()).results;
}

// ───────────── Delivery zones (admin) ─────────────

export async function zonesOverview(db: D1Database) {
  const [zones, districts, overrides] = await db.batch([
    db.prepare('SELECT z.*, (SELECT COUNT(*) FROM zone_districts d WHERE d.zone_id = z.id) AS district_count FROM delivery_zones z ORDER BY z.sort_order'),
    db.prepare('SELECT d.id, d.name, dv.name AS division, zd.zone_id FROM geo_districts d JOIN geo_divisions dv ON dv.id = d.division_id LEFT JOIN zone_districts zd ON zd.district_id = d.id ORDER BY dv.name, d.name'),
    db.prepare('SELECT o.upazila_id, o.zone_id, u.name, d.name AS district FROM zone_upazila_overrides o JOIN geo_upazilas u ON u.id = o.upazila_id JOIN geo_districts d ON d.id = u.district_id ORDER BY d.name, u.name'),
  ]);
  return { zones: zones.results, districts: districts.results, overrides: overrides.results };
}

export interface ZoneInput { name: string; baseChargePaisa: number; baseWeightGrams: number; extraPerKgPaisa: number; bulkyChargePaisa: number; etaText: string; isDefault: boolean; sortOrder: number; defaultCourier: string | null }

export async function saveZone(db: D1Database, id: number | null, z: ZoneInput): Promise<void> {
  const vals = [z.name, z.baseChargePaisa, z.baseWeightGrams, z.extraPerKgPaisa, z.bulkyChargePaisa, z.etaText, z.isDefault ? 1 : 0, z.sortOrder, z.defaultCourier];
  const stmts = z.isDefault ? [db.prepare('UPDATE delivery_zones SET is_default = 0')] : [];
  if (id) stmts.push(db.prepare('UPDATE delivery_zones SET name = ?, base_charge_paisa = ?, base_weight_grams = ?, extra_per_kg_paisa = ?, bulky_charge_paisa = ?, eta_text = ?, is_default = ?, sort_order = ?, default_courier = ? WHERE id = ?').bind(...vals, id));
  else stmts.push(db.prepare('INSERT INTO delivery_zones (name, base_charge_paisa, base_weight_grams, extra_per_kg_paisa, bulky_charge_paisa, eta_text, is_default, sort_order, default_courier) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(...vals));
  await db.batch(stmts);
}

export async function zoneIsDefault(db: D1Database, id: number): Promise<boolean> {
  return Boolean((await db.prepare('SELECT is_default FROM delivery_zones WHERE id = ?').bind(id).first<{ is_default: number }>())?.is_default);
}

export async function zoneUsedByOrders(db: D1Database, id: number): Promise<boolean> {
  return Boolean(await db.prepare('SELECT 1 FROM orders WHERE delivery_zone_id = ? LIMIT 1').bind(id).first());
}

export async function deleteZone(db: D1Database, id: number): Promise<void> {
  await db.prepare('DELETE FROM delivery_zones WHERE id = ?').bind(id).run();
}

export async function assignDistrictZone(db: D1Database, districtId: number, zoneId: number | null): Promise<void> {
  if (zoneId) await db.prepare('INSERT INTO zone_districts (district_id, zone_id) VALUES (?, ?) ON CONFLICT(district_id) DO UPDATE SET zone_id = excluded.zone_id').bind(districtId, zoneId).run();
  else await db.prepare('DELETE FROM zone_districts WHERE district_id = ?').bind(districtId).run();
}

export async function assignUpazilaZone(db: D1Database, upazilaId: number, zoneId: number | null): Promise<void> {
  if (zoneId) await db.prepare('INSERT INTO zone_upazila_overrides (upazila_id, zone_id) VALUES (?, ?) ON CONFLICT(upazila_id) DO UPDATE SET zone_id = excluded.zone_id').bind(upazilaId, zoneId).run();
  else await db.prepare('DELETE FROM zone_upazila_overrides WHERE upazila_id = ?').bind(upazilaId).run();
}

// ───────────── Postcodes (admin fixes) ─────────────

// ───────────── Courier area mapping ─────────────

export async function saveCourierArea(db: D1Database, m: { courier: string; upazilaId: number; cityId: string | null; zoneId: string | null; areaId: string | null; label: string | null }): Promise<void> {
  await db.prepare(
    `INSERT INTO courier_area_map (courier, upazila_id, courier_city_id, courier_zone_id, courier_area_id, label) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(courier, upazila_id) DO UPDATE SET courier_city_id = excluded.courier_city_id, courier_zone_id = excluded.courier_zone_id, courier_area_id = excluded.courier_area_id, label = excluded.label, updated_at = ${NOW}`,
  ).bind(m.courier, m.upazilaId, m.cityId, m.zoneId, m.areaId, m.label).run();
}
