/**
 * Reads the district (and, when it is named, the thana) out of the address a customer typed, in English or Bangla.
 * Checkout asks only for the delivery area and the address in the customer's own words; this fills the order's
 * district for the dashboard map, the reports and the courier. Best effort: an address that names no place falls back to
 * the chosen delivery area's own district, and otherwise stays unknown (the order goes through all the same).
 */

export interface GeoPlace { id: number; parentId: number; name: string; bn: string | null }
export interface GeoNames { divisions: GeoPlace[]; districts: GeoPlace[]; upazilas: GeoPlace[] }
export interface AreaGuess { divisionId: number; districtId: number; upazilaId: number | null; division: string; district: string; upazila: string | null }

/** Other spellings people type for some districts (the data uses the first, official one). */
const ALIASES: Record<string, string[]> = {
  Chattogram: ['chittagong', 'ctg'], Comilla: ['cumilla'], Barisal: ['barishal'], Bogura: ['bogra'], Jashore: ['jessore'],
  Jhalakathi: ['jhalokathi', 'jhalokati'], Coxsbazar: ["cox's bazar", 'coxs bazar', 'cox bazar', 'coxbazar'],
  Chapainawabganj: ['chapai nawabganj', 'chapainababganj'], Brahmanbaria: ['b baria', 'bbaria'], Moulvibazar: ['moulvi bazar', 'maulvibazar'],
  Netrokona: ['netrakona'], Khagrachhari: ['khagrachari'], Lakshmipur: ['laxmipur'], Narsingdi: ['narshingdi'], Mymensingh: ['maimansingh'],
};

/** Dhaka city areas are not thanas in the data, but people name them instead of "Dhaka". */
const DHAKA_AREAS = [
  'mirpur', 'uttara', 'dhanmondi', 'gulshan', 'banani', 'mohammadpur', 'motijheel', 'badda', 'rampura', 'khilgaon', 'jatrabari', 'tejgaon',
  'farmgate', 'mohakhali', 'bashundhara', 'shyamoli', 'pallabi', 'lalbagh', 'wari', 'demra', 'malibagh', 'moghbazar', 'khilkhet', 'banasree',
  'basabo', 'paltan', 'azimpur', 'kawran bazar', 'karwan bazar', 'old dhaka', 'puran dhaka', 'shantinagar', 'baridhara', 'dakshinkhan', 'uttarkhan',
  'মিরপুর', 'উত্তরা', 'ধানমন্ডি', 'গুলশান', 'বনানী', 'মোহাম্মদপুর', 'মতিঝিল', 'বাড্ডা', 'রামপুরা', 'খিলগাঁও', 'যাত্রাবাড়ী', 'তেজগাঁও', 'ফার্মগেট',
  'মহাখালী', 'বসুন্ধরা', 'শ্যামলী', 'পল্লবী', 'লালবাগ', 'ওয়ারী', 'ডেমরা', 'মালিবাগ', 'মগবাজার', 'খিলক্ষেত', 'বনশ্রী', 'বাসাবো', 'পল্টন', 'আজিমপুর', 'পুরান ঢাকা',
];

const BANGLA = /[ঀ-৿]/;
const norm = (s: string) => ` ${s.toLowerCase().replace(/[’`]/g, "'").replace(/[^\p{L}\p{M}\p{N}']+/gu, ' ').replace(/\s+/g, ' ').trim()} `;

/** Where a name appears in the normalised address (-1 if not): whole words for English, anywhere for Bangla (suffixes like -র). */
function find(text: string, name: string | null | undefined): number {
  if (!name) return -1;
  if (BANGLA.test(name)) return text.indexOf(name.trim());
  const n = norm(name);
  return n.trim().length < 3 ? -1 : text.indexOf(n);
}

export function guessArea(address: string, geo: GeoNames, fallback: { districtIds: number[] } = { districtIds: [] }): AreaGuess | null {
  const text = norm(address);
  const division = (id: number) => geo.divisions.find(d => d.id === id)?.name ?? '';
  const result = (districtId: number, upazila: GeoPlace | null): AreaGuess | null => {
    const d = geo.districts.find(x => x.id === districtId);
    return d ? { divisionId: d.parentId, districtId: d.id, upazilaId: upazila?.id ?? null, division: division(d.parentId), district: d.name, upazila: upazila?.name ?? null } : null;
  };
  // The latest mention wins: addresses end with the district ("…, Pangsa, Rajbari").
  const districtAt = geo.districts.map(d => ({ d, at: Math.max(find(text, d.name), find(text, d.bn), ...(ALIASES[d.name] ?? []).map(a => find(text, a))) })).filter(x => x.at >= 0);
  const upazilaHits = geo.upazilas.filter(u => !/city corporation/i.test(u.name)).map(u => ({ u, at: Math.max(find(text, u.name), find(text, u.bn)) })).filter(x => x.at >= 0);
  const longest = (list: typeof upazilaHits) => list.sort((a, b) => b.u.name.length - a.u.name.length)[0]?.u ?? null;

  if (districtAt.length) {
    // A district with one of its thanas named beats a district named alone.
    const withThana = districtAt.filter(x => upazilaHits.some(h => h.u.parentId === x.d.id));
    const pick = (withThana.length ? withThana : districtAt).sort((a, b) => b.at - a.at)[0].d;
    return result(pick.id, longest(upazilaHits.filter(h => h.u.parentId === pick.id)));
  }
  // "Mirpur 10" means Dhaka's Mirpur (there is a Mirpur thana in Kushtia too, but then the district is written).
  if (DHAKA_AREAS.some(a => find(text, a) >= 0)) {
    const dhaka = geo.districts.find(d => d.name === 'Dhaka');
    if (dhaka) return result(dhaka.id, longest(upazilaHits.filter(h => h.u.parentId === dhaka.id)));
  }
  if (upazilaHits.length) {
    const districts = [...new Set(upazilaHits.map(h => h.u.parentId))];
    // A thana name used in several districts: the delivery area's district settles it, otherwise it stays unknown.
    const only = districts.length === 1 ? districts[0] : districts.find(id => fallback.districtIds.includes(id));
    if (only) return result(only, longest(upazilaHits.filter(h => h.u.parentId === only)));
  }
  return fallback.districtIds.length === 1 ? result(fallback.districtIds[0], null) : null;
}
