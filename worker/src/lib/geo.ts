/** Geo helpers. Location detection is district-level only: the dataset has district coordinates and outlines, nothing finer. */

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function nearestDistrict<T extends { lat: number; lon: number }>(lat: number, lon: number, districts: T[]): { district: T; km: number } | null {
  let best: T | null = null;
  let bestKm = Infinity;
  for (const d of districts) {
    const km = haversineKm(lat, lon, d.lat, d.lon);
    if (km < bestKm) { best = d; bestKm = km; }
  }
  return best ? { district: best, km: bestKm } : null;
}

type Ring = Array<[number, number]>;

function inRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** GeoJSON MultiPolygon coordinates: [polygon][ring][point] with [lon, lat]. */
export function pointInMultiPolygon(lon: number, lat: number, coordinates: Ring[][]): boolean {
  return coordinates.some(([outer, ...holes]) => outer && inRing(lon, lat, outer) && !holes.some(h => inRing(lon, lat, h)));
}

/** Bangladesh bounding box (generous). Used to reject obviously foreign coordinates. */
export function inBangladesh(lat: number, lon: number): boolean {
  return lat >= 20.3 && lat <= 26.8 && lon >= 88.0 && lon <= 92.8;
}

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

/** Server-side re-validation on submit: every ID exists and belongs to its parent; the postcode is checked against the district. */
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
