# Geo data sources (pinned)

| File in `source/bangladesh-geocode/` | Upstream path | Rows |
|---|---|---:|
| `divisions.json` | `divisions/divisions.json` | 8 |
| `districts.json` | `districts/districts.json` (with lat/lon) | 64 |
| `upazilas.json` | `upazilas/upazilas.json` | 494 |
| `unions.json` | `unions/unions.json` (key is spelled `upazilla_id`) | 4,540 |
| `postcode.csv` | `postcode-bd/postcode.csv` (division, district, thana, post office, postcode) | 1,349 |
| `postcode.json` | `postcode-bd/postcode.json` (English + Bangla division, district, thana, post office per postcode; pinned at `8718ada2f7f34b075b7a23d90cb8bbbe615c4b1e`, 2026-10-30) | 1,368 |
| `districts.geojson.txt` | `geojson/districts.geojson.txt` (64 `MultiPolygon` district outlines) | 64 |
| `LICENSE` | `LICENSE` (MIT) | |

- Upstream: https://github.com/bayeziddev/Bangladesh-geocode
- Pinned commit: `c97c6945b018349050496070d982444b7aadfbbf` (2026-10-30)

## Facts checked against the files, not the docs

- Dhaka **division** id is `6` in `divisions.json`. The upstream README's PHP example filters Dhaka with `'1'`, which is Chattagram.
- Dhaka **district** id is `47`.
- `districts.json` spells Comilla `Comilla`; `districts.csv` spells it `Cumilla`. We import the JSON.
- `postcode.csv` uses the pre-2015 seven-division layout (no Mymensingh) and Wikipedia spellings
  (Chittagong, Jessore, Bogra, Barishal, …). The import resolves every postcode district through an alias table and takes
  the division from the matched district.
- The outline file uses a third set of spellings (`Nawabganj` = Chapainawabganj, `Brahamanbaria`, `Jhalokati`, …).
- The source has some typos of its own, e.g. upazila 260 is `Borhan Sddin` (Borhanuddin).

## Licensing to confirm before launch

Bangladesh-geocode is MIT licensed. Its `postcode-bd` folder was produced by `postcode-bd/bdpostcode.php`, which scrapes
Wikipedia's "List of postal codes in Bangladesh". Wikipedia text is CC BY-SA 4.0. Postcode facts themselves are generally
not copyrightable, but keep the attribution line in the site footer's credits page and confirm with the client.

## Bangla postcode names (migration 0007)

`npm run gen:postcode-bn` reads `postcode.json` and writes `worker/migrations/0007_postcode_bangla.sql` and
`data/geo/reports/postcode-bangla-report.csv`:

- **1,110** postcodes get their Bangla post office name (checkout shows "Board Bazar (বোর্ড বাজার)"). 224 entries in
  `postcode.json` carry English text in the Bangla field and 15 have no Bangla entry; those are left without one.
- **213 of the 323** postcodes linked to an area by spelling similarity (`fuzzy`) are confirmed (`alias`): their Bangla
  thana name is exactly the linked upazila's Bangla name. The other 110 stay as they are; no Bangla name pointed to a
  different upazila.
- The **239 unmatched** postcodes (mostly city thanas such as Dhaka's) get no area from the Bangla names either: their
  thanas are not upazilas in `upazilas.json`. Checkout still fills the division and district for them and asks the
  customer to pick the area, so nobody has to fix them by hand.
- Customers can type the postcode in Bangla digits (১২০৬); checkout and the server read it as 1206.

## Regenerating

```bash
npm run gen:geo      # writes worker/migrations/0002_geo_data.sql, data/geo/generated/*, data/geo/reports/*
```

Only regenerate `gen:geo` before the first production migration. After launch, new upstream data goes in as a new,
additive migration (like `0007_postcode_bangla.sql`); the shop owner never has to manage postcodes.
