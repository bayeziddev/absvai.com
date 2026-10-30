import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fold, matchUpazila, normKey } from '../../scripts/import-geo';
import { haversineKm, inBangladesh, nearestDistrict, pointInMultiPolygon } from '../../worker/src/lib/geo';

const districtsFile = JSON.parse(readFileSync('data/geo/source/bangladesh-geocode/districts.json', 'utf8')) as Array<{ data?: Array<Record<string, string>> }>;
const districts = districtsFile.find(x => x.data)!.data!.map(d => ({ id: Number(d.id), name: d.name, lat: Number(d.lat), lon: Number(d.lon) }));
const outlines = JSON.parse(readFileSync('data/geo/generated/districts.json', 'utf8')) as { features: Array<{ properties: { id: number; name: string }; geometry: { coordinates: Array<Array<Array<[number, number]>>> } }> };

describe('nearest district from browser coordinates', () => {
  const cases: Array<[string, number, number, string]> = [
    ['Dhaka (Motijheel)', 23.7330, 90.4172, 'Dhaka'],
    ['Chattogram port', 22.3419, 91.8152, 'Chattogram'],
    ['Sylhet city', 24.8949, 91.8687, 'Sylhet'],
    ['Jashore town', 23.1664, 89.2081, 'Jashore'],
    ['Rajshahi city', 24.3745, 88.6042, 'Rajshahi'],
  ];
  for (const [label, lat, lon, expected] of cases) {
    it(`${label} → ${expected}`, () => {
      expect(nearestDistrict(lat, lon, districts)!.district.name).toBe(expected);
    });
  }

  it('the simplified district outlines contain the same points', () => {
    for (const [, lat, lon, expected] of cases) {
      const hit = outlines.features.filter(f => pointInMultiPolygon(lon, lat, f.geometry.coordinates));
      expect(hit.map(h => h.properties.name)).toContain(expected);
    }
  });

  it('rejects coordinates outside Bangladesh', () => {
    expect(inBangladesh(23.81, 90.41)).toBe(true);
    expect(inBangladesh(51.5, -0.12)).toBe(false);
  });

  it('haversine distance is sane (Dhaka → Chattogram ≈ 215 km)', () => {
    expect(haversineKm(23.8103, 90.4125, 22.3569, 91.7832)).toBeGreaterThan(195);
    expect(haversineKm(23.8103, 90.4125, 22.3569, 91.7832)).toBeLessThan(230);
  });
});

describe('postcode → upazila matching used by the import', () => {
  const tangail = [{ id: 1, name: 'Kalihati' }, { id: 2, name: 'Tangail Sadar' }, { id: 3, name: 'Gopalpur' }];

  it('matches exact names and district sadar aliases', () => {
    expect(matchUpazila('Kalihati', tangail, 'Tangail')).toMatchObject({ id: 1, status: 'exact' });
    expect(matchUpazila('Tangail Sadar ', tangail, 'Tangail')).toMatchObject({ id: 2, status: 'exact' });
    expect(matchUpazila('Tangail', tangail, 'Tangail')).toMatchObject({ id: 2, status: 'alias' });
  });

  it('links spelling variants but labels them fuzzy for review', () => {
    expect(matchUpazila('Kalihaati', tangail, 'Tangail')).toMatchObject({ id: 1, status: 'fuzzy' });
    expect(fold('Rouzan')).toBe(fold('Raozan'));
  });

  it('never guesses when nothing is close', () => {
    expect(matchUpazila('Palton', tangail, 'Tangail')).toMatchObject({ id: null, status: 'unmatched' });
  });

  it('normalises case, spaces and punctuation', () => {
    expect(normKey("Cox's Bazar")).toBe(normKey('Coxsbazar'));
  });

  it('the committed report lists every postcode row once', () => {
    const report = readFileSync('data/geo/reports/postcode-match-report.csv', 'utf8').trim().split('\n');
    expect(report.length - 1).toBe(1349);
    expect(report.find(r => r.startsWith('1000,'))).toMatch(/Dhaka GPO/);
  });
});
