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

